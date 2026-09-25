// Traducir de verdad: un texto largo NO se manda de golpe a un modelo local (que solo abarca 4.000–8.000 «trozos» y corta en silencio).
// Se parte en fragmentos, se traduce uno a uno (mostrando lo que va saliendo), se comprueba cada resultado y se reintenta lo que falle.

export type Lang = { code: string; name: string };

const STOP: Record<string, string[]> = {
  es: "de la que el en y a los se del las un por con no una su para es al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos".split(" "),
  en: "the of and to in is that for it as with was on are by this be or from at which have not but an they you we their has were will would there been more if can what about who when".split(" "),
  fr: "le la les de des et en un une du que est pour dans qui pas sur au ce il elle ne plus avec par son sont nous vous ils mais ou où comme cette aux été être très aussi".split(" "),
  de: "der die und in den von zu das mit sich des auf für ist im dem nicht ein eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über so zum".split(" "),
  it: "il di che la e per un in è non con una le si del della da sono come più ma anche lo dei gli nel alla al questo essere ha loro suo sua tra fra molto quando".split(" "),
  pt: "de a o que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso".split(" "),
  ca: "de la que el i a en un per és amb els les una del al no es com més però també aquest aquesta són hi ha seu seva molt quan sobre entre fins".split(" "),
};
export const LANG_NAMES: Record<string, string> = { es: "español", en: "inglés", fr: "francés", de: "alemán", it: "italiano", pt: "portugués", ca: "catalán", zh: "chino", ja: "japonés", ko: "coreano", ru: "ruso", ar: "árabe", el: "griego", he: "hebreo" };
const HINT: Array<[RegExp, string, number]> = [[/[ñ¿¡]/g, "es", 3], [/[ãõ]/g, "pt", 3], [/ç/g, "pt", 1], [/[àèòï·]/g, "ca", 2], [/[ßäöü]/g, "de", 2], [/[êœëîû]/g, "fr", 2]];

