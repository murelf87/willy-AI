// INSTALAR LIBRERÍAS SIN NPM (rediseño, revisión 27). Solo servidor. En el equipo del dueño no hay npm: cuando un proyecto
// React necesita una librería que WILLY no trae, WILLY la instala él mismo, como haría npm pero sin ejecutar NADA de ella:
//  1. pregunta al registro oficial de npm qué versiones hay (y, si no contesta, a su espejo registry.yarnpkg.com);
//  2. elige la versión que pide el proyecto (las mismas reglas que npm: `semver-lite.ts`) y las librerías que ella necesita;
//  3. las coloca como npm (en `node_modules`, anidando cuando dos piden versiones distintas de la misma) sin duplicar lo que ya
//     trae WILLY (React nunca: dos React en una página no funcionan);
//  4. descarga cada una, comprueba su huella (sha512) y la descomprime a un lado; solo si TODO ha ido bien la pone en su sitio
//     (si algo falla, no queda nada a medias);
//  5. apunta qué instaló y para qué en `librerias.json`, para poder quitarla después sin romper las demás.
// Nunca se ejecutan sus programas de instalación (npm los ejecutaría): para la vista previa no hacen falta. El almacén está en
// `datos-privados/librerias-proyectos` (ninguna actualización lo toca) y la compilación de los proyectos lo usa.

import type { GeneratedFile } from "@/lib/ai-standard";
import {
  AUTO_INSTALL_MIN_DOWNLOADS, WILLY_SINGLETONS, declaredDependencies, downloadsLabel, specOf, validPackageName,
  type InstallItem, type InstallResult, type InstalledLibrary, type LibraryInfo, type LibraryList, type LibrarySpec, type RemoveResult,
} from "@/lib/project-libraries";
import { maxSatisfying, parseVersion, satisfies } from "@/lib/semver-lite";

export const DEFAULT_REGISTRIES = ["https://registry.npmjs.org", "https://registry.yarnpkg.com"];
export const DEFAULT_DOWNLOADS_API = "https://api.npmjs.org/downloads/point/last-week/";
/** Los datos «cortos» de cada paquete (los mismos que pide npm al instalar). */
const CORGI = "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";

type Limits = {
  maxPackages: number; maxTarballBytes: number; maxUnpackedBytes: number; maxTotalBytes: number;
  requestTimeoutMs: number; totalTimeoutMs: number; maxMetadataBytes: number; parallel: number;
};
const LIMITS: Limits = {
  maxPackages: 400, maxTarballBytes: 60_000_000, maxUnpackedBytes: 300_000_000, maxTotalBytes: 600_000_000,
  requestTimeoutMs: 45_000, totalTimeoutMs: 300_000, maxMetadataBytes: 80_000_000, parallel: 6,
};

export type StoreOptions = {
  registries?: string[];
  /** Descargas por semana (para saber si una librería es conocida); null = no se consulta. */
  downloadsApi?: string | null;
  fetch?: typeof fetch;
  /** Solo pruebas: un registro local por http (127.0.0.1). */
  allowHttp?: boolean;
  /** La carpeta node_modules de WILLY (lo que ya trae); null = ninguna. */
  rootModules?: string | null;
  platform?: string;
  arch?: string;
  limits?: Partial<Limits>;
};

type VersionMeta = {
  name?: string; version: string;
  dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  deprecated?: string | boolean; os?: string[]; cpu?: string[]; hasInstallScript?: boolean;
  dist?: { tarball?: string; integrity?: string; shasum?: string; unpackedSize?: number };
};
type Packument = { name: string; "dist-tags": Record<string, string>; versions: Record<string, VersionMeta> };

type ManifestPkg = { name: string; pkg?: string; version: string; integrity: string; bytes: number; for: string[]; deps: Record<string, string | null> };
type Manifest = { version: 1; requested: Record<string, { range: string; version: string; at: string }>; packages: Record<string, ManifestPkg>; updatedAt: string };

const MANIFEST = "librerias.json";
const NAME = "(?:@[a-z0-9][a-z0-9._~-]*\\/)?[a-z0-9][a-z0-9._~-]*";
const PKG_PATH = new RegExp(`^node_modules\\/${NAME}(?:\\/node_modules\\/${NAME})*$`);

// ----------------------------------------------------------------------------------------------------- utilidades

async function nodeMods() {
  const [fs, path, zlib, crypto] = await Promise.all([import("node:fs/promises"), import("node:path"), import("node:zlib"), import("node:crypto")]);
  return { fs, path, zlib, crypto };
}
const message = (e: unknown): string => {
  if (e instanceof Error) {
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    if (e.name === "TimeoutError" || e.name === "AbortError") return "el registro de npm tarda demasiado en contestar";
    if (cause === "ENOTFOUND" || cause === "EAI_AGAIN" || cause === "ECONNREFUSED" || cause === "ECONNRESET" || /fetch failed/i.test(e.message)) return "sin conexión con el registro de npm (¿hay internet?)";
    return e.message;
  }
  return String(e);
};
/** «node_modules/a/node_modules/@b/c» → «@b/c». */
const nameAt = (p: string): string => p.slice(p.lastIndexOf("node_modules/") + "node_modules/".length);
/** La carpeta del paquete del que cuelga («node_modules/a/node_modules/b» → «node_modules/a»; arriba del todo → «»). */
const parentOf = (p: string): string => { const i = p.lastIndexOf("/node_modules/"); return i < 0 ? "" : p.slice(0, i); };
const childPath = (parent: string, name: string): string => (parent ? `${parent}/node_modules/${name}` : `node_modules/${name}`);
const depth = (p: string): number => p.split("/node_modules/").length;
const isSingleton = (name: string): boolean => (WILLY_SINGLETONS as readonly string[]).includes(name);

