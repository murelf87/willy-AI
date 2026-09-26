// Cliente de ComfyUI (solo en este equipo). Habla el protocolo HTTP de ComfyUI: /system_stats, /object_info, /upload/image, /prompt,
// /history, /view. Independiente de qué nodos uses: importa TUS flujos (formato API) y rellena la foto, el audio y el vídeo.

export type Fetch = typeof fetch;
export type Deps = { fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void>; now?: () => number };

export type Node = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
export type Graph = Record<string, Node>;

const sleepReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ComfyError extends Error {
  readonly kind: "no-arranca" | "nodos" | "ejecucion" | "tiempo" | "salida" | "otro";
  constructor(kind: ComfyError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Solo se habla con un ComfyUI de ESTE equipo (http, 127.0.0.1 / localhost / ::1): nunca con direcciones de internet o de la red. */
export function comfyBase(raw: string | undefined): string {
  const text = (raw ?? "").trim() || "http://127.0.0.1:8188";
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    throw new ComfyError("otro", "La dirección de ComfyUI no es válida (por ejemplo http://127.0.0.1:8188).");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(host)) throw new ComfyError("otro", "ComfyUI tiene que estar en este mismo equipo (http://127.0.0.1:8188).");
  const port = Number(url.port || 80);
  if (!(port >= 1 && port <= 65535)) throw new ComfyError("otro", "Puerto de ComfyUI no válido.");
  return `http://${host === "::1" ? "[::1]" : host}:${port}`;
}

// ------------------------------------------------------------------------------------------------ grafo
export function isApiGraph(value: unknown): value is Graph {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(([, node]) => !!node && typeof node === "object" && typeof (node as Node).class_type === "string" && !!(node as Node).inputs && typeof (node as Node).inputs === "object" && !Array.isArray((node as Node).inputs));
}

/** Acepta el flujo tal cual o envuelto en { prompt: … }. */
export function unwrapGraph(value: unknown): Graph | null {
  if (isApiGraph(value)) return value;
  const inner = value && typeof value === "object" ? (value as Record<string, unknown>)["prompt"] : undefined;
  return isApiGraph(inner) ? inner : null;
}

const IMAGE_CLASS = /^LoadImage(?!Output)/i;
const AUDIO_CLASS = /^(LoadAudio|LoadAudioUpload|VHS_LoadAudioUpload)$/;
const VIDEO_CLASS = /^(VHS_LoadVideo|LoadVideo)$/;
const OUTPUT_CLASS = /VideoCombine|SaveVideo|SaveAnimated|SaveWEBM|SaveGIF|VHS_VideoCombine/i;
// Nodo que guarda una imagen fija (para el flujo de «Crea tu avatar IA»: personaje, no vídeo).
const IMAGE_OUTPUT_CLASS = /^(SaveImage|SaveImageWebsocket|PreviewImage)/i;
export type Slot = "image" | "audio" | "video";
const KEYS: Record<Slot, string[]> = { image: ["image"], audio: ["audio"], video: ["video", "file"] };
const TAG: Record<Slot, RegExp> = { image: /AVATAR_IMAGEN/i, audio: /AVATAR_AUDIO/i, video: /AVATAR_VIDEO/i };
// El texto de la escena/pose para «personaje»: manda el nodo titulado AVATAR_PROMPT; si no hay ninguno y solo existe UN
// nodo de texto (CLIPTextEncode y similares), se usa ese (para no escribir en un «prompt negativo» por error).
const PROMPT_TAG = /AVATAR_PROMPT/i;
const PROMPT_CLASS = /CLIPTextEncode|(?:^|[^a-z])Prompt(?:[^a-z]|$)/i;

/** Los nodos donde va cada entrada: los que llevan la etiqueta AVATAR_… en el título mandan; si no, los de cargar imagen/audio/vídeo. */
export function slotNodes(graph: Graph): Record<Slot, string[]> {
  const ids = Object.keys(graph).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const out: Record<Slot, string[]> = { image: [], audio: [], video: [] };
  const classOf: Record<Slot, RegExp> = { image: IMAGE_CLASS, audio: AUDIO_CLASS, video: VIDEO_CLASS };
  for (const slot of ["image", "audio", "video"] as Slot[]) {
    const tagged = ids.filter((id) => TAG[slot].test(graph[id]?._meta?.title ?? "") && KEYS[slot].some((key) => key in (graph[id]?.inputs ?? {})));
    out[slot] = tagged.length ? tagged : ids.filter((id) => classOf[slot].test(graph[id]!.class_type) && KEYS[slot].some((key) => key in graph[id]!.inputs));
  }
  return out;
}

export function describeGraph(graph: Graph): { classes: string[]; slots: Record<Slot, string[]>; hasVideoOutput: boolean; hasImageOutput: boolean; warnings: string[] } {
  const classes = [...new Set(Object.values(graph).map((node) => node.class_type))];
  const slots = slotNodes(graph);
  const warnings: string[] = [];
  for (const slot of ["image", "audio", "video"] as Slot[]) if (slots[slot].length > 1) warnings.push(`Hay ${slots[slot].length} nodos de ${slot === "image" ? "imagen" : slot === "audio" ? "audio" : "vídeo"}: se rellenan todos. Si solo uno es el tuyo, ponle al título del nodo AVATAR_${slot === "image" ? "IMAGEN" : slot.toUpperCase()}.`);
  return { classes, slots, hasVideoOutput: classes.some((name) => OUTPUT_CLASS.test(name)), hasImageOutput: classes.some((name) => IMAGE_OUTPUT_CLASS.test(name)), warnings };
}

/** Escribe el texto de la escena en el nodo de texto del flujo (ver PROMPT_TAG arriba). Si hay varios y ninguno está
 * etiquetado, no toca nada (mejor no acertar que escribir en el sitio equivocado). */
export function bindPrompt(graph: Graph, text: string): { graph: Graph; bound: boolean } {
  const copy = JSON.parse(JSON.stringify(graph)) as Graph;
  const ids = Object.keys(copy).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const tagged = ids.filter((id) => PROMPT_TAG.test(copy[id]?._meta?.title ?? "") && "text" in (copy[id]?.inputs ?? {}));
  const candidates = tagged.length ? tagged : ids.filter((id) => PROMPT_CLASS.test(copy[id]!.class_type) && typeof copy[id]!.inputs["text"] === "string");
  if (candidates.length !== 1) return { graph: copy, bound: false };
  copy[candidates[0]!]!.inputs["text"] = text;
  return { graph: copy, bound: true };
}

/** Copia del flujo con la foto, el audio y el vídeo puestos (y semillas nuevas para que cada vídeo salga distinto). */
export function bindGraph(graph: Graph, values: Partial<Record<Slot, string>>, opts: { randomSeed?: boolean; rnd?: () => number } = {}): { graph: Graph; bound: Record<Slot, number> } {
  const copy = JSON.parse(JSON.stringify(graph)) as Graph;
  const slots = slotNodes(copy);
  const bound: Record<Slot, number> = { image: 0, audio: 0, video: 0 };
  for (const slot of ["image", "audio", "video"] as Slot[]) {
    const value = values[slot];
    if (value === undefined) continue;
    for (const id of slots[slot]) {
      const key = KEYS[slot].find((candidate) => candidate in copy[id]!.inputs);
      if (key) { copy[id]!.inputs[key] = value; bound[slot] += 1; }
    }
  }
  if (opts.randomSeed) {
    const rnd = opts.rnd ?? Math.random;
    for (const node of Object.values(copy)) for (const key of ["seed", "noise_seed"]) if (typeof node.inputs[key] === "number") node.inputs[key] = Math.floor(rnd() * 2 ** 32);
  }
  return { graph: copy, bound };
}

export function missingClasses(graph: Graph, installed: Set<string>): string[] {
  return [...new Set(Object.values(graph).map((node) => node.class_type))].filter((name) => !installed.has(name));
}

// ------------------------------------------------------------------------------------------------ HTTP
async function getJson<T>(url: string, deps: Deps, timeoutMs: number): Promise<{ status: number; data: T | null }> {
  const res = await (deps.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  try {
    return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
  } catch {
    return { status: res.status, data: null };
  }
}

export type Probe = { running: boolean; version: string; gpu: string; vramGb: number; freeGb: number; classes: string[]; error: string };
const cache = new Map<string, { at: number; probe: Probe }>();
export const clearProbeCache = (): void => cache.clear();

/** ¿Está ComfyUI en marcha y qué nodos tiene? (la lista de nodos se guarda 60 s: es grande). */
export async function probe(base: string, deps: Deps = {}, useCache = true): Promise<Probe> {
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(base);
  if (useCache && hit && now - hit.at < 60_000 && hit.probe.running) return hit.probe;
  const down = (error: string): Probe => ({ running: false, version: "", gpu: "", vramGb: 0, freeGb: 0, classes: [], error });
  try {
    const stats = await getJson<{ system?: { comfyui_version?: string }; devices?: Array<{ name?: string; vram_total?: number; vram_free?: number }> }>(`${base}/system_stats`, deps, 5000);
    if (stats.status !== 200) return down(`ComfyUI respondió ${stats.status} en ${base}.`);
    const info = await getJson<Record<string, unknown>>(`${base}/object_info`, deps, 60_000);
    if (info.status !== 200 || !info.data) return down("ComfyUI no devolvió la lista de nodos instalados.");
    const dev = stats.data?.devices?.[0];
    const result: Probe = { running: true, version: stats.data?.system?.comfyui_version ?? "", gpu: dev?.name ?? "", vramGb: Math.round(((dev?.vram_total ?? 0) / 2 ** 30) * 10) / 10, freeGb: Math.round(((dev?.vram_free ?? 0) / 2 ** 30) * 10) / 10, classes: Object.keys(info.data), error: "" };
    cache.set(base, { at: now, probe: result });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return down(/timeout|abort/i.test(detail) ? `ComfyUI tarda demasiado en responder en ${base}.` : `ComfyUI no está en marcha en ${base}. Arráncalo con su lanzador (en tu equipo: C:\\WILLY_AVATAR\\ARRANCAR_WILLY_AVATAR.bat; en la versión portable: run_nvidia_gpu.bat) y vuelve a pulsar «Comprobar».`);
  }
}

export async function uploadFile(base: string, bytes: Uint8Array, filename: string, deps: Deps = {}): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([bytes as BlobPart]), filename);
  form.append("type", "input");
  form.append("overwrite", "true");
  const res = await (deps.fetchImpl ?? fetch)(`${base}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new ComfyError("otro", `ComfyUI no aceptó el archivo (${res.status}).`);
  const data = (await res.json().catch(() => ({}))) as { name?: string; subfolder?: string };
  if (!data.name) throw new ComfyError("otro", "ComfyUI no devolvió el nombre del archivo subido.");
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

type NodeErrors = Record<string, { class_type?: string; errors?: Array<{ message?: string; details?: string }> }>;

export async function submit(base: string, graph: Graph, clientId: string, deps: Deps = {}): Promise<string> {
  const res = await (deps.fetchImpl ?? fetch)(`${base}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: clientId }), signal: AbortSignal.timeout(30_000) });
  const data = (await res.json().catch(() => ({}))) as { prompt_id?: string; error?: { message?: string; details?: string } | string; node_errors?: NodeErrors };
  if (res.ok && data.prompt_id) return data.prompt_id;
  const nodeErrors = Object.entries(data.node_errors ?? {}).flatMap(([id, entry]) => (entry.errors ?? []).map((e) => `nodo ${id} (${entry.class_type ?? "?"}): ${e.message ?? ""}${e.details ? ` — ${e.details}` : ""}`));
  const general = typeof data.error === "string" ? data.error : data.error?.message ?? "";
  throw new ComfyError("nodos", `ComfyUI rechazó el flujo: ${[general, ...nodeErrors.slice(0, 3)].filter(Boolean).join(" | ") || `error ${res.status}`}`);
}