/** Idioma probable de un texto (por letras y palabras frecuentes). code = "" si no hay suficiente texto para decidir. */
export function detectLanguage(text: string): Lang {
  const sample = text.slice(0, 6000);
  const script: Array<[RegExp, string]> = [[/[\u3040-\u30ff]/, "ja"], [/[\uac00-\ud7af]/, "ko"], [/[\u4e00-\u9fff]/, "zh"], [/[\u0400-\u04ff]/, "ru"], [/[\u0600-\u06ff]/, "ar"], [/[\u0590-\u05ff]/, "he"], [/[\u0370-\u03ff]/, "el"]];
  for (const [pattern, code] of script) if ((sample.match(new RegExp(pattern.source, "g"))?.length ?? 0) >= 8) return { code, name: LANG_NAMES[code]! };
  const words = sample.toLowerCase().match(/[\p{L}·']+/gu) ?? [];
  if (words.length < 6) return { code: "", name: "" };
  const score: Record<string, number> = {};
  for (const [code, list] of Object.entries(STOP)) { const set = new Set(list); score[code] = words.filter((w) => set.has(w)).length / words.length; }
  for (const [pattern, code, weight] of HINT) score[code] = (score[code] ?? 0) + ((sample.match(pattern)?.length ?? 0) / words.length) * weight;
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [best, second] = [ranked[0]!, ranked[1]!];
  if (best[1] < 0.08 || best[1] < second[1] * 1.08) return { code: "", name: "" };
  return { code: best[0], name: LANG_NAMES[best[0]]! };
}

/** Parte el texto en fragmentos de un tamaño que un modelo local traduce bien, respetando párrafos y frases. */
export function splitForTranslation(text: string, max = 1100): string[] {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= max) { pieces.push(paragraph); continue; }
    let current = "";
    for (const sentence of paragraph.split(/(?<=[.!?…。！？])\s+/)) {
      if (sentence.length > max) {
        if (current) { pieces.push(current); current = ""; }
        for (let i = 0; i < sentence.length; i += max) { const cut = sentence.slice(i, i + max); const space = i + max < sentence.length ? cut.lastIndexOf(" ") : -1; pieces.push(space > max * 0.5 ? cut.slice(0, space) : cut); if (space > max * 0.5) i -= cut.length - space; }
        continue;
      }
      if (current && current.length + sentence.length + 1 > max) { pieces.push(current); current = ""; }
      current = current ? `${current} ${sentence}` : sentence;
    }
    if (current) pieces.push(current);
  }
  const chunks: string[] = [];
  for (const piece of pieces) {
    const last = chunks[chunks.length - 1];
    if (last !== undefined && last.length + piece.length + 2 <= max) chunks[chunks.length - 1] = `${last}\n\n${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}

/** Quita el «ruido» típico de una página web: líneas cortas que se repiten (menús, botones). */
export function cleanWebText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  const count = new Map<string, number>();
  for (const line of lines) if (line && line.split(/\s+/).length <= 3) count.set(line, (count.get(line) ?? 0) + 1);
  return lines.filter((l) => !(l && (count.get(l) ?? 0) >= 3)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const CJK = /chino|japonés|coreano|árabe/i;

export function buildPrompt(chunk: string, target: string, source: string, attempt: number): string {
  const hint = attempt > 0 ? "\nATENCIÓN: en el intento anterior quedó texto sin traducir o incompleto. Traduce ABSOLUTAMENTE TODO el texto, frase por frase." : "";
  return (
    `Eres un traductor profesional. Traduce ${source ? `del ${source} ` : ""}al ${target} el texto que hay entre <texto> y </texto>.\n` +
    `Reglas: traduce TODO, sin resumir ni omitir nada; conserva el formato (párrafos, listas, títulos), las cifras, los nombres propios y las direcciones web; ` +
    `no añadas explicaciones, notas ni comillas; responde solo con la traducción.${hint}\n\n<texto>\n${chunk}\n</texto>`
  );
}

export function cleanTranslation(out: string): string {
  return out
    .replace(/^\s*(aquí (tienes|está)|traducción|translation)[^\n]{0,40}:\s*\n/i, "")
    .replace(/^```[a-z]*\n?|\n?```$/g, "")
    .replace(/^\s*<texto>\s*|\s*<\/texto>\s*$/g, "")
    .trim();
}

/** null = parece bien; si no, el motivo (para reintentar). */
export function checkTranslation(src: string, out: string, target: string, sourceCode = ""): string | null {
  if (!out.trim()) return "vacía";
  if (/^(lo siento|no puedo|i('m| am) sorry|i can(no|')t)/i.test(out.trim()) && out.length < 240) return "el modelo se negó";
  if (src.length >= 80 && out.length < src.length * 0.35 && !CJK.test(target) && !CJK.test(LANG_NAMES[sourceCode] ?? "")) return "demasiado corta (falta texto)";
  if (/español/i.test(target) && sourceCode && sourceCode !== "es" && (out.match(/\S+/g)?.length ?? 0) >= 12 && detectLanguage(out).code === sourceCode) return "sin traducir";
  return null;
}

export type FlowResult = { parts: string[]; failed: number[] };

/** Traduce los fragmentos uno a uno; cada uno se comprueba y se reintenta (hasta 3 veces) antes de darlo por perdido. */
export async function translateChunks(o: {
  chunks: string[];
  target: string;
  source?: string;
  sourceCode?: string;
  translate: (prompt: string, index: number, onDelta: (text: string) => void) => Promise<string>;
  onProgress?: (index: number, total: number, partial: string, done: boolean) => void;
  signal?: AbortSignal;
  attempts?: number;
}): Promise<FlowResult> {
  const parts: string[] = [];
  const failed: number[] = [];
  const attempts = o.attempts ?? 3;
  for (const [index, chunk] of o.chunks.entries()) {
    if (o.signal?.aborted) break;
    let best = "";
    let ok = false;
    for (let attempt = 0; attempt < attempts && !ok; attempt++) {
      let acc = "";
      try {
        const raw = await o.translate(buildPrompt(chunk, o.target, o.source ?? "", attempt), index, (d) => { acc += d; o.onProgress?.(index, o.chunks.length, cleanTranslation(acc), false); });
        best = cleanTranslation(raw || acc);
      } catch (error) {
        if (o.signal?.aborted) return { parts, failed };
        best = cleanTranslation(acc);
        if (attempt === attempts - 1 && !best) throw error;
        continue;
      }
      ok = checkTranslation(chunk, best, o.target, o.sourceCode ?? "") === null;
    }
    if (!ok) { failed.push(index); best = best && best.length > chunk.length * 0.35 ? best : `[⚠ Fragmento sin traducir]\n${chunk}`; }
    parts.push(best);
    o.onProgress?.(index, o.chunks.length, best, true);
  }
  return { parts, failed };
}
