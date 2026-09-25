// «REVISAR DISEÑO» (rediseño, revisión 24 · fase 10; puntos 19 y 20). WILLY pinta la pantalla que estás viendo en los tres
// tamaños (ordenador, tableta y móvil) y la revisa con reglas objetivas, medidas en la página de verdad: lo que se sale de la
// pantalla, el texto que se corta, lo que se tapa, el poco contraste, la letra o los botones demasiado pequeños, las imágenes
// que no cargan o se deforman, la jerarquía (el título principal) y el espaciado irregular. Además, si en el equipo hay Edge o
// Chrome, hace CAPTURAS de verdad, y una IA con visión (si la hay) puede mirarlas. Arreglar es cosa del dueño: elige qué, y
// WILLY lo arregla SIN cambiar el diseño aprobado (si hiciera falta un cambio grande, pregunta antes). Lógica pura.

import type { RawIssue } from "@/lib/preview-runtime";

export type ReviewDevice = "ordenador" | "tablet" | "movil";
export type ReviewLevel = "error" | "aviso" | "sugerencia";

/** Los tres tamaños de la revisión (y de las capturas): los mismos que los de la vista previa, con el ordenador a 1280 px. */
export const REVIEW_SIZES: Record<ReviewDevice, { width: number; height: number; label: string }> = {
  ordenador: { width: 1280, height: 800, label: "Ordenador" },
  tablet: { width: 768, height: 1024, label: "Tableta" },
  movil: { width: 390, height: 844, label: "Móvil" },
};
export const REVIEW_DEVICES: ReviewDevice[] = ["ordenador", "tablet", "movil"];

export type ReviewIssue = {
  id: string;
  kind: string;
  level: ReviewLevel;
  text: string;
  /** Selector del elemento (interno), para señalarlo en la vista previa; vacío si es de toda la página. */
  selector: string;
  /** Tamaños en los que pasa. */
  devices: ReviewDevice[];
};

/** Una captura de verdad (hecha con el navegador del equipo). */
export type Shot = { device: ReviewDevice; width: number; height: number; image: string; bytes: number };
export type CaptureResult = { page: string; browser: string; shots: Shot[]; errors: string[] };

const LEVEL_ORDER: Record<ReviewLevel, number> = { error: 0, aviso: 1, sugerencia: 2 };
const KIND_ORDER = ["sin-viewport", "desborde", "superpuesto", "imagen-rota", "cortado", "contraste", "toque-pequeno", "letra-pequena", "imagen-deformada", "boton-vacio", "sin-h1", "varios-h1", "espaciado", "sin-alt", "sin-titulo"];
export const LEVEL_LABEL: Record<ReviewLevel, string> = { error: "Importante", aviso: "Mejor arreglarlo", sugerencia: "Sugerencia" };

const levelOf = (v: string): ReviewLevel => (v === "error" || v === "aviso" || v === "sugerencia" ? v : "aviso");

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Lo que se ve en el código de la página, sin pintarla: la etiqueta «viewport» (sin ella, en un móvil de verdad se ve diminuta). */
export function staticChecks(html: string | null | undefined): RawIssue[] {
  if (!html) return [];
  const out: RawIssue[] = [];
  const head = html.slice(0, 20_000);
  if (!/<meta\b[^>]*name\s*=\s*["']?viewport/i.test(head)) {
    out.push({ tipo: "sin-viewport", nivel: "error", texto: "Falta la etiqueta «viewport»: en un móvil de verdad la página se verá diminuta (como un ordenador en pequeño)", selector: "", clase: "", muestra: "" });
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]?.trim();
  if (!title) out.push({ tipo: "sin-titulo", nivel: "sugerencia", texto: "La página no tiene título (el que sale en la pestaña del navegador y en Google)", selector: "", clase: "", muestra: "" });
  return out;
}

/**
 * Junta lo que ha encontrado la revisión en cada tamaño: el mismo problema del mismo elemento es UNO (con los tamaños en que
 * pasa). Primero lo importante; dentro, lo que pasa en más tamaños. El texto es el del tamaño más pequeño en que pasa (suele
 * ser el peor caso: «se sale 210 px» en el móvil).
 */
export function mergeReview(byDevice: Partial<Record<ReviewDevice, RawIssue[] | null>>, staticIssues: RawIssue[] = []): ReviewIssue[] {
  const map = new Map<string, ReviewIssue>();
  const order: ReviewDevice[] = ["movil", "tablet", "ordenador"];
  const put = (raw: RawIssue, devices: ReviewDevice[]) => {
    const key = `${raw.tipo}|${raw.selector || raw.texto}`;
    const prev = map.get(key);
    if (prev) {
      for (const d of devices) if (!prev.devices.includes(d)) prev.devices.push(d);
      if (LEVEL_ORDER[levelOf(raw.nivel)] < LEVEL_ORDER[prev.level]) prev.level = levelOf(raw.nivel);
      return;
    }
    map.set(key, { id: hash(key), kind: raw.tipo, level: levelOf(raw.nivel), text: raw.texto, selector: raw.selector, devices: [...devices] });
  };
  for (const d of order) for (const raw of byDevice[d] ?? []) put(raw, [d]);
  const done = REVIEW_DEVICES.filter((d) => Array.isArray(byDevice[d]));
  for (const raw of staticIssues) put(raw, done.length ? done : [...REVIEW_DEVICES]);
  const kindRank = (k: string) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
  return [...map.values()]
    .map((i) => ({ ...i, devices: REVIEW_DEVICES.filter((d) => i.devices.includes(d)) }))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.devices.length - a.devices.length || kindRank(a.kind) - kindRank(b.kind))
    .slice(0, 25);
}

