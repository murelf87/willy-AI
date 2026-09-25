// Favoritos y etiqueta de cada conversación (pantalla Chats). Desde el 25/09/2026 viven DENTRO del propio hilo
// (lib/chat-history.ts: ChatThread.favorite / ChatThread.tag, con updateThreadMeta), que es el único sitio donde se guardan.
// Este archivo solo mantiene los mismos nombres de siempre para la pantalla Chats y, una sola vez, pasa al hilo lo que
// se hubiera guardado en el almacén provisional anterior («willy-front-chat-meta»), que después se borra.
import { useEffect, useState } from "react";
import { CHAT_EVENT, CHAT_TAGS, listThreads, loadThread, updateThreadMeta, type ChatTag } from "@/lib/chat-history";

export { CHAT_TAGS };
export type { ChatTag };
export type ChatMeta = { favorite?: boolean | undefined; tag?: ChatTag | undefined };

const OLD_KEY = "willy-front-chat-meta";

function readAll(): Record<string, ChatMeta> {
  if (typeof window === "undefined") return {};
  const out: Record<string, ChatMeta> = {};
  for (const t of listThreads()) {
    if (t.favorite || t.tag) out[t.id] = { ...(t.favorite ? { favorite: true } : {}), ...(t.tag ? { tag: t.tag } : {}) };
  }
  return out;
}

/** Pasa al hilo lo que quedara en el almacén provisional (sin pisar lo que el hilo ya tenga) y lo borra. */
function migrateOldStore(): void {
  if (typeof window === "undefined") return;
  let old: Record<string, ChatMeta> | null = null;
  try { old = JSON.parse(window.localStorage.getItem(OLD_KEY) ?? "null") as Record<string, ChatMeta> | null; } catch { old = null; }
  if (!old || typeof old !== "object") return;
  for (const [id, meta] of Object.entries(old)) {
    const thread = loadThread(id);
    if (!thread || !meta) continue;
    const patch: ChatMeta = {};
    if (meta.favorite && thread.favorite === undefined) patch.favorite = true;
    if (meta.tag && (CHAT_TAGS as readonly string[]).includes(meta.tag) && thread.tag === undefined) patch.tag = meta.tag;
    if (Object.keys(patch).length) updateThreadMeta(id, patch);
  }
  try { window.localStorage.removeItem(OLD_KEY); } catch { /* sin guardado */ }
}

export function readChatMeta(id: string): ChatMeta {
  return readAll()[id] ?? {};
}

export function updateChatMeta(id: string, patch: ChatMeta): void {
  updateThreadMeta(id, patch);
}

export function useChatMeta(): Record<string, ChatMeta> {
  const [all, setAll] = useState<Record<string, ChatMeta>>({});
  useEffect(() => {
    migrateOldStore();
    const sync = () => setAll(readAll());
    sync();
    window.addEventListener(CHAT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(CHAT_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return all;
}
