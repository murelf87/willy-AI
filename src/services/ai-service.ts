// Capa de IA independiente del proveedor. Todo se ejecuta con el motor local.

import { chatLocalStream, normalizeEndpoint, resolveLocalModel, type ChatMsg } from "@/lib/local-ai";
import { fail, ok, type ModelInfo, type ServiceResult } from "@/types/domain";

export type ProviderId = "local";

export type ChatRequest = {
  endpoint: string;
  model: string;
  messages: ChatMsg[];
  onDelta?: (delta: string) => void;
};

export interface AIProvider {
  id: ProviderId;
  label: string;
  /** Comprueba de verdad si el motor responde. Nunca inventa disponibilidad. */
  health(endpoint: string): Promise<ServiceResult<true>>;
  models(endpoint: string): Promise<ServiceResult<ModelInfo[]>>;
  chat(req: ChatRequest): Promise<ServiceResult<string>>;
}

function formatSize(bytes?: number): string {
  if (!bytes) return "—";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1).replace(".", ",")} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function tagFor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("embed")) return "Embeddings";
  if (n.includes("llava") || n.includes("vision")) return "Visión";
  if (n.includes("coder") || n.includes("code")) return "Código";
  return "General";
}

const localProvider: AIProvider = {
  id: "local",
  label: "Motor local",

  async health(endpoint) {
    const base = normalizeEndpoint(endpoint);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${base}/v1/models`, { signal: controller.signal });
      return res.ok ? ok(true as const) : fail<true>(`El motor respondió ${res.status}.`);
    } catch {
      // Algunos motores bloquean CORS en /v1/models pero sí están arrancados.
      try {
        await fetch(base, { mode: "no-cors", signal: controller.signal });
        return ok(true as const);
      } catch {
        return fail<true>("No hay respuesta en esa dirección.");
      }
    } finally {
      window.clearTimeout(timer);
    }
  },

  async models(endpoint) {
    const base = normalizeEndpoint(endpoint);
    try {
      const res = await fetch("/api/local-ai");
      if (res.ok) {
        const data = (await res.json()) as { models?: { name: string; size?: number }[] };
        const list = (data.models ?? []).map<ModelInfo>((m) => ({
          name: m.name,
          size: formatSize(m.size),
          tag: tagFor(m.name),
          loaded: true,
          origin: "local",
        }));
        if (list.length) return ok(list);
      }
    } catch {
      /* probamos el formato OpenAI */
    }
    try {
      const res = await fetch(`${base}/v1/models`);
      if (!res.ok) return fail<ModelInfo[]>(`El motor respondió ${res.status}.`);
      const data = (await res.json()) as { data?: { id: string }[] };
      return ok(
        (data.data ?? []).map<ModelInfo>((m) => ({
          name: m.id,
          size: "—",
          tag: tagFor(m.id),
          loaded: true,
          origin: "local",
        })),
      );
    } catch {
      return fail<ModelInfo[]>("No se pudo leer la lista de modelos del motor local.");
    }
  },

  async chat(req) {
    const viaLocal = () =>
      resolveLocalModel(req.endpoint, req.model).then((model) =>
        chatLocalStream({
          endpoint: req.endpoint,
          model,
          messages: req.messages,
          ...(req.onDelta ? { onDelta: req.onDelta } : {}),
        }),
      );

    try {
      return ok(await viaLocal());
    } catch (error) {
      return fail<string>(error instanceof Error ? error.message : "El motor local no ha respondido.");
    }
  },
};

export const PROVIDERS: Record<ProviderId, AIProvider> = { local: localProvider };

export const aiService = {
  provider(id: ProviderId = "local"): AIProvider {
    return PROVIDERS[id];
  },
  health: (endpoint: string) => localProvider.health(endpoint),
  models: (endpoint: string) => localProvider.models(endpoint),
  chat: (req: ChatRequest) => localProvider.chat(req),
};
