// Hablar desde los chats con las IA externas que tengas configuradas (Groq, Gemini, NVIDIA, Mistral, OpenRouter, Cohere).
// Regla de oro: NUNCA por sorpresa. Solo si eliges «IA externa» en el chat (por defecto siempre es tu IA local) y solo si el
// interruptor general de motores externos está activado. Si una externa falla o se le acaba lo gratis, se pasa sola a la
// siguiente que hayas marcado y, al final, a tu IA local. Las que se quedaron sin cuota vuelven solas cuando se renueva.

import type { PublicEngine, PublicStatus } from "@/lib/engines-server";
import { looksSensitive, smartPlan } from "@/lib/auto-engine";
import { CHAT_ORDER } from "@/lib/routing-table";

export const CHAT_ENGINE_KEY = "willy-motor-chat";
/** Qué IA externas ha marcado el dueño, en su orden de preferencia (lista JSON de ids). Sin elegir = todas las que tienen clave. */
export const CHAT_EXTERNAS_KEY = "willy-ia-externas";
/** Orden de prueba por defecto: primero las más rápidas y fiables para conversar (vive en la tabla única routing-table.ts). */
export { CHAT_ORDER };

/** Aviso interno: ha cambiado con qué IA se habla (Este equipo / IA externa y cuáles). Todos los botones se ponen al día. */
export const CHAT_PICK_EVENT = "willy:ia-externa";
/** Aviso interno: una IA externa acaba de contestar o de fallar; su estado (lista / sin cuota gratis) puede haber cambiado. */
export const CHAT_STATUS_EVENT = "willy:ia-externa-estado";

export type Msg = { role: "system" | "user" | "assistant"; content: string };
export type AskResult = { ok: true; data: string; model: string; engine: string } | { ok: false; error: string; kind?: string };

type Reader = Pick<Storage, "getItem"> | null;
const browserStorage = (): Storage | null => (typeof window === "undefined" ? null : window.localStorage);
const announce = (name: string) => { if (typeof window !== "undefined") window.dispatchEvent(new Event(name)); };

export function readChatPick(storage: Reader = browserStorage()): string {
  try { return storage?.getItem(CHAT_ENGINE_KEY) || "local"; } catch { return "local"; }
}

/** Guarda con qué IA se habla («local», «externas», «smart» o una concreta) y avisa a todos los botones (arriba, abajo, móvil…). */
export function writeChatPick(id: string, storage: Pick<Storage, "setItem"> | null = browserStorage()): void {
  try { storage?.setItem(CHAT_ENGINE_KEY, id); } catch { /* sin guardado */ }
  announce(CHAT_PICK_EVENT);
}

