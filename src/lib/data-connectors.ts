import { clip, type Connector, type Get, type Page, type Params } from "@/lib/data-helpers";
import { CATALOG } from "@/lib/data-catalog";

// Fuentes de datos en tiempo real para la IA local. Aquí vive lo común: cómo se elige la fuente a partir de tu mensaje,
// qué parámetros se aceptan, la lista cerrada de direcciones, la memoria de respuestas recientes y los mensajes de error.

export { CATALOG };
export type { Connector, Page, Params };

export type SourcesSettings = { enabled: boolean; off: string[]; place: string };
export const DEFAULT_SOURCES: SourcesSettings = { enabled: true, off: [], place: "" };

/** Orden de comprobación: lo más específico primero (así «cuánto vale un bitcoin en euros» no se confunde con un cambio de divisas). */
const ORDER = ["cripto", "bolsa", "luz", "divisas", "tiempo", "aire", "festivos", "terremotos", "noticias", "hackernews", "nasa", "software", "deporte", "arxiv", "pubmed", "crossref", "wikipedia", "diccionario", "libros", "paises", "bancomundial"];
const ranked = [...CATALOG].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

export const connectorById = (id: string): Connector | undefined => CATALOG.find((c) => c.id === id);

/**
 * ¿Pide este mensaje datos en tiempo real? Solo frases claras y cortas (no textos largos, ni código): en la duda no se consulta.
 * Solo sale de tu equipo el dato mínimo (la ciudad, la divisa…), nunca el mensaje entero.
 */
export function detectDataQuery(text: string, settings: SourcesSettings = DEFAULT_SOURCES): { connector: Connector; params: Params } | null {
  if (!settings.enabled) return null;
  const clean = text.trim();
  if (!clean || clean.length > 300 || clean.includes("```") || clean.split("\n").length > 3) return null;
  for (const connector of ranked) {
    if (settings.off.includes(connector.id)) continue;
    const params = connector.detect(clean);
    if (!params) continue;
    if ((connector.id === "tiempo" || connector.id === "aire") && !params["place"] && settings.place) params["place"] = settings.place;
    return { connector, params };
  }
  return null;
}

const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Solo pasan los parámetros que la fuente declara, como texto corto y sin caracteres de control. */
export function sanitizeParams(connector: Connector, raw: unknown): Params {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Params = {};
  for (const param of connector.params) {
    const value = source[param.name];
    if (typeof value === "string" || typeof value === "number") out[param.name] = String(value).replace(CONTROL, " ").trim().slice(0, 120);
  }
  return out;
}

/** Cada fuente solo puede abrir sus propias direcciones (https). Nada más. */
export function guard(connector: Connector, raw: Get): Get {
  const allowed = new Set(connector.hosts);
  return async (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Dirección no válida.");
    }
    if (parsed.protocol !== "https:" || !allowed.has(parsed.hostname)) throw new Error(`Esta fuente no puede abrir ${parsed.hostname}.`);
    return raw(url);
  };
}

export type RunResult = { ok: true; id: string; name: string; fetchedAt: string; cached: boolean; page: Page } | { ok: false; error: string };

const cache = new Map<string, { at: number; page: Page }>();
const MAX_CACHE = 300;
export const clearConnectorCache = (): void => cache.clear();

export async function runConnector(id: string, rawParams: unknown, deps: { get: Get; now?: Date; useCache?: boolean }): Promise<RunResult> {
  const connector = connectorById(id);
  if (!connector) return { ok: false, error: "Fuente desconocida." };
  const params = sanitizeParams(connector, rawParams);
  const missing = connector.params.filter((p) => p.required && !params[p.name]);
  if (missing.length) {
    const hint = missing.some((p) => p.name === "place") ? " Dímelo en tu mensaje (por ejemplo «en Sevilla») o guarda tu ciudad en Herramientas → Fuentes de datos." : "";
    return { ok: false, error: `Falta: ${missing.map((p) => p.label.toLowerCase()).join(", ")}.${hint}` };
  }
  const now = deps.now ?? new Date();
  const key = `${id}|${JSON.stringify(params)}`;
  const hit = cache.get(key);
  if (deps.useCache !== false && hit && now.getTime() - hit.at < connector.ttl * 1000) return { ok: true, id, name: connector.name, fetchedAt: new Date(hit.at).toISOString(), cached: true, page: hit.page };
  try {
    const page = await connector.run(params, { get: guard(connector, deps.get), now });
    const safe: Page = { title: clip(page.title, 200), url: page.url, text: clip(page.text.replace(CONTROL, " ").replace(/[ \t]+/g, " "), 3400) };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now.getTime(), page: safe });
    return { ok: true, id, name: connector.name, fetchedAt: now.toISOString(), cached: false, page: safe };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|timed out|aborted|abort/i.test(message) || (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))) return { ok: false, error: `${connector.name} tarda demasiado en responder. Inténtalo de nuevo en un momento.` };
    return { ok: false, error: message };
  }
}
