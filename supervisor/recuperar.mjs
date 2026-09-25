// WILLY AI · RECUPERAR (supervisor). Se abre con «Recuperar WILLY AI» (menú Inicio) o RECUPERAR_WILLY.bat cuando WILLY no
// abre. No depende de la interfaz de WILLY: mira si responde, enseña la versión y el último error, y si hace falta cierra lo
// que se haya quedado colgado, vuelve a poner la última copia buena del programa y lo arranca comprobando que responde.
// Todo automático: el dueño solo tiene que abrirlo y esperar. Los mensajes van sin tildes para que la consola de Windows
// los muestre bien. Uso: node recuperar.mjs [carpeta de WILLY AI]

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";
import { SB_DIR, complete, fallbacks, install, log as appLog, treeDigest, writeReport } from "./respaldo.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(here, ".."));
const TEST = process.env.WILLY_TEST === "1";
const PORT = Number(process.env.WILLY_PORT || 3000);
const WAIT_S = Number(process.env.WILLY_WAIT_SECONDS || 90);
const LOG = path.join(root, SB_DIR, "recuperacion-log.txt");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ascii = (text) => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");

function say(message) {
  const line = ascii(message);
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* el registro es opcional */
  }
}

function request(urlPath, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: urlPath, timeout: timeoutMs }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { if (text.length < 200_000) text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode || 0, text }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, text: "" }); });
    req.on("error", () => resolve({ status: 0, text: "" }));
  });
}

async function healthy() {
  const api = await request("/api/local-ai", 4000);
  if (api.status !== 200) return false;
  const page = await request("/app", 20_000);
  return page.status > 0 && page.status < 500;
}

async function waitHealthy(seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (await healthy()) return true;
    await sleep(2000);
  }
  return false;
}

