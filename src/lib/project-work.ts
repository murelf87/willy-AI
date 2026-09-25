// SUPER WILLY trabajando SOBRE un proyecto (rediseño, fase 5): la IA ve los archivos de verdad del proyecto (los que caben,
// empezando por los que tienen que ver con lo que pides), sabe cómo devolver los cambios y lo que devuelve se comprueba antes
// de tocar nada: un archivo cortado, con «... resto igual» o con restos de la respuesta NUNCA sustituye al bueno.
// Reutiliza lo que ya usa la Autoconstrucción (extractFiles/extractPatches, applyPatch y validateContent). Lógica pura.

import { extractFiles, extractPatches, type GeneratedFile } from "@/lib/ai-standard";
import { applyPatch, validateContent } from "@/lib/patch-apply";
import { termsOf } from "@/lib/code-focus";
import { looksSensitive } from "@/lib/auto-engine";

/**
 * Archivos que NUNCA van a una IA externa: los .env y los que llevan claves de API, claves privadas, DNI, IBAN o tarjetas.
 * (Un campo «password: string» de un formulario no cuenta: es código, no una contraseña.)
 */
export function isPrivateFile(file: { path: string; content: string }): boolean {
  if (/(?:^|\/)\.env(?:\.|$)/i.test(file.path)) return true;
  const found = looksSensitive(file.content);
  return Boolean(found) && found !== "una contraseña";
}

/**
 * Los papeles (agentes) que SUPER WILLY tiene en cuenta al construir o cambiar un proyecto (se activan en Centro de
 * Inteligencia → Agentes). No son programas aparte ni usan otro modelo: contesta la IA de SUPER WILLY.
 */
export const AGENTS = [
  { name: "Analist", role: "Analiza lo que pides y decide la estructura y los archivos." },
  { name: "Programmer", role: "Escribe y modifica el código." },
  { name: "Tester", role: "Repasa que todo funcione y propone pruebas." },
  { name: "Debugger", role: "Busca y corrige los errores." },
  { name: "Designer", role: "Cuida el diseño: estilos, colores y componentes." },
];

/** La línea de los agentes activos para la IA (vacía si no hay ninguno). */
export function agentsLine(active: string[]): string {
  const on = AGENTS.filter((a) => active.includes(a.name));
  return on.length ? `PAPELES ACTIVOS AL TRABAJAR EN EL PROYECTO (agentes): ${on.map((a) => `${a.name} — ${a.role}`).join(" · ")}` : "";
}

/** Cómo trabajar sobre un proyecto que ya existe (va en el mensaje de sistema, después de las reglas de calidad). */
export const PROJECT_WORK_RULES = `TRABAJAS SOBRE UN PROYECTO QUE YA EXISTE (SUPER WILLY):
1. Parte de sus archivos actuales (abajo). No empieces de cero salvo que el dueño lo pida.
2. Si cambias algo, entrega CADA archivo que cambies COMPLETO, en un bloque \`\`\`lenguaje ruta/exacta (la misma ruta que ya tiene). No entregues los archivos que no cambian: se conservan tal cual.
3. Si un archivo es muy grande, puedes entregar solo sustituciones exactas, así:
\`\`\`replace ruta/exacta
<<<<<<< SEARCH
(líneas copiadas EXACTAMENTE del archivo actual)
=======
(líneas nuevas)
>>>>>>> REPLACE
\`\`\`
4. Nunca escribas «...», «resto del código igual» ni partes omitidas: lo que entregues sustituye al archivo actual. Si falta algo, WILLY no guarda ese archivo.
5. Si el cambio se ve en pantalla y el proyecto tiene vista-previa.html, entrega también vista-previa.html completo y al día (es lo que el dueño ve en la vista previa).
6. Si el dueño solo pregunta algo, responde sin archivos.
7. Solo puedes cambiar archivos cuyo contenido veas abajo; si hace falta tocar otro, dilo y pídelo.`;

const SKIP_CONTENT = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$|\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp3|mp4|zip|pdf)$/i;
const PREVIEW = /(?:^|\/)(?:vista-previa|index)\.html?$/i;
const norm = (text: string): string => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const lineCount = (text: string): number => text.split("\n").length;

export type FilesContext = { block: string; included: string[]; omitted: string[] };

/**
 * Los archivos del proyecto para la IA: TODOS por su nombre y, completos, los que quepan en el presupuesto, empezando por los
 * que nombras, la vista previa y los que contienen las palabras de tu petición.
 */
