// Portada subida por el usuario: se ajusta a la proporción del libro (recortando por el centro, o sin recortar con bandas) y se guarda
// como JPEG. La parte de calcular tamaños y decodificar es pura; el dibujo usa el lienzo del navegador.

export function coverSize(trimW: number, trimH: number, width = 1400): { w: number; h: number } {
  return { w: width, h: Math.round((width * trimH) / trimW) };
}

/** Cómo se coloca una imagen (iw × ih) dentro de la portada (w × h): «cover» rellena recortando, «contain» encaja sin recortar. */
export function placeImage(iw: number, ih: number, w: number, h: number, fit: "cover" | "contain"): { dx: number; dy: number; dw: number; dh: number } {
  const scale = fit === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  return { dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh };
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1]! };
}

export const COVER_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const COVER_MAX_BYTES = 25 * 2 ** 20;

export async function fitCoverFile(file: File, trimW: number, trimH: number, fit: "cover" | "contain"): Promise<string> {
  if (!COVER_TYPES.includes(file.type)) throw new Error("La portada tiene que ser una imagen PNG, JPG o WEBP.");
  if (file.size > COVER_MAX_BYTES) throw new Error("La imagen pesa más de 25 MB.");
  const bitmap = await createImageBitmap(file);
  const { w, h } = coverSize(trimW, trimH);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no puede preparar la imagen.");
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, w, h);
  const p = placeImage(bitmap.width, bitmap.height, w, h, fit);
  ctx.drawImage(bitmap, p.dx, p.dy, p.dw, p.dh);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.9);
}
