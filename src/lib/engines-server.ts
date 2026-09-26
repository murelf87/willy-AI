// Motores de IA en la nube (opcionales) para la Autoconstrucción. Solo APIs oficiales con nivel gratuito y compatibles
// con el formato de OpenAI. Las claves se guardan SOLO en este equipo (nunca vuelven a la pantalla). Cada motor sale
// de la rueda cuando se agota su cuota, pide pago o rechaza la clave, y se vuelve a probar solo cuando toca.

export type ProviderId = "gemini" | "groq" | "openrouter" | "mistral" | "cohere" | "nvidia";

export type Provider = {
  id: ProviderId;
  name: string;
  baseUrl: string;
  keyUrl: string;
  dataNote: string;
  /** Solo se usan modelos cuyo id termine así (OpenRouter: «:free», para no gastar nunca dinero). */
  onlyModelSuffix?: string;
  /** Modelos conocidos, por si el proveedor no ofrece la lista de modelos en su API compatible (Cohere). */
  fallbackModels?: string[];
  /** Modelos preferidos (expresiones, de más a menos), para elegir el mejor de ese proveedor. */
  prefer?: string[];
  /** Tope de tokens de respuesta que admite este proveedor (si se pide más, se recorta a esto). */
  maxOutput?: number;
};

export const PROVIDERS: Provider[] = [
  { id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", dataNote: "En el nivel gratuito, Google puede usar lo que envíes para mejorar sus productos. No actives la facturación." },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys", dataNote: "Gratis con límites por minuto y por día. No pases a su plan de pago." },
  // (25/09/2026) nemotron-3-super (razonador) contestaba vacío una y otra vez: primero los modelos gratuitos que programan y contestan.
  { id: "openrouter", name: "OpenRouter (modelos gratuitos)", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", dataNote: "Solo se usan modelos marcados «:free». Cada proveedor de esos modelos tiene sus propias condiciones.", onlyModelSuffix: ":free", prefer: ["qwen3-coder", "qwen3-235b", "llama-3\\.3-70b-instruct", "gemma-3-27b", "deepseek-chat", "mistral-small"] },
  { id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys", dataNote: "Nivel gratuito con límites. Revisa sus condiciones sobre el uso de datos." },
  // SambaNova se quitó: ya no es gratis. En su lugar, Cohere: clave de prueba gratis y sin tarjeta, muy buena en español y con
  // documentos largos (unas 1.000 peticiones al mes). Su API compatible con OpenAI no siempre da la lista de modelos: por eso lleva los conocidos.
  {
    id: "cohere",
    name: "Cohere",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    keyUrl: "https://dashboard.cohere.com/api-keys",
    dataNote: "Clave de prueba gratis y sin tarjeta: unas 1.000 peticiones al mes (20 por minuto). Pensada para uso personal, no comercial.",
    fallbackModels: ["command-a-plus-05-2026", "command-a-03-2025"],
    prefer: ["^command-a-plus", "^command-a-\\d", "^command-r-plus"],
    maxOutput: 8000,
  },
  // NVIDIA Build (NIM): gratis y sin tarjeta, unas 40 peticiones por minuto, con decenas de modelos grandes (DeepSeek, Mistral Large, GLM, Llama…).
  {
    id: "nvidia",
    name: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyUrl: "https://build.nvidia.com/settings/api-keys",
    dataNote: "Gratis y sin tarjeta (cuenta de NVIDIA Developer): unas 40 peticiones por minuto. Revisa sus condiciones sobre el uso de datos.",
    fallbackModels: ["deepseek-ai/deepseek-v4.1-flash", "mistralai/mistral-large-2-instruct", "meta/llama-3.3-70b-instruct"],
    prefer: ["deepseek-v4[.\\d]*-flash", "llama-3\\.3-70b-instruct", "qwen[^/]*coder", "mistral-large-2", "glm-5", "deepseek-v4"],
  },
];

/** Tope general de tokens de respuesta (una web completa con su vista previa cabe de sobra). */
export const MAX_OUTPUT_TOKENS = 16000;

/**
 * `maxRequest`: tokens por petición (entrada + respuesta) que admite como mucho este motor; lo aprende de un «demasiado grande».
 * `alt`: otro modelo del mismo proveedor que responde mientras el elegido está saturado o sin cuota (hasta `until`; después se
 * vuelve a probar el elegido).
 */
export type EngineState = { key?: string; enabled: boolean; model?: string; cooldownUntil: number; reason: string; day: string; used: number; lastOk: number; maxRequest?: number; alt?: { model: string; until: number }; bad?: string[] };
export type EnginesFile = { version: 1; master: boolean; mode: "calidad" | "ahorro"; dailyCap: number; engines: Record<string, EngineState> };

const DAY = 24 * 60 * 60 * 1000;
export const todayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

export function defaultState(): EnginesFile {
  return { version: 1, master: false, mode: "calidad", dailyCap: 150, engines: {} };
}

const blank = (): EngineState => ({ enabled: true, cooldownUntil: 0, reason: "", day: "", used: 0, lastOk: 0 });

function sanitize(raw: unknown): EnginesFile {
  const out = defaultState();
  if (!raw || typeof raw !== "object") return out;
  const data = raw as Partial<EnginesFile>;
  out.master = data.master === true;
  out.mode = data.mode === "ahorro" ? "ahorro" : "calidad";
  out.dailyCap = typeof data.dailyCap === "number" && data.dailyCap >= 1 && data.dailyCap <= 5000 ? Math.floor(data.dailyCap) : 150;
  for (const provider of PROVIDERS) {
    const entry = (data.engines ?? {})[provider.id] as Partial<EngineState> | undefined;
    if (!entry) continue;
    out.engines[provider.id] = {
      ...blank(),
      ...(typeof entry.key === "string" && entry.key ? { key: entry.key } : {}),
      enabled: entry.enabled !== false,
      ...(typeof entry.model === "string" && entry.model ? { model: entry.model } : {}),
      cooldownUntil: Number(entry.cooldownUntil) || 0,
      reason: typeof entry.reason === "string" ? entry.reason.slice(0, 200) : "",
      day: typeof entry.day === "string" ? entry.day : "",
      used: Number(entry.used) || 0,
      lastOk: Number(entry.lastOk) || 0,
      ...(Number(entry.maxRequest) >= 500 ? { maxRequest: Math.floor(Number(entry.maxRequest)) } : {}),
      ...(entry.alt && typeof entry.alt.model === "string" && entry.alt.model && Number(entry.alt.until) > 0 ? { alt: { model: entry.alt.model, until: Number(entry.alt.until) } } : {}),
      ...(Array.isArray(entry.bad) ? { bad: entry.bad.filter((m): m is string => typeof m === "string" && Boolean(m)).slice(-12) } : {}),
    };
  }
  return out;
}

const FILE = "motores.json";

export async function loadState(dir: string): Promise<EnginesFile> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  try {
    return sanitize(JSON.parse(await fs.readFile(path.join(dir, FILE), "utf8")));
  } catch {
    return defaultState();
  }
}

export async function saveState(dir: string, state: EnginesFile): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, FILE);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
  await fs.chmod(target, 0o600).catch(() => undefined);
}

