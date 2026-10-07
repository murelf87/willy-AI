export type CendojAdvancedFilters = {
  query?: string;
  exactPhrase?: string;
  jurisdiction?: string;
  organ?: string;
  municipality?: string;
  resolutionType?: string;
  dateFrom?: string;
  dateTo?: string;
  roj?: string;
  ecli?: string;
  resourceNumber?: string;
  ponente?: string;
  judge?: string;
  lawyer?: string;
  laj?: string;
  limit?: number;
};

export type CendojAdvancedResult = {
  reference: string;
  roj: string;
  ecli: string;
  organ: string;
  municipality: string;
  ponente: string;
  resourceNumber: string;
  date: string;
  resolutionType: string;
  summary: string;
  url: string;
  verification: "metadatos-oficiales" | "texto-oficial";
  matchedInText?: string[];
  textSnippet?: string;
};

const CENDOJ = "https://www.poderjudicial.es";

function text(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d) || 32))
    .replace(/\s+/g, " ")
    .trim();
}

function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .trim();
}

function isoDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  return match ? match[3] + "-" + match[2] + "-" + match[1] : value.trim();
}

function dateInside(value: string, from = "", to = ""): boolean {
  const d = isoDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return !from && !to;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function metaValue(segment: string, label: string): string {
  const escaped = label.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  const re = new RegExp("<li>\\s*" + escaped + "\\s*:?\\s*<b>([\\s\\S]*?)<\\/b>", "i");
  return decodeHtml(re.exec(segment)?.[1] ?? "");
}

function firstMatch(segment: string, re: RegExp): string {
  return decodeHtml(re.exec(segment)?.[1] ?? "");
}

export function parseCendojResults(html: string, max = 30): CendojAdvancedResult[] {
  const parts = html.split(/<div\s+class=["']title["']\s*>/i).slice(1);
  const out: CendojAdvancedResult[] = [];
  for (const part of parts) {
    if (out.length >= max) break;
    const roj = firstMatch(part, /data-roj=["']([^"']+)["']/i) || firstMatch(part, /ROJ:\s*<strong>([\s\S]*?)<\/strong>/i);
    const reference = firstMatch(part, /data-reference=["']([^"']+)["']/i);
    const href = firstMatch(part, /href=["'](\/search\/documento\/[^"']+)["']/i);
    const ecli = firstMatch(part, /ECLI:\s*([^<\s]+)\s*<\/strong>/i);
    if (!roj && !reference) continue;
    const organ = metaValue(part, "Tipo Órgano") || metaValue(part, "Tipo �rgano");
    const municipality = metaValue(part, "Municipio");
    const ponente = metaValue(part, "Ponente");
    const resourceNumber = metaValue(part, "Nº Recurso") || metaValue(part, "N� Recurso");
    const date = metaValue(part, "Fecha");
    const resolutionType = metaValue(part, "Tipo Resolución") || metaValue(part, "Tipo Resoluci�n");
    const summary = firstMatch(part, /<div\s+class=["']summary["'][^>]*>\s*Resumen:\s*<b>([\s\S]*?)<\/b>/i);
    out.push({
      reference,
      roj,
      ecli,
      organ,
      municipality,
      ponente,
      resourceNumber,
      date,
      resolutionType,
      summary,
      url: href ? new URL(href, CENDOJ).toString() : CENDOJ + "/search/indexAN.jsp",
      verification: "metadatos-oficiales",
    });
  }
  return out;
}

function candidateMatches(result: CendojAdvancedResult, filters: CendojAdvancedFilters): boolean {
  const includes = (haystack: string, needle?: string) => !text(needle) || norm(haystack).includes(norm(text(needle)));
  if (!includes(result.organ, filters.organ)) return false;
  if (!includes(result.municipality, filters.municipality)) return false;
  if (!includes(result.resolutionType, filters.resolutionType)) return false;
  if (!includes(result.resourceNumber, filters.resourceNumber)) return false;
  if (!includes(result.ponente, filters.ponente)) return false;
  if (!includes(result.roj, filters.roj)) return false;
  if (!includes(result.ecli, filters.ecli)) return false;
  if (!dateInside(result.date, text(filters.dateFrom, 10), text(filters.dateTo, 10))) return false;
  const jurisdiction = text(filters.jurisdiction);
  if (jurisdiction && !norm(result.organ + " " + result.summary).includes(norm(jurisdiction))) return false;
  return true;
}

function around(textBody: string, needle: string): string {
  const bodyNorm = norm(textBody);
  const needleNorm = norm(needle);
  const i = bodyNorm.indexOf(needleNorm);
  if (i < 0) return "";
  const start = Math.max(0, i - 220);
  return textBody.slice(start, Math.min(textBody.length, start + 650)).replace(/\s+/g, " ").trim();
}

function needsText(filters: CendojAdvancedFilters): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (text(filters.judge)) out.push(["juez/magistrado", text(filters.judge)]);
  if (text(filters.lawyer)) out.push(["letrado/abogado", text(filters.lawyer)]);
  if (text(filters.laj)) out.push(["LAJ", text(filters.laj)]);
  if (text(filters.exactPhrase)) out.push(["frase exacta", text(filters.exactPhrase)]);
  return out;
}

async function decodeResponse(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad < 4) return utf8;
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    return utf8;
  }
}

async function fetchOfficial(url: string, timeout = 20_000): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "es-ES,es;q=0.9",
      "User-Agent": "Mozilla/5.0 WILLY-AI-Juridico/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error("CENDOJ respondió " + response.status + ".");
  return decodeResponse(response);
}

function searchSeed(filters: CendojAdvancedFilters): string {
  const values = [
    text(filters.query, 240),
    text(filters.exactPhrase, 160),
    text(filters.ecli, 100),
    text(filters.roj, 100),
    text(filters.resourceNumber, 80),
    text(filters.ponente, 120),
    text(filters.judge, 120),
    text(filters.lawyer, 120),
    text(filters.laj, 120),
    text(filters.municipality, 80),
  ].filter(Boolean);
  return values.join(" ").slice(0, 450) || "jurisprudencia";
}

export async function searchCendojAdvanced(raw: CendojAdvancedFilters): Promise<{
  results: CendojAdvancedResult[];
  officialSearchUrl: string;
  note: string;
}> {
  const filters: CendojAdvancedFilters = {
    ...raw,
    query: text(raw.query, 240),
    exactPhrase: text(raw.exactPhrase, 160),
    jurisdiction: text(raw.jurisdiction, 100),
    organ: text(raw.organ, 140),
    municipality: text(raw.municipality, 100),
    resolutionType: text(raw.resolutionType, 60),
    dateFrom: text(raw.dateFrom, 10),
    dateTo: text(raw.dateTo, 10),
    roj: text(raw.roj, 100),
    ecli: text(raw.ecli, 120),
    resourceNumber: text(raw.resourceNumber, 80),
    ponente: text(raw.ponente, 140),
    judge: text(raw.judge, 140),
    lawyer: text(raw.lawyer, 140),
    laj: text(raw.laj, 140),
    limit: Math.max(1, Math.min(40, Number(raw.limit) || 20)),
  };
  const seed = searchSeed(filters);
  const officialSearchUrl = CENDOJ + "/search/sentencias/" + encodeURIComponent(seed) + "/1/AN";
  const html = await fetchOfficial(officialSearchUrl);
  let results = parseCendojResults(html, 60).filter((item) => candidateMatches(item, filters));

  const textFilters = needsText(filters);
  if (textFilters.length) {
    const checked: CendojAdvancedResult[] = [];
    for (const result of results.slice(0, 18)) {
      try {
        const page = await fetchOfficial(result.url, 15_000);
        const body = decodeHtml(page);
        const matched: string[] = [];
        let snippet = "";
        for (const [label, needle] of textFilters) {
          if (norm(body).includes(norm(needle)) || (label === "juez/magistrado" && norm(result.ponente).includes(norm(needle)))) {
            matched.push(label + ": " + needle);
            if (!snippet) snippet = around(body, needle);
          }
        }
        if (matched.length === textFilters.length) {
          checked.push({ ...result, verification: "texto-oficial", matchedInText: matched, ...(snippet ? { textSnippet: snippet } : {}) });
        }
      } catch {
        // Si no puede abrir el documento, nunca se considera coincidencia por nombre dentro del texto.
      }
    }
    results = checked;
  }

  const limit = Number(filters.limit) || 20;
  return {
    results: results.slice(0, limit),
    officialSearchUrl,
    note: textFilters.length
      ? "Los filtros de juez/magistrado, letrado/abogado, LAJ o frase exacta se confirman leyendo el texto oficial recuperado; si no puede recuperarse, el resultado se excluye."
      : "Resultados obtenidos del buscador oficial CENDOJ y filtrados localmente por sus metadatos públicos.",
  };
}
