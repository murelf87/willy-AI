// LA VISTA PREVIA POR DENTRO (rediseño, revisión 22: puntos 11-14, 30, 97, 98, 99 y 100). La página del proyecto se enseña en
// un marco aislado (no puede tocar nada de WILLY). Dentro va un pequeño «vigía» que SOLO le cuenta a WILLY lo que pasa: lo que
// escribe en su consola, sus errores, los recursos que no cargan, a qué página o ruta se va y si se ve algo de verdad (no una
// pantalla en blanco, no algo que se sale de la pantalla). Con eso se hacen la CONSOLA DEL PROYECTO (separada de los registros
// de WILLY), la ruta que se recuerda, la comprobación antes de decir «Lista» y la reparación automática cuando un cambio de
// WILLY rompe la vista previa. Lógica pura: se prueba aparte.
// Revisión 24 (fase 10, «edición visual»; puntos 17-22): el vigía también obedece a WILLY (solo a WILLY, y solo en ESTA carga):
// «elegir» un elemento tocándolo (sin que la página reaccione al clic), marcarlo, revisar el diseño de lo que se ve (se sale,
// texto cortado, cosas que se tapan, poco contraste, letra o botones pequeños, imágenes rotas o deformadas, jerarquía, espaciado)
// y desplazarse a la vez que otra vista previa (para comparar ANTES y DESPUÉS).
// Revisión 26 (mapa de pantallas): el vigía cuenta también los enlaces a otras pantallas de la página («#/…») y obedece «ir» (a
// una pantalla: cambia la ruta «#» sin recargar, como si se pulsara su enlace).

export type ConsoleLevel = "log" | "info" | "warn" | "error";
export type ConsoleEntry = { level: ConsoleLevel; text: string; at: number; /** de dónde sale: la página, un recurso, WILLY… */ source: "pagina" | "recurso" | "willy" };
export type QualitySnapshot = { text: number; elements: number; media: number; overflow: number; width: number; height: number };
/** Estado de la vista previa del taller. Rev25: «compilando» y «no-compila» son de los proyectos React/Vite (se compilan). */
export type PreviewStatus = "vacio" | "sin-pagina" | "sin-vista" | "cargando" | "lista" | "actualizando" | "error" | "en-blanco" | "compilando" | "no-compila";

/** Mensajes que manda el vigía (siempre con `__willyVista: true`). */
export type MonitorMessage =
  | { tipo: "consola"; nivel: ConsoleLevel; texto: string }
  | { tipo: "error"; mensaje: string; linea?: number; columna?: number }
  | { tipo: "recurso"; url: string }
  | { tipo: "navegar"; ruta: string }
  | { tipo: "externo"; url: string }
  | { tipo: "formulario"; accion: string }
  | { tipo: "ruta"; hash: string }
  | { tipo: "calidad"; texto: number; elementos: number; medios: number; desborde: number; ancho: number; alto: number; resumen: string; enlaces?: Array<{ hash: string; texto: string }> }
  // Rev24: el elemento que el dueño ha tocado (o que se ha vuelto a marcar tras recargar), con sus detalles técnicos (internos).
  | {
    tipo: "elemento"; origen: "clic" | "marca"; clase: string; texto: string; selector: string; ruta: string; dentro: string; etiqueta: string;
    id: string; clases: string; html: string; estilos: string; x: number; y: number; w: number; h: number; ancho: number;
  }
  /** Al recargar, el elemento elegido ya no está en la página. */
  | { tipo: "perdido"; selector: string }
  /** El modo «elegir» se ha apagado desde dentro (tecla Escape). */
  | { tipo: "elegir"; activo: boolean }
  /** Revisión del diseño de lo que se ve a este ancho. */
  | { tipo: "revision"; ancho: number; alto: number; problemas: RawIssue[] }
  /** Se ha desplazado la página (fracción 0..1 de lo que se puede bajar), para moverse a la vez en «Comparar». */
  | { tipo: "scroll"; fraccion: number };

/** Un problema de diseño tal como lo cuenta el vigía (en castellano; el selector es interno, para marcarlo y para la IA). */
export type RawIssue = { tipo: string; nivel: string; texto: string; selector: string; clase: string; muestra: string };

/** Órdenes que WILLY manda al vigía de una carga concreta (con su marca: las de otra carga se ignoran). */
export type PreviewOrder =
  | { orden: "elegir"; activo: boolean }
  | { orden: "marcar"; selector: string; como?: "seleccion" | "problema"; etiqueta?: string }
  | { orden: "soltar" }
  | { orden: "revisar" }
  | { orden: "desplazar"; fraccion: number }
  /** Rev26: ir a otra pantalla de la página (su ruta «#/…»; null = la pantalla de inicio). */
  | { orden: "ir"; hash: string | null };

/** Manda una orden al vigía de una vista previa (su ventana y la marca de su carga). false si no se ha podido. */
export function sendOrder(target: Window | null | undefined, token: string, order: PreviewOrder): boolean {
  if (!target) return false;
  try {
    target.postMessage({ __willyOrden: true, k: token, ...order }, "*");
    return true;
  } catch {
    return false;
  }
}

const SAFE_HASH = /^#[^<>"'`\\\s]{0,200}$/;

/**
 * Rev24 · Las herramientas visuales del vigía (JavaScript que va dentro de la página). Van en `String.raw` para que las barras
 * de las expresiones regulares lleguen tal cual. Todo lo que dibuja (los recuadros) son elementos propios «willy-marca» con
 * estilos en línea importantes (los estilos de la página no les afectan) y no reciben clics.
 * - ELEGIR: con el modo activo, al pasar por encima se recuadra lo que hay debajo y al tocarlo se elige (la página NO recibe
 *   ese clic: ni navega, ni envía formularios, ni abre nada). Del trocito tocado se sube a lo que tiene sentido cambiar: el
 *   dibujo entero (no una línea del SVG), el botón o el enlace (no la palabra de dentro). Escape cancela.
 * - MARCAR: recuadra un elemento (el elegido, que se vuelve a buscar al recargar; o un problema de la revisión, que se enseña
 *   unos segundos). SOLTAR quita los recuadros.
 * - REVISAR (D): el diseño de lo que se ve a este ancho, con reglas objetivas (medidas de verdad, no opiniones).
 * - DESPLAZAR / scroll: para mover a la vez dos vistas previas al comparar.
 */
