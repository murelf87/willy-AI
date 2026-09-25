// Más voces de España además de Piper, para que WILLY lea como una PERSONA y no como un robot:
//  · Gemini (Google, gratis con cupo diario): la más humana. Usa la clave de Gemini que ya tienes en Motores y se deja
//    «dirigir» con un estilo de lectura (natural, narrador, expresivo…) y un ritmo.
//  · Kokoro (local, gratis, sin internet una vez instalada): se instala sola en datos-privados/voces-motores con uv, en un
//    Python PROPIO (no toca el Python del sistema ni el de ComfyUI).
//  · ElevenLabs (nube, gratis ≈ 10 min al mes): calidad muy alta; usa TU clave de ElevenLabs y las voces de tu cuenta.
//  · Google Chirp 3 HD (nube, 1 millón de caracteres gratis al mes, pero Google exige tener la facturación activada):
//    las 30 voces HD de Google en español de España, con TU clave de Google Cloud.
// Seguridad: solo se descarga desde direcciones FIJAS (GitHub, y PyPI a través de uv) y solo se habla con
// generativelanguage.googleapis.com, api.elevenlabs.io y texttospeech.googleapis.com. Las claves se guardan en este equipo
// (datos-privados/voces-motores/claves.json) y nunca se devuelven a la pantalla (solo sus 4 últimos caracteres).

import { loadState } from "@/lib/engines-server";
import { concatWav } from "@/lib/wav";
import { cleanForSpeech } from "@/lib/voz-limpia";

// ------------------------------------------------------------------------------------------------ ajustes
export type GeminiPace = "pausado" | "normal" | "agil";
export type ElevenModel = "eleven_multilingual_v2" | "eleven_v3" | "eleven_flash_v2_5";
export type ExtraCfg = {
  /** Voz elegida cuando no es de Piper («kokoro:ef_dora», «gemini:Sulafat», «eleven:<id>», «chirp:Sulafat»…). Vacío = la de Piper. */
  active: string;
  gemini: { added: string[]; library: Array<{ id: string; label: string }>; style: string; custom: string; pace: GeminiPace };
  kokoro: { speed: number; sentencePause: number; gpu: boolean; gpuNote: string };
  /** stability: más bajo = más expresiva; similarity: parecido a la voz original; style: exageración del estilo; speed: velocidad. */
  eleven: { voices: Array<{ id: string; label: string }>; model: ElevenModel; stability: number; similarity: number; style: number; speed: number };
  chirp: { added: string[]; rate: number };
  /** «Solo voces naturales» (lo pidió el dueño): sin voces básicas de Piper, sin volver nunca a ellas y sin instalarlas solas. */
  onlyNatural: boolean;
};
export const EXTRA_DEFAULTS: ExtraCfg = {
  active: "",
  gemini: { added: ["Sulafat", "Achird"], library: [], style: "natural", custom: "", pace: "normal" },
  kokoro: { speed: 1, sentencePause: 0.4, gpu: false, gpuNote: "" },
  eleven: { voices: [], model: "eleven_multilingual_v2", stability: 0.45, similarity: 0.8, style: 0.25, speed: 1 },
  chirp: { added: ["Sulafat", "Achird"], rate: 1 },
  onlyNatural: false,
};
export const ELEVEN_MODELS: Array<{ id: ElevenModel; label: string }> = [
  { id: "eleven_multilingual_v2", label: "Multilingüe v2 (la más natural y estable)" },
  { id: "eleven_v3", label: "v3 (la más expresiva, con emociones)" },
  { id: "eleven_flash_v2_5", label: "Flash 2.5 (rápida, gasta la mitad de créditos)" },
];

export type GeminiVoice = { id: string; gender: "mujer" | "hombre"; tone: string; top?: boolean };
// Las 30 voces de Gemini (las mismas que Chirp 3 HD). Hombre/mujer según la lista oficial de Google Cloud.
export const GEMINI_VOICES: GeminiVoice[] = [
  { id: "Sulafat", gender: "mujer", tone: "cálida", top: true },
  { id: "Achernar", gender: "mujer", tone: "dulce", top: true },
  { id: "Vindemiatrix", gender: "mujer", tone: "delicada", top: true },
  { id: "Kore", gender: "mujer", tone: "firme", top: true },
  { id: "Achird", gender: "hombre", tone: "cercana", top: true },
  { id: "Charon", gender: "hombre", tone: "informativa", top: true },
  { id: "Iapetus", gender: "hombre", tone: "clara", top: true },
  { id: "Algieba", gender: "hombre", tone: "suave", top: true },
  { id: "Zephyr", gender: "mujer", tone: "luminosa" },
  { id: "Leda", gender: "mujer", tone: "juvenil" },
  { id: "Aoede", gender: "mujer", tone: "desenfadada" },
  { id: "Callirrhoe", gender: "mujer", tone: "relajada" },
  { id: "Autonoe", gender: "mujer", tone: "luminosa" },
  { id: "Despina", gender: "mujer", tone: "suave" },
  { id: "Erinome", gender: "mujer", tone: "clara" },
  { id: "Laomedeia", gender: "mujer", tone: "animada" },
  { id: "Gacrux", gender: "mujer", tone: "madura" },
  { id: "Pulcherrima", gender: "mujer", tone: "directa" },
  { id: "Puck", gender: "hombre", tone: "animada" },
  { id: "Fenrir", gender: "hombre", tone: "enérgica" },
  { id: "Orus", gender: "hombre", tone: "firme" },
  { id: "Enceladus", gender: "hombre", tone: "susurrante" },
  { id: "Umbriel", gender: "hombre", tone: "relajada" },
  { id: "Algenib", gender: "hombre", tone: "grave" },
  { id: "Rasalgethi", gender: "hombre", tone: "informativa" },
  { id: "Alnilam", gender: "hombre", tone: "firme" },
  { id: "Schedar", gender: "hombre", tone: "serena" },
  { id: "Zubenelgenubi", gender: "hombre", tone: "informal" },
  { id: "Sadachbia", gender: "hombre", tone: "viva" },
  { id: "Sadaltager", gender: "hombre", tone: "experta" },
];

// Cómo tiene que LEER (Gemini entiende instrucciones de estilo): lo importante es que no suene leído ni robótico.
export const GEMINI_STYLES: Array<{ id: string; label: string; text: string }> = [
  { id: "natural", label: "Natural (como una persona hablando)", text: "Habla con naturalidad, como una persona real que le cuenta algo a alguien cercano: entonación viva, pausas y respiraciones naturales, nada de tono leído ni robótico." },
  { id: "narrador", label: "Narrador de audiolibro", text: "Narra con calidez y calma, como un buen narrador de audiolibros: pausas naturales entre frases, énfasis en lo importante y una entonación que acompaña al sentido del texto." },
  { id: "expresivo", label: "Expresivo (con emoción)", text: "Lee con emoción y expresividad, como un actor de doblaje: varía la entonación según lo que dice el texto, con naturalidad y sin exagerar." },
  { id: "profesional", label: "Locutor profesional", text: "Tono claro, seguro y profesional, como un locutor de radio: dicción muy clara, ritmo constante y pausas bien marcadas." },
  { id: "cercano", label: "Suave y cercano", text: "Voz suave, tranquila y cercana, como si hablaras con alguien sentado a tu lado." },
];
const PACE_TEXT: Record<GeminiPace, string> = { pausado: "Ritmo pausado, sin prisa.", normal: "Ritmo natural de conversación.", agil: "Ritmo ágil, sin atropellarse." };

export function geminiStyleText(cfg: ExtraCfg["gemini"]): string {
  const custom = cfg.style === "personal" ? cfg.custom.trim() : "";
  const base = custom || (GEMINI_STYLES.find((s) => s.id === cfg.style) ?? GEMINI_STYLES[0]!).text;
  return `${base} ${PACE_TEXT[cfg.pace]}`.slice(0, 700);
}

export const KOKORO_VOICES: Array<{ id: string; label: string }> = [
  { id: "ef_dora", label: "Kokoro · Dora (mujer)" },
  { id: "em_alex", label: "Kokoro · Alex (hombre)" },
];

const LIB_ID = /^[\w.:/-]{1,120}$/;
const ELEVEN_ID = /^[A-Za-z0-9]{10,40}$/;
export function isExtraId(id: string): boolean {
  if (id.startsWith("kokoro:")) return KOKORO_VOICES.some((v) => v.id === id.slice(7));
  if (id.startsWith("eleven:")) return ELEVEN_ID.test(id.slice(7));
  if (id.startsWith("chirp:")) return GEMINI_VOICES.some((v) => v.id === id.slice(6));
  if (id.startsWith("chatterbox:")) return ["dora", "alex", "propia"].includes(id.slice(11));
  if (id.startsWith("gemini:lib:")) return LIB_ID.test(id.slice(11));
  if (id.startsWith("gemini:")) return GEMINI_VOICES.some((v) => v.id === id.slice(7));
  return false;
}

const num = (value: unknown, base: number, min: number, max: number): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : base;
};
const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

