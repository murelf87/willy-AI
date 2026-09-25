// Capturas de pantalla para la Autoconstrucción: los modelos que programan solo entienden texto,
// así que un modelo con visión (llama3.2-vision, llava…) describe primero cada imagen y esa
// descripción se le pasa al modelo que programa. Las imágenes no salen de tu equipo.

import { listLocalModels, localAiUrl } from "@/lib/local-ai";
import { isVisionModel, visionModelsOf } from "@/lib/capabilities";
import { classifyEngineError, clearBroken, isBroken, markBroken } from "@/lib/model-health";

export type PreparedImage = { name: string; dataUrl: string; width: number; height: number };

/** Reduce (sin agrandar nunca) para que la mayor dimensión no pase de `max`. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Prepara una imagen pegada o subida: la reduce y la convierte a JPEG, mucho más ligero que el PNG de una captura. */
export async function prepareImage(file: File, name: string, maxSide = 1400): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("El navegador no puede procesar la imagen.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { name, dataUrl: canvas.toDataURL("image/jpeg", 0.9), width, height };
}

export const VISION_PROMPT = [
  "Esta es una captura de pantalla de una aplicación web (WILLY AI) que su dueño quiere modificar.",
  "Descríbela con precisión para que un programador pueda localizar el código:",
  "1) Transcribe literalmente TODO el texto visible: títulos, botones, etiquetas, mensajes y errores, tal como aparecen.",
  "2) Indica dónde está cada elemento (arriba, abajo, izquierda, derecha, dentro de qué tarjeta o panel) y su orden.",
  "3) Indica colores, tamaños relativos y qué parece estar mal, roto o fuera de lugar.",
  "No inventes texto que no veas. Responde en español, en una lista clara.",
].join("\n");

/** Para un chat cualquiera: la imagen puede ser una captura, un dibujo, un documento o una foto. */
export const GENERAL_VISION_PROMPT = [
  "Describe esta imagen con precisión para que otra IA, que no puede verla, pueda responder preguntas sobre ella.",
  "1) Transcribe literalmente TODO el texto que se vea (títulos, botones, mensajes, errores, números, tablas), tal como aparece.",
  "2) Si es una captura de pantalla o un diseño, describe la interfaz: qué elementos hay, dónde están y su orden.",
  "3) Si es un documento, tabla, gráfico, dibujo o foto, explica qué contiene y cómo está organizado.",
  "No inventes nada que no veas. Si algo es ilegible, dilo. Responde en español, en una lista clara.",
].join("\n");

/**
 * Cada familia de modelos ve la imagen a su manera y necesita otra memoria. LLaVA convierte una imagen en hasta ~2.900
 * «tokens»: con la memoria por defecto de Ollama la petición se recorta y la imagen se pierde (el modelo dice que no ve
 * nada o se lo inventa). Por eso se fija la memoria y se manda la imagen a un tamaño que el modelo aprovecha.
 */
export type VisionProfile = { family: "llava" | "moondream" | "otro"; maxSide: number; numCtx: number; maxTokens: number };

export function visionProfile(model: string): VisionProfile {
  const name = model.toLowerCase();
  if (/llava|bakllava/.test(name)) return { family: "llava", maxSide: 768, numCtx: 4096, maxTokens: 600 };
  if (/moondream/.test(name)) return { family: "moondream", maxSide: 756, numCtx: 4096, maxTokens: 500 };
  return { family: "otro", maxSide: 1120, numCtx: 8192, maxTokens: 800 };
}

/** LLaVA responde mejor a una instrucción corta y directa en inglés (pidiendo la respuesta en español). */
export function adaptVisionPrompt(model: string, prompt: string): string {
  if (visionProfile(model).family !== "llava") return prompt;
  const context = prompt.split("\n")[0]!.trim();
  return [
    "Look at the image carefully and describe it in detail.",
    "Write out ALL the visible text exactly as it appears. Say where each element is (top, bottom, left, right) and what it looks like.",
    "Do not invent anything you cannot see. Write your answer in Spanish.",
    context ? `Context: ${context}` : "",
  ].filter(Boolean).join(" ");
}

export const base64Of = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(",") + 1);

/** Petición nativa de Ollama: la imagen va aparte (`images`, sin el prefijo data:), la memoria se fija y la respuesta se transmite. */
export function buildNativeVisionRequest(model: string, dataUrl: string, prompt: string) {
  const profile = visionProfile(model);
  return {
    model,
    stream: true,
    temperature: 0.1,
    max_tokens: profile.maxTokens,
    num_ctx: profile.numCtx,
    messages: [{ role: "user", content: adaptVisionPrompt(model, prompt), images: [base64Of(dataUrl)] }],
  };
}