const VISUAL_TOOLS = String.raw`
var CL=function(el){var c=el&&el.className;return String(c&&c.baseVal!==undefined?c.baseVal:c||"").trim()};
var ESC=function(s){try{return CSS.escape(s)}catch(e){return String(s).replace(/[^\w-]/g,"\\$&")}};
var TXT=function(el){var t=el.tagName.toLowerCase(),v="";if(t==="img")v=el.getAttribute("alt")||"";else if(t==="input"||t==="textarea"||t==="select")v=el.getAttribute("placeholder")||el.value||el.getAttribute("name")||"";else v=el.innerText||el.textContent||"";v=String(v||el.getAttribute("aria-label")||el.getAttribute("title")||"").replace(/\s+/g," ").trim();return v.length>80?v.slice(0,79)+"…":v};
var KIND=function(el){var t=el.tagName.toLowerCase(),r=(el.getAttribute("role")||"").toLowerCase(),ty=(el.getAttribute("type")||"").toLowerCase(),b;
if(t==="button"||r==="button"||(t==="input"&&/^(button|submit|reset)$/.test(ty)))return "botón";
if(t==="a")return "enlace";if(t==="img"||t==="picture")return "imagen";
if(t==="svg"){b=el.getBoundingClientRect();return b.width<=48&&b.height<=48?"icono":"imagen"}
if(/^h[1-6]$/.test(t))return "título";if(t==="input"||t==="textarea"||t==="select")return "campo";if(t==="form")return "formulario";
if(t==="nav")return "menú";if(t==="header")return "cabecera";if(t==="footer")return "pie de página";if(t==="ul"||t==="ol")return "lista";
if(t==="li")return "elemento de lista";if(t==="table")return "tabla";if(t==="video")return "vídeo";if(t==="iframe")return "marco";if(t==="label")return "etiqueta";
if(t==="section"||t==="main"||t==="article"||t==="aside")return "sección";
if(t==="p"||t==="span"||t==="small"||t==="strong"||t==="em"||t==="blockquote"||t==="figcaption")return "texto";
if(t==="i"&&el.getBoundingClientRect().width<=48)return "icono";
var cs=getComputedStyle(el),n=el.children.length;
if(/card|tarjeta|tile|panel/i.test(CL(el))||(cs.boxShadow&&cs.boxShadow!=="none"&&n>1)||(parseFloat(cs.borderTopWidth)>0&&parseFloat(cs.borderTopLeftRadius)>0&&n>1))return "tarjeta";
return "bloque"};
var SELR=function(el){var q;if(el.id){q="#"+ESC(el.id);try{if(document.querySelectorAll(q).length===1)return q}catch(e){}}
var parts=[],cur=el;while(cur&&cur.nodeType===1&&cur!==document.documentElement&&parts.length<12){var p=cur.tagName.toLowerCase();
if(cur!==el&&cur.id){q="#"+ESC(cur.id);try{if(document.querySelectorAll(q).length===1){parts.unshift(q);break}}catch(e){}}
var par=cur.parentElement;if(par){var same=0,idx=0;for(var i=0;i<par.children.length;i++){var ch=par.children[i];if(ch.tagName===cur.tagName){same++;if(ch===cur)idx=same}}if(same>1)p+=":nth-of-type("+idx+")"}
parts.unshift(p);cur=par}return parts.join(" > ")};
var TAG=function(el){var c=CL(el).split(/\s+/).filter(Boolean).slice(0,3);return el.tagName.toLowerCase()+(el.id?"#"+el.id:"")+(c.length?"."+c.join("."):"")};
var PATH=function(el){var o=[],cur=el;while(cur&&cur.nodeType===1&&cur!==document.body&&cur!==document.documentElement&&o.length<6){o.unshift(TAG(cur));cur=cur.parentElement}return o.join(" > ")};
var INSIDE=function(el){var o=[],cur=el.parentElement;while(cur&&cur!==document.body&&cur!==document.documentElement&&o.length<3){var k=KIND(cur);if(k!=="bloque"&&k!=="texto"){var tx=(k==="botón"||k==="enlace"||k==="título"||k==="tarjeta")&&TXT(cur)?" «"+SH(TXT(cur),30)+"»":"";o.unshift(k+tx)}cur=cur.parentElement}return o.join(" › ")};
var RGBA=function(s){var m=/rgba?\(([^)]+)\)/.exec(String(s||""));if(!m)return null;var p=m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);if(p.length<3||p.some(isNaN))return null;return [p[0],p[1],p[2],p.length>3?p[3]:1]};
var HEX=function(c){return c?"#"+[c[0],c[1],c[2]].map(function(v){v=Math.max(0,Math.min(255,Math.round(v)));return (v<16?"0":"")+v.toString(16)}).join(""):""};
var MIX=function(top,bot){var a=top[3];return [top[0]*a+bot[0]*(1-a),top[1]*a+bot[1]*(1-a),top[2]*a+bot[2]*(1-a),1]};
var LUM=function(c){var a=[c[0],c[1],c[2]].map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]};
var EFFBG=function(el){var st=[],cur=el;while(cur&&cur.nodeType===1){var cs=getComputedStyle(cur);if(cs.backgroundImage&&cs.backgroundImage!=="none")return null;var c=RGBA(cs.backgroundColor);if(c&&c[3]>0){st.push(c);if(c[3]>=0.999)break}cur=cur.parentElement}var bg=[255,255,255,1];for(var i=st.length-1;i>=0;i--)bg=MIX(st[i],bg);return bg};
var STY=function(el){var cs=getComputedStyle(el),b=el.getBoundingClientRect(),bg=EFFBG(el),fg=RGBA(cs.color);return "color "+HEX(fg)+(bg?", fondo "+HEX(bg):", fondo con imagen o degradado")+", letra "+cs.fontSize+" "+cs.fontWeight+" ("+String(cs.fontFamily).split(",")[0].replace(/["']/g,"").trim()+"), tamaño "+Math.round(b.width)+"×"+Math.round(b.height)+" px, relleno "+cs.padding+", margen "+cs.margin+(parseFloat(cs.borderTopLeftRadius)?", esquinas "+cs.borderTopLeftRadius:"")+", alineación "+cs.textAlign+", display "+cs.display+(cs.position!=="static"?", posición "+cs.position:"")};
var HTML=function(el){var h=el.outerHTML||"";if(h.length<=600)return h;var op=(/^<[^>]*>/.exec(h)||[""])[0].slice(0,300);return op+" … "+SH(TXT(el),120)+" … </"+el.tagName.toLowerCase()+">"};
var INFO=function(el,origen){var b=el.getBoundingClientRect();return {tipo:"elemento",origen:origen,clase:KIND(el),texto:TXT(el),selector:SELR(el),ruta:PATH(el),dentro:INSIDE(el),etiqueta:el.tagName.toLowerCase(),id:el.id||"",clases:CL(el).slice(0,160),html:HTML(el),estilos:STY(el),x:Math.round(b.left+scrollX),y:Math.round(b.top+scrollY),w:Math.round(b.width),h:Math.round(b.height),ancho:innerWidth}};
var XE=function(el){if(!el||el.nodeType!==1)return null;var s=el.closest?el.closest("svg"):null;if(s){while(s.parentElement&&s.parentElement.closest&&s.parentElement.closest("svg"))s=s.parentElement.closest("svg");return s}
if(/^(SPAN|STRONG|EM|B|I|SMALL|MARK|U|SUB|SUP|ABBR|CODE)$/i.test(el.tagName)){var c=el.closest("button,a,[role=button],label,h1,h2,h3,h4,h5,h6,li,p,td,th");if(c)return c}return el};
var BOXES={},BOX=function(name,color){var b=BOXES[name];if(b&&b.isConnected)return b;b=document.createElement("willy-marca");var st=b.style;
[["position","fixed"],["pointer-events","none"],["z-index","2147483647"],["box-sizing","border-box"],["border","2px solid "+color],["background",color.replace("rgb(","rgba(").replace(")",",0.10)")],["border-radius","3px"],["display","none"],["margin","0"],["padding","0"],["transform","none"]].forEach(function(p){st.setProperty(p[0],p[1],"important")});
var l=document.createElement("willy-marca"),ls=l.style;[["position","absolute"],["left","-2px"],["top","-20px"],["background",color],["color","#fff"],["font","600 11px/18px system-ui,sans-serif"],["padding","0 6px"],["border-radius","3px"],["white-space","nowrap"],["display","block"],["letter-spacing","0"],["text-transform","none"]].forEach(function(p){ls.setProperty(p[0],p[1],"important")});
b.appendChild(l);(document.documentElement||document.body).appendChild(b);BOXES[name]=b;return b};
var PLACE=function(name,el,label,color){var b=BOX(name,color),st=b.style;if(!el||!el.isConnected){st.setProperty("display","none","important");return}var r=el.getBoundingClientRect();
st.setProperty("display","block","important");st.setProperty("left",r.left+"px","important");st.setProperty("top",r.top+"px","important");st.setProperty("width",Math.max(2,r.width)+"px","important");st.setProperty("height",Math.max(2,r.height)+"px","important");
var l=b.firstChild;l.textContent=label;l.style.setProperty("top",r.top<22?"0px":"-20px","important")};
var HIDE=function(name){var b=BOXES[name];if(b)b.style.setProperty("display","none","important")};
var PICK=false,HOV=null,SELD=null,SELL="",ISS=null,ISSL="",TMR=null,SKIP=0;
var REDRAW=function(){if(SELD)PLACE("sel",SELD,SELL,"rgb(124,58,237)");if(ISS)PLACE("iss",ISS,ISSL,"rgb(220,38,38)");if(HOV&&PICK)PLACE("hov",HOV,KIND(HOV),"rgb(37,99,235)")};
var TICK=function(){if(TMR)return;TMR=setInterval(function(){if(!SELD&&!ISS&&!PICK){clearInterval(TMR);TMR=null;return}REDRAW()},400)};
addEventListener("scroll",REDRAW,true);addEventListener("resize",REDRAW);
var CUR=function(on){var s=document.getElementById("willy-elegir");if(on&&!s){s=document.createElement("style");s.id="willy-elegir";s.textContent="*{cursor:crosshair!important}";(document.head||document.documentElement).appendChild(s)}if(!on&&s)s.parentNode.removeChild(s)};
var PICKSET=function(on){PICK=on;CUR(on);if(!on){HOV=null;HIDE("hov")}else TICK()};
var STOPEV=function(e){if(!PICK)return;if(e.type!=="touchstart"&&e.type!=="touchend")e.preventDefault();e.stopImmediatePropagation()};
["mousedown","mouseup","pointerdown","pointerup","dblclick","contextmenu","auxclick","submit","touchstart","touchend"].forEach(function(n){addEventListener(n,STOPEV,{capture:true,passive:false})});
addEventListener("click",function(e){if(!PICK)return;e.preventDefault();e.stopImmediatePropagation();var el=XE(e.target);if(!el||el===document.documentElement||el===document.body)return;PICKSET(false);SELD=el;SELL=KIND(el);REDRAW();TICK();P(INFO(el,"clic"))},true);
addEventListener("mouseover",function(e){if(!PICK)return;var el=XE(e.target);if(el&&el!==document.documentElement&&el!==document.body){HOV=el;PLACE("hov",el,KIND(el),"rgb(37,99,235)")}},true);
addEventListener("keydown",function(e){if(PICK&&e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();PICKSET(false);P({tipo:"elegir",activo:false})}},true);
var VIS=function(el,cs){var r=el.getBoundingClientRect();if(r.width<1||r.height<1)return null;cs=cs||getComputedStyle(el);if(cs.visibility==="hidden"||cs.visibility==="collapse"||parseFloat(cs.opacity)<0.05)return null;return r};
var OWN=function(el){for(var i=0;i<el.childNodes.length;i++){var n=el.childNodes[i];if(n.nodeType===3&&/\S/.test(n.nodeValue))return true}return false};
var CLIPPED=function(el){var cur=el.parentElement;while(cur&&cur!==document.body&&cur!==document.documentElement){var cs=getComputedStyle(cur);if(/(hidden|auto|scroll|clip)/.test(cs.overflowX)&&cur.getBoundingClientRect().right<=innerWidth+1)return true;cur=cur.parentElement}return false};
var NUM=function(v){return String(Math.round(v*10)/10).replace(".",",")};
var SH=function(t,n){t=String(t||"");if(t.length<=n)return t;var c=t.slice(0,n),i=c.lastIndexOf(" ");return (i>n*0.6?c.slice(0,i):c)+"\u2026"};
var D=function(){var out=[],W=innerWidth,de=document.documentElement,b=document.body,j,o,el,cs,r;
var add=function(tipo,nivel,e2,texto){if(out.length>=40)return;out.push({tipo:tipo,nivel:nivel,texto:String(texto).slice(0,220),selector:e2?SELR(e2):"",clase:e2?KIND(e2):"",muestra:e2?SH(TXT(e2),60):""})};
var nm=function(e2){return SH(TXT(e2),40)||KIND(e2)};
if(!b)return {tipo:"revision",ancho:W,alto:innerHeight,problemas:out};
var all=b.getElementsByTagName("*"),els=[];
for(j=0;j<all.length&&els.length<1500;j++){el=all[j];if(/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|META|LINK|WILLY-MARCA|BR|WBR|SOURCE|TRACK)$/i.test(el.tagName))continue;cs=getComputedStyle(el);r=VIS(el,cs);if(r)els.push({el:el,cs:cs,r:r})}
var over=Math.max(0,de.scrollWidth-W),cul=0;
if(over>1){for(j=0;j<els.length&&cul<3;j++){o=els[j];if(o.r.right<=W+1)continue;var pe=o.el.parentElement;if(pe&&pe!==b&&pe!==de&&pe.getBoundingClientRect().right>W+1)continue;if(CLIPPED(o.el))continue;cul++;add("desborde","error",o.el,"«"+nm(o.el)+"» ("+KIND(o.el)+") se sale "+Math.round(o.r.right-W)+" px por la derecha: hay que desplazarse de lado para verlo")}
if(!cul)add("desborde","error",null,"La página es "+Math.round(over)+" px más ancha que la pantalla: hay que desplazarse de lado")}
var cut=0;for(j=0;j<els.length&&cut<3;j++){o=els[j];if(!OWN(o.el))continue;cs=o.cs;var hx=/(hidden|clip)/.test(cs.overflowX)||cs.textOverflow==="ellipsis",hy=/(hidden|clip)/.test(cs.overflowY);
if((hx&&o.el.scrollWidth>o.el.clientWidth+1)||(hy&&o.el.scrollHeight>o.el.clientHeight+2)){cut++;add("cortado","aviso",o.el,"El texto «"+SH(TXT(o.el),50)+"» se corta: no cabe en su caja")}}
var cand=[];for(j=0;j<els.length&&cand.length<400;j++){o=els[j];var tg=o.el.tagName;if(o.cs.display==="inline"&&!/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(tg))continue;var ctl=/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(tg)||o.el.getAttribute("role")==="button";if(ctl||OWN(o.el))cand.push({el:o.el,r:o.r,tg:tg})}
var ov=0;for(var a=0;a<cand.length&&ov<3;a++)for(var c=a+1;c<cand.length&&ov<3;c++){var A=cand[a],B=cand[c];if(A.el.contains(B.el)||B.el.contains(A.el))continue;
if((A.tg==="LABEL"&&/^(INPUT|SELECT|TEXTAREA)$/.test(B.tg))||(B.tg==="LABEL"&&/^(INPUT|SELECT|TEXTAREA)$/.test(A.tg)))continue;
var ix=Math.min(A.r.right,B.r.right)-Math.max(A.r.left,B.r.left),iy=Math.min(A.r.bottom,B.r.bottom)-Math.max(A.r.top,B.r.top);if(ix<=2||iy<=2)continue;
var ar=ix*iy,sm=Math.min(A.r.width*A.r.height,B.r.width*B.r.height);if(ar<40||ar<sm*0.25)continue;ov++;add("superpuesto","error",B.el,"«"+SH(nm(A.el),30)+"» y «"+SH(nm(B.el),30)+"» se tapan uno a otro")}
var low=[];for(j=0;j<els.length&&low.length<80;j++){o=els[j];if(!OWN(o.el)||o.el.disabled)continue;var fg=RGBA(o.cs.color);if(!fg)continue;var bg=EFFBG(o.el);if(!bg)continue;if(fg[3]<1)fg=MIX(fg,bg);
var L1=LUM(fg),L2=LUM(bg),ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05),fs=parseFloat(o.cs.fontSize)||16,fw=parseInt(o.cs.fontWeight,10)||400,min=(fs>=24||(fs>=18.66&&fw>=700))?3:4.5;
if(ratio<min-0.05)low.push({el:o.el,ratio:ratio,min:min})}
low.sort(function(x,y){return x.ratio-y.ratio});for(j=0;j<low.length&&j<4;j++)add("contraste","aviso",low[j].el,"«"+SH(TXT(low[j].el),40)+"» tiene poco contraste: "+NUM(low[j].ratio)+":1 (mínimo "+NUM(low[j].min)+":1)");
var sm2=0;for(j=0;j<els.length&&sm2<2;j++){o=els[j];if(!OWN(o.el)||/^(SUP|SUB)$/i.test(o.el.tagName))continue;var fz=parseFloat(o.cs.fontSize)||16;if(fz<12&&TXT(o.el).length>=3){sm2++;add("letra-pequena","aviso",o.el,"El texto «"+SH(TXT(o.el),40)+"» es muy pequeño ("+NUM(fz)+" px): cuesta leerlo")}}
if(W<=820){var tp=0;for(j=0;j<els.length&&tp<3;j++){o=els[j];var t2=o.el.tagName,ty=(o.el.getAttribute("type")||"").toLowerCase();
var isC=t2==="BUTTON"||t2==="SELECT"||(t2==="INPUT"&&!/^(hidden|checkbox|radio|range|color|file)$/.test(ty))||o.el.getAttribute("role")==="button"||(t2==="A"&&o.cs.display!=="inline");
if(!isC)continue;if(Math.min(o.r.width,o.r.height)<32){tp++;add("toque-pequeno","aviso",o.el,"«"+SH(nm(o.el),30)+"» es pequeño para tocarlo con el dedo ("+Math.round(o.r.width)+"×"+Math.round(o.r.height)+" px; mejor al menos 44×44)")}}}
var imgs=b.getElementsByTagName("img"),noalt=0;for(j=0;j<imgs.length;j++){var im=imgs[j],src=im.getAttribute("src")||"";if(!im.hasAttribute("alt"))noalt++;if(!src)continue;
if(im.__willyRota||(im.complete&&im.naturalWidth===0&&!/\.svg(?:[?#]|$)|^data:image\/svg/i.test(src))){add("imagen-rota","error",im,"La imagen «"+(im.getAttribute("alt")||src.split("/").pop()||"").slice(0,50)+"» no carga");continue}
var ics=getComputedStyle(im),ir=VIS(im,ics);if(!ir||!im.naturalWidth||!im.naturalHeight)continue;
var cw=ir.width-parseFloat(ics.paddingLeft)-parseFloat(ics.paddingRight)-parseFloat(ics.borderLeftWidth)-parseFloat(ics.borderRightWidth),ch2=ir.height-parseFloat(ics.paddingTop)-parseFloat(ics.paddingBottom)-parseFloat(ics.borderTopWidth)-parseFloat(ics.borderBottomWidth);
if(cw<24||ch2<24||(ics.objectFit&&ics.objectFit!=="fill"))continue;var ra=(cw/ch2)/(im.naturalWidth/im.naturalHeight);if(ra>1.15||ra<0.87)add("imagen-deformada","aviso",im,"La imagen «"+(im.getAttribute("alt")||src.split("/").pop()||"sin nombre").slice(0,40)+"» se ve deformada (estirada o aplastada)")}
if(noalt)add("sin-alt","sugerencia",null,noalt===1?"Una imagen no tiene descripción (alt): quien no la vea no sabrá qué es":noalt+" imágenes no tienen descripción (alt)");
var hs=b.querySelectorAll("h1"),h1=[];for(j=0;j<hs.length;j++)if(VIS(hs[j]))h1.push(hs[j]);
if(!h1.length)add("sin-h1","sugerencia",null,"La pantalla no tiene un título principal (h1): ayuda a ver qué es lo importante");else if(h1.length>1)add("varios-h1","sugerencia",h1[1],"Hay "+h1.length+" títulos principales (h1) a la vez: lo normal es uno por pantalla");
var sp=0;for(j=0;j<els.length&&sp<2;j++){o=els[j];if(o.r.width<200||o.el.children.length<4)continue;var rs=[];for(var k=0;k<o.el.children.length;k++){var c2=o.el.children[k];if(/^(SCRIPT|STYLE|WILLY-MARCA)$/i.test(c2.tagName))continue;var cs2=getComputedStyle(c2);if(cs2.position==="absolute"||cs2.position==="fixed"||cs2.display==="none")continue;var r2=c2.getBoundingClientRect();if(r2.height>=1)rs.push(r2)}
if(rs.length<4)continue;var gaps=[],okv=true;for(k=1;k<rs.length;k++){var g=rs[k].top-rs[k-1].bottom;if(g<-1){okv=false;break}gaps.push(Math.max(0,g))}if(!okv)continue;
var sg=gaps.slice().sort(function(x,y){return x-y}),med=sg[Math.floor(sg.length/2)],mx=sg[sg.length-1],mi=sg[0];
if(med>=4&&mx>=48&&mx>=3*med&&mx-mi>=32){sp++;add("espaciado","sugerencia",o.el,"Espaciado irregular entre los bloques de «"+SH(nm(o.el),30)+"»: de "+Math.round(mi)+" a "+Math.round(mx)+" px")}}
var eb=0;for(j=0;j<els.length&&eb<2;j++){o=els[j];var t3=o.el.tagName;if(!(t3==="BUTTON"||t3==="A"||o.el.getAttribute("role")==="button"))continue;if(TXT(o.el))continue;
if(o.el.querySelector("img[alt]:not([alt='']),svg title,[aria-label],[title]"))continue;eb++;add("boton-vacio","aviso",o.el,"Hay un "+(t3==="A"?"enlace":"botón")+" sin texto ni descripción: quien use un lector de pantalla no sabrá qué hace")}
return {tipo:"revision",ancho:W,alto:innerHeight,problemas:out}};
addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(!d||d.__willyOrden!==true||d.k!==K)return;var el=null;
if(d.orden==="elegir"){PICKSET(Boolean(d.activo));return}
if(d.orden==="marcar"){try{el=d.selector?document.querySelector(String(d.selector)):null}catch(x){el=null}
if(d.como==="problema"){ISS=el;ISSL=String(d.etiqueta||"Aquí").slice(0,40);if(el){REDRAW();TICK();try{el.scrollIntoView({block:"center"})}catch(x){}clearTimeout(window.__willyIss);window.__willyIss=setTimeout(function(){ISS=null;HIDE("iss")},6000)}return}
SELD=el;SELL=el?KIND(el):"";if(el){REDRAW();TICK();var rr=el.getBoundingClientRect();if(rr.bottom<0||rr.top>innerHeight){try{el.scrollIntoView({block:"center"})}catch(x){}}P(INFO(el,"marca"))}else{HIDE("sel");P({tipo:"perdido",selector:String(d.selector||"").slice(0,300)})}return}
if(d.orden==="soltar"){SELD=null;ISS=null;HIDE("sel");HIDE("iss");return}
if(d.orden==="revisar"){P(D());return}
if(d.orden==="desplazar"){SKIP=Date.now();var mxs=Math.max(0,de0().scrollHeight-innerHeight);try{scrollTo(0,Math.round(Math.min(1,Math.max(0,Number(d.fraccion)||0))*mxs))}catch(x){}return}
if(d.orden==="ir"){var hh=String(d.hash||"");try{if(/^#[^<>"'\x60\s]{0,200}$/.test(hh)){if(location.hash!==hh)location.hash=hh}else if(location.hash&&location.hash!=="#"){location.hash=/^#!/.test(location.hash)?"#!/":"#/"}}catch(x){}try{scrollTo(0,0)}catch(x){}return}});
var de0=function(){return document.scrollingElement||document.documentElement};
if(SYNC)addEventListener("scroll",function(){if(Date.now()-SKIP<200)return;clearTimeout(window.__willySc);window.__willySc=setTimeout(function(){var mxs=Math.max(1,de0().scrollHeight-innerHeight);P({tipo:"scroll",fraccion:Math.min(1,Math.max(0,scrollY/mxs))})},60)},{passive:true});
`;

