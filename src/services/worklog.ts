// Guardado automático del trabajo en curso: la Súper IA recuerda por dónde se
// quedó y puede continuar sin perder nada.

import type { DiscoveryState } from "@/lib/project-discovery";

/**
 * Un turno de la conversación de un proyecto (SUPER WILLY): quién habló, qué dijo y con qué modelo (si respondió la IA).
 * `kind: "entrevista"` = preguntas y respuestas de la entrevista: se ven en el hilo, pero no se reenvían a la IA (sus
 * decisiones ya van resumidas en el contexto del proyecto).
 */
export type WorkTurn = { role: "owner" | "ia"; text: string; model: string | null; at: number; kind?: "entrevista" };

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
  /**
   * Conversación completa del proyecto (varios turnos), no solo el último prompt/respuesta. Opcional por compatibilidad:
   * las sesiones guardadas antes de esto no lo traen, y se tratan como conversación vacía (se ve solo prompt/answer).
   */
  turns?: WorkTurn[];
  /** Entrevista del proyecto (SUPER WILLY): decisiones, funciones y en qué paso va. */
  discovery?: DiscoveryState;
  /** Proyecto (en Proyectos, guardado en tu equipo) que lleva este trabajo. Desde la rev19. */
  projectId?: string;
  updatedAt: number;
};

const KEY = "willy-worklog";
const EVENT = "willy-worklog-change";
const MAX = 20;
/** Topes para no llenar el almacenamiento del navegador (lo comparte con los ajustes, el cerebro del dueño…). */
export const MAX_TURNS = 60;
export const MAX_TURN_CHARS = 60_000;
export const WORKLOG_BUDGET = 1_000_000;

const CUT = "\n[…recortado para ahorrar espacio…]\n";

/** Recorta un texto largo conservando el principio y el final (lo importante de una respuesta suele estar en los dos). */
export function trimMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = Math.max(0, max - head - CUT.length);
  return `${text.slice(0, head)}${CUT}${tail ? text.slice(-tail) : ""}`;
}

/**
 * Deja la lista de trabajos dentro del presupuesto: como mucho MAX_TURNS turnos por trabajo y MAX_TURN_CHARS por turno; si
 * aun así no cabe, primero se resumen los trabajos antiguos, luego se quitan los más antiguos. El primero (el actual) se
 * conserva siempre. Así un proyecto largo nunca deja sin guardar los ajustes ni lo demás.
 */
export function compactSessions(list: WorkSession[], budget = WORKLOG_BUDGET): WorkSession[] {
  let out = list.map((s) => ({
    ...s,
    answer: trimMiddle(s.answer, MAX_TURN_CHARS),
    ...(s.turns ? { turns: s.turns.slice(-MAX_TURNS).map((t) => (t.text.length > MAX_TURN_CHARS ? { ...t, text: trimMiddle(t.text, MAX_TURN_CHARS) } : t)) } : {}),
  }));
  const size = () => JSON.stringify(out).length;
  for (let i = out.length - 1; i >= 1 && size() > budget; i--) {
    const s = out[i]!;
    out[i] = { ...s, answer: trimMiddle(s.answer, 4000), ...(s.turns ? { turns: s.turns.map((t) => ({ ...t, text: trimMiddle(t.text, 1500) })) } : {}) };
  }
  while (out.length > 1 && size() > budget) out = out.slice(0, -1);
  if (size() > budget && out[0]) {
    const s = out[0];
    const turns = s.turns ?? [];
    out[0] = { ...s, answer: trimMiddle(s.answer, 20_000), turns: turns.map((t, i) => (i >= turns.length - 4 ? { ...t, text: trimMiddle(t.text, 20_000) } : { ...t, text: trimMiddle(t.text, 1500) })) };
  }
  return out;
}

export type HistoryMsg = { role: "user" | "assistant"; content: string };

/**
 * Los turnos anteriores del proyecto para que la IA recuerde la conversación (multiturno). Sin la entrevista (ya va
 * resumida en el contexto), empezando por un mensaje del dueño, alternando y terminando en una respuesta de la IA (así lo
 * piden las IA externas). La última respuesta va casi entera (suele llevar el código); las anteriores, resumidas.
 */
export function historyOf(session: WorkSession | null, o: { turns?: number; last?: number; other?: number; total?: number } = {}): HistoryMsg[] {
  const maxTurns = o.turns ?? 8;
  const last = o.last ?? 24_000;
  const other = o.other ?? 3_000;
  const total = o.total ?? 40_000;
  const turns = (session?.turns ?? []).filter((t) => t.kind !== "entrevista" && t.text.trim());
  // Pares dueño → IA, en orden. Un mensaje del dueño sin respuesta (falló o se detuvo) no se reenvía.
  const pairs: Array<[WorkTurn, WorkTurn]> = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]!;
    const next = turns[i + 1];
    if (t.role === "owner" && next?.role === "ia") { pairs.push([t, next]); i++; }
  }
  let picked = pairs.slice(-Math.max(1, Math.floor(maxTurns / 2)));
  const build = () => picked.flatMap(([u, a], i): HistoryMsg[] => [
    { role: "user", content: trimMiddle(u.text, other) },
    { role: "assistant", content: trimMiddle(a.text, i === picked.length - 1 ? last : other) },
  ]);
  let out = build();
  while (picked.length > 1 && out.reduce((n, m) => n + m.content.length, 0) > total) { picked = picked.slice(1); out = build(); }
  return out;
}

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
    turns: [],
    updatedAt: Date.now(),
  };
}

/** Añade un turno (dueño o IA) a la conversación de la sesión, sin tocar el resto de sus campos. Función pura. */
export function addTurn(session: WorkSession, role: WorkTurn["role"], text: string, model: string | null = null, kind?: WorkTurn["kind"]): WorkSession {
  const trimmed = text.trim();
  if (!trimmed) return session;
  const turn: WorkTurn = { role, text: trimmed, model, at: Date.now(), ...(kind ? { kind } : {}) };
  return { ...session, turns: [...(session.turns ?? []), turn] };
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

/** El trabajo de SUPER WILLY que lleva un proyecto (el más reciente si hubiera varios). */
export function sessionOfProject(projectId: string): WorkSession | null {
  return listSessions().find((s) => s.projectId === projectId) ?? null;
}

/** Guarda (o actualiza) la sesión. Se llama solo mientras se trabaja. */
export function saveSession(session: WorkSession): WorkSession {
  const next: WorkSession = {
    ...session,
    title: session.discovery?.name || session.prompt.trim().slice(0, 70) || session.title,
    updatedAt: Date.now(),
  };
  try {
    const rest = listSessions().filter((s) => s.id !== next.id);
    const all = compactSessions([next, ...rest].slice(0, MAX));
    try {
      window.localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      // El navegador dice que no cabe (lo comparte todo WILLY): se guarda más resumido en vez de no guardar nada.
      window.localStorage.setItem(KEY, JSON.stringify(compactSessions(all, WORKLOG_BUDGET / 5)));
    }
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
