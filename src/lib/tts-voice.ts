// Lectura en voz alta completamente local mediante las voces instaladas en Windows.

export type SpanishVoice = {
  id: string;
  name: string;
  gender: "hombre" | "mujer";
  desc: string;
  style: string;
};

const BASE =
  "Léelo en español de España con voz humana y natural, entonación viva, pausas y respiraciones reales. Nunca suenes robótico ni monótono";

export const SPANISH_VOICES: SpanishVoice[] = [
  { id: "Kore", name: "Lucía", gender: "mujer", desc: "Clara y profesional", style: `${BASE}, con tono profesional, claro y seguro` },
  { id: "Aoede", name: "Carmen", gender: "mujer", desc: "Cálida y cercana", style: `${BASE}, con tono cálido, amable y cercano` },
  { id: "Leda", name: "Alba", gender: "mujer", desc: "Joven y animada", style: `${BASE}, con tono joven, alegre y con energía` },
  { id: "Zephyr", name: "Elena", gender: "mujer", desc: "Suave, para escuchar largo rato", style: `${BASE}, con tono suave, relajado y agradable, ritmo pausado` },
  { id: "Charon", name: "Javier", gender: "hombre", desc: "Locutor de documental", style: `${BASE}, con tono grave de locutor de documental, sereno y bien vocalizado` },
  { id: "Puck", name: "Diego", gender: "hombre", desc: "Cercano y animado", style: `${BASE}, con tono cercano, animado y natural, como una conversación` },
  { id: "Orus", name: "Álvaro", gender: "hombre", desc: "Firme y corporativo", style: `${BASE}, con tono firme, profesional y convincente` },
  { id: "Enceladus", name: "Martín", gender: "hombre", desc: "Suave, para audiolibros", style: `${BASE}, con tono suave y envolvente de audiolibro, ritmo tranquilo` },
];

export function voiceById(id: string): SpanishVoice {
  return SPANISH_VOICES.find((v) => v.id === id) ?? SPANISH_VOICES[0]!;
}

/** Trocea el texto por frases para que cada petición sea corta y empiece a sonar antes. */
export function chunkForSpeech(text: string, maxWords = 120): string[] {
  const words = (s: string) => (s.match(/\S+/g) ?? []).length;
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const sentence of sentences) {
    if (words(sentence) > maxWords) {
      flush();
      const parts = sentence.match(/\S+/g) ?? [];
      for (let i = 0; i < parts.length; i += maxWords) chunks.push(parts.slice(i, i + maxWords).join(" "));
      continue;
    }
    if (current && words(current) + words(sentence) > maxWords) flush();
    current += sentence;
  }
  flush();
  return chunks.filter(Boolean);
}

export type SpeechHandle = {
  stop: () => void;
  readonly stopped: boolean;
};

type SpeakOptions = {
  voice?: string;
  speed?: number;
  onChunk?: (index: number, total: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

/**
 * Lee el texto completo en voz alta. Devuelve un mando para pararlo.
 * Se reproduce trozo a trozo, en orden, sin cortes entre frases.
 */
export function speakText(text: string, options: SpeakOptions = {}): SpeechHandle {
  const chunks = chunkForSpeech(text);
  const voice = voiceById(options.voice ?? "Kore");
  const speed = options.speed ?? 1;
  let stopped = false;

  const nativeVoices = () => speechSynthesis.getVoices();
  const chooseNativeVoice = () => {
    const spanish = nativeVoices().filter((item) => /^es([-_]|$)/i.test(item.lang));
    const preferredNames = voice.gender === "mujer"
      ? /elvira|helena|maria|lucia|paulina|sabina|female|mujer/i
      : /pablo|jorge|alvaro|raul|diego|male|hombre/i;
    return spanish.find((item) => preferredNames.test(item.name))
      ?? spanish.find((item) => /es[-_]ES/i.test(item.lang))
      ?? spanish[0]
      ?? nativeVoices()[0];
  };

  const handle: SpeechHandle = {
    stop() {
      stopped = true;
      speechSynthesis.cancel();
    },
    get stopped() {
      return stopped;
    },
  };

  void (async () => {
    try {
      for (let i = 0; i < chunks.length; i++) {
        if (stopped) break;
        options.onChunk?.(i, chunks.length);
        await new Promise<void>((resolve, reject) => {
          const utterance = new SpeechSynthesisUtterance(chunks[i]);
          utterance.lang = "es-ES";
          utterance.voice = chooseNativeVoice() ?? null;
          utterance.rate = Math.max(0.5, Math.min(2, speed));
          utterance.pitch = voice.gender === "mujer" ? 1.08 : 0.92;
          utterance.onend = () => resolve();
          utterance.onerror = (event) => {
            if (stopped || event.error === "canceled" || event.error === "interrupted") resolve();
            else reject(new Error("La voz española local no está disponible en Windows."));
          };
          speechSynthesis.speak(utterance);
        });
      }
      if (!stopped) options.onEnd?.();
      handle.stop();
    } catch (err) {
      if (stopped) return;
      options.onError?.(err instanceof Error ? err.message : "No se ha podido generar la voz.");
      handle.stop();
    }
  })();

  return handle;
}