/**
 * El vigía que se mete al principio de la página. Si se le da una ruta de la propia página («#/reservas»), la pone antes de que
 * arranque la página (sin avisar a nadie: la página arranca ya en esa ruta): así, al recargar, vuelves a donde estabas.
 * - La vista previa es una página «about:srcdoc»: un enlace «#algo» normal la llevaría a la dirección de WILLY (y se vería
 *   WILLY dentro de la vista previa). El vigía lo lleva a su sitio: cambia la ruta de la página o baja hasta esa parte.
 * - Los enlaces a otra página del proyecto no se abren dentro del marco (no hay servidor): se le pide a WILLY que la enseñe. Si
 *   la propia página ya se encarga del clic (una aplicación de una sola página), no se toca.
 * - La vista previa no tiene almacenamiento del navegador (es un marco aislado): sin nada más, una página que guarda datos
 *   (localStorage, cookies) fallaría al arrancar. El vigía le da un almacén en memoria, que dura mientras está abierta.
 * - Una página que escribe sin parar en la consola (en cada fotograma, por ejemplo) no puede atascar WILLY: como mucho 50
 *   mensajes por segundo (y aparte, 30 errores por segundo, para que los mensajes nunca tapen un error); los demás se cuentan
 *   y se dice cuántos se han omitido.
 * - Un error de JavaScript sin atender es un fallo de verdad; una promesa rechazada (por ejemplo, una petición a internet que
 *   en la vista previa no puede salir) va a la consola como error, pero no se trata como página rota.
 * - «¿Se ve algo?» se mira cuando la página ha cargado; si parece vacía, se vuelve a mirar dos veces más (hay páginas que
 *   pintan un poco después) antes de decir que se queda en blanco. Con eso va un resumen de lo que hay en pantalla (título,
 *   encabezados, botones y enlaces), para que la IA entienda «este botón» o «el de arriba». Se vuelve a mirar al cambiar de
 *   ruta o de tamaño.
 */
