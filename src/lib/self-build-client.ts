// Autoconstrucción desde la pantalla: estado (versiones, historial, copias), salud, recuperación y vuelta atrás.
// Solo tipos del lado del servidor (se borran al compilar): aquí no se carga nada que necesite Node.
import type { HealthReport, Recovery, StatusBody } from "@/lib/self-build-manager";

export type { HealthReport, Recovery, StatusBody };
export type RevertResult = { ok: true; reverted: string; label: string; backTo: string; restarting: boolean; installed: boolean; backup: string; notes?: string[] };

async function post<T>(body: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const res = await fetch("/api/self-build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data: (T & { ok?: boolean; error?: string }) | null = null;
  try {
    data = (await res.json()) as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error(`El servidor de WILLY respondió ${res.status} sin un resultado legible.`);
  }
  if (!res.ok || !data || data.ok === false) throw new Error(data?.error ?? `El servidor de WILLY respondió ${res.status}.`);
  return data;
}

/** Estado: recupera lo que se quedó a medias y confirma la salud de la versión recién instalada. */
export const fetchSelfStatus = (): Promise<StatusBody> => post<StatusBody>({ action: "self-status" }, 30_000);

/** Comprobación de salud completa (Ollama, IA externas, almacenamiento, disco…). */
export const fetchSelfHealth = async (): Promise<HealthReport> => (await post<{ ok: true; report: HealthReport }>({ action: "self-health" }, 30_000)).report;

export const recoverSelfBuild = async (): Promise<Recovery> => (await post<{ ok: true; recovery: Recovery }>({ action: "self-recover" }, 60_000)).recovery;

/** Vuelve atrás la versión actual (puede tardar: copia y verifica el programa antes de tocar nada). */
export const revertSelfVersion = (id: string): Promise<RevertResult> => post<RevertResult>({ action: "self-revert", id }, 10 * 60_000);

/** Tras reiniciar: espera a que el programa vuelva a responder (como al instalar una mejora). */
export async function waitForRestart(maxMs = 150_000): Promise<boolean> {
  const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const until = Date.now() + maxMs;
  await sleep(5000);
  while (Date.now() < until) {
    try {
      const res = await fetch("/api/local-ai", { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      /* todavía reiniciándose */
    }
    await sleep(1500);
  }
  return false;
}