export type OutFile = { filename: string; subfolder: string; type: string };
type HistoryEntry = { outputs?: Record<string, Record<string, unknown>>; status?: { status_str?: string; completed?: boolean; messages?: Array<[string, Record<string, unknown>]> } };

/** Espera a que termine el trabajo: sondea /history (y /queue para decir cuántos hay delante). */
export async function waitForResult(base: string, promptId: string, opts: { timeoutMs: number; pollMs?: number; onTick?: (text: string) => void; signal?: AbortSignal }, deps: Deps = {}): Promise<Record<string, Record<string, unknown>>> {
  const sleep = deps.sleep ?? sleepReal;
  const now = deps.now ?? Date.now;
  const started = now();
  for (;;) {
    if (opts.signal?.aborted) throw new ComfyError("otro", "Cancelado.");
    if (now() - started > opts.timeoutMs) throw new ComfyError("tiempo", `ComfyUI no terminó en ${Math.round(opts.timeoutMs / 60000)} minutos (¿poca memoria gráfica o un modelo muy pesado?).`);
    const history = await getJson<Record<string, HistoryEntry>>(`${base}/history/${encodeURIComponent(promptId)}`, deps, 15_000).catch(() => ({ status: 0, data: null }));
    const entry = history.data?.[promptId];
    if (entry?.status?.status_str === "error") {
      const failure = entry.status.messages?.find((m) => m[0] === "execution_error")?.[1];
      throw new ComfyError("ejecucion", `Falló dentro de ComfyUI${failure?.["node_type"] ? ` en el nodo ${String(failure["node_type"])}` : ""}: ${String(failure?.["exception_message"] ?? "error desconocido").trim().slice(0, 300)}`);
    }
    if (entry && (entry.status?.completed || entry.status?.status_str === "success")) return entry.outputs ?? {};
    const queue = await getJson<{ queue_running?: unknown[]; queue_pending?: unknown[] }>(`${base}/queue`, deps, 8000).catch(() => ({ status: 0, data: null }));
    const pending = queue.data?.queue_pending?.length ?? 0;
    opts.onTick?.(pending ? `En cola (${pending} por delante)…` : `Trabajando… ${Math.round((now() - started) / 1000)} s`);
    await sleep(opts.pollMs ?? 1500);
  }
}

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi)$/i;
const ANIM_EXT = /\.(gif|webp)$/i;

