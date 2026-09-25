// Estudio de avatar (servidor): ajustes, flujos de ComfyUI, voz y trabajos. Todo vive en este equipo (carpeta datos-privados/avatar).
// Un vídeo se crea en segundo plano: voz (Piper → Hugging Face) y luego animación con RELEVO entre flujos (movimiento → labios,
// «todo en uno», solo labios): si uno falla se pasa al siguiente y se cuenta qué pasó.

import { FAMILIES, familiesIn, hintForMissing, planPipelines, BREAK_MS, ROLES, type FlowInfo, type Pipeline, type Role } from "@/lib/avatar-engines";
import { ComfyError, bindGraph, comfyBase, describeGraph, downloadFile, interrupt, missingClasses, pickOutput, probe, sniff, submit, unwrapGraph, uploadFile, waitForResult, MIME, type Deps as ComfyDeps, type Graph, type Kind, type Probe, type Slot } from "@/lib/comfy-server";
import { hfSpeak, listVoiceOptions, piperSpeak, piperStatus, type PiperCfg, type PiperDeps } from "@/lib/piper-server";
import { installComfy, type ComfyInstallJob } from "@/lib/comfy-install";

export type Settings = { comfyUrl: string; piper: PiperCfg & { voicesDir: string }; hf: { enabled: boolean; model: string; token: string }; timeoutMin: number };
// Ritmo y pausa por defecto: algo más lento y con más aire que la voz "de fábrica" de Piper (1.0 / 0.2 s),
// para que suene natural y no atropellada, tal y como se pidió.
export const DEFAULT_LENGTH_SCALE = 1.08;
export const DEFAULT_SENTENCE_SILENCE = 0.55;
export const DEFAULTS: Settings = { comfyUrl: "http://127.0.0.1:8188", piper: { mode: "python", exe: "python", model: "", speaker: 0, voicesDir: "", lengthScale: DEFAULT_LENGTH_SCALE, sentenceSilence: DEFAULT_SENTENCE_SILENCE }, hf: { enabled: false, model: "", token: "" }, timeoutMin: 25 };

export type AvatarDeps = ComfyDeps & { spawnImpl?: PiperDeps["spawnImpl"]; pollMs?: number; hfFetch?: typeof fetch; piperTimeoutMs?: number };

const str = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const clampPace = (value: unknown, base: number, min: number, max: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined ? Math.min(max, Math.max(min, n)) : base;
};

export function sanitizeSettings(raw: unknown, base: Settings = DEFAULTS): Settings {
  const data = obj(raw), piper = obj(data["piper"]), hf = obj(data["hf"]);
  const token = typeof hf["token"] === "string" ? hf["token"].trim() : base.hf.token;
  const timeout = Number(data["timeoutMin"]);
  const model = piper["model"] === undefined ? base.piper.model : str(piper["model"], 260);
  // Persona dentro de la voz (Sharvard: 0 hombre, 1 mujer). Si cambia la voz y no se dice cuál, la primera.
  const who = Number(piper["speaker"] !== undefined ? piper["speaker"] : model === base.piper.model ? base.piper.speaker : 0);
  const speaker = Number.isInteger(who) && who >= 0 && who < 1000 ? who : 0;
  return {
    comfyUrl: str(data["comfyUrl"], 120) || base.comfyUrl,
    piper: {
      mode: piper["mode"] === "exe" ? "exe" : piper["mode"] === "python" ? "python" : base.piper.mode,
      exe: piper["exe"] === undefined ? base.piper.exe : str(piper["exe"], 260),
      model,
      speaker,
      voicesDir: piper["voicesDir"] === undefined ? base.piper.voicesDir : str(piper["voicesDir"], 260),
      // Ritmo: 0.7 (rápido) a 1.6 (muy pausado). Pausa entre frases: 0.1 a 1.2 s.
      lengthScale: clampPace(piper["lengthScale"], base.piper.lengthScale ?? DEFAULT_LENGTH_SCALE, 0.7, 1.6),
      sentenceSilence: clampPace(piper["sentenceSilence"], base.piper.sentenceSilence ?? DEFAULT_SENTENCE_SILENCE, 0.1, 1.2),
    },
    hf: { enabled: hf["enabled"] === undefined ? base.hf.enabled : hf["enabled"] === true, model: hf["model"] === undefined ? base.hf.model : str(hf["model"], 120), token: /^[\w-]{10,200}$/.test(token) ? token : "" },
    timeoutMin: Number.isFinite(timeout) && timeout > 0 ? Math.min(90, Math.max(3, Math.round(timeout))) : base.timeoutMin,
  };
}

