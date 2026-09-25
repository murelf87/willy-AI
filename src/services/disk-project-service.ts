// Proyectos guardados EN TU EQUIPO (revisión 19): la interfaz habla con el servidor de WILLY (/api/proyectos), que los guarda
// en «datos-privados/proyectos». Es la única fuente de verdad: Proyectos, SUPER WILLY, el Chat y el móvil ven lo mismo.

import {
  fail, ok, type GeneratedFile, type Project, type ProjectInput, type ProjectPatch, type ProjectState, type ProjectVersion,
  type ServiceResult,
} from "@/types/domain";
import { pushNotice } from "@/lib/notifications";
import { normalizePlan, type ProjectPlan } from "@/lib/project-progress";
import type { CaptureResult } from "@/lib/design-review";
import type { CompileOutcome } from "@/lib/project-compile";
import type { InstallResult, LibraryInfo, LibraryList, RemoveResult } from "@/lib/project-libraries";
import type { TranspiledTest } from "@/lib/project-tests";
import type { ProjectService } from "./project-service";

const URL_BASE = "/api/proyectos";
/** Aviso interno: los proyectos han cambiado (la lista se vuelve a leer). */
export const PROJECTS_EVENT = "willy:proyectos";

export function projectsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROJECTS_EVENT));
}

const NO_SERVER = "No se pudo hablar con WILLY en tu equipo. Comprueba que sigue abierto e inténtalo de nuevo.";

async function readJsonResponse<T>(res: Response): Promise<ServiceResult<T> & { skipped?: string[] }> {
  try {
    const body = (await res.json()) as { ok?: boolean; data?: T; error?: string; skipped?: string[] };
    if (body && body.ok === true) return { ok: true, data: body.data as T, ...(Array.isArray(body.skipped) ? { skipped: body.skipped } : {}) };
    return fail<T>(typeof body?.error === "string" ? body.error : NO_SERVER);
  } catch {
    return fail<T>(NO_SERVER);
  }
}

async function getJson<T>(query: string): Promise<ServiceResult<T>> {
  try {
    return await readJsonResponse<T>(await fetch(`${URL_BASE}${query}`, { cache: "no-store" }));
  } catch {
    return fail<T>(NO_SERVER);
  }
}

