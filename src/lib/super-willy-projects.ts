// SUPER WILLY ↔ PROYECTOS (revisión 19). Si WILLY ya lo está construyendo, ES UN PROYECTO: nace al empezar la entrevista (o al
// construir sin preguntas), aparece solo en Proyectos y guarda en tu equipo su conversación, su entrevista y los archivos que
// genera (cada construcción, una versión restaurable). La pantalla de SUPER WILLY solo llama a estas funciones.

import { openView } from "@/lib/background-tasks";
import { applyAnswer } from "@/lib/project-work";
import { cutDelivery } from "@/lib/answer-check";
import { projectService } from "@/services/project-service";
import { fetchProjectSession, fetchVersion, saveProjectSession } from "@/services/disk-project-service";
import { compareFiles } from "@/lib/line-diff";
import { saveSession, sessionOfProject, type WorkSession } from "@/services/worklog";
import type { GeneratedFile, Project, ProjectVersion } from "@/types/domain";

/** Proyectos pide a SUPER WILLY que abra un proyecto (con su conversación). */
export const OPEN_PROJECT_EVENT = "willy:abrir-proyecto";
let pendingOpen: string | null = null;

/** Abre este proyecto en SUPER WILLY (aunque la pestaña aún no se haya abierto nunca: lo recoge al abrirse). */
export function requestOpenProject(projectId: string): void {
  if (typeof window === "undefined") return;
  pendingOpen = projectId;
  window.dispatchEvent(new CustomEvent<string>(OPEN_PROJECT_EVENT, { detail: projectId }));
  openView("superia");
}

/** El proyecto que se pidió abrir y aún no se ha abierto (se consume al leerlo). */
export function takePendingProject(): string | null {
  const id = pendingOpen;
  pendingOpen = null;
  return id;
}

/** Nombre que ya se ha puesto (o intentado poner) a cada proyecto, para no renombrarlo en cada guardado. */
const knownName = new Map<string, string>();

/**
 * Crea el proyecto de este trabajo si aún no lo tiene (si el nombre ya existe, lo numera: «App de peluquería 2»).
 * Devuelve el trabajo enlazado; si no se pudo crear (WILLY no responde), el trabajo sigue igual y se reintenta después.
 */
export async function ensureProject(session: WorkSession, info: { name: string; idea: string; kind?: string }): Promise<{ session: WorkSession; project: Project | null }> {
  if (session.projectId) return { session, project: null };
  const base = info.name.trim().slice(0, 70) || "Proyecto de SUPER WILLY";
  const input = { desc: info.idea.trim().replace(/\s+/g, " ").slice(0, 140), prompt: info.idea, origin: "super-willy" as const, sessionId: session.id, ...(info.kind ? { kind: info.kind } : {}) };
  let r = await projectService.create({ ...input, name: base });
  for (let n = 2; !r.ok && /Ya existe/.test(r.error) && n < 20; n++) r = await projectService.create({ ...input, name: `${base} ${n}` });
  if (!r.ok) return { session, project: null };
  knownName.set(r.data.id, r.data.name);
  return { session: { ...session, projectId: r.data.id }, project: r.data };
}

// ------------------------------------------------------------------------------------ conversación guardada en el disco
const pending = new Map<string, { timer: number; session: WorkSession }>();

function flush(projectId: string): void {
  const item = pending.get(projectId);
  if (!item) return;
  window.clearTimeout(item.timer);
  pending.delete(projectId);
  void saveProjectSession(projectId, item.session);
  const name = item.session.discovery?.name?.trim();
  if (name && knownName.get(projectId) !== name) {
    knownName.set(projectId, name);
    void projectService.rename(projectId, name);
  }
}

/** Guarda la conversación en su proyecto (en tu equipo) poco después del último cambio: así no se escribe en cada tecla. */
export function syncSessionToProject(session: WorkSession): void {
  const projectId = session.projectId;
  if (!projectId || typeof window === "undefined") return;
  const prev = pending.get(projectId);
  if (prev) window.clearTimeout(prev.timer);
  pending.set(projectId, { session, timer: window.setTimeout(() => flush(projectId), 1200) });
}

// Si se cierra la pestaña justo después de un cambio, lo pendiente se envía igualmente.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const [projectId, item] of pending) {
      window.clearTimeout(item.timer);
      const body = JSON.stringify({ action: "saveSession", id: projectId, session: item.session });
      const sent = typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && /^https?:$/.test(window.location?.protocol ?? "")
        && navigator.sendBeacon("/api/proyectos", new Blob([body], { type: "application/json" }));
      if (!sent) void saveProjectSession(projectId, item.session);
    }
    pending.clear();
  });
}

