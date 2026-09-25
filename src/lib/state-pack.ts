// «Continuar el desarrollo»: un único .zip con TODO lo necesario para seguir mejorando WILLY AI sabiendo exactamente en qué
// estado está tu instalación: el código actual (con lo que haya cambiado la Autoconstrucción), qué ha cambiado respecto a la
// versión oficial, las mejoras hechas con la propia web, el estado del equipo y lo que quieres hacer después.
// Nunca incluye conversaciones, proyectos, claves ni contraseñas.

export const MAX_FILE_BYTES = 1_500_000;
export const MAX_TOTAL_BYTES = 30_000_000;
export const RELEASE_FILE = "willy-release.json";
export const JOURNAL_FILE = "mejoras-de-la-web.md";

const SKIP_DIRS = new Set(["node_modules", ".output", ".git", ".vinxi", ".nitro", ".tanstack", ".turbo", "dist", "app", "copias-autoconstruccion", "copias-actualizaciones", "datos-privados"]);
const ROOT_FILES = ["package.json", "tsconfig.json", "vite.config.ts", "vite.config.local.ts", "components.json", "roadmap.md", "README.md", "AGENTS.md", "bunfig.toml", "eslint.config.js", ".prettierrc"];
const SECRET_NAME = /(^|\/)(\.env(\..*)?|.*\.(pem|key|pfx|p12)|id_rsa.*|.*secret.*|motores\.json)$/i;
/** Se genera al compilar y cambia sin que nadie lo haya tocado: no cuenta como «modificado». */
const IGNORE_COMPARE = new Set(["src/routeTree.gen.ts"]);
const TEXT = /\.(?:tsx?|jsx?|mjs|cjs|json|css|md|html|svg|txt)$/i;

export type PackFile = { path: string; data: Buffer };

async function nodes() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const crypto = await import("node:crypto");
  return { fs, path, crypto };
}

export const isSecretName = (relative: string): boolean => SECRET_NAME.test(relative.replace(/\\/g, "/"));

/** El código actual: todo `src` y los archivos de configuración de la raíz. Sin compilados, copias ni datos privados. */
export async function collectProject(root: string): Promise<{ files: PackFile[]; skipped: string[] }> {
  const { fs, path } = await nodes();
  const files: PackFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  const take = async (relative: string) => {
    if (isSecretName(relative)) return void skipped.push(`${relative} (parece secreto)`);
    try {
      const data = await fs.readFile(path.join(root, ...relative.split("/")));
      if (data.length > MAX_FILE_BYTES) return void skipped.push(`${relative} (más de ${MAX_FILE_BYTES / 1000} KB)`);
      if (total + data.length > MAX_TOTAL_BYTES) return void skipped.push(`${relative} (paquete demasiado grande)`);
      total += data.length;
      files.push({ path: relative, data });
    } catch {
      /* desaparece mientras se lee */
    }
  };
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 10) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(root, ...dir.split("/")), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(relative, depth + 1);
      } else if (entry.isFile()) await take(relative);
    }
  };
  await walk("src", 0);
  for (const name of [...ROOT_FILES, RELEASE_FILE, JOURNAL_FILE]) await take(name);
  return { files, skipped };
}

