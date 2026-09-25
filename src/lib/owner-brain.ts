// Lo que WILLY sabe de su dueño, para TODAS las IA (la de tu equipo y las externas) y en todos los chats (PC, móvil,
// Súper IA y Autoconstrucción): las instrucciones permanentes y las reglas que el dueño le va enseñando al hablar.
// Se guarda en tu equipo (datos-privados/dueno.json) y, para tenerlo al instante, también en este navegador.

import { useSyncExternalStore } from "react";
import { hasOwnInstructions, readSelfBuild } from "@/lib/self-build-store";
import { cleanLesson, detectLesson, emptyBrain, normalizeLesson, ownerBlock, type OwnerBrain, type OwnerLesson } from "@/lib/owner-brain-shared";

export type { OwnerBrain, OwnerLesson };

const MIRROR = "willy-dueno-aprendido";
export const OWNER_EVENT = "willy-dueno-cambio";

const hasWindow = () => typeof window !== "undefined";

function readMirror(): OwnerBrain {
  if (!hasWindow()) return emptyBrain();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MIRROR) ?? "null") as Partial<OwnerBrain> | null;
    if (!parsed || typeof parsed !== "object") return emptyBrain();
    return {
      instructions: typeof parsed.instructions === "string" ? parsed.instructions : "",
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons.filter((l): l is OwnerLesson => !!l && typeof l.text === "string" && typeof l.id === "string") : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return emptyBrain();
  }
}

let brain: OwnerBrain = readMirror();
let loading: Promise<OwnerBrain> | null = null;
let loadedOnce = false;

function setBrain(next: OwnerBrain): void {
  brain = next;
  if (!hasWindow()) return;
  try { window.localStorage.setItem(MIRROR, JSON.stringify(next)); } catch { /* sin copia en el navegador */ }
  window.dispatchEvent(new Event(OWNER_EVENT));
}

type Reply = { ok?: boolean; brain?: OwnerBrain; added?: boolean; error?: string };

async function call(body: Record<string, unknown>): Promise<Reply | null> {
  if (!hasWindow()) return null;
  try {
    const res = await fetch("/api/self-build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    return (await res.json()) as Reply;
  } catch {
    return null;
  }
}

/**
 * Trae de tu equipo lo aprendido (una vez por sesión, o siempre con `force`). En el PC, si las instrucciones de la caja
 * de Autoconstrucción son distintas de las guardadas en el equipo, se guardan allí para que el móvil use las mismas.
 */
export function loadOwnerBrain(force = false): Promise<OwnerBrain> {
  if (loading) return loading;
  if (loadedOnce && !force) return Promise.resolve(brain);
  loading = (async () => {
    const res = await call({ action: "owner-get" });
    if (res?.ok && res.brain) {
      // Las lecciones que se aprendieron sin conexión con el servidor se suben ahora (sin repetir).
      const known = new Set(res.brain.lessons.map((l) => normalizeLesson(l.text)));
      let merged = res.brain;
      for (const lesson of brain.lessons.filter((l) => !known.has(normalizeLesson(l.text)))) {
        const saved = await call({ action: "owner-add-lesson", text: lesson.text, source: lesson.source });
        if (saved?.ok && saved.brain) merged = saved.brain;
      }
      setBrain(merged);
      loadedOnce = true;
      if (hasOwnInstructions()) {
        const local = readSelfBuild().instructions;
        if (local.trim() && local !== merged.instructions) await saveOwnerInstructions(local);
      }
    }
    return brain;
  })().finally(() => { loading = null; });
  return loading;
}

/** Guarda en tu equipo las instrucciones permanentes (las de la caja de Autoconstrucción), para todos los chats y el móvil. */
export async function saveOwnerInstructions(text: string): Promise<boolean> {
  setBrain({ ...brain, instructions: text });
  const res = await call({ action: "owner-save-instructions", text });
  if (res?.ok && res.brain) setBrain(res.brain);
  return !!res?.ok;
}

/**
 * Las instrucciones que valen ahora: las de la caja de Autoconstrucción si se han guardado en este navegador (el PC);
 * si no (por ejemplo en el móvil), las guardadas en tu equipo; y si tampoco, las de fábrica.
 */
export function currentInstructions(): string {
  if (hasOwnInstructions()) return readSelfBuild().instructions;
  return brain.instructions.trim() || readSelfBuild().instructions;
}

export function ownerLessons(): OwnerLesson[] {
  return brain.lessons;
}

/** El bloque que va delante de CUALQUIER IA en cada petición: instrucciones permanentes + lo aprendido del dueño. */
export function ownerRules(): string {
  return ownerBlock(currentInstructions(), brain.lessons);
}

/** Enseña una regla a todas las IA (desde la pantalla o desde un chat). Devuelve el texto guardado, o null si ya la sabían. */
export function teachOwnerRule(text: string, source: string): string | null {
  const clean = cleanLesson(text);
  if (!clean) return null;
  const key = normalizeLesson(clean);
  if (brain.lessons.some((l) => normalizeLesson(l.text) === key)) return null;
  // Vale ya en este navegador aunque el servidor tarde; el servidor la guarda para los demás chats y el móvil.
  setBrain({ ...brain, lessons: [...brain.lessons, { id: `local-${Date.now().toString(36)}`, text: clean, at: new Date().toISOString(), source }] });
  void call({ action: "owner-add-lesson", text: clean, source }).then((res) => { if (res?.ok && res.brain) setBrain(res.brain); });
  return clean;
}

/** Si el mensaje del dueño es una regla o preferencia («a partir de ahora…», «recuerda que…», «nunca…»), se aprende. */
export function learnFromOwner(message: string, source: string): string | null {
  const lesson = detectLesson(message);
  return lesson ? teachOwnerRule(lesson, source) : null;
}

export async function forgetOwnerLesson(id: string): Promise<void> {
  setBrain({ ...brain, lessons: brain.lessons.filter((l) => l.id !== id) });
  if (id.startsWith("local-")) return;
  const res = await call({ action: "owner-remove-lesson", id });
  if (res?.ok && res.brain) setBrain(res.brain);
}

export async function forgetAllOwnerLessons(): Promise<void> {
  setBrain({ ...brain, lessons: [] });
  const res = await call({ action: "owner-clear-lessons" });
  if (res?.ok && res.brain) setBrain(res.brain);
}

const subscribe = (fn: () => void) => {
  if (!hasWindow()) return () => undefined;
  window.addEventListener(OWNER_EVENT, fn);
  return () => window.removeEventListener(OWNER_EVENT, fn);
};
const snapshot = () => brain;

/** Lo aprendido, siempre al día en pantalla. */
export function useOwnerBrain(): OwnerBrain {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
