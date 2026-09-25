// Chatterbox Multilingual (Resemble AI): voz LOCAL y gratis, la más expresiva de las locales. Copia el timbre, la entonación y
// el acento de una voz de REFERENCIA de unos 10–15 s. Para que hable con acento de España se le da una referencia en castellano:
// por defecto una frase leída por Kokoro (Dora o Alex, con fonética de España) o, si quieres, tu propia voz.
// Pesa mucho (PyTorch + modelo ≈ 8,5 GB en disco) y va bien con una tarjeta NVIDIA; con el procesador funciona, pero lento.
// Se instala aparte, con su propio Python (uv), en datos-privados/voces-motores/chatterbox, sin tocar nada más.
// Descargas FIJAS: PyTorch desde download.pytorch.org, paquetes desde PyPI (con uv) y el modelo desde Hugging Face (ResembleAI/chatterbox).
// Con 6 GB en la gráfica no caben a la vez Chatterbox y los modelos de ComfyUI u Ollama: antes de cargarlo se les pide que la suelten.

import { exists, extraSpeak, lastLines, pathsFor, runCmd, speakInParts, splitForTts, uvEnv, type ExtraCtx, type Progress, type Spawn } from "@/lib/voces-extra";

export const CB_PKG = "chatterbox-tts==0.1.7";
const TORCH = ["torch==2.6.0", "torchaudio==2.6.0"];
/** Las mismas versiones, con CUDA 12.4 (para volver a ponerlas si al instalar Chatterbox se cambiaran por las del procesador). */
const TORCH_CUDA = ["torch==2.6.0+cu124", "torchaudio==2.6.0+cu124"];
const TORCH_INDEX = { cuda: "https://download.pytorch.org/whl/cu124", cpu: "https://download.pytorch.org/whl/cpu" };
/** Lo que ocupa PyTorch ya instalado (lo que se va descargando y descomprimiendo), para la barra de progreso. */
const TORCH_BYTES = { cuda: 4.4e9, cpu: 0.9e9 };
const HF_REPO = "ResembleAI/chatterbox";
const HF_FILES = ["ve.pt", "t3_mtl23ls_v2.safetensors", "s3gen.pt", "grapheme_mtl_merged_expanded_v1.json", "conds.pt", "Cangjie5_TC.json"];
/** Espacio aproximado en disco (PyTorch con CUDA + paquetes + modelo) y lo que se descarga. */
export const CB_GB = 8.5;
export const CB_DOWNLOAD_GB = 6;
/** Espacio libre que hace falta en el disco para instalarlo (descargas + instalado + margen). */
const MIN_FREE_BYTES = 12e9;
/** Memoria de la gráfica que necesita Chatterbox para hablar (modelo ≈ 3,2 GB + trabajo). */
export const CB_VRAM_MB = 4500;
/** Paquetes grandes que se borran también de la caché de uv al desinstalar Chatterbox (Kokoro no los usa). */
const CACHE_HEAVY = ["torch", "torchaudio", "transformers", "gradio", "scipy", "numba", "llvmlite", "pandas", "onnx", "diffusers"];
const REF_TEXT = "Hola, ¿qué tal? Hoy hace un día estupendo en Madrid. He quedado con unos amigos para dar un paseo por el Retiro y, después, tomaremos algo en una terraza de la plaza. ¿Te apetece venir con nosotros?";
const REFS: Array<{ id: "dora" | "alex"; kokoro: string }> = [{ id: "dora", kokoro: "kokoro:ef_dora" }, { id: "alex", kokoro: "kokoro:em_alex" }];
/** El motor de IA de WILLY (Ollama), en este mismo equipo. */
const OLLAMA_URL = "http://127.0.0.1:11434";
const OLLAMA_MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,160}$/;
/** nvidia-smi suele estar en el PATH; si no, en estas carpetas de Windows. */
const NVIDIA_SMI = ["nvidia-smi", "C:\\Windows\\System32\\nvidia-smi.exe", "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"];

export type CbCfg = { exaggeration: number; cfgWeight: number; temperature: number };
const CB_DEFAULTS: CbCfg = { exaggeration: 0.5, cfgWeight: 0.5, temperature: 0.8 };
/** cuda = solo la gráfica (si no puede, lo dice); auto = la gráfica y, si no puede, el procesador (para la prueba de instalación). */
type Device = "cuda" | "cpu" | "auto";
/** Lo que quedó al instalar: con qué habla, qué gráfica hay, la velocidad medida y, si la gráfica no pudo, por qué. */
type CbMarker = { device: "cuda" | "cpu"; gpu: string; note: string; gpuError: string; at: string };
type CbDeps = { platform: string; spawnImpl?: Spawn | undefined; fetchImpl?: typeof fetch | undefined };

const num = (value: unknown, base: number, min: number, max: number): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : base;
};
const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const gbText = (bytes: number) => (bytes / 1e9).toFixed(1).replace(".", ",");
const dec = (n: number) => n.toFixed(1).replace(".", ",");
const errText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function mods() {
  return { fs: await import("node:fs/promises"), path: await import("node:path"), os: await import("node:os") };
}
export type CbPaths = { root: string; uvExe: string; uvReady: () => Promise<boolean>; env: () => Promise<Record<string, string>>; cdir: string; venv: string; python: string; hf: string; pkuseg: string; refs: string; savedRefs: string; server: string; marker: string; cfg: string };
/** Rutas de Chatterbox (su Python con PyTorch y transformers lo reutiliza también la transcripción, lib/transcribir.ts). */
export async function cbPaths(dir: string, platform: string): Promise<CbPaths> {
  const { path } = await mods();
  const base = await pathsFor(dir, platform);
  const win = platform === "win32";
  const cdir = path.join(base.root, "chatterbox");
  return {
    root: base.root,
    uvExe: base.uvExe,
    uvReady: () => exists(base.uvExe),
    env: () => uvEnv(base),
    cdir,
    venv: path.join(cdir, "venv"),
    python: path.join(cdir, "venv", win ? "Scripts" : "bin", win ? "python.exe" : "python"),
    hf: path.join(cdir, "hf"),
    pkuseg: path.join(cdir, "pkuseg"),
    refs: path.join(cdir, "referencias"),
    // Copia de las voces de referencia fuera de la carpeta de Chatterbox: así se puede reinstalar aunque ya no esté Kokoro.
    savedRefs: path.join(base.root, "referencias-espana"),
    server: path.join(cdir, "willy_chatterbox_srv.py"),
    marker: path.join(cdir, "listo.json"),
    cfg: path.join(cdir, "ajustes.json"),
  };
}