/** El almacén de librerías al lado de la carpeta de proyectos («…/datos-privados/proyectos» → «…/datos-privados/librerias-proyectos»). */
export function libraryStoreOf(projectsBase: string): string {
  const clean = projectsBase.replace(/[\\/]+$/, "");
  const i = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  const sep = clean.includes("\\") && !clean.includes("/") ? "\\" : "/";
  return `${i >= 0 ? clean.slice(0, i) : "."}${sep}librerias-proyectos`;
}

// Una operación del almacén detrás de otra (instalar y quitar a la vez lo dejaría mal) y un contador de cambios.
let chain: Promise<unknown> = Promise.resolve();
let generation = 0;
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}
/** Espera a que termine lo que se esté instalando o quitando (la compilación lo espera). */
export function librariesIdle(): Promise<void> {
  return chain.then(() => undefined, () => undefined);
}
/** Cambia cada vez que se instala o se quita algo (para no enseñar compilaciones de antes). */
export const librariesGeneration = (): number => generation;

// ----------------------------------------------------------------------------------------------------- el apunte (librerias.json)

function emptyManifest(): Manifest {
  return { version: 1, requested: {}, packages: {}, updatedAt: new Date(0).toISOString() };
}
function cleanManifest(raw: unknown): Manifest {
  const m = emptyManifest();
  if (!raw || typeof raw !== "object") return m;
  const r = raw as Record<string, unknown>;
  const req = r["requested"] && typeof r["requested"] === "object" ? (r["requested"] as Record<string, unknown>) : {};
  for (const [name, v] of Object.entries(req)) {
    if (!validPackageName(name) || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o["version"] !== "string" || !parseVersion(o["version"])) continue;
    m.requested[name] = { range: typeof o["range"] === "string" ? o["range"].slice(0, 200) : "latest", version: o["version"], at: typeof o["at"] === "string" ? o["at"] : new Date(0).toISOString() };
  }
  const pk = r["packages"] && typeof r["packages"] === "object" ? (r["packages"] as Record<string, unknown>) : {};
  for (const [p, v] of Object.entries(pk)) {
    if (!PKG_PATH.test(p) || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o["version"] !== "string" || !parseVersion(o["version"]) || o["name"] !== nameAt(p)) continue;
    const deps: Record<string, string | null> = {};
    if (o["deps"] && typeof o["deps"] === "object") {
      for (const [dn, dv] of Object.entries(o["deps"] as Record<string, unknown>)) {
        if (!validPackageName(dn)) continue;
        if (dv === null) deps[dn] = null;
        else if (typeof dv === "string" && PKG_PATH.test(dv)) deps[dn] = dv;
      }
    }
    m.packages[p] = {
      name: nameAt(p),
      ...(typeof o["pkg"] === "string" && validPackageName(o["pkg"]) ? { pkg: o["pkg"] } : {}),
      version: o["version"],
      integrity: typeof o["integrity"] === "string" ? o["integrity"] : "",
      bytes: typeof o["bytes"] === "number" && Number.isFinite(o["bytes"]) ? o["bytes"] : 0,
      for: Array.isArray(o["for"]) ? (o["for"] as unknown[]).filter((x): x is string => validPackageName(x)) : [],
      deps,
    };
  }
  if (typeof r["updatedAt"] === "string") m.updatedAt = r["updatedAt"];
  return m;
}
async function readManifest(store: string): Promise<Manifest> {
  const { fs, path } = await nodeMods();
  try {
    return cleanManifest(JSON.parse(await fs.readFile(path.join(store, MANIFEST), "utf8")));
  } catch {
    return emptyManifest();
  }
}
async function writeManifest(store: string, m: Manifest): Promise<void> {
  const { fs, path } = await nodeMods();
  m.updatedAt = new Date().toISOString();
  const file = path.join(store, MANIFEST);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(m, null, 1), "utf8");
  await retry(() => fs.rename(tmp, file));
}
/** En Windows, un antivirus puede tener un archivo abierto un momento: se reintenta un poco. */
async function retry<T>(fn: () => Promise<T>, times = 5): Promise<T> {
  for (let i = 0; ; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (i >= times - 1 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES" || code === "ENOTEMPTY")) throw error;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

// ----------------------------------------------------------------------------------------------------- huella y descompresión

/** ¿El archivo descargado es exactamente el publicado? (la huella más fuerte que dé el registro: sha512, o la sha1 antigua). */
export function integrityOk(buf: Uint8Array, integrity: string, hash: (algo: string, data: Uint8Array, enc: "base64" | "hex") => string): boolean {
  if (integrity.startsWith("sha1-hex:")) return hash("sha1", buf, "hex") === integrity.slice(9).toLowerCase();
  const rank: Record<string, number> = { sha512: 4, sha384: 3, sha256: 2, sha1: 1 };
  const found = integrity.split(/\s+/).map((e) => /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)(?:\?\S*)?$/.exec(e)).filter((m): m is RegExpExecArray => m !== null);
  if (!found.length) return false;
  const best = Math.max(...found.map((m) => rank[m[1]!] ?? 0));
  const algo = Object.keys(rank).find((k) => rank[k] === best)!;
  const digest = hash(algo, buf, "base64");
  return found.some((m) => m[1] === algo && m[2] === digest);
}

const WIN_BAD = /[<>:"|?*\u0000-\u001f]/;
const WIN_RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;
/**
 * La ruta de un archivo del paquete, sin la carpeta de arriba («package/») y sin trampas: nada de «..», rutas absolutas ni
 * nombres que Windows no admite. null = se salta.
 */
export function cleanTarPath(raw: string): string | null {
  const parts = raw.replace(/\\/g, "/").split("/").filter((x) => x !== "" && x !== ".");
  parts.shift();
  if (!parts.length) return null;
  for (const seg of parts) if (seg === ".." || WIN_BAD.test(seg) || WIN_RESERVED.test(seg) || /[. ]$/.test(seg) || seg.length > 200) return null;
  return parts.join("/");
}

const cstr = (b: Uint8Array, start: number, len: number): string => {
  const s = Buffer.from(b.subarray(start, start + len)).toString("utf8");
  const z = s.indexOf("\u0000");
  return z >= 0 ? s.slice(0, z) : s;
};
function octal(f: Uint8Array): number {
  if (f[0]! & 0x80) {
    let n = 0;
    for (let i = 1; i < f.length; i += 1) n = n * 256 + f[i]!;
    return n;
  }
  const s = Buffer.from(f).toString("ascii").replace(/\u0000.*$/s, "").trim();
  return s ? Number.parseInt(s, 8) : 0;
}
function parsePax(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const text = Buffer.from(data).toString("utf8");
  let i = 0;
  while (i < text.length) {
    const sp = text.indexOf(" ", i);
    if (sp < 0) break;
    const len = Number.parseInt(text.slice(i, sp), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const rec = text.slice(sp + 1, i + len - 1);
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/**
 * Los archivos de un paquete de npm (.tgz): se descomprime en memoria (con un tope, por si es una «bomba») y se lee el formato
 * tar (con nombres largos de pax y de GNU). Los enlaces se saltan (y se cuentan).
 */
export function readTarball(tgz: Uint8Array, maxUnpacked: number, gunzip: (b: Uint8Array, max: number) => Uint8Array): { files: Array<{ path: string; data: Uint8Array }>; skipped: number; bytes: number } {
  let buf: Uint8Array;
  try {
    buf = gunzip(tgz, maxUnpacked);
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError) throw new Error(`demasiado grande al descomprimir (más de ${Math.round(maxUnpacked / 1_000_000)} MB)`);
    throw new Error("el archivo descargado no se puede descomprimir");
  }
  const files: Array<{ path: string; data: Uint8Array }> = [];
  let skipped = 0;
  let bytes = 0;
  let off = 0;
  let longName: string | null = null;
  let pax: Record<string, string> = {};
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const type = h[156] ? String.fromCharCode(h[156]) : "0";
    const own = octal(h.subarray(124, 136));
    const isMeta = type === "x" || type === "g" || type === "L" || type === "K";
    const size = isMeta ? own : pax["size"] !== undefined ? Number(pax["size"]) : own;
    if (!Number.isFinite(size) || size < 0) throw new Error("el archivo del paquete está dañado");
    const start = off + 512;
    const end = start + size;
    if (end > buf.length) throw new Error("el archivo del paquete está cortado");
    const data = buf.subarray(start, end);
    off = start + Math.ceil(size / 512) * 512;
    if (type === "x") { pax = parsePax(data); continue; }
    if (type === "g" || type === "K") continue;
    if (type === "L") { longName = Buffer.from(data).toString("utf8").replace(/\u0000.*$/s, ""); continue; }
    const magic = cstr(h, 257, 6);
    const prefix = magic.startsWith("ustar") ? cstr(h, 345, 155) : "";
    const base = cstr(h, 0, 100);
    const full = pax["path"] ?? longName ?? (prefix ? `${prefix}/${base}` : base);
    longName = null;
    pax = {};
    if (type === "0" || type === "7") {
      const clean = cleanTarPath(full);
      if (!clean) { skipped += 1; continue; }
      files.push({ path: clean, data });
      bytes += data.length;
    } else if (type !== "5") {
      skipped += 1; // enlaces, dispositivos…: nunca
    }
  }
  return { files, skipped, bytes };
}

// ----------------------------------------------------------------------------------------------------- el registro

type Ctx = {
  registries: string[]; downloadsApi: string | null; fetch: typeof fetch; allowHttp: boolean; rootModules: string | null;
  platform: string; arch: string; limits: Limits; hosts: Set<string>; deadline: number;
  meta: Map<string, Promise<Packument>>; rootVersions: Map<string, string | null>; warnings: string[];
};
class NotFound extends Error {}

function makeCtx(opts: StoreOptions): Ctx {
  const registries = (opts.registries?.length ? opts.registries : DEFAULT_REGISTRIES).map((r) => r.replace(/\/+$/, ""));
  const downloadsApi = opts.downloadsApi === undefined ? DEFAULT_DOWNLOADS_API : opts.downloadsApi;
  const limits = { ...LIMITS, ...(opts.limits ?? {}) };
  const hosts = new Set<string>();
  for (const r of registries) { try { hosts.add(new URL(r).host); } catch { /* se ignora */ } }
  if (downloadsApi) { try { hosts.add(new URL(downloadsApi).host); } catch { /* se ignora */ } }
  return {
    registries, downloadsApi, fetch: opts.fetch ?? fetch, allowHttp: Boolean(opts.allowHttp), rootModules: opts.rootModules ?? null,
    platform: opts.platform ?? process.platform, arch: opts.arch ?? process.arch, limits, hosts,
    deadline: Date.now() + limits.totalTimeoutMs, meta: new Map(), rootVersions: new Map(), warnings: [],
  };
}

/** Solo se descarga del registro de npm (o de su espejo) y por https. */
function allowed(url: string, ctx: Ctx): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("dirección de descarga no válida");
  }
  const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (!(u.protocol === "https:" || (ctx.allowHttp && local && u.protocol === "http:")) || !ctx.hosts.has(u.host)) {
    throw new Error(`se descarga de un sitio que no es el registro de npm (${u.host})`);
  }
  return u;
}

async function fetchBytes(url: string, ctx: Ctx, accept: string, max: number): Promise<{ status: number; body: Buffer }> {
  allowed(url, ctx);
  const left = ctx.deadline - Date.now();
  if (left <= 0) throw new Error("se ha acabado el tiempo para instalar (5 minutos)");
  const res = await ctx.fetch(url, { headers: { accept, "user-agent": "WILLY-AI (instalador propio, sin npm)" }, signal: AbortSignal.timeout(Math.min(ctx.limits.requestTimeoutMs, left)), redirect: "follow" });
  if (res.url) allowed(res.url, ctx);
  if (res.status !== 200) {
    try { await res.body?.cancel(); } catch { /* ya cerrada */ }
    return { status: res.status, body: Buffer.alloc(0) };
  }
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > max) throw new Error(`demasiado grande para descargar (${Math.round(declared / 1_000_000)} MB)`);
  const reader = res.body?.getReader();
  if (!reader) {
    const all = Buffer.from(await res.arrayBuffer());
    if (all.length > max) throw new Error("demasiado grande para descargar");
    return { status: 200, body: all };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* ya cerrada */ }
      throw new Error("demasiado grande para descargar");
    }
    chunks.push(Buffer.from(value));
  }
  return { status: 200, body: Buffer.concat(chunks) };
}