export function sanitizeExtra(raw: unknown, base: ExtraCfg = EXTRA_DEFAULTS): ExtraCfg {
  const data = rec(raw), g = rec(data["gemini"]), k = rec(data["kokoro"]), e = rec(data["eleven"]), c = rec(data["chirp"]);
  const added = Array.isArray(g["added"]) ? [...new Set(g["added"].filter((id): id is string => typeof id === "string" && GEMINI_VOICES.some((v) => v.id === id)))].slice(0, 30) : base.gemini.added;
  const library = Array.isArray(g["library"])
    ? g["library"].flatMap((entry) => { const e = rec(entry); const id = text(e["id"], 120); return LIB_ID.test(id) ? [{ id, label: text(e["label"], 80) || id }] : []; }).slice(0, 20)
    : base.gemini.library;
  const style = typeof g["style"] === "string" && (g["style"] === "personal" || GEMINI_STYLES.some((s) => s.id === g["style"])) ? g["style"] : base.gemini.style;
  const pace: GeminiPace = g["pace"] === "pausado" || g["pace"] === "normal" || g["pace"] === "agil" ? g["pace"] : base.gemini.pace;
  const active = typeof data["active"] === "string" ? (data["active"] === "" || isExtraId(data["active"]) ? data["active"] : "") : base.active;
  return {
    active,
    gemini: { added, library, style, custom: g["custom"] === undefined ? base.gemini.custom : text(g["custom"], 400), pace },
    kokoro: { speed: num(k["speed"], base.kokoro.speed, 0.7, 1.3), sentencePause: num(k["sentencePause"], base.kokoro.sentencePause, 0.1, 1.2), gpu: k["gpu"] === undefined ? base.kokoro.gpu : k["gpu"] === true, gpuNote: k["gpuNote"] === undefined ? base.kokoro.gpuNote : text(k["gpuNote"], 240) },
    eleven: {
      voices: Array.isArray(e["voices"])
        ? e["voices"].flatMap((entry) => { const v = rec(entry); const id = text(v["id"], 40); return ELEVEN_ID.test(id) ? [{ id, label: text(v["label"], 60) || id }] : []; }).slice(0, 20)
        : base.eleven.voices,
      model: ELEVEN_MODELS.some((m) => m.id === e["model"]) ? (e["model"] as ElevenModel) : base.eleven.model,
      stability: num(e["stability"], base.eleven.stability, 0, 1),
      similarity: num(e["similarity"], base.eleven.similarity, 0, 1),
      style: num(e["style"], base.eleven.style, 0, 1),
      speed: num(e["speed"], base.eleven.speed, 0.7, 1.2),
    },
    chirp: {
      added: Array.isArray(c["added"]) ? [...new Set(c["added"].filter((id): id is string => typeof id === "string" && GEMINI_VOICES.some((v) => v.id === id)))].slice(0, 30) : base.chirp.added,
      rate: num(c["rate"], base.chirp.rate, 0.75, 1.3),
    },
    onlyNatural: data["onlyNatural"] === undefined ? base.onlyNatural : data["onlyNatural"] === true,
  };
}

async function mods() {
  return { fs: await import("node:fs/promises"), path: await import("node:path"), os: await import("node:os") };
}

export type Paths = { root: string; cfg: string; keys: string; uvDir: string; uvExe: string; kdir: string; venv: string; python: string; model: string; voices: string; script: string; server: string; marker: string };
export async function pathsFor(dir: string, platform: string): Promise<Paths> {
  const { path } = await mods();
  const win = platform === "win32";
  const root = path.join(dir, "voces-motores");
  const kdir = path.join(root, "kokoro");
  return {
    root,
    cfg: path.join(root, "ajustes.json"),
    keys: path.join(root, "claves.json"),
    uvDir: path.join(root, "uv"),
    uvExe: path.join(root, "uv", win ? "uv.exe" : "uv"),
    kdir,
    venv: path.join(kdir, "venv"),
    python: path.join(kdir, "venv", win ? "Scripts" : "bin", win ? "python.exe" : "python"),
    model: path.join(kdir, "kokoro-v1.0.onnx"),
    voices: path.join(kdir, "voices-v1.0.bin"),
    script: path.join(kdir, "willy_kokoro.py"),
    server: path.join(kdir, "willy_kokoro_srv.py"),
    marker: path.join(kdir, "listo.json"),
  };
}

export async function loadExtra(dir: string): Promise<ExtraCfg> {
  const { fs } = await mods();
  try {
    return sanitizeExtra(JSON.parse(await fs.readFile((await pathsFor(dir, process.platform)).cfg, "utf8")));
  } catch {
    return structuredClone(EXTRA_DEFAULTS);
  }
}
export async function saveExtra(dir: string, cfg: ExtraCfg): Promise<void> {
  const { fs, path } = await mods();
  const file = (await pathsFor(dir, process.platform)).cfg;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(sanitizeExtra(cfg), null, 2), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}

// Claves de ElevenLabs y de Google Cloud: solo en este equipo, en un archivo aparte, y nunca de vuelta a la pantalla.
export type ExtraKeys = { elevenlabs: string; google: string };
const KEY_FORMAT: Record<keyof ExtraKeys, RegExp> = { elevenlabs: /^[\w-]{20,200}$/, google: /^[\w-]{30,80}$/ };
export async function loadKeys(dir: string): Promise<ExtraKeys> {
  const { fs } = await mods();
  try {
    const data = rec(JSON.parse(await fs.readFile((await pathsFor(dir, process.platform)).keys, "utf8")));
    const pick = (name: keyof ExtraKeys) => { const v = typeof data[name] === "string" ? String(data[name]).trim() : ""; return KEY_FORMAT[name].test(v) ? v : ""; };
    return { elevenlabs: pick("elevenlabs"), google: pick("google") };
  } catch {
    return { elevenlabs: "", google: "" };
  }
}
async function saveKey(dir: string, name: keyof ExtraKeys, value: string): Promise<void> {
  const { fs, path } = await mods();
  const file = (await pathsFor(dir, process.platform)).keys;
  const keys = { ...(await loadKeys(dir)), [name]: value };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(keys, null, 2), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
  await fs.chmod(file, 0o600).catch(() => undefined);
}

// ------------------------------------------------------------------------------------------------ WAV
export function pcmToWav(pcm: Uint8Array, rate = 24000, channels = 1, bits = 16): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const dv = new DataView(out.buffer);
  const put = (o: number, s: string) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  const block = (channels * bits) / 8;
  put(0, "RIFF"); dv.setUint32(4, 36 + pcm.byteLength, true); put(8, "WAVE"); put(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, channels, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * block, true); dv.setUint16(32, block, true); dv.setUint16(34, bits, true);
  put(36, "data"); dv.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}
const isRiff = (b: Uint8Array) => b.length > 44 && String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0) === "RIFF";

