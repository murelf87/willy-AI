// Encargo para el CHAT desde otra pantalla (la caja de Inicio del armazón nuevo): el texto y los adjuntos aparecen ya
// escritos en el chat y, si se pidió, se envían solos. Mismo patrón que `super-willy-handoff.ts` (memoria + evento;
// nada por la dirección ni por variables globales). Se consume al leerlo.
import { openView } from "@/lib/background-tasks";

export type ChatHandoff = {
  id: string;
  text: string;
  files: File[];
  /** Enviar en cuanto esté escrito (la caja de Inicio); si no, solo queda escrito en el cuadro. */
  autoSend: boolean;
  at: number;
};

export const CHAT_HANDOFF_EVENT = "willy:encargo-chat";
let pending: ChatHandoff | null = null;

/** Deja un encargo para el Chat y lo abre (el chat lo recoge al abrirse o al cambiar de conversación). */
export function sendToChat(input: { text: string; files?: File[]; autoSend?: boolean }): ChatHandoff {
  const handoff: ChatHandoff = {
    id: `chat-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text: input.text,
    files: input.files ?? [],
    autoSend: input.autoSend ?? false,
    at: Date.now(),
  };
  pending = handoff;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ChatHandoff>(CHAT_HANDOFF_EVENT, { detail: handoff }));
    openView("chat");
  }
  return handoff;
}

/** El encargo pendiente (se consume al leerlo). */
export function takeChatHandoff(): ChatHandoff | null {
  const h = pending;
  pending = null;
  return h;
}

/** Solo para pruebas. */
export function resetChatHandoff(): void {
  pending = null;
}
