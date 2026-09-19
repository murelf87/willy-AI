// Contrato de proyectos + adaptador local (navegador).
// ADAPTADOR TEMPORAL: para conectar un backend basta con crear otra clase que
// cumpla `ProjectService` y exportarla como `projectService`. La interfaz no cambia.

import { useEffect, useState } from "react";
import {
  fail, newId, ok, type GeneratedFile, type Project, type ProjectIcon,
  type ProjectState, type ProjectVersion, type ServiceResult,
} from "@/types/domain";
import { readList, subscribe, write } from "./storage";
import { ApiProjectService } from "./api-project-service";
import { backendOn } from "./backend";

const KEY = "willy-projects";
const VERSIONS_KEY = "willy-versions";

export interface ProjectService {
  list(): Promise<Project[]>;
  trash(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  create(input: { name: string; desc?: string; prompt?: string; icon?: ProjectIcon }): Promise<ServiceResult<Project>>;
  rename(id: string, name: string): Promise<ServiceResult<Project>>;
  duplicate(id: string): Promise<ServiceResult<Project>>;
  setState(id: string, state: ProjectState): Promise<ServiceResult<Project>>;
  saveFiles(id: string, files: GeneratedFile[], label: string): Promise<ServiceResult<Project>>;
  softDelete(id: string): Promise<ServiceResult<true>>;
  restore(id: string): Promise<ServiceResult<Project>>;
  destroy(id: string): Promise<ServiceResult<true>>;
  versions(projectId: string): Promise<ProjectVersion[]>;
  restoreVersion(versionId: string): Promise<ServiceResult<Project>>;
}

const SEED: Array<{ name: string; desc: string; icon: ProjectIcon; state: ProjectState }> = [
  { name: "SaaS Clientes", desc: "Gestión de clientes con métricas", icon: "folder", state: "Activo" },
  { name: "App Fitness", desc: "Rutinas y seguimiento diario", icon: "gauge", state: "Pausado" },
  { name: "Web Corporativa", desc: "Sitio institucional multiidioma", icon: "grid", state: "Listo" },
  { name: "API REST", desc: "Servicio de datos local en Node", icon: "server", state: "Activo" },
  { name: "Tienda Online", desc: "Catálogo y carrito sin pasarela", icon: "database", state: "Borrador" },
  { name: "Landing Page", desc: "Página de captación de leads", icon: "zap", state: "Listo" },
];

function now() {
  return new Date().toISOString();
}

function makeProject(input: { name: string; desc?: string; prompt?: string; icon?: ProjectIcon; state?: ProjectState }): Project {
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
  };
}

function readAll(): Project[] {
  const stored = readList<Project>(KEY, []);
  if (stored.length) return stored;
  const seeded = SEED.map((s) => makeProject(s));
  write(KEY, seeded);
  return seeded;
}

function writeAll(list: Project[]) {
  write(KEY, list);
}

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

  async create(input: { name: string; desc?: string; prompt?: string; icon?: ProjectIcon }) {
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
    const copy: Project = { ...source, id: newId("prj"), name, createdAt: now(), updatedAt: now(), deletedAt: null };
    writeAll([copy, ...all]);
    return ok(copy);
  }

  async setState(id: string, state: ProjectState) {
    return this.patch(id, (p) => ({ ...p, state }));
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
    return readList<ProjectVersion>(VERSIONS_KEY, []).filter((v) => v.projectId === projectId);
  }

  async restoreVersion(versionId: string) {
    const version = readList<ProjectVersion>(VERSIONS_KEY, []).find((v) => v.id === versionId);
    if (!version) return fail<Project>("Esa versión ya no está disponible.");
    return this.patch(version.projectId, (p) => ({ ...p, files: version.files }));
  }
}

export const localProjectService: ProjectService = new LocalProjectService();

const remote = new ApiProjectService();

/** Con el servidor conectado manda el backend; si no, los datos de este equipo. */
function pick(): ProjectService {
  return backendOn() ? remote : localProjectService;
}

export const projectService: ProjectService = {
  list: () => pick().list(),
  trash: () => pick().trash(),
  get: (id) => pick().get(id),
  create: (input) => pick().create(input),
  rename: (id, name) => pick().rename(id, name),
  duplicate: (id) => pick().duplicate(id),
  setState: (id, state) => pick().setState(id, state),
  saveFiles: (id, files, label) => pick().saveFiles(id, files, label),
  softDelete: (id) => pick().softDelete(id),
  restore: (id) => pick().restore(id),
  destroy: (id) => pick().destroy(id),
  versions: (id) => pick().versions(id),
  restoreVersion: (id) => pick().restoreVersion(id),
};

/** Lista viva de proyectos; se actualiza sola al crear, renombrar o borrar. */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [trashed, setTrashed] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void Promise.all([projectService.list(), projectService.trash()]).then(([list, bin]) => {
        if (!alive) return;
        setProjects(list);
        setTrashed(bin);
        setLoading(false);
      });
    };
    load();
    const off = subscribe(KEY, load);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return { projects, trashed, loading };
}

export function useVersions(projectId: string | undefined) {
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  useEffect(() => {
    if (!projectId) return setVersions([]);
    const load = () => void projectService.versions(projectId).then(setVersions);
    load();
    return subscribe(VERSIONS_KEY, load);
  }, [projectId]);
  return versions;
}
