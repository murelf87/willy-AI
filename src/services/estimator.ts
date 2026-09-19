// Estimación de cuánto falta para terminar un encargo. No promete milagros:
// calcula con el tamaño real del trabajo y se ajusta con la velocidad medida.

import type { Playbook } from "@/services/playbooks";

const KEY = "willy-velocidad";

/** Segundos que tardó de media el motor en generar 1.000 caracteres. */
function speed(): number {
  if (typeof window === "undefined") return 6;
  const raw = Number(window.localStorage.getItem(KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 6;
}

/** Registra la velocidad real tras una generación para afinar las siguientes. */
export function recordSpeed(chars: number, ms: number) {
  if (typeof window === "undefined" || chars < 500 || ms < 500) return;
  const measured = (ms / 1000) / (chars / 1000);
  const next = speed() * 0.6 + measured * 0.4;
  window.localStorage.setItem(KEY, String(Math.round(next * 100) / 100));
}

/** Trabajo estimado en caracteres de respuesta según el encargo. */
export function estimateChars(pb: Playbook | null, extras: number, prompt: string): number {
  const base = pb ? 2500 + pb.must.length * 1400 + extras * 900 : Math.max(1200, prompt.length * 6);
  return Math.round(base);
}

/** Segundos estimados totales para el encargo. */
export function estimateSeconds(pb: Playbook | null, extras: number, prompt: string): number {
  return Math.round((estimateChars(pb, extras, prompt) / 1000) * speed());
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m} min ${rest} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** Progreso y tiempo restante mientras se está generando. */
export function progressOf(written: number, total: number, elapsedMs: number) {
  const pct = Math.min(99, Math.round((written / Math.max(1, total)) * 100));
  const perChar = written > 200 ? elapsedMs / written : null;
  const remainingMs = perChar ? Math.max(0, (total - written) * perChar) : null;
  return {
    pct,
    remaining: remainingMs === null ? null : Math.round(remainingMs / 1000),
  };
}