export function monitorScript(opts: MonitorOptions = {}): string {
  const hash = opts.hash && SAFE_HASH.test(opts.hash) && opts.hash !== "#" ? opts.hash : "";
  const token = (opts.token ?? "").replace(/[^\w.-]/g, "").slice(0, 60);
  return `<script>(function(){
var K=${JSON.stringify(token)},REV=${opts.review ? 1 : 0},SYNC=${opts.sync ? 1 : 0};
var P=function(m){try{m.__willyVista=true;m.k=K;parent.postMessage(m,"*")}catch(e){}};
var S=function(v){try{if(typeof v==="string")return v;if(v&&v.message)return (v.name?v.name+": ":"")+v.message;return JSON.stringify(v)}catch(e){return String(v)}};
(function(){var ok=true;try{window.localStorage.getItem("__willy")}catch(e){ok=false}if(ok)return;var told=false,mk=function(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){if(!told){told=true;P({tipo:"consola",nivel:"info",texto:"(WILLY) En la vista previa, lo que la página guarda (localStorage) dura mientras está abierta: al recargarla empieza de cero."})}d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};["localStorage","sessionStorage"].forEach(function(n){try{Object.defineProperty(window,n,{value:mk(),configurable:true,enumerable:true})}catch(e){}});try{var c="";Object.defineProperty(document,"cookie",{get:function(){return c},set:function(v){var q=String(v).split(";")[0],k=q.split("=")[0];c=c.split("; ").filter(function(x){return x&&x.split("=")[0]!==k}).concat(q).join("; ")},configurable:true})}catch(e){}})();
${hash ? `try{var H=${JSON.stringify(hash)};if(location.hash!==H){if(location.protocol==="about:")history.replaceState(history.state,"",location.href.split("#")[0]+H);else location.hash=H}}catch(e){}` : ""}
var RL=function(max){var c=0,t0=0,d=0;return function(m){var t=Date.now();if(t-t0>1000){t0=t;c=0}if(++c<=max){P(m);return}if(!d)setTimeout(function(){P({tipo:"consola",nivel:"warn",texto:"(WILLY) La página escribe demasiado en la consola: se han omitido "+d+" mensajes."});d=0},1000);d++}},PC=RL(50),PE=RL(30);
["log","info","warn","error","debug"].forEach(function(k){var o=console[k];console[k]=function(){try{PC({tipo:"consola",nivel:k==="debug"?"log":k,texto:Array.prototype.map.call(arguments,S).join(" ").slice(0,600)})}catch(e){}if(o)return o.apply(console,arguments)}});
addEventListener("error",function(e){var t=e&&e.target;if(t&&t!==window&&t.tagName){try{t.__willyRota=1}catch(x){}PE({tipo:"recurso",url:String(t.src||t.href||t.tagName).slice(0,300)});return}PE({tipo:"error",mensaje:String(e&&e.message||"Error").replace(/^Uncaught /,""),linea:e&&e.lineno||0,columna:e&&e.colno||0})},true);
addEventListener("unhandledrejection",function(e){var r=e&&e.reason;P({tipo:"consola",nivel:"error",texto:("Promesa rechazada sin atender: "+S(r)).slice(0,600)})});
addEventListener("hashchange",function(){P({tipo:"ruta",hash:location.hash});clearTimeout(window.__willyQ);window.__willyQ=setTimeout(Q,400)});
addEventListener("click",function(e){if(e.defaultPrevented)return;var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"";if(!h||/^(mailto|tel|javascript):/i.test(h))return;e.preventDefault();if(h.charAt(0)==="#"){try{if(h==="#")scrollTo(0,0);else location.hash=h}catch(x){}return}if(/^[a-z][a-z0-9+.-]*:/i.test(h)||h.indexOf("//")===0){P({tipo:"externo",url:h.slice(0,300)});return}P({tipo:"navegar",ruta:h})});
addEventListener("submit",function(e){if(e.defaultPrevented)return;e.preventDefault();var f=e.target;P({tipo:"formulario",accion:String(f&&f.getAttribute&&f.getAttribute("action")||"")})});
var L=function(q,n){return b2a(document.querySelectorAll(q)).map(function(x){return String(x.innerText||x.value||x.getAttribute("aria-label")||x.getAttribute("title")||"").replace(/\\s+/g," ").trim().slice(0,40)}).filter(Boolean).slice(0,n)},b2a=function(x){return Array.prototype.slice.call(x)};
var EN=function(){var o=[],seen={};b2a(document.querySelectorAll('a[href^="#/"],a[href^="#!/"]')).forEach(function(a){var h=a.getAttribute("href")||"";if(!h||seen[h]||o.length>=40)return;seen[h]=1;o.push({h:h.slice(0,120),t:String(a.innerText||a.getAttribute("aria-label")||a.getAttribute("title")||"").replace(/\\s+/g," ").trim().slice(0,40)})});return o};
var R=function(){var o=[],h=L("h1,h2",6),k=L("button,a[href],[role=button],input[type=submit]",12);if(document.title)o.push("título «"+document.title.slice(0,60)+"»");if(h.length)o.push("encabezados: "+h.join(" | "));if(k.length)o.push("botones y enlaces: "+k.join(" | "));return o.join("; ").slice(0,500)};
var N=0,RD=0,Q=function(){var b=document.body,d=document.documentElement,t=b?(b.innerText||"").trim().length:0,l=b?b.querySelectorAll("*:not(script):not(style):not(willy-marca)").length:0,m=b?b.querySelectorAll("img,svg,canvas,video,iframe,picture").length:0;if(!t&&!m&&l<5&&N<2){N++;setTimeout(Q,1200);return}var r="",en=[];try{r=R()}catch(e){}try{en=EN()}catch(e){}P({tipo:"calidad",texto:t,elementos:l,medios:m,desborde:Math.max(0,d.scrollWidth-innerWidth),ancho:innerWidth,alto:d.scrollHeight,resumen:r,enlaces:en});if(REV&&!RD){RD=1;setTimeout(function(){try{P(D())}catch(e){P({tipo:"revision",ancho:innerWidth,alto:innerHeight,problemas:[]})}},300)}};
${VISUAL_TOOLS}
if(document.readyState==="complete")setTimeout(Q,600);else addEventListener("load",function(){setTimeout(Q,600)});
addEventListener("resize",function(){clearTimeout(window.__willyQ);window.__willyQ=setTimeout(Q,400)});
})();</script>`;
}

