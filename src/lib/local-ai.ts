// Cliente del motor de IA local del usuario (compatible con la API de OpenAI:
// Ollama, LM Studio, llama.cpp server...). Todo se ejecuta en su equipo.

import { fitContext } from "@/lib/chat-context";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

/** WILLY habla con Ollama a través de su propio servidor local para evitar bloqueos del navegador. */
export function localAiUrl(operation?: "chat"): string {
  return operation ? `/api/local-ai?operation=${operation}` : "/api/local-ai";
}

/** Modelos que NO saben conversar (embeddings, reordenadores, visión pura). */
const NO_CHAT = /(embed|embedding|bge-|gte-|e5-|minilm|rerank|nomic-|all-minilm|mxbai-embed|snowflake-arctic-embed|paraphrase|clip|whisper|moondream-embed)/i;

/** true si el modelo puede mantener una conversación. */
export function isChatModel(name: string): boolean {
  return !NO_CHAT.test(name);
}

/**
 * Lee del motor local los modelos realmente instalados.
 * Por defecto devuelve solo los que sirven para chatear.
 */
export async function listLocalModels(endpoint = "", opts: { chatOnly?: boolean } = {}): Promise<string[]> {
  const base = normalizeEndpoint(endpoint);
  const names: string[] = [];
  try {
    const res = await fetch(localAiUrl());
    if (res.ok) {
      const data = (await res.json()) as { models?: { name?: string }[] };
      for (const m of data.models ?? []) if (m?.name) names.push(m.name);
    }
  } catch {
    /* motor sin API de Ollama: se prueba con la de OpenAI */
  }
  if (!names.length && base) {
    try {
      const res = await fetch(`${base}/v1/models`);
      if (res.ok) {
        const data = (await res.json()) as { data?: { id?: string }[] };
        for (const m of data.data ?? []) if (m?.id) names.push(m.id);
      }
    } catch {
      /* el motor no está arrancado */
    }
  }
  const unique = Array.from(new Set(names));
  return opts.chatOnly === false ? unique : unique.filter(isChatModel);
}

/**
 * Devuelve un modelo de conversación que el motor local tenga realmente instalado.
 * Nunca elige modelos de embeddings: no saben chatear y devolverían error 400.
 */
export async function resolveLocalModel(endpoint: string, preferred: string): Promise<string> {
  const all = await listLocalModels(endpoint, { chatOnly: false });
  if (!all.length) {
    throw new Error("El motor local no está arrancado o todavía no tiene ningún modelo descargado.");
  }
  const chat = all.filter(isChatModel);
  if (!chat.length) {
    throw new Error(
      "Los modelos instalados solo sirven para búsquedas, no para conversar. Descarga llama3.2:3b en Centro de Inteligencia → Modelos.",
    );
  }
  if (isChatModel(preferred)) {
    const exact = chat.find((n) => n === preferred);
    if (exact) return exact;
    const partial = chat.find((n) => n.split(":")[0] === preferred.split(":")[0]);
    if (partial) return partial;
  }
  return chat[0]!;
}

/**
 * Llama al motor local y devuelve el texto completo.
 * Usa streaming (SSE) cuando el motor lo soporta y avisa de cada trozo vía onDelta,
 * para que el usuario vea la respuesta escribiéndose en el chat en tiempo real.
 */
export async function chatLocalStream(opts: {
  endpoint: string;
  model: string;
  messages: ChatMsg[];
  onDelta?: (delta: string) => void;
  temperature?: number;
  maxOutputTokens?: number;
  /** Memoria de contexto (tokens) que debe reservar Ollama; sin esto usa la suya por defecto, a menudo muy pequeña. */
  numCtx?: number;
  signal?: AbortSignal;
}): Promise<string> {
  // Sin memoria pedida, Ollama usa la suya por defecto (2.048–4.096 tokens) y recorta la petición en silencio: el modelo pierde
  // su identidad, el historial o la pregunta. Aquí se calcula la que hace falta según el tamaño real de la conversación.
  const fit = opts.numCtx ? null : fitContext(opts.model, opts.messages, opts.maxOutputTokens ?? 2048);
  const send = (withContext: boolean) =>
    fetch(localAiUrl("chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: withContext && fit ? fit.messages : opts.messages,
        stream: true,
        temperature: opts.temperature ?? 0.4,
        ...(opts.maxOutputTokens ? { max_tokens: opts.maxOutputTokens } : {}),
        ...(opts.numCtx ? { num_ctx: opts.numCtx } : withContext && fit ? { num_ctx: fit.numCtx } : {}),
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  let res = await send(true);
  // Si el motor rechaza la memoria calculada, se repite una vez como antes.
  if (!res.ok && fit && !opts.signal?.aborted) {
    void res.body?.cancel().catch(() => undefined);
    res = await send(false);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`El motor local respondió ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const ctype = res.headers.get("content-type") ?? "";
  const sse = ctype.includes("event-stream");
  const ndjson = ctype.includes("ndjson");
  if (!sse && !ndjson) {
    // Algunos motores ignoran stream:true y responden de una vez.
    const raw = await res.text();
    let text = "";
    try {
      const data = JSON.parse(raw) as { choices?: { message?: { content?: string } }[]; message?: { content?: string }; response?: string };
      text = data.choices?.[0]?.message?.content ?? data.message?.content ?? data.response ?? "";
    } catch {
      // Compatibilidad con motores que responden en JSON por líneas.
      for (const line of raw.split("\n")) {
        try {
          const data = JSON.parse(line) as { message?: { content?: string }; response?: string };
          text += data.message?.content ?? data.response ?? "";
        } catch {
          /* línea ajena al flujo */
        }
      }
    }
    if (text) opts.onDelta?.(text);
    return text;
  }

  if (!res.body) throw new Error("El motor local no ha devuelto una respuesta.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (sse && !trimmed.startsWith("data:")) continue;
      const payload = sse ? trimmed.slice(5).trim() : trimmed;
      if (!payload || payload === "[DONE]") continue;
      let json: { choices?: { delta?: { content?: string } }[]; message?: { content?: string }; response?: string; error?: string };
      try {
        json = JSON.parse(payload) as typeof json;
      } catch {
        continue; /* fragmento incompleto: se ignora */
      }
      if (typeof json.error === "string" && json.error) throw new Error(`El motor local devolvió un error: ${json.error.slice(0, 200)}`);
      const delta = json.choices?.[0]?.delta?.content ?? json.message?.content ?? json.response;
      if (delta) {
        full += delta;
        opts.onDelta?.(delta);
      }
    }
  }
  return full;
}
