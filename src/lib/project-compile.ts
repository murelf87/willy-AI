// PROYECTOS REACT/VITE EN LA VISTA PREVIA (rediseño, revisión 25; puntos 11 y 98-101). Un proyecto React/Vite no se puede
// pintar tal cual (su index.html carga «src/main.tsx», que el navegador no entiende): hay que COMPILARLO. En el equipo del dueño
// no hay npm, pero WILLY ya trae las piezas (su TypeScript —o esbuild, si lo hay—, React, Tailwind y las librerías de interfaz
// más usadas). Con ellas se compila el proyecto al guardarlo y la vista previa enseña su código DE VERDAD, con todo lo de la
// vista previa (consola, comprobación, reparación, seleccionar, revisar el diseño, comparar). Aquí, la parte que no depende del
// servidor: qué proyectos se compilan, qué librerías hay, cómo se cuentan los errores y qué se le pide a WILLY para arreglarlos.

import type { GeneratedFile } from "@/lib/ai-standard";
import { resolveRef } from "@/lib/live-files";

/** Librerías que trae WILLY (las de su propia instalación): un proyecto que use solo estas se compila en el equipo. */
export const AVAILABLE_LIBRARIES = [
  "react", "react-dom", "lucide-react", "recharts", "date-fns", "zod", "react-hook-form", "@hookform/resolvers", "clsx",
  "tailwind-merge", "class-variance-authority", "sonner", "cmdk", "embla-carousel-react", "vaul", "input-otp", "react-day-picker",
  "react-resizable-panels", "@tanstack/react-query", "@tanstack/react-router", "@radix-ui/react-*", "tailwindcss (v4)",
] as const;

/** Qué se compila: la página (index.html) y su punto de entrada («src/main.tsx»). */
export type CompileTarget = { page: string; entry: string };

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/^\.?\//, "");
const CODE = /\.(?:tsx|ts|jsx|js|mjs)$/i;

/**
 * ¿Es un proyecto que hay que compilar? Su página carga un módulo del propio proyecto que el navegador no puede ejecutar tal
 * cual: TypeScript/JSX (main.tsx, index.jsx…) o JavaScript que importa otros archivos o librerías. null si no.
 */
