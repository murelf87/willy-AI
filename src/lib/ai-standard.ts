// Estándar de calidad de código que WILLY AI envía a tu modelo local en cada generación.
// Así, cualquier software o página web que pida el usuario sale con calidad de senior,
// independientemente del modelo (Ollama, LM Studio...) que tenga configurado.

export type GeneratedFile = { path: string; lang: string; content: string };
export type GeneratedPatch = { path: string; search: string; replace: string };

const REFUSAL_PATTERNS = [
  /\bno (?:puedo|puede|es posible) (?:generar|crear|modificar|implementar|escribir)/i,
  /\blo siento[^\n]{0,100}\b(?:no puedo|no es posible)/i,
  /\b(?:como (?:una? )?(?:ia|modelo de lenguaje)|as an ai)\b/i,
  /\b(?:i (?:cannot|can't)|unable to) (?:generate|create|modify|implement|write)/i,
];

/**
 * Detecta una negativa del modelo para no reutilizarla como código o propuesta.
 * Solo mira el texto explicativo: el código entregado puede contener frases como
 * «no puedo generar» (por ejemplo, las propias reglas de WILLY) sin que sea una negativa.
 */
export function looksLikeRefusal(text: string): boolean {
  const clean = text.trim();
  if (!clean) return true;
  const prose = clean.replace(/```[\s\S]*?(?:```|$)/g, " ");
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(prose));
}

export const SYSTEM_PROMPT = `Eres WILLY AI, un ingeniero de software senior que trabaja en el equipo del usuario. Cuando te pidan software o páginas web, entregas código con calidad profesional, como haría un desarrollador senior.

REGLAS DE CALIDAD (obligatorias en todo lo que generes):
1. Código limpio y legible: nombres claros y descriptivos, funciones pequeñas con una sola responsabilidad, sin código muerto ni duplicado.
2. Arquitectura ordenada: componentes pequeños, lógica reutilizable extraída a hooks o utilidades, y una estructura de carpetas coherente.
3. Tipado estricto en TypeScript (sin \`any\` innecesario) y validación de datos en los límites.
4. Estilo con clases utilitarias (Tailwind) y tokens semánticos; nunca colores ni valores literales incrustados en los componentes.
5. Diseño responsive SIEMPRE (móvil primero): la interfaz debe verse perfecta de 320px a 2560px, sin desbordes horizontales, sin texto cortado y sin barras de scroll laterales. Usa rejillas fluidas (grid/flex con minmax, auto-fit, clamp), imágenes con max-width:100%, y puntos de corte para móvil, tablet y escritorio.
6. Simetría y equilibrio visual obligatorios: rejillas alineadas, espaciado consistente basado en una escala (4/8px), tarjetas de la misma altura en una fila, contenido centrado con un ancho máximo y márgenes iguales a ambos lados.
7. Accesibilidad: etiquetas, foco visible, contraste suficiente y roles correctos; estados de carga, vacío y error bien cuidados.
8. TODOS los botones y controles deben quedar 100% funcionales: cada botón, enlace, pestaña, menú, formulario y modal que crees tiene su manejador real y su comportamiento completo (abrir, cerrar, validar, guardar, filtrar, navegar). Está prohibido dejar un control decorativo, un enlace \`href="#"\` sin acción o un \`TODO\`. Si una acción necesita datos, usa un estado local realista para que funcione igualmente.
9. Comentarios breves y útiles solo donde aportan; el código se explica solo.
10. Para webs, tiendas, paneles o apps: entrega el PROYECTO COMPLETO con el mismo estándar de código que WILLY AI (Vite + React 19 + TypeScript estricto + Tailwind CSS v4, rutas por archivos, componentes reutilizables, formularios validados; con package.json, vite.config.ts, tsconfig.json, index.html, src/main.tsx, páginas, componentes, estilos, datos de ejemplo, README.md y .gitignore), listo para entregar a un cliente. Y ADEMÁS, siempre, \`vista-previa.html\`: un único archivo autocontenido (HTML, CSS y JS dentro, sin dependencias externas) con la web completa funcionando, responsive y con todos sus botones operativos, para verla al momento en la vista previa de WILLY. Ese archivo se abre tal cual en el navegador, sin compilar: JavaScript normal del navegador (nada de JSX, TypeScript ni import de librerías desde internet); si no, la vista previa da «Unexpected token '<'». Solo si te piden expresamente «una página suelta» o «solo HTML», basta con \`index.html\` autocontenido.

FORMATO DE RESPUESTA (obligatorio):
1. Empieza con una explicación breve en español (máximo 5 líneas) de lo que has construido y las decisiones tomadas.
2. Después, entrega CADA archivo completo en un bloque de código cuyo encabezado incluye el lenguaje y la ruta exacta, así:
\`\`\`tsx src/App.tsx
...código completo del archivo...
\`\`\`
3. Nunca escribas "...", "resto del código" ni omitas nada: entrega archivos completos y listos para usar.
4. No preguntes si quieres que continúes: entrega el resultado completo de una vez.
5. Antes de entregar, repasa esta lista y corrige lo que falle: (a) se ve bien en móvil, tablet y escritorio sin desbordes; (b) todo está alineado y simétrico; (c) cada botón y control tiene su acción real implementada.`;