export function filesContext(files: GeneratedFile[], request: string, budget = 40_000, opts: { exclude?: (file: GeneratedFile) => boolean } = {}): FilesContext {
  if (!files.length) return { block: "", included: [], omitted: [] };
  const excluded = new Set(files.filter((f) => opts.exclude?.(f)).map((f) => f.path));
  const wanted = norm(request);
  const { words, phrases } = termsOf(request);
  const scored = files.map((file, index) => {
    const path = norm(file.path);
    const base = path.split("/").pop() ?? path;
    const content = norm(file.content);
    let score = 0;
    if (wanted.includes(path) || (base.length > 4 && wanted.includes(base))) score += 100;
    if (PREVIEW.test(file.path)) score += 40;
    for (const word of words) if (content.includes(word)) score += 3;
    for (const phrase of phrases) if (content.includes(phrase)) score += 8;
    if (SKIP_CONTENT.test(file.path) || excluded.has(file.path)) score = -1;
    return { file, score, index };
  });
  const order = [...scored].sort((x, y) => y.score - x.score || x.file.content.length - y.file.content.length || x.index - y.index);
  const included = new Set<string>();
  let used = 0;
  for (const { file, score } of order) {
    if (score < 0) continue;
    const size = file.content.length + file.path.length + 40;
    // El más relevante (normalmente la vista previa) entra aunque se pase un poco: sin él no se podría cambiar lo que se ve.
    const room = included.size === 0 ? Math.round(budget * 1.8) : budget;
    if (used + size > room) continue;
    included.add(file.path);
    used += size;
  }
  const list = files.map((f) => `- ${f.path} (${lineCount(f.content)} líneas)${included.has(f.path) ? "" : excluded.has(f.path) ? " · PRIVADO: no sale del equipo del dueño (no lo has visto)" : " · NO incluido: no lo has visto"}`);
  const bodies = files
    .filter((f) => included.has(f.path))
    .map((f) => `\`\`\`${f.lang || ""} ${f.path}\n${f.content.trimEnd()}\n\`\`\``);
  return {
    block: [
      `ARCHIVOS ACTUALES DEL PROYECTO (${files.length}):`,
      ...list,
      bodies.length ? `\nCONTENIDO ACTUAL (${bodies.length} de ${files.length}):\n\n${bodies.join("\n\n")}` : "",
    ].filter(Boolean).join("\n"),
    included: files.filter((f) => included.has(f.path)).map((f) => f.path),
    omitted: files.filter((f) => !included.has(f.path)).map((f) => f.path),
  };
}

export type AppliedAnswer = {
  /** Todos los archivos del proyecto con los cambios aceptados. */
  files: GeneratedFile[];
  changed: string[];
  added: string[];
  /** Lo que la respuesta traía pero NO se guarda (y por qué): el archivo bueno se conserva. */
  rejected: Array<{ path: string; reason: string }>;
};

const keyOf = (path: string): string => path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
const CODE_FILE = /\.(?:tsx?|jsx?|mjs|cjs|css|scss|html?|json|vue|svelte|py|php|java|cs|go|rs|rb|kt|swift|c|cpp|h)$/i;

/**
 * Aplica una respuesta de la IA a los archivos del proyecto: archivos completos (nuevos o sustituidos) y sustituciones
 * SEARCH/REPLACE. Cada archivo se comprueba antes (vacío, cortado, «... resto igual», restos de la respuesta, JSON roto…).
 */
export function applyAnswer(current: GeneratedFile[], answer: string): AppliedAnswer {
  const known = current.map((f) => f.path);
  const byKey = new Map(current.map((f) => [keyOf(f.path), f]));
  const next = new Map(byKey);
  const changed: string[] = [];
  const added: string[] = [];
  const rejected: AppliedAnswer["rejected"] = [];

  for (const file of extractFiles(answer, known)) {
    const key = keyOf(file.path);
    const previous = byKey.get(key);
    // «Menos de la mitad = cortado» vale para el código; un documento (plan, estado, README) sí puede quedar más corto.
    const reason = validateContent(file.path, file.content, previous?.content ?? null, CODE_FILE.test(file.path));
    if (reason) { rejected.push({ path: previous?.path ?? file.path, reason }); continue; }
    if (previous && previous.content === file.content) continue;
    next.set(key, previous ? { ...file, path: previous.path } : file);
    (previous ? changed : added).push(previous?.path ?? file.path);
  }

  for (const patch of extractPatches(answer, known)) {
    const key = keyOf(patch.path);
    const base = next.get(key);
    if (!base) { rejected.push({ path: patch.path, reason: `${patch.path}: ese archivo no existe en el proyecto.` }); continue; }
    const r = applyPatch(base.content, patch.search, patch.replace);
    if (!r.ok) { rejected.push({ path: base.path, reason: `${base.path}: ${r.error}` }); continue; }
    const reason = validateContent(base.path, r.content, base.content, false);
    if (reason) { rejected.push({ path: base.path, reason }); continue; }
    next.set(key, { ...base, content: r.content });
    if (!changed.includes(base.path) && !added.includes(base.path)) changed.push(base.path);
  }

  return { files: [...next.values()], changed, added, rejected };
}
