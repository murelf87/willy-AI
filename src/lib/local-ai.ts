// Cliente del motor de IA local del usuario (compatible con la API de OpenAI:
// Ollama, Forge, LM Studio, llama.cpp server...). Todo se ejecuta en su equipo.

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

/** WILLY habla con Ollama a través de su propio servidor local para evitar bloqueos del navegador. */
export function localAiUrl(operation?: "chat"): string {
  return operation ? `/api/local-ai?operation=${operation}` : "/api/local-ai";
}

/**
 * Devuelve un modelo que el motor local tenga realmente instalado.
 * Si el modelo preferido no está descargado todavía, usa el primero disponible,
 * así el chat responde aunque las descargas grandes sigan en marcha.
 */
export async function resolveLocalModel(endpoint: string, preferred: string): Promise<string> {
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
  if (!names.length) {
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
  if (!names.length) {
    throw new Error("El motor local no está arrancado o todavía no tiene ningún modelo descargado.");
  }
  const exact = names.find((n) => n === preferred);
  if (exact) return exact;
  const partial = names.find((n) => n.split(":")[0] === preferred.split(":")[0]);
  return partial ?? names[0]!;
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
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(localAiUrl("chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature ?? 0.4,
    }),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`El motor local respondió ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("event-stream")) {
    // Algunos motores ignoran stream:true y responden de una vez.
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
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
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          opts.onDelta?.(delta);
        }
      } catch {
        /* fragmento incompleto: se ignora */
      }
    }
  }
  return full;
}
