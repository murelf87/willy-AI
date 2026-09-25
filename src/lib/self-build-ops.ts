// AUTOCONSTRUCCIÓN · OPERACIONES REALES DEL EQUIPO (solo servidor): compilar, instalar el programa compilado con
// intercambio y reiniciar. Antes vivían dentro de la ruta /api/self-build; aquí se pueden probar por separado y las usa el
// gestor (self-build-manager.ts) como «dependencias».
//
// En Windows, un antivirus o el indexador pueden bloquear una carpeta un instante: por eso cada cambio de nombre se reintenta
// unos segundos y, si aun así no se puede, el programa que funcionaba vuelve a su sitio (por nombre o copiándolo). Nunca se
// borra la copia apartada del programa anterior mientras no haya otro programa completo en su sitio.

import { summarizeBuildError, type TsModule } from "@/lib/patch-apply";

/** Informe que deja el ayudante de reinicio si el programa nuevo no arrancó y tuvo que volver al anterior. */
export const RESTART_REPORT = "reinicio-fallido.json";

/** Marca que deja el actualizador oficial (.bat) mientras instala: la Autoconstrucción no empieza nada mientras tanto. */
export const UPDATE_LOCK = "actualizacion-en-curso.json";

export async function exists(target: string): Promise<boolean> {
  const fs = await import("node:fs/promises");
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Bloqueos pasajeros típicos de Windows (antivirus, indexador, un archivo abierto un instante). */
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);

/** Reintenta una operación de disco con esperas crecientes (0,25 s → 4 s; unos 8 s en total) si el fallo es pasajero. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let wait = 250;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !TRANSIENT.has(errorCode(error))) throw error;
      await sleep(wait);
      wait = Math.min(wait * 2, 4000);
    }
  }
}

/** ¿Es la instalación de Windows con el programa compilado (willy-ai.exe)? Si no, es la vista previa o el entorno de desarrollo. */
export async function isInstalled(root: string): Promise<boolean> {
  const path = await import("node:path");
  return exists(path.join(root, "willy-ai.exe"));
}

/** TypeScript de la propia instalación, para comprobar la sintaxis en segundos. Null si no está. */
export async function loadTypeScript(root: string): Promise<TsModule | null> {
  try {
    const { createRequire } = await import("node:module");
    const path = await import("node:path");
    const load = createRequire(path.join(root, "package.json"));
    const mod = load("typescript") as TsModule & { default?: TsModule };
    return typeof mod.transpileModule === "function" ? mod : (mod.default ?? null);
  } catch {
    return null;
  }
}

/** Supervisor estable (lo instala el actualizador oficial; la Autoconstrucción no puede tocarlo). */
export const SAFE_START_FILE = ["supervisor", "arranque-seguro.mjs"] as const;

/**
 * Envuelve el programa recién compilado con el ARRANQUE SEGURO: el servidor de siempre pasa a llamarse willy.mjs y el
 * index.mjs (el que abre el lanzador) es el supervisor, que arranca willy.mjs y, solo si no puede cargarse al abrir WILLY,
 * arranca con la última copia buena. Sin el supervisor instalado (vista previa) no se toca nada.
 */
export async function wrapWithSafeStart(root: string, outputDir: string): Promise<boolean> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const supervisor = path.join(root, ...SAFE_START_FILE);
  if (!(await exists(supervisor))) return false;
  const entry = path.join(outputDir, "server", "index.mjs");
  const inner = path.join(outputDir, "server", "willy.mjs");
  if (!(await exists(inner))) {
    if (!(await exists(entry))) return false;
    await fs.rename(entry, inner);
  }
  await fs.copyFile(supervisor, entry);
  return true;
}

/**
 * Compila con las herramientas de la instalación (`root/node_modules`). Con `cwd`, compila OTRA carpeta (la versión
 * candidata, que vive dentro de la instalación): su programa queda en `cwd/.output` y la versión que funciona no se toca.
 * Si la compilación sale bien, el programa se envuelve con el arranque seguro (si la instalación tiene el supervisor).
 */
