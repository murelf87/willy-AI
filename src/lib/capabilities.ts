// Fase 1 de «la IA consigue lo que le falta»: detecta qué modelo haría mejor una petición
// y, si no está instalado, lo ofrece para instalar con un clic (o, si ya está, para usarlo).
// Solo propone; nunca descarga nada sin que se pulse el botón.

export type NeedId = "codigo" | "vision" | "razonamiento";

export type CatalogEntry = { name: string; label: string; tag: string; size: string; ram: string; desc: string };

export type Suggestion = {
  need: NeedId;
  /** install: descargar el modelo; use: ya está instalado, solo hay que elegirlo. */
  action: "install" | "use";
  model: string;
  label: string;
  size?: string;
  ram?: string;
  why: string;
};

type Rule = { test: RegExp; has: RegExp; tag: string; prefer: string[]; why: string };

const RULES: Record<NeedId, Rule> = {
  codigo: {
    test: /\b(program[ao]r?|programa|c[oó]digo|script|funci[oó]n|componente|p[aá]gina web|aplicaci[oó]n|html|css|javascript|typescript|python|react|api|bug|depura\w*|refactori\w*|compila\w*)\b/i,
    has: /coder|codestral|starcoder|codellama|codegemma|deepseek-coder/i,
    tag: "Código",
    prefer: ["qwen2.5-coder:7b", "qwen2.5-coder:14b"],
    why: "Para programar rinden mucho mejor los modelos hechos para código.",
  },
  vision: {
    test: /\b(imagen|im[aá]genes|foto|fotograf[ií]a|captura|screenshot|pantallazo|dibujo|maqueta|mockup)\b/i,
    has: /llava|vision|moondream|minicpm-v|bakllava|qwen2\.?5-?vl|gemma3(?::(?:4b|12b|27b)|:latest)?$/i,
    tag: "Visión",
    prefer: [],
    why: "Para entender imágenes hace falta un modelo con visión.",
  },
  razonamiento: {
    test: /\b(razona\w*|paso a paso|demuestra|matem[aá]tic\w*|l[oó]gic[oa]|acertijo)\b/i,
    has: /deepseek-r1|\br1\b|qwq|reason/i,
    tag: "Razonamiento",
    prefer: [],
    why: "Para problemas de lógica o matemáticas rinden mejor los modelos de razonamiento.",
  },
};

const ORDER: NeedId[] = ["codigo", "vision", "razonamiento"];

/** Tamaño en miles de millones de parámetros que indica el nombre («qwen2.5-coder:14b» → 14). */
function sizeOf(name: string): number {
  const found = /(?:^|[:-])(\d+(?:\.\d+)?)b(?:$|[-:])/i.exec(name)?.[1];
  return found ? Number(found) : Number.POSITIVE_INFINITY;
}

/** Preferencia entre modelos instalados de la misma clase; lo que no figura va después, de menor a mayor tamaño. */
const RANK: Record<NeedId, string[]> = {
  codigo: ["qwen2.5-coder:7b", "qwen2.5-coder:14b", "deepseek-coder-v2:16b"],
  vision: ["gemma3:4b", "qwen2.5vl:3b", "llama3.2-vision:11b", "llava:13b", "llava:7b"],
  razonamiento: ["deepseek-r1:8b"],
};

function bestInstalled(need: NeedId, names: string[]): string | undefined {
  const rank = (name: string) => {
    const at = RANK[need].indexOf(name);
    return at < 0 ? RANK[need].length : at;
  };
  return names.filter((name) => RULES[need].has.test(name)).sort((a, b) => rank(a) - rank(b) || sizeOf(a) - sizeOf(b) || a.localeCompare(b))[0];
}

/** true si el nombre corresponde a un modelo que ve imágenes. */
export function isVisionModel(name: string): boolean {
  return RULES.vision.has.test(name);
}

/** Todos los modelos con visión instalados, del preferido al último (para probar el siguiente si uno falla). */
export function visionModelsOf(installed: string[]): string[] {
  const rank = (name: string) => {
    const at = RANK.vision.indexOf(name);
    return at < 0 ? RANK.vision.length : at;
  };
  return installed.filter((name) => RULES.vision.has.test(name)).sort((a, b) => rank(a) - rank(b) || sizeOf(a) - sizeOf(b) || a.localeCompare(b));
}

/** Modelo con visión que conviene usar entre los instalados (o undefined si no hay ninguno). */
export function visionModelOf(installed: string[]): string | undefined {
  return bestInstalled("vision", installed);
}

const CODER = /coder|codestral|codegemma|starcoder|deepseek-coder/i;

/**
 * Orden de prueba para la Autoconstrucción: primero los modelos de código de menor a mayor tamaño
 * (el pequeño cabe en la memoria gráfica y responde mucho antes; si falla, se pasa a los grandes)
 * y después los demás en el orden recibido.
 */
export function fastCoderFirst(models: string[]): string[] {
  const coders = models.filter((name) => CODER.test(name)).sort((a, b) => sizeOf(a) - sizeOf(b) || a.localeCompare(b));
  return [...coders, ...models.filter((name) => !CODER.test(name))];
}

export function detectSuggestions(
  input: { text: string; hasImages: boolean; currentModel: string; installed: string[]; dismissed: string[] },
  catalog: CatalogEntry[],
): Suggestion[] {
  for (const need of ORDER) {
    const rule = RULES[need];
    const wanted = rule.test.test(input.text) || (need === "vision" && input.hasImages);
    if (!wanted || input.dismissed.includes(need)) continue;
    if (rule.has.test(input.currentModel)) continue;

    const installed = bestInstalled(need, input.installed);
    if (installed) {
      return [{ need, action: "use", model: installed, label: installed, why: `${rule.why} Ya tienes «${installed}» instalado: puedes usarlo para esto.` }];
    }
    const candidates = catalog.filter((entry) => entry.tag === rule.tag);
    const pick = rule.prefer.map((name) => candidates.find((entry) => entry.name === name)).find(Boolean) ?? candidates[0];
    if (!pick) continue;
    return [{ need, action: "install", model: pick.name, label: pick.label, size: pick.size, ram: pick.ram, why: rule.why }];
  }
  return [];
}

const KEY = "willy.capabilities.dismissed";

export function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** «Ahora no»: no se vuelve a proponer esa mejora. */
export function dismissNeed(need: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...new Set([...readDismissed(), need])]));
  } catch {
    /* sin almacenamiento: solo se pierde el recuerdo */
  }
}