async function loadCfg(p: CbPaths): Promise<CbCfg> {
  const { fs } = await mods();
  try {
    const d = rec(JSON.parse(await fs.readFile(p.cfg, "utf8")));
    return { exaggeration: num(d["exaggeration"], CB_DEFAULTS.exaggeration, 0.25, 1.5), cfgWeight: num(d["cfgWeight"], CB_DEFAULTS.cfgWeight, 0.2, 0.9), temperature: num(d["temperature"], CB_DEFAULTS.temperature, 0.5, 1.2) };
  } catch {
    return { ...CB_DEFAULTS };
  }
}
async function loadMarker(p: CbPaths): Promise<CbMarker | null> {
  const { fs } = await mods();
  try {
    const d = rec(JSON.parse(await fs.readFile(p.marker, "utf8")));
    return { device: d["device"] === "cuda" ? "cuda" : "cpu", gpu: String(d["gpu"] ?? "").slice(0, 80), note: String(d["note"] ?? "").slice(0, 240), gpuError: String(d["gpuError"] ?? "").slice(0, 240), at: String(d["at"] ?? "") };
  } catch {
    return null;
  }
}
async function saveMarker(p: CbPaths, marker: CbMarker): Promise<void> {
  const { fs } = await mods();
  await fs.writeFile(p.marker, JSON.stringify({ ...marker, note: marker.note.slice(0, 240), gpuError: marker.gpuError.slice(0, 240) }, null, 2), "utf8");
}
async function ownRef(p: CbPaths): Promise<string> {
  const { fs, path } = await mods();
  const names = await fs.readdir(p.refs).catch(() => [] as string[]);
  const own = names.find((n) => /^propia\.(wav|flac|mp3|ogg)$/i.test(n));
  return own ? path.join(p.refs, own) : "";
}
/** Duración de un .wav (cabecera estándar de 44 bytes, como los que escribe el guion). */
function wavSeconds(bytes: Uint8Array): number {
  if (bytes.length < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const perSecond = view.getUint32(28, true);
  return perSecond ? Math.max(0, bytes.length - 44) / perSecond : 0;
}

// ------------------------------------------------------------------------------------------------ Chatterbox «en marcha»
export const CB_SERVER_SCRIPT = `# WILLY AI · Chatterbox Multilingual en marcha. Argumento: cuda (solo la gráfica), cpu, o auto (la gráfica y, si no puede, el procesador).
# Entrada: una petición JSON por línea. Salida: una respuesta JSON por línea.
import json, sys, wave
def why(e):
    # Los errores de Windows llegan en su idioma y Python no siempre sabe leerlos: se recupera el texto original.
    raw = getattr(e, "object", None)
    if isinstance(e, UnicodeDecodeError) and isinstance(raw, (bytes, bytearray)):
        msg = bytes(raw).decode("cp1252", "replace")
    else:
        msg = "%s: %s" % (type(e).__name__, e)
    msg = " ".join(msg.split())
    if "out of memory" in msg.lower():
        msg = "La tarjeta gráfica no tiene memoria libre para Chatterbox (¿está ComfyUI haciendo un vídeo o el modelo de Ollama ocupándola?). " + msg
    return msg if len(msg) <= 290 else msg[:140] + " | " + msg[-140:]
def skip_chinese():
    # WILLY solo lee en español: no se carga el separador de palabras del chino (pkuseg), que además se descarga de internet la primera vez.
    try:
        import chatterbox.models.tokenizers.tokenizer as tok
    except Exception:
        return
    class Skip:
        def __init__(self, *args, **kwargs):
            pass
        def __call__(self, text):
            return text
    if hasattr(tok, "ChineseCangjieConverter"):
        tok.ChineseCangjieConverter = Skip
def main():
    import numpy as np
    import torch
    skip_chinese()
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    want = sys.argv[1] if len(sys.argv) > 1 else "auto"
    if want == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("PyTorch no ve la tarjeta gráfica NVIDIA (¿está actualizado el controlador de NVIDIA?).")
    device = "cuda" if want in ("cuda", "auto") and torch.cuda.is_available() else "cpu"
    cuda_error = "" if device == "cuda" or want != "auto" else "PyTorch no ve la tarjeta gráfica NVIDIA."
    try:
        model = ChatterboxMultilingualTTS.from_pretrained(device)
    except Exception as e:
        if want != "auto" or device != "cuda":
            raise
        cuda_error = why(e)
        device = "cpu"
        torch.cuda.empty_cache()
        model = ChatterboxMultilingualTTS.from_pretrained(device)
    sys.stdout.write(json.dumps({"ready": True, "device": device, "cudaError": cuda_error}) + "\\n"); sys.stdout.flush()
    ref_now = None
    while True:
        raw = sys.stdin.buffer.readline()
        if not raw:
            break
        line = raw.decode("utf-8").strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line); rid = req.get("id")
            exag = float(req.get("exaggeration", 0.5))
            ref = req.get("ref") or None
            if ref and ref != ref_now:
                model.prepare_conditionals(ref, exaggeration=exag)
                ref_now = ref
            wav = model.generate(req["text"], language_id="es", exaggeration=exag, cfg_weight=float(req.get("cfg_weight", 0.5)), temperature=float(req.get("temperature", 0.8)))
            samples = wav.squeeze(0).detach().cpu().numpy().astype("float32")
            peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
            rms = float(np.sqrt(np.mean(samples ** 2))) if len(samples) else 0.0
            if peak > 0 and rms > 0: samples = samples * min(4.0, 0.14 / rms, 0.95 / peak)
            pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
            with wave.open(req["out"], "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(int(model.sr)); w.writeframes(pcm.tobytes())
            sys.stdout.write(json.dumps({"id": rid, "ok": True, "seconds": round(len(pcm) / float(model.sr), 2), "device": device}) + "\\n")
        except Exception as e:
            sys.stdout.write(json.dumps({"id": rid, "ok": False, "error": why(e)}) + "\\n")
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass
        sys.stdout.flush()
if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stderr.write("ERROR: %s\\n" % why(e)); sys.exit(3)
`;

type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
/** device: con qué habla de verdad; cudaError: por qué no pudo con la gráfica (solo en «auto»). */
type Ready = { device: string; cudaError: string };
type Worker = { child: import("node:child_process").ChildProcess; key: string; ready: Promise<Ready>; pending: Map<string, Pending>; buf: string; err: string; idle: ReturnType<typeof setTimeout> | null };
let worker: Worker | null = null;
/** Se cierra solo tras 5 minutos sin hablar, para devolver la memoria de la gráfica (a Ollama y a ComfyUI) y ≈ 3 GB de RAM. */
const IDLE_MS = 5 * 60_000;

/** La línea «ERROR: …» que escribe el guion al fallar (o, si no la hay, lo último que escribió). */
export const errLine = (err: string): string => {
  const mine = err.replace(/\r/g, "").split("\n").reverse().find((l) => l.startsWith("ERROR:"));
  return mine ? mine.replace(/^ERROR:\s*/, "").trim().slice(0, 300) : lastLines(err);
};

/** Antes de que ComfyUI use la gráfica: cierra Chatterbox solo si está en marcha con ella (con el procesador no estorba). */
export function releaseGpu(): Promise<void> {
  return worker && /\|(cuda|auto)$/.test(worker.key) ? stopChatterbox() : Promise.resolve();
}

/** Cierra Chatterbox (si está en marcha) y espera a que el proceso termine: así la gráfica queda libre de verdad. */
export function stopChatterbox(): Promise<void> {
  const w = worker;
  worker = null;
  if (!w) return Promise.resolve();
  if (w.idle) clearTimeout(w.idle);
  return new Promise<void>((resolve) => {
    if (w.child.exitCode !== null || w.child.signalCode !== null) { resolve(); return; }
    const giveUp = setTimeout(resolve, 8000);
    w.child.once("exit", () => { clearTimeout(giveUp); resolve(); });
    try { w.child.kill(); } catch { clearTimeout(giveUp); resolve(); }
  });
}

async function startWorker(p: CbPaths, device: Device, spawnImpl?: Spawn): Promise<Worker> {
  const spawn = spawnImpl ?? (await import("node:child_process")).spawn;
  const env = {
    ...process.env,
    PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONWARNINGS: "ignore", TRANSFORMERS_VERBOSITY: "error", TQDM_DISABLE: "1", TOKENIZERS_PARALLELISM: "false",
    HF_HOME: p.hf, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
    // Por si el arreglo del chino no se aplicara: lo que bajara pkuseg se queda en la carpeta de Chatterbox, no en la de tu usuario.
    PKUSEG_HOME: p.pkuseg,
  };
  const child = spawn(p.python, [p.server, device], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env });
  let markReady: (ready: Ready) => void = () => undefined;
  let markFailed: (error: Error) => void = () => undefined;
  const ready = new Promise<Ready>((resolve, reject) => { markReady = resolve; markFailed = reject; });
  ready.catch(() => undefined);
  const w: Worker = { child, key: `${p.python}|${device}`, ready, pending: new Map(), buf: "", err: "", idle: null };
  // Cargar el modelo la primera vez puede tardar (lee ≈ 3 GB del disco).
  const startTimer = setTimeout(() => { markFailed(new Error("Chatterbox tardó demasiado en arrancar.")); try { child.kill(); } catch { /* nada */ } }, 10 * 60_000);
  const fail = (why: string) => {
    clearTimeout(startTimer);
    markFailed(new Error(why));
    for (const job of w.pending.values()) { clearTimeout(job.timer); job.reject(new Error(why)); }
    w.pending.clear();
    if (w.idle) clearTimeout(w.idle);
    if (worker === w) worker = null;
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    w.buf += chunk.toString("utf8");
    for (let nl = w.buf.indexOf("\n"); nl >= 0; nl = w.buf.indexOf("\n")) {
      const line = w.buf.slice(0, nl).trim();
      w.buf = w.buf.slice(nl + 1);
      if (!line.startsWith("{")) continue;
      let msg: Record<string, unknown>;
      try { msg = rec(JSON.parse(line)); } catch { continue; }
      if (msg["ready"] === true) {
        clearTimeout(startTimer);
        markReady({ device: String(msg["device"] ?? device), cudaError: String(msg["cudaError"] ?? "").slice(0, 300) });
        continue;
      }
      const id = typeof msg["id"] === "string" ? msg["id"] : "";
      const job = w.pending.get(id);
      if (!job) continue;
      w.pending.delete(id);
      clearTimeout(job.timer);
      if (msg["ok"] === true) job.resolve();
      else job.reject(new Error(`Chatterbox ha fallado: ${String(msg["error"] ?? "sin detalle").slice(0, 300)}`));
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => { w.err = (w.err + chunk.toString("utf8")).slice(-3000); });
  child.on("error", (error: Error) => fail(`No pude arrancar Chatterbox: ${error.message}`));
  child.on("exit", (code: number | null) => fail(`Chatterbox se cerró (código ${code ?? "?"}): ${errLine(w.err)}`));
  child.stdin?.on("error", () => undefined);
  return w;
}

type SayDeps = { spawnImpl?: Spawn | undefined; beforeStart?: (() => Promise<void>) | undefined };
async function workerSay(p: CbPaths, device: Device, req: { text: string; ref: string; cfg: CbCfg }, deps: SayDeps): Promise<{ bytes: Uint8Array } & Ready> {
  // «auto» vale con cualquier Chatterbox ya en marcha; «cuda» o «cpu», solo con uno arrancado igual.
  const fits = (key: string) => (device === "auto" ? key.startsWith(`${p.python}|`) : key === `${p.python}|${device}`);
  if (worker && !fits(worker.key)) await stopChatterbox();
  if (!worker) {
    if (deps.beforeStart) await deps.beforeStart();
    worker = await startWorker(p, device, deps.spawnImpl);
  }
  const w = worker;
  const running = await w.ready;
  // Uno arrancado en «auto» queda anotado con lo que de verdad usa, para que después sirva a «cuda» (o a «cpu») sin recargar el modelo.
  if (device === "auto") w.key = `${p.python}|${running.device === "cuda" ? "cuda" : "cpu"}`;
  if (w.idle) { clearTimeout(w.idle); w.idle = null; }
  const { fs, path, os } = await mods();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "willy-chatterbox-"));
  const out = path.join(tmp, "voz.wav");
  const id = Math.random().toString(36).slice(2, 10);
  try {
    await new Promise<void>((resolve, reject) => {
      // Con el procesador puede ir muy lento: hasta 10 minutos por trozo antes de darlo por perdido.
      const timer = setTimeout(() => { w.pending.delete(id); reject(new Error("Chatterbox tardó demasiado.")); if (worker === w) void stopChatterbox(); }, 10 * 60_000);
      w.pending.set(id, { resolve, reject, timer });
      w.child.stdin?.write(`${JSON.stringify({ id, text: req.text, ref: req.ref, exaggeration: req.cfg.exaggeration, cfg_weight: req.cfg.cfgWeight, temperature: req.cfg.temperature, out })}\n`, "utf8");
    });
    const bytes = new Uint8Array(await fs.readFile(out));
    if (bytes.length < 100 || String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0) !== "RIFF") throw new Error("Chatterbox no produjo un audio válido.");
    return { bytes, ...running };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    if (worker === w && !w.pending.size) {
      w.idle = setTimeout(() => { if (worker === w && !w.pending.size) void stopChatterbox(); }, IDLE_MS);
      w.idle.unref?.();
    }
  }
}