export async function runBuild(root: string, cwd: string = root): Promise<{ ok: boolean; detail: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
  try {
    await fs.access(vite);
  } catch {
    return { ok: false, detail: "Faltan las herramientas locales de compilación en esta instalación." };
  }
  try {
    const { spawn } = await import("node:child_process");
    const env: Record<string, string | undefined> = { ...process.env, LOVABLE_SANDBOX: "0" };
    delete env["DEV_SERVER__PROJECT_PATH"];
    const result = await new Promise<{ code: number; output: string }>((resolve) => {
      let output = "";
      const child = spawn(process.execPath, [vite, "build", "--config", "vite.config.local.ts"], { cwd, env, windowsHide: true });
      const timer = setTimeout(() => { child.kill(); resolve({ code: -1, output: `${output}\nTiempo de compilación agotado.` }); }, 180_000);
      child.stdout?.on("data", (chunk) => { output += String(chunk); });
      child.stderr?.on("data", (chunk) => { output += String(chunk); });
      child.on("error", (error) => { clearTimeout(timer); resolve({ code: -1, output: `${output}\n${error.message}` }); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, output }); });
    });
    if (result.code !== 0) return { ok: false, detail: summarizeBuildError(result.output) };
    try {
      const wrapped = await wrapWithSafeStart(root, path.join(cwd, ".output"));
      return { ok: true, detail: wrapped ? "Compilación correcta (con arranque seguro)." : "Compilación correcta." };
    } catch (error) {
      return { ok: false, detail: `Compiló, pero no se pudo preparar el arranque seguro: ${error instanceof Error ? error.message : String(error)}` };
    }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "No se pudo iniciar la compilación." };
  }
}

/**
 * Instala un programa compilado (`source`, normalmente `.output`; al volver atrás, la copia guardada) en `app/.output`
 * con intercambio: la versión que funciona no se borra hasta que la nueva está en su sitio, y si el cambio falla se
 * vuelve a poner la anterior. Si una instalación anterior se quedó a medias (sin programa en su sitio pero con el anterior
 * apartado en `.output-anterior`), primero lo vuelve a poner. Sin willy-ai.exe (vista previa) no instala nada.
 */
