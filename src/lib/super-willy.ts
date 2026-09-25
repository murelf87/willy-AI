// SUPER WILLY (pestaña Súper IA): con qué IA trabaja, APARTE de la pestaña Chat. El equipo del dueño es modesto (6 GB de
// memoria gráfica), así que por defecto SUPER WILLY usa primero la mejor IA externa GRATUITA para cada tarea y, si ninguna
// puede, su equipo. El dueño puede elegir: Externa primero · Híbrida · Local primero · Solo local. Lo que no debe salir del
// equipo (DNI, IBAN, tarjetas, claves) se queda SIEMPRE en el equipo, sea cual sea el modo (lo comprueba chat-cloud).

import { isChatModel } from "@/lib/local-ai";

export type SuperMode = "externa" | "hibrida" | "local" | "solo-local";

export const SUPER_MODE_KEY = "willy-superwilly-ia";
export const SUPER_DECISIONS_KEY = "willy-superwilly-decisiones";
/** Aviso interno: ha cambiado el modo de SUPER WILLY (para que todos sus botones se pongan al día). */
export const SUPER_MODE_EVENT = "willy:superwilly-ia";

export const SUPER_MODES: Array<{ id: SuperMode; label: string; icon: string; desc: string }> = [
  { id: "externa", label: "Externa primero", icon: "☁", desc: "La mejor IA externa gratuita para cada tarea; si ninguna puede, contesta tu equipo." },
  { id: "hibrida", label: "Híbrida", icon: "◉", desc: "Lo sencillo y corto, en tu equipo; programar, razonar, investigar o analizar datos, en la nube." },
  { id: "local", label: "Local primero", icon: "💻", desc: "Primero tu equipo; si no puede, una IA externa." },
  { id: "solo-local", label: "Solo local", icon: "🔒", desc: "Nada sale de tu equipo. En tareas grandes, más lento y con menos calidad." },
];

type Reader = Pick<Storage, "getItem"> | null;
type Writer = Pick<Storage, "setItem"> | null;
const browserStorage = (): Storage | null => (typeof window === "undefined" ? null : window.localStorage);

export function readSuperMode(storage: Reader = browserStorage()): SuperMode {
  try {
    const raw = storage?.getItem(SUPER_MODE_KEY);
    return SUPER_MODES.some((m) => m.id === raw) ? (raw as SuperMode) : "externa";
  } catch {
    return "externa";
  }
}

export function writeSuperMode(mode: SuperMode, storage: Writer = browserStorage()): void {
  try { storage?.setItem(SUPER_MODE_KEY, mode); } catch { /* sin guardado: vale para esta sesión */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SUPER_MODE_EVENT));
}

/** Modo de las decisiones de un proyecto: «guiado» (pregunta y recomienda, por defecto) o «auto» (decide WILLY y enseña el resumen). */
export function readDecisionMode(storage: Reader = browserStorage()): "guiado" | "auto" {
  try { return storage?.getItem(SUPER_DECISIONS_KEY) === "auto" ? "auto" : "guiado"; } catch { return "guiado"; }
}

export function writeDecisionMode(mode: "guiado" | "auto", storage: Writer = browserStorage()): void {
  try { storage?.setItem(SUPER_DECISIONS_KEY, mode); } catch { /* sin guardado */ }
}

/** Tareas que salen mucho mejor con una IA grande (en la nube) que con los modelos pequeños de un portátil. */
const HEAVY = new Set(["codigo", "web", "razonamiento", "investigacion", "datos", "vision"]);

export type Route = { order: Array<"nube" | "equipo">; why: string };

/** En qué orden prueba SUPER WILLY: la nube y/o tu equipo, según el modo y el tipo de tarea. */
export function superRoute(mode: SuperMode, kind: string, text: string, label = kind): Route {
  if (mode === "solo-local") return { order: ["equipo"], why: "Solo local: contesta tu equipo y nada sale de él." };
  if (mode === "local") return { order: ["equipo", "nube"], why: "Local primero: contesta tu equipo; si no puede, una IA externa." };
  if (mode === "hibrida") {
    const heavy = HEAVY.has(kind) || text.length > 2500;
    return heavy
      ? { order: ["nube", "equipo"], why: `Híbrida: ${label} va a la mejor IA externa; si ninguna puede, tu equipo.` }
      : { order: ["equipo", "nube"], why: `Híbrida: ${label} lo resuelve tu equipo.` };
  }
  return { order: ["nube", "equipo"], why: `Externa primero: la mejor IA externa gratuita para ${label}; si ninguna puede, tu equipo.` };
}

/**
 * Modelo LOCAL de SUPER WILLY (el de respaldo). Si el dueño eligió uno a mano y sigue instalado (y sabe conversar), ese;
 * si no, «» = automático: el orquestador elige el mejor instalado PARA CADA TAREA (nunca uno de búsquedas/embeddings), en
 * vez de quedarse con el modelo de la pestaña Chat.
 */
export function superModelFor(chosen: string, available: string[]): string {
  return chosen && isChatModel(chosen) && available.includes(chosen) ? chosen : "";
}

/** Tamaño en miles de millones de parámetros que dice el nombre del modelo («qwen2.5-coder:7b» → 7), o null. */
export function modelSize(name: string): number | null {
  const m = /(?:^|[:\-_])(\d+(?:\.\d+)?)b(?:$|[-_:])/i.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * «Solo local» con una tarea grande y modelos pequeños: se avisa de que la calidad será peor (pero se permite).
 * Devuelve el aviso, o null si no hace falta.
 */
export function localWarning(mode: SuperMode, kind: string, available: string[], label = kind): string | null {
  if (mode !== "solo-local" || !HEAVY.has(kind)) return null;
  const chat = available.filter(isChatModel);
  if (!chat.length) return "Solo local, pero tu equipo no tiene ningún modelo de IA instalado para conversar: descarga uno en «Modelos».";
  const sized = chat.map((m) => ({ m, size: modelSize(m) ?? 0 })).sort((a, b) => b.size - a.size);
  const best = sized[0]!;
  if (best.size === 0 || best.size > 8) return null;
  return `Esta tarea (${label}) tendrá peor calidad con los modelos de tu equipo (el mayor es ${best.m}). Si quieres más calidad, cambia a «Externa primero».`;
}
