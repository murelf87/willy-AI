import {
  POWER,
  cpuPercent,
  isHighPerformance,
  parseNvidiaSmi,
  parseOllamaPs,
  parsePowerScheme,
  parseTasklist,
  pickRemovable,
  type BackupInfo,
  type CpuTimes,
  type LoadedModel,
  type SystemSnapshot,
} from "@/lib/system-info";

// Lectura del equipo y acciones de optimización del panel de Inicio (solo en el programa instalado).
// Todo lo que toca el sistema se puede sustituir para probarlo sin depender del ordenador real.

const OLLAMA_URL = "http://127.0.0.1:11434";
// «modelo», «usuario/modelo» y «modelo:etiqueta»; nunca «..» ni rutas.
const MODEL_NAME = /^(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,80})?(?::[a-zA-Z0-9._-]{1,60})?$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Carpetas de copias de WILLY y cuántas de las más recientes se conservan siempre. */
const BACKUP_FOLDERS: Array<{ folder: string; keep: number }> = [
  { folder: "copias-autoconstruccion", keep: 3 },
  { folder: "copias-actualizacion", keep: 2 },
];

export type SystemDeps = {
  cpus?: () => Array<{ model: string; times: { idle: number; user: number; nice: number; sys: number; irq: number } }>;
  totalmem?: () => number;
  freemem?: () => number;
  platform?: string;
  exec?: (file: string, args: string[], timeoutMs?: number) => Promise<{ ok: boolean; stdout: string }>;
  fetchImpl?: typeof fetch;
  root?: string;
  statfs?: (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  /** Pausa entre dos lecturas del procesador (para las pruebas). */
  sleep?: (ms: number) => Promise<void>;
  /** Archivo con el que arrancó este servidor: su copia nunca se borra al limpiar (para las pruebas). */
  runningEntry?: string;
};

async function withDefaults(deps: SystemDeps): Promise<Required<Omit<SystemDeps, "root">> & { root: string }> {
  const os = await import("node:os");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const exec = deps.exec ?? ((file: string, args: string[], timeoutMs = 4000) =>
    new Promise<{ ok: boolean; stdout: string }>((resolve) => {
      try {
        execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? "") }));
      } catch {
        resolve({ ok: false, stdout: "" });
      }
    }));
  const statfs = deps.statfs ?? (async (target: string) => {
    const stats = await (fs as unknown as { statfs: (p: string) => Promise<{ bsize: number; blocks: number; bavail: number }> }).statfs(target);
    return { bsize: Number(stats.bsize), blocks: Number(stats.blocks), bavail: Number(stats.bavail) };
  });
  return {
    cpus: deps.cpus ?? (() => os.cpus()),
    totalmem: deps.totalmem ?? (() => os.totalmem()),
    freemem: deps.freemem ?? (() => os.freemem()),
    platform: deps.platform ?? process.platform,
    exec,
    fetchImpl: deps.fetchImpl ?? fetch,
    statfs,
    sleep: deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    runningEntry: deps.runningEntry ?? process.argv[1] ?? "",
    root: deps.root ?? (await findRoot(path.resolve(process.cwd()))),
  };
}

