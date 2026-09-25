import type { PreparedImage } from "@/lib/vision";

/** Miniaturas de las imágenes que se van a enviar, cada una con su botón para quitarla. */
export function ImageChips({ images, onRemove }: { images: PreparedImage[]; onRemove: (image: PreparedImage) => void }) {
  if (!images.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((image, index) => (
        <div key={`${image.name}-${index}`} className="relative">
          <img src={image.dataUrl} alt={image.name} className="h-14 rounded-md border border-border" />
          <button
            type="button"
            className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white"
            onClick={() => onRemove(image)}
            aria-label={`Quitar ${image.name}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
