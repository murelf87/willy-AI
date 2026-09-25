// PRUEBAS AUTOMÁTICAS DE CADA PROYECTO (revisión 28) · EL «PROBADOR» QUE VA DENTRO DE LA PÁGINA. Cuando WILLY pasa las
// pruebas de un proyecto, carga la página de verdad (la misma que la vista previa, con su vigía) en un marco aislado e
// invisible y, además del vigía, le mete este probador: SOLO obedece a WILLY (y solo en ESA carga) y hace lo que haría una
// persona: buscar un botón por lo que dice, escribir en un campo, pulsar, marcar una casilla, elegir en una lista, pulsar una
// tecla… y contar lo que se ve (para comprobarlo). Lo que busca y cómo lo busca imita a Playwright (getByRole, getByText,
// getByLabel…), para que las pruebas que escribe la IA sean las de siempre.
// - Nunca roba el foco a WILLY: el foco dentro de la página es «de mentira» (se mueve y avisa como el de verdad, pero no se
//   lleva el teclado del dueño aunque esté escribiendo en el chat mientras tanto).
// - Lo que la página guarda (localStorage/sessionStorage) dura toda la prueba (también al recargar o ir a otra página) y cada
//   prueba empieza de cero, como en Playwright.
// - Los avisos de la página (alert, confirm, prompt) no bloquean nada: se contestan como diga la prueba (por defecto, «Cancelar»,
//   como Playwright) y se cuentan.
// Es JavaScript que va dentro de la página (texto): se prueba en un navegador de verdad (cctest/rev28motor).

import { monitorScript, type MonitorOptions } from "@/lib/preview-runtime";

/** Cómo arranca el probador en una carga: su marca, lo que la página tenía guardado y qué contestar a sus avisos. */
export type AgentConfig = {
  token: string;
  storage?: { local: Record<string, string>; session: Record<string, string> } | null;
  dialog?: { policy: "aceptar" | "rechazar"; text?: string | null } | null;
};