/** Registro de cada llamada a una IA externa (datos-privados/motores-registro.jsonl): motor, modelo, tamaño, tiempo y resultado. Nunca la clave ni el texto. */
const LOG_FILE = "motores-registro.jsonl";
const LOG_MAX_BYTES = 400_000;
export type CallLog = { at: string; id: string; model: string; promptTokens: number; maxTokens: number; ms: number; ok: boolean; status?: number; kind?: string; error?: string; tries?: string[] };
export async function logCall(dir: string, entry: CallLog): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const target = path.join(dir, LOG_FILE);
    await fs.appendFile(target, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
    const size = (await fs.stat(target)).size;
    if (size > LOG_MAX_BYTES) {
      const lines = (await fs.readFile(target, "utf8")).split("\n");
      await fs.writeFile(target, `${lines.slice(Math.floor(lines.length / 2)).join("\n").trimEnd()}\n`, { encoding: "utf8", mode: 0o600 });
    }
  } catch {
    /* el registro nunca impide contestar */
  }
}

/** Las últimas llamadas registradas (para la pantalla de motores y para diagnosticar), la más reciente primero. */
export async function recentCalls(dir: string, limit = 40): Promise<CallLog[]> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const text = await fs.readFile(path.join(dir, LOG_FILE), "utf8");
    return text.trim().split("\n").filter(Boolean).slice(-limit).reverse().map((line) => JSON.parse(line) as CallLog);
  } catch {
    return [];
  }
}

export type PublicEngine = { id: string; name: string; hasKey: boolean; last4: string; enabled: boolean; model: string; available: boolean; reason: string; cooldownUntil: number; used: number; cap: number; keyUrl: string; dataNote: string };
export type PublicStatus = { master: boolean; mode: "calidad" | "ahorro"; dailyCap: number; engines: PublicEngine[] };

export function availability(state: EnginesFile, id: string, now: number): { ok: boolean; reason: string } {
  const engine = state.engines[id];
  if (!state.master) return { ok: false, reason: "El uso de motores externos está desactivado." };
  if (!engine?.key) return { ok: false, reason: "Sin clave." };
  if (!engine.enabled) return { ok: false, reason: "Desactivado." };
  if (now < engine.cooldownUntil) return { ok: false, reason: engine.reason || "En espera." };
  const used = engine.day === todayOf(now) ? engine.used : 0;
  if (used >= state.dailyCap) return { ok: false, reason: `Límite diario de seguridad (${state.dailyCap} peticiones) alcanzado.` };
  return { ok: true, reason: "" };
}

