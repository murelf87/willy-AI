// Motor de escritorio del programa: sirve su pantalla y su lógica SOLO en este equipo (127.0.0.1), guarda los datos del
// usuario en su carpeta de datos (nunca junto al programa) y se cierra solo cuando se cierra su ventana.
//
// Uso:
//   motor servidor.mjs --abrir            arranca (o reutiliza el que ya está abierto) y abre la ventana del programa
//   motor servidor.mjs --autoprueba       comprueba que el programa instalado arranca y carga, y termina (código 0 = bien)
//   opciones: --datos=<carpeta>  --puerto=<número>
//
// Estructura del programa instalado (la monta la fábrica de instaladores):
//   programa.json            { id, nombre, version, descripcion, entrada, ventana? }
//   app/…                    pantalla (HTML, CSS, JS; módulos ES permitidos)
//   servidor/api.mjs         (opcional) rutas "MÉTODO /api/…" → función async
//   pruebas/*.test.mjs       (opcional) pruebas de aceptación con node:test
//   runtime/servidor.mjs     este archivo

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Carpeta del programa instalado (la que contiene programa.json). */
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".avif": "image/avif", ".ico": "image/x-icon", ".bmp": "image/bmp", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".otf": "font/otf", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm", ".pdf": "application/pdf",
  ".wasm": "application/wasm", ".webmanifest": "application/manifest+json",
};

const LIMITE_CUERPO = 10 * 1024 * 1024;
const RUTAS_INTERNAS = "/__app/";
const SCRIPT_VIDA = "/__app/vida.js";
const ID_VALIDO = /^[a-z0-9][a-z0-9-]{1,40}$/;
const VERSION_VALIDA = /^\d+\.\d+\.\d+$/;

// ------------------------------------------------------------------------------------------------ programa y datos

/** Lee y valida programa.json. */
export function leerPrograma(raiz = RAIZ) {
  let bruto;
  try {
    bruto = JSON.parse(fs.readFileSync(path.join(raiz, "programa.json"), "utf8"));
  } catch (error) {
    throw new Error(`No se puede leer programa.json (${error instanceof Error ? error.message : String(error)})`);
  }
  const id = String(bruto.id ?? "");
  const nombre = String(bruto.nombre ?? "").trim();
  const version = String(bruto.version ?? "");
  const entrada = String(bruto.entrada ?? "app/index.html").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!ID_VALIDO.test(id)) throw new Error(`programa.json: id no válido («${id}»)`);
  if (!nombre) throw new Error("programa.json: falta el nombre");
  if (!VERSION_VALIDA.test(version)) throw new Error(`programa.json: versión no válida («${version}»), usa 1.0.0`);
  if (!entrada.startsWith("app/") || entrada.includes("..")) throw new Error(`programa.json: la entrada debe estar dentro de app/ («${entrada}»)`);
  const ventana = bruto.ventana && typeof bruto.ventana === "object" ? bruto.ventana : {};
  const ancho = Number(ventana.ancho);
  const alto = Number(ventana.alto);
  return {
    id, nombre, version, entrada,
    descripcion: String(bruto.descripcion ?? ""),
    ventana: Number.isInteger(ancho) && Number.isInteger(alto) && ancho >= 320 && alto >= 240 && ancho <= 4000 && alto <= 3000 ? { ancho, alto } : null,
  };
}

