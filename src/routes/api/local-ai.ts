import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL_NAME = /^[a-zA-Z0-9._:/-]{1,120}$/;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function forward(path: string, init?: RequestInit): Promise<Response> {
  try {
    const upstream = await fetch(`${OLLAMA_URL}${path}`, init);
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    headers.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return jsonError("Ollama no está arrancado en localhost:11434.", 503);
  }
}

export const Route = createFileRoute("/api/local-ai")({
  server: {
    handlers: {
      // Consulta de estado: nunca falla. Si el motor no está arrancado,
      // devolvemos una lista vacía para que la interfaz lo muestre sin error.
      GET: async () => {
        try {
          const upstream = await fetch(`${OLLAMA_URL}/api/tags`);
          const data = (await upstream.json()) as { models?: unknown[] };
          return Response.json(
            { models: data.models ?? [], engine: "online" },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            { models: [], engine: "offline" },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
      },
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        const operation = new URL(request.url).searchParams.get("operation");
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonError("Petición no válida.", 400);
        }
        if (operation === "chat" && typeof body === "object" && body !== null) {
          const b = body as { model?: unknown; messages?: unknown; temperature?: unknown; max_tokens?: unknown; num_ctx?: unknown };
          // Con memoria de contexto pedida se usa la API nativa de Ollama, la única que permite fijarla.
          if (typeof b.num_ctx === "number" && b.num_ctx >= 2048 && b.num_ctx <= 131_072 && typeof b.model === "string" && MODEL_NAME.test(b.model) && Array.isArray(b.messages)) {
            return forward("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: b.model,
                messages: b.messages,
                stream: true,
                options: {
                  num_ctx: b.num_ctx,
                  ...(typeof b.temperature === "number" ? { temperature: b.temperature } : {}),
                  ...(typeof b.max_tokens === "number" ? { num_predict: b.max_tokens } : {}),
                },
              }),
              signal: request.signal,
            });
          }
        }
        if (operation === "chat") {
          return forward("/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: request.signal,
          });
        }
        if (operation === "pull") {
          const model = typeof body === "object" && body !== null && "model" in body ? String(body.model) : "";
          if (!MODEL_NAME.test(model)) return jsonError("Nombre de modelo no válido.", 400);
          return forward("/api/pull", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, stream: true }),
            signal: request.signal,
          });
        }
        return jsonError("Operación no permitida.", 400);
      },
      DELETE: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        let body: { model?: unknown };
        try {
          body = (await request.json()) as { model?: unknown };
        } catch {
          return jsonError("Petición no válida.", 400);
        }
        const model = String(body.model ?? "");
        if (!MODEL_NAME.test(model)) return jsonError("Nombre de modelo no válido.", 400);
        return forward("/api/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        });
      },
    },
  },
});