/**
 * Opciones del vigía: la ruta con la que arranca, la marca de la carga, `review` (marco oculto de «Revisar diseño»: al cargar
 * revisa el diseño y lo cuenta) y `sync` (cuenta cuándo se desplaza, para moverse a la vez que otra vista previa al comparar).
 */
export type MonitorOptions = { hash?: string | null; token?: string; review?: boolean; sync?: boolean };

/** Mete el vigía al principio de la página (antes que sus propios scripts). */
export function withMonitor(html: string, opts: MonitorOptions = {}): string {
  const script = monitorScript(opts);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, (_m, attrs: string) => `<head${attrs}>${script}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, (_m, attrs: string) => `<html${attrs}>${script}`);
  return `${script}${html}`;
}

/**
 * Marca de cada carga de la vista previa: lo que llegue de una carga anterior (una página que se estaba cerrando) no se
 * confunde con lo de la de ahora.
 */
export function pageToken(html: string, extra: string | number = ""): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < html.length; i += 1) {
    h ^= html.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${String(extra).replace(/[^\w.-]/g, "")}.${html.length.toString(36)}.${h.toString(36)}`;
}

/** ¿Es un mensaje del vigía (y, si se da `token`, de ESTA carga)? Cualquier otra cosa que llegue al marco se ignora. */
export function asMonitorMessage(data: unknown, token?: string): MonitorMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d["__willyVista"] !== true || typeof d["tipo"] !== "string") return null;
  if (token !== undefined && d["k"] !== token) return null;
  const text = (v: unknown, max = 600) => String(v ?? "").slice(0, max);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  switch (d["tipo"]) {
    case "consola": {
      const nivel = ["log", "info", "warn", "error"].includes(String(d["nivel"])) ? (d["nivel"] as ConsoleLevel) : "log";
      return { tipo: "consola", nivel, texto: text(d["texto"]) };
    }
    case "error": return { tipo: "error", mensaje: text(d["mensaje"], 400), linea: num(d["linea"]), columna: num(d["columna"]) };
    case "recurso": return { tipo: "recurso", url: text(d["url"], 300) };
    case "navegar": return { tipo: "navegar", ruta: text(d["ruta"], 300) };
    case "externo": return { tipo: "externo", url: text(d["url"], 300) };
    case "formulario": return { tipo: "formulario", accion: text(d["accion"], 200) };
    case "ruta": return { tipo: "ruta", hash: text(d["hash"], 200) };
    case "calidad": {
      // Rev26: los enlaces a otras pantallas de la página («#/…»), para el mapa de pantallas.
      const raw = Array.isArray(d["enlaces"]) ? (d["enlaces"] as unknown[]).slice(0, 40) : [];
      const enlaces = raw.filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
        .map((e) => ({ hash: text(e["h"], 120), texto: text(e["t"], 40) }))
        .filter((e) => /^#!?\//.test(e.hash) && SAFE_HASH.test(e.hash));
      return { tipo: "calidad", texto: num(d["texto"]), elementos: num(d["elementos"]), medios: num(d["medios"]), desborde: num(d["desborde"]), ancho: num(d["ancho"]), alto: num(d["alto"]), resumen: text(d["resumen"], 500), enlaces };
    }
    case "elemento":
      return {
        tipo: "elemento", origen: d["origen"] === "marca" ? "marca" : "clic", clase: text(d["clase"], 40), texto: text(d["texto"], 120), selector: text(d["selector"], 400),
        ruta: text(d["ruta"], 400), dentro: text(d["dentro"], 200), etiqueta: text(d["etiqueta"], 30), id: text(d["id"], 100), clases: text(d["clases"], 200),
        html: text(d["html"], 800), estilos: text(d["estilos"], 600), x: num(d["x"]), y: num(d["y"]), w: num(d["w"]), h: num(d["h"]), ancho: num(d["ancho"]),
      };
    case "perdido": return { tipo: "perdido", selector: text(d["selector"], 400) };
    case "elegir": return { tipo: "elegir", activo: d["activo"] === true };
    case "revision": {
      const list = Array.isArray(d["problemas"]) ? (d["problemas"] as unknown[]).slice(0, 100) : [];
      const problemas: RawIssue[] = list.filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object").map((p) => ({
        tipo: text(p["tipo"], 30), nivel: text(p["nivel"], 20), texto: text(p["texto"], 240), selector: text(p["selector"], 400), clase: text(p["clase"], 40), muestra: text(p["muestra"], 80),
      })).filter((p) => p.tipo && p.texto).slice(0, 40);
      return { tipo: "revision", ancho: num(d["ancho"]), alto: num(d["alto"]), problemas };
    }
    case "scroll": return { tipo: "scroll", fraccion: Math.min(1, Math.max(0, num(d["fraccion"]))) };
    default: return null;
  }
}