// ------------------------------------------------------------------------------------------------ sitio en la gráfica
/** Ejecuta un programa y devuelve lo que escribe (vacío si falla o no existe). */
async function runOut(cmd: string, args: string[], timeoutMs: number, spawnImpl?: Spawn): Promise<string> {
  const spawn = spawnImpl ?? (await import("node:child_process")).spawn;
  return new Promise((resolve) => {
    let out = "";
    let child: import("node:child_process").ChildProcess;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      resolve("");
      return;
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* nada */ } resolve(""); }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { out = (out + chunk.toString("utf8")).slice(-2000); });
    child.on("error", () => { clearTimeout(timer); resolve(""); });
    child.on("close", (code: number | null) => { clearTimeout(timer); resolve(code === 0 ? out : ""); });
  });
}
async function nvidiaSmi(args: string[], spawnImpl?: Spawn): Promise<string> {
  for (const exe of NVIDIA_SMI) {
    const out = await runOut(exe, args, 15_000, spawnImpl);
    if (out.trim()) return out;
  }
  return "";
}
export async function detectNvidia(spawnImpl?: Spawn): Promise<{ name: string; mb: number } | null> {
  const out = await nvidiaSmi(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], spawnImpl);
  const first = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!first) return null;
  const [name, mb] = first.split(",").map((s) => s.trim());
  const megas = Number(mb);
  return name ? { name: name.slice(0, 80), mb: Number.isFinite(megas) ? megas : 0 } : null;
}
/** Memoria libre de la gráfica NVIDIA, en MB (null si no hay o no se puede saber). */
export async function freeVramMB(spawnImpl?: Spawn): Promise<number | null> {
  const out = await nvidiaSmi(["--query-gpu=memory.free", "--format=csv,noheader,nounits"], spawnImpl);
  const first = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  const n = first ? Number(first) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Pide a ComfyUI (si está abierto) que suelte la memoria de la gráfica. Lo hace al acabar lo que esté generando y, la próxima vez,
 * vuelve a cargar sus modelos. Devuelve si ComfyUI contestó.
 */
export async function freeComfyVram(dir: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const { loadSettings } = await import("@/lib/avatar-server");
    const { comfyBase } = await import("@/lib/comfy-server");
    const base = comfyBase((await loadSettings(dir)).comfyUrl);
    const res = await fetchImpl(`${base}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false; // ComfyUI cerrado o sin respuesta
  }
}

/** Saca de la gráfica los modelos de Ollama que la estén usando (Ollama los vuelve a cargar solo la próxima vez que WILLY piensa). */
export async function unloadOllamaFromGpu(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  let names: string[];
  try {
    const res = await fetchImpl(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];
    const list = rec(await res.json())["models"];
    names = (Array.isArray(list) ? list : [])
      .map(rec)
      .filter((m) => Number(m["size_vram"] ?? 0) > 0)
      .map((m) => String(m["name"] ?? m["model"] ?? ""))
      .filter((n) => OLLAMA_MODEL.test(n));
  } catch {
    return []; // Ollama cerrado o sin /api/ps
  }
  const done: string[] = [];
  for (const model of names) {
    try {
      const res = await fetchImpl(`${OLLAMA_URL}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(15_000) });
      if (res.ok) done.push(model);
    } catch {
      /* Ollama no contestó: se sigue con los demás */
    }
  }
  return done;
}

