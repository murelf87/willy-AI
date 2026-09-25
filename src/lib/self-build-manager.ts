// AUTOCONSTRUCCIÓN · GESTOR DE OPERACIONES (solo servidor). Todo lo que cambia WILLY por dentro pasa por aquí, siempre
// en este orden:
//   1. el cambio se resuelve y se comprueba EN MEMORIA (sin tocar nada);
//   2. se escribe la MARCA de operación en curso (antes de tocar nada) y cada paso queda en el diario;
//   3. VERSIÓN CANDIDATA aparte («version-candidata»): allí se escribe el cambio, se compila, se comprueban los tipos
//      (solo bloquea un error NUEVO) y su programa se prueba APARTE (otro puerto). La versión que funciona no se toca;
//   4. si nadie cambió el código mientras tanto: copia de cada archivo y del programa + verificación por huella → solo
//      entonces se escriben los archivos y el programa de la candidata sustituye al instalado (intercambio);
//   5. versión nueva en el registro (changelog, pruebas, copia para volver atrás) → COMPLETED;
//   6. reinicio (si el programa nuevo no responde, el ayudante vuelve solo al anterior y deja un informe).
// Si algo falla ANTES de promocionar, no hay nada que deshacer (se descarta la candidata). Si falla durante la promoción, se
// deshace SOLO lo que hizo la operación (nunca se pisa lo que otra IA o el dueño hayan cambiado). Si WILLY se apaga a mitad,
// la marca dice en qué paso se quedó y recoverInterrupted() lo resuelve la próxima vez (restaurar o terminar), sin
// adivinar. Las marcas, copias y registros se escriben de forma que aguanten un apagón. La vuelta atrás usa el mismo circuito.
//
// La respuesta de applySelfBuild mantiene EXACTAMENTE los campos de siempre ({ok, applied, compiled, restarting, installed,
// folder, backup, written, total, evidence} o {ok:false, error, backup?}): otras partes (y otras IA) dependen de ella.

import { applyPatch, syntaxProblems, validateContent, type TsModule } from "@/lib/patch-apply";
import { changeItems, cleanChecks, describeFailures, evidenceMarkdown, failures, sourceCheck, summarize, type Checks, type EvidenceItem, type EvidenceReport } from "@/lib/evidence";
import { backupFiles, copyProgram, readManifest, restoreFiles, sha256Of, treeDigest, verifyFileBackup, writeFileDurable, writeManifest, type BackupFile, type BackupManifest, type ProgramCopy } from "@/lib/self-build-backup";
import { CANDIDATE_STATE, SB_DIR, appendEvent, clearMarker, opId, readJournal, readMarker, readMarkerState, serverStartedAt, summarizeOperations, writeMarker, type JournalStep, type Marker, type OperationKind, type OperationSummary, type Verdict } from "@/lib/self-build-journal";
import { changelogFor, confirmHealth, labelOf, loadRegistry, protectedBackups, recordPromotion, recordRollback, writeRegistry, type Registry, type VersionEntry } from "@/lib/self-build-versions";
import { RESTART_REPORT, UPDATE_LOCK, type RestartInfo } from "@/lib/self-build-ops";
import { candidatePath, createCandidate, diffSnapshots, generatedChanges, removeCandidate, snapshotSources, writeIntoCandidate } from "@/lib/self-build-candidate";
import { describeDiagnostics, newDiagnostics, type TypecheckResult } from "@/lib/self-build-typecheck";

/** Copias que se conservan en disco (las más antiguas se borran, nunca las protegidas: actual, última buena y 3 estables). */
export const KEEP_BACKUPS = 10;
/** Una operación que lleva más de esto sin terminar no puede seguir viva (la compilación se corta a los 3 minutos). */
const STALE_MS = 30 * 60_000;
/** Tras pedir el reinicio, este proceso se cierra en segundos: mientras tanto no empieza nada nuevo. */
const RESTART_GRACE_MS = 60_000;
export const STAGE_PORT = 3100;
export const HEALTH_FILE = "salud.json";

export type Collected = { items: EvidenceItem[]; gating: boolean; screenshots?: { backup: string; changedPct: number } };
export type EvidenceInput = { root: string; checks: Checks; newOutput: string; liveOutput: string | null; liveUrl: string | null; backupDir: string; stagePort: number };

export type ManagerDeps = {
  /** Versión oficial que está ejecutándose, «0.0.43+13». */
  appVersion: string;
  loadTypeScript: (root: string) => Promise<TsModule | null>;
  /** Compila `cwd` (la versión candidata) con las herramientas de la instalación `root`. */
  build: (root: string, cwd: string) => Promise<{ ok: boolean; detail: string }>;
  /** Comprobación de tipos de `cwd` con el TypeScript de la instalación. Sin ella, los tipos quedan «sin comprobar». */
  typecheck?: (root: string, cwd: string) => Promise<TypecheckResult>;
  collectEvidence: (input: EvidenceInput) => Promise<Collected>;
  isInstalled: (root: string) => Promise<boolean>;
  /** Instala en app/.output el programa compilado de `source` (con intercambio). */
  deploy: (root: string, source: string) => Promise<{ installed: boolean; detail: string }>;
  /** Reinicia con el programa instalado; con `info.fallback`, vuelve solo al anterior si el nuevo no responde. */
  restart: (root: string, info?: RestartInfo) => Promise<void>;
  writeReport: (backupDir: string, report: EvidenceReport, markdown: string) => Promise<void>;
  appendJournal: (root: string, entry: { at: string; request: string; files: string[]; backup: string; evidence: string }) => Promise<void>;
  now?: () => Date;
  pid?: number;
  /** Cuándo arrancó este servidor. */
  startedAt?: string;
  /** Cuándo arrancó el equipo (ms): una marca de antes de arrancar el equipo es de un proceso que ya no existe. */
  bootTime?: number;
  isAlive?: (pid: number) => boolean;
  /** Copia de prueba del programa nuevo (otro puerto): nunca aplica, recupera ni confirma nada. */
  isStage?: boolean;
  keepBackups?: number;
  /** Cuánto se espera sin empezar nada nuevo tras pedir el reinicio (el proceso se cierra en segundos). */
  restartGraceMs?: number;
};

export type ApplyInput = {
  root: string;
  name: string;
  files: Array<{ path: string; content: string }>;
  patches: Array<{ path: string; search: string; replace: string }>;
  checks: unknown;
  liveUrl: string | null;
};

export type Outcome = { status: number; body: Record<string, unknown> };

export type RecoveryState = "nada" | "en-curso" | "recuperada" | "completada" | "bloqueada";
export type Recovery = { state: RecoveryState; op?: string; step?: JournalStep; message: string; restored?: string[]; foreign?: string[] };

// ------------------------------------------------------------------------------------------------------- utilidades

/** Solo una operación a la vez en este proceso (dos a la vez se pisarían los archivos). Guarda el nombre de la que está en marcha. */
let busy: string | null = null;
/** Hasta cuándo se está reiniciando este proceso (tras instalar o volver atrás). */
let restartingUntil = 0;
export const currentOperation = (): string | null => busy;

async function node() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  return { fs, path, os };
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const errorCode = (error: unknown): string => (error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "");
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Outcome => ({ status, body: { ok: false, error, ...extra } });
const clock = (deps: ManagerDeps) => deps.now ?? (() => new Date());
const RM = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } as const;

async function quietly(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    /* el diario y los informes nunca deben romper (ni deshacer) una operación */
    return false;
  }
}

async function exists(target: string): Promise<boolean> {
  const { fs } = await node();
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

async function hashFileOrNull(target: string): Promise<string | null> {
  const { fs } = await node();
  try {
    return await sha256Of(await fs.readFile(target));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

/** Huella del programa instalado (null si no hay programa completo en app/.output). */
async function liveDigest(root: string): Promise<string | null> {
  const { path } = await node();
  const live = path.join(root, "app", ".output");
  if (!(await exists(path.join(live, "server", "index.mjs")))) return null;
  return (await treeDigest(live)).sha256;
}

async function dirDigest(dir: string): Promise<string | null> {
  if (!(await exists(dir))) return null;
  return (await treeDigest(dir)).sha256;
}

/** Nombre de operación que no coincide con ninguna carpeta de copia existente. */
async function uniqueOp(root: string, base: string): Promise<string> {
  const { path } = await node();
  for (let i = 1; i < 50; i += 1) {
    const name = i === 1 ? base : `${base}-${i}`;
    if (!(await exists(path.join(root, SB_DIR, name)))) return name;
  }
  return `${base}-${Date.now()}`;
}

/**
 * La ruta tal como está en el disco: en Windows «src/lib/A.ts» y «src/lib/a.ts» son el MISMO archivo, así que se usa el
 * nombre que ya tiene (si existe) para no tratarlo como dos archivos distintos ni cambiarle las mayúsculas sin querer.
 */
async function onDiskPath(root: string, rel: string): Promise<string> {
  const { fs, path } = await node();
  const parts = rel.split("/").filter((part) => part && part !== ".");
  const out: string[] = [];
  let current = root;
  for (let i = 0; i < parts.length; i += 1) {
    const want = parts[i]!;
    let names: string[];
    try {
      names = await fs.readdir(current);
    } catch {
      out.push(...parts.slice(i));
      break;
    }
    const found = names.includes(want) ? want : names.find((name) => name.toLowerCase() === want.toLowerCase());
    out.push(found ?? want);
    if (!found) {
      out.push(...parts.slice(i + 1));
      break;
    }
    current = path.join(current, found);
  }
  return out.join("/");
}

/** ¿Está instalando ahora mismo el actualizador oficial (.bat)? Entonces la Autoconstrucción no empieza nada. */
async function officialUpdateRunning(root: string, deps: ManagerDeps): Promise<string | null> {
  const { fs, path } = await node();
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, SB_DIR, UPDATE_LOCK), "utf8")) as { pid?: unknown; at?: unknown; version?: unknown };
    const age = Date.now() - new Date(String(raw.at ?? "")).getTime();
    const alive = typeof raw.pid === "number" && (deps.isAlive ?? processAlive)(raw.pid);
    if (alive && age >= 0 && age < 2 * 3600_000) {
      return `Se está instalando una actualización oficial de WILLY${raw.version ? ` (${String(raw.version)})` : ""}: espera a que termine y vuelve a intentarlo.`;
    }
  } catch {
    /* no se está actualizando */
  }
  return null;
}