/** Carpeta de instalación: la primera hacia arriba que tiene package.json (igual que la Autoconstrucción). */
async function findRoot(start: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  let dir = start;
  for (let step = 0; step < 6; step += 1) {
    try {
      await fs.access(path.join(dir, "package.json"));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return start;
}

let lastCpu: { at: number; times: CpuTimes[] } | null = null;
let noNvidiaUntil = 0;

const toTimes = (cpus: ReturnType<Required<SystemDeps>["cpus"]>): CpuTimes[] =>
  cpus.map((cpu) => ({ idle: cpu.times.idle, total: cpu.times.idle + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq }));

async function readCpu(d: Awaited<ReturnType<typeof withDefaults>>): Promise<number | null> {
  const now = Date.now();
  let before = lastCpu && now - lastCpu.at < 30_000 ? lastCpu.times : null;
  if (!before) {
    before = toTimes(d.cpus());
    await d.sleep(300);
  }
  const after = toTimes(d.cpus());
  lastCpu = { at: Date.now(), times: after };
  return cpuPercent(before, after);
}

async function readGpu(d: Awaited<ReturnType<typeof withDefaults>>) {
  if (Date.now() < noNvidiaUntil) return null;
  const args = ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"];
  for (const file of ["nvidia-smi", "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"]) {
    const result = await d.exec(file, args, 3000);
    const gpus = result.ok ? parseNvidiaSmi(result.stdout) : [];
    if (gpus.length) return gpus.sort((a, b) => b.vramTotalMB - a.vramTotalMB)[0] ?? null;
  }
  noNvidiaUntil = Date.now() + 60_000; // sin gráfica NVIDIA: no se vuelve a intentar cada 2 segundos
  return null;
}

async function readEngine(d: Awaited<ReturnType<typeof withDefaults>>): Promise<SystemSnapshot["engine"]> {
  try {
    const tags = await d.fetchImpl(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!tags.ok) return { alive: false, installed: 0, loaded: [] };
    const installed = ((await tags.json()) as { models?: unknown[] }).models?.length ?? 0;
    let loaded: LoadedModel[] = [];
    try {
      const ps = await d.fetchImpl(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(2000) });
      if (ps.ok) loaded = parseOllamaPs(await ps.json());
    } catch {
      /* versiones antiguas sin /api/ps */
    }
    return { alive: true, installed, loaded };
  } catch {
    return { alive: false, installed: 0, loaded: [] };
  }
}

async function readDisk(d: Awaited<ReturnType<typeof withDefaults>>): Promise<SystemSnapshot["disk"]> {
  try {
    const path = await import("node:path");
    const stats = await d.statfs(d.root);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    if (!(total > 0)) return null;
    return { drive: path.parse(d.root).root || d.root, freeGB: free / 1073741824, totalGB: total / 1073741824, percent: Math.round((1 - free / total) * 100) };
  } catch {
    return null;
  }
}

async function folderSize(dir: string): Promise<number> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  let total = 0;
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 12) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else {
        try {
          total += (await fs.stat(full)).size;
        } catch {
          /* archivo que desaparece mientras se cuenta */
        }
      }
    }
  };
  await walk(dir, 0);
  return total;
}

/**
 * Copias que NUNCA se borran al limpiar, aunque sean antiguas: las que la Autoconstrucción protege en su registro (la
 * versión activa, la última buena y las estables, que usa «Volver a la versión anterior») y la copia desde la que esté
 * funcionando ahora mismo este servidor (por ejemplo, tras un arranque seguro).
 */
async function protectedCopies(root: string, runningEntry: string): Promise<Set<string>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const keep = new Set<string>();
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, "copias-autoconstruccion", "versiones.json"), "utf8")) as { entries?: unknown; activeId?: unknown; lastKnownGood?: unknown };
    const entries = (Array.isArray(raw.entries) ? raw.entries : []).filter((e): e is { id: string; status?: unknown; backup?: unknown } => !!e && typeof (e as { id?: unknown }).id === "string");
    const byId = (id: unknown) => entries.find((e) => e.id === id);
    for (const entry of [byId(raw.activeId), byId(raw.lastKnownGood), ...entries.filter((e) => e.status === "ESTABLE").slice(-3)]) {
      if (entry && typeof entry.backup === "string" && entry.backup) keep.add(`copias-autoconstruccion/${entry.backup}`);
    }
  } catch {
    /* sin registro todavía */
  }
  if (runningEntry) {
    const rel = path.relative(root, path.resolve(runningEntry)).split(path.sep);
    if (rel.length > 2 && BACKUP_FOLDERS.some((entry) => entry.folder === rel[0]) && rel[1]) keep.add(`${rel[0]}/${rel[1]}`);
  }
  return keep;
}

