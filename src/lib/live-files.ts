import type { GeneratedFile } from "@/lib/ai-standard";

// Lógica de la vista en directo del espacio de trabajo: qué se muestra en la
// vista previa y en el terminal mientras la IA todavía está escribiendo.
// Desde la revisión 22: cualquier página HTML del proyecto (no solo la principal), con sus estilos, scripts e imágenes SVG
// del propio proyecto dentro, y las rutas relativas resueltas desde la carpeta de la página (como un servidor de verdad).

const norm = (path: string): string => path.replace(/\\/g, "/").replace(/[?#].*$/, "").replace(/^\.?\//, "");
const base = (path: string): string => norm(path).split("/").pop() ?? path;
const lines = (text: string): number => text.split("\n").length;
const external = (ref: string): boolean => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref) || /^(?:data|blob|mailto|tel|javascript):/i.test(ref);

/** La carpeta de una ruta («blog/post.html» → «blog/»). */
const dirOf = (path: string): string => {
  const n = norm(path);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(0, i + 1) : "";
};

/** Resuelve una ruta relativa (de un enlace, un src o un href) desde la página o el archivo donde está. */
export function resolveRef(from: string, ref: string): string {
  const clean = ref.trim().replace(/[?#].*$/, "");
  if (!clean) return norm(from);
  const joined = clean.startsWith("/") ? clean.slice(1) : `${dirOf(from)}${clean}`;
  const out: string[] = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function lookup(files: GeneratedFile[], ref: string, from = ""): GeneratedFile | undefined {
  if (external(ref)) return undefined;
  const exact = resolveRef(from, ref);
  const wanted = norm(ref);
  return (
    files.find((file) => norm(file.path) === exact) ??
    files.find((file) => norm(file.path) === wanted) ??
    files.find((file) => norm(file.path).endsWith(`/${wanted}`)) ??
    files.find((file) => base(file.path) === base(wanted))
  );
}

/** Un HTML que el navegador puede pintar tal cual (no el index.html de un proyecto Vite/React, que carga src/main.tsx). */
const runnable = (file: GeneratedFile): boolean => !/<script\b[^>]*\bsrc\s*=\s*["'][^"']+\.(?:tsx?|jsx)["']/i.test(file.content);
const isHtml = (file: GeneratedFile): boolean => /\.html?$/i.test(file.path);
const svgData = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Las páginas del proyecto que se pueden ver en la vista previa (la principal primero). */
export function htmlPages(files: GeneratedFile[]): string[] {
  const pages = files.filter((file) => isHtml(file) && runnable(file)).map((file) => file.path);
  const main = mainPage(files);
  return main ? [main, ...pages.filter((p) => p !== main)] : pages;
}

/** La página que se enseña primero: «vista-previa.html»; si no, un index.html que se pueda pintar; si no, cualquier .html. */
function mainPage(files: GeneratedFile[]): string | null {
  return (
    files.find((file) => /(?:^|\/)vista-previa\.html?$/i.test(norm(file.path)))
    ?? files.find((file) => norm(file.path) === "index.html" && runnable(file))
    ?? files.find((file) => isHtml(file) && runnable(file))
  )?.path ?? null;
}

/** Imágenes SVG del proyecto que usa una hoja de estilos (url(...)), dentro de ella: la vista previa no puede pedírselas a nadie. */
export function inlineCssUrls(files: GeneratedFile[], css: string, from: string): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, _q: string, ref: string) => {
    const asset = lookup(files, ref, from);
    return asset && /\.svg$/i.test(asset.path) ? `url("${svgData(asset.content)}")` : whole;
  });
}

/**
 * Una página del proyecto lista para la vista previa: sus hojas de estilo y sus scripts locales, y sus imágenes SVG, dentro
 * (la vista previa no puede leer los demás archivos). Las rutas se resuelven desde la carpeta de la página. null si no existe
 * o no se puede pintar tal cual.
 */
export function buildPageHtml(files: GeneratedFile[], pagePath: string): string | null {
  const page = files.find((file) => norm(file.path) === norm(pagePath));
  if (!page || !isHtml(page) || !runnable(page)) return null;
  return inlineAssets(files, page.path, page.content);
}

/**
 * Mete dentro de una página sus hojas de estilo y sus scripts locales, y sus imágenes SVG (rutas resueltas desde la carpeta de
 * la página). Rev25: también lo usa la compilación de los proyectos React/Vite para su index.html.
 */
export function inlineAssets(files: GeneratedFile[], pagePath: string, source: string): string {
  const page = { path: pagePath };
  let html = source;

  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const css = href ? lookup(files, href, page.path) : undefined;
    return css && /\.css$/i.test(css.path) ? `<style>${inlineCssUrls(files, css.content, css.path).replace(/<\/style/gi, "<\\/style")}</style>` : tag;
  });

  html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs: string) => {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const script = src ? lookup(files, src, page.path) : undefined;
    if (!script || !/\.(?:js|mjs)$/i.test(script.path)) return tag;
    const rest = attrs.replace(/\s*\bsrc\s*=\s*["'][^"']*["']/i, "");
    return `<script${rest}>${script.content.replace(/<\/script/gi, "<\\/script")}</script>`;
  });

  html = html.replace(/(<(?:img|source|image|use)\b[^>]*?\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi, (whole, head: string, q: string, ref: string) => {
    const asset = lookup(files, ref, page.path);
    return asset && /\.svg$/i.test(asset.path) ? `${head}${q}${svgData(asset.content)}${q}` : whole;
  });

  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (whole, open: string, css: string, close: string) => (/url\(/i.test(css) ? `${open}${inlineCssUrls(files, css, page.path)}${close}` : whole));
  return html;
}

