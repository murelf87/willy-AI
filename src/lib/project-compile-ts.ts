// MOTOR PROPIO DE WILLY PARA COMPILAR UN PROYECTO REACT/VITE (rediseño, revisión 25). Solo servidor.
// Vite 8 (el que trae WILLY) ya no instala esbuild, así que en muchos equipos no hay esbuild. Este motor no lo necesita: usa el
// TypeScript que ya viene con WILLY (el mismo de la comprobación de tipos de la Autoconstrucción) para traducir cada archivo del
// proyecto (TSX, TS, JSX) y junta el proyecto y las librerías de la carpeta node_modules de WILLY (React, lucide-react, Radix…)
// en un solo programa para la página, como hace un empaquetador: resuelve cada import (con los «exports» de cada librería),
// mete los estilos (también los @import y las imágenes SVG del proyecto) y cuenta los errores con su archivo y su línea.
// Sin npm, sin internet y sin ejecutar nada del proyecto.

import type { GeneratedFile } from "@/lib/ai-standard";
import { inlineCssUrls, resolveRef } from "@/lib/live-files";
import { packageName, type CompileIssue } from "@/lib/project-compile";

type TsDiagnostic = { messageText: unknown; category?: number; start?: number; file?: { getLineAndCharacterOfPosition: (pos: number) => { line: number; character: number } } };
/** Lo que se usa del TypeScript de WILLY (existe igual en TypeScript 5 y 6). */
export type TypeScriptLike = {
  version?: string;
  transpileModule: (input: string, opts: { compilerOptions: Record<string, unknown>; fileName?: string; reportDiagnostics?: boolean }) => { outputText: string; diagnostics?: TsDiagnostic[] };
  preProcessFile: (text: string, readImportFiles?: boolean, detectJavaScriptImports?: boolean) => { importedFiles: Array<{ fileName: string }> };
  flattenDiagnosticMessageText: (d: unknown, newLine: string) => string;
  ModuleKind: Record<string, unknown>;
  ScriptTarget: Record<string, unknown>;
  JsxEmit: Record<string, unknown>;
  ModuleDetectionKind?: Record<string, unknown>;
};

export type TsBundleInput = {
  ts: TypeScriptLike;
  /** Los archivos del proyecto (ruta normalizada → archivo). */
  files: Map<string, GeneratedFile>;
  entry: string;
  /** Carpeta de WILLY (la de node_modules) y, para las pruebas, otras carpetas de librerías. */
  root: string;
  nodePaths: string[];
  /** Alias del proyecto («@/» → «src/» y los «paths» de su tsconfig), del más largo al más corto. */
  aliases: Array<[string, string]>;
  /** import.meta.env del proyecto. */
  env: Record<string, string | boolean>;
  /** Para cada hoja de estilos del proyecto (ya con sus @import locales dentro): Tailwind, si lo usa. */
  css: (path: string, css: string) => Promise<string>;
};
export type TsBundleResult =
  | { ok: true; js: string; css: string; warnings: CompileIssue[]; modules: number }
  | { ok: false; errors: CompileIssue[]; missing: string[] };

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/^\.?\//, "");
const extOf = (p: string): string => (/\.([a-z0-9]+)$/i.exec(p.replace(/[?#].*$/, ""))?.[1] ?? "").toLowerCase();
const CODE_EXT = new Set(["tsx", "ts", "mts", "cts", "jsx", "js", "mjs", "cjs"]);
const MIME: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  ico: "image/x-icon", bmp: "image/bmp", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm",
};
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel", "dns",
  "domain", "events", "fs", "http", "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode",
  "querystring", "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls", "trace_events", "tty", "url", "util", "v8",
  "vm", "wasi", "worker_threads", "zlib",
]);
const isUrl = (spec: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(spec);
/** Condiciones de los «exports» de una librería: primero su versión CommonJS (se junta sin traducir); si no, la ESM. */
const CJS_FIRST = ["browser", "require", "default"];
const ESM_ONLY = ["browser", "import", "module", "default"];
/** Para las hojas de estilo de una librería (@import "tw-animate-css"). */
const CSS_CONDS = ["style", "browser", "default", "import", "require"];

type PackageJson = { name?: string; type?: string; main?: string; module?: string; browser?: string | Record<string, string | false>; exports?: unknown };
type Produced = { code: string; specs: string[]; css: string | null };

// Lo que no cambia mientras WILLY está en marcha (las librerías de su carpeta): se recuerda entre compilaciones.
const statCache = new Map<string, "file" | "dir" | null>();
const pkgCache = new Map<string, PackageJson | null>();
const libCache = new Map<string, Produced>();
/** Rev27: al instalar o quitar librerías, lo recordado de las carpetas de librerías deja de valer. */
export function resetLibraryCaches(): void {
  statCache.clear();
  pkgCache.clear();
  libCache.clear();
}
function trim<K, V>(map: Map<K, V>, max: number): void {
  if (map.size > max) map.clear();
}

/** El destino de un camino dentro de los «exports» de una librería (con patrones «./*»), o null. */
function pickCondition(value: unknown, conds: string[]): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const r = pickCondition(v, conds);
      if (r) return r;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!conds.includes(k)) continue;
      const r = pickCondition(v, conds);
      if (r) return r;
    }
  }
  return null;
}
export function exportTarget(exportsField: unknown, subpath: string, conds: string[]): string | null {
  let map: Record<string, unknown>;
  if (typeof exportsField === "string" || Array.isArray(exportsField)) map = { ".": exportsField };
  else if (exportsField && typeof exportsField === "object") {
    const o = exportsField as Record<string, unknown>;
    map = Object.keys(o).some((k) => k.startsWith(".")) ? o : { ".": o };
  } else return null;
  return mapTarget(map, subpath, conds);
}

