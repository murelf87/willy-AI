import { isChatModel } from "@/lib/local-ai";

// «El motor no está en marcha» y «este modelo no se puede cargar» son problemas MUY distintos, pero hasta ahora se
// presentaban igual (y se ofrecía reinstalar lo que ya funcionaba). Aquí se distingue, se apuntan los modelos que no
// cargan en este equipo (por ejemplo llama3.2-vision con la arquitectura «mllama») y se elige otro automáticamente.

export type EngineErrorKind = "no-carga" | "sin-memoria" | "no-existe" | "parado" | "otro";

export function classifyEngineError(detail: string): { kind: EngineErrorKind; arch?: string } {
  const text = detail.replace(/\\n/g, "\n");
  const arch = /unknown model architecture:\s*'([^']+)'/i.exec(text)?.[1];
  if (/unknown model architecture|error loading model|failed to load model|(?:llama[- ](?:runner|server)) process has terminated|unsupported (?:model )?architecture|the model you are attempting to pull requires a newer version/i.test(text)) return { kind: "no-carga", ...(arch ? { arch } : {}) };
  if (/requires more system memory|out of memory|cudamalloc failed|insufficient memory|not enough memory/i.test(text)) return { kind: "sin-memoria" };
  if (/model ["'`][^"'`]+["'`] not found|try pulling it first|no existe el modelo/i.test(text)) return { kind: "no-existe" };
  if (/ECONNREFUSED|fetch failed|failed to fetch|no está arrancado|no esta arrancado|respondió 50[234]|connection (?:refused|reset)|ollama no está/i.test(text) && !/error loading model/i.test(text)) return { kind: "parado" };
  return { kind: "otro" };
}

const short = (text: string, max = 260): string => text.replace(/\s+/g, " ").trim().slice(0, max);

export function explainEngineError(kind: EngineErrorKind, model: string, detail: string, arch?: string): string {
  const technical = `Detalle técnico: ${short(detail)}`;
  if (kind === "no-carga") {
    return [
      `El modelo «${model}» no se puede cargar en tu equipo${arch ? ` (usa la arquitectura «${arch}», que tu versión de Ollama no puede cargar)` : ""}. Ollama SÍ está en marcha: el fallo es solo de ese modelo.`,
      "",
      "Qué hacer: elige otro modelo en Centro de Inteligencia → Modelos → «Usar» (por ejemplo llama3.1:8b). WILLY ya lo ha apuntado para no volver a intentarlo. Si es un modelo de visión, prueba otro (llava:7b, por ejemplo) y, en Centro de Inteligencia → Modelos, usa «Comprobar ahora» para ver cuál funciona bien en tu equipo.",
      "",
      technical,
    ].join("\n");
  }
  if (kind === "sin-memoria") {
    return [`El modelo «${model}» necesita más memoria de la que tiene libre tu equipo ahora mismo. Ollama SÍ está en marcha.`, "", "Qué hacer: cierra programas pesados, o elige un modelo más pequeño en Centro de Inteligencia → Modelos → «Usar».", "", technical].join("\n");
  }
  if (kind === "no-existe") {
    return [`El modelo «${model}» ya no está instalado en tu equipo. Ollama SÍ está en marcha.`, "", "Qué hacer: elige otro en Centro de Inteligencia → Modelos → «Usar», o vuelve a descargarlo desde el catálogo.", "", technical].join("\n");
  }
  return [
    "El motor de IA de tu equipo todavía no está en marcha, por eso no he podido contestar.",
    "",
    "Pulsa el botón de abajo: lo instalo, lo arranco y descargo el primer modelo por ti. No tienes que hacer nada más.",
    "",
    technical,
  ].join("\n");
}

// ------------------------------------------------------------ modelos que no cargan (se recuerdan unos días)
const KEY = "willy:modelos-que-no-cargan";
const EXPIRES_MS = 3 * 24 * 60 * 60 * 1000;
type Entry = { kind: string; at: number };

function read(now: number): Record<string, Entry> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, Entry>;
    return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => entry && now - entry.at < EXPIRES_MS));
  } catch {
    return {};
  }
}

const write = (data: Record<string, Entry>): void => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* sin almacenamiento: solo se pierde el recuerdo */
  }
};

export function markBroken(model: string, kind: string, now = Date.now()): void {
  write({ ...read(now), [model]: { kind, at: now } });
}

export function isBroken(model: string, now = Date.now()): boolean {
  return model in read(now);
}

export function listBroken(now = Date.now()): Array<{ model: string; kind: string }> {
  return Object.entries(read(now)).map(([model, entry]) => ({ model, kind: entry.kind }));
}

export function clearBroken(model?: string, now = Date.now()): void {
  if (!model) return write({});
  const data = read(now);
  delete data[model];
  write(data);
}

const VISION_ONLY = /llava|bakllava|moondream|vision|-vl\b|minicpm-v/i;

/** Otros modelos para conversar, en orden de preferencia: sin los que fallaron o no cargan, y los de visión al final. */
export function alternativeModels(installed: string[], failed: string, rank: (models: string[]) => string[], now = Date.now()): string[] {
  const usable = installed.filter((name) => name !== failed && isChatModel(name) && !isBroken(name, now));
  const ordered = rank(usable);
  return [...ordered.filter((name) => !VISION_ONLY.test(name)), ...ordered.filter((name) => VISION_ONLY.test(name))];
}

/**
 * Pregunta a un modelo y, si NO se puede cargar en este equipo (o no le cabe en memoria), prueba con el siguiente sin que
 * el usuario haga nada. Solo se cambia de modelo si aún no se ha recibido nada y nadie ha pulsado «Detener».
 */
export async function askWithFallback<T>(opts: {
  model: string;
  ask: (model: string) => Promise<T>;
  installed: () => Promise<string[]>;
  rank: (models: string[]) => string[];
  canRetry: () => boolean;
  onSwitch?: (from: string, to: string, kind: EngineErrorKind, arch?: string) => void;
}): Promise<{ value: T; model: string }> {
  const tried = new Set<string>();
  let model = opts.model;
  // Si no queda ninguno, se muestra el error del modelo que eligió el usuario, no el del último probado.
  let first: unknown;
  for (;;) {
    tried.add(model);
    try {
      const value = await opts.ask(model);
      clearBroken(model);
      return { value, model };
    } catch (failure) {
      const info = classifyEngineError(failure instanceof Error ? failure.message : String(failure));
      if (!opts.canRetry() || (info.kind !== "no-carga" && info.kind !== "sin-memoria")) throw failure;
      first ??= failure;
      markBroken(model, info.kind);
      const next = alternativeModels(await opts.installed(), model, opts.rank).find((name) => !tried.has(name));
      if (!next) throw first;
      opts.onSwitch?.(model, next, info.kind, info.arch);
      model = next;
    }
  }
}
