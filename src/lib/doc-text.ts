// Lee el texto de casi cualquier documento en el propio navegador (nada se sube a ningún sitio): Word (.docx), LibreOffice (.odt),
// PowerPoint (.pptx), Excel (.xlsx), libros (.epub), páginas (.html), RTF, subtítulos (.srt/.vtt) y texto. El PDF lo lee pdf-text.ts.

// ------------------------------------------------------------------------------------------------ ZIP mínimo (docx, odt, epub… son ZIP)
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export type ZipFiles = Map<string, () => Promise<Uint8Array>>;

export function readZip(buf: Uint8Array): ZipFiles {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("El archivo no es un documento válido (no se reconoce su estructura).");
  const count = dv.getUint16(eocd + 10, true);
  let at = dv.getUint32(eocd + 16, true);
  const files: ZipFiles = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count && at + 46 <= buf.length; n++) {
    if (dv.getUint32(at, true) !== 0x02014b50) break;
    const method = dv.getUint16(at + 10, true);
    const compSize = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true), extraLen = dv.getUint16(at + 30, true), commentLen = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = decoder.decode(buf.subarray(at + 46, at + 46 + nameLen));
    files.set(name, async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = buf.subarray(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error("El documento usa una compresión que no sé leer.");
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const utf8 = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);

// ------------------------------------------------------------------------------------------------ XML / HTML → texto
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»", iexcl: "¡", iquest: "¿", ntilde: "ñ", Ntilde: "Ñ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", uuml: "ü", ccedil: "ç", agrave: "à", egrave: "è", ouml: "ö", auml: "ä", szlig: "ß", euro: "€", copy: "©", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED[entity] ?? NAMED[entity.toLowerCase()] ?? whole;
  });
}

export function xmlToText(xml: string, opts: { paragraph: RegExp; tab?: RegExp; lineBreak?: RegExp }): string {
  let s = xml.replace(opts.paragraph, "\n");
  if (opts.tab) s = s.replace(opts.tab, "\t");
  if (opts.lineBreak) s = s.replace(opts.lineBreak, "\n");
  return decodeEntities(s.replace(/<[^>]+>/g, ""));
}

const BLOCK = /<\/?(p|div|section|article|header|footer|h[1-6]|li|ul|ol|table|tr|blockquote|pre|br|hr|figcaption|dt|dd)\b[^>]*>/gi;

export function htmlToText(html: string): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|head|nav|iframe|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(BLOCK, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(cleaned);
}

function rtfToText(rtf: string): string {
  let s = rtf.replace(/\{\\\*[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "").replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\n?\}/g, "");
  s = s.replace(/\\par[d]?\b ?/g, "\n").replace(/\\(line|tab)\b ?/g, (_m, w: string) => (w === "tab" ? "\t" : "\n"));
  s = s.replace(/\\'([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\u(-?\d+)\??/g, (_m, n: string) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)));
  return s.replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").replace(/\\(.)/g, "$1");
}

function subtitlesToText(text: string): string {
  return text.replace(/^WEBVTT.*$/m, "").split(/\r?\n/).filter((line) => line.trim() && !/^\d+$/.test(line.trim()) && !/-->/.test(line)).map((line) => line.replace(/<[^>]+>/g, "")).join("\n");
}

// ------------------------------------------------------------------------------------------------ por formato
async function fromZip(buf: Uint8Array, kind: string): Promise<string> {
  const zip = readZip(buf);
  const read = async (name: string): Promise<string> => { const f = zip.get(name); return f ? utf8(await f()) : ""; };
  if (kind === "docx") {
    const body = await read("word/document.xml");
    if (!body) throw new Error("Ese archivo no parece un documento de Word (.docx).");
    return xmlToText(body, { paragraph: /<\/w:p>/g, tab: /<w:tab\s*\/>/g, lineBreak: /<w:br\s*\/>/g });
  }
  if (kind === "odt") {
    const body = await read("content.xml");
    if (!body) throw new Error("Ese archivo no parece un documento de LibreOffice (.odt).");
    return xmlToText(body, { paragraph: /<\/text:(p|h)>/g, tab: /<text:tab\s*\/>/g, lineBreak: /<text:line-break\s*\/>/g });
  }
  if (kind === "pptx") {
    const slides = [...zip.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
    if (!slides.length) throw new Error("Ese archivo no parece una presentación de PowerPoint (.pptx).");
    const out: string[] = [];
    for (const [i, name] of slides.entries()) out.push(`Diapositiva ${i + 1}\n${xmlToText(await read(name), { paragraph: /<\/a:p>/g })}`);
    return out.join("\n\n");
  }
  if (kind === "xlsx") {
    const shared = await read("xl/sharedStrings.xml");
    if (!shared) throw new Error("Ese archivo no parece una hoja de Excel (.xlsx) con texto.");
    return xmlToText(shared, { paragraph: /<\/si>/g });
  }
  // epub: el orden de lectura lo da el «spine» del OPF
  const container = await read("META-INF/container.xml");
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
  if (!opfPath) throw new Error("Ese archivo no parece un libro EPUB.");
  const opf = await read(opfPath);
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const manifest = new Map<string, string>();
  for (const item of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(item[0])?.[1], href = /\bhref="([^"]+)"/.exec(item[0])?.[1];
    if (id && href) manifest.set(id, decodeURIComponent(href));
  }
  const order = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => manifest.get(m[1]!)).filter((h): h is string => !!h);
  const parts: string[] = [];
  for (const href of order) parts.push(htmlToText(await read(dir + href)));
  if (!parts.length) throw new Error("No encuentro capítulos en ese EPUB.");
  return parts.join("\n\n");
}

const TEXTUAL = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "xml", "log", "yaml", "yml", "ini", "tex", "rst"]);

/** Para texto plano y código: solo saltos de línea y espacios sobrantes al final; NO se tocan la sangría ni las tablas. */
export function tidyPlain(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\s+$/g, "").slice(0, 2_000_000);
}

export function tidy(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim().slice(0, 2_000_000);
}

/** Texto de un documento de cualquier formato habitual (el PDF lo trata pdf-text.ts, que llama a esto para el resto). */
export async function extractDocumentText(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<string> {
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? "").toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (["docx", "odt", "pptx", "xlsx", "epub"].includes(ext)) return tidy(await fromZip(bytes, ext));
  if (["doc", "ppt", "xls"].includes(ext)) throw new Error(`Los archivos .${ext} antiguos no se pueden leer directamente: ábrelo en Word/LibreOffice y guárdalo como .docx o PDF.`);
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(ext)) throw new Error("Eso es una imagen: pásala por la pestaña OCR para sacar su texto.");
  const text = utf8(bytes);
  if (/\.(html?|xhtml)$/i.test(file.name)) return tidy(htmlToText(text));
  if (ext === "rtf" || /^\{\\rtf/.test(text)) return tidy(rtfToText(text));
  if (ext === "srt" || ext === "vtt") return tidy(subtitlesToText(text));
  if (!TEXTUAL.has(ext) && ext && bytes.length > 4 && bytes.subarray(0, 4).some((b) => b === 0)) throw new Error("No reconozco ese formato de archivo. Prueba con PDF, Word (.docx), LibreOffice (.odt), EPUB, HTML o texto.");
  return tidyPlain(text);
}
