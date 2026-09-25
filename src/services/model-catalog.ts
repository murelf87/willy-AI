// Catálogo de modelos libres y gratuitos para el motor local (Ollama u otro compatible).
// Todos son de descarga abierta: no hacen falta claves ni cuentas de pago.
// La descarga se hace contra el propio motor local (POST /api/pull), con progreso real.

import { normalizeEndpoint } from "@/lib/local-ai";
import { fail, ok, type ServiceResult } from "@/types/domain";

export type CatalogModel = {
  /** Identificador exacto que entiende el motor local (ollama pull <name>). */
  name: string;
  /** Nombre amigable para quien no conoce los modelos. */
  label: string;
  tag: "Código" | "General" | "Visión" | "Ligero" | "Razonamiento" | "Embeddings";
  size: string;
  /** Memoria recomendada para que vaya fino. */
  ram: string;
  desc: string;
  /** Recomendado como punto de partida. */
  best?: boolean;
};

/** Los mejores modelos abiertos que se pueden usar gratis en local. */
export const MODEL_CATALOG: CatalogModel[] = [
  {
    name: "qwen2.5-coder:14b",
    label: "Qwen 2.5 Coder 14B",
    tag: "Código",
    size: "9,0 GB",
    ram: "16 GB",
    desc: "El mejor para programar en local: genera webs y aplicaciones completas con muy buena calidad.",
    best: true,
  },
  {
    name: "qwen2.5-coder:7b",
    label: "Qwen 2.5 Coder 7B",
    tag: "Código",
    size: "4,7 GB",
    ram: "8 GB",
    desc: "La versión ligera del anterior. Ideal si tu equipo es más justo de memoria.",
  },
  {
    name: "deepseek-coder-v2:16b",
    label: "DeepSeek Coder V2 16B",
    tag: "Código",
    size: "8,9 GB",
    ram: "16 GB",
    desc: "Muy fuerte en refactorizar y corregir errores en proyectos grandes.",
  },
  {
    name: "llama3.1:8b",
    label: "Llama 3.1 8B",
    tag: "General",
    size: "4,7 GB",
    ram: "8 GB",
    desc: "Equilibrado para conversación, planificación y redacción. Buen modelo de uso diario.",
    best: true,
  },
  {
    name: "gemma2:9b",
    label: "Gemma 2 9B",
    tag: "General",
    size: "5,4 GB",
    ram: "12 GB",
    desc: "Modelo abierto de Google, muy sólido explicando y resumiendo.",
  },
  {
    name: "qwen2.5:14b",
    label: "Qwen 2.5 14B",
    tag: "Razonamiento",
    size: "9,0 GB",
    ram: "16 GB",
    desc: "El más capaz del catálogo para tareas complejas de análisis y planificación.",
  },
  {
    name: "deepseek-r1:8b",
    label: "DeepSeek R1 8B",
    tag: "Razonamiento",
    size: "4,9 GB",
    ram: "8 GB",
    desc: "Piensa paso a paso antes de responder. Útil para arquitectura y decisiones técnicas.",
  },
  {
    name: "llama3.2:3b",
    label: "Llama 3.2 3B",
    tag: "Ligero",
    size: "2,0 GB",
    ram: "4 GB",
    desc: "Respuestas instantáneas para tareas sencillas y borradores.",
  },
  {
    name: "phi4-mini",
    label: "Phi-4 Mini 3.8B",
    tag: "Ligero",
    size: "2,5 GB",
    ram: "4 GB",
    desc: "Pequeño y sólido para su tamaño. Sustituye a Phi-3 Mini.",
  },
  {
    name: "gemma3:4b",
    label: "Gemma 3 4B (visión)",
    tag: "Visión",
    size: "3,3 GB",
    ram: "8 GB",
    desc: "Entiende imágenes y escribe bien en español; cabe entero en 6 GB de memoria gráfica. Necesita Ollama 0.6 o superior.",
  },
  {
    name: "qwen2.5vl:3b",
    label: "Qwen 2.5 VL 3B (visión)",
    tag: "Visión",
    size: "≈3 GB",
    ram: "8 GB",
    desc: "Ligero y bueno leyendo el texto de las imágenes (capturas, documentos).",
  },
  {
    name: "nomic-embed-text",
    label: "Nomic Embed",
    tag: "Embeddings",
    size: "274 MB",
    ram: "2 GB",
    desc: "Necesario para que WILLY busque dentro de tu propio código y tus documentos.",
    best: true,
  },
];

