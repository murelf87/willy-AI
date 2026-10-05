import nodePath from "node:path";
import { promises as fs } from "node:fs";

export type BoeLegalResult = {
  id: string; title: string; rank: string; number: string; department: string;
  publicationDate: string; effectiveDate: string; exhausted: boolean;
  consolidatedState: string; url: string; eli?: string;
};
export type BojaResult = {
  id: string; date: string; organisation: string; section: string;
  summary: string; number: string; url: string;
};
export type EuLegalResult = {
  id: string; title: string; ecli?: string; date?: string;
  type: "legislation" | "case-law"; url: string;
};
type SparqlBinding = { value?: string };
type SparqlRow = Record<string, SparqlBinding>;

const s = (value: unknown) => typeof value === "string" ? value.trim() : String(value ?? "").trim();
const nestedText = (value: unknown) => value && typeof value === "object" && "texto" in value
  ? s((value as { texto?: unknown }).texto) : s(value);

function legalTerms(query: string): string[] {
  const stop = new Set(["para","como","este","esta","estos","estas","desde","hasta","sobre","segun","según","analiza","analizar","caso","documento","documentos","derecho","legal","juridico","jurídico","puede","puedo","quiero","necesito","contra","entre","porque","donde","cuando","cual","cuál","unos","unas","del","las","los","una","uno","que","por","con","sin","sus","mis","son","hay","más","mas"]);
  const words = query.toLowerCase().normalize("NFC").match(/[a-záéíóúüñ0-9]{3,}/giu) ?? [];
  const unique: string[] = [];
  for (const word of words) if (!stop.has(word) && !unique.includes(word)) unique.push(word);
  return unique.slice(0, 7);
}
function boeQuery(query: string): string {
  const terms = legalTerms(query);
  const condition = terms.length ? terms.map((term) => `texto:${term}`).join(" and ") : `texto:${query.replace(/[^\p{L}\p{N} ]/gu," ").trim().split(/\s+/).slice(0,5).join(" and texto:")}`;
  return JSON.stringify({ query: { query_string: { query: condition }, range: {} }, sort: [{ fecha_publicacion: "desc" }] });
}
function stripHtml(value: string): string {
  return value.replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/p>|<\/article>|<\/div>|<\/title>|<\/articulo>|<\/bloque>/gi,"\n")
    .replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"')
    .replace(/[ \t]+/g," ").replace(/\n\s+/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}

