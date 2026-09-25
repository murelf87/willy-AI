// Lado del navegador de Ajustes y del Centro de Inteligencia: habla con /api/sistema (el servidor de WILLY en tu equipo).
// Cada función devuelve lo que contestó el servidor o un error claro; nunca se inventa un «hecho».

import type {
  CachePreview, DependencyReport, DiagReport, LogSource, OllamaReport, StorageReport, SystemInfo,
} from "@/lib/maintenance-server";

export type { CachePreview, DependencyReport, DiagReport, LogSource, OllamaReport, StorageReport, SystemInfo };
export type { CacheItem, DiagCheck, DiagStatus, OllamaModel, StorageItem } from "@/lib/maintenance-server";

export type ActionReply = { ok: boolean; message?: string; error?: string; [key: string]: unknown };

const API = "/api/sistema";

async function getJson<T>(query: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}?${query}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const fetchSystemInfo = () => getJson<SystemInfo>("info");
export const fetchStorage = () => getJson<StorageReport>("almacenamiento");
export const fetchCachePreview = () => getJson<CachePreview>("cache");
export const fetchOllama = () => getJson<OllamaReport>("ollama");
export const fetchLogs = (full: boolean) => getJson<{ sources: LogSource[]; full: boolean }>(`registros${full ? "&completos=1" : ""}`);
export const fetchDependencies = () => getJson<DependencyReport>("dependencias");

/** Pide una acción al servidor. Si no contesta, lo dice (no da nada por hecho). */
export async function systemAction(action: string): Promise<ActionReply> {
  try {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const data = (await res.json().catch(() => null)) as ActionReply | null;
    if (!data) return { ok: false, error: `El servidor de WILLY no contestó bien (código ${res.status}).` };
    return data;
  } catch {
    return { ok: false, error: "No hay respuesta del servidor de WILLY. ¿Está abierto?" };
  }
}

export async function runDiagnosis(): Promise<{ ok: true; report: DiagReport } | { ok: false; error: string }> {
  const data = await systemAction("diagnostico");
  const report = data["report"] as DiagReport | undefined;
  return data.ok && report ? { ok: true, report } : { ok: false, error: data.error ?? "No se pudo hacer el diagnóstico." };
}

/**
 * Espera a que WILLY vuelva a responder tras reiniciarse (primero a que deje de responder, para no confundir el servidor
 * viejo con el nuevo) y devuelve true si lo hace a tiempo.
 */
export async function waitForRestart(opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)));
  const interval = opts.intervalMs ?? 1000;
  const until = Date.now() + (opts.timeoutMs ?? 90_000);
  const firstInfo = await fetchSystemInfo();
  const firstPid = firstInfo?.pid ?? null;
  while (Date.now() < until) {
    await sleep(interval);
    const info = await fetchSystemInfo();
    // Responde un servidor distinto (otro proceso) o, sin saber cuál había, uno recién encendido.
    if (info && ((firstPid !== null && info.pid !== firstPid) || (firstPid === null && info.uptimeSec < 60))) return true;
  }
  return false;
}
