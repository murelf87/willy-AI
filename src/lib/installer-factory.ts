// FÁBRICA DE INSTALADORES (solo servidor). Convierte un proyecto con el formato de programa de escritorio en un instalador
// de Windows REAL y lo prueba de verdad en este equipo, siempre en este orden:
//   1. comprueba el formato (sin inventar nada: si falta algo, lo dice);
//   2. monta el programa: su pantalla y su lógica, el motor de escritorio, su propio motor de Node y su icono;
//   3. compila el lanzador y el instalador con NSIS (incluido en WILLY, tools/nsis);
//   4. lo instala en silencio en una carpeta vacía (modo prueba: no toca el programa del dueño si ya lo tiene instalado)
//      y comprueba archivos, accesos directos y la entrada de «Aplicaciones instaladas»;
//   5. arranca el programa instalado (autoprueba del motor);
//   6. ejecuta sus pruebas de aceptación AISLADAS (solo pueden leer el programa y escribir en su carpeta de datos de prueba);
//   7. lo desinstala y comprueba que no queda nada;
//   8. deja el informe (docs para la pestaña Replicación) y el instalador listo para descargar.
// Nada se da por bueno sin comprobarlo: lo que no se ha podido comprobar queda «pendiente» con el motivo.

import runtimeSource from "@/lib/desktop-runtime/servidor.mjs?raw";
import {
  FACTORY_CHECK_LABELS, fileSafeName, motorExeName, packageFingerprintText, planDesktopPackage,
  type FactoryCheck, type FactoryCheckId, type FactoryCheckStatus, type FactoryReport, type FactoryStep, type PackagePlan, type ProjectFile,
} from "@/lib/desktop-format";
import { installerScript, launcherScript } from "@/lib/installer-scripts";
import { iconIco, iconPng } from "@/lib/app-icon";

export const NSIS_VERSION = "3.05";

export type RunResult = { code: number | null; out: string; timedOut: boolean };
/** verbatim + argv0: la línea de órdenes va tal cual (lo necesitan los instaladores de NSIS para /D= y _?=). */
export type RunOptions = { cwd?: string; env?: Record<string, string>; timeoutMs: number; verbatim?: boolean; argv0?: string };
export type RunFn = (file: string, args: string[], options: RunOptions) => Promise<RunResult>;

export type FactoryTools = {
  platform: string;
  /** Compilador de NSIS (tools/nsis/Bin/makensis.exe en Windows). */
  makensis: string | null;
  /** Variables para el compilador (NSISDIR cuando no está junto a su carpeta). */
  nsisEnv: Record<string, string>;
  /** Node que se empaqueta como motor del programa (el mismo que usa WILLY: tools/node.exe). */
  motor: string | null;
  run: RunFn;
  /** Solo en Windows se instala y desinstala de verdad. */
  windows: boolean;
  /** Ejecutable con el que se arranca el programa instalado (por defecto, su propio motor). */
  motorPara?: (instalado: string, motor: string) => string;
  install?: (setup: string, dir: string) => Promise<RunResult>;
  uninstall?: (dir: string) => Promise<RunResult>;
  /** ¿Existe este valor del registro (por defecto DisplayName)? null = no se puede mirar en este equipo. */
  registryHas?: (key: string, value?: string) => Promise<boolean | null>;
  now?: () => Date;
};

export type FactoryRequest = { projectId: string; name: string; description?: string; editor?: string; files: ProjectFile[] };

export type FactoryJob = {
  id: string;
  projectId: string;
  startedAt: string;
  step: FactoryStep;
  log: string[];
  done: boolean;
  report: FactoryReport | null;
  error: string | null;
};

const jobs = new Map<string, FactoryJob>();
let active: string | null = null;

