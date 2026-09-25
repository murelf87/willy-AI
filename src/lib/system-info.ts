// Panel «Recursos de tu equipo» de Inicio: lectura de datos reales del ordenador y consejos.
// Lógica pura (sin acceso al sistema) para poder probarla: interpreta la salida de nvidia-smi,
// tasklist, powercfg y Ollama, y decide qué avisos mostrar.

export type GpuInfo = { name: string; utilization: number; vramUsedMB: number; vramTotalMB: number; temperature: number | null };
export type LoadedModel = { name: string; sizeMB: number; vramMB: number; expiresAt: string | null };
export type ProcInfo = { name: string; memoryMB: number; count: number };
export type CpuTimes = { idle: number; total: number };
export type PowerScheme = { guid: string; name: string };
export type BackupInfo = { totalMB: number; removableMB: number; removableCount: number };

export type SystemSnapshot = {
  at: number;
  platform: string;
  cpu: { percent: number | null; cores: number; model: string };
  memory: { totalMB: number; usedMB: number; percent: number };
  gpu: GpuInfo | null;
  disk: { drive: string; freeGB: number; totalGB: number; percent: number } | null;
  engine: { alive: boolean; installed: number; loaded: LoadedModel[] };
  /** Solo en la lectura ampliada. */
  processes?: ProcInfo[];
  power?: PowerScheme | null;
  backups?: BackupInfo;
};

export const POWER = {
  HIGH: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
  BALANCED: "381b4222-f694-41f0-9685-ff5bb260df2e",
  SAVER: "a1841308-3541-4fab-bc81-f71556f20b4a",
} as const;

const num = (text: string | undefined): number | null => {
  const value = Number((text ?? "").trim().replace(",", "."));
  return Number.isFinite(value) ? value : null;
};

/** `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits` */
export function parseNvidiaSmi(csv: string): GpuInfo[] {
  const out: GpuInfo[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length < 4 || !parts[0]) continue;
    const utilization = num(parts[1]);
    const used = num(parts[2]);
    const total = num(parts[3]);
    if (used === null || total === null || total <= 0) continue;
    out.push({ name: parts[0], utilization: utilization ?? 0, vramUsedMB: used, vramTotalMB: total, temperature: num(parts[4]) });
  }
  return out;
}

/** Respuesta de `GET /api/ps` de Ollama: modelos que están cargados en memoria ahora mismo. */
export function parseOllamaPs(json: unknown): LoadedModel[] {
  const list = (json as { models?: unknown } | null)?.models;
  if (!Array.isArray(list)) return [];
  const out: LoadedModel[] = [];
  for (const item of list as Array<{ name?: unknown; model?: unknown; size?: unknown; size_vram?: unknown; expires_at?: unknown }>) {
    const name = typeof item?.name === "string" ? item.name : typeof item?.model === "string" ? item.model : "";
    if (!name) continue;
    const size = typeof item.size === "number" ? item.size : 0;
    const vram = typeof item.size_vram === "number" ? item.size_vram : 0;
    out.push({ name, sizeMB: Math.round(size / 1048576), vramMB: Math.round(vram / 1048576), expiresAt: typeof item.expires_at === "string" ? item.expires_at : null });
  }
  return out;
}

/** `tasklist /fo csv /nh`: se suman los procesos con el mismo nombre (un navegador tiene decenas). */
export function parseTasklist(csv: string, top = 6): ProcInfo[] {
  const totals = new Map<string, ProcInfo>();
  for (const line of csv.split(/\r?\n/)) {
    const match = /^"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]*)"/.exec(line.trim());
    if (!match) continue;
    const name = match[1]!;
    const memoryKB = Number((match[3] ?? "").replace(/\D/g, ""));
    if (!memoryKB || /^(?:system idle process|system|registry|memory compression)$/i.test(name)) continue;
    const entry = totals.get(name) ?? { name, memoryMB: 0, count: 0 };
    entry.memoryMB += memoryKB / 1024;
    entry.count += 1;
    totals.set(name, entry);
  }
  return [...totals.values()].map((entry) => ({ ...entry, memoryMB: Math.round(entry.memoryMB) })).sort((a, b) => b.memoryMB - a.memoryMB).slice(0, top);
}

/** `powercfg /getactivescheme` (o /duplicatescheme): el texto cambia de idioma, el GUID no. */
export function parsePowerScheme(output: string): PowerScheme | null {
  const guid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(output)?.[1]?.toLowerCase();
  if (!guid) return null;
  const name = /\(([^)]+)\)\s*$/m.exec(output)?.[1]?.trim() ?? "";
  return { guid, name };
}

export const isHighPerformance = (scheme: PowerScheme | null | undefined): boolean =>
  !!scheme && (scheme.guid === POWER.HIGH || /alto rendimiento|high performance|máximo rendimiento|maximo rendimiento|ultimate/i.test(scheme.name));

/** Porcentaje de uso del procesador entre dos lecturas de os.cpus() (suma de todos los núcleos). */
export function cpuPercent(before: CpuTimes[], after: CpuTimes[]): number | null {
  if (!before.length || before.length !== after.length) return null;
  let idle = 0;
  let total = 0;
  for (let index = 0; index < after.length; index += 1) {
    idle += after[index]!.idle - before[index]!.idle;
    total += after[index]!.total - before[index]!.total;
  }
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
}

/** Instante que lleva en el nombre una copia («2026-09-20T14-05-52-…»); sirve para ordenarlas por antigüedad. */
export function backupStamp(name: string): string {
  return /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.exec(name)?.[0] ?? name;
}

