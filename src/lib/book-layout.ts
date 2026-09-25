// Maquetación del libro. Paginador PROPIO: el texto se reparte en páginas reales del tamaño elegido (con márgenes de encuadernación,
// cabecera, número de página, capítulos que abren en página impar, índice con sus páginas), así la vista previa es lo que se imprime
// y sale igual en cualquier navegador (los encabezados de @page no funcionan en Firefox). El EPUB se genera aparte, sin páginas fijas.

export type Trim = "a5" | "6x9" | "5.5x8.5" | "5x8";
export const TRIMS: Record<Trim, { label: string; w: number; h: number; inner: number; outer: number; top: number; bottom: number }> = {
  a5: { label: "A5 (148 × 210 mm)", w: 148, h: 210, inner: 20, outer: 15, top: 20, bottom: 22 },
  "6x9": { label: "6 × 9 pulgadas (152 × 229 mm)", w: 152.4, h: 228.6, inner: 22, outer: 16, top: 20, bottom: 22 },
  "5.5x8.5": { label: "5,5 × 8,5 pulgadas (140 × 216 mm)", w: 139.7, h: 215.9, inner: 20, outer: 15, top: 19, bottom: 21 },
  "5x8": { label: "5 × 8 pulgadas (127 × 203 mm)", w: 127, h: 203.2, inner: 18, outer: 13, top: 17, bottom: 19 },
};
export type FontId = "georgia" | "palatino" | "times";
export const FONTS: Record<FontId, { label: string; stack: string }> = {
  georgia: { label: "Georgia", stack: 'Georgia, "Times New Roman", serif' },
  palatino: { label: "Palatino", stack: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif' },
  times: { label: "Times", stack: '"Times New Roman", Times, serif' },
};
export type LayoutOptions = { trim: Trim; font: FontId; sizePt: number; lineHeight: number; indent: boolean; dropCap: boolean; justify: boolean; aiNote: boolean };
export const DEFAULT_LAYOUT: LayoutOptions = { trim: "6x9", font: "georgia", sizePt: 11, lineHeight: 1.45, indent: true, dropCap: true, justify: true, aiNote: true };

import { readableOn } from "@/lib/image-info";

export const mmToPx = (mm: number): number => (mm * 96) / 25.4;

// ------------------------------------------------------------------------------------------------ Markdown → bloques
export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function inline(text: string): string {
  let s = esc(text).replace(/\.\.\./g, "…");
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w_])_([^_\n]+?)_(?![\w_])/g, "$1<em>$2</em>");
  return s;
}

export type Block = { t: "p" | "quote" | "h" | "hr" | "ul" | "ol" | "toc" | "raw"; text?: string; items?: string[]; html?: string; cls?: string; page?: string };

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  const flush = () => {
    if (para.length) { blocks.push({ t: "p", text: para.join(" ").replace(/\s+/g, " ").trim() }); para = []; }
    if (list) { blocks.push({ t: list.t, items: list.items }); list = null; }
    if (quote.length) { blocks.push({ t: "quote", text: quote.join(" ").replace(/\s+/g, " ").trim() }); quote = []; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) { flush(); blocks.push({ t: "hr" }); continue; }
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (h) { flush(); blocks.push({ t: "h", text: h[1]! }); continue; }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) { if (para.length || list) flush(); quote.push(q[1]!); continue; }
    const li = /^\s*([-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (li) {
      const t = /\d/.test(li[1]!) ? "ol" : "ul";
      if (para.length || quote.length) flush();
      if (list && list.t !== t) flush();
      list = list ?? { t, items: [] };
      list.items.push(li[2]!.trim());
      continue;
    }
    if (quote.length || list) flush();
    para.push(line.trim());
  }
  flush();
  return blocks;
}

