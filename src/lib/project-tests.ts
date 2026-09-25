// PRUEBAS AUTOMÁTICAS DE CADA PROYECTO (revisión 28; rediseño, «Quality Gate»). Cada proyecto lleva sus pruebas: archivos
// «pruebas/<tema>.spec.js» con el formato de Playwright (el de siempre: si algún día el proyecto va a un programador, las
// entiende y las puede pasar con Playwright). WILLY las pasa SOLO, en el equipo del dueño y sin npm: abre la página de verdad
// (la de la vista previa) en un marco aislado e invisible, y hace lo que haría una persona (escribir, pulsar, elegir…) para
// comprobar que todo responde bien. Después de cada cambio de WILLY se vuelven a pasar; si un cambio rompe alguna, se repara
// sola (como la vista previa: 2 intentos o bloqueo). Y el 100 % de un proyecto exige que pasen.
// Aquí, la parte que no depende del navegador: qué archivos son pruebas, cómo se preparan, a qué página va cada «goto», cómo se
// cuentan los resultados, qué se le pide a la IA (escribirlas y arreglar lo que falla) y cuándo se repara sola.
// Lógica pura: la usan la pantalla y el servidor, y se prueba aparte (cctest/rev28).

import type { GeneratedFile } from "@/lib/ai-standard";
import { compileKey } from "@/lib/project-compile";
import { resolveRef } from "@/lib/live-files";
import type { TestsEvidence } from "@/lib/project-progress";

export type { TestsEvidence };

