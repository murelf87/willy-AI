// ENRUTADO · tabla única de los órdenes de IA externas (lo que WILLY prueba primero, y después, en cada sitio).
// Antes cada motor guardaba su propia lista: el chat (chat-cloud.ts), el «plug and play» por tipo de petición (auto-engine.ts)
// y la Autoconstrucción (engine-plan.ts). Ahora las tres viven aquí, con los mismos valores de siempre, y esos archivos las
// reexportan con su nombre de siempre (nada cambia para quien ya las usaba). Así el Centro de Inteligencia → Routing enseña
// la tabla que se usa de verdad, no una copia que se pueda quedar vieja. Solo datos: sin importaciones.

/** Chat normal con «IA externa»: Groq primero (más rápido para conversaciones cortas), luego el resto. */
export const CHAT_ORDER = ["groq", "cerebras", "gemini", "openrouter", "modelscope", "cloudflare", "siliconflow", "huggingface", "perplexity", "xai", "deepseek", "zai", "kimi", "minimax", "nvidia", "mistral", "cohere"];

/**
 * Autoconstrucción (y SUPER WILLY cuando construye): primero los que aguantan contextos largos (10k+ tokens).
 * Groq NO está aquí: su límite de 8k tokens hace que rechace siempre los prompts de autoconstrucción,
 * ralentizando el proceso sin aportar nada. Para chats cortos sigue disponible en CHAT_ORDER.
 *
 * Orden actual: OpenAI (si el dueño tiene clave válida) → Mistral/Codestral → Cohere → OpenRouter → resto.
 * Mistral y Cohere van delante porque en el equipo real del dueño han demostrado responder con estabilidad a contextos largos.
 * OpenRouter conserva su catálogo gratuito como fallback, pero ya no puede retener un ciclo largo cuando sus upstream están saturados.
 * NVIDIA queda al final porque puede tardar incluso con peticiones pequeñas.
 *
 * Groq se reserva para tareas cortas por su contexto limitado.
 */
export const BUILD_ORDER = ["openai", "mistral", "cohere", "openrouter", "gemini", "cerebras", "modelscope", "cloudflare", "siliconflow", "huggingface", "xai", "deepseek", "zai", "kimi", "minimax", "nvidia"];

/**
 * «Plug and play»: orden por tipo de petición.
 * Groq solo en tareas cortas (código simple, chat, web, traducción) donde su límite 8k no es problema.
 * Para tareas que generan respuestas largas (razonamiento, investigación, escritura) no va primero.
 */
export const KIND_CLOUD_ORDER: Record<string, string[]> = {
  codigo:        ["mistral", "cohere", "openrouter", "cerebras", "modelscope", "gemini", "cloudflare", "siliconflow", "huggingface", "xai", "deepseek", "zai", "kimi", "minimax", "nvidia", "groq"],
  web:           ["mistral", "cohere", "openrouter", "gemini", "cerebras", "modelscope", "cloudflare", "siliconflow", "huggingface", "xai", "nvidia", "groq"],
  datos:         ["gemini", "openrouter", "modelscope", "cerebras", "cloudflare", "siliconflow", "huggingface", "xai", "nvidia", "mistral", "cohere", "groq"],
  razonamiento:  ["openrouter", "cerebras", "gemini", "modelscope", "cloudflare", "siliconflow", "huggingface", "xai", "deepseek", "zai", "kimi", "minimax", "nvidia", "mistral", "cohere", "groq"],
  juridico:      ["perplexity", "openai", "gemini", "openrouter", "cerebras", "modelscope", "cloudflare", "siliconflow", "huggingface", "mistral", "cohere", "xai", "deepseek", "zai", "kimi", "nvidia", "groq"],
  investigacion: ["perplexity", "gemini", "openrouter", "modelscope", "cerebras", "huggingface", "cloudflare", "siliconflow", "xai", "cohere", "nvidia", "mistral", "groq"],
  escritura:     ["gemini", "openrouter", "cerebras", "modelscope", "huggingface", "cloudflare", "siliconflow", "xai", "mistral", "cohere", "nvidia", "groq"],
  traduccion:    ["gemini", "mistral", "openrouter", "modelscope", "cerebras", "huggingface", "siliconflow", "xai", "cohere", "groq", "nvidia"],
  vision:        ["gemini", "modelscope", "openrouter", "huggingface", "siliconflow", "nvidia", "mistral", "cohere", "groq"],
  general:       ["mistral", "cohere", "openrouter", "gemini", "cerebras", "modelscope", "cloudflare", "siliconflow", "huggingface", "xai", "deepseek", "zai", "kimi", "minimax", "nvidia", "groq"],
};

/** Las IA externas de una lista que se pueden usar ahora mismo (con clave, activadas y sin agotar), en su orden. */
export function usableInOrder(order: readonly string[], engines: ReadonlyArray<{ id: string; hasKey: boolean; enabled: boolean; available: boolean }>): string[] {
  const ok = new Set(engines.filter((e) => e.hasKey && e.enabled && e.available).map((e) => e.id));
  return order.filter((id) => ok.has(id));
}
