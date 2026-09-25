// AUTOCONSTRUCCIÓN · VERSIÓN CANDIDATA (solo servidor). Toda mejora se hace primero en una COPIA APARTE del código
// («version-candidata», dentro de la instalación): allí se escribe el cambio, se compila, se comprueban los tipos y se
// prueba el programa nuevo. La versión que funciona NO se toca hasta que la candidata lo ha superado todo; entonces se
// promociona (copia verificada → archivos → programa) y la candidata se borra.
//
// La carpeta está dentro de la instalación a propósito: así el código de la candidata encuentra las mismas herramientas
// (node_modules de la instalación, dos niveles más arriba) sin enlaces ni atajos que al borrar pudieran tocar otra cosa.

import { sha256Of } from "@/lib/self-build-backup";

export const CANDIDATE_DIR = "version-candidata";
/** Lo que necesita la candidata para compilar exactamente igual que la instalación. */
export const CANDIDATE_TREES = ["src", "public"] as const;
export const CANDIDATE_ROOT_FILES = ["package.json", "tsconfig.json", "vite.config.ts", "vite.config.local.ts"] as const;
/** Archivos que genera la propia compilación dentro del código (el mapa de pantallas de TanStack Router). */
export const GENERATED = /(^|\/)routeTree\.gen\.ts$/;

/** Huella de cada archivo del código (src, public y configuración), por ruta relativa con «/». */
export type SourceSnapshot = Record<string, string>;

async function node() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return { fs, path };
}

const errorCode = (error: unknown): string => (error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "");

/** Carpeta de la candidata de esta instalación (siempre la misma: solo hay una operación a la vez). */
export async function candidatePath(root: string): Promise<string> {
  const { path } = await node();
  return path.join(path.resolve(root), CANDIDATE_DIR);
}

async function listTree(base: string, rel: string, out: string[]): Promise<void> {
  const { fs, path } = await node();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(path.join(base, rel), { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await listTree(base, child, out);
    } else if (entry.isFile() && !entry.name.endsWith(".willy-tmp")) {
      out.push(child);
    }
  }
}

/** Todas las rutas del código que forman una versión (src, public y los archivos de configuración de la raíz). */
export async function sourceFiles(base: string): Promise<string[]> {
  const { fs, path } = await node();
  const out: string[] = [];
  for (const tree of CANDIDATE_TREES) await listTree(base, tree, out);
  for (const file of CANDIDATE_ROOT_FILES) {
    try {
      if ((await fs.stat(path.join(base, file))).isFile()) out.push(file);
    } catch {
      /* archivo opcional */
    }
  }
  return out.sort();
}

/** Huella de todo el código de una carpeta (para saber si alguien lo cambia mientras se prepara la candidata). */
export async function snapshotSources(base: string): Promise<SourceSnapshot> {
  const { fs, path } = await node();
  const snapshot: SourceSnapshot = {};
  for (const rel of await sourceFiles(base)) {
    try {
      snapshot[rel] = await sha256Of(await fs.readFile(path.join(base, rel)));
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error; // un archivo que desaparece mientras se lee no cuenta
    }
  }
  return snapshot;
}

/** Qué ha cambiado entre dos huellas del código (añadido, cambiado o borrado). */
export function diffSnapshots(before: SourceSnapshot, after: SourceSnapshot): string[] {
  const changed = new Set<string>();
  for (const [rel, hash] of Object.entries(before)) if (after[rel] !== hash) changed.add(rel);
  for (const rel of Object.keys(after)) if (!(rel in before)) changed.add(rel);
  return [...changed].sort();
}

/** Borra la candidata. Nunca toca nada fuera de «version-candidata» (se comprueba la ruta antes). */
export async function removeCandidate(root: string): Promise<boolean> {
  const { fs, path } = await node();
  const dir = await candidatePath(root);
  if (path.dirname(dir) !== path.resolve(root) || path.basename(dir) !== CANDIDATE_DIR) return false;
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
    return true;
  } catch {
    return false; // Windows puede tenerla bloqueada un momento: se borra en la próxima operación
  }
}

export type Candidate = { dir: string; snapshot: SourceSnapshot; files: number };

/**
 * Crea la candidata: copia verificada (huella por archivo) del código actual en «version-candidata». Si ya había una de
 * una operación anterior, se borra antes. Devuelve la huella del código actual para detectar cambios ajenos después.
 */
export async function createCandidate(root: string): Promise<Candidate> {
  const { fs, path } = await node();
  const dir = await candidatePath(root);
  await removeCandidate(root);
  const snapshot = await snapshotSources(root);
  await fs.mkdir(dir, { recursive: true });
  for (const rel of Object.keys(snapshot)) {
    const target = path.join(dir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(root, rel), target);
  }
  const copied = await snapshotSources(dir);
  const wrong = diffSnapshots(snapshot, copied);
  if (wrong.length) throw new Error(`La copia de trabajo no quedó igual que el código actual (${wrong.slice(0, 4).join(", ")}).`);
  return { dir, snapshot, files: Object.keys(snapshot).length };
}

/** Escribe los cambios de la mejora en la candidata (nunca en la versión que funciona) y comprueba cada uno. */
export async function writeIntoCandidate(dir: string, changes: Map<string, string>): Promise<void> {
  const { fs, path } = await node();
  const prefix = `${path.resolve(dir)}${path.sep}`;
  for (const [rel, content] of changes) {
    const target = path.resolve(dir, rel);
    if (!target.startsWith(prefix)) throw new Error(`Ruta no permitida: ${rel}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    if ((await fs.readFile(target, "utf8")) !== content) throw new Error(`No se pudo verificar ${rel} en la copia de trabajo.`);
  }
}

/**
 * Archivos que la compilación regeneró dentro del código de la candidata (el mapa de pantallas) y que no son parte del
 * cambio: se instalan junto con él para que el código y el programa sigan coincidiendo.
 */
export async function generatedChanges(dir: string, snapshot: SourceSnapshot, changes: Map<string, string>): Promise<Map<string, string>> {
  const { fs, path } = await node();
  const out = new Map<string, string>();
  const now = await snapshotSources(dir);
  for (const rel of diffSnapshots(snapshot, now)) {
    if (changes.has(rel) || !GENERATED.test(rel) || !(rel in now)) continue;
    out.set(rel, await fs.readFile(path.join(dir, rel), "utf8"));
  }
  return out;
}