export function renderBlock(b: Block): string {
  switch (b.t) {
    case "p": return `<p${b.cls ? ` class="${b.cls}"` : ""}>${inline(b.text ?? "")}</p>`;
    case "quote": return `<blockquote><p>${inline(b.text ?? "")}</p></blockquote>`;
    case "h": return `<h3>${inline(b.text ?? "")}</h3>`;
    case "hr": return `<p class="scene">* * *</p>`;
    case "ul": case "ol": return `<${b.t}>${(b.items ?? []).map((i) => `<li>${inline(i)}</li>`).join("")}</${b.t}>`;
    case "toc": return `<div class="toc-row"><span class="t">${esc(b.text ?? "")}</span><span class="d"></span><span class="n">${esc(b.page ?? "")}</span></div>`;
    default: return b.html ?? "";
  }
}

/** Si se parte un párrafo dentro de una negrita o cursiva, se cierra en la primera parte y se reabre en la segunda. */
function balance(a: string, b: string): [string, string] {
  let x = a, y = b;
  if ((x.match(/\*\*/g) ?? []).length % 2) { x += "**"; y = `**${y}`; }
  const single = (s: string) => (s.replace(/\*\*/g, "").match(/\*/g) ?? []).length % 2;
  if (single(x)) { x += "*"; y = `*${y}`; }
  return [x, y];
}

// ------------------------------------------------------------------------------------------------ el libro como secciones
export type BookInput = { title: string; subtitle: string; author: string; language: string; year: number; dedication: string; acknowledgements: string; about: string; prologue: string; epilogue: string; blurb: string; chapters: Array<{ title: string; text: string }>; authorPhoto?: { url: string; w: number; h: number } | null };
export type SectionKind = "half" | "title" | "copyright" | "dedication" | "toc" | "prologue" | "chapter" | "epilogue" | "ack" | "about";
export type Section = { id: string; kind: SectionKind; title: string; label: string; blocks: Block[]; recto: boolean; body: boolean };

const raw = (html: string): Block => ({ t: "raw", html });

export function buildSections(input: BookInput, opts: LayoutOptions, labels: Map<string, string> = new Map()): Section[] {
  const out: Section[] = [];
  const title = input.title.trim() || "Sin título";
  out.push({ id: "half", kind: "half", title, label: "", recto: true, body: false, blocks: [raw(`<div class="half">${esc(title)}</div>`)] });
  out.push({ id: "title", kind: "title", title, label: "", recto: true, body: false, blocks: [raw(`<div class="titlepage"><h1>${esc(title)}</h1>${input.subtitle.trim() ? `<p class="sub">${esc(input.subtitle.trim())}</p>` : ""}<p class="aut">${esc(input.author.trim())}</p></div>`)] });
  const legal = [`© ${input.year} ${esc(input.author.trim() || "El autor")}`, "Todos los derechos reservados. Queda prohibida la reproducción total o parcial de esta obra sin permiso del titular de los derechos.", `Primera edición: ${input.year}`];
  if (opts.aiNote) legal.push("Obra creada con la ayuda de herramientas de inteligencia artificial.");
  out.push({ id: "copyright", kind: "copyright", title: "Créditos", label: "", recto: false, body: false, blocks: [raw(`<div class="legal">${legal.map((l) => `<p>${l}</p>`).join("")}</div>`)] });
  if (input.dedication.trim()) out.push({ id: "dedication", kind: "dedication", title: "Dedicatoria", label: "", recto: true, body: false, blocks: [raw(`<div class="dedication">${input.dedication.trim().split(/\n+/).map((l) => `<p>${inline(l)}</p>`).join("")}</div>`)] });
  const entries: Array<{ id: string; title: string }> = [];
  const body: Section[] = [];
  const add = (id: string, kind: SectionKind, sectionTitle: string, label: string, md: string) => {
    body.push({ id, kind, title: sectionTitle, label, recto: true, body: true, blocks: parseMarkdown(md) });
    entries.push({ id, title: label ? `${label}. ${sectionTitle}` : sectionTitle });
  };
  if (input.prologue.trim()) add("prologue", "prologue", "Prólogo", "", input.prologue);
  input.chapters.forEach((c, i) => add(`ch${i + 1}`, "chapter", c.title.trim() || `Capítulo ${i + 1}`, `Capítulo ${i + 1}`, c.text));
  if (input.epilogue.trim()) add("epilogue", "epilogue", "Epílogo", "", input.epilogue);
  if (input.acknowledgements.trim()) add("ack", "ack", "Agradecimientos", "", input.acknowledgements);
  if (input.about.trim()) {
    add("about", "about", "Sobre el autor", "", input.about);
    const photo = input.authorPhoto;
    if (photo && photo.w > 0 && photo.h > 0) { const mmW = 34; body[body.length - 1]!.blocks.unshift(raw(`<div class="authorphoto"><img src="${esc(photo.url)}" alt="" style="width:${mmW}mm;height:${(mmW * photo.h / photo.w).toFixed(1)}mm"></div>`)); }
  }
  out.push({ id: "toc", kind: "toc", title: "Índice", label: "", recto: true, body: false, blocks: entries.map((e) => ({ t: "toc" as const, text: e.title, page: labels.get(e.id) ?? "00" })) });
  return [...out, ...body];
}

