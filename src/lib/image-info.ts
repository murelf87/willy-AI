// Fotos de alta calidad: se guardan tal cual las subes (sin recomprimir) y aquí se mide qué calidad tendrán al imprimir.

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const IMAGE_MAX_BYTES = 60 * 2 ** 20;

export type PrintQuality = { dpi: number; level: "ideal" | "aceptable" | "baja"; text: string };

/** Puntos por pulgada que tendrá la imagen (w × h píxeles) impresa a mmW × mmH. */
export function printQuality(w: number, h: number, mmW: number, mmH: number): PrintQuality {
  const dpi = Math.round(Math.min(w / (mmW / 25.4), h / (mmH / 25.4)));
  if (dpi >= 300) return { dpi, level: "ideal", text: `${dpi} ppp: calidad de imprenta` };
  if (dpi >= 200) return { dpi, level: "aceptable", text: `${dpi} ppp: se ve bien en pantalla; en papel es justa (lo ideal son 300)` };
  return { dpi, level: "baja", text: `${dpi} ppp: en papel se verá borrosa (lo ideal son 300). Usa una imagen más grande` };
}

/** Grosor del lomo orientativo (mm): papel blanco 0,0572 mm por página; crema 0,0635 mm. Confirma el dato con tu imprenta. */
export function spineMm(pages: number, paper: "blanco" | "crema"): number {
  return Math.round(Math.max(0, pages) * (paper === "crema" ? 0.0635 : 0.0572) * 10) / 10;
}

/** Texto blanco o negro según lo claro que sea el fondo (#rrggbb). */
export function readableOn(hex: string): "#ffffff" | "#111111" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const yiq = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
  return yiq >= 150 ? "#111111" : "#ffffff";
}

export const formatBytes = (n: number): string => (n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function readImageInfo(blob: Blob): Promise<{ w: number; h: number }> {
  const bitmap = await createImageBitmap(blob);
  const info = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  return info;
}

export function checkImageFile(file: { type: string; size: number }): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return "La imagen tiene que ser PNG, JPG o WEBP.";
  if (file.size > IMAGE_MAX_BYTES) return `La imagen pesa ${formatBytes(file.size)} y el máximo es ${formatBytes(IMAGE_MAX_BYTES)}.`;
  return null;
}
