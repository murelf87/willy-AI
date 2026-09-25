// AUTOCONSTRUCCIÓN · COPIAS VERIFICADAS (solo servidor). Una copia no vale por existir: vale cuando se ha comprobado que
// contiene exactamente lo que había (huella SHA-256 de cada archivo), que se puede leer y que sirve para restaurar.
// «Copia creada» no es «copia verificada»: el manifiesto dice cuál de las dos es.

export type BackupFile = { path: string; existed: boolean; sha256: string | null; bytes: number };
export type ProgramCopy = { files: number; bytes: number; sha256: string };
export type BackupStatus = "creada" | "verificada" | "fallo-verificacion";
export type BackupManifest = {
  /** v1 (anteriores) solo tenían createdAt, reason y files. */
  version: 2;
  createdAt: string;
  reason: string;
  appVersion: string;
  /** Lista simple de rutas (la leen el paquete de estado y versiones anteriores). */
  files: string[];
  entries: BackupFile[];
  /**
   * Huella de cada archivo tal como lo deja la operación (null = el archivo deja de existir): sirve para saber, al recuperar
   * o volver atrás, si alguien lo ha cambiado después.
   */
  after?: Record<string, string | null>;
  /** Copia verificada del programa que estaba instalado ANTES de la mejora. */
  program?: ProgramCopy;
  /** Huella del programa nuevo que se instaló con la mejora. */
  candidate?: string;
  /** Qué operación la hizo (mejora o vuelta atrás) y, si es una vuelta atrás, qué versión revertía. */
  kind?: "mejora" | "vuelta-atras";
  target?: string;
  status: BackupStatus;
  verifiedAt?: string;
  problems?: string[];
};

async function node() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const crypto = await import("node:crypto");
  return { fs, path, crypto };
}

export async function sha256Of(data: Uint8Array | string): Promise<string> {
  const { crypto } = await node();
  return crypto.createHash("sha256").update(data).digest("hex");
}

const code = (error: unknown): string => (error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "");

/**
 * Escritura que aguanta un apagón: se escribe en un archivo temporal, se obliga al disco a guardarlo de verdad (sync) y
 * solo entonces se le pone su nombre. Así nunca queda un archivo a medias o lleno de ceros con el nombre bueno.
 */
