// ¿SIRVE PARA EL PROYECTO LO QUE HA CONTESTADO LA IA? (25/09/2026)
// En «Mundo jamon» la IA gratuita que contestaba (OpenRouter · nemotron) devolvió 8 veces el mismo archivo roto al pedirle que
// lo reparara, y una vez 60.000 caracteres de razonamiento en inglés sin ningún archivo: WILLY lo daba por bueno y el dueño
// tenía que volver a pulsar «Reparar». Ahora, cuando lo que se pide TIENE QUE cambiar archivos (construir el proyecto, reparar
// la vista previa, la compilación o las pruebas, arreglar lo elegido), la respuesta se prueba con el mismo applyAnswer que
// guarda los archivos: si no cambiaría ninguno (sin archivos, los mismos de antes o todos rotos), o si la página que entrega
// sigue sin poder ejecutarse, no vale y el relevo de IA externas pasa sola a la siguiente. En cualquier trabajo sobre un
// proyecto (también construir o una pregunta), el razonamiento en vez de la respuesta, los archivos rotos o una página que no se
// ejecuta tampoco valen. Lógica pura.

import type { GeneratedFile } from "@/lib/ai-standard";
import { applyAnswer } from "@/lib/project-work";

/** Para comprobar un módulo como cuerpo de una función que admite «await». */
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (code: string) => unknown;

/**
 * El primer error de sintaxis de los <script> (normales o módulos; sin «src», y no los de Babel o JSON) de las páginas HTML, tal
 * como lo vería el navegador. null si no hay, o si este navegador no deja comprobarlo.
 */
export function scriptSyntaxError(files: ReadonlyArray<{ path: string; content: string }>): string | null {
  for (const file of files) {
    if (!/\.html?$/i.test(file.path)) continue;
    for (const m of file.content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1] ?? "";
      const code = m[2] ?? "";
      if (/\bsrc\s*=/i.test(attrs) || !code.trim()) continue;
      const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? "").toLowerCase();
      const isModule = type === "module";
      if (type && !isModule && type !== "text/javascript" && type !== "application/javascript") continue;
      // Un módulo se comprueba sin sus import/export (que solo valen en un módulo) y como función asíncrona (admite await).
      const body = isModule
        ? code
          .replace(/^\s*import\s[\s\S]*?\bfrom\s*["'][^"'\n]+["'];?/gm, "")
          .replace(/^\s*import\s*["'][^"'\n]+["'];?/gm, "")
          .replace(/^\s*export\s*\{[^}]*\}(?:\s*from\s*["'][^"'\n]+["'])?;?/gm, "")
          .replace(/^\s*export\s+default\s+/gm, "")
          .replace(/^\s*export\s+(?=(?:const|let|var|function|class|async)\b)/gm, "")
          .replace(/\bimport\.meta\b/g, "({})")
        : code;
      try {
        if (isModule) new AsyncFunction(body);
        else new Function(body);
      } catch (error) {
        if (error instanceof SyntaxError) return `${file.path}: ${error.message}`;
        return null;
      }
    }
  }
  return null;
}

/**
 * Por qué no sirve una respuesta sobre el proyecto (o null si sirve). Siempre: su razonamiento en vez de la respuesta, archivos
 * rotos o una página que no se puede ejecutar. Con `requireFiles` (un «Reparar», una reparación automática, «arreglar lo
 * elegido»…), además, no cambiar ningún archivo. Sin él (una construcción puede empezar proponiendo las direcciones visuales,
 * una pregunta se contesta sin archivos), una respuesta sin archivos sí vale.
 */
export function unusableAnswer(text: string, current: GeneratedFile[], opts: { requireFiles: boolean; mustContain?: string[] } = { requireFiles: true }): string | null {
  // Su razonamiento en vez de la respuesta: empieza «We need to», «Let's» y ningún bloque lleva su ruta en la cabecera (los trozos
  // de código que cita se tomarían por archivos solo porque nombra el archivo antes; no son una entrega).
  const headed = (text.match(/```[\w+-]*[ \t:]+[^\s`]+\.[A-Za-z0-9]+[^\n]*\n/g) ?? []).length;
  if (!headed && /^\s*(?:we need to|let'?s |let me |okay\b|ok,|the user |i need to|i will |i'll |first,? )/i.test(text)) return "ha escrito su razonamiento (en inglés) en vez de entregar los archivos";
  const applied = applyAnswer(current, text);
  if (applied.changed.length + applied.added.length > 0) {
    // Una página que sigue sin poder ejecutarse tampoco vale (en «Mundo jamon», 8 «reparaciones» seguidas con JSX dentro de un
    // <script> normal: «Unexpected token '<'»).
    const touched = new Set([...applied.changed, ...applied.added]);
    const broken = scriptSyntaxError(applied.files.filter((f) => touched.has(f.path)));
    if (broken) return `sigue entregando una página que no se puede ejecutar (${broken})`;
    // (25/09/2026) «Cambia el botón por «Reserva tu clase gratis»»: Gemini entregó 30.000 caracteres (una página de reservas
    // entera) sin poner ese texto en ningún sitio. Lo que el dueño pide entre comillas tiene que estar en los archivos.
    // Tiene que estar en un archivo que cambia de verdad y que forma parte de la aplicación (Mistral lo puso en un «demo.html»
    // suelto y pidió ver la portada en vez de cambiarla).
    const inApp = applied.files.some((f) => /^src\//.test(f.path)) ? (f: GeneratedFile) => /^src\/|^index\.html$/.test(f.path) : () => true;
    const delivered = applied.files.filter((f) => touched.has(f.path) && inApp(f));
    const missing = (opts.mustContain ?? []).find((needle) => !delivered.some((f) => plain(f.content).includes(plain(needle))));
    return missing ? `no ha puesto «${missing}» en ningún archivo de la aplicación: no ha hecho lo que se pedía` : null;
  }
  const first = applied.rejected[0];
  if (first) return `ha entregado archivos rotos o incompletos (${first.reason.replace(/\s+/g, " ").slice(0, 140)})`;
  if (!opts.requireFiles) return null;
  if (/```[^\n]*\S[^\n]*\n[\s\S]*?```/.test(text) || /^<{5,9}\s*SEARCH\s*$/m.test(text)) return "ha devuelto los mismos archivos, sin ningún cambio";
  return text.length > 20_000 ? "ha escrito mucho texto pero ningún archivo con su ruta" : "no ha entregado ningún archivo con su ruta";
}

