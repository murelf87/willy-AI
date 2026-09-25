// AUTOCONSTRUCCIÓN · COMPROBACIÓN DE TIPOS (TypeScript). Compilar no basta: el empaquetador genera el programa aunque el
// código tenga errores de tipos (un nombre de campo mal escrito, una función llamada con lo que no toca…). Aquí se ejecuta
// el comprobador de TypeScript de la propia instalación sobre la versión candidata y se compara con la versión actual:
// solo BLOQUEA un error NUEVO (los que ya existían antes de la mejora no son culpa suya). Se guarda lo aprendido en disco
// («incremental»), así que después de la primera vez solo se revisa lo que cambia.

export type TsDiagnostic = { file: string; line: number; col: number; code: string; message: string };
export type TypecheckStatus = "ok" | "errors" | "unavailable" | "timeout" | "failed";
export type TypecheckResult = { status: TypecheckStatus; diagnostics: TsDiagnostic[]; detail: string; ms: number };

/** Archivo donde TypeScript guarda lo ya comprobado (dentro de copias-autoconstruccion; nunca se borra al limpiar copias). */
export const TYPECHECK_CACHE = "tipos-candidata.tsbuildinfo";
/** La primera comprobación completa tarda unos minutos en un portátil; después, segundos. */
export const TYPECHECK_TIMEOUT_MS = 8 * 60_000;

const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const GLOBAL = /^error (TS\d+): (.*)$/;

/** Lee la salida de «tsc --pretty false»: una línea por error (las siguientes, sangradas, son detalle del mismo error). */
export function parseTscOutput(text: string): TsDiagnostic[] {
  const out: TsDiagnostic[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const hit = LINE.exec(line);
    if (hit) {
      out.push({ file: hit[1]!.replace(/\\/g, "/"), line: Number(hit[2]), col: Number(hit[3]), code: hit[4]!, message: hit[5]!.trim() });
      continue;
    }
    const global = GLOBAL.exec(line);
    if (global) out.push({ file: "", line: 0, col: 0, code: global[1]!, message: global[2]!.trim() });
  }
  return out;
}

/** Clave de un error sin el número de línea (un cambio arriba en el archivo mueve las líneas de los errores de siempre). */
const keyOf = (d: TsDiagnostic) => `${d.file}\u0000${d.code}\u0000${d.message}`;

/** Errores que tiene la candidata y NO tenía la versión actual (contando repeticiones: 2 antes y 3 ahora = 1 nuevo). */
export function newDiagnostics(baseline: TsDiagnostic[], candidate: TsDiagnostic[]): TsDiagnostic[] {
  const left = new Map<string, number>();
  for (const d of baseline) left.set(keyOf(d), (left.get(keyOf(d)) ?? 0) + 1);
  const out: TsDiagnostic[] = [];
  for (const d of candidate) {
    const k = keyOf(d);
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else out.push(d);
  }
  return out;
}

export function describeDiagnostics(list: TsDiagnostic[], max = 8): string {
  const lines = list.slice(0, max).map((d) => (d.file ? `${d.file}:${d.line}:${d.col} ${d.code}: ${d.message}` : `${d.code}: ${d.message}`));
  if (list.length > max) lines.push(`… y ${list.length - max} más.`);
  return lines.join("\n");
}

/**
 * Ejecuta el TypeScript de la instalación (`root/node_modules/typescript`) sobre `cwd/tsconfig.json`, sin generar nada.
 * Nunca lanza errores: si no se puede comprobar, lo dice (unavailable / timeout / failed) y la mejora sigue «sin comprobar».
 */
export async function runTypecheck(root: string, cwd: string, opts: { buildInfo?: string; timeoutMs?: number; nodePath?: string } = {}): Promise<TypecheckResult> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const started = Date.now();
  const done = (status: TypecheckStatus, diagnostics: TsDiagnostic[], detail: string): TypecheckResult => ({ status, diagnostics, detail, ms: Date.now() - started });
  const tsc = path.join(root, "node_modules", "typescript", "lib", "tsc.js");
  try {
    await fs.access(tsc);
    await fs.access(path.join(cwd, "tsconfig.json"));
  } catch {
    return done("unavailable", [], "Esta instalación no tiene el comprobador de TypeScript.");
  }
  const buildInfo = opts.buildInfo ?? path.join(root, "copias-autoconstruccion", TYPECHECK_CACHE);
  await fs.mkdir(path.dirname(buildInfo), { recursive: true }).catch(() => undefined);
  try {
    const { spawn } = await import("node:child_process");
    const args = [tsc, "--noEmit", "--pretty", "false", "--incremental", "--tsBuildInfoFile", buildInfo, "-p", path.join(cwd, "tsconfig.json")];
    const result = await new Promise<{ code: number | null; output: string; timedOut: boolean; error?: string }>((resolve) => {
      let output = "";
      let finished = false;
      const child = spawn(opts.nodePath ?? process.execPath, args, { cwd, windowsHide: true, env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" } });
      const finish = (value: { code: number | null; output: string; timedOut: boolean; error?: string }) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* ya terminado */ }
        finish({ code: null, output, timedOut: true });
      }, opts.timeoutMs ?? TYPECHECK_TIMEOUT_MS);
      child.stdout?.on("data", (chunk) => { if (output.length < 4_000_000) output += String(chunk); });
      child.stderr?.on("data", (chunk) => { if (output.length < 4_000_000) output += String(chunk); });
      child.on("error", (error) => finish({ code: null, output, timedOut: false, error: error.message }));
      child.on("close", (code) => finish({ code, output, timedOut: false }));
    });
    if (result.timedOut) return done("timeout", [], `La comprobación de tipos no terminó en ${Math.round((opts.timeoutMs ?? TYPECHECK_TIMEOUT_MS) / 60_000)} minutos.`);
    if (result.error) return done("failed", [], `No se pudo ejecutar TypeScript: ${result.error}`);
    const diagnostics = parseTscOutput(result.output);
    if (result.code === 0) return done("ok", [], "Sin errores de tipos.");
    if (diagnostics.length) return done("errors", diagnostics, `${diagnostics.length} error(es) de tipos.`);
    return done("failed", [], `TypeScript terminó con el código ${String(result.code)} sin decir por qué: ${result.output.trim().slice(-400)}`);
  } catch (error) {
    return done("failed", [], `No se pudo ejecutar TypeScript: ${error instanceof Error ? error.message : String(error)}`);
  }
}
