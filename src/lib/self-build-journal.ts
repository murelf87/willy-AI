// AUTOCONSTRUCCIÓN · DIARIO DE OPERACIONES (solo servidor). Cada mejora deja, paso a paso, qué ha pasado y, mientras dura,
// una MARCA de operación en curso escrita ANTES de tocar nada. Si WILLY se apaga a mitad, al volver se lee la marca y se sabe
// exactamente qué quedó a medias: nunca se adivina ni se da por terminado lo que no tiene confirmación.
//
// Orden de una mejora (desde la rev14, con VERSIÓN CANDIDATA aparte):
//   STARTED → CANDIDATE_CREATED → CANDIDATE_EDITED → BUILD_STARTED → BUILD_SUCCESS → TYPECHECK_STARTED → TYPECHECK_SUCCESS →
//   TEST_STARTED → TEST_SUCCESS → READY  (hasta aquí la versión que funciona NO se ha tocado)
//   → PROMOTION_STARTED → BACKUP_VERIFIED → FILES_MODIFIED → PROMOTED → COMPLETED → RESTART_SCHEDULED → HEALTH_CHECK
// o, si algo falla, FAILED (y ROLLED_BACK si ya se había tocado algo y se deshizo).

import { appendDurable, writeFileDurable } from "@/lib/self-build-backup";

export const SB_DIR = "copias-autoconstruccion";
export const JOURNAL_FILE = "diario-operaciones.jsonl";
export const MARKER_FILE = "operacion-en-curso.json";

export type JournalStep =
  | "STARTED" | "CANDIDATE_CREATED" | "CANDIDATE_EDITED" | "BUILD_STARTED" | "BUILD_SUCCESS" | "TYPECHECK_STARTED" | "TYPECHECK_SUCCESS"
  | "TEST_STARTED" | "TEST_SUCCESS" | "READY" | "BACKUP_VERIFIED" | "FILES_MODIFIED"
  | "PROMOTION_STARTED" | "PROMOTED" | "RESTART_SCHEDULED" | "HEALTH_CHECK" | "COMPLETED" | "ROLLED_BACK" | "FAILED" | "RECOVERED";

/** Estado de la versión candidata según el paso en que va la operación (los nombres del prompt maestro, en claro). */
export const CANDIDATE_STATE: Partial<Record<JournalStep, string>> = {
  STARTED: "ANALIZANDO",
  CANDIDATE_CREATED: "CREADA",
  CANDIDATE_EDITED: "EDITADA",
  BUILD_STARTED: "COMPILANDO",
  BUILD_SUCCESS: "COMPILADA",
  TYPECHECK_STARTED: "VALIDANDO",
  TYPECHECK_SUCCESS: "VALIDADA",
  TEST_STARTED: "PROBANDO",
  TEST_SUCCESS: "PROBADA",
  READY: "LISTA",
  PROMOTION_STARTED: "PROMOCIONANDO",
  BACKUP_VERIFIED: "PROMOCIONANDO",
  FILES_MODIFIED: "PROMOCIONANDO",
  PROMOTED: "ACTIVA",
  COMPLETED: "ACTIVA",
  FAILED: "FALLIDA",
  ROLLED_BACK: "DESHECHA",
};

/** Resultado de una comprobación: superada, fallida, no se pudo comprobar o no se aplica. */
export type Verdict = "PASS" | "FAIL" | "NOT_VERIFIED" | "N/A";

export type OperationKind = "mejora" | "vuelta-atras";

export type JournalEvent = { op: string; at: string; step: JournalStep; detail?: string; kind?: OperationKind };

export type Marker = {
  op: string;
  kind?: OperationKind;
  startedAt: string;
  /** Proceso del servidor que empezó la operación y cuándo arrancó ese servidor (para saber si sigue vivo). */
  pid: number;
  serverStartedAt: string;
  objective: string;
  /** Versión oficial con la que empezó («0.0.43+13»): si al recuperar es otra, se instaló una oficial después y no se toca nada. */
  appVersion: string;
  /** Carpeta de la copia, relativa a la instalación («copias-autoconstruccion/…»). */
  backupDir: string;
  files: string[];
  step: JournalStep;
  /** Cuándo empezó el paso actual (para la barra de progreso). */
  stepAt?: string;
  /** Comprobaciones superadas hasta ahora (para registrar la versión si hay que terminarla al recuperar). */
  tests?: Record<string, Verdict>;
  /** Si la instalación tiene programa compilado (willy-ai.exe) y la huella del programa nuevo antes de instalarlo. */
  installed?: boolean;
  candidate?: string;
  /** Vuelta atrás: versión que se revierte. */
  target?: string;
  /** Si la recuperación no pudo resolverla sola: el motivo (se anota una sola vez en el diario). */
  blocked?: string;
  /** true desde justo antes de escribir el primer archivo: si no, la operación no llegó a tocar nada. */
  touched?: boolean;
};

async function node() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return { fs, path };
}

/** Cuándo arrancó este proceso del servidor (no cambia mientras siga vivo). */
export function serverStartedAt(): string {
  return new Date(Date.now() - process.uptime() * 1000).toISOString();
}

/** Nombre de operación: fecha + objetivo, legible y único. */
export function opId(now: Date, objective: string): string {
  // Con milésimas: dos intentos seguidos de la misma mejora (el motor reintenta al instante) nunca comparten nombre.
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 23);
  const slug = objective.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mejora";
  return `${stamp}-${slug}`;
}

export async function appendEvent(root: string, event: JournalEvent): Promise<void> {
  const { fs, path } = await node();
  const dir = path.join(root, SB_DIR);
  await fs.mkdir(dir, { recursive: true });
  const clean = { ...event, ...(event.detail ? { detail: event.detail.replace(/\s+/g, " ").slice(0, 900) } : {}) };
  await appendDurable(path.join(dir, JOURNAL_FILE), `${JSON.stringify(clean)}\n`);
}