async function node() {
  const fs = await import("node:fs/promises");
  const fsSync = await import("node:fs");
  const path = await import("node:path");
  const crypto = await import("node:crypto");
  const zlib = await import("node:zlib");
  return { fs, fsSync, path, crypto, zlib };
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Carpeta de la fábrica para un proyecto (fuera de src/: nunca se mezcla con el código de WILLY). */
export function safeProjectDir(projectId: string): string {
  const clean = projectId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return clean || "proyecto";
}

async function exists(target: string): Promise<boolean> {
  const { fs } = await node();
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function rmrf(target: string): Promise<void> {
  const { fs } = await node();
  await fs.rm(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
}

/** Ejecuta un programa sin ventana, con límite de tiempo (en Windows cierra también sus procesos hijos). */
export async function runProcess(file: string, args: string[], options: RunOptions): Promise<RunResult> {
  const { spawn, execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    let child: import("node:child_process").ChildProcess;
    try {
      child = spawn(file, args, {
        cwd: options.cwd, env: { ...process.env, ...(options.env ?? {}) }, windowsHide: true,
        windowsVerbatimArguments: Boolean(options.verbatim), stdio: ["ignore", "pipe", "pipe"],
        ...(options.argv0 ? { argv0: options.argv0 } : {}),
      });
    } catch (error) {
      resolve({ code: -1, out: message(error), timedOut: false });
      return;
    }
    const add = (d: Buffer) => {
      if (out.length < 400_000) out += d.toString("utf8");
    };
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
      else child.kill("SIGKILL");
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, out: `${out}\n${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, timedOut });
    });
  });
}

/** Herramientas de este equipo (se pueden cambiar con variables de entorno para probar la fábrica en otro sistema). */
export async function defaultTools(root: string): Promise<FactoryTools> {
  const { path } = await node();
  const env = process.env;
  const win = process.platform === "win32";
  const bundled = path.join(root, "tools", "nsis");
  const candidates = [env["WILLY_MAKENSIS"], path.join(bundled, "Bin", "makensis.exe"), path.join(bundled, "makensis.exe")].filter((x): x is string => Boolean(x));
  let makensis: string | null = null;
  for (const c of candidates) if (!makensis && (await exists(c))) makensis = c;
  let motor: string | null = null;
  for (const c of [env["WILLY_MOTOR"], path.join(root, "tools", "node.exe"), path.join(root, "node", "node.exe")].filter((x): x is string => Boolean(x))) {
    if (!motor && (await exists(c))) motor = c;
  }
  // Con el NSIS incluido en WILLY se le indica siempre su carpeta (así no usa otro NSIS que haya en el equipo).
  const nsisDir = env["WILLY_NSISDIR"] ?? (makensis && makensis.startsWith(bundled + path.sep) ? bundled : "");
  const tools: FactoryTools = { platform: process.platform, makensis, nsisEnv: nsisDir ? { NSISDIR: nsisDir } : {}, motor, run: runProcess, windows: win };
  if (win) {
    tools.registryHas = async (key, value = "DisplayName") => {
      const r = await runProcess("reg", ["query", key, "/v", value], { timeoutMs: 20_000 });
      return r.code === 0;
    };
  }
  return tools;
}

/** Lee instalacion.ini tal como lo escribe el instalador (UTF-16 con marca; si no, Latin-1). */
export function parseIni(bytes: Uint8Array): Record<string, string> {
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? new TextDecoder("utf-16le").decode(bytes.subarray(2)) : new TextDecoder("latin1").decode(bytes);
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([^=;[\]]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!.toLowerCase()] = m[2]!;
  }
  return out;
}

/** Resumen de una salida TAP de node:test. */
export function parseTap(out: string): { tests: number; pass: number; fail: number; cancelled: number; failures: string[] } {
  const num = (name: string) => Number((new RegExp(`^# ${name} (\\d+)`, "m").exec(out) ?? [])[1] ?? 0);
  const failures = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]!.trim()).slice(0, 8);
  return { tests: num("tests"), pass: num("pass"), fail: num("fail"), cancelled: num("cancelled"), failures };
}

function tail(text: string, lines = 12): string {
  return text.trim().split(/\r?\n/).slice(-lines).join("\n");
}

/** Qué opción de aislamiento entiende el motor (Node 22.13+: --permission; antes, --experimental-permission). */
async function permissionFlag(tools: FactoryTools, motor: string): Promise<string | null> {
  for (const flag of ["--permission", "--experimental-permission"]) {
    const r = await tools.run(motor, [flag, "-e", "0"], { timeoutMs: 30_000 });
    if (r.code === 0) return flag;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ trabajos

export function factoryJob(id: string): FactoryJob | null {
  return jobs.get(id) ?? null;
}

export function currentFactoryJob(): FactoryJob | null {
  return active ? (jobs.get(active) ?? null) : null;
}

/** Empieza a fabricar (en segundo plano). Solo uno a la vez: compilar e instalar usan mucho disco y procesador. */
export function startFactoryJob(root: string, request: FactoryRequest, tools: FactoryTools): { ok: true; job: string } | { ok: false; error: string } {
  if (active) {
    const running = jobs.get(active);
    if (running && !running.done) return { ok: false, error: "Ya se está fabricando un instalador. Espera a que termine." };
  }
  const now = tools.now ?? (() => new Date());
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job: FactoryJob = { id, projectId: request.projectId, startedAt: now().toISOString(), step: "Comprobar el formato", log: [], done: false, report: null, error: null };
  jobs.set(id, job);
  active = id;
  for (const [key, old] of jobs) if (old.done && key !== id && jobs.size > 20) jobs.delete(key);
  void runFactory(root, request, tools, job)
    .then((report) => {
      job.report = report;
    })
    .catch((error) => {
      job.error = message(error);
      job.log.push(`Error inesperado: ${message(error)}`);
    })
    .finally(() => {
      job.done = true;
      if (active === id) active = null;
    });
  return { ok: true, job: id };
}

/** Último informe guardado de un proyecto. */
export async function lastFactoryReport(root: string, projectId: string): Promise<FactoryReport | null> {
  const { fs, path } = await node();
  try {
    return JSON.parse(await fs.readFile(path.join(root, "fabrica", safeProjectDir(projectId), "informe.json"), "utf8")) as FactoryReport;
  } catch {
    return null;
  }
}

/** Ruta del instalador fabricado para un proyecto (o null). */
export async function builtInstaller(root: string, projectId: string): Promise<{ file: string; name: string } | null> {
  const { fs, path } = await node();
  const dir = path.join(root, "fabrica", safeProjectDir(projectId), "salida");
  try {
    const name = (await fs.readdir(dir)).find((n) => n.toLowerCase().endsWith(".exe"));
    return name ? { file: path.join(dir, name), name } : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ fabricar

export async function runFactory(root: string, request: FactoryRequest, tools: FactoryTools, job: FactoryJob): Promise<FactoryReport> {
  const { fs, fsSync, path, crypto, zlib } = await node();
  const now = tools.now ?? (() => new Date());
  const t0 = Date.now();
  const log = (text: string) => {
    job.log.push(`[${now().toISOString().slice(11, 19)}] ${text}`);
  };
  const step = (name: FactoryStep) => {
    job.step = name;
    log(name);
  };
  const checks = new Map<FactoryCheckId, FactoryCheck>();
  const set = (id: FactoryCheckId, estado: FactoryCheckStatus, detalle: string) => checks.set(id, { id, estado, detalle });
  for (const id of Object.keys(FACTORY_CHECK_LABELS) as FactoryCheckId[]) set(id, "pendiente", "No se ha llegado a este paso.");

  const base = path.join(root, "fabrica", safeProjectDir(request.projectId));
  const paquete = path.join(base, "paquete");
  const compilacion = path.join(base, "compilacion");
  const salida = path.join(base, "salida");
  const prueba = path.join(base, "prueba");
  let plan: PackagePlan | null = null;
  let huella = "";
  let instalador: FactoryReport["instalador"] = null;
  const avisos: string[] = [];

  const finish = async (): Promise<FactoryReport> => {
    step("Informe");
    await rmrf(paquete).catch(() => undefined);
    await rmrf(compilacion).catch(() => undefined);
    const report: FactoryReport = {
      version: 1,
      projectId: request.projectId,
      programa: plan?.programa ?? { id: "", nombre: request.name, version: "1.0.0", descripcion: "", entrada: "app/index.html", ventana: null },
      huella,
      creado: now().toISOString(),
      duracionMs: Date.now() - t0,
      plataforma: tools.platform,
      nsis: NSIS_VERSION,
      instalador,
      comprobaciones: [...checks.values()],
      avisos,
      registro: job.log.slice(-200),
    };
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, "informe.json"), JSON.stringify(report, null, 2), "utf8");
    return report;
  };

  // 1) Formato
  step("Comprobar el formato");
  plan = planDesktopPackage(request.files, { name: request.name, ...(request.description ? { description: request.description } : {}) });
  avisos.push(...plan.avisos);
  huella = crypto.createHash("sha256").update(packageFingerprintText(plan)).digest("hex");
  if (!plan.ok) {
    set("formato", "fallida", plan.errores.slice(0, 6).join(" "));
    return finish();
  }
  set("formato", "superada", `${plan.archivos.length} archivo(s) del programa${plan.tieneLogica ? ", con lógica en servidor/api.mjs" : ""}; ${plan.pruebas.length} archivo(s) de pruebas de aceptación.`);
  if (!tools.makensis) {
    set("paquete", "fallida", "Falta el compilador de instaladores (tools/nsis). Vuelve a aplicar la actualización de WILLY que lo incluye.");
    return finish();
  }
  if (!tools.motor) {
    set("paquete", "fallida", "Falta el motor de Node de WILLY (tools/node.exe), que es el que se incluye en cada programa.");
    return finish();
  }

  const programa = plan.programa;
  const nombreArchivo = fileSafeName(programa.nombre);
  const motor = motorExeName(programa.id);
  const editor = (request.editor ?? "").trim().slice(0, 80) || programa.nombre;

  const clavePrueba = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${plan.programa.id}-prueba`;
  const claveCarpetaPrueba = `HKCU\\Software\\${plan.programa.id}-prueba`;
  // Instalador y desinstalador de NSIS con su línea de órdenes exacta: /D= y _?= van al final y sin comillas (aunque la
  // carpeta tenga espacios), así que no se pueden pasar como argumentos normales; el programa sí va entre comillas.
  const nsisExe = (exe: string, params: string[]) => tools.run(exe, params, { timeoutMs: 180_000, verbatim: true, argv0: `"${exe}"` });
  const limpiarRegistro = async () => {
    if (!tools.windows) return;
    for (const clave of [clavePrueba, claveCarpetaPrueba]) await tools.run("reg", ["delete", clave, "/f"], { timeoutMs: 20_000 }).catch(() => undefined);
  };
  try {
    // 2) Montaje
    step("Montar el programa");
    await rmrf(paquete);
    await rmrf(compilacion);
    await rmrf(salida);
    await fs.mkdir(paquete, { recursive: true });
    await fs.mkdir(compilacion, { recursive: true });
    await fs.mkdir(salida, { recursive: true });
    const within = (dir: string, rel: string) => {
      const target = path.resolve(dir, ...rel.split("/"));
      if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error(`Ruta fuera del paquete: ${rel}`);
      return target;
    };
    for (const f of plan.archivos) {
      const target = within(paquete, f.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, f.content, "utf8");
    }
    await fs.writeFile(path.join(paquete, "programa.json"), `${JSON.stringify(programa, null, 2)}\n`, "utf8");
    await fs.mkdir(path.join(paquete, "runtime"), { recursive: true });
    await fs.writeFile(path.join(paquete, "runtime", "servidor.mjs"), runtimeSource, "utf8");
    await fs.mkdir(path.join(paquete, "motor"), { recursive: true });
    await fs.copyFile(tools.motor, path.join(paquete, "motor", motor));
    const deflate = (data: Uint8Array) => new Uint8Array(zlib.deflateSync(data));
    if (!plan.archivos.some((f) => f.path === "app/icono-programa.png")) await fs.writeFile(path.join(paquete, "app", "icono-programa.png"), iconPng(programa.id, programa.nombre, 256, deflate));
    const icono = path.join(compilacion, "icono.ico");
    await fs.writeFile(icono, iconIco(programa.id, programa.nombre));
    const top = await fs.readdir(paquete, { withFileTypes: true });
    log(`Programa montado: ${plan.archivos.length} archivo(s), motor de escritorio y motor ${motor}.`);

    // 3) Lanzador
    step("Compilar el lanzador");
    const anio = now().getFullYear();
    const lanzador = path.join(compilacion, "lanzador.exe");
    await fs.writeFile(path.join(compilacion, "lanzador.nsi"), `﻿${launcherScript({ programa, editor, icono, anio, salida: lanzador })}`, "utf8");
    const compLanzador = await tools.run(tools.makensis, ["-V2", "-INPUTCHARSET", "UTF8", path.join(compilacion, "lanzador.nsi")], { cwd: compilacion, env: tools.nsisEnv, timeoutMs: 120_000 });
    if (compLanzador.code !== 0 || !(await exists(lanzador))) {
      set("paquete", "fallida", `No compila el lanzador:\n${tail(compLanzador.out)}`);
      return finish();
    }

    // 4) Instalador
    step("Compilar el instalador");
    const nombreInstalador = `${nombreArchivo}-Instalador-${programa.version}.exe`;
    const setup = path.join(salida, nombreInstalador);
    // NSIS escribe primero con un nombre sin acentos (así funciona igual en cualquier idioma del sistema) y después se le da
    // su nombre real.
    const setupTemporal = path.join(compilacion, "instalador.exe");
    const guion = installerScript({
      programa, nombreArchivo, editor, paquete, lanzador, icono, salida: setupTemporal, anio,
      carpetas: top.filter((e) => e.isDirectory()).map((e) => e.name),
      archivos: top.filter((e) => e.isFile()).map((e) => e.name),
    });
    await fs.writeFile(path.join(compilacion, "instalador.nsi"), `﻿${guion}`, "utf8");
    const compInstalador = await tools.run(tools.makensis, ["-V2", "-INPUTCHARSET", "UTF8", path.join(compilacion, "instalador.nsi")], { cwd: compilacion, env: tools.nsisEnv, timeoutMs: 600_000 });
    if (compInstalador.code !== 0 || !(await exists(setupTemporal))) {
      set("paquete", "fallida", `No compila el instalador${compInstalador.timedOut ? " (tiempo agotado)" : ""}:\n${tail(compInstalador.out)}`);
      return finish();
    }
    await fs.copyFile(setupTemporal, setup);
    const setupBytes = await fs.readFile(setup);
    instalador = { archivo: nombreInstalador, bytes: setupBytes.length, sha256: crypto.createHash("sha256").update(setupBytes).digest("hex") };
    const mb = (setupBytes.length / 1024 / 1024).toFixed(1);
    set("paquete", "superada", `Programa montado con su motor y su icono; lanzador e instalador compilados con NSIS ${NSIS_VERSION}.`);
    set("instalador", "superada", `${nombreInstalador} (${mb} MB), por usuario y sin permisos de administrador. Sin firma digital: si se descarga de internet, Windows (SmartScreen) avisará hasta firmarlo con un certificado de firma de código.`);
    log(`Instalador: ${nombreInstalador} (${mb} MB).`);

    if (!tools.windows && !tools.install) {
      const why = `Solo se puede comprobar en Windows (este equipo es ${tools.platform}).`;
      for (const id of ["instalacion-limpia", "primer-arranque", "desinstalacion"] as const) set(id, "pendiente", why);
      set("funcionalidad", "pendiente", plan.pruebas.length ? why : "El programa no tiene pruebas de aceptación (pruebas/*.test.mjs).");
      return finish();
    }

    // 5) Instalación limpia (modo prueba)
    step("Instalar en una carpeta vacía");
    await rmrf(prueba);
    const instalado = path.join(prueba, "instalado");
    const datos = path.join(prueba, "datos");
    await fs.mkdir(datos, { recursive: true });
    let instaladoOk = false;
    let ini: Record<string, string> = {};
    try {
      if (instalado.includes('"')) throw new Error(`La carpeta de WILLY (${root}) tiene comillas: el instalador no puede usarla.`);
      const inst = tools.install ? await tools.install(setup, instalado) : await nsisExe(setup, ["/S", "/PRUEBA", `/D=${instalado}`]);
      const esperados = [
        "programa.json", "Desinstalar.exe", `${nombreArchivo}.exe`, "instalacion.ini",
        path.join("runtime", "servidor.mjs"), path.join("motor", motor), ...plan.archivos.map((f) => path.join(...f.path.split("/"))),
      ];
      const faltan: string[] = [];
      for (const rel of esperados) if (!(await exists(path.join(instalado, rel)))) faltan.push(rel.replace(/\\/g, "/"));
      const distintos: string[] = [];
      for (const f of plan.archivos) {
        const target = path.join(instalado, ...f.path.split("/"));
        if (!faltan.includes(f.path) && (await fs.readFile(target, "utf8").catch(() => null)) !== f.content) distintos.push(f.path);
      }
      const motorOk = !faltan.includes(`motor/${motor}`) && fsSync.statSync(path.join(instalado, "motor", motor)).size === fsSync.statSync(tools.motor).size;
      const problemas: string[] = [];
      if (inst.code !== 0) problemas.push(`el instalador terminó con el código ${inst.code}${inst.timedOut ? " (tiempo agotado)" : ""}`);
      if (faltan.length) problemas.push(`faltan ${faltan.length} archivo(s): ${faltan.slice(0, 5).join(", ")}`);
      if (distintos.length) problemas.push(`${distintos.length} archivo(s) instalados no coinciden con el programa: ${distintos.slice(0, 5).join(", ")}`);
      if (!motorOk && !faltan.includes(`motor/${motor}`)) problemas.push("el motor instalado no coincide con el original");
      if (await exists(path.join(instalado, "instalacion.ini"))) ini = parseIni(await fs.readFile(path.join(instalado, "instalacion.ini")));
      if (ini["modo"] !== "1") problemas.push("no se instaló en modo prueba");
      for (const k of ["acceso_menu", "acceso_escritorio"]) {
        if (!ini[k] || !(await exists(ini[k]!))) problemas.push(`no se creó el acceso directo (${k === "acceso_menu" ? "menú Inicio" : "escritorio"})`);
      }
      const reg = tools.registryHas ? await tools.registryHas(clavePrueba) : null;
      if (reg === false) problemas.push("no aparece en «Aplicaciones instaladas» (registro)");
      instaladoOk = problemas.length === 0;
      set("instalacion-limpia", instaladoOk ? "superada" : "fallida", instaladoOk
        ? `Instalado en silencio en una carpeta vacía: ${esperados.length} archivo(s) en su sitio e idénticos al programa, accesos directos creados${reg === true ? " y registrado en «Aplicaciones instaladas»" : ""}.`
        : `${problemas.join("; ")}.${inst.out.trim() ? `\n${tail(inst.out, 6)}` : ""}`);
    } catch (error) {
      set("instalacion-limpia", "fallida", message(error));
    }

    // 6) Primer arranque
    const motorInstalado = tools.motorPara ? tools.motorPara(instalado, motor) : path.join(instalado, "motor", motor);
    if (instaladoOk) {
      step("Primer arranque");
      const r = await tools.run(motorInstalado, [path.join(instalado, "runtime", "servidor.mjs"), "--autoprueba", `--datos=${path.join(datos, "autoprueba")}`], { cwd: instalado, env: { APP_SIN_VENTANA: "1" }, timeoutMs: 120_000 });
      let resultado: { ok?: boolean; comprobaciones?: Array<{ nombre: string; ok: boolean; detalle: string }> } = {};
      try {
        const linea = r.out.trim().split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{")) ?? "{}";
        resultado = JSON.parse(linea) as typeof resultado;
      } catch {
        /* sin resultado legible */
      }
      const lista = resultado.comprobaciones ?? [];
      if (r.code === 0 && resultado.ok) {
        set("primer-arranque", "superada", `El programa instalado arranca y su pantalla carga: ${lista.map((c) => c.nombre).join(", ")}.`);
      } else {
        const malas = lista.filter((c) => !c.ok).map((c) => `${c.nombre}: ${c.detalle}`);
        set("primer-arranque", "fallida", malas.length ? malas.slice(0, 4).join(" · ") : `No arranca${r.timedOut ? " (tiempo agotado)" : ""}:\n${tail(r.out, 8)}`);
      }
    } else {
      set("primer-arranque", "pendiente", "No se puede arrancar: la instalación no salió bien.");
    }

    // 7) Pruebas de aceptación, aisladas
    if (!plan.pruebas.length) {
      set("funcionalidad", "pendiente", "El programa no tiene pruebas de aceptación (pruebas/*.test.mjs): WILLY no puede comprobar que hace lo que debe.");
    } else if (!instaladoOk) {
      set("funcionalidad", "pendiente", "No se pueden ejecutar: la instalación no salió bien.");
    } else {
      step("Pruebas de aceptación");
      const flag = await permissionFlag(tools, motorInstalado);
      if (!flag) {
        set("funcionalidad", "pendiente", "El motor no permite aislar las pruebas, así que no se ejecutan (nunca se ejecuta código sin aislar).");
      } else {
        const datosPruebas = path.join(datos, "pruebas");
        await fs.mkdir(datosPruebas, { recursive: true });
        const r = await tools.run(motorInstalado, [
          "--test", "--experimental-test-isolation=none", "--test-reporter=tap", flag,
          `--allow-fs-read=${instalado}`, `--allow-fs-read=${datosPruebas}`, `--allow-fs-write=${datosPruebas}`,
          // Rutas relativas a la carpeta instalada: el buscador de pruebas no necesita leer fuera de ella (aislamiento).
          ...plan.pruebas,
        ], { cwd: instalado, env: { APP_DATOS: datosPruebas, APP_SIN_VENTANA: "1" }, timeoutMs: 240_000 });
        const tap = parseTap(r.out);
        if (r.code === 0 && tap.pass > 0 && tap.fail === 0 && tap.cancelled === 0) {
          set("funcionalidad", "superada", `${tap.pass} de ${tap.tests} prueba(s) de aceptación superadas en el programa instalado (aisladas: solo leen el programa y escriben en su carpeta de pruebas).`);
        } else {
          const detalle = tap.failures.length ? `Fallan: ${tap.failures.join(" · ")}` : tail(r.out, 10);
          set("funcionalidad", "fallida", `${tap.pass} superada(s), ${tap.fail} fallida(s)${tap.cancelled ? `, ${tap.cancelled} cancelada(s)` : ""}${r.timedOut ? " (tiempo agotado)" : ""}. ${detalle}`);
        }
      }
    }

    // 8) Desinstalación
    if (await exists(path.join(instalado, "Desinstalar.exe"))) {
      step("Desinstalar");
      try {
        const des = tools.uninstall ? await tools.uninstall(instalado) : await nsisExe(path.join(instalado, "Desinstalar.exe"), ["/S", `_?=${instalado}`]);
        const quedan: string[] = [];
        for (const e of await fs.readdir(instalado).catch(() => [] as string[])) if (e.toLowerCase() !== "desinstalar.exe") quedan.push(e);
        for (const k of ["acceso_menu", "acceso_escritorio"]) if (ini[k] && (await exists(ini[k]!))) quedan.push(k === "acceso_menu" ? "acceso del menú Inicio" : "acceso del escritorio");
        const reg = tools.registryHas ? await tools.registryHas(clavePrueba) : null;
        if (reg === true) quedan.push("entrada en «Aplicaciones instaladas»");
        if (tools.registryHas && (await tools.registryHas(claveCarpetaPrueba, "Carpeta")) === true) quedan.push("su clave en el registro");
        const ok = des.code === 0 && quedan.length === 0;
        set("desinstalacion", ok ? "superada" : "fallida", ok
          ? `Desinstalado en silencio: no queda ningún archivo del programa${reg === false ? ", ni accesos directos, ni su entrada en «Aplicaciones instaladas»" : " ni accesos directos"}.`
          : `${des.code !== 0 ? `El desinstalador terminó con el código ${des.code}. ` : ""}${quedan.length ? `Queda: ${quedan.slice(0, 6).join(", ")}.` : ""}`);
        if (!ok) await limpiarRegistro();
      } catch (error) {
        set("desinstalacion", "fallida", message(error));
      }
    } else {
      set("desinstalacion", "pendiente", "No hay desinstalador que probar: la instalación no salió bien.");
    }
  } catch (error) {
    // Un fallo inesperado nunca deja el trabajo a medias sin explicar: se anota en el paso donde ocurrió y se limpia la prueba.
    const paso = [...checks.values()].find((c) => c.estado === "pendiente" && c.detalle === "No se ha llegado a este paso.");
    set(paso?.id ?? "paquete", "fallida", `Error inesperado en «${job.step}»: ${message(error)}`);
    log(`Error inesperado en «${job.step}»: ${message(error)}`);
    const desinstalar = path.join(prueba, "instalado", "Desinstalar.exe");
    if (tools.windows && (await exists(desinstalar))) await nsisExe(desinstalar, ["/S", `_?=${path.join(prueba, "instalado")}`]).catch(() => undefined);
    await limpiarRegistro();
  }
  await rmrf(prueba).catch((error) => log(`No se pudo borrar la carpeta de prueba (${message(error)}).`));
  return finish();
}
