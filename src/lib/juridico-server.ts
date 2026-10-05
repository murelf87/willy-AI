import nodePath from "node:path";
import { promises as fs } from "node:fs";



export type EuLegalResult = {
  id: string;
  title: string;
  ecli?: string;
  date?: string;
  type: "legislation" | "case-law";
  url: string;
};

type SparqlBinding = { value?: string };
type SparqlRow = Record<string, SparqlBinding>;

function escapeSparqlRegex(value: string): string {
  return value.replace(/[\\.*+?^$()|[\]{}]/g, "\\$&").replace(/"/g, '\\"');
}

async function cellarSparql(query: string): Promise<SparqlRow[]> {
  const url = new URL("https://publications.europa.eu/webapi/rdf/sparql");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "application/sparql-results+json");
  const response = await fetch(url, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": "WILLY-AI-Juridico/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`CELLAR respondió ${response.status}.`);
  const json = await response.json() as { results?: { bindings?: SparqlRow[] } };
  return Array.isArray(json.results?.bindings) ? json.results!.bindings! : [];
}

export async function searchEuCaseLaw(query: string, limit = 10): Promise<EuLegalResult[]> {
  const terms = legalTerms(query).slice(0, 4);
  if (!terms.length) return [];
  const pattern = terms.map(escapeSparqlRegex).join(".*");
  const sparql = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?w ?ecli ?title ?datedoc
WHERE {
  ?w a ?class .
  FILTER(?class IN (
    <http://publications.europa.eu/ontology/cdm#document_cjeu>,
    <http://publications.europa.eu/ontology/cdm#court-report>,
    <http://publications.europa.eu/ontology/cdm#case-law>,
    <http://publications.europa.eu/ontology/cdm#summary_case-law>,
    <http://publications.europa.eu/ontology/cdm#summary_case-law_jure>
  ))
  OPTIONAL { ?w cdm:case-law_ecli ?ecli . }
  OPTIONAL { ?w cdm:date_creation_legacy ?datedoc . }
  ?e cdm:expression_belongs_to_work ?w ;
     cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/SPA> ;
     cdm:expression_title ?title .
  FILTER(regex(lcase(str(?title)), "${pattern.toLowerCase()}", "i"))
}
ORDER BY DESC(?datedoc)
LIMIT ${Math.max(1, Math.min(25, limit))}
`;
  const rows = await cellarSparql(sparql);
  return rows.map((row, index) => {
    const work = s(row["w"]?.value);
    const ecli = s(row["ecli"]?.value);
    const id = ecli || work.split("/").pop() || `EU-CASE-${index + 1}`;
    return {
      id,
      title: s(row["title"]?.value) || id,
      ...(ecli ? { ecli } : {}),
      ...(s(row["datedoc"]?.value) ? { date: s(row["datedoc"]?.value) } : {}),
      type: "case-law" as const,
      url: ecli ? `https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=${encodeURIComponent(ecli)}` : work,
    };
  }).filter((item) => item.title);
}

export async function searchEuLegislation(query: string, limit = 10): Promise<EuLegalResult[]> {
  const terms = legalTerms(query).slice(0, 4);
  if (!terms.length) return [];
  const pattern = terms.map(escapeSparqlRegex).join(".*");
  const sparql = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT DISTINCT ?w ?celex ?title ?datedoc
WHERE {
  ?w a ?class .
  FILTER(?class IN (
    <http://publications.europa.eu/ontology/cdm#resource_legal>,
    <http://publications.europa.eu/ontology/cdm#act_legislative>,
    <http://publications.europa.eu/ontology/cdm#act_other>,
    <http://publications.europa.eu/ontology/cdm#directive>,
    <http://publications.europa.eu/ontology/cdm#regulation>
  ))
  OPTIONAL { ?w owl:sameAs ?celex . FILTER(regex(str(?celex), "/celex/")) }
  OPTIONAL { ?w cdm:work_date_document ?datedoc . }
  ?e cdm:expression_belongs_to_work ?w ;
     cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/SPA> ;
     cdm:expression_title ?title .
  FILTER(regex(lcase(str(?title)), "${pattern.toLowerCase()}", "i"))
}
ORDER BY DESC(?datedoc)
LIMIT ${Math.max(1, Math.min(25, limit))}
`;
  const rows = await cellarSparql(sparql);
  return rows.map((row, index) => {
    const work = s(row["w"]?.value);
    const celexUri = s(row["celex"]?.value);
    const celex = celexUri.includes("/celex/") ? celexUri.split("/celex/")[1] : "";
    const id = celex || work.split("/").pop() || `EU-LAW-${index + 1}`;
    return {
      id,
      title: s(row["title"]?.value) || id,
      ...(s(row["datedoc"]?.value) ? { date: s(row["datedoc"]?.value) } : {}),
      type: "legislation" as const,
      url: celex ? `https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:${encodeURIComponent(celex)}` : work,
    };
  }).filter((item) => item.title);
}

