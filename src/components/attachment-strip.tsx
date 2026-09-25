import { useEffect, useMemo } from "react";
import { Paperclip, X } from "lucide-react";
import { formatBytes } from "@/lib/profile";

type Item = { name: string; size: number; file: File };

/**
 * Adjuntos del chat dentro del propio cuadro de escribir: las imágenes como miniatura (se pueden pegar con
 * Win+Shift+S y Ctrl+V y escribir debajo) y el resto de archivos como una etiqueta con su tamaño.
 */
export function AttachmentStrip({ items, onRemove }: { items: Item[]; onRemove: (index: number) => void }) {
  const urls = useMemo(() => items.map((item) => (item.file.type.startsWith("image/") ? URL.createObjectURL(item.file) : "")), [items]);
  useEffect(() => () => urls.forEach((url) => url && URL.revokeObjectURL(url)), [urls]);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {items.map((item, index) =>
        urls[index] ? (
          <div key={`${item.name}-${index}`} className="relative">
            <img src={urls[index]} alt={item.name} className="h-14 rounded-md border border-border" />
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={`Quitar ${item.name}`}
              className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white"
            >
              ×
            </button>
          </div>
        ) : (
          <span key={`${item.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
            <Paperclip className="size-3 text-primary" />
            <span className="max-w-40 truncate font-medium text-foreground">{item.name}</span>
            <span className="shrink-0">{formatBytes(item.size)}</span>
            <button type="button" onClick={() => onRemove(index)} aria-label={`Quitar ${item.name}`} className="rounded-full hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </span>
        ),
      )}
    </div>
  );
}