/** Parte un texto largo por frases para no pasar del máximo de cada servicio (caracteres y, en Google, bytes). */
export function splitForTts(input: string, maxChars: number, maxBytes = Number.POSITIVE_INFINITY): string[] {
  const clean = input.replace(/\s+/g, " ").trim();
  const fits = (piece: string) => piece.length <= maxChars && Buffer.byteLength(piece, "utf8") <= maxBytes;
  if (!clean) return [];
  if (fits(clean)) return [clean];
  const out: string[] = [];
  let current = "";
  const flush = () => { if (current.trim()) out.push(current.trim()); current = ""; };
  for (const sentence of clean.match(/[^.!?…]+[.!?…]*\s*/g) ?? [clean]) {
    if (!fits(sentence)) {
      flush();
      let piece = "";
      for (const word of sentence.split(" ")) {
        const next = piece ? `${piece} ${word}` : word;
        if (fits(next)) piece = next;
        else { if (piece) out.push(piece); piece = word.slice(0, maxChars); }
      }
      if (piece.trim()) out.push(piece.trim());
      continue;
    }
    if (!fits(current + sentence)) flush();
    current += sentence;
  }
  flush();
  return out;
}
export async function speakInParts(parts: string[], one: (piece: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  if (!parts.length) throw new Error("No hay texto que leer.");
  const wavs: Uint8Array[] = [];
  for (const piece of parts) wavs.push(await one(piece));
  return wavs.length === 1 ? wavs[0]! : concatWav(wavs, 200);
}

// ------------------------------------------------------------------------------------------------ Gemini (nube, gratis con cupo)
const GEMINI_HOST = "generativelanguage.googleapis.com";
type Shape = { model: string; modern: boolean; lang: boolean };
// Se prueba en este orden y se RECUERDA el que funciona (para no gastar cupo en intentos fallidos cada vez).
// «modern» = formato de los modelos 3.8 (voice + speech_metadata.style); si no, el clásico (prebuiltVoiceConfig + estilo en el texto).
export const GEMINI_SHAPES: Shape[] = [
  { model: "gemini-3.8-flash-tts", modern: true, lang: true },
  { model: "gemini-3.8-flash-tts", modern: true, lang: false },
  { model: "gemini-3.8-flash-tts", modern: false, lang: true },
  { model: "gemini-3.1-flash-tts-preview", modern: false, lang: true },
  { model: "gemini-3.1-flash-tts-preview", modern: false, lang: false },
  { model: "gemini-3.8-flash-lite-tts", modern: true, lang: true },
];
let geminiOk: Shape | null = null;
export const resetExtraState = (): void => { geminiOk = null; void stopKokoroWorker(); };
export const geminiWorking = (): string => (geminiOk ? geminiOk.model : "");

export async function geminiKey(dir: string): Promise<string> {
  try {
    const key = (await loadState(dir)).engines["gemini"]?.key ?? "";
    return typeof key === "string" ? key.trim() : "";
  } catch {
    return "";
  }
}

function geminiBody(shape: Shape, voice: string, spoken: string, style: string): Record<string, unknown> {
  const name = voice.startsWith("lib:") ? voice.slice(4) : voice;
  const accent = shape.lang ? "" : " Acento: español de España (castellano).";
  const part = shape.modern
    ? { text: spoken, speech_metadata: { style: `${style}${accent}` } }
    : { text: `${style} Habla en español de España, con acento castellano: ${spoken}` };
  const voiceConfig = shape.modern ? { voice: name } : { prebuiltVoiceConfig: { voiceName: name } };
  return { contents: [{ role: "user", parts: [part] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig, ...(shape.lang ? { languageCode: "es-ES" } : {}) } } };
}

function briefError(raw: string, key: string): string {
  let message = raw;
  try { message = String(rec(rec(JSON.parse(raw))["error"])["message"] ?? raw); } catch { /* texto tal cual */ }
  return (key ? message.split(key).join("…") : message).replace(/\s+/g, " ").trim().slice(0, 180);
}

function extractAudio(raw: string): Uint8Array | null {
  let data: Record<string, unknown>;
  try { data = rec(JSON.parse(raw)); } catch { return null; }
  const candidates = Array.isArray(data["candidates"]) ? data["candidates"] : [];
  const parts = rec(rec(candidates[0])["content"])["parts"];
  for (const part of Array.isArray(parts) ? parts : []) {
    const inline = rec(rec(part)["inlineData"] ?? rec(part)["inline_data"]);
    const b64 = typeof inline["data"] === "string" ? inline["data"] : "";
    if (!b64) continue;
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    if (bytes.length < 200) continue;
    if (isRiff(bytes)) return bytes;
    const mime = String(inline["mimeType"] ?? inline["mime_type"] ?? "");
    const rate = Number(/rate=(\d+)/i.exec(mime)?.[1] ?? 24000);
    return pcmToWav(bytes.byteLength % 2 ? bytes.slice(0, -1) : bytes, Number.isFinite(rate) && rate >= 8000 && rate <= 48000 ? rate : 24000);
  }
  return null;
}

export async function geminiSpeak(key: string, voice: string, spoken: string, style: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  if (!key) throw new Error("Falta tu clave de Gemini: añádela en Motores (es la misma que usa WILLY para pensar).");
  const clean = spoken.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!clean) throw new Error("No hay texto que leer.");
  const library = voice.startsWith("lib:");
  const usable = GEMINI_SHAPES.filter((s) => !library || s.modern);
  const order = geminiOk && usable.includes(geminiOk) ? [geminiOk, ...usable.filter((s) => s !== geminiOk)] : usable;
  const fails: string[] = [];
  let quota = 0;
  for (const shape of order) {
    const url = new URL(`https://${GEMINI_HOST}/v1beta/models/${shape.model}:generateContent`);
    if (url.hostname !== GEMINI_HOST) throw new Error("Dirección no permitida.");
    let res: Response;
    try {
      res = await fetchImpl(url, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(geminiBody(shape, voice, clean, style)), signal: AbortSignal.timeout(90_000) });
    } catch {
      fails.push(`${shape.model}: sin respuesta`);
      continue;
    }
    const raw = await res.text().catch(() => "");
    if (res.status === 401 || /API_KEY_INVALID|API key not valid/i.test(raw)) { geminiOk = null; throw new Error("Google ha rechazado tu clave de Gemini. Revísala en Motores."); }
    if (res.status === 429) { quota += 1; fails.push(`${shape.model}: cupo gratuito agotado`); continue; }
    if (!res.ok) { fails.push(`${shape.model}${shape.modern ? "" : " (formato clásico)"}${shape.lang ? "" : " sin idioma"}: ${res.status} ${briefError(raw, key)}`); continue; }
    const audio = extractAudio(raw);
    if (!audio) { fails.push(`${shape.model}: respondió sin audio`); continue; }
    geminiOk = shape;
    return audio;
  }
  geminiOk = null;
  if (quota && fails.every((f) => /cupo|sin respuesta|404/.test(f))) throw new Error("Se ha acabado el cupo gratuito de voz de Gemini por ahora (Google lo renueva cada día a las 9:00, hora de España). Mientras, WILLY lee con otra de tus voces (si tienes Chatterbox, sin internet).");
  throw new Error(`Gemini no ha podido crear la voz. ${fails.slice(0, 4).join(" · ")}`);
}

/** Voces de la biblioteca de Google con acento de España (si tu clave gratuita tiene acceso a ella). */
export async function geminiLibrary(dir: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; voices: Array<{ id: string; label: string; gender: string; accent: string; description: string }> } | { ok: false; error: string }> {
  const key = await geminiKey(dir);
  if (!key) return { ok: false, error: "Falta tu clave de Gemini (ponla en Motores)." };
  const url = new URL(`https://${GEMINI_HOST}/v1beta/voices`);
  url.searchParams.set("language_code", "es-ES");
  url.searchParams.set("page_size", "100");
  try {
    const res = await fetchImpl(url, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(30_000) });
    const raw = await res.text();
    if (!res.ok) return { ok: false, error: `Google no deja ver su biblioteca de voces con esta clave (${res.status}: ${briefError(raw, key)}).` };
    const list = rec(JSON.parse(raw))["voices"];
    const voices = (Array.isArray(list) ? list : []).flatMap((entry) => {
      const v = rec(entry);
      const id = text(v["id"] ?? v["name"], 120).replace(/^voices\//, "");
      const lang = text(v["language_code"] ?? v["languageCode"], 20);
      if (!LIB_ID.test(id) || (lang && !/^es-ES/i.test(lang))) return [];
      return [{ id, label: text(v["display_name"] ?? v["displayName"], 60) || id, gender: text(v["gender"], 20).toLowerCase(), accent: text(v["accent"], 40), description: text(v["description"], 160) }];
    });
    return { ok: true, voices: voices.slice(0, 60) };
  } catch {
    return { ok: false, error: "No pude hablar con Google para ver su biblioteca de voces." };
  }
}

// ------------------------------------------------------------------------------------------------ ElevenLabs (nube, gratis ≈ 10 min/mes)
const ELEVEN_HOST = "api.elevenlabs.io";
export type ElevenVoice = { id: string; name: string; category: string; accent: string; gender: string; spanish: boolean; spain: boolean };

