// Lo que responde /api/proyectos (solo servidor). Separado de la ruta para poder probarlo entero sin arrancar WILLY:
// recibe la petición y la carpeta de los proyectos, y devuelve la respuesta.

import { blockForeignSite } from "@/lib/same-origin";
import {
  createProject, destroyProject, duplicateProject, getProject, getVersion, importProjects, listProjects, listVersions,
  readPlan, readSession, renameProject, restoreProject, restoreVersion, saveProjectFiles, setProjectState, softDeleteProject,
  updateProject, writePlan, writeSession,
} from "@/lib/project-store-server";
import { captureProject } from "@/lib/project-capture-server";
import { compileProject, forgetCompiled, transpileTestFiles } from "@/lib/project-compile-server";
import { inspectLibraries, installLibraries, libraryStoreOf, listLibraries, removeLibrary, type StoreOptions } from "@/lib/package-store-server";
import { declaredDependencies, validPackageName, type InstallItem, type InstallResult } from "@/lib/project-libraries";
import { fail, ok, type ProjectInput, type ProjectPatch, type ServiceResult } from "@/types/domain";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE });
const reply = <T,>(r: ServiceResult<T>): Response => json(r, r.ok ? 200 : 400);

/** GET: lista (o papelera), un proyecto, sus versiones, una versión, su conversación de SUPER WILLY o su plan (rev23). */
export async function projectsGet(request: Request, base: string): Promise<Response> {
  const blocked = blockForeignSite(request);
  if (blocked) return blocked;
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const version = url.searchParams.get("version");
  try {
    if (version) {
      const v = await getVersion(base, version);
      return v ? json({ ok: true, data: v }) : json({ ok: false, error: "Esa versión ya no está disponible." }, 404);
    }
    if (id && url.searchParams.has("versiones")) return json({ ok: true, data: await listVersions(base, id) });
    if (id && url.searchParams.has("sesion")) return json({ ok: true, data: await readSession(base, id) });
    if (id && url.searchParams.has("plan")) return json({ ok: true, data: await readPlan(base, id) });
    if (id) {
      const p = await getProject(base, id);
      return p ? json({ ok: true, data: p }) : json({ ok: false, error: "Ese proyecto ya no existe." }, 404);
    }
    return json({ ok: true, data: await listProjects(base, { trash: url.searchParams.has("papelera") }) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "No se pudieron leer los proyectos." }, 500);
  }
}

/** Solo pruebas: con qué registro de npm (uno de prueba) y qué «node_modules de WILLY» se instalan las librerías. */
let testStoreOptions: StoreOptions | null = null;
export function setLibraryOptionsForTests(o: StoreOptions | null): void {
  testStoreOptions = o;
}

/** Rev27: con qué se instalan las librerías (lo que ya trae WILLY está en su carpeta node_modules). */
async function storeOptions(): Promise<StoreOptions> {
  if (testStoreOptions) return testStoreOptions;
  const { projectRoot } = await import("@/lib/project-root");
  const { join } = await import("node:path");
  const root = (await projectRoot()) ?? process.cwd();
  return { rootModules: join(root, "node_modules") };
}
const namesOf = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()))].slice(0, 20) : []);

/**
 * Rev27: instalar librerías para un proyecto (sin npm). Con `auto`, solo las que se pueden instalar SOLAS (el proyecto las
 * declara en su package.json y son conocidas); de las demás se dice por qué no.
 */
async function installForProject(base: string, id: string, body: Record<string, unknown>): Promise<ServiceResult<InstallResult>> {
  const names = namesOf(body["nombres"]);
  if (!names.length) return fail("No hay librerías que instalar.");
  const files = id ? (await getProject(base, id))?.files ?? [] : [];
  const declared = declaredDependencies(files);
  const store = libraryStoreOf(base);
  const opts = await storeOptions();
  let requests = names.map((name) => ({ name, spec: declared[name] ?? "latest" }));
  const skipped: InstallItem[] = [];
  if (body["auto"] === true) {
    const infos = await inspectLibraries(store, names, files, opts);
    for (const i of infos) {
      if (i.auto.ok) continue;
      skipped.push({ name: i.name, status: i.provided ? "la-trae-willy" : i.installed ? "ya-estaba" : "no-instalada", reason: i.auto.reason, ...(i.provided ?? i.installed ?? i.version ? { version: (i.provided ?? i.installed ?? i.version)! } : {}) });
    }
    const allowed = new Set(infos.filter((i) => i.auto.ok).map((i) => i.name));
    requests = requests.filter((r) => allowed.has(r.name));
  }
  const result: InstallResult = requests.length ? await installLibraries(store, requests, opts) : { items: [], packages: 0, bytes: 0, ms: 0, warnings: [] };
  if (result.packages > 0) forgetCompiled();
  return ok({ ...result, items: [...result.items, ...skipped] });
}

