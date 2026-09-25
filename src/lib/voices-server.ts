// Voces naturales para leer en voz alta (Piper, gratis y sin internet una vez descargadas). WILLY descarga el motor y las voces desde
// direcciones FIJAS (GitHub y Hugging Face): nunca se descarga nada desde una dirección que venga de la pantalla.

import { loadSettings, saveSettings } from "@/lib/avatar-server";
import { listVoiceOptions, listVoices, piperSpeak, type PiperDeps, type VoiceOption } from "@/lib/piper-server";
import { backupVoices, extraAction, extraSpeak, extraStatus, geminiLibrary, installKokoro, isExtraId, pcmToWav, removeKokoro, sanitizeExtra, saveExtra, EXTRA_ACTIONS, GEMINI_VOICES } from "@/lib/voces-extra";
import { cleanForSpeech } from "@/lib/voz-limpia";

export const HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
export const PIPER_ZIP = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";

// Solo español de España en el grupo principal (el que se ve primero y el que se ofrece por defecto).
// México, Argentina, catalán y otros idiomas van en grupos aparte, nunca mezclados con las de España.
export type CatalogVoice = { id: string; label: string; group: "España" | "México" | "Argentina" | "Catalán" | "Otros idiomas"; recommended?: boolean };
const QUALITY: Record<string, { label: string; mb: number }> = { x_low: { label: "ligera", mb: 25 }, low: { label: "básica", mb: 60 }, medium: { label: "buena", mb: 65 }, high: { label: "la más natural", mb: 110 } };

// Estas son, de verdad, TODAS las voces de español de España que existen publicadas en Piper
// (rhasspy/piper-voices) a día de hoy. Van ordenadas de mejor a peor calidad real medida de oído.
// Piper no tiene más archivos de España: pedir "más opciones" de esta lista sería inventar
// voces que luego fallarían al descargar, así que aquí se ofrece, además, la vía por Hugging Face
// (Estudio de avatar → Voz) para sumar otros modelos de español si el dueño quiere más variedad.
// Sharvard trae DOS personas en el mismo archivo (su .onnx.json: M = 0, F = 1): «#F» es la de mujer, sin otra descarga.
// Hombre/mujer comprobado de verdad el 23/09/2026 midiendo el tono de cada voz (≈ 120 Hz las de hombre, ≈ 200–216 Hz las de mujer).
export const CATALOG: CatalogVoice[] = [
  { id: "es_ES-davefx-medium", label: "España · Davefx (hombre)", group: "España", recommended: true },
  { id: "es_ES-sharvard-medium", label: "España · Sharvard (hombre)", group: "España", recommended: true },
  { id: "es_ES-sharvard-medium#F", label: "España · Sharvard (mujer)", group: "España", recommended: true },
  { id: "es_ES-carlfm-x_low", label: "España · Carlfm (hombre)", group: "España" },
  { id: "es_MX-ald-medium", label: "México · Ald", group: "México" },
  { id: "es_MX-claude-high", label: "México · Claude", group: "México" },
  { id: "es_AR-daniela-high", label: "Argentina · Daniela (mujer)", group: "Argentina" },
  { id: "ca_ES-upc_ona-medium", label: "Catalán · Ona", group: "Catalán" },
  { id: "en_US-lessac-high", label: "Inglés (EE. UU.) · Lessac", group: "Otros idiomas" },
  { id: "fr_FR-siwis-medium", label: "Francés · Siwis", group: "Otros idiomas" },
  { id: "de_DE-thorsten-high", label: "Alemán · Thorsten", group: "Otros idiomas" },
  { id: "it_IT-paola-medium", label: "Italiano · Paola", group: "Otros idiomas" },
  { id: "pt_BR-faber-medium", label: "Portugués (Brasil) · Faber", group: "Otros idiomas" },
];
/** La voz que se instala sola la primera vez que hace falta hablar y no hay ninguna todavía. */
export const DEFAULT_VOICE_ID = "es_ES-davefx-medium";
// Voces de Piper que FALLAN: medido el 23/09/2026 en el equipo del dueño, para una frase que las demás dicen en ≈ 7 s estas dos
// sacaban 17–21 s de audio (silencios y sílabas estiradas). Se quitan de la lista y se ocultan de los selectores; el archivo
// se queda en disco (no se borra nada sin permiso) y se puede quitar a mano.
export const BROKEN_VOICES = new Set(["es_ES-mls_10246-low", "es_ES-mls_9972-low"]);