async function elevenFetch(key: string, pathAndQuery: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  if (!key) throw new Error("Falta tu clave de ElevenLabs: pégala en Lectura → Voces más humanas → ElevenLabs.");
  const url = new URL(`https://${ELEVEN_HOST}${pathAndQuery}`);
  if (url.hostname !== ELEVEN_HOST) throw new Error("Dirección no permitida.");
  try {
    return await fetchImpl(url, { ...init, headers: { "xi-api-key": key, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(90_000) });
  } catch {
    throw new Error("No pude conectar con ElevenLabs. Revisa tu conexión a internet.");
  }
}
function elevenError(status: number, raw: string, key: string): Error {
  const detail = rec(rec(safeJson(raw))["detail"]);
  const code = String(detail["code"] ?? detail["status"] ?? "");
  const message = briefError(String(detail["message"] ?? raw), key);
  if (status === 401 || /invalid_api_key|api key/i.test(code + message)) return new Error("ElevenLabs ha rechazado tu clave. Revísala (debe tener permiso de «Text to Speech» y «Voices»).");
  if (status === 402 || /paid_plan_required|payment/i.test(code)) return new Error("Esa voz es de la biblioteca de ElevenLabs y con el plan gratis no se puede usar desde otras aplicaciones. Usa una voz tuya (puedes diseñar una con acento de España en elevenlabs.io → Voice Design).");
  if (/quota_exceeded|credits|character limit/i.test(code + message)) return new Error("Se han acabado tus créditos gratis de ElevenLabs de este mes. Mientras, usa otra voz (Gemini o Chatterbox).");
  if (status === 429) return new Error("ElevenLabs está recibiendo demasiadas peticiones a la vez (el plan gratis solo deja 2). Espera unos segundos.");
  if (/unusual activity|free tier usage disabled/i.test(message)) return new Error("ElevenLabs ha bloqueado el uso gratis de tu cuenta por «actividad inusual» (suele pasar con VPN o proxy).");
  return new Error(`ElevenLabs respondió ${status}${message ? `: ${message}` : ""}`);
}
function safeJson(raw: string): unknown { try { return JSON.parse(raw); } catch { return {}; } }

export async function elevenSpeak(key: string, voiceId: string, spoken: string, cfg: ExtraCfg["eleven"], fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  if (!ELEVEN_ID.test(voiceId)) throw new Error("Esa voz de ElevenLabs no es válida.");
  const clean = spoken.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("No hay texto que leer.");
  const v3 = cfg.model === "eleven_v3";
  // v3 solo admite estabilidad 0 (creativa), 0,5 (natural) o 1 (robusta).
  const voice_settings = v3
    ? { stability: [0, 0.5, 1].reduce((a, b) => (Math.abs(b - cfg.stability) < Math.abs(a - cfg.stability) ? b : a), 0.5) }
    : { stability: cfg.stability, similarity_boost: cfg.similarity, style: cfg.style, use_speaker_boost: true, speed: cfg.speed };
  const body = JSON.stringify({ text: clean, model_id: cfg.model, ...(cfg.model === "eleven_multilingual_v2" ? {} : { language_code: "es" }), voice_settings });
  for (const format of ["wav_24000", "pcm_24000"]) {
    const res = await elevenFetch(key, `/v1/text-to-speech/${voiceId}?output_format=${format}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "audio/*" }, body }, fetchImpl);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || /json|text/i.test(type)) {
      const raw = await res.text().catch(() => "");
      if (res.status === 400 && /output_format|format/i.test(raw) && format === "wav_24000") continue;
      throw elevenError(res.status, raw, key);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 200) throw new Error("ElevenLabs respondió sin audio.");
    return isRiff(bytes) ? bytes : pcmToWav(bytes.byteLength % 2 ? bytes.slice(0, -1) : bytes, 24000);
  }
  throw new Error("ElevenLabs no ha devuelto un audio que WILLY sepa leer.");
}

/** Voces que tu clave puede usar (las tuyas y las predeterminadas). Primero las de España, luego las de español. */
export async function elevenVoices(key: string, fetchImpl: typeof fetch = fetch): Promise<ElevenVoice[]> {
  const res = await elevenFetch(key, "/v2/voices?page_size=100", { method: "GET" }, fetchImpl);
  const raw = await res.text().catch(() => "");
  if (!res.ok) throw elevenError(res.status, raw, key);
  const list = rec(safeJson(raw))["voices"];
  const voices = (Array.isArray(list) ? list : []).flatMap((entry): ElevenVoice[] => {
    const v = rec(entry);
    const id = text(v["voice_id"], 40);
    if (!ELEVEN_ID.test(id)) return [];
    const labels = rec(v["labels"]);
    const langs = Array.isArray(v["verified_languages"]) ? v["verified_languages"].map(rec) : [];
    const accent = text(labels["accent"], 40) || text(langs.find((l) => /^es/i.test(String(l["language"] ?? "")))?.["accent"], 40);
    const spain = /spain|castil|peninsular|españa|madrid|iberian|european spanish/i.test(`${accent} ${langs.map((l) => `${String(l["locale"] ?? "")} ${String(l["accent"] ?? "")}`).join(" ")}`) || langs.some((l) => /^es-ES$/i.test(String(l["locale"] ?? "")));
    const spanish = spain || /spanish|español/i.test(accent) || langs.some((l) => /^es/i.test(String(l["language"] ?? "")));
    return [{ id, name: text(v["name"], 60) || id, category: text(v["category"], 20), accent, gender: text(labels["gender"], 20), spanish, spain }];
  });
  return voices.sort((a, b) => Number(b.spain) - Number(a.spain) || Number(b.spanish) - Number(a.spanish) || a.name.localeCompare(b.name)).slice(0, 100);
}

export async function elevenCredits(key: string, fetchImpl: typeof fetch = fetch): Promise<{ used: number; limit: number; tier: string; resetAt: number }> {
  const res = await elevenFetch(key, "/v1/user/subscription", { method: "GET" }, fetchImpl);
  const raw = await res.text().catch(() => "");
  if (!res.ok) throw elevenError(res.status, raw, key);
  const data = rec(safeJson(raw));
  return { used: Number(data["character_count"]) || 0, limit: Number(data["character_limit"]) || 0, tier: text(data["tier"], 30), resetAt: (Number(data["next_character_count_reset_unix"]) || 0) * 1000 };
}

// ------------------------------------------------------------------------------------------------ Google Chirp 3 HD (nube, 1 M caracteres/mes gratis)
const CHIRP_HOST = "texttospeech.googleapis.com";
export const chirpName = (id: string) => `es-ES-Chirp3-HD-${id}`;
function chirpError(status: number, raw: string, key: string): Error {
  const err = rec(rec(safeJson(raw))["error"]);
  const message = briefError(String(err["message"] ?? raw), key);
  const all = `${String(err["status"] ?? "")} ${message} ${JSON.stringify(err["details"] ?? "")}`;
  if (/API key not valid|API_KEY_INVALID/i.test(all)) return new Error("Google ha rechazado la clave. Comprueba que la has copiado entera (empieza por «AIza»).");
  if (/billing/i.test(all)) return new Error("Tu proyecto de Google Cloud no tiene la facturación activada. Google la exige incluso para el millón de caracteres gratis: actívala en console.cloud.google.com/billing.");
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(all)) return new Error("Falta activar la «Cloud Text-to-Speech API» en tu proyecto: console.cloud.google.com/apis/library/texttospeech.googleapis.com → Habilitar (tarda 1–2 minutos en valer).");
  if (/API_KEY_SERVICE_BLOCKED|blocked/i.test(all)) return new Error("Tu clave no tiene permiso para Text-to-Speech: en Credenciales, edítala y añade «Cloud Text-to-Speech API» a las API permitidas.");
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(all)) return new Error("Google ha limitado las peticiones de voz (cupo por minuto o del mes). Espera un poco.");
  return new Error(`Google respondió ${status}${message ? `: ${message}` : ""}`);
}
export async function chirpSpeak(key: string, id: string, spoken: string, cfg: ExtraCfg["chirp"], fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  if (!key) throw new Error("Falta tu clave de Google Cloud: pégala en Lectura → Voces más humanas → Google Chirp 3 HD.");
  if (!GEMINI_VOICES.some((v) => v.id === id)) throw new Error("Esa voz de Google no existe.");
  const clean = spoken.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("No hay texto que leer.");
  const url = new URL(`https://${CHIRP_HOST}/v1/text:synthesize`);
  if (url.hostname !== CHIRP_HOST) throw new Error("Dirección no permitida.");
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ input: { text: clean }, voice: { languageCode: "es-ES", name: chirpName(id) }, audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000, ...(Math.abs(cfg.rate - 1) > 0.01 ? { speakingRate: cfg.rate } : {}) } }), signal: AbortSignal.timeout(90_000) });
  } catch {
    throw new Error("No pude conectar con Google. Revisa tu conexión a internet.");
  }
  const raw = await res.text().catch(() => "");
  if (!res.ok) throw chirpError(res.status, raw, key);
  const b64 = String(rec(safeJson(raw))["audioContent"] ?? "");
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  if (bytes.length < 200) throw new Error("Google respondió sin audio.");
  return isRiff(bytes) ? bytes : pcmToWav(bytes.byteLength % 2 ? bytes.slice(0, -1) : bytes, 24000);
}
/** Comprueba la clave de verdad (lista las voces de España de Google) y cuenta cuántas Chirp 3 HD hay. */
export async function chirpCheck(key: string, fetchImpl: typeof fetch = fetch): Promise<{ total: number; chirp: number }> {
  if (!key) throw new Error("Falta tu clave de Google Cloud.");
  const url = new URL(`https://${CHIRP_HOST}/v1/voices`);
  url.searchParams.set("languageCode", "es-ES");
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("No pude conectar con Google. Revisa tu conexión a internet.");
  }
  const raw = await res.text().catch(() => "");
  if (!res.ok) throw chirpError(res.status, raw, key);
  const list = rec(safeJson(raw))["voices"];
  const names = (Array.isArray(list) ? list : []).map((v) => String(rec(v)["name"] ?? ""));
  return { total: names.length, chirp: names.filter((n) => /Chirp3-HD/i.test(n)).length };
}

