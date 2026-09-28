/**
 * self-audit.ts — sistema de autoauditoría para WILLY AI
 * La IA local puede llamar a estas funciones desde Autoconstrucción
 * para detectar y reportar errores de compilación sin intervención humana.
 */

export type AuditResult = {
  ok: boolean;
  errors: Array<{ file: string; line: number; message: string; code: string }>;
  warnings: Array<{ file: string; line: number; message: string }>;
  summary: string;
  timestamp: number;
};

/**
 * Ejecuta tsc --noEmit para detectar errores TypeScript.
 * Devuelve una lista de errores parseada, lista para que la IA los corrija.
 */
export async function runTypeCheck(projectRoot: string): Promise<AuditResult> {
  const cp = await import("node:child_process");
  const util = await import("node:util");
  const execFile = util.promisify(cp.execFile);
  const timestamp = Date.now();

  try {
    await execFile("npx", ["tsc", "--noEmit", "--pretty", "false"], {
      cwd: projectRoot,
      timeout: 60_000,
    });
    return { ok: true, errors: [], warnings: [], summary: "Sin errores TypeScript.", timestamp };
  } catch (err: unknown) {
    const output = (err as { stdout?: string; stderr?: string }).stdout ?? (err as { message?: string }).message ?? "";
    const errors: AuditResult["errors"] = [];
    const warnings: AuditResult["warnings"] = [];

    for (const line of output.split("\n")) {
      const m = line.match(/^(.+)\((\d+),\d+\): (error|warning) (TS\d+): (.+)$/);
      if (!m) continue;
      const [, file, lineNum, severity, code, message] = m;
      if (severity === "error") {
        errors.push({ file: file!.trim(), line: Number(lineNum), message: message!.trim(), code: code!.trim() });
      } else {
        warnings.push({ file: file!.trim(), line: Number(lineNum), message: message!.trim() });
      }
    }

    const summary = errors.length
      ? `${errors.length} error(es) TypeScript encontrado(s). El primero: ${errors[0]!.file}:${errors[0]!.line} — ${errors[0]!.message}`
      : "Sin errores (solo advertencias).";

    return { ok: errors.length === 0, errors, warnings, summary, timestamp };
  }
}

/**
 * Versión rápida: solo comprueba un archivo concreto.
 */
export async function checkFile(projectRoot: string, filePath: string): Promise<AuditResult> {
  const cp = await import("node:child_process");
  const util = await import("node:util");
  const execFile = util.promisify(cp.execFile);
  const timestamp = Date.now();

  try {
    await execFile("npx", ["tsc", "--noEmit", "--pretty", "false", filePath], {
      cwd: projectRoot,
      timeout: 30_000,
    });
    return { ok: true, errors: [], warnings: [], summary: `${filePath}: sin errores.`, timestamp };
  } catch (err: unknown) {
    const output = (err as { stdout?: string; stderr?: string }).stdout ?? (err as { message?: string }).message ?? "";
    const errors: AuditResult["errors"] = [];
    for (const line of output.split("\n")) {
      const m = line.match(/^(.+)\((\d+),\d+\): error (TS\d+): (.+)$/);
      if (!m) continue;
      const [, file, lineNum, code, message] = m;
      errors.push({ file: file!.trim(), line: Number(lineNum), message: message!.trim(), code: code!.trim() });
    }
    return { ok: errors.length === 0, errors, warnings: [], summary: errors.length ? `${errors.length} error(es) en ${filePath}` : "Sin errores.", timestamp };
  }
}
