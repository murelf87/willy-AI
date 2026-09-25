// EDICIÓN VISUAL (rediseño, revisión 24 · fase 10; puntos 17 y 18). El dueño pulsa «Seleccionar elemento», toca algo de la
// vista previa (un botón, una imagen, un texto, el menú, una tarjeta…) y WILLY le pregunta «¿Qué quieres cambiar?». Por dentro,
// WILLY sabe exactamente qué es: su selector, su HTML, sus estilos de ahora y DÓNDE está en el código (archivo y línea, y las
// reglas de estilo que le afectan). Eso va a la IA; al dueño solo se le enseña en palabras de cualquiera («el botón
// «Reservar»»). Los detalles técnicos quedan para el modo avanzado (opcional). Lógica pura: se prueba aparte.

import type { GeneratedFile } from "@/lib/ai-standard";
import { resolveRef } from "@/lib/live-files";
import type { MonitorMessage } from "@/lib/preview-runtime";

export type PickedElement = {
  /** Qué es, en castellano: botón, enlace, imagen, icono, título, texto, campo, menú, cabecera, tarjeta, sección, bloque… */
  kind: string;
  /** Su texto visible (o su descripción: alt, placeholder, aria-label). */
  text: string;
  /** Selector CSS único (interno: para volver a encontrarlo y para la IA). */
  selector: string;
  /** Ruta con etiquetas y clases («header.top > nav.menu > a.btn»). */
  path: string;
  /** Dentro de qué está, en palabras («cabecera › menú»). */
  inside: string;
  tag: string;
  id: string;
  classes: string[];
  html: string;
  /** Sus estilos de ahora, resumidos (color, fondo, letra, tamaño, relleno…). */
  styles: string;
  box: { x: number; y: number; w: number; h: number };
  /** Ancho de la pantalla de la vista previa cuando se eligió. */
  width: number;
  page: string | null;
  route: string | null;
  device: string;
};

type ElementMessage = Extract<MonitorMessage, { tipo: "elemento" }>;

/** Lo que cuenta el vigía, como elemento elegido (con la página, la ruta y el tamaño en que se está viendo). */
export function pickedOf(m: ElementMessage, ctx: { page: string | null; route: string | null; device: string }): PickedElement {
  return {
    kind: m.clase || "bloque",
    text: m.texto,
    selector: m.selector,
    path: m.ruta,
    inside: m.dentro,
    tag: m.etiqueta,
    id: m.id,
    classes: m.clases.split(/\s+/).filter(Boolean).slice(0, 8),
    html: m.html,
    styles: m.estilos,
    box: { x: m.x, y: m.y, w: m.w, h: m.h },
    width: m.ancho,
    page: ctx.page,
    route: ctx.route,
    device: ctx.device,
  };
}

const FEMININE = new Set(["imagen", "cabecera", "lista", "tabla", "etiqueta", "sección", "tarjeta"]);

/** En palabras de cualquiera: «el botón «Reservar ahora»», «la imagen «Logo»», «el bloque». */
export function pickedLabel(p: Pick<PickedElement, "kind" | "text">): string {
  const article = FEMININE.has(p.kind) ? "la" : "el";
  const text = p.text.replace(/\s+/g, " ").trim();
  const short = text.length > 50 ? `${text.slice(0, 49)}…` : text;
  return `${article} ${p.kind}${short ? ` «${short}»` : ""}`;
}

/** Cambios rápidos que tienen sentido para lo que se ha elegido (el dueño puede escribir cualquier otra cosa). */
export function quickChanges(kind: string): string[] {
  switch (kind) {
    case "botón":
    case "enlace":
      return ["Hazlo más grande", "Hazlo más pequeño", "Cambia el color", "Cambia el texto", "Muévelo a la derecha", "Elimínalo"];
    case "imagen":
      return ["Hazla más grande", "Hazla más pequeña", "Pon otra imagen", "Redondea las esquinas", "Elimínala"];
    case "icono":
      return ["Quiero otro icono", "Hazlo más grande", "Cambia el color", "Elimínalo"];
    case "título":
    case "texto":
    case "etiqueta":
      return ["Cambia el texto", "Letra más grande", "Letra más pequeña", "Cambia el color", "Céntralo", "Elimínalo"];
    case "cabecera":
    case "menú":
      return ["Pon el menú a la izquierda", "Hazlo más elegante", "Cambia el color de fondo", "Que se quede fijo arriba"];
    case "campo":
    case "formulario":
      return ["Hazlo más grande", "Bordes más suaves", "Cambia el texto de ayuda", "Elimínalo"];
    case "tarjeta":
    case "sección":
    case "bloque":
    case "pie de página":
      return ["Más espacio alrededor", "Menos espacio", "Cambia el color de fondo", "Hazlo más elegante", "Muévelo más arriba", "Elimínalo"];
    default:
      return ["Hazlo más grande", "Hazlo más pequeño", "Cambia el color", "Elimínalo"];
  }
}

