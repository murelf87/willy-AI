import { DEFAULT_SOURCES, type SourcesSettings } from "@/lib/data-connectors";

// Ajustes de las fuentes de datos en tiempo real (en este equipo): interruptor general, fuentes apagadas y tu ciudad por defecto.

const KEY = "willy:fuentes-de-datos";
export const SOURCES_EVENT = "willy:fuentes-cambio";
export const SOURCES_REPORT_KEY = "willy:fuentes-informe";

export function readSources(): SourcesSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<SourcesSettings>;
    return {
      enabled: parsed.enabled !== false,
      off: Array.isArray(parsed.off) ? parsed.off.filter((id): id is string => typeof id === "string").slice(0, 60) : [],
      place: typeof parsed.place === "string" ? parsed.place.slice(0, 80) : "",
    };
  } catch {
    return { ...DEFAULT_SOURCES };
  }
}

export function writeSources(next: SourcesSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(SOURCES_EVENT));
  } catch {
    /* sin almacenamiento */
  }
}

export type TestLine = { id: string; name: string; ok: boolean; ms: number; detail: string };

/** Llama a la fuente desde el navegador (la consulta real la hace el servidor de WILLY en tu equipo). */
export async function callConnector(id: string, params: Record<string, string>): Promise<{ ok: true; title: string; url: string; text: string; source: string; fetchedAt: string; cached: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/fetch-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connector: id, params }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string; source?: string; fetchedAt?: string; cached?: boolean; pages?: Array<{ title: string; url: string; text: string }> };
    const page = data.pages?.[0];
    if (!res.ok || data.error || !page) return { ok: false, error: data.error ?? `El servidor respondió ${res.status}.` };
    return { ok: true, title: page.title, url: page.url, text: page.text, source: data.source ?? "", fetchedAt: data.fetchedAt ?? "", cached: !!data.cached };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo hablar con el servidor de WILLY." };
  }
}
