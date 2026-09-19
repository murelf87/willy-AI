// Guardado automático del trabajo en curso: la Súper IA recuerda por dónde se
// quedó y puede continuar sin perder nada.

export type WorkSession = {
  id: string;
  title: string;
  prompt: string;
  answer: string;
  playbookId: string | null;
  /** Puntos imprescindibles ya cubiertos. */
  done: string[];
  /** Opcionales aceptados por el propietario. */
  accepted: string[];
  /** Opcionales descartados por el propietario. */
  rejected: string[];
  /** Preguntas pendientes de responder. */
  pending: string[];
  model: string | null;
  updatedAt: number;
};

const KEY = "willy-worklog";
const EVENT = "willy-worklog-change";
const MAX = 20;

export function emptySession(): WorkSession {
  return {
    id: `s-${Date.now()}`,
    title: "Trabajo sin título",
    prompt: "",
    answer: "",
    playbookId: null,
    done: [],
    accepted: [],
    rejected: [],
    pending: [],
    model: null,
    updatedAt: Date.now(),
  };
}

export function listSessions(): WorkSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as WorkSession[];
    return Array.isArray(raw) ? raw.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

/** Guarda (o actualiza) la sesión. Se llama solo mientras se trabaja. */
export function saveSession(session: WorkSession): WorkSession {
  const next: WorkSession = {
    ...session,
    title: session.prompt.trim().slice(0, 70) || session.title,
    updatedAt: Date.now(),
  };
  try {
    const rest = listSessions().filter((s) => s.id !== next.id);
    window.localStorage.setItem(KEY, JSON.stringify([next, ...rest].slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* almacenamiento lleno: se sigue trabajando sin historial */
  }
  return next;
}

export function removeSession(id: string) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(listSessions().filter((s) => s.id !== id)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* nada que hacer */
  }
}

export function lastSession(): WorkSession | null {
  return listSessions()[0] ?? null;
}

/** Saca de la respuesta las preguntas de la sección PENDIENTE. */
export function extractPending(text: string): string[] {
  const idx = text.search(/pendiente/i);
  if (idx < 0) return [];
  return text
    .slice(idx)
    .split("\n")
    .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((l) => l.length > 8 && l.length < 180 && /[?¿]/.test(l))
    .slice(0, 8);
}

/** Marca como cubiertos los mínimos que la respuesta menciona de verdad. */
export function coveredItems(answer: string, must: string[]): string[] {
  const low = answer.toLowerCase();
  return must.filter((m) => {
    const words = m.toLowerCase().split(/[^a-záéíóúñ]+/).filter((w) => w.length > 4).slice(0, 3);
    return words.length > 0 && words.every((w) => low.includes(w));
  });
}
