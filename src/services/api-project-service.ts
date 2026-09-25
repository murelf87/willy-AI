// Proyectos servidos por el backend (Fastify). Implementa el mismo contrato
// `ProjectService` que el adaptador local, de modo que la interfaz no cambia.
//
// El backend no guarda algunos datos propios de la interfaz (icono, estado,
// versiones locales, papelera). Esos detalles se conservan en el equipo y se
// combinan con los datos reales del servidor.

import {
  fail, ok, projectModeOf, type GeneratedFile, type Project, type ProjectIcon, type ProjectInput, type ProjectMode,
  type ProjectOrigin, type ProjectPatch, type ProjectState, type ProjectVersion, type ServiceResult,
} from "@/types/domain";
import { api, attempt, refreshData } from "./backend";
import type { ProjectService } from "./project-service";
import { readList, write } from "./storage";
import { VERSIONS_KEY, findVersion, versionsOf } from "./project-versions";

type ApiProject = {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type Meta = { icon?: ProjectIcon; state?: ProjectState; prompt?: string; trashed?: string | null; mode?: ProjectMode; origin?: ProjectOrigin; kind?: string; sessionId?: string };
const META_KEY = "willy-remote-meta";

function readMeta(): Record<string, Meta> {
  return readList<Record<string, Meta>>(META_KEY, [])[0] ?? {};
}

function patchMeta(id: string, patch: Meta) {
  const all = readMeta();
  all[id] = { ...all[id], ...patch };
  write(META_KEY, all);
}

function toProject(p: ApiProject, meta: Record<string, Meta> = readMeta()): Project {
  const m = meta[p.id] ?? {};
  const at = p.updatedAt ?? p.createdAt ?? new Date().toISOString();
  return {
    id: p.id,
    name: p.name,
    desc: p.description ?? "",
    state: m.state ?? "Activo",
    icon: m.icon ?? "folder",
    prompt: m.prompt ?? "",
    ...(m.mode && m.mode !== "standard" ? { mode: projectModeOf(m) } : {}),
    ...(m.origin ? { origin: m.origin } : {}),
    ...(m.kind ? { kind: m.kind } : {}),
    ...(m.sessionId ? { sessionId: m.sessionId } : {}),
    files: [],
    createdAt: p.createdAt ?? at,
    updatedAt: at,
    deletedAt: m.trashed ?? null,
  };
}

async function fetchAll(): Promise<Project[]> {
  const res = await api<{ projects: ApiProject[] }>("/api/projects?sortBy=updatedAt&sortDir=desc");
  const meta = readMeta();
  return (res.projects ?? []).map((p) => toProject(p, meta));
}

/** Descarga los archivos reales del proyecto desde el servidor. */
export async function fetchProjectFiles(projectId: string): Promise<GeneratedFile[]> {
  const list = await api<{ files: Array<{ path: string; type?: string }> }>(
    `/api/projects/${projectId}/files`,
  );
  const paths = (list.files ?? []).filter((f) => f.type !== "directory").map((f) => f.path);
  const files = await Promise.all(
    paths.slice(0, 200).map(async (path) => {
      try {
        const res = await api<{ file: { path: string; content: string } }>(
          `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
        );
        return { path, lang: path.split(".").pop() ?? "txt", content: res.file?.content ?? "" };
      } catch {
        return { path, lang: path.split(".").pop() ?? "txt", content: "" };
      }
    }),
  );
  return files;
}

export class ApiProjectService implements ProjectService {
  async list() {
    try {
      return (await fetchAll()).filter((p) => !p.deletedAt);
    } catch {
      return [];
    }
  }

  async trash() {
    try {
      return (await fetchAll()).filter((p) => p.deletedAt);
    } catch {
      return [];
    }
  }

  async get(id: string) {
    try {
      const res = await api<{ project: ApiProject }>(`/api/projects/${id}`);
      const project = toProject(res.project);
      project.files = await fetchProjectFiles(id).catch(() => []);
      return project;
    } catch {
      return undefined;
    }
  }

  async create(input: ProjectInput) {
    const name = input.name.trim();
    if (!name) return fail<Project>("El proyecto necesita un nombre.");
    const result = await attempt(async () => {
      const res = await api<{ project: ApiProject }>("/api/projects", {
        method: "POST",
        body: { name, description: input.desc ?? "" },
      });
      return res.project;
    });
    if (!result.ok) return fail<Project>(result.error);
    patchMeta(result.data.id, {
      ...(input.icon ? { icon: input.icon } : {}),
      ...(input.prompt ? { prompt: input.prompt } : {}),
      ...(input.mode && input.mode !== "standard" ? { mode: input.mode } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      state: input.state ?? "Borrador",
    });
    refreshData();
    return ok(toProject(result.data));
  }

  async rename(id: string, name: string) {
    const clean = name.trim();
    if (!clean) return fail<Project>("El nombre no puede quedar vacío.");
    const result = await attempt(async () => {
      const res = await api<{ project: ApiProject }>(`/api/projects/${id}`, {
        method: "PATCH",
        body: { name: clean },
      });
      return toProject(res.project);
    });
    if (result.ok) refreshData();
    return result;
  }

  async duplicate(id: string) {
    const source = await this.get(id);
    if (!source) return fail<Project>("Ese proyecto ya no existe.");
    return this.create({ name: `${source.name} (copia)`, desc: source.desc, prompt: source.prompt, icon: source.icon, mode: projectModeOf(source) });
  }

  async setState(id: string, state: ProjectState) {
    patchMeta(id, { state });
    refreshData();
    const project = await this.get(id);
    return project ? ok({ ...project, state }) : fail<Project>("Ese proyecto ya no existe.");
  }

  async update(id: string, patch: ProjectPatch) {
    patchMeta(id, {
      ...(patch.icon ? { icon: patch.icon } : {}),
      ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      ...(patch.origin ? { origin: patch.origin } : {}),
      ...(patch.kind ? { kind: patch.kind } : {}),
      ...(patch.sessionId ? { sessionId: patch.sessionId } : {}),
    });
    refreshData();
    const project = await this.get(id);
    return project ? ok(project) : fail<Project>("Ese proyecto ya no existe.");
  }

  async saveFiles(id: string, files: GeneratedFile[], label: string) {
    // El backend escribe los archivos durante la generación; aquí solo se guarda
    // la versión para poder comparar y restaurar desde la interfaz.
    const list = readList<ProjectVersion>(VERSIONS_KEY, []);
    write(VERSIONS_KEY, [
      { id: `ver_${Date.now().toString(36)}`, projectId: id, label, at: new Date().toISOString(), files },
      ...list,
    ].slice(0, 60));
    const project = await this.get(id);
    return project ? ok({ ...project, files }) : fail<Project>("Ese proyecto ya no existe.");
  }

  async softDelete(id: string) {
    patchMeta(id, { trashed: new Date().toISOString() });
    refreshData();
    return ok(true as const);
  }

  async restore(id: string) {
    patchMeta(id, { trashed: null });
    refreshData();
    const project = await this.get(id);
    return project ? ok(project) : fail<Project>("Ese proyecto ya no existe.");
  }

  async destroy(id: string): Promise<ServiceResult<true>> {
    const result = await attempt(() => api<void>(`/api/projects/${id}`, { method: "DELETE", body: { confirmed: true } }));
    if (!result.ok) return fail<true>(result.error);
    const all = readMeta();
    delete all[id];
    write(META_KEY, all);
    refreshData();
    return ok(true as const);
  }

  async versions(projectId: string) {
    return versionsOf(projectId);
  }

  async restoreVersion(versionId: string) {
    const version = findVersion(versionId);
    if (!version) return fail<Project>("Esa versión ya no está disponible.");
    const result = await attempt(() =>
      api<{ result: { success: boolean } }>(`/api/projects/${version.projectId}/rollback`, { method: "POST" }),
    );
    if (!result.ok) return fail<Project>(result.error);
    const project = await this.get(version.projectId);
    return project ? ok({ ...project, files: version.files }) : fail<Project>("Ese proyecto ya no existe.");
  }
}
