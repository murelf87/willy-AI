// FASE 4 · Registro común de CAPACIDADES. Los agentes piden capacidades («CODING + TOOLS, mejor si es rápido y gratis»), no marcas
// («Gemini»); el enrutador decide qué proveedor y qué modelo, y explica por qué.
//
// No sustituye a lo que ya funciona: orchestrator.ts (relevo entre modelos locales y su aprendizaje), auto-engine.ts («plug and
// play» y protección de datos sensibles), engine-plan.ts (orden de la Autoconstrucción), chat-cloud.ts (cadena de IA externas) y
// engines-server.ts (claves, cuotas y llamadas) siguen igual. Este registro les da un vocabulario común y una forma explicable de
// elegir; se irá conectando a ellos poco a poco, sin romper sus interfaces.

import { isVisionModel } from "@/lib/capabilities";
import { isChatModel } from "@/lib/local-ai";

export const CAPABILITIES = [
  "TEXT", "REASONING", "CODING", "VISION", "OCR", "IMAGE_GENERATION", "IMAGE_EDITING", "VIDEO", "STT", "TTS", "AUDIO", "MUSIC",
  "EMBEDDINGS", "RERANK", "WEB_SEARCH", "WEB_READ", "TOOLS", "JSON", "LONG_CONTEXT", "LOCAL", "OFFLINE", "FAST", "FREE",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type ProviderKind = "llm" | "tool" | "media" | "voice";
/** Nivel gratuito: local (sin límite), recurrente (se renueva), crédito inicial (se acaba) o prueba. */
export type FreeKind = "local" | "recurring" | "starterCredit" | "trial";
export type CommercialUse = "allowed" | "restricted" | "unknown";

export type ProviderInfo = {
  id: string;
  name: string;
  kind: ProviderKind;
  where: "local" | "cloud";
  freeKind: FreeKind;
  requiresCard: boolean;
  commercialUse: CommercialUse;
  /** Lo que ofrece el proveedor en general (cada modelo concreto puede tener menos). */
  capabilities: Capability[];
  /** Lo que hay que comprobar o saber (condiciones, límites…). */
  note: string;
};

// Solo lo que WILLY ya tiene de verdad. «Uso comercial: desconocido» significa exactamente eso: no se afirma lo que no se ha
// verificado (depende de las condiciones de cada servicio y de la licencia de cada modelo).
export const PROVIDERS_INFO: ProviderInfo[] = [
  { id: "ollama", name: "Ollama (tu equipo)", kind: "llm", where: "local", freeKind: "local", requiresCard: false, commercialUse: "unknown", capabilities: ["TEXT", "REASONING", "CODING", "VISION", "EMBEDDINGS", "JSON", "LOCAL", "OFFLINE", "FREE"], note: "Todo en tu equipo. El uso comercial depende de la licencia de cada modelo descargado." },
  { id: "gemini", name: "Google Gemini", kind: "llm", where: "cloud", freeKind: "recurring", requiresCard: false, commercialUse: "unknown", capabilities: ["TEXT", "REASONING", "CODING", "VISION", "JSON", "TOOLS", "LONG_CONTEXT", "FREE"], note: "Nivel gratuito con límites diarios; en él Google puede usar lo enviado para mejorar sus productos." },
  { id: "groq", name: "Groq", kind: "llm", where: "cloud", freeKind: "recurring", requiresCard: false, commercialUse: "unknown", capabilities: ["TEXT", "REASONING", "CODING", "JSON", "TOOLS", "FAST", "FREE"], note: "Gratis con límites por minuto y por día; muy rápido." },
  { id: "openrouter", name: "OpenRouter (modelos «:free»)", kind: "llm", where: "cloud", freeKind: "recurring", requiresCard: false, commercialUse: "unknown", capabilities: ["TEXT", "REASONING", "CODING", "VISION", "JSON", "FREE"], note: "Solo modelos gratuitos «:free»; cada modelo tiene sus propias condiciones." },
  { id: "mistral", name: "Mistral", kind: "llm", where: "cloud", freeKind: "recurring", requiresCard: false, commercialUse: "unknown", capabilities: ["TEXT", "REASONING", "CODING", "OCR", "JSON", "TOOLS", "FREE"], note: "Nivel gratuito con límites; revisa sus condiciones sobre datos." },
  { id: "cohere", name: "Cohere", kind: "llm", where: "cloud", freeKind: "trial", requiresCard: false, commercialUse: "restricted", capabilities: ["TEXT", "EMBEDDINGS", "RERANK", "JSON", "FREE"], note: "Clave de prueba con cupo mensual; la clave de prueba no es para uso comercial." },
  { id: "nvidia", name: "NVIDIA", kind: "llm", where: "cloud", freeKind: "recurring", requiresCard: false, commercialUse: "unknown", capabilities: ["TEXT", "REASONING", "CODING", "VISION", "JSON", "FREE"], note: "Catálogo que cambia: WILLY elige el modelo de conversación de su lista en cada momento." },
  { id: "comfyui", name: "ComfyUI (tu equipo)", kind: "media", where: "local", freeKind: "local", requiresCard: false, commercialUse: "unknown", capabilities: ["IMAGE_GENERATION", "IMAGE_EDITING", "VIDEO", "LOCAL", "OFFLINE", "FREE"], note: "Solo ofrece lo que permitan los flujos y modelos que tengas instalados." },
  { id: "piper", name: "Piper (voces de tu equipo)", kind: "voice", where: "local", freeKind: "local", requiresCard: false, commercialUse: "unknown", capabilities: ["TTS", "LOCAL", "OFFLINE", "FREE"], note: "Voces naturales en tu equipo; cada voz tiene su propia licencia." },
  { id: "willy-web", name: "Búsqueda web de WILLY", kind: "tool", where: "cloud", freeKind: "recurring", requiresCard: false, commercialUse: "unknown", capabilities: ["WEB_SEARCH", "WEB_READ", "FREE"], note: "Búsqueda y lectura de páginas públicas sin clave; sale a internet solo lo que se busca." },
];

export const providerInfo = (id: string): ProviderInfo | undefined => PROVIDERS_INFO.find((p) => p.id === id);

/** Capacidades de un modelo concreto, deducidas de su nombre (solo lo que se sabe; nunca se anuncia lo que no tiene). */
export function modelCapabilities(model: string, providerId = "ollama"): Capability[] {
  const name = model.toLowerCase();
  const provider = providerInfo(providerId);
  const caps = new Set<Capability>();
  if (/embed|bge-|gte-|e5-|minilm|nomic-|mxbai|arctic-embed/.test(name)) caps.add("EMBEDDINGS");
  else if (/rerank/.test(name)) caps.add("RERANK");
  else if (/whisper/.test(name)) caps.add("STT");
  else if (isChatModel(model)) {
    caps.add("TEXT");
    caps.add("JSON");
    if (/coder|code|codestral|devstral|starcoder|deepseek-v|qwen3|gpt-oss|kimi|glm/.test(name)) caps.add("CODING");
    if (/r1|reason|think|qwq|o1|o3|o4|magistral|nemotron|gpt-oss|deepseek-v|qwen3|kimi|glm/.test(name)) caps.add("REASONING");
    if (isVisionModel(model) || /vision|vl\b|-vl|llava|pixtral|gemma3|gemma-3|gemini|minicpm-v|moondream/.test(name)) caps.add("VISION");
    if (/gemini|128k|1m\b|long/.test(name)) caps.add("LONG_CONTEXT");
    if (/mini|small|3b|1b|0\.5b|flash|8b|instant|lite/.test(name) || providerId === "groq") caps.add("FAST");
  }
  if (provider?.where === "local") { caps.add("LOCAL"); caps.add("OFFLINE"); }
  if (provider?.capabilities.includes("FREE")) caps.add("FREE");
  if (provider?.capabilities.includes("TOOLS") && caps.has("TEXT")) caps.add("TOOLS");
  return [...caps];
}

export type RouteRequest = {
  required: Capability[];
  preferred?: Capability[];
  /** «sensible»: solo tu equipo (se respeta la protección de datos que ya tiene WILLY). */
  privacy?: "normal" | "sensible";
  /** Proyecto para producción comercial: se evitan proveedores con uso comercial restringido. */
  commercial?: boolean;
};
export type Candidate = { providerId: string; model: string; available: boolean };
export type RouteChoice = Candidate & { capabilities: Capability[]; score: number; why: string };
export type RouteResult = { chosen: RouteChoice[]; discarded: Array<Candidate & { why: string }> };

/** Elige, con motivos explicables, qué modelos pueden hacer la tarea (en orden). Nunca propone nada de pago. */
export function routeRequest(req: RouteRequest, candidates: Candidate[]): RouteResult {
  const chosen: RouteChoice[] = [];
  const discarded: Array<Candidate & { why: string }> = [];
  candidates.forEach((c, index) => {
    const info = providerInfo(c.providerId);
    const caps = modelCapabilities(c.model, c.providerId);
    const missing = req.required.filter((cap) => !caps.includes(cap));
    if (!info) return discarded.push({ ...c, why: "proveedor desconocido para WILLY" });
    if (!c.available) return discarded.push({ ...c, why: "no disponible ahora (sin clave, sin cuota o apagado)" });
    if (!caps.includes("FREE")) return discarded.push({ ...c, why: "no es gratuito: WILLY nunca gasta dinero por su cuenta" });
    if (req.privacy === "sensible" && info.where !== "local") return discarded.push({ ...c, why: "hay datos sensibles: solo se usa tu equipo" });
    if (req.commercial && info.commercialUse === "restricted") return discarded.push({ ...c, why: "su plan gratuito no permite uso comercial" });
    if (missing.length) return discarded.push({ ...c, why: `le falta: ${missing.join(", ")}` });
    const preferred = (req.preferred ?? []).filter((cap) => caps.includes(cap));
    // Orden explicable: primero lo que cumple más preferencias; a igualdad, se respeta el orden de entrada (el que ya usaba WILLY).
    const score = preferred.length * 10 - index * 0.01;
    const notes = [
      `tiene ${req.required.join(" + ") || "lo básico"}`,
      preferred.length ? `además ${preferred.join(", ")}` : "",
      info.where === "local" ? "en tu equipo" : "gratis en la nube",
      req.commercial && info.commercialUse === "unknown" ? "uso comercial sin confirmar (revísalo antes de publicar)" : "",
    ].filter(Boolean);
    chosen.push({ ...c, capabilities: caps, score, why: notes.join("; ") });
  });
  chosen.sort((a, b) => b.score - a.score);
  return { chosen, discarded };
}

/** Lo que sabe hacer un modelo, en palabras cortas para enseñarlo junto a su nombre (solo lo que se sabe de verdad). */
export function capabilityLabels(model: string, providerId = "ollama"): string[] {
  const caps = modelCapabilities(model, providerId);
  const labels: string[] = [];
  if (caps.includes("CODING")) labels.push("programa");
  if (caps.includes("VISION")) labels.push("ve imágenes");
  if (caps.includes("REASONING")) labels.push("razona");
  if (caps.includes("FAST")) labels.push("rápido");
  if (caps.includes("EMBEDDINGS")) labels.push("solo búsquedas");
  return labels;
}

/**
 * «Automático» al crear un proyecto: qué modelo de TU EQUIPO lo construye. Se piden capacidades (CODING), no marcas.
 * `ranked` son los modelos instalados en el orden del orquestador (el mejor primero, con lo que ya ha aprendido); si el modelo
 * que ya usas sabe programar, se respeta. Devuelve null si ninguno sabe programar (entonces no se cambia nada).
 */
export function chooseBuildModel(ranked: string[], current: string): { model: string; changed: boolean; why: string } | null {
  const candidates = ranked.filter((name) => isChatModel(name)).map((model) => ({ providerId: "ollama", model, available: true }));
  const result = routeRequest({ required: ["CODING"], privacy: "sensible" }, candidates);
  if (!result.chosen.length) return null;
  const pick = result.chosen.find((c) => c.model === current) ?? result.chosen[0]!;
  return { model: pick.model, changed: pick.model !== current, why: explainRoute({ ...result, chosen: [pick, ...result.chosen.filter((c) => c.model !== pick.model)] }) };
}

/** Explicación corta de la elección, para enseñarla al dueño. */
export function explainRoute(result: RouteResult): string {
  if (!result.chosen.length) return `Ninguna IA puede hacerlo ahora: ${result.discarded.map((d) => `${d.model} (${d.why})`).join("; ") || "no hay candidatos"}.`;
  const first = result.chosen[0]!;
  const info = providerInfo(first.providerId)!;
  return `Elegido ${first.model} (${info.name}): ${first.why}.${result.chosen.length > 1 ? ` Si falla: ${result.chosen.slice(1, 3).map((c) => c.model).join(", ")}.` : ""}`;
}