/** Copias que se pueden borrar conservando las `keep` más recientes. */
export function pickRemovable(names: string[], keep: number): string[] {
  return [...names].sort((a, b) => backupStamp(b).localeCompare(backupStamp(a))).slice(Math.max(0, keep));
}

export const formatMB = (mb: number): string => (mb >= 1024 ? `${(mb / 1024).toFixed(1).replace(".", ",")} GB` : `${Math.round(mb)} MB`);

/**
 * ¿Con qué calcula la IA de tu equipo? Lo dice Ollama (cuánto del modelo cargado está en la memoria de la gráfica), no una
 * suposición: «grafica» (entero en la gráfica), «mixto» (una parte va al procesador) o «procesador» (nada en la gráfica,
 * va mucho más lento). Sin ningún modelo cargado todavía no se puede saber («sin-modelo»). La lectura de la gráfica NVIDIA
 * (nvidia-smi) solo sirve para explicar el porqué.
 */
export type GpuUsage =
  | { state: "sin-modelo" }
  | { state: "grafica"; model: string }
  | { state: "mixto"; model: string; share: number }
  | { state: "procesador"; model: string; reason: string; fix: string };

export function gpuUsage(loaded: LoadedModel[], gpu: GpuInfo | null): GpuUsage {
  // El modelo que más pesa es el que decide cómo de rápido va.
  const model = [...loaded].filter((entry) => entry.sizeMB > 0).sort((a, b) => b.sizeMB - a.sizeMB)[0];
  if (!model) return { state: "sin-modelo" };
  if (model.vramMB >= model.sizeMB * 0.95) return { state: "grafica", model: model.name };
  if (model.vramMB > model.sizeMB * 0.02) return { state: "mixto", model: model.name, share: Math.round((model.vramMB / model.sizeMB) * 100) };
  if (!gpu) {
    return {
      state: "procesador",
      model: model.name,
      reason: "No se ha encontrado una tarjeta gráfica NVIDIA con su controlador en este equipo (o Ollama no puede usar la que tiene), así que calcula con el procesador.",
      fix: "Es lo normal en un equipo sin gráfica NVIDIA: con modelos pequeños (de 3B o 4B) responde antes, y una IA externa gratuita es mucho más rápida.",
    };
  }
  const freeMB = gpu.vramTotalMB - gpu.vramUsedMB;
  if (freeMB < model.sizeMB * 0.3) {
    return {
      state: "procesador",
      model: model.name,
      reason: `Tu gráfica (${gpu.name}) tiene su memoria casi llena: ${formatMB(gpu.vramUsedMB)} de ${formatMB(gpu.vramTotalMB)} ocupados, y el modelo no cabe.`,
      fix: "Cierra los programas que usan la gráfica (juegos, editores de vídeo o de imagen) y pulsa «Reiniciar» en la IA de tu equipo.",
    };
  }
  return {
    state: "procesador",
    model: model.name,
    reason: `Tu gráfica (${gpu.name}, ${formatMB(gpu.vramTotalMB)}) está libre, pero Ollama no la está usando. Suele pasar con un controlador de NVIDIA antiguo o si Ollama arrancó antes que el controlador.`,
    fix: "Actualiza el controlador de NVIDIA y pulsa «Reiniciar» en la IA de tu equipo.",
  };
}

/** Consejos según lo que se mide, en lenguaje llano. Solo se muestran los que aplican. */
export function advise(s: SystemSnapshot): string[] {
  const tips: string[] = [];
  if (!s.engine.alive) tips.push("El motor de IA (Ollama) no responde. Si el chat tampoco contesta, pulsa «Arrancar la IA de mi equipo» en el chat.");
  if (s.memory.percent >= 90) tips.push(`La memoria está casi llena (${s.memory.percent} %). Pulsa «Liberar memoria de la IA» o cierra programas pesados (abajo ves los que más usan).`);
  const usage = gpuUsage(s.engine.loaded, s.gpu);
  if (usage.state === "procesador") tips.push(`La IA de tu equipo («${usage.model}») va solo con el procesador, por eso tarda más. ${usage.reason} ${usage.fix}`);
  if (usage.state === "mixto") {
    const total = s.gpu ? ` (${formatMB(s.gpu.vramTotalMB)} en total)` : "";
    tips.push(`«${usage.model}» solo está al ${usage.share} % en la gráfica${total}; el resto se calcula en el procesador y va más lento. Un modelo más pequeño (de unos 7B) cabe entero y responde antes.`);
  }
  if (s.gpu && s.gpu.temperature !== null && s.gpu.temperature >= 85) tips.push(`La gráfica está muy caliente (${s.gpu.temperature} °C). Revisa la ventilación y evita tareas largas hasta que baje.`);
  if (s.disk && s.disk.freeGB < 30) tips.push(`Queda poco espacio en el disco (${s.disk.freeGB.toFixed(0)} GB libres). Borra modelos que no uses desde Centro de Inteligencia → Modelos.`);
  if (s.backups && s.backups.removableMB >= 300) tips.push(`Hay ${formatMB(s.backups.removableMB)} en copias antiguas de WILLY que puedes borrar sin riesgo (se conservan las más recientes).`);
  if (s.power && s.platform === "win32" && !isHighPerformance(s.power) && (s.cpu.percent ?? 0) >= 60) {
    tips.push(`El plan de energía es «${s.power.name || "el actual"}» y el procesador está trabajando mucho: «Alto rendimiento» acelera la IA (gasta más batería).`);
  }
  return tips;
}
