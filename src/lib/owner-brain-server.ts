// Lo que el dueño ha enseñado a WILLY, guardado EN SU EQUIPO (carpeta datos-privados/dueno.json) para que valga en todos
// los chats y con todas las IA: el escritorio, el móvil, Súper IA y la Autoconstrucción leen y escriben aquí.
//  - instructions: las instrucciones permanentes del dueño (las de la pestaña Autoconstrucción).
//  - lessons: reglas y preferencias que el dueño ha dicho en los chats («a partir de ahora…», «recuerda que…», «nunca…»).

import { MAX_INSTRUCTION_CHARS, MAX_LESSONS, cleanLesson, emptyBrain, normalizeLesson, type OwnerBrain, type OwnerLesson } from "@/lib/owner-brain-shared";

const FILE = "dueno.json";

function sanitize(raw: unknown): OwnerBrain {
  const data = (raw && typeof raw === "object" ? raw : {}) as Partial<OwnerBrain>;
  const lessons = Array.isArray(data.lessons)
    ? data.lessons
      .filter((l): l is OwnerLesson => !!l && typeof l === "object" && typeof (l as OwnerLesson).text === "string")
      .map((l) => ({ id: String(l.id || crypto.randomUUID()), text: cleanLesson(l.text), at: String(l.at || ""), source: String(l.source || "") }))
      .filter((l) => l.text)
      .slice(-MAX_LESSONS)
    : [];
  return {
    instructions: typeof data.instructions === "string" ? data.instructions.slice(0, MAX_INSTRUCTION_CHARS) : "",
    lessons,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
  };
}

export async function loadBrain(dir: string): Promise<OwnerBrain> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  try {
    return sanitize(JSON.parse(await fs.readFile(path.join(dir, FILE), "utf8")));
  } catch {
    return emptyBrain();
  }
}

export async function saveBrain(dir: string, brain: OwnerBrain): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, FILE);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(brain, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
}

/** Añade una lección (sin repetir las ya guardadas). Devuelve si se añadió de verdad. */
export function addLessonTo(brain: OwnerBrain, text: string, source: string, now = new Date()): { brain: OwnerBrain; added: boolean } {
  const clean = cleanLesson(text);
  if (!clean) return { brain, added: false };
  const key = normalizeLesson(clean);
  if (brain.lessons.some((l) => normalizeLesson(l.text) === key)) return { brain, added: false };
  const lessons = [...brain.lessons, { id: crypto.randomUUID(), text: clean, at: now.toISOString(), source: cleanLesson(source).slice(0, 40) }].slice(-MAX_LESSONS);
  return { brain: { ...brain, lessons, updatedAt: now.toISOString() }, added: true };
}

/** Todas las acciones «owner-…» de la ruta /api/self-build. */
export async function ownerAction(dir: string, body: Record<string, unknown>, now = new Date()): Promise<Record<string, unknown>> {
  const action = String(body["action"] ?? "");
  const brain = await loadBrain(dir);
  if (action === "owner-get") return { ok: true, brain };
  if (action === "owner-save-instructions") {
    const text = typeof body["text"] === "string" ? body["text"].slice(0, MAX_INSTRUCTION_CHARS) : "";
    const next: OwnerBrain = { ...brain, instructions: text, updatedAt: now.toISOString() };
    await saveBrain(dir, next);
    return { ok: true, brain: next };
  }
  if (action === "owner-add-lesson") {
    const result = addLessonTo(brain, String(body["text"] ?? ""), String(body["source"] ?? ""), now);
    if (result.added) await saveBrain(dir, result.brain);
    return { ok: true, added: result.added, brain: result.brain };
  }
  if (action === "owner-remove-lesson") {
    const id = String(body["id"] ?? "");
    const next: OwnerBrain = { ...brain, lessons: brain.lessons.filter((l) => l.id !== id), updatedAt: now.toISOString() };
    await saveBrain(dir, next);
    return { ok: true, brain: next };
  }
  if (action === "owner-clear-lessons") {
    const next: OwnerBrain = { ...brain, lessons: [], updatedAt: now.toISOString() };
    await saveBrain(dir, next);
    return { ok: true, brain: next };
  }
  return { ok: false, error: "Acción desconocida." };
}