const encodeName = (name: string): string => (name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name));

function packument(name: string, ctx: Ctx): Promise<Packument> {
  let p = ctx.meta.get(name);
  if (!p) {
    p = loadPackument(name, ctx);
    p.catch(() => undefined);
    ctx.meta.set(name, p);
  }
  return p;
}
async function loadPackument(name: string, ctx: Ctx): Promise<Packument> {
  let last: unknown = null;
  for (const reg of ctx.registries) {
    try {
      const r = await fetchBytes(`${reg}/${encodeName(name)}`, ctx, CORGI, ctx.limits.maxMetadataBytes);
      if (r.status === 404) throw new NotFound(`«${name}» no existe en el registro de npm`);
      if (r.status !== 200) { last = new Error(`el registro de npm contestó ${r.status}`); continue; }
      const data = JSON.parse(r.body.toString("utf8")) as Partial<Packument>;
      if (!data || typeof data !== "object" || !data.versions || typeof data.versions !== "object") { last = new Error("el registro de npm contestó algo que no se entiende"); continue; }
      return { name, "dist-tags": data["dist-tags"] && typeof data["dist-tags"] === "object" ? data["dist-tags"] : {}, versions: data.versions };
    } catch (error) {
      if (error instanceof NotFound) throw error;
      last = error;
    }
  }
  throw new Error(message(last ?? new Error("no se ha podido consultar el registro de npm")));
}