/** Huella de un archivo. Los saltos de línea de Windows (CRLF) y de Linux (LF) dan la misma huella. */
export async function hashOf(relative: string, data: Buffer): Promise<string> {
  const { crypto } = await nodes();
  const bytes = TEXT.test(relative) ? Buffer.from(data.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : data;
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export async function hashes(files: PackFile[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of files) if (file.path.startsWith("src/") && !IGNORE_COMPARE.has(file.path)) out[file.path] = await hashOf(file.path, file.data);
  return out;
}

export type Release = { version: string; files: Record<string, string> };
export type Diff = { modified: string[]; added: string[]; removed: string[] };

export function compareToRelease(current: Record<string, string>, release: Release | null): Diff | null {
  if (!release?.files) return null;
  const modified: string[] = [];
  const added: string[] = [];
  for (const [file, hash] of Object.entries(current)) {
    if (!(file in release.files)) added.push(file);
    else if (release.files[file] !== hash) modified.push(file);
  }
  const removed = Object.keys(release.files).filter((file) => !(file in current));
  return { modified: modified.sort(), added: added.sort(), removed: removed.sort() };
}

export async function readRelease(files: PackFile[]): Promise<Release | null> {
  const found = files.find((file) => file.path === RELEASE_FILE);
  if (!found) return null;
  try {
    const parsed = JSON.parse(found.data.toString("utf8")) as Release;
    return parsed && typeof parsed.version === "string" && parsed.files && typeof parsed.files === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Versión que dice el código instalado (puede diferir de la del programa en marcha si algo se cambió y no se compiló). */
export function sourceVersion(files: PackFile[]): { version: string; revision: number } | null {
  const text = files.find((file) => file.path === "src/lib/version.ts")?.data.toString("utf8");
  if (!text) return null;
  const version = /APP_VERSION\s*=\s*"([^"]+)"/.exec(text)?.[1];
  const revision = Number(/APP_REVISION\s*=\s*(\d+)/.exec(text)?.[1] ?? 0);
  return version ? { version, revision } : null;
}

// ------------------------------------------------------------------------------------------------ zip (sin librerías)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Buffer };

export async function buildZip(entries: ZipEntry[], when = new Date()): Promise<Buffer> {
  const zlib = await import("node:zlib");
  if (entries.length > 60_000) throw new Error("Demasiados archivos para un zip sencillo.");
  const time = ((when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2)) & 0xffff;
  const date = (((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const compressed = zlib.deflateRawSync(entry.data, { level: 6 });
    const useDeflate = compressed.length < entry.data.length;
    const body = useDeflate ? compressed : entry.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(entry.data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

// ------------------------------------------------------------------------------------------------ lo que envía la pantalla

export type ClientImprovement = { id: string; createdAt: string; request: string; proposal: string; status: string; result: string; engine: string; files: string[]; checks: { mustContain: string[]; mustNotContain: string[] } | null; evidence: { summary: string; items: Array<{ status: string; title: string; detail: string }> } | null; attachments: string[]; screenshots: string[] };
export type ClientState = {
  version: string;
  revision: number;
  userAgent: string;
  notes: string;
  instructions: string;
  improvements: ClientImprovement[];
  lessons: Array<{ request: string; kind: string; files: string[]; model: string; verdict: string; attempts: number }>;
  settings: { endpoint: string; model: string; agents: string[]; tools: string[]; project: string };
  brokenModels: Array<{ model: string; kind: string }>;
  engineReport: string;
  dataSources: { enabled: boolean; off: string[] };
  dataSourcesReport: string;
};

const str = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
/** Oculta lo que parece una clave o un token dentro de un texto libre (por si algún mensaje de error la trajera). */
const scrubKeys = (text: string): string => text.replace(/(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]{16,}|(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi, "[oculto]");
const list = (value: unknown, max: number, each: number): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, max).map((item) => item.slice(0, each)) : []);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** Lo que llega del navegador se valida, se recorta y solo se conservan los campos esperados (nada de claves ni contenidos de archivos). */
export function sanitizeClientState(raw: unknown): ClientState {
  const data = obj(raw);
  const settings = obj(data["settings"]);
  const improvements = (Array.isArray(data["improvements"]) ? data["improvements"] : []).slice(0, 60).map((entry): ClientImprovement => {
    const item = obj(entry);
    const checks = obj(item["checks"]);
    const evidence = obj(item["evidence"]);
    return {
      id: str(item["id"], 80),
      createdAt: str(item["createdAt"], 40),
      request: str(item["request"], 2000),
      proposal: str(item["proposal"], 4000),
      status: str(item["status"], 40),
      result: str(item["result"], 2000),
      engine: str(item["engine"], 120),
      files: list(item["files"], 40, 200),
      checks: Object.keys(checks).length ? { mustContain: list(checks["mustContain"], 8, 140), mustNotContain: list(checks["mustNotContain"], 8, 140) } : null,
      evidence: Object.keys(evidence).length
        ? { summary: str(evidence["summary"], 300), items: (Array.isArray(evidence["items"]) ? evidence["items"] : []).slice(0, 40).map((e) => ({ status: str(obj(e)["status"], 12), title: str(obj(e)["title"], 200), detail: str(obj(e)["detail"], 400) })) }
        : null,
      attachments: list(item["attachments"], 10, 120),
      screenshots: list(item["screenshots"], 6, 600),
    };
  });
  const lessons = (Array.isArray(data["lessons"]) ? data["lessons"] : []).slice(0, 40).map((entry) => {
    const l = obj(entry);
    return { request: str(l["request"], 500), kind: str(l["kind"], 40), files: list(l["files"], 10, 200), model: str(l["model"], 120), verdict: str(l["verdict"], 30), attempts: Number(l["attempts"]) || 0 };
  });
  return {
    version: str(data["version"], 30),
    revision: Number(data["revision"]) || 0,
    userAgent: str(data["userAgent"], 300),
    notes: str(data["notes"], 8000),
    instructions: str(data["instructions"], 12000),
    improvements,
    lessons,
    settings: { endpoint: str(settings["endpoint"], 200), model: str(settings["model"], 120), agents: list(settings["agents"], 30, 60), tools: list(settings["tools"], 30, 60), project: str(settings["project"], 120) },
    brokenModels: (Array.isArray(data["brokenModels"]) ? data["brokenModels"] : []).slice(0, 30).map((m) => ({ model: str(obj(m)["model"], 120), kind: str(obj(m)["kind"], 30) })),
    engineReport: str(data["engineReport"], 20000),
    dataSources: { enabled: obj(data["dataSources"])["enabled"] !== false, off: list(obj(data["dataSources"])["off"], 60, 40) },
    dataSourcesReport: scrubKeys(str(data["dataSourcesReport"], 20000)),
  };
}

// ------------------------------------------------------------------------------------------------ estado del equipo

export type Machine = { os: string; node: string; memoryGb: number; cpu: string; gpu: string; ollama: { version: string; models: Array<{ name: string; sizeGb: number }>; loaded: string[]; error: string } };
export type Deps = {
  fetchImpl?: typeof fetch;
  run?: (command: string, args: string[]) => Promise<string>;
  home?: string;
};

async function runCommand(command: string, args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  return await new Promise<string>((resolve) => {
    try {
      execFile(command, args, { timeout: 4000, windowsHide: true }, (error, stdout) => resolve(error ? "" : String(stdout).trim()));
    } catch {
      resolve("");
    }
  });
}

export async function readMachine(deps: Deps = {}): Promise<Machine> {
  const os = await import("node:os");
  const fetcher = deps.fetchImpl ?? fetch;
  const run = deps.run ?? runCommand;
  const get = async (route: string): Promise<unknown> => {
    const res = await fetcher(`http://127.0.0.1:11434${route}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    return res.json();
  };
  const ollama: Machine["ollama"] = { version: "", models: [], loaded: [], error: "" };
  try {
    ollama.version = String((await get("/api/version") as { version?: string }).version ?? "");
    const tags = (await get("/api/tags")) as { models?: Array<{ name?: string; size?: number }> };
    ollama.models = (tags.models ?? []).map((m) => ({ name: String(m.name ?? ""), sizeGb: Math.round(((m.size ?? 0) / 1e9) * 10) / 10 })).filter((m) => m.name);
    try {
      const ps = (await get("/api/ps")) as { models?: Array<{ name?: string; size?: number; size_vram?: number }> };
      ollama.loaded = (ps.models ?? []).map((m) => `${m.name} (${Math.round(((m.size ?? 0) / 1e9) * 10) / 10} GB, ${m.size ? Math.round(((m.size_vram ?? 0) / m.size) * 100) : 0} % en la tarjeta gráfica)`);
    } catch {
      /* /api/ps no existe en versiones antiguas */
    }
  } catch (error) {
    ollama.error = error instanceof Error ? error.message : String(error);
  }
  const gpu = (await run("nvidia-smi", ["--query-gpu=name,memory.total,memory.used", "--format=csv,noheader"])).split("\n")[0] ?? "";
  return { os: `${os.platform()} ${os.release()}`, node: process.version, memoryGb: Math.round((os.totalmem() / 1e9) * 10) / 10, cpu: os.cpus()[0]?.model ?? "", gpu, ollama };
}

/** El registro del actualizador (deja uno en el Escritorio). Solo las últimas líneas de cada uno. */
export async function readUpdaterLogs(deps: Deps = {}): Promise<string> {
  const { fs, path } = await nodes();
  const os = await import("node:os");
  const home = deps.home ?? os.homedir();
  const folders = [path.join(home, "Desktop"), path.join(home, "OneDrive", "Desktop"), path.join(home, "Escritorio"), path.join(home, "OneDrive", "Escritorio"), os.tmpdir()];
  const out: string[] = [];
  for (const name of ["WillyAI-actualizacion-log.txt", "WillyAI-actualizacion-log-anterior.txt"]) {
    for (const folder of folders) {
      try {
        const text = await fs.readFile(path.join(folder, name), "utf8");
        out.push(`===== ${name} (últimas líneas) =====\n${text.trimEnd().split("\n").slice(-120).join("\n")}\n`);
        break;
      } catch {
        /* no está aquí */
      }
    }
  }
  return out.join("\n") || "No se encontró ningún registro del actualizador (se guarda en el Escritorio al actualizar).\n";
}

export type Backup = { name: string; createdAt: string; reason: string; files: string[]; evidence: string };

/** Cada mejora aplicada por la Autoconstrucción deja una copia con su manifiesto (y su informe de evidencias). */
export async function readBackups(root: string): Promise<Backup[]> {
  const { fs, path } = await nodes();
  const base = path.join(root, "copias-autoconstruccion");
  let names: string[] = [];
  try {
    names = (await fs.readdir(base, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
  const out: Backup[] = [];
  for (const name of names.slice(-20)) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(base, name, "manifest.json"), "utf8")) as { createdAt?: string; reason?: string; files?: string[] };
      let evidence = "";
      try {
        evidence = (await fs.readFile(path.join(base, name, "evidencia", "informe.md"), "utf8")).slice(0, 6000);
      } catch {
        /* sin informe (versiones anteriores a las evidencias) */
      }
      out.push({ name, createdAt: String(manifest.createdAt ?? ""), reason: String(manifest.reason ?? "").slice(0, 500), files: (manifest.files ?? []).slice(0, 60).map(String), evidence });
    } catch {
      out.push({ name, createdAt: "", reason: "", files: [], evidence: "" });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ diario en disco

export type JournalEntry = { at: string; request: string; files: string[]; backup: string; evidence: string };

/** Cada mejora aplicada con éxito se anota en `mejoras-de-la-web.md`, para que se conserve aunque el navegador borre sus datos. */
export async function appendJournal(root: string, entry: JournalEntry): Promise<void> {
  const { fs, path } = await nodes();
  const target = path.join(root, JOURNAL_FILE);
  let existing = "";
  try {
    existing = await fs.readFile(target, "utf8");
  } catch {
    existing = "# Mejoras hechas con la propia web (Autoconstrucción)\n\nLo anota WILLY AI solo, cada vez que aplica una mejora. Se incluye en el paquete de «Continuar el desarrollo».\n";
  }
  const clean = (text: string, max: number) => text.replace(/\r?\n/g, " ").trim().slice(0, max);
  const block = [`\n## ${entry.at}`, `- **Petición:** ${clean(entry.request, 1500)}`, `- **Archivos:** ${entry.files.length ? entry.files.map((f) => `\`${clean(f, 200)}\``).join(", ") : "(ninguno)"}`, `- **Copia de seguridad:** ${clean(entry.backup, 200)}`, entry.evidence ? `- **Evidencias:** ${clean(entry.evidence, 400)}` : ""].filter(Boolean).join("\n");
  const next = `${existing.trimEnd()}\n${block}\n`;
  const trimmed = next.length > 200_000 ? `${next.slice(0, 300)}\n\n[…entradas antiguas recortadas…]\n${next.slice(-150_000)}` : next;
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, trimmed, "utf8");
  await fs.rename(temporary, target);
}

// ------------------------------------------------------------------------------------------------ informe y paquete

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(2)} MB`;
const bullets = (items: string[], empty = "ninguno"): string => (items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`);

export type Built = { zip: Buffer; name: string; summary: Preview };
export type Preview = { version: string; sourceVersion: string; files: number; bytes: number; hasRelease: boolean; releaseVersion: string; modified: number; added: number; removed: number; improvements: number; backups: number; skipped: number };

export async function buildStatePackage(root: string, rawClient: unknown, deps: Deps = {}, now = new Date()): Promise<Built> {
  const client = sanitizeClientState(rawClient);
  const { files, skipped } = await collectProject(root);
  const release = await readRelease(files);
  const diff = compareToRelease(await hashes(files), release);
  const source = sourceVersion(files);
  const machine = await readMachine(deps);
  const backups = await readBackups(root);
  const logs = await readUpdaterLogs(deps);
  const bytes = files.reduce((sum, file) => sum + file.data.length, 0);
  const stamp = now.toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const versionText = source ? `${source.version}${source.revision ? ` revisión ${source.revision}` : ""}` : client.version || "desconocida";
  const summary: Preview = {
    version: client.version ? `${client.version}${client.revision ? `+${client.revision}` : ""}` : "",
    sourceVersion: source ? `${source.version}${source.revision ? `+${source.revision}` : ""}` : "",
    files: files.length,
    bytes,
    hasRelease: !!release,
    releaseVersion: release?.version ?? "",
    modified: diff?.modified.length ?? 0,
    added: diff?.added.length ?? 0,
    removed: diff?.removed.length ?? 0,
    improvements: client.improvements.length,
    backups: backups.length,
    skipped: skipped.length,
  };
  const done = client.improvements.filter((i) => i.status === "implementada");
  const state = [
    `# Estado de WILLY AI — ${now.toLocaleString("es-ES")}`,
    "",
    "> Paquete de «Continuar el desarrollo». Lee este archivo primero: resume dónde está la plataforma. El código completo está en `codigo/`.",
    "",
    "## Versión",
    `- Código instalado (src/lib/version.ts): **${versionText}**`,
    `- Programa en marcha: ${client.version ? `${client.version}${client.revision ? ` revisión ${client.revision}` : ""}` : "(no informado)"}${source && client.version && (source.version !== client.version || source.revision !== client.revision) ? "  ⚠️ **distinta del código**: puede que se haya cambiado código y no se haya compilado/reiniciado" : ""}`,
    `- Referencia oficial (\`${RELEASE_FILE}\`): ${release ? `versión ${release.version}` : "NO hay (instalación anterior a esta función): no se puede saber qué se ha modificado; lo importante es el código completo"}`,
    "",
    "## Qué ha cambiado desde la versión oficial (por la Autoconstrucción o a mano)",
    diff ? [`**Modificados (${diff.modified.length}):**`, bullets(diff.modified), "", `**Añadidos (${diff.added.length}):**`, bullets(diff.added), "", `**Que faltan respecto a la oficial (${diff.removed.length}):**`, bullets(diff.removed)].join("\n") : "(sin referencia oficial)",
    "",
    "## Mejoras hechas con la propia web",
    `- Registradas en el navegador: ${client.improvements.length} (${done.length} implementadas)`,
    `- Copias de seguridad en disco: ${backups.length}`,
    "",
    done.length ? done.slice(0, 40).map((i, n) => [`### ${n + 1}. ${i.request.replace(/\s+/g, " ").slice(0, 200)}`, `- Estado: ${i.status}${i.engine ? ` · motor: ${i.engine}` : ""}${i.createdAt ? ` · ${i.createdAt}` : ""}`, i.files.length ? `- Archivos: ${i.files.join(", ")}` : "", i.evidence ? `- Evidencias: ${i.evidence.summary || `${i.evidence.items.length} comprobaciones`}` : "", i.result ? `- Resultado: ${i.result.replace(/\s+/g, " ").slice(0, 300)}` : ""].filter(Boolean).join("\n")).join("\n\n") : "(ninguna implementada todavía)",
    "",
    client.improvements.some((i) => i.status !== "implementada") ? `### No implementadas / pendientes\n${bullets(client.improvements.filter((i) => i.status !== "implementada").map((i) => `${i.request.replace(/\s+/g, " ").slice(0, 160)} — ${i.status}${i.result ? `: ${i.result.replace(/\s+/g, " ").slice(0, 160)}` : ""}`))}\n` : "",
    "## Instrucciones permanentes del propietario para WILLY",
    client.instructions ? client.instructions : "(las de fábrica)",
    "",
    "## Equipo",
    `- Sistema: ${machine.os} · Node ${machine.node} · ${machine.memoryGb} GB de memoria · ${machine.cpu}`,
    `- Tarjeta gráfica: ${machine.gpu || "(no detectada)"}`,
    `- Ollama: ${machine.ollama.version ? `versión ${machine.ollama.version}` : `no responde (${machine.ollama.error})`}`,
    `- Modelos instalados: ${machine.ollama.models.length ? machine.ollama.models.map((m) => `${m.name} (${m.sizeGb} GB)`).join(", ") : "(ninguno o no se pudo leer)"}`,
    machine.ollama.loaded.length ? `- Cargados ahora: ${machine.ollama.loaded.join("; ")}` : "",
    `- Modelo elegido en WILLY: ${client.settings.model || "(no informado)"}`,
    client.brokenModels.length ? `- ⚠️ Modelos que NO cargan en este equipo: ${client.brokenModels.map((m) => `${m.model} (${m.kind})`).join(", ")}` : "",
    client.userAgent ? `- Navegador: ${client.userAgent}` : "",
    "",
    client.engineReport ? `## Última comprobación del equipo («Comprobar ahora» en Centro de Inteligencia → Modelos)\n${client.engineReport}\n` : "",
    client.dataSourcesReport ? `## Fuentes de datos en tiempo real (última prueba en este equipo)\n${client.dataSources.enabled ? "Activadas en el chat." : "APAGADAS en el chat."}${client.dataSources.off.length ? ` Desactivadas: ${client.dataSources.off.join(", ")}.` : ""}\n${client.dataSourcesReport}\n` : "",
    "## Lo que quiero en la siguiente fase (escrito por el propietario)",
    client.notes.trim() || "(no escribió nada: pregúntale)",
    "",
    "## Contenido del paquete",
    `- \`codigo/\`: ${files.length} archivos (${mb(bytes)}) tal como están instalados. ${skipped.length ? `No se incluyeron ${skipped.length}: ${skipped.slice(0, 6).join("; ")}` : ""}`,
    "- NO incluye: conversaciones, proyectos, claves ni contraseñas (tampoco las de los motores en la nube), ni el programa compilado.",
  ].filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n");
  const readme = [
    "# WILLY AI — paquete para continuar el desarrollo",
    "",
    "Súbelo tal cual a la conversación con Claude (un único archivo .zip) y escribe qué quieres hacer.",
    "",
    "Para quien lo lea (Claude): empieza por **ESTADO.md** (resumen), luego **cambios-desde-la-version.txt** y **mejoras-de-la-web.md** (qué se ha tocado desde la web), **copias-autoconstruccion/versiones.json** y **diario-operaciones.jsonl** (versiones locales de la Autoconstrucción y cada operación paso a paso), **registro-actualizador.txt** si hubo problemas al actualizar, y trabaja sobre **codigo/**. Parte SIEMPRE de este código y no de una versión anterior: puede contener mejoras hechas por la propia Autoconstrucción que no están en ninguna versión oficial.",
    "",
    "Al entregar una actualización: comprueba con el generador verificado que el lanzador del .bat es el de referencia, y prueba el actualizador desde lo extraído del propio .bat.",
  ].join("\n");
  const entries: ZipEntry[] = [
    { name: "LEEME_PARA_CONTINUAR.md", data: Buffer.from(readme, "utf8") },
    { name: "ESTADO.md", data: Buffer.from(state, "utf8") },
    { name: "estado.json", data: Buffer.from(JSON.stringify({ generatedAt: now.toISOString(), summary, machine, client: { ...client, engineReport: undefined }, diff, release: release ? { version: release.version } : null, backups: backups.map((b) => ({ name: b.name, createdAt: b.createdAt, reason: b.reason, files: b.files })), skipped }, null, 2), "utf8") },
    { name: "cambios-desde-la-version.txt", data: Buffer.from(diff ? [`Referencia: versión ${release?.version}`, "", `MODIFICADOS (${diff.modified.length})`, ...diff.modified, "", `AÑADIDOS (${diff.added.length})`, ...diff.added, "", `QUE FALTAN (${diff.removed.length})`, ...diff.removed, ""].join("\n") : "Sin referencia oficial: no se puede calcular.\n", "utf8") },
    { name: "mejoras-autoconstruccion.json", data: Buffer.from(JSON.stringify({ improvements: client.improvements, lessons: client.lessons, instructions: client.instructions }, null, 2), "utf8") },
    { name: "registro-actualizador.txt", data: Buffer.from(logs, "utf8") },
  ];
  if (client.notes.trim()) entries.push({ name: "SIGUIENTE_FASE.md", data: Buffer.from(`# Lo que quiero en la siguiente fase\n\n${client.notes.trim()}\n`, "utf8") });
  if (client.engineReport) entries.push({ name: "informe-equipo.md", data: Buffer.from(client.engineReport, "utf8") });
  for (const backup of backups) entries.push({ name: `copias-autoconstruccion/${backup.name}/manifiesto.json`, data: Buffer.from(JSON.stringify({ createdAt: backup.createdAt, reason: backup.reason, files: backup.files }, null, 2), "utf8") }, ...(backup.evidence ? [{ name: `copias-autoconstruccion/${backup.name}/evidencias.md`, data: Buffer.from(backup.evidence, "utf8") }] : []));
  // Registro de versiones y diario de operaciones de la Autoconstrucción: qué se instaló, qué falló, qué se recuperó y qué
  // se volvió atrás (sin conversaciones ni claves: solo objetivos, pasos y archivos).
  {
    const { fs, path } = await nodes();
    for (const [file, name, tail] of [["versiones.json", "copias-autoconstruccion/versiones.json", 0], ["diario-operaciones.jsonl", "copias-autoconstruccion/diario-operaciones.jsonl", 400]] as const) {
      try {
        const text = await fs.readFile(path.join(root, "copias-autoconstruccion", file), "utf8");
        entries.push({ name, data: Buffer.from(tail ? text.split("\n").slice(-tail).join("\n") : text, "utf8") });
      } catch {
        /* todavía no hay ninguna operación registrada */
      }
    }
  }
  for (const file of files) entries.push({ name: `codigo/${file.path}`, data: file.data });
  return { zip: await buildZip(entries, now), name: `WillyAI-estado-${source ? `${source.version}${source.revision ? `-rev${source.revision}` : ""}` : client.version || "sin-version"}-${stamp}.zip`, summary };
}

/** Sin descargar nada: lo que se incluiría. */
export async function previewStatePackage(root: string): Promise<Preview> {
  const { files, skipped } = await collectProject(root);
  const release = await readRelease(files);
  const diff = compareToRelease(await hashes(files), release);
  const source = sourceVersion(files);
  const backups = await readBackups(root);
  return { version: "", sourceVersion: source ? `${source.version}${source.revision ? `+${source.revision}` : ""}` : "", files: files.length, bytes: files.reduce((sum, file) => sum + file.data.length, 0), hasRelease: !!release, releaseVersion: release?.version ?? "", modified: diff?.modified.length ?? 0, added: diff?.added.length ?? 0, removed: diff?.removed.length ?? 0, improvements: 0, backups: backups.length, skipped: skipped.length };
}

/** La «huella» de una versión oficial: se genera al empaquetar una versión y se guarda en `willy-release.json`. */
export async function releaseManifest(root: string, version: string): Promise<Release> {
  const { files } = await collectProject(root);
  return { version, files: await hashes(files.filter((file) => file.path !== RELEASE_FILE && file.path !== JOURNAL_FILE)) };
}
