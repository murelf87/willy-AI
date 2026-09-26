// AJUSTES Y CENTRO DE INTELIGENCIA · lo que el servidor de WILLY hace DE VERDAD con el equipo (solo servidor).
// Estado de WILLY (versión, puerto, tiempo encendido), reiniciar y detener, espacio y copias, la caché que se puede vaciar
// sin riesgo, los registros (sin claves), las dependencias, el diagnóstico completo y la IA del equipo (Ollama): versión,
// modelos, carpeta de modelos, si calcula con la tarjeta gráfica o solo con el procesador, y reiniciarla.
// Nada de esto «dice que lo ha hecho» sin hacerlo: cada acción comprueba el resultado. Todo lo que toca el sistema llega
// como dependencia, así se prueba con carpetas temporales y sin el ordenador real.

import { APP_REVISION, APP_VERSION } from "@/lib/version";
import { gpuUsage, parseOllamaPs, type GpuInfo, type GpuUsage, type LoadedModel, type SystemSnapshot } from "@/lib/system-info";
import { sanitizeNotice } from "@/lib/update-notice";

const OLLAMA_URL = "http://127.0.0.1:11434";
const SB_DIR = "copias-autoconstruccion";
const UPDATE_LOCK = "actualizacion-en-curso.json";
const RESTART_REPORT = "reinicio-fallido.json";
const SAFE_START_LOG = "arranque-seguro.log";

type ExecResult = { ok: boolean; stdout: string };

export type MaintenanceDeps = {
  /** Carpeta de instalación de WILLY (la que tiene package.json). */
  root?: string;
  now?: () => number;
  uptimeSec?: () => number;
  pid?: number;
  node?: string;
  platform?: string;
  env?: Record<string, string | undefined>;
  homedir?: () => string;
  tmpdir?: () => string;
  fetchImpl?: typeof fetch;
  exec?: (file: string, args: string[], timeoutMs?: number) => Promise<ExecResult>;
  /** Arranca un programa en segundo plano, sin ventana (Windows). Devuelve false si no se pudo lanzar. */
  startDetached?: (command: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  later?: (fn: () => void, ms: number) => void;
  statfs?: (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  memory?: () => { total: number; free: number };
  /** Operación de Autoconstrucción en marcha (o null). */
  busy?: () => Promise<string | null>;
  isAlive?: (pid: number) => boolean;
  installed?: () => Promise<boolean>;
  scheduleRestart?: () => Promise<void>;
  exit?: (code: number) => void;
  recentErrors?: () => Array<{ at: number; text: string }>;
  /** Lectura del equipo (gráfica, memoria, modelos cargados). */
  snapshot?: () => Promise<SystemSnapshot>;
  /** Resumen de las IA externas (nunca las claves). */
  engines?: () => Promise<EnginesSummary | null>;
  /** Comprueba si hay internet. */
  internet?: () => Promise<boolean>;
};

export type EnginesSummary = { master: boolean; withKey: number; available: number; names: string[] };

type Resolved = Required<MaintenanceDeps>;

async function nodeMods() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return { fs, path };
}

/** Rellena las dependencias con las reales del equipo. */
export async function resolveDeps(deps: MaintenanceDeps = {}): Promise<Resolved> {
  const os = await import("node:os");
  const { fs, path } = await nodeMods();
  const root = deps.root ?? (await (await import("@/lib/project-root")).projectRoot()) ?? process.cwd();
  const exec = deps.exec ?? (async (file: string, args: string[], timeoutMs = 4000) => {
    const { execFile } = await import("node:child_process");
    return new Promise<ExecResult>((resolve) => {
      try {
        execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? "") }));
      } catch {
        resolve({ ok: false, stdout: "" });
      }
    });
  });
  const platform = deps.platform ?? process.platform;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());
  return {
    root,
    now,
    uptimeSec: deps.uptimeSec ?? (() => process.uptime()),
    pid: deps.pid ?? process.pid,
    node: deps.node ?? process.version,
    platform,
    env: deps.env ?? process.env,
    homedir: deps.homedir ?? (() => os.homedir()),
    tmpdir: deps.tmpdir ?? (() => os.tmpdir()),
    fetchImpl,
    exec,
    startDetached: deps.startDetached ?? (async (command: string) => {
      if (platform !== "win32") return false;
      try {
        const { spawn } = await import("node:child_process");
        const child = spawn("cmd.exe", ["/d", "/s", "/c", command], { windowsHide: true, detached: true, stdio: "ignore" });
        child.unref();
        return true;
      } catch {
        return false;
      }
    }),
    sleep,
    later: deps.later ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); }),
    statfs: deps.statfs ?? (async (target: string) => {
      const stats = await (fs as unknown as { statfs: (p: string) => Promise<{ bsize: number; blocks: number; bavail: number }> }).statfs(target);
      return { bsize: Number(stats.bsize), blocks: Number(stats.blocks), bavail: Number(stats.bavail) };
    }),
    memory: deps.memory ?? (() => ({ total: os.totalmem(), free: os.freemem() })),
    busy: deps.busy ?? (async () => (await import("@/lib/self-build-manager")).currentOperation()),
    isAlive: deps.isAlive ?? ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as { code?: string }).code === "EPERM";
      }
    }),
    installed: deps.installed ?? (async () => (await import("@/lib/self-build-ops")).isInstalled(root)),
    scheduleRestart: deps.scheduleRestart ?? (async () => (await import("@/lib/self-build-ops")).scheduleInstalledRestart(root, {})),
    exit: deps.exit ?? ((code: number) => process.exit(code)),
    recentErrors: deps.recentErrors ?? (() => []),
    snapshot: deps.snapshot ?? (async () => (await import("@/lib/system-ops")).systemStats({}, { root, fetchImpl, exec, platform, sleep })),
    engines: deps.engines ?? (async () => {
      try {
        const { loadState, publicStatus } = await import("@/lib/engines-server");
        const status = publicStatus(await loadState(path.join(root, "datos-privados")), now());
        const keyed = status.engines.filter((engine) => engine.hasKey);
        return { master: status.master, withKey: keyed.length, available: keyed.filter((engine) => engine.available).length, names: keyed.map((engine) => engine.name) };
      } catch {
        return null;
      }
    }),
    internet: deps.internet ?? (async () => {
      for (const url of ["https://www.google.com/generate_204", "https://www.cloudflare.com/cdn-cgi/trace"]) {
        try {
          const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
          if (res.status < 500) return true;
        } catch {
          /* se prueba el siguiente */
        }
      }
      return false;
    }),
  };
}

