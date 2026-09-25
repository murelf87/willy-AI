// Adjuntos del chat: el texto de cada archivo (PDF, Word, LibreOffice, EPUB, HTML, código, texto…) para que el modelo lo lea.
// No hay límite de formatos ni un tope de 200 KB: se lee el archivo entero y se le pasa al modelo lo que le cabe (y se dice cuánto).

import { extractAnyText } from "@/lib/pdf-text";

export type AttachResult = { blocks: string[]; notes: string[] };
export type AttachOptions = { budgetChars: number; modelLabel?: string; maxFiles?: number; maxBytes?: number; extract?: (file: File) => Promise<string> };

const fmt = (n: number) => n.toLocaleString("es-ES");

/** Corta en un final de párrafo o de frase cercano al límite, para no dejar la última frase a medias. */
export function cutAt(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const end = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf(". "), head.lastIndexOf("\n"));
  return end > max * 0.6 ? head.slice(0, end + 1).trimEnd() : head;
}

export async function readAttachmentText(files: File[], o: AttachOptions): Promise<AttachResult> {
  const maxFiles = o.maxFiles ?? 8;
  const maxBytes = o.maxBytes ?? 100 * 2 ** 20;
  const extract = o.extract ?? extractAnyText;
  const notes: string[] = [];
  const texts: Array<{ name: string; text: string }> = [];
  if (files.length > maxFiles) notes.push(`Solo leo los primeros ${maxFiles} archivos de ${files.length}.`);
  for (const file of files.slice(0, maxFiles)) {
    if (file.size > maxBytes) { notes.push(`«${file.name}» pesa ${(file.size / 2 ** 20).toFixed(0)} MB y el máximo para leerlo aquí es ${Math.round(maxBytes / 2 ** 20)} MB. Para textos enormes usa Lector o Traducir, que trabajan por trozos.`); continue; }
    try {
      const text = (await extract(file)).replace(/--- Página \d+ ---/g, "").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) notes.push(`«${file.name}» no tiene texto que se pueda leer (¿es un escaneado? pásalo por la pestaña OCR).`);
      else texts.push({ name: file.name, text });
    } catch (error) {
      notes.push(`No he podido leer «${file.name}»: ${error instanceof Error ? error.message : "formato no reconocido"}`);
    }
  }
  const share = Math.max(1500, Math.floor(o.budgetChars / Math.max(1, texts.length)));
  const blocks = texts.map(({ name, text }) => {
    if (text.length <= share) return `--- ${name} ---\n${text}`;
    const part = cutAt(text, share);
    notes.push(`«${name}» tiene ${fmt(text.length)} caracteres y ${o.modelLabel ?? "el modelo"} solo puede leer ${fmt(part.length)} de golpe. Para un documento largo usa Lector o Traducir (van por trozos) o un modelo con más contexto.`);
    return `--- ${name} (primeros ${fmt(part.length)} de ${fmt(text.length)} caracteres) ---\n${part}`;
  });
  return { blocks, notes };
}
