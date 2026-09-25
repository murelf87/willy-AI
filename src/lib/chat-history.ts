// Historial de chats guardados en el equipo (localStorage): nada se pierde al recargar.

export type StoredMsg = {
  who: "you" | "willy";
  time: string;
  text: string;
  files?: { path: string; content: string }[];
  download?: { name: string; url: string; size: number };
  /** Qué IA respondió de verdad este mensaje (p. ej. «Gemini · gemini-2.0-flash» o «Tu equipo · qwen2.5:7b»). */
  by?: string;
  /** Rev21: una PROJECT ACTION (construir o cambiar un proyecto) y qué se hizo con ella («Abrir en SUPER WILLY»…). */
  projectAction?: StoredProjectAction;
};

export type StoredProjectAction = {
  /** Lo que se pasa a SUPER WILLY (con «desarróllalo», también tu mensaje anterior). */
  text: string;
  action: "nuevo" | "cambio" | "continuar";
  /** Nombres de los adjuntos de ese mensaje. */
  files: string[];
  state: "pendiente" | "enviado" | "aqui";
};


export const CHAT_TAGS = ["Ideas", "General", "Trabajo"] as const;
export type ChatTag = (typeof CHAT_TAGS)[number];

export type ChatThread = {
  id: string;
  title: string;
  messages: StoredMsg[];
  updatedAt: number;
  /** Favorito y etiqueta de la conversación (pantalla Chats). Antes vivían aparte en front/chat-meta.ts (localStorage propio); ahora son parte del hilo. */
  favorite?: boolean | undefined;
  tag?: ChatTag | undefined;
};

const KEY = "willy.chat-threads.v1";
export const CHAT_EVENT = "willy:chat-threads";

function readAll(): Record<string, ChatThread> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, ChatThread>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, ChatThread>) {
  window.localStorage.setItem(KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent(CHAT_EVENT));
}

export function newThreadId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Guarda (o actualiza) un chat. Si no tiene título, usa el primer mensaje del dueño. */
export function saveThread(id: string, messages: StoredMsg[]) {
  const all = readAll();
  const prev = all[id];
  const firstUser = messages.find((m) => m.who === "you" && m.text.trim());
  const title = (firstUser?.text.trim().slice(0, 60) || prev?.title || "Nueva conversación");
  all[id] = {
    id,
    title,
    messages,
    updatedAt: Date.now(),
    ...(prev?.favorite !== undefined ? { favorite: prev.favorite } : {}),
    ...(prev?.tag !== undefined ? { tag: prev.tag } : {}),
  };
  writeAll(all);
}

export function loadThread(id: string): ChatThread | null {
  return readAll()[id] ?? null;
}

export function listThreads(): ChatThread[] {
  return Object.values(readAll()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteThread(id: string) {
  const all = readAll();
  delete all[id];
  writeAll(all);
}

export function renameThread(id: string, title: string) {
  const all = readAll();
  if (all[id]) {
    all[id]!.title = title.trim() || all[id]!.title;
    writeAll(all);
  }
}

/** Favorito y/o etiqueta de un chat ya guardado (pantalla Chats). No crea el hilo si no existe todavía. */
export function updateThreadMeta(id: string, patch: { favorite?: boolean | undefined; tag?: ChatTag | undefined }): void {
  const all = readAll();
  if (all[id]) {
    if ("favorite" in patch) { if (patch.favorite) all[id]!.favorite = true; else delete all[id]!.favorite; }
    if ("tag" in patch) { if (patch.tag) all[id]!.tag = patch.tag; else delete all[id]!.tag; }
    writeAll(all);
  }
}
