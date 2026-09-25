// WILLY AI · RESPALDO DE ARRANQUE (parte del supervisor). Lo usan el «arranque seguro» (el index.mjs de cada programa
// instalado) y «Recuperar WILLY AI». Solo lo instala el actualizador oficial: la Autoconstrucción no puede modificarlo
// (sus cambios solo pueden tocar src/ y public/), así que sigue funcionando aunque una mejora rompa WILLY.
// Sin dependencias: solo módulos de Node.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const SB_DIR = "copias-autoconstruccion";
export const UPDATE_BACKUPS = "copias-actualizacion";
/** Mismo informe que deja el ayudante de reinicio: WILLY lo lee al abrirse y deja el código como corresponde. */
export const REPORT = "reinicio-fallido.json";
export const LOG_FILE = "arranque-seguro.log";

const RM = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 };

export function log(root, message) {
  try {
    fs.mkdirSync(path.join(root, SB_DIR), { recursive: true });
    fs.appendFileSync(path.join(root, SB_DIR, LOG_FILE), `[${new Date().toISOString()}] ${String(message).replace(/\s+/g, " ").slice(0, 1500)}\n`);
  } catch {
    /* el registro nunca impide arrancar */
  }
}

/** ¿Hay un programa completo en `dir`? (servidor envuelto por el arranque seguro o servidor de siempre) */
export function complete(dir) {
  return fs.existsSync(path.join(dir, "server", "willy.mjs")) || fs.existsSync(path.join(dir, "server", "index.mjs"));
}

/** El archivo que arranca de verdad el programa de `dir` (nunca otro arranque seguro: así no se encadenan). */
export function entryOf(dir) {
  const inner = path.join(dir, "server", "willy.mjs");
  return fs.existsSync(inner) ? inner : path.join(dir, "server", "index.mjs");
}

/** Huella de una carpeta: la misma que usa la Autoconstrucción para sus copias verificadas (self-build-backup.ts). */
export function treeDigest(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push({ rel: path.relative(dir, full).split(path.sep).join("/"), hash: crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex") });
    }
  };
  walk(dir);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const all = crypto.createHash("sha256");
  for (const f of files) all.update(`${f.rel}\0${f.hash}\n`);
  return all.digest("hex");
}

const same = (a, b) => {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function mtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Copias del programa que funcionaba antes, de la más reciente a la más antigua:
 *  1. el programa apartado por un intercambio que se quedó a medias (app/.output-anterior);
 *  2. las copias VERIFICADAS de la Autoconstrucción (cada una guarda el programa de antes de una mejora; las de «volver
 *     atrás» guardan justo la versión que se quitaba, así que no sirven);
 *  3. las copias del actualizador oficial (el programa de antes de cada actualización).
 * `exclude`: carpetas que no valen (la del programa que falla).
 */
export function fallbacks(root, { exclude = [], limit = 4 } = {}) {
  const found = [];
  const add = (dir, at, source, sha) => {
    if (!complete(dir) || exclude.some((x) => same(x, dir)) || found.some((f) => same(f.dir, dir))) return;
    found.push({ dir, at, source, ...(sha ? { sha } : {}) });
  };
  const aside = path.join(root, "app", ".output-anterior");
  add(aside, mtime(path.join(aside, "server")) || mtime(aside), "intercambio");
  const listDirs = (base) => {
    try {
      return fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(base, e.name));
    } catch {
      return [];
    }
  };
  for (const dir of listDirs(path.join(root, SB_DIR))) {
    const manifest = readJson(path.join(dir, "manifest.json"));
    if (!manifest || manifest.status !== "verificada" || !manifest.program || !manifest.program.sha256 || manifest.kind === "vuelta-atras") continue;
    const at = Date.parse(String(manifest.createdAt || "")) || mtime(dir);
    add(path.join(dir, "app", ".output"), at, "autoconstruccion", String(manifest.program.sha256));
  }
  for (const dir of listDirs(path.join(root, UPDATE_BACKUPS))) {
    add(path.join(dir, "app", ".output"), mtime(path.join(dir, "estado.json")) || mtime(dir), "actualizacion");
  }
  return found.sort((a, b) => b.at - a.at).slice(0, limit);
}

/**
 * Deja la copia `candidate` como programa instalado (app/.output). Primero se copia aparte (y se comprueba su huella si
 * se conoce), y solo entonces se aparta el programa que falla a app/.output-fallida: nunca se queda WILLY sin programa.
 */
export function install(root, candidate) {
  const live = path.join(root, "app", ".output");
  const failed = path.join(root, "app", ".output-fallida");
  const ready = path.join(root, "app", ".output-respaldo");
  fs.rmSync(ready, RM);
  fs.cpSync(candidate.dir, ready, { recursive: true });
  if (candidate.sha && treeDigest(ready) !== candidate.sha) {
    fs.rmSync(ready, RM);
    throw new Error("la copia no coincide con su huella");
  }
  fs.rmSync(failed, RM);
  if (fs.existsSync(live)) fs.renameSync(live, failed);
  try {
    fs.renameSync(ready, live);
  } catch (error) {
    if (!fs.existsSync(live) && fs.existsSync(failed)) fs.renameSync(failed, live);
    throw error;
  }
}

/** Informe para WILLY (se procesa al abrir Autoconstrucción): qué versión no arrancó y que se volvió a la copia buena. */
export function writeReport(root, { detail, restored, answering, fallback }) {
  const registry = readJson(path.join(root, SB_DIR, "versiones.json"));
  const op = registry && typeof registry.activeId === "string" ? registry.activeId : null;
  const report = {
    op, kind: "mejora", target: null, at: new Date().toISOString(), detail: String(detail).slice(0, 600), restored: Boolean(restored), answering: Boolean(answering),
    source: "arranque-seguro", ...(fallback ? { fallback: path.relative(root, fallback).split(path.sep).join("/") } : {}),
  };
  try {
    fs.mkdirSync(path.join(root, SB_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, SB_DIR, REPORT), JSON.stringify(report, null, 2));
  } catch {
    /* sin informe: WILLY arranca igual */
  }
  return report;
}

/**
 * Envuelve un programa recién compilado con el arranque seguro: el servidor de siempre pasa a llamarse willy.mjs y el
 * index.mjs (el que abre el lanzador) es el arranque seguro. Sin el archivo del supervisor no se toca nada.
 */
export function wrapProgram(outputDir, supervisorFile) {
  const server = path.join(outputDir, "server");
  const entry = path.join(server, "index.mjs");
  const inner = path.join(server, "willy.mjs");
  if (!fs.existsSync(supervisorFile)) return false;
  if (!fs.existsSync(inner)) {
    if (!fs.existsSync(entry)) throw new Error("el programa compilado no tiene server/index.mjs");
    fs.renameSync(entry, inner);
  }
  fs.copyFileSync(supervisorFile, entry);
  return true;
}
