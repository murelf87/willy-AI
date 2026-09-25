// Piezas compartidas de la lectura en voz alta: el mando para parar y el troceado por frases.
// La síntesis real (motor Piper, voces de España) vive en @/lib/natural-voice — aquí ya NO queda
// ninguna voz de Windows: se quitaron speakText/SPANISH_VOICES a propósito.

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
