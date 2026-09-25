// Acceso con contraseña a WILLY AI cuando se usa desde fuera del propio ordenador: el móvil en casa (Wi-Fi) o el
// servidor en Internet (VPS). En el propio ordenador (localhost, sin un proxy delante) no cambia nada: WILLY se abre
// como siempre, sin contraseña, y los programas que lo comprueban (supervisor, autoconstrucción) siguen funcionando.
//
// Cómo funciona:
// - La contraseña no se guarda: se guarda su huella (scrypt con sal) en datos-privados/acceso.json, junto con un
//   secreto aleatorio con el que se firman las sesiones. Las actualizaciones nunca tocan esa carpeta.
// - Al entrar bien, el navegador recibe una cookie HttpOnly (willy_acceso) firmada y con caducidad; sin ella, las
//   páginas van a /acceso y las rutas /api responden 401.
// - Solo se exige cuando el dueño lo activa (Ajustes → General → Acceso desde fuera) o cuando el servidor arranca con
//   la variable WILLY_ACCESO_PASS (así lo deja el instalador del VPS la primera vez).
// - Los intentos fallidos se limitan (8 seguidos → 10 minutos de espera) para frenar la fuerza bruta.

import { privateDataDir } from "@/lib/project-root";

export type AccesoConfig = {
  activo: boolean;
  hash: string;
  sal: string;
  secreto: string;
  creadoEl: string;
  actualizadoEl: string;
};

export type AccesoEstado = { activo: boolean; configurado: boolean; sesion: boolean; local: boolean };

const ARCHIVO = "acceso.json";
export const COOKIE = "willy_acceso";
const DIAS_SESION = 30;
const MIN_CONTRASENA = 8;
const MAX_FALLOS = 8;
const BLOQUEO_MS = 10 * 60 * 1000;
const CACHE_MS = 3000;

/** Rutas que se sirven sin contraseña: la propia pantalla de acceso y los archivos que necesita para pintarse. */
const RUTAS_LIBRES = new Set(["/acceso", "/api/acceso", "/favicon.png", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest", "/movil.webmanifest", "/sw.js", "/robots.txt"]);
const PREFIJOS_LIBRES = ["/assets/", "/fonts/"];

let cache: { at: number; cfg: AccesoConfig | null } | null = null;
const fallos = new Map<string, { n: number; hasta: number }>();

async function mods() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const crypto = await import("node:crypto");
  return { fs, path, crypto };
}

export async function rutaConfig(): Promise<string> {
  const { path } = await mods();
  return path.join(await privateDataDir(), ARCHIVO);
}

function esConfig(value: unknown): value is AccesoConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v["activo"] === "boolean" && typeof v["hash"] === "string" && typeof v["sal"] === "string" && typeof v["secreto"] === "string";
}

/** Lee la configuración (con una caché corta para no tocar el disco en cada petición). */
export async function leerConfig(fresca = false): Promise<AccesoConfig | null> {
  if (!fresca && cache && Date.now() - cache.at < CACHE_MS) return cache.cfg;
  const { fs } = await mods();
  let cfg: AccesoConfig | null = null;
  try {
    const parsed = JSON.parse(await fs.readFile(await rutaConfig(), "utf8")) as unknown;
    cfg = esConfig(parsed) ? parsed : null;
  } catch {
    cfg = null;
  }
  if (!cfg) cfg = await arranqueDesdeEntorno();
  cache = { at: Date.now(), cfg };
  return cfg;
}

async function guardarConfig(cfg: AccesoConfig): Promise<void> {
  const { fs, path } = await mods();
  const file = await rutaConfig();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(cfg, null, 2), "utf8");
  cache = null;
}

/** Primera vez en un servidor: si no hay configuración y el proceso arranca con WILLY_ACCESO_PASS, se crea activada. */
async function arranqueDesdeEntorno(): Promise<AccesoConfig | null> {
  const pass = (process.env["WILLY_ACCESO_PASS"] ?? "").trim();
  if (pass.length < MIN_CONTRASENA) return null;
  try {
    return await establecerContrasena(pass, true);
  } catch {
    return null;
  }
}

async function huella(password: string, sal: string): Promise<string> {
  const { crypto } = await mods();
  return crypto.scryptSync(password, sal, 64).toString("hex");
}

/** Guarda una contraseña nueva (mínimo 8 caracteres) y deja el acceso activado o no. Conserva el secreto de las sesiones. */
export async function establecerContrasena(password: string, activo: boolean): Promise<AccesoConfig> {
  if (password.length < MIN_CONTRASENA) throw new Error(`La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres.`);
  const { crypto } = await mods();
  const previa = await leerConfig(true);
  const sal = crypto.randomBytes(16).toString("hex");
  const ahora = new Date().toISOString();
  const cfg: AccesoConfig = {
    activo,
    hash: await huella(password, sal),
    sal,
    secreto: previa?.secreto || crypto.randomBytes(32).toString("hex"),
    creadoEl: previa?.creadoEl || ahora,
    actualizadoEl: ahora,
  };
  await guardarConfig(cfg);
  return cfg;
}

/** Activa o desactiva la exigencia de contraseña (hace falta tener una guardada). */
export async function activar(activo: boolean): Promise<AccesoConfig> {
  const previa = await leerConfig(true);
  if (!previa) throw new Error("Primero guarda una contraseña.");
  const cfg: AccesoConfig = { ...previa, activo, actualizadoEl: new Date().toISOString() };
  await guardarConfig(cfg);
  return cfg;
}