// ------------------------------------------------------------------------------------------------ almacenamiento
async function modules() {
  return { fs: await import("node:fs/promises"), path: await import("node:path"), crypto: await import("node:crypto") };
}
async function writePrivate(file: string, data: string | Uint8Array): Promise<void> {
  const { fs, path } = await modules();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600).catch(() => undefined);
}

export async function loadSettings(dir: string): Promise<Settings> {
  const { fs, path } = await modules();
  try {
    return sanitizeSettings(JSON.parse(await fs.readFile(path.join(dir, "avatar", "ajustes.json"), "utf8")));
  } catch {
    return structuredClone(DEFAULTS);
  }
}
export async function saveSettings(dir: string, settings: Settings): Promise<void> {
  const { path } = await modules();
  await writePrivate(path.join(dir, "avatar", "ajustes.json"), JSON.stringify(settings, null, 2));
}

type FlowEntry = { id: string; name: string; role: Role; addedAt: string };
async function loadIndex(dir: string): Promise<FlowEntry[]> {
  const { fs, path } = await modules();
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, "avatar", "flujos.json"), "utf8")) as { flows?: unknown };
    return (Array.isArray(parsed.flows) ? parsed.flows : []).flatMap((entry): FlowEntry[] => {
      const item = obj(entry);
      return /^f[0-9a-f]{8}$/.test(String(item["id"])) && String(item["role"]) in ROLES ? [{ id: String(item["id"]), name: str(item["name"], 60) || "Flujo", role: item["role"] as Role, addedAt: str(item["addedAt"], 40) }] : [];
    });
  } catch {
    return [];
  }
}
async function saveIndex(dir: string, flows: FlowEntry[]): Promise<void> {
  const { path } = await modules();
  await writePrivate(path.join(dir, "avatar", "flujos.json"), JSON.stringify({ flows }, null, 2));
}
async function loadGraph(dir: string, id: string): Promise<Graph | null> {
  const { fs, path } = await modules();
  try {
    return unwrapGraph(JSON.parse(await fs.readFile(path.join(dir, "avatar", "flujos", `${id}.json`), "utf8")));
  } catch {
    return null;
  }
}

function guessRole(graph: Graph): Role {
  const info = describeGraph(graph);
  const names = info.classes.join(" ");
  if (/LivePortrait/i.test(names) && !info.slots.audio.length) return "movimiento";
  if (info.slots.audio.length && info.slots.video.length) return "labios";
  return "todo";
}

const broken: Record<string, number> = {};
export const resetAvatarState = (): void => { for (const key of Object.keys(broken)) delete broken[key]; jobs.clear(); active = null; ffmpegFound = null; };

async function describeFlow(dir: string, entry: FlowEntry, installed: Set<string> | null) {
  const graph = await loadGraph(dir, entry.id);
  if (!graph) return { info: null as FlowInfo | null, graph: null as Graph | null, checked: false, hints: [] as string[] };
  const d = describeGraph(graph);
  const missing = installed ? missingClasses(graph, installed) : [];
  const info: FlowInfo = { id: entry.id, name: entry.name, role: entry.role, needs: { image: d.slots.image.length > 0, audio: d.slots.audio.length > 0, video: d.slots.video.length > 0 }, missing, warnings: d.warnings, hasVideoOutput: d.hasVideoOutput };
  return { info, graph, checked: !!installed, hints: missing.slice(0, 4).map(hintForMissing) };
}

// ------------------------------------------------------------------------------------------------ voz
/** Voces para elegir, una por persona (Sharvard trae hombre y mujer), con el nombre que se ve en pantalla. */
async function voiceChoices(voicesDir: string): Promise<Array<{ id: string; name: string; label: string; path: string; speaker: number }>> {
  // Import dinámico: voices-server ya importa este archivo, así no se crea un ciclo al cargar.
  const { CATALOG, BROKEN_VOICES } = await import("@/lib/voices-server");
  return (await listVoiceOptions(voicesDir)).filter((v) => !BROKEN_VOICES.has(v.id)).map((v) => ({ id: v.id, name: v.name, label: CATALOG.find((c) => c.id === v.id)?.label ?? v.id, path: v.path, speaker: v.speaker ?? 0 }));
}

export type VoiceResult = { bytes: Uint8Array; ext: string; engine: string; attempts: string[] };

/**
 * La voz natural que speak() prueba primero: la elegida en Lectura → Voces más humanas o, con «solo voces naturales», la
 * primera instalada. La pantalla de vídeo la necesita para no pedir una voz de Piper cuando Piper ya no se usa.
 */
async function naturalVoice(dir: string): Promise<{ ok: boolean; label: string; onlyNatural: boolean; count: number }> {
  try {
    const { extraLabel, extraStatus } = await import("@/lib/voces-extra");
    const extra = await extraStatus(dir, process.platform);
    const id = extra.cfg.active || (extra.cfg.onlyNatural ? (extra.installed[0]?.id ?? "") : "");
    return { ok: !!id, label: id ? extraLabel(id, extra.cfg) : "", onlyNatural: !!extra.cfg.onlyNatural, count: extra.installed.length };
  } catch {
    return { ok: false, label: "", onlyNatural: false, count: 0 };
  }
}