/** Lo que ve la pantalla: NUNCA incluye la clave completa (solo las 4 últimas cifras). */
export function publicStatus(state: EnginesFile, now: number, providers: Provider[] = PROVIDERS): PublicStatus {
  return {
    master: state.master,
    mode: state.mode,
    dailyCap: state.dailyCap,
    engines: providers.map((provider) => {
      const engine = state.engines[provider.id];
      const av = availability(state, provider.id, now);
      const canUse = !!engine?.key && engine.enabled;
      return {
        id: provider.id,
        name: provider.name,
        hasKey: !!engine?.key,
        last4: engine?.key ? engine.key.slice(-4) : "",
        enabled: engine?.enabled !== false,
        model: engine?.model ?? "",
        available: av.ok,
        reason: canUse && state.master ? av.reason : canUse ? "" : engine?.key ? "Desactivado." : "",
        cooldownUntil: engine && now < engine.cooldownUntil ? engine.cooldownUntil : 0,
        used: engine && engine.day === todayOf(now) ? engine.used : 0,
        cap: state.dailyCap,
        keyUrl: provider.keyUrl,
        dataNote: provider.dataNote,
      };
    }),
  };
}

export type FailureKind = "quota-minute" | "quota-day" | "auth" | "payment" | "model" | "transient" | "empty" | "too-large" | "other";
export type Failure = { kind: FailureKind; cooldownMs: number; message: string };

