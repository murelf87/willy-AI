// PROYECTOS EN TU EQUIPO (solo servidor) — revisión 19. Es la ÚNICA fuente de verdad de los proyectos de WILLY: la usan
// Proyectos, SUPER WILLY, el Chat, el Historial y el móvil (que ve los mismos proyectos que el ordenador).
//
// Cada proyecto es una carpeta en «datos-privados/proyectos/<id>/»:
//   proyecto.json   su ficha (nombre, estado, tipo, de dónde viene, conversación de SUPER WILLY…) — se escribe la ÚLTIMA:
//                   una carpeta sin ficha (p. ej. un paso a medias) no cuenta como proyecto
//   archivos.json   el índice de sus archivos (qué archivos son del proyecto; lo demás de la carpeta, como una compilación, no)
//   archivos/…      los archivos reales, con sus carpetas (un proyecto de verdad, que se puede abrir y compilar)
//   versiones/…     una copia comprimida por versión (las últimas 40), con su índice versiones.json
//   sesion.json     la conversación y la entrevista de SUPER WILLY de este proyecto
//   plan.json       (rev23) su plan: hitos y tareas con su peso, y lo que se sabe de verdad (de ahí sale su progreso)
//
// Antes (hasta la rev18) todo esto vivía en el navegador, que admite unos 5 MB y, al llenarse, perdía lo último sin avisar.

import { writeFileDurable } from "@/lib/self-build-backup";
import { normalizePlan, type ProjectPlan } from "@/lib/project-progress";
import {
  PROJECT_ICONS, PROJECT_ORIGINS, PROJECT_STATES, fail, isExampleProject, newId, ok,
  type GeneratedFile, type Project, type ProjectIcon, type ProjectInput, type ProjectOrigin, type ProjectPatch, type ProjectState,
  type ProjectVersion, type ServiceResult,
} from "@/types/domain";

export const PROJECTS_DIR = "proyectos";
export const LIMITS = {
  files: 500,
  fileBytes: 2_000_000,
  totalBytes: 25_000_000,
  versions: 40,
  sessionBytes: 4_000_000,
  planBytes: 200_000,
  name: 80,
  desc: 300,
  prompt: 20_000,
} as const;

const META = "proyecto.json";
const FILE_INDEX = "archivos.json";
const FILES = "archivos";
const VERSIONS = "versiones";
const VERSION_INDEX = "versiones.json";
const SESSION = "sesion.json";
const PLAN = "plan.json";

async function node() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const zlib = await import("node:zlib");
  const crypto = await import("node:crypto");
  return { fs, path, zlib, crypto };
}

const ID = /^[A-Za-z0-9_-]{3,64}$/;
/** Identificador válido de proyecto o de versión (nunca una ruta). */
export const isProjectId = (id: unknown): id is string => typeof id === "string" && ID.test(id);

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Ruta relativa segura para un archivo del proyecto, o null si no se puede usar. Nunca sale de la carpeta del proyecto
 * («..», rutas absolutas), ni usa nombres que Windows no admite (CON, NUL…, «:», «?», acabados en punto o espacio).
 */
export function safeRelPath(input: unknown): string | null {
  let s = String(input ?? "").replace(/\\/g, "/").trim();
  s = s.replace(/^[a-zA-Z]:\//, "").replace(/^\/+/, "").replace(/^(\.\/)+/, "");
  if (!s || s.length > 240) return null;
  const parts = s.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") return null;
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part) || RESERVED.test(part)) return null;
  }
  return parts.join("/");
}

const LANGS: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js", json: "json", html: "html", htm: "html", css: "css",
  md: "md", py: "python", sql: "sql", sh: "bash", bat: "bat", ps1: "powershell", yml: "yaml", yaml: "yaml", svg: "svg", txt: "text",
};
const langOf = (rel: string): string => LANGS[(rel.split(".").pop() ?? "").toLowerCase()] ?? "text";