const plain = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
const QUOTE = /[«“"]([^»”"\n]{3,120})[»”"]/g;
const CHANGE_VERB = /\b(?:cambia|cambiar|pon|poner|escribe|escribir|añade|añadir|agrega|agregar|muestra|mostrar|que diga|que ponga|titula|titular|renombra|renombrar|llama|llamar|sustituye|sustituir|reemplaza|reemplazar|traduce|traducir)\b/i;
const NOT_WANTED = /(?:quita|quitar|elimina|eliminar|borra|borrar|en vez de|en lugar de|sustituye|sustituir|reemplaza|reemplazar|cambia|cambiar)\s+(?:el |la |los |las |el texto |la palabra )?$/i;

/**
 * Los textos que el dueño pide tal cual, entre comillas («pon «Reserva tu clase gratis»», «cambia «A» por «B»» → «B»), para
 * comprobar después que están en los archivos. Sin verbo de cambio (una pregunta, un nombre de empresa) no se exige nada.
 */
export function requiredTexts(request: string): string[] {
  if (!CHANGE_VERB.test(request)) return [];
  const out: string[] = [];
  for (const m of request.matchAll(QUOTE)) {
    const before = request.slice(Math.max(0, m.index - 40), m.index);
    const after = request.slice(m.index + m[0].length, m.index + m[0].length + 12);
    // «cambia «A» por «B»»: A es lo que desaparece; «quita «X»»: X no se exige.
    if (/\s(?:por|a)\s*$/i.test(before) || !/^\s*(?:por|a)\s+[«“"]/i.test(after) && !NOT_WANTED.test(before)) out.push(m[1]!.trim());
  }
  return [...new Set(out)].filter((t) => t.length >= 3).slice(0, 6);
}

/**
 * Encargos del taller que siempre cambian archivos (su etiqueta), además de las reparaciones automáticas. «Construcción del
 * proyecto» NO está: su primera respuesta puede ser proponer las direcciones visuales y esperar a que el dueño elija.
 */
export const CHANGE_LABELS: ReadonlySet<string> = new Set([
  "Reparación automática", "Reparación de la compilación", "Arreglar pruebas", "Escribir pruebas",
  "Reparar una pantalla", "Arreglo de diseño", "Cambio visual", "Rutas con #",
]);

/** Las peticiones de reparación que manda la vista previa (su botón «Reparar») o la revisión del diseño. */
export const REPAIR_REQUEST = /^(?:La vista previa(?: de «[^»\n]{1,200}»)? no funciona bien|El proyecto no compila para la vista previa|Revisa y arregla estos problemas del proyecto)/;

/** ¿Tiene que cambiar archivos este encargo? (Una pregunta del dueño puede contestarse sin archivos: esas no se exigen.) */
export function mustChangeFiles(input: { label: string; text: string; repairAttempt?: number; testsAttempt?: number }): boolean {
  return Boolean(input.repairAttempt || input.testsAttempt) || CHANGE_LABELS.has(input.label) || REPAIR_REQUEST.test(input.text.trimStart());
}

// ------------------------------------------------------------------------------------------- una entrega que se ha cortado
/**
 * (25/09/2026) Una web completa no cabe en una sola respuesta de una IA gratuita: Gemini entregó 11 de 20 archivos y el último
 * cortado por la mitad (y se guardaba así). Aquí se detecta: un bloque de código sin cerrar al final (se quita, con su ruta,
 * para que NO se guarde a medias) y la línea «FALTAN: ruta1, ruta2» con la que la IA dice lo que no le ha cabido.
 */
export type CutDelivery = { text: string; cutPath: string | null; pending: string[] };
const PATH_RE = /(?:src|public|docs)\/[\w./@()[\]-]+\.[A-Za-z0-9]+|[\w-]+\.(?:json|html?|tsx?|jsx?|css|md|ts|js|svg)/g;

export function cutDelivery(text: string): CutDelivery {
  let out = text;
  let cutPath: string | null = null;
  const fences = text.match(/^```/gm)?.length ?? 0;
  if (fences % 2 === 1) {
    const at = text.lastIndexOf("\n```");
    const start = at >= 0 ? at + 1 : text.indexOf("```");
    const header = text.slice(start + 3, text.indexOf("\n", start) === -1 ? undefined : text.indexOf("\n", start)).trim();
    cutPath = header.match(PATH_RE)?.[0] ?? "(archivo sin ruta)";
    out = text.slice(0, start).trimEnd();
  }
  const m = /^(?:\*\*)?(?:FALTAN?|PENDIENTES? DE ENTREGAR|QUEDAN? POR ENTREGAR|CONTIN[UÚ]O CON)(?:\*\*)?\s*:\s*([^\n]+)/im.exec(out);
  const pending = m ? [...new Set(m[1]!.match(PATH_RE) ?? [])] : [];
  return { text: out, cutPath, pending };
}