export async function deployCompiledApp(root: string, source?: string): Promise<{ installed: boolean; detail: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  if (!(await isInstalled(root))) return { installed: false, detail: "Vista previa actualizada." };
  const built = source ?? path.join(root, ".output");
  const live = path.join(root, "app", ".output");
  const replacement = path.join(root, "app", ".output-nueva");
  const previous = path.join(root, "app", ".output-anterior");
  const complete = (dir: string) => exists(path.join(dir, "server", "index.mjs"));
  if (!(await complete(built))) throw new Error("La compilación no generó el servidor esperado (.output/server/index.mjs).");
  if (!(await complete(live)) && (await complete(previous))) {
    await withRetry(() => fs.rm(live, { recursive: true, force: true }));
    await withRetry(() => fs.rename(previous, live));
  }
  await withRetry(() => fs.rm(replacement, { recursive: true, force: true }));
  await withRetry(() => fs.rm(previous, { recursive: true, force: true }));
  await fs.cp(built, replacement, { recursive: true });
  try {
    await withRetry(() => fs.rename(live, previous));
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      await fs.rm(replacement, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
  try {
    await withRetry(() => fs.rename(replacement, live));
  } catch (error) {
    // Vuelta atrás: el programa que funcionaba vuelve a su sitio; si no se deja cambiar de nombre, se copia.
    try {
      await withRetry(() => fs.rename(previous, live));
    } catch {
      try {
        if (!(await complete(live)) && (await complete(previous))) await fs.cp(previous, live, { recursive: true });
      } catch {
        /* el gestor lo detecta por la huella y pone la copia verificada */
      }
    }
    throw error;
  }
  await fs.rm(previous, { recursive: true, force: true }).catch(() => undefined);
  return { installed: true, detail: "Programa recompilado y preparado para reiniciarse." };
}

/** Programa anterior al que volver si el nuevo no arranca tras reiniciar, y a qué operación se refiere. */
export type RestartInfo = { op?: string; kind?: "mejora" | "vuelta-atras"; target?: string; fallback?: string | null };

export type RestartPlan = {
  parentPid: number;
  execPath: string;
  root: string;
  entry: string;
  port: number;
  killAfterMs: number;
  startAfterMs: number;
  waitMs: number;
  fallback: string | null;
  report: string;
  op: string | null;
  kind: string | null;
  target: string | null;
};

/**
 * Programa (CommonJS) del ayudante que reinicia WILLY: cierra este servidor, arranca el programa instalado y comprueba que
 * responde. Si no responde a tiempo y hay una copia verificada del anterior, lo aparta (app/.output-fallida), pone la copia,
 * vuelve a arrancar y deja un informe para que WILLY lo anote y deje el código como estaba.
 */
export function restartScript(plan: RestartPlan): string {
  return `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const O = ${JSON.stringify(plan)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = () => { const c = spawn(O.execPath, [O.entry], { cwd: O.root, env: { ...process.env, APP_PORT: String(O.port), PORT: String(O.port), HOST: "0.0.0.0", NODE_ENV: "production", WILLY_SIN_RESPALDO: "1" }, detached: true, windowsHide: true, stdio: "ignore" }); c.unref(); return c; };
const answers = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: O.port, path: "/api/local-ai", timeout: 4000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});
const healthy = async (child) => {
  let exited = false;
  child.on("exit", () => { exited = true; });
  child.on("error", () => { exited = true; });
  const until = Date.now() + O.waitMs;
  while (Date.now() < until) {
    if (await answers()) return true;
    if (exited) return false;
    await sleep(2000);
  }
  return false;
};
(async () => {
  await sleep(O.killAfterMs);
  try { process.kill(O.parentPid); } catch {}
  await sleep(O.startAfterMs);
  const child = start();
  if (!O.fallback) return;
  if (await healthy(child)) return;
  let detail = "El programa nuevo no respondió al arrancar.";
  try { process.kill(child.pid); } catch {}
  await sleep(1500);
  const live = path.join(O.root, "app", ".output");
  const failed = path.join(O.root, "app", ".output-fallida");
  try { fs.rmSync(failed, { recursive: true, force: true }); } catch {}
  try { fs.renameSync(live, failed); } catch { try { fs.rmSync(live, { recursive: true, force: true }); } catch {} }
  let restored = true;
  try { fs.cpSync(O.fallback, live, { recursive: true }); } catch (e) { restored = false; detail += " No se pudo volver a poner el anterior: " + (e && e.message ? e.message : e); }
  const again = start();
  const ok = restored && (await healthy(again));
  try {
    fs.mkdirSync(path.dirname(O.report), { recursive: true });
    fs.writeFileSync(O.report, JSON.stringify({ op: O.op, kind: O.kind, target: O.target, at: new Date().toISOString(), detail, restored, answering: ok }, null, 2));
  } catch {}
})();
`;
}

/**
 * Argumentos para lanzar el ayudante con `node`: el programa va en base64 (solo letras, números, «+», «/» y «=»), así las
 * comillas, barras y saltos de línea no pueden estropearse al pasar por la línea de órdenes de Windows.
 */
export function restartArgs(plan: RestartPlan): string[] {
  const encoded = Buffer.from(restartScript(plan), "utf8").toString("base64");
  return ["-e", `eval(Buffer.from('${encoded}','base64').toString('utf8'))`];
}

/**
 * Cierra este servidor a los 3,5 s y arranca el programa instalado (app/.output) 1,2 s después. Con `info.fallback` (copia
 * verificada del programa anterior), si el nuevo no responde en 90 s se vuelve solo al anterior y queda un informe.
 */
export async function scheduleInstalledRestart(root: string, info: RestartInfo = {}): Promise<void> {
  const path = await import("node:path");
  const { spawn } = await import("node:child_process");
  const args = restartArgs({
    parentPid: process.pid,
    execPath: process.execPath,
    root,
    entry: path.join(root, "app", ".output", "server", "index.mjs"),
    port: 3000,
    killAfterMs: 3500,
    startAfterMs: 1200,
    waitMs: 90_000,
    fallback: info.fallback ?? null,
    report: path.join(root, "copias-autoconstruccion", RESTART_REPORT),
    op: info.op ?? null,
    kind: info.kind ?? null,
    target: info.target ?? null,
  });
  const helper = spawn(process.execPath, args, { cwd: root, detached: true, windowsHide: true, stdio: "ignore" });
  helper.unref();
}