// Una sola operación de escritura a la vez (el servidor de WILLY es un único proceso): nunca dos cambios cruzados.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

type Meta = Omit<Project, "files"> & { fileCount: number };
type IndexEntry = { path: string; lang: string };
type VersionEntry = { id: string; label: string; at: string; fileCount: number };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const iso = (v: unknown, fallback: string): string => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : fallback);
const now = (): string => new Date().toISOString();

/** Ficha leída del disco, con cada campo comprobado (una ficha rota o a medias no se cuela como proyecto). */
export function normalizeMeta(raw: unknown, id: string): Meta | null {
  if (!raw || typeof raw !== "object" || !isProjectId(id)) return null;
  const r = raw as Record<string, unknown>;
  const name = str(r["name"], LIMITS.name).trim();
  if (!name) return null;
  const created = iso(r["createdAt"], new Date(0).toISOString());
  const meta: Meta = {
    id,
    name,
    desc: str(r["desc"], LIMITS.desc),
    state: (PROJECT_STATES as readonly string[]).includes(r["state"] as string) ? (r["state"] as ProjectState) : "Borrador",
    icon: (PROJECT_ICONS as readonly string[]).includes(r["icon"] as string) ? (r["icon"] as ProjectIcon) : "folder",
    prompt: str(r["prompt"], LIMITS.prompt),
    createdAt: created,
    updatedAt: iso(r["updatedAt"], created),
    deletedAt: typeof r["deletedAt"] === "string" && r["deletedAt"] ? r["deletedAt"] : null,
    fileCount: typeof r["fileCount"] === "number" && r["fileCount"] >= 0 ? Math.floor(r["fileCount"]) : 0,
  };
  if (r["mode"] === "innovation" || r["mode"] === "rebuild") meta.mode = r["mode"];
  if ((PROJECT_ORIGINS as readonly string[]).includes(r["origin"] as string)) meta.origin = r["origin"] as ProjectOrigin;
  const kind = str(r["kind"], 40).trim();
  if (kind) meta.kind = kind;
  const sessionId = str(r["sessionId"], 80).trim();
  if (sessionId) meta.sessionId = sessionId;
  return meta;
}

async function readJson(file: string): Promise<unknown> {
  const { fs } = await node();
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFileDurable(file, JSON.stringify(value));
}

async function dirOf(base: string, id: string): Promise<string> {
  const { path } = await node();
  if (!isProjectId(id)) throw new Error("Identificador de proyecto no válido.");
  return path.join(base, id);
}

async function readMeta(base: string, id: string): Promise<Meta | null> {
  if (!isProjectId(id)) return null;
  const { path } = await node();
  return normalizeMeta(await readJson(path.join(base, id, META)), id);
}

async function writeMeta(base: string, meta: Meta): Promise<void> {
  const { path } = await node();
  // El plan vive en su propio archivo (plan.json), nunca dentro de la ficha.
  const { plan: _plan, ...clean } = meta as Meta & { plan?: unknown };
  await writeJson(path.join(base, meta.id, META), clean);
}

async function readPlanOf(base: string, id: string): Promise<ProjectPlan | null> {
  const { path } = await node();
  return normalizePlan(await readJson(path.join(base, id, PLAN)));
}

async function readIndex(dir: string): Promise<IndexEntry[]> {
  const { path } = await node();
  const raw = await readJson(path.join(dir, FILE_INDEX));
  if (!Array.isArray(raw)) return [];
  const out: IndexEntry[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const rel = safeRelPath(item?.["path"]);
    if (rel) out.push({ path: rel, lang: str(item["lang"], 20) || langOf(rel) });
  }
  return out;
}

async function readVersionIndex(dir: string): Promise<VersionEntry[]> {
  const { path } = await node();
  const raw = await readJson(path.join(dir, VERSION_INDEX));
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .filter((v) => isProjectId(v?.["id"]))
    .map((v) => ({ id: String(v["id"]), label: str(v["label"], 200), at: iso(v["at"], new Date(0).toISOString()), fileCount: typeof v["fileCount"] === "number" ? v["fileCount"] : 0 }));
}

