// Lógica pura (sin acceso a disco) para aplicar las sustituciones que propone el
// modelo local y para comprobar el código generado ANTES de guardarlo.
// Está separada del servidor para poder probarla de forma aislada.

export type PatchResult = { ok: true; content: string; mode: "exacto" | "flexible" } | { ok: false; error: string };

function toLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
}

function collapse(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function leadingSpace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

/** Quita los números de línea («123: código») que el contexto de archivos grandes muestra al modelo. */
function stripLineNumbers(lines: string[]): string[] | null {
  const filled = lines.filter((line) => line.trim() !== "");
  if (!filled.length) return null;
  if (!filled.every((line) => /^\s*\d{1,6}\s?[:|]\s?/.test(line))) return null;
  return lines.map((line) => line.replace(/^\s*\d{1,6}\s?[:|]\s?/, ""));
}

function snippet(search: string): string {
  const first = search.split("\n").find((line) => line.trim() !== "") ?? search;
  return first.trim().slice(0, 110);
}

/** Distancia de edición aproximada y barata (no exacta, solo para ordenar candidatos), pensada para líneas cortas de código. */
function roughDistance(a: string, b: string): number {
  if (a === b) return 0;
  const shared = new Set(a).size + new Set(b).size;
  let common = 0;
  for (const ch of new Set(a)) if (b.includes(ch)) common += 1;
  const lenDiff = Math.abs(a.length - b.length);
  return lenDiff + (shared - common * 2);
}

/**
 * Cuando el SEARCH no se encuentra en el archivo, busca las líneas reales más
 * parecidas a la primera línea no vacía del SEARCH y devuelve unas pocas líneas
 * de contexto EXACTO alrededor, tal como están en el archivo. Esto se le pasa
 * de vuelta al modelo en el siguiente intento para que copie el texto real en
 * vez de repetir el mismo error.
 */
function closestRealContext(fileLines: string[], wantedFirstLine: string): string | null {
  const target = collapse(wantedFirstLine);
  if (!target) return null;
  let bestIdx = -1;
  let bestScore = Infinity;
  for (let i = 0; i < fileLines.length; i += 1) {
    const line = collapse(fileLines[i]!);
    if (!line) continue;
    const score = roughDistance(target, line);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const from = Math.max(0, bestIdx - 1);
  const to = Math.min(fileLines.length, bestIdx + 3);
  return fileLines.slice(from, to).join("\n");
}

/**
 * Sustituye `search` por `replace` dentro de `original`.
 * 1) Coincidencia exacta y única.
 * 2) Si no aparece: ignora números de línea copiados, diferencias de sangrado,
 *    espacios al final y saltos de línea CRLF/LF, siempre que la coincidencia siga siendo ÚNICA.
 * Nunca sustituye a ciegas: si hay dudas, devuelve un error explicativo.
 */
export function applyPatch(original: string, search: string, replace: string): PatchResult {
  const crlf = original.includes("\r\n");
  const text = toLf(original);
  let needle = toLf(search);
  const newText = toLf(replace);
  if (!needle.trim()) return { ok: false, error: "El bloque SEARCH estaba vacío." };

  const finish = (content: string, mode: "exacto" | "flexible"): PatchResult => ({
    ok: true,
    content: crlf ? content.replace(/\n/g, "\r\n") : content,
    mode,
  });

  // 1) Exacta.
  const exact = countOccurrences(text, needle);
  if (exact === 1) {
    const at = text.indexOf(needle);
    return finish(`${text.slice(0, at)}${newText}${text.slice(at + needle.length)}`, "exacto");
  }
  if (exact > 1) {
    return { ok: false, error: `El texto a sustituir aparece ${exact} veces y no es único («${snippet(needle)}»). Añade más líneas de contexto alrededor.` };
  }

  // 2) Flexible, por líneas.
  let needleLines = needle.split("\n");
  const unnumbered = stripLineNumbers(needleLines);
  if (unnumbered) {
    needleLines = unnumbered;
    needle = needleLines.join("\n");
    const again = countOccurrences(text, needle);
    if (again === 1) {
      const at = text.indexOf(needle);
      return finish(`${text.slice(0, at)}${newText}${text.slice(at + needle.length)}`, "flexible");
    }
    if (again > 1) return { ok: false, error: `El texto a sustituir no es único («${snippet(needle)}»). Añade más líneas de contexto.` };
  }
  while (needleLines.length && needleLines[0]!.trim() === "") needleLines.shift();
  while (needleLines.length && needleLines[needleLines.length - 1]!.trim() === "") needleLines.pop();
  if (!needleLines.length) return { ok: false, error: "El bloque SEARCH estaba vacío." };

  const fileLines = text.split("\n");
  const wanted = needleLines.map(collapse);
  const hits: number[] = [];
  for (let start = 0; start + wanted.length <= fileLines.length; start += 1) {
    let same = true;
    for (let offset = 0; offset < wanted.length; offset += 1) {
      if (collapse(fileLines[start + offset]!) !== wanted[offset]) {
        same = false;
        break;
      }
    }
    if (same) hits.push(start);
  }

  if (hits.length === 0) {
    const real = closestRealContext(fileLines, needleLines[0] ?? "");
    const hint = real ? ` Esto es lo que hay REALMENTE en esa zona del archivo, cópialo tal cual en SEARCH:\n${real}` : "";
    return { ok: false, error: `No se encontró en el archivo el texto que debía sustituirse («${snippet(needle)}»). Copia el texto EXACTO actual, sin números de línea.${hint}` };
  }
  if (hits.length > 1) {
    return { ok: false, error: `El texto a sustituir aparece ${hits.length} veces con espacios distintos («${snippet(needle)}»). Añade más líneas de contexto.` };
  }

  const start = hits[0]!;
  const originalIndent = leadingSpace(fileLines[start]!);
  const searchIndent = leadingSpace(needleLines[0]!);
  let replacementLines = newText === "" ? [] : newText.split("\n");
  if (originalIndent !== searchIndent) {
    if (originalIndent.length > searchIndent.length && originalIndent.startsWith(searchIndent)) {
      // El modelo copió el bloque con menos sangrado del real: se lo añadimos al texto nuevo.
      const extra = originalIndent.slice(searchIndent.length);
      replacementLines = replacementLines.map((line) => (line.trim() === "" ? line : `${extra}${line}`));
    } else if (searchIndent.length > originalIndent.length && searchIndent.startsWith(originalIndent)) {
      // Lo copió con más sangrado del real: se lo quitamos al texto nuevo.
      const extra = searchIndent.slice(originalIndent.length);
      replacementLines = replacementLines.map((line) => (line.startsWith(extra) ? line.slice(extra.length) : line));
    }
  }
  const merged = [...fileLines.slice(0, start), ...replacementLines, ...fileLines.slice(start + wanted.length)];
  return finish(merged.join("\n"), "flexible");
}

const PLACEHOLDER =
  /^\s*(?:\/\/|\/\*+|\*|#|<!--|\{\/\*)[^\n]*(?:\.{3}|…)[^\n]*(?:resto|rest of|remaining|igual que|sin cambios|unchanged|omitted|omitido|existing code|código existente|codigo existente)/gim;

/**
 * Comprueba un archivo ya resuelto antes de escribirlo en disco. Devuelve el
 * motivo del rechazo, o null si es aceptable. Así un archivo cortado, con restos
 * de la respuesta del modelo o con «...» no llega nunca a sustituir al bueno.
 */
export function validateContent(path: string, content: string, previous: string | null, wholeFile: boolean): string | null {
  if (!content.trim()) return `${path}: el contenido nuevo está vacío.`;
  const countBlocks = (text: string): number => {
    const lines = text.replace(/\r/g, "").split("\n");
    let count = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^<{7}\s*(?:SEARCH|HEAD)\b/.test(lines[i]!)) {
        const sep = lines.slice(i + 1).findIndex((l) => /^=======\s*$/.test(l));
        if (sep !== -1) {
          const close = lines.slice(i + 1 + sep + 1).findIndex((l) => /^>{7}\s*REPLACE\b/.test(l));
          if (close !== -1) {
            count += 1;
            i += 1 + sep + 1 + close;
          }
        }
      }
    }
    return count;
  };
  const nowConflicts = countBlocks(content);
  const beforeConflicts = previous ? countBlocks(previous) : 0;
  if (nowConflicts > beforeConflicts) {
    return `${path}: contiene marcadores SEARCH/REPLACE sin resolver.`;
  }
  const isCode = /\.(?:tsx?|jsx?|css|json|html|mjs|cjs)$/i.test(path);
  if (isCode && /^```/m.test(content)) return JSON.stringify({ code: "INVALID_CODE", message: `${path}: contiene una línea con \`\`\` que pertenece a la respuesta del modelo, no al código.` });
  if (/\.json$/i.test(path)) {
    try {
      JSON.parse(content);
    } catch {
      return JSON.stringify({ code: "INVALID_JSON", message: `${path}: no es un JSON válido.` });
    }
  }
  if (isCode) {
    const now = content.match(PLACEHOLDER)?.length ?? 0;
    const before = previous ? (previous.match(PLACEHOLDER)?.length ?? 0) : 0;
    if (now > before) return JSON.stringify({ code: "INCOMPLETE_CODE", message: `${path}: contiene marcas de código omitido («... resto igual»). Debe entregarse completo.` });
  }
  if (wholeFile && previous && previous.length > 3000 && content.length < previous.length * 0.5) {
    return JSON.stringify({ code: "INCOMPLETE_FILE", message: `${path}: el archivo nuevo ocupa menos de la mitad que el actual (${content.length} frente a ${previous.length} caracteres); parece incompleto. Usa bloques SEARCH/REPLACE para archivos grandes.` });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Diagnóstico de errores: que el modelo reciba el error REAL (línea y motivo)
// y no la pila de llamadas interna de la herramienta de compilación.
// ---------------------------------------------------------------------------

/** Parte del módulo «typescript» que se necesita para comprobar la sintaxis. */
export type TsModule = {
  transpileModule: (source: string, options: Record<string, unknown>) => { diagnostics?: Array<{ start?: number; messageText: unknown }> };
  flattenDiagnosticMessageText: (message: unknown, newLine: string) => string;
  JsxEmit: { Preserve: number };
  ScriptTarget: { ES2022: number };
};

/**
 * Errores de sintaxis de un archivo de código («archivo:línea:columna: motivo → línea»).
 * Tarda milisegundos, frente a los minutos que tarda la compilación completa en fallar.
 */
export function syntaxProblems(ts: TsModule, path: string, content: string): string[] {
  if (!/\.(?:tsx?|jsx?|mjs|cjs)$/i.test(path)) return [];
  const result = ts.transpileModule(content, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 },
  });
  const lines = content.split("\n");
  return (result.diagnostics ?? []).slice(0, 5).map((diagnostic) => {
    const start = Math.max(0, Math.min(diagnostic.start ?? 0, content.length));
    const before = content.slice(0, start).split("\n");
    const line = before.length;
    const column = (before[before.length - 1] ?? "").length + 1;
    const text = (lines[line - 1] ?? "").trim().slice(0, 120);
    return `${path}:${line}:${column}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}${text ? ` → «${text}»` : ""}`;
  });
}

/**
 * Resume la salida de una compilación fallida: se quitan los colores, las líneas de la pila
 * de llamadas de la herramienta (`at …`, rutas de node_modules) y se conservan las que
 * describen el error. Antes solo se devolvían los últimos 1.200 caracteres, que son justo la pila.
 */
export function summarizeBuildError(output: string): string {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");
  const useful = clean
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "" && !/^\s*at\s/.test(line) && !/file:\/\/\//.test(line) && !/node_modules[\\/]/.test(line));
  const key = useful.filter((line) => /error|expected|unexpected|could not|cannot|not exported|not defined|failed|parse|\bsrc[\\/]/i.test(line));
  const chosen = (key.length ? key : useful.slice(-10)).slice(0, 14).map((line) => (line.length > 220 ? `${line.slice(0, 220)}…` : line));
  return chosen.join("\n") || "La compilación falló sin un mensaje legible.";
}
