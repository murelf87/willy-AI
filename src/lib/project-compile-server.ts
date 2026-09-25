// COMPILAR UN PROYECTO REACT/VITE EN EL EQUIPO (rediseño, revisión 25). Solo servidor. Sin npm y sin internet, con lo que ya
// trae WILLY en su carpeta node_modules: si hay esbuild, con esbuild; si no (Vite 8 ya no lo instala), con el motor propio de
// WILLY y su TypeScript (`project-compile-ts.ts`). Las librerías (React, lucide-react, Radix, Tailwind…) salen de esa misma
// carpeta. El código del proyecto NO se ejecuta al compilar (no se usa su vite.config ni sus scripts de npm): solo se traduce
// y se junta. El resultado es UNA página (su index.html con el código y los estilos dentro) que la vista previa enseña como
// cualquier otra, con su vigía.

import type { GeneratedFile } from "@/lib/ai-standard";
import { resolveRef, inlineAssets } from "@/lib/live-files";
import { compileKey, compileTarget, packageName, type CompileEngine, type CompileIssue, type CompileOutcome, type TailwindState } from "@/lib/project-compile";
import { lineMapOf, type TranspiledTest } from "@/lib/project-tests";
import { bundleWithTypeScript, inlineLocalCssImports, resetLibraryCaches, type TypeScriptLike } from "@/lib/project-compile-ts";
import { libraryStoreOf, librariesGeneration, librariesIdle } from "@/lib/package-store-server";
import { fail, ok, type ServiceResult } from "@/types/domain";

type EsbuildMessage = { text: string; location?: { file?: string; line?: number; column?: number } | null };
type EsbuildResult = { outputFiles?: Array<{ path: string; text: string }>; warnings?: EsbuildMessage[] };
export type EsbuildLike = { build: (opts: Record<string, unknown>) => Promise<EsbuildResult>; version?: string };
export type TailwindLike = { compile: (css: string, opts: { base: string; onDependency: (path: string) => void }) => Promise<{ build: (candidates: string[]) => string }> };

export type CompileOptions = {
  /** Carpeta de WILLY (la que tiene node_modules). Por defecto, la de la instalación. */
  root?: string;
  /** Para las pruebas: otro esbuild (null = como si no lo hubiera), otro TypeScript u otras carpetas de librerías. */
  esbuild?: EsbuildLike | null;
  esbuildPath?: string;
  typescript?: TypeScriptLike | null;
  typescriptPath?: string;
  /** Para las pruebas: usar solo ese motor. Por defecto, esbuild si lo hay y, si no, el TypeScript de WILLY. */
  engine?: CompileEngine;
  nodePaths?: string[];
  /** Rev27: carpetas de librerías instaladas para los proyectos (el almacén), después de las de WILLY. */
  libraryDirs?: string[];
  /** Tailwind (el de WILLY); null = no hay; undefined = buscarlo en la instalación. */
  tailwind?: TailwindLike | null;
  timeoutMs?: number;
};

