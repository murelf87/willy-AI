// LIBRERÍAS NUEVAS PARA LOS PROYECTOS (rediseño, revisión 27; lo que faltaba en SÚPER IA: «Instalar librerías nuevas para los
// proyectos (en tu equipo no hay npm)»). Cuando un proyecto React usa una librería que WILLY no trae (framer-motion,
// react-router-dom, chart.js…), WILLY la instala él mismo desde el registro de npm, SIN npm: la descarga, comprueba su huella
// (sha512) y la guarda en `datos-privados/librerias-proyectos`, sin ejecutar nada de ella. Aquí, lo que comparten la pantalla y
// el servidor: los tipos, qué versión pide el proyecto en su package.json y cómo se cuenta en palabras. Lógica pura.

import type { GeneratedFile } from "@/lib/ai-standard";
import { validRange } from "@/lib/semver-lite";

/** Carpeta del almacén (dentro de `datos-privados`, al lado de `proyectos`). */
export const LIBRARY_STORE_DIRNAME = "librerias-proyectos";
/** Para instalar SOLA una librería tiene que ser conocida: al menos estas descargas a la semana en npm. */
export const AUTO_INSTALL_MIN_DOWNLOADS = 1000;
/** Nunca se instala otra copia de estas: las trae WILLY (dos React en la misma página no funcionan). */
export const WILLY_SINGLETONS = ["react", "react-dom", "scheduler"] as const;

export type InstalledLibrary = { name: string; version: string; range: string; bytes: number; packages: number; installedAt: string };
export type LibraryList = { libraries: InstalledLibrary[]; totalBytes: number; packages: number };
/** Lo que se sabe de una librería antes de instalarla. */
export type LibraryInfo = {
  name: string;
  valid: boolean;
  /** ¿Existe en el registro de npm? (null: no se ha podido comprobar, p. ej. sin internet). */
  exists: boolean | null;
  /** La versión que se instalaría (la que pide el proyecto, o la última). */
  version: string | null;
  /** Lo que pide el proyecto en su package.json (null si no la declara). */
  declared: string | null;
  weeklyDownloads: number | null;
  deprecated: string | null;
  /** WILLY ya la trae (su versión): los proyectos usan esa. */
  provided: string | null;
  /** Ya está instalada (su versión). */
  installed: string | null;
  /** ¿Se puede instalar SOLA? (y si no, por qué). */
  auto: { ok: boolean; reason: string };
  error?: string;
};
export type InstallStatus = "instalada" | "ya-estaba" | "la-trae-willy" | "no-instalada";
export type InstallItem = { name: string; status: InstallStatus; version?: string; range?: string; packages?: number; bytes?: number; reason?: string };
export type InstallResult = { items: InstallItem[]; packages: number; bytes: number; ms: number; warnings: string[] };
export type RemoveResult = { name: string; removed: number; bytes: number };

/** Nombre válido de un paquete de npm (en minúsculas, con o sin «@grupo/»; nada de rutas). */
export function validPackageName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 214 && /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name) && !/\.\.|\/\.|^\.|node_modules|favicon\.ico/.test(name);
}

/** Qué pide el proyecto: un rango de versiones, una etiqueta («latest») o algo que sin npm no se puede instalar (git, archivo…). */
export type LibrarySpec = { kind: "range"; value: string } | { kind: "tag"; value: string } | { kind: "unsupported"; reason: string };
export function specOf(value: string | null | undefined): LibrarySpec {
  const v = String(value ?? "").trim();
  if (!v || v === "latest") return { kind: "tag", value: "latest" };
  if (/^(?:npm:|file:|link:|workspace:|portal:|patch:|git(?:\+|:)|github:|gitlab:|bitbucket:|https?:)/i.test(v) || /^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(v)) {
    return { kind: "unsupported", reason: "no es una versión de npm (es una dirección de git, de internet o de un archivo)" };
  }
  if (validRange(v)) return { kind: "range", value: v };
  if (/^[a-z][a-z0-9._-]*$/i.test(v)) return { kind: "tag", value: v };
  return { kind: "unsupported", reason: `la versión «${v.slice(0, 40)}» no se entiende` };
}