/** La versión que se instala: la que pide el proyecto (las mismas reglas que npm: primero «latest» si vale, y no las obsoletas). */
function pickVersion(pk: Packument, spec: LibrarySpec): string | null {
  const versions = Object.keys(pk.versions).filter((v) => parseVersion(v) !== null);
  const tags = pk["dist-tags"];
  if (spec.kind === "tag") {
    const t = tags[spec.value];
    return t && pk.versions[t] ? t : null;
  }
  if (spec.kind !== "range") return null;
  const latest = tags["latest"];
  if (latest && pk.versions[latest] && !pk.versions[latest]!.deprecated && satisfies(latest, spec.value)) return latest;
  const good = versions.filter((v) => !pk.versions[v]!.deprecated);
  return maxSatisfying(good, spec.value) ?? maxSatisfying(versions, spec.value);
}
const accepts = (spec: LibrarySpec, version: string): boolean => (spec.kind === "range" ? satisfies(version, spec.value) : spec.kind === "tag");

async function rootVersion(name: string, ctx: Ctx): Promise<string | null> {
  if (!ctx.rootModules) return null;
  if (ctx.rootVersions.has(name)) return ctx.rootVersions.get(name) ?? null;
  const { fs, path } = await nodeMods();
  let v: string | null = null;
  try {
    const data = JSON.parse(await fs.readFile(path.join(ctx.rootModules, ...name.split("/"), "package.json"), "utf8")) as { version?: unknown };
    v = typeof data.version === "string" && parseVersion(data.version) ? data.version : "0.0.0";
  } catch {
    v = null;
  }
  ctx.rootVersions.set(name, v);
  return v;
}

