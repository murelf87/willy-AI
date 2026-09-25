// Comprobación del chat y de la visión EN TU EQUIPO: en vez de adivinar por qué «no va», se prueba de verdad y se mide.
// 1) ¿Responde Ollama? 2) ¿Responde el modelo del chat (y cuánto tarda)? 3) ¿Entiende un mensaje de sistema largo como el de
// WILLY, o se le recorta? 4) ¿Cada modelo de visión sabe leer un texto en una imagen? Nada de esto sale de tu equipo.

export type CheckStatus = "ok" | "aviso" | "fallo";
export type CheckStep = { id: string; title: string; status: CheckStatus; detail: string; seconds?: number };
export type CheckMsg = { role: "system" | "user" | "assistant"; content: string };

export type CheckDeps = {
  listModels: () => Promise<string[]>;
  chat: (model: string, messages: CheckMsg[], signal: AbortSignal) => Promise<string>;
  describe: (model: string, dataUrl: string, prompt: string, signal: AbortSignal) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  makeImage: (text: string) => Promise<string>;
  now: () => number;
  systemPrompt: string;
  visionModels: (installed: string[]) => string[];
  /** ¿Responde el propio servidor de WILLY? Sirve para explicar un «NetworkError» (fallo de conexión, no del modelo). */
  ping?: () => Promise<boolean>;
};

/** Dónde se guarda el último informe, para incluirlo en el paquete de «Continuar el desarrollo». */
export const LAST_REPORT_KEY = "willy:ultimo-informe-equipo";

export const SECRET = "TULIPAN-4827";
export const IMAGE_TEXT = "HOLA 4827";
const SLOW = 25;
const VERY_SLOW = 90;

const short = (text: string, max = 90): string => text.replace(/\s+/g, " ").trim().slice(0, max);
const errorText = (error: unknown, seconds: number, limit: number): string => {
  if (error instanceof Error && (error.name === "AbortError" || /abort|timeout/i.test(error.message))) return `No respondió en ${limit} segundos (${Math.round(seconds)} s esperados).`;
  return error instanceof Error ? error.message : String(error);
};

/** true si el error es de conexión (el navegador no llegó a recibir respuesta), no un error del modelo. */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  return error.name === "TypeError" && /networkerror|failed to fetch|load failed|network|fetch/i.test(error.message);
}

/** Explica un fallo de conexión según si el servidor de WILLY seguía respondiendo o no. */
export async function explainNetworkError(error: unknown, ping?: () => Promise<boolean>): Promise<string | null> {
  if (!isNetworkError(error)) return null;
  const alive = ping ? await ping().catch(() => false) : null;
  const base = `Fallo de conexión del navegador («${(error as Error).message}»), no del modelo.`;
  if (alive === false) return `${base} En ese momento el servidor de WILLY no respondía (por ejemplo, porque se estaba reiniciando tras una actualización). Vuelve a pasar la comprobación dentro de un minuto.`;
  if (alive === true) return `${base} WILLY sí responde, así que la conexión con el chat se cortó antes de terminar (lo normal es que el modelo tardara demasiado en cargarse en memoria o que Ollama se reiniciara). Vuelve a probar; si se repite, prueba un modelo más pequeño.`;
  return base;
}