// ───────────────────────────────────────────────────────────── utilidades

/** «12,3 MB» */
export function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1).replace(".", ",")} ${units[unit]}`;
}

/** «3 h 12 min», «5 min», «40 s». */
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

/**
 * Quita de un texto todo lo que parezca una clave, un token o una contraseña (claves de Google, Groq, OpenRouter, NVIDIA,
 * Hugging Face, GitHub, «Bearer …», «api_key=…», cadenas largas en base64/hex…). Los registros nunca enseñan secretos.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, "[clave oculta]")
    .replace(/\bsk-or-v1-[A-Za-z0-9]{12,}/g, "[clave oculta]")
    .replace(/\bgsk_[A-Za-z0-9]{12,}/g, "[clave oculta]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "[clave oculta]")
    .replace(/\bhf_[A-Za-z0-9]{12,}/g, "[clave oculta]")
    .replace(/\bnvapi-[A-Za-z0-9_-]{12,}/g, "[clave oculta]")
    .replace(/\bxai-[A-Za-z0-9]{12,}/g, "[clave oculta]")
    .replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, "[clave oculta]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{16,}/g, "[clave oculta]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [oculto]")
    .replace(/((?:api[_-]?key|apikey|x-api-key|token|secret|password|passwd|contrase(?:ñ|n)a|clave)["']?\s*[:=]\s*["']?)[^\s"',;&[\]]{4,}/gi, "$1[oculto]")
    .replace(/([?&](?:key|token|access_token|api_key)=)[^\s&"']+/gi, "$1[oculto]")
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "[oculto]");
}

type SizeResult = { bytes: number; files: number; partial: boolean };

/** Tamaño de una carpeta con límite de tiempo y de archivos: si se pasa, lo dice («partial») en vez de colgarse. */
export async function folderSize(dir: string, budget: { maxEntries?: number; deadlineMs?: number } = {}): Promise<SizeResult> {
  const { fs, path } = await nodeMods();
  const maxEntries = budget.maxEntries ?? 150_000;
  const until = Date.now() + (budget.deadlineMs ?? 6000);
  const out: SizeResult = { bytes: 0, files: 0, partial: false };
  let seen = 0;
  const walk = async (current: string, depth: number): Promise<void> => {
    if (out.partial) return;
    if (depth > 24) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries || Date.now() > until) {
        out.partial = true;
        return;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile()) {
        try {
          out.bytes += (await fs.stat(full)).size;
          out.files += 1;
        } catch {
          /* archivo que desaparece mientras se cuenta */
        }
      }
    }
  };
  try {
    const stat = await fs.stat(dir);
    if (stat.isFile()) return { bytes: stat.size, files: 1, partial: false };
  } catch {
    return out;
  }
  await walk(dir, 0);
  return out;
}

async function exists(target: string): Promise<boolean> {
  const { fs } = await nodeMods();
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  const { fs } = await nodeMods();
  try {
    return JSON.parse((await fs.readFile(file, "utf8")).replace(/^﻿/, "")) as T;
  } catch {
    return null;
  }
}

/** Lo último de un archivo de registro (sin cargarlo entero): UTF-8 o UTF-16 (PowerShell), sin la marca inicial. */
async function tailText(file: string, maxBytes = 256 * 1024): Promise<{ text: string; mtime: number } | null> {
  const { fs } = await nodeMods();
  let handle: import("node:fs/promises").FileHandle | null = null;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return null;
    handle = await fs.open(file, "r");
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    let text: string;
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.subarray(2).toString("utf16le");
    else if (buffer.length >= 4 && buffer[1] === 0 && buffer[3] === 0) text = buffer.toString("utf16le");
    else text = buffer.toString("utf8");
    text = text.replace(/^﻿/, "");
    // Si se ha cortado por el principio, la primera línea puede estar a medias: fuera.
    if (stat.size > maxBytes) text = text.slice(text.indexOf("\n") + 1);
    return { text, mtime: stat.mtimeMs };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** ¿Está instalando ahora mismo el actualizador oficial (.bat)? Mismo criterio que la Autoconstrucción. */
async function updateRunning(d: Resolved): Promise<string | null> {
  const { path } = await nodeMods();
  const raw = await readJson<{ pid?: unknown; at?: unknown; version?: unknown }>(path.join(d.root, SB_DIR, UPDATE_LOCK));
  if (!raw) return null;
  const age = d.now() - new Date(String(raw.at ?? "")).getTime();
  const alive = typeof raw.pid === "number" && d.isAlive(raw.pid);
  return alive && age >= 0 && age < 2 * 3600_000 ? `Se está instalando una actualización de WILLY${raw.version ? ` (${String(raw.version)})` : ""}.` : null;
}

/** Motivo para no hacer ahora una acción de mantenimiento (o null si se puede). */
async function blockedReason(d: Resolved): Promise<string | null> {
  const updating = await updateRunning(d);
  if (updating) return `${updating} Espera a que termine.`;
  const op = await d.busy().catch(() => null);
  if (op) return "La Autoconstrucción está trabajando ahora mismo. Espera a que termine y vuelve a intentarlo.";
  return null;
}

// ───────────────────────────────────────────────────────────── estado de WILLY

export type SystemInfo = {
  version: string;
  revision: number;
  port: number;
  pid: number;
  uptimeSec: number;
  uptime: string;
  startedAt: string;
  node: string;
  platform: string;
  installed: boolean;
  root: string;
  busy: boolean;
  updating: boolean;
  /** La última actualización instalada (la anota el actualizador), aunque ya se haya aceptado su aviso. */
  lastUpdate: { version: string; at: string; label: string; notes: string[] } | null;
  checkedAt: string;
};

export async function systemInfo(port: number, deps: MaintenanceDeps = {}): Promise<SystemInfo> {
  const d = await resolveDeps(deps);
  const uptimeSec = Math.round(d.uptimeSec());
  const now = d.now();
  return {
    version: APP_VERSION,
    revision: APP_REVISION,
    port,
    pid: d.pid,
    uptimeSec,
    uptime: durationText(uptimeSec),
    startedAt: new Date(now - uptimeSec * 1000).toISOString(),
    node: d.node,
    platform: d.platform,
    installed: await d.installed().catch(() => false),
    root: d.root,
    busy: Boolean(await d.busy().catch(() => null)),
    updating: Boolean(await updateRunning(d)),
    lastUpdate: await lastUpdateOf(d),
    checkedAt: new Date(now).toISOString(),
  };
}

async function lastUpdateOf(d: Resolved): Promise<SystemInfo["lastUpdate"]> {
  const { path } = await nodeMods();
  const notice = sanitizeNotice(await readJson<unknown>(path.join(d.root, "datos-privados", "actualizacion.json")));
  return notice ? { version: notice.version, at: notice.at, label: notice.label, notes: notice.notes } : null;
}

type ActionResult = { ok: boolean; message?: string; error?: string };

/** Reinicia WILLY de verdad: cierra este servidor y arranca el programa instalado (en unos segundos vuelve a responder). */
export async function restartServer(deps: MaintenanceDeps = {}): Promise<ActionResult> {
  const d = await resolveDeps(deps);
  if (!(await d.installed().catch(() => false))) return { ok: false, error: "Reiniciar solo funciona en el programa instalado de Windows (esto es la vista previa)." };
  const blocked = await blockedReason(d);
  if (blocked) return { ok: false, error: blocked };
  await d.scheduleRestart();
  return { ok: true, message: "WILLY AI se está reiniciando: en unos 10 segundos vuelve a estar listo y esta página se recarga sola." };
}

/** Detiene WILLY de verdad (el servidor se cierra un segundo después de contestar). Se vuelve a abrir con su acceso directo. */
export async function stopServer(deps: MaintenanceDeps = {}): Promise<ActionResult> {
  const d = await resolveDeps(deps);
  if (!(await d.installed().catch(() => false))) return { ok: false, error: "Detener solo funciona en el programa instalado de Windows (esto es la vista previa)." };
  const blocked = await blockedReason(d);
  if (blocked) return { ok: false, error: blocked };
  d.later(() => d.exit(0), 1000);
  return { ok: true, message: "WILLY AI se está cerrando. Para volver a usarlo, ábrelo con su acceso directo del escritorio." };
}

// ───────────────────────────────────────────────────────────── almacenamiento

export type StorageItem = { id: string; label: string; detail: string; path: string; bytes: number; partial: boolean; count?: number };
export type StorageReport = {
  root: string;
  dataDir: string;
  disk: { drive: string; freeGB: number; totalGB: number; percent: number } | null;
  items: StorageItem[];
  removable: { count: number; mb: number };
  checkedAt: string;
};

async function projectCount(dir: string): Promise<number> {
  const { fs, path } = await nodeMods();
  let count = 0;
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return 0;
  }
  for (const name of names) {
    const meta = await readJson<{ deletedAt?: unknown }>(path.join(dir, name, "proyecto.json"));
    if (meta && !meta.deletedAt) count += 1;
  }
  return count;
}

async function diskOf(d: Resolved): Promise<StorageReport["disk"]> {
  const { path } = await nodeMods();
  try {
    const stats = await d.statfs(d.root);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    if (!(total > 0)) return null;
    return { drive: path.parse(d.root).root || d.root, freeGB: free / 1073741824, totalGB: total / 1073741824, percent: Math.round((1 - free / total) * 100) };
  } catch {
    return null;
  }
}

export async function storageReport(deps: MaintenanceDeps = {}): Promise<StorageReport> {
  const d = await resolveDeps(deps);
  const { path } = await nodeMods();
  const dataDir = path.join(d.root, "datos-privados");
  const specs: Array<{ id: string; label: string; detail: string; rel: string }> = [
    { id: "proyectos", label: "Tus proyectos", detail: "Todo lo que construyes con SUPER WILLY y sus versiones.", rel: "datos-privados/proyectos" },
    { id: "librerias", label: "Librerías de los proyectos", detail: "Las que WILLY instala desde npm cuando un proyecto React las necesita (se ven y se quitan en el taller de SUPER WILLY: «Librerías instaladas»).", rel: "datos-privados/librerias-proyectos" },
    { id: "datos", label: "Todos tus datos privados", detail: "Proyectos, perfil y vídeos de «Mi yo en IA», voces, ajustes de la IA externa… Las actualizaciones nunca los tocan.", rel: "datos-privados" },
    { id: "copias-actualizacion", label: "Copias de las actualizaciones", detail: "Se hacen solas antes de cada actualización, para poder volver atrás.", rel: "copias-actualizacion" },
    { id: "copias-autoconstruccion", label: "Copias de la Autoconstrucción", detail: "Una por cada mejora aplicada: «Volver a la versión anterior» las usa.", rel: SB_DIR },
    { id: "copias-rediseno", label: "Copia de antes del rediseño", detail: "La copia completa que se hizo antes de empezar el rediseño.", rel: "copias-rediseno" },
    { id: "programa", label: "El programa de WILLY", detail: "Lo que se ejecuta al abrir WILLY AI.", rel: "app/.output" },
  ];
  const items: StorageItem[] = [];
  for (const spec of specs) {
    const full = path.join(d.root, ...spec.rel.split("/"));
    if (!(await exists(full))) continue;
    const size = await folderSize(full, { deadlineMs: 5000 });
    const item: StorageItem = { id: spec.id, label: spec.label, detail: spec.detail, path: spec.rel, bytes: size.bytes, partial: size.partial };
    if (spec.id === "proyectos") item.count = await projectCount(full);
    items.push(item);
  }
  let removable = { count: 0, mb: 0 };
  try {
    const { handleSystemAction } = await import("@/lib/system-ops");
    const preview = (await handleSystemAction("backups-preview", {}, { root: d.root })) as { removable?: unknown[]; totalMB?: number };
    removable = { count: Array.isArray(preview.removable) ? preview.removable.length : 0, mb: typeof preview.totalMB === "number" ? preview.totalMB : 0 };
  } catch {
    /* sin copias que limpiar */
  }
  return { root: d.root, dataDir, disk: await diskOf(d), items, removable, checkedAt: new Date(d.now()).toISOString() };
}

/** Borra las copias antiguas (nunca las más recientes ni las protegidas) si no hay nada trabajando. */
export async function cleanOldBackups(deps: MaintenanceDeps = {}): Promise<ActionResult & { removed?: number; freedMB?: number }> {
  const d = await resolveDeps(deps);
  const blocked = await blockedReason(d);
  if (blocked) return { ok: false, error: blocked };
  const { handleSystemAction } = await import("@/lib/system-ops");
  const result = (await handleSystemAction("backups-clean", {}, { root: d.root })) as { ok: boolean; removed?: number; freedMB?: number; error?: string };
  if (!result.ok) return { ok: false, error: result.error ?? "No se pudieron borrar las copias antiguas." };
  const removed = result.removed ?? 0;
  const freedMB = result.freedMB ?? 0;
  return { ok: true, removed, freedMB, message: removed ? `Borradas ${removed} copia(s) antigua(s): ${bytesText(freedMB * 1048576)} libres. Las más recientes y las protegidas siguen ahí.` : "No había copias antiguas que borrar." };
}

// ───────────────────────────────────────────────────────────── caché

export type CacheItem = { id: string; label: string; path: string; bytes: number };
export type CachePreview = { items: CacheItem[]; totalBytes: number; blocked: string | null };

const CACHE_DIRS: Array<{ id: string; rel: string[]; label: string }> = [
  { id: "vite", rel: ["node_modules", ".vite"], label: "Caché de compilación (se vuelve a crear sola cuando hace falta)" },
  { id: "herramientas", rel: ["node_modules", ".cache"], label: "Caché de las herramientas de compilación" },
  { id: "tanstack", rel: [".tanstack", "tmp"], label: "Temporales de la preparación de pantallas" },
  { id: "fallida", rel: ["app", ".output-fallida"], label: "Programa que no llegó a arrancar y quedó apartado" },
];
/** Temporales que deja WILLY en la carpeta temporal de Windows (actualizaciones ya terminadas, YouTube, comprobaciones de pantalla). */
const TEMP_NAME = /^willy-(update|ytdlp|browser)-[A-Za-z0-9.+_-]{1,80}$/;
const TEMP_MIN_AGE_MS = 3600_000;

async function cacheItems(d: Resolved): Promise<CacheItem[]> {
  const { fs, path } = await nodeMods();
  const items: CacheItem[] = [];
  for (const spec of CACHE_DIRS) {
    const full = path.join(d.root, ...spec.rel);
    if (!(await exists(full))) continue;
    items.push({ id: spec.id, label: spec.label, path: spec.rel.join("/"), bytes: (await folderSize(full, { deadlineMs: 4000 })).bytes });
  }
  const tmp = d.tmpdir();
  let names: string[] = [];
  try {
    names = await fs.readdir(tmp);
  } catch {
    names = [];
  }
  for (const name of names.filter((entry) => TEMP_NAME.test(entry)).sort()) {
    const full = path.join(tmp, name);
    try {
      const stat = await fs.stat(full);
      // Solo lo que lleva más de una hora sin tocarse: nunca algo que se esté usando ahora mismo.
      if (d.now() - stat.mtimeMs < TEMP_MIN_AGE_MS) continue;
    } catch {
      continue;
    }
    const kind = name.startsWith("willy-update-") ? "Restos de una actualización ya terminada" : name.startsWith("willy-ytdlp-") ? "Restos de una descarga de YouTube" : "Restos de una comprobación de pantalla";
    items.push({ id: `temporal:${name}`, label: kind, path: full, bytes: (await folderSize(full, { deadlineMs: 3000 })).bytes });
  }
  return items;
}

export async function cachePreview(deps: MaintenanceDeps = {}): Promise<CachePreview> {
  const d = await resolveDeps(deps);
  const items = await cacheItems(d);
  return { items, totalBytes: items.reduce((sum, item) => sum + item.bytes, 0), blocked: await blockedReason(d) };
}

/** Vacía de verdad la caché: solo las carpetas de la lista (se vuelve a calcular aquí, nunca se fía de lo que llega). */
export async function cleanCache(deps: MaintenanceDeps = {}): Promise<ActionResult & { removed?: string[]; failed?: string[]; freedBytes?: number }> {
  const d = await resolveDeps(deps);
  const blocked = await blockedReason(d);
  if (blocked) return { ok: false, error: blocked };
  const { fs, path } = await nodeMods();
  const items = await cacheItems(d);
  const removed: string[] = [];
  const failed: string[] = [];
  let freedBytes = 0;
  for (const item of items) {
    const target = item.id.startsWith("temporal:") ? path.join(d.tmpdir(), item.id.slice("temporal:".length)) : path.join(d.root, ...item.path.split("/"));
    try {
      await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      if (await exists(target)) throw new Error("sigue ahí");
      removed.push(item.label);
      freedBytes += item.bytes;
    } catch {
      failed.push(item.label);
    }
  }
  const message = !items.length
    ? "La caché ya estaba vacía."
    : `Caché vaciada: ${bytesText(freedBytes)} libres${failed.length ? ` (${failed.length} parte(s) estaban en uso y se han dejado)` : ""}. Tus proyectos, conversaciones y ajustes no se tocan.`;
  return { ok: failed.length === 0 || removed.length > 0, removed, failed, freedBytes, message };
}

// ───────────────────────────────────────────────────────────── registros

export type LogSource = { id: string; label: string; lines: string[]; total: number; missing: boolean; updatedAt: string | null };

const clip = (line: string) => (line.length > 1000 ? `${line.slice(0, 1000)}…` : line);
const stamp = (time: number | string) => {
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export async function readLogs(full: boolean, deps: MaintenanceDeps = {}): Promise<{ sources: LogSource[]; full: boolean }> {
  const d = await resolveDeps(deps);
  const { path } = await nodeMods();
  const keep = full ? 300 : 6;
  const out: LogSource[] = [];
  const add = (id: string, label: string, lines: string[], mtime: number | null, missing = false) => {
    const clean = lines.map((line) => clip(redactSecrets(line.replace(/\s+$/, "")))).filter((line) => line.trim());
    out.push({ id, label, lines: clean.slice(-keep), total: clean.length, missing, updatedAt: mtime ? new Date(mtime).toISOString() : null });
  };

  const errors = d.recentErrors();
  add("errores", "Errores recientes del servidor (desde que se encendió)", errors.map((entry) => `[${stamp(entry.at)}] ${entry.text.replace(/\s+/g, " ")}`), errors.length ? errors[errors.length - 1]!.at : null);

  for (const [id, label, rel] of [
    ["arranque", "Arranque de WILLY", "arranque.log"],
    ["arranque-seguro", "Arranque seguro (vuelta sola a la última versión buena)", `${SB_DIR}/${SAFE_START_LOG}`],
  ] as const) {
    const tail = await tailText(path.join(d.root, ...rel.split("/")));
    add(id, label, tail ? tail.text.split(/\r?\n/) : [], tail?.mtime ?? null, !tail);
  }

  const journal = await tailText(path.join(d.root, SB_DIR, "diario-operaciones.jsonl"));
  const journalLines = (journal?.text.split(/\r?\n/) ?? []).filter(Boolean).map((line) => {
    try {
      const entry = JSON.parse(line) as { at?: string; step?: string; detail?: string; op?: string };
      return `[${stamp(entry.at ?? "")}] ${entry.step ?? ""}${entry.detail ? ` · ${entry.detail}` : ""}${entry.op ? ` (${entry.op.slice(0, 60)})` : ""}`;
    } catch {
      return line;
    }
  });
  add("autoconstruccion", "Diario de la Autoconstrucción", journalLines, journal?.mtime ?? null, !journal);

  const update = await readJson<{ version?: string; at?: string; label?: string }>(path.join(d.root, "datos-privados", "actualizacion.json"));
  const updateLines = update ? [`[${stamp(update.at ?? "")}] Instalada la versión ${update.version ?? "?"}`, update.label ?? ""] : [];
  const updating = await updateRunning(d);
  if (updating) updateLines.push(updating);
  add("actualizacion", "Última actualización", updateLines, update?.at ? new Date(update.at).getTime() : null, !update);

  const report = await readJson<{ at?: string; detail?: string; restored?: boolean; answering?: boolean }>(path.join(d.root, SB_DIR, RESTART_REPORT));
  if (report) add("reinicio", "Reinicio que falló", [`[${stamp(report.at ?? "")}] ${report.detail ?? ""}${report.restored ? " Se volvió sola a la versión anterior." : ""}`], report.at ? new Date(report.at).getTime() : null);

  return { sources: out, full };
}

// ───────────────────────────────────────────────────────────── dependencias

export type DependencyReport = { packageJson: boolean; total: number; missing: string[] };

/** ¿Están todas las piezas que necesita la Autoconstrucción para compilar? (No instala nada: en el equipo no hay npm.) */
export async function dependencyCheck(deps: MaintenanceDeps = {}): Promise<DependencyReport> {
  const d = await resolveDeps(deps);
  const { path } = await nodeMods();
  const pkg = await readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(path.join(d.root, "package.json"));
  if (!pkg) return { packageJson: false, total: 0, missing: [] };
  const names = [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])].filter((name) => /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name));
  const missing: string[] = [];
  for (const name of names) {
    if (!(await exists(path.join(d.root, "node_modules", ...name.split("/"), "package.json")))) missing.push(name);
  }
  return { packageJson: true, total: names.length, missing };
}

// ───────────────────────────────────────────────────────────── IA del equipo (Ollama)

export type OllamaModel = { name: string; sizeMB: number; family: string; params: string; quant: string; modifiedAt: string | null };
export type OllamaReport = {
  alive: boolean;
  url: string;
  version: string | null;
  models: OllamaModel[];
  loaded: LoadedModel[];
  usage: GpuUsage;
  gpu: GpuInfo | null;
  modelsDir: { path: string; source: "OLLAMA_MODELS" | "predeterminada"; exists: boolean; bytes: number | null; partial: boolean };
  program: string | null;
  checkedAt: string;
};

async function ollamaJson<T>(d: Resolved, route: string): Promise<T | null> {
  try {
    const res = await d.fetchImpl(`${OLLAMA_URL}${route}`, { signal: AbortSignal.timeout(2500) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Carpeta real de los modelos: la que diga OLLAMA_MODELS (si la has movido) o la de siempre, «.ollama\models» en tu usuario. */
function modelsDirOf(d: Resolved, join: (...parts: string[]) => string): OllamaReport["modelsDir"] {
  const custom = (d.env["OLLAMA_MODELS"] ?? "").trim();
  return custom
    ? { path: custom, source: "OLLAMA_MODELS", exists: false, bytes: null, partial: false }
    : { path: join(d.homedir(), ".ollama", "models"), source: "predeterminada", exists: false, bytes: null, partial: false };
}

async function ollamaProgram(d: Resolved): Promise<string | null> {
  if (d.platform !== "win32") return null;
  const { path } = await nodeMods();
  const candidates = [
    d.env["LOCALAPPDATA"] ? path.join(d.env["LOCALAPPDATA"], "Programs", "Ollama", "ollama.exe") : "",
    d.env["ProgramFiles"] ? path.join(d.env["ProgramFiles"], "Ollama", "ollama.exe") : "",
  ].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return null;
}

export async function ollamaReport(deps: MaintenanceDeps = {}, opts: { sizes?: boolean } = {}): Promise<OllamaReport> {
  const d = await resolveDeps(deps);
  const { path } = await nodeMods();
  const [version, tags, snapshot, program] = await Promise.all([
    ollamaJson<{ version?: string }>(d, "/api/version"),
    ollamaJson<{ models?: Array<{ name?: string; model?: string; size?: number; modified_at?: string; details?: { family?: string; parameter_size?: string; quantization_level?: string } }> }>(d, "/api/tags"),
    d.snapshot().catch(() => null),
    ollamaProgram(d),
  ]);
  const models: OllamaModel[] = (tags?.models ?? [])
    .map((m) => ({
      name: m.name ?? m.model ?? "",
      sizeMB: Math.round((m.size ?? 0) / 1048576),
      family: m.details?.family ?? "",
      params: m.details?.parameter_size ?? "",
      quant: m.details?.quantization_level ?? "",
      modifiedAt: m.modified_at ?? null,
    }))
    .filter((m) => m.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  let loaded = snapshot?.engine.loaded ?? [];
  if (!snapshot) {
    const ps = await ollamaJson<unknown>(d, "/api/ps");
    loaded = ps ? parseOllamaPs(ps) : [];
  }
  const gpu = snapshot?.gpu ?? null;
  const modelsDir = modelsDirOf(d, path.join);
  modelsDir.exists = await exists(modelsDir.path);
  if (modelsDir.exists && opts.sizes !== false) {
    const size = await folderSize(modelsDir.path, { deadlineMs: 4000, maxEntries: 20_000 });
    modelsDir.bytes = size.bytes;
    modelsDir.partial = size.partial;
  }
  return {
    alive: Boolean(tags),
    url: OLLAMA_URL,
    version: version?.version ?? null,
    models,
    loaded,
    usage: gpuUsage(loaded, gpu, { cudaMissing: snapshot?.ollamaCudaMissing }),
    gpu,
    modelsDir,
    program,
    checkedAt: new Date(d.now()).toISOString(),
  };
}

/** Reinicia de verdad la IA del equipo: cierra Ollama, lo vuelve a arrancar y espera a que responda (hasta 25 s). */
export async function restartOllama(deps: MaintenanceDeps = {}): Promise<ActionResult & { version?: string | null }> {
  const d = await resolveDeps(deps);
  if (d.platform !== "win32") return { ok: false, error: "Reiniciar la IA de tu equipo solo se puede hacer en el programa de Windows." };
  await d.exec("taskkill", ["/IM", "ollama.exe", "/F"], 10_000);
  // Espera a que se cierre del todo (deja libre su puerto) antes de volver a arrancarlo.
  for (let i = 0; i < 10 && (await ollamaJson(d, "/api/version")); i += 1) await d.sleep(500);
  const launched = await d.startDetached('set "PATH=%PATH%;%LOCALAPPDATA%\\Programs\\Ollama;%ProgramFiles%\\Ollama" && ollama serve');
  for (let i = 0; i < 25; i += 1) {
    const version = await ollamaJson<{ version?: string }>(d, "/api/version");
    if (version) return { ok: true, version: version.version ?? null, message: `La IA de tu equipo se ha reiniciado y ya responde${version.version ? ` (Ollama ${version.version})` : ""}.` };
    await d.sleep(1000);
  }
  return {
    ok: false,
    error: launched
      ? "La IA de tu equipo se cerró pero no ha vuelto a responder. Pulsa «Arrancar la IA de mi equipo» o reinicia el ordenador."
      : "No se pudo volver a arrancar la IA de tu equipo (Ollama). Pulsa «Arrancar la IA de mi equipo».",
  };
}

// ───────────────────────────────────────────────────────────── diagnóstico

export type DiagStatus = "ok" | "aviso" | "fallo" | "info";
export type DiagCheck = { id: string; label: string; status: DiagStatus; detail: string; fix?: string };
export type DiagReport = { at: string; overall: "todo bien" | "con avisos" | "con fallos"; checks: DiagCheck[]; tookMs: number };

const whenText = (time: number) => new Date(time).toLocaleString("es-ES", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

async function newestBackup(root: string): Promise<{ folder: string; name: string; mtime: number } | null> {
  const { fs, path } = await nodeMods();
  let best: { folder: string; name: string; mtime: number } | null = null;
  for (const folder of ["copias-actualizacion", SB_DIR, "copias-rediseno"]) {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fs.readdir(path.join(root, folder), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const mtime = (await fs.stat(path.join(root, folder, entry.name))).mtimeMs;
        if (!best || mtime > best.mtime) best = { folder, name: entry.name, mtime };
      } catch {
        /* copia que desaparece mientras se mira */
      }
    }
  }
  return best;
}

export async function diagnose(port: number, deps: MaintenanceDeps = {}): Promise<DiagReport> {
  const d = await resolveDeps(deps);
  const { fs, path } = await nodeMods();
  const started = d.now();
  const safe = async (id: string, label: string, run: () => Promise<Omit<DiagCheck, "id" | "label">>): Promise<DiagCheck> => {
    try {
      return { id, label, ...(await run()) };
    } catch (error) {
      return { id, label, status: "aviso", detail: `No se pudo comprobar: ${redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 200)}` };
    }
  };

  const ollama = ollamaReport(d, { sizes: false });
  const checks = await Promise.all([
    safe("servidor", "WILLY AI", async () => {
      const installed = await d.installed().catch(() => false);
      return {
        status: installed ? "ok" : "info",
        detail: `Versión ${APP_VERSION} (revisión ${APP_REVISION}) funcionando en el puerto ${port}, encendido desde hace ${durationText(d.uptimeSec())}.${installed ? "" : " Esto es la vista previa, no el programa instalado."}`,
      };
    }),
    safe("actualizacion", "Actualizaciones", async () => {
      const updating = await updateRunning(d);
      if (updating) return { status: "aviso", detail: updating, fix: "Espera a que termine la ventana de la actualización." };
      const last = await readJson<{ version?: string; at?: string }>(path.join(d.root, "datos-privados", "actualizacion.json"));
      return last?.at ? { status: "ok", detail: `La última actualización (${last.version ?? "?"}) se instaló el ${whenText(new Date(last.at).getTime())}.` } : { status: "info", detail: "No hay registro de actualizaciones en este equipo." };
    }),
    safe("autoconstruccion", "Autoconstrucción y arranque", async () => {
      const op = await d.busy().catch(() => null);
      if (op) return { status: "info", detail: "La Autoconstrucción está trabajando ahora mismo." };
      const report = await readJson<{ at?: string; detail?: string }>(path.join(d.root, SB_DIR, RESTART_REPORT));
      if (report?.detail) return { status: "aviso", detail: `Un reinicio falló (${report.at ? whenText(new Date(report.at).getTime()) : "hace poco"}): ${report.detail}`, fix: "WILLY volvió solo a la versión anterior. Mira «Registros» y la pestaña Versiones de la Autoconstrucción." };
      const safeLog = await tailText(path.join(d.root, SB_DIR, SAFE_START_LOG), 16 * 1024);
      if (safeLog && d.now() - safeLog.mtime < 7 * 86400_000) {
        const last = safeLog.text.trim().split(/\r?\n/).pop() ?? "";
        return { status: "aviso", detail: `El arranque seguro tuvo que actuar hace poco: ${redactSecrets(last).slice(0, 300)}`, fix: "WILLY sigue funcionando con la última versión buena. Mira «Registros»." };
      }
      return { status: "ok", detail: "Sin operaciones a medias ni arranques fallidos." };
    }),
    safe("motor-local", "IA de tu equipo (Ollama)", async () => {
      const report = await ollama;
      if (!report.alive) return { status: "aviso", detail: "La IA de tu equipo no responde.", fix: "Centro de Inteligencia → Tu equipo → «Arrancar la IA de mi equipo» (si usas una IA externa, no es imprescindible)." };
      if (!report.models.length) return { status: "aviso", detail: `Ollama ${report.version ?? ""} responde, pero no tiene ningún modelo descargado.`, fix: "Centro de Inteligencia → Modelos → descarga el recomendado." };
      return { status: "ok", detail: `Ollama ${report.version ?? ""} responde con ${report.models.length} modelo(s) descargado(s).` };
    }),
    safe("grafica", "Tarjeta gráfica", async () => {
      const report = await ollama;
      const usage = report.usage;
      const gpuName = report.gpu ? `${report.gpu.name}` : "";
      if (usage.state === "grafica") return { status: "ok", detail: `La IA de tu equipo («${usage.model}») calcula con la tarjeta gráfica${gpuName ? ` (${gpuName})` : ""}: va rápida.` };
      if (usage.state === "mixto") return { status: "aviso", detail: `«${usage.model}» solo está al ${usage.share} % en la gráfica; el resto va al procesador y es más lento.`, fix: "Usa un modelo más pequeño (de unos 7B) para que quepa entero." };
      if (usage.state === "procesador") return { status: "aviso", detail: `La IA de tu equipo («${usage.model}») va solo con el procesador. ${usage.reason}`, fix: usage.fix };
      return { status: "info", detail: `Ahora no hay ningún modelo cargado: se sabrá en cuanto la IA de tu equipo conteste algo.${gpuName ? ` Gráfica detectada: ${gpuName}.` : ""}` };
    }),
    safe("ia-externa", "IA externas (opcionales)", async () => {
      const summary = await d.engines();
      if (!summary) return { status: "info", detail: "No se pudo leer la configuración de las IA externas." };
      if (!summary.withKey) return { status: "info", detail: "No has añadido ninguna clave de IA externa (es opcional).", fix: "Centro de Inteligencia → IA externas." };
      if (!summary.master) return { status: "info", detail: `Tienes ${summary.withKey} clave(s), pero el interruptor general de la IA externa está apagado.` };
      if (!summary.available) return { status: "aviso", detail: `Tus ${summary.withKey} IA externa(s) están en espera (cuota gratuita agotada o clave rechazada).`, fix: "Vuelven solas cuando se renueva la cuota; mientras, contesta tu equipo." };
      return { status: "ok", detail: `${summary.available} de ${summary.withKey} IA externa(s) listas: ${summary.names.join(", ")}.` };
    }),
    safe("internet", "Conexión a internet", async () =>
      (await d.internet())
        ? { status: "ok", detail: "Hay conexión a internet." }
        : { status: "aviso", detail: "No hay conexión a internet: las IA externas, la búsqueda web y YouTube no funcionarán.", fix: "Comprueba el Wi-Fi o el cable. La IA de tu equipo sigue funcionando sin internet." },
    ),
    safe("disco", "Espacio en el disco", async () => {
      const disk = await diskOf(d);
      if (!disk) return { status: "info", detail: "No se pudo leer el espacio del disco." };
      const text = `${disk.freeGB.toFixed(1).replace(".", ",")} GB libres de ${disk.totalGB.toFixed(0)} GB en ${disk.drive}`;
      if (disk.freeGB < 2) return { status: "fallo", detail: `${text}: casi lleno.`, fix: "Borra copias antiguas (Ajustes → Almacenamiento) o modelos que no uses (Centro de Inteligencia → Modelos)." };
      if (disk.freeGB < 10) return { status: "aviso", detail: `${text}: queda poco.`, fix: "Ajustes → Almacenamiento → «Borrar copias antiguas»." };
      return { status: "ok", detail: `${text}.` };
    }),
    safe("memoria", "Memoria", async () => {
      const { total, free } = d.memory();
      const percent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
      const text = `${percent} % en uso (${bytesText(total - free)} de ${bytesText(total)})`;
      return percent >= 95 ? { status: "aviso", detail: `${text}: casi llena.`, fix: "Inicio → «Liberar memoria de la IA» o cierra programas pesados." } : { status: "ok", detail: `${text}.` };
    }),
    safe("proyectos", "Guardado de tus proyectos", async () => {
      const dir = path.join(d.root, "datos-privados");
      const probe = path.join(dir, `.prueba-diagnostico-${d.pid}.tmp`);
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(probe, "ok", "utf8");
        const back = await fs.readFile(probe, "utf8");
        if (back !== "ok") throw new Error("lo escrito no coincide al leerlo");
      } catch (error) {
        return { status: "fallo", detail: `No se puede guardar en la carpeta de datos (${error instanceof Error ? error.message : String(error)}).`, fix: "Cierra programas que puedan bloquearla (antivirus, copias de seguridad) y vuelve a probar." };
      } finally {
        await fs.rm(probe, { force: true }).catch(() => undefined);
      }
      const count = await projectCount(path.join(dir, "proyectos"));
      return { status: "ok", detail: `Se guardan bien en tu equipo (${count} proyecto(s)).` };
    }),
    safe("copias", "Copias de seguridad", async () => {
      const newest = await newestBackup(d.root);
      return newest ? { status: "ok", detail: `La más reciente es del ${whenText(newest.mtime)}.` } : { status: "aviso", detail: "Todavía no hay ninguna copia de seguridad.", fix: "Se crea sola con la próxima actualización o mejora." };
    }),
    safe("dependencias", "Piezas para compilar", async () => {
      const report = await dependencyCheck(d);
      if (!report.packageJson) return { status: "info", detail: "No se encuentra package.json (vista previa)." };
      if (!report.missing.length) return { status: "ok", detail: `Están las ${report.total} piezas que necesita la Autoconstrucción.` };
      return { status: "aviso", detail: `Faltan ${report.missing.length} de ${report.total} piezas (${report.missing.slice(0, 5).join(", ")}${report.missing.length > 5 ? "…" : ""}): la Autoconstrucción no podrá compilar.`, fix: "La próxima actualización oficial las repone. Si no, «Recuperar WILLY AI» o reinstalar." };
    }),
    safe("errores", "Errores del servidor", async () => {
      const hour = d.now() - 3600_000;
      const recent = d.recentErrors().filter((entry) => entry.at >= hour);
      return recent.length ? { status: "aviso", detail: `${recent.length} error(es) en la última hora.`, fix: "Mira «Registros» (arriba) para ver cuáles." } : { status: "ok", detail: "Ningún error en la última hora." };
    }),
  ]);
  const overall = checks.some((check) => check.status === "fallo") ? "con fallos" : checks.some((check) => check.status === "aviso") ? "con avisos" : "todo bien";
  return { at: new Date(d.now()).toISOString(), overall, checks, tookMs: Math.max(0, d.now() - started) };
}
