// Contrato de proyectos y quién lo cumple.
// Desde la revisión 19 los proyectos se guardan EN TU EQUIPO (DiskProjectService → /api/proyectos → datos-privados/proyectos):
// es la única fuente de verdad para Proyectos, SUPER WILLY, el Chat y el móvil. El adaptador del navegador (LocalProjectService)
// queda solo para leer lo de antes y para pruebas; ya no siembra proyectos de ejemplo.

import { useEffect, useState } from "react";
import {
  fail, isExampleProject, newId, ok, type GeneratedFile, type Project, type ProjectInput, type ProjectPatch,
  type ProjectState, type ProjectVersion, type ServiceResult,
} from "@/types/domain";
import { pushNotice } from "@/lib/notifications";
import { readList, subscribe, write } from "./storage";
import { ApiProjectService } from "./api-project-service";
import { backendOn } from "./backend";
import { DiskProjectService, PROJECTS_EVENT } from "./disk-project-service";
import { linkLegacySessions, migrateBrowserProjects, migrationSummary } from "./project-migration";
import { VERSIONS_KEY, findVersion, versionsOf } from "./project-versions";

const KEY = "willy-projects";

export interface ProjectService {
  list(): Promise<Project[]>;
  trash(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  create(input: ProjectInput): Promise<ServiceResult<Project>>;
  rename(id: string, name: string): Promise<ServiceResult<Project>>;
  duplicate(id: string): Promise<ServiceResult<Project>>;
  setState(id: string, state: ProjectState): Promise<ServiceResult<Project>>;
  /** Cambia datos de la ficha (descripción, tipo, conversación de SUPER WILLY…). */
  update(id: string, patch: ProjectPatch): Promise<ServiceResult<Project>>;
  saveFiles(id: string, files: GeneratedFile[], label: string): Promise<ServiceResult<Project>>;
  softDelete(id: string): Promise<ServiceResult<true>>;
  restore(id: string): Promise<ServiceResult<Project>>;
  destroy(id: string): Promise<ServiceResult<true>>;
  versions(projectId: string): Promise<ProjectVersion[]>;
  restoreVersion(versionId: string): Promise<ServiceResult<Project>>;
}

function now() {
  return new Date().toISOString();
}

function makeProject(input: ProjectInput): Project {
  const at = now();
  return {
    id: newId("prj"),
    name: input.name.trim(),
    desc: input.desc?.trim() ?? "",
    state: input.state ?? "Borrador",
    icon: input.icon ?? "folder",
    prompt: input.prompt ?? "",
    files: [],
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    // Solo se guarda si es innovador o réplica: así un proyecto normal queda igual que los de siempre.
    ...(input.mode && input.mode !== "standard" ? { mode: input.mode } : {}),
    ...(input.origin ? { origin: input.origin } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
}

/** Lo que hay en el navegador (de antes). Ya NO se siembran los 6 ejemplos cuando está vacío. */
function readAll(): Project[] {
  return readList<Project>(KEY, []);
}

function writeAll(list: Project[]) {
  write(KEY, list);
}

/** Adaptador del navegador (el de antes de la rev19): solo para leer lo antiguo y para pruebas. */
class LocalProjectService implements ProjectService {
  async list() {
    return readAll().filter((p) => !p.deletedAt);
  }

  async trash() {
    return readAll().filter((p) => p.deletedAt);
  }

  async get(id: string) {
    return readAll().find((p) => p.id === id);
  }

  async create(input: ProjectInput) {
    const name = input.name.trim();
    if (!name) return fail<Project>("El proyecto necesita un nombre.");
    const all = readAll();
    if (all.some((p) => !p.deletedAt && p.name.toLowerCase() === name.toLowerCase())) {
      return fail<Project>(`Ya existe un proyecto llamado «${name}».`);
    }
    const project = makeProject({ ...input, name });
    writeAll([project, ...all]);
    return ok(project);
  }

  private async patch(id: string, patch: (p: Project) => Project): Promise<ServiceResult<Project>> {
    const all = readAll();
    const index = all.findIndex((p) => p.id === id);
    if (index < 0) return fail<Project>("Ese proyecto ya no existe.");
    const updated = { ...patch(all[index]!), updatedAt: now() };
    const next = [...all];
    next[index] = updated;
    writeAll(next);
    return ok(updated);
  }

  async rename(id: string, name: string) {
    const clean = name.trim();
    if (!clean) return fail<Project>("El nombre no puede quedar vacío.");
    const all = readAll();
    if (all.some((p) => p.id !== id && !p.deletedAt && p.name.toLowerCase() === clean.toLowerCase())) {
      return fail<Project>(`Ya existe un proyecto llamado «${clean}».`);
    }
    return this.patch(id, (p) => ({ ...p, name: clean }));
  }

  async duplicate(id: string) {
    const all = readAll();
    const source = all.find((p) => p.id === id);
    if (!source) return fail<Project>("Ese proyecto ya no existe.");
    const base = `${source.name} (copia)`;
    let name = base;
    let n = 2;
    while (all.some((p) => !p.deletedAt && p.name === name)) name = `${base} ${n++}`;
    const { sessionId: _session, origin: _origin, ...rest } = source;
    const copy: Project = { ...rest, id: newId("prj"), name, createdAt: now(), updatedAt: now(), deletedAt: null };
    writeAll([copy, ...all]);
    return ok(copy);
  }

  async setState(id: string, state: ProjectState) {
    return this.patch(id, (p) => ({ ...p, state }));
  }

  async update(id: string, patch: ProjectPatch) {
    return this.patch(id, (p) => ({
      ...p,
      ...(patch.desc !== undefined ? { desc: patch.desc } : {}),
      ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      ...(patch.icon ? { icon: patch.icon } : {}),
      ...(patch.origin ? { origin: patch.origin } : {}),
      ...(patch.kind ? { kind: patch.kind } : {}),
      ...(patch.sessionId ? { sessionId: patch.sessionId } : {}),
    }));
  }

  async saveFiles(id: string, files: GeneratedFile[], label: string) {
    const result = await this.patch(id, (p) => ({ ...p, files }));
    if (!result.ok) return result;
    const version: ProjectVersion = { id: newId("ver"), projectId: id, label, at: now(), files };
    const versions = readList<ProjectVersion>(VERSIONS_KEY, []);
    write(VERSIONS_KEY, [version, ...versions].slice(0, 60));
    return result;
  }

  async softDelete(id: string) {
    const result = await this.patch(id, (p) => ({ ...p, deletedAt: now() }));
    return result.ok ? ok(true as const) : fail<true>(result.error);
  }

  async restore(id: string) {
    return this.patch(id, (p) => ({ ...p, deletedAt: null }));
  }

  async destroy(id: string) {
    const all = readAll();
    if (!all.some((p) => p.id === id)) return fail<true>("Ese proyecto ya no existe.");
    writeAll(all.filter((p) => p.id !== id));
    write(VERSIONS_KEY, readList<ProjectVersion>(VERSIONS_KEY, []).filter((v) => v.projectId !== id));
    return ok(true as const);
  }

  async versions(projectId: string) {
    return versionsOf(projectId);
  }

  async restoreVersion(versionId: string) {
    const version = findVersion(versionId);
    if (!version) return fail<Project>("Esa versión ya no está disponible.");
    return this.patch(version.projectId, (p) => ({ ...p, files: version.files }));
  }
}

export const localProjectService: ProjectService = new LocalProjectService();

const remote = new ApiProjectService();
const disk = new DiskProjectService();

/** Con el servidor opcional conectado (Ajustes avanzados) manda ese servidor; si no, tu equipo. */
function pick(): ProjectService {
  return backendOn() ? remote : disk;
}

export const projectService: ProjectService = {
  list: () => pick().list(),
  trash: () => pick().trash(),
  get: (id) => pick().get(id),
  create: (input) => pick().create(input),
  rename: (id, name) => pick().rename(id, name),
  duplicate: (id) => pick().duplicate(id),
  setState: (id, state) => pick().setState(id, state),
  update: (id, patch) => pick().update(id, patch),
  saveFiles: (id, files, label) => pick().saveFiles(id, files, label),
  softDelete: (id) => pick().softDelete(id),
  restore: (id) => pick().restore(id),
  destroy: (id) => pick().destroy(id),
  versions: (id) => pick().versions(id),
  restoreVersion: (id) => pick().restoreVersion(id),
};

/** Antes de la primera lectura, los proyectos que hubiera en este navegador pasan al disco (una sola vez). */
let migration: Promise<void> | null = null;
function ensureMigrated(): Promise<void> {
  if (backendOn()) return Promise.resolve();
  migration ??= migrateBrowserProjects()
    .then(async (r) => {
      const text = r ? migrationSummary(r) : null;
      if (text) pushNotice(text);
      if (r?.errors.length) migration = null; // se reintenta la próxima vez
      // Las entrevistas de SUPER WILLY de antes pasan a ser proyectos (aparecen en Proyectos).
      const linked = await linkLegacySessions();
      if (linked) pushNotice(`${linked} proyecto(s) de SUPER WILLY añadidos a Proyectos.`);
    })
    .catch(() => {
      migration = null;
    });
  return migration;
}

/** Vuelve a leer cuando algo cambia: en esta pestaña, al volver a ella y, mientras se ve, cada 20 s (otra pestaña o el móvil). */
function watchProjects(load: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const offKey = subscribe(KEY, load);
  const onVisible = () => {
    if (document.visibilityState === "visible") load();
  };
  window.addEventListener(PROJECTS_EVENT, load);
  window.addEventListener("focus", load);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") load();
  }, 20_000);
  return () => {
    offKey();
    window.removeEventListener(PROJECTS_EVENT, load);
    window.removeEventListener("focus", load);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}

// Una sola lista compartida por todas las pantallas (varias la usan a la vez): una sola lectura y un solo vigilante.
type ProjectsSnapshot = { projects: Project[]; trashed: Project[]; loading: boolean };
let snapshot: ProjectsSnapshot = { projects: [], trashed: [], loading: true };
const subscribers = new Set<(s: ProjectsSnapshot) => void>();
let inflight: Promise<void> | null = null;
let again = false;
let stopWatching: (() => void) | null = null;

/** Vuelve a leer la lista. Si ya se está leyendo, se lee otra vez al acabar (para no perder un cambio hecho a mitad). */
export function reloadProjects(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    do {
      again = false;
      await ensureMigrated();
      const [projects, trashed] = await Promise.all([projectService.list(), projectService.trash()]);
      snapshot = { projects, trashed, loading: false };
      subscribers.forEach((fn) => fn(snapshot));
    } while (again);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Lista viva de proyectos; se actualiza sola al crear, renombrar o borrar (aquí, en otra pestaña o en el móvil). */
export function useProjects(): ProjectsSnapshot {
  const [state, setState] = useState<ProjectsSnapshot>(snapshot);
  useEffect(() => {
    subscribers.add(setState);
    if (subscribers.size === 1) stopWatching = watchProjects(() => void reloadProjects());
    void reloadProjects();
    return () => {
      subscribers.delete(setState);
      if (!subscribers.size && stopWatching) {
        stopWatching();
        stopWatching = null;
      }
    };
  }, []);
  return state;
}

/**
 * Un proyecto CON sus archivos (el taller de SUPER WILLY). Se vuelve a leer solo cuando cambia (guardar archivos, restaurar
 * una versión, cambiar su estado…), aquí o desde otra pantalla.
 */
export function useProject(projectId: string | undefined): { project: Project | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ project: Project | null; loading: boolean }>({ project: null, loading: Boolean(projectId) });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!projectId) {
      setState({ project: null, loading: false });
      return;
    }
    let alive = true;
    const load = () => void projectService.get(projectId).then((p) => { if (alive) setState({ project: p ?? null, loading: false }); });
    setState((s) => ({ project: s.project?.id === projectId ? s.project : null, loading: true }));
    load();
    window.addEventListener(PROJECTS_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(PROJECTS_EVENT, load);
    };
  }, [projectId, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useVersions(projectId: string | undefined) {
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  useEffect(() => {
    if (!projectId) return setVersions([]);
    let alive = true;
    const load = () => void projectService.versions(projectId).then((v) => { if (alive) setVersions(v); });
    load();
    const offKey = subscribe(VERSIONS_KEY, load);
    window.addEventListener(PROJECTS_EVENT, load);
    return () => {
      alive = false;
      offKey();
      window.removeEventListener(PROJECTS_EVENT, load);
    };
  }, [projectId]);
  return versions;
}

/**
 * Tus proyectos completos (con sus archivos) y todas sus versiones, para los informes (Demo, Admin). La lista normal no
 * trae el contenido de los archivos; esto lo pide proyecto a proyecto y solo cuando algo ha cambiado.
 */
export function useProjectsDetail(): { projects: Project[]; versions: ProjectVersion[]; loading: boolean } {
  const { projects } = useProjects();
  const [state, setState] = useState<{ projects: Project[]; versions: ProjectVersion[]; loading: boolean }>({ projects: [], versions: [], loading: true });
  const key = projects.map((p) => `${p.id}:${p.updatedAt}`).join("|");
  useEffect(() => {
    let alive = true;
    const real = projects.filter((p) => !isExampleProject(p));
    void Promise.all(real.map(async (p) => ({ full: (await projectService.get(p.id)) ?? p, versions: await projectService.versions(p.id) })))
      .then((rows) => {
        if (alive) setState({ projects: rows.map((r) => r.full), versions: rows.flatMap((r) => r.versions), loading: false });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