export async function runEngineCheck(deps: CheckDeps, opts: { chatModel: string; timeoutSeconds?: number; signal?: AbortSignal; onStep?: (step: CheckStep) => void }): Promise<CheckStep[]> {
  const steps: CheckStep[] = [];
  const limit = opts.timeoutSeconds ?? 180;
  const push = (step: CheckStep) => { steps.push(step); opts.onStep?.(step); };
  const guarded = async <T>(run: (signal: AbortSignal) => Promise<T>): Promise<{ value?: T; error?: unknown; seconds: number }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit * 1000);
    const onOuter = () => controller.abort();
    opts.signal?.addEventListener("abort", onOuter);
    const started = deps.now();
    try {
      return { value: await run(controller.signal), seconds: (deps.now() - started) / 1000 };
    } catch (error) {
      return { error, seconds: (deps.now() - started) / 1000 };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuter);
    }
  };

  // 1) El motor
  const listed = await guarded(() => deps.listModels());
  const installed = listed.value ?? [];
  if (!installed.length) {
    push({ id: "motor", title: "Motor de IA (Ollama)", status: "fallo", detail: listed.error ? `No responde: ${errorText(listed.error, listed.seconds, limit)}` : "Ollama responde pero no tiene ningún modelo instalado, o no está arrancado en localhost:11434." });
    return steps;
  }
  push({ id: "motor", title: "Motor de IA (Ollama)", status: "ok", detail: `Responde. Modelos instalados: ${installed.join(", ")}.` });

  // 2) Chat corto
  const model = opts.chatModel;
  if (!installed.includes(model)) push({ id: "modelo", title: `Modelo del chat: ${model}`, status: "aviso", detail: "No está entre los instalados: WILLY usará otro automáticamente." });
  if (/llava|bakllava|moondream/i.test(model)) push({ id: "vision-como-chat", title: `«${model}» es un modelo de visión`, status: "aviso", detail: "Sirve para mirar imágenes, pero conversa peor y ocupa mucha memoria. Elige otro modelo para el chat y deja este solo para las imágenes." });
  const short1 = await guarded((signal) => deps.chat(model, [{ role: "system", content: "Responde SOLO con la palabra LISTO." }, { role: "user", content: "Hola" }], signal));
  if (short1.error !== undefined) {
    push({ id: "chat", title: `Chat con ${model}`, status: "fallo", detail: (await explainNetworkError(short1.error, deps.ping)) ?? errorText(short1.error, short1.seconds, limit), seconds: short1.seconds });
    return await finish();
  }
  const okShort = /listo/i.test(short1.value ?? "");
  push({
    id: "chat",
    title: `Chat con ${model}`,
    status: !okShort ? "aviso" : short1.seconds > SLOW ? "aviso" : "ok",
    detail: !okShort ? `Respondió, pero no lo esperado: «${short(short1.value ?? "")}».` : short1.seconds > SLOW ? `Responde en ${short1.seconds.toFixed(1)} s: es lento. Probablemente el modelo no cabe entero en tu memoria gráfica y trabaja en parte con el procesador.` : `Responde en ${short1.seconds.toFixed(1)} s.`,
    seconds: short1.seconds,
  });

  // 3) Mensaje de sistema largo, como el de WILLY
  const longSystem = `CLAVE SECRETA: ${SECRET}. Cuando te la pidan, respóndela tal cual.\n\n${[1, 2, 3, 4].map(() => deps.systemPrompt).join("\n\n")}`;
  const long = await guarded((signal) => deps.chat(model, [{ role: "system", content: longSystem }, { role: "user", content: "¿Cuál es la clave secreta? Responde solo con la clave." }], signal));
  if (long.error !== undefined) push({ id: "largo", title: "Mensaje largo (como el de WILLY)", status: "fallo", detail: (await explainNetworkError(long.error, deps.ping)) ?? errorText(long.error, long.seconds, limit), seconds: long.seconds });
  else if (/4827/.test(long.value ?? "")) push({ id: "largo", title: "Mensaje largo (como el de WILLY)", status: long.seconds > VERY_SLOW ? "aviso" : "ok", detail: `Recibe el mensaje entero (≈${Math.round(longSystem.length / 3)} tokens) en ${long.seconds.toFixed(1)} s.${long.seconds > VERY_SLOW ? " Es muy lento: cada respuesta del chat tardará mucho." : ""}`, seconds: long.seconds });
  else push({ id: "largo", title: "Mensaje largo (como el de WILLY)", status: "fallo", detail: `El modelo NO recibió el mensaje entero: se le pidió una clave escrita al principio y respondió «${short(long.value ?? "")}». Con conversaciones largas se pierde información (memoria de contexto insuficiente).`, seconds: long.seconds });

  return await finish();

  // 4) Visión (cada modelo, por separado) y resumen
  async function finish(): Promise<CheckStep[]> {
    const candidates = deps.visionModels(installed).slice(0, 3);
    if (!candidates.length) push({ id: "vision", title: "Modelos de visión", status: "aviso", detail: "No hay ningún modelo con visión instalado (por ejemplo gemma3:4b o qwen2.5vl:3b). Sin él, WILLY no puede entender imágenes." });
    const visionOk: Array<{ model: string; seconds: number }> = [];
    const visionBad: string[] = [];
    const visionWeak: string[] = [];
    for (const candidate of candidates) {
      if (opts.signal?.aborted) break;
      const image = await deps.makeImage(IMAGE_TEXT);
      const seen = await guarded((signal) => deps.describe(candidate, image, "What text is written in the image? Answer with only that text.", signal));
      if (seen.error !== undefined || (seen.value && !seen.value.ok)) {
        const why = seen.error !== undefined ? (await explainNetworkError(seen.error, deps.ping)) ?? errorText(seen.error, seen.seconds, limit) : (seen.value as { ok: false; error: string }).error;
        push({ id: `vision:${candidate}`, title: `Visión con ${candidate}`, status: "fallo", detail: why, seconds: seen.seconds });
        visionBad.push(candidate);
        continue;
      }
      const text = (seen.value as { ok: true; text: string }).text;
      if (/4827/.test(text)) {
        push({ id: `vision:${candidate}`, title: `Visión con ${candidate}`, status: seen.seconds > VERY_SLOW ? "aviso" : "ok", detail: `Lee bien el texto de la imagen en ${seen.seconds.toFixed(1)} s.${seen.seconds > VERY_SLOW ? " Es muy lento." : ""}`, seconds: seen.seconds });
        visionOk.push({ model: candidate, seconds: seen.seconds });
      } else if (/hola/i.test(text)) {
        push({ id: `vision:${candidate}`, title: `Visión con ${candidate}`, status: "aviso", detail: `Ve la imagen pero lee mal las cifras: respondió «${short(text)}» (debía ser «${IMAGE_TEXT}»). Sirve para describir, no para transcribir.`, seconds: seen.seconds });
        visionWeak.push(candidate);
      } else {
        push({ id: `vision:${candidate}`, title: `Visión con ${candidate}`, status: "fallo", detail: `NO identifica lo que hay en la imagen: respondió «${short(text)}» (debía leer «${IMAGE_TEXT}»).`, seconds: seen.seconds });
        visionBad.push(candidate);
      }
    }
    push(summary(steps, visionOk, visionBad, visionWeak));
    return steps;
  }
}