const MAX_HTML = 12_000_000;
const norm = (p: string): string => p.replace(/\\/g, "/").replace(/^\.?\//, "");
const extOf = (p: string): string => (/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? "").toLowerCase();
const LOADERS: Record<string, string> = { tsx: "tsx", ts: "ts", mts: "ts", jsx: "jsx", js: "jsx", mjs: "jsx", json: "json", css: "css", svg: "dataurl", md: "text", txt: "text" };

/** Carga un módulo desde la carpeta de librerías de WILLY (sirve tanto si es CommonJS como si solo es ESM). */
async function importFromRoot<T>(root: string, id: string, extraDirs: string[] = []): Promise<T | null> {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  for (const dir of [path.join(root, "node_modules"), ...extraDirs]) {
    const pkgFile = path.join(dir, ...id.split("/"), "package.json");
    let pkg: { main?: string; module?: string; exports?: unknown };
    try {
      pkg = JSON.parse(await fs.readFile(pkgFile, "utf8")) as typeof pkg;
    } catch {
      continue;
    }
    try {
      return createRequire(pkgFile)(path.dirname(pkgFile)) as T;
    } catch {
      /* solo ESM: se importa su entrada */
    }
    const exp = (pkg.exports && typeof pkg.exports === "object" ? (pkg.exports as Record<string, unknown>)["."] ?? pkg.exports : pkg.exports) as unknown;
    const pick = (e: unknown): string | null => {
      if (typeof e === "string") return e;
      if (e && typeof e === "object") {
        const o = e as Record<string, unknown>;
        return pick(o["import"]) ?? pick(o["default"]) ?? pick(o["node"]) ?? null;
      }
      return null;
    };
    const entry = pick(exp) ?? pkg.module ?? pkg.main;
    if (!entry) continue;
    try {
      return (await import(/* @vite-ignore */ pathToFileURL(path.join(path.dirname(pkgFile), entry)).href)) as T;
    } catch {
      continue;
    }
  }
  return null;
}

/** El archivo del proyecto al que apunta una ruta (con o sin extensión, o su index). */
function findFile(files: Map<string, GeneratedFile>, target: string): string | null {
  const t = norm(target).replace(/\/$/, "");
  const tries = [t, ...["tsx", "ts", "jsx", "js", "mjs", "json", "css"].map((e) => `${t}.${e}`), ...["tsx", "ts", "jsx", "js"].map((e) => `${t}/index.${e}`)];
  for (const candidate of tries) if (files.has(candidate)) return candidate;
  return null;
}

/** Los «paths» del tsconfig (y siempre «@/» → «src/»), como pares prefijo → carpeta. */
function aliasesOf(files: Map<string, GeneratedFile>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const name of ["tsconfig.app.json", "tsconfig.json"]) {
    const f = files.get(name);
    if (!f) continue;
    try {
      const clean = f.content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1").replace(/,\s*([}\]])/g, "$1");
      const cfg = JSON.parse(clean) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
      const base = norm(cfg.compilerOptions?.baseUrl ?? ".").replace(/^\.$/, "");
      for (const [key, targets] of Object.entries(cfg.compilerOptions?.paths ?? {})) {
        const to = targets?.[0];
        if (!to) continue;
        const from = key.replace(/\*$/, "");
        const dest = norm(`${base ? `${base}/` : ""}${to.replace(/\*$/, "")}`);
        out.push([from, dest]);
      }
    } catch {
      /* tsconfig con errores: se sigue con el alias de siempre */
    }
  }
  if (!out.some(([from]) => from === "@/")) out.push(["@/", "src/"]);
  return out.sort((a, b) => b[0].length - a[0].length);
}