export async function writeFileDurable(target: string, data: string | Uint8Array): Promise<void> {
  const { fs, path } = await node();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.willy-tmp`;
  const handle = await fs.open(temporary, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, target);
}

/** Añade una línea a un archivo y la deja guardada de verdad en el disco. */
export async function appendDurable(target: string, line: string): Promise<void> {
  const { fs, path } = await node();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const handle = await fs.open(target, "a");
  try {
    await handle.write(line);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Copia cada archivo que se va a tocar y comprueba la copia contra el original, byte a byte (huella). No escribe nada en el
 * programa: si una copia no coincide, se detiene ANTES de modificar nada.
 */
export async function backupFiles(root: string, backupDir: string, relPaths: string[]): Promise<{ entries: BackupFile[]; problems: string[] }> {
  const { fs, path } = await node();
  const entries: BackupFile[] = [];
  const problems: string[] = [];
  for (const rel of relPaths) {
    const target = path.resolve(root, rel);
    let original: Buffer;
    try {
      original = await fs.readFile(target);
    } catch (error) {
      if (code(error) !== "ENOENT") throw error;
      entries.push({ path: rel, existed: false, sha256: null, bytes: 0 });
      continue;
    }
    const copy = path.join(backupDir, rel);
    await writeFileDurable(copy, original);
    const expected = await sha256Of(original);
    const stored = await sha256Of(await fs.readFile(copy));
    if (stored !== expected) problems.push(`La copia de ${rel} no coincide con el original.`);
    entries.push({ path: rel, existed: true, sha256: expected, bytes: original.length });
  }
  return { entries, problems };
}

/** Vuelve a leer las copias y comprueba sus huellas: la copia existe, se puede leer y es idéntica a lo que había. */
export async function verifyFileBackup(backupDir: string, entries: BackupFile[]): Promise<string[]> {
  const { fs, path } = await node();
  const problems: string[] = [];
  for (const entry of entries) {
    if (!entry.existed) continue;
    try {
      const data = await fs.readFile(path.join(backupDir, entry.path));
      if ((await sha256Of(data)) !== entry.sha256) problems.push(`La copia de ${entry.path} está dañada (huella distinta).`);
    } catch {
      problems.push(`Falta la copia de ${entry.path}.`);
    }
  }
  return problems;
}

/** Huella de una carpeta entera (rutas ordenadas + huella de cada archivo): sirve para comparar el programa y su copia. */
export async function treeDigest(dir: string): Promise<ProgramCopy> {
  const { fs, path, crypto } = await node();
  const files: Array<{ rel: string; hash: string; bytes: number }> = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const data = await fs.readFile(full);
        files.push({ rel: path.relative(dir, full).split(path.sep).join("/"), hash: await sha256Of(data), bytes: data.length });
      }
    }
  };
  await walk(dir);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const all = crypto.createHash("sha256");
  for (const f of files) all.update(`${f.rel}\0${f.hash}\n`);
  return { files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), sha256: all.digest("hex") };
}

/** Copia el programa compilado y comprueba que la copia es idéntica (misma huella de carpeta). */
export async function copyProgram(live: string, dest: string): Promise<{ copy: ProgramCopy; problems: string[] }> {
  const { fs } = await node();
  const before = await treeDigest(live);
  await fs.cp(live, dest, { recursive: true });
  const after = await treeDigest(dest);
  const problems = after.sha256 === before.sha256 ? [] : [`La copia del programa no coincide (${after.files} de ${before.files} archivos iguales en huella).`];
  return { copy: before, problems };
}

export async function writeManifest(backupDir: string, manifest: BackupManifest): Promise<void> {
  const { path } = await node();
  await writeFileDurable(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

/** Lee el manifiesto de una copia (también los antiguos, que solo decían qué archivos había: esos no están verificados). */
export async function readManifest(backupDir: string): Promise<BackupManifest | null> {
  const { fs, path } = await node();
  try {
    const raw = JSON.parse(await fs.readFile(path.join(backupDir, "manifest.json"), "utf8")) as Partial<BackupManifest> & { files?: string[] };
    if (raw.version === 2 && Array.isArray(raw.entries)) return raw as BackupManifest;
    const files = Array.isArray(raw.files) ? raw.files.map(String) : [];
    return { version: 2, createdAt: String(raw.createdAt ?? ""), reason: String(raw.reason ?? ""), appVersion: "", files, entries: files.map((p) => ({ path: p, existed: true, sha256: null, bytes: 0 })), status: "creada" };
  } catch {
    return null;
  }
}

/**
 * Restaura los archivos de una copia, comprobando antes cada huella (no se restaura nada dañado). Lo que no existía antes
 * se elimina. Devuelve los problemas encontrados; si hay alguno ANTES de empezar, no se toca nada.
 */
export async function restoreFiles(root: string, backupDir: string, entries: BackupFile[]): Promise<{ ok: boolean; restored: string[]; problems: string[] }> {
  const { fs, path } = await node();
  const checked = await verifyFileBackup(backupDir, entries.filter((e) => e.sha256));
  if (checked.length) return { ok: false, restored: [], problems: checked };
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  const restored: string[] = [];
  const problems: string[] = [];
  for (const entry of entries) {
    const target = path.resolve(root, entry.path);
    if (!target.startsWith(rootPrefix)) { problems.push(`Ruta no permitida: ${entry.path}`); continue; }
    try {
      if (entry.existed) {
        await writeFileDurable(target, await fs.readFile(path.join(backupDir, entry.path)));
      } else {
        await fs.rm(target, { force: true });
      }
      await fs.rm(`${target}.willy-tmp`, { force: true });
      restored.push(entry.path);
    } catch (error) {
      problems.push(`No se pudo restaurar ${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: problems.length === 0, restored, problems };
}
