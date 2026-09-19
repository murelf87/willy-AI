// OCR en el propio navegador: reconoce el texto de fotos, escaneos y PDFs
// escaneados sin que el documento salga del equipo.

export type OcrProgress = { page: number; total: number; percent: number; stage: string };

const STAGES: Record<string, string> = {
  "loading tesseract core": "Preparando el motor",
  "initializing tesseract": "Preparando el motor",
  "loading language traineddata": "Cargando el español",
  "initializing api": "Preparando el motor",
  "recognizing text": "Leyendo el documento",
};

async function renderPdfPages(file: File, onPage?: (n: number, total: number) => void): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
    { type: "module" },
  );
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const canvases: HTMLCanvasElement[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onPage?.(i, doc.numPages);
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) continue;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    canvases.push(canvas);
  }
  await doc.cleanup();
  return canvases;
}

/** Reconoce el texto de una imagen o de un PDF escaneado. */
export async function recognizeDocument(
  file: File,
  onProgress?: (p: OcrProgress) => void,
  language = "spa",
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const pages: Array<HTMLCanvasElement | File> = isPdf
    ? await renderPdfPages(file, (n, total) =>
        onProgress?.({ page: n, total, percent: 0, stage: "Preparando las páginas" }))
    : [file];

  let current = 0;
  let totalPages = pages.length;
  const worker = await createWorker(language, 1, {
    logger: (m: { status: string; progress: number }) =>
      onProgress?.({
        page: current + 1,
        total: totalPages,
        percent: Math.round((m.progress ?? 0) * 100),
        stage: STAGES[m.status] ?? "Trabajando",
      }),
  });

  try {
    const out: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      current = i;
      totalPages = pages.length;
      const { data } = await worker.recognize(pages[i]!);
      const text = (data.text ?? "").replace(/\n{3,}/g, "\n\n").trim();
      if (text) out.push(pages.length > 1 ? `--- Página ${i + 1} ---\n${text}` : text);
    }
    return out.join("\n\n");
  } finally {
    await worker.terminate();
  }
}