/** POST: cualquier cambio, con `action` (create, rename, setState, update, duplicate, saveFiles, softDelete, restore…), las capturas (rev24), compilar (rev25), las librerías de los proyectos (rev27) y las pruebas en TypeScript (rev28). */
export async function projectsPost(request: Request, base: string): Promise<Response> {
  const blocked = blockForeignSite(request);
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Petición no válida." }, 400);
  }
  if (!body || typeof body !== "object") return json({ ok: false, error: "Petición no válida." }, 400);
  const id = typeof body["id"] === "string" ? body["id"] : "";
  try {
    switch (body["action"]) {
      case "create": return reply(await createProject(base, (body["input"] ?? {}) as ProjectInput));
      case "rename": return reply(await renameProject(base, id, String(body["name"] ?? "")));
      case "setState": return reply(await setProjectState(base, id, body["state"]));
      case "update": return reply(await updateProject(base, id, (body["patch"] ?? {}) as ProjectPatch));
      case "duplicate": return reply(await duplicateProject(base, id));
      case "saveFiles": {
        const r = await saveProjectFiles(base, id, body["files"], body["label"]);
        return r.ok ? json({ ok: true, data: r.data.project, skipped: r.data.skipped }) : json(r, 400);
      }
      case "softDelete": {
        const r = await softDeleteProject(base, id);
        return r.ok ? json({ ok: true, data: true }) : json(r, 400);
      }
      case "restore": return reply(await restoreProject(base, id));
      case "destroy": return reply(await destroyProject(base, id));
      case "restoreVersion": return reply(await restoreVersion(base, String(body["versionId"] ?? "")));
      case "saveSession": return reply(await writeSession(base, id, body["session"]));
      case "savePlan": return reply(await writePlan(base, id, body["plan"], body["touch"] === true));
      // Rev24: capturas de verdad de la página que se está viendo (con el Edge o el Chrome del equipo), para «Revisar diseño».
      case "capturas": return reply(await captureProject(base, id, { page: body["page"], hash: body["hash"], devices: body["devices"] }));
      // Rev25: compilar un proyecto React/Vite en el equipo (con las piezas de WILLY) para enseñarlo en la vista previa.
      case "compilar": return reply(await compileProject(base, id, { versionId: body["versionId"] }));
      // Rev27: librerías nuevas para los proyectos, instaladas sin npm (lista, qué se sabe de ellas, instalar y quitar).
      case "librerias": return reply(ok(await listLibraries(libraryStoreOf(base))));
      case "infoLibrerias": {
        const files = id ? (await getProject(base, id))?.files ?? [] : [];
        return reply(ok(await inspectLibraries(libraryStoreOf(base), namesOf(body["nombres"]), files, await storeOptions())));
      }
      case "instalarLibrerias": return reply(await installForProject(base, id, body));
      case "quitarLibreria": {
        const name = String(body["nombre"] ?? "");
        if (!validPackageName(name)) return reply(fail("Esa librería no existe."));
        const r = await removeLibrary(libraryStoreOf(base), name);
        forgetCompiled();
        return reply(ok(r));
      }
      // Rev28: las pruebas en TypeScript de un proyecto, sin tipos (para pasarlas en la vista previa). No ejecuta nada.
      case "transpilarPruebas": {
        const list = (Array.isArray(body["archivos"]) ? (body["archivos"] as unknown[]) : []).slice(0, 60)
          .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object" && typeof (a as Record<string, unknown>)["path"] === "string" && typeof (a as Record<string, unknown>)["content"] === "string")
          .map((a) => ({ path: String(a["path"]).slice(0, 300), content: String(a["content"]).slice(0, 500_000) }));
        if (!list.length) return reply(fail("No hay pruebas que leer."));
        return reply(await transpileTestFiles(list));
      }
      case "import": return json({ ok: true, data: await importProjects(base, { projects: body["projects"], versions: body["versions"] }) });
      default: return json({ ok: false, error: "Operación no permitida." }, 400);
    }
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "No se pudo guardar en tu equipo." }, 500);
  }
}