/** El archivo de vídeo que ha producido el flujo (prefiere mp4/webm; acepta gif/webp animados). */
export function pickOutput(outputs: Record<string, Record<string, unknown>>): OutFile | null {
  const files: OutFile[] = [];
  for (const entry of Object.values(outputs)) for (const key of ["videos", "gifs", "images"]) {
    const list = entry[key];
    if (Array.isArray(list)) for (const item of list) if (item && typeof item === "object" && typeof (item as OutFile).filename === "string") files.push({ filename: (item as OutFile).filename, subfolder: String((item as OutFile).subfolder ?? ""), type: String((item as OutFile).type ?? "output") });
  }
  return files.find((f) => VIDEO_EXT.test(f.filename) && f.type === "output") ?? files.find((f) => VIDEO_EXT.test(f.filename)) ?? files.find((f) => ANIM_EXT.test(f.filename)) ?? null;
}

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** La imagen fija que ha producido el flujo de «personaje» (prefiere la de tipo «output»; ignora vídeos/gifs). */
export function pickImageOutput(outputs: Record<string, Record<string, unknown>>): OutFile | null {
  const files: OutFile[] = [];
  for (const entry of Object.values(outputs)) for (const key of ["images", "gifs"]) {
    const list = entry[key];
    if (Array.isArray(list)) for (const item of list) if (item && typeof item === "object" && typeof (item as OutFile).filename === "string") files.push({ filename: (item as OutFile).filename, subfolder: String((item as OutFile).subfolder ?? ""), type: String((item as OutFile).type ?? "output") });
  }
  return files.find((f) => IMAGE_EXT.test(f.filename) && f.type === "output") ?? files.find((f) => IMAGE_EXT.test(f.filename)) ?? null;
}