/** «en todos los tamaños», «en móvil», «en móvil y tableta». */
export function devicesText(devices: ReviewDevice[]): string {
  if (devices.length >= 3) return "en todos los tamaños";
  const names = REVIEW_DEVICES.filter((d) => devices.includes(d)).map((d) => REVIEW_SIZES[d].label.toLowerCase());
  return names.length ? `en ${names.join(" y ")}` : "";
}

/** El resumen de la revisión para cualquiera. */
export function reviewSummary(issues: ReviewIssue[], checked: ReviewDevice[]): string {
  const where = checked.length >= 3 ? "ordenador, tableta y móvil" : checked.map((d) => REVIEW_SIZES[d].label.toLowerCase()).join(" y ");
  if (!checked.length) return "No se ha podido revisar el diseño.";
  if (!issues.length) return `Sin problemas de diseño a la vista en ${where}.`;
  const important = issues.filter((i) => i.level === "error").length;
  return `WILLY mejoraría ${issues.length === 1 ? "1 cosa" : `${issues.length} cosas`}${important ? ` (${important} importante${important === 1 ? "" : "s"})` : ""}, revisando ${where}.`;
}

/** Cuántos problemas hay en cada tamaño (para las etiquetas «Móvil: 3»). null si ese tamaño no se ha podido revisar. */
export function countsByDevice(issues: ReviewIssue[], checked: ReviewDevice[]): Record<ReviewDevice, number | null> {
  const out = { ordenador: null, tablet: null, movil: null } as Record<ReviewDevice, number | null>;
  for (const d of checked) out[d] = issues.filter((i) => i.devices.includes(d)).length;
  return out;
}

/**
 * La petición a SUPER WILLY para arreglar lo elegido (punto 20): SOLO eso, sin cambiar el diseño aprobado; si hiciera falta un
 * cambio grande, que no lo haga y pregunte. Lleva el selector de cada problema (para la IA) y, si las hay, las observaciones de
 * la IA de visión sobre las capturas.
 */
export function designFixRequest(input: { page: string | null; route?: string | null; issues: ReviewIssue[]; visionNotes?: string[] }): { text: string; ownerText: string } {
  const lines = input.issues.slice(0, 20).map((i) => `- [${devicesText(i.devices) || "todos los tamaños"}] ${i.text}${i.selector ? ` (elemento: ${i.selector})` : ""}`);
  const vision = (input.visionNotes ?? []).filter(Boolean).slice(0, 3);
  const text = [
    `Revisión del diseño de «${input.page ?? "la página"}»${input.route ? ` (ruta «${input.route}»)` : ""}: arregla SOLO estos problemas, sin cambiar el diseño que ya está aprobado (los colores de marca, la tipografía, la distribución y los textos se quedan como están):`,
    ...lines,
    ...(vision.length ? ["", "Lo que ha visto una IA de visión en las capturas (puede equivocarse; tenlo en cuenta solo si coincide con el código):", ...vision.map((v) => `> ${v.replace(/\s+/g, " ").slice(0, 900)}`)] : []),
    "",
    "Si para arreglar algo hiciera falta un cambio GRANDE de diseño (otra distribución, otros colores de marca, quitar secciones…), NO lo hagas: explica qué cambiarías y pregunta primero.",
    "Comprueba el resultado en móvil (390 px), tableta (768 px) y ordenador, y entrega los archivos que cambies COMPLETOS.",
  ].join("\n");
  const n = input.issues.length;
  return { text, ownerText: `Arregla ${n === 1 ? "el problema de diseño elegido" : `los ${n} problemas de diseño elegidos`} (revisión del diseño${input.page ? ` de «${input.page}»` : ""}).` };
}

/** Lo que se le pide a una IA con visión al mirar una captura (solo el diseño; en castellano; sin inventar). */
export function designVisionPrompt(device: ReviewDevice): string {
  const s = REVIEW_SIZES[device];
  return [
    `Esta es una captura de pantalla de la página web de un proyecto, vista en ${s.label.toLowerCase()} (${s.width} px de ancho).`,
    "Revisa SOLO su diseño visual y di qué problemas ves: textos que se cortan o se salen, elementos que se tapan, poco contraste, cosas desalineadas o con espaciado irregular, tamaños desproporcionados y si se entiende qué es lo importante (jerarquía visual).",
    "Sé concreto: di qué elemento (por su texto) y dónde está. Si se ve bien, dilo. No inventes nada que no veas.",
    "Responde en español, en una lista corta.",
  ].join("\n");
}

/** Una línea para la consola del proyecto con el resultado de la revisión. */
export function reviewConsoleLine(issues: ReviewIssue[], checked: ReviewDevice[]): string {
  const counts = countsByDevice(issues, checked);
  const parts = REVIEW_DEVICES.map((d) => `${REVIEW_SIZES[d].label.toLowerCase()}: ${counts[d] === null ? "sin revisar" : counts[d]}`);
  return `Revisión del diseño: ${issues.length ? `${issues.length} cosa(s) que mejorar` : "sin problemas a la vista"} (${parts.join(", ")}).`;
}