/** Deja solo las últimas copias para que el disco no se llene; las protegidas (actual, última buena, estables) nunca se borran. */
export async function pruneBackups(root: string, keep = KEEP_BACKUPS, protect: Set<string> = new Set()): Promise<string[]> {
  const removed: string[] = [];
  try {
    const { fs, path } = await node();
    const base = path.join(root, SB_DIR);
    const names = (await fs.readdir(base, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const name of names.slice(0, Math.max(0, names.length - keep))) {
      if (protect.has(name)) continue;
      await fs.rm(path.join(base, name), RM);
      removed.push(name);
    }
  } catch {
    /* limpiar copias antiguas nunca debe estropear una mejora ya aplicada */
  }
  return removed;
}

/**
 * Deshace SOLO lo que hizo la operación: un archivo se restaura si sigue exactamente como lo dejó la operación (o si es uno
 * que la propia operación no pudo verificar al escribirlo); si ya está como antes, se deja; si alguien lo ha cambiado
 * después (otra IA, el dueño, una actualización), NO se toca y se avisa.
 */
async function restoreOwnChanges(root: string, backupDir: string, manifest: BackupManifest, force: Set<string> = new Set()): Promise<{ restored: string[]; skipped: string[]; foreign: string[]; problems: string[] }> {
  const { fs, path } = await node();
  const after = manifest.after ?? {};
  const toRestore: BackupFile[] = [];
  const skipped: string[] = [];
  const foreign: string[] = [];
  for (const entry of manifest.entries) {
    const target = path.resolve(root, entry.path);
    await fs.rm(`${target}.willy-tmp`, { force: true }).catch(() => undefined);
    const current = await hashFileOrNull(target);
    const ours = entry.path in after ? after[entry.path] : undefined;
    if ((ours !== undefined && current === ours) || force.has(entry.path)) toRestore.push(entry);
    else if (entry.existed ? current === entry.sha256 : current === null) skipped.push(entry.path);
    else foreign.push(entry.path);
  }
  const result = toRestore.length ? await restoreFiles(root, backupDir, toRestore) : { ok: true, restored: [] as string[], problems: [] as string[] };
  return { restored: result.restored, skipped, foreign, problems: result.problems };
}

/**
 * El programa que funcionaba tiene que estar en su sitio: si no lo está, se vuelve a poner su copia verificada (por
 * intercambio y, si Windows no deja cambiar nombres, copiándola). Devuelve el problema, o "" si todo quedó bien.
 */
async function ensureProgram(root: string, deps: ManagerDeps, copyDir: string, expected: string): Promise<string> {
  const { fs, path } = await node();
  try {
    if ((await liveDigest(root)) === expected) return "";
    const live = path.join(root, "app", ".output");
    const aside = path.join(root, "app", ".output-anterior");
    const liveMissing = async () => !(await exists(path.join(live, "server", "index.mjs")));
    // 1) Si el programa que funcionaba quedó apartado intacto (intercambio a medias), se vuelve a poner tal cual.
    if ((await liveMissing()) && (await dirDigest(aside)) === expected) {
      await fs.rm(live, RM).catch(() => undefined);
      await fs.rename(aside, live).catch(() => undefined);
      if ((await liveDigest(root)) === expected) return "";
    }
    // 2) Si no, su copia verificada: por intercambio y, si Windows no deja cambiar nombres, copiándola.
    if ((await dirDigest(copyDir)) !== expected) return "la copia del programa anterior no coincide con su huella";
    try {
      await deps.deploy(root, copyDir);
    } catch {
      /* se intenta copiándola directamente */
    }
    if ((await liveDigest(root)) === expected) return "";
    if (await liveMissing()) {
      await fs.rm(live, RM).catch(() => undefined);
      await fs.cp(copyDir, live, { recursive: true });
      if ((await liveDigest(root)) === expected) return "";
    }
    return "el programa anterior no quedó en su sitio";
  } catch (error) {
    return `no se pudo volver a poner el programa anterior (${message(error)})`;
  }
}

/**
 * Tipos de la candidata frente a los de la versión actual (`baseline`): solo bloquea un error NUEVO. Si no se puede
 * comprobar (sin TypeScript, tarda demasiado…), la mejora sigue con los tipos «sin comprobar», nunca «correctos».
 */
async function typecheckGate(deps: ManagerDeps, root: string, dir: string, baseline: TypecheckResult | null): Promise<{ verdict: Verdict; note: string; fresh: number }> {
  if (!deps.typecheck || !baseline) return { verdict: "NOT_VERIFIED", note: "Tipos sin comprobar: este entorno no tiene el comprobador de TypeScript.", fresh: 0 };
  if (baseline.status !== "ok" && baseline.status !== "errors") return { verdict: "NOT_VERIFIED", note: `Tipos sin comprobar: ${baseline.detail}`, fresh: 0 };
  const result = await deps.typecheck(root, dir);
  if (result.status === "ok") return { verdict: "PASS", note: "Sin errores de tipos (TypeScript).", fresh: 0 };
  if (result.status !== "errors") return { verdict: "NOT_VERIFIED", note: `Tipos sin comprobar: ${result.detail}`, fresh: 0 };
  const fresh = newDiagnostics(baseline.diagnostics, result.diagnostics);
  if (fresh.length) {
    throw new Error(`La comprobación de tipos (TypeScript) encontró ${fresh.length} error(es) NUEVO(S) que introduce el cambio (no se instaló nada):\n${describeDiagnostics(fresh)}`);
  }
  return { verdict: "PASS", note: `Sin errores de tipos nuevos (TypeScript). ${result.diagnostics.length} ya existían antes de la mejora y no son culpa suya.`, fresh: 0 };
}

function typesEvidence(types: { verdict: Verdict; note: string }): EvidenceItem {
  return { kind: "compilado", status: types.verdict === "PASS" ? "ok" : "info", title: types.verdict === "PASS" ? "Tipos comprobados (TypeScript)" : "Tipos sin comprobar", detail: types.note };
}

/** ¿Falta el programa instalado? (para decirlo claro: entonces WILLY no puede volver a abrirse hasta reponerlo) */
async function programMissing(root: string): Promise<boolean> {
  const { path } = await node();
  return !(await exists(path.join(root, "app", ".output", "server", "index.mjs")));
}

/**
 * Si este servidor está funcionando con una COPIA del programa (el arranque seguro no pudo cargar el instalado y arrancó
 * con la última copia buena), devuelve su carpeta; si funciona con el programa instalado o no se sabe, null.
 */
async function runningFromCopy(root: string): Promise<string | null> {
  const main = (globalThis as { __nitro_main__?: unknown }).__nitro_main__;
  if (typeof main !== "string" || !main.startsWith("file:")) return null;
  try {
    const { path } = await node();
    const { fileURLToPath } = await import("node:url");
    const dir = path.dirname(path.dirname(fileURLToPath(main)));
    const norm = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
    const base = `${norm(root)}${path.sep}`;
    if (norm(dir) === norm(path.join(root, "app", ".output")) || !norm(dir).startsWith(base)) return null;
    return dir;
  } catch {
    return null;
  }
}

async function relativeCopy(root: string, dir: string | null): Promise<string | null> {
  if (!dir) return null;
  const { path } = await node();
  return path.relative(root, dir).split(path.sep).join("/") || null;
}

/** La copia desde la que está funcionando este servidor nunca se borra al limpiar copias antiguas. */
async function protectRunning(root: string, protect: Set<string>): Promise<Set<string>> {
  const copy = await runningFromCopy(root);
  if (copy) {
    const { path } = await node();
    const rel = path.relative(path.join(root, SB_DIR), copy).split(path.sep);
    if (rel[0] && rel[0] !== ".." && !path.isAbsolute(rel[0])) protect.add(rel[0]);
  }
  return protect;
}

// ------------------------------------------------------------------------------------------------ aplicar una mejora

export async function applySelfBuild(input: ApplyInput, deps: ManagerDeps): Promise<Outcome> {
  if (deps.isStage) return fail(409, "Esta es la copia de prueba de WILLY (otro puerto): aquí nunca se aplican mejoras.");
  if (!input.files.length && !input.patches.length) return fail(400, "La mejora no contiene archivos válidos.");
  if (busy) return fail(409, "Ya hay otra mejora aplicándose en este momento. Espera a que termine.");
  if (Date.now() < restartingUntil) return fail(409, "WILLY se está reiniciando con la versión nueva: espera unos segundos y vuelve a intentarlo.");
  busy = "mejora";
  try {
    return await applyLocked(input, deps);
  } finally {
    busy = null;
  }
}

async function applyLocked(input: ApplyInput, deps: ManagerDeps): Promise<Outcome> {
  const { fs, path } = await node();
  const { root } = input;
  const now = clock(deps);
  const objective = input.name.trim() || "Mejora de WILLY AI";
  if (!(await exists(path.join(root, "src")))) {
    return fail(409, "Esta instalación no contiene todavía el código editable de WILLY AI. Actualiza a la versión que incluye la autoconstrucción real.");
  }

  // 0) Una operación anterior que se quedó a medias se resuelve ANTES de empezar otra; y nada mientras se actualiza.
  const previous = await recoverLocked(root, deps);
  if (previous.state === "bloqueada" || previous.state === "en-curso") return fail(409, `${previous.message} Hasta resolverlo no se aplica ninguna mejora nueva.`);
  const updating = await officialUpdateRunning(root, deps);
  if (updating) return fail(409, updating);

  const op = await uniqueOp(root, opId(now(), objective));
  busy = op;
  const backup = path.join(root, SB_DIR, op);
  const liveOutput = path.join(root, "app", ".output");
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  let marker: Marker | null = null;
  // La marca va PRIMERO (es lo que permite recuperar); el diario, después y sin romper nada si falla.
  const mark = async (stepName: JournalStep, detail?: string): Promise<void> => {
    const at = now().toISOString();
    if (marker) {
      marker.step = stepName;
      marker.stepAt = at;
      await writeMarker(root, marker);
    }
    await quietly(() => appendEvent(root, { op, at, step: stepName, ...(detail ? { detail } : {}), ...(stepName === "STARTED" ? { kind: "mejora" as const } : {}) }));
  };
  await quietly(() => mark("STARTED", objective));

  // 1) Resolver TODOS los cambios en memoria y comprobarlos. Hasta aquí no se ha tocado nada del disco.
  const originals = new Map<string, string | null>();
  const original = async (relative: string): Promise<string | null> => {
    if (!originals.has(relative)) {
      try {
        originals.set(relative, await fs.readFile(path.resolve(root, relative), "utf8"));
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
        originals.set(relative, null);
      }
    }
    return originals.get(relative) ?? null;
  };
  const changes = new Map<string, string>();
  const tests: Record<string, Verdict> = {};
  let checks: Checks;
  let codeItems: EvidenceItem[];
  try {
    // Rutas tal como están en el disco (mayúsculas incluidas) y sin dos nombres para el mismo archivo.
    const canonical = new Map<string, string>();
    const onDisk = async (rel: string) => {
      if (!canonical.has(rel)) canonical.set(rel, await onDiskPath(root, rel));
      return canonical.get(rel)!;
    };
    const files = await Promise.all(input.files.map(async (file) => ({ ...file, path: await onDisk(file.path) })));
    const patches = await Promise.all(input.patches.map(async (patch) => ({ ...patch, path: await onDisk(patch.path) })));
    const byLower = new Map<string, string>();
    for (const rel of [...files.map((f) => f.path), ...patches.map((p) => p.path)]) {
      const seen = byLower.get(rel.toLowerCase());
      if (seen && seen !== rel) throw new Error(`«${seen}» y «${rel}» son el mismo archivo en Windows (solo cambian las mayúsculas). Usa un único nombre.`);
      byLower.set(rel.toLowerCase(), rel);
    }
    const wholeFiles = new Set<string>();
    for (const file of files) {
      changes.set(file.path, file.content);
      wholeFiles.add(file.path);
    }
    for (const patch of patches) {
      const base = changes.get(patch.path) ?? (await original(patch.path));
      if (base === null) throw new Error(`${patch.path} no existe, así que no se le puede aplicar una sustitución. Entrega el archivo completo.`);
      const result = applyPatch(base, patch.search, patch.replace);
      if (!result.ok) throw new Error(`${patch.path}: ${result.error}`);
      changes.set(patch.path, result.content);
    }
    for (const [relativePath, content] of changes) {
      const problem = validateContent(relativePath, content, await original(relativePath), wholeFiles.has(relativePath));
      if (problem) throw new Error(problem);
      if (!path.resolve(root, relativePath).startsWith(rootPrefix)) throw new Error(`Ruta no permitida: ${relativePath}`);
    }
    // 1a) Evidencias en el código: ¿el cambio hace lo que se pidió? Se mira ANTES de guardar nada ni compilar.
    checks = cleanChecks(input.checks);
    const changedFiles = [...changes].map(([relativePath, content]) => ({ path: relativePath, before: originals.get(relativePath) ?? null, after: content }));
    codeItems = [...changeItems(changedFiles), ...sourceCheck(changedFiles, checks)];
    const codeFailures = failures(codeItems);
    if (codeFailures.length) throw new Error(`El cambio propuesto no hace lo que se pidió (no se guardó nada):\n${describeFailures(codeFailures)}`);
    tests["evidenciasCodigo"] = "PASS";
    // 1b) Sintaxis en segundos con el TypeScript de la propia instalación (en vez de esperar minutos a la compilación).
    const typescript = await deps.loadTypeScript(root);
    if (typescript) {
      const found: string[] = [];
      for (const [relativePath, content] of changes) found.push(...syntaxProblems(typescript, relativePath, content));
      if (found.length) throw new Error(`Error de sintaxis en el código propuesto (no se guardó nada):\n${found.slice(0, 6).join("\n")}`);
      tests["sintaxis"] = "PASS";
    } else {
      tests["sintaxis"] = "NOT_VERIFIED";
    }
  } catch (error) {
    await quietly(() => mark("FAILED", `No se tocó nada: ${message(error)}`));
    return fail(500, `No se aplicó la mejora y se restauró la copia anterior: ${message(error)}`);
  }

  // 2) Marca de operación en curso, escrita ANTES de tocar nada. Sin marca no se sigue.
  const files = [...changes.keys()];
  const installed = await deps.isInstalled(root).catch(() => false);
  const startedAt = now().toISOString();
  const opMarker: Marker = {
    op, kind: "mejora", startedAt, pid: deps.pid ?? process.pid, serverStartedAt: deps.startedAt ?? serverStartedAt(), objective, appVersion: deps.appVersion,
    backupDir: `${SB_DIR}/${op}`, files, step: "STARTED", stepAt: startedAt, tests: { ...tests }, installed, touched: false,
  };
  try {
    await writeMarker(root, opMarker);
    marker = opMarker;
  } catch (error) {
    await quietly(() => mark("FAILED", `No se tocó nada: no se pudo anotar la operación en curso (${message(error)}).`));
    return fail(500, `No se aplicó la mejora y se restauró la copia anterior: no se pudo anotar la operación en curso (${message(error)}).`);
  }

  let manifest: BackupManifest | null = null;
  let wrote = false;
  let promotionStarted = false;
  const unverified = new Set<string>();
  let report: EvidenceReport = { at: startedAt, items: [] };
  try {
    // 3) VERSIÓN CANDIDATA: copia verificada del código en «version-candidata». Todo lo que sigue (escribir el cambio,
    //    compilar, comprobar tipos y probar el programa nuevo) se hace ahí: la versión que funciona NO se toca.
    const cand = await createCandidate(root);
    tests["candidata"] = "PASS";
    await mark("CANDIDATE_CREATED", `Versión candidata aparte con ${cand.files} archivo(s) del código: la versión que funciona no se toca hasta que la candidata lo supere todo.`);
    // Tipos de la versión actual (la referencia): lo que ya fallaba antes no es culpa de la mejora.
    const baseline = deps.typecheck ? await deps.typecheck(root, cand.dir) : null;
    await writeIntoCandidate(cand.dir, changes);
    await mark("CANDIDATE_EDITED", files.join(", "));

    // 4) Compilar la candidata (su programa queda en version-candidata/.output).
    await mark("BUILD_STARTED");
    const candidateOutput = path.join(cand.dir, ".output");
    const build = await deps.build(root, cand.dir);
    if (!build.ok) throw new Error(`La comprobación encontró errores: ${build.detail}`);
    if (installed && !(await exists(path.join(candidateOutput, "server", "index.mjs")))) {
      throw new Error("La compilación terminó sin errores, pero no generó el programa nuevo (.output/server/index.mjs). No se instala nada.");
    }
    tests["compilacion"] = "PASS";
    opMarker.tests = { ...tests };
    await mark("BUILD_SUCCESS", build.detail);

    // 5) Tipos (TypeScript): compilar no basta; solo bloquea un error NUEVO que introduzca la mejora.
    await mark("TYPECHECK_STARTED");
    const types = await typecheckGate(deps, root, cand.dir, baseline);
    tests["tipos"] = types.verdict;
    opMarker.tests = { ...tests };
    await mark("TYPECHECK_SUCCESS", types.note);

    // 6) Evidencias del programa compilado: la candidata se prueba APARTE (otro puerto) antes de instalarla, se cuentan
    //    los textos antes/después y, si hay Edge o Chrome, se dibuja la pantalla y se comparan capturas.
    await mark("TEST_STARTED");
    const evidenceItems: EvidenceItem[] = [...codeItems];
    let evidenceShots: EvidenceReport["screenshots"];
    let evidenceGate = "";
    try {
      const collected = await deps.collectEvidence({ root, checks, newOutput: candidateOutput, liveOutput: (await exists(liveOutput)) ? liveOutput : null, liveUrl: input.liveUrl, backupDir: backup, stagePort: STAGE_PORT });
      evidenceItems.push(...collected.items);
      evidenceShots = collected.screenshots;
      if (collected.gating) evidenceGate = describeFailures(failures(collected.items));
      tests["pruebaAparte"] = collected.items.some((item) => item.kind === "arranque" && item.status === "ok") ? "PASS" : "NOT_VERIFIED";
    } catch (error) {
      evidenceItems.push({ kind: "aviso", status: "info", title: "Evidencias del programa compilado", detail: `No se pudieron recoger: ${message(error)}` });
      tests["pruebaAparte"] = "NOT_VERIFIED";
    }
    if (evidenceGate) throw new Error(`La versión compilada no pasa las comprobaciones (no se instaló nada):\n${evidenceGate}`);
    report = { at: now().toISOString(), items: [...evidenceItems, typesEvidence(types)], ...(evidenceShots ? { screenshots: evidenceShots } : {}) };
    const stats = summarize(report.items);
    tests["evidencias"] = stats.fallos ? "FAIL" : "PASS";
    opMarker.tests = { ...tests };
    await mark("TEST_SUCCESS", `${stats.ok} comprobadas · ${stats.fallos} fallos · ${stats.info} informativas`);
    await mark("READY", "La versión candidata compila, no añade errores de tipos y su programa arranca aparte: se promociona.");

    // 7) PROMOCIÓN. Antes de tocar nada: nadie ha cambiado el código mientras se preparaba la candidata (si no, se pisaría su
    //    cambio o el programa nuevo no lo llevaría).
    const foreignNow = diffSnapshots(cand.snapshot, await snapshotSources(root));
    if (foreignNow.length) {
      throw new Error(`Mientras se preparaba la versión candidata alguien cambió ${foreignNow.slice(0, 6).join(", ")}${foreignNow.length > 6 ? ` y ${foreignNow.length - 6} más` : ""}: no se instala para no pisar ese cambio. Vuelve a intentarlo y la nueva candidata ya lo incluirá.`);
    }
    // Lo que se instala: el cambio y lo que la compilación regeneró dentro del código (el mapa de pantallas).
    const promote = new Map<string, string>([...changes, ...(await generatedChanges(cand.dir, cand.snapshot, changes))]);
    const promoted = [...promote.keys()];
    opMarker.files = promoted;
    await mark("PROMOTION_STARTED", promoted.length > files.length ? `También se instala lo que regeneró la compilación: ${promoted.filter((rel) => !changes.has(rel)).join(", ")}.` : undefined);

    // 7a) Copia de cada archivo y del programa instalado, verificadas por huella. Solo si TODO está verificado se modifica algo.
    const copied = await backupFiles(root, backup, promoted);
    const problems = [...copied.problems, ...(await verifyFileBackup(backup, copied.entries))];
    const after: Record<string, string | null> = {};
    for (const [relativePath, content] of promote) after[relativePath] = await sha256Of(content);
    let program: ProgramCopy | undefined;
    let candidate: string | undefined;
    if (installed) {
      if (await exists(liveOutput)) {
        const saved = await copyProgram(liveOutput, path.join(backup, "app", ".output"));
        problems.push(...saved.problems.map((problem) => `No se pudo guardar una copia verificada del programa actual: ${problem}`));
        program = saved.copy;
        if (!saved.problems.length) tests["copiaPrograma"] = "PASS";
      }
      candidate = (await treeDigest(candidateOutput)).sha256;
    } else {
      tests["copiaPrograma"] = "N/A";
    }
    manifest = {
      version: 2, createdAt: startedAt, reason: objective, appVersion: deps.appVersion, files: promoted, entries: copied.entries, after, kind: "mejora",
      ...(program ? { program } : {}), ...(candidate ? { candidate } : {}),
      status: problems.length ? "fallo-verificacion" : "verificada", ...(problems.length ? { problems } : { verifiedAt: now().toISOString() }),
    };
    await writeManifest(backup, manifest);
    if (problems.length) throw new Error(`La copia de seguridad no se pudo verificar, así que no se modificó nada: ${problems.join(" ")}`);
    tests["copiaArchivos"] = "PASS";
    if (candidate) opMarker.candidate = candidate;
    opMarker.tests = { ...tests };
    // Desde aquí la operación puede tocar archivos: queda anotado en la marca antes del primero.
    opMarker.touched = true;
    await mark("BACKUP_VERIFIED", `${promoted.length} archivo(s)${program ? " y el programa instalado" : ""} copiados y comprobados por huella.`);

    // 7b) Escritura que aguanta un apagón (temporal + guardado en disco + cambio de nombre) y verificada.
    wrote = true;
    for (const [relativePath, content] of promote) {
      const target = path.resolve(root, relativePath);
      await writeFileDurable(target, content);
      if ((await fs.readFile(target, "utf8")) !== content) {
        unverified.add(relativePath);
        throw new Error(`No se pudo verificar ${relativePath}`);
      }
    }
    await mark("FILES_MODIFIED", promoted.join(", "));

    // 7c) Programa: el de la candidata sustituye al instalado por intercambio (el que funcionaba no se borra hasta el final).
    promotionStarted = true;
    const deployment = await deps.deploy(root, candidateOutput);
    if (deployment.installed && candidate && (await liveDigest(root)) !== candidate) throw new Error("El programa instalado no coincide con el que se compiló y probó.");
    tests["instalacion"] = deployment.installed ? "PASS" : "N/A";
    await mark("PROMOTED", deployment.detail);

    // 8) Desde aquí la mejora ya está instalada: nada de lo que queda la deshace.
    return await finishApply({ root, deps, op, objective, files: promoted, tests, report, manifest, marker: opMarker, installed: deployment.installed, backup, written: changes.size, mark });
  } catch (error) {
    const reason = message(error);
    await quietly(() => mark("FAILED", reason));
    await removeCandidate(root);
    const problems: string[] = [];
    let foreign: string[] = [];
    // El programa que funcionaba tiene que seguir en su sitio: si la instalación se quedó a medias, se vuelve a poner su copia verificada.
    if (promotionStarted && manifest?.program) {
      const problem = await ensureProgram(root, deps, path.join(backup, "app", ".output"), manifest.program.sha256);
      if (problem) problems.push(problem);
    }
    if (wrote && manifest) {
      const restored = await restoreOwnChanges(root, backup, manifest, unverified);
      foreign = restored.foreign;
      problems.push(...restored.problems);
    }
    const foreignNote = foreign.length ? ` No se tocaron ${foreign.length} archivo(s) que alguien cambió mientras tanto (${foreign.join(", ")}); lo que había antes está en ${backup}.` : "";
    if (!problems.length) {
      if (wrote) await quietly(() => mark("ROLLED_BACK", `Se restauró todo lo de esta mejora.${foreignNote}`));
      const cleared = await quietly(() => clearMarker(root));
      marker = null;
      // La copia de este intento solo se borra cuando ya no hace falta: marca quitada y nada ajeno pendiente.
      if (cleared && !foreign.length) await fs.rm(backup, RM).catch(() => undefined);
      return fail(500, `No se aplicó la mejora y se restauró la copia anterior: ${reason}${foreignNote}`);
    }
    // No se pudo dejar todo como estaba: la marca se queda (paso FAILED) para reintentarlo, y la copia se conserva.
    await quietly(() => mark("FAILED", `No se pudo restaurar automáticamente: ${problems.join(" ")}. Se reintentará; los originales están en ${backup}.`));
    if (installed && (await programMissing(root))) {
      return fail(500, `⚠️ No se aplicó la mejora y el programa instalado quedó fuera de su sitio. NO cierres WILLY: pulsa «Recuperar ahora» en Autoconstrucción → Historial para volver a ponerlo. La copia verificada está en ${backup}. Motivo: ${reason}`, { backup });
    }
    return fail(500, `No se aplicó la mejora y no se pudo restaurar automáticamente algún archivo. Tus originales están en la carpeta ${backup}. Motivo: ${reason}`, { backup });
  }
}

type FinishInput = {
  root: string;
  deps: ManagerDeps;
  op: string;
  objective: string;
  files: string[];
  tests: Record<string, Verdict>;
  report: EvidenceReport;
  manifest: BackupManifest;
  marker: Marker;
  installed: boolean;
  backup: string;
  written: number;
  mark: (stepName: JournalStep, detail?: string) => Promise<void>;
};

/** Registro de la versión, informe, diario, limpieza y reinicio. Nunca lanza errores: la mejora ya está instalada. */
async function finishApply(ctx: FinishInput): Promise<Outcome> {
  const { root, deps, op } = ctx;
  const { path } = await node();
  const now = clock(deps);
  const notes: string[] = [];
  let label = "";
  let registered = false;
  // La candidata ya está instalada (se copió su programa): su carpeta de trabajo sobra.
  await removeCandidate(root);
  try {
    const { reg } = await loadRegistry(root, deps.appVersion, now());
    const next = registerPromotion(reg, deps.appVersion, ctx.marker, ctx.manifest, { ...ctx.tests }, now().toISOString(), ctx.installed);
    await writeRegistry(root, next);
    label = next.entries.find((entry) => entry.id === op)?.label ?? "";
    registered = true;
  } catch (error) {
    notes.push(`No se pudo anotar la versión: ${message(error)}. Se anotará al abrir Autoconstrucción.`);
  }
  await quietly(() => ctx.deps.writeReport(ctx.backup, ctx.report, evidenceMarkdown(ctx.report, ctx.objective)));
  // Diario en disco de las mejoras hechas con la web: se conserva aunque el navegador borre sus datos y va en el paquete de «Continuar el desarrollo».
  await quietly(async () => {
    const stats = summarize(ctx.report.items);
    await deps.appendJournal(root, { at: now().toLocaleString("es-ES"), request: ctx.objective, files: ctx.files, backup: path.basename(ctx.backup), evidence: `${stats.ok} comprobadas · ${stats.fallos} fallos · ${stats.info} informativas` });
  });
  await quietly(async () => {
    const { reg } = await loadRegistry(root, deps.appVersion, now());
    const protect = await protectRunning(root, protectedBackups(reg));
    protect.add(op);
    await pruneBackups(root, deps.keepBackups ?? KEEP_BACKUPS, protect);
  });
  // Sin la versión anotada, la marca se queda (paso PROMOTED): al abrir Autoconstrucción se termina de anotar.
  if (registered) {
    await quietly(() => ctx.mark("COMPLETED", label ? `Versión ${label}.` : "Mejora instalada."));
    await quietly(() => clearMarker(root));
  }
  let restarting = false;
  if (ctx.installed) {
    try {
      await deps.restart(root, { op, kind: "mejora", fallback: ctx.manifest.program ? path.join(ctx.backup, "app", ".output") : null });
      restarting = true;
      restartingUntil = Date.now() + (deps.restartGraceMs ?? RESTART_GRACE_MS);
      await quietly(() => appendEvent(root, { op, at: now().toISOString(), step: "RESTART_SCHEDULED", detail: "El programa se reinicia con la versión nueva (si no responde, vuelve solo a la anterior)." }));
    } catch (error) {
      notes.push(`La mejora está instalada, pero no se pudo reiniciar solo: cierra y abre WILLY (${message(error)}).`);
    }
  }
  return {
    status: 200,
    body: {
      ok: true, applied: true, compiled: true, restarting, installed: ctx.installed, folder: root, backup: ctx.backup, written: ctx.written, total: ctx.written,
      evidence: ctx.report, version: { id: op, label }, ...(notes.length ? { notes } : {}),
    },
  };
}

/** Anota una versión promovida (también al terminarla durante una recuperación). */
function registerPromotion(reg: Registry, base: string, marker: Marker, manifest: BackupManifest, tests: Record<string, Verdict>, promotedAt: string, installed: boolean): Registry {
  if (reg.entries.some((entry) => entry.id === marker.op)) return reg;
  const rollback = manifest.status === "verificada" && (!installed || Boolean(manifest.program));
  return recordPromotion(
    reg,
    {
      id: marker.op, kind: "autoconstruccion", base, at: marker.startedAt, objective: marker.objective, files: marker.files, tests, promotedAt,
      backup: marker.op, rollback, changelog: changelogFor(marker.objective, marker.files), previous: reg.activeId,
      ...(manifest.candidate ? { program: manifest.candidate } : {}),
    },
    { installed },
  );
}

// ------------------------------------------------------------------------------------------- recuperar una operación

/** Resuelve una operación que se quedó a medias (apagón, cierre…). Nunca actúa si la operación sigue viva en otro proceso. */
export async function recoverInterrupted(root: string, deps: ManagerDeps): Promise<Recovery> {
  if (deps.isStage) return { state: "nada", message: "" };
  if (busy) return { state: "en-curso", op: busy, message: "Hay una operación de Autoconstrucción en marcha." };
  busy = "recuperacion";
  try {
    return await recoverLocked(root, deps);
  } finally {
    busy = null;
  }
}

/**
 * Marca dañada (apagón justo al escribirla): se busca a qué operación pertenecía — la copia verificada más reciente cuya
 * operación no terminó según el diario — y se trata como de paso desconocido: se comprueba el programa y se deshace solo lo
 * propio. Si no hay ninguna así, no había nada que deshacer.
 */
async function markerFromBackups(root: string): Promise<Marker | null> {
  const { fs, path } = await node();
  let names: string[] = [];
  try {
    names = (await fs.readdir(path.join(root, SB_DIR), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  } catch {
    return null;
  }
  const journal = await readJournal(root, 2000);
  const finished = new Set(journal.filter((e) => e.step === "COMPLETED" || e.step === "ROLLED_BACK" || e.step === "RECOVERED").map((e) => e.op));
  for (const name of names.slice(0, 5)) {
    if (finished.has(name)) continue;
    const events = journal.filter((e) => e.op === name);
    if (!events.length) continue;
    const manifest = await readManifest(path.join(root, SB_DIR, name));
    if (!manifest || manifest.status !== "verificada" || !manifest.after) continue;
    const kind: OperationKind = manifest.kind ?? events.find((e) => e.kind)?.kind ?? "mejora";
    return {
      op: name, kind, ...(manifest.target ? { target: manifest.target } : {}), startedAt: manifest.createdAt, pid: -1, serverStartedAt: "", objective: manifest.reason,
      appVersion: manifest.appVersion, backupDir: `${SB_DIR}/${name}`, files: manifest.files, step: "FAILED", touched: true, installed: Boolean(manifest.program),
      ...(manifest.candidate ? { candidate: manifest.candidate } : {}),
    };
  }
  return null;
}

async function recoverLocked(root: string, deps: ManagerDeps): Promise<Recovery> {
  const { fs, path, os } = await node();
  const now = clock(deps);
  const state = await readMarkerState(root);
  let marker = state.marker;
  let unknownStep = false;
  if (!marker && state.damaged) {
    marker = await markerFromBackups(root);
    if (!marker) {
      await quietly(() => clearMarker(root));
      await quietly(() => appendEvent(root, { op: "marca-dañada", at: now().toISOString(), step: "RECOVERED", detail: "La marca de operación estaba dañada (apagón) y no había ninguna operación con copia verificada que deshacer." }));
      return { state: "recuperada", message: "La marca de operación estaba dañada (apagón) y no había nada que deshacer." };
    }
    unknownStep = true;
  }
  if (!marker) {
    // Sin operación a medias, una carpeta de candidata que quedara de antes (cierre inesperado) ya no sirve.
    if (await exists(await candidatePath(root))) await removeCandidate(root);
    return { state: "nada", message: "" };
  }
  const pid = deps.pid ?? process.pid;
  if (!unknownStep && marker.pid !== pid) {
    const bootTime = deps.bootTime ?? now().getTime() - os.uptime() * 1000;
    const rebooted = new Date(marker.serverStartedAt).getTime() < bootTime;
    const age = now().getTime() - new Date(marker.startedAt).getTime();
    if (!rebooted && age < STALE_MS && (deps.isAlive ?? processAlive)(marker.pid)) {
      return { state: "en-curso", op: marker.op, step: marker.step, message: "Hay una operación de Autoconstrucción en marcha en otro proceso de WILLY." };
    }
  }
  const current: Marker = marker;
  const op = current.op;
  const kind = current.kind ?? "mejora";
  const base = path.resolve(root, SB_DIR);
  const backupDir = path.resolve(root, current.backupDir);
  const event = (stepName: JournalStep, detail: string) => quietly(() => appendEvent(root, { op, at: now().toISOString(), step: stepName, detail }));
  const done = async (result: RecoveryState, text: string, extra: Partial<Recovery> = {}, removeBackup = false): Promise<Recovery> => {
    await event("RECOVERED", text);
    await removeCandidate(root);
    const cleared = await quietly(() => clearMarker(root));
    // La copia solo se borra si la marca ya no existe (si no, la siguiente recuperación la necesitaría).
    if (cleared && removeBackup && backupDir.startsWith(`${base}${path.sep}`)) await fs.rm(backupDir, RM).catch(() => undefined);
    return { state: result, op, step: current.step, message: text, ...extra };
  };
  const blocked = async (text: string): Promise<Recovery> => {
    const full = `La operación «${current.objective}» se interrumpió y no se pudo resolver sola: ${text}`;
    // El motivo se anota una sola vez (con una marca reconstruida, se mira el último apunte del diario).
    const already = unknownStep ? (await readJournal(root, 50)).filter((e) => e.op === op).at(-1)?.detail === full : current.blocked === full;
    if (!already) {
      await event("FAILED", full);
      if (!unknownStep) await quietly(() => writeMarker(root, { ...current, blocked: full }));
    }
    return { state: "bloqueada", op, step: current.step, message: full };
  };

  if (!backupDir.startsWith(`${base}${path.sep}`)) return done("recuperada", "Marca de operación no válida: se descarta sin tocar nada.");
  const touched = current.touched ?? current.step !== "STARTED";
  if (!touched) return done("recuperada", "Se interrumpió antes de tocar nada: no hacía falta restaurar.", {}, true);
  if (current.step === "ROLLED_BACK") return done("recuperada", "Ya se había restaurado todo: solo faltaba cerrarla.");
  const manifest = await readManifest(backupDir);

  // Si después se instaló una versión oficial, su programa no se toca; en el código se deshace solo lo que se quedó a medias.
  if (current.appVersion && current.appVersion !== deps.appVersion) {
    let note = "";
    if (manifest?.status === "verificada" && manifest.after) {
      const restored = await restoreOwnChanges(root, backupDir, manifest);
      if (restored.problems.length) return blocked(restored.problems.join(" "));
      if (restored.restored.length) note = ` En el código se deshicieron ${restored.restored.length} cambio(s) que se habían quedado a medias; el programa se pondrá al día en la próxima compilación.`;
    }
    return done("recuperada", `Se interrumpió con la versión ${labelOf(current.appVersion, 0)} y después se instaló la oficial ${labelOf(deps.appVersion, 0)}: su programa no se toca.${note}`);
  }
  if (!manifest || manifest.status !== "verificada" || !manifest.after) return blocked(`no se encontró su copia verificada (${current.backupDir}).`);

  const finished = current.step === "PROMOTED" || current.step === "RESTART_SCHEDULED" || current.step === "HEALTH_CHECK" || current.step === "COMPLETED";
  if (finished) {
    if (!(await finalizeRecovered(root, deps, current, manifest))) return blocked("no se pudo anotar en el registro de versiones; se reintentará.");
    return done("completada", kind === "vuelta-atras" ? "La vuelta atrás ya estaba hecha: se termina de anotar." : "La mejora ya estaba instalada: se termina de anotar la versión.");
  }

  // ¿Qué programa está instalado ahora? Solo importa si la operación pudo llegar a sustituirlo (durante la promoción).
  const promoting = current.step === "PROMOTION_STARTED" || current.step === "BACKUP_VERIFIED" || current.step === "FILES_MODIFIED";
  if (current.installed && (promoting || current.step === "FAILED" || unknownStep)) {
    const live = await liveDigest(root);
    // Terminada justo antes del cierre: el programa instalado es el nuevo Y los archivos están como los deja la operación.
    if ((promoting || unknownStep) && live && manifest.candidate && live === manifest.candidate && (await filesAsAfter(root, manifest))) {
      if (!(await finalizeRecovered(root, deps, current, manifest))) return blocked("no se pudo anotar en el registro de versiones; se reintentará.");
      return done("completada", kind === "vuelta-atras" ? "La vuelta atrás había terminado justo antes del cierre: se da por hecha." : "La instalación había terminado justo antes del cierre: se da por buena y se anota la versión.");
    }
    const previousProgram = manifest.program?.sha256 ?? null;
    if (previousProgram && live !== previousProgram) {
      const problem = await ensureProgram(root, deps, path.join(backupDir, "app", ".output"), previousProgram);
      if (problem) return blocked(`${problem}.`);
    }
  }

  const restored = await restoreOwnChanges(root, backupDir, manifest);
  if (restored.problems.length) return blocked(restored.problems.join(" "));
  const foreignNote = restored.foreign.length ? ` No se tocaron ${restored.foreign.length} archivo(s) que alguien cambió después: ${restored.foreign.join(", ")}.` : "";
  await event("ROLLED_BACK", `Restaurados ${restored.restored.length} archivo(s).${foreignNote}`);
  return done(
    "recuperada",
    kind === "vuelta-atras" ? `La vuelta atrás se interrumpió a medias: se ha deshecho y todo sigue como estaba.${foreignNote}` : `La mejora se interrumpió a medias: se ha restaurado todo como estaba antes.${foreignNote}`,
    { restored: restored.restored, foreign: restored.foreign },
    !restored.foreign.length,
  );
}

/** ¿Están todos los archivos de la operación exactamente como los deja (huella «after»)? */
async function filesAsAfter(root: string, manifest: BackupManifest): Promise<boolean> {
  const { path } = await node();
  for (const [rel, expected] of Object.entries(manifest.after ?? {})) {
    if ((await hashFileOrNull(path.resolve(root, rel))) !== expected) return false;
  }
  return true;
}

/** Termina de anotar una operación que llegó a instalarse antes del cierre. Devuelve false si no se pudo anotar. */
async function finalizeRecovered(root: string, deps: ManagerDeps, marker: Marker, manifest: BackupManifest): Promise<boolean> {
  const now = clock(deps);
  const ok = await quietly(async () => {
    const { reg } = await loadRegistry(root, deps.appVersion, now());
    let next: Registry;
    if ((marker.kind ?? "mejora") === "vuelta-atras") {
      const target = reg.entries.find((entry) => entry.id === marker.target);
      next = target && target.status !== "REVERTIDA" ? recordRollback(reg, target.id, "Vuelta atrás pedida por el dueño.", backToOf(reg, target)?.id ?? null, { at: marker.startedAt, installed: marker.installed !== false }) : reg;
    } else {
      next = registerPromotion(reg, deps.appVersion, marker, manifest, { ...(marker.tests ?? {}), instalacion: marker.installed ? "PASS" : "N/A" }, marker.startedAt, marker.installed !== false);
    }
    if (next !== reg) await writeRegistry(root, next);
  });
  if (ok) await quietly(() => appendEvent(root, { op: marker.op, at: now().toISOString(), step: "COMPLETED", detail: "Terminada al recuperar tras el cierre." }));
  return ok;
}

/** La versión a la que se vuelve al revertir `entry`: la que estaba activa antes (o, si no consta, la anterior sana). */
function backToOf(reg: Registry, entry: VersionEntry): VersionEntry | null {
  const previous = entry.previous ? reg.entries.find((e) => e.id === entry.previous) : undefined;
  if (previous) return previous;
  const candidates = reg.entries.filter((e) => e.id !== entry.id && e.status !== "REVERTIDA" && e.status !== "FALLIDA" && e.at <= entry.at);
  return candidates[candidates.length - 1] ?? null;
}

// ------------------------------------------------------------------------------ el reinicio no salió bien (informe)

export type RestartRollback = { op: string; kind: OperationKind; detail: string; answering: boolean };

/**
 * El ayudante de reinicio dejó un informe: el programa nuevo no respondía y volvió solo al anterior. Aquí se deja el código
 * como corresponde a ese programa (solo lo propio de la operación) y se anota en versiones y diario.
 */
async function handleRestartReport(root: string, deps: ManagerDeps): Promise<RestartRollback | null> {
  const { fs, path } = await node();
  const now = clock(deps);
  const file = path.join(root, SB_DIR, RESTART_REPORT);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") await fs.rm(file, { force: true }).catch(() => undefined);
    return null;
  }
  const op = String(raw["op"] ?? "");
  const kind: OperationKind = raw["kind"] === "vuelta-atras" ? "vuelta-atras" : "mejora";
  const detail = String(raw["detail"] ?? "El programa nuevo no respondió al arrancar.").slice(0, 400);
  const answering = raw["answering"] === true;
  const dir = path.join(root, SB_DIR, op);
  if (op && path.resolve(dir).startsWith(`${path.resolve(root, SB_DIR)}${path.sep}`)) {
    const manifest = await readManifest(dir);
    if (manifest?.status === "verificada" && manifest.after) {
      const restored = await restoreOwnChanges(root, dir, manifest);
      if (restored.problems.length) return null; // se reintentará en la próxima consulta
    }
  }
  const saved = await quietly(async () => {
    const { reg } = await loadRegistry(root, deps.appVersion, now());
    let next = reg;
    if (kind === "mejora") {
      const entry = reg.entries.find((e) => e.id === op);
      if (entry && entry.status === "ACTIVA") {
        next = recordRollback(reg, entry.id, `No arrancó tras reiniciar y WILLY volvió solo a la versión anterior. ${detail}`, backToOf(reg, entry)?.id ?? null);
        next = { ...next, entries: next.entries.map((e) => (e.id === entry.id ? { ...e, health: "FAIL" as const, tests: { ...e.tests, health: "FAIL" as const } } : e)) };
      }
    } else {
      // Una vuelta atrás cuyo programa no arrancó: WILLY volvió a la versión que se quería revertir, que sigue siendo la ACTUAL.
      const target = reg.entries.find((e) => e.id === raw["target"]);
      if (target && target.status === "REVERTIDA") {
        next = {
          ...reg,
          activeId: target.id,
          entries: reg.entries.map((e) => (e.id === target.id ? { ...e, status: "ACTIVA" as const, reason: `Se intentó volver atrás, pero la versión anterior no arrancó. ${detail}` } : e.status === "ACTIVA" ? { ...e, status: "SUSTITUIDA" as const } : e)),
        };
      }
    }
    if (next !== reg) await writeRegistry(root, next);
  });
  if (!saved) return null;
  await quietly(() => appendEvent(root, { op, at: now().toISOString(), step: "ROLLED_BACK", detail: `${kind === "vuelta-atras" ? "La versión anterior" : "El programa nuevo"} no arrancó tras reiniciar: WILLY volvió solo a la que funcionaba. ${detail}` }));
  // Si la marca de esa misma operación seguía ahí (por ejemplo, porque no se pudo anotar la versión), el informe manda.
  if ((await readMarker(root))?.op === op) await quietly(() => clearMarker(root));
  await fs.rm(file, { force: true }).catch(() => undefined);
  return { op, kind, detail, answering };
}

// ------------------------------------------------------------------------------------------ volver a la versión anterior

/**
 * Vuelve atrás la versión ACTUAL hecha por la Autoconstrucción (de una en una, de la más reciente hacia atrás): archivos y
 * programa quedan como estaban antes de ella. Solo con copias verificadas y si nadie ha cambiado esos archivos después.
 * Antes de tocar nada guarda (y verifica) una copia del estado actual, por si hubiera que deshacerla.
 */
export async function revertVersion(root: string, versionId: string, deps: ManagerDeps): Promise<Outcome> {
  if (deps.isStage) return fail(409, "Esta es la copia de prueba de WILLY: aquí no se cambia de versión.");
  if (busy) return fail(409, "Hay otra operación de Autoconstrucción en marcha. Espera a que termine.");
  if (Date.now() < restartingUntil) return fail(409, "WILLY se está reiniciando: espera unos segundos y vuelve a intentarlo.");
  busy = "vuelta-atras";
  try {
    return await revertLocked(root, versionId, deps);
  } finally {
    busy = null;
  }
}

async function revertLocked(root: string, versionId: string, deps: ManagerDeps): Promise<Outcome> {
  const { fs, path } = await node();
  const now = clock(deps);
  const previous = await recoverLocked(root, deps);
  if (previous.state === "bloqueada" || previous.state === "en-curso") return fail(409, previous.message);
  const updating = await officialUpdateRunning(root, deps);
  if (updating) return fail(409, updating);

  const { reg } = await loadRegistry(root, deps.appVersion, now());
  const entry = reg.entries.find((e) => e.id === versionId);
  if (!entry) return fail(404, "No se encontró esa versión.");
  if (entry.id !== reg.activeId || entry.kind !== "autoconstruccion") return fail(409, "Solo se puede volver atrás desde la versión ACTUAL hecha por la Autoconstrucción (de una en una, de la más reciente hacia atrás).");
  if (!entry.backup || !entry.rollback) return fail(409, "Esa versión no tiene una copia verificada para volver atrás.");
  const backTo = backToOf(reg, entry);
  const oldDir = path.join(root, SB_DIR, entry.backup);
  const old = await readManifest(oldDir);
  if (!old || old.status !== "verificada" || !old.after) return fail(409, "La copia de esa versión no está verificada: no se vuelve atrás automáticamente.");
  const damaged = await verifyFileBackup(oldDir, old.entries);
  if (damaged.length) return fail(409, `La copia de esa versión está dañada: ${damaged.join(" ")}`);
  const changedSince: string[] = [];
  for (const e of old.entries) {
    if ((await hashFileOrNull(path.resolve(root, e.path))) !== old.after[e.path]) changedSince.push(e.path);
  }
  if (changedSince.length) {
    return fail(409, `Estos archivos han cambiado después de esa versión (otra mejora, otra IA o una actualización): ${changedSince.join(", ")}. No se vuelve atrás automáticamente para no perder esos cambios.`);
  }
  const installed = await deps.isInstalled(root).catch(() => false);
  const oldProgramDir = path.join(oldDir, "app", ".output");
  if (installed) {
    if (!old.program) return fail(409, "Esa versión no guardó copia del programa anterior: no se puede volver atrás de forma segura.");
    if ((await dirDigest(oldProgramDir)) !== old.program.sha256) return fail(409, "La copia del programa anterior no coincide con su huella: no se usa.");
    if (entry.program && (await liveDigest(root)) !== entry.program) return fail(409, "El programa instalado ya no es el de esa versión: no se vuelve atrás automáticamente.");
  }

  const objective = `Volver atrás: ${entry.label} («${entry.objective.replace(/\s+/g, " ").slice(0, 90)}»)`;
  const op = await uniqueOp(root, opId(now(), `volver atras ${entry.label}`));
  busy = op;
  const safetyDir = path.join(root, SB_DIR, op);
  const startedAt = now().toISOString();
  const opMarker: Marker = {
    op, kind: "vuelta-atras", target: entry.id, startedAt, pid: deps.pid ?? process.pid, serverStartedAt: deps.startedAt ?? serverStartedAt(), objective,
    appVersion: deps.appVersion, backupDir: `${SB_DIR}/${op}`, files: old.files, step: "STARTED", installed, touched: false,
    ...(old.program ? { candidate: old.program.sha256 } : {}),
  };
  let marker: Marker | null = null;
  const mark = async (stepName: JournalStep, detail?: string): Promise<void> => {
    if (marker) {
      marker.step = stepName;
      await writeMarker(root, marker);
    }
    await quietly(() => appendEvent(root, { op, at: now().toISOString(), step: stepName, ...(detail ? { detail } : {}), ...(stepName === "STARTED" ? { kind: "vuelta-atras" as const } : {}) }));
  };
  try {
    await writeMarker(root, opMarker);
    marker = opMarker;
  } catch (error) {
    return fail(500, `No se volvió atrás: no se pudo anotar la operación (${message(error)}). No se tocó nada.`);
  }
  await quietly(() => mark("STARTED", objective));

  let safety: BackupManifest | null = null;
  let wrote = false;
  let promotionStarted = false;
  try {
    // Copia verificada de cómo está todo AHORA (archivos y programa), por si hubiera que deshacer la vuelta atrás.
    const copied = await backupFiles(root, safetyDir, old.files);
    const problems = [...copied.problems, ...(await verifyFileBackup(safetyDir, copied.entries))];
    let program: ProgramCopy | undefined;
    if (installed && (await exists(path.join(root, "app", ".output")))) {
      const saved = await copyProgram(path.join(root, "app", ".output"), path.join(safetyDir, "app", ".output"));
      problems.push(...saved.problems);
      program = saved.copy;
    }
    safety = {
      version: 2, createdAt: startedAt, reason: objective, appVersion: deps.appVersion, files: old.files, entries: copied.entries,
      after: Object.fromEntries(old.entries.map((e) => [e.path, e.existed ? e.sha256 : null])), kind: "vuelta-atras", target: entry.id,
      ...(program ? { program } : {}), ...(old.program ? { candidate: old.program.sha256 } : {}),
      status: problems.length ? "fallo-verificacion" : "verificada", ...(problems.length ? { problems } : { verifiedAt: now().toISOString() }),
    };
    await writeManifest(safetyDir, safety);
    if (problems.length) throw new Error(`La copia del estado actual no se pudo verificar, así que no se tocó nada: ${problems.join(" ")}`);
    opMarker.touched = true;
    await mark("BACKUP_VERIFIED", `${old.files.length} archivo(s)${program ? " y el programa" : ""} copiados y comprobados por huella.`);

    // Solo se ponen los archivos anteriores si siguen siendo los de esa versión (nadie los ha cambiado mientras tanto).
    wrote = true;
    const restored = await restoreOwnChanges(root, oldDir, old);
    if (restored.problems.length) throw new Error(`No se pudieron poner los archivos anteriores: ${restored.problems.join(" ")}`);
    if (restored.foreign.length) throw new Error(`Mientras se preparaba, alguien cambió: ${restored.foreign.join(", ")}. No se vuelve atrás para no perder esos cambios.`);
    await mark("FILES_MODIFIED", restored.restored.join(", "));

    let detail = "Vista previa: archivos restaurados.";
    if (installed && old.program) {
      await mark("PROMOTION_STARTED");
      promotionStarted = true;
      const deployment = await deps.deploy(root, oldProgramDir);
      if ((await liveDigest(root)) !== old.program.sha256) throw new Error("El programa anterior no quedó en su sitio.");
      detail = deployment.detail;
    }
    await mark("PROMOTED", detail);
  } catch (error) {
    const reason = message(error);
    await quietly(() => mark("FAILED", reason));
    const problems: string[] = [];
    let foreign: string[] = [];
    if (promotionStarted && safety?.program) {
      const problem = await ensureProgram(root, deps, path.join(safetyDir, "app", ".output"), safety.program.sha256);
      if (problem) problems.push(problem);
    }
    if (wrote && safety) {
      const back = await restoreOwnChanges(root, safetyDir, safety);
      foreign = back.foreign;
      problems.push(...back.problems);
    }
    const foreignNote = foreign.length ? ` No se tocaron ${foreign.length} archivo(s) que alguien cambió mientras tanto (${foreign.join(", ")}).` : "";
    if (!problems.length) {
      if (wrote) await quietly(() => mark("ROLLED_BACK", `La vuelta atrás se deshizo: todo sigue como estaba.${foreignNote}`));
      const cleared = await quietly(() => clearMarker(root));
      marker = null;
      if (cleared && !foreign.length) await fs.rm(safetyDir, RM).catch(() => undefined);
      return fail(500, `No se pudo volver atrás y todo sigue como estaba: ${reason}${foreignNote}`);
    }
    await quietly(() => mark("FAILED", `No se pudo dejar todo como estaba: ${problems.join(" ")}. Se reintentará; la copia está en ${safetyDir}.`));
    if (installed && (await programMissing(root))) {
      return fail(500, `⚠️ No se pudo volver atrás y el programa instalado quedó fuera de su sitio. NO cierres WILLY: pulsa «Recuperar ahora» en Autoconstrucción → Historial. La copia está en ${safetyDir}. Motivo: ${reason}`, { backup: safetyDir });
    }
    return fail(500, `No se pudo volver atrás ni dejarlo todo como estaba. La copia está en ${safetyDir}. Motivo: ${reason}`, { backup: safetyDir });
  }

  // Hecha: registro, limpieza y reinicio (nada de esto la deshace). Sin registro, la marca se queda para terminarlo después.
  const notes: string[] = [];
  const registered = await quietly(async () => {
    const { reg: latest } = await loadRegistry(root, deps.appVersion, now());
    await writeRegistry(root, recordRollback(latest, entry.id, "Vuelta atrás pedida por el dueño.", backTo?.id ?? null, { at: now().toISOString(), installed }));
  });
  if (!registered) notes.push("No se pudo anotar en el registro de versiones: se anotará al abrir Autoconstrucción.");
  await quietly(async () => {
    const { reg: latest } = await loadRegistry(root, deps.appVersion, now());
    const protect = await protectRunning(root, protectedBackups(latest));
    protect.add(op);
    await pruneBackups(root, deps.keepBackups ?? KEEP_BACKUPS, protect);
  });
  if (registered) {
    await quietly(() => mark("COMPLETED", `Vuelta a ${backTo?.label ?? "la versión anterior"}.`));
    marker = null;
    await quietly(() => clearMarker(root));
  }
  let restarting = false;
  if (installed) {
    try {
      await deps.restart(root, { op, kind: "vuelta-atras", target: entry.id, fallback: safety?.program ? path.join(safetyDir, "app", ".output") : null });
      restarting = true;
      restartingUntil = Date.now() + (deps.restartGraceMs ?? RESTART_GRACE_MS);
      await quietly(() => appendEvent(root, { op, at: now().toISOString(), step: "RESTART_SCHEDULED", detail: "El programa se reinicia con la versión anterior (si no responde, vuelve solo a la que había)." }));
    } catch (error) {
      notes.push(`Hecho, pero no se pudo reiniciar solo: cierra y abre WILLY (${message(error)}).`);
    }
  }
  return {
    status: 200,
    body: { ok: true, reverted: entry.id, label: entry.label, backTo: backTo?.label ?? "", restarting, installed, backup: safetyDir, ...(notes.length ? { notes } : {}) },
  };
}

// ---------------------------------------------------------------------------------------------------- estado y salud

export type Progress = { ok: true; running: string | null; op: string | null; objective: string; step: JournalStep | null; state: string; stepAt: string | null; startedAt: string | null };

/** Progreso real de la operación en marcha (paso y estado de la candidata), para la barra de progreso. No cambia nada. */
export async function selfBuildProgress(root: string): Promise<Progress> {
  const marker = await readMarker(root);
  return {
    ok: true, running: busy, op: marker?.op ?? null, objective: marker?.objective ?? "", step: marker?.step ?? null,
    state: marker ? (CANDIDATE_STATE[marker.step] ?? "") : "", stepAt: marker?.stepAt ?? null, startedAt: marker?.startedAt ?? null,
  };
}

export type BackupInfo = { name: string; createdAt: string; reason: string; status: string; files: number; program: boolean; protected: boolean };

async function listBackups(root: string, protect: Set<string>, limit = 30): Promise<BackupInfo[]> {
  const { fs, path } = await node();
  let names: string[] = [];
  try {
    names = (await fs.readdir(path.join(root, SB_DIR), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse().slice(0, limit);
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    const manifest = await readManifest(path.join(root, SB_DIR, name));
    out.push({ name, createdAt: manifest?.createdAt ?? "", reason: (manifest?.reason ?? "").slice(0, 200), status: manifest?.status ?? "sin manifiesto", files: manifest?.entries.length ?? 0, program: Boolean(manifest?.program), protected: protect.has(name) });
  }
  return out;
}

export type StatusBody = {
  ok: true;
  running: string | null;
  recovery: Recovery;
  marker: Marker | null;
  version: { base: string; label: string };
  active: VersionEntry | null;
  lastKnownGood: VersionEntry | null;
  versions: VersionEntry[];
  operations: OperationSummary[];
  backups: BackupInfo[];
  healthConfirmed: VersionEntry | null;
  restartRollback: RestartRollback | null;
  /** fromCopy: carpeta (relativa) de la copia con la que arrancó el arranque seguro, si no es el programa instalado. */
  server: { startedAt: string; uptimeSec: number; pid: number; node: string; platform: string; installed: boolean; stage: boolean; fromCopy: string | null };
  lastHealth: HealthReport | null;
};

/**
 * Estado de la Autoconstrucción: recupera lo que se quedó a medias, anota un reinicio que tuvo que volver atrás, confirma la
 * salud de la versión recién instalada (si este servidor arrancó después de instalarla y es ese programa) y devuelve
 * versiones, historial y copias.
 */
export async function selfBuildStatus(root: string, deps: ManagerDeps): Promise<StatusBody> {
  const { fs, path } = await node();
  const now = clock(deps);
  const startedAt = deps.startedAt ?? serverStartedAt();
  const installed = await deps.isInstalled(root).catch(() => false);
  let recovery: Recovery = { state: "nada", message: "" };
  let healthConfirmed: VersionEntry | null = null;
  let restartRollback: RestartRollback | null = null;
  // Todo lo que cambia algo se hace con el cerrojo (nunca a la vez que una mejora o una vuelta atrás): primero el informe de
  // un reinicio que tuvo que volver atrás, después lo que se quedara a medias y, por último, la salud de la versión nueva.
  if (!deps.isStage && busy) recovery = { state: "en-curso", op: busy, message: "Hay una operación de Autoconstrucción en marcha." };
  if (!deps.isStage && !busy) {
    busy = "estado";
    try {
      restartRollback = await handleRestartReport(root, deps);
      recovery = await recoverLocked(root, deps);
      const loaded = await loadRegistry(root, deps.appVersion, now());
      let reg = loaded.reg;
      let changed = loaded.changed;
      const active = reg.entries.find((entry) => entry.id === reg.activeId);
      // Funcionando con una copia (arranque seguro), la versión instalada NO ha demostrado que arranque.
      if (active?.health === "PENDIENTE" && !(installed && (await runningFromCopy(root)))) {
        const live = installed && active.program ? await liveDigest(root) : undefined;
        const health = confirmHealth(reg, startedAt, live);
        if (health.confirmed) {
          reg = health.reg;
          changed = true;
          healthConfirmed = health.confirmed;
          const confirmedId = health.confirmed.id;
          await quietly(() => appendEvent(root, { op: confirmedId, at: now().toISOString(), step: "HEALTH_CHECK", detail: "Comprobado: el programa nuevo arrancó y responde." }));
        }
      }
      if (changed) await quietly(() => writeRegistry(root, reg));
    } finally {
      busy = null;
    }
  }
  const { reg } = await loadRegistry(root, deps.appVersion, now());
  const byId = (id: string | null) => reg.entries.find((entry) => entry.id === id) ?? null;
  const journal = await readJournal(root, 400);
  let lastHealth: HealthReport | null = null;
  try {
    lastHealth = JSON.parse(await fs.readFile(path.join(root, SB_DIR, HEALTH_FILE), "utf8")) as HealthReport;
  } catch {
    /* todavía no se ha hecho ninguna comprobación de salud */
  }
  return {
    ok: true,
    running: busy,
    recovery,
    marker: await readMarker(root),
    version: { base: deps.appVersion, label: byId(reg.activeId)?.label ?? labelOf(deps.appVersion, 0) },
    active: byId(reg.activeId),
    lastKnownGood: byId(reg.lastKnownGood),
    versions: [...reg.entries].reverse().slice(0, 40),
    operations: summarizeOperations(journal, busy).slice(0, 40),
    backups: await listBackups(root, protectedBackups(reg)),
    healthConfirmed,
    restartRollback,
    server: { startedAt, uptimeSec: Math.round(process.uptime()), pid: deps.pid ?? process.pid, node: process.version, platform: process.platform, installed, stage: Boolean(deps.isStage), fromCopy: installed ? await relativeCopy(root, await runningFromCopy(root)) : null },
    lastHealth,
  };
}

export type HealthStatus = "ok" | "aviso" | "fallo" | "info";
export type HealthCheck = { id: string; label: string; status: HealthStatus; detail: string };
export type HealthReport = { at: string; overall: "funcionando" | "con avisos" | "con fallos"; checks: HealthCheck[] };

export type HealthProbes = {
  ollama: () => Promise<{ ok: boolean; version?: string; models?: number; error?: string }>;
  engines: () => Promise<{ active: number; configured: number; master: boolean } | null>;
  backend: () => Promise<{ ok: boolean; detail: string }>;
  diskFree: (dir: string) => Promise<number | null>;
};

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Comprobación de salud («self-check»): cada parte con su estado real. Se guarda la última para mostrar cuándo se hizo. */
export async function selfBuildHealth(root: string, deps: ManagerDeps, probes: HealthProbes): Promise<HealthReport> {
  const { fs, path } = await node();
  const now = clock(deps);
  const checks: HealthCheck[] = [];
  const add = (id: string, label: string, status: HealthStatus, detail: string) => checks.push({ id, label, status, detail });
  const installed = await deps.isInstalled(root).catch(() => false);
  const { reg } = await loadRegistry(root, deps.appVersion, now());
  const active = reg.entries.find((entry) => entry.id === reg.activeId);
  add("servidor", "WILLY AI", "ok", `Funcionando · versión ${active?.label ?? labelOf(deps.appVersion, 0)} · encendido hace ${Math.round(process.uptime() / 60)} min.`);

  if (installed) {
    const server = await exists(path.join(root, "app", ".output", "server", "index.mjs"));
    const front = await exists(path.join(root, "app", ".output", "public"));
    add("backend", "Servidor de WILLY", server ? "ok" : "fallo", server ? "Programa instalado completo." : "Falta el servidor del programa instalado (app/.output/server): NO cierres WILLY y pulsa «Recuperar ahora» en Historial.");
    add("frontend", "Pantallas (frontend)", front ? "ok" : "fallo", front ? "Archivos de la interfaz presentes." : "Faltan los archivos de la interfaz (app/.output/public).");
    // Supervisor: arranque seguro dentro del programa + «Recuperar WILLY AI» fuera de él (funciona aunque WILLY no abra).
    const copy = await runningFromCopy(root);
    const guarded = (await exists(path.join(root, "app", ".output", "server", "willy.mjs"))) && (await exists(path.join(root, "supervisor", "respaldo.mjs")));
    const rescue = (await exists(path.join(root, "RECUPERAR_WILLY.bat"))) && (await exists(path.join(root, "supervisor", "recuperar.mjs")));
    if (copy) add("arranque", "Arranque seguro", "aviso", `WILLY está funcionando con una copia buena (${await relativeCopy(root, copy)}) porque el programa instalado no arrancaba; esa copia ya queda puesta para la próxima vez.`);
    else if (guarded && rescue) add("arranque", "Arranque seguro y recuperación", "ok", "Si el programa no pudiera arrancar, WILLY arranca solo con la última copia buena. Y si algún día no abre: menú Inicio → «Recuperar WILLY AI».");
    else add("arranque", "Arranque seguro y recuperación", "info", rescue ? "Se activa con la próxima compilación del programa (actualización o mejora). Si algún día WILLY no abre: menú Inicio → «Recuperar WILLY AI»." : "Llega con la próxima actualización oficial de WILLY.");
  } else {
    add("backend", "Servidor de WILLY", "ok", "Responde (entorno de vista previa: sin programa instalado).");
    add("frontend", "Pantallas (frontend)", "info", "Vista previa: la interfaz la sirve el entorno de desarrollo.");
  }

  try {
    const ollama = await probes.ollama();
    add("ollama", "IA de tu equipo (Ollama)", ollama.ok ? "ok" : "fallo", ollama.ok ? `Versión ${ollama.version ?? "?"} · ${ollama.models ?? 0} modelo(s) instalados.` : `No responde: ${ollama.error ?? "no arrancado"}.`);
  } catch (error) {
    add("ollama", "IA de tu equipo (Ollama)", "fallo", `No se pudo comprobar: ${message(error)}`);
  }
  try {
    const engines = await probes.engines();
    if (!engines) add("motores", "IA externas", "info", "No se pudo leer su estado.");
    else if (!engines.configured) add("motores", "IA externas", "info", "Ninguna configurada (opcional).");
    else add("motores", "IA externas", engines.master && engines.active ? "ok" : "aviso", `${engines.master ? engines.active : 0} activa(s) de ${engines.configured} configurada(s)${engines.master ? "" : " · interruptor general apagado"}.`);
  } catch (error) {
    add("motores", "IA externas", "info", `No se pudo leer su estado: ${message(error)}`);
  }
  try {
    const backend = await probes.backend();
    add("proyectos", "Servidor de proyectos", backend.ok ? "ok" : "info", backend.detail);
  } catch {
    add("proyectos", "Servidor de proyectos", "info", "No arrancado (solo hace falta para proyectos con servidor propio).");
  }

  // Almacenamiento: se escribe y se borra un archivo de prueba de verdad.
  for (const [id, label, dir] of [["datos", "Datos privados", path.join(root, "datos-privados")], ["copias", "Copias de la Autoconstrucción", path.join(root, SB_DIR)]] as const) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const probe = path.join(dir, `.prueba-escritura-${process.pid}`);
      await fs.writeFile(probe, "ok", "utf8");
      const back = await fs.readFile(probe, "utf8");
      await fs.rm(probe, { force: true });
      add(id, label, back === "ok" ? "ok" : "fallo", back === "ok" ? "Se puede guardar y leer." : "Lo guardado no se lee igual.");
    } catch (error) {
      add(id, label, "fallo", `No se puede guardar: ${message(error)}`);
    }
  }
  try {
    const free = await probes.diskFree(root);
    if (free === null) add("disco", "Espacio en disco", "info", "No se pudo medir.");
    else add("disco", "Espacio en disco", free < 2 * 1024 ** 3 ? "aviso" : "ok", `${gb(free)} libres${free < 2 * 1024 ** 3 ? " · poco espacio: cada mejora necesita ~1 GB para compilar y guardar copias" : ""}.`);
  } catch {
    add("disco", "Espacio en disco", "info", "No se pudo medir.");
  }

  // Autoconstrucción: operación a medias, versión actual y copias.
  const marker = await readMarker(root);
  if (marker) add("operacion", "Operación a medias", "aviso", `«${marker.objective}» (paso ${marker.step}). Se resuelve sola al abrir Autoconstrucción o al aplicar otra mejora.`);
  else add("operacion", "Operaciones", "ok", "Ninguna a medias.");
  if (active) {
    const status: HealthStatus = active.health === "PASS" || active.health === "N/A" ? "ok" : active.health === "PENDIENTE" ? "aviso" : "fallo";
    add("version", "Versión actual", status, `${active.label} · salud ${active.health === "PENDIENTE" ? "pendiente de reiniciar" : active.health}${reg.lastKnownGood ? ` · última buena: ${reg.entries.find((e) => e.id === reg.lastKnownGood)?.label ?? "?"}` : ""}.`);
  }
  const backups = await listBackups(root, protectedBackups(reg), 200);
  const unverified = backups.filter((b) => b.status !== "verificada").length;
  add("copias-lista", "Copias guardadas", backups.length && !unverified ? "ok" : "info", backups.length ? `${backups.length} copia(s)${unverified ? ` · ${unverified} de versiones anteriores sin verificación por huella` : " · todas verificadas"}.` : "Todavía ninguna (se crea una con cada mejora).");

  const worst = checks.some((c) => c.status === "fallo") ? "con fallos" : checks.some((c) => c.status === "aviso") ? "con avisos" : "funcionando";
  const report: HealthReport = { at: now().toISOString(), overall: worst, checks };
  await quietly(() => writeFileDurable(path.join(root, SB_DIR, HEALTH_FILE), JSON.stringify(report, null, 2)));
  return report;
}
