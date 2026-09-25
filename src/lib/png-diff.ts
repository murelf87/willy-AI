// Comparación de capturas de pantalla (PNG de 8 bits) sin librerías: descodifica y cuenta qué parte cambió.

export type Pixels = { width: number; height: number; channels: number; data: Uint8Array };

export async function decodePng(buffer: Uint8Array): Promise<Pixels | null> {
  const zlib = await import("node:zlib");
  const view = Buffer.from(buffer);
  if (view.length < 33 || view.readUInt32BE(0) !== 0x89504e47) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= view.length) {
    const length = view.readUInt32BE(offset);
    const type = view.toString("ascii", offset + 4, offset + 8);
    const body = view.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colorType = body[9]!;
      interlace = body[12]!;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!width || !height || depth !== 8 || !channels || interlace !== 0 || width * height > 40_000_000) return null;
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const row = y * stride;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[row + x - channels]! : 0;
      const up = y > 0 ? out[row - stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? out[row - stride + x - channels]! : 0;
      let value = raw[src + x]!;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) return null;
      out[row + x] = value & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

export type PngDiff = { changedPct: number; changedPixels: number; total: number; sameSize: boolean; box: { x: number; y: number; w: number; h: number } | null };

/** Porcentaje de píxeles que cambian de verdad (con una pequeña tolerancia para el suavizado del texto). */
export function diffPixels(a: Pixels, b: Pixels, tolerance = 24): PngDiff {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  let changed = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const color = (p: Pixels, x: number, y: number, c: number): number => {
    const base = (y * p.width + x) * p.channels;
    if (p.channels >= 3) return p.data[base + c]!;
    return p.data[base]!;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.abs(color(a, x, y, 0) - color(b, x, y, 0)) > tolerance || Math.abs(color(a, x, y, 1) - color(b, x, y, 1)) > tolerance || Math.abs(color(a, x, y, 2) - color(b, x, y, 2)) > tolerance) {
        changed += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const total = width * height;
  return {
    changedPct: total ? Math.round((changed / total) * 1000) / 10 : 0,
    changedPixels: changed,
    total,
    sameSize: a.width === b.width && a.height === b.height,
    box: maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  };
}

export async function diffPng(before: Uint8Array, after: Uint8Array): Promise<PngDiff | null> {
  const [a, b] = await Promise.all([decodePng(before), decodePng(after)]);
  return a && b ? diffPixels(a, b) : null;
}