const headHtml = (s: Section): string => (s.kind === "chapter" ? `<div class="ch-open"><div class="ch-num">${esc(s.label)}</div><h2 class="ch-title">${esc(s.title)}</h2></div>` : ["prologue", "epilogue", "ack", "about", "toc"].includes(s.kind) ? `<div class="ch-open"><h2 class="ch-title">${esc(s.title)}</h2></div>` : "");

// ------------------------------------------------------------------------------------------------ paginador
export type Page = { html: string; kind: SectionKind | "blank"; sectionId: string; sectionTitle: string; opens: boolean; label: string; head: string; blank: boolean };
export type Fits = (html: string) => boolean;

export function paginate(sections: Section[], fits: Fits, author: string): { pages: Page[]; starts: Map<string, number> } {
  const pages: Page[] = [];
  const starts = new Map<string, number>();
  const push = (s: Section | null, html: string, opens: boolean) => pages.push({ html, kind: s ? s.kind : "blank", sectionId: s?.id ?? "", sectionTitle: s?.title ?? "", opens, label: "", head: "", blank: !s });
  for (const s of sections) {
    if (s.recto && pages.length % 2 === 1) push(null, "", false);
    starts.set(s.id, pages.length);
    let cur = headHtml(s);
    let placed = false;
    let opens = true;
    const flush = () => { push(s, cur, opens); cur = ""; placed = false; opens = false; };
    const queue = s.blocks.map((b, i) => ({ b, i }));
    let guard = 0;
    while (queue.length) {
      if (++guard > 200_000) throw new Error("La maquetación no avanza (revisa el tamaño de página y de letra).");
      const { b, i } = queue[0]!;
      const html = renderBlock(b);
      // un subtítulo no se queda solo al final de una página
      if (b.t === "h" && placed) {
        const next = queue[1]?.b;
        const probe = next && next.t === "p" ? renderBlock({ ...next, text: (next.text ?? "").split(" ").slice(0, 14).join(" ") }) : "";
        if (!fits(cur + html + probe)) { flush(); continue; }
      }
      if (fits(cur + html)) { cur += html; placed = true; queue.shift(); continue; }
      if ((b.t === "p" || b.t === "quote") && b.text) {
        const words = b.text.split(" ");
        let lo = 1, hi = words.length - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const piece = balance(words.slice(0, mid).join(" "), "")[0];
          if (fits(cur + renderBlock({ ...b, text: piece }))) { best = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (best === 0) {
          if (!placed) { // ni una palabra cabe en una página vacía: se fuerza para no quedarse atascado
            const [a, rest] = balance(words[0]!, words.slice(1).join(" "));
            cur += renderBlock({ ...b, text: a }); placed = true; queue.shift();
            if (rest.trim()) queue.unshift({ b: { ...b, text: rest, cls: "cont" }, i });
          }
          flush(); continue;
        }
        const [first, rest] = balance(words.slice(0, best).join(" "), words.slice(best).join(" "));
        cur += renderBlock({ ...b, text: first }); placed = true;
        queue.shift();
        queue.unshift({ b: { ...b, text: rest, cls: "cont" }, i });
        flush();
        continue;
      }
      if ((b.t === "ul" || b.t === "ol") && b.items && b.items.length > 1) {
        let k = 0;
        for (let n = 1; n < b.items.length; n++) { if (fits(cur + renderBlock({ ...b, items: b.items.slice(0, n) }))) k = n; else break; }
        if (k > 0) { cur += renderBlock({ ...b, items: b.items.slice(0, k) }); placed = true; queue.shift(); queue.unshift({ b: { ...b, items: b.items.slice(k) }, i }); flush(); continue; }
      }
      if (!placed) { cur += html; placed = true; queue.shift(); continue; } // bloque que no cabe ni solo: se coloca igualmente
      flush();
    }
    if (placed || opens) flush();
  }
  // numeración: los preliminares no llevan número; el cuerpo empieza en 1
  const firstBody = sections.find((s) => s.body);
  const bodyStart = firstBody ? (starts.get(firstBody.id) ?? 0) : pages.length;
  pages.forEach((p, idx) => {
    if (p.blank || idx < bodyStart) return;
    p.label = String(idx - bodyStart + 1);
    p.head = p.opens ? "" : idx % 2 === 1 ? author.trim() : p.sectionTitle;
  });
  return { pages, starts };
}

/** Maqueta el libro completo. El índice lleva los números de página REALES (se calcula en dos pasadas). */
export function layoutBook(input: BookInput, opts: LayoutOptions, fits: Fits): { pages: Page[]; sections: Section[]; tocLabels: Map<string, string> } {
  let labels = new Map<string, string>();
  let result = { pages: [] as Page[], starts: new Map<string, number>() };
  let sections: Section[] = [];
  for (let pass = 0; pass < 4; pass++) {
    sections = buildSections(input, opts, labels);
    result = paginate(sections, fits, input.author);
    const next = new Map<string, string>();
    for (const s of sections) if (s.body) next.set(s.id, result.pages[result.starts.get(s.id) ?? 0]?.label ?? "");
    const same = [...next].every(([k, v]) => labels.get(k) === v);
    labels = next;
    if (same) break;
  }
  return { pages: result.pages, sections, tocLabels: labels };
}

// ------------------------------------------------------------------------------------------------ HTML / CSS
export function bookCss(opts: LayoutOptions): string {
  const t = TRIMS[opts.trim];
  const cw = t.w - t.inner - t.outer, ch = t.h - t.top - t.bottom;
  return `
@page{size:${t.w}mm ${t.h}mm;margin:0}
.bk-page{position:relative;width:${t.w}mm;height:${t.h}mm;background:#fff;color:#111;overflow:hidden;box-sizing:border-box;font-family:${FONTS[opts.font].stack};font-size:${opts.sizePt}pt;line-height:${opts.lineHeight};break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bk-inner{position:absolute;top:${t.top}mm;width:${cw}mm;height:${ch}mm;overflow:hidden}
.bk-page.recto .bk-inner,.bk-page.recto .bk-head,.bk-page.recto .bk-foot{left:${t.inner}mm}
.bk-page.verso .bk-inner,.bk-page.verso .bk-head,.bk-page.verso .bk-foot{left:${t.outer}mm}
.bk-head,.bk-foot{position:absolute;width:${cw}mm;text-align:center;font-size:${Math.max(7, opts.sizePt - 2.5)}pt;color:#555}
.bk-head{top:${(t.top * 0.42).toFixed(1)}mm;letter-spacing:.08em;text-transform:uppercase;line-height:1.2}
.bk-foot{bottom:${(t.bottom * 0.38).toFixed(1)}mm;line-height:1.2}
.bk-inner p{margin:0;text-align:${opts.justify ? "justify" : "left"};hyphens:auto;-webkit-hyphens:auto;orphans:2;widows:2;${opts.indent ? "text-indent:1.3em" : "margin-bottom:.6em"}}
.bk-inner p.first,.bk-inner p.cont,.bk-inner .ch-open + p,.bk-inner h3 + p,.bk-inner p.scene + p{text-indent:0}
.bk-inner p.scene{text-align:center;text-indent:0;margin:1.1em 0;letter-spacing:.3em}
.bk-inner h3{font-size:1.1em;margin:1.2em 0 .5em;text-align:left;font-weight:bold;break-after:avoid}
.bk-inner blockquote{margin:.9em 1.6em;font-style:italic}
.bk-inner blockquote p{text-indent:0}
.bk-inner ul,.bk-inner ol{margin:.6em 0 .6em 1.4em;padding:0}
.bk-inner li{margin:0 0 .25em}
.bk-inner .ch-open{text-align:center;padding-top:16%;margin-bottom:2.2em}
.bk-inner .ch-num{font-size:.85em;letter-spacing:.25em;text-transform:uppercase;color:#666;margin-bottom:.4em}
.bk-inner .ch-title{font-size:1.9em;font-weight:normal;margin:0;line-height:1.15}
${opts.dropCap ? ".bk-inner .ch-open + p::first-letter{float:left;font-size:3.3em;line-height:.82;padding:.06em .08em 0 0}" : ""}
.bk-inner .half{text-align:center;padding-top:32%;font-size:1.5em;letter-spacing:.06em}
.bk-inner .titlepage{text-align:center;padding-top:26%}
.bk-inner .titlepage h1{font-size:2.4em;font-weight:normal;margin:0 0 .4em;line-height:1.15}
.bk-inner .titlepage .sub{font-style:italic;font-size:1.15em;text-indent:0;text-align:center;margin:0 0 3em}
.bk-inner .titlepage .aut{letter-spacing:.15em;text-transform:uppercase;text-indent:0;text-align:center;margin:0}
.bk-inner .legal{padding-top:55%;font-size:.8em;color:#333}
.bk-inner .legal p{text-indent:0;text-align:left;margin:0 0 .6em}
.bk-inner .dedication{padding-top:32%;text-align:center;font-style:italic}
.bk-inner .dedication p{text-align:center;text-indent:0}
.bk-inner .toc-row{display:flex;align-items:baseline;gap:.4em;margin:0 0 .55em}
.bk-inner .toc-row .t{flex:0 1 auto}
.bk-inner .toc-row .d{flex:1 1 auto;border-bottom:1px dotted #999;transform:translateY(-.25em)}
.bk-inner .toc-row .n{flex:0 0 auto;font-variant-numeric:tabular-nums}
.bk-cover{padding:0}.bk-cover img{display:block;width:100%;height:100%;object-fit:cover}
.bk-back{background:#111;color:#f3f3f3}
.bk-back .bk-bgimg{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:block}
.bk-back .bk-ov{position:absolute;left:0;top:0;right:0;bottom:0;background:#000}
.bk-back .bk-backin{position:absolute;left:15mm;right:15mm;top:18mm;bottom:15mm;display:flex;flex-direction:column;gap:5mm;font-size:.95em}
.bk-back .bk-blurb p{margin:0 0 .7em;text-indent:0;text-align:left;line-height:1.5}
.bk-back .bk-quote{font-style:italic;border-left:2px solid currentColor;padding-left:4mm;opacity:.92}
.bk-back .bk-bio{display:flex;gap:4mm;align-items:center;font-size:.82em;margin-top:auto}
.bk-back .bk-bio img{width:22mm;height:22mm;border-radius:50%;object-fit:cover;flex:none;display:block}
.bk-back .bk-bio p{margin:0;text-indent:0;text-align:left}
.bk-back .bk-base{display:flex;justify-content:space-between;align-items:flex-end;gap:4mm;font-size:.8em}
.bk-back .bk-barcode{width:51mm;height:30mm;background:#fff;color:#888;font-size:7pt;display:flex;align-items:center;justify-content:center;text-align:center;flex:none;line-height:1.2}
.bk-spine{position:relative;flex:none;overflow:hidden;display:flex;align-items:center;justify-content:center}
.bk-spine span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-size:11pt;letter-spacing:.06em}
.bk-wrap{display:flex;align-items:stretch;box-shadow:0 2px 12px rgba(0,0,0,.25)}
.bk-wrap .bk-page{margin:0!important;box-shadow:none!important}
.bk-cover-fallback{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;padding:14mm;box-sizing:border-box;font-size:20pt;line-height:1.2}
.bk-inner .authorphoto{text-align:center;margin:0 0 6mm}
.bk-inner .authorphoto img{display:inline-block;border-radius:50%;object-fit:cover}
`;
}

export function pageHtml(p: Page, idx: number): string {
  const side = idx % 2 === 0 ? "recto" : "verso";
  if (p.blank) return `<section class="bk-page ${side}"></section>`;
  return `<section class="bk-page ${side}" data-kind="${p.kind}"><div class="bk-head">${esc(p.head)}</div><div class="bk-inner" lang="es">${p.html}</div><div class="bk-foot">${esc(p.label)}</div></section>`;
}

/** Portada y contraportada como páginas de la maqueta. */
export function coverPage(coverUrl: string | null): string {
  return coverUrl ? `<section class="bk-page bk-cover recto"><img src="${esc(coverUrl)}" alt="Portada"></section>` : "";
}
export type BackCover = { blurb: string; bio: string; quote: string; price: string; isbn: string; bgColor: string; bgImage: string | null; overlay: number; barcode: boolean; photo: string | null };
export const DEFAULT_BACK: BackCover = { blurb: "", bio: "", quote: "", price: "", isbn: "", bgColor: "#111111", bgImage: null, overlay: 0.45, barcode: true, photo: null };

const paras = (text: string): string => text.trim().split(/\n{2,}/).filter(Boolean).map((p) => `<p>${inline(p.replace(/\n/g, " "))}</p>`).join("");

/** Contraportada: sinopsis, cita, biografía con foto, precio/ISBN y la zona del código de barras. Acepta un texto (solo sinopsis). */
export function backPage(input: string | BackCover): string {
  const b: BackCover = typeof input === "string" ? { ...DEFAULT_BACK, blurb: input, barcode: false } : input;
  const empty = !b.blurb.trim() && !b.bio.trim() && !b.quote.trim() && !b.bgImage && !b.barcode && !b.price.trim() && !b.isbn.trim();
  if (empty) return "";
  const fg = b.bgImage ? "#ffffff" : readableOn(b.bgColor);
  const base = [b.price.trim() && `<span>${esc(b.price.trim())}</span>`, b.isbn.trim() && `<span>ISBN ${esc(b.isbn.trim())}</span>`].filter(Boolean).join("");
  return `<section class="bk-page bk-back verso" style="background:${esc(b.bgColor)};color:${fg}">${b.bgImage ? `<img class="bk-bgimg" src="${esc(b.bgImage)}" alt=""><div class="bk-ov" style="opacity:${Math.min(0.85, Math.max(0, b.overlay))}"></div>` : ""}<div class="bk-backin" lang="es" style="color:${fg}">${b.blurb.trim() ? `<div class="bk-blurb">${paras(b.blurb)}</div>` : ""}${b.quote.trim() ? `<div class="bk-quote">${inline(b.quote.trim())}</div>` : ""}${b.bio.trim() || b.photo ? `<div class="bk-bio">${b.photo ? `<img src="${esc(b.photo)}" alt="">` : ""}${b.bio.trim() ? `<p>${inline(b.bio.trim())}</p>` : ""}</div>` : ""}${base || b.barcode ? `<div class="bk-base"><div>${base}</div>${b.barcode ? `<div class="bk-barcode">Zona del código de barras<br>(lo añade la imprenta)</div>` : ""}</div>` : ""}</div></section>`;
}

export function spineHtml(title: string, author: string, widthMm: number, bg: string, fg: string, heightMm: number): string {
  const text = widthMm >= 6 ? `<span>${esc(title)}${author.trim() ? ` — ${esc(author.trim())}` : ""}</span>` : "";
  return `<div class="bk-spine" style="width:${widthMm}mm;height:${heightMm}mm;background:${esc(bg)};color:${fg}">${text}</div>`;
}

/** Cubierta completa de un vistazo: contraportada · lomo · portada, con el tamaño real de la maqueta. */
export function coverSpreadHtml(o: { front: string | null; back: BackCover | string; spineMm: number; title: string; author: string; opts: LayoutOptions; frontBg?: string }): string {
  const t = TRIMS[o.opts.trim];
  const back = backPage(o.back) || `<section class="bk-page bk-back verso" style="background:#111"></section>`;
  const bg = typeof o.back === "string" ? "#111111" : o.back.bgColor;
  const fallback = `<section class="bk-page bk-cover recto" style="background:${esc(o.frontBg ?? "#1b1030")};color:#fff"><div class="bk-cover-fallback">${esc(o.title || "Título del libro")}</div></section>`;
  return `<div class="bk-wrap">${back}${spineHtml(o.title, o.author, o.spineMm, bg, readableOn(bg), t.h)}${coverPage(o.front) || fallback}</div>`;
}

/** Documento HTML completo para imprimir/guardar como PDF: portada + páginas + contraportada, cada una del tamaño exacto. */
export function fullDocument(pages: Page[], opts: LayoutOptions, title: string, coverUrl: string | null, blurb: string | BackCover): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title || "Libro")}</title><style>${bookCss(opts)}body{margin:0;background:#e9e9ee}@media screen{.bk-page{margin:16px auto;box-shadow:0 2px 12px rgba(0,0,0,.25)}}@media print{body{background:#fff}.bk-page{margin:0;box-shadow:none}}</style></head><body>${coverPage(coverUrl)}${pages.map(pageHtml).join("")}${backPage(blurb)}</body></html>`;
}