/** Lo que cuenta el vigía, como línea de la consola del proyecto (o null si no va a la consola). */
export function consoleEntryOf(m: MonitorMessage, at = Date.now()): ConsoleEntry | null {
  switch (m.tipo) {
    case "consola": return { level: m.nivel, text: m.texto, at, source: "pagina" };
    case "error": return { level: "error", text: `${m.mensaje}${m.linea ? ` (línea ${m.linea}${m.columna ? `, columna ${m.columna}` : ""})` : ""}`, at, source: "pagina" };
    case "recurso": return { level: "error", text: `No se ha podido cargar: ${m.url}`, at, source: "recurso" };
    case "externo": return { level: "info", text: `Enlace fuera del proyecto (no se abre en la vista previa): ${m.url}`, at, source: "willy" };
    case "formulario": return { level: "info", text: `Se ha enviado un formulario${m.accion ? ` a «${m.accion}»` : ""}: en la vista previa no hay servidor que lo reciba.`, at, source: "willy" };
    default: return null;
  }
}

/** Resumen para cualquiera (rediseño, punto 97): «Sin errores», «2 errores y 1 aviso»… */
export function consoleSummary(entries: ConsoleEntry[]): { errors: number; warnings: number; text: string } {
  const errors = entries.filter((e) => e.level === "error").length;
  const warnings = entries.filter((e) => e.level === "warn").length;
  const parts = [errors ? `${errors} error${errors === 1 ? "" : "es"}` : "", warnings ? `${warnings} aviso${warnings === 1 ? "" : "s"}` : ""].filter(Boolean);
  return { errors, warnings, text: parts.length ? parts.join(" y ") : "Sin errores" };
}

