// Abre un PDF en el propio navegador (nada sale del equipo) y devuelve el documento de pdf.js listo para leer
// sus páginas. La lectura de texto (pdf-text.ts) y el OCR de PDFs escaneados (ocr.ts) partían cada uno por su
// cuenta desde aquí; el resto de cada uno (sacar texto o renderizar la página) sigue siendo cosa suya.
export async function openPdfDocument(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
    { type: "module" },
  );
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}
