import nodePath from "node:path";
import { promises as fs } from "node:fs";
import * as https from "node:https";



const OFFICIAL_LEGAL_HOSTS = new Set([
  "www.poderjudicial.es", "poderjudicial.es",
  "hj.tribunalconstitucional.es", "www.tribunalconstitucional.es", "tribunalconstitucional.es",
  "juris.curia.europa.eu", "curia.europa.eu",
  "eur-lex.europa.eu",
  "hudoc.echr.coe.int",
  "www.boe.es", "boe.es",
  "www.juntadeandalucia.es", "juntadeandalucia.es",
  "ws050.juntadeandalucia.es", "desarrollo.juntadeandalucia.es",
]);

function decodeBasicHtml(text: string): string {
  return text
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|article|section|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


type NativeHttpsResult = { url: string; status: number; contentType: string; body: Uint8Array };

async function nativeHttpsGet(rawUrl: string, redirects = 0): Promise<NativeHttpsResult> {
  if (redirects > 5) throw new Error("Demasiadas redirecciones en la fuente oficial.");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !OFFICIAL_LEGAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Redirección fuera de un dominio jurídico oficial autorizado.");
  }
  return new Promise<NativeHttpsResult>((resolve, reject) => {
    const req = https.get(url, {
      family: 4,
      headers: {
        "User-Agent": "WILLY-AI-Juridico/1.0",
        Accept: "application/pdf,text/html,application/xhtml+xml,*/*;q=0.8",
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === "string" ? new URL(res.headers.location, url).toString() : "";
      if (status >= 300 && status < 400 && location) {
        res.resume();
        void nativeHttpsGet(location, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error("La fuente oficial respondió " + status + "."));
        return;
      }
      const declared = Number(res.headers["content-length"] || "0");
      if (declared > 20 * 1024 * 1024) {
        res.destroy();
        reject(new Error("La resolución supera 20 MB."));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > 20 * 1024 * 1024) {
          res.destroy(new Error("La resolución supera 20 MB."));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({
          url: url.toString(),
          status,
          contentType: String(res.headers["content-type"] || "").toLowerCase(),
          body: new Uint8Array(body),
        });
      });
      res.on("error", reject);
    });
    req.setTimeout(25_000, () => req.destroy(new Error("Tiempo de espera agotado al leer la fuente oficial.")));
    req.on("error", reject);
  });
}

async function extractPdfServer(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes, useWorkerFetch: false });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    for (let pageNo = 1; pageNo <= Math.min(doc.numPages, 300); pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? String(item.str) : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pages.push("--- Página " + pageNo + " ---\n" + text);
      if (pages.join("\n").length > 180_000) break;
    }
  } finally {
    await doc.cleanup();
    await task.destroy();
  }
  return pages.join("\n\n").slice(0, 180_000);
}

export async function fetchOfficialLegalDocument(rawUrl: string): Promise<{ url: string; title: string; text: string; host: string; verified: true }> {
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { throw new Error("URL oficial no válida."); }
  if (url.protocol !== "https:" || !OFFICIAL_LEGAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Solo se admiten URLs HTTPS de fuentes jurídicas oficiales autorizadas (CGPJ/CENDOJ, TC, TJUE/EUR-Lex, TEDH o BOE).");
  }

  let finalUrl = url;
  let contentType = "";
  let bytes: Uint8Array;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "WILLY-AI-Juridico/1.0", Accept: "application/pdf,text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: AbortSignal.timeout(18_000),
    });
    if (!response.ok) throw new Error("La fuente oficial respondió " + response.status + ".");
    finalUrl = new URL(response.url);
    if (!OFFICIAL_LEGAL_HOSTS.has(finalUrl.hostname.toLowerCase())) throw new Error("La fuente redirigió fuera de un dominio oficial autorizado.");
    const length = Number(response.headers.get("content-length") || "0");
    if (length > 20 * 1024 * 1024) throw new Error("La resolución supera 20 MB.");
    contentType = (response.headers.get("content-type") || "").toLowerCase();
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    const fallback = await nativeHttpsGet(url.toString());
    finalUrl = new URL(fallback.url);
    contentType = fallback.contentType;
    bytes = fallback.body;
  }

  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("La resolución supera 20 MB.");
  let text = "";
  let title = finalUrl.pathname.split("/").pop() || "Resolución oficial";
  if (contentType.includes("pdf") || finalUrl.pathname.toLowerCase().endsWith(".pdf")) {
    text = await extractPdfServer(bytes);
  } else {
    const html = new TextDecoder("utf-8").decode(bytes);
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (match?.[1]) title = decodeBasicHtml(match[1]).slice(0, 240) || title;
    text = decodeBasicHtml(html).slice(0, 180_000);
  }
  if (text.trim().length < 80) throw new Error("No se pudo extraer texto suficiente de la resolución oficial.");
  return { url: finalUrl.toString(), title, text, host: finalUrl.hostname, verified: true };
}

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
  tier?: "fuente-primaria" | "jurisprudencia" | "doctrina-oficial" | "biblioteca-profesional";
  topics?: string[];
};

