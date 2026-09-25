// Plan B para leer los subtítulos de YouTube: yt-dlp, programa libre y gratuito (el más usado del mundo para
// esto, y se actualiza en días cada vez que YouTube cambia algo). Solo se usa si las vías integradas fallan.
//
// Seguridad: se descarga SOLO desde su página oficial de GitHub (dirección fija, nunca una que venga de la
// pantalla), se comprueba su huella SHA-256 con la lista oficial de esa misma versión antes de usarlo, se
// guarda en datos-privados/herramientas y se ejecuta sin intérprete de comandos, solo con argumentos, para
// pedir ÚNICAMENTE los subtítulos (nunca descarga el vídeo). Se renueva solo cada 14 días.

import { parseCaptions, type Segment } from "@/lib/youtube-captions";

export const YTDLP_EXE_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
export const YTDLP_SUMS_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";

export type YtDlpDeps = {
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof import("node:child_process").spawn;
  platform?: string;
  now?: () => number;
  /** Días que se usa la misma copia antes de pedir la versión nueva. */
  maxAgeDays?: number;
  /** Tiempo máximo de la consulta de subtítulos. */
  timeoutMs?: number;
  /** Motor de JavaScript que yt-dlp puede usar con YouTube: el propio Node de WILLY. */
  nodePath?: string;
  /** Límites de tamaño de la descarga (bytes). */
  minBytes?: number;
  maxBytes?: number;
  log?: (line: string) => void;
};

type Meta = { sha256: string; downloadedAt: number };

async function mods() {
  return {
    fs: await import("node:fs/promises"),
    path: await import("node:path"),
    os: await import("node:os"),
    crypto: await import("node:crypto"),
  };
}

export async function ytDlpFiles(dataDir: string): Promise<{ dir: string; exe: string; meta: string }> {
  const { path } = await mods();
  const dir = path.join(dataDir, "herramientas");
  return { dir, exe: path.join(dir, "yt-dlp.exe"), meta: path.join(dir, "yt-dlp.json") };
}

/** Huella oficial de yt-dlp.exe dentro de la lista SHA2-256SUMS de GitHub. */
export function expectedHash(sums: string): string | null {
  return /^([a-f0-9]{64})\s+\*?yt-dlp\.exe\s*$/im.exec(sums)?.[1]?.toLowerCase() ?? null;
}

