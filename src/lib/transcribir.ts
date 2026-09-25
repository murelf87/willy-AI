// TRANSCRIBIR AUDIO O VÍDEO en tu equipo (Whisper): lo que se dice en un audio o en un vídeo, a texto con sus tiempos (para
// subtítulos). No instala otro Python: usa el de Chatterbox (datos-privados/voces-motores/chatterbox), que ya trae PyTorch y
// transformers. Solo hace falta el modelo (openai/whisper-large-v3-turbo, 1,6 GB, una vez, desde Hugging Face), y se baja
// cuando el dueño pulsa «Preparar». ffmpeg (el mismo que usa «Mi yo en IA») pasa cualquier audio o vídeo a WAV de 16 kHz.
// Cada transcripción arranca su propio proceso y lo cierra al acabar: con 6 GB en la gráfica no conviven con Chatterbox,
// Ollama ni ComfyUI, así que antes se les pide que la suelten (y si aun así no cabe, se hace con el procesador).
// El archivo llega por trozos a /api/voces (acciones «stt-»), así cabe un vídeo largo sin subir el límite de las peticiones.

import { cbPaths, makeRoomOnGpu, stopChatterbox } from "@/lib/voces-chatterbox";
import { exists, lastLines, runCmd } from "@/lib/voces-extra";
import type { VoicesResult } from "@/lib/voices-server";

export const STT_MODEL = "openai/whisper-large-v3-turbo";
/** Lo que pesa la descarga (model.safetensors y su configuración). */
const STT_BYTES = 1_620_000_000;
export const STT_GB = "1,6";
/** Trozo de subida: en base64 cabe en una petición de /api/voces (17 MB). */
export const STT_CHUNK = 12 * 2 ** 20;
/** Tamaño máximo del archivo (un vídeo largo). */
export const STT_MAX_FILE = 2 * 2 ** 30;
/** Idiomas que se pueden elegir («auto»: Whisper lo detecta). */
const LANGS = new Set(["auto", "es", "en", "fr", "de", "it", "pt", "ca", "gl", "eu"]);

export type SttSegment = { start: number; end: number; text: string };
export type SttResult = { text: string; segments: SttSegment[]; seconds: number; device: string; cudaError: string; name: string };
type SttJob = {
  id: string;
  kind: "preparar" | "transcribir";
  status: "activo" | "listo" | "error";
  text: string;
  pct: number;
  error: string;
  startedAt: number;
  finishedAt: number;
  result: SttResult | null;
};
type Upload = { id: string; dir: string; file: string; name: string; size: number; received: number; next: number; at: number };

const jobs = new Map<string, SttJob>();
const uploads = new Map<string, Upload>();
/** Solo un trabajo a la vez (preparar o transcribir): los dos usan mucha memoria. */
let current: SttJob | null = null;

async function mods() {
  return { fs: await import("node:fs/promises"), path: await import("node:path"), os: await import("node:os"), crypto: await import("node:crypto") };
}
const errText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const str = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const minutes = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
};

// ------------------------------------------------------------------------------------------------ rutas y guiones
async function sttPaths(dir: string) {
  const { path } = await mods();
  const p = await cbPaths(dir, process.platform);
  return {
    python: p.python,
    cdir: p.cdir,
    hf: p.hf,
    chatterboxMarker: p.marker,
    modelDir: path.join(p.hf, "hub", `models--${STT_MODEL.replace("/", "--")}`),
    marker: path.join(p.cdir, "whisper-listo.json"),
    getScript: path.join(p.cdir, "willy_whisper_get.py"),
    runScript: path.join(p.cdir, "willy_whisper.py"),
  };
}

const GET_SCRIPT = `# WILLY AI · descarga el modelo de Whisper una sola vez. Argumentos: repositorio de Hugging Face y json de salida.
import json, sys
def main():
    from huggingface_hub import snapshot_download
    path = snapshot_download(repo_id=sys.argv[1], allow_patterns=["*.json", "*.txt", "model.safetensors"])
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump({"ok": True, "path": path}, f)
if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stderr.write("ERROR: %s\\n" % " ".join(("%s: %s" % (type(e).__name__, e)).split())[:400]); sys.exit(3)
`;

