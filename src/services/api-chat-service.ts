// Conversaciones del proyecto contra el backend, con respuesta en directo (SSE).

import { fail, ok, type ServiceResult } from "@/types/domain";
import { api, attempt, readBackend } from "./backend";

export type ApiConversation = { id: string; projectId: string; messages?: ApiMessage[] };
export type ApiMessage = { id: string; role: "user" | "assistant"; text: string; createdAt?: string };

export const chatService = {
  async open(projectId: string): Promise<ServiceResult<ApiConversation>> {
    const list = await attempt(async () =>
      (await api<{ conversations: ApiConversation[] }>(`/api/projects/${projectId}/conversations`)).conversations,
    );
    if (list.ok && list.data.length) return ok(list.data[0]!);
    return attempt(async () =>
      (await api<{ conversation: ApiConversation }>(`/api/projects/${projectId}/conversations`, { method: "POST" }))
        .conversation,
    );
  },

  async messages(projectId: string, conversationId: string): Promise<ServiceResult<ApiMessage[]>> {
    return attempt(async () =>
      (
        await api<{ conversation: ApiConversation }>(
          `/api/projects/${projectId}/conversations/${conversationId}`,
        )
      ).conversation.messages ?? [],
    );
  },

  /** Envía un mensaje y va entregando el texto según llega del servidor. */
  async send(opts: {
    projectId: string;
    conversationId: string;
    text: string;
    onDelta?: (delta: string) => void;
    signal?: AbortSignal;
  }): Promise<ServiceResult<{ text: string; messageId: string | null }>> {
    const cfg = readBackend();
    if (!cfg.url) return fail("No hay dirección de backend configurada.");
    try {
      const res = await fetch(
        `${cfg.url}/api/projects/${opts.projectId}/conversations/${opts.conversationId}/messages`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...(cfg.organizationId ? { "X-Organization-Id": cfg.organizationId } : {}),
          },
          body: JSON.stringify({ text: opts.text }),
          ...(opts.signal ? { signal: opts.signal } : {}),
        },
      );
      if (!res.ok || !res.body) return fail(`El servidor respondió ${res.status}.`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let messageId: string | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            try {
              const event = JSON.parse(raw) as { type?: string; text?: string; messageId?: string; message?: string };
              if (event.messageId) messageId = event.messageId;
              if (event.type === "text_delta" && event.text) {
                text += event.text;
                opts.onDelta?.(event.text);
              }
              if (event.type === "error") return fail(event.message ?? "El servidor ha devuelto un error.");
            } catch {
              /* evento sin JSON: se ignora */
            }
          }
        }
      }
      return ok({ text, messageId });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return fail("Generación cancelada.");
      return fail("Se ha perdido la conexión con el servidor.");
    }
  },

  async cancel(projectId: string, conversationId: string, messageId: string) {
    return attempt(() =>
      api<{ cancelled: boolean }>(
        `/api/projects/${projectId}/conversations/${conversationId}/messages/${messageId}/cancel`,
        { method: "POST" },
      ),
    );
  },
};
