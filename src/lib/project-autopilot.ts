import { computeProgress, normalizePlan, type ProgressInfo, type ProjectPlan } from "@/lib/project-progress";
import type { Project } from "@/types/domain";

export const AUTOPILOT_KEY = "willy:project-autopilot:v1";
export const AUTOPILOT_ENABLED_KEY = "willy:project-autopilot:enabled";
export const AUTOPILOT_STALL_LIMIT = 3;
export const AUTOPILOT_COOLDOWN_MS = 6_000;

export type AutoProject = {
  project: Project;
  plan: ProjectPlan;
  progress: ProgressInfo;
};

export type AutoStamp = {
  signature: string;
  at: number;
  stalls: number;
  cycles: number;
};

type AutoMap = Record<string, AutoStamp>;

export function eligibleAutoProject(project: Project): AutoProject | null {
  if (project.state === "Pausado" || project.state === "Archivado" || project.state === "Listo") return null;
  if (!project.prompt?.trim()) return null;
  const plan = normalizePlan(project.plan ?? null);
  if (!plan || plan.attention) return null;
  const progress = computeProgress(plan);
  if (!progress.known || progress.percent === 100) return null;
  return { project, plan, progress };
}

export function autoSignature(item: AutoProject): string {
  const p = item.project;
  const x = item.progress;
  return [
    item.plan.updatedAt,
    item.plan.evidence.filesKey ?? "",
    p.fileCount ?? p.files?.length ?? 0,
    x.percent ?? -1,
    x.pending.length,
    x.phase,
  ].join("|");
}

export function readAutoMap(): AutoMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTOPILOT_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as AutoMap;
  } catch {
    return {};
  }
}

export function writeAutoStamp(projectId: string, stamp: AutoStamp): void {
  if (typeof window === "undefined") return;
  const map = readAutoMap();
  map[projectId] = stamp;
  window.localStorage.setItem(AUTOPILOT_KEY, JSON.stringify(map));
}

export function nextAutoStamp(item: AutoProject, now = Date.now()): AutoStamp {
  const sig = autoSignature(item);
  const prev = readAutoMap()[item.project.id];
  const same = prev?.signature === sig;
  return {
    signature: sig,
    at: now,
    stalls: same ? (prev.stalls ?? 0) + 1 : 0,
    cycles: (prev?.cycles ?? 0) + 1,
  };
}

export function autoContinuationPrompt(item: AutoProject): string {
  const { project, progress } = item;
  const next = progress.pending
    .slice(0, 5)
    .map((x, index) => `${index + 1}. [${x.milestone}] ${x.task.title}`)
    .join("\n");
  const objective = project.prompt.replace(/\s+/g, " ").trim().slice(0, 5_000);

  return [
    "AUTOPILOTO WILLY — CONTINÚA ESTE PROYECTO AHORA, SIN ESPERAR A QUE EL DUEÑO PULSE «CONTINUAR».",
    `PROYECTO: ${project.name}`,
    `FASE REAL: ${progress.phase}. PROGRESO: ${progress.percent ?? 0}%.`,
    "",
    "OBJETIVO ORIGINAL DEL DUEÑO:",
    objective,
    "",
    "PRIMER TRABAJO PENDIENTE (haz primero lo que desbloquea más avance):",
    next || "- Completa la validación y Definition of Done pendiente.",
    "",
    "REGLAS DEL AUTOPILOTO:",
    "- Trabaja SOBRE LOS ARCHIVOS REALES DEL PROYECTO. Nunca digas que no tienes acceso a ellos: WILLY te los adjunta como contexto.",
    "- No vuelvas a hacer una entrevista si el plan ya existe. Las decisiones técnicas razonables las tomas tú; pregunta solo decisiones de negocio/propietario que de verdad no puedan inferirse.",
    "- Esta vuelta debe producir avance verificable: archivos completos, documentación, pruebas o actualización real del plan. No entregues solo una explicación.",
    "- No uses rutas, nombres o endpoints que aparezcan como EJEMPLO en la documentación como si fueran requisitos del producto.",
    "- Conserva lo que ya funciona. Cambia el mínimo necesario y comprueba el resultado.",
    "- Si una tarea puede hacerse ya, hazla. Si depende de otra, resuelve primero la dependencia.",
    "- No declares FINAL_VERIFIED sin evidencias reales.",
  ].join("\n");
}

export function autoPilotEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const value = window.localStorage.getItem(AUTOPILOT_ENABLED_KEY);
  return value === null ? true : value !== "0";
}

export function setAutoPilotEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTOPILOT_ENABLED_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new CustomEvent("willy:project-autopilot-change", { detail: enabled }));
}