export type RoomDeps = { spawnImpl?: Spawn | undefined; fetchImpl?: typeof fetch | undefined; sleep?: ((ms: number) => Promise<void>) | undefined };
/**
 * Deja sitio en la gráfica antes de cargar Chatterbox. Con 6 GB no caben a la vez sus modelos y los de ComfyUI o el de Ollama:
 * 1) ComfyUI suelta los suyos; 2) si aun así quedan menos de 4,5 GB libres, se saca de la gráfica el modelo de Ollama;
 * 3) se espera (≈ 10 s como mucho) a que la memoria quede libre de verdad.
 */
export async function makeRoomOnGpu(dir: string, deps: RoomDeps = {}): Promise<{ freeMB: number | null; unloaded: string[] }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const comfy = await freeComfyVram(dir, fetchImpl);
  let free = await freeVramMB(deps.spawnImpl);
  if (free === null || free >= CB_VRAM_MB) return { freeMB: free, unloaded: [] };
  const unloaded = await unloadOllamaFromGpu(fetchImpl);
  if (!comfy && !unloaded.length) return { freeMB: free, unloaded };
  for (let i = 0; i < 10 && free !== null && free < CB_VRAM_MB; i++) {
    await sleep(1000);
    free = await freeVramMB(deps.spawnImpl);
  }
  return { freeMB: free, unloaded };
}