/**
 * Antes de decir «Lista» (rediseño, punto 100): ¿se ve algo de verdad? ¿se sale de la pantalla en este tamaño? Devuelve el
 * problema grave (una pantalla en blanco) y los avisos.
 */
export function qualityOf(q: QualitySnapshot): { blank: boolean; warnings: string[] } {
  const blank = q.text === 0 && q.media === 0 && q.elements < 5;
  const warnings: string[] = [];
  if (q.overflow > 1) warnings.push(`Se sale de la pantalla: ${q.overflow} px de más a lo ancho con ${q.width} px (habrá que desplazarse de lado).`);
  return { blank, warnings };
}

/**
 * Lo que se le cuenta a WILLY para reparar la vista previa (rediseño, puntos 98-99): los errores reales de la página, los
 * recursos que faltan y si se queda en blanco (lo que anota WILLY en la consola no cuenta). Sin nada de eso, null.
 */
export function repairRequest(input: { page: string | null; entries: ConsoleEntry[]; blank: boolean; warnings: string[] }): string | null {
  const errors = input.entries.filter((e) => e.level === "error" && e.source !== "willy").slice(-8);
  if (!errors.length && !input.blank) return null;
  return [
    `La vista previa${input.page ? ` de «${input.page}»` : ""} no funciona bien. Encuentra la causa y arréglalo, sin romper lo demás:`,
    ...(input.blank ? ["- La página se carga pero se queda EN BLANCO (no se ve nada)."] : []),
    ...errors.map((e) => `- ${e.source === "recurso" ? "Recurso que no carga" : "Error"}: ${e.text}`),
    ...input.warnings.map((w) => `- Aviso: ${w}`),
    ...repairHints(errors.map((e) => e.text)),
    "Comprueba que la página se ve entera, sin errores en la consola y en móvil, y entrega los archivos que cambies COMPLETOS.",
  ].join("\n");
}

/**
 * Pistas para los errores que más se repiten: con el mensaje solo, la IA gratuita a veces devuelve el mismo archivo roto una y
 * otra vez (pasó el 25/09 con «Mundo jamon»: JSX dentro de un script normal). Solo se añaden si ese error aparece de verdad.
 */