const ID = /^([a-z]{2,3})_([A-Z]{2})-([a-z0-9_]+)-(x_low|low|medium|high)$/;
/** «es_ES-sharvard-medium#F» es otra persona del MISMO archivo: el archivo es la parte de antes de «#». */
export const baseVoiceId = (id: string): string => id.split("#")[0] ?? "";
export function voiceUrls(id: string, base = HF_BASE): { onnx: string; json: string; quality: string } {
  const file = baseVoiceId(id);
  const m = ID.exec(file);
  if (!m) throw new Error("Voz no válida.");
  const stem = `${base}/${m[1]}/${m[1]}_${m[2]}/${m[3]}/${m[4]}/${file}`;
  return { onnx: `${stem}.onnx`, json: `${stem}.onnx.json`, quality: m[4]! };
}

export type VoicesDeps = PiperDeps & { fetchImpl?: typeof fetch; platform?: string; extract?: (zip: string, dest: string) => Promise<void>; hfBase?: string; piperZip?: string; minOnnx?: number; minZip?: number };

type VJob = { id: string; kind: "piper" | "voz" | "kokoro"; label: string; status: "activo" | "listo" | "error"; pct: number; text: string; error: string };
const jobs = new Map<string, VJob>();
let active: VJob | null = null;
export const resetVoicesState = (): void => { jobs.clear(); active = null; };

async function mods() {
  return { fs: await import("node:fs/promises"), path: await import("node:path"), crypto: await import("node:crypto") };
}
const voicesDirOf = async (dir: string) => (await mods()).path.join(dir, "voces");

