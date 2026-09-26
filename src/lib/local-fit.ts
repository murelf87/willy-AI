// ¿QUÉ MODELO DE TU EQUIPO CABE ENTERO EN LA GRÁFICA? (25/09/2026)
// En el PC de Antonio (GTX 1660 Ti, 6 GB) qwen2.5-coder:7b se queda a medias entre la gráfica y el procesador (73 % en la
// gráfica) y escribe a 4 tokens por segundo: un cambio de un texto tardó más de 20 minutos cuando ninguna IA externa pudo. Los
// modelos que caben enteros (gemma3:4b, phi4-mini, llama3.2:3b) van a 65–90 tokens por segundo. Para el trabajo largo de SUPER
// WILLY, los que caben van primero; los demás quedan de respaldo. Si no se sabe la memoria de la gráfica, no se cambia nada.

export type FitInfo = { vramTotalMB: number; models: Array<{ name: string; sizeMB: number }> };

/** Memoria que Ollama necesita además de los pesos (contexto de 16.000 tokens y buffers), y la parte de la gráfica que deja libre. */
const EXTRA_MB = 1100;
const USABLE_SHARE = 0.85;

export function fitsInGpu(name: string, info: FitInfo | null): boolean | null {
  if (!info || !info.vramTotalMB) return null;
  const lower = name.toLowerCase();
  const model = info.models.find((m) => m.name.toLowerCase() === lower || m.name.toLowerCase() === `${lower}:latest` || lower === `${m.name.toLowerCase()}:latest`);
  if (!model || !model.sizeMB) return null;
  return model.sizeMB + EXTRA_MB <= info.vramTotalMB * USABLE_SHARE;
}

/** La misma cadena de modelos, con los que caben enteros en la gráfica por delante (el orden entre ellos no cambia). */
export function preferFitting(chain: readonly string[], info: FitInfo | null): string[] {
  if (!info) return [...chain];
  const fits = chain.filter((m) => fitsInGpu(m, info) !== false);
  const rest = chain.filter((m) => fitsInGpu(m, info) === false);
  return [...fits, ...rest];
}

/** Lo que dice el sistema de la gráfica y de los modelos instalados (null si no se puede saber). */
export async function readFitInfo(): Promise<FitInfo | null> {
  try {
    const res = await fetch("/api/sistema?ollama", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { gpu?: { vramTotalMB?: number }; models?: Array<{ name?: string; sizeMB?: number }> };
    const vramTotalMB = Number(data.gpu?.vramTotalMB) || 0;
    if (!vramTotalMB) return null;
    return { vramTotalMB, models: (data.models ?? []).filter((m) => m.name).map((m) => ({ name: String(m.name), sizeMB: Number(m.sizeMB) || 0 })) };
  } catch {
    return null;
  }
}

/** Para decírselo al dueño: «gemma3:4b (cabe entera en la gráfica)» o «qwen2.5-coder:7b (va a medias con el procesador: será lento)». */
export function fitNote(name: string, info: FitInfo | null): string {
  const fit = fitsInGpu(name, info);
  return fit === null ? name : fit ? `${name} (cabe entero en la gráfica)` : `${name} (no cabe entero en la gráfica: irá lento)`;
}

// ------------------------------------------------------------------------- caché para quien no puede esperar (funciones síncronas)
let cached: FitInfo | null = null;
let priming: Promise<FitInfo | null> | null = null;

/** La última información leída (null hasta que se lee la primera vez); `primeFitInfo()` la pide en segundo plano. */
export function cachedFitInfo(): FitInfo | null {
  return cached;
}

/** Pide la información de la gráfica una vez (y como mucho cada 5 minutos); no bloquea a nadie. */
export function primeFitInfo(): Promise<FitInfo | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!priming) {
    priming = readFitInfo().then((info) => { cached = info ?? cached; window.setTimeout(() => { priming = null; }, 5 * 60_000); return cached; });
  }
  return priming;
}

if (typeof window !== "undefined") void primeFitInfo();