/** Los modelos grandes tardan: se avisa para que no parezca que se ha colgado. */
export function sizeHint(model: string): string {
  const size = Number(/(\d{1,3})b\b/i.exec(model)?.[1] ?? 0);
  return size >= 11 ? " Con un modelo grande puede tardar unos minutos." : "";
}

/** Reduce la imagen al tamaño que aprovecha el modelo (solo en el navegador; fuera de él la deja igual). */
export async function shrinkDataUrl(dataUrl: string, maxSide: number): Promise<string> {
  if (typeof document === "undefined" || typeof Image === "undefined") return dataUrl;
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, maxSide);
    if (width >= image.naturalWidth && height >= image.naturalHeight) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } catch {
    return dataUrl;
  }
}

export function buildVisionMessages(dataUrl: string, prompt: string = VISION_PROMPT) {
  return [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }];
}

/** Texto de una respuesta en formato OpenAI; null si no trae contenido. */
export function parseVisionResponse(json: unknown): string | null {
  const text = (json as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

/** Lee la respuesta de cualquiera de los dos formatos: OpenAI, JSON de Ollama, o el flujo por líneas de Ollama. */
export function parseVisionBody(raw: string): { text: string | null; error?: string } {
  const body = raw.trim();
  if (!body) return { text: null };
  try {
    const json = JSON.parse(body) as { error?: unknown; choices?: Array<{ message?: { content?: unknown } }>; message?: { content?: unknown }; response?: unknown };
    if (typeof json.error === "string" && json.error) return { text: null, error: json.error.slice(0, 200) };
    const text = json.choices?.[0]?.message?.content ?? json.message?.content ?? json.response;
    return { text: typeof text === "string" && text.trim() ? text.trim() : null };
  } catch {
    /* no es un único JSON: se lee línea a línea */
  }
  let text = "";
  for (const line of body.split("\n")) {
    try {
      const json = JSON.parse(line.trim()) as { error?: unknown; message?: { content?: unknown }; response?: unknown };
      if (typeof json.error === "string" && json.error) return { text: text.trim() || null, error: json.error.slice(0, 200) };
      const piece = json.message?.content ?? json.response;
      if (typeof piece === "string") text += piece;
    } catch {
      /* línea ajena al flujo */
    }
  }
  return { text: text.trim() || null };
}

/** Pide a un modelo con visión que describa una imagen (por el propio motor local, sin salir del equipo). */
export async function describeImage(
  model: string,
  dataUrl: string,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; prompt?: string } = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const prompt = opts.prompt ?? VISION_PROMPT;
  const profile = visionProfile(model);
  const send = (body: unknown) =>
    fetchImpl(localAiUrl("chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  const fail = async (res: Response) => {
    const detail = await res.text().catch(() => "");
    return { ok: false as const, error: `El motor respondió ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}.` };
  };
  const read = async (res: Response) => {
    const parsed = parseVisionBody(await res.text().catch(() => ""));
    if (parsed.error) return { ok: false as const, error: `El motor devolvió un error: ${parsed.error}` };
    return parsed.text ? { ok: true as const, text: parsed.text } : { ok: false as const, error: "El modelo no devolvió ninguna descripción." };
  };
  try {
    const image = await shrinkDataUrl(dataUrl, profile.maxSide);
    // 1) Vía nativa de Ollama: fija la memoria (si no, la imagen se recorta y se pierde) y transmite la respuesta.
    const native = await send(buildNativeVisionRequest(model, image, prompt));
    if (native.ok) return await read(native);
    if (![400, 404, 405, 422].includes(native.status)) return await fail(native);
    // 2) El motor no admite la vía nativa: la compatible con OpenAI, como hasta ahora.
    const legacy = await send({ model, stream: false, temperature: 0.1, max_tokens: profile.maxTokens, messages: buildVisionMessages(image, adaptVisionPrompt(model, prompt)) });
    return legacy.ok ? await read(legacy) : await fail(legacy);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo hablar con el motor local." };
  }
}

/** Archivos de imagen de una lista (portapapeles, arrastrar y soltar, selector de archivos). */
export function imageFilesOf(list: FileList | File[] | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
}

/** Modelos que pueden describir las imágenes, en orden de prueba: primero el del propio chat si ya ve imágenes. */
export function describerCandidates(currentModel: string, installed: string[]): string[] {
  const all = visionModelsOf(installed);
  return isVisionModel(currentModel) && installed.includes(currentModel) ? [currentModel, ...all.filter((name) => name !== currentModel)] : all;
}

/** Compatibilidad: el primer candidato. */
export function pickDescriber(currentModel: string, installed: string[]): string | undefined {
  return describerCandidates(currentModel, installed)[0];
}

/** Una negativa («Lo siento, pero no puedo ayudar con la imagen») no es una descripción: se prueba otro modelo. */
export function isVisionRefusal(text: string): boolean {
  const clean = text.trim();
  if (clean.length < 20) return true;
  const start = clean.slice(0, 220);
  return (
    /^(?:lo siento|disculpa|perd[oó]n|lamento|i'?m sorry|sorry|i (?:can(?:'|no)t|am unable|won'?t)|no puedo|no me es posible|unable to)/i.test(start) ||
    /\b(?:no puedo|no es posible|no me es posible) (?:ayudar|describir|analizar|ver|procesar)/i.test(start) ||
    /\bi (?:can(?:'|no)t|am unable to) (?:help|assist|describe|analy[sz]e|process)/i.test(start) ||
    // La imagen no llegó al modelo (memoria recortada, formato…): dice que no ve nada.
    /^(?:i (?:do not|don'?t|can(?:'|no)t) see|there (?:is|are) no (?:image|picture|photo)|no (?:image|picture|photo) (?:was|is|has been)|no veo|no (?:hay|he recibido|se ha adjuntado) (?:ninguna )?(?:imagen|foto))/i.test(start) ||
    /\b(?:no (?:image|picture|photo) (?:is |was |has been )?(?:provided|attached|included|visible)|i (?:can(?:'|no)t|do not) see (?:any|an|the) (?:image|picture|photo)|no (?:se )?(?:ha )?(?:adjunt|proporcion|recib)\w+ (?:ninguna )?imagen)/i.test(start)
  );
}

/**
 * Describe una imagen probando los modelos de visión uno tras otro: si uno no arranca (por ejemplo
 * «unknown model architecture: mllama» con una versión antigua de Ollama), se prueba el siguiente.
 */
export async function describeWithRelay(
  models: string[],
  dataUrl: string,
  opts: { prompt?: string; signal?: AbortSignal; fetchImpl?: typeof fetch; onTry?: (model: string) => void } = {},
): Promise<{ ok: true; text: string; model: string } | { ok: false; error: string }> {
  const errors: string[] = [];
  // Los modelos que ya se sabe que no cargan en este equipo se prueban los últimos (no se descartan: puede haberse arreglado).
  const ordered = [...models.filter((name) => !isBroken(name)), ...models.filter((name) => isBroken(name))];
  for (const model of ordered) {
    if (opts.signal?.aborted) return { ok: false, error: "Cancelado." };
    opts.onTry?.(model);
    const seen = await describeImage(model, dataUrl, {
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    if (seen.ok && !isVisionRefusal(seen.text)) {
      clearBroken(model);
      return { ok: true, text: seen.text, model };
    }
    if (!seen.ok) {
      const info = classifyEngineError(seen.error);
      if (info.kind === "no-carga" || info.kind === "sin-memoria") markBroken(model, info.kind);
    }
    errors.push(`${model}: ${seen.ok ? "se negó a describir la imagen" : seen.error}`);
  }
  return { ok: false, error: errors.length ? errors.join(" · ") : "no hay ningún modelo con visión instalado" };
}

/**
 * Describe las imágenes de un mensaje y devuelve el texto que se añade a la pregunta.
 * Un modelo con visión las mira; el modelo del chat recibe solo la descripción.
 */
export async function describePictures(opts: {
  endpoint: string;
  currentModel: string;
  pictures: PreparedImage[];
  signal?: AbortSignal;
  onStage?: (text: string) => void;
  listModels?: (endpoint: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const installed = await (opts.listModels ?? ((endpoint: string) => listLocalModels(endpoint)))(opts.endpoint);
  const models = describerCandidates(opts.currentModel, installed);
  if (!models.length) {
    return { ok: false, error: "Para entender imágenes hace falta un modelo con visión (por ejemplo gemma3:4b o qwen2.5vl:3b). Instálalo desde Centro de Inteligencia → Modelos." };
  }
  const parts: string[] = [];
  for (const [index, picture] of opts.pictures.entries()) {
    const seen = await describeWithRelay(models, picture.dataUrl, {
      prompt: GENERAL_VISION_PROMPT,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      onTry: (model) => opts.onStage?.(`🖼️ Mirando la imagen ${index + 1} de ${opts.pictures.length} con ${model}…${sizeHint(model)}`),
    });
    if (!seen.ok) return { ok: false, error: `No pude leer la imagen ${index + 1} (${picture.name}): ${seen.error}` };
    parts.push(`Imagen ${index + 1} (${picture.name}):\n${seen.text}`);
  }
  return {
    ok: true,
    text: `[IMÁGENES ADJUNTAS: un modelo de visión las ha descrito porque tú no puedes verlas. Trata la descripción como lo que el usuario te está enseñando; puede tener errores de lectura.]\n${parts.join("\n\n")}`,
  };
}
