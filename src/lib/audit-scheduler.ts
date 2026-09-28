/**
 * audit-scheduler.ts — auditorías automáticas programables por el dueño
 *
 * El dueño configura desde la UI cuándo quiere que WILLY revise el código:
 *   - Días de la semana (lunes, martes… o todos)
 *   - Hora del día (p. ej. 03:00)
 *   - Frecuencia: cada N semanas
 *
 * El scheduler corre en segundo plano (servidor) y ejecuta runTypeCheck()
 * cuando toca. Los resultados se guardan en datos-privados/auditorias-log.json
 * y se notifican al dueño en el Centro de Inteligencia.
 */

import { runTypeCheck, type AuditResult } from "@/lib/self-audit";

// ─────────────────────────── tipos públicos ───────────────────────────

/** 0 = domingo … 6 = sábado (igual que Date.getDay()) */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type AuditSchedule = {
  /** Activa o desactiva la auditoría automática. */
  enabled: boolean;
  /** Días de la semana en que se ejecuta (vacío = todos los días). */
  days: Weekday[];
  /** Hora local (0–23). */
  hour: number;
  /** Minuto local (0–59). */
  minute: number;
  /** Ejecutar cada N semanas (1 = todas las semanas). */
  everyWeeks: number;
};

export type AuditLogEntry = {
  id: string;
  startedAt: number;
  finishedAt: number;
  triggeredBy: "schedule" | "manual";
  result: AuditResult;
};

export type AuditState = {
  schedule: AuditSchedule;
  /** Última ejecución completada. */
  lastRun: AuditLogEntry | null;
  /** Si hay una auditoría en curso ahora mismo. */
  running: boolean;
};

// ─────────────────────────── defaults ────────────────────────────────

export const DEFAULT_SCHEDULE: AuditSchedule = {
  enabled: false,
  days: [],        // todos los días
  hour: 3,
  minute: 0,
  everyWeeks: 1,
};

// ─────────────────────────── persistencia ────────────────────────────

const SCHEDULE_FILE = "auditorias-config.json";
const LOG_FILE = "auditorias-log.json";
const MAX_LOG_ENTRIES = 50;

async function modules() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return { fs, path };
}

async function privateDir(dataDir: string): Promise<string> {
  const { path } = await modules();
  return path.join(dataDir, "datos-privados");
}