const AGENT = String.raw`
var P=function(m){try{m.__willyVista=true;m.k=K;parent.postMessage(m,"*")}catch(e){}};
var S=function(v){try{if(typeof v==="string")return v;if(v&&v.message)return (v.name?v.name+": ":"")+v.message;return JSON.stringify(v)}catch(e){return String(v)}};
var NORM=function(s){return String(s==null?"":s).replace(/[\s\u00a0\u200b]+/g," ").trim()};
var SL=function(t,n){t=String(t==null?"":t);return t.length>n?t.slice(0,n-1)+"…":t};
var TXTM=function(m,exact){if(m&&m.re!=null){var re;try{re=new RegExp(m.re,(m.f||"").replace(/g/g,""))}catch(e){throw new Error("Expresión regular no válida: /"+m.re+"/")}return function(t){return re.test(NORM(t))||re.test(String(t==null?"":t))}}
var s=NORM(m&&m.s);if(exact)return function(t){return NORM(t)===s};var sl=s.toLowerCase();return function(t){return NORM(t).toLowerCase().indexOf(sl)>=0}};

// ---------------------------------------------------------------- almacenamiento que dura toda la prueba
var ST={local:{},session:{}};try{if(CFG.storage){ST.local=CFG.storage.local||{};ST.session=CFG.storage.session||{}}}catch(e){}
var STT=null,STS=function(){if(STT)return;STT=setTimeout(function(){STT=null;P({tipo:"prueba-almacen",local:ST.local,session:ST.session})},30)};
var MKS=function(d){return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(ST[d],k)?ST[d][k]:null},setItem:function(k,v){ST[d][String(k)]=String(v);STS()},removeItem:function(k){delete ST[d][String(k)];STS()},clear:function(){ST[d]={};STS()},key:function(i){return Object.keys(ST[d])[i]||null},get length(){return Object.keys(ST[d]).length}}};
try{Object.defineProperty(window,"localStorage",{value:MKS("local"),configurable:true,enumerable:true})}catch(e){}
try{Object.defineProperty(window,"sessionStorage",{value:MKS("session"),configurable:true,enumerable:true})}catch(e){}

// ---------------------------------------------------------------- avisos de la página (alert, confirm, prompt)
var DLG=(CFG.dialog&&CFG.dialog.policy)||"rechazar",DLGT=CFG.dialog&&CFG.dialog.text!=null?String(CFG.dialog.text):null;
window.alert=function(m){P({tipo:"prueba-dialogo",clase:"alert",mensaje:SL(S(m),300)})};
window.confirm=function(m){P({tipo:"prueba-dialogo",clase:"confirm",mensaje:SL(S(m),300)});return DLG==="aceptar"};
window.prompt=function(m,d){P({tipo:"prueba-dialogo",clase:"prompt",mensaje:SL(S(m),300)});return DLG==="aceptar"?(DLGT!=null?DLGT:(d==null?"":String(d))):null};
window.print=function(){};window.open=function(u){P({tipo:"externo",url:SL(String(u||""),300)});return null};

// ---------------------------------------------------------------- foco «de mentira» (nunca se lleva el teclado de WILLY)
var VF=null,AS=false;
var FOCUSABLE="a[href],area[href],button,input,select,textarea,iframe,summary,[tabindex],[contenteditable]:not([contenteditable=false]),audio[controls],video[controls]";
var canFocus=function(el){if(!el||el.nodeType!==1||!el.isConnected)return false;try{if(!el.matches(FOCUSABLE))return false}catch(e){return false}if(el.matches&&el.matches(":disabled"))return false;if(el.tagName==="INPUT"&&el.type==="hidden")return false;return true};
var FEV=function(el,type,rel,bub){try{el.dispatchEvent(new FocusEvent(type,{bubbles:bub,composed:true,relatedTarget:rel||null}))}catch(e){}};
var VFOCUS=function(el){if(el&&!canFocus(el))el=null;if(VF===el)return;var prev=VF;VF=el;AS=false;if(prev&&prev.isConnected){FEV(prev,"blur",el,false);FEV(prev,"focusout",el,true)}if(el){FEV(el,"focus",prev,false);FEV(el,"focusin",prev,true)}};
try{var HF=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(){VFOCUS(this)};HTMLElement.prototype.blur=function(){if(VF===this)VFOCUS(null)};if(window.SVGElement){SVGElement.prototype.focus=function(){};SVGElement.prototype.blur=function(){}}}catch(e){}
try{Object.defineProperty(document,"activeElement",{get:function(){return VF&&VF.isConnected?VF:document.body},configurable:true})}catch(e){}
try{document.hasFocus=function(){return true};window.focus=function(){}}catch(e){}
var focusTarget=function(el){for(var c=el;c&&c.nodeType===1;c=c.parentElement)if(canFocus(c))return c;return null};

// ---------------------------------------------------------------- qué se ve y qué no
var CS=function(el){try{return getComputedStyle(el)}catch(e){return null}};
var CHKVIS=function(el){try{return typeof el.checkVisibility!=="function"||el.checkVisibility()}catch(e){return true}};
var VISIBLE=function(el){if(!el||el.nodeType!==1||!el.isConnected)return false;if(el===document.documentElement||el===document.body)return true;var cs=CS(el);if(!cs)return false;
if(cs.display==="contents"){for(var i=0;i<el.children.length;i++)if(VISIBLE(el.children[i]))return true;return false}
if(el.tagName==="OPTION"){var sel=el.closest("select");return sel?VISIBLE(sel):false}
if(!CHKVIS(el)||cs.visibility!=="visible")return false;
var r=el.getBoundingClientRect();return r.width>0&&r.height>0};
var AHIDDEN=function(el){if(!(el.tagName==="OPTION"&&el.closest("select"))&&!CHKVIS(el))return true;for(var c=el;c&&c.nodeType===1;c=c.parentElement){if(c.getAttribute("aria-hidden")==="true")return true;var cs=CS(c);if(!cs||cs.display==="none")return true;if(c.tagName==="TEMPLATE")return true}var cs2=CS(el);return !cs2||cs2.visibility==="hidden"||cs2.visibility==="collapse"};
var DISABLED=function(el){if(!el||el.nodeType!==1)return false;try{if(el.matches(":disabled"))return true}catch(e){}for(var c=el;c&&c.nodeType===1;c=c.parentElement)if(c.getAttribute("aria-disabled")==="true")return true;return false};
var EDITABLE=function(el){if(DISABLED(el))return false;var t=el.tagName;if(t==="INPUT"){if(/^(checkbox|radio|file|button|submit|reset|image|range|color|hidden)$/i.test(el.type))return false;return !el.readOnly}if(t==="TEXTAREA")return !el.readOnly;if(t==="SELECT")return true;if(el.isContentEditable)return true;var r=(el.getAttribute("role")||"").toLowerCase();if(/^(textbox|searchbox|combobox|spinbutton)$/.test(r))return el.getAttribute("aria-readonly")!=="true";return false};

// ---------------------------------------------------------------- papeles (roles) y nombres accesibles, como Playwright
var LANDSCOPE=function(el){for(var p=el.parentElement;p;p=p.parentElement){var t=p.tagName;if(t==="ARTICLE"||t==="ASIDE"||t==="MAIN"||t==="NAV"||t==="SECTION")return true;var r=(p.getAttribute("role")||"").toLowerCase();if(r==="article"||r==="complementary"||r==="main"||r==="navigation"||r==="region")return true}return false};
var INROLE={button:"button",checkbox:"checkbox",image:"button",number:"spinbutton",radio:"radio",range:"slider",reset:"button",submit:"button"};
var ROLE=function(el){var ex=(el.getAttribute("role")||"").trim().split(/\s+/)[0].toLowerCase();if(ex)return ex==="none"?"presentation":ex;var t=el.tagName.toLowerCase();
switch(t){case "a":case "area":return el.hasAttribute("href")?"link":"";case "article":return "article";case "aside":return "complementary";case "blockquote":return "blockquote";case "button":return "button";case "caption":return "caption";case "code":return "code";case "datalist":return "listbox";case "del":return "deletion";case "details":return "group";case "dialog":return "dialog";case "dd":return "definition";case "dt":return "term";case "em":return "emphasis";case "fieldset":return "group";case "figure":return "figure";
case "footer":return LANDSCOPE(el)?"":"contentinfo";case "header":return LANDSCOPE(el)?"":"banner";case "form":return el.hasAttribute("aria-label")||el.hasAttribute("aria-labelledby")?"form":"";case "dfn":return "term";case "mark":return "mark";case "search":return "search";case "h1":case "h2":case "h3":case "h4":case "h5":case "h6":return "heading";case "hr":return "separator";case "html":return "document";
case "img":return el.getAttribute("alt")===""&&!el.getAttribute("title")&&!el.hasAttribute("tabindex")?"presentation":"img";
case "input":{var ty=(el.type||"").toLowerCase();if(ty==="search")return el.hasAttribute("list")?"combobox":"searchbox";if(/^(|text|email|tel|url)$/.test(ty)){var dl=el.getAttribute("list")?document.getElementById(el.getAttribute("list")):null;return dl&&dl.tagName==="DATALIST"?"combobox":"textbox"}if(ty==="hidden")return "";if(ty==="file")return "button";return INROLE[ty]||"textbox"}
case "ins":return "insertion";case "li":return "listitem";case "main":return "main";case "math":return "math";case "menu":return "list";case "meter":return "meter";case "nav":return "navigation";case "ol":case "ul":return "list";case "optgroup":return "group";case "option":return "option";case "output":return "status";case "p":return "paragraph";case "progress":return "progressbar";
case "section":return el.hasAttribute("aria-label")||el.hasAttribute("aria-labelledby")?"region":"";case "select":return el.multiple||el.size>1?"listbox":"combobox";case "strong":return "strong";case "sub":return "subscript";case "sup":return "superscript";case "svg":return "img";case "table":return "table";case "tbody":case "thead":case "tfoot":return "rowgroup";
case "td":case "th":{if(t==="th"){var sc=el.getAttribute("scope");if(sc==="col")return "columnheader";if(sc==="row")return "rowheader"}var g=el.closest("table"),gr=g?(g.getAttribute("role")||"").trim().toLowerCase():"";return gr==="grid"||gr==="treegrid"?"gridcell":"cell"}case "tr":return "row";case "textarea":return "textbox";case "time":return "time"}
return ""};
var FROMCONTENT={button:1,cell:1,checkbox:1,columnheader:1,gridcell:1,heading:1,link:1,menuitem:1,menuitemcheckbox:1,menuitemradio:1,option:1,radio:1,row:1,rowheader:1,"switch":1,tab:1,tooltip:1,treeitem:1};
var HIDDENSELF=function(n){if(n.getAttribute("aria-hidden")==="true"||n.hidden)return true;var cs=CS(n);return !cs||cs.display==="none"||cs.visibility==="hidden"};
var CONTENT=function(el,skip){var out=[];for(var i=0;i<el.childNodes.length;i++){var n=el.childNodes[i];if(n.nodeType===3){out.push(n.nodeValue);continue}if(n.nodeType!==1||n===skip)continue;var tg=n.tagName;
if(tg==="SCRIPT"||tg==="STYLE"||tg==="TEMPLATE"||tg==="NOSCRIPT"||HIDDENSELF(n))continue;var al=NORM(n.getAttribute("aria-label"));if(al){out.push(" "+al+" ");continue}
if(tg==="IMG"){out.push(" "+(n.getAttribute("alt")||"")+" ");continue}if(tg==="INPUT"){var ty=(n.type||"").toLowerCase();out.push(" "+(/^(button|submit|reset)$/.test(ty)?(n.value||""):/^(checkbox|radio)$/.test(ty)?"":(n.value||""))+" ");continue}
if(tg==="TEXTAREA"){out.push(" "+(n.value||"")+" ");continue}if(tg==="SELECT"){out.push(" "+(n.selectedOptions&&n.selectedOptions[0]?n.selectedOptions[0].text:"")+" ");continue}if(tg==="BR"){out.push(" ");continue}
var cs=CS(n),inl=cs&&String(cs.display).indexOf("inline")===0;var inner=CONTENT(n,skip);out.push(inl?inner:" "+inner+" ")}return out.join("")};
var BYIDS=function(ids){return String(ids||"").split(/\s+/).filter(Boolean).map(function(id){return document.getElementById(id)}).filter(Boolean)};
var NAME=function(el){var lb=el.getAttribute("aria-labelledby");if(lb){var s0=NORM(BYIDS(lb).map(function(n){return NORM(n.getAttribute("aria-label"))||CONTENT(n)}).join(" "));if(s0)return s0}
var al=NORM(el.getAttribute("aria-label"));if(al)return al;var t=el.tagName.toLowerCase(),ty=(el.getAttribute("type")||"").toLowerCase();
if(t==="input"&&/^(button|submit|reset)$/.test(ty)){var v=NORM(el.value||el.getAttribute("value"));if(v)return v;if(ty==="submit")return "Submit";if(ty==="reset")return "Reset";return NORM(el.title)}
if(t==="input"&&ty==="image")return NORM(el.getAttribute("alt")||el.title||"Submit");
if(t==="input"||t==="textarea"||t==="select"||t==="meter"||t==="progress"||t==="output"){var labs=el.labels?Array.prototype.slice.call(el.labels):[];if(labs.length){var s2=NORM(labs.map(function(l){return CONTENT(l,el)}).join(" "));if(s2)return s2}if(el.title)return NORM(el.title);return NORM(el.getAttribute("placeholder")||"")}
if(t==="img"||t==="area")return NORM(el.getAttribute("alt")||el.getAttribute("title")||"");
if(t==="fieldset"||t==="figure"||t==="table"){var cap=el.querySelector(t==="fieldset"?":scope > legend":t==="figure"?":scope > figcaption":":scope > caption");if(cap)return NORM(CONTENT(cap))}
if(t==="svg"){var ti=el.querySelector(":scope > title");if(ti)return NORM(ti.textContent)}
if(FROMCONTENT[ROLE(el)]){var c=NORM(CONTENT(el));if(c)return c}return NORM(el.getAttribute("title")||"")};
var LABELS=function(el){var lb=el.getAttribute("aria-labelledby");if(lb){var ls=BYIDS(lb);if(ls.length)return ls.map(function(n){return ELTEXT(n)})}var al=el.getAttribute("aria-label");if(al!=null&&al.trim())return [al];var t=el.tagName;if(/^(BUTTON|METER|OUTPUT|PROGRESS|SELECT|TEXTAREA)$/.test(t)||(t==="INPUT"&&el.type!=="hidden")){if(el.labels)return Array.prototype.map.call(el.labels,function(l){return ELTEXT(l)})}return []};
var CHECKED=function(el){var a=el.getAttribute("aria-checked");if(a==="true")return true;if(a==="mixed")return "mixed";if(a==="false")return false;if(el.tagName==="INPUT"&&(el.type==="checkbox"||el.type==="radio"))return el.indeterminate?"mixed":!!el.checked;var r=ROLE(el);if(r==="checkbox"||r==="radio"||r==="switch"||r==="menuitemcheckbox"||r==="menuitemradio")return false;return null};
var PRESSED=function(el){var a=el.getAttribute("aria-pressed");return a==="true"?true:a==="mixed"?"mixed":false};
var SELECTED=function(el){var a=el.getAttribute("aria-selected");if(a!=null)return a==="true";return el.tagName==="OPTION"?!!el.selected:false};
var EXPANDED=function(el){var a=el.getAttribute("aria-expanded");return a==null?null:a==="true"};
var LEVEL=function(el){var a=parseInt(el.getAttribute("aria-level")||"",10);if(a>0)return a;var m=/^H([1-6])$/.exec(el.tagName);return m?Number(m[1]):0};

// ---------------------------------------------------------------- texto de un elemento (getByText, hasText, toHaveText)
var SKIPTXT={SCRIPT:1,STYLE:1,NOSCRIPT:1,TEMPLATE:1,HEAD:1};
var ELTEXT=function(el){if(el.tagName==="INPUT"&&/^(button|submit|reset)$/i.test(el.type))return el.value||"";var out="";var walk=function(n){for(var i=0;i<n.childNodes.length;i++){var c=n.childNodes[i];if(c.nodeType===3)out+=c.nodeValue;else if(c.nodeType===1&&!SKIPTXT[c.tagName])walk(c)}};walk(el);return out};
var ALLEL=function(root){var out=[];var start=root.nodeType===9?root.documentElement:root;if(!start)return out;var w=document.createTreeWalker(start,1,{acceptNode:function(n){return SKIPTXT[n.tagName]?2:1}});var n=root.nodeType===9?w.currentNode:w.nextNode();while(n&&out.length<20000){out.push(n);n=w.nextNode()}return out};
var DEEPEST=function(list){return list.filter(function(el,i){var nx=list[i+1];return !(nx&&el.contains(nx))})};

// ---------------------------------------------------------------- localizar (la cadena de pasos de un «locator»)
var DOCORDER=function(a,b){if(a===b)return 0;return a.compareDocumentPosition(b)&4?-1:1};
var UNIQ=function(arr){var s=new Set(),o=[];for(var i=0;i<arr.length;i++)if(!s.has(arr[i])){s.add(arr[i]);o.push(arr[i])}return o};
var WITHIN=function(root,sel){try{return Array.prototype.slice.call((root.nodeType===9?root:root).querySelectorAll(sel))}catch(e){throw new Error("El selector «"+SL(sel,120)+"» no es válido")}};
var STEP=function(roots,st){var out=[];
if(st.t==="nth"){if(!roots.length)return [];var i=st.i<0?roots.length+st.i:st.i;return roots[i]?[roots[i]]:[]}
if(st.t==="filter"){return roots.filter(function(el){if(st.hasText&&!TXTM(st.hasText,false)(ELTEXT(el)))return false;if(st.hasNotText&&TXTM(st.hasNotText,false)(ELTEXT(el)))return false;if(st.has&&!RES(st.has,[el]).length)return false;if(st.hasNot&&RES(st.hasNot,[el]).length)return false;if(st.visible===true&&!VISIBLE(el))return false;if(st.visible===false&&VISIBLE(el))return false;return true})}
if(st.t==="and"){var other=RES(st.loc,[document]);var os=new Set(other);return roots.filter(function(el){return os.has(el)})}
if(st.t==="or"){return UNIQ(roots.concat(RES(st.loc,[document]))).sort(DOCORDER)}
for(var r=0;r<roots.length;r++){var root=roots[r];var cands;
if(st.t==="css"){cands=WITHIN(root,st.s)}
else if(st.t==="xpath"){var xp=st.s;if(root.nodeType!==9&&/^\//.test(xp))xp="."+xp;cands=[];try{var snap=document.evaluate(xp,root,null,7,null);for(var q=0;q<snap.snapshotLength;q++){var nd=snap.snapshotItem(q);if(nd&&nd.nodeType===1)cands.push(nd)}}catch(e){throw new Error("La expresión XPath «"+SL(st.s,120)+"» no es válida")}}
else if(st.t==="role"){var nm=st.name?TXTM(st.name,st.exact):null;cands=ALLEL(root).filter(function(el){if(ROLE(el)!==st.role)return false;if(!st.includeHidden&&AHIDDEN(el))return false;if(st.checked!=null&&CHECKED(el)!==st.checked)return false;if(st.pressed!=null&&PRESSED(el)!==st.pressed)return false;if(st.selected!=null&&SELECTED(el)!==st.selected)return false;if(st.expanded!=null&&EXPANDED(el)!==st.expanded)return false;if(st.disabled!=null&&DISABLED(el)!==st.disabled)return false;if(st.level&&LEVEL(el)!==st.level)return false;if(nm&&!nm(NAME(el)))return false;return true})}
else if(st.t==="text"){var tm=TXTM(st.v,st.exact);var all=ALLEL(root).filter(function(el){return el!==document.documentElement});
var hit=all.filter(function(el){return tm(ELTEXT(el))});cands=DEEPEST(hit)}
else if(st.t==="label"){var lm=TXTM(st.v,st.exact);cands=ALLEL(root).filter(function(el){return LABELS(el).some(function(t){return lm(t)})})}
else if(st.t==="placeholder"){var pm=TXTM(st.v,st.exact);cands=WITHIN(root,"[placeholder]").filter(function(el){return pm(el.getAttribute("placeholder"))})}
else if(st.t==="alt"){var am=TXTM(st.v,st.exact);cands=WITHIN(root,"[alt]").filter(function(el){return am(el.getAttribute("alt"))})}
else if(st.t==="title"){var ttm=TXTM(st.v,st.exact);cands=WITHIN(root,"[title]").filter(function(el){return ttm(el.getAttribute("title"))})}
else if(st.t==="testid"){var idm=st.v&&st.v.re!=null?TXTM(st.v,false):function(t){return t===String(st.v&&st.v.s)};cands=WITHIN(root,"[data-testid]").filter(function(el){return idm(el.getAttribute("data-testid"))})}
else throw new Error("Paso de búsqueda desconocido: "+st.t);
for(var c2=0;c2<cands.length;c2++)out.push(cands[c2])}
return UNIQ(out).sort(DOCORDER)};
var RES=function(steps,roots){var cur=roots||[document];for(var i=0;i<steps.length;i++){cur=STEP(cur,steps[i]);if(!cur.length&&steps[i].t!=="or")return []}return cur};

// ---------------------------------------------------------------- describir elementos (para los mensajes de error)
var DESC=function(el){if(!el||el.nodeType!==1)return "";var t=el.tagName.toLowerCase(),a="";if(el.id)a+=' id="'+SL(el.id,40)+'"';var cl=String(el.getAttribute("class")||"").trim();if(cl)a+=' class="'+SL(cl,50)+'"';["type","name","role","aria-label","placeholder","href","data-testid"].forEach(function(n){var v=el.getAttribute(n);if(v!=null&&v!=="")a+=" "+n+'="'+SL(v,40)+'"'});var tx=SL(NORM(ELTEXT(el)),50);return "<"+t+a+">"+tx+(el.children.length||tx?"</"+t+">":"")};

// ---------------------------------------------------------------- desplazar dentro de la página (nunca mueve WILLY)
var SCROLLIN=function(el){try{var r=el.getBoundingClientRect(),vh=innerHeight,vw=innerWidth;for(var p=el.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){var cs=CS(p);if(!cs||!/(auto|scroll|overlay)/.test(cs.overflowY+cs.overflowX))continue;var pr=p.getBoundingClientRect();if(r.top<pr.top||r.bottom>pr.bottom)p.scrollTop+=(r.top+r.height/2)-(pr.top+pr.height/2);if(r.left<pr.left||r.right>pr.right)p.scrollLeft+=(r.left+r.width/2)-(pr.left+pr.width/2);r=el.getBoundingClientRect()}
var se=document.scrollingElement||document.documentElement;if(r.top<0||r.bottom>vh)se.scrollTop+=(r.top+r.height/2)-vh/2;if(r.left<0||r.right>vw)se.scrollLeft+=(r.left+r.width/2)-vw/2}catch(e){}};

// ---------------------------------------------------------------- ratón y teclado «de persona»
var BTN={left:0,middle:1,right:2};
var MODS=function(o){o=o||{};var m=o.modifiers||[];var has=function(k){return m.indexOf(k)>=0};return {ctrlKey:has("Control")||has("ControlOrMeta"),shiftKey:has("Shift"),altKey:has("Alt"),metaKey:has("Meta")}};
var MEV=function(type,target,x,y,o){var init={bubbles:!/(enter|leave)$/.test(type),cancelable:!/(enter|leave|move)$/.test(type)||type==="mousemove"||type==="pointermove",composed:true,view:window,clientX:x,clientY:y,screenX:x,screenY:y,button:o.button||0,buttons:o.buttons||0,detail:o.detail||0,relatedTarget:null};var md=o.mods||{};init.ctrlKey=!!md.ctrlKey;init.shiftKey=!!md.shiftKey;init.altKey=!!md.altKey;init.metaKey=!!md.metaKey;
var ev;if(/^pointer/.test(type)&&window.PointerEvent){init.pointerId=1;init.pointerType="mouse";init.isPrimary=true;ev=new PointerEvent(type,init)}else if(type==="wheel"){init.deltaX=o.dx||0;init.deltaY=o.dy||0;ev=new WheelEvent(type,init)}else ev=new MouseEvent(type,init);return target.dispatchEvent(ev)};
var HOVERSEQ=function(t,x,y,mods){MEV("pointerover",t,x,y,{mods:mods});MEV("pointerenter",t,x,y,{mods:mods});MEV("mouseover",t,x,y,{mods:mods});MEV("mouseenter",t,x,y,{mods:mods});MEV("pointermove",t,x,y,{mods:mods});MEV("mousemove",t,x,y,{mods:mods})};
var CLICKSEQ=function(t,x,y,o){var b=BTN[o.button||"left"]||0,n=Math.max(1,Math.min(3,o.clickCount||1)),mods=MODS(o);HOVERSEQ(t,x,y,mods);
for(var i=1;i<=n;i++){MEV("pointerdown",t,x,y,{button:b,buttons:1<<b,detail:i,mods:mods});var md=MEV("mousedown",t,x,y,{button:b,buttons:1<<b,detail:i,mods:mods});if(md!==false&&t.isConnected)VFOCUS(focusTarget(t));
MEV("pointerup",t,x,y,{button:b,detail:i,mods:mods});MEV("mouseup",t,x,y,{button:b,detail:i,mods:mods});if(b===0)MEV("click",t,x,y,{button:0,detail:i,mods:mods});else if(b===2)MEV("contextmenu",t,x,y,{button:2,detail:i,mods:mods});else MEV("auxclick",t,x,y,{button:b,detail:i,mods:mods})}
if(n===2&&b===0)MEV("dblclick",t,x,y,{button:0,detail:2,mods:mods})};
var NATIVE=function(el,v){var proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;var d=Object.getOwnPropertyDescriptor(proto,"value");if(d&&d.set)d.set.call(el,v);else el.value=v};
var IEV=function(el,data,type){try{el.dispatchEvent(new InputEvent("input",{bubbles:true,composed:true,inputType:type||"insertText",data:data==null?null:data}))}catch(e){el.dispatchEvent(new Event("input",{bubbles:true}))}};
var CEV=function(el){el.dispatchEvent(new Event("change",{bubbles:true}))};
var KEYNAMES={enter:"Enter",tab:"Tab",escape:"Escape",esc:"Escape",backspace:"Backspace",delete:"Delete",arrowup:"ArrowUp",arrowdown:"ArrowDown",arrowleft:"ArrowLeft",arrowright:"ArrowRight",home:"Home",end:"End",pageup:"PageUp",pagedown:"PageDown",space:" ",shift:"Shift",control:"Control",alt:"Alt",meta:"Meta",controlormeta:"Control",insert:"Insert"};
var KEYCODES={Enter:13,Tab:9,Escape:27,Backspace:8,Delete:46,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Home:36,End:35,PageUp:33,PageDown:34," ":32,Shift:16,Control:17,Alt:18,Meta:91};
var PARSEKEY=function(spec){var parts=String(spec).split("+"),key=parts.pop();if(key===""&&parts.length){parts.pop();key="+"}var mods=parts.map(function(p){var k=KEYNAMES[p.toLowerCase()]||p;return k==="Control"&&p.toLowerCase()==="controlormeta"?"Control":k});var k=key.length===1?key:(KEYNAMES[key.toLowerCase()]||(/^F\d{1,2}$/i.test(key)?key.toUpperCase():key));return {key:k,mods:mods}};
var CODEOF=function(k){if(k.length===1){if(/[a-z]/i.test(k))return "Key"+k.toUpperCase();if(/\d/.test(k))return "Digit"+k;if(k===" ")return "Space";return ""}return k};
var KEV=function(type,t,k,mods){var init={key:k,code:CODEOF(k),bubbles:true,cancelable:true,composed:true,view:window,ctrlKey:mods.indexOf("Control")>=0,shiftKey:mods.indexOf("Shift")>=0,altKey:mods.indexOf("Alt")>=0,metaKey:mods.indexOf("Meta")>=0,keyCode:KEYCODES[k]||(k.length===1?k.toUpperCase().charCodeAt(0):0),which:KEYCODES[k]||(k.length===1?k.toUpperCase().charCodeAt(0):0),charCode:type==="keypress"&&k.length===1?k.charCodeAt(0):0};return t.dispatchEvent(new KeyboardEvent(type,init))};
var ISTEXT=function(el){return el&&(el.tagName==="TEXTAREA"||(el.tagName==="INPUT"&&!/^(checkbox|radio|file|button|submit|reset|image|range|color|hidden)$/i.test(el.type)))};
var INSERT=function(el,ch){if(ISTEXT(el)){if(el.readOnly||DISABLED(el))return;var cur=AS?"":String(el.value||"");AS=false;var ml=el.maxLength;if(ml>=0&&cur.length>=ml)return;NATIVE(el,cur+ch);IEV(el,ch,"insertText")}else if(el&&el.isContentEditable){if(AS){el.textContent="";AS=false}el.textContent=(el.textContent||"")+ch;IEV(el,ch,"insertText")}};
var TABNEXT=function(back){var list=Array.prototype.slice.call(document.querySelectorAll(FOCUSABLE)).filter(function(el){return canFocus(el)&&VISIBLE(el)&&el.tabIndex>=0});if(!list.length)return;var i=VF?list.indexOf(VF):-1;var n=back?(i<=0?list.length-1:i-1):(i<0||i>=list.length-1?0:i+1);VFOCUS(list[n])};
var PRESS=function(spec,target){var pk=PARSEKEY(spec),k=pk.key,mods=pk.mods,t=target||VF||document.body;var ctrl=mods.indexOf("Control")>=0||mods.indexOf("Meta")>=0;
mods.forEach(function(m){KEV("keydown",t,m,mods)});var ok=KEV("keydown",t,k,mods);var printable=k.length===1&&!ctrl;
if(ok&&(printable||k==="Enter"))KEV("keypress",t,k==="Enter"?"Enter":k,mods);
if(ok){if(ctrl&&(k==="a"||k==="A")){if(ISTEXT(t)||t.isContentEditable)AS=true}
else if(printable)INSERT(t,k);
else if(k==="Enter"){if(t.tagName==="TEXTAREA")INSERT(t,"\n");else if(ISTEXT(t)){var f=t.form;if(f){var db=f.querySelector("button:not([type]),button[type=submit],input[type=submit],input[type=image]");if(db){if(!DISABLED(db)){var rb=db.getBoundingClientRect();MEV("click",db,rb.left+rb.width/2,rb.top+rb.height/2,{detail:0})}}else{var single=Array.prototype.filter.call(f.elements,function(x){return ISTEXT(x)&&x.tagName==="INPUT"}).length===1;if(single){if(f.requestSubmit)f.requestSubmit();else f.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))}}}}else if(t.tagName==="BUTTON"||t.tagName==="A"||t.tagName==="SUMMARY"||(t.tagName==="INPUT"&&/^(button|submit|reset|image)$/i.test(t.type))||t.getAttribute("role")==="button"){var r=t.getBoundingClientRect();MEV("click",t,r.left+r.width/2,r.top+r.height/2,{detail:0})}}
else if(k==="Backspace"||k==="Delete"){if(ISTEXT(t)&&!t.readOnly){var v=String(t.value||"");var nv=AS?"":(k==="Backspace"?v.slice(0,-1):v);AS=false;if(nv!==v){NATIVE(t,nv);IEV(t,null,k==="Backspace"?"deleteContentBackward":"deleteContentForward")}}else if(t.isContentEditable){t.textContent=AS?"":String(t.textContent||"").slice(0,-1);AS=false;IEV(t,null,"deleteContentBackward")}}
else if(k==="Tab"){TABNEXT(mods.indexOf("Shift")>=0)}}
KEV("keyup",t,k,mods);if(ok&&k===" "&&(t.tagName==="BUTTON"||(t.tagName==="INPUT"&&/^(checkbox|radio|button|submit|reset)$/i.test(t.type))||t.getAttribute("role")==="button"||t.getAttribute("role")==="checkbox")){var r2=t.getBoundingClientRect();MEV("click",t,r2.left+r2.width/2,r2.top+r2.height/2,{detail:0})}
mods.slice().reverse().forEach(function(m){KEV("keyup",t,m,mods)})};

// ---------------------------------------------------------------- las acciones (con las comprobaciones de Playwright)
var FAIL=function(motivo,extra){var o={ok:false,motivo:motivo,reintentar:true};if(extra)for(var k in extra)o[k]=extra[k];return o};
var TARGET=function(loc,o,need){var els=RES(loc);if(!els.length)return FAIL("no-existe");if(els.length>1&&!o.noStrict)return FAIL("varios",{reintentar:false,n:els.length,muestras:els.slice(0,4).map(DESC)});var el=els[0];
if(!o.force){if(need.visible&&!VISIBLE(el))return FAIL("oculto",{muestra:DESC(el)});if(need.enabled&&DISABLED(el))return FAIL("desactivado",{muestra:DESC(el)});if(need.editable&&!EDITABLE(el))return FAIL(DISABLED(el)?"desactivado":"no-editable",{muestra:DESC(el)})}return {el:el}};
var POINT=function(el,o){SCROLLIN(el);var r=el.getBoundingClientRect();var x=o.position?r.left+Number(o.position.x||0):r.left+r.width/2,y=o.position?r.top+Number(o.position.y||0):r.top+r.height/2;
if(o.force)return {x:x,y:y,t:el};var hit=document.elementFromPoint(x,y);if(!hit)return FAIL("fuera",{muestra:DESC(el)});if(hit!==el&&!el.contains(hit)){if(hit.tagName==="LABEL"&&hit.control===el)return {x:x,y:y,t:hit};return FAIL("tapado",{por:DESC(hit),muestra:DESC(el)})}return {x:x,y:y,t:hit}};
var ACTS={
click:function(el,c,o){var p=POINT(el,o);if(p.ok===false)return p;CLICKSEQ(p.t,p.x,p.y,o);return {ok:true}},
dblclick:function(el,c,o){o.clickCount=2;return ACTS.click(el,c,o)},
tap:function(el,c,o){return ACTS.click(el,c,o)},
hover:function(el,c,o){var p=POINT(el,o);if(p.ok===false)return p;HOVERSEQ(p.t,p.x,p.y,MODS(o));return {ok:true}},
fill:function(el,c){var v=String(c.valor==null?"":c.valor);if(el.tagName==="INPUT"){var ty=(el.type||"").toLowerCase();if(/^(checkbox|radio|file|button|submit|reset|image|range|color|hidden)$/.test(ty))return {ok:false,motivo:"no-rellenable",reintentar:false,tipo:ty};if(ty==="number"&&v.trim()!==""&&isNaN(Number(v)))return {ok:false,motivo:"no-numero",reintentar:false}}
VFOCUS(focusTarget(el)||el);if(el.tagName!=="INPUT"&&el.tagName!=="TEXTAREA"&&el.tagName!=="SELECT"&&el.isContentEditable){el.textContent=v;IEV(el,v,"insertText");return {ok:true}}
if(el.tagName==="SELECT")return {ok:false,motivo:"es-lista",reintentar:false};NATIVE(el,v);IEV(el,v||null,v?"insertText":"deleteContentBackward");CEV(el);return {ok:true}},
clear:function(el,c,o){c.valor="";return ACTS.fill(el,c,o)},
type:function(el,c){VFOCUS(focusTarget(el)||el);var txt=String(c.valor==null?"":c.valor);for(var i=0;i<txt.length;i++){var ch=txt[i];var ok=KEV("keydown",el,ch,[]);if(ok){KEV("keypress",el,ch,[]);INSERT(el,ch)}KEV("keyup",el,ch,[])}if(ISTEXT(el))CEV(el);return {ok:true}},
press:function(el,c){VFOCUS(focusTarget(el)||el);PRESS(String(c.valor||""),el);return {ok:true}},
focus:function(el){VFOCUS(focusTarget(el)||el);return {ok:true}},
blur:function(el){if(VF===el)VFOCUS(null);return {ok:true}},
scroll:function(el){SCROLLIN(el);return {ok:true}},
check:function(el,c,o){var want=c.valor!==false;var st=CHECKED(el);if(st===null)return {ok:false,motivo:"no-es-casilla",reintentar:false,muestra:DESC(el)};if(!want&&el.tagName==="INPUT"&&el.type==="radio")return {ok:false,motivo:"radio-no-se-desmarca",reintentar:false};if(st===want)return {ok:true};
var r=ACTS.click(el,c,o);if(r.ok===false)return r;if(CHECKED(el)!==want)return {ok:false,motivo:"no-cambia",reintentar:false,muestra:DESC(el)};return {ok:true}},
select:function(el,c){if(el.tagName!=="SELECT")return {ok:false,motivo:"no-es-lista",reintentar:false,muestra:DESC(el)};var wants=c.valor||[];var opts=Array.prototype.slice.call(el.options);var pick=[];
for(var i=0;i<wants.length;i++){var w=wants[i];var found=opts.filter(function(op,idx){if(w.index!=null&&idx!==w.index)return false;if(w.value!=null&&op.value!==String(w.value))return false;if(w.label!=null&&NORM(op.label||op.text)!==NORM(w.label))return false;if(w.any!=null)return op.value===String(w.any)||NORM(op.label||op.text)===NORM(w.any);return true});if(!found.length)return FAIL("sin-opcion",{opcion:w.any!=null?String(w.any):w.value!=null?String(w.value):w.label!=null?String(w.label):"#"+w.index});pick.push(found[0]);if(!el.multiple)break}
if(DISABLED(el))return FAIL("desactivado",{muestra:DESC(el)});VFOCUS(el);opts.forEach(function(op){op.selected=pick.indexOf(op)>=0});if(!el.multiple&&pick[0])el.selectedIndex=opts.indexOf(pick[0]);IEV(el,null,"insertReplacementText");CEV(el);return {ok:true,value:pick.map(function(op){return op.value})}},
dispatch:function(el,c){var type=String(c.valor||"click"),init=c.init||{};init.bubbles=init.bubbles!==false;init.cancelable=init.cancelable!==false;init.composed=true;var ev;if(/^(click|dblclick|mouse|contextmenu|auxclick)/.test(type))ev=new MouseEvent(type,init);else if(/^pointer/.test(type)&&window.PointerEvent)ev=new PointerEvent(type,init);else if(/^key/.test(type))ev=new KeyboardEvent(type,init);else if(/^(focus|blur)/.test(type))ev=new FocusEvent(type,init);else if(type==="input")ev=new InputEvent(type,init);else ev=new CustomEvent(type,{bubbles:init.bubbles,cancelable:init.cancelable,composed:true,detail:init.detail});el.dispatchEvent(ev);return {ok:true}}};
var NEEDS={click:{visible:1,enabled:1},dblclick:{visible:1,enabled:1},tap:{visible:1,enabled:1},hover:{visible:1},fill:{visible:1,enabled:1,editable:1},clear:{visible:1,enabled:1,editable:1},type:{},press:{},focus:{},blur:{},scroll:{},check:{visible:1,enabled:1},select:{visible:1},dispatch:{}};

// ---------------------------------------------------------------- lo que se cuenta para comprobar (expect)
var INVIEW=function(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth};
var STATE=function(el,c){var o={};var f=c.campos||[];for(var i=0;i<f.length;i++){switch(f[i]){
case "vis":o.vis=VISIBLE(el);break;case "txt":o.txt=ELTEXT(el);break;case "inner":o.inner=el.innerText!=null?el.innerText:ELTEXT(el);break;
case "val":o.val=el.tagName==="INPUT"||el.tagName==="TEXTAREA"||el.tagName==="SELECT"?String(el.value==null?"":el.value):null;if(el.tagName==="SELECT"&&el.multiple)o.vals=Array.prototype.slice.call(el.selectedOptions).map(function(op){return op.value});break;
case "chk":o.chk=CHECKED(el);break;case "en":o.en=!DISABLED(el);break;case "ed":o.ed=EDITABLE(el);break;case "foc":o.foc=VF===el;break;case "cls":o.cls=String(el.getAttribute("class")||"");break;case "id":o.id=el.id||"";break;
case "name":o.name=NAME(el);break;case "role":o.role=ROLE(el);break;case "inview":o.inview=INVIEW(el);break;case "empty":o.empty=ISTEXT(el)||el.tagName==="TEXTAREA"?!String(el.value||""):!String(el.textContent||"").trim();break;
case "desc":o.desc=DESC(el);break;case "box":var r=el.getBoundingClientRect();o.box={x:r.left,y:r.top,width:r.width,height:r.height};break}}
if(c.attrs){o.attrs={};c.attrs.forEach(function(n){o.attrs[n]=el.getAttribute(n)})}if(c.css){o.css={};var cs=CS(el);c.css.forEach(function(n){o.css[n]=cs?cs.getPropertyValue(n)||cs[n]||"":""})}if(c.props){o.props={};c.props.forEach(function(n){try{var v=el[n];o.props[n]=v==null||typeof v!=="object"?v:String(v)}catch(e){o.props[n]=null}})}return o};

// ---------------------------------------------------------------- valores que vuelven a WILLY (evaluate)
var OUT=function(v,depth,seen){depth=depth||0;seen=seen||[];if(v===undefined)return {__u:1};if(v===null||typeof v==="boolean"||typeof v==="string")return v;if(typeof v==="number"){if(isNaN(v))return {__n:"NaN"};if(!isFinite(v))return {__n:v>0?"Infinity":"-Infinity"};if(v===0&&1/v<0)return {__n:"-0"};return v}
if(typeof v==="bigint")return {__b:String(v)};if(typeof v==="function"||typeof v==="symbol")return {__u:1};if(depth>8||seen.indexOf(v)>=0)return "[…]";if(v instanceof Date)return {__d:v.toISOString()};if(v instanceof RegExp)return {__r:v.source,f:v.flags};if(window.Node&&v instanceof Node)return {__e:v.nodeType===1?DESC(v):String(v.nodeName)};
seen=seen.concat([v]);if(Array.isArray(v)||(typeof v.length==="number"&&typeof v!=="string"&&v.item)){var a=[];for(var i=0;i<Math.min(v.length,1000);i++)a.push(OUT(v[i],depth+1,seen));return a}if(v instanceof Map){var m=[];v.forEach(function(val,key){m.push([OUT(key,depth+1,seen),OUT(val,depth+1,seen)])});return {__m:m}}if(v instanceof Set){var s=[];v.forEach(function(x){s.push(OUT(x,depth+1,seen))});return {__s:s}}
var o={};var ks=Object.keys(v).slice(0,200);for(var j=0;j<ks.length;j++){try{o[ks[j]]=OUT(v[ks[j]],depth+1,seen)}catch(e){o[ks[j]]=null}}return o};
var IN=function(v){if(v&&typeof v==="object"){if(v.__u)return undefined;if(v.__n)return Number(v.__n==="-0"?-0:v.__n);if(v.__d)return new Date(v.__d);if(v.__r!=null)return new RegExp(v.__r,v.f||"");if(Array.isArray(v))return v.map(IN);var o={};for(var k in v)o[k]=IN(v[k]);return o}return v};
var FN=function(src,isFn){if(!isFn)return null;try{return (0,eval)("("+src+")")}catch(e){try{return (0,eval)("(function "+src+")")}catch(e2){throw new Error("No se puede ejecutar esa función en la página: "+S(e))}}};

// ---------------------------------------------------------------- órdenes de WILLY
var DO=function(c){switch(c.op){
case "contar":return {ok:true,value:RES(c.loc).length};
case "estado":{var els=RES(c.loc);return {ok:true,value:{n:els.length,items:els.slice(0,c.max||60).map(function(el){return STATE(el,c)})}}}
case "describe":{var e2=RES(c.loc);return {ok:true,value:e2.slice(0,6).map(DESC)}}
case "accion":{var need=NEEDS[c.que];if(!need)return {ok:false,error:"Acción desconocida: "+c.que};var o=c.opciones||{};var tg=TARGET(c.loc,o,need);if(tg.ok===false)return tg;var r=ACTS[c.que](tg.el,c,o);return r}
case "info":return {ok:true,value:{hash:location.hash,titulo:document.title,listo:document.readyState}};
case "html":return {ok:true,value:document.documentElement?document.documentElement.outerHTML:""};
case "teclado":{var t=VF&&VF.isConnected?VF:document.body;if(c.que==="press"){PRESS(String(c.tecla||""),t);return {ok:true}}if(c.que==="type"||c.que==="insertText"){var tx=String(c.texto||"");for(var i=0;i<tx.length;i++){if(c.que==="type"){var ok2=KEV("keydown",t,tx[i],[]);if(ok2){KEV("keypress",t,tx[i],[]);INSERT(t,tx[i])}KEV("keyup",t,tx[i],[])}else INSERT(t,tx[i])}return {ok:true}}
if(c.que==="down"){var pk=PARSEKEY(c.tecla);KEV("keydown",t,pk.key,pk.mods);return {ok:true}}if(c.que==="up"){var pk2=PARSEKEY(c.tecla);KEV("keyup",t,pk2.key,pk2.mods);return {ok:true}}return {ok:false,error:"Tecla desconocida"}}
case "raton":{var x=Number(c.x)||0,y=Number(c.y)||0,h=document.elementFromPoint(x,y)||document.body;if(c.que==="click"||c.que==="dblclick"){CLICKSEQ(h,x,y,{clickCount:c.que==="dblclick"?2:(c.clickCount||1),button:c.boton||"left"});return {ok:true}}if(c.que==="move"){HOVERSEQ(h,x,y,{});return {ok:true}}
if(c.que==="down"){MEV("pointerdown",h,x,y,{buttons:1});if(MEV("mousedown",h,x,y,{buttons:1})!==false)VFOCUS(focusTarget(h));return {ok:true}}if(c.que==="up"){MEV("pointerup",h,x,y,{});MEV("mouseup",h,x,y,{});return {ok:true}}
if(c.que==="wheel"){MEV("wheel",h,x,y,{dx:c.dx,dy:c.dy});try{(document.scrollingElement||document.documentElement).scrollBy(Number(c.dx)||0,Number(c.dy)||0)}catch(e){}return {ok:true}}return {ok:false,error:"Movimiento de ratón desconocido"}}
case "historia":{if(c.que==="atras"){history.back()}else history.forward();return {ok:true}}
case "dialogo":DLG=c.politica==="aceptar"?"aceptar":"rechazar";DLGT=c.texto!=null?String(c.texto):null;return {ok:true};
case "evaluar":{var f=FN(c.fn,c.esFn);var arg=IN(c.arg);var res;if(c.loc){var e3=RES(c.loc);if(c.todos)res=f(e3,arg);else{if(!e3.length)return FAIL("no-existe");if(e3.length>1)return FAIL("varios",{reintentar:false,n:e3.length,muestras:e3.slice(0,4).map(DESC)});res=f(e3[0],arg)}}else res=f?f(arg):(0,eval)(String(c.fn));
if(res&&typeof res.then==="function")return res.then(function(v){return {ok:true,value:OUT(v)}},function(e){return {ok:false,error:S(e),reintentar:false,enPagina:true}});return {ok:true,value:OUT(res)}}
default:return {ok:false,error:"Orden desconocida: "+c.op}}};
addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(!d||d.__willyOrden!==true||d.k!==K||d.orden!=="prueba")return;var id=d.id,r;
try{r=DO(d.cmd||{})}catch(x){r={ok:false,error:S(x),reintentar:false}}
var FLUSH=function(){if(STT){clearTimeout(STT);STT=null;P({tipo:"prueba-almacen",local:ST.local,session:ST.session})}};
if(r&&typeof r.then==="function")r.then(function(v){FLUSH();P({tipo:"prueba-respuesta",id:id,r:v})},function(x){FLUSH();P({tipo:"prueba-respuesta",id:id,r:{ok:false,error:S(x)}})});else{FLUSH();P({tipo:"prueba-respuesta",id:id,r:r})}});
var READY=function(){P({tipo:"prueba-listo",hash:location.hash,titulo:document.title})};
if(document.readyState==="complete")setTimeout(READY,0);else addEventListener("load",function(){setTimeout(READY,0)});
`;

