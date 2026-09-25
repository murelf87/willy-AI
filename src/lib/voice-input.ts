// Dictado por voz.
// 1) Chrome/Edge/Safari: reconocimiento de voz del navegador (tiempo real).
// 2) Firefox y otros sin reconocimiento: graba el audio y lo transcribe con un
//    modelo de voz que corre localmente en el navegador (se descarga una vez
//    y queda guardado; funciona sin conexión después).

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type WindowWithSpeech = Window & {
  SpeechRecognition?: new () => RecognitionLike;
  webkitSpeechRecognition?: new () => RecognitionLike;
};

export function speechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as WindowWithSpeech;
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function recordingSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

/** Verdadero si el micrófono puede usarse de alguna forma en este navegador. */
export function voiceSupported(): boolean {
  return speechRecognitionSupported() || recordingSupported();
}

export type VoiceSession = { stop: () => void };

export type DictationOpts = {
  onText: (text: string) => void;
  onPartial?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
  /** Avisos de progreso (descarga del modelo, transcribiendo…). */
  onStatus?: (message: string) => void;
  lang?: string;
};

export function startDictation(opts: DictationOpts): VoiceSession | null {
  if (typeof window === "undefined") return null;
  if (speechRecognitionSupported()) return startBrowserDictation(opts);
  return startRecorderDictation(opts);
}

// ---------------------------------------------------------------- Chrome/Edge
function startBrowserDictation(opts: DictationOpts): VoiceSession | null {
  const w = window as WindowWithSpeech;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = opts.lang ?? "es-ES";
  rec.continuous = true;
  rec.interimResults = true;
  let stopped = false;

  rec.onresult = (event) => {
    let partial = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result) continue;
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) opts.onText(text.trim());
      else partial += text;
    }
    if (partial) opts.onPartial?.(partial.trim());
  };

  rec.onerror = (event) => {
    const code = event.error ?? "desconocido";
    const message =
      code === "not-allowed" || code === "service-not-allowed"
        ? "No se ha dado permiso al micrófono."
        : code === "no-speech"
          ? "No se ha oído nada."
          : `Error del micrófono: ${code}`;
    opts.onError?.(message);
  };

  rec.onend = () => {
    if (stopped) return opts.onEnd?.();
    try {
      rec.start();
    } catch {
      opts.onEnd?.();
    }
  };

  try {
    rec.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* nada */
      }
    },
  };
}

// ---------------------------------------------------------- Firefox (grabar)
type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string } | Array<{ text?: string }>>;

let transcriberPromise: Promise<Transcriber> | null = null;

async function loadTranscriber(onStatus?: (m: string) => void): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      onStatus?.("Preparando la transcripción de voz (solo la primera vez)…");
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      const opts = {
        dtype: "q8" as const,
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p.status === "progress" && typeof p.progress === "number") {
            onStatus?.(`Descargando modelo de voz… ${Math.round(p.progress)}%`);
          }
        },
      };
      let asr: unknown;
      try {
        asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny", opts);
      } catch {
        asr = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", opts);
      }
      return asr as Transcriber;
    })();
    transcriberPromise.catch(() => {
      transcriberPromise = null;
    });
  }
  return transcriberPromise;
}

async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const target = 16000;
    const duration = buffer.duration;
    const offline = new OfflineAudioContext(1, Math.ceil(duration * target), target);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  } finally {
    void ctx.close();
  }
}

function startRecorderDictation(opts: DictationOpts): VoiceSession | null {
  if (!recordingSupported()) return null;
  let stopped = false;
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];

  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void (async () => {
          try {
            const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
            if (blob.size < 1000) {
              opts.onError?.("No se ha oído nada.");
              return;
            }
            opts.onStatus?.("Transcribiendo tu voz…");
            const transcriber = await loadTranscriber(opts.onStatus);
            const audio = await blobToFloat32(blob);
            const result = await transcriber(audio, { language: "spanish", task: "transcribe", chunk_length_s: 30 });
            const text = (Array.isArray(result) ? result[0]?.text : result.text) ?? "";
            if (text.trim()) opts.onText(text.trim());
            else opts.onError?.("No se ha entendido el audio.");
          } catch (err) {
            opts.onError?.(err instanceof Error ? `No se pudo transcribir: ${err.message}` : "No se pudo transcribir el audio.");
          } finally {
            opts.onEnd?.();
          }
        })();
      };
      recorder.start(250);
      opts.onStatus?.("Grabando… pulsa el micrófono otra vez para transcribir.");
    })
    .catch(() => {
      opts.onError?.("No se ha dado permiso al micrófono.");
      opts.onEnd?.();
    });

  return {
    stop: () => {
      stopped = true;
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
        else opts.onEnd?.();
      } catch {
        opts.onEnd?.();
      }
    },
  };
}