export async function loadSchedule(dataDir: string): Promise<AuditSchedule> {
  try {
    const { fs, path } = await modules();
    const raw = await fs.readFile(path.join(await privateDir(dataDir), SCHEDULE_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<AuditSchedule>;
    return {
      enabled: parsed.enabled === true,
      days: Array.isArray(parsed.days) ? (parsed.days as number[]).filter((d) => d >= 0 && d <= 6) as Weekday[] : [],
      hour: Number.isInteger(parsed.hour) && (parsed.hour as number) >= 0 && (parsed.hour as number) <= 23 ? parsed.hour as number : DEFAULT_SCHEDULE.hour,
      minute: Number.isInteger(parsed.minute) && (parsed.minute as number) >= 0 && (parsed.minute as number) <= 59 ? parsed.minute as number : DEFAULT_SCHEDULE.minute,
      everyWeeks: Number.isInteger(parsed.everyWeeks) && (parsed.everyWeeks as number) >= 1 ? parsed.everyWeeks as number : 1,
    };
  } catch {
    return structuredClone(DEFAULT_SCHEDULE);
  }
}

export async function saveSchedule(dataDir: string, schedule: AuditSchedule): Promise<void> {
  const { fs, path } = await modules();
  const dir = await privateDir(dataDir);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, SCHEDULE_FILE + ".tmp");
  await fs.writeFile(tmp, JSON.stringify(schedule, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path.join(dir, SCHEDULE_FILE));
}

export async function loadLog(dataDir: string): Promise<AuditLogEntry[]> {
  try {
    const { fs, path } = await modules();
    const raw = await fs.readFile(path.join(await privateDir(dataDir), LOG_FILE), "utf8");
    return (JSON.parse(raw) as AuditLogEntry[]).slice(-MAX_LOG_ENTRIES);
  } catch {
    return [];
  }
}

async function appendLog(dataDir: string, entry: AuditLogEntry): Promise<void> {
  const { fs, path } = await modules();
  const dir = await privateDir(dataDir);
  const file = path.join(dir, LOG_FILE);
  let entries: AuditLogEntry[] = [];
  try {
    entries = JSON.parse(await fs.readFile(file, "utf8")) as AuditLogEntry[];
  } catch { /* primera vez */ }
  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) entries = entries.slice(-MAX_LOG_ENTRIES);
  const tmp = file + ".tmp";
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

// ─────────────────────────── lógica de horario ───────────────────────

/** ¿Toca ejecutar ahora? Comprueba día, hora y frecuencia semanal. */
export function shouldRunNow(schedule: AuditSchedule, lastRun: AuditLogEntry | null, now: Date): boolean {
  if (!schedule.enabled) return false;

  // Comprobar hora (ventana de ±1 minuto)
  if (now.getHours() !== schedule.hour) return false;
  if (Math.abs(now.getMinutes() - schedule.minute) > 1) return false;

  // Comprobar día de la semana
  if (schedule.days.length > 0 && !schedule.days.includes(now.getDay() as Weekday)) return false;

  // Comprobar frecuencia semanal: no volver a ejecutar en la misma ventana
  if (lastRun) {
    const msSinceLast = now.getTime() - lastRun.startedAt;
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    if (msSinceLast < schedule.everyWeeks * msPerWeek - 2 * 60 * 1000) return false;
  }

  return true;
}

/** Próxima ejecución programada (para mostrar al dueño). */
export function nextRunAt(schedule: AuditSchedule, from: Date = new Date()): Date | null {
  if (!schedule.enabled) return null;

  const weekdays = schedule.days.length > 0 ? schedule.days : ([0, 1, 2, 3, 4, 5, 6] as Weekday[]);
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setHours(schedule.hour, schedule.minute);

  // Si la hora de hoy ya pasó o no es el día correcto, buscar el próximo
  if (candidate <= from || !weekdays.includes(candidate.getDay() as Weekday)) {
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(schedule.hour, schedule.minute, 0, 0);
    for (let i = 0; i < 7; i++) {
      if (weekdays.includes(candidate.getDay() as Weekday)) break;
      candidate.setDate(candidate.getDate() + 1);
    }
  }

  return candidate;
}

// ─────────────────────────── runner en background ────────────────────

let runnerState: {
  running: boolean;
  lastEntry: AuditLogEntry | null;
  timer: ReturnType<typeof setInterval> | null;
} = { running: false, lastEntry: null, timer: null };

/**
 * Arranca el ticker del scheduler (llamar una vez al iniciar el servidor).
 * Comprueba cada minuto si toca ejecutar la auditoría.
 */
export function startScheduler(dataDir: string, projectRoot: string): void {
  if (runnerState.timer) return; // ya arrancado

  // Cargar el último log al inicio
  void loadLog(dataDir).then((entries) => {
    runnerState.lastEntry = entries[entries.length - 1] ?? null;
  });

  runnerState.timer = setInterval(() => {
    void (async () => {
      if (runnerState.running) return;
      const schedule = await loadSchedule(dataDir);
      if (!shouldRunNow(schedule, runnerState.lastEntry, new Date())) return;

      runnerState.running = true;
      const id = `${Date.now()}-auto`;
      const startedAt = Date.now();
      try {
        const result = await runTypeCheck(projectRoot);
        const entry: AuditLogEntry = { id, startedAt, finishedAt: Date.now(), triggeredBy: "schedule", result };
        await appendLog(dataDir, entry);
        runnerState.lastEntry = entry;
      } catch {
        // error al auditar: no bloquear el scheduler
      } finally {
        runnerState.running = false;
      }
    })();
  }, 60_000); // cada minuto
}

export function stopScheduler(): void {
  if (runnerState.timer) {
    clearInterval(runnerState.timer);
    runnerState.timer = null;
  }
}

/** Estado actual del scheduler (para la UI). */
export function getSchedulerState(schedule: AuditSchedule): Omit<AuditState, "schedule"> {
  return {
    lastRun: runnerState.lastEntry,
    running: runnerState.running,
  };
}

/**
 * Ejecutar una auditoría ahora mismo (disparada manualmente por el dueño).
 * Devuelve el resultado y lo guarda en el log.
 */
export async function runAuditNow(dataDir: string, projectRoot: string): Promise<AuditLogEntry> {
  if (runnerState.running) throw new Error("Ya hay una auditoría en curso.");
  runnerState.running = true;
  const id = `${Date.now()}-manual`;
  const startedAt = Date.now();
  try {
    const result = await runTypeCheck(projectRoot);
    const entry: AuditLogEntry = { id, startedAt, finishedAt: Date.now(), triggeredBy: "manual", result };
    await appendLog(dataDir, entry);
    runnerState.lastEntry = entry;
    return entry;
  } finally {
    runnerState.running = false;
  }
}
