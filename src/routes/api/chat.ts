// Endpoint genérico de chat: recibe { messages, stream?, model?, kind? } y responde con la IA disponible.
// Prueba primero Ollama local; si no está listo, prueba los motores externos en el orden adecuado al tipo.
// kind: "razonamiento" | "codigo" | "investigacion" | ... (ver routing-table.ts KIND_CLOUD_ORDER)
// Devuelve { content, model }. Usado por IA Influencer, Análisis Jurídico y otros componentes de texto.
import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import { CHAT_ORDER, KIND_CLOUD_ORDER } from "@/lib/routing-table";
import { engineAction } from "@/lib/engines-server";
import nodePath from "node:path";

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

async function tryCloud(messages: ChatMsg[], root: string, kind?: string): Promise<{ content: string; model: string } | null> {
  const order = (kind && KIND_CLOUD_ORDER[kind]) ? KIND_CLOUD_ORDER[kind]! : CHAT_ORDER;
  const dir = nodePath.join(root, "datos-privados");
  for (const id of order) {
    try {
      const result = (await engineAction(dir, {
        action: "cloud-chat",
        id,
        messages,
        maxTokens: 4000,
      })) as { ok?: boolean; data?: string; model?: string; error?: string };
      if (result.ok && result.data) {
        return { content: result.data.trim(), model: `${id} · ${result.model ?? id}` };
      }
    } catch {
      // pasar al siguiente motor
    }
  }
  return null;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        let body: { messages?: ChatMsg[]; stream?: boolean; model?: string; kind?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Petición no válida." }, { status: 400 });
        }
        const messages: ChatMsg[] = Array.isArray(body.messages) ? body.messages : [];
        if (!messages.length) return Response.json({ error: "Falta el campo messages." }, { status: 400 });

        // 1. Intentar Ollama local
        const local = await tryOllama(messages);
        if (local) return Response.json({ content: local, model: "local" }, { headers: { "Cache-Control": "no-store" } });

        // 2. Fallback: motores de nube en CHAT_ORDER
        try {
          const root = process.env["WILLY_ROOT"] ?? process.cwd();
          const cloud = await tryCloud(messages, root, body.kind);
          if (cloud) return Response.json({ content: cloud.content, model: cloud.model }, { headers: { "Cache-Control": "no-store" } });
        } catch {
          // ningún motor de nube disponible
        }

        return Response.json({ error: "No hay IA disponible ahora mismo. Comprueba que Ollama está arrancado (IA de tu equipo) o que tienes algún motor de nube configurado." }, { status: 503 });
      },
    },
  },
});