const RUN_SCRIPT = `# WILLY AI · Whisper: pasa a texto un WAV de 16 kHz. Argumentos: dispositivo (cuda, cpu o auto), wav, json de salida,
# idioma (auto para detectarlo) y modelo.
import json, sys
def why(e):
    raw = getattr(e, "object", None)
    if isinstance(e, UnicodeDecodeError) and isinstance(raw, (bytes, bytearray)):
        msg = bytes(raw).decode("cp1252", "replace")
    else:
        msg = "%s: %s" % (type(e).__name__, e)
    msg = " ".join(msg.split())
    if "out of memory" in msg.lower():
        msg = "La tarjeta grafica no tiene memoria libre para transcribir. " + msg
    return msg if len(msg) <= 290 else msg[:140] + " | " + msg[-140:]
def load(model, device):
    import torch
    from transformers import pipeline
    # Siempre float32: las GTX 16xx dan resultados vacios o raros con float16.
    return pipeline("automatic-speech-recognition", model=model, device=device, dtype=torch.float32)
def main():
    import numpy as np
    import soundfile as sf
    import torch
    want, wav, out, lang, model = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
    audio, rate = sf.read(wav, dtype="float32")
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    if rate != 16000:
        raise RuntimeError("El audio tiene que llegar a 16 kHz.")
    audio = np.ascontiguousarray(audio, dtype=np.float32)
    seconds = float(len(audio)) / 16000.0
    kw = {"return_timestamps": True, "task": "transcribe"}
    if lang and lang != "auto":
        kw["language"] = lang
    device = "cuda:0" if want in ("cuda", "auto") and torch.cuda.is_available() else "cpu"
    cuda_error = ""
    try:
        res = load(model, device)(audio, **kw)
    except Exception as e:
        if want != "auto" or device == "cpu":
            raise
        cuda_error = why(e)
        torch.cuda.empty_cache()
        device = "cpu"
        res = load(model, device)(audio, **kw)
    segments = []
    for c in res.get("chunks") or []:
        ts = c.get("timestamp") or (None, None)
        start = float(ts[0]) if ts[0] is not None else (segments[-1]["end"] if segments else 0.0)
        end = float(ts[1]) if len(ts) > 1 and ts[1] is not None else seconds
        text = (c.get("text") or "").strip()
        if text:
            segments.append({"start": start, "end": max(end, start), "text": text})
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"text": (res.get("text") or "").strip(), "segments": segments, "seconds": seconds, "device": "cuda" if device.startswith("cuda") else "cpu", "cudaError": cuda_error}, f, ensure_ascii=False)
if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stderr.write("ERROR: %s\\n" % why(e)); sys.exit(3)
`;

/** Escribe el guion solo si ha cambiado (así una versión nueva de WILLY trae su guion nuevo). */
async function ensureScript(file: string, content: string): Promise<void> {
  const { fs } = await mods();
  const now = await fs.readFile(file, "utf8").catch(() => "");
  if (now !== content) await fs.writeFile(file, content, "utf8");
}

async function dirBytes(root: string): Promise<number> {
  const { fs, path } = await mods();
  let total = 0;
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) total += await dirBytes(full);
    else if (entry.isFile()) {
      try { total += (await fs.stat(full)).size; } catch { /* se está escribiendo */ }
    }
  }
  return total;
}

/** ¿Está el modelo en el disco? (lo deja anotado la preparación, tras comprobar que el archivo grande está entero). */
async function modelReady(p: Awaited<ReturnType<typeof sttPaths>>): Promise<boolean> {
  const { fs, path } = await mods();
  if (!(await exists(p.marker))) return false;
  try {
    const snaps = await fs.readdir(path.join(p.modelDir, "snapshots"));
    for (const snap of snaps) {
      const file = path.join(p.modelDir, "snapshots", snap, "model.safetensors");
      try { if ((await fs.stat(file)).size > 1_500_000_000) return true; } catch { /* esta versión no lo tiene */ }
    }
  } catch { /* sin descargar */ }
  return false;
}

const show = (job: SttJob | null) => (job ? { id: job.id, kind: job.kind, status: job.status, text: job.text, pct: job.pct, error: job.error, result: job.result } : null);

function newJob(kind: SttJob["kind"], id: string, text: string): SttJob {
  const job: SttJob = { id, kind, status: "activo", text, pct: kind === "preparar" ? 0 : -1, error: "", startedAt: Date.now(), finishedAt: 0, result: null };
  jobs.set(id, job);
  for (const [key, old] of jobs) if (jobs.size > 8 && old.finishedAt && key !== id) jobs.delete(key);
  current = job;
  return job;
}
function finish(job: SttJob, error?: string): void {
  job.finishedAt = Date.now();
  if (error) { job.status = "error"; job.error = error.slice(0, 400); job.text = "No se pudo terminar."; }
  else { job.status = "listo"; job.pct = 100; }
  if (current === job) current = null;
}