function isSession(value: unknown): value is WorkSession {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v["id"] === "string" && typeof v["prompt"] === "string" && typeof v["answer"] === "string"
    && Array.isArray(v["done"]) && Array.isArray(v["accepted"]) && Array.isArray(v["rejected"]) && Array.isArray(v["pending"])
    && typeof v["updatedAt"] === "number";
}

/**
 * La conversación de un proyecto: la de este navegador o la guardada en el equipo, la más reciente (así se puede seguir
 * desde otro navegador o después de borrar los datos del navegador). Queda como trabajo actual en este navegador.
 */
export async function loadProjectSession(projectId: string): Promise<WorkSession | null> {
  const local = sessionOfProject(projectId);
  const remote = await fetchProjectSession(projectId).catch(() => null);
  const disk = isSession(remote) ? { ...remote, projectId } : null;
  const best = !local ? disk : !disk ? local : disk.updatedAt > local.updatedAt ? disk : local;
  if (!best) return null;
  const saved = saveSession(best);
  if (saved.discovery?.name) knownName.set(projectId, saved.discovery.name);
  return saved;
}

// ------------------------------------------------------------------------------------------------ archivos generados
/** Une archivos: los nuevos sustituyen a los del mismo nombre (sin distinguir mayúsculas, como Windows); el resto se conserva. */
export function mergeFiles(base: GeneratedFile[], incoming: GeneratedFile[]): GeneratedFile[] {
  const out = new Map<string, GeneratedFile>();
  for (const f of base) out.set(f.path.toLowerCase(), f);
  for (const f of incoming) out.set(f.path.toLowerCase(), f);
  return [...out.values()];
}

export type SavedAnswer = {
  saved: number; total: number; changed: string[]; added: string[]; rejected: Array<{ path: string; reason: string }>;
  /** (25/09/2026) La respuesta se cortó a mitad de este archivo (no se guarda) y lo que la IA dice que no le ha cabido («FALTAN: …»). */
  cut: string | null; pending: string[];
};

/**
 * Guarda en el proyecto los archivos que trae una respuesta, como versión nueva. Una respuesta suele traer solo lo que
 * cambia: por eso se UNEN con los que ya había (nunca se pierden los demás), y también se aplican las sustituciones
 * SEARCH/REPLACE. Desde la revisión 21 cada archivo se comprueba antes: uno cortado o con «... resto igual» NO se guarda (se
 * conserva el bueno y se dice en `rejected`). Si no se pueden leer los actuales, no se guarda nada (para no pisar el proyecto
 * con una parte). null = la respuesta no traía archivos.
 */
export async function saveAnswerFiles(projectId: string, text: string, label: string): Promise<SavedAnswer | null> {
  // Sin ningún bloque de código ni archivo no hay nada que guardar (una pregunta, una explicación): ni se lee el proyecto.
  if (!/```|<file\s|^(?:#{1,6}\s*)?(?:FILE|PATH|ARCHIVO|RUTA)?\s*[:=-]?\s*[`"']?(?:src|public)\//im.test(text)) return null;
  const current = await projectService.get(projectId);
  if (!current) return null;
  // Un archivo cortado por el límite de la respuesta no se guarda a medias: se dice y WILLY pide que siga.
  const delivery = cutDelivery(text);
  const applied = applyAnswer(current.files, delivery.text);
  const saved = applied.changed.length + applied.added.length;
  const rejected = delivery.cutPath ? [...applied.rejected, { path: delivery.cutPath, reason: `${delivery.cutPath}: la respuesta se cortó a mitad de este archivo (límite de tamaño de la IA).` }] : applied.rejected;
  const result: SavedAnswer = { saved, total: applied.files.length, changed: applied.changed, added: applied.added, rejected, cut: delivery.cutPath, pending: delivery.pending };
  if (!saved) return rejected.length ? { ...result, total: current.files.length } : null;
  const r = await projectService.saveFiles(projectId, applied.files, label);
  if (!r.ok) return null;
  if (current.state === "Borrador") void projectService.setState(projectId, "Activo");
  return result;
}

/**
 * «Vuelve a la versión anterior» (rediseño, punto 92): la versión guardada más reciente que NO es igual a lo que hay ahora
 * (es decir, cómo estaba antes del último cambio). null si no hay ninguna distinta.
 */
export async function previousVersionOf(projectId: string): Promise<ProjectVersion | null> {
  const current = await projectService.get(projectId);
  if (!current) return null;
  for (const entry of (await projectService.versions(projectId)).slice(0, 6)) {
    const version = await fetchVersion(entry.id);
    if (version && compareFiles(version.files, current.files).length) return version;
  }
  return null;
}