async function readMeta(file: string): Promise<Meta | null> {
  const { fs } = await mods();
  try {
    const meta = JSON.parse(await fs.readFile(file, "utf8")) as Meta;
    return typeof meta.sha256 === "string" && typeof meta.downloadedAt === "number" ? meta : null;
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  const { fs } = await mods();
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function download(dataDir: string, deps: YtDlpDeps): Promise<void> {
  const { fs, crypto } = await mods();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const files = await ytDlpFiles(dataDir);
  await fs.mkdir(files.dir, { recursive: true });

  const sumsRes = await fetchImpl(YTDLP_SUMS_URL, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!sumsRes.ok) throw new Error(`GitHub respondió ${sumsRes.status} al pedir la lista oficial de huellas.`);
  const hash = expectedHash(await sumsRes.text());
  if (!hash) throw new Error("La lista oficial de huellas de yt-dlp no trae la de yt-dlp.exe.");

  const res = await fetchImpl(YTDLP_EXE_URL, { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`GitHub respondió ${res.status} al descargar yt-dlp.`);
  const max = deps.maxBytes ?? 80 * 2 ** 20;
  const min = deps.minBytes ?? 5 * 2 ** 20;
  const total = Number(res.headers.get("content-length")) || 0;
  if (total > max) throw new Error("yt-dlp.exe es más grande de lo esperado; no lo descargo.");

  const part = `${files.exe}.part`;
  const handle = await fs.open(part, "w");
  const sha = crypto.createHash("sha256");
  let got = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (got > max) throw new Error("yt-dlp.exe es más grande de lo esperado; no lo descargo.");
      sha.update(value);
      await handle.write(value);
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(part, { force: true }).catch(() => undefined);
    throw error instanceof Error ? error : new Error(String(error));
  }
  await handle.close();
  const digest = sha.digest("hex");
  if (got < min || digest !== hash) {
    await fs.rm(part, { force: true }).catch(() => undefined);
    throw new Error(got < min ? "La descarga de yt-dlp llegó incompleta." : "La huella de yt-dlp.exe no coincide con la oficial: no lo uso.");
  }
  await fs.rm(files.exe, { force: true }).catch(() => undefined);
  await fs.rename(part, files.exe);
  const meta: Meta = { sha256: digest, downloadedAt: (deps.now ?? Date.now)() };
  await fs.writeFile(files.meta, JSON.stringify(meta, null, 2));
}

let pending: Promise<void> | null = null;
// Si renovar falla (sin internet, GitHub caído…), no se reintenta en cada vídeo: se espera una hora.
let lastFailAt = Number.NEGATIVE_INFINITY;
export const resetYtDlpState = (): void => { pending = null; lastFailAt = Number.NEGATIVE_INFINITY; };

/** Deja yt-dlp listo (lo descarga o lo renueva si hace falta). Si la renovación falla pero hay una copia comprobada, se usa esa. */
export async function ensureYtDlp(dataDir: string, deps: YtDlpDeps = {}): Promise<{ ok: true; exe: string } | { ok: false; error: string }> {
  if ((deps.platform ?? process.platform) !== "win32") return { ok: false, error: "yt-dlp automático solo está preparado para Windows." };
  const now = (deps.now ?? Date.now)();
  const files = await ytDlpFiles(dataDir);
  const meta = await readMeta(files.meta);
  const have = meta !== null && (await exists(files.exe));
  const fresh = have && now - meta!.downloadedAt < (deps.maxAgeDays ?? 14) * 86_400_000;
  if (fresh || (have && now - lastFailAt < 3_600_000)) return { ok: true, exe: files.exe };
  try {
    deps.log?.(have ? "Renovando yt-dlp (versión nueva)…" : "Descargando yt-dlp desde su página oficial (solo la primera vez)…");
    pending ??= download(dataDir, deps).finally(() => { pending = null; });
    await pending;
    return { ok: true, exe: files.exe };
  } catch (error) {
    lastFailAt = now;
    if (have) return { ok: true, exe: files.exe };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Argumentos para pedir solo los subtítulos (español, inglés o el idioma original), nunca el vídeo. */
export function ytDlpArgs(videoId: string, outBase: string, nodePath: string | null): string[] {
  return [
    "--ignore-config",
    "--no-playlist",
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs", "es,es-.*,en,en-.*,.*-orig",
    "--sub-format", "json3/vtt/best",
    "--no-progress",
    "--no-color",
    "--socket-timeout", "20",
    "--retries", "2",
    ...(nodePath ? ["--js-runtimes", `node:${nodePath}`] : []),
    "-o", `${outBase}.%(ext)s`,
    "--",
    videoId,
  ];
}

/** De los archivos que deja yt-dlp («sub.es.json3», «sub.en-orig.vtt»…), el mejor: español, luego inglés, luego el original. */
export function pickSubtitleFile(names: string[]): { name: string; lang: string } | null {
  const subs = names
    .map((name) => ({ name, m: /^sub\.([\w-]+)\.(json3|vtt|srv3|srv1|ttml|srt)$/i.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .map(({ name, m }) => ({ name, lang: m[1]!, ext: m[2]!.toLowerCase() }));
  const score = (x: { lang: string; ext: string }) => {
    const l = x.lang.toLowerCase();
    const base = l === "es" || l.startsWith("es-") && !l.endsWith("-orig") ? 0 : l === "en" || l.startsWith("en-") && !l.endsWith("-orig") ? 2 : l.endsWith("-orig") ? 4 : 6;
    return base + (x.ext === "json3" ? 0 : 1);
  };
  const best = subs.sort((a, b) => score(a) - score(b))[0];
  return best ? { name: best.name, lang: best.lang.replace(/-orig$/i, "") } : null;
}

function run(exe: string, args: string[], deps: YtDlpDeps): Promise<{ code: number | null; stderr: string }> {
  return (async () => {
    const spawn = deps.spawnImpl ?? (await import("node:child_process")).spawn;
    return new Promise<{ code: number | null; stderr: string }>((resolve) => {
      let stderr = "";
      let settled = false;
      const finish = (code: number | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code, stderr }); } };
      const child = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      const timer = setTimeout(() => { try { child.kill(); } catch { /* ya terminó */ } stderr += "\nTardó demasiado."; finish(null); }, deps.timeoutMs ?? 90_000);
      child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-3000); });
      child.on("error", (error: Error) => { stderr += `\n${error.message}`; finish(null); });
      child.on("close", (code: number | null) => finish(code));
    });
  })();
}

/** Subtítulos con yt-dlp. Devuelve null si tampoco así se consiguen (el motivo queda en `log`). */
export async function ytDlpCaptions(videoId: string, dataDir: string, deps: YtDlpDeps = {}): Promise<{ segments: Segment[]; lang: string } | null> {
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  const ready = await ensureYtDlp(dataDir, deps);
  if (!ready.ok) { deps.log?.(`yt-dlp no disponible: ${ready.error}`); return null; }
  const { fs, path, os } = await mods();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "willy-ytdlp-"));
  try {
    const base = path.join(tmp, "sub");
    const nodePath = deps.nodePath ?? process.execPath;
    let result = await run(ready.exe, ytDlpArgs(videoId, base, nodePath), deps);
    // Versiones antiguas no conocen --js-runtimes: se repite sin esa opción.
    if (result.code !== 0 && /js-runtimes|no such option/i.test(result.stderr)) result = await run(ready.exe, ytDlpArgs(videoId, base, null), deps);
    const chosen = pickSubtitleFile(await fs.readdir(tmp).catch(() => []));
    if (!chosen) {
      deps.log?.(`yt-dlp no trajo subtítulos (código ${result.code ?? "sin terminar"}): ${result.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
      return null;
    }
    const segments = parseCaptions(await fs.readFile(path.join(tmp, chosen.name), "utf8"));
    return segments.length ? { segments, lang: chosen.lang } : null;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