export function compileTarget(files: GeneratedFile[]): CompileTarget | null {
  const pages = files.filter((f) => /\.html?$/i.test(f.path)).sort((a, b) => (norm(a.path) === "index.html" ? -1 : norm(b.path) === "index.html" ? 1 : a.path.localeCompare(b.path)));
  for (const page of pages) {
    for (const m of page.content.matchAll(/<script\b([^>]*)>\s*<\/script>/gi)) {
      const attrs = m[1] ?? "";
      if (!/\btype\s*=\s*["']?module/i.test(attrs)) continue;
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
      if (!src || /^(?:[a-z]+:)?\/\//i.test(src)) continue;
      const target = resolveRef(page.path, src);
      const entry = files.find((f) => norm(f.path) === target);
      if (!entry || !CODE.test(entry.path)) continue;
      const needs = /\.(?:tsx|ts|jsx)$/i.test(entry.path) || /^\s*import\s|\bimport\s*\(/m.test(entry.content);
      if (needs) return { page: page.path, entry: entry.path };
    }
  }
  return null;
}

/** Huella de los archivos (para no compilar dos veces lo mismo). */
export function compileKey(files: GeneratedFile[]): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => { for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) { feed(f.path); feed("\u0000"); feed(f.content); feed("\u0001"); }
  return `c1.${files.length}.${h.toString(36)}`;
}

export type CompileIssue = { file: string; line: number; column: number; text: string };
/** Con qué se compiló: el esbuild de la instalación (si lo hay) o el motor propio de WILLY con su TypeScript. */
export type CompileEngine = "esbuild" | "typescript";

/** El nombre de la librería de un import («@radix-ui/react-dialog/dist/x» → «@radix-ui/react-dialog»). */
export const packageName = (spec: string): string => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);
/** Cómo quedó Tailwind: compilado con el de WILLY, sin poder compilar (se ve sin esas clases) o el proyecto no lo usa. */
export type TailwindState = "compilado" | "sin-compilar" | "no";
export type CompileOutcome =
  | { ok: true; key: string; page: string; entry: string; html: string; ms: number; warnings: CompileIssue[]; tailwind: TailwindState; bytes: number; engine?: CompileEngine }
  /** `env`: el problema es del equipo (no hay compilador, tardó demasiado…), no del código del proyecto: no se «repara» el código. */
  | { ok: false; key: string; page: string; entry: string; ms: number; errors: CompileIssue[]; missing: string[]; env?: boolean };

/** Un error en palabras (con su archivo y línea si los hay). */
export function issueText(i: CompileIssue): string {
  return `${i.file ? `${i.file}${i.line ? ` (línea ${i.line}${i.column ? `, columna ${i.column}` : ""})` : ""}: ` : ""}${i.text}`;
}

/** «Falta la librería «framer-motion»» / «Faltan las librerías «a» y «b»». */
export function missingText(missing: string[]): string {
  if (!missing.length) return "";
  const names = missing.map((m) => `«${m}»`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
  return missing.length === 1 ? `Falta la librería ${list}: no la trae WILLY ni está instalada en tu equipo.` : `Faltan las librerías ${list}: no las trae WILLY ni están instaladas en tu equipo.`;
}

/**
 * Rev27 · Una librería que no trae WILLY: se DECLARA en el package.json del proyecto y WILLY la instala sola (desde npm, sin npm,
 * comprobando su huella) si es conocida; si no, se sustituye por código propio o por una de las que trae.
 */
const LIBRARY_RULE = "Si de verdad hace falta, declárala en el package.json del proyecto (en «dependencies», con su versión, por ejemplo \"framer-motion\": \"^11.0.0\"): WILLY la instala sola desde npm si es conocida. Si no, sustitúyela por código propio o por una de las librerías que trae WILLY.";

/**
 * Lo que se le pide a WILLY cuando el proyecto no compila (o se pediría en la reparación automática): los errores reales,
 * con su archivo y línea, las librerías que faltan y cuáles SÍ puede usar.
 */
export function compileRepairRequest(o: Extract<CompileOutcome, { ok: false }>): string {
  return [
    `El proyecto no compila para la vista previa (su entrada es «${o.entry}»). Arregla la causa, sin romper lo demás:`,
    ...o.errors.slice(0, 10).map((e) => `- Error: ${issueText(e)}`),
    ...(o.missing.length ? [`- ${missingText(o.missing)} ${LIBRARY_RULE}`] : []),
    `Librerías que trae WILLY (se pueden usar sin instalar nada): ${AVAILABLE_LIBRARIES.join(", ")}.`,
    "Entrega los archivos que cambies COMPLETOS.",
  ].join("\n");
}

/**
 * Para la IA, cuando el proyecto es React/Vite: con qué se compila y se comprueba en el equipo del dueño. Rev27: además de lo
 * que trae WILLY, las librerías ya instaladas en el equipo (`installed`) y cómo pedir otra (declarándola en package.json).
 */
export function reactProjectRules(installed: readonly string[] = []): string {
  const extra = installed.filter((n) => typeof n === "string" && n.length > 0 && n.length < 120).slice(0, 40);
  return [
    "PROYECTO REACT/VITE: además de verlo en la vista previa, WILLY COMPILA el código de verdad en el equipo del dueño (sin npm) para comprobar que funciona. Para que compile:",
    `- Usa primero las librerías que trae WILLY: ${AVAILABLE_LIBRARIES.join(", ")}.`,
    ...(extra.length ? [`- Ya instaladas en el equipo (también se pueden usar): ${extra.join(", ")}.`] : []),
    `- ¿Hace falta otra (react-router-dom, framer-motion, chart.js…)? ${LIBRARY_RULE} Solo librerías conocidas de npm (nada de direcciones de git ni de archivos); para pedir datos a internet no hace falta axios: usa fetch.`,
    "- El index.html carga el punto de entrada con <script type=\"module\" src=\"/src/main.tsx\"></script> y monta la app en <div id=\"root\"></div>. El alias «@/» apunta a «src/».",
    "- La vista previa de WILLY ES este proyecto compilado: no crees «vista-previa.html» ni la mantengas al día (en los proyectos React/Vite esto sustituye a la regla 5 de «TRABAJAS SOBRE UN PROYECTO»).",
    "- Rutas en código, en src/router.tsx (createRootRoute, createRoute y createRouter de @tanstack/react-router, con history: createHashHistory()). Si el proyecto ya usa rutas por archivos (src/routes y src/routeTree.gen.ts), al añadir o quitar una página actualiza también src/routeTree.gen.ts: en el equipo no se genera solo.",
    "- Los estilos, en archivos .css importados desde el código (Tailwind v4 con @import \"tailwindcss\" funciona). Las imágenes, en SVG dentro del proyecto (o las fotos que dé el dueño): nada de servicios de relleno de internet ni rutas a imágenes que no existen en el proyecto.",
  ].join("\n");
}

/** Las mismas reglas, sin librerías instaladas (para quien no sabe todavía cuáles hay). */
export const REACT_PROJECT_RULES = reactProjectRules();