async function refPath(p: CbPaths, voice: string): Promise<string> {
  const { path } = await mods();
  if (voice === "propia") {
    const own = await ownRef(p);
    if (!own) throw new Error("Todavía no has subido tu voz para Chatterbox.");
    return own;
  }
  if (voice !== "dora" && voice !== "alex") throw new Error("Esa voz de Chatterbox no existe.");
  const file = path.join(p.refs, `${voice}.wav`);
  if (!(await exists(file))) throw new Error("Falta la voz de referencia de Chatterbox: vuelve a instalarlo.");
  return file;
}

const roomFor = (dir: string, deps: CbDeps) => async (): Promise<void> => { await makeRoomOnGpu(dir, { spawnImpl: deps.spawnImpl, fetchImpl: deps.fetchImpl }); };

/** Audio (.wav) con Chatterbox. El modelo admite frases cortas (≈ 40 s como mucho): los textos se parten por frases. */
export async function cbSpeak(dir: string, voice: string, spoken: string, deps: CbDeps): Promise<Uint8Array> {
  const p = await cbPaths(dir, deps.platform);
  const marker = await loadMarker(p);
  if (!marker || !(await exists(p.python))) throw new Error("Chatterbox todavía no está instalado (Lectura → Voces más humanas → Chatterbox).");
  const { fs } = await mods();
  if ((await fs.readFile(p.server, "utf8").catch(() => "")) !== CB_SERVER_SCRIPT) { await stopChatterbox(); await fs.writeFile(p.server, CB_SERVER_SCRIPT, "utf8"); }
  const ref = await refPath(p, voice);
  const cfg = await loadCfg(p);
  const say: SayDeps = { spawnImpl: deps.spawnImpl, beforeStart: marker.device === "cuda" ? roomFor(dir, deps) : undefined };
  return speakInParts(splitForTts(spoken, 250), async (piece) => (await workerSay(p, marker.device, { text: piece, ref, cfg }, say)).bytes);
}

