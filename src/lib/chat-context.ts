// Memoria de contexto para el chat. Si no se pide, Ollama usa la suya por defecto (2.048–4.096 tokens) y RECORTA la petición
// en silencio: el modelo pierde su identidad, el historial o la propia pregunta y «el chat no va». Aquí se calcula la que
// hace falta según el tamaño real de la conversación, sin pasarse de lo que cabe en el equipo, y si aun así no cabe se quita
// lo más antiguo del historial (avisando de ello) en vez de dejar que se corte a ciegas.

export type Msg = { role: "system" | "user" | "assistant"; content: string };

export const CTX_SIZES = [4096, 6144, 8192, 12288, 16384, 24576, 32768];

/** Estimación prudente: en español y en código entran unos 3 caracteres por token. */
export function estimateTokens(messages: Array<{ content: string }>): number {
  return messages.reduce((sum, message) => sum + Math.ceil(message.content.length / 3) + 8, 0);
}

/** Memoria (KB) que gasta cada «token» de contexto: los modelos antiguos y los de visión (LLaVA…) gastan mucho más. */
export function kvKbPerToken(model: string): number {
  const size = Number(/(\d+(?:\.\d+)?)b\b/i.exec(model)?.[1] ?? 8);
  const heavy = /llava|bakllava|vicuna|llama2|codellama|phi3|phi-3|gemma|starcoder/i.test(model);
  return (heavy ? 62 : 25) * Math.max(1, size);
}

const KV_BUDGET_KB = 3 * 1024 * 1024; // ~3 GB de memoria para el contexto: prudente con 6 GB de memoria gráfica

/** El contexto más grande que conviene pedir a este modelo (nunca menos de 4.096). */
export function contextCap(model: string): number {
  const fits = CTX_SIZES.filter((size) => size * kvKbPerToken(model) <= KV_BUDGET_KB);
  const memory = fits.length ? fits[fits.length - 1]! : CTX_SIZES[0]!;
  const native = NATIVE.find(([pattern]) => pattern.test(model))?.[1];
  return native ? Math.min(memory, native) : memory;
}

/** Ventana con la que se entrenó cada familia: pedir más solo empeora la calidad y gasta memoria (phi3:mini «normal» es de 4.096). */
const NATIVE: Array<[RegExp, number]> = [[/phi-?3(?!.*128k)/i, 4096], [/llava|bakllava|llama2|vicuna/i, 4096]];

const CUT = "\n[…recortado para que quepa en la memoria del modelo…]\n";

export function shrinkText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.65);
  const tail = Math.max(0, maxChars - head - CUT.length);
  return `${text.slice(0, head)}${CUT}${tail ? text.slice(-tail) : ""}`;
}

export type Fit = { messages: Msg[]; numCtx: number; dropped: number; shrunk: boolean };

/**
 * Decide la memoria de contexto y, si la conversación no cabe, quita los mensajes más antiguos del historial (nunca el de
 * sistema ni el último). Para no obligar a Ollama a recargar el modelo cada vez que la conversación crece, se pide como
 * mínimo 8.192 (o el máximo que quepa, si es menos).
 */
export function fitContext(model: string, messages: Msg[], maxOutput = 2048): Fit {
  const cap = contextCap(model);
  const floor = Math.min(cap, 8192);
  let current = messages.slice();
  let dropped = 0;
  let shrunk = false;
  const budget = () => cap - maxOutput;
  const hasSystem = () => current[0]?.role === "system";
  // 1) Historial: fuera lo más antiguo.
  while (estimateTokens(current) > budget() && current.length > (hasSystem() ? 2 : 1)) {
    current.splice(hasSystem() ? 1 : 0, 1);
    dropped += 1;
  }
  // 2) Si todavía no cabe, se acorta el mensaje más grande (respetando el principio y el final).
  for (let guard = 0; guard < 12 && estimateTokens(current) > budget(); guard += 1) {
    let at = 0;
    current.forEach((message, index) => { if (message.content.length > current[at]!.content.length) at = index; });
    const target = current[at]!;
    const over = (estimateTokens(current) - budget()) * 3;
    const next = shrinkText(target.content, Math.max(800, target.content.length - over - 200));
    if (next.length >= target.content.length) break;
    current[at] = { ...target, content: next };
    shrunk = true;
  }
  const needed = estimateTokens(current) + maxOutput;
  const numCtx = CTX_SIZES.find((size) => size >= Math.max(needed, floor) && size <= cap) ?? cap;
  return { messages: current, numCtx, dropped, shrunk };
}