async function weeklyDownloads(name: string, ctx: Ctx): Promise<number | null> {
  if (!ctx.downloadsApi) return null;
  try {
    const r = await fetchBytes(`${ctx.downloadsApi}${name}`, ctx, "application/json", 200_000);
    if (r.status !== 200) return r.status === 404 ? 0 : null;
    const n = (JSON.parse(r.body.toString("utf8")) as { downloads?: unknown }).downloads;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Una lista de npm de sistemas («os») o procesadores («cpu»): «["darwin"]» solo en Mac; «["!win32"]» en todos menos Windows. */
function allowedBy(list: unknown, value: string): boolean {
  if (!Array.isArray(list) || !list.length) return true;
  const items = list.filter((x): x is string => typeof x === "string");
  if (items.some((x) => x === `!${value}`)) return false;
  const allow = items.filter((x) => !x.startsWith("!"));
  return allow.length ? allow.includes(value) : true;
}

// ----------------------------------------------------------------------------------------------------- el plan

type Placed = { path: string; name: string; pkg: string; version: string; integrity: string; bytes: number; for: Set<string>; deps: Record<string, string | null>; fresh: boolean; meta?: VersionMeta; stage?: string };
type Want = { name: string; pkg: string; spec: LibrarySpec; raw: string; from: string; top: string; optional: boolean; peer: boolean; peerOptional: boolean };
class PlanError extends Error {}

/** «npm:string-width@^4» (un alias): se instala «string-width» con otro nombre de carpeta. */
function wantSpec(raw: string): { pkg: string | null; spec: LibrarySpec } {
  const alias = /^npm:((?:@[^/@\s]+\/)?[^@\s]+)(?:@(.*))?$/.exec(raw.trim());
  if (alias) return validPackageName(alias[1]) ? { pkg: alias[1]!, spec: specOf(alias[2] ?? "latest") } : { pkg: null, spec: { kind: "unsupported", reason: "alias no válido" } };
  return { pkg: null, spec: specOf(raw) };
}

function clonePlacements(src: Map<string, Placed>): Map<string, Placed> {
  const out = new Map<string, Placed>();
  for (const [k, v] of src) out.set(k, { ...v, for: new Set(v.for), deps: { ...v.deps } });
  return out;
}

/**
 * Dónde va cada paquete (como npm): arriba del todo si nadie lo ocupa; si alguien necesita otra versión de uno que ya está (o de
 * uno que trae WILLY), dentro del que lo necesita. Lo que ya está y vale se reutiliza. Cada librería pedida se planea aparte: si
 * una no se puede instalar, las demás sí.
 */
async function planInstall(requests: Array<{ name: string; spec: string }>, manifest: Manifest, ctx: Ctx): Promise<{ placements: Map<string, Placed>; items: InstallItem[]; tops: Array<{ name: string; path: string; range: string; version: string }> }> {
  let placements = new Map<string, Placed>();
  for (const [p, m] of Object.entries(manifest.packages)) placements.set(p, { path: p, name: m.name, pkg: m.pkg ?? m.name, version: m.version, integrity: m.integrity, bytes: m.bytes, for: new Set(m.for), deps: { ...m.deps }, fresh: false });
  const items: InstallItem[] = [];
  const tops: Array<{ name: string; path: string; range: string; version: string }> = [];
  let fresh = 0;

  const setDep = (from: string, name: string, to: string | null) => { const p = placements.get(from); if (p) p.deps[name] = to; };

  for (const req of requests) {
    const name = req.name;
    const raw = req.spec || "latest";
    if (!validPackageName(name)) { items.push({ name: String(name).slice(0, 80), status: "no-instalada", reason: "no es un nombre de librería válido" }); continue; }
    const { spec } = wantSpec(raw);
    if (spec.kind === "unsupported") { items.push({ name, status: "no-instalada", reason: spec.reason }); continue; }
    const rv = isSingleton(name) ? (await rootVersion(name, ctx)) ?? "incluida" : await rootVersion(name, ctx);
    if (rv) {
      items.push({ name, status: "la-trae-willy", version: rv, ...(spec.kind === "range" && parseVersion(rv) && !satisfies(rv, spec.value) ? { reason: `el proyecto pide «${raw}»; se usa la de WILLY (${rv})` } : {}) });
      continue;
    }
    const existing = placements.get(`node_modules/${name}`);
    if (existing) {
      if (accepts(spec, existing.version)) {
        items.push({ name, status: "ya-estaba", version: existing.version });
        if (!manifest.requested[name]) tops.push({ name, path: existing.path, range: raw, version: existing.version });
      } else {
        const users = [...existing.for].filter((x) => x !== name).sort();
        items.push({ name, status: "no-instalada", reason: `otra librería instalada${users.length ? ` (${users.slice(0, 3).join(", ")})` : ""} usa su versión ${existing.version}; quítala primero o pide una versión compatible` });
      }
      continue;
    }

    // Plan de esta librería (si falla, se deshace solo lo suyo).
    const snapshot = clonePlacements(placements);
    const freshBefore = fresh;
    const warningsBefore = ctx.warnings.length;
    const queue: Want[] = [{ name, pkg: name, spec, raw, from: "", top: name, optional: false, peer: false, peerOptional: false }];
    let head = 0;
    try {
      while (head < queue.length) {
        // Se piden por adelantado los datos de los siguientes (en paralelo): así tarda mucho menos.
        for (const next of queue.slice(head, head + ctx.limits.parallel * 2)) if (!isSingleton(next.name)) packument(next.pkg, ctx);
        const w = queue[head++]!;
        const top = w.from === "";
        let target: string;
        if (!top && isSingleton(w.name)) {
          const v = await rootVersion(w.name, ctx);
          if (!v) throw new PlanError(`«${nameAt(w.from)}» necesita «${w.name}», que tendría que traer WILLY`);
          if (w.spec.kind === "range" && !satisfies(v, w.spec.value) && !w.peerOptional) ctx.warnings.push(`«${nameAt(w.from)}» pide ${w.name} «${w.raw}»; se usa el de WILLY (${v}).`);
          setDep(w.from, w.name, null);
          continue;
        }
        if (top) target = `node_modules/${w.name}`;
        else {
          let dir = w.from;
          let found: string | null = null;
          for (;;) {
            const cand = childPath(dir, w.name);
            if (placements.has(cand)) { found = cand; break; }
            if (!dir) break;
            dir = parentOf(dir);
          }
          if (found) {
            const f = placements.get(found)!;
            if (accepts(w.spec, f.version) || w.peer) {
              if (!accepts(w.spec, f.version)) ctx.warnings.push(`«${nameAt(w.from)}» pide ${w.name} «${w.raw}» y hay la ${f.version}.`);
              setDep(w.from, w.name, found);
              continue;
            }
            target = childPath(w.from, w.name);
          } else {
            const v = await rootVersion(w.name, ctx);
            if (v && (accepts(w.spec, v) || w.peer)) {
              if (!accepts(w.spec, v) && !w.peerOptional) ctx.warnings.push(`«${nameAt(w.from)}» pide ${w.name} «${w.raw}»; se usa el de WILLY (${v}).`);
              setDep(w.from, w.name, null);
              continue;
            }
            if (w.peer && w.peerOptional) continue;
            target = v ? childPath(w.from, w.name) : `node_modules/${w.name}`;
          }
        }
        if (w.spec.kind === "unsupported") {
          if (w.optional) continue;
          throw new PlanError(`«${nameAt(w.from) || w.name}» necesita «${w.name}» ${w.spec.reason}: sin npm no se puede`);
        }
        let pk: Packument;
        try {
          pk = await packument(w.pkg, ctx);
        } catch (error) {
          if (w.optional) { ctx.warnings.push(`«${w.name}» (opcional) no se ha instalado: ${message(error)}.`); continue; }
          throw new PlanError(top ? message(error) : `«${nameAt(w.from)}» necesita «${w.name}»: ${message(error)}`);
        }
        const version = pickVersion(pk, w.spec);
        if (!version) {
          if (w.optional) continue;
          throw new PlanError(`no hay ninguna versión de «${w.pkg}» que valga para «${w.raw}»`);
        }
        const meta = pk.versions[version]!;
        if (!allowedBy(meta.os, ctx.platform) || !allowedBy(meta.cpu, ctx.arch)) {
          if (w.optional) continue;
          ctx.warnings.push(`«${w.name}» está hecha para otro sistema (${[...(meta.os ?? []), ...(meta.cpu ?? [])].join(", ")}): se instala igual, pero puede no funcionar.`);
        }
        const integrity = meta.dist?.integrity ?? (meta.dist?.shasum ? `sha1-hex:${meta.dist.shasum}` : "");
        if (!meta.dist?.tarball || !integrity) {
          if (w.optional) continue;
          throw new PlanError(`«${w.pkg}» ${version} no dice dónde descargarla o no trae su huella`);
        }
        if (++fresh > ctx.limits.maxPackages) throw new PlanError(`necesita demasiadas librerías (más de ${ctx.limits.maxPackages})`);
        placements.set(target, { path: target, name: w.name, pkg: w.pkg, version, integrity, bytes: 0, for: new Set(), deps: {}, fresh: true, meta });
        if (!top) setDep(w.from, w.name, target);
        if (meta.deprecated) ctx.warnings.push(`«${w.pkg}» ${version} está marcada como obsoleta: ${String(meta.deprecated).slice(0, 160)}`);
        if (meta.hasInstallScript) ctx.warnings.push(`«${w.pkg}» trae un programa de instalación que WILLY no ejecuta (por seguridad); para la vista previa no suele hacer falta.`);
        const optional = meta.optionalDependencies ?? {};
        const add = (group: Record<string, string> | undefined, kind: "dep" | "opt" | "peer") => {
          for (const [dn, dr] of Object.entries(group ?? {})) {
            if (typeof dr !== "string" || !validPackageName(dn)) continue;
            if (kind === "dep" && Object.prototype.hasOwnProperty.call(optional, dn)) continue;
            const ws = wantSpec(dr);
            queue.push({ name: dn, pkg: ws.pkg ?? dn, spec: ws.spec, raw: dr, from: target, top: w.top, optional: kind === "opt", peer: kind === "peer", peerOptional: kind === "peer" && meta.peerDependenciesMeta?.[dn]?.optional === true });
          }
        };
        add(meta.dependencies, "dep");
        add(optional, "opt");
        add(meta.peerDependencies, "peer");
      }
      const topPlaced = placements.get(`node_modules/${name}`)!;
      tops.push({ name, path: topPlaced.path, range: raw, version: topPlaced.version });
      items.push({ name, status: "instalada", version: topPlaced.version, range: raw });
    } catch (error) {
      placements = snapshot;
      fresh = freshBefore;
      ctx.warnings.length = warningsBefore;
      items.push({ name, status: "no-instalada", reason: error instanceof PlanError ? error.message : message(error) });
    }
  }

  // Para qué está cada paquete: todo lo que cuelga de cada librería pedida (también lo que ya estaba y se reutiliza).
  for (const t of tops) {
    const seen = new Set<string>();
    const stack = [t.path];
    while (stack.length) {
      const p = stack.pop()!;
      if (seen.has(p)) continue;
      seen.add(p);
      const node = placements.get(p);
      if (!node) continue;
      node.for.add(t.name);
      for (const d of Object.values(node.deps)) if (d) stack.push(d);
    }
  }
  return { placements, items, tops };
}

// ----------------------------------------------------------------------------------------------------- descargar y colocar

async function downloadTarball(p: Placed, ctx: Ctx): Promise<Buffer> {
  const { crypto } = await nodeMods();
  const hash = (algo: string, data: Uint8Array, enc: "base64" | "hex") => crypto.createHash(algo).update(data).digest(enc);
  const first = p.meta!.dist!.tarball!;
  const urls: string[] = [];
  try { allowed(first, ctx); urls.push(first); } catch { /* se prueba en los espejos */ }
  try {
    const u = new URL(first);
    for (const reg of ctx.registries) {
      const r = new URL(reg);
      const alt = `${r.origin}${u.pathname}`;
      if (!urls.includes(alt)) urls.push(alt);
    }
  } catch { /* dirección rara: solo la original */ }
  let last: unknown = new Error("no se puede descargar");
  for (const url of urls) {
    try {
      const r = await fetchBytes(url, ctx, "application/octet-stream", ctx.limits.maxTarballBytes);
      if (r.status !== 200) { last = new Error(`la descarga contestó ${r.status}`); continue; }
      if (!integrityOk(r.body, p.integrity, hash)) { last = new Error("la huella no coincide: lo descargado NO es lo publicado (no se instala)"); continue; }
      return r.body;
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`«${p.pkg}» ${p.version}: ${message(last)}`);
}

async function pool<T>(list: T[], size: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (failure === null && next < list.length) {
      const i = next++;
      try {
        await fn(list[i]!, i);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, worker));
  if (failure !== null) throw failure;
}

// ----------------------------------------------------------------------------------------------------- lo que se usa desde fuera

/** Las librerías instaladas (las pedidas), con cuánto ocupan con lo que necesitan. */
export async function listLibraries(store: string): Promise<LibraryList> {
  const m = await readManifest(store);
  const pk = Object.values(m.packages);
  const libraries: InstalledLibrary[] = Object.entries(m.requested).map(([name, r]) => {
    const mine = pk.filter((p) => p.for.includes(name));
    return { name, version: r.version, range: r.range, bytes: mine.reduce((n, p) => n + p.bytes, 0), packages: mine.length, installedAt: r.at };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { libraries, totalBytes: pk.reduce((n, p) => n + p.bytes, 0), packages: pk.length };
}

/** Los nombres de las librerías instaladas (para decírselo a la IA). */
export async function installedLibraryNames(store: string): Promise<string[]> {
  return Object.keys((await readManifest(store)).requested).sort();
}

/**
 * Lo que se sabe de cada librería que falta, antes de instalarla: si existe, qué versión se instalaría, si el proyecto la
 * declara, si es conocida y, con todo eso, si se puede instalar SOLA.
 */
export async function inspectLibraries(store: string, names: string[], files: GeneratedFile[], opts: StoreOptions = {}): Promise<LibraryInfo[]> {
  const ctx = makeCtx(opts);
  const manifest = await readManifest(store);
  const declared = declaredDependencies(files);
  const list = [...new Set(names)].slice(0, 20);
  return await Promise.all(list.map(async (name): Promise<LibraryInfo> => {
    const base: LibraryInfo = { name, valid: validPackageName(name), exists: null, version: null, declared: declared[name] ?? null, weeklyDownloads: null, deprecated: null, provided: null, installed: null, auto: { ok: false, reason: "" } };
    if (!base.valid) return { ...base, exists: false, auto: { ok: false, reason: "no es un nombre de librería válido" } };
    const rv = isSingleton(name) ? (await rootVersion(name, ctx)) ?? "incluida" : await rootVersion(name, ctx);
    if (rv) return { ...base, provided: rv, auto: { ok: false, reason: "ya la trae WILLY" } };
    const mine = manifest.requested[name]?.version ?? manifest.packages[`node_modules/${name}`]?.version ?? null;
    if (mine) return { ...base, installed: mine, auto: { ok: false, reason: "ya está instalada" } };
    const spec = wantSpec(base.declared ?? "latest").spec;
    const [pk, downloads] = await Promise.all([
      packument(name, ctx).then((p) => ({ ok: true as const, p }), (e: unknown) => ({ ok: false as const, e })),
      weeklyDownloads(name, ctx),
    ]);
    if (!pk.ok) {
      const notFound = pk.e instanceof NotFound;
      return { ...base, exists: notFound ? false : null, weeklyDownloads: downloads, error: message(pk.e), auto: { ok: false, reason: notFound ? "no existe en el registro de npm" : message(pk.e) } };
    }
    const version = spec.kind === "unsupported" ? null : pickVersion(pk.p, spec);
    const meta = version ? pk.p.versions[version] : undefined;
    const deprecated = meta?.deprecated ? String(meta.deprecated).slice(0, 200) : null;
    const info: LibraryInfo = { ...base, exists: true, version, weeklyDownloads: downloads, deprecated };
    const reason = spec.kind === "unsupported" ? spec.reason
      : !version ? `ninguna versión vale para «${base.declared}»`
        : !base.declared ? "el proyecto no la declara en su package.json"
          : deprecated ? "está marcada como obsoleta"
            : downloads === null ? "no se ha podido comprobar si es conocida"
              : downloads < AUTO_INSTALL_MIN_DOWNLOADS ? downloadsLabel(downloads)
                : "";
    return { ...info, auto: { ok: reason === "", reason: reason || "conocida y declarada en package.json" } };
  }));
}

/**
 * Instala librerías (con lo que necesitan) en el almacén. `requests`: nombre y versión («^11.0.0», «latest»…). Si ya hay otra
 * versión de una librería pedida que no vale, se quita antes. Si algo falla al descargar o colocar, no queda nada a medias.
 */
export async function installLibraries(store: string, requests: Array<{ name: string; spec?: string }>, opts: StoreOptions = {}): Promise<InstallResult> {
  return await serial(async () => {
    const started = Date.now();
    const { fs, path, zlib } = await nodeMods();
    const ctx = makeCtx(opts);
    await fs.mkdir(store, { recursive: true });
    let manifest = await readManifest(store);
    const wanted = requests.filter((r, i, all) => all.findIndex((x) => x.name === r.name) === i).slice(0, 20).map((r) => ({ name: r.name, spec: (r.spec ?? "latest").trim() || "latest" }));
    // Otra versión instalada que no vale para lo que se pide: se quita primero.
    for (const r of wanted) {
      const cur = manifest.requested[r.name];
      const spec = wantSpec(r.spec).spec;
      if (cur && spec.kind === "range" && !satisfies(cur.version, spec.value)) manifest = (await removeInternal(store, r.name, manifest)).manifest;
    }
    const { placements, items, tops } = await planInstall(wanted, manifest, ctx);
    const fresh = [...placements.values()].filter((p) => p.fresh);
    const staging = path.join(store, `.instalando-${Date.now()}-${process.pid}`);
    let bytes = 0;
    if (fresh.length) {
      await fs.mkdir(staging, { recursive: true });
      try {
        await pool(fresh, ctx.limits.parallel, async (p, i) => {
          const tgz = await downloadTarball(p, ctx);
          const { files, skipped, bytes: size } = readTarball(tgz, ctx.limits.maxUnpackedBytes, (b, max) => zlib.gunzipSync(b, { maxOutputLength: max }));
          if (!files.length) throw new Error(`«${p.pkg}» ${p.version}: el paquete descargado está vacío`);
          if (skipped) ctx.warnings.push(`«${p.pkg}»: ${skipped} archivo(s) raros (enlaces o rutas no válidas) no se han copiado.`);
          bytes += size;
          if (bytes > ctx.limits.maxTotalBytes) throw new Error(`demasiado grande en total (más de ${Math.round(ctx.limits.maxTotalBytes / 1_000_000)} MB)`);
          p.bytes = size;
          const dir = path.join(staging, `p${i}`);
          for (const f of files) {
            const target = path.join(dir, ...f.path.split("/"));
            if (!target.startsWith(dir + path.sep)) continue;
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, f.data);
          }
          p.stage = dir;
        });
        // Todo descargado y comprobado: ahora sí, a su sitio (primero los de arriba).
        fresh.sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));
        const modules = path.join(store, "node_modules");
        const moved: string[] = [];
        try {
          for (const p of fresh) {
            const final = path.join(store, ...p.path.split("/"));
            if (!final.startsWith(modules + path.sep)) throw new Error("ruta de instalación no válida");
            await retry(() => fs.rm(final, { recursive: true, force: true }));
            await fs.mkdir(path.dirname(final), { recursive: true });
            await retry(() => fs.rename(p.stage!, final));
            moved.push(final);
          }
        } catch (error) {
          for (const m of moved.reverse()) await fs.rm(m, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
        // Nada de esta instalación queda: las pedidas que iban a instalarse, «no instalada» con el motivo.
        const why = message(error);
        return {
          items: items.map((it) => (it.status === "instalada" ? { name: it.name, status: "no-instalada" as const, reason: why } : it)),
          packages: 0, bytes: 0, ms: Date.now() - started, warnings: ctx.warnings,
        };
      }
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
    // El apunte: lo nuevo y para qué está cada cosa.
    const now = new Date().toISOString();
    for (const p of placements.values()) {
      if (!p.fresh && !manifest.packages[p.path]) continue;
      manifest.packages[p.path] = { name: p.name, ...(p.pkg !== p.name ? { pkg: p.pkg } : {}), version: p.version, integrity: p.integrity, bytes: p.bytes || manifest.packages[p.path]?.bytes || 0, for: [...p.for].sort(), deps: p.deps };
    }
    for (const t of tops) manifest.requested[t.name] = { range: t.range, version: t.version, at: now };
    if (fresh.length || tops.length) {
      await writeManifest(store, manifest);
      generation += 1;
    }
    return { items, packages: fresh.length, bytes, ms: Date.now() - started, warnings: ctx.warnings };
  });
}

async function removeInternal(store: string, name: string, manifest: Manifest): Promise<{ manifest: Manifest; removed: number; bytes: number }> {
  const { fs, path } = await nodeMods();
  delete manifest.requested[name];
  for (const p of Object.values(manifest.packages)) p.for = p.for.filter((x) => x !== name);
  const gone = Object.entries(manifest.packages).filter(([, p]) => p.for.length === 0).map(([k]) => k).sort((a, b) => depth(b) - depth(a));
  let bytes = 0;
  const modules = path.join(store, "node_modules");
  for (const k of gone) {
    bytes += manifest.packages[k]!.bytes;
    delete manifest.packages[k];
    const dir = path.join(store, ...k.split("/"));
    if (dir.startsWith(modules + path.sep)) await retry(() => fs.rm(dir, { recursive: true, force: true }));
    // La carpeta del grupo («@radix-ui») se quita si se queda vacía.
    const scope = path.dirname(dir);
    if (path.basename(scope).startsWith("@")) await fs.rmdir(scope).catch(() => undefined);
  }
  return { manifest, removed: gone.length, bytes };
}

/** Quita una librería instalada y lo que solo ella necesitaba (lo que usan otras, se queda). */
export async function removeLibrary(store: string, name: string): Promise<RemoveResult> {
  return await serial(async () => {
    const manifest = await readManifest(store);
    if (!validPackageName(name) || !manifest.requested[name]) throw new Error(`«${String(name).slice(0, 80)}» no está entre las librerías instaladas.`);
    const r = await removeInternal(store, name, manifest);
    await writeManifest(store, r.manifest);
    generation += 1;
    return { name, removed: r.removed, bytes: r.bytes };
  });
}
