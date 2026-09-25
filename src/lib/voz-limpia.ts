// Texto limpio para leer en voz alta. Las respuestas de WILLY y muchos documentos vienen en Markdown (negritas con asteriscos,
// títulos con almohadillas, listas, tablas, código, enlaces) y con emojis: las voces locales (Piper, Kokoro, Chatterbox) los
// leerían en voz alta («asterisco», «almohadilla», «barra», letra a letra en las direcciones web). Aquí se quita todo eso y se
// deja el texto como lo leería una persona: los títulos y cada punto de una lista acaban en una pausa, las tablas se leen
// por filas y el código y las direcciones web no se leen. Es idempotente: limpiar dos veces da lo mismo.

const ENDS = /[.!?…:;,]$/;
const BULLET = /^(?:[-*+•·▪‣◦►▶➤→✓✔☑✅❌]|\d{1,3}[.)])\s+/;
const RULE = /^(?:[-*_=]\s*){3,}$/;
const TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?$/;

type Line = { text: string; kind: "blank" | "heading" | "item" | "row" | "text" };

function parseLine(raw: string): Line {
  let line = raw.trim();
  if (!line || RULE.test(line) || TABLE_SEP.test(line)) return { text: "", kind: "blank" };
  line = line.replace(/^(?:>\s*)+/, "");
  if (/^#{1,6}\s+/.test(line)) return { text: line.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, ""), kind: "heading" };
  const bullet = BULLET.exec(line);
  if (bullet) {
    const n = /^(\d{1,3})[.)]/.exec(bullet[0]);
    const rest = line.slice(bullet[0].length).replace(/^\[[ xX]\]\s*/, "");
    return { text: n ? `${n[1]}, ${rest}` : rest, kind: "item" };
  }
  if (/^\[[ xX]\]\s+/.test(line)) return { text: line.replace(/^\[[ xX]\]\s+/, ""), kind: "item" };
  if (line.includes("|") && /^\|.*\|$|\S\s*\|\s*\S/.test(line)) {
    const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean);
    return { text: cells.join(", "), kind: "row" };
  }
  return { text: line, kind: "text" };
}

/** Quita los símbolos que no se leen en voz alta, dentro de una línea ya sin estructura. */
function cleanInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<(?:https?:\/\/|www\.)[^>]*>/gi, " el enlace ")
    .replace(/\b(?:https?:\/\/|www\.)[^\s)\]»"']+/gi, " el enlace ")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu, "")
    .replace(/\s*(?:->|=>|→|⇒|⟶|⟹|➔|➜|←|⇐|↔|⇔)\s*/g, ", ")
    .replace(/\s+[-–—]\s+/g, ", ")
    .replace(/\s*[•·▪‣◦]\s*/g, ", ")
    .replace(/(\d)\s*%/g, "$1 por ciento")
    .replace(/(\d[\d.,]*)\s*€/g, "$1 euros")
    .replace(/€\s*(\d[\d.,]*)/g, "$1 euros")
    .replace(/\s&\s/g, " y ")
    .replace(/\by\/o\b/gi, "y o")
    .replace(/\s+\/\s+/g, ", ")
    .replace(/[*`~^{}[\]<>|\\]+/g, " ")
    .replace(/#(?=\S)/g, "")
    .replace(/#+/g, " ")
    .replace(/(^|[\s(¿¡"«])_+|_+(?=[\s).,;:!?»"]|$)/g, "$1")
    .replace(/_/g, " ");
}

/** Deja la puntuación como la leería una persona: sin signos repetidos ni sueltos. */
function tidy(s: string): string {
  return s
    .replace(/\.{3,}/g, "…")
    .replace(/…+/g, "…")
    .replace(/(^|[^\d.])\.{2}(?![\d.])/g, "$1.")
    .replace(/!{2,}/g, "!")
    .replace(/\?{2,}/g, "?")
    .replace(/,{2,}/g, ",")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?…)»])/g, "$1")
    .replace(/([(«¿¡])\s+/g, "$1")
    .replace(/,\s*([.;:!?…])/g, "$1")
    .replace(/([.;:!?…])\s*,/g, "$1")
    .replace(/:\s*\./g, ".")
    .replace(/(^|[.!?…]\s)[,;:.]\s*/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:.]\s*/, "");
}

/** Texto listo para cualquier voz. Devuelve cadena vacía si no queda nada que leer (solo código, separadores o emojis). */
export function cleanForSpeech(input: string): string {
  const text = String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?(?:```|$)/g, "\n\n")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, "\n\n");
  const lines = text.split("\n").map(parseLine).map((l) => ({ ...l, text: tidy(cleanInline(l.text)) }));
  const parts: string[] = [];
  lines.forEach((line, i) => {
    if (line.kind === "blank" || !line.text) return;
    const next = lines[i + 1];
    // Un título, un punto de lista o una fila de tabla terminan en pausa; un párrafo partido en varias líneas se une.
    const endsHere = line.kind !== "text" || !next || next.kind !== "text" || !next.text;
    parts.push(endsHere && !ENDS.test(line.text) ? `${line.text}.` : line.text);
  });
  return tidy(parts.join(" "));
}