// ------------------------------------------------------------------------------------------------ instalación
async function dirSize(root: string): Promise<number> {
  const { fs, path } = await mods();
  let total = 0;
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 8) return;
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile()) total += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
    }
  };
  await walk(root, 0);
  return total;
}
/** Espacio libre del disco (para comprobarlo antes y para ver avanzar PyTorch, que uv no cuenta mientras descarga). */
async function freeBytes(where: string): Promise<number | null> {
  const { fs } = await mods();
  try {
    if (typeof fs.statfs !== "function") return null;
    const s = await fs.statfs(where);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}
async function installEnv(p: CbPaths): Promise<Record<string, string>> {
  // Enlaces duros desde la caché de uv: PyTorch (≈ 4,4 GB) no se guarda dos veces en el disco.
  return { ...(await p.env()), UV_LINK_MODE: "hardlink", HF_HOME: p.hf, HF_HUB_DISABLE_TELEMETRY: "1", HF_HUB_DISABLE_SYMLINKS_WARNING: "1" };
}
/** Qué PyTorch hay en el Python de Chatterbox: su versión («2.6.0+cu124» = con CUDA) y si ve la gráfica. */
async function torchInfo(p: CbPaths, spawnImpl?: Spawn): Promise<{ version: string; cuda: boolean } | null> {
  const out = await runOut(p.python, ["-c", "import torch; print(torch.__version__); print(torch.cuda.is_available())"], 5 * 60_000, spawnImpl);
  const [version, cuda] = out.split(/\r?\n/).map((l) => l.trim());
  return version ? { version, cuda: cuda === "True" } : null;
}
/** Deja PyTorch con CUDA. Si al instalar Chatterbox se hubiera cambiado por el del procesador, se vuelve a poner (solo PyTorch). */
async function ensureCudaTorch(p: CbPaths, gpuName: string, env: Record<string, string>, job: Progress, deps: CbDeps): Promise<void> {
  job.text = "Comprobando que PyTorch puede usar la tarjeta gráfica…";
  const now = await torchInfo(p, deps.spawnImpl);
  if (now && /\+cu\d+/.test(now.version)) return;
  job.text = `Poniendo PyTorch con CUDA para tu ${gpuName || "tarjeta NVIDIA"} (≈ 2,5 GB)…`;
  const r = await runCmd(p.uvExe, ["pip", "install", "--python", p.python, "--reinstall", "--no-deps", ...TORCH_CUDA, "--index-url", TORCH_INDEX.cuda], { env, timeoutMs: 120 * 60_000, what: "Instalar PyTorch con CUDA" }, deps.spawnImpl);
  if (r.code !== 0) throw new Error(`No pude instalar PyTorch con CUDA: ${lastLines(r.err)}`);
  const after = await torchInfo(p, deps.spawnImpl);
  if (!after || !/\+cu\d+/.test(after.version)) throw new Error("PyTorch sigue sin CUDA después de volver a instalarlo.");
}

/** Prueba real con la voz de referencia de España y mide la velocidad (la segunda frase, ya con el modelo cargado). */
async function measure(dir: string, p: CbPaths, device: Device, gpuName: string, job: Progress, deps: CbDeps): Promise<{ device: "cuda" | "cpu"; note: string; gpuError: string }> {
  const { fs, path } = await mods();
  await stopChatterbox();
  await fs.writeFile(p.server, CB_SERVER_SCRIPT, "utf8");
  const ref = path.join(p.refs, "dora.wav");
  const say: SayDeps = { spawnImpl: deps.spawnImpl, beforeStart: device === "cpu" ? undefined : roomFor(dir, deps) };
  const t0 = Date.now();
  const first = await workerSay(p, device, { text: "Hola. Ya estoy lista para leer con voz natural.", ref, cfg: CB_DEFAULTS }, say);
  job.text = "Midiendo la velocidad…";
  job.pct = Math.max(job.pct, 96);
  const t1 = Date.now();
  const second = await workerSay(p, device, { text: "Esta segunda frase sirve para medir cuánto tarda de verdad, ya con el modelo cargado.", ref, cfg: CB_DEFAULTS }, say);
  const synth = (Date.now() - t1) / 1000;
  const secs2 = wavSeconds(second.bytes);
  if (wavSeconds(first.bytes) < 0.5 || secs2 < 1) throw new Error("Chatterbox arrancó, pero la prueba no produjo voz.");
  const onGpu = first.device === "cuda";
  const used = onGpu ? `tu tarjeta gráfica${gpuName ? ` (${gpuName})` : ""}` : "el procesador";
  const note = `Funciona con ${used}: ${dec(secs2)} s de voz en ${dec(synth)} s (la primera vez tarda ${Math.round((t1 - t0) / 1000)} s en arrancar).`;
  return { device: onGpu ? "cuda" : "cpu", note, gpuError: onGpu ? "" : first.cudaError };
}

export async function installChatterbox(dir: string, job: Progress, deps: CbDeps): Promise<void> {
  const { fs, path } = await mods();
  const p = await cbPaths(dir, deps.platform);
  if (!(await p.uvReady())) throw new Error("Primero instala Kokoro: Chatterbox usa su instalador de Python y su voz de España como referencia.");
  await fs.mkdir(p.refs, { recursive: true });
  const room = await freeBytes(p.refs);
  if (deps.platform === "win32" && room !== null && room < MIN_FREE_BYTES && !(await exists(p.python))) throw new Error(`No hay sitio en el disco: Chatterbox necesita ≈ 12 GB libres para instalarse y quedan ${gbText(room)} GB.`);
  // 1) Voces de referencia con acento de España: de la copia guardada o, si no la hay, leídas por Kokoro. Si no se pueden
  //    tener, se para aquí, antes de bajar nada grande. Se guarda una copia aparte para poder reinstalar sin Kokoro.
  job.text = "Preparando las voces de referencia con acento de España…";
  job.pct = 2;
  await fs.mkdir(p.savedRefs, { recursive: true });
  for (const r of REFS) {
    const file = path.join(p.refs, `${r.id}.wav`);
    const saved = path.join(p.savedRefs, `${r.id}.wav`);
    if (!(await exists(file))) {
      if (await exists(saved)) await fs.copyFile(saved, file);
      else {
        try {
          await fs.writeFile(file, await extraSpeak(dir, r.kokoro, REF_TEXT, { platform: deps.platform, spawnImpl: deps.spawnImpl }));
        } catch (error) {
          throw new Error(`Para crear las voces de España de Chatterbox hace falta Kokoro una vez (después se puede quitar): ${errText(error)}`);
        }
      }
    }
    if (!(await exists(saved))) await fs.copyFile(file, saved);
  }
  // 2) ¿Hay tarjeta NVIDIA? Entonces PyTorch con CUDA; si no, la versión para el procesador.
  job.text = "Mirando si tu equipo tiene tarjeta gráfica NVIDIA…";
  job.pct = 5;
  const gpu = await detectNvidia(deps.spawnImpl);
  const kind: "cuda" | "cpu" = gpu && gpu.mb >= 3500 ? "cuda" : "cpu";
  const env = await installEnv(p);
  if (!(await exists(p.python))) {
    job.text = "Preparando un Python propio para Chatterbox (no toca el de tu sistema ni el de ComfyUI)…";
    job.pct = 7;
    const r = await runCmd(p.uvExe, ["venv", "--python", "3.12", p.venv], { env, timeoutMs: 15 * 60_000, what: "Crear el Python de Chatterbox" }, deps.spawnImpl);
    if (r.code !== 0 || !(await exists(p.python))) throw new Error(`No pude crear el Python de Chatterbox: ${lastLines(r.err)}`);
  }
  const follow = (label: string) => (line: string) => { if (/^(Resolved|Downloading|Downloaded|Prepared|Installed)/.test(line)) job.text = `${label}: ${line.slice(0, 90)}`; };
  const label = kind === "cuda" ? `Instalando PyTorch para tu ${gpu?.name ?? "tarjeta NVIDIA"} (es lo que más tarda)` : "Instalando PyTorch para el procesador";
  job.text = `${label}…`;
  job.pct = 10;
  const before = await freeBytes(p.cdir);
  const watch = setInterval(() => {
    void freeBytes(p.cdir).then((now) => {
      if (before === null || now === null) return;
      const got = Math.max(0, before - now);
      job.pct = 10 + Math.min(33, Math.round((got / TORCH_BYTES[kind]) * 33));
      job.text = `${label}: ${gbText(Math.min(got, TORCH_BYTES[kind]))} de ≈ ${gbText(TORCH_BYTES[kind])} GB…`;
    });
  }, 5000);
  let torch: { code: number | null; err: string };
  try {
    torch = await runCmd(p.uvExe, ["pip", "install", "--python", p.python, ...TORCH, "--index-url", TORCH_INDEX[kind]], { env, timeoutMs: 120 * 60_000, what: "Instalar PyTorch" }, deps.spawnImpl);
  } finally {
    clearInterval(watch);
  }
  if (torch.code !== 0) throw new Error(`No pude instalar PyTorch: ${lastLines(torch.err)}`);
  job.text = "Instalando Chatterbox y sus piezas (≈ 700 MB)…";
  job.pct = 45;
  const pkg = await runCmd(p.uvExe, ["pip", "install", "--python", p.python, CB_PKG], { env, timeoutMs: 60 * 60_000, what: "Instalar Chatterbox", onErr: follow("Chatterbox") }, deps.spawnImpl);
  if (pkg.code !== 0) throw new Error(`No pude instalar Chatterbox: ${lastLines(pkg.err)}`);
  if (kind === "cuda") {
    job.pct = 55;
    await ensureCudaTorch(p, gpu?.name ?? "", env, job, deps);
  }
  // 3) El modelo (≈ 3 GB) se baja AHORA, con progreso, en vez de la primera vez que hable.
  job.text = "Descargando el modelo de Chatterbox (≈ 3 GB)…";
  job.pct = 60;
  const target = 3.2e9;
  const poll = setInterval(() => { void dirSize(p.hf).then((got) => { job.pct = 60 + Math.min(30, Math.round((got / target) * 30)); job.text = `Descargando el modelo de Chatterbox: ${gbText(Math.min(got, target))} de ≈ 3 GB…`; }); }, 4000);
  const script = `from huggingface_hub import snapshot_download\nsnapshot_download(repo_id=${JSON.stringify(HF_REPO)}, repo_type="model", revision="main", allow_patterns=${JSON.stringify(HF_FILES)})\nprint("ok")\n`;
  let dl: { code: number | null; err: string };
  try {
    dl = await runCmd(p.python, ["-c", script], { env, timeoutMs: 120 * 60_000, what: "Descargar el modelo de Chatterbox" }, deps.spawnImpl);
  } finally {
    clearInterval(poll);
  }
  if (dl.code !== 0) throw new Error(`No pude descargar el modelo de Chatterbox: ${lastLines(dl.err)}`);
  // 4) Prueba real y medida de la velocidad. Con gráfica se prueba primero con ella y, si no puede, con el procesador (y se dice por qué).
  job.text = "Arrancando Chatterbox por primera vez (carga el modelo)…";
  job.pct = 92;
  const m = await measure(dir, p, kind === "cuda" ? "auto" : "cpu", gpu?.name ?? "", job, deps);
  await saveMarker(p, { device: m.device, gpu: gpu?.name ?? "", note: m.note, gpuError: kind === "cuda" ? m.gpuError : "", at: new Date().toISOString() });
}

/** Chatterbox quedó con el procesador pero hay tarjeta NVIDIA: se vuelve a probar con ella (después de dejarle sitio) y, si va, se queda con ella. */
export async function cbGpuRetry(dir: string, job: Progress, deps: CbDeps): Promise<void> {
  const p = await cbPaths(dir, deps.platform);
  const marker = await loadMarker(p);
  if (!marker || !(await exists(p.python))) throw new Error("Chatterbox no está instalado.");
  job.text = "Mirando la tarjeta gráfica…";
  job.pct = 5;
  const gpu = await detectNvidia(deps.spawnImpl);
  if (!gpu || gpu.mb < 3500) throw new Error("No encuentro una tarjeta gráfica NVIDIA con 4 GB o más: Chatterbox sigue con el procesador.");
  try {
    job.pct = 15;
    await ensureCudaTorch(p, gpu.name, await installEnv(p), job, deps);
    job.text = "Probando Chatterbox con la tarjeta gráfica…";
    job.pct = 80;
    const m = await measure(dir, p, "cuda", gpu.name, job, deps);
    await saveMarker(p, { device: "cuda", gpu: gpu.name, note: m.note, gpuError: "", at: new Date().toISOString() });
  } catch (error) {
    await saveMarker(p, { ...marker, gpu: gpu.name, gpuError: errText(error) });
    throw error;
  }
}

// ------------------------------------------------------------------------------------------------ estado y acciones
/** ¿Están ya las dos voces de referencia (en Chatterbox o en la copia guardada)? Entonces no hace falta Kokoro para instalarlo. */
async function refsReady(p: CbPaths): Promise<boolean> {
  const { path } = await mods();
  for (const r of REFS) if (!(await exists(path.join(p.refs, `${r.id}.wav`))) && !(await exists(path.join(p.savedRefs, `${r.id}.wav`)))) return false;
  return true;
}

export async function cbStatus(dir: string, platform: string, kokoroReady: boolean): Promise<{ voices: string[]; view: Record<string, unknown> }> {
  const p = await cbPaths(dir, platform);
  const marker = await loadMarker(p);
  const ready = !!marker && (await exists(p.python));
  const own = ready ? await ownRef(p) : "";
  const cfg = await loadCfg(p);
  const needsKokoro = !kokoroReady && !(await refsReady(p));
  return {
    voices: ready ? ["dora", "alex", ...(own ? ["propia"] : [])] : [],
    view: {
      ready, canInstall: platform === "win32", needsKokoro, gb: CB_GB, downloadGb: CB_DOWNLOAD_GB, vramGb: CB_VRAM_MB / 1000,
      device: marker?.device ?? "", gpu: marker?.gpu ?? "", note: marker?.note ?? "", gpuError: marker?.gpuError ?? "",
      canRetryGpu: platform === "win32" && marker?.device === "cpu" && !!marker.gpu, hasOwn: !!own, ...cfg,
    },
  };
}

const AUDIO_KINDS: Array<{ ext: string; test: (b: Uint8Array) => boolean }> = [
  { ext: "wav", test: (b) => String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0) === "RIFF" },
  { ext: "flac", test: (b) => String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0) === "fLaC" },
  { ext: "ogg", test: (b) => String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0) === "OggS" },
  { ext: "mp3", test: (b) => String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0) === "ID3" || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0) },
];

