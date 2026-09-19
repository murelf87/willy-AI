// Historial de chats guardados en el equipo (localStorage): nada se pierde al recargar.

export type StoredMsg = {
  who: "you" | "willy";
  time: string;
  text: string;
  files?: { path: string; content: string }[];
  download?: { name: string; url: string; size: number };
};


export type ChatThread = {
  id: string;
  title: string;
  messages: StoredMsg[];
  updatedAt: number;
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
