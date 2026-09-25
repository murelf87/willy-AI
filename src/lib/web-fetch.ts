import { htmlToText, isPrivateIp, parseDuckDuckGo, parseWikipedia, safeWebUrl, titleOf, type WebPage, type WebResult } from "@/lib/web-search";

// Acceso a internet desde el servidor de WILLY. Sin dependencias del entorno: todo lo que toca la red
// se puede sustituir (para probarlo sin conexión).

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type WebDeps = {
  fetchImpl?: typeof fetch;
  /** Direcciones IP de un nombre de dominio. */
  lookup?: (host: string) => Promise<string[]>;
  blockIp?: (ip: string) => boolean;
  checkUrl?: (raw: string) => URL | null;
  timeoutMs?: number;
  maxBytes?: number;
  duckUrl?: (query: string) => string;
  wikiUrl?: (query: string) => string;
};

export type Fetched = { status: number; type: string; body: string; url: string };

async function defaultLookup(host: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  return (await lookup(host, { all: true })).map((entry) => entry.address);
}

/**
 * Descarga una página con estas garantías: solo http/https a direcciones públicas (también tras cada
 * redirección), como máximo 4 saltos, tiempo límite y tamaño máximo. Así ni una página ni una petición
 * maliciosa pueden usar a WILLY para llegar a tu router, a tu red local o a servicios de tu propio equipo.
 */
export async function safeGet(rawUrl: string, accept: string, deps: WebDeps = {}): Promise<Fetched> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const blockIp = deps.blockIp ?? isPrivateIp;
  const check = deps.checkUrl ?? safeWebUrl;
  const resolve = deps.lookup ?? defaultLookup;
  const maxBytes = deps.maxBytes ?? 1_500_000;
  let current = rawUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    const url = check(current);
    if (!url) throw new Error("Dirección no permitida.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = /^[\d.]+$/.test(host) || host.includes(":") ? [host] : await resolve(host);
    if (!addresses.length || addresses.some((address) => blockIp(address))) throw new Error("Dirección no permitida.");

    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "es-ES,es;q=0.9,en;q=0.6" },
      redirect: "manual",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new Error("Redirección sin destino.");
      current = new URL(next, url).toString();
      continue;
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        // El límite es exacto: lo que pase de maxBytes se descarta aunque llegue en un solo trozo.
        if (received + value.byteLength > maxBytes) {
          chunks.push(value.subarray(0, Math.max(0, maxBytes - received)));
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
        received += value.byteLength;
      }
    }
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status: res.status, type: res.headers.get("content-type") ?? "", body: new TextDecoder("utf-8").decode(bytes), url: url.toString() };
  }
  throw new Error("Demasiadas redirecciones.");
}

/** Busca primero en DuckDuckGo y, si no da resultados (o se niega a responder), en Wikipedia. */
export async function searchWeb(query: string, deps: WebDeps = {}): Promise<{ results: WebResult[]; source: string }> {
  const duck = deps.duckUrl ?? ((q: string) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=es-es`);
  const wiki = deps.wikiUrl ?? ((q: string) => `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&format=json&utf8=1`);
  try {
    const page = await safeGet(duck(query), "text/html", deps);
    if (page.status === 200) {
      const results = parseDuckDuckGo(page.body, 6);
      if (results.length) return { results, source: "DuckDuckGo" };
    }
  } catch {
    /* se prueba con Wikipedia */
  }
  try {
    const page = await safeGet(wiki(query), "application/json", deps);
    if (page.status === 200) {
      const results = parseWikipedia(JSON.parse(page.body), "es", 5);
      if (results.length) return { results, source: "Wikipedia" };
    }
  } catch {
    /* sin resultados */
  }
  return { results: [], source: "" };
}

/** Lee una página y devuelve su texto limpio, o null si no es una página de texto útil. */
export async function readPage(url: string, fallbackTitle: string, deps: WebDeps = {}): Promise<WebPage | null> {
  try {
    const page = await safeGet(url, "text/html,text/plain;q=0.9,*/*;q=0.5", deps);
    if (page.status !== 200) return null;
    const isHtml = /html/i.test(page.type) || /^\s*<(?:!doctype|html)/i.test(page.body);
    if (!isHtml && !/^text\//i.test(page.type)) return null;
    const text = isHtml ? htmlToText(page.body) : page.body.trim();
    return text.length < 200 ? null : { title: (isHtml ? titleOf(page.body) : "") || fallbackTitle, url: page.url, text: text.slice(0, 3500) };
  } catch {
    return null;
  }
}

/** Busca y lee las 3 primeras páginas, en paralelo. */
export async function askWeb(query: string, deps: WebDeps = {}): Promise<{ query: string; source: string; results: WebResult[]; pages: WebPage[] }> {
  const { results, source } = await searchWeb(query, deps);
  const read = await Promise.all(results.slice(0, 3).map((result) => readPage(result.url, result.title, deps)));
  return { query, source, results, pages: read.filter((page): page is WebPage => page !== null) };
}