// ------------------------------------------------------------------------------------------------ qué archivos son pruebas
/** Archivos de pruebas (como Playwright: «*.spec.js», «*.test.ts»…). */
export const TEST_FILE = /(?:^|\/)[^/]+\.(?:spec|test)\.(?:[cm]?[jt]sx?)$/i;
const PW_MODULE = /^(?:@playwright\/test|playwright\/test|playwright)$/;
const USES_PW = /(?:from\s*|require\(\s*)["'](?:@playwright\/test|playwright\/test|playwright)["']/;
const USES_PAGE = /\(\s*\{[^}]*\bpage\b[^}]*\}\s*\)\s*=>|async\s*\(\s*\{\s*page\b/;

/** Las pruebas del proyecto que WILLY puede pasar (Playwright) y las que no (pruebas unitarias de Vitest/Jest…). */
export function testFilesOf(files: ReadonlyArray<GeneratedFile>): { runnable: GeneratedFile[]; unit: string[] } {
  const runnable: GeneratedFile[] = [];
  const unit: string[] = [];
  for (const f of files) {
    const p = f.path.replace(/\\/g, "/");
    if (!TEST_FILE.test(p) || /(?:^|\/)node_modules\//.test(p)) continue;
    if (USES_PW.test(f.content) || (/(?:^|\/)(?:pruebas|tests?|e2e)\//i.test(p) && USES_PAGE.test(f.content))) runnable.push(f);
    else unit.push(f.path);
  }
  runnable.sort((a, b) => a.path.localeCompare(b.path));
  return { runnable, unit };
}

export const isTypeScriptTest = (path: string): boolean => /\.(?:[cm]?ts|tsx)$/i.test(path);

/** La huella de los archivos del proyecto (la misma que usa la compilación): dice si las pruebas son de lo que hay ahora. */
export const filesKeyOf = (files: GeneratedFile[]): string => compileKey(files);

// ------------------------------------------------------------------------------------------------ preparar un archivo
const lineOf = (code: string, index: number): number => code.slice(0, index).split("\n").length;
const newlines = (s: string): string => "\n".repeat((s.match(/\n/g) ?? []).length);

/**
 * Un archivo de pruebas listo para el pasador: sus importaciones de @playwright/test pasan a ser lo que da WILLY (`__pw`), sin
 * mover ninguna línea (así los errores dicen la línea de verdad). Otras importaciones no se pueden usar (cada archivo va solo).
 */
export function prepareTestSource(path: string, source: string): { ok: true; code: string } | { ok: false; error: string; line: number } {
  let code = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (code.startsWith("#!")) code = code.replace(/^#![^\n]*/, "");
  let usedPw = false;
  let failure: { error: string; line: number } | null = null;
  const IMPORT = /^[ \t]*import\s+(type\s+)?([\s\S]*?)\s*from\s*(["'])([^"'\n]+)\3[ \t]*;?|^[ \t]*import\s*(["'])([^"'\n]+)\5[ \t]*;?/gm;
  code = code.replace(IMPORT, (whole: string, typeOnly: string | undefined, clause: string | undefined, _q: string, mod: string | undefined, _q2: string, bare: string | undefined, offset: number) => {
    const module = (mod ?? bare ?? "").trim();
    if (!PW_MODULE.test(module)) {
      failure ??= { error: `La prueba importa «${module}»: en las pruebas de WILLY cada archivo va solo y solo puede usar @playwright/test.`, line: lineOf(code, offset) };
      return whole;
    }
    usedPw = true;
    if (typeOnly || !clause) return newlines(whole);
    const parts: string[] = [];
    let rest = clause.trim();
    const ns = /^\*\s*as\s+([\w$]+)$/.exec(rest);
    if (ns) return `const ${ns[1]} = __pw;${newlines(whole)}`;
    const def = /^([\w$]+)\s*(?:,\s*([\s\S]*))?$/.exec(rest);
    if (def && !rest.startsWith("{")) {
      parts.push(`const ${def[1]} = __pw;`);
      rest = (def[2] ?? "").trim();
    }
    const named = /^\{([\s\S]*)\}$/.exec(rest);
    if (named) {
      const names = named[1]!.split(",").map((n) => n.trim()).filter((n) => n && !/^type\s/.test(n)).map((n) => {
        const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(n);
        return m ? (m[2] ? `${m[1]}: ${m[2]}` : m[1]!) : "";
      }).filter(Boolean);
      if (names.length) parts.push(`const { ${names.join(", ")} } = __pw;`);
    }
    return `${parts.join(" ")}${newlines(whole)}`;
  });
  if (failure) return { ok: false, ...(failure as { error: string; line: number }) };
  code = code.replace(/require\(\s*(["'])([^"'\n]+)\1\s*\)/g, (whole: string, _q: string, mod: string) => {
    if (PW_MODULE.test(mod)) { usedPw = true; return "__pw"; }
    return whole;
  });
  const badRequire = /\brequire\(\s*["']([^"'\n]+)["']\s*\)/.exec(code);
  if (badRequire) return { ok: false, error: `La prueba usa require(«${badRequire[1]}»): en las pruebas de WILLY cada archivo va solo y solo puede usar @playwright/test.`, line: lineOf(code, badRequire.index) };
  // «export» no tiene sentido dentro del pasador (cada archivo va solo): se quita sin mover líneas.
  code = code.replace(/^([ \t]*)export\s+default\s+/gm, "$1").replace(/^([ \t]*)export\s+(?=(?:const|let|var|function|async|class)\b)/gm, "$1").replace(/^[ \t]*export\s*\{[^}]*\}[ \t]*;?/gm, (m) => newlines(m));
  if (!usedPw) code = `const { test, expect, devices } = __pw; ${code}`;
  return { ok: true, code };
}

/** Una prueba del proyecto en TypeScript sin tipos (o por qué no se ha podido leer) y en qué línea del original cae cada línea. */
export type TranspiledTest = { path: string; code?: string; lineMap?: number[] | null; error?: string; line?: number };

/**
 * En qué línea del original cae cada línea de una prueba en TypeScript a la que se le han quitado los tipos (del «source map»
 * que da el TypeScript de WILLY). `map[n - 1]` es la línea original de la línea `n`; sin datos, null.
 */
export function lineMapOf(sourceMap: string | null): number[] | null {
  if (!sourceMap) return null;
  let mappings: unknown;
  try { mappings = (JSON.parse(sourceMap) as { mappings?: unknown }).mappings; } catch { return null; }
  if (typeof mappings !== "string") return null;
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const decode = (seg: string): number[] => {
    const out: number[] = [];
    let value = 0, shift = 0;
    for (const ch of seg) {
      const digit = B64.indexOf(ch);
      if (digit < 0) return out;
      value += (digit & 31) << shift;
      if (digit & 32) { shift += 5; continue; }
      out.push(value & 1 ? -(value >> 1) : value >> 1);
      value = 0;
      shift = 0;
    }
    return out;
  };
  const map: number[] = [];
  let srcLine = 0;
  for (const line of mappings.split(";")) {
    let first = 0;
    for (const seg of line.split(",")) {
      if (!seg) continue;
      const v = decode(seg);
      if (v.length >= 4) { srcLine += v[2]!; if (!first) first = srcLine + 1; }
    }
    map.push(first);
  }
  for (let i = 0; i < map.length; i += 1) if (!map[i]) map[i] = i > 0 ? map[i - 1]! : 1;
  return map;
}

// ------------------------------------------------------------------------------------------------ a qué página va cada «goto»
const normPath = (p: string): string => p.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
export type GotoTarget = { page: string | null; hash: string } | { blank: true } | { error: string };

/**
 * «page.goto(url)» dentro del proyecto: «/» es la página principal, «/#/reservas» una pantalla de ella, «/otra.html» otra página
 * y «#/x» la misma página en otra ruta. Da igual el servidor que diga (localhost…): todo es del proyecto.
 */
export function resolveGoto(url: string, ctx: { pages: string[]; main: string | null; current: string | null }): GotoTarget {
  const raw = String(url ?? "").trim();
  if (/^about:blank$/i.test(raw)) return { blank: true };
  if (/^(?:data|javascript|file|mailto|tel):/i.test(raw)) return { error: `«${raw.slice(0, 80)}» no es una página del proyecto.` };
  const noOrigin = raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/#?]*/i, "");
  const hashAt = noOrigin.indexOf("#");
  const hash = hashAt >= 0 ? noOrigin.slice(hashAt) : "";
  const path = (hashAt >= 0 ? noOrigin.slice(0, hashAt) : noOrigin).replace(/\?.*$/, "");
  if (hash.length > 200 || /[<>"'`\s\\]/.test(hash)) return { error: `La ruta «${hash.slice(0, 60)}» no es válida.` };
  if (!path) return { page: raw.startsWith("#") ? ctx.current ?? ctx.main : ctx.main, hash: hash === "#" ? "" : hash };
  if (path === "/" || path === "./") return { page: ctx.main, hash: hash === "#" ? "" : hash };
  const target = resolveRef(path.startsWith("/") ? "" : ctx.current ?? "", path);
  const found = ctx.pages.find((p) => normPath(p) === normPath(target)) ?? (ctx.main && /^index\.html?$/i.test(normPath(target)) ? ctx.main : null);
  if (found) return { page: found, hash: hash === "#" ? "" : hash };
  const route = path.replace(/^\/+/, "");
  if (!/\.[a-z0-9]{2,5}$/i.test(route)) return { error: `La página «${path}» no existe en el proyecto (las pantallas se abren con «/#/${route}»).` };
  return { error: `La página «${path}» no existe en el proyecto.` };
}

/** Un enlace a otra página del proyecto (lo cuenta el vigía): relativo a la página en la que está. */
export function resolveLink(ruta: string, ctx: { pages: string[]; main: string | null; current: string | null }): GotoTarget {
  const r = String(ruta ?? "").trim();
  if (r.startsWith("/") || r.startsWith("#")) return resolveGoto(r, ctx);
  return resolveGoto(`/${resolveRef(ctx.current ?? "", r.replace(/#.*$/, ""))}${r.includes("#") ? r.slice(r.indexOf("#")) : ""}`, ctx);
}

/** La dirección que ve la prueba (page.url()): la página principal es «/». */
export function pageUrl(page: string | null, hash: string, main: string | null): string {
  if (!page) return "about:blank";
  return `http://localhost/${page === main ? "" : page.replace(/^\/+/, "")}${hash}`;
}

// ------------------------------------------------------------------------------------------------ resultados
export type TestStatus = "ok" | "fallo" | "saltada" | "no-pasada";
export type TestError = {
  /** Para cualquiera, en castellano. */
  plain: string;
  /** Para la IA (como lo diría Playwright). */
  detail: string;
  file: string;
  line: number;
  timeout: boolean;
  unsupported: boolean;
  /** El error es del código de la prueba (no de la aplicación). */
  inTest: boolean;
  expected: string | null;
  received: string | null;
  others: number;
};
export type TestResult = { id: string; file: string; title: string; status: TestStatus; ms: number; line: number; error: TestError | null; steps: string[]; pageErrors: string[]; dialogs: string[] };
export type RunStatus = "bien" | "fallos" | "sin-pruebas" | "no-arranca" | "parado";
export type TestRun = {
  /** Huella de los archivos probados. */
  key: string;
  at: string;
  startedAt: number;
  ms: number;
  status: RunStatus;
  results: TestResult[];
  /** Archivos de pruebas que WILLY no pasa (pruebas unitarias). */
  unit: string[];
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** Por qué no se ha podido pasar (si no arranca). */
  note: string | null;
};

const str = (v: unknown, max: number): string => String(v ?? "").slice(0, max);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
const strList = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v.slice(0, n).map((x) => str(x, max)) : []);

/** Un resultado tal como lo cuenta el pasador, comprobado campo a campo. */
export function normalizeResult(raw: Record<string, unknown>): TestResult {
  const e = raw["error"] && typeof raw["error"] === "object" ? (raw["error"] as Record<string, unknown>) : null;
  const status = ["ok", "fallo", "saltada", "no-pasada"].includes(raw["estado"] as string) ? (raw["estado"] as TestStatus) : "fallo";
  return {
    id: str(raw["id"], 400),
    file: str(raw["archivo"], 300),
    title: str(raw["titulo"], 300) || "(sin nombre)",
    status,
    ms: num(raw["ms"]),
    line: num(raw["linea"]),
    error: e ? {
      plain: str(e["plano"], 600) || "Ha fallado.",
      detail: str(e["detalle"], 1500),
      file: str(e["archivo"], 300),
      line: num(e["linea"]),
      timeout: e["tiempo"] === true,
      unsupported: e["nosoportado"] === true,
      inTest: e["enPrueba"] === true,
      expected: e["esperado"] == null ? null : str(e["esperado"], 300),
      received: e["recibido"] == null ? null : str(e["recibido"], 300),
      others: num(e["otros"]),
    } : status === "fallo" ? { plain: "Ha fallado.", detail: "", file: str(raw["archivo"], 300), line: num(raw["linea"]), timeout: false, unsupported: false, inTest: false, expected: null, received: null, others: 0 } : null,
    steps: strList(raw["pasos"], 12, 200),
    pageErrors: strList(raw["erroresPagina"], 5, 400),
    dialogs: strList(raw["dialogos"], 5, 300),
  };
}

/** Un archivo de pruebas que no se puede leer (mal escrito) cuenta como una prueba que falla: hay que arreglarlo. */
export function loadErrorResult(file: string, message: string, line: number): TestResult {
  return {
    id: `${file} › (archivo)`, file, title: `${file.split("/").pop()} (el archivo)`, status: "fallo", ms: 0, line,
    error: { plain: `El archivo de pruebas no se puede leer: ${message}`, detail: `${message}${line ? ` (línea ${line})` : ""}`, file, line, timeout: false, unsupported: false, inTest: true, expected: null, received: null, others: 0 },
    steps: [], pageErrors: [], dialogs: [],
  };
}

/** La pasada completa, con sus cuentas. */
export function buildRun(input: { key: string; startedAt: number; ms: number; results: TestResult[]; unit: string[]; stopped?: boolean; note?: string | null }): TestRun {
  const results = input.results;
  const passed = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "fallo").length;
  const skipped = results.filter((r) => r.status === "saltada" || r.status === "no-pasada").length;
  const status: RunStatus = input.note && !results.length ? "no-arranca" : input.stopped ? "parado" : !results.length ? "sin-pruebas" : failed ? "fallos" : "bien";
  return { key: input.key, at: new Date(input.startedAt).toISOString(), startedAt: input.startedAt, ms: input.ms, status, results, unit: input.unit, total: results.length, passed, failed, skipped, note: input.note ?? null };
}

// ------------------------------------------------------------------------------------------------ contarlo
const secs = (ms: number): string => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
const names = (list: TestResult[], n = 3): string => `${list.slice(0, n).map((r) => `«${r.title}»`).join(", ")}${list.length > n ? ` y ${list.length - n} más` : ""}`;

/** «5 de 5 bien», «4 de 5 bien · 1 falla»… */
export function testsSummary(run: TestRun | null): string {
  if (!run) return "Sin pasar todavía";
  if (run.status === "no-arranca") return `No se han podido pasar${run.note ? `: ${run.note}` : ""}`;
  if (run.status === "sin-pruebas") return "Sin pruebas todavía";
  const ran = run.passed + run.failed;
  const base = `${run.passed} de ${ran} bien`;
  const extra = [run.failed ? `${run.failed} falla${run.failed === 1 ? "" : "n"}` : "", run.skipped ? `${run.skipped} sin pasar` : "", run.status === "parado" ? "paradas" : ""].filter(Boolean);
  return extra.length ? `${base} · ${extra.join(" · ")}` : base;
}

/** Lo que dice el botón «Pruebas»: «5/5» en verde, «1 falla» en rojo… */
export function testsBadge(run: TestRun | null): { text: string; tone: "bien" | "fallo" | "nada" } {
  if (!run || run.status === "sin-pruebas" || run.status === "no-arranca") return { text: "", tone: "nada" };
  if (run.failed) return { text: `${run.failed} falla${run.failed === 1 ? "" : "n"}`, tone: "fallo" };
  return { text: `${run.passed}/${run.passed + run.failed}`, tone: "bien" };
}

/** Rev28 · El botón con lo apuntado en el plan (la última pasada de otra sesión, con estos mismos archivos). */
export function testsBadgeOfEvidence(ev: TestsEvidence | null | undefined): { text: string; tone: "bien" | "fallo" | "nada" } {
  if (!ev || ev.total <= 0) return { text: "", tone: "nada" };
  if (ev.failed) return { text: `${ev.failed} falla${ev.failed === 1 ? "" : "n"}`, tone: "fallo" };
  return { text: `${ev.passed}/${ev.passed + ev.failed}`, tone: "bien" };
}

/** Las líneas de la consola del proyecto después de una pasada. */
export function testsConsoleLines(run: TestRun): Array<{ level: "info" | "warn" | "error"; text: string }> {
  const out: Array<{ level: "info" | "warn" | "error"; text: string }> = [];
  const failing = run.results.filter((r) => r.status === "fallo");
  out.push({ level: run.failed ? "error" : run.status === "no-arranca" ? "warn" : "info", text: `Pruebas: ${testsSummary(run)}${run.ms ? ` (${secs(run.ms)})` : ""}.` });
  for (const r of failing.slice(0, 6)) out.push({ level: "error", text: `Prueba ${`«${r.title}»`}${r.error?.line || r.line ? ` (${r.error?.file || r.file}, línea ${r.error?.line || r.line})` : ""}: ${r.error?.plain ?? "ha fallado"}` });
  if (run.unit.length) out.push({ level: "warn", text: `Pruebas unitarias que WILLY no pasa aquí (solo pasa las de Playwright): ${run.unit.slice(0, 4).join(", ")}${run.unit.length > 4 ? "…" : ""}.` });
  return out;
}

/** Una frase para la IA (va con lo que ve el dueño): así entiende «la prueba que falla». */
export function testsForAi(run: TestRun | null): string | null {
  if (!run || run.status === "sin-pruebas") return null;
  if (run.status === "no-arranca") return `PRUEBAS AUTOMÁTICAS: no se han podido pasar (${run.note ?? "error"}).`;
  const failing = run.results.filter((r) => r.status === "fallo");
  return `PRUEBAS AUTOMÁTICAS DEL PROYECTO: ${run.total} (${run.passed} bien${run.failed ? `, ${run.failed} fallan: ${failing.slice(0, 3).map((r) => `«${r.title}» — ${r.error?.plain ?? "falla"}`).join("; ")}` : ""}).`;
}

// ------------------------------------------------------------------------------------------------ lo que se le pide a la IA
/** Cómo escribe la IA las pruebas (va en las reglas de SUPER WILLY cuando trabaja en un proyecto con vista previa). */
export const TESTS_RULES = [
  "PRUEBAS AUTOMÁTICAS (WILLY las pasa solo, en la vista previa y sin npm, después de cada cambio):",
  "- Van en «pruebas/<tema>.spec.js» (JavaScript), con el formato de Playwright:",
  '  import { test, expect } from "@playwright/test";',
  '  test("añadir una tarea", async ({ page }) => {',
  '    await page.goto("/");',
  '    await page.getByPlaceholder("Nueva tarea").fill("Comprar pan");',
  '    await page.getByRole("button", { name: "Añadir" }).click();',
  '    await expect(page.getByRole("listitem")).toHaveText(["Comprar pan"]);',
  "  });",
  "- Una prueba por cada cosa importante que hace un usuario (pocas y claras). Cada prueba empieza de cero (sin nada guardado).",
  '- Se abre con page.goto("/") (la página principal), page.goto("/#/reservas") (una pantalla) o page.goto("/otra.html").',
  "- Busca como una persona: getByRole (con name), getByLabel, getByPlaceholder, getByText; getByTestId solo si no hay otra forma. Nada de selectores frágiles.",
  "- Comprueba lo que SE VE: toBeVisible, toHaveText, toContainText, toHaveValue, toHaveCount, toBeChecked, toHaveURL, toHaveTitle. Sin esperas fijas: Playwright espera solo.",
  '- Si la aplicación pregunta con confirm(), acéptalo en la prueba: page.on("dialog", (d) => d.accept()).',
  "- Solo @playwright/test (ninguna otra importación); sin request, route, capturas ni archivos.",
  "- Si cambias una función, actualiza su prueba. Nunca borres ni suavices una prueba para que pase (solo si el dueño quita esa función, y dilo).",
].join("\n");

/** «Escribir las pruebas»: lo que se le pide a WILLY (y lo que ve el dueño en el chat). */
export function testsWriteRequest(input: { existing: string[]; functions: string[]; screens?: string | null }): { text: string; ownerText: string } {
  const fns = input.functions.map((f) => f.trim()).filter(Boolean).slice(0, 15);
  const head = input.existing.length
    ? `Completa las PRUEBAS AUTOMÁTICAS de este proyecto: ya tiene ${input.existing.join(", ")}. Añade las que falten para las funciones principales y actualiza las que ya no sirvan.`
    : "Escribe las PRUEBAS AUTOMÁTICAS de este proyecto: un archivo por tema en «pruebas/<tema>.spec.js».";
  return {
    text: [
      `${head} Tienen que comprobar lo que hace de verdad un usuario con cada función principal${fns.length ? `: ${fns.join("; ")}` : ""}.${input.screens ? ` ${input.screens}` : ""}`,
      TESTS_RULES,
      "No cambies nada más del proyecto (si ves un error en él, dilo). Entrega los archivos de pruebas COMPLETOS.",
    ].join("\n\n"),
    ownerText: input.existing.length ? "Añade las pruebas automáticas que falten." : "Escribe las pruebas automáticas del proyecto.",
  };
}

/** Lo que se le pide a WILLY para que pasen las que fallan (a mano, con «Arreglar lo que falla», o sola). */
export function testsRepairRequest(failing: TestResult[], opts: { attempt?: number; max?: number } = {}): { text: string; ownerText: string } {
  const lines = failing.slice(0, 6).map((r) => {
    const where = r.error?.line || r.line ? ` (${r.error?.file || r.file}, línea ${r.error?.line || r.line})` : ` (${r.file})`;
    const out = [`- «${r.title}»${where}: ${r.error?.plain ?? "falla"}`];
    const detail = (r.error?.detail ?? "").split("\n").filter((l) => l.trim()).slice(0, 7).join(" | ");
    if (detail) out.push(`  Detalle: ${detail}`);
    if (r.steps.length) out.push(`  Pasos: ${r.steps.slice(-6).join(" → ")}`);
    if (r.pageErrors.length) out.push(`  Errores de la página: ${r.pageErrors.slice(0, 2).join(" | ")}`);
    return out.join("\n");
  });
  const more = failing.length > 6 ? [`(y ${failing.length - 6} más)`] : [];
  const attempt = opts.attempt ? [`(Reparación automática, intento ${opts.attempt} de ${opts.max ?? MAX_TEST_REPAIRS}: después del último cambio fallan estas pruebas. Arregla SOLO lo necesario para que pasen.)`] : [];
  return {
    text: [
      "Fallan pruebas automáticas del proyecto (WILLY las pasa en la vista previa, con el formato de Playwright). Arregla el PROYECTO para que pasen, sin romper lo demás:",
      ...lines,
      ...more,
      "Si una prueba está MAL (comprueba algo que el dueño no ha pedido o que ya no existe, o usa algo que WILLY no puede usar), corrige esa prueba y dilo; si no, NO cambies las pruebas.",
      "Entrega los archivos que cambies COMPLETOS.",
      ...attempt,
    ].join("\n"),
    ownerText: `Arregla lo que falla en las pruebas: ${names(failing)}.`,
  };
}

/** Evidencia para el plan del proyecto (de ahí salen «Funciones principales probadas» y el 100 %). */
export function testsEvidenceOf(run: TestRun): TestsEvidence | null {
  if (run.status === "no-arranca" || run.status === "parado") return null;
  return { total: run.passed + run.failed, passed: run.passed, failed: run.failed, skipped: run.skipped, key: run.key, at: run.at };
}

// ------------------------------------------------------------------------------------------------ reparación automática
/** Como mucho, estos intentos seguidos de arreglar las pruebas que rompe un cambio; después, bloqueo. */
export const MAX_TEST_REPAIRS = 2;
/** Cuánto se espera la pasada de pruebas después de que WILLY guarde un cambio. */
export const TESTS_WATCH_MS = 10 * 60_000;

/**
 * Vigilancia de las pruebas tras un cambio de WILLY: `before` es cómo estaba cada prueba ANTES del cambio (las que ya fallaban
 * no las ha roto este cambio), `attempt` 0 tras un cambio normal y 1..MAX tras cada intento de reparación.
 */
export type TestsWatch = { projectId: string; attempt: number; before: Record<string, TestStatus> | null; at: number };
export type TestsStep =
  | { kind: "nada" }
  | { kind: "reparar"; attempt: number; failing: TestResult[] }
  | { kind: "recuperadas"; attempt: number; total: number }
  | { kind: "bloqueo"; attempts: number; failing: TestResult[] }
  | { kind: "avisar"; failing: TestResult[] };

export function testsWatchAfterSave(input: { projectId: string; before: TestRun | null; attempt?: number; now?: number }): TestsWatch {
  const before = input.before ? Object.fromEntries(input.before.results.map((r) => [r.id, r.status])) : null;
  return { projectId: input.projectId, attempt: input.attempt ?? 0, before, at: input.now ?? Date.now() };
}

/** Qué hacer con una pasada de pruebas mientras se vigila un cambio (función pura). */
export function testsStep(watch: TestsWatch | null, input: { projectId: string | null; run: TestRun; auto: boolean; now: number }): { step: TestsStep; watch: TestsWatch | null } {
  const none: TestsStep = { kind: "nada" };
  if (!watch) return { step: none, watch: null };
  if (watch.projectId !== input.projectId || input.now - watch.at > TESTS_WATCH_MS) return { step: none, watch: null };
  // Una pasada que empezó antes de guardar el cambio es de lo de antes: se sigue esperando la buena.
  if (input.run.startedAt < watch.at) return { step: none, watch };
  if (input.run.status === "no-arranca" || input.run.status === "parado") return { step: none, watch: null };
  const failing = input.run.results.filter((r) => r.status === "fallo");
  const relevant = watch.attempt > 0 ? failing : failing.filter((r) => watch.before?.[r.id] !== "fallo");
  if (!relevant.length) return { step: watch.attempt > 0 ? { kind: "recuperadas", attempt: watch.attempt, total: input.run.passed } : none, watch: null };
  if (!input.auto) return { step: { kind: "avisar", failing: relevant }, watch: null };
  if (watch.attempt >= MAX_TEST_REPAIRS) return { step: { kind: "bloqueo", attempts: watch.attempt, failing: relevant }, watch: null };
  return { step: { kind: "reparar", attempt: watch.attempt + 1, failing: relevant }, watch: null };
}

/** Lo que WILLY escribe en el chat del proyecto en cada paso. `good` describe la última versión en la que pasaban. */
export function testsNote(step: TestsStep, good?: string | null): string | null {
  switch (step.kind) {
    case "reparar":
      return `🧪 Después del último cambio fallan ${step.failing.length} prueba(s) automática(s): ${names(step.failing)}. Lo arreglo yo solo: intento ${step.attempt} de ${MAX_TEST_REPAIRS} (lo de antes queda guardado en Versiones).`;
    case "recuperadas":
      return `✓ Pruebas en verde otra vez: después de la reparación (intento ${step.attempt} de ${MAX_TEST_REPAIRS}) pasan ${step.total === 1 ? "la prueba" : `las ${step.total}`}.`;
    case "bloqueo":
      return `⚠️ BLOQUEO: he intentado arreglarlo ${step.attempts} veces y siguen fallando ${step.failing.length} prueba(s): ${names(step.failing)}. No sigo probando a ciegas. ${good ? `Dime «vuelve a la versión que funcionaba» y vuelvo a ${good}` : "Dime «vuelve a la versión anterior» para deshacer el último cambio"}; o pulsa «Arreglar lo que falla» en Pruebas para intentarlo otra vez.`;
    case "avisar":
      return `⚠️ Después de este cambio fallan ${step.failing.length} prueba(s) automática(s): ${names(step.failing)}. Pulsa «Arreglar lo que falla» en Pruebas, o dime «vuelve a la versión anterior».`;
    default:
      return null;
  }
}
