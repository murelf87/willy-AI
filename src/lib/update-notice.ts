// Aviso de «ya se ha actualizado»: el actualizador deja una nota en datos-privados/actualizacion.json y WILLY la enseña en un globo que
// NO desaparece hasta que pulsas Aceptar (aunque recargues la página o abras otro navegador). Aquí vive lo que no depende de la pantalla.

export type Notice = { version: string; from: string; label: string; at: string; notes: string[]; ack: boolean };
export type Poll = { version: string; notice: Notice | null } | null;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

export function sanitizeNotice(raw: unknown): Notice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const version = str(r["version"], 40);
  if (!/^\d+\.\d+\.\d+/.test(version)) return null;
  return { version, from: str(r["from"], 40), label: str(r["label"], 200), at: str(r["at"], 40), notes: (Array.isArray(r["notes"]) ? r["notes"] : []).map((n) => str(n, 300)).filter(Boolean).slice(0, 12), ack: r["ack"] === true };
}

/** Si hay una nota sin aceptar de una actualización anterior, se conserva su «desde» y se suman las novedades (dos actualizaciones seguidas = un solo globo). */
export function mergeNotice(previous: Notice | null, next: Notice): Notice {
  if (!previous || previous.ack) return next;
  const notes = [...previous.notes, ...next.notes.filter((n) => !previous.notes.includes(n))].slice(0, 12);
  return { ...next, from: previous.from || next.from, notes };
}

export type Ui = { kind: "none" } | { kind: "waiting" } | { kind: "stale"; serverVersion: string } | { kind: "balloon"; notice: Notice };

/**
 * Qué enseñar y si recargar la pestaña. Un WILLY que se está reiniciando (varios avisos sin respuesta) se dice con calma; una pestaña que
 * lleva el programa viejo se recarga sola (lo que escribías queda guardado); y la nota de actualización manda: se enseña hasta aceptarla.
 */
export function decide(clientVersion: string, poll: Poll, missed: number): { ui: Ui; reload: boolean } {
  // Dos avisos seguidos sin respuesta (unos 3 s con el sondeo rápido): el programa se está reiniciando.
  if (!poll) return { ui: missed >= 2 ? { kind: "waiting" } : { kind: "none" }, reload: false };
  const stale = poll.version !== clientVersion;
  if (poll.notice && !poll.notice.ack) return { ui: { kind: "balloon", notice: poll.notice }, reload: stale };
  if (stale) return { ui: { kind: "stale", serverVersion: poll.version }, reload: true };
  return { ui: { kind: "none" }, reload: false };
}

/** Cuánto suele tardar el reinicio en este equipo (se aprende de los reinicios anteriores). */
export const RESTART_KEY = "willy-reinicio-ms";
export const DEFAULT_RESTART_MS = 30_000;
export const MIN_RESTART_MS = 8_000;
export const MAX_RESTART_MS = 180_000;

export function expectedRestartMs(storage: Pick<Storage, "getItem"> | null): number {
  try {
    const saved = Number(storage?.getItem(RESTART_KEY));
    return Number.isFinite(saved) && saved > 0 ? Math.min(MAX_RESTART_MS, Math.max(MIN_RESTART_MS, saved)) : DEFAULT_RESTART_MS;
  } catch {
    return DEFAULT_RESTART_MS;
  }
}

/** Tras un reinicio, se guarda lo que ha tardado de verdad (con un pequeño margen) para que la próxima barra vaya al ritmo real. */
export function rememberRestartMs(storage: Pick<Storage, "setItem"> | null, measuredMs: number): void {
  try { storage?.setItem(RESTART_KEY, String(Math.round(Math.min(MAX_RESTART_MS, Math.max(MIN_RESTART_MS, measuredMs * 1.1))))); } catch { /* sin guardado */ }
}

/**
 * Barra del reinicio: del 1 % al 99 % al ritmo del tiempo que suele tardar (de 1 en 1, en tiempo real) y cuánto queda; el 100 % llega
 * cuando el programa responde de verdad. Si tarda más de lo normal, se queda en 99 % y lo dice.
 */
export function restartProgress(elapsedMs: number, expectedMs: number, back = false): { pct: number; remainingText: string } {
  if (back) return { pct: 100, remainingText: "¡Ya está! Cargando…" };
  const pct = Math.min(99, Math.max(1, Math.floor((Math.max(0, elapsedMs) / Math.max(1, expectedMs)) * 100)));
  const left = Math.ceil((expectedMs - elapsedMs) / 1000);
  if (left > 0) return { pct, remainingText: left >= 90 ? `quedan ~${Math.ceil(left / 60)} min` : `quedan ~${left} s` };
  return { pct: 99, remainingText: "un momento más de lo normal…" };
}

export function noticeTitle(n: Notice): string {
  return `WILLY AI se ha actualizado a la versión ${n.version}${n.from ? ` (desde la ${n.from})` : ""}`;
}