/** El probador para una carga concreta (texto de un <script>): su marca y lo que trae de la carga anterior de la misma prueba. */
export function testAgentScript(cfg: AgentConfig): string {
  const token = cfg.token.replace(/[^\w.-]/g, "").slice(0, 60);
  const conf = JSON.stringify({ storage: cfg.storage ?? null, dialog: cfg.dialog ?? null }).replace(/</g, "\\u003c");
  return `<script>(function(){\nvar K=${JSON.stringify(token)},CFG=${conf};\n${AGENT}\n})();</script>`;
}

/**
 * La página de un proyecto preparada para pasarle las pruebas: el vigía de la vista previa (errores, consola, enlaces…) y el
 * probador, los dos antes que los scripts de la propia página.
 */
export function withTestAgent(html: string, opts: AgentConfig & { hash?: string | null }): string {
  const monitor: MonitorOptions = { token: opts.token, ...(opts.hash ? { hash: opts.hash } : {}) };
  const scripts = monitorScript(monitor) + testAgentScript(opts);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, (_m, attrs: string) => `<head${attrs}>${scripts}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, (_m, attrs: string) => `<html${attrs}>${scripts}`);
  return `${scripts}${html}`;
}

/** Lo que contesta el probador (siempre con `__willyVista: true`, su marca y `tipo`). */
export type AgentMessage =
  | { tipo: "prueba-listo"; hash: string; titulo: string }
  | { tipo: "prueba-respuesta"; id: number; r: AgentReply }
  | { tipo: "prueba-almacen"; local: Record<string, string>; session: Record<string, string> }
  | { tipo: "prueba-dialogo"; clase: "alert" | "confirm" | "prompt"; mensaje: string };

/** La respuesta a una orden: bien (con su valor) o por qué no (y si tiene sentido volver a intentarlo en un momento). */
export type AgentReply = {
  ok: boolean;
  value?: unknown;
  error?: string;
  motivo?: string;
  reintentar?: boolean;
  n?: number;
  muestras?: string[];
  muestra?: string;
  por?: string;
  opcion?: string;
  tipo?: string;
  enPagina?: boolean;
};

/** ¿Es un mensaje del probador de ESTA carga? (lo demás que llegue se ignora) */
export function asAgentMessage(data: unknown, token: string): AgentMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d["__willyVista"] !== true || d["k"] !== token || typeof d["tipo"] !== "string") return null;
  const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
  const dict = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!v || typeof v !== "object") return out;
    let size = 0;
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 500)) {
      const s = String(val ?? "");
      size += k.length + s.length;
      if (size > 5_000_000) break;
      out[k] = s;
    }
    return out;
  };
  switch (d["tipo"]) {
    case "prueba-listo": return { tipo: "prueba-listo", hash: str(d["hash"], 300), titulo: str(d["titulo"], 300) };
    case "prueba-respuesta": {
      const id = Number(d["id"]);
      const r = d["r"] && typeof d["r"] === "object" ? (d["r"] as AgentReply) : { ok: false, error: "Respuesta vacía" };
      return Number.isFinite(id) ? { tipo: "prueba-respuesta", id, r } : null;
    }
    case "prueba-almacen": return { tipo: "prueba-almacen", local: dict(d["local"]), session: dict(d["session"]) };
    case "prueba-dialogo": {
      const clase = d["clase"] === "confirm" || d["clase"] === "prompt" ? d["clase"] : "alert";
      return { tipo: "prueba-dialogo", clase, mensaje: str(d["mensaje"], 300) };
    }
    default: return null;
  }
}