export const CATALOG_TAGS = ["Todos", "Código", "General", "Razonamiento", "Visión", "Ligero", "Embeddings"] as const;
export type CatalogTag = (typeof CATALOG_TAGS)[number];

export type PullProgress = {
  /** Texto del motor: "pulling manifest", "downloading", "verifying"... */
  status: string;
  /** 0-100, o null cuando el motor todavía no informa del tamaño. */
  percent: number | null;
};

/**
 * Descarga un modelo en el motor local con progreso real.
 * Usa la API nativa de Ollama (POST /api/pull, respuesta en líneas JSON).
 */
export async function pullModel(
  endpoint: string,
  name: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal,
): Promise<ServiceResult<true>> {
  normalizeEndpoint(endpoint);
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name, stream: true }),
  };
  if (signal) init.signal = signal;

  const ask = async () => fetch("/api/local-ai?operation=pull", init);

  let res: Response | null = null;
  try {
    res = await ask();
  } catch {
    res = null;
  }
  // Si el motor no está arrancado, WILLY lo instala y lo arranca solo, y reintenta.
  if (!res || !res.ok) {
    onProgress({ status: "preparando el motor de IA de tu equipo", percent: null });
    try {
      const fix = await fetch("/api/engine", { method: "POST" });
      const data = (await fix.json()) as { ok?: boolean; error?: string };
      if (!fix.ok || !data.ok) return fail<true>(data.error ?? "El motor de IA de tu equipo no está en marcha.");
      res = await ask();
    } catch {
      return fail<true>("No se pudo hablar con el motor local. Abre WILLY AI desde su acceso directo del escritorio.");
    }
  }
  if (!res.ok) return fail<true>(`El motor respondió ${res.status} al descargar ${name}.`);
  if (!res.body) return fail<true>("El motor no devolvió progreso de descarga.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastError = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const raw = line.trim();
        if (!raw) continue;
        let evt: { status?: string; error?: string; total?: number; completed?: number };
        try {
          evt = JSON.parse(raw) as typeof evt;
        } catch {
          continue;
        }
        if (evt.error) lastError = evt.error;
        const percent = evt.total && evt.total > 0 ? Math.min(100, Math.round(((evt.completed ?? 0) / evt.total) * 100)) : null;
        onProgress({ status: evt.status ?? "descargando", percent });
      }
    }
  } catch (error) {
    if (signal?.aborted) return fail<true>("Descarga cancelada.");
    return fail<true>(error instanceof Error ? error.message : "La descarga se interrumpió.");
  }

  if (lastError) return fail<true>(lastError);
  return ok(true as const);
}

/** Borra un modelo del disco a través del motor local. */
export async function removeModel(endpoint: string, name: string): Promise<ServiceResult<true>> {
  normalizeEndpoint(endpoint);
  try {
    const res = await fetch("/api/local-ai", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name }),
    });
    if (!res.ok) return fail<true>(`El motor respondió ${res.status} al borrar ${name}.`);
    return ok(true as const);
  } catch {
    return fail<true>("No se pudo contactar con el motor local.");
  }
}

/** Orden recomendado: primero los destacados, luego por tamaño de descarga. */
export function recommended(): CatalogModel[] {
  return MODEL_CATALOG.filter((m) => m.best);
}
