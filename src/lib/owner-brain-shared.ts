// Lo que WILLY aprende del dueño: tipos y ayudas puras (sin navegador ni disco) que comparten el servidor y la pantalla.

export type OwnerLesson = { id: string; text: string; at: string; source: string };
export type OwnerBrain = { instructions: string; lessons: OwnerLesson[]; updatedAt: string };

export const MAX_LESSONS = 300;
export const MAX_LESSON_CHARS = 400;
export const MAX_INSTRUCTION_CHARS = 20_000;
/** Cuántas lecciones (las más recientes) se le ponen delante a la IA en cada petición, y cuánto pueden ocupar. */
const PROMPT_LESSONS = 40;
const PROMPT_LESSON_CHARS = 240;

export function emptyBrain(): OwnerBrain {
  return { instructions: "", lessons: [], updatedAt: "" };
}

const plain = (text: string): string => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Texto comparable: sin tildes, sin mayúsculas, sin puntuación ni espacios repetidos (para no guardar la misma regla dos veces). */
export function normalizeLesson(text: string): string {
  return plain(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function cleanLesson(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LESSON_CHARS);
}

// Cómo suena una regla o preferencia del dueño en un chat (español de España). Una pregunta nunca es una regla.
const RULE_PATTERNS: RegExp[] = [
  /\b(recuerda|recuerdalo|acuerdate|apuntate|apuntalo|aprende|aprendete|aprendelo|memoriza|memorizalo|ten (siempre )?en cuenta)\b/,
  /\b(a partir de ahora|de ahora en adelante|desde ahora|en adelante|cada vez que|siempre que (te|me|haga|pida|hagas|pidas|generes|entregues))\b/,
  /\b(haz|pon|usa|utiliza|escribe|entrega|responde|contesta|habla|crea|genera|deja|incluye|anade|agrega|evita|quita|manten|mantén|revisa|comprueba) siempre\b/,
  /\bsiempre (tienes|debes|hay que|has de|que (uses|pongas|hagas|escribas|entregues|respondas|generes|incluyas|dejes))\b/,
  /\b(nunca|jamas) (uses|pongas|hagas|escribas|vuelvas|respondas|dejes|entregues|generes|crees|incluyas|me|le|lo|la|los|las)\b/,
  /\b(no vuelvas a|no quiero que|no me (gusta|gustan) que|quiero que (siempre|todas|todos|nunca|a partir|cada|cualquier)|prefiero que|prefiero (siempre|el|la|los|las|usar|que)|me gusta mas|mejor que sea siempre|tiene que ser siempre|es obligatorio que|regla:)\b/,
];

/**
 * Si el mensaje del dueño suena a regla o preferencia permanente («a partir de ahora…», «recuerda que…», «nunca…»),
 * devuelve el texto limpio para guardarlo como lección; si no, null.
 */
export function detectLesson(message: string): string | null {
  const clean = cleanLesson(message);
  if (clean.length < 12 || clean.length >= MAX_LESSON_CHARS) return null;
  if (/[?¿]\s*$/.test(clean) || /^[¿?]/.test(clean)) return null;
  const text = plain(clean);
  if (!RULE_PATTERNS.some((pattern) => pattern.test(text))) return null;
  return clean;
}

/** El bloque «LO QUE HAS APRENDIDO DEL DUEÑO» que va en cada petición a cualquier IA (vacío si no hay lecciones). */
export function lessonsSection(lessons: OwnerLesson[]): string {
  const recent = lessons.slice(-PROMPT_LESSONS);
  if (!recent.length) return "";
  const lines = recent.map((lesson) => {
    const day = lesson.at ? lesson.at.slice(0, 10) : "";
    const where = lesson.source ? ` · ${lesson.source}` : "";
    return `- ${day}${where}: «${lesson.text.length > PROMPT_LESSON_CHARS ? `${lesson.text.slice(0, PROMPT_LESSON_CHARS - 1)}…` : lesson.text}»`;
  });
  return `LO QUE HAS APRENDIDO DEL DUEÑO (reglas y preferencias que te ha dado en los chats; cúmplelas SIEMPRE, en cualquier chat y con cualquier motor de IA; si una choca con una instrucción anterior, manda la más reciente):\n${lines.join("\n")}`;
}

/** Instrucciones permanentes + lecciones: el texto completo que ve cada IA. */
export function ownerBlock(instructions: string, lessons: OwnerLesson[]): string {
  return [
    `INSTRUCCIONES PERMANENTES DEL DUEÑO (valen para TODAS las IA, la de tu equipo y las externas, sin excepción):\n${instructions.trim()}`,
    lessonsSection(lessons),
  ].filter(Boolean).join("\n\n");
}