/**
 * Rev27 · Las importaciones INTERNAS de una librería («#minpath» → su archivo): el campo «imports» de su package.json, con las
 * mismas condiciones y comodines que «exports» (lo usan vfile, chalk, #ansi-styles…). null si no está.
 */
export function importTarget(importsField: unknown, spec: string, conds: string[]): string | null {
  if (!spec.startsWith("#") || !importsField || typeof importsField !== "object" || Array.isArray(importsField)) return null;
  return mapTarget(importsField as Record<string, unknown>, spec, conds);
}

/** La entrada de un mapa de «exports» o «imports» que corresponde a una ruta (exacta, o la de comodín «*» o «/» más larga). */
function mapTarget(map: Record<string, unknown>, subpath: string, conds: string[]): string | null {
  if (Object.prototype.hasOwnProperty.call(map, subpath)) return pickCondition(map[subpath], conds);
  let best: { prefix: string; value: unknown; rest: string; star: boolean } | null = null;
  for (const [k, v] of Object.entries(map)) {
    const star = k.indexOf("*");
    if (star >= 0) {
      const pre = k.slice(0, star);
      const post = k.slice(star + 1);
      if (subpath.startsWith(pre) && subpath.endsWith(post) && subpath.length >= pre.length + post.length) {
        if (!best || pre.length > best.prefix.length) best = { prefix: pre, value: v, rest: subpath.slice(pre.length, subpath.length - post.length), star: true };
      }
    } else if (k.endsWith("/") && subpath.startsWith(k)) {
      if (!best || k.length > best.prefix.length) best = { prefix: k, value: v, rest: subpath.slice(k.length), star: false };
    }
  }
  if (!best) return null;
  const target = pickCondition(best.value, conds);
  if (!target) return null;
  return best.star ? target.split("*").join(best.rest) : `${target}${best.rest}`;
}

/** Los @import de archivos del PROYECTO, metidos dentro (con sus url() apuntando bien); los de internet y de librerías, igual. */
export function inlineLocalCssImports(files: Map<string, GeneratedFile>, cssPath: string, css: string, seen: Set<string> = new Set()): string {
  seen.add(norm(cssPath));
  return css.replace(/@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);/g, (whole, _q1: string, u: string | undefined, _q2: string, s: string | undefined, rest: string) => {
    const ref = (u ?? s ?? "").trim();
    if (!ref || isUrl(ref) || !/^(?:\.{1,2}\/|\/)/.test(ref)) return whole;
    const target = resolveRef(cssPath, ref);
    const file = files.get(target);
    if (!file || seen.has(target)) return file ? "" : whole;
    const inner = rebaseCssUrls(inlineLocalCssImports(files, target, file.content, seen), target);
    const media = rest.trim();
    return media && !/\b(?:layer|supports)\s*\(/i.test(media) ? `@media ${media} {\n${inner}\n}` : inner;
  });
}
/** Las url() relativas de una hoja que se mete dentro de otra: pasan a ser desde la raíz del proyecto («/src/img/x.svg»). */
function rebaseCssUrls(css: string, from: string): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, q: string, ref: string) => {
    const r = ref.trim();
    if (!r || isUrl(r) || r.startsWith("/") || r.startsWith("#") || /^data:/i.test(r)) return whole;
    return `url(${q}/${resolveRef(from, r)}${q})`;
  });
}