/** Contexto del proyecto que se añade al mensaje de sistema. */
export function buildProjectContext(s: {
  project: string;
  model: string;
  agents: string[];
  tools: string[];
  files: GeneratedFile[];
}): string {
  return [
    "CONTEXTO DEL PROYECTO:",
    `- Proyecto activo: ${s.project}`,
    `- Modelo local: ${s.model}`,
    `- Agentes activos: ${s.agents.join(", ")}`,
    s.tools.length ? `- Herramientas: ${s.tools.join(", ")}` : "",
    s.files.length
      ? `- Archivos ya generados (mantén la coherencia y entrega solo los que cambien):\n${s.files.map((f) => `  - ${f.path}`).join("\n")}`
      : "- Proyecto nuevo: genera la estructura completa desde cero.",
  ]
    .filter(Boolean)
    .join("\n");
}

function guessLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", json: "json", css: "css",
    html: "html", md: "md", py: "python", sh: "bash", sql: "sql", yml: "yaml",
  };
  return map[ext] ?? ext;
}

const PATH_LABELLED = /(?:file|path|archivo|ruta)\s*(?:=|:)?\s*["'`]?((?:src|public)\/[\w@()./\-]+\.[A-Za-z0-9]+|(?:package|tsconfig)[\w.-]*\.json|vite\.config(?:\.local)?\.ts)/i;
const PATH_DIRECT = /(?:^|[\s`'"(])((?:src|public)\/[\w@()./\-]+\.[A-Za-z0-9]+|(?:package|tsconfig)[\w.-]*\.json|vite\.config(?:\.local)?\.ts)(?=$|[\s`'"),:])/i;

/** Busca una ruta de archivo del proyecto dentro de un trozo de texto. */
function findPath(value: string): string {
  const labelled = value.match(PATH_LABELLED);
  if (labelled?.[1]) return labelled[1];
  return value.match(PATH_DIRECT)?.[1] ?? "";
}

/**
 * Los modelos pequeños suelen escribir «voice-input.ts» o «**Archivo: voice-input.ts**» antes del bloque
 * en vez de la ruta completa. Si ese nombre coincide con uno de los archivos que se le dieron, se usa su ruta.
 * Gana el mencionado más cerca del bloque.
 */
function pathFromMention(before: string, known: string[]): string {
  let best = "";
  let bestAt = -1;
  for (const full of known) {
    const base = full.split("/").pop() ?? full;
    const at = Math.max(before.lastIndexOf(full), base.length > 3 ? before.lastIndexOf(base) : -1);
    if (at > bestAt) {
      bestAt = at;
      best = full;
    }
  }
  return best;
}

/** true si el contenido es una sustitución SEARCH/REPLACE o un diff, no un archivo completo. */
function isEditInstruction(lang: string, content: string): boolean {
  if (/^(?:replace|patch|diff)$/i.test(lang)) return true;
  if (/^<{5,9}\s*SEARCH\s*$/m.test(content) || /^>{5,9}\s*REPLACE\s*$/m.test(content)) return true;
  return /^(?:diff --git |@@ -\d)/m.test(content);
}

/** Interpreta la cabecera de un bloque de código («tsx src/a.ts», «ts:src/a.ts», «file="src/a.ts"»…). */
function pathFromHeader(info: string): { path: string; lang: string } {
  const cleaned = info
    .replace(/^(?:file|path|archivo|ruta)\s*=\s*["']?/i, "")
    .replace(/^([\w+-]+):(?=[\w@./-]+\.[A-Za-z0-9]+$)/, "$1 ")
    .replace(/["']$/, "")
    .trim();
  const tokens = cleaned.split(/\s+/);
  const candidate = (tokens.find((token) => /[\\/]|\.[A-Za-z0-9]+$/.test(token) && !/^[A-Za-z0-9+-]+$/.test(token)) ?? tokens.at(-1) ?? "")
    .replace(/^[:"']+|["',:]+$/g, "")
    .replace(/\\/g, "/");
  const lang = tokens[0] && !tokens[0].includes(".") && !tokens[0].includes("/") ? tokens[0] : "";
  return { path: candidate, lang };
}

/**
 * Extrae los archivos de la respuesta del modelo.
 * Formato esperado: bloques de código cuyo encabezado lleva la ruta, p. ej.
 * ```tsx src/App.tsx  /  ```html index.html  /  ```ts:src/lib/api.ts
 */
export function extractFiles(text: string, fallbackPaths: string[] = []): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const add = (rawPath: string, content: string, declaredLang = "") => {
    const path = rawPath
      .trim()
      .replace(/^[`'"\s:=-]+|[`'"\s,:;-]+$/g, "")
      .replace(/^\.\//, "")
      .replace(/\\/g, "/");
    const looksLikePath = /^[\w./@()[\]-]+\.[A-Za-z0-9]+$/.test(path);
    if (!looksLikePath || !content.trim() || files.some((file) => file.path === path)) return;
    // Una sustitución SEARCH/REPLACE o un diff NUNCA es un archivo completo.
    if (isEditInstruction(declaredLang, content)) return;
    files.push({ path, lang: declaredLang || guessLang(path), content: `${content.trimEnd()}\n` });
  };
  const re = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const info = (match[1] ?? "").trim();
    const content = (match[2] ?? "").trimEnd();
    if (!content) continue;
    // Rev23: los bloques «plan» y «plan-json» son el progreso del proyecto que da WILLY, NUNCA un archivo (sin esto, un bloque
    // sin ruta podía acabar guardado encima del único archivo del proyecto).
    if (/^plan(?:-json)?$/i.test(info)) continue;
    // Acepta "lang ruta", "lang:ruta", "ruta", "file=\"ruta\"" y rutas
    // precedidas por etiquetas habituales de modelos locales pequeños.
    const cleaned = info
      .replace(/^(?:file|path|archivo|ruta)\s*=\s*["']?/i, "")
      .replace(/^([\w+-]+):(?=[\w@./-]+\.[A-Za-z0-9]+$)/, "$1 ")
      .replace(/["']$/, "")
      .trim();
    const tokens = cleaned.split(/\s+/);
    let candidate = (tokens.find((token) => /[\\/]|\.[A-Za-z0-9]+$/.test(token) && !/^[A-Za-z0-9+-]+$/.test(token)) ?? tokens.at(-1) ?? "")
      .replace(/^[:"']+|["',:]+$/g, "")
      .replace(/\\/g, "/");
    // Los modelos locales suelen poner la ruta en un título anterior o en la
    // primera línea del bloque en vez de escribirla tras ```tsx.
    if (!candidate.includes(".")) {
      const before = text.slice(Math.max(0, match.index - 240), match.index);
      candidate = findPath(`${content.split("\n").slice(0, 4).join("\n")}\n${before}`);
    }
    if (!candidate.includes(".")) candidate = pathFromMention(text.slice(Math.max(0, match.index - 240), match.index), fallbackPaths);
    if (!candidate.includes(".") && fallbackPaths.length === 1) candidate = fallbackPaths[0] ?? "";
    const declaredLang = tokens[0] && !tokens[0].includes(".") && !tokens[0].includes("/") ? tokens[0] : "";
    const cleanContent = content.replace(/^\s*(?:\/\/|#|<!--)\s*(?:file|path|archivo|ruta)?\s*(?:=|:)?\s*["'`]?[^\n]+\.[A-Za-z0-9]+["'`]?\s*(?:-->)?\s*\n/i, "");
    add(candidate, cleanContent, declaredLang);
  }

  // Formato XML empleado por algunos modelos: <file path="src/a.ts">…</file>.
  const xml = /<file\s+path=["']([^"']+)["'][^>]*>([\s\S]*?)<\/file>/gi;
  while ((match = xml.exec(text))) add(match[1] ?? "", match[2] ?? "");

  // Formato sin fences: FILE: src/a.ts seguido del archivo hasta la próxima ruta.
  const marker = /^(?:#{1,6}\s*)?(?:FILE|PATH|ARCHIVO|RUTA)?\s*(?:=|:|-)?\s*[`"']?((?:src|public)\/[\w@()./\-]+\.[A-Za-z0-9]+|(?:package|tsconfig)[\w.-]*\.json|vite\.config(?:\.local)?\.ts)[`"']?\s*$/gim;
  const markers = [...text.matchAll(marker)];
  for (let index = 0; index < markers.length; index += 1) {
    const current = markers[index];
    if (!current) continue;
    const start = (current.index ?? 0) + current[0].length;
    const end = markers[index + 1]?.index ?? text.length;
    const content = text.slice(start, end).replace(/^\s*```[^\n]*\n?/, "").replace(/```\s*$/, "");
    add(current[1] ?? "", content);
  }
  return files;
}

/**
 * Extrae sustituciones (SEARCH/REPLACE) para modificar archivos grandes sin obligar
 * a un modelo local a repetir decenas de miles de caracteres sin errores.
 *
 * Acepta la ruta en la cabecera del bloque con cualquier lenguaje (```replace src/a.ts,
 * ```tsx src/a.ts…), en el texto inmediatamente anterior o, si solo hay un archivo
 * candidato, sin ruta. Tolera CRLF, marcadores con espacios y REPLACE vacío (borrar código).
 * Un bloque al que le falta el cierre `>>>>>>> REPLACE` se descarta por estar cortado.
 */
export function extractPatches(text: string, fallbackPaths: string[] = []): GeneratedPatch[] {
  const patches: GeneratedPatch[] = [];
  const source = text.replace(/\r\n?/g, "\n");
  const fences = /```([^\n]*)\n([\s\S]*?)(?:\n```|$)/g;
  let fence: RegExpExecArray | null;
  while ((fence = fences.exec(source))) {
    const body = fence[2] ?? "";
    if (!/^<{5,9}\s*SEARCH\s*$/m.test(body)) continue;

    let path = pathFromHeader((fence[1] ?? "").trim()).path;
    if (!path.includes(".")) {
      const before = source.slice(Math.max(0, fence.index - 240), fence.index);
      path = findPath(`${body.split("\n").slice(0, 3).join("\n")}\n${before}`);
    }
    if (!path.includes(".")) path = pathFromMention(source.slice(Math.max(0, fence.index - 240), fence.index), fallbackPaths);
    if (!path.includes(".") && fallbackPaths.length === 1) path = fallbackPaths[0] ?? "";
    path = path.replace(/^\.\//, "").replace(/\\/g, "/");
    if (!path) continue;

    const lines = body.split("\n");
    let index = 0;
    while (index < lines.length) {
      if (!/^<{5,9}\s*SEARCH\s*$/.test((lines[index] ?? "").trim())) {
        index += 1;
        continue;
      }
      index += 1;
      const search: string[] = [];
      const replace: string[] = [];
      while (index < lines.length && !/^={5,9}\s*$/.test((lines[index] ?? "").trim())) search.push(lines[index++] ?? "");
      const separated = index < lines.length;
      index += 1;
      while (separated && index < lines.length && !/^>{5,9}\s*REPLACE\s*$/.test((lines[index] ?? "").trim())) replace.push(lines[index++] ?? "");
      const closed = separated && index < lines.length;
      index += 1;
      const searchText = search.join("\n");
      if (!closed || !searchText.trim()) continue;
      if (!patches.some((entry) => entry.path === path && entry.search === searchText)) {
        patches.push({ path, search: searchText, replace: replace.join("\n") });
      }
    }
  }
  return patches;
}