export async function getEuDocumentByCelex(celex: string): Promise<{ celex: string; text: string; url: string }> {
  const safe = celex.trim().toUpperCase();
  if (!/^[0-9A-Z()_-]{5,40}$/.test(safe)) throw new Error("Identificador CELEX no válido.");
  const resource = `https://publications.europa.eu/resource/celex/${encodeURIComponent(safe)}?language=es`;
  const response = await fetch(resource, {
    headers: {
      Accept: "application/xhtml+xml, application/xml;q=0.9, text/html;q=0.8",
      "Accept-Language": "spa",
      "User-Agent": "WILLY-AI-Juridico/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`CELLAR respondió ${response.status}.`);
  const raw = await response.text();
  const text = raw
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>|<\/article>|<\/div>|<\/title>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { celex: safe, text: text.slice(0, 120_000), url: `https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:${encodeURIComponent(safe)}` };
}

export async function getBoeDailySummary(date: string, borme = false): Promise<unknown> {
  const safe = date.replace(/[^0-9]/g, "");
  if (!/^\d{8}$/.test(safe)) throw new Error("Fecha no válida; usa AAAAMMDD.");
  const kind = borme ? "borme" : "boe";
  const response = await fetch(`https://www.boe.es/datosabiertos/api/${kind}/sumario/${safe}`, {
    headers: { Accept: "application/json", "User-Agent": "WILLY-AI-Juridico/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${kind.toUpperCase()} respondió ${response.status}.`);
  return response.json();
}

export async function getBoeAuxTable(name: string): Promise<unknown> {
  const allowed = new Set(["materias", "ambitos", "estados-consolidacion", "departamentos", "rangos", "relaciones-anteriores", "relaciones-posteriores"]);
  if (!allowed.has(name)) throw new Error("Tabla auxiliar BOE no permitida.");
  const response = await fetch(`https://www.boe.es/datosabiertos/api/datos-auxiliares/${name}`, {
    headers: { Accept: "application/json", "User-Agent": "WILLY-AI-Juridico/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BOE respondió ${response.status}.`);
  return response.json();
}

export type BojaLegalResult = {
  id: string;
  date: string;
  organisation: string;
  section: string;
  summary: string;
  number: string;
  url: string;
};

type BojaRaw = {
  id?: unknown;
  number?: unknown;
  date?: unknown;
  titleSec?: unknown;
  organisation?: unknown;
  summaryNoHtml?: unknown;
  bodyNoHtml?: unknown;
  pdf?: Array<{ publicUrl?: unknown }>;
};

export async function searchBoja(query: string, limit = 8): Promise<BojaLegalResult[]> {
  const clean = query.trim().slice(0, 400);
  if (!clean) return [];
  const url = new URL("https://datos.juntadeandalucia.es/api/v0/boja/get/search_pagination");
  url.searchParams.set("order_by", "date");
  url.searchParams.set("mode", "DESC");
  url.searchParams.set("size", String(Math.max(1, Math.min(20, limit))));
  url.searchParams.set("page", "0");
  url.searchParams.set("general", clean);
  url.searchParams.set("general_search_like", "true");
  for (const field of ["id","organisation","summaryNoHtml","number","date","titleSec","publicUrl"]) url.searchParams.append("campos", field);
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "WILLY-AI-Juridico/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BOJA respondió ${response.status}.`);
  const json = await response.json() as { results?: BojaRaw[] };
  return (json.results ?? []).map((item) => ({
    id: s(item.id),
    date: s(item.date),
    organisation: s(item.organisation),
    section: s(item.titleSec),
    summary: s(item.summaryNoHtml),
    number: String(item.number ?? ""),
    url: s(item.pdf?.[0]?.publicUrl) || (s(item.id) ? `https://juntadeandalucia.es/eboja/` : "https://juntadeandalucia.es/eboja/"),
  })).filter((item) => item.id && item.summary);
}

export async function getBojaText(id: string): Promise<{ id: string; summary: string; body: string; url: string }> {
  const safe = id.trim();
  if (!/^disposition\.\d{4}\.\d+\.\d+$/i.test(safe)) throw new Error("Identificador BOJA no válido.");
  const response = await fetch(`https://datos.juntadeandalucia.es/api/v0/boja/${encodeURIComponent(safe)}`, {
    headers: { Accept: "application/json", "User-Agent": "WILLY-AI-Juridico/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`BOJA respondió ${response.status}.`);
  const json = await response.json() as { results?: BojaRaw[] };
  const item = json.results?.[0];
  if (!item) throw new Error("La disposición BOJA no existe.");
  return {
    id: safe,
    summary: s(item.summaryNoHtml),
    body: s(item.bodyNoHtml).slice(0, 140_000),
    url: s(item.pdf?.[0]?.publicUrl) || "https://juntadeandalucia.es/eboja/",
  };
}

export type LegalSourceDescriptor = {
  id: string;
  name: string;
  authority: string;
  scope: string;
  access: "api" | "open-data" | "search" | "portal";
  automatic: boolean;
  free: boolean;
  url: string;
  note: string;
};

export function legalSourceCatalog(): LegalSourceDescriptor[] {
  return [
    { id:"boe-consolidada", name:"BOE · Legislación consolidada", authority:"Agencia Estatal BOE", scope:"España", access:"api", automatic:true, free:true, url:"https://www.boe.es/datosabiertos/api/legislacion-consolidada", note:"Búsqueda, metadatos y texto consolidado. Contrastar siempre la publicación oficial." },
    { id:"boe-diario", name:"BOE · Diario oficial", authority:"Agencia Estatal BOE", scope:"España", access:"api", automatic:true, free:true, url:"https://www.boe.es/datosabiertos/", note:"Sumarios y datos abiertos diarios." },
    { id:"borme", name:"BORME", authority:"Agencia Estatal BOE", scope:"España · mercantil", access:"api", automatic:true, free:true, url:"https://www.boe.es/datosabiertos/", note:"Sumarios mercantiles diarios." },
    { id:"boja", name:"BOJA · Disposiciones", authority:"Junta de Andalucía", scope:"Andalucía", access:"api", automatic:true, free:true, url:"https://datos.juntadeandalucia.es/api/v0/boja/openapi.json", note:"OpenAPI REST: búsqueda, detalle, boletines, calendario y valores auxiliares." },
    { id:"cellar", name:"CELLAR / Publications Office", authority:"Unión Europea", scope:"UE", access:"api", automatic:true, free:true, url:"https://op.europa.eu/en/web/about-us/legal-notices/accessibility-statement", note:"REST/SPARQL para recursos jurídicos y metadatos de la UE." },
    { id:"eurlex-ws", name:"EUR-Lex Webservice", authority:"Unión Europea", scope:"UE", access:"api", automatic:false, free:true, url:"https://eur-lex.europa.eu/content/help/data-reuse/webservice.html", note:"Servicio gratuito con registro previo; preparado para añadir credenciales si el usuario las obtiene." },
    { id:"congreso", name:"Congreso · Datos abiertos", authority:"Congreso de los Diputados", scope:"España · parlamentario", access:"open-data", automatic:false, free:true, url:"https://www.congreso.es/es/opendata", note:"CSV/JSON/XML de iniciativas, intervenciones y actividad parlamentaria." },
    { id:"senado", name:"Senado · Datos abiertos", authority:"Senado de España", scope:"España · parlamentario", access:"open-data", automatic:false, free:true, url:"https://www.senado.es/web/relacionesciudadanos/datosabiertos/index.html", note:"XML reutilizable de iniciativas, votaciones, sesiones y composición." },
    { id:"aepd", name:"AEPD · Datos abiertos", authority:"Agencia Española de Protección de Datos", scope:"España · privacidad", access:"open-data", automatic:false, free:true, url:"https://www.aepd.es/la-agencia/datos-abiertos", note:"Informes jurídicos y conjuntos documentales abiertos." },
    { id:"cgpj", name:"CGPJ · Consejo General del Poder Judicial", authority:"Consejo General del Poder Judicial", scope:"España · información institucional", access:"portal", automatic:false, free:true, url:"https://www.poderjudicial.es/", note:"Consulta del portal oficial. Los documentos institucionales no equivalen a sentencias; verifica el documento original antes de citarlo. Sin recuperación automática integrada." },
    { id:"cendoj", name:"CENDOJ", authority:"CGPJ", scope:"España · jurisprudencia", access:"search", automatic:false, free:true, url:"https://www.poderjudicial.es/search/indexAN.jsp", note:"Buscador oficial; no se asume una API pública no documentada." },
    { id:"tc", name:"Tribunal Constitucional", authority:"Tribunal Constitucional", scope:"España · constitucional", access:"search", automatic:false, free:true, url:"https://hj.tribunalconstitucional.es/", note:"Buscador oficial de jurisprudencia constitucional." },
    { id:"curia", name:"InfoCuria", authority:"Tribunal de Justicia de la UE", scope:"UE · jurisprudencia", access:"search", automatic:false, free:true, url:"https://juris.curia.europa.eu/juris/recherche.jsf?language=es", note:"Buscador oficial TJUE/TG." },
    { id:"hudoc", name:"HUDOC", authority:"Tribunal Europeo de Derechos Humanos", scope:"CEDH", access:"search", automatic:false, free:true, url:"https://hudoc.echr.coe.int/", note:"Base oficial de jurisprudencia TEDH." },
  ];
}

export type BoeLegalResult = {
  id: string;
  title: string;
  rank: string;
  number: string;
  department: string;
  publicationDate: string;
  effectiveDate: string;
  exhausted: boolean;
  consolidatedState: string;
  url: string;
  eli?: string;
};

type BoeRaw = {
  identificador?: unknown;
  titulo?: unknown;
  rango?: { texto?: unknown } | unknown;
  numero_oficial?: unknown;
  departamento?: { texto?: unknown } | unknown;
  fecha_publicacion?: unknown;
  fecha_vigencia?: unknown;
  vigencia_agotada?: unknown;
  estado_consolidacion?: { texto?: unknown } | unknown;
  url_html_consolidada?: unknown;
  url_eli?: unknown;
};

const s = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nestedText = (value: unknown) => value && typeof value === "object" && "texto" in value ? s((value as { texto?: unknown }).texto) : s(value);

function legalTerms(query: string): string[] {
  const stop = new Set(["para","como","este","esta","estos","estas","desde","hasta","sobre","segun","según","analiza","analizar","caso","documento","documentos","derecho","legal","juridico","jurídico","puede","puedo","quiero","necesito","contra","entre","porque","donde","cuando","cual","cuál","unos","unas","del","las","los","una","uno","que","por","con","sin","sus","mis","son","hay","más","mas"]);
  const words = query.toLowerCase().normalize("NFC").match(/[a-záéíóúüñ0-9]{3,}/giu) ?? [];
  const unique: string[] = [];
  for (const word of words) { if (!stop.has(word) && !unique.includes(word)) unique.push(word); }
  return unique.slice(0, 7);
}

function boeQuery(query: string): string {
  const terms = legalTerms(query);
  const condition = terms.length ? terms.map((term) => `texto:${term}`).join(" and ") : `texto:${query.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).slice(0, 5).join(" and texto:")}`;
  return JSON.stringify({ query: { query_string: { query: condition }, range: {} }, sort: [{ fecha_publicacion: "desc" }] });
}

export async function searchBoeLegislation(query: string, limit = 8): Promise<BoeLegalResult[]> {
  const clean = query.trim().slice(0, 500);
  if (!clean) return [];
  const url = new URL("https://www.boe.es/datosabiertos/api/legislacion-consolidada");
  url.searchParams.set("query", boeQuery(clean));
  url.searchParams.set("limit", String(Math.max(1, Math.min(15, limit))));
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "WILLY-AI-Juridico/1.0" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`BOE respondió ${response.status}.`);
  const json = await response.json() as { data?: unknown };
  const data = Array.isArray(json.data) ? json.data : [];
  return (data as BoeRaw[]).map((item) => ({
    id: s(item.identificador),
    title: s(item.titulo),
    rank: nestedText(item.rango),
    number: s(item.numero_oficial),
    department: nestedText(item.departamento),
    publicationDate: s(item.fecha_publicacion),
    effectiveDate: s(item.fecha_vigencia),
    exhausted: s(item.vigencia_agotada).toUpperCase() === "S",
    consolidatedState: nestedText(item.estado_consolidacion),
    url: s(item.url_html_consolidada) || (s(item.identificador) ? `https://www.boe.es/buscar/act.php?id=${encodeURIComponent(s(item.identificador))}` : "https://www.boe.es/"),
    ...(s(item.url_eli) ? { eli: s(item.url_eli) } : {}),
  })).filter((item) => item.id && item.title);
}

export async function getBoeLegislationText(id: string): Promise<{ id: string; text: string; url: string }> {
  const safe = id.trim();
  if (!/^BOE-[A-Z]-\d{4}-\d+$/i.test(safe)) throw new Error("Identificador BOE no válido.");
  const url = `https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/${encodeURIComponent(safe)}/texto`;
  const response = await fetch(url, { headers: { Accept: "application/xml", "User-Agent": "WILLY-AI-Juridico/1.0" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`BOE respondió ${response.status}.`);
  const xml = await response.text();
  const text = xml
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>|<\/articulo>|<\/bloque>|<\/titulo>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { id: safe, text: text.slice(0, 120_000), url: `https://www.boe.es/buscar/act.php?id=${encodeURIComponent(safe)}` };
}

export function officialLegalLinks(query: string) {
  const q = encodeURIComponent(query.trim().slice(0, 300));
  return [
    { id: "boe", name: "BOE · Legislación consolidada", kind: "legislación", url: "https://www.boe.es/buscar/legislacion.php", note: "Fuente oficial estatal. El texto consolidado es informativo; contrasta la publicación oficial." },
    { id: "cgpj", name: "Consejo General del Poder Judicial", kind: "institucional", url: "https://www.poderjudicial.es/", note: "Portal oficial del CGPJ. Consulta manual; no implica que WILLY haya recuperado o verificado sus documentos." },
    { id: "cendoj", name: "CENDOJ · Jurisprudencia", kind: "jurisprudencia", url: "https://www.poderjudicial.es/search/indexAN.jsp", note: "Buscador oficial del CGPJ para resoluciones judiciales españolas." },
    { id: "tc", name: "Tribunal Constitucional", kind: "jurisprudencia", url: "https://hj.tribunalconstitucional.es/", note: "Buscador oficial de jurisprudencia constitucional." },
    { id: "eurlex", name: "EUR-Lex", kind: "UE", url: `https://eur-lex.europa.eu/search.html?scope=EURLEX&text=${q}&lang=es&type=quick`, note: "Derecho de la Unión Europea y Diario Oficial." },
    { id: "curia", name: "InfoCuria · TJUE", kind: "jurisprudencia UE", url: "https://juris.curia.europa.eu/juris/recherche.jsf?language=es", note: "Jurisprudencia oficial del Tribunal de Justicia y Tribunal General." },
    { id: "hudoc", name: "HUDOC · TEDH", kind: "derechos humanos", url: "https://hudoc.echr.coe.int/", note: "Base oficial de jurisprudencia del Tribunal Europeo de Derechos Humanos." },
    { id: "aepd", name: "AEPD", kind: "protección de datos", url: `https://www.aepd.es/buscador?search=${q}`, note: "Resoluciones, guías y criterios de la autoridad española de protección de datos." },
  ];
}

function juridicoDir(): string {
  return nodePath.join(process.env["WILLY_ROOT"] ?? process.cwd(), "datos-privados", "juridico");
}

export async function loadLegalCases(): Promise<unknown[]> {
  try {
    const raw = await fs.readFile(nodePath.join(juridicoDir(), "casos.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLegalCases(cases: unknown): Promise<{ count: number; bytes: number }> {
  if (!Array.isArray(cases)) throw new Error("Formato de expedientes no válido.");
  if (cases.length > 200) throw new Error("Demasiados expedientes.");
  const data = JSON.stringify(cases, null, 2);
  const bytes = Buffer.byteLength(data, "utf8");
  if (bytes > 80 * 1024 * 1024) throw new Error("El archivo de expedientes supera 80 MB. Exporta o divide el expediente.");
  const dir = juridicoDir();
  await fs.mkdir(dir, { recursive: true });
  const file = nodePath.join(dir, "casos.json");
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, data, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
  return { count: cases.length, bytes };
}

export function legalServerStatus() {
  return {
    checkedAt: new Date().toISOString(),
    officialSources: ["BOE", "BORME", "BOJA", "CELLAR/EUR-Lex", "Congreso", "Senado", "CGPJ", "CENDOJ", "Tribunal Constitucional", "InfoCuria", "HUDOC", "AEPD"],
    freeApis: [
      { id: "boe-law", name: "BOE Legislación consolidada", auth: "sin clave", active: true, endpoint: "https://www.boe.es/datosabiertos/api/legislacion-consolidada" },
      { id: "boe-daily", name: "BOE Sumario diario", auth: "sin clave", active: true, endpoint: "https://www.boe.es/datosabiertos/api/boe/sumario/{fecha}" },
      { id: "borme", name: "BORME Sumario diario", auth: "sin clave", active: true, endpoint: "https://www.boe.es/datosabiertos/api/borme/sumario/{fecha}" },
      { id: "boe-aux", name: "BOE Datos auxiliares", auth: "sin clave", active: true, endpoint: "https://www.boe.es/datosabiertos/api/datos-auxiliares" },
      { id: "boja", name: "BOJA OpenAPI REST", auth: "sin clave", active: true, endpoint: "https://datos.juntadeandalucia.es/api/v0/boja/openapi.json" },
      { id: "cellar-sparql", name: "CELLAR SPARQL", auth: "sin clave", active: true, endpoint: "https://publications.europa.eu/webapi/rdf/sparql" },
      { id: "cellar-rest", name: "CELLAR REST/CELEX", auth: "sin clave", active: true, endpoint: "https://publications.europa.eu/resource/celex/{CELEX}" },
      { id: "eurlex-soap", name: "EUR-Lex Webservice SOAP", auth: "registro gratuito EU Login", active: false, endpoint: "https://eur-lex.europa.eu/content/help/data-reuse/webservice.html" },
    ],
    publicOfficialPortals: [{ id: "cgpj", name: "Consejo General del Poder Judicial", url: "https://www.poderjudicial.es/", api: false, automatic: false }],
    publicOfficialSearches: [
      { id: "cendoj", name: "CENDOJ", api: false },
      { id: "tc", name: "Tribunal Constitucional", api: false },
      { id: "curia", name: "InfoCuria", api: false },
      { id: "hudoc", name: "HUDOC", api: false },
      { id: "aepd", name: "AEPD Datos Abiertos", api: false },
    ],
    storageHint: juridicoDir(),
  };
}