export type SourceHit = {
  file: string;
  line: number;
  /** Qué se ha encontrado ahí: la etiqueta del elemento, su texto, una regla de estilo que le afecta o el script que lo crea. */
  why: "etiqueta" | "texto" | "estilos" | "script";
  /** La regla de estilo («.btn-primary»), cuando es de estilos. */
  detail?: string;
};

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/^\.?\//, "");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lineAt = (content: string, index: number): number => content.slice(0, Math.max(0, index)).split("\n").length;

/** Un texto como expresión regular que admite cualquier espacio o salto de línea entre palabras (como se escribe en el HTML). */
function textPattern(text: string, max = 30): RegExp | null {
  const words = text.replace(/[«»"“”…]/g, " ").trim().split(/\s+/).filter(Boolean);
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max && out) break;
    out = next;
  }
  if (out.replace(/\s/g, "").length < 3) return null;
  return new RegExp(out.split(" ").map(escapeRe).join("(?:\\s|&nbsp;|<[^>]{0,80}>)+"), "i");
}

/** Hojas de estilo y scripts que enlaza la página (resueltos desde su carpeta). */
function linkedFiles(files: GeneratedFile[], page: GeneratedFile): { css: GeneratedFile[]; js: GeneratedFile[] } {
  const find = (ref: string) => {
    const target = resolveRef(page.path, ref);
    return files.find((f) => norm(f.path) === target) ?? files.find((f) => norm(f.path).endsWith(`/${norm(ref)}`) || norm(f.path) === norm(ref));
  };
  const css: GeneratedFile[] = [];
  const js: GeneratedFile[] = [];
  for (const m of page.content.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["']?stylesheet/i.test(m[0])) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    const f = href ? find(href) : undefined;
    if (f && /\.css$/i.test(f.path) && !css.includes(f)) css.push(f);
  }
  for (const m of page.content.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const f = find(m[1]!);
    if (f && /\.(?:m?js)$/i.test(f.path) && !js.includes(f)) js.push(f);
  }
  return { css, js };
}

/**
 * DÓNDE está en el código (rediseño, punto 17: «source mapping»). En la página: por su id, por su etiqueta con sus clases (y su
 * texto cerca) o por su texto. Si no está en el HTML, en los scripts (lo crea un script). Y las reglas de estilo que le afectan
 * (por su id o sus clases) en las hojas de estilo enlazadas y en los <style> de la página. Como mucho 5 sitios.
 */
export function locateElement(files: GeneratedFile[], page: string | null, p: Pick<PickedElement, "id" | "classes" | "tag" | "text" | "html">): SourceHit[] {
  const pageFile = page ? files.find((f) => norm(f.path) === norm(page)) : undefined;
  if (!pageFile) return [];
  const hits: SourceHit[] = [];
  const textRe = p.text ? textPattern(p.text) : null;
  const isHtml = /\.html?$/i.test(pageFile.path);
  // Rev25: en un proyecto React/Vite (compilado), la «página» es su entrada (src/main.tsx): el elemento está en sus
  // componentes (.tsx/.jsx), con «className» en vez de «class».
  const codeFiles = files.filter((f) => /\.(?:tsx|jsx|ts|js|mjs)$/i.test(f.path));
  const markupFiles = isHtml ? [pageFile] : [pageFile, ...codeFiles.filter((f) => f !== pageFile)];

  // 1) La etiqueta: por su id, por su etiqueta con sus clases (y su texto dentro) o por su texto.
  let best: { file: GeneratedFile; index: number; score: number; why: SourceHit["why"] } | null = null;
  for (const file of markupFiles) {
    const content = file.content;
    // En una página HTML, lo que está dentro de sus <script> no cuenta como etiqueta (lo crea el script); se deja con espacios
    // para que las posiciones sigan valiendo.
    const markupText = /\.html?$/i.test(file.path) ? content.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_s, a: string, body: string, c: string) => `${a}${body.replace(/[^\n]/g, " ")}${c}`) : content;
    if (p.id) {
      const m = new RegExp(`\\bid\\s*=\\s*(?:\\{\\s*)?["'\`]?${escapeRe(p.id)}(?=["'\`\\s>/}])`, "i").exec(markupText);
      if (m && (best?.score ?? 0) < 10) best = { file, index: m.index, score: 10, why: "etiqueta" };
    }
    if (p.tag && /^[a-z][a-z0-9-]*$/i.test(p.tag)) {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(p.html)?.[1];
      const lower = markupText.toLowerCase();
      for (const m of markupText.matchAll(new RegExp(`<${escapeRe(p.tag)}\\b[^>]*>`, "gi"))) {
        const tag = m[0];
        const start = m.index!;
        const cls = /\b(?:class|className)\s*=\s*\{?\s*["'`]([^"'`]*)["'`]/i.exec(tag)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
        let score = 0;
        if (p.classes.length && p.classes.every((c) => cls.includes(c))) score += 3;
        else if (p.classes.some((c) => cls.includes(c))) score += 1;
        if (src && tag.includes(src)) score += 3;
        // Su texto, DENTRO de este elemento (hasta su cierre), no el de otro que venga detrás.
        const close = lower.indexOf(`</${p.tag.toLowerCase()}`, start + tag.length);
        const inner = markupText.slice(start, close >= 0 && close - start < 2000 ? close : start + tag.length + 300);
        if (textRe && textRe.test(inner)) score += 2;
        if (score >= 2 && score > (best?.score ?? 0)) best = { file, index: start, score, why: "etiqueta" };
      }
    }
    if (!best && textRe) {
      const m = textRe.exec(markupText);
      if (m) best = { file, index: m.index, score: 1, why: "texto" };
    }
  }
  if (best) hits.push({ file: best.file.path, line: lineAt(best.file.content, best.index), why: best.why });

  const content = pageFile.content;
  const { css, js } = isHtml ? linkedFiles(files, pageFile) : { css: files.filter((f) => /\.css$/i.test(f.path)), js: [] as GeneratedFile[] };
  // 2) Si no está en el HTML de la página: el script que lo crea (el de la página o uno enlazado).
  if (!best && isHtml) {
    const needles = [textRe, ...p.classes.slice(0, 2).map((c) => new RegExp(`["'\\s.]${escapeRe(c)}(?![\\w-])`))].filter((r): r is RegExp => Boolean(r));
    // Los <script> de la propia página y los scripts que enlaza.
    const scripts: Array<{ file: GeneratedFile; text: string; offset: number }> = [
      ...[...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => ({ file: pageFile, text: m[1] ?? "", offset: m.index! + m[0].indexOf(">") + 1 })),
      ...js.map((f) => ({ file: f, text: f.content, offset: 0 })),
    ];
    outer: for (const re of needles) {
      for (const s of scripts) {
        const m = re.exec(s.text);
        if (m) { hits.push({ file: s.file.path, line: lineAt(s.file.content, s.offset + m.index), why: "script" }); break outer; }
      }
    }
  }

  // 3) Las reglas de estilo que le afectan (por su id o sus clases).
  const selectors = [...(p.id ? [`#${p.id}`] : []), ...p.classes.slice(0, 4).map((c) => `.${c}`)];
  const sheets: Array<{ file: GeneratedFile; text: string; offset: number }> = [
    ...css.map((f) => ({ file: f, text: f.content, offset: 0 })),
    ...(isHtml ? [...content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => ({ file: pageFile, text: m[1] ?? "", offset: m.index! + m[0].indexOf(m[1] ?? "") })) : []),
  ];
  for (const sel of selectors) {
    if (hits.filter((h) => h.why === "estilos").length >= 3) break;
    const re = new RegExp(`(^|[\\s,>+~(}])${escapeRe(sel)}(?![\\w-])[^{};]*\\{`, "m");
    for (const sheet of sheets) {
      const m = re.exec(sheet.text);
      if (!m) continue;
      const at = sheet.offset + m.index + (m[1]?.length ?? 0);
      hits.push({ file: sheet.file.path, line: lineAt(sheet.file.content, at), why: "estilos", detail: sel });
      break;
    }
  }
  const seen = new Set<string>();
  return hits.filter((h) => { const k = `${h.file}:${h.line}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);
}

const WHY: Record<SourceHit["why"], string> = { etiqueta: "su etiqueta", texto: "su texto", estilos: "estilos", script: "lo crea este script" };
const DEVICE_TEXT: Record<string, string> = { ordenador: "ordenador", tablet: "tableta", movil: "móvil" };

/** Dónde está, en una línea (para la IA): «index.html línea 12 (su etiqueta); css/estilo.css línea 4 (estilos .btn)». */
export function hitsLine(hits: SourceHit[]): string {
  return hits.map((h) => `${h.file} línea ${h.line} (${WHY[h.why]}${h.detail ? ` ${h.detail}` : ""})`).join("; ");
}

/** Lo que la IA sabe del elemento elegido (interno: al dueño no se le enseña salvo en el modo avanzado). */
export function elementContext(p: PickedElement, hits: SourceHit[]): string {
  const size = `${DEVICE_TEXT[p.device] ?? p.device}${p.width ? ` (${p.width} px de ancho)` : ""}`;
  return [
    "ELEMENTO ELEGIDO EN LA VISTA PREVIA (el dueño lo ha tocado; cuando dice «esto», «este botón», «aquí», «ponlo…» o «elimínalo», es ESTE elemento):",
    `- Qué es: ${pickedLabel(p)}${p.inside ? ` (dentro de: ${p.inside})` : ""}`,
    `- Dónde: página ${p.page ?? "(sin nombre)"}${p.route ? `, ruta «${p.route}»` : ""}; lo ha elegido viéndolo en ${size}`,
    `- Selector CSS: ${p.selector}${p.path && p.path !== p.selector ? ` · ruta: ${p.path}` : ""}`,
    `- HTML: ${p.html}`,
    `- Estilos que tiene ahora: ${p.styles}`,
    `- En el código: ${hits.length ? hitsLine(hits) : "no aparece tal cual en los archivos (puede que lo cree un script al arrancar)"}`,
    "Cambia SOLO este elemento (y lo imprescindible para que encaje), sin tocar el resto del diseño; si el cambio afecta a otros tamaños de pantalla, que se siga viendo bien en móvil, tableta y ordenador. Entrega los archivos que cambies COMPLETOS.",
  ].join("\n");
}

/**
 * La petición a SUPER WILLY desde «¿Qué quieres cambiar?»: lo que ve el dueño en el chat («Hazlo más pequeño · en el botón
 * «Reservar»») y lo que recibe la IA (el deseo y a qué se refiere; los detalles técnicos van en el contexto visual).
 */
export function visualEditRequest(p: PickedElement, wish: string): { text: string; ownerText: string } {
  const w = wish.replace(/\s+/g, " ").trim();
  const label = pickedLabel(p);
  // «a el botón» → «al botón».
  const target = label.startsWith("el ") ? `al ${label.slice(3)}` : `a ${label}`;
  return {
    text: `${w}\n\n(Se refiere ${target}, que ha elegido en la vista previa${p.page ? ` de «${p.page}»` : ""}: sus detalles están en «ELEMENTO ELEGIDO EN LA VISTA PREVIA».)`,
    ownerText: `${w} · en ${label}`,
  };
}

/** Los detalles técnicos, para el modo avanzado (opcional): selector, ruta, HTML, estilos y dónde está en el código. */
export function technicalDetails(p: PickedElement, hits: SourceHit[]): Array<[string, string]> {
  return [
    ["Selector", p.selector],
    ...(p.path && p.path !== p.selector ? [["Ruta", p.path] as [string, string]] : []),
    ["HTML", p.html],
    ["Estilos", p.styles],
    ["En el código", hits.length ? hitsLine(hits) : "no aparece tal cual (lo creará un script)"],
  ];
}