async function post<T>(action: string, body: Record<string, unknown>): Promise<ServiceResult<T> & { skipped?: string[] }> {
  try {
    const res = await fetch(URL_BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
    return await readJsonResponse<T>(res);
  } catch {
    return fail<T>(NO_SERVER);
  }
}

const enc = encodeURIComponent;

export class DiskProjectService implements ProjectService {
  /** Última lista leída: si un momento no se puede leer, se enseña lo último en vez de «no tienes proyectos». */
  private last: { list: Project[] | null; trash: Project[] | null } = { list: null, trash: null };

  async list() {
    const r = await getJson<Project[]>("");
    if (r.ok) this.last.list = r.data;
    return r.ok ? r.data : (this.last.list ?? []);
  }

  async trash() {
    const r = await getJson<Project[]>("?papelera=1");
    if (r.ok) this.last.trash = r.data;
    return r.ok ? r.data : (this.last.trash ?? []);
  }

  async get(id: string) {
    const r = await getJson<Project>(`?id=${enc(id)}`);
    return r.ok ? r.data : undefined;
  }

  private async change<T>(action: string, body: Record<string, unknown>): Promise<ServiceResult<T>> {
    const r = await post<T>(action, body);
    if (r.ok) projectsChanged();
    return r.ok ? ok(r.data) : fail<T>(r.error);
  }

  create(input: ProjectInput) {
    return this.change<Project>("create", { input });
  }

  rename(id: string, name: string) {
    return this.change<Project>("rename", { id, name });
  }

  duplicate(id: string) {
    return this.change<Project>("duplicate", { id });
  }

  setState(id: string, state: ProjectState) {
    return this.change<Project>("setState", { id, state });
  }

  update(id: string, patch: ProjectPatch) {
    return this.change<Project>("update", { id, patch });
  }

  async saveFiles(id: string, files: GeneratedFile[], label: string) {
    const r = await post<Project>("saveFiles", { id, files, label });
    if (!r.ok) return fail<Project>(r.error);
    projectsChanged();
    if (r.skipped?.length) {
      pushNotice(`⚠️ ${r.skipped.length} archivo(s) no se guardaron por tener un nombre o un tamaño no válido: ${r.skipped.slice(0, 3).join(", ")}${r.skipped.length > 3 ? "…" : ""}`);
    }
    return ok(r.data);
  }

  softDelete(id: string) {
    return this.change<true>("softDelete", { id });
  }

  restore(id: string) {
    return this.change<Project>("restore", { id });
  }

  destroy(id: string) {
    return this.change<true>("destroy", { id });
  }

  async versions(projectId: string): Promise<ProjectVersion[]> {
    const r = await getJson<ProjectVersion[]>(`?id=${enc(projectId)}&versiones=1`);
    return r.ok ? r.data : [];
  }

  restoreVersion(versionId: string) {
    return this.change<Project>("restoreVersion", { versionId });
  }
}

/** Una versión con sus archivos (para comparar). */
export async function fetchVersion(versionId: string): Promise<ProjectVersion | null> {
  const r = await getJson<ProjectVersion>(`?version=${enc(versionId)}`);
  return r.ok ? r.data : null;
}

/** La conversación de SUPER WILLY guardada en el proyecto (o null si no tiene). */
export async function fetchProjectSession(projectId: string): Promise<unknown> {
  const r = await getJson<unknown>(`?id=${enc(projectId)}&sesion=1`);
  return r.ok ? r.data : null;
}

/** Guarda la conversación de SUPER WILLY dentro del proyecto, en el disco de tu equipo. */
export async function saveProjectSession(projectId: string, session: unknown): Promise<ServiceResult<true>> {
  const r = await post<true>("saveSession", { id: projectId, session });
  return r.ok ? ok(true as const) : fail<true>(r.error);
}

/** El plan del proyecto (rev23): de él sale su progreso. null si no tiene (o si no se ha podido leer). */
export async function fetchProjectPlan(projectId: string): Promise<ProjectPlan | null> {
  const r = await getJson<unknown>(`?id=${enc(projectId)}&plan=1`);
  return r.ok ? normalizePlan(r.data) : null;
}

/** Guarda el plan del proyecto. Con `touch`, cuenta como actividad (sube en «Actividad reciente»). */
export async function saveProjectPlan(projectId: string, plan: ProjectPlan, opts: { touch?: boolean } = {}): Promise<ServiceResult<ProjectPlan>> {
  const r = await post<unknown>("savePlan", { id: projectId, plan, touch: Boolean(opts.touch) });
  if (!r.ok) return fail<ProjectPlan>(r.error);
  projectsChanged();
  const clean = normalizePlan(r.data);
  return clean ? ok(clean) : fail<ProjectPlan>("El plan guardado no es válido.");
}

export type ImportItem = { id: string; name: string; status: "importado" | "ya-estaba" | "error"; files: number; versions: number; example: boolean; error?: string };

/** Pasa al disco los proyectos que había en este navegador. */
export async function importBrowserProjects(projects: Project[], versions: ProjectVersion[]): Promise<ServiceResult<ImportItem[]>> {
  const r = await post<ImportItem[]>("import", { projects, versions });
  if (r.ok) projectsChanged();
  return r.ok ? ok(r.data) : fail<ImportItem[]>(r.error);
}

/**
 * Rev24 · Capturas de verdad de la página que estás viendo (ordenador, tableta y móvil), hechas en tu equipo con Edge o Chrome
 * sin ventana. Tarda unos segundos; si no hay navegador, lo dice (la revisión automática del diseño se hace igual).
 */
export async function captureProjectPage(projectId: string, page: string | null, hash: string | null): Promise<ServiceResult<CaptureResult>> {
  return await post<CaptureResult>("capturas", { id: projectId, page, hash });
}

/**
 * Rev25 · Compila en tu equipo un proyecto React/Vite (sus archivos guardados) con las piezas que ya trae WILLY, para verlo en
 * la vista previa. Devuelve la página compilada o sus errores (con archivo y línea) y las librerías que faltan.
 */
export async function compileProjectPreview(projectId: string, versionId?: string): Promise<ServiceResult<CompileOutcome>> {
  return await post<CompileOutcome>("compilar", { id: projectId, ...(versionId ? { versionId } : {}) });
}

/** Rev28 · Pruebas del proyecto escritas en TypeScript, sin tipos (las lee el TypeScript de WILLY en tu equipo; no se ejecuta nada). */
export async function transpileProjectTests(files: Array<{ path: string; content: string }>): Promise<ServiceResult<TranspiledTest[]>> {
  return await post<TranspiledTest[]>("transpilarPruebas", { archivos: files.map((f) => ({ path: f.path, content: f.content })) });
}

/** Rev27 · Las librerías instaladas para los proyectos (sin npm), con lo que ocupan. */
export async function fetchProjectLibraries(): Promise<ServiceResult<LibraryList>> {
  return await post<LibraryList>("librerias", {});
}
/** Rev27 · Qué se sabe de unas librerías que faltan (si existen, qué versión, si son conocidas, si el proyecto las declara). */
export async function inspectProjectLibraries(projectId: string, names: string[]): Promise<ServiceResult<LibraryInfo[]>> {
  return await post<LibraryInfo[]>("infoLibrerias", { id: projectId, nombres: names });
}
/** Rev27 · Instala librerías para un proyecto desde internet, sin npm. Con `auto`, solo las que se pueden instalar solas. */
export async function installProjectLibraries(projectId: string, names: string[], opts: { auto?: boolean } = {}): Promise<ServiceResult<InstallResult>> {
  return await post<InstallResult>("instalarLibrerias", { id: projectId, nombres: names, auto: Boolean(opts.auto) });
}
/** Rev27 · Quita una librería instalada (y lo que solo ella necesitaba). */
export async function removeProjectLibrary(name: string): Promise<ServiceResult<RemoveResult>> {
  return await post<RemoveResult>("quitarLibreria", { nombre: name });
}