/** Interpreta el error de un proveedor: cuánto esperar y por qué. Es lo que detecta «se acabó lo gratis» y «vuelve a estar disponible». */
export function classifyFailure(status: number, body: string, retryAfterHeader: string | null, now: number): Failure {
  const text = body.toLowerCase();
  const retryHeader = retryAfterHeader && /^\d+(\.\d+)?$/.test(retryAfterHeader.trim()) ? Number(retryAfterHeader) : null;
  const retryBody = /retry(?:ing)?(?: in|after)?[^0-9]{0,12}([\d.]+)\s*s/.exec(text)?.[1] ?? /"retrydelay"\s*:\s*"([\d.]+)s"/.exec(text)?.[1];
  const retrySec = retryHeader ?? (retryBody ? Number(retryBody) : null);
  if (status === 402 || /payment required|requires? (?:a )?(?:paid|billing)|insufficient (?:credit|fund|balance)|add credits|billing (?:is )?(?:not )?(?:enabled|required)/.test(text)) {
    return { kind: "payment", cooldownMs: DAY, message: "Pide pago o créditos. WILLY lo deja de lado y lo vuelve a probar dentro de 24 horas." };
  }
  if (status === 401 || (status === 403 && /api key|api_key|permission|denied|forbidden|invalid|unauthor/.test(text))) {
    return { kind: "auth", cooldownMs: DAY, message: "Rechaza la clave (inválida, sin permiso o proyecto denegado). Revisa la clave." };
  }
  // La PETICIÓN no cabe en este motor (25/09/2026: Groq gratis respondía 413 «Request too large … tokens per minute (TPM):
  // Limit 8000, Requested 19234» a cada encargo de SUPER WILLY y se quedaba 5 minutos en espera para todo, también para lo
  // pequeño). El motor está bien: sin espera, y el relevo pasa al siguiente motor.
  if (status === 413 || /request (?:entity )?too large|request_too_large|context[_ ]length|maximum context|context window|prompt is too long|input is too long|reduce (?:the length|your message size)/.test(text)) {
    return { kind: "too-large", cooldownMs: 0, message: "La petición es demasiado grande para este motor en su nivel gratuito: WILLY pasa a otro." };
  }
  if (status === 429) {
    // Cuota MENSUAL (p. ej. la clave de prueba de Cohere: «1000 API calls / month»): se vuelve a probar una vez al día, no cada pocos minutos.
    if (/\/ ?month|per ?month|monthly|al mes/.test(text)) {
      return { kind: "quota-day", cooldownMs: DAY, message: "Se agotó la cuota gratuita del mes. WILLY la vuelve a probar mañana." };
    }
    const perDay = /per ?day|daily|\brpd\b|\btpd\b|requests per day|tokens per day|quota exceeded for quota metric[^"]*day|limit: 0|free_tier_requests/.test(text);
    if (perDay) {
      const midnight = Math.ceil((now + 1) / DAY) * DAY + 5 * 60_000;
      return { kind: "quota-day", cooldownMs: Math.max(15 * 60_000, Math.min(midnight - now, DAY)), message: "Se agotó la cuota gratuita del día. WILLY lo reintenta más tarde, cuando se renueve." };
    }
    return { kind: "quota-minute", cooldownMs: Math.min(15 * 60_000, Math.max(10_000, Math.round((retrySec ?? 65) * 1000))), message: "Demasiadas peticiones por minuto. WILLY espera y sigue con otro motor." };
  }
  // También el «Function '…': Not found for account» de NVIDIA: el modelo está en su lista pero no para esta cuenta.
  if ((status === 404 || status === 400) && (/model/.test(text) || /function '[^']*': not found|not found for account/.test(text)) && /(not found|does not exist|unsupported|decommission|deprecat|not available|invalid model|no longer)/.test(text)) {
    return { kind: "model", cooldownMs: 0, message: "El modelo elegido ya no está disponible. WILLY buscará otro." };
  }
  if (status === 0 || status === 408 || status >= 500) return { kind: "transient", cooldownMs: 2 * 60_000, message: "El servicio no responde ahora mismo. WILLY lo reintenta en unos minutos." };
  return { kind: "other", cooldownMs: 5 * 60_000, message: `Error inesperado (${status}).` };
}

const NOT_CHAT = /(embed|whisper|tts|guard|moderat|rerank|imagen|image|veo|audio|transcri|realtime|dall|safeguard|orpheus|playai|speech|lyria|robotics|computer-use|aqa)/i;

function scoreModel(provider: ProviderId, id: string): number {
  const name = id.toLowerCase();
  let score = 0;
  if (/coder|codestral|devstral/.test(name)) score += 4;
  const size = /(\d{1,3})b(?![a-z])/.exec(name)?.[1];
  if (size) score += Math.min(6, Math.max(0, Math.log2(Number(size) / 7)));
  if (/(large|maverick|opus|405b|235b|120b)/.test(name)) score += 2;
  // Como palabra suelta: «gemini» lleva dentro «mini» y todos los Gemini salían penalizados (también contra sus versiones «lite»).
  if (/(?:^|[-_/.:])(?:mini|nano|lite|small|tiny|instant|1b|3b|8b)(?=$|[-_/.:])/.test(name)) score -= 2;
  if (/preview|exp(?:erimental)?\b/.test(name)) score -= 0.5;
  if (provider === "gemini") {
    if (/flash/.test(name)) score += 3;
    const version = /gemini-(\d+(?:\.\d+)?)/.exec(name)?.[1];
    if (version) score += Number(version) * 0.6;
  }
  return score;
}

/** Elige el mejor modelo de la lista de un proveedor (sin modelos de pago ni que no sean de conversación). */
export function pickModel(provider: Provider, ids: string[]): string | null {
  return rankModels(provider, ids)[0] ?? null;
}

/** Los modelos de conversación de un proveedor, del mejor al peor (el primero es el que elige `pickModel`). */
export function rankModels(provider: Provider, ids: string[]): string[] {
  const usable = [...new Set(ids
    .map((id) => id.replace(/^models\//, ""))
    .filter((id) => !NOT_CHAT.test(id))
    .filter((id) => !provider.onlyModelSuffix || id.endsWith(provider.onlyModelSuffix))
    .filter((id) => !(provider.id === "gemini" && /-pro(?![a-z])/.test(id.toLowerCase()))))];
  if (!usable.length) return [];
  // Los preferidos del proveedor (si los tiene) van por delante; entre el resto, la puntuación general.
  const prefer = (id: string): number => {
    const at = (provider.prefer ?? []).findIndex((pattern) => new RegExp(pattern, "i").test(id));
    return at < 0 ? 0 : 50 - at * 5;
  };
  const score = (id: string) => scoreModel(provider.id, id) + prefer(id);
  return [...usable].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

/** Tiempo que se usa otro modelo cuando el elegido está saturado (después se vuelve a probar el elegido). */
const ALT_MS = 6 * 60 * 60 * 1000;

/**
 * ¿El fallo es del MODELO y no del motor? Saturado («high demand», «overloaded»…) o, en Gemini, sin cuota (allí la cuota gratuita
 * es de cada modelo). Entonces vale la pena probar otro modelo del mismo proveedor.
 */
export function canTryAnotherModel(provider: ProviderId, status: number, body: string): boolean {
  if ((status === 503 || status === 529 || status === 500) && /high demand|overload|over capacity|no capacity|unavailable|try again later/i.test(body)) return true;
  return provider === "gemini" && status === 429;
}

type FetchLike = typeof fetch;
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const scrub = (text: string, key: string | undefined): string => {
  let out = text;
  if (key) out = out.split(key).join("***");
  return out.replace(/\s+/g, " ").trim().slice(0, 300);
};

async function listModels(provider: Provider, key: string, fetchImpl: FetchLike): Promise<{ ok: true; ids: string[] } | { ok: false; status: number; body: string; retryAfter: string | null }> {
  try {
    const res = await fetchImpl(`${provider.baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    // Sin lista de modelos en su API compatible (404/405): se usan los modelos conocidos de ese proveedor.
    if (!res.ok && provider.fallbackModels?.length && (res.status === 404 || res.status === 405)) return { ok: true, ids: provider.fallbackModels };
    if (!res.ok) return { ok: false, status: res.status, body: text, retryAfter: res.headers.get("retry-after") };
    let ids: string[];
    try {
      const parsed = JSON.parse(text) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> };
      ids = [...(parsed.data ?? []).map((entry) => String(entry.id ?? "")), ...(parsed.models ?? []).map((entry) => String(entry.name ?? ""))].filter(Boolean);
    } catch (error) {
      if (!provider.fallbackModels?.length) throw error;
      ids = [];
    }
    return { ok: true, ids: ids.length || !provider.fallbackModels?.length ? ids : provider.fallbackModels };
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error), retryAfter: null };
  }
}

export type CallResult =
  | { ok: true; data: string; model: string; engine: string }
  | { ok: false; kind: FailureKind | "unavailable"; error: string; retryAt?: number };

type Env = { dir: string; fetchImpl?: FetchLike; now?: () => number; providers?: Provider[] };

/** Tokens aproximados de unos mensajes, por lo alto (unos 3 caracteres por token en español y en código). */
export function estimateTokens(messages: ReadonlyArray<{ content: string }>): number {
  return Math.ceil(messages.reduce((sum, m) => sum + m.content.length + 12, 0) / 3);
}

/** Lo que admite como mucho un motor por petición, según su «demasiado grande» («Limit 8000, Requested 19234»); sin cifra, menos que esta. */
export function learnedLimit(body: string, requested: number): number {
  const n = Number(/\blimit\b[^0-9]{0,12}(\d{3,7})/i.exec(body)?.[1] ?? NaN);
  if (Number.isFinite(n) && n >= 500) return Math.floor(n);
  return Math.max(500, Math.floor(requested) - 1);
}

async function markFailure(dir: string, id: string, failure: Failure, now: number, clearModel: boolean, maxRequest?: number, dropAlt = false): Promise<void> {
  const state = await loadState(dir);
  const engine = state.engines[id];
  if (!engine) return;
  engine.cooldownUntil = failure.cooldownMs > 0 ? now + failure.cooldownMs : 0;
  engine.reason = failure.message;
  if (clearModel) { delete engine.model; delete engine.maxRequest; }
  if (dropAlt || clearModel) delete engine.alt;
  if (maxRequest !== undefined) engine.maxRequest = maxRequest;
  await saveState(dir, state);
}

/** Apunta un modelo que el proveedor no tiene de verdad (404), para no volver a elegirlo. */
async function rememberBad(dir: string, id: string, model: string): Promise<void> {
  const state = await loadState(dir);
  const engine = state.engines[id];
  if (!engine || (engine.bad ?? []).includes(model)) return;
  engine.bad = [...(engine.bad ?? []), model].slice(-12);
  await saveState(dir, state);
}

/** Deja apuntado el modelo que sustituye al elegido hasta `until`. */
async function setAlt(dir: string, id: string, model: string, until: number): Promise<void> {
  const state = await loadState(dir);
  const engine = state.engines[id];
  if (!engine) return;
  engine.alt = { model, until };
  await saveState(dir, state);
}

/** Una petición de conversación a un motor. Aplica las esperas y los límites, y anota el resultado. */
export async function callEngine(env: Env, id: string, messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number; compact?: ChatMessage[] } = {}): Promise<CallResult> {
  const now = (env.now ?? Date.now)();
  const provider = (env.providers ?? PROVIDERS).find((p) => p.id === id);
  if (!provider) return { ok: false, kind: "other", error: "Motor desconocido." };
  const fetchImpl = env.fetchImpl ?? fetch;
  let state = await loadState(env.dir);
  const av = availability(state, id, now);
  if (!av.ok) return { ok: false, kind: "unavailable", error: av.reason };
  const engine = state.engines[id]!;
  const key = engine.key!;

  // Si el modelo elegido estaba saturado hace poco, sigue respondiendo el que lo sustituyó (hasta que caduque).
  const altActive = engine.alt && engine.alt.until > now ? engine.alt.model : undefined;
  let model = altActive ?? engine.model;
  if (!model) {
    const listed = await listModels(provider, key, fetchImpl);
    if (!listed.ok) {
      const failure = classifyFailure(listed.status, listed.body, listed.retryAfter, now);
      await markFailure(env.dir, id, failure, now, false);
      return { ok: false, kind: failure.kind, error: `${failure.message} (${scrub(listed.body, key)})`, retryAt: now + failure.cooldownMs };
    }
    const picked = pickModel(provider, listed.ids.filter((m) => !(engine.bad ?? []).includes(m.replace(/^models\//, ""))));
    if (!picked) {
      const failure: Failure = { kind: "model", cooldownMs: 10 * 60_000, message: "No hay ningún modelo gratuito de conversación disponible con esta clave." };
      await markFailure(env.dir, id, failure, now, false);
      return { ok: false, kind: "model", error: failure.message, retryAt: now + failure.cooldownMs };
    }
    model = picked;
    state = await loadState(env.dir);
    if (state.engines[id]) {
      state.engines[id]!.model = model;
      await saveState(env.dir, state);
    }
  }

  let status = 0;
  let body = "";
  let retryAfter: string | null = null;
  const startedAt = Date.now();
  const tries: string[] = [];
  // Webs completas y respuestas largas: se pide el tope que admita el proveedor (nunca más de lo que soporta) y se da tiempo.
  let wanted = Math.min(opts.maxTokens ?? 6000, provider.maxOutput ?? MAX_OUTPUT_TOKENS);
  // Lo que ya se sabe que no cabe en este motor (entrada + respuesta) no se envía: si queda sitio de sobra se pide una
  // respuesta más corta; si no, se contesta «demasiado grande» sin gastar una petición ni dejar el motor en espera.
  let promptTokens = estimateTokens(messages);
  const cap = engine.maxRequest;
  if (cap && promptTokens + wanted > cap) {
    const room = cap - promptTokens - 256;
    if (room >= 1500) wanted = room;
    else {
      void logCall(env.dir, { at: new Date(now).toISOString(), id, model: model ?? "", promptTokens, maxTokens: wanted, ms: 0, ok: false, kind: "too-large", error: `no cabe: admite ${cap}` });
      return { ok: false, kind: "too-large", error: `La petición (unos ${promptTokens.toLocaleString("es-ES")} tokens) no cabe en ${provider.name}: en su nivel gratuito admite unos ${cap.toLocaleString("es-ES")} por petición. WILLY pasa a otro motor.` };
    }
  }
  let sent = messages;
  const request = async (maxTokens: number) => {
    try {
      const res = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(provider.id === "openrouter" ? { "HTTP-Referer": "http://localhost:3000", "X-Title": "WILLY AI" } : {}) },
        body: JSON.stringify({ model, messages: sent, max_tokens: maxTokens, temperature: opts.temperature ?? 0.2, stream: false }),
        signal: AbortSignal.timeout(280_000),
      });
      status = res.status;
      body = await res.text();
      retryAfter = res.headers.get("retry-after");
    } catch (error) {
      status = 0;
      body = error instanceof Error ? error.message : String(error);
    }
    tries.push(`${model} ${status || "sin respuesta"} ${Math.round((Date.now() - startedAt) / 1000)}s`);
  };
  await request(wanted);
  // Si el proveedor rechaza el tope pedido («max_tokens too large…»), se repite una vez con el tope clásico.
  if (status === 400 && wanted > 4096 && /max_tokens|max_completion_tokens|output tokens|maximum.*tokens|too (?:large|many) tokens|exceeds/i.test(body)) await request(4096);

  // 25/09/2026 · Google respondía 503 «This model is currently experiencing high demand» a CADA petición a gemini-3.8-flash desde
  // hacía dos días, y WILLY dejaba fuera a Gemini (el mejor gratuito) y construía con motores peores. Si el MODELO está saturado
  // (o, en Gemini, sin cuota), se prueban hasta dos modelos más del mismo proveedor, del mejor al peor; el que responda se queda
  // unas horas en su lugar. Si ninguno responde, cuenta el fallo del modelo elegido.
  let switched: string | null = null;
  if (canTryAnotherModel(provider.id, status, body)) {
    const first = { model, status, body, retryAfter };
    const listed = await listModels(provider, key, fetchImpl);
    const others = listed.ok ? rankModels(provider, listed.ids).filter((m) => m !== first.model && !(engine.bad ?? []).includes(m)).slice(0, 2) : [];
    for (const other of others) {
      model = other;
      await request(wanted);
      if (status >= 200 && status < 300) { switched = other; break; }
      if (!canTryAnotherModel(provider.id, status, body)) break;
    }
    if (!switched) ({ model, status, body, retryAfter } = first);
  }
  // (25/09/2026) Google contesta 503 «high demand» mucho más con peticiones grandes (26.000 tokens: 3 modelos saturados; 11.500:
  // responde). Si el que pide trae una versión COMPACTA de la misma petición (menos archivos y menos historial), se prueba una
  // vez con ella en el mejor modelo antes de dar el motor por saturado.
  if (!(status >= 200 && status < 300) && opts.compact?.length && promptTokens > 12_000 && (canTryAnotherModel(provider.id, status, body) || status === 413)) {
    const compactTokens = estimateTokens(opts.compact);
    if (compactTokens < promptTokens * 0.8) {
      sent = opts.compact;
      promptTokens = compactTokens;
      model = altActive ?? engine.model ?? model;
      tries.push(`compacta (${compactTokens} tokens)`);
      await request(wanted);
    }
  }

  if (status >= 200 && status < 300) {
    let content = "";
    try {
      const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> };
      const raw = parsed.choices?.[0]?.message?.content;
      content = typeof raw === "string" ? raw : "";
    } catch {
      /* respuesta ilegible */
    }
    if (!content.trim()) {
      // Vacío: se olvida el modelo elegido para que la próxima vez se elija otro (nemotron en OpenRouter contestaba vacío siempre).
      const failure: Failure = { kind: "empty", cooldownMs: 60_000, message: "Respondió vacío." };
      await markFailure(env.dir, id, failure, now, true);
      await rememberBad(env.dir, id, model);
      void logCall(env.dir, { at: new Date(now).toISOString(), id, model, promptTokens, maxTokens: wanted, ms: Date.now() - startedAt, ok: false, status, kind: "empty", tries });
      return { ok: false, kind: "empty", error: failure.message, retryAt: now + failure.cooldownMs };
    }
    void logCall(env.dir, { at: new Date(now).toISOString(), id, model, promptTokens, maxTokens: wanted, ms: Date.now() - startedAt, ok: true, status, ...(tries.length > 1 ? { tries } : {}) });
    state = await loadState(env.dir);
    const current = state.engines[id];
    if (current) {
      const today = todayOf(now);
      current.used = (current.day === today ? current.used : 0) + 1;
      current.day = today;
      current.lastOk = now;
      current.cooldownUntil = 0;
      current.reason = "";
      if (switched && switched !== current.model) current.alt = { model: switched, until: now + ALT_MS };
      else if (switched || !altActive) delete current.alt;
      await saveState(env.dir, state);
    }
    return { ok: true, data: content, model, engine: provider.name };
  }
  const failure = classifyFailure(status, body, retryAfter, now);
  const learned = failure.kind === "too-large" ? Math.min(engine.maxRequest ?? Number.MAX_SAFE_INTEGER, learnedLimit(body, promptTokens + wanted)) : undefined;
  // Si fallaba el modelo que sustituía al elegido, se deja de usar (la próxima vez se prueba otra vez el elegido).
  const altFailed = Boolean(altActive) && model === altActive;
  await markFailure(env.dir, id, failure, now, failure.kind === "model" && !altFailed, learned, altFailed);
  // Un modelo que este proveedor dice no tener (404) no se vuelve a elegir como sustituto.
  if (failure.kind === "model") await rememberBad(env.dir, id, model);
  // (25/09/2026) El modelo no ha contestado a tiempo (NVIDIA · deepseek tardó más de 280 s con una web entera): la próxima vez
  // responde otro modelo del mismo proveedor, sin gastar más tiempo ahora. Si ese también tarda, se pasa al siguiente.
  if (status === 0 && /timeout|abort/i.test(body)) {
    const listed = await listModels(provider, key, fetchImpl).catch(() => ({ ok: false as const, status: 0, body: "", retryAfter: null }));
    const next = listed.ok ? rankModels(provider, listed.ids).find((m) => m !== model && m !== altActive && !(engine.bad ?? []).includes(m)) : undefined;
    if (next) await setAlt(env.dir, id, next, now + ALT_MS);
  }
  void logCall(env.dir, { at: new Date(now).toISOString(), id, model, promptTokens, maxTokens: wanted, ms: Date.now() - startedAt, ok: false, status, kind: failure.kind, error: scrub(body, key).slice(0, 200), tries });
  return { ok: false, kind: failure.kind, error: `${failure.message} (${scrub(body, key)})`, retryAt: failure.cooldownMs ? now + failure.cooldownMs : now };
}

/** Comprueba una clave: pide la lista de modelos y elige uno. No gasta cuota de conversación. */
export async function testEngine(env: Env, id: string): Promise<{ ok: true; model: string; count: number } | { ok: false; error: string }> {
  const now = (env.now ?? Date.now)();
  const provider = (env.providers ?? PROVIDERS).find((p) => p.id === id);
  const state = await loadState(env.dir);
  const key = state.engines[id]?.key;
  if (!provider || !key) return { ok: false, error: "Guarda primero la clave de este motor." };
  const listed = await listModels(provider, key, env.fetchImpl ?? fetch);
  if (!listed.ok) {
    const failure = classifyFailure(listed.status, listed.body, listed.retryAfter, now);
    await markFailure(env.dir, id, failure, now, false);
    return { ok: false, error: `${failure.message} (${scrub(listed.body, key)})` };
  }
  const model = pickModel(provider, listed.ids);
  if (!model) return { ok: false, error: "La clave es válida, pero no hay ningún modelo gratuito de conversación disponible." };
  const fresh = await loadState(env.dir);
  if (fresh.engines[id]) {
    fresh.engines[id]!.model = model;
    fresh.engines[id]!.cooldownUntil = 0;
    fresh.engines[id]!.reason = "";
    await saveState(env.dir, fresh);
  }
  return { ok: true, model, count: listed.ids.length };
}

type Body = Record<string, unknown>;

/** Todas las acciones de motores, para que la ruta solo tenga que reenviarlas. */
export async function engineAction(dir: string, body: Body, env: Partial<Env> = {}): Promise<Record<string, unknown>> {
  const full: Env = { dir, ...env };
  const now = (env.now ?? Date.now)();
  const providers = env.providers ?? PROVIDERS;
  const knows = (id: unknown): id is string => typeof id === "string" && providers.some((p) => p.id === id);
  const action = String(body["action"] ?? "");
  const state = await loadState(dir);
  if (action === "engines-status") return { ok: true, status: publicStatus(state, now, providers) };
  if (action === "engines-log") return { ok: true, calls: await recentCalls(dir, Math.min(200, Math.max(1, Number(body["limit"]) || 40))) };
  if (action === "engines-master") {
    state.master = body["on"] === true;
    await saveState(dir, state);
    return { ok: true, status: publicStatus(state, now, providers) };
  }
  if (action === "engines-mode") {
    state.mode = body["mode"] === "ahorro" ? "ahorro" : "calidad";
    await saveState(dir, state);
    return { ok: true, status: publicStatus(state, now, providers) };
  }
  if (action === "engines-save-key" || action === "engines-remove-key" || action === "engines-enable" || action === "engines-test") {
    const id = body["id"];
    if (!knows(id)) return { ok: false, error: "Motor desconocido." };
    if (action === "engines-save-key") {
      const key = String(body["key"] ?? "").trim();
      if (key.length < 10 || key.length > 400 || /\s/.test(key)) return { ok: false, error: "La clave no parece válida (no debe llevar espacios)." };
      state.engines[id] = { ...blank(), ...(state.engines[id] ?? {}), key, cooldownUntil: 0, reason: "" };
      delete state.engines[id]!.model;
      await saveState(dir, state);
      return { ok: true, status: publicStatus(state, now, providers) };
    }
    if (action === "engines-remove-key") {
      delete state.engines[id];
      await saveState(dir, state);
      return { ok: true, status: publicStatus(state, now, providers) };
    }
    if (action === "engines-enable") {
      if (!state.engines[id]) return { ok: false, error: "Guarda primero la clave de este motor." };
      state.engines[id]!.enabled = body["on"] !== false;
      await saveState(dir, state);
      return { ok: true, status: publicStatus(state, now, providers) };
    }
    const tested = await testEngine(full, id);
    return { ...tested, status: publicStatus(await loadState(dir), now, providers) };
  }
  if (action === "cloud-chat") {
    const id = body["id"];
    if (!knows(id)) return { ok: false, kind: "other", error: "Motor desconocido." };
    const raw = Array.isArray(body["messages"]) ? (body["messages"] as Array<{ role?: unknown; content?: unknown }>) : [];
    const messages: ChatMessage[] = raw
      .map((m) => ({ role: (m.role === "system" || m.role === "assistant" ? m.role : "user") as ChatMessage["role"], content: String(m.content ?? "") }))
      .filter((m) => m.content.trim());
    if (!messages.length || messages.reduce((sum, m) => sum + m.content.length, 0) > 300_000) return { ok: false, kind: "other", error: "Mensajes vacíos o demasiado grandes." };
    const maxTokens = Math.min(MAX_OUTPUT_TOKENS, Math.max(200, Number(body["maxTokens"]) || 6000));
    const temperature = typeof body["temperature"] === "number" && Number.isFinite(body["temperature"]) ? Math.min(1.5, Math.max(0, body["temperature"])) : undefined;
    const rawCompact = Array.isArray(body["compact"]) ? (body["compact"] as Array<{ role?: unknown; content?: unknown }>) : [];
    const compact: ChatMessage[] = rawCompact
      .map((m) => ({ role: (m.role === "system" || m.role === "assistant" ? m.role : "user") as ChatMessage["role"], content: String(m.content ?? "") }))
      .filter((m) => m.content.trim());
    const result = await callEngine(full, id, messages, { maxTokens, ...(temperature !== undefined ? { temperature } : {}), ...(compact.length ? { compact } : {}) });
    return { ...result };
  }
  return { ok: false, error: "Acción de motores desconocida." };
}