// ------------------------------------------------------------------------------------------------ ZIP (para el EPUB)
const CRC = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function makeZip(files: Array<{ name: string; data: Uint8Array; store?: boolean }>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const dosTime = 0, dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const packed = f.store ? f.data : await deflateRaw(f.data);
    const method = f.store ? 0 : 8;
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, method, true); lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, packed.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, method, true); cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, packed.length, true); cv.setUint32(24, f.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, packed); central.push(cen);
    offset += local.length + packed.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

// ------------------------------------------------------------------------------------------------ EPUB
export type CoverImage = { bytes: Uint8Array; mime: string };
const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.w3.org/2001/10/epub" lang="es" xml:lang="es"><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
const EPUB_CSS = `body{font-family:serif;line-height:1.5;margin:5%}p{margin:0;text-align:justify;text-indent:1.3em}p.first,p.cont,h1+p,h2+p,h3+p,p.scene+p{text-indent:0}h1,h2{text-align:center;font-weight:normal}h2.ch-title{margin:2.5em 0 1.5em;font-size:1.6em}.ch-num{text-align:center;text-transform:uppercase;letter-spacing:.2em;font-size:.8em;margin-top:3em}h3{font-size:1.1em;margin:1.2em 0 .5em}p.scene{text-align:center;text-indent:0;margin:1.2em 0}blockquote{margin:1em 1.5em;font-style:italic}.titlepage{text-align:center;margin-top:20%}.titlepage .sub{font-style:italic;text-indent:0;text-align:center}.titlepage .aut{text-transform:uppercase;letter-spacing:.15em;text-indent:0;text-align:center}.legal p,.dedication p{text-indent:0;text-align:center}.cover{text-align:center}.cover img{max-width:100%;max-height:100%}`;