/** Las librerías que declara el proyecto en su package.json (dependencies, devDependencies y peerDependencies), con su versión. */
export function declaredDependencies(files: GeneratedFile[]): Record<string, string> {
  const pkg = files.find((f) => f.path.replace(/\\/g, "/").replace(/^\.?\//, "") === "package.json");
  if (!pkg) return {};
  try {
    const data = JSON.parse(pkg.content) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of ["peerDependencies", "devDependencies", "dependencies"]) {
      const group = data[key];
      if (!group || typeof group !== "object") continue;
      for (const [name, value] of Object.entries(group as Record<string, unknown>)) if (typeof value === "string" && validPackageName(name)) out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

const nf = (n: number, d = 1): string => n.toLocaleString("es-ES", { maximumFractionDigits: d, minimumFractionDigits: 0 });
/** «4,9 MB», «820 KB». */
export function bytesLabel(bytes: number): string {
  if (bytes >= 1_048_576) return `${nf(bytes / 1_048_576)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
/** «muy conocida (5,2 millones de descargas a la semana)», «poco conocida (12 descargas a la semana)». */
export function downloadsLabel(n: number | null): string {
  if (n === null) return "no se ha podido comprobar si es conocida";
  const how = n >= 1_000_000 ? "muy conocida" : n >= AUTO_INSTALL_MIN_DOWNLOADS ? "conocida" : "poco conocida";
  const count = n >= 1_000_000 ? `${nf(n / 1_000_000)} millones` : n >= 10_000 ? `${nf(n / 1000, 0)} mil` : nf(n, 0);
  return `${how} (${count} descarga${n === 1 ? "" : "s"} a la semana)`;
}

/** Una línea para el dueño sobre una librería que falta. */
export function libraryInfoLine(i: LibraryInfo): string {
  if (!i.valid) return `«${i.name}»: no es un nombre de librería válido.`;
  if (i.provided) return `«${i.name}»: ya la trae WILLY (versión ${i.provided}).`;
  if (i.installed) return `«${i.name}»: ya está instalada (versión ${i.installed}).`;
  if (i.exists === false) return `«${i.name}»: no existe en el registro de npm (¿nombre mal escrito?).`;
  if (i.exists === null) return `«${i.name}»: no se ha podido consultar${i.error ? ` (${i.error})` : ""}.`;
  const parts = [`«${i.name}» ${i.version ?? ""}`.trim(), downloadsLabel(i.weeklyDownloads)];
  if (i.declared) parts.push(`el proyecto la pide en package.json (${i.declared})`);
  else parts.push("el proyecto no la declara en package.json");
  if (i.deprecated) parts.push(`OBSOLETA: ${i.deprecated.slice(0, 120)}`);
  return `${parts.join(" · ")}.`;
}

/** El resultado de una instalación en una frase (para la consola del proyecto y el panel). */
export function installSummary(r: InstallResult): string {
  const done = r.items.filter((i) => i.status === "instalada");
  const had = r.items.filter((i) => i.status === "ya-estaba" || i.status === "la-trae-willy");
  const bad = r.items.filter((i) => i.status === "no-instalada");
  const parts: string[] = [];
  if (done.length) {
    const extra = Math.max(0, r.packages - done.length);
    parts.push(`Instalada${done.length === 1 ? "" : "s"} ${done.map((i) => `«${i.name}» ${i.version ?? ""}`.trim()).join(", ")}${extra ? ` (+${extra} que necesita${done.length === 1 ? "" : "n"})` : ""}, ${bytesLabel(r.bytes)}`);
  }
  if (had.length) parts.push(`${had.map((i) => `«${i.name}»`).join(", ")} ya estaba${had.length === 1 ? "" : "n"}`);
  if (bad.length) parts.push(`sin instalar: ${bad.map((i) => `«${i.name}» (${i.reason ?? "no se pudo"})`).join(", ")}`);
  return parts.length ? `${parts.join("; ")}.` : "No había nada que instalar.";
}
