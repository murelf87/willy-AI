// Lectura de PDF en el propio navegador: nada sale del equipo.

export async function extractPdfText(file: File, onPage?: (page: number, total: number) => void): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
    { type: "module" },
  );
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onPage?.(i, doc.numPages);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(`--- Página ${i} ---\n${text}`);
  }
  await doc.cleanup();
  return pages.join("\n\n");
}

/** Texto de cualquier archivo legible (txt, md, csv, json, código…). */
export async function extractAnyText(file: File, onPage?: (page: number, total: number) => void): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return extractPdfText(file, onPage);
  }
  return file.text();
}