export function repairHints(texts: string[]): string[] {
  const all = texts.join("\n");
  const hints: string[] = [];
  if (/Unexpected token\s*['"\u2018\u2019]?</i.test(all)) {
    hints.push(
      "- Pista: «Unexpected token '<'» casi siempre es JSX (etiquetas como <div> dentro de JavaScript) en un <script> que el navegador ejecuta tal cual, sin compilar, o un <script src> que apunta a un archivo que no existe (llega una página HTML en vez de código).",
      "- Cómo arreglarlo de verdad (no basta con devolver el mismo archivo): en un proyecto React/Vite, la vista previa ya compila index.html → src/main.tsx, así que una página HTML suelta no debe llevar JSX; si esa página tiene que funcionar sola, reescribe su script sin JSX (React.createElement) o cámbialo a <script type=\"text/babel\" data-type=\"module\"> cargando antes https://unpkg.com/@babel/standalone/babel.min.js.",
    );
  }
  return hints;
}

// ------------------------------------------------------------------------------------------ reparación automática (punto 99)

/** Como mucho, estos intentos de reparación seguidos; después se declara el bloqueo (no se prueba a ciegas sin fin). */
export const MAX_REPAIRS = 2;
/** Cuánto se vigila la vista previa después de que WILLY guarde un cambio. */
export const REPAIR_WATCH_MS = 120_000;

/**
 * Vigilancia tras un cambio de WILLY: `attempt` es 0 tras un cambio normal y 1..MAX_REPAIRS tras cada intento de reparación;
 * `seenLoad` dice si ya se ha vuelto a cargar la vista previa con lo guardado (hasta entonces, el estado es el de antes).
 */
export type RepairWatch = { projectId: string; attempt: number; seenLoad: boolean; at: number };
export type RepairStep =
  | { kind: "nada" }
  | { kind: "recuperada"; attempt: number }
  | { kind: "avisar" }
  | { kind: "reparar"; attempt: number }
  | { kind: "bloqueo"; attempts: number };

export const isBrokenPreview = (state: PreviewStatus | null | undefined): boolean => state === "error" || state === "en-blanco" || state === "no-compila";

/** ¿Hay que vigilar la vista previa después de guardar? Tras un intento de reparación, siempre; tras un cambio normal, solo si
 * antes funcionaba (si ya estaba rota, no la ha roto este cambio: se queda el aviso con «Reparar»). */
export function watchAfterSave(input: { projectId: string; brokenBefore: boolean; attempt?: number; now?: number }): RepairWatch | null {
  const attempt = input.attempt ?? 0;
  if (!attempt && input.brokenBefore) return null;
  return { projectId: input.projectId, attempt, seenLoad: false, at: input.now ?? Date.now() };
}

/**
 * Qué hacer cuando cambia el estado de la vista previa mientras se vigila un cambio (función pura): esperar a que se cargue lo
 * guardado; si queda «Lista», se acabó (y si venía de una reparación, se dice que se ha recuperado); si se rompe, reparar solo
 * (como mucho MAX_REPAIRS veces), avisar (si la reparación automática está apagada) o declarar el bloqueo.
 */
export function repairStep(watch: RepairWatch | null, input: { projectId: string | null; state: PreviewStatus; auto: boolean; now: number }): { step: RepairStep; watch: RepairWatch | null } {
  const none: RepairStep = { kind: "nada" };
  if (!watch) return { step: none, watch: null };
  if (watch.projectId !== input.projectId || input.now - watch.at > REPAIR_WATCH_MS) return { step: none, watch: null };
  // Compilar (un proyecto React/Vite) cuenta como volver a cargar: después viene «Lista» o «No compila».
  if (input.state === "cargando" || input.state === "compilando") return { step: none, watch: watch.seenLoad ? watch : { ...watch, seenLoad: true } };
  if (input.state === "actualizando" || !watch.seenLoad) return { step: none, watch };
  if (input.state === "lista") return { step: watch.attempt > 0 ? { kind: "recuperada", attempt: watch.attempt } : none, watch: null };
  if (!isBrokenPreview(input.state)) return { step: none, watch: null };
  if (!input.auto) return { step: { kind: "avisar" }, watch: null };
  if (watch.attempt >= MAX_REPAIRS) return { step: { kind: "bloqueo", attempts: watch.attempt }, watch: null };
  return { step: { kind: "reparar", attempt: watch.attempt + 1 }, watch: null };
}

/** Por qué no se ve bien, en palabras de cualquiera. */
export function brokenReason(state: PreviewStatus | null | undefined, error: string | null | undefined): string {
  if (state === "en-blanco") return "se queda en blanco";
  if (state === "no-compila") {
    const e = (error ?? "").trim();
    return e ? `no compila: «${e.length > 160 ? `${e.slice(0, 160)}…` : e}»` : "no compila";
  }
  const e = (error ?? "").trim();
  return e ? `da un error: «${e.length > 160 ? `${e.slice(0, 160)}…` : e}»` : "tiene errores";
}

/**
 * Lo que WILLY escribe en el chat del proyecto en cada paso de la reparación automática. `good` describe la última versión que
 * se veía bien (la de antes del cambio que la rompió), para poder volver a ella de una vez.
 */
export function repairNote(step: RepairStep, reason: string, good?: string | null): string | null {
  switch (step.kind) {
    case "reparar":
      return `🔧 El último cambio ha roto la vista previa (${reason}). La reparo yo solo: intento ${step.attempt} de ${MAX_REPAIRS} (lo de antes queda guardado en Versiones).`;
    case "recuperada":
      return `✓ Vista previa recuperada: después de la reparación (intento ${step.attempt} de ${MAX_REPAIRS}) se ve bien y sin errores al arrancar.`;
    case "bloqueo":
      return `⚠️ BLOQUEO: he intentado reparar la vista previa ${step.attempts} veces y sigue sin verse bien (${reason}). No sigo probando a ciegas. ${good ? `Dime «vuelve a la versión que funcionaba» y vuelvo a ${good}, la última que se veía bien` : "Dime «vuelve a la versión anterior» para deshacer el último cambio"}; o cuéntame qué ves y lo miramos juntos.`;
    case "avisar":
      return `⚠️ Después de este cambio la vista previa no se ve bien (${reason}). Pulsa «Reparar» en la vista previa, o dime «vuelve a la versión anterior».`;
    default:
      return null;
  }
}

/** Lo que se le pide a WILLY en un intento de reparación automática (con lo que ha visto la vista previa, si lo hay). */
export function autoRepairRequest(detail: string | null, attempt: number): string {
  const base = detail ?? "La vista previa del proyecto no funciona bien después del último cambio. Encuentra la causa y arréglalo, sin romper lo demás, y entrega los archivos que cambies COMPLETOS.";
  return `${base}\n(Reparación automática, intento ${attempt} de ${MAX_REPAIRS}: el último cambio ha roto la vista previa. Arregla SOLO lo necesario para que vuelva a funcionar.)`;
}