export async function speak(settings: Settings, raw: string, deps: AvatarDeps = {}, dir?: string): Promise<VoiceResult> {
  const attempts: string[] = [];
  // Ninguna voz lee asteriscos, almohadillas, código, direcciones web ni emojis.
  const text = (await import("@/lib/voz-limpia")).cleanForSpeech(raw);
  if (!text) throw new Error("No hay texto que leer (solo había símbolos, código o enlaces).");
  let onlyNatural = false;
  // Primero, la voz más humana elegida en Lectura → Voces más humanas; si falla, una de reserva (local o de otro servicio).
  if (dir) {
    const { backupVoices, extraLabel, extraSpeak, extraStatus } = await import("@/lib/voces-extra");
    const extra = await extraStatus(dir, process.platform);
    onlyNatural = extra.cfg.onlyNatural;
    const first = extra.cfg.active || (onlyNatural ? (extra.installed[0]?.id ?? "") : "");
    if (first) {
      for (const id of [first, ...backupVoices(extra.installed, first)]) {
        try {
          const bytes = await extraSpeak(dir, id, text, { spawnImpl: deps.spawnImpl, fetchImpl: deps.hfFetch });
          return { bytes, ext: "wav", engine: extraLabel(id, extra.cfg), attempts };
        } catch (error) {
          attempts.push(`${extraLabel(id, extra.cfg)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  // «Solo voces naturales»: nunca se vuelve a la voz básica (robótica).
  if (onlyNatural) throw new Error(`No pude generar la voz con tus voces naturales. ${attempts.join(" · ") || "Elige una en Lectura → Voces más humanas."}`);
  if (settings.piper.model) {
    try {
      return { bytes: await piperSpeak(settings.piper, text, { ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}), ...(deps.piperTimeoutMs ? { timeoutMs: deps.piperTimeoutMs } : {}) }), ext: "wav", engine: "Piper", attempts };
    } catch (error) {
      attempts.push(`Piper: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else attempts.push("Piper: sin configurar.");
  if (settings.hf.enabled) {
    try {
      const out = await hfSpeak(settings.hf, text, deps.hfFetch ?? fetch);
      return { ...out, engine: "Hugging Face", attempts };
    } catch (error) {
      attempts.push(`Hugging Face: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No pude generar la voz. ${attempts.join(" · ")}${settings.piper.model ? "" : " Elige una voz en Mi yo en IA → Ajustes (se descargan en Lectura → Voces naturales)."}`);
}

// ------------------------------------------------------------------------------------------------ trabajos
export type Job = { id: string; status: "voz" | "animando" | "listo" | "error" | "cancelado"; steps: string[]; attempts: Array<{ pipeline: string; ok: boolean; error: string }>; error: string; file: { path: string; name: string; mime: string; size: number } | null; startedAt: number; finishedAt: number; abort: AbortController };
const jobs = new Map<string, Job>();
let active: Job | null = null;

// Instalación automática de ComfyUI + nodos: un único trabajo en segundo plano a la vez.
let comfyInstallJob: ComfyInstallJob | null = null;
function showComfyInstall(job: ComfyInstallJob | null) {
  return job ? { id: job.id, status: job.status, pct: job.pct, step: job.step, text: job.text, error: job.error, log: job.log.slice(-8) } : null;
}

const publicJob = (job: Job) => ({ id: job.id, status: job.status, steps: job.steps.slice(-40), attempts: job.attempts, error: job.error, file: job.file ? { name: job.file.name, mime: job.file.mime, size: job.file.size } : null, seconds: Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000) });

const stamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;


// ffmpeg saca la voz del vídeo maestro. Se usa el del sistema (PATH) y, si no hay, el que ya trae ComfyUI dentro
// (imageio-ffmpeg), así la «voz de mi vídeo» funciona sin instalar nada más. Se recuerda 5 minutos.
let ffmpegFound: { at: number; path: string } | null = null;

export async function findFfmpeg(dir: string, deps: AvatarDeps = {}): Promise<string> {
  const now = (deps.now ?? Date.now)();
  if (ffmpegFound && now - ffmpegFound.at < 5 * 60_000) return ffmpegFound.path;
  const { fs, path } = await modules();
  const cp = await import("node:child_process");
  const util = await import("node:util");
  const execFile = util.promisify(cp.execFile);
  const works = async (bin: string): Promise<boolean> => {
    try {
      await execFile(bin, ["-version"], { windowsHide: true, timeout: 15000 });
      return true;
    } catch {
      return false;
    }
  };
  let found = (await works("ffmpeg")) ? "ffmpeg" : "";
  if (!found) {
    const packages = ["venv/Lib/site-packages", "python_embeded/Lib/site-packages", ".venv/Lib/site-packages"];
    const roots = [path.join(dir, "avatar", "ComfyUI"), "C:/WILLY_AVATAR/ComfyUI", "C:/ComfyUI/ComfyUI_windows_portable", "C:/ComfyUI"];
    search: for (const root of roots) {
      for (const pkg of packages) {
        const folder = path.join(root, ...pkg.split("/"), "imageio_ffmpeg", "binaries");
        let names: string[] = [];
        try { names = await fs.readdir(folder); } catch { continue; }
        for (const name of names.filter((n) => /^ffmpeg/i.test(n) && !/\.(?:py|pyc|txt|md)$/i.test(n)).sort()) {
          const candidate = path.join(folder, name);
          if (await works(candidate)) { found = candidate; break search; }
        }
      }
    }
  }
  ffmpegFound = { at: now, path: found };
  return found;
}

async function audioFromVideo(video: { bytes: Uint8Array; ext: string }, ffmpeg = "ffmpeg"): Promise<{ bytes: Uint8Array; ext: string } | null> {
  const { fs, path, crypto } = await modules();
  const os = await import("node:os");
  const cp = await import("node:child_process");
  const util = await import("node:util");
  const execFile = util.promisify(cp.execFile);
  const tag = crypto.randomBytes(6).toString("hex");
  const input = path.join(os.tmpdir(), `willy-avatar-${tag}.${video.ext}`);
  const output = path.join(os.tmpdir(), `willy-avatar-${tag}.wav`);
  try {
    await fs.writeFile(input, video.bytes);
    await execFile(ffmpeg, ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", output], { windowsHide: true, timeout: 120000 });
    const bytes = new Uint8Array(await fs.readFile(output));
    return bytes.byteLength > 1000 ? { bytes, ext: "wav" } : null;
  } catch {
    return null;
  } finally {
    await fs.rm(input, { force: true }).catch(() => undefined);
    await fs.rm(output, { force: true }).catch(() => undefined);
  }
}

/** De dónde sale la voz: del vídeo maestro, de WILLY leyendo un texto (Piper), de un audio tuyo, o «auto» (lo de antes: audio > vídeo > texto). */
export type VoiceMode = "auto" | "video" | "texto" | "audio";

type RenderInput = { text: string; photo: Uint8Array; photoKind: Kind; audio: { bytes: Uint8Array; ext: string } | null; video: { bytes: Uint8Array; ext: string } | null; voice?: VoiceMode };

async function runJob(dir: string, job: Job, input: RenderInput, deps: AvatarDeps): Promise<void> {
  const say = (text: string) => { job.steps.push(text); };
  const now = deps.now ?? Date.now;
  const settings = await loadSettings(dir);
  const voiceMode: VoiceMode = input.voice ?? "auto";
  let base = "";
  try {
    // 1) Voz
    let audio = voiceMode === "texto" ? null : input.audio;
    if (!audio && input.video && (voiceMode === "video" || voiceMode === "auto")) {
      job.status = "voz";
      say("Sacando tu voz del vídeo maestro…");
      const ffmpeg = await findFfmpeg(dir, deps);
      audio = ffmpeg ? await audioFromVideo(input.video, ffmpeg) : null;
      if (audio) say("Voz natural extraída del vídeo maestro.");
      else if (voiceMode === "video") {
        throw new Error(ffmpeg
          ? "No encuentro voz en el vídeo maestro (¿está en silencio o sin pista de audio?). Elige «Leer un texto» o «Un audio mío» en el paso 3."
          : "Para sacar la voz del vídeo hace falta ffmpeg y no lo encuentro en este equipo. Elige «Leer un texto» o «Un audio mío» en el paso 3.");
      } else say("No pude extraer audio del vídeo (ffmpeg no disponible o vídeo sin voz). Probaré la voz local configurada.");
    }
    if (!audio) {
      if (!input.text.trim()) throw new Error("El vídeo no contiene una pista de voz utilizable. Escribe texto o sube un audio.");
      job.status = "voz";
      say(voiceMode === "texto" ? "Generando la voz de WILLY con tu texto…" : "Generando la voz local de respaldo…");
      const voice = await speak(settings, input.text, deps, dir);
      audio = { bytes: voice.bytes, ext: voice.ext };
      say(`Voz lista (${voice.engine}${voice.attempts.length ? `; antes falló: ${voice.attempts.join(" · ")}` : ""}).`);
    } else if (input.audio) say("Uso tu audio original.");
    // Si la voz la ha hecho Chatterbox con la gráfica, se cierra ya: con 6 GB no caben a la vez él y los modelos de ComfyUI.
    await (await import("@/lib/voces-chatterbox")).releaseGpu();
    // 2) ComfyUI y flujos
    job.status = "animando";
    base = comfyBase(settings.comfyUrl);
    const status: Probe = await probe(base, deps, false);
    if (!status.running) throw new ComfyError("no-arranca", status.error);
    const installed = new Set(status.classes);
    const index = await loadIndex(dir);
    const described = await Promise.all(index.map((entry) => describeFlow(dir, entry, installed)));
    const flows = new Map(described.flatMap((d) => (d.info && d.graph ? [[d.info.id, { info: d.info, graph: d.graph }] as const] : [])));
    const plan = planPipelines([...flows.values()].map((f) => f.info), broken, now());
    if (!plan.pipelines.length) {
      throw new ComfyError("otro", `No hay ningún flujo listo para usar. ${index.length ? plan.skipped.map((s) => `«${s.flow}»: ${s.reason}`).join(" · ") : "Añade al menos un flujo (formato API) en Estudio de avatar → Flujos."}`);
    }
    for (const s of plan.skipped) say(`Salto «${s.flow}»: ${s.reason}.`);
    // Sin vídeo maestro, un camino que empieza por un flujo que necesita vídeo (movimiento, o labios sin foto) usaría el vídeo
    // de prueba que se quedó guardado dentro del flujo: se salta y se dice por qué.
    let pipelines = plan.pipelines;
    if (!input.video) {
      const needsMaster = (pipeline: Pipeline): boolean => {
        const first = flows.get(pipeline.stages[0]?.flowId ?? "")?.info;
        return !!first && first.needs.video && (first.role === "movimiento" || !first.needs.image);
      };
      for (const pipeline of pipelines.filter(needsMaster)) say(`Salto «${pipeline.label}»: necesita tu vídeo maestro.`);
      pipelines = pipelines.filter((pipeline) => !needsMaster(pipeline));
      if (!pipelines.length) throw new ComfyError("otro", "Tus flujos necesitan un vídeo maestro (tú hablando a cámara 10–20 s) para dar movimiento a la foto. Súbelo en el paso 2 y vuelve a crear el vídeo.");
    }
    // 3) Subidas
    const tag = job.id.slice(0, 6);
    const imageName = await uploadFile(base, input.photo, `willy_${tag}_foto.${input.photoKind}`, deps);
    const audioName = await uploadFile(base, audio.bytes, `willy_${tag}_audio.${audio.ext}`, deps);
    const drivingName = input.video ? await uploadFile(base, input.video.bytes, `willy_${tag}_movimiento.${input.video.ext}`, deps) : undefined;
    // 4) Probar los caminos, en orden
    for (const pipeline of pipelines) {
      if (job.abort.signal.aborted) throw new ComfyError("otro", "Cancelado.");
      say(`Probando: ${pipeline.label}`);
      try {
        const out = await runPipeline(base, pipeline, flows, { imageName, audioName, ...(drivingName ? { drivingName } : {}), tag }, job, settings, deps);
        job.attempts.push({ pipeline: pipeline.label, ok: true, error: "" });
        const { fs, path } = await modules();
        const folder = path.join(dir, "avatar-salidas");
        await fs.mkdir(folder, { recursive: true });
        const name = `avatar-IA-${stamp(new Date(now()))}.${out.ext}`;
        await writePrivate(path.join(folder, name), out.bytes);
        for (const old of (await fs.readdir(folder)).filter((n) => n.startsWith("avatar-IA-")).sort().reverse().slice(20)) await fs.rm(path.join(folder, old), { force: true }).catch(() => undefined);
        job.file = { path: path.join(folder, name), name, mime: MIME[out.ext] ?? "application/octet-stream", size: out.bytes.byteLength };
        job.status = "listo";
        say(`Vídeo listo (${Math.round(out.bytes.byteLength / 1024)} KB).`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (job.abort.signal.aborted) throw new ComfyError("otro", "Cancelado.");
        job.attempts.push({ pipeline: pipeline.label, ok: false, error: message });
        for (const stage of pipeline.stages) broken[stage.flowId] = now() + BREAK_MS;
        say(`«${pipeline.label}» no ha funcionado: ${message}`);
      }
    }
    throw new ComfyError("otro", `Ningún flujo ha podido crear el vídeo. ${job.attempts.map((a) => `${a.pipeline}: ${a.error}`).join(" · ")}`);
  } catch (error) {
    if (job.abort.signal.aborted) { job.status = "cancelado"; job.error = "Cancelado."; if (base) await interrupt(base, deps); }
    else { job.status = "error"; job.error = error instanceof Error ? error.message : String(error); }
    say(job.error);
  } finally {
    job.finishedAt = now();
    if (active === job) active = null;
  }
}

async function runPipeline(base: string, pipeline: Pipeline, flows: Map<string, { info: FlowInfo; graph: Graph }>, ctx: { imageName: string; audioName: string; drivingName?: string; tag: string }, job: Job, settings: Settings, deps: AvatarDeps): Promise<{ bytes: Uint8Array; ext: string }> {
  let video = ctx.drivingName;
  for (const [index, stage] of pipeline.stages.entries()) {
    const flow = flows.get(stage.flowId)!;
    const values: Partial<Record<Slot, string>> = { image: ctx.imageName };
    if (flow.info.role !== "movimiento") values.audio = ctx.audioName;
    if (video) values.video = video;
    const { graph } = bindGraph(flow.graph, values, { randomSeed: true });
    job.steps.push(`Paso ${index + 1}/${pipeline.stages.length} · ${flow.info.name}`);
    const promptId = await submit(base, graph, `willy-${ctx.tag}`, deps);
    const outputs = await waitForResult(base, promptId, { timeoutMs: settings.timeoutMin * 60_000, ...(deps.pollMs ? { pollMs: deps.pollMs } : {}), signal: job.abort.signal, onTick: (text) => { job.steps.push(text); if (job.steps.length > 400) job.steps.splice(0, 200); } }, deps);
    const file = pickOutput(outputs);
    if (!file) throw new ComfyError("salida", "El flujo terminó pero no guardó ningún vídeo (falta un nodo Video Combine / Save Video).");
    const bytes = await downloadFile(base, file, deps);
    const ext = (/\.([a-z0-9]+)$/i.exec(file.filename)?.[1] ?? "mp4").toLowerCase();
    if (index === pipeline.stages.length - 1) return { bytes, ext };
    video = await uploadFile(base, bytes, `willy_${ctx.tag}_paso${index + 1}.${ext}`, deps);
  }
  throw new ComfyError("otro", "Camino sin pasos.");
}

// ------------------------------------------------------------------------------------------------ acciones
const decode = (value: unknown, max: number, kinds: Kind[], what: string): { bytes: Uint8Array; kind: Kind } => {
  const text = typeof value === "string" ? value.replace(/^data:[^,]*,/, "") : "";
  if (!text || !/^[A-Za-z0-9+/=\s]+$/.test(text)) throw new Error(`Falta ${what} (o no se pudo leer).`);
  const bytes = new Uint8Array(Buffer.from(text, "base64"));
  if (bytes.byteLength > max) throw new Error(`${what[0]!.toUpperCase()}${what.slice(1)} es demasiado grande (máximo ${Math.round(max / 2 ** 20)} MB).`);
  const kind = sniff(bytes);
  if (!kind || !kinds.includes(kind)) throw new Error(`${what[0]!.toUpperCase()}${what.slice(1)} no es un archivo válido (${kinds.join(", ")}).`);
  return { bytes, kind };
};

export type AvatarResult = Record<string, unknown> & { error?: string; file?: { bytes: Uint8Array; name: string; mime: string } };

export async function avatarAction(dir: string, body: Record<string, unknown>, deps: AvatarDeps = {}): Promise<AvatarResult> {
  const action = String(body["action"] ?? "");
  const { fs, crypto } = await modules();
  const settings = await loadSettings(dir);
  const now = (deps.now ?? Date.now)();

  if (action === "status") {
    let base = "", comfy: Probe;
    try {
      base = comfyBase(settings.comfyUrl);
      comfy = await probe(base, deps, body["fresh"] !== true);
    } catch (error) {
      comfy = { running: false, version: "", gpu: "", vramGb: 0, freeGb: 0, classes: [], error: error instanceof Error ? error.message : String(error) };
    }
    const installed = comfy.running ? new Set(comfy.classes) : null;
    const index = await loadIndex(dir);
    const described = await Promise.all(index.map((entry) => describeFlow(dir, entry, installed)));
    const infos = described.flatMap((d) => (d.info ? [d.info] : []));
    const plan = planPipelines(comfy.running ? infos : [], broken, now);
    const piper = await piperStatus(settings.piper);
    const ffmpeg = await findFfmpeg(dir, deps);
    const natural = await naturalVoice(dir);
    return {
      ok: true,
      natural,
      comfy: { running: comfy.running, version: comfy.version, gpu: comfy.gpu, vramGb: comfy.vramGb, freeGb: comfy.freeGb, error: comfy.error, url: settings.comfyUrl, families: familiesIn(comfy.classes), nodes: comfy.classes.length },
      piper: { ...piper, mode: settings.piper.mode, exe: settings.piper.exe, model: settings.piper.model, speaker: settings.piper.speaker ?? 0, voicesDir: settings.piper.voicesDir, voices: await voiceChoices(settings.piper.voicesDir) },
      hf: { enabled: settings.hf.enabled, model: settings.hf.model, hasToken: !!settings.hf.token, last4: settings.hf.token.slice(-4) },
      ffmpeg: { ok: !!ffmpeg, path: ffmpeg },
      timeoutMin: settings.timeoutMin,
      flows: described.flatMap((d) => (d.info ? [{ ...d.info, checked: d.checked, hints: d.hints, pausedMin: Math.max(0, Math.ceil(((broken[d.info.id] ?? 0) - now) / 60000)) }] : [])),
      plan: { pipelines: plan.pipelines.map((p) => p.label), skipped: plan.skipped },
      families: FAMILIES.map((f) => ({ id: f.id, label: f.label, repo: f.repo, note: f.note })),
      comfyInstall: showComfyInstall(comfyInstallJob),
    };
  }

  // «Arrancar ComfyUI»: abre el lanzador de siempre (el que el dueño usa a mano) en una ventana aparte y minimizada, para que
  // se pueda ver y cerrar. Con «check» solo dice qué lanzador usaría. Solo en Windows.
  if (action === "comfy-start") {
    const { fs, path } = await modules();
    if (process.platform !== "win32") return { error: "Arrancar ComfyUI desde aquí solo funciona en Windows." };
    const candidates = [
      "C:\\WILLY_AVATAR\\ARRANCAR_WILLY_AVATAR.bat",
      path.join(dir, "avatar", "run_nvidia_gpu.bat"),
      "C:\\ComfyUI\\ComfyUI_windows_portable\\run_nvidia_gpu.bat",
      "C:\\ComfyUI\\run_nvidia_gpu.bat",
    ];
    let launcher = "";
    for (const file of candidates) {
      try { if ((await fs.stat(file)).isFile()) { launcher = file; break; } } catch { /* no está */ }
    }
    if (!launcher) return { error: "No encuentro el lanzador de ComfyUI en este equipo (C:\\WILLY_AVATAR\\ARRANCAR_WILLY_AVATAR.bat o run_nvidia_gpu.bat)." };
    if (body["check"] === true) return { ok: true, launcher };
    try {
      if ((await probe(comfyBase(settings.comfyUrl), deps, false)).running) return { ok: true, already: true, launcher };
    } catch { /* apagado: se arranca */ }
    const cp = await import("node:child_process");
    const child = cp.spawn("cmd.exe", ["/c", "start", "\"ComfyUI\"", "/min", `"${launcher}"`], { cwd: path.dirname(launcher), detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true });
    child.on("error", () => undefined);
    child.unref();
    return { ok: true, started: true, launcher };
  }

  if (action === "comfy-install") {
    if (comfyInstallJob && comfyInstallJob.status === "activo") return { ok: true, job: showComfyInstall(comfyInstallJob) };
    const job: ComfyInstallJob = { id: crypto.randomBytes(6).toString("hex"), status: "activo", pct: 0, step: "Empezando", text: "Preparando la instalación automática…", error: "", log: [] };
    comfyInstallJob = job;
    const python = String(body["python"] ?? "python") || "python";
    void installComfy(dir, job, {}, python).then(
      () => { job.status = "listo"; job.pct = 100; },
      (error: unknown) => { job.status = "error"; job.error = error instanceof Error ? error.message : String(error); },
    );
    return { ok: true, job: showComfyInstall(job) };
  }

  if (action === "comfy-install-status") {
    return { ok: true, job: showComfyInstall(comfyInstallJob) };
  }

  if (action === "settings") {
    const next = sanitizeSettings(obj(body["settings"]), settings);
    if (obj(obj(body["settings"])["hf"])["clearToken"] === true) next.hf.token = "";
    else if (!obj(obj(body["settings"])["hf"])["token"]) next.hf.token = settings.hf.token;
    try { comfyBase(next.comfyUrl); } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
    await saveSettings(dir, next);
    return { ok: true };
  }

  if (action === "flow-add") {
    const raw = typeof body["json"] === "string" ? body["json"] : "";
    if (!raw || raw.length > 3_000_000) return { error: "El archivo del flujo está vacío o es demasiado grande (máximo 3 MB)." };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { error: "Ese archivo no es un JSON válido." }; }
    const graph = unwrapGraph(parsed);
    if (!graph) {
      const looksUi = Array.isArray(obj(parsed)["nodes"]) && Array.isArray(obj(parsed)["links"]);
      return { error: looksUi ? "Ese es el formato de EDICIÓN de ComfyUI. Necesito el formato API: en ComfyUI activa «Dev mode» (Ajustes) y usa Workflow → «Export (API)» / «Save (API Format)»." : "No reconozco ese flujo. Tiene que ser el formato API de ComfyUI (un JSON donde cada nodo tiene class_type e inputs)." };
    }
    const index = await loadIndex(dir);
    if (index.length >= 20) return { error: "Ya tienes 20 flujos: quita alguno." };
    const id = `f${crypto.randomBytes(4).toString("hex")}`;
    const role: Role = (body["role"] as string) in ROLES ? (body["role"] as Role) : guessRole(graph);
    const { path } = await modules();
    await writePrivate(path.join(dir, "avatar", "flujos", `${id}.json`), JSON.stringify(graph));
    index.push({ id, name: str(body["name"], 60) || `Flujo ${index.length + 1}`, role, addedAt: new Date(now).toISOString() });
    await saveIndex(dir, index);
    return { ok: true, id, role, nodes: Object.keys(graph).length };
  }

  if (action === "flow-remove" || action === "flow-move" || action === "flow-role") {
    const id = String(body["id"] ?? "");
    const index = await loadIndex(dir);
    const at = index.findIndex((f) => f.id === id);
    if (at < 0) return { error: "No encuentro ese flujo." };
    if (action === "flow-remove") {
      const { path } = await modules();
      index.splice(at, 1);
      await fs.rm(path.join(dir, "avatar", "flujos", `${id}.json`), { force: true }).catch(() => undefined);
    } else if (action === "flow-move") {
      const to = at + (body["dir"] === "up" ? -1 : 1);
      if (to >= 0 && to < index.length) [index[at], index[to]] = [index[to]!, index[at]!];
    } else if ((body["role"] as string) in ROLES) index[at]!.role = body["role"] as Role;
    await saveIndex(dir, index);
    return { ok: true };
  }

  if (action === "voice-test") {
    try {
      const text = str(body["text"], 400) || "Hola, esta es una prueba de mi voz.";
      const out = await speak(settings, text, deps, dir);
      return { ok: true, engine: out.engine, mime: MIME[out.ext], audio: Buffer.from(out.bytes).toString("base64") };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (action === "render") {
    if (body["consent"] !== true) return { error: "Confirma que la cara es tuya, de alguien que te ha dado permiso, o de un personaje inventado." };
    if (active && !active.finishedAt) return { error: "Ya hay un vídeo en marcha. Espera a que termine o cancélalo." };
    try {
      const photo = decode(body["photo"], 15 * 2 ** 20, ["png", "jpg", "webp"], "la foto");
      const audio = body["audio"] ? decode(body["audio"], 40 * 2 ** 20, ["wav", "mp3", "flac", "ogg"], "el audio") : null;
      const video = body["video"] ? decode(body["video"], 80 * 2 ** 20, ["mp4", "webm"], "el vídeo de movimiento") : null;
      const text = str(body["text"], 6000);
      const voice: VoiceMode = body["voice"] === "video" || body["voice"] === "texto" || body["voice"] === "audio" ? body["voice"] : "auto";
      if (voice === "video" && !video) return { error: "Para usar la voz de tu vídeo maestro, súbelo primero (paso 2)." };
      if (voice === "texto" && !text) return { error: "Escribe el texto que debe decir (paso 3)." };
      if (voice === "audio" && !audio) return { error: "Elige el archivo de audio con tu voz (paso 3)." };
      if (voice === "auto" && !audio && !text && !video) return { error: "Escribe el texto que debe decir, sube tu audio o usa tu vídeo maestro." };
      const job: Job = { id: crypto.randomBytes(8).toString("hex"), status: "voz", steps: [], attempts: [], error: "", file: null, startedAt: now, finishedAt: 0, abort: new AbortController() };
      jobs.set(job.id, job);
      for (const [key, old] of jobs) if (jobs.size > 6 && old.finishedAt && key !== job.id) jobs.delete(key);
      active = job;
      void runJob(dir, job, { text, photo: photo.bytes, photoKind: photo.kind, audio: audio ? { bytes: audio.bytes, ext: audio.kind } : null, video: video ? { bytes: video.bytes, ext: video.kind } : null, voice }, deps);
      return { ok: true, job: publicJob(job) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (action === "job" || action === "cancel" || action === "job-file") {
    const job = jobs.get(String(body["id"] ?? ""));
    if (!job) return { error: "No encuentro ese trabajo." };
    if (action === "cancel") { job.abort.abort(); return { ok: true, job: publicJob(job) }; }
    if (action === "job-file") {
      if (!job.file) return { error: "Ese vídeo todavía no está listo." };
      return { ok: true, file: { bytes: new Uint8Array(await fs.readFile(job.file.path)), name: job.file.name, mime: job.file.mime } };
    }
    return { ok: true, job: publicJob(job) };
  }

  return { error: "Acción desconocida." };
}