/** Las variables de Vite que el código puede leer (import.meta.env), con las VITE_* de sus archivos .env. */
function envOf(files: Map<string, GeneratedFile>): Record<string, string | boolean> {
  const env: Record<string, string | boolean> = { MODE: "development", DEV: true, PROD: false, SSR: false, BASE_URL: "/" };
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    const f = files.get(name);
    if (!f) continue;
    for (const line of f.content.split(/\r?\n/)) {
      const m = /^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
  return env;
}
function envDefines(env: Record<string, string | boolean>): Record<string, string> {
  const defines: Record<string, string> = { "process.env.NODE_ENV": '"development"', "import.meta.env": JSON.stringify(env) };
  for (const [k, v] of Object.entries(env)) defines[`import.meta.env.${k}`] = JSON.stringify(v);
  return defines;
}

/** Palabras que pueden ser clases de Tailwind en el código del proyecto (Tailwind ignora las que no lo son). */
function tailwindCandidates(files: GeneratedFile[]): string[] {
  const set = new Set<string>();
  for (const f of files) {
    if (!/\.(?:tsx|ts|jsx|js|mjs|html?|mdx?)$/i.test(f.path)) continue;
    for (const m of f.content.matchAll(/[^\s"'`{}()<>;,=\\]+/g)) {
      const t = m[0];
      if (t.length <= 100 && /[a-z]/.test(t)) set.add(t);
    }
    if (set.size > 40_000) break;
  }
  return [...set];
}

const TAILWIND_RE = /@import\s+["']tailwindcss["'][^;]*;|@tailwind\s+(?:base|components|utilities)\s*;/;
const stripTailwind = (css: string): string => css.replace(/@import\s+["']tailwindcss["'][^;]*;/g, "").replace(/@tailwind\s+(?:base|components|utilities)\s*;/g, "").replace(/^\s*@apply\s[^;]*;\s*$/gm, "");

/** Mensajes de esbuild, en castellano los más comunes. */
function spanish(text: string): string {
  let m = /^Could not resolve "([^"]+)"/.exec(text);
  if (m) return `No se encuentra «${m[1]}».`;
  m = /^Expected (.+) but found (.+)$/.exec(text);
  if (m) return `Se esperaba ${m[1]} y hay ${m[2]}.`;
  m = /^Unexpected (.+)$/.exec(text);
  if (m) return `Sobra ${m[1]} (error de sintaxis).`;
  m = /^The symbol "([^"]+)" has already been declared$/.exec(text);
  if (m) return `«${m[1]}» está declarado dos veces.`;
  m = /^No matching export in "([^"]+)" for import "([^"]+)"$/.exec(text);
  if (m) return `«${m[1]}» no tiene «${m[2]}» (lo que se importa no existe).`;
  return text;
}

const issueOf = (msg: EsbuildMessage): CompileIssue => ({
  file: norm(String(msg.location?.file ?? "").replace(/^proyecto:/, "")),
  line: msg.location?.line ?? 0,
  column: msg.location?.column ?? 0,
  text: spanish(msg.text),
});

/** ¿Sirve este esbuild? (jsx «automatic» y el resto de opciones: desde la 0.17). Sin versión (pruebas): sí. */
function esbuildUsable(version: string | undefined): boolean {
  if (!version) return true;
  const [major = 0, minor = 0] = version.split(".").map((n) => Number.parseInt(n, 10));
  return major > 0 || minor >= 17;
}

/**
 * Compila los archivos de un proyecto React/Vite y devuelve su página lista para la vista previa (o sus errores, con archivo y
 * línea, y las librerías que faltan).
 */
export async function compileProjectFiles(list: GeneratedFile[], opts: CompileOptions = {}): Promise<CompileOutcome> {
  const started = Date.now();
  const key = compileKey(list);
  const target = compileTarget(list);
  if (!target) return { ok: false, key, page: "", entry: "", ms: 0, errors: [{ file: "", line: 0, column: 0, text: "Este proyecto no tiene un punto de entrada que compilar (un index.html con <script type=\"module\" src=\"/src/main.tsx\">)." }], missing: [] };
  const files = new Map(list.map((f) => [norm(f.path), f] as const));
  const root = opts.root ?? process.cwd();
  // Las librerías: las de la carpeta de WILLY y, por si WILLY se ejecuta desde una subcarpeta (app/.output/server), las de
  // las carpetas de encima (como hace Node).
  const { join, dirname } = await import("node:path");
  const above: string[] = [];
  for (let d = root, i = 0; i < 3; i += 1) {
    const up = dirname(d);
    if (up === d) break;
    d = up;
    above.push(join(d, "node_modules"));
  }
  const nodePaths = [...(opts.nodePaths ?? []), ...above, ...(opts.libraryDirs ?? [])];
  const failWith = (text: string, env = false): CompileOutcome => ({ ok: false, key, page: target.page, entry: target.entry, ms: Date.now() - started, errors: [{ file: "", line: 0, column: 0, text }], missing: [], ...(env ? { env: true } : {}) });
  // El motor: el esbuild de la instalación si lo hay (también el que traen tsx o Vite 7 dentro) y, si no, el TypeScript de WILLY.
  let esbuild: EsbuildLike | null = null;
  let ts: TypeScriptLike | null = null;
  if (opts.engine !== "typescript") {
    const found = opts.esbuild !== undefined ? opts.esbuild : await importFromRoot<EsbuildLike>(root, opts.esbuildPath ?? "esbuild", [...nodePaths, join(root, "node_modules", "tsx", "node_modules"), join(root, "node_modules", "vite", "node_modules")]);
    if (found?.build && esbuildUsable(found.version)) esbuild = found;
  }
  if (!esbuild && opts.engine !== "esbuild") {
    const found = opts.typescript !== undefined ? opts.typescript : await importFromRoot<TypeScriptLike>(root, opts.typescriptPath ?? "typescript", nodePaths);
    if (typeof found?.transpileModule === "function" && typeof found.preProcessFile === "function") ts = found;
  }
  if (!esbuild && !ts) return failWith("No se encuentra el compilador de WILLY (ni esbuild ni su TypeScript) en su instalación: no se puede compilar el proyecto en este equipo.", true);

  const warnings: CompileIssue[] = [];
  let tailwind: TailwindState = "no";
  let tw: TailwindLike | null | undefined = opts.tailwind;
  const cssOf = async (path: string, css: string): Promise<string> => {
    if (!TAILWIND_RE.test(css)) return css;
    if (tw === undefined) tw = await importFromRoot<TailwindLike>(root, "@tailwindcss/node", nodePaths);
    if (!tw?.compile) {
      tailwind = "sin-compilar";
      return stripTailwind(css);
    }
    try {
      let source = css.replace(/@tailwind\s+(?:base|components|utilities)\s*;/g, "");
      if (!/@import\s+["']tailwindcss["']/.test(source)) source = `@import "tailwindcss";\n${source}`;
      const compiler = await tw.compile(source, { base: root, onDependency: () => undefined });
      const out = compiler.build(tailwindCandidates(list));
      if (tailwind !== "sin-compilar") tailwind = "compilado";
      return out;
    } catch (error) {
      tailwind = "sin-compilar";
      warnings.push({ file: path, line: 0, column: 0, text: `Tailwind no se ha podido aplicar (${error instanceof Error ? error.message.slice(0, 160) : "error"}): se ve sin esas clases.` });
      return stripTailwind(css);
    }
  };
  const aliases = aliasesOf(files);
  const env = envOf(files);
  const timeoutMs = opts.timeoutMs ?? 90_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = <T,>(work: Promise<T>): Promise<T> => Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`La compilación tardó más de ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs); })]);
  let js = "";
  let css = "";
  let engine: CompileEngine = "esbuild";

  if (!esbuild && ts) {
    // Motor propio de WILLY (su TypeScript): para los equipos sin esbuild.
    engine = "typescript";
    try {
      const bundled = await limit(bundleWithTypeScript({ ts, files, entry: target.entry, root, nodePaths, aliases, env, css: cssOf }));
      if (!bundled.ok) return { ok: false, key, page: target.page, entry: target.entry, ms: Date.now() - started, errors: bundled.errors, missing: bundled.missing };
      js = bundled.js;
      css = bundled.css;
      for (const w of bundled.warnings) if (warnings.length < 20) warnings.push(w);
    } catch (error) {
      return failWith(`No se pudo compilar: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`, true);
    } finally {
      if (timer) clearTimeout(timer);
    }
    return finish(js, css, engine);
  }

  const plugin = {
    name: "willy-proyecto",
    setup(build: { onResolve: (o: { filter: RegExp; namespace?: string }, cb: (a: { path: string; importer: string; namespace: string; kind: string }) => unknown) => void; onLoad: (o: { filter: RegExp; namespace?: string }, cb: (a: { path: string }) => unknown) => void }) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return { path: norm(args.path), namespace: "proyecto" };
        if (args.namespace !== "proyecto") return undefined;
        const spec = args.path;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(spec)) return { path: spec, external: true };
        let target: string | null = null;
        for (const [from, to] of aliases) {
          if (spec === from.replace(/\/$/, "") || spec.startsWith(from)) { target = `${to}${spec.slice(from.length)}`; break; }
        }
        if (!target) {
          if (spec.startsWith("/")) target = spec.slice(1);
          else if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") target = resolveRef(args.importer, spec);
          else return undefined; // una librería: la busca esbuild entre las de WILLY
        }
        const found = findFile(files, target);
        if (found) return { path: found, namespace: "proyecto" };
        // Una imagen o una fuente que no está en el proyecto (en CSS): se deja como está (no rompe la compilación).
        if (args.kind === "url-token") return { path: spec, external: true };
        return { errors: [{ text: `No se encuentra «${spec}» en el proyecto (lo importa ${args.importer}).` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "proyecto" }, async (args) => {
        const f = files.get(args.path);
        if (!f) return { errors: [{ text: `No se encuentra «${args.path}» en el proyecto.` }] };
        const ext = extOf(f.path);
        const loader = LOADERS[ext] ?? "text";
        const contents = ext === "css" ? await cssOf(f.path, inlineLocalCssImports(files, norm(f.path), f.content)) : f.content;
        return { contents, loader, resolveDir: root };
      });
    },
  };

  let result: EsbuildResult;
  try {
    const run = esbuild!.build({
      entryPoints: [target.entry],
      bundle: true,
      write: false,
      outdir: "salida",
      entryNames: "app",
      format: "iife",
      platform: "browser",
      target: ["es2020"],
      jsx: "automatic",
      define: envDefines(env),
      nodePaths,
      absWorkingDir: root,
      logLevel: "silent",
      plugins: [plugin],
      loader: { ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl", ".webp": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      minify: false,
      sourcemap: false,
      legalComments: "none",
      charset: "utf8",
    });
    result = await limit(run);
  } catch (error) {
    const raw = (error as { errors?: EsbuildMessage[] })?.errors;
    if (Array.isArray(raw) && raw.length) {
      const missing = [...new Set(raw.map((m) => /^Could not resolve "([^"]+)"/.exec(m.text)?.[1]).filter((s): s is string => Boolean(s) && !/^[./]/.test(s!)).map(packageName))];
      const errors = raw.slice(0, 20).map((m) => {
        const i = issueOf(m);
        const lib = /^Could not resolve "([^"]+)"/.exec(m.text)?.[1];
        return lib && !/^[./]/.test(lib) ? { ...i, text: `Falta la librería «${packageName(lib)}» (no la trae WILLY ni está instalada en tu equipo).` } : i;
      });
      return { ok: false, key, page: target.page, entry: target.entry, ms: Date.now() - started, errors, missing };
    }
    return failWith(`No se pudo compilar: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`, true);
  } finally {
    if (timer) clearTimeout(timer);
  }
  for (const w of result.warnings ?? []) if (warnings.length < 20) warnings.push(issueOf(w));
  const out = result.outputFiles ?? [];
  js = out.find((o) => o.path.endsWith(".js"))?.text ?? "";
  css = out.find((o) => o.path.endsWith(".css"))?.text ?? "";
  return finish(js, css, engine);

  /** La página: sin su <script type="module" src="…main.tsx">, con sus hojas y SVG locales dentro, y el código compilado. */
  function finish(code: string, styles: string, used: CompileEngine): CompileOutcome {
    const t = target!;
    const page = files.get(norm(t.page))!;
    let html = page.content.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs: string) => {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
      return src && resolveRef(page.path, src) === norm(t.entry) ? "" : tag;
    });
    html = inlineAssets(list, page.path, html);
    const style = styles ? `<style data-willy="compilado">${styles.replace(/<\/style/gi, "<\\/style")}</style>` : "";
    const script = `<script data-willy="compilado">${code.replace(/<\/script/gi, "<\\/script")}</script>`;
    html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, (m) => `${style}${m}`) : `${style}${html}`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, (m) => `${script}${m}`) : `${html}${script}`;
    if (html.length > MAX_HTML) return failWith(`El proyecto compilado es demasiado grande para la vista previa (${Math.round(html.length / 1_000_000)} MB).`);
    return { ok: true, key, page: page.path, entry: t.entry, html, ms: Date.now() - started, warnings, tailwind, bytes: html.length, engine: used };
  }
}

/**
 * Rev28 · Las pruebas de un proyecto escritas en TypeScript (lo normal en Playwright): se les quitan los tipos con el TypeScript
 * de WILLY (sin ejecutar nada) y se apunta en qué línea del original cae cada línea, para que un fallo diga la línea de verdad.
 */
export async function transpileTestFiles(list: Array<{ path: string; content: string }>, opts: { root?: string; nodePaths?: string[]; typescript?: TypeScriptLike | null } = {}): Promise<ServiceResult<TranspiledTest[]>> {
  const root = opts.root ?? (await (await import("@/lib/project-root")).projectRoot()) ?? process.cwd();
  const { join, dirname } = await import("node:path");
  const above: string[] = [];
  for (let d = root, i = 0; i < 3; i += 1) { const up = dirname(d); if (up === d) break; d = up; above.push(join(d, "node_modules")); }
  const ts = opts.typescript !== undefined ? opts.typescript : await importFromRoot<TypeScriptLike>(root, "typescript", [...(opts.nodePaths ?? []), ...above]);
  if (!ts || typeof ts.transpileModule !== "function") return fail("No se encuentra el TypeScript de WILLY: las pruebas en TypeScript no se pueden leer (escríbelas en JavaScript, .spec.js).");
  const pick = (e: Record<string, unknown> | undefined, name: string, fallback: number): unknown => e?.[name] ?? fallback;
  const out: TranspiledTest[] = [];
  for (const f of list.slice(0, 60)) {
    try {
      const r = ts.transpileModule(f.content, {
        compilerOptions: { module: pick(ts.ModuleKind, "ESNext", 99), target: pick(ts.ScriptTarget, "ES2020", 7), jsx: pick(ts.JsxEmit, "Preserve", 1), sourceMap: true, inlineSourceMap: false, removeComments: false, isolatedModules: true, useDefineForClassFields: true },
        fileName: f.path.replace(/\\/g, "/").split("/").pop() ?? "prueba.ts",
        reportDiagnostics: true,
      }) as { outputText: string; sourceMapText?: string; diagnostics?: Array<{ messageText: unknown; category?: number; start?: number; file?: { getLineAndCharacterOfPosition: (p: number) => { line: number } } }> };
      const bad = (r.diagnostics ?? []).find((d) => d.category === 1);
      if (bad) {
        const line = bad.file && typeof bad.start === "number" ? bad.file.getLineAndCharacterOfPosition(bad.start).line + 1 : 0;
        out.push({ path: f.path, error: `SyntaxError: ${ts.flattenDiagnosticMessageText(bad.messageText, " ")}`.slice(0, 400), line });
        continue;
      }
      out.push({ path: f.path, code: r.outputText.replace(/\n?\/\/# sourceMappingURL=[^\n]*\s*$/, "\n"), lineMap: lineMapOf(r.sourceMapText ?? null) });
    } catch (error) {
      out.push({ path: f.path, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
  }
  return ok(out);
}

// Lo último compilado (así, volver a abrir el proyecto o recargar no compila otra vez lo mismo) y una compilación detrás de otra.
const cache = new Map<string, CompileOutcome>();
let cacheGeneration = -1;
let chain: Promise<unknown> = Promise.resolve();

/** Rev27: se han instalado o quitado librerías: lo compilado antes (y lo recordado de sus carpetas) ya no vale. */
export function forgetCompiled(): void {
  cache.clear();
  resetLibraryCaches();
}

/** Compila los archivos GUARDADOS de un proyecto (lo que hay en el equipo) o, con `versionId`, los de una de sus versiones. */
export async function compileProject(base: string, id: string, opts: CompileOptions & { versionId?: unknown } = {}): Promise<ServiceResult<CompileOutcome>> {
  const { getProject, getVersion } = await import("@/lib/project-store-server");
  const project = await getProject(base, id);
  if (!project) return fail("Ese proyecto ya no existe.");
  let files = project.files;
  if (typeof opts.versionId === "string" && opts.versionId) {
    const version = await getVersion(base, opts.versionId);
    if (!version || version.projectId !== id) return fail("Esa versión ya no está disponible.");
    files = version.files;
  }
  if (!compileTarget(files)) return fail("Este proyecto no es de los que se compilan (no tiene un index.html con src/main.tsx).");
  // Rev27: las librerías instaladas para los proyectos (si se está instalando alguna, se espera a que termine).
  await librariesIdle();
  if (cacheGeneration !== librariesGeneration()) { forgetCompiled(); cacheGeneration = librariesGeneration(); }
  const key = compileKey(files);
  const hit = cache.get(key);
  if (hit) return ok(hit);
  const root = opts.root ?? (await (await import("@/lib/project-root")).projectRoot()) ?? process.cwd();
  const { join } = await import("node:path");
  const libraryDirs = opts.libraryDirs ?? [join(libraryStoreOf(base), "node_modules")];
  const run = chain.then(() => compileProjectFiles(files, { ...opts, root, libraryDirs }), () => compileProjectFiles(files, { ...opts, root, libraryDirs }));
  chain = run.catch(() => undefined);
  const outcome = await run;
  // Un fallo del EQUIPO (no se encuentra el compilador, tardó demasiado…) no se guarda: al volver a abrir se intenta otra vez.
  if (outcome.ok || !outcome.env) {
    cache.set(key, outcome);
    while (cache.size > 6) cache.delete(cache.keys().next().value as string);
  }
  return ok(outcome);
}