// ------------------------------------------------------------------------------------------------ Kokoro (local)
export const KOKORO_PKG = "kokoro-onnx==0.6.1";
const KOKORO_FILES = {
  uv: "https://github.com/astral-sh/uv/releases/download/0.12.18/uv-x86_64-pc-windows-msvc.zip",
  model: { url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx", bytes: 325_532_387 },
  voices: { url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin", bytes: 28_214_398 },
};
/** Espacio aproximado en disco (modelo + voces + Python propio + paquetes). */
export const KOKORO_MB = 480;

// Guion de Python que se guarda junto al modelo. Recibe TODO por la entrada estándar (JSON, UTF-8): así no hay problemas
// con comillas ni acentos en la línea de órdenes de Windows.
export const KOKORO_SCRIPT = `# WILLY AI · Kokoro (voz local). Entrada estándar: {"text","model","voices","voice","speed","lang","sentence_pause","clause_pause","out"}
import json, sys, wave
def why(e):
    # Los errores de Windows llegan en su idioma (por ejemplo «El parámetro no es correcto») y Python no siempre sabe leerlos.
    raw = getattr(e, "object", None)
    if isinstance(e, UnicodeDecodeError) and isinstance(raw, (bytes, bytearray)):
        msg = bytes(raw).decode("cp1252", "replace")
    else:
        msg = "%s: %s" % (type(e).__name__, e)
    msg = " ".join(msg.split())
    return msg if len(msg) <= 290 else msg[:140] + " | " + msg[-140:]
def main():
    req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    import numpy as np
    from kokoro_onnx import Kokoro
    k = Kokoro(req["model"], req["voices"])
    samples, rate = k.create(req["text"], voice=req["voice"], speed=float(req.get("speed", 1.0)), lang=req.get("lang", "es"),
                             sentence_pause=float(req.get("sentence_pause", 0.4)), clause_pause=float(req.get("clause_pause", 0.12)))
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    rms = float(np.sqrt(np.mean(samples ** 2))) if len(samples) else 0.0
    if peak > 0 and rms > 0: samples = samples * min(4.0, 0.14 / rms, 0.95 / peak)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(req["out"], "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(int(rate)); w.writeframes(pcm.tobytes())
    print(json.dumps({"ok": True, "rate": int(rate), "seconds": round(len(pcm) / float(rate), 2)}))
if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stderr.write("ERROR: %s\\n" % why(e)); sys.exit(3)
`;

// Kokoro «en marcha»: carga el modelo UNA sola vez y atiende peticiones (una por línea, en JSON). Así no se pierden ≈ 7 s
// arrancando Python y cargando el modelo en cada trozo de texto, y la lectura va seguida, sin silencios entre frases.
// El volumen se iguala (al nivel de Gemini y Piper, sin saturar) para que Kokoro no suene más bajo que las demás voces.
export const KOKORO_SERVER_SCRIPT = `# WILLY AI · Kokoro en marcha. Argumentos: modelo voces. Entrada: una petición JSON por línea. Salida: una respuesta JSON por línea.
import json, sys, wave
def why(e):
    # Los errores de Windows llegan en su idioma (por ejemplo «El parámetro no es correcto») y Python no siempre sabe leerlos.
    raw = getattr(e, "object", None)
    if isinstance(e, UnicodeDecodeError) and isinstance(raw, (bytes, bytearray)):
        msg = bytes(raw).decode("cp1252", "replace")
    else:
        msg = "%s: %s" % (type(e).__name__, e)
    msg = " ".join(msg.split())
    return msg if len(msg) <= 290 else msg[:140] + " | " + msg[-140:]
def main():
    import numpy as np
    from kokoro_onnx import Kokoro
    k = Kokoro(sys.argv[1], sys.argv[2])
    sys.stdout.write(json.dumps({"ready": True}) + "\\n"); sys.stdout.flush()
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
            samples, rate = k.create(req["text"], voice=req["voice"], speed=float(req.get("speed", 1.0)), lang=req.get("lang", "es"),
                                     sentence_pause=float(req.get("sentence_pause", 0.4)), clause_pause=float(req.get("clause_pause", 0.12)))
            peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
            rms = float(np.sqrt(np.mean(samples ** 2))) if len(samples) else 0.0
            if peak > 0 and rms > 0: samples = samples * min(4.0, 0.14 / rms, 0.95 / peak)
            pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
            with wave.open(req["out"], "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(int(rate)); w.writeframes(pcm.tobytes())
            sys.stdout.write(json.dumps({"id": rid, "ok": True, "seconds": round(len(pcm) / float(rate), 2)}) + "\\n")
        except Exception as e:
            sys.stdout.write(json.dumps({"id": rid, "ok": False, "error": why(e)}) + "\\n")
        sys.stdout.flush()
if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stderr.write("ERROR: %s\\n" % why(e)); sys.exit(3)
`;

export type Spawn = typeof import("node:child_process").spawn;
export async function runCmd(cmd: string, args: string[], o: { env?: Record<string, string>; timeoutMs: number; input?: string; what: string; onErr?: (line: string) => void }, spawnImpl?: Spawn): Promise<{ code: number | null; err: string }> {
  const spawn = spawnImpl ?? (await import("node:child_process")).spawn;
  return new Promise((resolve, reject) => {
    let err = "";
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true, env: { ...process.env, ...(o.env ?? {}) } });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${o.what} tardó demasiado.`)); }, o.timeoutMs);
    child.stderr?.on("data", (chunk: Buffer) => {
      const t = chunk.toString("utf8");
      err = (err + t).slice(-4000);
      if (o.onErr) for (const line of t.split(/\r?\n/)) if (line.trim()) o.onErr(line.trim());
    });
    child.on("error", (error: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new Error(error.code === "ENOENT" ? `${o.what}: no encuentro el programa.` : `${o.what}: ${error.message}`)); });
    child.on("close", (code: number | null) => { clearTimeout(timer); resolve({ code, err }); });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(o.input ?? "", "utf8");
  });
}
export const lastLines = (err: string) => err.replace(/\r/g, "").split("\n").map((l) => l.replace(/^ERROR:\s*/, "").trim()).filter(Boolean).slice(-2).join(" ").slice(0, 300) || "sin detalle";

export async function exists(file: string): Promise<boolean> {
  const { fs } = await mods();
  try { return (await fs.stat(file)).isFile(); } catch { return false; }
}
async function sizeIs(file: string, bytes: number): Promise<boolean> {
  const { fs } = await mods();
  try { return (await fs.stat(file)).size === bytes; } catch { return false; }
}
export async function kokoroReadyAt(p: Paths): Promise<boolean> {
  return (await exists(p.marker)) && (await exists(p.python)) && (await sizeIs(p.model, KOKORO_FILES.model.bytes)) && (await sizeIs(p.voices, KOKORO_FILES.voices.bytes));
}
async function ensureScript(p: Paths): Promise<void> {
  const { fs } = await mods();
  const now = await fs.readFile(p.script, "utf8").catch(() => "");
  if (now !== KOKORO_SCRIPT) await fs.writeFile(p.script, KOKORO_SCRIPT, "utf8");
  const server = await fs.readFile(p.server, "utf8").catch(() => "");
  if (server !== KOKORO_SERVER_SCRIPT) {
    await fs.writeFile(p.server, KOKORO_SERVER_SCRIPT, "utf8");
    void stopKokoroWorker();
  }
}

// ------------------------------------------------------------------------------------------------ Kokoro en marcha
type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Worker = { child: import("node:child_process").ChildProcess; key: string; ready: Promise<void>; pending: Map<string, Pending>; buf: string; err: string; idle: ReturnType<typeof setTimeout> | null };
let worker: Worker | null = null;
/** Se cierra solo tras 10 minutos sin leer nada, para devolver la memoria (≈ 600 MB). */
const WORKER_IDLE_MS = 10 * 60_000;
/** Cierra Kokoro «en marcha» y espera a que el proceso termine de verdad (en Windows, mientras sigue vivo, sus archivos están bloqueados). */
export function stopKokoroWorker(): Promise<void> {
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

const workerKey = (p: Paths, gpu: boolean) => `${p.python}|${p.model}|${gpu ? "gpu" : "cpu"}`;
// Con la tarjeta gráfica (DirectML) Kokoro usa todo lo disponible; si no, se le obliga a usar solo el procesador.
const providerEnv = (gpu: boolean): Record<string, string> => (gpu ? {} : { ONNX_PROVIDER: "CPUExecutionProvider" });
async function startWorker(p: Paths, gpu: boolean, spawnImpl?: Spawn): Promise<Worker> {
  const spawn = spawnImpl ?? (await import("node:child_process")).spawn;
  const child = spawn(p.python, [p.server, p.model, p.voices], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", ...providerEnv(gpu) } });
  let markReady: () => void = () => undefined;
  let markFailed: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => { markReady = resolve; markFailed = reject; });
  ready.catch(() => undefined);
  const w: Worker = { child, key: workerKey(p, gpu), ready, pending: new Map(), buf: "", err: "", idle: null };
  const startTimer = setTimeout(() => { markFailed(new Error("Kokoro tardó demasiado en arrancar.")); try { child.kill(); } catch { /* nada */ } }, 180_000);
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
      if (msg["ready"] === true) { clearTimeout(startTimer); markReady(); continue; }
      const id = typeof msg["id"] === "string" ? msg["id"] : "";
      const job = w.pending.get(id);
      if (!job) continue;
      w.pending.delete(id);
      clearTimeout(job.timer);
      if (msg["ok"] === true) job.resolve();
      else job.reject(new Error(`Kokoro ha fallado: ${text(msg["error"], 300) || "sin detalle"}`));
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => { w.err = (w.err + chunk.toString("utf8")).slice(-3000); });
  child.on("error", (error: Error) => fail(`No pude arrancar Kokoro: ${error.message}`));
  child.on("exit", (code: number | null) => fail(`Kokoro se cerró (código ${code ?? "?"}): ${lastLines(w.err)}`));
  child.stdin?.on("error", () => undefined);
  return w;
}

async function workerSpeak(p: Paths, req: { text: string; voice: string; speed: number; sentencePause: number }, gpu: boolean, spawnImpl: Spawn | undefined, timeoutMs: number): Promise<Uint8Array> {
  if (worker && worker.key !== workerKey(p, gpu)) void stopKokoroWorker();
  if (!worker) worker = await startWorker(p, gpu, spawnImpl);
  const w = worker;
  await w.ready;
  if (w.idle) { clearTimeout(w.idle); w.idle = null; }
  const { fs, path, os } = await mods();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "willy-kokoro-"));
  const out = path.join(tmp, "voz.wav");
  const id = Math.random().toString(36).slice(2, 10);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { w.pending.delete(id); reject(new Error("Kokoro tardó demasiado.")); if (worker === w) void stopKokoroWorker(); }, timeoutMs);
      w.pending.set(id, { resolve, reject, timer });
      w.child.stdin?.write(`${JSON.stringify({ id, text: req.text, voice: req.voice, speed: req.speed, lang: "es", sentence_pause: req.sentencePause, clause_pause: Math.min(0.3, Math.max(0.05, req.sentencePause / 3)), out })}\n`, "utf8");
    });
    const bytes = new Uint8Array(await fs.readFile(out));
    if (!isRiff(bytes)) throw new Error("Kokoro no produjo un audio válido.");
    return bytes;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    if (worker === w && !w.pending.size) {
      w.idle = setTimeout(() => { if (worker === w && !w.pending.size) void stopKokoroWorker(); }, WORKER_IDLE_MS);
      w.idle.unref?.();
    }
  }
}

async function kokoroRun(p: Paths, req: { text: string; voice: string; speed: number; sentencePause: number }, spawnImpl: Spawn | undefined, timeoutMs: number): Promise<Uint8Array> {
  const { fs, path, os } = await mods();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "willy-kokoro-"));
  const out = path.join(tmp, "voz.wav");
  try {
    const input = JSON.stringify({ text: req.text, model: p.model, voices: p.voices, voice: req.voice, speed: req.speed, lang: "es", sentence_pause: req.sentencePause, clause_pause: Math.min(0.3, Math.max(0.05, req.sentencePause / 3)), out });
    const r = await runCmd(p.python, [p.script], { env: { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", ...providerEnv(false) }, timeoutMs, input, what: "Kokoro" }, spawnImpl);
    if (r.code !== 0) throw new Error(`Kokoro ha fallado: ${lastLines(r.err)}`);
    const bytes = new Uint8Array(await fs.readFile(out));
    if (!isRiff(bytes)) throw new Error("Kokoro no produjo un audio válido.");
    return bytes;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type Progress = { text: string; pct: number };
export async function uvEnv(p: Paths): Promise<Record<string, string>> {
  const { path } = await mods();
  return { UV_CACHE_DIR: path.join(p.uvDir, "cache"), UV_PYTHON_INSTALL_DIR: path.join(p.uvDir, "python"), UV_PYTHON_PREFERENCE: "only-managed", UV_NO_CONFIG: "1", UV_LINK_MODE: "copy", PYTHONUTF8: "1" };
}
export type InstallDeps = {
  platform: string;
  spawnImpl?: Spawn;
  download: (url: string, dest: string, o: { max: number; min: number; onBytes: (got: number, total: number) => void }) => Promise<void>;
  extract: (zip: string, dest: string) => Promise<void>;
};

/** Instala Kokoro de principio a fin (uv → Python propio → paquete → modelo y voces → prueba real). Se puede repetir: lo que ya está, no se vuelve a bajar. */
export async function installKokoro(dir: string, job: Progress, deps: InstallDeps): Promise<void> {
  const { fs, path } = await mods();
  const p = await pathsFor(dir, deps.platform);
  await fs.mkdir(p.kdir, { recursive: true });
  if (!(await exists(p.uvExe))) {
    job.text = "Descargando el instalador de Python (uv, ≈ 18 MB)…";
    job.pct = 2;
    const zip = path.join(p.root, "uv.zip");
    await deps.download(KOKORO_FILES.uv, zip, { max: 120 * 2 ** 20, min: 2_000_000, onBytes: (got, total) => { job.pct = 2 + (total ? Math.round((got / total) * 6) : 3); } });
    await fs.mkdir(p.uvDir, { recursive: true });
    await deps.extract(zip, p.uvDir);
    await fs.rm(zip, { force: true });
    if (!(await exists(p.uvExe))) throw new Error("Descargué uv pero no encuentro uv.exe dentro del archivo.");
  }
  const env = await uvEnv(p);
  if (!(await exists(p.python))) {
    job.text = "Preparando un Python propio para las voces (no toca el de tu sistema ni el de ComfyUI)…";
    job.pct = 10;
    const r = await runCmd(p.uvExe, ["venv", "--python", "3.12", p.venv], { env, timeoutMs: 15 * 60_000, what: "Crear el Python de las voces" }, deps.spawnImpl);
    if (r.code !== 0 || !(await exists(p.python))) throw new Error(`No pude crear el Python de las voces: ${lastLines(r.err)}`);
  }
  job.text = "Instalando Kokoro y sus piezas (≈ 60 MB)…";
  job.pct = 18;
  const pip = await runCmd(p.uvExe, ["pip", "install", "--python", p.python, KOKORO_PKG], {
    env, timeoutMs: 25 * 60_000, what: "Instalar Kokoro",
    onErr: (line) => { if (/^(Resolved|Downloading|Downloaded|Prepared|Installed)/.test(line)) job.text = `Instalando Kokoro: ${line.slice(0, 90)}`; },
  }, deps.spawnImpl);
  if (pip.code !== 0) throw new Error(`No pude instalar Kokoro: ${lastLines(pip.err)}`);
  job.pct = 28;
  if (!(await sizeIs(p.voices, KOKORO_FILES.voices.bytes))) {
    job.text = "Descargando las voces de Kokoro (28 MB)…";
    await deps.download(KOKORO_FILES.voices.url, p.voices, { max: 80 * 2 ** 20, min: 20_000_000, onBytes: (got, total) => { job.pct = 28 + (total ? Math.round((got / total) * 5) : 2); } });
  }
  if (!(await sizeIs(p.model, KOKORO_FILES.model.bytes))) {
    job.text = "Descargando el modelo de Kokoro (325 MB)…";
    await deps.download(KOKORO_FILES.model.url, p.model, { max: 500 * 2 ** 20, min: 300_000_000, onBytes: (got, total) => { job.pct = 33 + (total ? Math.round((got / total) * 57) : 25); } });
  }
  if (!(await sizeIs(p.model, KOKORO_FILES.model.bytes)) || !(await sizeIs(p.voices, KOKORO_FILES.voices.bytes))) throw new Error("El modelo o las voces de Kokoro no tienen el tamaño esperado: vuelve a instalar.");
  await ensureScript(p);
  job.text = "Probando la voz de Kokoro de verdad…";
  job.pct = 93;
  const probe = await kokoroRun(p, { text: "Hola. Ya estoy lista para leer.", voice: "ef_dora", speed: 1, sentencePause: 0.3 }, deps.spawnImpl, 10 * 60_000);
  if (probe.byteLength < 20_000) throw new Error("Kokoro se instaló, pero la prueba no produjo voz.");
  await fs.writeFile(p.marker, JSON.stringify({ pkg: KOKORO_PKG, model: "kokoro-v1.0", at: new Date().toISOString() }), "utf8");
}

export async function removeKokoro(dir: string, platform: string): Promise<void> {
  const { fs } = await mods();
  await stopKokoroWorker();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await fs.rm((await pathsFor(dir, platform)).kdir, { recursive: true, force: true });
}

// Kokoro con la tarjeta gráfica (DirectML: vale para cualquier gráfica de Windows, también la GTX 1660 Ti, sin instalar CUDA).
// Se MIDE antes y después con la misma frase: solo se queda si de verdad va más rápido; si falla o no mejora, se vuelve solo al procesador.
const GPU_TEST = "Esta frase sirve para medir la velocidad de la voz, primero con el procesador y luego con la tarjeta gráfica, para quedarnos con lo más rápido.";
async function timedSpeak(p: Paths, gpu: boolean, spawnImpl: Spawn | undefined): Promise<number> {
  await stopKokoroWorker();
  const w = await startWorker(p, gpu, spawnImpl);
  worker = w;
  await w.ready;
  let best = Number.POSITIVE_INFINITY;
  try {
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now();
      await workerSpeak(p, { text: GPU_TEST, voice: "ef_dora", speed: 1, sentencePause: 0.3 }, gpu, spawnImpl, 5 * 60_000);
      best = Math.min(best, Date.now() - t0);
    }
  } finally {
    await stopKokoroWorker();
  }
  return best;
}

/**
 * Deja instalado UNO de los dos motores de onnxruntime (el normal, para el procesador, o el DirectML, para la gráfica).
 * Antes cierra Kokoro, espera a que Windows suelte los archivos y quita los restos que un cambio anterior pudiera dejar a medias
 * (carpetas vacías de metadatos «dist-info» de onnxruntime o el paquete incompleto): con eso a medias uv no puede instalar nada.
 */
async function switchOnnxRuntime(p: Paths, pkg: "onnxruntime" | "onnxruntime-directml", deps: { platform: string; spawnImpl?: Spawn }): Promise<void> {
  const { fs, path } = await mods();
  const env = await uvEnv(p);
  const pip = (args: string[], what: string) => runCmd(p.uvExe, ["pip", ...args, "--python", p.python], { env, timeoutMs: 20 * 60_000, what }, deps.spawnImpl);
  await stopKokoroWorker();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const name of ["onnxruntime-directml", "onnxruntime"]) await pip(["uninstall", name], "Quitar onnxruntime");
  const site = deps.platform === "win32" ? path.join(p.venv, "Lib", "site-packages") : "";
  if (site) {
    for (const name of await fs.readdir(site).catch(() => [] as string[])) {
      if (/^onnxruntime([_-]directml)?(-[\d.]+\.dist-info)?$/i.test(name)) await fs.rm(path.join(site, name), { recursive: true, force: true }).catch(() => undefined);
    }
  }
  const r = await pip(["install", "--reinstall", pkg], pkg === "onnxruntime" ? "Dejar Kokoro con el procesador" : "Instalar la aceleración con la gráfica");
  if (r.code !== 0) throw new Error(`${pkg === "onnxruntime" ? "No pude dejar Kokoro con el procesador" : "No pude instalar la aceleración con la gráfica"}: ${lastLines(r.err)}`);
}

async function kokoroNote(dir: string, gpu: boolean, message: string): Promise<void> {
  const cfg = await loadExtra(dir);
  cfg.kokoro.gpu = gpu;
  cfg.kokoro.gpuNote = message;
  await saveExtra(dir, cfg);
}

/** Vuelve a dejar Kokoro con el procesador y comprueba que habla (por si algo quedó a medias). */
export async function repairKokoro(dir: string, job: Progress, deps: { platform: string; spawnImpl?: Spawn }): Promise<void> {
  const p = await pathsFor(dir, deps.platform);
  if (!(await exists(p.python))) throw new Error("Kokoro no está instalada: pulsa «Instalar Kokoro».");
  await ensureScript(p);
  job.text = "Reparando Kokoro (motor para el procesador)…";
  job.pct = 30;
  await switchOnnxRuntime(p, "onnxruntime", deps);
  job.text = "Probando que Kokoro habla…";
  job.pct = 80;
  const probe = await kokoroRun(p, { text: "Hola. Ya estoy reparada.", voice: "ef_dora", speed: 1, sentencePause: 0.3 }, deps.spawnImpl, 5 * 60_000);
  if (probe.byteLength < 20_000) throw new Error("Kokoro sigue sin producir voz después de repararla.");
  await kokoroNote(dir, false, "Kokoro reparada: usa el procesador.");
}

/** Recorta un mensaje largo dejando el principio y el final (en los errores de Windows lo importante suele ir al final). */
export const brief = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.floor(max * 0.45))} | ${s.slice(-Math.floor(max * 0.5))}`);
/** Traduce el fallo típico de DirectML con Kokoro («80070057 El parámetro no es correcto») a algo que se entienda. */
export function gpuWhy(raw: string): string {
  if (/80070057|par[aá]metro no es correcto|parameter is incorrect/i.test(raw)) return "DirectML no admite una de las operaciones del modelo de Kokoro en tu tarjeta; Windows responde «El parámetro no es correcto»";
  return raw;
}

export async function kokoroGpu(dir: string, on: boolean, job: Progress, deps: { platform: string; spawnImpl?: Spawn }): Promise<void> {
  const p = await pathsFor(dir, deps.platform);
  if (!(await kokoroReadyAt(p))) throw new Error("Primero instala Kokoro.");
  await ensureScript(p);
  if (!on) {
    job.text = "Volviendo a usar el procesador…";
    job.pct = 30;
    await switchOnnxRuntime(p, "onnxruntime", deps);
    await kokoroNote(dir, false, "Kokoro usa el procesador.");
    return;
  }
  job.text = "Midiendo la velocidad con el procesador…";
  job.pct = 10;
  const cpuMs = await timedSpeak(p, false, deps.spawnImpl);
  job.text = "Instalando la aceleración con la tarjeta gráfica (DirectML, ≈ 25 MB)…";
  job.pct = 40;
  const backToCpu = async (raw: string): Promise<never> => {
    const why = gpuWhy(raw);
    try {
      await switchOnnxRuntime(p, "onnxruntime", deps);
    } catch (error) {
      await kokoroNote(dir, false, `La gráfica no funcionó (${brief(why, 120)}) y no pude volver al procesador: pulsa «Reparar Kokoro».`);
      throw new Error(`${why} · Además no pude dejar Kokoro con el procesador (${error instanceof Error ? error.message : String(error)}). Pulsa «Reparar Kokoro».`);
    }
    await kokoroNote(dir, false, `Tu tarjeta gráfica no pudo con Kokoro (${brief(why, 150)}). Sigue con el procesador, que funciona.`);
    throw new Error(`Tu tarjeta gráfica no ha podido con Kokoro (${brief(why, 200)}). Kokoro sigue con el procesador, que funciona.`);
  };
  try {
    await switchOnnxRuntime(p, "onnxruntime-directml", deps);
  } catch (error) {
    return backToCpu(error instanceof Error ? error.message : String(error));
  }
  job.text = "Probando Kokoro con la tarjeta gráfica…";
  job.pct = 75;
  let gpuMs: number;
  try {
    gpuMs = await timedSpeak(p, true, deps.spawnImpl);
  } catch (error) {
    return backToCpu(error instanceof Error ? error.message : String(error));
  }
  const secs = (ms: number) => (ms / 1000).toFixed(1).replace(".", ",");
  if (gpuMs > cpuMs * 0.8) {
    job.text = "La gráfica no mejora: vuelvo al procesador…";
    await switchOnnxRuntime(p, "onnxruntime", deps);
    await kokoroNote(dir, false, `Con la tarjeta gráfica no iba más rápido (${secs(gpuMs)} s frente a ${secs(cpuMs)} s con el procesador): sigue con el procesador.`);
    return;
  }
  await kokoroNote(dir, true, `Kokoro usa la tarjeta gráfica: la misma frase tarda ${secs(gpuMs)} s en vez de ${secs(cpuMs)} s (${(cpuMs / gpuMs).toFixed(1).replace(".", ",")} veces más rápido).`);
}

// ------------------------------------------------------------------------------------------------ estado y voz
export type ExtraInstalled = { id: string; label: string; active: boolean };
export function geminiLabel(id: string, cfg: ExtraCfg): string {
  if (id.startsWith("lib:")) return `Gemini · ${cfg.gemini.library.find((v) => v.id === id.slice(4))?.label ?? id.slice(4)}`;
  const v = GEMINI_VOICES.find((g) => g.id === id);
  return v ? `Gemini · ${v.id} (${v.gender}, ${v.tone})` : `Gemini · ${id}`;
}
/** Nombre que se ve en pantalla para cualquier voz de este archivo. */
export function extraLabel(id: string, cfg: ExtraCfg): string {
  if (id.startsWith("gemini:")) return geminiLabel(id.slice(7), cfg);
  if (id.startsWith("kokoro:")) return KOKORO_VOICES.find((v) => v.id === id.slice(7))?.label ?? "Kokoro";
  if (id.startsWith("eleven:")) return `ElevenLabs · ${cfg.eleven.voices.find((v) => v.id === id.slice(7))?.label ?? id.slice(7)}`;
  if (id.startsWith("chirp:")) {
    const v = GEMINI_VOICES.find((g) => g.id === id.slice(6));
    return v ? `Google HD · ${v.id} (${v.gender}, ${v.tone})` : `Google HD · ${id.slice(6)}`;
  }
  if (id.startsWith("chatterbox:")) return id === "chatterbox:propia" ? "Chatterbox · mi voz" : id === "chatterbox:alex" ? "Chatterbox · hombre (España)" : "Chatterbox · mujer (España)";
  return id;
}

export async function extraStatus(dir: string, platform: string): Promise<{ cfg: ExtraCfg; installed: ExtraInstalled[]; kokoroReady: boolean; hasKey: boolean; view: Record<string, unknown> }> {
  const cfg = await loadExtra(dir);
  const p = await pathsFor(dir, platform);
  const kokoroReady = await kokoroReadyAt(p);
  const key = await geminiKey(dir);
  const keys = await loadKeys(dir);
  const installed: ExtraInstalled[] = [];
  const add = (id: string) => installed.push({ id, label: extraLabel(id, cfg), active: cfg.active === id });
  if (key) {
    for (const id of cfg.gemini.added) add(`gemini:${id}`);
    for (const v of cfg.gemini.library) add(`gemini:lib:${v.id}`);
  }
  if (kokoroReady) for (const v of KOKORO_VOICES) add(`kokoro:${v.id}`);
  if (keys.elevenlabs) for (const v of cfg.eleven.voices) add(`eleven:${v.id}`);
  if (keys.google) for (const id of cfg.chirp.added) add(`chirp:${id}`);
  // Chatterbox vive en su propio archivo (es grande): se carga solo cuando hace falta.
  const cb = await (await import("@/lib/voces-chatterbox")).cbStatus(dir, platform, kokoroReady);
  for (const id of cb.voices) add(`chatterbox:${id}`);
  return {
    cfg,
    installed,
    kokoroReady,
    hasKey: !!key,
    view: {
      active: cfg.active,
      gemini: { hasKey: !!key, last4: key.slice(-4), model: geminiWorking(), voices: GEMINI_VOICES, styles: GEMINI_STYLES.map((s) => ({ id: s.id, label: s.label })), added: cfg.gemini.added, library: cfg.gemini.library, style: cfg.gemini.style, custom: cfg.gemini.custom, pace: cfg.gemini.pace },
      kokoro: { ready: kokoroReady, canInstall: platform === "win32", mb: KOKORO_MB, voices: KOKORO_VOICES, speed: cfg.kokoro.speed, sentencePause: cfg.kokoro.sentencePause, gpu: cfg.kokoro.gpu, gpuNote: cfg.kokoro.gpuNote },
      eleven: { hasKey: !!keys.elevenlabs, last4: keys.elevenlabs.slice(-4), models: ELEVEN_MODELS, model: cfg.eleven.model, stability: cfg.eleven.stability, similarity: cfg.eleven.similarity, style: cfg.eleven.style, speed: cfg.eleven.speed, voices: cfg.eleven.voices },
      chirp: { hasKey: !!keys.google, last4: keys.google.slice(-4), added: cfg.chirp.added, rate: cfg.chirp.rate },
      chatterbox: cb.view,
      onlyNatural: cfg.onlyNatural,
    },
  };
}

/**
 * Voces de reserva cuando la elegida falla (sin cupo de Gemini, sin internet…): primero las locales (Chatterbox, Kokoro) y después
 * las de otros servicios. Una por servicio (si una de Chatterbox falla, las demás de Chatterbox también fallarían) y nunca del mismo
 * servicio que la que falló.
 */
export function backupVoices(installed: Array<{ id: string }>, failed: string): string[] {
  const provider = (id: string) => (id.split(":")[0] ?? "");
  return ["chatterbox", "kokoro", "eleven", "chirp"].flatMap((name) => {
    if (name === provider(failed)) return [];
    const found = installed.find((v) => provider(v.id) === name && v.id !== failed);
    return found ? [found.id] : [];
  });
}

/** Genera el audio (.wav) con una de estas voces. Los textos largos se parten por frases según el máximo de cada servicio. */
export async function extraSpeak(dir: string, id: string, raw: string, deps: { platform?: string; spawnImpl?: Spawn | undefined; fetchImpl?: typeof fetch | undefined } = {}): Promise<Uint8Array> {
  if (!isExtraId(id)) throw new Error("Esa voz no existe.");
  // Ninguna voz lee asteriscos, almohadillas, código, direcciones web ni emojis.
  const spoken = cleanForSpeech(raw);
  if (!spoken) throw new Error("No hay texto que leer.");
  const cfg = await loadExtra(dir);
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (id.startsWith("kokoro:")) {
    const p = await pathsFor(dir, deps.platform ?? process.platform);
    if (!(await kokoroReadyAt(p))) throw new Error("Kokoro todavía no está instalada (Lectura → Voz natural → Instalar Kokoro).");
    await ensureScript(p);
    const req = { text: spoken, voice: id.slice(7), speed: cfg.kokoro.speed, sentencePause: cfg.kokoro.sentencePause };
    try {
      return await workerSpeak(p, req, cfg.kokoro.gpu, deps.spawnImpl, 180_000);
    } catch {
      // Si Kokoro «en marcha» falla (por ejemplo, se cerró), se lee este trozo arrancándolo solo para él, con el procesador.
      return kokoroRun(p, req, deps.spawnImpl, 180_000);
    }
  }
  if (id.startsWith("chatterbox:")) return (await import("@/lib/voces-chatterbox")).cbSpeak(dir, id.slice(11), spoken, { platform: deps.platform ?? process.platform, spawnImpl: deps.spawnImpl, fetchImpl: deps.fetchImpl });
  if (id.startsWith("eleven:")) {
    const key = (await loadKeys(dir)).elevenlabs;
    return speakInParts(splitForTts(spoken, cfg.eleven.model === "eleven_v3" ? 2500 : 4000), (piece) => elevenSpeak(key, id.slice(7), piece, cfg.eleven, fetchImpl));
  }
  if (id.startsWith("chirp:")) {
    const key = (await loadKeys(dir)).google;
    return speakInParts(splitForTts(spoken, 2000, 4800), (piece) => chirpSpeak(key, id.slice(6), piece, cfg.chirp, fetchImpl));
  }
  const key = await geminiKey(dir);
  const style = geminiStyleText(cfg.gemini);
  return speakInParts(splitForTts(spoken, 1500), (piece) => geminiSpeak(key, id.slice(7), piece, style, fetchImpl));
}

// ------------------------------------------------------------------------------------------------ acciones de /api/voces
export const EXTRA_ACTIONS = new Set(["extra-key", "eleven-voices", "eleven-credits", "eleven-add", "eleven-remove", "eleven-config", "chirp-check", "chirp-add", "chirp-remove", "chirp-config", "kokoro-gpu", "kokoro-repair", "cb-install", "cb-gpu", "cb-config", "cb-own", "cb-own-remove", "cb-remove"]);
export type ExtraCtx = { platform: string; busy: boolean; run: (label: string, work: (job: Progress) => Promise<void>) => unknown; spawnImpl?: Spawn; fetchImpl?: typeof fetch };

export async function extraAction(dir: string, action: string, body: Record<string, unknown>, ctx: ExtraCtx): Promise<Record<string, unknown>> {
  const cfg = await loadExtra(dir);
  const keys = await loadKeys(dir);
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const save = async (patch: (next: ExtraCfg) => void) => { const next = structuredClone(cfg); patch(next); await saveExtra(dir, next); };
  try {
    switch (action) {
      case "extra-key": {
        const provider: keyof ExtraKeys | null = body["provider"] === "elevenlabs" ? "elevenlabs" : body["provider"] === "google" ? "google" : null;
        if (!provider) return { error: "Proveedor desconocido." };
        const value = typeof body["key"] === "string" ? body["key"].trim() : "";
        if (value && !KEY_FORMAT[provider].test(value)) return { error: provider === "google" ? "Esa clave de Google no tiene el formato esperado (empieza por «AIza»)." : "Esa clave de ElevenLabs no tiene el formato esperado (suele empezar por «sk_»)." };
        await saveKey(dir, provider, value);
        if (!value) await save((next) => { if (next.active.startsWith(provider === "elevenlabs" ? "eleven:" : "chirp:")) next.active = ""; });
        return { ok: true, last4: value.slice(-4) };
      }
      case "eleven-voices":
        return { ok: true, voices: await elevenVoices(keys.elevenlabs, fetchImpl) };
      case "eleven-credits":
        return { ok: true, ...(await elevenCredits(keys.elevenlabs, fetchImpl)) };
      case "eleven-add":
      case "eleven-remove": {
        const id = text(body["id"], 40);
        if (!ELEVEN_ID.test(id)) return { error: "Esa voz de ElevenLabs no es válida." };
        await save((next) => {
          if (action === "eleven-add") { if (!next.eleven.voices.some((v) => v.id === id)) next.eleven.voices.push({ id, label: text(body["label"], 60) || id }); }
          else { next.eleven.voices = next.eleven.voices.filter((v) => v.id !== id); if (next.active === `eleven:${id}`) next.active = ""; }
        });
        return { ok: true };
      }
      case "eleven-config":
      case "chirp-config": {
        const incoming = rec(body["cfg"]);
        const merged = action === "eleven-config" ? { ...cfg, eleven: { ...cfg.eleven, ...incoming, voices: cfg.eleven.voices } } : { ...cfg, chirp: { ...cfg.chirp, ...incoming, added: cfg.chirp.added } };
        await saveExtra(dir, sanitizeExtra(merged, cfg));
        return { ok: true };
      }
      case "chirp-check":
        return { ok: true, ...(await chirpCheck(keys.google, fetchImpl)) };
      case "chirp-add":
      case "chirp-remove": {
        const id = text(body["id"], 30);
        if (!GEMINI_VOICES.some((v) => v.id === id)) return { error: "Esa voz de Google no existe." };
        await save((next) => {
          if (action === "chirp-add") { if (!next.chirp.added.includes(id)) next.chirp.added.push(id); }
          else { next.chirp.added = next.chirp.added.filter((v) => v !== id); if (next.active === `chirp:${id}`) next.active = ""; }
        });
        return { ok: true };
      }
      case "kokoro-gpu": {
        if (ctx.busy) return { error: "Ya hay una instalación en marcha. Espera a que termine." };
        if (ctx.platform !== "win32") return { error: "La aceleración con la tarjeta gráfica (DirectML) es solo para Windows." };
        const on = body["on"] === true;
        return { ok: true, job: ctx.run(on ? "Kokoro con la tarjeta gráfica" : "Kokoro con el procesador", (job) => kokoroGpu(dir, on, job, { platform: ctx.platform, ...(ctx.spawnImpl ? { spawnImpl: ctx.spawnImpl } : {}) })) };
      }
      case "cb-install":
      case "cb-gpu":
      case "cb-config":
      case "cb-own":
      case "cb-own-remove":
      case "cb-remove": {
        const out = await (await import("@/lib/voces-chatterbox")).cbAction(dir, action, body, ctx);
        // Si la voz elegida era la que se acaba de quitar, WILLY vuelve a la voz por defecto.
        const gone = action === "cb-remove" ? "chatterbox:" : action === "cb-own-remove" ? "chatterbox:propia" : "";
        if (out["ok"] === true && gone && cfg.active.startsWith(gone)) await save((next) => { next.active = ""; });
        return out;
      }
      case "kokoro-repair": {
        if (ctx.busy) return { error: "Ya hay una instalación en marcha. Espera a que termine." };
        return { ok: true, job: ctx.run("Reparar Kokoro", (job) => repairKokoro(dir, job, { platform: ctx.platform, ...(ctx.spawnImpl ? { spawnImpl: ctx.spawnImpl } : {}) })) };
      }
      default:
        return { error: "Acción desconocida." };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