export async function comprobarContrasena(password: string): Promise<boolean> {
  const cfg = await leerConfig(true);
  if (!cfg || !password) return false;
  const { crypto } = await mods();
  const a = Buffer.from(await huella(password, cfg.sal), "hex");
  const b = Buffer.from(cfg.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ───────────────────────────────────────────────────────────── Sesión (cookie firmada)

async function firma(secreto: string, texto: string): Promise<string> {
  const { crypto } = await mods();
  return crypto.createHmac("sha256", secreto).update(texto).digest("hex");
}

export async function crearToken(): Promise<string> {
  const cfg = await leerConfig(true);
  if (!cfg) throw new Error("El acceso con contraseña no está configurado.");
  const { crypto } = await mods();
  const caduca = Date.now() + DIAS_SESION * 24 * 60 * 60 * 1000;
  const nonce = crypto.randomBytes(12).toString("hex");
  const cuerpo = `${caduca}.${nonce}`;
  return `${cuerpo}.${await firma(cfg.secreto, cuerpo)}`;
}

export async function tokenValido(token: string | null): Promise<boolean> {
  if (!token) return false;
  const partes = token.split(".");
  if (partes.length !== 3) return false;
  const [caduca, nonce, sello] = partes;
  if (!caduca || !nonce || !sello) return false;
  if (!/^\d+$/.test(caduca) || Number(caduca) < Date.now()) return false;
  const cfg = await leerConfig();
  if (!cfg) return false;
  const { crypto } = await mods();
  const esperado = Buffer.from(await firma(cfg.secreto, `${caduca}.${nonce}`), "hex");
  const recibido = Buffer.from(/^[0-9a-f]+$/i.test(sello) ? sello : "00", "hex");
  return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
}

export function leerCookie(request: Request): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const parte of raw.split(";")) {
    const [nombre, ...resto] = parte.trim().split("=");
    if (nombre === COOKIE) return decodeURIComponent(resto.join("="));
  }
  return null;
}

/** ¿La petición ha llegado por HTTPS (directamente o a través del proxy del servidor)? */
export function esHttps(request: Request): boolean {
  const proto = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function cookieDeSesion(token: string, secure: boolean): string {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESION * 24 * 60 * 60}${secure ? "; Secure" : ""}`;
}

export function cookieBorrada(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

// ───────────────────────────────────────────────────────────── ¿Hay que pedir contraseña?

/**
 * ¿Viene del propio ordenador? Es decir, se ha abierto como localhost y no pasa por un proxy (Caddy, nginx) que añada
 * X-Forwarded-For. En el VPS todo llega por el proxy, así que nunca cuenta como local; en el PC, el móvil llega por la
 * dirección de la Wi-Fi (192.168.x.x), así que tampoco.
 */
export function desdeEsteOrdenador(request: Request): boolean {
  if (request.headers.get("x-forwarded-for") || request.headers.get("x-forwarded-host")) return false;
  try {
    const host = new URL(request.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export function rutaLibre(pathname: string): boolean {
  if (RUTAS_LIBRES.has(pathname)) return true;
  return PREFIJOS_LIBRES.some((prefijo) => pathname.startsWith(prefijo));
}

export type Decision = "pasa" | "sin-sesion";

/** Decide si la petición puede pasar. Camino rápido: con el acceso desactivado no se lee ni la cookie. */
export async function decidir(request: Request): Promise<Decision> {
  const cfg = await leerConfig();
  if (!cfg || !cfg.activo) return "pasa";
  if (desdeEsteOrdenador(request)) return "pasa";
  let pathname = "/";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    pathname = "/";
  }
  if (rutaLibre(pathname)) return "pasa";
  return (await tokenValido(leerCookie(request))) ? "pasa" : "sin-sesion";
}

export async function estado(request: Request): Promise<AccesoEstado> {
  const cfg = await leerConfig();
  return {
    activo: !!cfg?.activo,
    configurado: !!cfg,
    sesion: cfg ? await tokenValido(leerCookie(request)) : false,
    local: desdeEsteOrdenador(request),
  };
}

// ───────────────────────────────────────────────────────────── Freno a la fuerza bruta

function claveDeOrigen(request: Request): string {
  const xff = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim();
  return xff || "local";
}

/** Milisegundos que quedan de bloqueo para quien hace la petición (0 si puede intentarlo). */
export function bloqueoRestante(request: Request): number {
  const registro = fallos.get(claveDeOrigen(request));
  if (!registro) return 0;
  if (registro.hasta && Date.now() < registro.hasta) return registro.hasta - Date.now();
  if (registro.hasta && Date.now() >= registro.hasta) fallos.delete(claveDeOrigen(request));
  return 0;
}

export function anotarFallo(request: Request): void {
  const clave = claveDeOrigen(request);
  const registro = fallos.get(clave) ?? { n: 0, hasta: 0 };
  registro.n += 1;
  if (registro.n >= MAX_FALLOS) {
    registro.hasta = Date.now() + BLOQUEO_MS;
    registro.n = 0;
  }
  fallos.set(clave, registro);
}

export function olvidarFallos(request: Request): void {
  fallos.delete(claveDeOrigen(request));
}