export async function downloadFile(base: string, file: OutFile, deps: Deps = {}, maxBytes = 400 * 2 ** 20): Promise<Uint8Array> {
  const url = `${base}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder)}&type=${encodeURIComponent(file.type)}`;
  const res = await (deps.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new ComfyError("salida", `No pude recoger el vídeo de ComfyUI (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new ComfyError("salida", "El vídeo es demasiado grande.");
  if (!bytes.byteLength) throw new ComfyError("salida", "ComfyUI devolvió un vídeo vacío.");
  return bytes;
}

export async function interrupt(base: string, deps: Deps = {}): Promise<void> {
  await (deps.fetchImpl ?? fetch)(`${base}/interrupt`, { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
}

// ------------------------------------------------------------------------------------------------ tipos de archivo (por contenido, no por nombre)
export type Kind = "png" | "jpg" | "webp" | "mp4" | "webm" | "wav" | "mp3" | "flac" | "ogg";
export function sniff(bytes: Uint8Array): Kind | null {
  const at = (i: number, s: string) => s.split("").every((c, k) => bytes[i + k] === c.charCodeAt(0));
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && at(1, "PNG")) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (at(0, "RIFF") && at(8, "WEBP")) return "webp";
  if (at(0, "RIFF") && at(8, "WAVE")) return "wav";
  if (at(4, "ftyp")) return "mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  if (at(0, "fLaC")) return "flac";
  if (at(0, "OggS")) return "ogg";
  if (at(0, "ID3") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return "mp3";
  return null;
}
export const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", gif: "image/gif", wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg" };