/** Modelos de visión que sí caben en 6 GB y que aún no se han probado (nunca se recomienda uno que ya ha fallado). */
function suggestVision(tried: string[]): string {
  const fresh = ["gemma3:4b", "qwen2.5vl:3b"].filter((name) => !tried.some((t) => t.startsWith(name.split(":")[0]!)));
  return fresh.length ? `Prueba a instalar ${fresh.join(" o ")} (caben enteros en 6 GB de memoria gráfica; gemma3 necesita Ollama 0.6 o superior).` : "Prueba a actualizar Ollama a la última versión.";
}

function summary(steps: CheckStep[], visionOk: Array<{ model: string; seconds: number }>, visionBad: string[], visionWeak: string[] = []): CheckStep {
  const notes: string[] = [];
  const failed = steps.filter((step) => step.status === "fallo" && !step.id.startsWith("vision:"));
  if (steps.find((s) => s.id === "motor")?.status === "fallo") notes.push("Arranca Ollama (o instálalo) y vuelve a comprobar.");
  if (steps.find((s) => s.id === "chat")?.status === "fallo") notes.push("El modelo del chat no responde: prueba con otro modelo (por ejemplo llama3.1:8b) desde «Usar» en Centro de Inteligencia → Modelos.");
  const large = steps.find((s) => s.id === "largo");
  if (large?.status === "fallo") {
    notes.push(/No respondió en/.test(large.detail)
      ? "Con un mensaje largo el modelo va demasiado lento: lo normal es que una parte se ejecute en el procesador en vez de en la tarjeta gráfica. Mira con «ollama ps» la columna PROCESSOR, libera modelos grandes con «ollama stop nombre» y prueba un modelo más ligero (por ejemplo llama3.2:3b)."
      : "Con mensajes largos el modelo pierde información: usa un modelo más pequeño o cierra otros programas que gasten memoria gráfica.");
  }
  if (visionOk.length) {
    const best = [...visionOk].sort((a, b) => a.seconds - b.seconds)[0]!;
    notes.push(`Para imágenes usa ${best.model} (${best.seconds.toFixed(0)} s).${visionBad.length ? ` No uses ${visionBad.join(", ")}: no identifica bien las imágenes en tu equipo.` : ""}`);
  } else if (visionBad.length || visionWeak.length) {
    // «Ve la imagen pero lee mal las cifras» tampoco es «todo bien»: sirve para describir, no para transcribir.
    const plural = (list: string[], one: string, many: string) => (list.length > 1 ? many : one);
    notes.push(`${visionBad.length ? `No funcionan bien en tu equipo: ${visionBad.join(", ")}. ` : ""}${visionWeak.length ? `${visionWeak.join(", ")} ${plural(visionWeak, "ve las imágenes pero lee mal el texto y las cifras: sirve", "ven las imágenes pero leen mal el texto y las cifras: sirven")} para describirlas, no para transcribirlas. ` : ""}${suggestVision([...visionBad, ...visionWeak])} Para leer el texto de una imagen, la pestaña OCR es más fiable que un modelo de visión.`);
  }
  const bad = failed.length > 0 || visionBad.length > 0 || (visionWeak.length > 0 && !visionOk.length);
  return { id: "resumen", title: "Qué hacer", status: bad && !visionOk.length && !steps.some((s) => s.id === "chat" && s.status === "ok") ? "fallo" : bad ? "aviso" : "ok", detail: notes.length ? notes.join(" ") : "Todo responde bien." };
}

export function checkMarkdown(steps: CheckStep[], info: { chatModel: string; when: string }): string {
  const mark = { ok: "✔", aviso: "⚠", fallo: "✘" } as const;
  return [`# Comprobación de WILLY AI (${info.when})`, `Modelo del chat: ${info.chatModel}`, "", ...steps.map((step) => `- ${mark[step.status]} **${step.title}**${step.seconds !== undefined ? ` (${step.seconds.toFixed(1)} s)` : ""} — ${step.detail}`)].join("\n");
}