/** Todas las fichas (en uso y en la papelera). */
async function allMeta(base: string): Promise<Meta[]> {
  const { fs } = await node();
  let ids: string[] = [];
  try {
    ids = (await fs.readdir(base, { withFileTypes: true })).filter((e) => e.isDirectory() && isProjectId(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
  const out: Meta[] = [];
  for (const id of ids) {
    const meta = await readMeta(base, id);
    if (meta) out.push(meta);
  }
  return out;
}

const nameTaken = (metas: Meta[], name: string, except?: string): boolean =>
  metas.some((m) => m.id !== except && !m.deletedAt && m.name.toLowerCase() === name.toLowerCase());

/** Archivos limpios para guardar: rutas seguras, sin repetidos (Windows no distingue mayúsculas), dentro de los límites. */
export function cleanFiles(files: unknown): ServiceResult<{ files: GeneratedFile[]; skipped: string[] }> {
  if (!Array.isArray(files)) return fail("La lista de archivos no es válida.");
  const skipped: string[] = [];
  const byKey = new Map<string, GeneratedFile>();
  for (const raw of files as Array<Record<string, unknown>>) {
    const rel = safeRelPath(raw?.["path"]);
    const content = raw?.["content"];
    if (!rel || typeof content !== "string") {
      skipped.push(String(raw?.["path"] ?? "(sin nombre)").slice(0, 120));
      continue;
    }
    if (Buffer.byteLength(content, "utf8") > LIMITS.fileBytes) {
      skipped.push(`${rel} (más de 2 MB)`);
      continue;
    }
    const lang = str(raw["lang"], 20).trim() || langOf(rel);
    byKey.set(rel.toLowerCase(), { path: rel, lang, content });
  }
  const clean = [...byKey.values()];
  if (clean.length > LIMITS.files) return fail(`Demasiados archivos (${clean.length}); el máximo por proyecto es ${LIMITS.files}.`);
  const total = clean.reduce((n, f) => n + Buffer.byteLength(f.content, "utf8"), 0);
  if (total > LIMITS.totalBytes) return fail("Los archivos ocupan más de 25 MB: es demasiado para una sola versión.");
  return ok({ files: clean, skipped });
}

/** Deja en `archivos/` exactamente estos archivos (los que ya no están se quitan) y reescribe el índice. */
async function writeProjectFiles(dir: string, files: GeneratedFile[]): Promise<void> {
  const { fs, path } = await node();
  const old = await readIndex(dir);
  for (const f of files) {
    const target = path.join(dir, FILES, ...f.path.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, f.content, "utf8");
  }
  await writeJson(path.join(dir, FILE_INDEX), files.map((f) => ({ path: f.path, lang: f.lang })));
  const keep = new Set(files.map((f) => f.path.toLowerCase()));
  for (const entry of old) {
    if (!keep.has(entry.path.toLowerCase())) await fs.rm(path.join(dir, FILES, ...entry.path.split("/")), { force: true });
  }
}

async function addVersion(dir: string, projectId: string, version: { id: string; label: string; at: string; files: GeneratedFile[] }): Promise<void> {
  const { fs, path, zlib } = await node();
  const data = zlib.gzipSync(Buffer.from(JSON.stringify({ ...version, projectId }), "utf8"));
  await writeFileDurable(path.join(dir, VERSIONS, `${version.id}.json.gz`), data);
  const index = await readVersionIndex(dir);
  const next: VersionEntry[] = [
    { id: version.id, label: version.label.slice(0, 200), at: version.at, fileCount: version.files.length },
    ...index.filter((v) => v.id !== version.id),
  ].sort((a, b) => b.at.localeCompare(a.at));
  for (const gone of next.slice(LIMITS.versions)) await fs.rm(path.join(dir, VERSIONS, `${gone.id}.json.gz`), { force: true });
  await writeJson(path.join(dir, VERSION_INDEX), next.slice(0, LIMITS.versions));
}

// ------------------------------------------------------------------------------------------------------------ lectura
/** Proyectos (sin el contenido de sus archivos: `fileCount` dice cuántos tiene), del más reciente al más antiguo. */
export async function listProjects(base: string, opts: { trash?: boolean } = {}): Promise<Project[]> {
  const metas = (await allMeta(base)).filter((m) => Boolean(m.deletedAt) === Boolean(opts.trash));
  const out: Project[] = [];
  for (const m of metas) out.push({ ...m, files: [], plan: await readPlanOf(base, m.id) });
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Un proyecto completo, con sus archivos. */
export async function getProject(base: string, id: string): Promise<Project | null> {
  const meta = await readMeta(base, id);
  if (!meta) return null;
  const { fs, path } = await node();
  const dir = await dirOf(base, id);
  const files: GeneratedFile[] = [];
  for (const entry of await readIndex(dir)) {
    try {
      files.push({ path: entry.path, lang: entry.lang, content: await fs.readFile(path.join(dir, FILES, ...entry.path.split("/")), "utf8") });
    } catch {
      /* el archivo ya no está en el disco: se omite */
    }
  }
  return { ...meta, files, fileCount: files.length, plan: await readPlanOf(base, id) };
}

export async function listVersions(base: string, id: string): Promise<ProjectVersion[]> {
  if (!(await readMeta(base, id))) return [];
  const dir = await dirOf(base, id);
  return (await readVersionIndex(dir)).map((v) => ({ id: v.id, projectId: id, label: v.label, at: v.at, files: [], fileCount: v.fileCount }));
}

/** Una versión con sus archivos (se busca en todos los proyectos: su identificador es único). */
export async function getVersion(base: string, versionId: string): Promise<ProjectVersion | null> {
  if (!isProjectId(versionId)) return null;
  const { fs, path, zlib } = await node();
  for (const meta of await allMeta(base)) {
    const file = path.join(base, meta.id, VERSIONS, `${versionId}.json.gz`);
    let data: Buffer;
    try {
      data = await fs.readFile(file);
    } catch {
      continue;
    }
    try {
      const raw = JSON.parse(zlib.gunzipSync(data).toString("utf8")) as Record<string, unknown>;
      const files = cleanFiles(raw["files"]);
      return {
        id: versionId,
        projectId: meta.id,
        label: str(raw["label"], 200),
        at: iso(raw["at"], new Date(0).toISOString()),
        files: files.ok ? files.data.files : [],
        fileCount: files.ok ? files.data.files.length : 0,
      };
    } catch {
      return null;
    }
  }
  return null;
}

/** El plan del proyecto (rev23), o null si todavía no tiene (proyectos de antes: «Progreso no calculado»). */
export async function readPlan(base: string, id: string): Promise<ProjectPlan | null> {
  if (!(await readMeta(base, id))) return null;
  return readPlanOf(base, id);
}

/**
 * Guarda el plan del proyecto, comprobado campo a campo. Con `touch`, cuenta como actividad del proyecto (sube en
 * «Actividad reciente»): una tarea terminada, la entrevista que avanza… Lo que solo es una comprobación (la vista previa) no.
 */
export function writePlan(base: string, id: string, plan: unknown, touch = false): Promise<ServiceResult<ProjectPlan>> {
  return serial(async () => {
    const meta = await readMeta(base, id);
    if (!meta || meta.deletedAt) return fail<ProjectPlan>("Ese proyecto ya no existe.");
    const clean = normalizePlan(plan);
    if (!clean) return fail<ProjectPlan>("El plan del proyecto no es válido.");
    if (JSON.stringify(clean).length > LIMITS.planBytes) return fail<ProjectPlan>("El plan del proyecto es demasiado grande.");
    const { path } = await node();
    await writeJson(path.join(await dirOf(base, id), PLAN), clean);
    if (touch) await writeMeta(base, { ...meta, updatedAt: now() });
    return ok(clean);
  });
}

export async function readSession(base: string, id: string): Promise<unknown> {
  if (!(await readMeta(base, id))) return null;
  const { path } = await node();
  return readJson(path.join(await dirOf(base, id), SESSION));
}

// ---------------------------------------------------------------------------------------------------------- escritura
export function createProject(base: string, input: ProjectInput): Promise<ServiceResult<Project>> {
  return serial(async () => {
    const name = String(input?.name ?? "").trim().slice(0, LIMITS.name);
    if (!name) return fail<Project>("El proyecto necesita un nombre.");
    const metas = await allMeta(base);
    if (nameTaken(metas, name)) return fail<Project>(`Ya existe un proyecto llamado «${name}».`);
    const { fs, path } = await node();
    const id = newId("prj");
    const at = now();
    const meta: Meta = {
      id,
      name,
      desc: str(input.desc, LIMITS.desc).trim(),
      state: input.state && (PROJECT_STATES as readonly string[]).includes(input.state) ? input.state : "Borrador",
      icon: input.icon && PROJECT_ICONS.includes(input.icon) ? input.icon : "folder",
      prompt: str(input.prompt, LIMITS.prompt),
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      fileCount: 0,
    };
    if (input.mode === "innovation" || input.mode === "rebuild") meta.mode = input.mode;
    if (input.origin && (PROJECT_ORIGINS as readonly string[]).includes(input.origin)) meta.origin = input.origin;
    const kind = str(input.kind, 40).trim();
    if (kind) meta.kind = kind;
    const sessionId = str(input.sessionId, 80).trim();
    if (sessionId) meta.sessionId = sessionId;
    const dir = path.join(base, id);
    await fs.mkdir(path.join(dir, FILES), { recursive: true });
    await writeJson(path.join(dir, FILE_INDEX), []);
    await writeJson(path.join(dir, VERSION_INDEX), []);
    await writeMeta(base, meta);
    return ok<Project>({ ...meta, files: [] });
  });
}

/** Cambia la ficha de un proyecto dentro del candado. `change` devuelve la ficha nueva o un error. */
function patchMeta(base: string, id: string, change: (meta: Meta, metas: Meta[]) => ServiceResult<Meta>): Promise<ServiceResult<Project>> {
  return serial(async () => {
    const metas = await allMeta(base);
    const meta = metas.find((m) => m.id === id);
    if (!meta) return fail<Project>("Ese proyecto ya no existe.");
    const next = change(meta, metas);
    if (!next.ok) return fail<Project>(next.error);
    const updated: Meta = { ...next.data, updatedAt: now() };
    await writeMeta(base, updated);
    return ok<Project>({ ...updated, files: [] });
  });
}

export function renameProject(base: string, id: string, name: string): Promise<ServiceResult<Project>> {
  const clean = String(name ?? "").trim().slice(0, LIMITS.name);
  if (!clean) return Promise.resolve(fail<Project>("El nombre no puede quedar vacío."));
  return patchMeta(base, id, (meta, metas) => {
    if (nameTaken(metas, clean, id)) return fail(`Ya existe un proyecto llamado «${clean}».`);
    // Si era un ejemplo de antes y le pones nombre, ya es tuyo: deja de ser ejemplo.
    const { origin, ...rest } = meta;
    return ok({ ...rest, ...(origin && origin !== "ejemplo" ? { origin } : {}), name: clean });
  });
}

export function setProjectState(base: string, id: string, state: unknown): Promise<ServiceResult<Project>> {
  if (!(PROJECT_STATES as readonly string[]).includes(state as string)) return Promise.resolve(fail<Project>("Estado no válido."));
  return patchMeta(base, id, (meta) => ok({ ...meta, state: state as ProjectState }));
}

export function updateProject(base: string, id: string, patch: ProjectPatch): Promise<ServiceResult<Project>> {
  return patchMeta(base, id, (meta) => {
    const next: Meta = { ...meta };
    if (typeof patch?.desc === "string") next.desc = patch.desc.trim().slice(0, LIMITS.desc);
    if (typeof patch?.prompt === "string") next.prompt = patch.prompt.slice(0, LIMITS.prompt);
    if (patch?.icon && PROJECT_ICONS.includes(patch.icon)) next.icon = patch.icon;
    if (patch?.origin && (PROJECT_ORIGINS as readonly string[]).includes(patch.origin)) next.origin = patch.origin;
    if (typeof patch?.kind === "string" && patch.kind.trim()) next.kind = patch.kind.trim().slice(0, 40);
    if (typeof patch?.sessionId === "string" && patch.sessionId.trim()) next.sessionId = patch.sessionId.trim().slice(0, 80);
    return ok(next);
  });
}

export function softDeleteProject(base: string, id: string): Promise<ServiceResult<Project>> {
  return patchMeta(base, id, (meta) => ok({ ...meta, deletedAt: now() }));
}

export function restoreProject(base: string, id: string): Promise<ServiceResult<Project>> {
  return patchMeta(base, id, (meta, metas) => {
    // Si mientras estaba en la papelera otro proyecto tomó su nombre, vuelve con «(restaurado)» en vez de chocar.
    let name = meta.name;
    for (let n = 1; nameTaken(metas, name, meta.id); n++) name = `${meta.name} (restaurado${n > 1 ? ` ${n}` : ""})`.slice(0, LIMITS.name);
    return ok({ ...meta, name, deletedAt: null });
  });
}

export function destroyProject(base: string, id: string): Promise<ServiceResult<true>> {
  return serial(async () => {
    if (!(await readMeta(base, id))) return fail<true>("Ese proyecto ya no existe.");
    const { fs, path } = await node();
    const dir = path.resolve(await dirOf(base, id));
    if (!dir.startsWith(path.resolve(base) + path.sep)) return fail<true>("Ruta no válida.");
    await fs.rm(dir, { recursive: true, force: true });
    return ok(true as const);
  });
}

export function duplicateProject(base: string, id: string): Promise<ServiceResult<Project>> {
  return serial(async () => {
    const source = await getProject(base, id);
    if (!source) return fail<Project>("Ese proyecto ya no existe.");
    const metas = await allMeta(base);
    const stem = `${source.name} (copia)`.slice(0, LIMITS.name);
    let name = stem;
    for (let n = 2; nameTaken(metas, name); n++) name = `${stem} ${n}`;
    const { fs, path } = await node();
    const at = now();
    const copyId = newId("prj");
    // La copia es un proyecto nuevo: sin la conversación de SUPER WILLY del original ni su origen.
    const meta: Meta = {
      id: copyId, name, desc: source.desc, state: source.state, icon: source.icon, prompt: source.prompt,
      createdAt: at, updatedAt: at, deletedAt: null, fileCount: source.files.length,
      ...(source.mode ? { mode: source.mode } : {}),
      ...(source.kind ? { kind: source.kind } : {}),
    };
    const dir = path.join(base, copyId);
    await fs.mkdir(path.join(dir, FILES), { recursive: true });
    await writeProjectFiles(dir, source.files);
    await writeJson(path.join(dir, VERSION_INDEX), []);
    // Su plan también (el progreso es el mismo trabajo), sin lo que estuviera pendiente de ti en el original.
    const plan = await readPlanOf(base, id);
    if (plan) await writeJson(path.join(dir, PLAN), { ...plan, attention: null });
    await writeMeta(base, meta);
    return ok<Project>({ ...meta, files: source.files, plan: plan ? { ...plan, attention: null } : null });
  });
}

/** Guarda los archivos del proyecto (sustituyen a los anteriores) y crea una versión restaurable. */
export function saveProjectFiles(base: string, id: string, files: unknown, label: unknown): Promise<ServiceResult<{ project: Project; skipped: string[] }>> {
  return serial(async () => {
    const meta = await readMeta(base, id);
    if (!meta) return fail("Ese proyecto ya no existe.");
    const clean = cleanFiles(files);
    if (!clean.ok) return fail(clean.error);
    const dir = await dirOf(base, id);
    await writeProjectFiles(dir, clean.data.files);
    const at = now();
    await addVersion(dir, id, { id: newId("ver"), label: str(label, 200).trim() || "Versión guardada", at, files: clean.data.files });
    // Un ejemplo de antes con archivos ya es trabajo tuyo: deja de ser ejemplo.
    const { origin, ...rest } = meta;
    const updated: Meta = { ...rest, ...(origin && !(origin === "ejemplo" && clean.data.files.length) ? { origin } : {}), fileCount: clean.data.files.length, updatedAt: at };
    await writeMeta(base, updated);
    return ok({ project: { ...updated, files: clean.data.files }, skipped: clean.data.skipped });
  });
}

/** Vuelve a los archivos de una versión (la actual ya quedó guardada como versión al guardarse). */
export async function restoreVersion(base: string, versionId: string): Promise<ServiceResult<Project>> {
  const version = await getVersion(base, versionId);
  if (!version) return fail<Project>("Esa versión ya no está disponible.");
  return serial(async () => {
    const meta = await readMeta(base, version.projectId);
    if (!meta) return fail<Project>("Ese proyecto ya no existe.");
    const dir = await dirOf(base, meta.id);
    await writeProjectFiles(dir, version.files);
    const updated: Meta = { ...meta, fileCount: version.files.length, updatedAt: now() };
    await writeMeta(base, updated);
    return ok<Project>({ ...updated, files: version.files });
  });
}

/** Guarda la conversación de SUPER WILLY de este proyecto (y cuenta como actividad del proyecto). */
export function writeSession(base: string, id: string, session: unknown): Promise<ServiceResult<true>> {
  return serial(async () => {
    const meta = await readMeta(base, id);
    if (!meta) return fail<true>("Ese proyecto ya no existe.");
    if (!session || typeof session !== "object" || typeof (session as Record<string, unknown>)["id"] !== "string") return fail<true>("Conversación no válida.");
    const text = JSON.stringify(session);
    if (Buffer.byteLength(text, "utf8") > LIMITS.sessionBytes) return fail<true>("La conversación es demasiado grande para guardarla.");
    const { path } = await node();
    await writeFileDurable(path.join(await dirOf(base, id), SESSION), text);
    await writeMeta(base, { ...meta, updatedAt: now() });
    return ok(true as const);
  });
}

// --------------------------------------------------------------------------------------------- paso desde el navegador
export type ImportItem = { id: string; name: string; status: "importado" | "ya-estaba" | "error"; files: number; versions: number; example: boolean; error?: string };

const fingerprint = async (files: GeneratedFile[]): Promise<string> => {
  const { crypto } = await node();
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) h.update(`${f.path}\u0000${f.content}\u0000`);
  return h.digest("hex");
};

/**
 * Pasa al disco los proyectos que estaban en el navegador (y sus versiones). Conserva sus identificadores, fechas y estado;
 * se puede repetir sin duplicar nada (lo que ya está se deja como está). Cada proyecto pasado se COMPRUEBA leyéndolo de nuevo
 * del disco: solo es «importado» si sus archivos coinciden exactamente. Los 6 ejemplos de antes quedan marcados como ejemplo.
 */
export function importProjects(base: string, payload: { projects?: unknown; versions?: unknown }): Promise<ImportItem[]> {
  return serial(async () => {
    const { fs, path } = await node();
    const report: ImportItem[] = [];
    const list = Array.isArray(payload?.projects) ? (payload.projects as Array<Record<string, unknown>>) : [];
    const versions = Array.isArray(payload?.versions) ? (payload.versions as Array<Record<string, unknown>>) : [];
    await fs.mkdir(base, { recursive: true });
    for (const raw of list.slice(0, 500)) {
      const id = raw?.["id"];
      const name = str(raw?.["name"], LIMITS.name).trim();
      if (!isProjectId(id) || !name) {
        report.push({ id: String(id ?? "?").slice(0, 64), name: name || "(sin nombre)", status: "error", files: 0, versions: 0, example: false, error: "Proyecto sin identificador o sin nombre." });
        continue;
      }
      const existing = await readMeta(base, id);
      if (existing) {
        report.push({ id, name: existing.name, status: "ya-estaba", files: existing.fileCount, versions: (await readVersionIndex(path.join(base, id))).length, example: existing.origin === "ejemplo" });
        continue;
      }
      const clean = cleanFiles(raw["files"] ?? []);
      if (!clean.ok) {
        report.push({ id, name, status: "error", files: 0, versions: 0, example: false, error: clean.error });
        continue;
      }
      const files = clean.data.files;
      const metas = await allMeta(base);
      const example = isExampleProject({ name, desc: str(raw["desc"], LIMITS.desc), files });
      // Un ejemplo que ya está (p. ej. el mismo ejemplo que traía otro navegador) no se duplica.
      const twin = example ? metas.find((m) => m.origin === "ejemplo" && m.name === name) : undefined;
      if (twin) {
        report.push({ id, name, status: "ya-estaba", files: 0, versions: 0, example: true });
        continue;
      }
      const deletedAt = typeof raw["deletedAt"] === "string" && raw["deletedAt"] ? raw["deletedAt"] : null;
      let finalName = name;
      for (let n = 2; !deletedAt && nameTaken(metas, finalName); n++) finalName = `${name} (${n})`.slice(0, LIMITS.name);
      const meta = normalizeMeta({ ...raw, name: finalName, deletedAt, fileCount: files.length, ...(example ? { origin: "ejemplo" } : {}) }, id);
      if (!meta) {
        report.push({ id, name, status: "error", files: 0, versions: 0, example, error: "Ficha no válida." });
        continue;
      }
      const dir = path.join(base, id);
      try {
        await fs.mkdir(path.join(dir, FILES), { recursive: true });
        await writeProjectFiles(dir, files);
        const own = versions
          .filter((v) => v?.["projectId"] === id && isProjectId(v["id"]))
          .sort((a, b) => String(b["at"] ?? "").localeCompare(String(a["at"] ?? "")))
          .slice(0, LIMITS.versions);
        await writeJson(path.join(dir, VERSION_INDEX), []);
        let saved = 0;
        for (const v of own.reverse()) {
          const vf = cleanFiles(v["files"] ?? []);
          if (!vf.ok) continue;
          await addVersion(dir, id, { id: String(v["id"]), label: str(v["label"], 200) || "Versión", at: iso(v["at"], meta.updatedAt), files: vf.data.files });
          saved += 1;
        }
        await writeMeta(base, meta); // la ficha, la última: hasta aquí el proyecto no «existe»
        const back = await getProject(base, id);
        const same = back !== null && back.files.length === files.length && (await fingerprint(back.files)) === (await fingerprint(files));
        report.push(same
          ? { id, name: finalName, status: "importado", files: files.length, versions: saved, example }
          : { id, name: finalName, status: "error", files: back?.files.length ?? 0, versions: saved, example, error: "Al leerlo de nuevo del disco no coincide." });
      } catch (error) {
        report.push({ id, name, status: "error", files: 0, versions: 0, example, error: error instanceof Error ? error.message.slice(0, 200) : "Error al escribir en el disco." });
      }
    }
    return report;
  });
}

/** Carpeta de los proyectos de esta instalación. */
export async function projectsBase(): Promise<string> {
  const { path } = await node();
  const { privateDataDir } = await import("@/lib/project-root");
  return path.join(await privateDataDir(), PROJECTS_DIR);
}
