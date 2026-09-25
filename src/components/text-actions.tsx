// Botones de «Copiar» y «Descargar» para un texto largo (OCR, Lectura en voz alta…). Antes cada pantalla tenía su
// propia copia, con la misma lógica de portapapeles y descarga como .txt.
import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";

export function CopyTextButton({ text }: { text: string }) {
  return (
    <Button
      variant="secondary"
      className="gap-2"
      disabled={!text.trim()}
      onClick={() => { void navigator.clipboard.writeText(text); pushNotice("Texto copiado.", "success"); }}
    >
      <Copy className="size-4" />Copiar
    </Button>
  );
}

export function DownloadTextButton({ text, fileBaseName, fallbackName = "documento", label = "Descargar" }: { text: string; fileBaseName: string; fallbackName?: string; label?: string }) {
  return (
    <Button
      variant="outline"
      className="gap-2"
      disabled={!text.trim()}
      onClick={() => {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(fileBaseName || fallbackName).replace(/\.[^.]+$/, "")}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download className="size-4" />{label}
    </Button>
  );
}
