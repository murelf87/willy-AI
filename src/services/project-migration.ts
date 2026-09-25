// Paso de los proyectos del navegador al disco del equipo (revisión 19). Se hace una sola vez por navegador, sin perder
// nada: el servidor escribe cada proyecto, lo vuelve a leer y lo compara; solo si TODOS coinciden se da por terminado.
// Los datos del navegador NO se borran (quedan como copia); desde ese momento ya no se usan.

import type { Project, ProjectVersion } from "@/types/domain";
import { DiskProjectService, importBrowserProjects, saveProjectSession, type ImportItem } from "./disk-project-service";
import { readJson, readList, write } from "./storage";
import { listSessions, saveSession } from "./worklog";

/** Claves de antes (hasta la rev18): proyectos y versiones en el navegador. */
export const LEGACY_PROJECTS_KEY = "willy-projects";
export const LEGACY_VERSIONS_KEY = "willy-versions";
/** Marca de «ya se pasaron al disco» en este navegador. */
export const MIGRATED_KEY = "willy-proyectos-en-disco";

export type MigrationResult = { moved: number; already: number; examples: number; errors: ImportItem[] };

type Marker = { at: string | null; moved: number };

export function alreadyMigrated(): boolean {
  return Boolean(readJson<Marker>(MIGRATED_KEY, { at: null, moved: 0 }).at);
}

/** Resumen en claro de lo que pasó (para el aviso). */
export function migrationSummary(r: MigrationResult): string | null {
  const real = r.moved - r.examples;
  if (r.errors.length) return `⚠️ ${r.errors.length} proyecto(s) no se pudieron pasar a tu equipo todavía: se reintentará solo. Siguen a salvo en el navegador.`;
  if (real > 0) return `Tus ${real} proyecto(s) están ahora guardados en tu equipo (no dependen del navegador).`;
  return null;
}

/**
 * Las entrevistas de SUPER WILLY de antes de la rev19 no tenían proyecto: cada una pasa a ser un proyecto (con su
 * conversación guardada dentro), para que aparezcan en Proyectos. Solo las que tienen entrevista (las demás eran tareas
 * sueltas: investigar, traducir…). Se puede repetir sin duplicar: la que ya tiene proyecto se salta.
 */
export async function linkLegacySessions(): Promise<number> {
  if (typeof window === "undefined") return 0;
  const disk = new DiskProjectService();
  let linked = 0;
  // De la más antigua a la más reciente: así «Continuar donde lo dejaste» sigue siendo la última en la que trabajaste.
  for (const s of [...listSessions()].reverse()) {
    if (s.projectId || !s.discovery) continue;
    const base = s.discovery.name.trim() || "Proyecto de SUPER WILLY";
    const input = { desc: s.discovery.idea.replace(/\s+/g, " ").slice(0, 140), prompt: s.discovery.idea, origin: "super-willy" as const, sessionId: s.id, kind: s.discovery.kind };
    let r = await disk.create({ ...input, name: base });
    for (let n = 2; !r.ok && /Ya existe/.test(r.error) && n < 20; n++) r = await disk.create({ ...input, name: `${base} ${n}` });
    if (!r.ok) break; // WILLY no responde: se reintenta la próxima vez
    const saved = saveSession({ ...s, projectId: r.data.id, discovery: { ...s.discovery, name: r.data.name } });
    await saveProjectSession(r.data.id, saved);
    linked += 1;
  }
  return linked;
}

let running: Promise<MigrationResult | null> | null = null;

/** Pasa los proyectos de este navegador al disco (una sola vez; si algo falla se reintenta la próxima vez). */
export function migrateBrowserProjects(): Promise<MigrationResult | null> {
  if (typeof window === "undefined" || alreadyMigrated()) return Promise.resolve(null);
  running ??= (async () => {
    const projects = readList<Project>(LEGACY_PROJECTS_KEY, []);
    const versions = readList<ProjectVersion>(LEGACY_VERSIONS_KEY, []);
    if (!projects.length) {
      write(MIGRATED_KEY, { at: new Date().toISOString(), moved: 0 });
      return null;
    }
    const r = await importBrowserProjects(projects, versions);
    if (!r.ok) return null; // el servidor no respondió: se reintenta en la próxima carga
    const errors = r.data.filter((i) => i.status === "error");
    const result: MigrationResult = {
      moved: r.data.filter((i) => i.status === "importado").length,
      already: r.data.filter((i) => i.status === "ya-estaba").length,
      examples: r.data.filter((i) => i.example && i.status === "importado").length,
      errors,
    };
    if (!errors.length) write(MIGRATED_KEY, { at: new Date().toISOString(), moved: result.moved });
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}