// ------------------------------------------------------------------------------------------------ preparar (descarga)
async function prepare(dir: string, job: SttJob): Promise<void> {
  const { fs, path, os } = await mods();
  const p = await sttPaths(dir);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "willy-whisper-get-"));
  const out = path.join(tmp, "listo.json");
  const before = await dirBytes(p.modelDir);
  const timer = setInterval(() => {
    void dirBytes(p.modelDir).then((bytes) => {
      const got = Math.max(0, bytes - before);
      job.pct = Math.min(99, Math.round((bytes / STT_BYTES) * 100));
      job.text = `Descargando el modelo de Whisper: ${(bytes / 1e9).toFixed(2).replace(".", ",")} de ${STT_GB} GB${got ? "" : " (empezando)"}…`;
    });
  }, 2000);
  try {
    await ensureScript(p.getScript, GET_SCRIPT);
    const env: Record<string, string> = { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONWARNINGS: "ignore", HF_HOME: p.hf, HF_HUB_DISABLE_TELEMETRY: "1", HF_HUB_DISABLE_SYMLINKS_WARNING: "1", TQDM_DISABLE: "1" };
    const r = await runCmd(p.python, [p.getScript, STT_MODEL, out], { env, timeoutMs: 3 * 60 * 60_000, what: "La descarga del modelo de Whisper" });
    if (r.code !== 0 || !(await exists(out))) throw new Error(`No se pudo descargar el modelo: ${lastLines(r.err)}`);
    await fs.writeFile(p.marker, JSON.stringify({ model: STT_MODEL, at: new Date().toISOString() }), "utf8");
    if (!(await modelReady(p))) {
      await fs.rm(p.marker, { force: true }).catch(() => undefined);
      throw new Error("La descarga terminó, pero el modelo no está entero. Vuelve a pulsar «Preparar».");
    }
    job.text = "Listo: la transcripción ya funciona sin internet.";
    finish(job);
  } catch (error) {
    finish(job, errText(error));
  } finally {
    clearInterval(timer);
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ------------------------------------------------------------------------------------------------ transcribir
async function transcribe(dir: string, job: SttJob, up: Upload, language: string): Promise<void> {
  const { fs, path } = await mods();
  const p = await sttPaths(dir);
  const wav = path.join(up.dir, "audio-16k.wav");
  const out = path.join(up.dir, "resultado.json");
  let tick: ReturnType<typeof setInterval> | null = null;
  try {
    job.text = "Preparando el audio con ffmpeg…";
    const { findFfmpeg } = await import("@/lib/avatar-server");
    const ffmpeg = await findFfmpeg(dir);
    if (!ffmpeg) throw new Error("No encuentro ffmpeg en este equipo (hace falta para leer el audio del archivo).");
    const conv = await runCmd(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", up.file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeoutMs: 30 * 60_000, what: "ffmpeg" });
    if (conv.code !== 0 || !(await exists(wav))) throw new Error(`ffmpeg no pudo leer el audio de «${up.name}»: ${lastLines(conv.err)}`);
    const seconds = Math.max(0, ((await fs.stat(wav)).size - 44) / 32000);
    if (seconds < 0.5) throw new Error(`«${up.name}» no tiene audio (o dura menos de medio segundo).`);
    // Sitio en la gráfica: fuera Chatterbox y lo que tengan cargado Ollama y ComfyUI.
    job.text = "Haciendo sitio en la tarjeta gráfica…";
    await stopChatterbox().catch(() => undefined);
    await makeRoomOnGpu(dir).catch(() => undefined);
    await ensureScript(p.runScript, RUN_SCRIPT);
    const started = Date.now();
    const say = () => { job.text = `Transcribiendo ${minutes(seconds)} de audio (la primera vez tarda más en cargar el modelo) · lleva ${minutes((Date.now() - started) / 1000)}`; };
    say();
    tick = setInterval(say, 2000);
    const env: Record<string, string> = {
      PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONWARNINGS: "ignore", TRANSFORMERS_VERBOSITY: "error", TQDM_DISABLE: "1", TOKENIZERS_PARALLELISM: "false",
      HF_HOME: p.hf, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
    };
    const r = await runCmd(p.python, [p.runScript, "auto", wav, out, language, STT_MODEL], { env, timeoutMs: 20 * 60_000 + seconds * 4000, what: "La transcripción" });
    if (r.code !== 0 || !(await exists(out))) throw new Error(`Whisper ha fallado: ${lastLines(r.err)}`);
    const data = JSON.parse(await fs.readFile(out, "utf8")) as Record<string, unknown>;
    const segments = (Array.isArray(data["segments"]) ? (data["segments"] as unknown[]) : [])
      .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
      .map((s) => ({ start: Number(s["start"]) || 0, end: Number(s["end"]) || 0, text: str(s["text"], 2000).trim() }))
      .filter((s) => s.text);
    job.result = {
      text: str(data["text"], 2_000_000).trim(),
      segments,
      seconds,
      device: str(data["device"], 10) || "?",
      cudaError: str(data["cudaError"], 300),
      name: up.name,
    };
    job.text = job.result.text
      ? `Transcrito: ${minutes(seconds)} de audio en ${minutes((Date.now() - started) / 1000)}${job.result.device === "cuda" ? " con la tarjeta gráfica" : " con el procesador"}.`
      : "No se ha oído ninguna frase en ese archivo.";
    finish(job);
  } catch (error) {
    finish(job, errText(error));
  } finally {
    if (tick) clearInterval(tick);
    uploads.delete(up.id);
    await fs.rm(up.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ------------------------------------------------------------------------------------------------ acciones (/api/voces)
export async function sttAction(dir: string, action: string, body: Record<string, unknown>): Promise<VoicesResult> {
  const { fs, path, os, crypto } = await mods();

  if (action === "stt-status") {
    const p = await sttPaths(dir);
    const engine = (await exists(p.python)) && (await exists(p.chatterboxMarker));
    let gpu = "";
    try { gpu = String((JSON.parse(await fs.readFile(p.chatterboxMarker, "utf8")) as Record<string, unknown>)["gpu"] ?? ""); } catch { /* sin Chatterbox */ }
    return { ok: true, engine, ready: engine && (await modelReady(p)), model: STT_MODEL, gb: STT_GB, gpu, chunk: STT_CHUNK, maxFile: STT_MAX_FILE, job: show(current) };
  }

  if (action === "stt-job") {
    const job = jobs.get(str(body["id"], 40));
    return job ? { ok: true, job: show(job) } : { error: "No encuentro ese trabajo (¿se ha reiniciado WILLY?)." };
  }

  if (action === "stt-prepare") {
    const p = await sttPaths(dir);
    if (!((await exists(p.python)) && (await exists(p.chatterboxMarker)))) return { error: "Falta el motor de IA: instala primero Chatterbox en Lectura → Voces más humanas." };
    if (await modelReady(p)) return { ok: true, ready: true };
    if (current) return current.kind === "preparar" ? { ok: true, job: show(current) } : { error: "Hay una transcripción en marcha: espera a que termine." };
    const job = newJob("preparar", crypto.randomBytes(6).toString("hex"), "Empezando la descarga del modelo de Whisper…");
    void prepare(dir, job);
    return { ok: true, job: show(job) };
  }

  if (action === "stt-begin") {
    const size = Number(body["size"]);
    const name = str(body["name"], 180).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "archivo";
    if (!Number.isFinite(size) || size <= 0) return { error: "El archivo está vacío." };
    if (size > STT_MAX_FILE) return { error: "El archivo es demasiado grande (máximo 2 GB)." };
    // Subidas a medias de hace más de 2 horas: fuera.
    const now = Date.now();
    for (const [key, old] of uploads) {
      if (now - old.at > 2 * 60 * 60_000) { uploads.delete(key); await fs.rm(old.dir, { recursive: true, force: true }).catch(() => undefined); }
    }
    const id = crypto.randomBytes(8).toString("hex");
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "willy-transcribir-"));
    const ext = path.extname(name).slice(0, 8) || ".bin";
    const up: Upload = { id, dir: folder, file: path.join(folder, `entrada${ext}`), name, size, received: 0, next: 0, at: now };
    await fs.writeFile(up.file, new Uint8Array(0));
    uploads.set(id, up);
    return { ok: true, upload: id, chunk: STT_CHUNK };
  }

  if (action === "stt-chunk") {
    const up = uploads.get(str(body["upload"], 40));
    if (!up) return { error: "La subida ya no existe: vuelve a elegir el archivo." };
    if (Number(body["index"]) !== up.next) return { error: "Se ha perdido un trozo del archivo: vuelve a elegirlo." };
    const bytes = Buffer.from(str(body["data"], 20 * 2 ** 20), "base64");
    if (!bytes.length || bytes.length > STT_CHUNK || up.received + bytes.length > up.size) return { error: "Trozo del archivo no válido: vuelve a elegirlo." };
    await fs.appendFile(up.file, bytes);
    up.received += bytes.length;
    up.next += 1;
    up.at = Date.now();
    return { ok: true, received: up.received };
  }

  if (action === "stt-run") {
    const up = uploads.get(str(body["upload"], 40));
    if (!up) return { error: "La subida ya no existe: vuelve a elegir el archivo." };
    if (up.received !== up.size) return { error: "El archivo no ha llegado entero: vuelve a elegirlo." };
    const language = str(body["language"], 8) || "es";
    if (!LANGS.has(language)) return { error: "Idioma no válido." };
    const p = await sttPaths(dir);
    if (!(await modelReady(p))) return { error: "Primero hay que preparar la transcripción (botón «Preparar»)." };
    if (current) return { error: current.kind === "preparar" ? "Se está descargando el modelo: espera a que termine." : "Ya hay una transcripción en marcha: espera a que termine." };
    const job = newJob("transcribir", crypto.randomBytes(6).toString("hex"), `Preparando «${up.name}»…`);
    void transcribe(dir, job, up, language);
    return { ok: true, job: show(job) };
  }

  return { error: "Acción desconocida." };
}
