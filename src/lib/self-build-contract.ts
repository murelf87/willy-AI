import { fullLessonsSection, normalizeLesson, type OwnerLesson } from "@/lib/owner-brain-shared";

export const REQUIRED_OWNER_RULES = 121;

function clean(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function normalizedBlock(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Conserva las instrucciones del servidor Y las del navegador. Antes se elegía una u otra:
 * si el servidor tenía una copia antigua, podía tapar el contrato completo guardado en el navegador.
 */
export function mergeOwnerInstructions(serverInstructions: string, browserInstructions: string): string {
  const server = clean(serverInstructions);
  const browser = clean(browserInstructions);
  if (!server) return browser;
  if (!browser) return server;
  const a = normalizedBlock(server);
  const b = normalizedBlock(browser);
  if (a === b) return browser.length >= server.length ? browser : server;
  if (a.includes(b)) return server;
  if (b.includes(a)) return browser;
  return [
    "INSTRUCCIONES PERMANENTES GUARDADAS EN EL EQUIPO:",
    server,
    "INSTRUCCIONES PERMANENTES GUARDADAS EN ESTA SESIÓN (también obligatorias):",
    browser,
  ].join("\n\n");
}

/** Números de reglas explícitas (1., 2), «Regla 3:», etc.) detectados en las instrucciones. */
export function numberedOwnerRules(text: string, max = REQUIRED_OWNER_RULES): number[] {
  const found = new Set<number>();
  const patterns = [
    /^\s*(\d{1,3})\s*[.)\-:]\s+\S/gm,
    /^\s*regla\s+(\d{1,3})\s*[.)\-:]?\s+\S/gim,
  ];
  for (const pattern of patterns) {
    for (const hit of text.matchAll(pattern)) {
      const n = Number(hit[1]);
      if (Number.isInteger(n) && n >= 1 && n <= max) found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function uniqueLessons(lessons: OwnerLesson[]): OwnerLesson[] {
  const seen = new Set<string>();
  const out: OwnerLesson[] = [];
  for (const lesson of lessons) {
    const key = normalizeLesson(lesson.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(lesson);
  }
  return out;
}

export type OwnerContract = {
  rules: string;
  count: number;
  explicitRules: number;
  learnedRules: number;
  complete: boolean;
  warning: string;
};

/**
 * Construye el contrato sin bloquear Autoconstrucción por un error de conteo.
 * Las 121 reglas pueden vivir en el texto de instrucciones, en las lecciones aprendidas o repartidas entre ambos.
 * Siempre se incluyen completas todas las fuentes disponibles.
 */
export function composeOwnerContract(
  serverInstructions: string,
  browserInstructions: string,
  lessons: OwnerLesson[],
  required = REQUIRED_OWNER_RULES,
): OwnerContract {
  const instructions = mergeOwnerInstructions(serverInstructions, browserInstructions);
  const unique = uniqueLessons(lessons);
  const explicit = numberedOwnerRules(instructions, required);
  const hasCompleteNumberedSet = Array.from({ length: required }, (_, i) => i + 1).every((n) => explicit.includes(n));
  const count = hasCompleteNumberedSet ? Math.max(required, explicit.length + unique.length) : explicit.length + unique.length;
  const complete = hasCompleteNumberedSet || count >= required;
  const rules = [instructions, fullLessonsSection(unique)].filter(Boolean).join("\n\n");
  const warning = complete
    ? ""
    : `Se han cargado ${count} regla(s)/entrada(s) identificables de ${required}. WILLY no bloquea el trabajo por un conteo imperfecto: aplica íntegramente todas las instrucciones y lecciones disponibles.`;
  return { rules, count, explicitRules: explicit.length, learnedRules: unique.length, complete, warning };
}
