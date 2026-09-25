// Memoria de la Autoconstrucción: WILLY guarda las mejoras que funcionaron y se las enseña como ejemplo
// al modelo local cuando llega una petición parecida. Los modelos locales no aprenden por dentro; lo que
// mejora es lo que WILLY les pone delante. Solo cuentan como ejemplo las mejoras que no se han marcado
// como «no funciona». Se guarda en el navegador (clave propia) y no sale del equipo.

export type Verdict = "sin confirmar" | "funciona" | "no funciona";

export type Lesson = {
  id: string;
  at: string;
  request: string;
  kind: string;
  files: string[];
  patches: Array<{ path: string; search: string; replace: string }>;
  model: string;
  attempts: number;
  seconds: number;
  verdict: Verdict;
};

const FENCE = "```";
const KEY = "willy-autoconstruccion-lecciones";
const MAX_LESSONS = 60;

const norm = (text: string): string => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const STOP = new Set("quiero cambia cambiar cambialo pon poner para como esto esta este donde aqui sobre desde hasta pero solo cosa favor nuevo nueva mejora hacer haz hazme que los las una unos unas del con por".split(" "));
const tokens = (text: string): Set<string> => new Set((norm(text).match(/[a-z0-9]{4,}/g) ?? []).filter((word) => !STOP.has(word)));

/** Tipo de petición, para las estadísticas y para saber qué modelo rinde mejor en cada una. */
export function taskKind(request: string): string {
  const text = norm(request);
  if (/(color|estilo|fuente|tamano|margen|espaci|redond|sombra|borde|tema oscuro|animad)/.test(text)) return "estilo";
  if (/(texto|palabra|etiqueta|rotulo|titulo|cambia .* por|renombr|diga|ponga)/.test(text)) return "texto";
  if (/(boton|componente|seccion|tarjeta|pestana|panel|menu|formulario|anade|agrega|nuevo)/.test(text)) return "componente";
  if (/(error|falla|no funciona|arregla|bug|rota|roto)/.test(text)) return "arreglo";
  return "otro";
}

/** Mejoras anteriores parecidas a la petición (mismas palabras poco comunes), ordenadas de más a menos parecida. */
export function similarLessons(lessons: Lesson[], request: string, limit = 2): Lesson[] {
  const wanted = tokens(request);
  if (!wanted.size) return [];
  return lessons
    .filter((lesson) => lesson.verdict !== "no funciona" && lesson.patches.length > 0)
    .map((lesson) => {
      const have = tokens(lesson.request);
      let shared = 0;
      for (const word of wanted) if (have.has(word)) shared += 1;
      const score = shared / Math.max(3, Math.min(wanted.size, have.size)) + (lesson.verdict === "funciona" ? 0.25 : 0);
      return { lesson, score, shared };
    })
    .filter((entry) => entry.shared >= 1 && entry.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.lesson);
}

/** Texto con los ejemplos para el prompt del constructor (vacío si no hay ninguno). */
export function examplesSection(lessons: Lesson[]): string {
  if (!lessons.length) return "";
  const blocks = lessons.map((lesson) => {
    const hunk = lesson.patches[0]!;
    const body = `${FENCE}replace ${hunk.path}\n<<<<<<< SEARCH\n${hunk.search.slice(0, 500)}\n=======\n${hunk.replace.slice(0, 700)}\n>>>>>>> REPLACE\n${FENCE}`;
    return `--- Petición parecida que ${lesson.verdict === "funciona" ? "SÍ funcionó" : "compiló bien"}: «${lesson.request.slice(0, 160)}» (${lesson.model}) ---\n${body}`.slice(0, 1500);
  });
  return `EJEMPLOS DE MEJORAS PARECIDAS YA HECHAS EN ESTE PROGRAMA (imita el estilo y el tamaño del cambio; no lo copies si no encaja con el código de más abajo):\n${blocks.join("\n\n")}\n\n`;
}

export function lessonStats(lessons: Lesson[]): { total: number; confirmed: number; firstTry: number; avgSeconds: number; summary: string } {
  const total = lessons.length;
  const confirmed = lessons.filter((lesson) => lesson.verdict === "funciona").length;
  const firstTry = total ? Math.round((lessons.filter((lesson) => lesson.attempts === 1).length / total) * 100) : 0;
  const avgSeconds = total ? Math.round(lessons.reduce((sum, lesson) => sum + lesson.seconds, 0) / total) : 0;
  const minutes = avgSeconds >= 90 ? `${Math.round(avgSeconds / 60)} min` : `${avgSeconds} s`;
  return {
    total,
    confirmed,
    firstTry,
    avgSeconds,
    summary: total ? `${total} mejora(s) guardadas · ${confirmed} confirmada(s) por ti · aciertan a la primera el ${firstTry} % · tiempo medio ${minutes}` : "",
  };
}

export function upsertLesson(lessons: Lesson[], lesson: Lesson): Lesson[] {
  const clipped: Lesson = { ...lesson, patches: lesson.patches.slice(0, 4).map((patch) => ({ ...patch, search: patch.search.slice(0, 1500), replace: patch.replace.slice(0, 2500) })) };
  return [clipped, ...lessons.filter((entry) => entry.id !== lesson.id)].slice(0, MAX_LESSONS);
}

export function setVerdict(lessons: Lesson[], id: string, verdict: Verdict): Lesson[] {
  return lessons.map((lesson) => (lesson.id === id ? { ...lesson, verdict } : lesson));
}

export function removeLesson(lessons: Lesson[], id: string): Lesson[] {
  return lessons.filter((lesson) => lesson.id !== id);
}

const isLesson = (value: unknown): value is Lesson => {
  const lesson = value as Lesson;
  return !!lesson && typeof lesson.id === "string" && typeof lesson.request === "string" && Array.isArray(lesson.patches) && Array.isArray(lesson.files);
};

export function readLessons(): Lesson[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isLesson) : [];
  } catch {
    return [];
  }
}

export function writeLessons(lessons: Lesson[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lessons.slice(0, MAX_LESSONS)));
  } catch {
    /* sin almacenamiento: la memoria es opcional */
  }
}
