// Endpoint genérico de chat: recibe { messages, stream?, model? } y responde con la IA disponible.
// Prueba primero Ollama local; si no está listo, usa la nube (chat-cloud). Devuelve { content, model }.
// Usado por IA Influencer (paso 1, guion) y por cualquier componente que necesite IA sin manejar streaming.
import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";

const OLLAMA_URL = "http://127.0.0.1:11434";

interface ChatMsg { role: "system" | "user" | "assistant"; content: string }

async function tryOllama(messages: ChatMsg[]): Promise<string | null> {
  try {
    // Pedir la lista de modelos disponibles
    const tagsRes = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!tagsRes.ok) return null;
    const tags = (await tagsRes.json()) as { models?: { name: string }[] };
    const model = tags.models?.[0]?.name;
    if (!model) return null;
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        let body: { messages?: ChatMsg[]; stream?: boolean; model?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Petición no válida." }, { status: 400 });
        }
        const messages: ChatMsg[] = Array.isArray(body.messages) ? body.messages : [];
        if (!messages.length) return Response.json({ error: "Falta el campo messages." }, { status: 400 });

        // Intentar Ollama local
        const local = await tryOllama(messages);
        if (local) return Response.json({ content: local, model: "local" }, { headers: { "Cache-Control": "no-store" } });

        return Response.json({ error: "No hay IA disponible ahora mismo. Comprueba que Ollama está arrancado (IA de tu equipo)." }, { status: 503 });
      },
    },
  },
});
