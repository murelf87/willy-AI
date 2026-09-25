// Voz local con Piper (gratis, sin internet). Se ejecuta el programa SIN intérprete de comandos (sin shell): solo con argumentos.
// Sirve tanto el `piper.exe` clásico como `python -m piper` (pip install piper-tts): las dos formas aceptan -m (voz) y -f (archivo).

export type PiperCfg = {
  mode: "exe" | "python";
  exe: string;
  model: string;
  /** Ritmo real de la voz (no un truco de velocidad sobre el audio ya grabado): 0.7 = rápido, 1.0 = normal, 1.6 = muy pausado. */
  lengthScale?: number;
  /** Silencio real entre frases, en segundos: así la voz respira y no suena atropellada. */
  sentenceSilence?: number;
  /** Persona dentro de la voz: algunas voces traen varias en el mismo archivo (Sharvard: 0 = hombre, 1 = mujer). */
  speaker?: number;
};
export type PiperDeps = { spawnImpl?: typeof import("node:child_process").spawn; timeoutMs?: number };

const BAD = /[\u0000-\u001f]/;

export async function piperStatus(cfg: PiperCfg): Promise<{ ok: boolean; message: string }> {
  const fs = await import("node:fs/promises");
  if (!cfg.model) return { ok: false, message: "Falta elegir una voz de Piper (archivo .onnx)." };
  if (!/\.onnx$/i.test(cfg.model) || BAD.test(cfg.model)) return { ok: false, message: "La voz tiene que ser un archivo .onnx." };
  try {
    if (!(await fs.stat(cfg.model)).isFile()) throw new Error("no es un archivo");
  } catch {
    return { ok: false, message: `No encuentro la voz: ${cfg.model}` };
  }
  if (cfg.mode === "exe") {
    try {
      if (!cfg.exe || BAD.test(cfg.exe) || !(await fs.stat(cfg.exe)).isFile()) throw new Error("no es un archivo");
    } catch {
      return { ok: false, message: `No encuentro piper.exe en: ${cfg.exe || "(sin ruta)"}` };
    }
  }
  return { ok: true, message: "Lista." };
}

/** Voces disponibles en una carpeta (archivos .onnx). */
export async function listVoices(dir: string): Promise<Array<{ name: string; path: string }>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  if (!dir || BAD.test(dir)) return [];
  try {
    return (await fs.readdir(dir)).filter((name) => /\.onnx$/i.test(name)).sort().slice(0, 80).map((name) => ({ name: name.replace(/\.onnx$/i, ""), path: path.join(dir, name) }));
  } catch {
    return [];
  }
}

export type VoiceOption = { id: string; name: string; path: string; speaker?: number };

/**
 * Voces para elegir, UNA POR PERSONA: si un archivo trae varias (su .onnx.json lo dice en «speaker_id_map»), cada una sale
 * aparte. La primera conserva el nombre del archivo (así lo ya elegido sigue valiendo) y las demás llevan «#» y su clave:
 * es_ES-sharvard-medium = hombre, es_ES-sharvard-medium#F = mujer.
 */
export async function listVoiceOptions(dir: string): Promise<VoiceOption[]> {
  const fs = await import("node:fs/promises");
  const out: VoiceOption[] = [];
  for (const voice of await listVoices(dir)) {
    let people: Array<[string, number]> = [];
    try {
      const meta = JSON.parse(await fs.readFile(`${voice.path}.json`, "utf8")) as { num_speakers?: number; speaker_id_map?: Record<string, unknown> };
      if ((meta.num_speakers ?? 1) > 1 && meta.speaker_id_map && typeof meta.speaker_id_map === "object") {
        people = Object.entries(meta.speaker_id_map)
          .filter((entry): entry is [string, number] => /^[\w-]{1,24}$/.test(entry[0]) && Number.isInteger(entry[1]) && (entry[1] as number) >= 0 && (entry[1] as number) < 1000)
          .sort((a, b) => a[1] - b[1]);
      }
    } catch { /* sin datos de la voz: una sola persona */ }
    if (people.length < 2) { out.push({ id: voice.name, name: voice.name, path: voice.path }); continue; }
    people.forEach(([key, speaker], i) => {
      const id = i === 0 ? voice.name : `${voice.name}#${key}`;
      out.push({ id, name: id, path: voice.path, speaker });
    });
  }
  return out;
}

