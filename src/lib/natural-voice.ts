// Lectura en voz alta con voces NATURALES (Piper), exclusivamente: nunca se usa la voz robótica de Windows.
// Si la voz natural no está lista todavía, WILLY la instala sola (motor + una voz de España) la primera vez
// y sigue leyendo en cuanto está lista. Se pide el trozo siguiente mientras suena el actual, para que no
// haya silencios entre frases.

import { chunkForSpeech, type SpeechHandle } from "@/lib/tts-voice";
import { concatWav } from "@/lib/wav";
import { cleanForSpeech } from "@/lib/voz-limpia";

export type ChunkDeps = {
  fetchWav: (text: string, signal: AbortSignal) => Promise<Blob>;
  play: (blob: Blob, speed: number, signal: AbortSignal) => Promise<void>;
};
type Fetched = { blob: Blob } | { error: string };

export function speakChunks(chunks: string[], deps: ChunkDeps, opts: { speed?: number; onChunk?: (index: number, total: number) => void; onEnd?: () => void; onFallback?: (rest: string[], why: string) => void } = {}): SpeechHandle {
  const controller = new AbortController();
  const get = async (text: string): Promise<Fetched> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return { blob: await deps.fetchWav(text, controller.signal) }; } catch (error) { if (controller.signal.aborted) return { error: "parado" }; if (attempt === 1) return { error: error instanceof Error ? error.message : String(error) }; }
    }
    return { error: "sin respuesta" };
  };
  void (async () => {
    let next: Promise<Fetched> | null = chunks.length ? get(chunks[0]!) : null;
    for (let i = 0; i < chunks.length; i++) {
      const current = await next!;
      if (controller.signal.aborted) return;
      if ("error" in current) { opts.onFallback?.(chunks.slice(i), current.error); return; }
      next = i + 1 < chunks.length ? get(chunks[i + 1]!) : null;
      opts.onChunk?.(i, chunks.length);
      try { await deps.play(current.blob, opts.speed ?? 1, controller.signal); } catch (error) { if (controller.signal.aborted) return; opts.onFallback?.(chunks.slice(i), error instanceof Error ? error.message : String(error)); return; }
    }
    if (!controller.signal.aborted) opts.onEnd?.();
  })();
  return { stop: () => controller.abort(), get stopped() { return controller.signal.aborted; } };
}

// ------------------------------------------------------------------------------------------------ navegador
async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return fetch("/api/voces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
}

async function fetchWav(text: string, voice: string | undefined, pace: { rate?: number; pause?: number } | undefined, signal: AbortSignal): Promise<Blob> {
  const res = await post({ action: "speak", text, ...(voice ? { voice } : {}), ...(pace?.rate ? { rate: pace.rate } : {}), ...(pace?.pause != null ? { pause: pace.pause } : {}) }, signal);
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `La voz natural respondió ${res.status}.`);
  return res.blob();
}

/** Audio (.wav) de un trozo corto con la voz natural, para quien necesita tenerlo preparado por adelantado
 *  (por ejemplo, la narración sincronizada con un vídeo). */
export function synthesizeSpeech(text: string, voice: string | undefined, signal: AbortSignal): Promise<Blob> {
  return fetchWav(text, voice || undefined, undefined, signal);
}

/** ¿Hay ya una voz natural lista? Si no, la instala sola (motor + una voz de España) y espera a que termine. */
export async function ensureNaturalVoice(onProgress?: (text: string) => void): Promise<{ ok: true } | { ok: false; error: string }> {
  const start = await voiceCall({ action: "ensure-ready" });
  if (!start.ok) return { ok: false, error: start.error ?? "No se pudo preparar la voz natural." };
  if (start.data?.ready) return { ok: true };
  let jobId = start.data?.job?.id as string | undefined;
  if (!jobId) return { ok: false, error: "No se pudo iniciar la instalación de la voz natural." };
  for (let i = 0; i < 300; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    const check = await voiceCall({ action: "job", id: jobId });
    const job = check.data?.job as { status?: string; text?: string; error?: string } | undefined;
    if (!job) return { ok: false, error: "Se perdió el progreso de la instalación de la voz." };
    onProgress?.(job.text ?? "Preparando la voz natural…");
    if (job.status === "listo") return { ok: true };
    if (job.status === "error") return { ok: false, error: job.error || "No se pudo instalar la voz natural." };
  }
  return { ok: false, error: "La instalación de la voz natural está tardando demasiado." };
}

function play(blob: Blob, speed: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = Math.max(0.5, Math.min(2, speed));
    const done = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onended = done;
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No pude reproducir el audio.")); };
    signal.addEventListener("abort", () => { audio.pause(); done(); }, { once: true });
    audio.play().catch((error) => { URL.revokeObjectURL(url); reject(error instanceof Error ? error : new Error("El navegador no dejó reproducir el audio.")); });
  });
}