/** Copias de WILLY que se pueden borrar (todas menos las más recientes de cada carpeta y las protegidas). */
async function listRemovable(root: string, runningEntry: string): Promise<Array<{ folder: string; name: string; mb: number }>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const keep = await protectedCopies(root, runningEntry);
  const out: Array<{ folder: string; name: string; mb: number }> = [];
  for (const { folder, keep: newest } of BACKUP_FOLDERS) {
    let names: string[] = [];
    try {
      names = (await fs.readdir(path.join(root, folder), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const name of pickRemovable(names, newest)) {
      if (keep.has(`${folder}/${name}`)) continue;
      out.push({ folder, name, mb: Math.round((await folderSize(path.join(root, folder, name))) / 1048576) });
    }
  }
  return out;
}

async function readBackups(root: string, runningEntry: string): Promise<BackupInfo> {
  const removable = await listRemovable(root, runningEntry);
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  let total = 0;
  for (const { folder } of BACKUP_FOLDERS) {
    try {
      await fs.access(path.join(root, folder));
      total += await folderSize(path.join(root, folder));
    } catch {
      /* esa carpeta aún no existe */
    }
  }
  return { totalMB: Math.round(total / 1048576), removableMB: removable.reduce((sum, item) => sum + item.mb, 0), removableCount: removable.length };
}

async function readPower(d: Awaited<ReturnType<typeof withDefaults>>) {
  if (d.platform !== "win32") return null;
  const result = await d.exec("powercfg", ["/getactivescheme"], 3000);
  return result.ok ? parsePowerScheme(result.stdout) : null;
}

/**
 * ¿A la instalación de Ollama le falta su pieza para la gráfica? Hay carpeta lib\ollama\cuda_vNN pero ningún ggml-cuda.dll
 * dentro (instalación cortada). Solo en Windows; se mira como mucho una vez por minuto (son dos lecturas de carpeta).
 */
let cudaCheck: { at: number; missing: boolean } | null = null;
async function readOllamaCudaMissing(platform: string): Promise<boolean> {
  if (platform !== "win32") return false;
  if (cudaCheck && Date.now() - cudaCheck.at < 60_000) return cudaCheck.missing;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const local = process.env["LOCALAPPDATA"] ?? "";
  const programs = process.env["ProgramFiles"] ?? "";
  const roots = [local ? path.join(local, "Programs", "Ollama") : "", programs ? path.join(programs, "Ollama") : ""].filter(Boolean);
  let missing = false;
  for (const root of roots) {
    const lib = path.join(root, "lib", "ollama");
    let entries: string[];
    try {
      entries = await fs.readdir(lib);
    } catch {
      continue;
    }
    const cudaDirs = entries.filter((name) => /^cuda_v\d+$/i.test(name));
    let found = false;
    for (const dir of cudaDirs) {
      try {
        await fs.access(path.join(lib, dir, "ggml-cuda.dll"));
        found = true;
        break;
      } catch {
        /* en esta carpeta no está */
      }
    }
    missing = cudaDirs.length > 0 && !found;
    break;
  }
  cudaCheck = { at: Date.now(), missing };
  return missing;
}

/** Lectura del equipo en directo. Con `more` añade procesos, plan de energía y copias (más lenta). */
export async function systemStats(opts: { more?: boolean } = {}, deps: SystemDeps = {}): Promise<SystemSnapshot> {
  const d = await withDefaults(deps);
  const cpus = d.cpus();
  const [cpu, gpu, engine, disk, cudaMissing] = await Promise.all([readCpu(d), readGpu(d), readEngine(d), readDisk(d), readOllamaCudaMissing(d.platform).catch(() => false)]);
  const total = d.totalmem();
  const used = total - d.freemem();
  const snapshot: SystemSnapshot = {
    at: Date.now(),
    platform: d.platform,
    cpu: { percent: cpu, cores: cpus.length, model: (cpus[0]?.model ?? "").replace(/\s+/g, " ").trim() },
    memory: { totalMB: Math.round(total / 1048576), usedMB: Math.round(used / 1048576), percent: total > 0 ? Math.round((used / total) * 100) : 0 },
    gpu,
    disk,
    engine,
    ...(cudaMissing ? { ollamaCudaMissing: true } : {}),
  };
  if (opts.more) {
    const [tasks, power, backups] = await Promise.all([
      d.platform === "win32" ? d.exec("tasklist", ["/fo", "csv", "/nh"], 5000) : Promise.resolve({ ok: false, stdout: "" }),
      readPower(d),
      readBackups(d.root, d.runningEntry),
    ]);
    snapshot.processes = tasks.ok ? parseTasklist(tasks.stdout) : [];
    snapshot.power = power;
    snapshot.backups = backups;
  }
  return snapshot;
}

type ActionResult = { ok: boolean; error?: string; [key: string]: unknown };

/** Acciones del panel. Cada una devuelve {ok} y un mensaje claro si algo falla. */
export async function handleSystemAction(action: string, body: { model?: unknown }, deps: SystemDeps = {}): Promise<ActionResult> {
  const d = await withDefaults(deps);
  const path = await import("node:path");
  const fs = await import("node:fs/promises");

  if (action === "unload") {
    let names: string[];
    if (typeof body.model === "string" && body.model) {
      if (!MODEL_NAME.test(body.model)) return { ok: false, error: "Nombre de modelo no válido." };
      names = [body.model];
    } else {
      names = (await readEngine(d)).loaded.map((model) => model.name);
    }
    if (!names.length) return { ok: true, unloaded: [], message: "No había ningún modelo cargado en memoria." };
    const done: string[] = [];
    for (const model of names) {
      try {
        const res = await d.fetchImpl(`${OLLAMA_URL}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(15_000) });
        if (res.ok) done.push(model);
      } catch {
        /* se informa abajo */
      }
    }
    return done.length ? { ok: true, unloaded: done } : { ok: false, error: "No se pudo descargar la memoria: el motor de IA no respondió." };
  }

  if (action === "backups-preview") {
    const removable = await listRemovable(d.root, d.runningEntry);
    return { ok: true, removable, totalMB: removable.reduce((sum, item) => sum + item.mb, 0) };
  }

  if (action === "backups-clean") {
    const removable = await listRemovable(d.root, d.runningEntry);
    let freed = 0;
    let removed = 0;
    for (const item of removable) {
      // Solo dentro de las dos carpetas de copias de WILLY y solo subcarpetas con nombre válido.
      if (!BACKUP_FOLDERS.some((entry) => entry.folder === item.folder) || /[\\/]|^\.+$/.test(item.name)) continue;
      try {
        await fs.rm(path.join(d.root, item.folder, item.name), { recursive: true, force: true });
        freed += item.mb;
        removed += 1;
      } catch {
        /* una copia en uso se salta */
      }
    }
    return { ok: true, removed, freedMB: freed };
  }

  if (action === "power-high" || action === "power-restore") {
    if (d.platform !== "win32") return { ok: false, error: "El plan de energía solo se puede cambiar en Windows." };
    const memory = path.join(d.root, "plan-energia-anterior.txt");
    const current = await readPower(d);
    if (action === "power-high") {
      if (isHighPerformance(current)) return { ok: true, active: current, message: "Ya estaba en Alto rendimiento." };
      if (current) await fs.writeFile(memory, current.guid, "utf8").catch(() => undefined);
      let set = await d.exec("powercfg", ["/setactive", POWER.HIGH], 4000);
      if (!set.ok) {
        // En muchos portátiles el plan «Alto rendimiento» está oculto: se crea a partir del original y se activa.
        const made = await d.exec("powercfg", ["/duplicatescheme", POWER.HIGH], 4000);
        const created = made.ok ? parsePowerScheme(made.stdout) : null;
        if (created) set = await d.exec("powercfg", ["/setactive", created.guid], 4000);
      }
      const after = await readPower(d);
      return isHighPerformance(after)
        ? { ok: true, active: after }
        : { ok: false, error: "Windows no permitió activar «Alto rendimiento» en este equipo. Puedes cambiarlo a mano en Configuración > Sistema > Inicio/apagado y batería." };
    }
    let previous: string = POWER.BALANCED;
    try {
      const saved = (await fs.readFile(memory, "utf8")).trim();
      if (GUID.test(saved)) previous = saved;
    } catch {
      /* sin plan guardado: se vuelve a Equilibrado */
    }
    await d.exec("powercfg", ["/setactive", previous], 4000);
    const after = await readPower(d);
    return after && after.guid === previous.toLowerCase()
      ? { ok: true, active: after }
      : { ok: false, error: "No se pudo restaurar el plan de energía anterior. Cámbialo a mano en Configuración > Sistema > Inicio/apagado y batería." };
  }

  return { ok: false, error: "Acción no reconocida." };
}