/** El código de las librerías: sin la parte de «producción» de React y compañía (así no se junta dos veces). */
function prepLibrary(code: string): string {
  return code
    .replace(/^#!.*/, "")
    .replace(/process\.env\.NODE_ENV/g, '"development"')
    .replace(/if\s*\(\s*["']development["']\s*===\s*["']production["']\s*\)\s*\{[^{}]*\}\s*else\s*\{([^{}]*)\}/g, "$1")
    .replace(/if\s*\(\s*["']development["']\s*!==\s*["']production["']\s*\)\s*\{([^{}]*)\}\s*else\s*\{[^{}]*\}/g, "$1");
}
/** import.meta no existe fuera de un módulo ESM: se cambia por lo que valdría (su env de Vite, la dirección de la página). */
function prepImportMeta(code: string, env: Record<string, string | boolean>): string {
  const envJson = `(${JSON.stringify(env)})`;
  let c = code;
  for (const k of Object.keys(env).sort((a, b) => b.length - a.length)) c = c.replace(new RegExp(`import\\.meta\\.env\\.${k}\\b`, "g"), JSON.stringify(env[k]));
  return c
    .replace(/import\.meta\.env\b/g, envJson)
    .replace(/import\.meta\.hot\b/g, "undefined")
    .replace(/import\.meta\.url\b/g, "location.href")
    .replace(/import\.meta\b/g, `({ url: location.href, env: ${envJson} })`);
}
/** ¿Es un módulo ESM (import/export) o CommonJS (require/module.exports)? */
function looksEsm(code: string): boolean {
  return /(?:^|[\n;])[ \t]*(?:import[ \t]*(?:[\w*{$]|["'])|export[ \t]+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b)|export[ \t]*[{*])/.test(code);
}
const lineOf = (source: string, spec: string): number => {
  for (const q of ['"', "'", "`"]) {
    const i = source.indexOf(`${q}${spec}${q}`);
    if (i >= 0) return source.slice(0, i).split("\n").length;
  }
  return 0;
};

/** Mensajes de TypeScript, en castellano los más comunes. */
function spanishTs(text: string): string {
  let m = /^'(.+)' expected\.$/.exec(text);
  if (m) return `Falta «${m[1]}» (error de sintaxis).`;
  if (/^Expression expected\.$/.test(text)) return "Se esperaba una expresión (error de sintaxis).";
  if (/^Declaration or statement expected\.$/.test(text)) return "Se esperaba una instrucción (error de sintaxis).";
  if (/^Identifier expected/.test(text)) return "Se esperaba un nombre (error de sintaxis).";
  if (/^Unterminated string literal\.$/.test(text)) return "Hay un texto entre comillas sin cerrar.";
  if (/^Unterminated template literal\.$/.test(text)) return "Hay un texto entre comillas invertidas sin cerrar.";
  if (/^Unexpected token/.test(text)) return "Sobra algo aquí (error de sintaxis).";
  m = /^JSX element '(.+)' has no corresponding closing tag\.$/.exec(text);
  if (m) return `La etiqueta «<${m[1]}>» no está cerrada.`;
  m = /^Expected corresponding JSX closing tag for '(.+)'\.$/.exec(text);
  if (m) return `Falta cerrar la etiqueta «<${m[1]}>» (o se cierra otra).`;
  if (/^JSX expressions must have one parent element\.$/.test(text)) return "Lo que devuelve el componente debe ir dentro de UNA sola etiqueta (o de <>…</>).";
  return text;
}

/**
 * Junta el proyecto (desde su punto de entrada) y las librerías que usa en un solo programa para la página, con el TypeScript
 * de WILLY. Devuelve el programa y sus estilos, o los errores (con archivo y línea) y las librerías que faltan.
 */
export async function bundleWithTypeScript(input: TsBundleInput): Promise<TsBundleResult> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { ts, files, root } = input;
  const libDirs = [path.join(root, "node_modules"), ...input.nodePaths];
  const errors: CompileIssue[] = [];
  const missing = new Set<string>();
  const warnings: CompileIssue[] = [];
  const cssParts: string[] = [];
  const mods: Array<{ code: string; deps: Record<string, number>; label: string }> = [];
  const ids = new Map<string, number>();
  const kindEnum = (e: Record<string, unknown> | undefined, name: string, fallback: number): unknown => e?.[name] ?? fallback;
  const baseOptions = {
    module: kindEnum(ts.ModuleKind, "CommonJS", 1),
    target: kindEnum(ts.ScriptTarget, "ES2020", 7),
    jsx: kindEnum(ts.JsxEmit, "ReactJSX", 4),
    moduleDetection: kindEnum(ts.ModuleDetectionKind, "Force", 3),
    esModuleInterop: true,
    allowJs: true,
    isolatedModules: true,
    useDefineForClassFields: true,
    sourceMap: false,
    inlineSourceMap: false,
    declaration: false,
  };
  trim(statCache, 100_000);
  trim(pkgCache, 20_000);
  trim(libCache, 6_000);

  const kindOf = async (p: string): Promise<"file" | "dir" | null> => {
    const hit = statCache.get(p);
    if (hit !== undefined) return hit;
    let k: "file" | "dir" | null = null;
    try {
      const s = await fs.stat(p);
      k = s.isFile() ? "file" : s.isDirectory() ? "dir" : null;
    } catch {
      k = null;
    }
    statCache.set(p, k);
    return k;
  };
  const readPkg = async (dir: string): Promise<PackageJson | null> => {
    const file = path.join(dir, "package.json");
    if (pkgCache.has(file)) return pkgCache.get(file) ?? null;
    let pkg: PackageJson | null = null;
    try {
      pkg = JSON.parse(await fs.readFile(file, "utf8")) as PackageJson;
    } catch {
      pkg = null;
    }
    pkgCache.set(file, pkg);
    return pkg;
  };
  /** La librería (carpeta y package.json) a la que pertenece un archivo. */
  const nearestPackage = async (dir: string): Promise<{ dir: string; pkg: PackageJson } | null> => {
    let d = dir;
    for (let i = 0; i < 30; i += 1) {
      if ((await kindOf(path.join(d, "package.json"))) === "file") {
        const pkg = await readPkg(d);
        if (pkg) return { dir: d, pkg };
      }
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
    return null;
  };
  const LIB_EXTS = [".js", ".cjs", ".mjs", ".jsx", ".json", ".ts", ".tsx", ".css"];
  const resolveAbsFile = async (p: string, depth = 0): Promise<string | null> => {
    if ((await kindOf(p)) === "file") return p;
    for (const e of LIB_EXTS) if ((await kindOf(p + e)) === "file") return p + e;
    if ((await kindOf(p)) === "dir" && depth < 3) {
      const pkg = (await kindOf(path.join(p, "package.json"))) === "file" ? await readPkg(p) : null;
      const main = pkg ? (typeof pkg.browser === "string" ? pkg.browser : pkg.main ?? pkg.module) : undefined;
      if (main) {
        const r = await resolveAbsFile(path.join(p, main), depth + 1);
        if (r) return r;
      }
      for (const e of LIB_EXTS) if ((await kindOf(path.join(p, `index${e}`))) === "file") return path.join(p, `index${e}`);
    }
    return null;
  };
  const findPackageDir = async (name: string, fromDir: string | null): Promise<string | null> => {
    const dirs: string[] = [];
    if (fromDir) {
      let d = fromDir;
      for (let i = 0; i < 40; i += 1) {
        if (path.basename(d) !== "node_modules") dirs.push(path.join(d, "node_modules"));
        const up = path.dirname(d);
        if (up === d) break;
        d = up;
      }
    }
    for (const d of libDirs) if (!dirs.includes(d)) dirs.push(d);
    for (const d of dirs) {
      const dir = path.join(d, ...name.split("/"));
      if ((await kindOf(path.join(dir, "package.json"))) === "file") return dir;
    }
    return null;
  };
  /** El campo «browser» de una librería puede cambiar un archivo por otro o dejarlo vacío (false). */
  const browserMap = (dir: string, pkg: PackageJson, file: string): string | false => {
    const map = pkg.browser;
    if (!map || typeof map !== "object") return file;
    const rel = `./${path.relative(dir, file).split(path.sep).join("/")}`;
    for (const key of [rel, rel.replace(/\.(?:js|cjs|mjs)$/, "")]) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
      const v = map[key];
      if (v === false) return false;
      if (typeof v === "string") return path.join(dir, v);
    }
    return file;
  };
  /** Una librería por su nombre («react», «react-dom/client», «@radix-ui/react-slot»): su archivo, false si va vacía o null. */
  const resolveBare = async (spec: string, fromDir: string | null, css = false): Promise<string | false | null> => {
    const name = packageName(spec);
    const sub = spec.slice(name.length);
    const dir = await findPackageDir(name, fromDir);
    if (!dir) return null;
    const pkg = (await readPkg(dir)) ?? {};
    if (pkg.exports !== undefined && pkg.exports !== null) {
      const subpath = sub ? `.${sub}` : ".";
      for (const conds of css ? [CSS_CONDS] : [CJS_FIRST, ESM_ONLY]) {
        const t = exportTarget(pkg.exports, subpath, conds);
        if (!t) continue;
        const f = await resolveAbsFile(path.join(dir, t));
        if (f) return f;
      }
    }
    if (!sub) {
      const style = css ? (pkg as { style?: string }).style ?? null : null;
      for (const c of [style, typeof pkg.browser === "string" ? pkg.browser : null, pkg.main ?? null, pkg.module ?? null, "index.js"]) {
        if (!c) continue;
        const f = await resolveAbsFile(path.join(dir, c));
        if (f) return browserMap(dir, pkg, f);
      }
      return null;
    }
    const f = await resolveAbsFile(path.join(dir, sub));
    return f ? browserMap(dir, pkg, f) : null;
  };
  /** Un archivo del proyecto (con o sin extensión, su index, o «.js» que en realidad es «.ts»). */
  const findProjectFile = (target: string): string | null => {
    const t = norm(target).replace(/\/$/, "");
    const tries = [t, ...["tsx", "ts", "jsx", "js", "mjs", "json", "css"].map((e) => `${t}.${e}`), ...["tsx", "ts", "jsx", "js"].map((e) => `${t}/index.${e}`)];
    if (/\.(?:js|jsx|mjs)$/i.test(t)) tries.push(...["ts", "tsx", "mts"].map((e) => t.replace(/\.(?:js|jsx|mjs)$/i, `.${e}`)));
    for (const candidate of tries) if (files.has(candidate)) return candidate;
    return null;
  };

  const dataUrl = (mime: string, data: Buffer): string => `data:${mime};base64,${data.toString("base64")}`;
  const exportsValue = (value: unknown): string => `module.exports = ${JSON.stringify(value)};`;

  /** Las hojas de estilo de una librería (import "sonner/dist/styles.css"): con sus @import y url() de archivos dentro. */
  const libraryCss = async (file: string, seen: Set<string> = new Set()): Promise<string> => {
    seen.add(file);
    let css = await fs.readFile(file, "utf8");
    const dir = path.dirname(file);
    const parts: Array<Promise<string>> = [];
    css = css.replace(/@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);/g, (whole, _q1: string, u: string | undefined, _q2: string, s: string | undefined) => {
      const ref = (u ?? s ?? "").trim();
      if (!ref || isUrl(ref)) return whole;
      const i = parts.length;
      parts.push((async () => {
        const target = /^\.{0,2}\//.test(ref) ? await resolveAbsFile(path.resolve(dir, ref)) : await resolveBare(ref, dir, true);
        return target && !seen.has(target) && /\.css$/i.test(target) ? libraryCss(target, seen) : whole;
      })());
      return `\u0000willy-import-${i}\u0000`;
    });
    const done = await Promise.all(parts);
    css = css.replace(/\u0000willy-import-(\d+)\u0000/g, (_w, n: string) => done[Number(n)] ?? "");
    const urls: Array<Promise<string>> = [];
    css = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, _q: string, ref: string) => {
      const r = ref.trim().replace(/[?#].*$/, "");
      if (!r || isUrl(r) || /^data:/i.test(r) || r.startsWith("#")) return whole;
      const mime = MIME[extOf(r)];
      if (!mime) return whole;
      const i = urls.length;
      urls.push((async () => {
        const f = await resolveAbsFile(path.resolve(dir, r));
        return f ? `url("${dataUrl(mime, await fs.readFile(f))}")` : whole;
      })());
      return `\u0000willy-url-${i}\u0000`;
    });
    const urlDone = await Promise.all(urls);
    return css.replace(/\u0000willy-url-(\d+)\u0000/g, (_w, n: string) => urlDone[Number(n)] ?? "");
  };

  /** Los @import de librerías que quedan en una hoja del proyecto (sin Tailwind, o que Tailwind no ha resuelto): dentro. */
  const inlineLibraryCssImports = async (css: string): Promise<string> => {
    const found: Array<Promise<string>> = [];
    const marked = css.replace(/@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);/g, (whole, _q1: string, u: string | undefined, _q2: string, s: string | undefined) => {
      const ref = (u ?? s ?? "").trim();
      if (!ref || isUrl(ref) || /^(?:\.{0,2}\/)/.test(ref) || /^tailwindcss(?:\/|$)/.test(ref)) return whole;
      const i = found.length;
      found.push((async () => {
        const target = await resolveBare(ref, null, true);
        return target && /\.css$/i.test(target) ? libraryCss(target) : whole;
      })());
      return `\u0000willy-lib-${i}\u0000`;
    });
    if (!found.length) return css;
    const done = await Promise.all(found);
    return marked.replace(/\u0000willy-lib-(\d+)\u0000/g, (_w, n: string) => done[Number(n)] ?? "");
  };

  /** Un archivo del proyecto, listo para juntar (o sus errores). */
  const produceProject = async (key: string): Promise<Produced> => {
    const [p, query = ""] = key.split("?") as [string, string?];
    const f = files.get(p)!;
    const ext = extOf(p);
    if (/(?:^|&)raw\b/.test(query)) return { code: exportsValue(f.content), specs: [], css: null };
    if (/(?:^|&)url\b/.test(query)) return { code: exportsValue(ext === "svg" ? dataUrl(MIME.svg!, Buffer.from(f.content, "utf8")) : p), specs: [], css: null };
    if (ext === "css") {
      const inlined = inlineCssUrls([...files.values()], inlineLocalCssImports(files, p, f.content), p);
      const css = await inlineLibraryCssImports(await input.css(p, inlined));
      if (/(?:^|&)inline\b/.test(query)) return { code: exportsValue(css), specs: [], css: null };
      // Los módulos CSS («x.module.css»): sus clases se usan tal cual (styles.boton → "boton").
      const code = /\.module\.css$/i.test(p) ? "module.exports = new Proxy({}, { get: function (_t, k) { return k === \"__esModule\" ? false : String(k); } });" : "";
      return { code, specs: [], css };
    }
    if (ext === "json") {
      try {
        return { code: exportsValue(JSON.parse(f.content)), specs: [], css: null };
      } catch (error) {
        errors.push({ file: p, line: 0, column: 0, text: `El archivo JSON tiene un error: ${error instanceof Error ? error.message.slice(0, 160) : "no se puede leer"}.` });
        return { code: "", specs: [], css: null };
      }
    }
    if (MIME[ext]) return { code: exportsValue(ext === "svg" ? dataUrl(MIME.svg!, Buffer.from(f.content, "utf8")) : p), specs: [], css: null };
    if (!CODE_EXT.has(ext)) return { code: exportsValue(f.content), specs: [], css: null };
    // .ts sin JSX; .tsx con JSX; y los .js/.jsx del proyecto también pueden llevar JSX (como con Vite).
    const fileName = /^(?:ts|mts|cts)$/.test(ext) ? "archivo.ts" : /^(?:js|mjs|cjs|jsx)$/.test(ext) ? "archivo.jsx" : "archivo.tsx";
    const out = ts.transpileModule(prepImportMeta(f.content, input.env), { compilerOptions: baseOptions, fileName, reportDiagnostics: true });
    for (const d of out.diagnostics ?? []) {
      if (!d.file || (d.category !== undefined && d.category !== 1)) continue;
      const pos = typeof d.start === "number" ? d.file.getLineAndCharacterOfPosition(d.start) : null;
      if (errors.length < 30) errors.push({ file: p, line: pos ? pos.line + 1 : 0, column: pos ? pos.character : 0, text: spanishTs(ts.flattenDiagnosticMessageText(d.messageText, "\n")) });
    }
    const specs = ts.preProcessFile(out.outputText, true, true).importedFiles.map((i) => i.fileName);
    return { code: out.outputText, specs, css: null };
  };

  /** Un archivo de una librería de WILLY, listo para juntar (se recuerda: las librerías no cambian). */
  const produceLibrary = async (file: string): Promise<Produced> => {
    const hit = libCache.get(file);
    if (hit) return hit;
    const ext = extOf(file);
    let produced: Produced;
    if (ext === "json") produced = { code: `module.exports = ${(await fs.readFile(file, "utf8")).trim() || "null"};`, specs: [], css: null };
    else if (ext === "css") produced = { code: "", specs: [], css: await libraryCss(file) };
    else if (MIME[ext]) produced = { code: exportsValue(dataUrl(MIME[ext]!, await fs.readFile(file))), specs: [], css: null };
    else if (!CODE_EXT.has(ext)) produced = { code: exportsValue(await fs.readFile(file, "utf8")), specs: [], css: null };
    else {
      let code = prepLibrary(await fs.readFile(file, "utf8"));
      const near = ext === "js" ? await nearestPackage(path.dirname(file)) : null;
      const esm = ext === "mjs" || /^(?:ts|tsx|mts)$/.test(ext) || (ext !== "cjs" && (near?.pkg.type === "module" || looksEsm(code)));
      if (esm) {
        code = ts.transpileModule(prepImportMeta(code, { MODE: "development", DEV: true, PROD: false, SSR: false }), {
          compilerOptions: baseOptions,
          fileName: ext === "tsx" ? "libreria.tsx" : /^(?:ts|mts)$/.test(ext) ? "libreria.ts" : "libreria.js",
          reportDiagnostics: false,
        }).outputText;
      }
      produced = { code, specs: ts.preProcessFile(code, true, true).importedFiles.map((i) => i.fileName), css: null };
    }
    libCache.set(file, produced);
    return produced;
  };

  /** Adónde lleva un import: la clave de su módulo («p:» del proyecto, «n:» de una librería) o un módulo especial. */
  const resolveFrom = async (importer: string, spec: string, source: string): Promise<string | null> => {
    if (importer.startsWith("p:")) {
      const from = importer.slice(2).split("?")[0]!;
      if (isUrl(spec)) return `throw:El proyecto importa «${spec}» de internet: en la vista previa no se puede cargar.`;
      const [bare, query] = spec.split("?") as [string, string?];
      let target: string | null = null;
      for (const [prefix, to] of input.aliases) {
        if (bare === prefix.replace(/\/$/, "") || bare.startsWith(prefix)) {
          target = `${to}${bare.slice(prefix.length)}`;
          break;
        }
      }
      if (!target && bare.startsWith("/")) target = bare.slice(1);
      if (!target && /^\.{1,2}(?:\/|$)/.test(bare)) target = resolveRef(from, bare);
      if (target !== null) {
        const found = findProjectFile(target);
        if (found) return `p:${found}${query ? `?${query}` : ""}`;
        errors.push({ file: from, line: lineOf(source, spec), column: 0, text: `No se encuentra «${spec}» en el proyecto (lo importa ${from}).` });
        return null;
      }
      const lib = bare.startsWith("node:") ? null : await resolveBare(bare, null);
      if (lib === false) return "empty:";
      if (lib) return `n:${lib}`;
      const name = bare.replace(/^node:/, "").split("/")[0]!;
      if (bare.startsWith("node:") || NODE_BUILTINS.has(name)) return "empty:";
      missing.add(packageName(bare));
      errors.push({ file: from, line: lineOf(source, spec), column: 0, text: `Falta la librería «${packageName(bare)}» (no la trae WILLY ni está instalada en tu equipo).` });
      return null;
    }
    // Dentro de una librería
    const file = importer.slice(2);
    const dir = path.dirname(file);
    // Rev27: sus importaciones internas («#minpath»), del campo «imports» de su package.json (sin la condición «node»).
    if (spec.startsWith("#")) {
      const own = await nearestPackage(dir);
      if (own) {
        for (const conds of [CJS_FIRST, ESM_ONLY]) {
          const t = importTarget((own.pkg as { imports?: unknown }).imports, spec, conds);
          if (!t) continue;
          const f = /^\.{0,2}\//.test(t) ? await resolveAbsFile(path.join(own.dir, t)) : await resolveBare(t, own.dir);
          if (f === false) return "empty:";
          if (f) return `n:${f}`;
        }
      }
      return `throw:La librería ${own?.pkg.name ? `«${own.pkg.name}» ` : ""}no encuentra su importación interna «${spec}».`;
    }
    const clean = spec.replace(/[?#].*$/, "");
    if (/^\.{0,2}\//.test(clean) || path.isAbsolute(clean)) {
      const abs = path.isAbsolute(clean) ? clean : path.resolve(dir, clean);
      const f = await resolveAbsFile(abs);
      if (!f) return `throw:La librería no encuentra su archivo «${spec}».`;
      const near = await nearestPackage(path.dirname(f));
      const mapped = near ? browserMap(near.dir, near.pkg, f) : f;
      return mapped === false ? "empty:" : `n:${mapped}`;
    }
    const near = await nearestPackage(dir);
    const map = near?.pkg.browser;
    if (map && typeof map === "object" && Object.prototype.hasOwnProperty.call(map, clean)) {
      const v = map[clean];
      if (v === false) return "empty:";
      if (typeof v === "string" && near) {
        const f = /^\.{0,2}\//.test(v) ? await resolveAbsFile(path.join(near.dir, v)) : await resolveBare(v, dir);
        if (f) return `n:${f}`;
      }
    }
    const lib = clean.startsWith("node:") ? null : await resolveBare(clean, dir);
    if (lib === false) return "empty:";
    if (lib) return `n:${lib}`;
    const name = clean.replace(/^node:/, "").split("/")[0]!;
    if (clean.startsWith("node:") || NODE_BUILTINS.has(name)) return "empty:";
    return `throw:Falta «${clean}», que usa la librería ${near?.pkg.name ? `«${near.pkg.name}»` : "de WILLY"}.`;
  };

  /** Recorre el proyecto desde su entrada (en el orden de sus import: así los estilos quedan en su orden). */
  const visit = async (key: string, label: string): Promise<number> => {
    const known = ids.get(key);
    if (known !== undefined) return known;
    const id = mods.length;
    ids.set(key, id);
    const mod = { code: "", deps: {} as Record<string, number>, label };
    mods.push(mod);
    let produced: Produced;
    let source = "";
    if (key.startsWith("p:")) {
      produced = await produceProject(key.slice(2));
      source = files.get(key.slice(2).split("?")[0]!)?.content ?? "";
    } else if (key.startsWith("n:")) produced = await produceLibrary(key.slice(2));
    else if (key.startsWith("throw:")) produced = { code: `throw new Error(${JSON.stringify(`WILLY: ${key.slice(6)}`)});`, specs: [], css: null };
    else produced = { code: "module.exports = {};", specs: [], css: null };
    if (produced.css !== null && produced.css.trim()) cssParts.push(produced.css);
    mod.code = produced.code;
    for (const spec of produced.specs) {
      if (Object.prototype.hasOwnProperty.call(mod.deps, spec)) continue;
      const target = await resolveFrom(key, spec, source);
      if (!target) continue;
      mod.deps[spec] = await visit(target, spec);
    }
    return id;
  };

  const entry = findProjectFile(input.entry);
  if (!entry) return { ok: false, errors: [{ file: input.entry, line: 0, column: 0, text: `No se encuentra el punto de entrada «${input.entry}» en el proyecto.` }], missing: [] };
  const entryId = await visit(`p:${entry}`, entry);
  if (errors.length || missing.size) return { ok: false, errors: errors.slice(0, 20), missing: [...missing] };

  const js = [
    "(function () {",
    "var process = { env: { NODE_ENV: \"development\" }, browser: true, argv: [], version: \"\", versions: {}, platform: \"browser\", cwd: function () { return \"/\"; }, nextTick: function (fn) { var args = Array.prototype.slice.call(arguments, 1); Promise.resolve().then(function () { fn.apply(null, args); }); } };",
    "var global = typeof globalThis !== \"undefined\" ? globalThis : window;",
    "var __willy = {",
    ...mods.map((m, i) => `${i}: [function (module, exports, require, __filename, __dirname) {\n${m.code}\n}, ${JSON.stringify(m.deps)}, ${JSON.stringify(m.label)}],`),
    "};",
    "var __willyHechos = {};",
    "function __willyCargar(id) {",
    "  var hecho = __willyHechos[id];",
    "  if (hecho) return hecho.exports;",
    "  var def = __willy[id], module = (__willyHechos[id] = { exports: {} });",
    "  def[0].call(module.exports, module, module.exports, function (spec) {",
    "    var to = def[1][spec];",
    "    if (to === undefined) throw new Error(\"WILLY: «\" + spec + \"» no está incluido en la vista previa.\");",
    "    return __willyCargar(to);",
    "  }, \"/\" + def[2], \"/\");",
    "  return module.exports;",
    "}",
    `__willyCargar(${entryId});`,
    "})();",
  ].join("\n");

  // Los @import que quedan (de internet, como las fuentes) van arriba del todo, como exige CSS.
  const imports: string[] = [];
  let css = cssParts.join("\n").replace(/@charset\s+["'][^"']*["'];/gi, "");
  css = css.replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])[^;]*;/g, (m) => {
    imports.push(m.trim());
    return "";
  });
  css = [...new Set(imports), css].join("\n").trim();
  return { ok: true, js, css, warnings, modules: mods.length };
}