/** Carpeta de datos del usuario: --datos, APP_DATOS o la carpeta de datos local del usuario + id del programa. */
export function carpetaDatos(programa, elegida) {
  if (elegida) return path.resolve(elegida);
  if (process.env.APP_DATOS) return path.resolve(process.env.APP_DATOS);
  const base = process.platform === "win32"
    ? (process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"))
    : (process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"));
  return path.join(base, programa.id);
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** En Windows un antivirus puede tener el archivo abierto un instante: se reintenta antes de dar error. */
async function conReintentos(fn) {
  for (let intento = 0; ; intento += 1) {
    try {
      return await fn();
    } catch (error) {
      const codigo = error && typeof error === "object" ? error.code : "";
      if (intento >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(codigo)) throw error;
      await esperar(60 * (intento + 1));
    }
  }
}

/**
 * Almacén de datos del programa: cada dato es un JSON en <carpeta>/datos/<nombre>.json. Las escrituras son atómicas
 * (archivo temporal + cambio de nombre) y en orden por dato, así que un cierre a mitad nunca deja un archivo a medias.
 */
export function crearDatos(carpeta) {
  const dir = path.join(carpeta, "datos");
  const colas = new Map();
  const archivo = (clave) => {
    if (typeof clave !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(clave)) throw new Error(`Nombre de dato no válido: «${String(clave)}» (letras, números, - y _)`);
    return path.join(dir, `${clave}.json`);
  };
  const enOrden = (clave, fn) => {
    const anterior = colas.get(clave) ?? Promise.resolve();
    const siguiente = anterior.then(fn, fn);
    colas.set(clave, siguiente.catch(() => undefined));
    return siguiente;
  };
  return {
    carpeta: dir,
    async leer(clave, porDefecto = null) {
      const f = archivo(clave);
      let texto;
      try {
        texto = await conReintentos(() => fsp.readFile(f, "utf8"));
      } catch (error) {
        if (error && error.code === "ENOENT") return porDefecto;
        throw error;
      }
      try {
        return JSON.parse(texto);
      } catch {
        throw new Error(`El dato «${clave}» está dañado (${f}); no se ha tocado para no perder nada.`);
      }
    },
    guardar(clave, valor) {
      let f;
      try {
        f = archivo(clave);
      } catch (error) {
        return Promise.reject(error);
      }
      return enOrden(clave, async () => {
        const texto = JSON.stringify(valor, null, 2);
        if (texto === undefined) throw new Error(`No se puede guardar «${clave}»: el valor no es JSON`);
        await fsp.mkdir(dir, { recursive: true });
        const temporal = `${f}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
        await fsp.writeFile(temporal, texto, "utf8");
        await conReintentos(() => fsp.rename(temporal, f));
        return valor;
      });
    },
    borrar(clave) {
      let f;
      try {
        f = archivo(clave);
      } catch (error) {
        return Promise.reject(error);
      }
      return enOrden(clave, () => conReintentos(() => fsp.rm(f, { force: true })));
    },
    async lista() {
      try {
        return (await fsp.readdir(dir)).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).sort();
      } catch {
        return [];
      }
    },
  };
}

/** Registro de funcionamiento en la carpeta de datos (se renueva al pasar de 1 MB). */
function crearRegistro(carpeta) {
  const archivoRegistro = path.join(carpeta, "registro.txt");
  return (mensaje) => {
    try {
      fs.mkdirSync(carpeta, { recursive: true });
      try {
        if (fs.statSync(archivoRegistro).size > 1024 * 1024) fs.renameSync(archivoRegistro, path.join(carpeta, "registro-anterior.txt"));
      } catch {
        /* todavía no hay registro */
      }
      fs.appendFileSync(archivoRegistro, `[${new Date().toISOString()}] ${String(mensaje)}\n`, "utf8");
    } catch {
      /* el registro nunca debe impedir que el programa funcione */
    }
  };
}

// ------------------------------------------------------------------------------------------------ lógica (servidor/api.mjs)

function compilarRutas(rutas) {
  if (!rutas || typeof rutas !== "object") throw new Error("servidor/api.mjs debe exportar por defecto un objeto { \"GET /api/…\": async (ctx) => … }");
  return Object.entries(rutas).map(([clave, fn]) => {
    const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/\S*)$/.exec(String(clave).trim());
    if (!m || typeof fn !== "function") throw new Error(`Ruta no válida en servidor/api.mjs: «${clave}» (usa "GET /api/…" con una función)`);
    const nombres = [];
    const partes = m[2].replace(/\/+$/, "").split("/").map((seg) => {
      if (seg.startsWith(":")) {
        nombres.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    return { metodo: m[1], patron: m[2], re: new RegExp(`^${partes.join("/")}/?$`), nombres, fn };
  });
}

/** Carga servidor/api.mjs (si existe) y devuelve sus rutas. */
export async function cargarLogica(raiz = RAIZ) {
  const f = path.join(raiz, "servidor", "api.mjs");
  if (!fs.existsSync(f)) return null;
  const modulo = await import(pathToFileURL(f).href);
  return compilarRutas(modulo.default ?? modulo.rutas);
}

// ------------------------------------------------------------------------------------------------ servidor

function enviar(res, estado, cuerpo, cabeceras = {}) {
  const esTexto = typeof cuerpo === "string" || Buffer.isBuffer(cuerpo);
  const datos = cuerpo === undefined ? "" : esTexto ? cuerpo : JSON.stringify(cuerpo);
  res.writeHead(estado, {
    "Content-Type": esTexto ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    ...cabeceras,
  });
  res.end(datos);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    req.on("data", (trozo) => {
      total += trozo.length;
      if (total > LIMITE_CUERPO) {
        reject(Object.assign(new Error("La petición es demasiado grande (más de 10 MB)."), { estado: 413 }));
        req.destroy();
        return;
      }
      trozos.push(trozo);
    });
    req.on("end", () => resolve(Buffer.concat(trozos)));
    req.on("error", reject);
  });
}

/** Referencias locales de una página (scripts, estilos, imágenes…), para comprobar que existen. */
export function recursosLocales(html) {
  const out = new Set();
  for (const m of String(html).matchAll(/\b(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)) {
    const ref = m[1].trim().split("?")[0];
    if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue;
    out.add(ref.startsWith("/") ? ref : `/${ref.replace(/^\.\//, "")}`);
  }
  return [...out].filter((ref) => !ref.startsWith(RUTAS_INTERNAS));
}

/** Prepara una página antes de servirla: el aviso de «ventana abierta» y, si la página no trae icono, el del programa. */
function prepararHtml(html, conIcono) {
  const etiqueta = `<script src="${SCRIPT_VIDA}" defer></script>`;
  let out = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${etiqueta}</body>`) : `${html}\n${etiqueta}`;
  if (conIcono && !/<link\b[^>]*\brel\s*=\s*["'][^"']*\bicon\b/i.test(out)) {
    const icono = '<link rel="icon" href="/icono-programa.png">';
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${icono}</head>`) : `${icono}\n${out}`;
  }
  return out;
}

const CODIGO_VIDA = "(()=>{let fuente=null;const abrir=()=>{try{fuente=new EventSource('/__app/vida');fuente.onerror=()=>{fuente.close();setTimeout(abrir,3000);};}catch{}};abrir();})();\n";

/**
 * Arranca el servidor del programa. Devuelve { url, puerto, api, cerrar() } o, si ya había una ventana de este mismo programa
 * abierta, { yaAbierto: true, url }.
 * opciones: { raiz, puerto (0 = cualquiera libre), datos, abrir, ciclo (cerrarse solo al cerrar la ventana), esperaInicialMs, graciaMs }
 */
export async function iniciar(opciones = {}) {
  const raiz = opciones.raiz ?? RAIZ;
  const programa = leerPrograma(raiz);
  const carpeta = carpetaDatos(programa, opciones.datos);
  fs.mkdirSync(carpeta, { recursive: true });
  const registro = crearRegistro(carpeta);
  const datos = crearDatos(carpeta);
  const api = await cargarLogica(raiz);
  const appDir = path.join(raiz, "app");
  const entrada = path.join(raiz, programa.entrada);
  const conIcono = fs.existsSync(path.join(appDir, "icono-programa.png"));
  const vidas = new Set();
  const avisos = new Set();
  let puertoActual = 0;

  /** Puerto en el que escucha de verdad (se lee del propio servidor: nunca queda una petición con un puerto sin fijar). */
  const puertoReal = () => {
    const dir = servidor.address();
    return dir && typeof dir === "object" ? dir.port : puertoActual;
  };
  const origenesValidos = () => new Set([`http://127.0.0.1:${puertoReal()}`, `http://localhost:${puertoReal()}`]);

  async function atenderApi(req, res, url) {
    if (!api) return enviar(res, 404, { error: "Este programa no tiene lógica en el servidor." });
    const origen = req.headers.origin;
    if (req.method !== "GET" && req.method !== "HEAD" && origen && !origenesValidos().has(origen)) {
      return enviar(res, 403, { error: "Petición bloqueada: no procede de este programa." });
    }
    const ruta = url.pathname;
    const encontrada = api.find((r) => r.metodo === req.method && r.re.test(ruta));
    if (!encontrada) return enviar(res, 404, { error: `No existe ${req.method} ${ruta}` });
    const valores = encontrada.re.exec(ruta).slice(1);
    const params = Object.fromEntries(encontrada.nombres.map((n, i) => [n, decodeURIComponent(valores[i] ?? "")]));
    let cuerpo = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const bruto = await leerCuerpo(req);
      const tipo = String(req.headers["content-type"] ?? "");
      if (bruto.length && tipo.includes("application/json")) {
        try {
          cuerpo = JSON.parse(bruto.toString("utf8"));
        } catch {
          return enviar(res, 400, { error: "El cuerpo de la petición no es un JSON válido." });
        }
      } else if (bruto.length) {
        cuerpo = bruto.toString("utf8");
      }
    }
    const ctx = {
      metodo: req.method, ruta, params, consulta: Object.fromEntries(url.searchParams), cuerpo, cabeceras: req.headers,
      datos, carpetaDatos: carpeta, registro, programa,
    };
    const resultado = await encontrada.fn(ctx);
    if (resultado === undefined || resultado === null) return enviar(res, 204, undefined);
    if (typeof resultado === "object" && !Array.isArray(resultado) && ("estado" in resultado || "json" in resultado || "texto" in resultado)) {
      const estado = Number.isInteger(resultado.estado) ? resultado.estado : 200;
      const cabeceras = resultado.cabeceras && typeof resultado.cabeceras === "object" ? resultado.cabeceras : {};
      if ("texto" in resultado) return enviar(res, estado, String(resultado.texto), cabeceras);
      return enviar(res, estado, resultado.json, cabeceras);
    }
    return enviar(res, 200, resultado);
  }

  async function servirArchivo(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") return enviar(res, 405, "Método no permitido.");
    let relativa;
    try {
      relativa = decodeURIComponent(url.pathname);
    } catch {
      return enviar(res, 400, "Dirección no válida.");
    }
    let destino = relativa === "/" ? entrada : path.resolve(appDir, `.${relativa}`);
    if (destino !== appDir && !destino.startsWith(appDir + path.sep)) return enviar(res, 403, "Acceso no permitido.");
    let info = await fsp.stat(destino).catch(() => null);
    if (info && info.isDirectory()) {
      destino = path.join(destino, "index.html");
      info = await fsp.stat(destino).catch(() => null);
    }
    if (!info && !path.extname(relativa) && String(req.headers.accept ?? "").includes("text/html")) {
      destino = entrada; // navegación interna de una aplicación de una sola página
      info = await fsp.stat(destino).catch(() => null);
    }
    if (!info || !info.isFile()) return enviar(res, 404, `No existe ${relativa}`);
    const tipo = MIME[path.extname(destino).toLowerCase()] ?? "application/octet-stream";
    const base = { "Content-Type": tipo, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-cache" };
    if (tipo.startsWith("text/html")) {
      const html = prepararHtml(await fsp.readFile(destino, "utf8"), conIcono);
      res.writeHead(200, { ...base, "Content-Length": Buffer.byteLength(html) });
      return res.end(req.method === "HEAD" ? undefined : html);
    }
    const rango = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (rango && (rango[1] || rango[2])) {
      const inicio = rango[1] ? Number(rango[1]) : Math.max(0, info.size - Number(rango[2]));
      const final = rango[1] && rango[2] ? Math.min(Number(rango[2]), info.size - 1) : info.size - 1;
      if (inicio > final || inicio >= info.size) {
        res.writeHead(416, { ...base, "Content-Range": `bytes */${info.size}` });
        return res.end();
      }
      res.writeHead(206, { ...base, "Accept-Ranges": "bytes", "Content-Range": `bytes ${inicio}-${final}/${info.size}`, "Content-Length": final - inicio + 1 });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(destino, { start: inicio, end: final }).pipe(res);
    }
    res.writeHead(200, { ...base, "Accept-Ranges": "bytes", "Content-Length": info.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(destino).on("error", () => res.destroy()).pipe(res);
  }

  function atenderInterno(req, res, url) {
    if (url.pathname === "/__app/ping") return enviar(res, 200, { app: programa.id, version: programa.version, pid: process.pid });
    if (url.pathname === SCRIPT_VIDA) {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return res.end(CODIGO_VIDA);
    }
    if (url.pathname === "/__app/vida") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(": abierto\n\n");
      const latido = setInterval(() => res.write(": sigue\n\n"), 25_000);
      vidas.add(res);
      for (const aviso of avisos) aviso(vidas.size);
      req.on("close", () => {
        clearInterval(latido);
        vidas.delete(res);
        for (const aviso of avisos) aviso(vidas.size);
      });
      return undefined;
    }
    return enviar(res, 404, "No existe.");
  }

  const servidor = http.createServer((req, res) => {
    const host = String(req.headers.host ?? "");
    const puerto = puertoReal();
    if (host !== `127.0.0.1:${puerto}` && host !== `localhost:${puerto}`) {
      return enviar(res, 403, "Acceso no permitido.");
    }
    let url;
    try {
      url = new URL(req.url ?? "/", `http://${host}`);
    } catch {
      return enviar(res, 400, "Dirección no válida.");
    }
    const tarea = url.pathname.startsWith(RUTAS_INTERNAS)
      ? Promise.resolve(atenderInterno(req, res, url))
      : url.pathname === "/api" || url.pathname.startsWith("/api/")
        ? atenderApi(req, res, url)
        : servirArchivo(req, res, url);
    tarea.catch((error) => {
      const estado = error && Number.isInteger(error.estado) && error.estado >= 400 && error.estado < 500 ? error.estado : 500;
      if (estado === 500) registro(`Error en ${req.method} ${url.pathname}: ${error && error.stack ? error.stack : String(error)}`);
      if (!res.headersSent) enviar(res, estado, { error: error instanceof Error ? error.message : String(error) });
      else res.destroy();
    });
  });
  servidor.keepAliveTimeout = 5_000;

  const escuchar = (puerto) => new Promise((resolve, reject) => {
    const alFallar = (error) => {
      servidor.off("listening", alEscuchar);
      reject(error);
    };
    const alEscuchar = () => {
      servidor.off("error", alFallar);
      resolve(servidor.address().port);
    };
    servidor.once("error", alFallar);
    servidor.once("listening", alEscuchar);
    servidor.listen(puerto, "127.0.0.1");
  });

  const archivoPuerto = path.join(carpeta, "puerto.txt");
  let preferido = opciones.puerto;
  if (preferido === undefined) {
    const guardado = Number(fs.existsSync(archivoPuerto) ? fs.readFileSync(archivoPuerto, "utf8").trim() : NaN);
    preferido = Number.isInteger(guardado) && guardado > 1024 && guardado < 65536 ? guardado : puertoPropio(programa.id);
  }
  if (preferido === 0) {
    puertoActual = await escuchar(0);
  } else {
    for (let intento = 0; intento < 20 && !puertoActual; intento += 1) {
      const puerto = preferido + intento;
      try {
        puertoActual = await escuchar(puerto);
      } catch (error) {
        if (!error || error.code !== "EADDRINUSE") throw error;
        const otro = await preguntarPing(puerto);
        if (otro && otro.app === programa.id) {
          const url = `http://127.0.0.1:${puerto}/`;
          if (opciones.abrir) abrirVentana(url, programa.ventana);
          return { yaAbierto: true, url, puerto };
        }
      }
    }
    if (!puertoActual) throw new Error(`No hay ningún puerto libre entre ${preferido} y ${preferido + 19}.`);
    try {
      fs.writeFileSync(archivoPuerto, String(puertoActual), "utf8");
    } catch {
      /* se volverá a elegir la próxima vez */
    }
  }

  const url = `http://127.0.0.1:${puertoActual}/`;
  registro(`Arrancado ${programa.nombre} ${programa.version} en ${url} (proceso ${process.pid})`);
  const cerrar = () => new Promise((resolve) => {
    for (const r of vidas) r.end();
    vidas.clear();
    servidor.close(() => resolve());
    servidor.closeAllConnections?.();
  });

  if (opciones.ciclo) {
    const esperaInicial = opciones.esperaInicialMs ?? 120_000;
    const gracia = opciones.graciaMs ?? 15_000;
    let temporizador = setTimeout(() => terminar("nadie abrió la ventana del programa"), esperaInicial);
    const terminar = (motivo) => {
      registro(`Se cierra: ${motivo}.`);
      void cerrar().then(() => (opciones.alTerminar ? opciones.alTerminar(motivo) : process.exit(0)));
    };
    avisos.add((abiertas) => {
      if (temporizador) clearTimeout(temporizador);
      temporizador = abiertas > 0 ? null : setTimeout(() => terminar("se cerró la ventana del programa"), gracia);
    });
  }
  if (opciones.abrir) abrirVentana(url, programa.ventana);
  return { url, puerto: puertoActual, api, datos, carpetaDatos: carpeta, programa, cerrar, ventanasAbiertas: () => vidas.size };
}

/** Puerto fijo propio de cada programa (así sus datos del navegador no cambian de un día a otro). */
export function puertoPropio(id) {
  const n = crypto.createHash("sha256").update(id).digest().readUInt32BE(0);
  return 41000 + (n % 8000);
}

function preguntarPing(puerto) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: puerto, path: "/__app/ping", timeout: 1500, headers: { Host: `127.0.0.1:${puerto}` } }, (res) => {
      let texto = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { texto += d; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(texto));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

/** Microsoft Edge (viene con Windows 10 y 11): abre el programa en su propia ventana, sin barra de direcciones. */
function rutaEdge() {
  const bases = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  return bases.map((b) => path.join(b, "Microsoft", "Edge", "Application", "msedge.exe")).find((f) => fs.existsSync(f)) ?? null;
}

export function abrirVentana(url, ventana = null) {
  if (process.env.APP_SIN_VENTANA === "1") return;
  const soltar = (hijo) => {
    hijo.on("error", () => undefined);
    hijo.unref();
  };
  if (process.platform === "win32") {
    const edge = rutaEdge();
    if (edge) {
      const extra = ventana ? [`--window-size=${ventana.ancho},${ventana.alto}`] : [];
      soltar(spawn(edge, [`--app=${url}`, ...extra], { detached: true, stdio: "ignore" }));
      return;
    }
    soltar(spawn("cmd.exe", ["/d", "/s", "/c", `"start "" "${url}""`], { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true }));
    return;
  }
  soltar(spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }));
}

// ------------------------------------------------------------------------------------------------ autoprueba

/** ¿El script usa import/export (módulo ES)? */
function esModulo(codigo) {
  return /^\s*(?:import\s*(?:[\w{*"'(]|\.meta)|export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*))/m.test(codigo);
}

/**
 * Comprueba que un script de la pantalla se puede leer (sin ejecutarlo). Los scripts clásicos se analizan aquí mismo; los
 * módulos, con el analizador de módulos del motor sobre una copia temporal .mjs (así se analizan siempre como módulo).
 */
async function comprobarSintaxis(archivo) {
  const codigo = await fsp.readFile(archivo, "utf8");
  if (!archivo.endsWith(".mjs") && !esModulo(codigo)) {
    try {
      new vm.Script(codigo, { filename: archivo });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  const temporal = path.join(os.tmpdir(), `sintaxis-${process.pid}-${crypto.randomBytes(4).toString("hex")}.mjs`);
  await fsp.writeFile(temporal, codigo, "utf8");
  try {
    return await new Promise((resolve) => {
      execFile(process.execPath, ["--check", temporal], { windowsHide: true, timeout: 20_000 }, (error, _salida, errores) => {
        if (!error) return resolve("");
        const lineas = String(errores || error.message).split("\n").map((l) => l.trim()).filter(Boolean);
        const donde = (lineas[0] ?? "").replace(temporal, path.basename(archivo));
        const que = lineas.find((l) => /Error:/.test(l)) ?? "";
        resolve(`${donde} ${que}`.trim());
      });
    });
  } finally {
    await fsp.rm(temporal, { force: true }).catch(() => undefined);
  }
}

function listarArchivos(dir, extensiones, maximo = 300) {
  const out = [];
  const recorrer = (actual) => {
    if (out.length >= maximo) return;
    let entradas = [];
    try {
      entradas = fs.readdirSync(actual, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const completo = path.join(actual, e.name);
      if (e.isDirectory()) recorrer(completo);
      else if (extensiones.includes(path.extname(e.name).toLowerCase())) out.push(completo);
    }
  };
  recorrer(dir);
  return out;
}

/** Comprueba de verdad el programa instalado: arranca, abre la pantalla, carga sus recursos, sus scripts se entienden y su lógica responde. */
export async function autoprueba(opciones = {}) {
  const raiz = opciones.raiz ?? RAIZ;
  const comprobaciones = [];
  const anotar = (nombre, ok, detalle) => comprobaciones.push({ nombre, ok: Boolean(ok), detalle: String(detalle ?? "") });
  const fin = () => ({ ok: comprobaciones.length > 0 && comprobaciones.every((c) => c.ok), comprobaciones });
  let programa;
  try {
    programa = leerPrograma(raiz);
    anotar("programa.json", true, `${programa.nombre} ${programa.version}`);
  } catch (error) {
    anotar("programa.json", false, error instanceof Error ? error.message : String(error));
    return fin();
  }
  anotar("pantalla principal", fs.existsSync(path.join(raiz, programa.entrada)), programa.entrada);
  const scripts = listarArchivos(path.join(raiz, "app"), [".js", ".mjs"]);
  const errores = [];
  for (const archivo of scripts) {
    const problema = await comprobarSintaxis(archivo);
    if (problema) errores.push(`${path.relative(raiz, archivo).replace(/\\/g, "/")}: ${problema}`);
  }
  anotar("sintaxis de los scripts", errores.length === 0, errores.length ? errores.slice(0, 3).join(" | ") : `${scripts.length} script(s) correctos`);
  const datos = opciones.datos ?? fs.mkdtempSync(path.join(os.tmpdir(), `${programa.id}-autoprueba-`));
  let srv;
  try {
    srv = await iniciar({ raiz, puerto: 0, datos });
  } catch (error) {
    anotar("arranque", false, error instanceof Error ? error.message : String(error));
    return fin();
  }
  anotar("arranque", true, `responde en ${srv.url}`);
  try {
    const pagina = await fetch(srv.url, { headers: { Accept: "text/html" } });
    const html = await pagina.text();
    anotar("abre la pantalla principal", pagina.ok && /<html|<!doctype/i.test(html), `código ${pagina.status}`);
    const faltan = [];
    const refs = recursosLocales(html);
    for (const ref of refs) {
      const r = await fetch(new URL(ref, srv.url));
      await r.arrayBuffer();
      if (!r.ok) faltan.push(`${ref} (${r.status})`);
    }
    anotar("recursos de la pantalla", faltan.length === 0, faltan.length ? `no cargan: ${faltan.slice(0, 5).join(", ")}` : `${refs.length} recurso(s) cargan`);
    if (srv.api) {
      anotar("lógica del programa (servidor/api.mjs)", true, `${srv.api.length} ruta(s)`);
      if (srv.api.some((r) => r.metodo === "GET" && r.patron === "/api/salud")) {
        const salud = await fetch(new URL("/api/salud", srv.url));
        await salud.arrayBuffer();
        anotar("GET /api/salud", salud.ok, `código ${salud.status}`);
      }
    }
  } catch (error) {
    anotar("abre la pantalla principal", false, error instanceof Error ? error.message : String(error));
  } finally {
    await srv.cerrar();
  }
  return fin();
}

// ------------------------------------------------------------------------------------------------ arranque desde la línea de órdenes

function argumentos(lista) {
  const out = { abrir: false, autoprueba: false, datos: undefined, puerto: undefined };
  for (const a of lista) {
    if (a === "--abrir") out.abrir = true;
    else if (a === "--autoprueba") out.autoprueba = true;
    else if (a.startsWith("--datos=")) out.datos = a.slice(8);
    else if (a.startsWith("--puerto=")) out.puerto = Number(a.slice(9));
  }
  return out;
}

async function principal() {
  const args = argumentos(process.argv.slice(2));
  if (args.autoprueba) {
    const resultado = await autoprueba({ datos: args.datos });
    process.stdout.write(`${JSON.stringify(resultado)}\n`);
    process.exit(resultado.ok ? 0 : 1);
  }
  const resultado = await iniciar({ datos: args.datos, puerto: Number.isInteger(args.puerto) ? args.puerto : undefined, abrir: args.abrir, ciclo: args.abrir });
  if (resultado.yaAbierto) process.exit(0);
}

const esPrincipal = (() => {
  try {
    const a = fs.realpathSync(process.argv[1] ?? "");
    const b = fs.realpathSync(fileURLToPath(import.meta.url));
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
})();

if (esPrincipal) {
  process.on("uncaughtException", (error) => {
    try {
      const programa = leerPrograma();
      crearRegistro(carpetaDatos(programa))(`Error inesperado: ${error && error.stack ? error.stack : String(error)}`);
    } catch {
      /* sin registro */
    }
    process.exit(1);
  });
  principal().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