export function legalSourceCatalog(): LegalSourceDescriptor[] {
  return [
    { id:"boe-consolidada", name:"BOE · Legislación consolidada", authority:"Agencia Estatal BOE", scope:"España", access:"api", automatic:true, free:true, url:"https://www.boe.es/datosabiertos/api/legislacion-consolidada", note:"Búsqueda, metadatos y texto consolidado. Contrastar siempre la publicación oficial." },
    { id:"boe-diario", name:"BOE · Diario oficial", authority:"Agencia Estatal BOE", scope:"España", access:"api", automatic:true, free:true, url:"https://www.boe.es/datosabiertos/", note:"Sumarios y datos abiertos diarios." },
    { id:"borme", name:"BORME", authority:"Agencia Estatal BOE", scope:"España · mercantil", access:"api", automatic:true, free:true, url:"https://www.boe.es/datosabiertos/", note:"Sumarios mercantiles diarios." },
    { id:"boja", name:"BOJA · Disposiciones", authority:"Junta de Andalucía", scope:"Andalucía", access:"api", automatic:true, free:true, url:"https://datos.juntadeandalucia.es/api/v0/boja/openapi.json", note:"OpenAPI REST: búsqueda, detalle, boletines, calendario y valores auxiliares." },
    { id:"hcv-junta", name:"HCV · Verificación CSV", authority:"Junta de Andalucía · Agencia Digital de Andalucía", scope:"Andalucía · autenticidad documental", access:"portal", automatic:false, free:true, url:"https://ws050.juntadeandalucia.es/verificarFirma/", note:"Comprueba autenticidad e integridad mediante CSV. La consulta ciudadana exige identificación; ENIDOCWS 2.0 permite automatización solo para clientes/sistemas autorizados.", tier:"fuente-primaria", topics:["CSV","firma electrónica","autenticidad","integridad","documento electrónico"] },
    { id:"cellar", name:"CELLAR / Publications Office", authority:"Unión Europea", scope:"UE", access:"api", automatic:true, free:true, url:"https://op.europa.eu/en/web/about-us/legal-notices/accessibility-statement", note:"REST/SPARQL para recursos jurídicos y metadatos de la UE." },
    { id:"eurlex-ws", name:"EUR-Lex Webservice", authority:"Unión Europea", scope:"UE", access:"api", automatic:false, free:true, url:"https://eur-lex.europa.eu/content/help/data-reuse/webservice.html", note:"Servicio gratuito con registro previo; preparado para añadir credenciales si el usuario las obtiene." },
    { id:"congreso", name:"Congreso · Datos abiertos", authority:"Congreso de los Diputados", scope:"España · parlamentario", access:"open-data", automatic:false, free:true, url:"https://www.congreso.es/es/opendata", note:"CSV/JSON/XML de iniciativas, intervenciones y actividad parlamentaria." },
    { id:"senado", name:"Senado · Datos abiertos", authority:"Senado de España", scope:"España · parlamentario", access:"open-data", automatic:false, free:true, url:"https://www.senado.es/web/relacionesciudadanos/datosabiertos/index.html", note:"XML reutilizable de iniciativas, votaciones, sesiones y composición." },
    { id:"aepd", name:"AEPD · Datos abiertos", authority:"Agencia Española de Protección de Datos", scope:"España · privacidad", access:"open-data", automatic:false, free:true, url:"https://www.aepd.es/la-agencia/datos-abiertos", note:"Informes jurídicos y conjuntos documentales abiertos." },
    { id:"teac", name:"TEAC · DYCTEA", authority:"Tribunal Económico-Administrativo Central", scope:"España · tributario", access:"search", automatic:false, free:true, url:"https://serviciostelematicosext.hacienda.gob.es/TEAC/DYCTEA/", note:"Base oficial de doctrina, criterios y resoluciones económico-administrativas. Consulta pública; verifica siempre la resolución original." },
    { id:"dgt", name:"DGT · Consultas tributarias", authority:"Dirección General de Tributos", scope:"España · tributario", access:"search", automatic:false, free:true, url:"https://petete.tributos.hacienda.gob.es/consultas/", note:"Buscador oficial de consultas generales y vinculantes. La doctrina tributaria debe citarse con número y fecha y distinguirse de jurisprudencia.", tier:"doctrina-oficial", topics:["fiscal","tributario"] },
    { id:"consejo-estado", name:"Consejo de Estado · Dictámenes", authority:"Consejo de Estado / BOE", scope:"España · administrativo", access:"search", automatic:false, free:true, url:"https://www.boe.es/buscar/consejo_estado.php", note:"Base oficial de dictámenes desde 1987. Son criterio consultivo; la propia base advierte de su carácter informativo y no deben presentarse como sentencia.", tier:"doctrina-oficial", topics:["administrativo","responsabilidad patrimonial","reglamentos"] },
    { id:"tacrc", name:"TACRC · Resoluciones", authority:"Tribunal Administrativo Central de Recursos Contractuales", scope:"España · contratación pública", access:"search", automatic:false, free:true, url:"https://www.hacienda.gob.es/es-ES/Areas%20Tematicas/Contratacion/tacrc/paginas/tribunal%20administrativo%20central%20de%20recursos%20contractuales.aspx", note:"Resoluciones públicas del TACRC y acceso a sus procedimientos. Debe distinguirse su doctrina de la jurisprudencia judicial.", tier:"doctrina-oficial", topics:["contratación pública","administrativo"] },
    { id:"fiscalia", name:"Fiscalía General · Doctrina", authority:"Fiscalía General del Estado", scope:"España · penal y procesal", access:"search", automatic:false, free:true, url:"https://www.fiscal.es/", note:"Circulares, Consultas e Instrucciones de la Fiscalía General del Estado. Criterios institucionales relevantes, no equivalentes a jurisprudencia.", tier:"doctrina-oficial", topics:["penal","procesal","menores","violencia"] },
    { id:"defensor", name:"Defensor del Pueblo · Resoluciones", authority:"Defensor del Pueblo", scope:"España · derechos y administración", access:"search", automatic:false, free:true, url:"https://www.defensordelpueblo.es/resoluciones-dp/", note:"Recomendaciones, sugerencias y recordatorios de deberes legales. Útiles como criterio institucional, sin valor de sentencia.", tier:"doctrina-oficial", topics:["administrativo","derechos fundamentales","servicios públicos"] },
    { id:"edpb", name:"EDPB · Directrices y decisiones", authority:"Comité Europeo de Protección de Datos", scope:"UE · privacidad", access:"portal", automatic:false, free:true, url:"https://www.edpb.europa.eu/our-work-tools/our-documents_en", note:"Directrices, recomendaciones y otros documentos oficiales europeos de protección de datos. Contrastar con RGPD, jurisprudencia TJUE y autoridades nacionales.", tier:"doctrina-oficial", topics:["protección de datos","RGPD","UE"] },
    { id:"aranzadi", name:"Aranzadi LA LEY · Bases de datos jurídicas", authority:"Aranzadi LA LEY", scope:"España · legislación, jurisprudencia y doctrina", access:"portal", automatic:false, free:false, url:"https://www.aranzadilaley.es/productos/bases-de-datos-juridicas", note:"Fuente profesional de suscripción. Sus servicios LegalTech contemplan acceso vía API o navegador según contrato/consumo; WILLY no descarga ni reutiliza contenido licenciado sin las credenciales y derechos del cliente." },
    { id:"legalteca", name:"Legalteca · Biblioteca jurídica digital", authority:"Aranzadi LA LEY", scope:"España · doctrina y libros jurídicos", access:"portal", automatic:false, free:false, url:"https://www.aranzadilaley.es/productos/legalteca", note:"Biblioteca profesional de suscripción. Se muestra como acceso documental; cualquier automatización queda condicionada a la licencia contratada." },
    { id:"vlex", name:"vLex Library", authority:"vLex (Clio)", scope:"España e internacional · jurisprudencia, legislación y doctrina", access:"portal", automatic:false, free:false, url:"https://vlex.es/vlex-library", note:"Base jurídica profesional de suscripción con cobertura internacional. WILLY no automatiza contenido licenciado sin una integración autorizada para la cuenta del cliente." },
    { id:"tirant", name:"Tirant Prime / Tirant Online", authority:"Tirant lo Blanch", scope:"España · legislación, jurisprudencia, doctrina y formularios", access:"portal", automatic:false, free:false, url:"https://www.tirantonline.com/", note:"Base jurídica profesional de suscripción. El acceso automático solo se habilitará si Tirant facilita una integración autorizada para la licencia del usuario." },
    { id:"lefebvre", name:"Lefebvre NEO / QMemento", authority:"Lefebvre", scope:"España · legislación, jurisprudencia, doctrina, Mementos y formularios", access:"portal", automatic:false, free:false, url:"https://lefebvre.es/tienda/bases-de-datos-juridicas", note:"Base jurídica profesional con NEO/QMemento y GenIA-L. Se integra solo mediante mecanismos autorizados por la suscripción; no se extrae contenido de pago por scraping." },
    { id:"cgpj", name:"CGPJ · Consejo General del Poder Judicial", authority:"Consejo General del Poder Judicial", scope:"España · información institucional", access:"portal", automatic:false, free:true, url:"https://www.poderjudicial.es/", note:"Consulta del portal oficial. Los documentos institucionales no equivalen a sentencias; verifica el documento original antes de citarlo. Sin recuperación automática integrada." },
    { id:"cendoj", name:"CENDOJ", authority:"CGPJ", scope:"España · jurisprudencia", access:"search", automatic:true, free:true, url:"https://www.poderjudicial.es/search/indexAN.jsp", note:"Buscador oficial integrado mediante su interfaz pública: WILLY recupera y filtra metadatos y puede verificar nombres dentro del texto oficial. No se presenta como una API pública." },
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
    { id: "cendoj", name: "CENDOJ · Jurisprudencia", kind: "jurisprudencia", url: query.trim() ? `https://www.poderjudicial.es/search/sentencias/${q}/1/PUB` : "https://www.poderjudicial.es/search/indexAN.jsp", note: "Buscador oficial del CGPJ para resoluciones judiciales españolas. La ficha debe comprobarse antes de citar ROJ/ECLI." },
    { id: "tc", name: "Tribunal Constitucional", kind: "jurisprudencia", url: "https://hj.tribunalconstitucional.es/", note: "Buscador oficial con consulta por ECLI, disposiciones citadas, proceso y análisis doctrinal." },
    { id: "teac", name: "TEAC · DYCTEA", kind: "doctrina económico-administrativa", url: "https://serviciostelematicosext.hacienda.gob.es/TEAC/DYCTEA/", note: "Criterios y resoluciones económico-administrativas; permite buscar por norma, precepto, concepto y texto." },
    { id: "dgt", name: "DGT · Consultas vinculantes", kind: "doctrina tributaria", url: "https://petete.tributos.hacienda.gob.es/consultas/", note: "Buscador oficial de consultas generales y vinculantes de la Dirección General de Tributos." },
    { id: "consejo-estado", name: "Consejo de Estado · Dictámenes", kind: "doctrina consultiva", url: "https://www.boe.es/buscar/consejo_estado.php", note: "Dictámenes oficiales publicados por BOE; criterio consultivo, no jurisprudencia." },
    { id: "tacrc", name: "TACRC · Resoluciones", kind: "contratación pública", url: "https://www.hacienda.gob.es/es-ES/Areas%20Tematicas/Contratacion/tacrc/paginas/tribunal%20administrativo%20central%20de%20recursos%20contractuales.aspx", note: "Resoluciones públicas del Tribunal Administrativo Central de Recursos Contractuales." },
    { id: "fiscalia", name: "Fiscalía General del Estado", kind: "doctrina fiscal", url: "https://www.fiscal.es/", note: "Circulares, Consultas e Instrucciones: criterio institucional del Ministerio Fiscal, no sentencia." },
    { id: "defensor", name: "Defensor del Pueblo", kind: "resoluciones institucionales", url: "https://www.defensordelpueblo.es/resoluciones-dp/", note: "Recomendaciones, sugerencias y recordatorios de deberes legales." },
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
    officialSources: ["BOE", "BORME", "BOJA", "HCV · Verificación CSV", "CELLAR/EUR-Lex", "Congreso", "Senado", "CGPJ", "CENDOJ", "Tribunal Constitucional", "InfoCuria", "HUDOC", "AEPD", "TEAC · DYCTEA", "DGT", "Consejo de Estado", "TACRC", "Fiscalía General del Estado", "Defensor del Pueblo", "EDPB"],
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
    publicOfficialPortals: [
      { id: "cgpj", name: "Consejo General del Poder Judicial", url: "https://www.poderjudicial.es/", api: false, automatic: false },
      { id: "hcv-junta", name: "HCV · Verificación CSV", url: "https://ws050.juntadeandalucia.es/verificarFirma/", api: false, automatic: false, note: "Portal oficial. La consulta ciudadana exige identificación; ENIDOCWS 2.0 es un protocolo de integración con repositorios, no una API pública del portal." },
    ],
    publicOfficialSearches: [
      { id: "cendoj", name: "CENDOJ", api: false, automatic: true },
      { id: "tc", name: "Tribunal Constitucional", api: false },
      { id: "curia", name: "InfoCuria", api: false },
      { id: "hudoc", name: "HUDOC", api: false },
      { id: "aepd", name: "AEPD Datos Abiertos", api: false },
      { id: "teac", name: "TEAC · DYCTEA", api: false },
      { id: "dgt", name: "DGT · Consultas tributarias", api: false },
      { id: "consejo-estado", name: "Consejo de Estado · Dictámenes", api: false },
      { id: "tacrc", name: "TACRC · Resoluciones", api: false },
      { id: "fiscalia", name: "Fiscalía General · Doctrina", api: false },
      { id: "defensor", name: "Defensor del Pueblo · Resoluciones", api: false },
      { id: "edpb", name: "EDPB · Directrices", api: false },
    ],
    licensedSources: [
      { id: "aranzadi", name: "Aranzadi LA LEY", api: "según contrato", automatic: false, free: false, url: "https://www.aranzadilaley.es/productos/bases-de-datos-juridicas" },
      { id: "legalteca", name: "Legalteca", api: false, automatic: false, free: false, url: "https://www.aranzadilaley.es/productos/legalteca" },
      { id: "vlex", name: "vLex Library", api: "según contrato", automatic: false, free: false, url: "https://vlex.es/vlex-library" },
      { id: "tirant", name: "Tirant Prime", api: false, automatic: false, free: false, url: "https://www.tirantonline.com/" },
      { id: "lefebvre", name: "Lefebvre NEO / QMemento", api: false, automatic: false, free: false, url: "https://lefebvre.es/tienda/bases-de-datos-juridicas" },
    ],
    storageHint: juridicoDir(),
  };
}
