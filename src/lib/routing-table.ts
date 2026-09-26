// ENRUTADO · tabla única de los órdenes de IA externas (lo que WILLY prueba primero, y después, en cada sitio).
// Antes cada motor guardaba su propia lista: el chat (chat-cloud.ts), el «plug and play» por tipo de petición (auto-engine.ts)
// y la Autoconstrucción (engine-plan.ts). Ahora las tres viven aquí, con los mismos valores de siempre, y esos archivos las
// reexportan con su nombre de siempre (nada cambia para quien ya las usaba). Así el Centro de Inteligencia → Routing enseña
// la tabla que se usa de verdad, no una copia que se pueda quedar vieja. Solo datos: sin importaciones.

/** Chat normal con «IA externa»: primero las más rápidas y fiables para conversar (las que marques van antes). */
export const CHAT_ORDER = ["groq", "gemini", "nvidia", "mistral", "openrouter", "cohere"];

/** Autoconstrucción (y SUPER WILLY cuando construye): primero la de más calidad; tu equipo siempre como último recurso. */
// 25/09/2026: Mistral (Codestral, un modelo hecho para programar) sube delante de NVIDIA, Groq y OpenRouter: en «Mundo jamon» contestaba
// el modelo gratuito de OpenRouter porque los primeros fallaban por tamaño, y sus respuestas no servían.
export const BUILD_ORDER = ["gemini", "mistral", "nvidia", "groq", "openrouter", "cohere"];

/** «Plug and play»: orden por tipo de petición (rapidez para lo corto y el código, contexto y prosa para lo largo, razonamiento…). */
export const KIND_CLOUD_ORDER: Record<string, string[]> = {
  codigo: ["groq", "gemini", "mistral", "nvidia", "openrouter", "cohere"],
  web: ["groq", "gemini", "mistral", "nvidia", "openrouter", "cohere"],
  datos: ["gemini", "groq", "nvidia", "openrouter", "mistral", "cohere"],
  razonamiento: ["gemini", "nvidia", "openrouter", "groq", "mistral", "cohere"],
  investigacion: ["gemini", "cohere", "nvidia", "openrouter", "mistral", "groq"],
  escritura: ["gemini", "mistral", "cohere", "nvidia", "openrouter", "groq"],
  traduccion: ["gemini", "mistral", "cohere", "nvidia", "groq", "openrouter"],
  vision: ["gemini", "groq", "mistral", "nvidia", "openrouter", "cohere"],
  general: ["groq", "gemini", "nvidia", "mistral", "openrouter", "cohere"],
};

/** Las IA externas de una lista que se pueden usar ahora mismo (con clave, activadas y sin agotar), en su orden. */
export function usableInOrder(order: readonly string[], engines: ReadonlyArray<{ id: string; hasKey: boolean; enabled: boolean; available: boolean }>): string[] {
  const ok = new Set(engines.filter((e) => e.hasKey && e.enabled && e.available).map((e) => e.id));
  return order.filter((id) => ok.has(id));
}