async function download(url: string, dest: string, o: { max: number; min: number; onBytes: (got: number, total: number) => void }, deps: VoicesDeps): Promise<void> {
  const { fs, path } = await mods();
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(url, { redirect: "follow", signal: AbortSignal.timeout(30 * 60_000) });
  } catch {
    throw new Error(`No pude conectar con ${new URL(url).hostname}. Revisa tu conexión a internet.`);
  }
  if (res.status === 404) throw new Error("No encontré ese archivo en el servidor (puede que haya cambiado de sitio).");
  if (!res.ok || !res.body) throw new Error(`El servidor respondió ${res.status}.`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (total > o.max) throw new Error("El archivo es más grande de lo esperado; no lo descargo.");
  const handle = await fs.open(part, "w");
  let got = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read().catch(() => { throw new Error("La descarga se cortó a mitad. Vuelve a intentarlo."); });
      if (done) break;
      got += value.byteLength;
      if (got > o.max) throw new Error("El archivo es más grande de lo esperado; lo corto.");
      await handle.write(value);
      o.onBytes(got, total);
    }
    await handle.close();
    if (got < o.min) throw new Error("La descarga llegó incompleta o vacía.");
    if (total && got !== total) throw new Error("La descarga se cortó a mitad. Vuelve a intentarlo.");
    await fs.rename(part, dest);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(part, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function defaultExtract(zip: string, dest: string, platform: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = platform === "win32" ? spawn("tar", ["-xf", zip, "-C", dest], { windowsHide: true }) : spawn("unzip", ["-o", "-q", zip, "-d", dest], { windowsHide: true });
    child.on("error", () => reject(new Error("No pude descomprimir el motor (falta «tar» en Windows 10/11 o «unzip»).")));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Al descomprimir el motor de voz salió el error ${code}.`))));
  });
}

/** ¿Tiene ese Python el paquete piper-tts? (se comprueba de verdad, con un límite de 5 s). */
async function pythonHasPiper(command: string): Promise<boolean> {
  const { spawn } = await import("node:child_process");
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
    try {
      const child = spawn(command, ["-c", "import piper"], { stdio: "ignore", windowsHide: true });
      const timer = setTimeout(() => { child.kill(); done(false); }, 5000);
      child.on("error", () => { clearTimeout(timer); done(false); });
      child.on("close", (code) => { clearTimeout(timer); done(code === 0); });
    } catch { done(false); }
  });
}

async function findExe(root: string, names: string[], depth = 4): Promise<string | null> {
  const { fs, path } = await mods();
  if (depth < 0) return null;
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (!e.isDirectory() && names.includes(e.name.toLowerCase())) return path.join(root, e.name);
  for (const e of entries) if (e.isDirectory()) { const found = await findExe(path.join(root, e.name), names, depth - 1); if (found) return found; }
  return null;
}

async function installPiper(dir: string, job: VJob, deps: VoicesDeps): Promise<void> {
  const { fs, path } = await mods();
  const platform = deps.platform ?? process.platform;
  const pdir = path.join(dir, "piper");
  const zip = path.join(dir, "piper.zip");
  await fs.rm(pdir, { recursive: true, force: true });
  await fs.mkdir(pdir, { recursive: true });
  job.text = "Descargando el motor de voz (Piper)…";
  await download(deps.piperZip ?? PIPER_ZIP, zip, { max: 300 * 2 ** 20, min: deps.minZip ?? 1_000_000, onBytes: (got, total) => { job.pct = total ? Math.round((got / total) * 85) : 40; } }, deps);
  job.text = "Descomprimiendo…";
  job.pct = 90;
  await (deps.extract ? deps.extract(zip, pdir) : defaultExtract(zip, pdir, platform));
  await fs.rm(zip, { force: true });
  const exe = await findExe(pdir, ["piper.exe", "piper"]);
  if (!exe) throw new Error("Descargué el motor pero no encuentro piper.exe dentro. Instálalo a mano (pip install piper-tts) y usa el modo «python -m piper» en Estudio de avatar.");
  const settings = await loadSettings(dir);
  settings.piper = { ...settings.piper, mode: "exe", exe, voicesDir: await voicesDirOf(dir) };
  await saveSettings(dir, settings);
}

async function installVoice(dir: string, id: string, job: VJob, deps: VoicesDeps): Promise<void> {
  const { fs, path } = await mods();
  const urls = voiceUrls(id, deps.hfBase);
  const vdir = await voicesDirOf(dir);
  const onnx = path.join(vdir, `${id}.onnx`);
  job.text = `Descargando la voz ${id}…`;
  await download(urls.json, `${onnx}.json`, { max: 2 * 2 ** 20, min: 20, onBytes: () => undefined }, deps);
  try { const meta = JSON.parse(await fs.readFile(`${onnx}.json`, "utf8")) as { audio?: { sample_rate?: number } }; if (!meta.audio?.sample_rate) throw new Error("x"); } catch { await fs.rm(`${onnx}.json`, { force: true }); throw new Error("El archivo de configuración de la voz no es válido."); }
  try {
    await download(urls.onnx, onnx, { max: 400 * 2 ** 20, min: deps.minOnnx ?? 1_000_000, onBytes: (got, total) => { job.pct = total ? Math.round((got / total) * 98) : 50; } }, deps);
  } catch (error) {
    await fs.rm(`${onnx}.json`, { force: true }).catch(() => undefined);
    throw error;
  }
  const settings = await loadSettings(dir);
  settings.piper = { ...settings.piper, voicesDir: vdir, ...(settings.piper.model ? {} : { model: onnx, speaker: 0 }) };
  await saveSettings(dir, settings);
}

function start(kind: VJob["kind"], label: string, work: (job: VJob) => Promise<void>): VJob {
  const job: VJob = { id: Math.random().toString(36).slice(2, 10), kind, label, status: "activo", pct: 0, text: "Empezando…", error: "" };
  jobs.set(job.id, job);
  active = job;
  void work(job).then(() => { job.status = "listo"; job.pct = 100; job.text = "Listo."; }, (error: unknown) => { job.status = "error"; job.error = error instanceof Error ? error.message : String(error); }).finally(() => { if (active === job) active = null; });
  return job;
}

export type VoicesResult = Record<string, unknown> & { error?: string; file?: { bytes: Uint8Array; name: string; mime: string } };
const show = (j: VJob | null) => (j ? { id: j.id, kind: j.kind, label: j.label, status: j.status, pct: j.pct, text: j.text, error: j.error } : null);

export async function voicesAction(dir: string, body: Record<string, unknown>, deps: VoicesDeps = {}): Promise<VoicesResult> {
  const { fs, path } = await mods();
  const action = String(body["action"] ?? "");
  // Transcribir audio o vídeo (Whisper, lib/transcribir.ts): va aparte y no necesita el estado de las voces.
  if (action.startsWith("stt-")) return (await import("@/lib/transcribir")).sttAction(dir, action, body);
  const settings = await loadSettings(dir);
  const vdir = await voicesDirOf(dir);
  const platform = deps.platform ?? process.platform;
  // Una entrada por persona (Sharvard sale dos veces: hombre y mujer). Las voces que fallan no se ofrecen.
  const installed = (await listVoiceOptions(vdir)).filter((v) => !BROKEN_VOICES.has(v.id));
  // Voces más humanas (Gemini, Kokoro): van aparte, en voces-extra, y se suman a la misma lista para todas las pestañas.
  const extra = await extraStatus(dir, platform);
  const sameFile = (a: string, b: string) => !!a && !!b && path.basename(a).toLowerCase() === path.basename(b).toLowerCase();
  const isActive = (v: VoiceOption) => !extra.cfg.active && sameFile(v.path, settings.piper.model) && (v.speaker ?? 0) === (settings.piper.speaker ?? 0);
  const saveExtraCfg = async (patch: (cfg: typeof extra.cfg) => void) => { const cfg = structuredClone(extra.cfg); patch(cfg); await saveExtra(dir, cfg); };

  if (action === "status") {
    let piperReady = false;
    try { piperReady = settings.piper.mode === "python" ? await pythonHasPiper(settings.piper.exe || "python") : !!settings.piper.exe && (await fs.stat(settings.piper.exe)).isFile(); } catch { piperReady = false; }
    return {
      ok: true,
      piper: { ready: piperReady, mode: settings.piper.mode, canInstall: platform === "win32" },
      pace: { lengthScale: settings.piper.lengthScale ?? 1.08, sentenceSilence: settings.piper.sentenceSilence ?? 0.55 },
      installed: [...installed.map((v) => ({ id: v.id, label: CATALOG.find((c) => c.id === v.id)?.label ?? v.id, active: isActive(v) })), ...extra.installed],
      catalog: CATALOG.map((c) => { const q = QUALITY[voiceUrls(c.id).quality]!; return { ...c, quality: q.label, mb: q.mb, installed: installed.some((v) => v.id === c.id) }; }),
      extra: extra.view,
      job: show(active ?? [...jobs.values()].at(-1) ?? null),
    };
  }
  if (action === "job") { const job = jobs.get(String(body["id"] ?? "")); return job ? { ok: true, job: show(job) } : { error: "No encuentro esa descarga." }; }

  // ---------------------------------------------------------------- voces más humanas (Gemini y Kokoro)
  if (action === "extra-config") {
    // Solo se tocan estilo, ritmo y pausas (nunca claves): lo demás se queda como estaba.
    const incoming = body["cfg"] && typeof body["cfg"] === "object" ? (body["cfg"] as Record<string, unknown>) : {};
    const merged = sanitizeExtra({ ...extra.cfg, ...(typeof incoming["onlyNatural"] === "boolean" ? { onlyNatural: incoming["onlyNatural"] } : {}), gemini: { ...extra.cfg.gemini, ...(incoming["gemini"] && typeof incoming["gemini"] === "object" ? (incoming["gemini"] as Record<string, unknown>) : {}), added: extra.cfg.gemini.added, library: extra.cfg.gemini.library }, kokoro: { ...extra.cfg.kokoro, ...(incoming["kokoro"] && typeof incoming["kokoro"] === "object" ? (incoming["kokoro"] as Record<string, unknown>) : {}) } }, extra.cfg);
    await saveExtra(dir, merged);
    return { ok: true };
  }
  if (action === "install-kokoro") {
    if (platform !== "win32" && !deps.extract) return { error: "La instalación automática de Kokoro es para Windows." };
    if (active) return { error: "Ya hay una descarga en marcha. Espera a que termine." };
    if (extra.kokoroReady) return { error: "Kokoro ya está instalada." };
    return {
      ok: true,
      job: show(start("kokoro", "Voz local Kokoro", (job) => installKokoro(dir, job, {
        platform,
        ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
        download: (url, dest, o) => download(url, dest, o, deps),
        extract: (zip, dest) => (deps.extract ? deps.extract(zip, dest) : defaultExtract(zip, dest, platform)),
      }))),
    };
  }
  if (action === "remove-kokoro") {
    if (active?.kind === "kokoro") return { error: "Kokoro se está instalando ahora mismo." };
    await removeKokoro(dir, platform);
    if (extra.cfg.active.startsWith("kokoro:")) await saveExtraCfg((cfg) => { cfg.active = ""; });
    return { ok: true };
  }
  if (action === "gemini-add" || action === "gemini-remove") {
    const id = String(body["id"] ?? "");
    const lib = id.startsWith("lib:");
    if (!lib && !GEMINI_VOICES.some((v) => v.id === id)) return { error: "Esa voz de Gemini no existe." };
    if (lib && !isExtraId(`gemini:${id}`)) return { error: "Esa voz de la biblioteca no es válida." };
    await saveExtraCfg((cfg) => {
      if (action === "gemini-add") {
        if (lib) { if (!cfg.gemini.library.some((v) => v.id === id.slice(4))) cfg.gemini.library.push({ id: id.slice(4), label: String(body["label"] ?? "").slice(0, 60) || id.slice(4) }); }
        else if (!cfg.gemini.added.includes(id)) cfg.gemini.added.push(id);
      } else {
        cfg.gemini.added = cfg.gemini.added.filter((v) => v !== id);
        cfg.gemini.library = cfg.gemini.library.filter((v) => `lib:${v.id}` !== id);
        if (cfg.active === `gemini:${id}`) cfg.active = "";
      }
    });
    return { ok: true };
  }
  if (action === "gemini-library") return await geminiLibrary(dir);
  // ElevenLabs, Google Chirp 3 HD y la aceleración de Kokoro con la tarjeta gráfica: todo vive en voces-extra.
  if (EXTRA_ACTIONS.has(action)) {
    return await extraAction(dir, action, body, {
      platform,
      busy: !!active,
      run: (label, work) => show(start("kokoro", label, work)),
      ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
  }

  if (action === "install-piper") {
    if (platform !== "win32" && !deps.extract) return { error: "El motor descargable es para Windows. En este sistema instálalo con «pip install piper-tts» y elige el modo «python -m piper» en Estudio de avatar." };
    if (active) return { error: "Ya hay una descarga en marcha. Espera a que termine." };
    return { ok: true, job: show(start("piper", "Motor de voz Piper", (job) => installPiper(dir, job, deps))) };
  }
  if (action === "download-voice") {
    const id = String(body["id"] ?? "");
    if (!CATALOG.some((c) => c.id === id)) return { error: "Esa voz no está en la lista." };
    if (active) return { error: "Ya hay una descarga en marcha. Espera a que termine." };
    if (installed.some((v) => v.id === id)) return { error: "Esa voz ya está descargada." };
    return { ok: true, job: show(start("voz", id, (job) => installVoice(dir, baseVoiceId(id), job, deps))) };
  }
  if (action === "ensure-ready") {
    // Deja la voz natural lista sola, sin que el dueño tenga que pulsar nada: motor + voz de España
    // por defecto. Si ya está todo, no hace nada y responde al momento.
    let piperReady = false;
    try { piperReady = settings.piper.mode === "python" ? await pythonHasPiper(settings.piper.exe || "python") : !!settings.piper.exe && (await fs.stat(settings.piper.exe)).isFile(); } catch { piperReady = false; }
    if ((piperReady && installed.length) || extra.installed.length) return { ok: true, ready: true };
    // «Solo voces naturales»: nunca se instala sola una voz básica (robótica).
    if (extra.cfg.onlyNatural) return { error: "No hay ninguna voz natural lista. Elige una en Lectura → Voces más humanas (Gemini funciona con tu clave de Motores) o instala Chatterbox." };
    if (active) return { ok: true, ready: false, job: show(active) };
    if (platform !== "win32" && !deps.extract && !piperReady) {
      return { error: "El motor descargable es para Windows. En este sistema instálalo con «pip install piper-tts» (Estudio de avatar → Voz, modo «python -m piper»)." };
    }
    return {
      ok: true,
      ready: false,
      job: show(start("voz", "Preparando la voz natural (motor + voz de España)", async (job) => {
        if (!piperReady) { job.text = "Descargando el motor de voz…"; await installPiper(dir, job, deps); }
        job.text = `Descargando la voz ${DEFAULT_VOICE_ID}…`;
        job.pct = 50;
        await installVoice(dir, DEFAULT_VOICE_ID, job, deps);
      })),
    };
  }
  if (action === "set-pace") {
    const lengthScale = Number(body["lengthScale"]);
    const sentenceSilence = Number(body["sentenceSilence"]);
    settings.piper = {
      ...settings.piper,
      ...(Number.isFinite(lengthScale) ? { lengthScale: Math.min(1.6, Math.max(0.7, lengthScale)) } : {}),
      ...(Number.isFinite(sentenceSilence) ? { sentenceSilence: Math.min(1.2, Math.max(0.1, sentenceSilence)) } : {}),
    };
    await saveSettings(dir, settings);
    return { ok: true, pace: { lengthScale: settings.piper.lengthScale, sentenceSilence: settings.piper.sentenceSilence } };
  }
  if (action === "set-voice" || action === "remove-voice") {
    const id = String(body["id"] ?? "");
    if (isExtraId(id)) {
      if (!extra.installed.some((v) => v.id === id)) return { error: id.startsWith("kokoro:") ? "Kokoro todavía no está instalada." : "Esa voz de Gemini no está añadida (o falta la clave de Gemini en Motores)." };
      if (action === "set-voice") await saveExtraCfg((cfg) => { cfg.active = id; });
      else if (id.startsWith("gemini:")) await saveExtraCfg((cfg) => { const g = id.slice(7); cfg.gemini.added = cfg.gemini.added.filter((v) => v !== g); cfg.gemini.library = cfg.gemini.library.filter((v) => `lib:${v.id}` !== g); if (cfg.active === id) cfg.active = ""; });
      else if (id.startsWith("kokoro:")) return { error: "Las voces de Kokoro van juntas: para quitarlas, desinstala Kokoro." };
      else await saveExtraCfg((cfg) => { if (id.startsWith("eleven:")) cfg.eleven.voices = cfg.eleven.voices.filter((v) => `eleven:${v.id}` !== id); else cfg.chirp.added = cfg.chirp.added.filter((v) => `chirp:${v}` !== id); if (cfg.active === id) cfg.active = ""; });
      return { ok: true };
    }
    const voice = installed.find((v) => v.id === id);
    if (!voice) return { error: "Esa voz no está descargada." };
    if (action === "set-voice") {
      settings.piper = { ...settings.piper, model: voice.path, speaker: voice.speaker ?? 0, voicesDir: vdir };
      if (extra.cfg.active) await saveExtraCfg((cfg) => { cfg.active = ""; });
    }
    else {
      // Se borra el archivo: si trae varias personas (Sharvard), se van las dos.
      await fs.rm(voice.path, { force: true }); await fs.rm(`${voice.path}.json`, { force: true });
      if (sameFile(voice.path, settings.piper.model)) {
        const next = installed.find((v) => v.path !== voice.path);
        settings.piper = { ...settings.piper, model: next?.path ?? "", speaker: next?.speaker ?? 0 };
      }
    }
    await saveSettings(dir, settings);
    return { ok: true };
  }
  if (action === "only-natural") {
    // «Quitar las voces robóticas» (lo pidió el dueño): borra TODAS las voces de Piper (también las ocultas), el motor Piper que
    // instaló WILLY y, si se pide, Kokoro. Desde entonces WILLY solo lee con voces naturales y nunca vuelve solo a Piper.
    if (active) return { error: "Hay una descarga en marcha. Espera a que termine." };
    const alsoKokoro = body["kokoro"] === true;
    const voice = typeof body["voice"] === "string" ? body["voice"] : "";
    if (voice && (!isExtraId(voice) || !extra.installed.some((v) => v.id === voice) || (alsoKokoro && voice.startsWith("kokoro:")))) return { error: "Elige como voz por defecto una voz natural que ya esté lista (por ejemplo gemini:Sulafat)." };
    const removed: string[] = [];
    for (const v of await listVoices(vdir)) {
      await fs.rm(v.path, { force: true });
      await fs.rm(`${v.path}.json`, { force: true });
      removed.push(v.name);
    }
    const pdir = path.join(dir, "piper");
    const managed = settings.piper.mode === "exe" && !!settings.piper.exe && path.resolve(settings.piper.exe).toLowerCase().startsWith(`${path.resolve(pdir).toLowerCase()}${path.sep}`);
    if (managed) { await fs.rm(pdir, { recursive: true, force: true }); removed.push("motor Piper"); }
    settings.piper = { ...settings.piper, model: "", speaker: 0, ...(managed ? { exe: "" } : {}) };
    await saveSettings(dir, settings);
    if (alsoKokoro) {
      const had = extra.kokoroReady || (await fs.stat(path.join(dir, "voces-motores", "kokoro")).then(() => true, () => false));
      await removeKokoro(dir, platform);
      if (had) removed.push("Kokoro");
    }
    await saveExtraCfg((cfg) => {
      cfg.onlyNatural = true;
      if (voice) cfg.active = voice;
      else if (alsoKokoro && cfg.active.startsWith("kokoro:")) cfg.active = "";
    });
    return { ok: true, removed };
  }
  if (action === "speak") {
    const raw = typeof body["text"] === "string" ? body["text"] : "";
    if (!raw.trim()) return { error: "No hay texto que leer." };
    if (raw.length > 1600) return { error: "Trozo de texto demasiado largo (máximo 1.600 caracteres)." };
    // Ninguna voz lee asteriscos, almohadillas, código, direcciones web ni emojis. Si no queda nada que leer (un trozo que era
    // solo código o un separador), se devuelve un silencio corto para que la lectura siga sin cortarse.
    const text = cleanForSpeech(raw);
    const wav = (bytes: Uint8Array) => ({ ok: true, file: { bytes, name: "voz.wav", mime: "audio/wav" } });
    if (!text) return wav(pcmToWav(new Uint8Array(12_000), 24000));
    const speakDeps = { platform, spawnImpl: deps.spawnImpl, fetchImpl: deps.fetchImpl };
    // Voces más humanas: la pedida, o la elegida en el equipo si no se pide ninguna.
    const asked = body["voice"] ? String(body["voice"]) : "";
    const wanted = asked || extra.cfg.active || (extra.cfg.onlyNatural ? (extra.installed[0]?.id ?? "") : "");
    if (wanted && isExtraId(wanted)) {
      // La pedida no tiene reserva: se dice por qué falla. La elegida en el equipo sí: si falla (sin cupo, sin internet),
      // se prueba antes con una local (Chatterbox) o de otro servicio que con Piper.
      let last = "";
      for (const id of asked ? [wanted] : [wanted, ...backupVoices(extra.installed, wanted)]) {
        try {
          return wav(await extraSpeak(dir, id, text, speakDeps));
        } catch (error) {
          last = error instanceof Error ? error.message : String(error);
        }
      }
      if (asked || extra.cfg.onlyNatural || !settings.piper.model) return { error: last };
    } else if (!asked && extra.cfg.onlyNatural) {
      return { error: "No hay ninguna voz natural lista: elige una en Lectura → Voces más humanas." };
    }
    let model = settings.piper.model;
    let speaker = settings.piper.speaker ?? 0;
    if (body["voice"]) {
      const voice = installed.find((v) => v.id === String(body["voice"]));
      if (!voice) return { error: "Esa voz no está descargada." };
      model = voice.path;
      speaker = voice.speaker ?? 0;
    }
    if (!model) return { error: "Todavía no hay ninguna voz natural descargada." };
    const lengthScale = Number(body["rate"]);
    const sentenceSilence = Number(body["pause"]);
    const rate = Number.isFinite(lengthScale) ? Math.min(1.6, Math.max(0.7, lengthScale)) : settings.piper.lengthScale;
    const pause = Number.isFinite(sentenceSilence) ? Math.min(1.2, Math.max(0.1, sentenceSilence)) : settings.piper.sentenceSilence;
    try {
      const bytes = await piperSpeak({
        mode: settings.piper.mode,
        exe: settings.piper.exe,
        model,
        speaker,
        ...(rate != null ? { lengthScale: rate } : {}),
        ...(pause != null ? { sentenceSilence: pause } : {}),
      }, text, { ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}), ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}) });
      return { ok: true, file: { bytes, name: "voz.wav", mime: "audio/wav" } };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { error: "Acción desconocida." };
}