export async function buildEpub(input: BookInput, opts: LayoutOptions, cover: CoverImage | null, uuid: string, isoDate: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const sections = buildSections({ ...input, authorPhoto: null }, opts).filter((s) => s.kind !== "half" && s.kind !== "toc");
  const ext = cover ? (cover.mime.includes("png") ? "png" : cover.mime.includes("webp") ? "webp" : "jpg") : "";
  const files: Array<{ name: string; data: Uint8Array; store?: boolean }> = [];
  const add = (name: string, text: string) => files.push({ name, data: enc.encode(text) });
  files.push({ name: "mimetype", data: enc.encode("application/epub+zip"), store: true });
  add("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  add("OEBPS/style.css", EPUB_CSS);
  const manifest: string[] = [`<item id="css" href="style.css" media-type="text/css"/>`, `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`, `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`];
  const spine: string[] = [];
  if (cover) {
    files.push({ name: `OEBPS/images/cover.${ext}`, data: cover.bytes });
    add("OEBPS/cover.xhtml", xhtml("Portada", `<div class="cover"><img src="images/cover.${ext}" alt="Portada"/></div>`));
    manifest.push(`<item id="cover-img" href="images/cover.${ext}" media-type="${esc(cover.mime)}" properties="cover-image"/>`, `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="cover" linear="yes"/>`);
  }
  const navItems: Array<{ file: string; title: string }> = [];
  sections.forEach((s, i) => {
    const file = `s${String(i + 1).padStart(2, "0")}.xhtml`;
    const head = s.kind === "chapter" ? `<div class="ch-num">${esc(s.label)}</div><h2 class="ch-title">${esc(s.title)}</h2>` : ["prologue", "epilogue", "ack", "about"].includes(s.kind) ? `<h2 class="ch-title">${esc(s.title)}</h2>` : "";
    const blocks = s.blocks.map((b, bi) => renderBlock(b.t === "p" && bi === 0 ? { ...b, cls: "first" } : b)).join("\n");
    add(`OEBPS/${file}`, xhtml(s.title, `${head}\n${blocks}`));
    manifest.push(`<item id="s${i + 1}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="s${i + 1}"/>`);
    if (s.body || s.kind === "title") navItems.push({ file, title: s.kind === "chapter" ? `${s.label}. ${s.title}` : s.title });
  });
  add("OEBPS/nav.xhtml", xhtml("Índice", `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Índice</h1><ol>${navItems.map((n) => `<li><a href="${n.file}">${esc(n.title)}</a></li>`).join("")}</ol></nav>`));
  add("OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${esc(uuid)}"/></head><docTitle><text>${esc(input.title)}</text></docTitle><navMap>${navItems.map((n, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(n.title)}</text></navLabel><content src="${n.file}"/></navPoint>`).join("")}</navMap></ncx>`);
  add("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="es"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${esc(uuid)}</dc:identifier><dc:title>${esc(input.title)}</dc:title><dc:creator>${esc(input.author || "Autor")}</dc:creator><dc:language>es</dc:language><dc:date>${esc(isoDate.slice(0, 10))}</dc:date><meta property="dcterms:modified">${esc(isoDate.slice(0, 19))}Z</meta>${cover ? `<meta name="cover" content="cover-img"/>` : ""}</metadata><manifest>${manifest.join("")}</manifest><spine toc="ncx">${spine.join("")}</spine></package>`);
  return makeZip(files);
}

// ------------------------------------------------------------------------------------------------ utilidades
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export function layoutWarnings(input: BookInput, pageCount: number, hasCover: boolean): string[] {
  const w: string[] = [];
  if (!input.title.trim()) w.push("Falta el título.");
  if (!input.author.trim()) w.push("Falta el nombre del autor.");
  if (!hasCover) w.push("No has subido portada: el PDF y el EPUB saldrán sin ella (puedes usar la generada).");
  input.chapters.forEach((c, i) => { const n = (c.text.match(/\S+/g) ?? []).length; if (n < 300) w.push(`El capítulo ${i + 1} es muy corto (${n} palabras).`); });
  if (pageCount < 24) w.push(`El libro tiene ${pageCount} páginas: para papel, Amazon KDP pide al menos 24.`);
  return w;
}