/** Las IA externas marcadas por el dueño (en su orden), o null si nunca eligió (entonces valen todas las que tienen clave). */
export function readChosenExternal(storage: Reader = browserStorage()): string[] | null {
  try {
    const raw = storage?.getItem(CHAT_EXTERNAS_KEY);
    if (!raw) return null;
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export function writeChosenExternal(ids: string[], storage: Pick<Storage, "setItem"> | null = browserStorage()): void {
  try { storage?.setItem(CHAT_EXTERNAS_KEY, JSON.stringify(ids)); } catch { /* sin guardado */ }
}

const rank = (id: string) => { const at = CHAT_ORDER.indexOf(id); return at < 0 ? 99 : at; };

/** Las IA con clave, en el orden en que se probarán: primero las marcadas (en su orden) y luego el resto. */
export function externalOrder(status: PublicStatus | null, chosen: string[] | null): { order: string[]; checked: Set<string> } {
  const withKey = (status?.engines ?? []).filter((e) => e.hasKey).map((e) => e.id).sort((a, b) => rank(a) - rank(b));
  const picked = (chosen ?? withKey).filter((id) => withKey.includes(id));
  return { order: [...picked, ...withKey.filter((id) => !picked.includes(id))], checked: new Set(picked) };
}

const SHORT_NAMES: Record<string, string> = { groq: "Groq", gemini: "Gemini", nvidia: "NVIDIA", mistral: "Mistral", openrouter: "OpenRouter", cohere: "Cohere" };

/** Nombre corto para los botones: «Google Gemini» → «Gemini», «OpenRouter (modelos gratuitos)» → «OpenRouter». */
export function shortName(id: string, status: PublicStatus | null = null): string {
  const known = SHORT_NAMES[id];
  if (known) return known;
  const full = status?.engines.find((e) => e.id === id)?.name;
  return full ? full.replace(/\s*\(.*\)$/, "") : id;
}

/** Puede contestar ya: tiene clave, está encendida y no está esperando a que se renueve lo gratis. */
export function readyNow(e: PublicEngine, now = Date.now()): boolean {
  return e.hasKey && e.enabled && (e.available || (e.cooldownUntil > 0 && e.cooldownUntil <= now));
}

/**
 * Lo que dicen los botones cuando la IA externa está en uso: la que contesta AHORA (si a la primera se le acabó lo
 * gratis, la siguiente) y cuántas más hay de reserva. Ej.: «Groq +3», «Gemini +3» (Groq sin cuota), «en pausa…».
 */
export function externalSummary(status: PublicStatus | null, pick: string, chosen: string[] | null, now = Date.now()): string {
  if (pick === "local") return "";
  if (pick === "smart") return "Plug and play";
  if (pick !== "externas" && pick !== "auto") return shortName(pick, status);
  const own = pick === "auto" ? null : chosen;
  if (!status) return own?.length ? `${shortName(own[0]!)}${own.length > 1 ? ` +${own.length - 1}` : ""}` : "…";
  if (!status.master) return "desactivadas";
  const { order, checked } = externalOrder(status, own);
  const marked = order.filter((id) => checked.has(id));
  if (!marked.length) return "ninguna marcada";
  const ready = marked.find((id) => status.engines.some((e) => e.id === id && readyNow(e, now)));
  if (!ready) return "en pausa (contesta tu equipo)";
  return `${shortName(ready, status)}${marked.length > 1 ? ` +${marked.length - 1}` : ""}`;
}

/** Hora a la que vuelve una IA que se quedó sin cuota (hoy «a las 14:05», otro día «el 23/09 a las 02:00»). */
export function backAt(until: number, now = Date.now()): string {
  const d = new Date(until);
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return new Date(now).toDateString() === d.toDateString() ? `a las ${time}` : `el ${d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })} a las ${time}`;
}

/** Estado de una IA externa en palabras sencillas (para la lista del apartado «IA externa»). */
export function engineState(e: PublicEngine, now = Date.now()): { tone: "ok" | "wait" | "off" | "bad"; text: string } {
  if (!e.hasKey) return { tone: "off", text: "sin clave" };
  if (!e.enabled) return { tone: "off", text: "apagada" };
  if (e.available) return { tone: "ok", text: "lista" };
  if (e.cooldownUntil > now) {
    const quota = /cuota|límite|limite|peticiones/i.test(e.reason);
    return { tone: "wait", text: `${quota ? "sin cuota gratis" : "en espera"} · vuelve ${backAt(e.cooldownUntil, now)}` };
  }
  if (/clave|pago|créditos/i.test(e.reason)) return { tone: "bad", text: e.reason.replace(/\.$/, "") };
  return { tone: "wait", text: e.reason ? e.reason.replace(/\.$/, "") : "no disponible ahora" };
}

/** Qué motores externos se probarán, y por qué no si no se puede. */
export function chatSequence(status: PublicStatus | null, pick: string, chosen: string[] | null = null, now = Date.now()): { ids: string[]; note: string } {
  if (pick === "local") return { ids: [], note: "" };
  if (!status) return { ids: [], note: "No he podido consultar las IA externas. Contesta tu equipo." };
  if (!status.master) return { ids: [], note: "Las IA externas están desactivadas (actívalas en el botón «IA externa»). Contesta tu equipo." };
  const usable = status.engines.filter((e) => e.hasKey && e.enabled && e.available);
  if (pick === "externas" || pick === "auto") {
    // «auto» (versiones anteriores) = todas las que tienen clave, igual que «externas» sin haber elegido nada.
    const { order, checked } = externalOrder(status, pick === "auto" ? null : chosen);
    const wanted = order.filter((id) => checked.has(id));
    if (!wanted.length) return { ids: [], note: "No hay ninguna IA externa marcada (o ninguna tiene clave). Contesta tu equipo." };
    const ids = wanted.filter((id) => usable.some((e) => e.id === id));
    if (ids.length) return { ids, note: "" };
    const why = wanted.map((id) => { const e = status.engines.find((x) => x.id === id)!; return `${e.name}: ${engineState(e, now).text}`; }).join(" · ");
    return { ids: [], note: `Ninguna de tus IA externas puede contestar ahora (${why}). Contesta tu equipo; vuelven solas cuando se renueva lo gratis.` };
  }
  const one = status.engines.find((e) => e.id === pick);
  if (!one) return { ids: [], note: "Esa IA externa ya no existe. Contesta tu equipo." };
  if (!one.hasKey) return { ids: [], note: `${one.name} no tiene clave guardada. Contesta tu equipo.` };
  if (!one.enabled) return { ids: [], note: `${one.name} está apagada. Contesta tu equipo.` };
  if (!one.available) return { ids: [], note: `${one.name} no está disponible ahora (${engineState(one, now).text}). Contesta tu equipo.` };
  return { ids: [one.id], note: "" };
}

/** Motivo corto de un fallo, para decir por qué se pasa a la siguiente IA. */
function shortFailure(res: { error: string; kind?: string }): string {
  if (res.kind === "quota-day") return /mes/.test(res.error) ? "se le acabó lo gratis del mes" : "se le acabó lo gratis de hoy";
  if (res.kind === "quota-minute") return "demasiadas peticiones seguidas";
  if (res.kind === "auth") return "su clave no vale";
  if (res.kind === "payment") return "pide pago";
  if (res.kind === "transient") return "no responde ahora";
  if (res.kind === "too-large") return "la petición es demasiado grande para su nivel gratuito";
  return res.error.replace(/\s*\(.*$/s, "").slice(0, 90);
}

/**
 * Pregunta a las IA externas elegidas, en relevo: si una falla o se queda sin cuota gratis, pasa sola a la siguiente.
 * Devuelve el texto, o null para que el chat siga con tu IA local.
 */
export async function askChatCloud(o: {
  pick: string;
  messages: Msg[];
  status: () => Promise<PublicStatus | null>;
  ask: (id: string, messages: Msg[], maxTokens: number, compact?: Msg[]) => Promise<AskResult>;
  /** (25/09/2026) La misma petición con menos contexto, por si el motor rechaza la grande por saturación (Gemini con 26.000 tokens). */
  compact?: Msg[];
  notify: (text: string) => void;
  onText: (text: string) => void;
  signal?: AbortSignal;
  /** Modo «plug and play»: WILLY elige la IA según la petición. */
  smart?: { text: string; kind: string; labelOf: (kind: string) => string; hasAttachments: boolean; installed: string[]; localPlan: (kind: string) => string[] };
  /** En plug and play, el modelo local que toca para esta petición (si al final responde tu equipo). */
  onLocal?: (model: string) => void;
  /** Qué IA externa respondió de verdad (nombre del motor y modelo), para poder decírselo al dueño. */
  onAnswered?: (engine: string, model: string) => void;
  /** (25/09/2026) Una respuesta que no sirvió (por qué, y su texto) para que quede a la vista en la conversación del proyecto. */
  onRefused?: (engine: string, model: string, reason: string, text: string) => void;
  /** Las IA marcadas en el apartado «IA externa» (si falta, se leen de este navegador). */
  chosen?: string[] | null;
  /** Tope de tokens de la respuesta (por defecto 4.000; para código y webs completas, más). */
  maxTokens?: number;
  /**
   * 25/09/2026 · ¿Sirve la respuesta para lo que se pidió? Devuelve por qué no (o null si sirve). Una respuesta que no sirve
   * (p. ej. un «Reparar» que devuelve el mismo archivo roto) cuenta como un fallo de esa IA y el relevo pasa a la siguiente.
   */
  accept?: (text: string) => string | null;
}): Promise<string | null> {
  if (o.pick === "local") return null;
  const status = await o.status();
  let ids: string[];
  if (o.pick === "smart" && o.smart) {
    const plan = smartPlan({ ...o.smart, status });
    if (plan.localModel) o.onLocal?.(plan.localModel);
    o.notify(plan.why);
    if (!plan.cloudIds.length) return null;
    ids = plan.cloudIds;
  } else {
    // Lo que no debe salir de tu equipo (DNI/NIE, IBAN, tarjeta, claves, contraseñas) se queda en tu equipo aunque elijas IA externa.
    const lastUser = [...o.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const sensitive = looksSensitive(lastUser);
    if (sensitive) { o.notify(`Tu mensaje lleva ${sensitive}: se queda en tu equipo y contesta tu IA local.`); return null; }
    const plan = chatSequence(status, o.pick === "smart" ? "externas" : o.pick, o.chosen === undefined ? readChosenExternal() : o.chosen);
    if (!plan.ids.length) { if (plan.note) o.notify(plan.note); return null; }
    ids = plan.ids;
  }
  const names = new Map((status?.engines ?? []).map((e) => [e.id, e.name]));
  const failures: string[] = [];
  for (const [index, id] of ids.entries()) {
    if (o.signal?.aborted) return null;
    o.notify(`Enviando a ${names.get(id) ?? id}… (el mensaje sale de tu equipo)`);
    const res = await o.ask(id, o.messages, o.maxTokens ?? 4000, o.compact);
    // Contestó o falló: su estado (lista / sin cuota gratis) puede haber cambiado, y los botones de arriba y abajo lo reflejan.
    announce(CHAT_STATUS_EVENT);
    const refused = res.ok ? o.accept?.(res.data) ?? null : null;
    if (res.ok && refused) {
      failures.push(`${names.get(id) ?? id}: ${refused}`);
      o.onRefused?.(res.engine, res.model, refused, res.data);
      const after = ids[index + 1];
      o.notify(`${names.get(id) ?? id} ${refused}: no sirve.${after ? ` Paso sola a ${names.get(after) ?? after}…` : ""}`);
      continue;
    }
    if (res.ok) {
      o.onText(res.data);
      o.onAnswered?.(res.engine, res.model);
      o.notify(`Respuesta de ${res.engine} (${res.model}).`);
      return res.data;
    }
    const reason = shortFailure(res);
    failures.push(`${names.get(id) ?? id}: ${reason}`);
    const next = ids[index + 1];
    if (next) o.notify(`${names.get(id) ?? id}: ${reason}. Paso sola a ${names.get(next) ?? next}…`);
  }
  o.notify(`Ninguna IA externa ha podido responder (${failures.join(" · ")}). Contesta tu equipo.`);
  return null;
}