export type BestOptions = {
  naturalVoice?: string;
  /** Ritmo real (no un truco de velocidad): 0.7 rápido … 1.6 muy pausado. Si no se indica, se usa el guardado en Estudio de avatar. */
  rate?: number;
  /** Pausa real entre frases, en segundos: 0.1 … 1.2. Si no se indica, se usa la guardada en Estudio de avatar. */
  pause?: number;
  onChunk?: (index: number, total: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
  /** Aviso de progreso mientras WILLY instala la voz natural sola, la primera vez. */
  onPreparing?: (message: string) => void;
};

/**
 * Lee el texto con una voz natural (nunca la de Windows). Si la voz natural todavía no está instalada,
 * la prepara sola (motor Piper + una voz de España) y, en cuanto está lista, empieza a leer. Solo si de
 * verdad no se puede preparar (por ejemplo, sin conexión la primera vez) se avisa con `onError`.
 */
export function speakBest(text: string, o: BestOptions = {}): SpeechHandle {
  let stopped = false;
  let inner: SpeechHandle | null = null;
  const pace = { ...(o.rate ? { rate: o.rate } : {}), ...(o.pause != null ? { pause: o.pause } : {}) };
  const startReading = () => {
    if (stopped) return;
    inner = speakChunks(chunkForSpeech(cleanForSpeech(text), 55), { fetchWav: (t, s) => fetchWav(t, o.naturalVoice, pace, s), play }, {
      ...(o.onChunk ? { onChunk: o.onChunk } : {}),
      ...(o.onEnd ? { onEnd: o.onEnd } : {}),
      onFallback: (_rest, why) => { o.onError?.(`La voz natural ha fallado a media lectura: ${why}`); },
    });
  };
  // Se comprueba (sin gastar ninguna síntesis) si ya hay una voz natural lista; si no, se instala sola. Lista = una voz más
  // humana (Gemini, Chatterbox, ElevenLabs o Chirp: su id lleva «proveedor:») o Piper con alguna voz, como «ensure-ready» en el
  // servidor. Así no sale el aviso de preparar la voz en cada lectura desde que Piper se retiró.
  void (async () => {
    const status = await voiceStatus();
    if (stopped) return;
    if (status && ((status.piper.ready && status.installed.length) || status.installed.some((v) => v.id.includes(":")))) return startReading();
    o.onPreparing?.("Preparando la voz natural (la primera vez tarda un poco)…");
    const ready = await ensureNaturalVoice((text) => o.onPreparing?.(text));
    if (stopped) return;
    if (!ready.ok) { o.onError?.(`No hay ninguna voz natural disponible: ${ready.error}`); return; }
    startReading();
  })();
  return {
    stop: () => { stopped = true; inner?.stop(); },
    get stopped() { return stopped || (inner?.stopped ?? false); },
  };
}

/** Audio completo (un solo .wav) con la voz natural, para escuchar el documento fuera de WILLY. */
export async function exportNaturalAudio(text: string, voice: string | undefined, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<Blob> {
  const chunks = chunkForSpeech(cleanForSpeech(text), 90);
  const parts: Uint8Array[] = [];
  for (const [i, chunk] of chunks.entries()) {
    if (signal.aborted) throw new Error("Cancelado.");
    parts.push(new Uint8Array(await (await fetchWav(chunk, voice, undefined, signal)).arrayBuffer()));
    onProgress(i + 1, chunks.length);
  }
  return new Blob([concatWav(parts) as BlobPart], { type: "audio/wav" });
}

export type VoiceStatus = { piper: { ready: boolean; mode: string; canInstall: boolean }; pace: { lengthScale: number; sentenceSilence: number }; installed: Array<{ id: string; label: string; active: boolean }>; catalog: Array<{ id: string; label: string; group: string; quality: string; mb: number; installed: boolean; recommended?: boolean }>; job: { id: string; kind: string; label: string; status: "activo" | "listo" | "error"; pct: number; text: string; error: string } | null };
export async function voiceStatus(): Promise<VoiceStatus | null> {
  try { const res = await post({ action: "status" }); return res.ok ? ((await res.json()) as VoiceStatus) : null; } catch { return null; }
}
export const voiceCall = async (body: Record<string, unknown>): Promise<{ ok: boolean; data: any; error?: string }> => {
  try { const res = await post(body); const data = await res.json().catch(() => ({})); return { ok: res.ok, data, ...(res.ok ? {} : { error: data.error ?? `Error ${res.status}` }) }; } catch (error) { return { ok: false, data: {}, error: error instanceof Error ? error.message : "Sin conexión con WILLY." }; }
};