/** Cierra los procesos de ESTA instalación de WILLY (servidor colgado, lanzador…), igual que el actualizador. */
function stopApp() {
  if (TEST) {
    try { const pid = Number(fs.readFileSync(process.env.WILLY_TEST_PIDFILE, "utf8")); if (pid) process.kill(pid); } catch { /* ya parado */ }
    return;
  }
  const esc = root.replace(/'/g, "''");
  const script = `$root='${esc}'; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.ProcessId -ne ${process.ppid} -and $_.Name -notmatch '^(powershell|pwsh|cmd|conhost)' -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0)) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { cp.execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "ignore", timeout: 30_000 }); } catch { /* nada que cerrar */ }
}

/** Arranca WILLY como siempre (su lanzador). Sin respaldo automático: aquí un fallo tiene que verse para arreglarlo. */
function startApp() {
  const env = { ...process.env, WILLY_SIN_RESPALDO: "1" };
  if (TEST) {
    const child = cp.spawn(process.execPath, [path.join(root, "app", ".output", "server", "index.mjs")], { cwd: root, detached: true, stdio: "ignore", env: { ...env, PORT: String(PORT) } });
    fs.writeFileSync(process.env.WILLY_TEST_PIDFILE, String(child.pid));
    child.unref();
    return;
  }
  const child = cp.spawn(path.join(root, "willy-ai.exe"), [], { cwd: root, detached: true, stdio: "ignore", env });
  child.on("error", () => say("No pude abrir willy-ai.exe: abrelo tu desde su acceso directo."));
  child.unref();
}

/** Arranca el servidor unos segundos mirando su salida, para decir POR QUE no arranca. */
function probeStartup() {
  return new Promise((resolve) => {
    let out = "";
    let finished = false;
    const env = { ...process.env, WILLY_SIN_RESPALDO: "1", PORT: String(PORT + 7), APP_PORT: String(PORT + 7), NITRO_PORT: String(PORT + 7), HOST: "127.0.0.1", NODE_ENV: "production" };
    const child = cp.spawn(process.execPath, [path.join(root, "app", ".output", "server", "index.mjs")], { cwd: root, env, windowsHide: true });
    const finish = () => { if (finished) return; finished = true; try { child.kill(); } catch { /* ya cerrado */ } resolve(out.trim().slice(-1200)); };
    const timer = setTimeout(finish, Number(process.env.WILLY_PROBE_SECONDS || 12) * 1000);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("error", (e) => { out += e.message; clearTimeout(timer); finish(); });
    child.on("close", () => { clearTimeout(timer); finish(); });
  });
}

function openBrowser() {
  const url = `http://localhost:${PORT}/app`;
  if (TEST) { say(`(prueba) abriria el navegador en ${url}`); return; }
  try {
    const child = cp.spawn("explorer.exe", [url], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* se dice la dirección igualmente */
  }
  say(`WILLY AI: ${url}`);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function showState() {
  let version = "desconocida";
  try {
    const src = fs.readFileSync(path.join(root, "src", "lib", "version.ts"), "utf8");
    const v = (/APP_VERSION\s*=\s*"([^"]+)"/.exec(src) || [])[1];
    const r = (/APP_REVISION\s*=\s*(\d+)/.exec(src) || [])[1];
    if (v) version = r ? `${v} rev ${r}` : v;
  } catch { /* sin version */ }
  say(`Version del codigo instalado: ${version}`);
  const reg = readJson(path.join(root, SB_DIR, "versiones.json"));
  if (reg && Array.isArray(reg.entries)) {
    const byId = (id) => reg.entries.find((e) => e && e.id === id);
    const active = byId(reg.activeId);
    const good = byId(reg.lastKnownGood);
    if (active) say(`Version activa: ${active.label} (salud: ${active.health})`);
    if (good) say(`Ultima version buena: ${good.label}`);
  }
  const marker = readJson(path.join(root, SB_DIR, "operacion-en-curso.json"));
  if (marker) say(`Hay una mejora de la Autoconstruccion a medias ("${marker.objective}", paso ${marker.step}): WILLY la resolvera solo al abrirse.`);
  const last = readJson(path.join(root, SB_DIR, "reinicio-fallido.json"));
  if (last && last.detail) say(`Ultimo aviso de arranque: ${last.detail}`);
  try {
    const lines = fs.readFileSync(path.join(root, SB_DIR, "arranque-seguro.log"), "utf8").trim().split("\n").slice(-3);
    for (const line of lines) if (line) say(`  ${line}`);
  } catch { /* sin registro */ }
}

async function main() {
  say("==================== RECUPERAR WILLY AI ====================");
  say(`Carpeta: ${root}`);
  if (!fs.existsSync(path.join(root, "app")) || !fs.existsSync(path.join(root, "src"))) {
    say("Esta carpeta no parece una instalacion de WILLY AI. No he cambiado nada.");
    return 1;
  }
  say("Comprobando si WILLY AI responde...");
  if (await healthy()) {
    say("WILLY AI ESTA FUNCIONANDO. No hace falta recuperar nada.");
    openBrowser();
    return 0;
  }
  showState();
  say("WILLY AI no responde. Cierro lo que se haya quedado colgado...");
  stopApp();
  await sleep(TEST ? 500 : 2500);

  const live = path.join(root, "app", ".output");
  let replaced = null;
  const putBack = (why) => {
    const liveDigest = complete(live) ? (() => { try { return treeDigest(live); } catch { return null; } })() : null;
    for (const candidate of fallbacks(root, { exclude: [live] })) {
      try {
        if (liveDigest && treeDigest(candidate.dir) === liveDigest) continue; // es el mismo programa que falla
        install(root, candidate);
        say(`${why}: he puesto la copia buena de ${candidate.source === "actualizacion" ? "antes de la ultima actualizacion" : candidate.source === "intercambio" ? "la instalacion anterior" : "antes de la ultima mejora"} (${path.relative(root, candidate.dir)}).`);
        appLog(root, `Recuperar WILLY AI: puesta la copia ${candidate.dir} (${why}).`);
        return candidate;
      } catch (error) {
        say(`La copia ${path.relative(root, candidate.dir)} no sirve (${error && error.message ? error.message : error}). Pruebo la siguiente...`);
      }
    }
    return null;
  };

  if (!complete(live)) {
    say("Falta el programa de WILLY AI (app\\.output).");
    replaced = putBack("Programa que faltaba");
    if (!replaced) { say("No encuentro ninguna copia buena del programa. No he podido recuperarlo solo."); return 1; }
  }

  say(`Arrancando WILLY AI y comprobando que responde (hasta ${WAIT_S} s)...`);
  startApp();
  if (await waitHealthy(WAIT_S)) return finish(replaced, "");

  say("WILLY AI no arranca. Miro por que...");
  stopApp();
  await sleep(TEST ? 500 : 2500);
  const why = await probeStartup();
  if (why) say(`Salida del programa al arrancar:\n${why.split("\n").slice(-8).join("\n")}`);
  const second = putBack("El programa instalado no arrancaba");
  if (!second) { say("No hay otra copia buena con la que probar. No he podido recuperarlo solo."); return 1; }
  replaced = second;
  startApp();
  if (await waitHealthy(WAIT_S)) return finish(replaced, why);
  say("Tampoco arranca con la copia buena. No he podido recuperarlo solo.");
  return 1;
}

function finish(replaced, why) {
  if (replaced) {
    const first = (why || "").split("\n").filter(Boolean).pop() || "no respondia";
    writeReport(root, { detail: `WILLY no arrancaba (${first.slice(0, 200)}) y «Recuperar WILLY AI» volvio a poner la copia buena anterior.`, restored: true, answering: true, fallback: replaced.dir });
  }
  say(replaced ? "LISTO: WILLY AI funciona otra vez con la ultima version buena. Al abrir Autoconstruccion veras el aviso." : "LISTO: WILLY AI funciona otra vez.");
  openBrowser();
  return 0;
}

main().then((code) => process.exit(code), (error) => {
  say(`Error inesperado: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