export async function searchBoeLegislation(query: string, limit = 8): Promise<BoeLegalResult[]> {
  const clean = query.trim().slice(0,500); if (!clean) return [];
  const url = new URL("https://www.boe.es/datosabiertos/api/legislacion-consolidada");
  url.searchParams.set("query", boeQuery(clean));
  url.searchParams.set("limit", String(Math.max(1, Math.min(15, limit))));
  const response = await fetch(url,{headers:{Accept:"application/json","User-Agent":"WILLY-AI-Juridico/1.0"},signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`BOE respondió ${response.status}.`);
  const json = await response.json() as { data?: unknown };
  const data = Array.isArray(json.data) ? json.data as Array<Record<string,unknown>> : [];
  return data.map((item)=>({
    id:s(item.identificador), title:s(item.titulo), rank:nestedText(item.rango), number:s(item.numero_oficial),
    department:nestedText(item.departamento), publicationDate:s(item.fecha_publicacion), effectiveDate:s(item.fecha_vigencia),
    exhausted:s(item.vigencia_agotada).toUpperCase()==="S", consolidatedState:nestedText(item.estado_consolidacion),
    url:s(item.url_html_consolidada)||(`https://www.boe.es/buscar/act.php?id=${encodeURIComponent(s(item.identificador))}`),
    ...(s(item.url_eli)?{eli:s(item.url_eli)}:{}),
  })).filter((x)=>x.id&&x.title);
}
export async function getBoeLegislationText(id: string): Promise<{id:string;text:string;url:string}> {
  const safe=id.trim(); if(!/^BOE-[A-Z]-\d{4}-\d+$/i.test(safe)) throw new Error("Identificador BOE no válido.");
  const url=`https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/${encodeURIComponent(safe)}/texto`;
  const response=await fetch(url,{headers:{Accept:"application/xml","User-Agent":"WILLY-AI-Juridico/1.0"},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`BOE respondió ${response.status}.`);
  return {id:safe,text:stripHtml(await response.text()).slice(0,120000),url:`https://www.boe.es/buscar/act.php?id=${encodeURIComponent(safe)}`};
}

export async function searchBoja(query: string, limit = 10): Promise<BojaResult[]> {
  const clean=query.trim().slice(0,300); if(!clean)return[];
  const url=new URL("https://datos.juntadeandalucia.es/api/v0/boja/get/search_pagination");
  url.searchParams.set("order_by","date"); url.searchParams.set("mode","DESC"); url.searchParams.set("size",String(Math.max(1,Math.min(25,limit))));
  url.searchParams.set("page","0"); url.searchParams.set("general",clean); url.searchParams.set("general_search_like","true");
  const response=await fetch(url,{headers:{Accept:"application/json","User-Agent":"WILLY-AI-Juridico/1.0"},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`BOJA respondió ${response.status}.`);
  const json=await response.json() as {results?:Array<Record<string,unknown>>};
  return (json.results??[]).map((row)=>({id:s(row.id),date:s(row.date),organisation:s(row.organisation),section:s(row.titleSec),summary:stripHtml(s(row.summary)),number:s(row.number),url:"https://juntadeandalucia.es/eboja/"})).filter((x)=>x.id&&x.summary);
}
export async function getBojaDisposition(id: string): Promise<{id:string;summary:string;body:string;pdf:string;url:string}> {
  const safe=id.trim(); if(!/^disposition\.\d{4}\.\d+\.\d+$/i.test(safe)) throw new Error("Identificador BOJA no válido.");
  const response=await fetch(`https://datos.juntadeandalucia.es/api/v0/boja/${encodeURIComponent(safe)}`,{headers:{Accept:"application/json","User-Agent":"WILLY-AI-Juridico/1.0"},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`BOJA respondió ${response.status}.`);
  const row=await response.json() as Record<string,unknown>; const pdfs=Array.isArray(row.pdf)?row.pdf as Array<Record<string,unknown>>:[];
  const pdf=s(pdfs[0]?.publicUrl);
  return {id:safe,summary:s(row.summaryNoHtml)||stripHtml(s(row.summary)),body:s(row.bodyNoHtml)||stripHtml(s(row.body)),pdf,url:pdf||"https://juntadeandalucia.es/eboja/"};
}

function escapeSparqlRegex(value:string):string { return value.replace(/[\\.*+?^$()|[\]{}]/g,"\\$&").replace(/"/g,'\\"'); }
async function cellarSparql(query:string):Promise<SparqlRow[]> {
  const url=new URL("https://publications.europa.eu/webapi/rdf/sparql"); url.searchParams.set("query",query); url.searchParams.set("format","application/sparql-results+json");
  const response=await fetch(url,{headers:{Accept:"application/sparql-results+json","User-Agent":"WILLY-AI-Juridico/1.0"},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`CELLAR respondió ${response.status}.`);
  const json=await response.json() as {results?:{bindings?:SparqlRow[]}}; return Array.isArray(json.results?.bindings)?json.results!.bindings!:[];
}
export async function searchEuCaseLaw(query:string,limit=10):Promise<EuLegalResult[]> {
  const terms=legalTerms(query).slice(0,4); if(!terms.length)return[]; const pattern=terms.map(escapeSparqlRegex).join(".*").toLowerCase();
  const rows=await cellarSparql(`PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?w ?ecli ?title ?datedoc WHERE {
 ?w cdm:case-law_ecli ?ecli .
 OPTIONAL { ?w cdm:work_date_document ?datedoc . }
 ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/SPA> ; cdm:expression_title ?title .
 FILTER(regex(lcase(str(?title)),"${pattern}","i"))
} ORDER BY DESC(?datedoc) LIMIT ${Math.max(1,Math.min(25,limit))}`);
  return rows.map((row,i)=>{const ecli=s(row.ecli?.value),w=s(row.w?.value),id=ecli||w.split("/").pop()||`EU-CASE-${i+1}`;return {id,title:s(row.title?.value)||id,...(ecli?{ecli}:{}),...(s(row.datedoc?.value)?{date:s(row.datedoc?.value)}:{}),type:"case-law" as const,url:ecli?`https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=${encodeURIComponent(ecli)}`:w};});
}
export async function searchEuLegislation(query:string,limit=10):Promise<EuLegalResult[]> {
  const terms=legalTerms(query).slice(0,4); if(!terms.length)return[]; const pattern=terms.map(escapeSparqlRegex).join(".*").toLowerCase();
  const rows=await cellarSparql(`PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
PREFIX owl:<http://www.w3.org/2002/07/owl#>
SELECT DISTINCT ?w ?celex ?title ?datedoc WHERE {
 ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/SPA> ; cdm:expression_title ?title .
 OPTIONAL { ?w owl:sameAs ?celex . FILTER(regex(str(?celex),"/celex/")) }
 OPTIONAL { ?w cdm:work_date_document ?datedoc . }
 FILTER NOT EXISTS { ?w cdm:case-law_ecli ?ecli . }
 FILTER(regex(lcase(str(?title)),"${pattern}","i"))
} ORDER BY DESC(?datedoc) LIMIT ${Math.max(1,Math.min(25,limit))}`);
  return rows.map((row,i)=>{const w=s(row.w?.value),uri=s(row.celex?.value),celex=uri.includes("/celex/")?uri.split("/celex/")[1]:"",id=celex||w.split("/").pop()||`EU-LAW-${i+1}`;return {id,title:s(row.title?.value)||id,...(s(row.datedoc?.value)?{date:s(row.datedoc?.value)}:{}),type:"legislation" as const,url:celex?`https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:${encodeURIComponent(celex)}`:w};});
}
export async function getEuDocumentByCelex(celex:string):Promise<{celex:string;text:string;url:string}> {
  const safe=celex.trim().toUpperCase(); if(!/^[0-9A-Z()_-]{5,40}$/.test(safe)) throw new Error("Identificador CELEX no válido.");
  const resource=`https://publications.europa.eu/resource/celex/${encodeURIComponent(safe)}?language=es`;
  const response=await fetch(resource,{headers:{Accept:"application/xhtml+xml, application/xml;q=0.9, text/html;q=0.8","Accept-Language":"spa","User-Agent":"WILLY-AI-Juridico/1.0"},redirect:"follow",signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`CELLAR respondió ${response.status}.`);
  return {celex:safe,text:stripHtml(await response.text()).slice(0,120000),url:`https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:${encodeURIComponent(safe)}`};
}

export async function getBoeDailySummary(date:string,borme=false):Promise<unknown>{
  const safe=date.replace(/[^0-9]/g,"");if(!/^\d{8}$/.test(safe))throw new Error("Fecha no válida; usa AAAAMMDD.");
  const kind=borme?"borme":"boe";const response=await fetch(`https://www.boe.es/datosabiertos/api/${kind}/sumario/${safe}`,{headers:{Accept:"application/json","User-Agent":"WILLY-AI-Juridico/1.0"},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`${kind.toUpperCase()} respondió ${response.status}.`);return response.json();
}
export async function getBoeAuxTable(name:string):Promise<unknown>{
  const allowed=new Set(["materias","ambitos","estados-consolidacion","departamentos","rangos","relaciones-anteriores","relaciones-posteriores"]);if(!allowed.has(name))throw new Error("Tabla auxiliar BOE no permitida.");
  const response=await fetch(`https://www.boe.es/datosabiertos/api/datos-auxiliares/${name}`,{headers:{Accept:"application/json","User-Agent":"WILLY-AI-Juridico/1.0"},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`BOE respondió ${response.status}.`);return response.json();
}

export function officialLegalLinks(query:string){
  const q=encodeURIComponent(query.trim().slice(0,300));
  return [
    {id:"boe",name:"BOE · Legislación",kind:"legislación",url:"https://www.boe.es/buscar/legislacion.php",note:"Fuente oficial estatal."},
    {id:"boja",name:"BOJA · Andalucía",kind:"legislación autonómica",url:"https://www.juntadeandalucia.es/eboja.html",note:"Boletín Oficial de la Junta de Andalucía."},
    {id:"cendoj",name:"CENDOJ · Jurisprudencia",kind:"jurisprudencia",url:"https://www.poderjudicial.es/search/indexAN.jsp",note:"TS, AN, TSJ, Audiencias Provinciales y otros órganos."},
    {id:"tsja",name:"TSJ de Andalucía",kind:"jurisprudencia Andalucía",url:"https://www.poderjudicial.es/search/indexAN.jsp",note:"Filtra por Tribunal Superior de Justicia de Andalucía."},
    {id:"apsevilla",name:"Audiencia Provincial de Sevilla",kind:"jurisprudencia Andalucía",url:"https://www.poderjudicial.es/search/indexAN.jsp",note:"Filtra por AP Sevilla."},
    {id:"apmalaga",name:"Audiencia Provincial de Málaga",kind:"jurisprudencia Andalucía",url:"https://www.poderjudicial.es/search/indexAN.jsp",note:"Filtra por AP Málaga."},
    {id:"tc",name:"Tribunal Constitucional",kind:"constitucional",url:"https://hj.tribunalconstitucional.es/",note:"Jurisprudencia constitucional oficial."},
    {id:"eurlex",name:"EUR-Lex",kind:"UE",url:`https://eur-lex.europa.eu/search.html?scope=EURLEX&text=${q}&lang=es&type=quick`,note:"Derecho UE y DOUE."},
    {id:"curia",name:"InfoCuria",kind:"jurisprudencia UE",url:"https://juris.curia.europa.eu/juris/recherche.jsf?language=es",note:"TJUE y Tribunal General."},
    {id:"hudoc",name:"HUDOC · TEDH",kind:"CEDH",url:"https://hudoc.echr.coe.int/",note:"Jurisprudencia oficial TEDH."},
    {id:"aepd",name:"AEPD",kind:"protección de datos",url:`https://www.aepd.es/buscador?search=${q}`,note:"Resoluciones y criterios AEPD."},
  ];
}

function juridicoDir():string{return nodePath.join(process.env["WILLY_ROOT"]??process.cwd(),"datos-privados","juridico");}
export async function loadLegalCases():Promise<unknown[]>{try{const raw=await fs.readFile(nodePath.join(juridicoDir(),"casos.json"),"utf8");const parsed=JSON.parse(raw) as unknown;return Array.isArray(parsed)?parsed:[];}catch{return[];}}
export async function saveLegalCases(cases:unknown):Promise<{count:number;bytes:number}>{
  if(!Array.isArray(cases))throw new Error("Formato de expedientes no válido.");if(cases.length>200)throw new Error("Demasiados expedientes.");
  const data=JSON.stringify(cases,null,2),bytes=Buffer.byteLength(data,"utf8");if(bytes>80*1024*1024)throw new Error("Los expedientes superan 80 MB.");
  const dir=juridicoDir();await fs.mkdir(dir,{recursive:true});const file=nodePath.join(dir,"casos.json"),tmp=file+".tmp";await fs.writeFile(tmp,data,{encoding:"utf8",mode:0o600});await fs.rename(tmp,file);return{count:cases.length,bytes};
}
export function legalServerStatus(){
  return {
    checkedAt:new Date().toISOString(),
    freeApis:[
      {id:"boe-law",name:"BOE Legislación consolidada",auth:"sin clave",active:true},
      {id:"boe-daily",name:"BOE Sumario",auth:"sin clave",active:true},
      {id:"borme",name:"BORME Sumario",auth:"sin clave",active:true},
      {id:"boja",name:"BOJA API REST",auth:"sin clave",active:true},
      {id:"cellar-sparql",name:"CELLAR SPARQL",auth:"sin clave",active:true},
      {id:"cellar-rest",name:"CELLAR CELEX",auth:"sin clave",active:true},
      {id:"eurlex-soap",name:"EUR-Lex Webservice SOAP",auth:"EU Login gratuito",active:false},
    ],
    publicOfficialSearches:["CENDOJ","Tribunal Constitucional","InfoCuria","HUDOC","AEPD"],
    storageHint:juridicoDir(),
  };
}