/**
 * Página que se enseña en la vista previa: el index.html (o el primer .html) con sus
 * hojas de estilo y scripts locales incrustados, porque la vista previa no puede leer
 * los demás archivos generados. Devuelve null si todavía no hay ninguna página.
 */
export function buildPreviewHtml(files: GeneratedFile[]): string | null {
  // Primero la vista previa autocontenida que acompaña a los proyectos completos («vista-previa.html»); si no, un index.html
  // que se pueda pintar; si no, cualquier .html pintable.
  const page = mainPage(files);
  if (!page) {
    // Proyecto React/TypeScript sin vista previa autocontenida: se explica en vez de enseñar una página vacía.
    const project = files.find((file) => /\.html?$/i.test(file.path));
    if (!project) return null;
    const list = files.map((file) => file.path).slice(0, 40).map((path) => `<li>${path.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c)}</li>`).join("");
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proyecto generado</title><style>body{margin:0;padding:32px;font-family:system-ui,sans-serif;background:#0b0d14;color:#e6e8ef}h1{font-size:20px;margin:0 0 8px}p{color:#aab0c0;line-height:1.5;max-width:60ch}ul{columns:2;font-size:12px;color:#8b93a7}code{background:#171a26;padding:2px 6px;border-radius:4px}</style></head><body><h1>Proyecto React/TypeScript generado (${files.length} archivos)</h1><p>Este proyecto se arranca con <code>npm install</code> y <code>npm run dev</code>. Para verlo aquí al momento, pide a la IA que añada <code>vista-previa.html</code> (la web completa en un solo archivo).</p><ul>${list}</ul></body></html>`;
  }
  return buildPageHtml(files, page);
}

/**
 * Qué se puede enseñar en la vista previa (rev21, taller del proyecto de SUPER WILLY): «vacio» = el proyecto no tiene archivos;
 * «sin-pagina» = tiene archivos pero ninguna página HTML; «sin-vista» = es un proyecto React/Vite sin `vista-previa.html`
 * (su index.html necesita arrancarse con npm); «pagina» = hay una página que se puede ver tal cual (`page`). Desde la rev22,
 * `pages` son todas las páginas que se pueden ver (para moverse entre ellas) y `forPage` pide una en concreto.
 */
export function previewOf(files: GeneratedFile[], forPage?: string | null): { kind: "vacio" | "sin-pagina" | "sin-vista" | "pagina"; html: string | null; page: string | null; pages: string[] } {
  if (!files.length) return { kind: "vacio", html: null, page: null, pages: [] };
  const pages = htmlPages(files);
  const page = (forPage && pages.find((p) => norm(p) === norm(forPage))) || pages[0] || null;
  if (!page) return { kind: files.some((file) => isHtml(file)) ? "sin-vista" : "sin-pagina", html: null, page: null, pages };
  return { kind: "pagina", html: buildPageHtml(files, page), page, pages };
}

export type ActivityLine = { text: string; tone: "ok" | "work" | "info" };

/** Líneas reales del terminal: qué archivos lleva escritos la IA y cuál está escribiendo ahora. */
export function activityLines(files: GeneratedFile[], running: boolean): ActivityLine[] {
  if (!files.length) {
    return [{ text: running ? "… la IA está pensando; los archivos aparecerán aquí según se escriban." : "Sin actividad todavía. Pide algo en el chat.", tone: "info" }];
  }
  const out: ActivityLine[] = files.map((file, index) => {
    const writing = running && index === files.length - 1;
    return writing
      ? { text: `… escribiendo ${file.path} (${lines(file.content)} líneas)`, tone: "work" as const }
      : { text: `✓ ${file.path} (${lines(file.content)} líneas)`, tone: "ok" as const };
  });
  out.push(
    running
      ? { text: `${files.length} archivo(s) hasta ahora · sigue en marcha`, tone: "info" }
      : { text: `Terminado: ${files.length} archivo(s), ${files.reduce((n, f) => n + lines(f.content), 0)} líneas`, tone: "info" },
  );
  return out;
}
