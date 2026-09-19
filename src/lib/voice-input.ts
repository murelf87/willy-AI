// Dictado por voz con el reconocimiento del propio navegador (gratuito).

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

export function voiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as WindowWithSpeech;
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export type VoiceSession = { stop: () => void };

/**
 * Empieza a escuchar y va devolviendo lo dictado. `onText` recibe el texto
 * definitivo de cada frase; `onPartial`, lo que se está diciendo ahora mismo.
 */
export function startDictation(opts: {
  onText: (text: string) => void;
  onPartial?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
  lang?: string;
}): VoiceSession | null {
  if (typeof window === "undefined") return null;
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
    // El navegador corta solo cada cierto tiempo: se reanuda si no lo paró el usuario.
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