export async function cbAction(dir: string, action: string, body: Record<string, unknown>, ctx: ExtraCtx): Promise<Record<string, unknown>> {
  const { fs, path } = await mods();
  const p = await cbPaths(dir, ctx.platform);
  const deps: CbDeps = { platform: ctx.platform, spawnImpl: ctx.spawnImpl, fetchImpl: ctx.fetchImpl };
  try {
    switch (action) {
      case "cb-install": {
        if (ctx.busy) return { error: "Ya hay una instalación en marcha. Espera a que termine." };
        if (ctx.platform !== "win32") return { error: "La instalación automática de Chatterbox es para Windows." };
        if (await loadMarker(p)) return { error: "Chatterbox ya está instalado." };
        return { ok: true, job: ctx.run("Voz local Chatterbox", (job) => installChatterbox(dir, job, deps)) };
      }
      case "cb-gpu": {
        if (ctx.busy) return { error: "Ya hay una instalación en marcha. Espera a que termine." };
        if (ctx.platform !== "win32") return { error: "Esto es para Windows." };
        if (!(await loadMarker(p))) return { error: "Chatterbox no está instalado." };
        return { ok: true, job: ctx.run("Chatterbox con la tarjeta gráfica", (job) => cbGpuRetry(dir, job, deps)) };
      }
      case "cb-config": {
        const incoming = rec(body["cfg"]);
        const now = await loadCfg(p);
        const next: CbCfg = { exaggeration: num(incoming["exaggeration"], now.exaggeration, 0.25, 1.5), cfgWeight: num(incoming["cfgWeight"], now.cfgWeight, 0.2, 0.9), temperature: num(incoming["temperature"], now.temperature, 0.5, 1.2) };
        await fs.mkdir(p.cdir, { recursive: true });
        await fs.writeFile(p.cfg, JSON.stringify(next, null, 2), "utf8");
        return { ok: true };
      }
      case "cb-own": {
        if (body["consent"] !== true) return { error: "Confirma que la voz es tuya o de alguien que te ha dado permiso." };
        const b64 = typeof body["audio"] === "string" ? body["audio"].replace(/^data:[^,]*,/, "") : "";
        if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return { error: "No he podido leer ese audio." };
        const bytes = new Uint8Array(Buffer.from(b64, "base64"));
        if (bytes.byteLength > 12 * 2 ** 20) return { error: "El audio es demasiado grande (máximo 12 MB; bastan 10–20 segundos)." };
        if (bytes.byteLength < 20_000) return { error: "El audio es demasiado corto: graba o sube 10–20 segundos hablando con naturalidad." };
        const kind = AUDIO_KINDS.find((k) => k.test(bytes));
        if (!kind) return { error: "Ese archivo no es un audio WAV, FLAC, OGG o MP3." };
        await fs.mkdir(p.refs, { recursive: true });
        for (const n of await fs.readdir(p.refs).catch(() => [] as string[])) if (/^propia\./i.test(n)) await fs.rm(path.join(p.refs, n), { force: true });
        await fs.writeFile(path.join(p.refs, `propia.${kind.ext}`), bytes);
        return { ok: true };
      }
      case "cb-own-remove": {
        for (const n of await fs.readdir(p.refs).catch(() => [] as string[])) if (/^propia\./i.test(n)) await fs.rm(path.join(p.refs, n), { force: true });
        return { ok: true };
      }
      case "cb-remove": {
        if (ctx.busy) return { error: "Hay una instalación en marcha. Espera a que termine." };
        await stopChatterbox();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await fs.rm(p.cdir, { recursive: true, force: true });
        // PyTorch y compañía también ocupan sitio en la caché de uv: se quitan (Kokoro no los usa).
        if (await p.uvReady()) await runCmd(p.uvExe, ["cache", "clean", ...CACHE_HEAVY], { env: await p.env(), timeoutMs: 10 * 60_000, what: "Limpiar la caché" }, ctx.spawnImpl).catch(() => undefined);
        return { ok: true };
      }
      default:
        return { error: "Acción desconocida." };
    }
  } catch (error) {
    return { error: errText(error) };
  }
}