export async function readJournal(root: string, limit = 80): Promise<JournalEvent[]> {
  const { fs, path } = await node();
  try {
    const text = await fs.readFile(path.join(root, SB_DIR, JOURNAL_FILE), "utf8");
    const out: JournalEvent[] = [];
    for (const line of text.split("\n").slice(-limit * 2)) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as JournalEvent); } catch { /* línea cortada por un apagón: se ignora */ }
    }
    return out.slice(-limit);
  } catch {
    return [];
  }
}

/** Escribe la marca (y la actualiza en cada paso) de forma que aguante un apagón. */
export async function writeMarker(root: string, marker: Marker): Promise<void> {
  const { path } = await node();
  await writeFileDurable(path.join(root, SB_DIR, MARKER_FILE), JSON.stringify(marker, null, 2));
}

/** La marca, distinguiendo «no hay ninguna» de «hay una pero está dañada» (por ejemplo, tras un apagón). */
export async function readMarkerState(root: string): Promise<{ marker: Marker | null; damaged: boolean }> {
  const { fs, path } = await node();
  let text: string;
  try {
    text = await fs.readFile(path.join(root, SB_DIR, MARKER_FILE), "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "";
    return { marker: null, damaged: code !== "ENOENT" };
  }
  try {
    const marker = JSON.parse(text) as Marker;
    return marker && typeof marker.op === "string" && typeof marker.backupDir === "string" ? { marker, damaged: false } : { marker: null, damaged: true };
  } catch {
    return { marker: null, damaged: true };
  }
}

export async function readMarker(root: string): Promise<Marker | null> {
  return (await readMarkerState(root)).marker;
}

export async function clearMarker(root: string): Promise<void> {
  const { fs, path } = await node();
  await fs.rm(path.join(root, SB_DIR, MARKER_FILE), { force: true, maxRetries: 5, retryDelay: 200 });
}

/** Una operación y su marca, juntas: cada paso queda en el diario y en la marca (si la hay). */
export async function step(root: string, marker: Marker | null, op: string, stepName: JournalStep, detail?: string): Promise<void> {
  await appendEvent(root, { op, at: new Date().toISOString(), step: stepName, ...(detail ? { detail } : {}), ...(stepName === "STARTED" && marker?.kind ? { kind: marker.kind } : {}) });
  if (marker) {
    marker.step = stepName;
    await writeMarker(root, marker);
  }
}

// ------------------------------------------------------------------------------------------ historial para el dueño

export type OperationOutcome = "instalada" | "aplicada" | "descartada" | "restaurada" | "recuperada" | "vuelta-atras" | "en-curso" | "interrumpida";

export type OperationSummary = {
  op: string;
  kind: OperationKind;
  at: string;
  objective: string;
  outcome: OperationOutcome;
  /** Motivo o resultado, en palabras del propio diario. */
  detail: string;
  steps: JournalStep[];
};

export const OUTCOME_LABEL: Record<OperationOutcome, string> = {
  instalada: "Instalada",
  aplicada: "Aplicada (vista previa)",
  descartada: "Descartada · no se tocó nada",
  restaurada: "Descartada · se restauró todo",
  recuperada: "Recuperada tras un cierre inesperado",
  "vuelta-atras": "Vuelta atrás hecha",
  "en-curso": "En curso",
  interrumpida: "Interrumpida · se recuperará al abrir Autoconstrucción",
};

/**
 * Agrupa el diario por operación y dice cómo terminó cada una. Una operación fallida NUNCA aparece como éxito: solo es
 * «instalada» si tiene COMPLETED y no fue revertida después.
 */
export function summarizeOperations(events: JournalEvent[], running: string | null = null): OperationSummary[] {
  const byOp = new Map<string, JournalEvent[]>();
  for (const event of events) {
    if (!event || typeof event.op !== "string") continue;
    const list = byOp.get(event.op) ?? [];
    list.push(event);
    byOp.set(event.op, list);
  }
  const out: OperationSummary[] = [];
  for (const [op, list] of byOp) {
    const steps = list.map((e) => e.step);
    const has = (s: JournalStep) => steps.includes(s);
    const last = (s: JournalStep) => [...list].reverse().find((e) => e.step === s)?.detail ?? "";
    const started = list.find((e) => e.step === "STARTED");
    const kind: OperationKind = started?.kind ?? list.find((e) => e.kind)?.kind ?? "mejora";
    let outcome: OperationOutcome;
    let detail: string;
    if (has("COMPLETED") && !has("ROLLED_BACK")) {
      outcome = kind === "vuelta-atras" ? "vuelta-atras" : /vista previa/i.test(last("PROMOTED")) ? "aplicada" : "instalada";
      detail = [last("RECOVERED") || last("COMPLETED") || last("PROMOTED"), last("HEALTH_CHECK")].filter(Boolean).join(" · ");
    } else if (has("ROLLED_BACK")) {
      outcome = has("RECOVERED") ? "recuperada" : "restaurada";
      detail = [last("FAILED"), last("RECOVERED") || last("ROLLED_BACK")].filter(Boolean).join(" · ");
    } else if (has("RECOVERED")) {
      outcome = "recuperada";
      detail = last("RECOVERED");
    } else if (has("FAILED")) {
      outcome = "descartada";
      detail = last("FAILED");
    } else {
      outcome = op === running ? "en-curso" : "interrumpida";
      detail = list[list.length - 1]?.detail ?? "";
    }
    out.push({ op, kind, at: list[0]?.at ?? "", objective: started?.detail ?? "", outcome, detail, steps });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