export async function piperSpeak(cfg: PiperCfg, text: string, deps: PiperDeps = {}): Promise<Uint8Array> {
  const clean = text.replace(/\r/g, "").trim();
  if (!clean) throw new Error("No hay texto que leer.");
  if (clean.length > 6000) throw new Error("El texto es demasiado largo para una sola voz (máximo 6.000 caracteres): divídelo en partes.");
  const status = await piperStatus(cfg);
  if (!status.ok) throw new Error(status.message);
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const spawn = deps.spawnImpl ?? (await import("node:child_process")).spawn;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "willy-piper-"));
  const out = path.join(dir, "voz.wav");
  try {
    const command = cfg.mode === "python" ? cfg.exe || "python" : cfg.exe;
    // --length_scale (ritmo) y --sentence_silence (pausa entre frases) son parámetros reales del propio
    // motor Piper: la voz se genera ya pausada y con el ritmo pedido, no se simula acelerando el audio.
    const pace: string[] = [];
    if (cfg.lengthScale && cfg.lengthScale > 0) pace.push("--length_scale", cfg.lengthScale.toFixed(2));
    if (cfg.sentenceSilence != null && cfg.sentenceSilence >= 0) pace.push("--sentence_silence", cfg.sentenceSilence.toFixed(2));
    // --speaker elige la persona dentro de la voz (solo hace falta si no es la primera, la 0).
    if (cfg.speaker != null && Number.isInteger(cfg.speaker) && cfg.speaker > 0) pace.push("--speaker", String(cfg.speaker));
    const args = cfg.mode === "python" ? ["-m", "piper", "-m", cfg.model, "-f", out, ...pace] : ["-m", cfg.model, "-f", out, ...pace];
    await new Promise<void>((resolve, reject) => {
      let stderr = "";
      const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
      const timer = setTimeout(() => { child.kill(); reject(new Error("Piper tardó demasiado (más de 2 minutos).")); }, deps.timeoutMs ?? 120_000);
      child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-1500); });
      child.on("error", (error: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new Error(error.code === "ENOENT" ? (cfg.mode === "python" ? "No encuentro Python o el paquete piper-tts (pip install piper-tts)." : "No pude ejecutar piper.exe.") : `No pude ejecutar Piper: ${error.message}`)); });
      child.on("close", (code: number | null) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Piper terminó con error ${code}: ${stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300) || "sin detalle"}`)); });
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(`${clean}\n`, "utf8");
    });
    const bytes = new Uint8Array(await fs.readFile(out));
    if (bytes.length < 100 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF") throw new Error("Piper no produjo un audio válido.");
    return bytes;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ------------------------------------------------------------------------------------------------ Hugging Face (respaldo opcional, con clave)
export type HfCfg = { enabled: boolean; model: string; token: string };
const HF_HOST = "router.huggingface.co";

/** Voz por la API de Hugging Face (solo si la activas y pones tu clave). Solo se llama a router.huggingface.co. */
export async function hfSpeak(cfg: HfCfg, text: string, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Uint8Array; ext: string }> {
  if (!cfg.enabled) throw new Error("Hugging Face está desactivado.");
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.model)) throw new Error("Falta el modelo de voz de Hugging Face (por ejemplo facebook/mms-tts-spa).");
  if (!cfg.token) throw new Error("Falta la clave de Hugging Face.");
  const url = new URL(`https://${HF_HOST}/hf-inference/models/${cfg.model}`);
  if (url.hostname !== HF_HOST) throw new Error("Dirección no permitida.");
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 1500);
  const res = await fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", Accept: "audio/*" }, body: JSON.stringify({ inputs: clean }), signal: AbortSignal.timeout(90_000) });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || /json|text/i.test(type)) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new Error("Hugging Face rechazó la clave (401/403).");
    if (res.status === 429) throw new Error("Hugging Face ha limitado las consultas gratuitas. Espera un rato.");
    if (res.status === 503) throw new Error("El modelo de Hugging Face se está cargando o no está disponible ahora.");
    throw new Error(`Hugging Face respondió ${res.status}${body ? `: ${body.replace(/\s+/g, " ")}` : ""}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const magic = String.fromCharCode(...bytes.slice(0, 4));
  const ext = magic === "RIFF" ? "wav" : magic === "fLaC" ? "flac" : magic === "OggS" ? "ogg" : magic.startsWith("ID3") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) ? "mp3" : "";
  if (!ext) throw new Error("Hugging Face no devolvió un audio reconocible.");
  return { bytes, ext };
}
