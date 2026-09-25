// Icono propio de cada programa: un cuadrado redondeado con un degradado de color sacado de su identificador y la inicial de
// su nombre dibujada con trazos suaves (sin fuentes externas). Da a cada programa su identidad en el menú Inicio, el
// escritorio, el instalador y la barra de tareas. Funciones puras: devuelven los bytes del .ico y del .png.

type Pt = [number, number];
type Stroke = Pt[];

/** Arco de elipse en la rejilla 10×14 (ángulos en grados, 0 = derecha, aumentando en el sentido de las agujas del reloj). */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 20): Stroke {
  const out: Stroke = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

/** Trazos de cada carácter en una rejilla de 10 de ancho por 14 de alto. */
const GLYPHS: Record<string, Stroke[]> = {
  A: [[[0, 14], [5, 0], [10, 14]], [[2, 9], [8, 9]]],
  B: [[[0, 0], [0, 14]], [[0, 0], [5.5, 0], ...arc(5.5, 3.5, 3.5, 3.5, -90, 90).slice(1), [0, 7]], [[0, 7], [6, 7], ...arc(6, 10.5, 3.8, 3.5, -90, 90).slice(1), [0, 14]]],
  C: [arc(5.5, 7, 5.5, 7, 310, 50)],
  D: [[[0, 0], [0, 14]], [[0, 0], [3.5, 0], ...arc(3.5, 7, 6.5, 7, -90, 90).slice(1), [0, 14]]],
  E: [[[10, 0], [0, 0], [0, 14], [10, 14]], [[0, 7], [7, 7]]],
  F: [[[10, 0], [0, 0], [0, 14]], [[0, 7], [7, 7]]],
  G: [[...arc(5.5, 7, 5.5, 7, 310, 0), [10.5, 7]], [[10.5, 7], [6, 7]]],
  H: [[[0, 0], [0, 14]], [[10, 0], [10, 14]], [[0, 7], [10, 7]]],
  I: [[[5, 0], [5, 14]], [[2, 0], [8, 0]], [[2, 14], [8, 14]]],
  J: [[[8, 0], [8, 10]], arc(4.5, 10, 3.5, 4, 0, 180)],
  K: [[[0, 0], [0, 14]], [[10, 0], [0, 8.5]], [[3.2, 5.8], [10, 14]]],
  L: [[[0, 0], [0, 14], [10, 14]]],
  M: [[[0, 14], [0, 0], [5, 9], [10, 0], [10, 14]]],
  N: [[[0, 14], [0, 0], [10, 14], [10, 0]]],
  Ñ: [[[0, 14], [0, 3], [10, 14], [10, 3]], [[1.5, 0.3], [3.5, -0.8], [6.5, 0.8], [8.5, -0.3]]],
  O: [arc(5, 7, 5, 7, 0, 360, 36)],
  P: [[[0, 14], [0, 0], [5.5, 0], ...arc(5.5, 3.75, 4, 3.75, -90, 90).slice(1), [0, 7.5]]],
  Q: [arc(5, 7, 5, 7, 0, 360, 36), [[6, 10], [10, 14]]],
  R: [[[0, 14], [0, 0], [5.5, 0], ...arc(5.5, 3.75, 4, 3.75, -90, 90).slice(1), [0, 7.5]], [[4.5, 7.5], [10, 14]]],
  S: [arc(5, 3.6, 4.6, 3.6, 320, 90), arc(5, 10.5, 4.9, 3.3, 270, 500)],
  T: [[[0, 0], [10, 0]], [[5, 0], [5, 14]]],
  U: [[[0, 0], [0, 9], ...arc(5, 9, 5, 5, 180, 0).slice(1), [10, 0]]],
  V: [[[0, 0], [5, 14], [10, 0]]],
  W: [[[0, 0], [2.5, 14], [5, 5], [7.5, 14], [10, 0]]],
  X: [[[0, 0], [10, 14]], [[10, 0], [0, 14]]],
  Y: [[[0, 0], [5, 7], [10, 0]], [[5, 7], [5, 14]]],
  Z: [[[0, 0], [10, 0], [0, 14], [10, 14]]],
  "0": [arc(5, 7, 5, 7, 0, 360, 36)],
  "1": [[[2, 3], [6, 0], [6, 14]], [[2, 14], [10, 14]]],
  "2": [[...arc(5, 4, 4.8, 4, 200, 360), [10, 5], [0, 14], [10, 14]]],
  "3": [arc(5, 3.5, 4.5, 3.5, 200, 450), arc(5, 10.5, 5, 3.5, 270, 520)],
  "4": [[[8, 14], [8, 0], [0, 10], [10, 10]]],
  "5": [[[9, 0], [1, 0], [0.5, 6], [5, 5.6], ...arc(5, 9.8, 5, 4.2, 270, 520).slice(1)]],
  "6": [arc(5, 9.5, 5, 4.5, 0, 360, 30), [[0.2, 9], [1.6, 4], [4.5, 1], [8.5, 0]]],
  "7": [[[0, 0], [10, 0], [4, 14]]],
  "8": [arc(5, 3.5, 4, 3.5, 0, 360, 28), arc(5, 10.5, 5, 3.5, 0, 360, 28)],
  "9": [arc(5, 4.5, 5, 4.5, 0, 360, 30), [[9.8, 5], [8.4, 10], [5.5, 13], [1.5, 14]]],
};

/** Primer carácter dibujable del nombre (sin acentos; la Ñ se conserva). */
export function iconInitial(nombre: string): string {
  for (const ch of nombre.trim()) {
    const up = ch.toUpperCase();
    if (up === "Ñ") return "Ñ";
    const base = up.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (GLYPHS[base]) return base;
  }
  return "";
}

function hash32(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len = vx * vx + vy * vy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len)) : 0;
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Imagen RGBA (fila a fila, de arriba abajo) del icono a un tamaño. */
export function renderIcon(id: string, nombre: string, size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const h = hash32(id);
  const hue = h % 360;
  const c1 = hsl(hue, 0.62, 0.55);
  const c2 = hsl((hue + 28) % 360, 0.7, 0.36);
  const glyph = GLYPHS[iconInitial(nombre)] ?? [arc(5, 7, 4, 4, 0, 360, 28)];
  const radius = size * 0.22;
  const half = size / 2;
  const gh = size * 0.5;
  const scale = gh / 14;
  const ox = half - 5 * scale;
  const oy = half - 7 * scale;
  const stroke = Math.max(1.4, size * 0.085) / 2;
  const segs: Array<[number, number, number, number]> = [];
  for (const s of glyph) {
    for (let i = 1; i < s.length; i += 1) {
      const a = s[i - 1]!;
      const b = s[i]!;
      segs.push([ox + a[0] * scale, oy + a[1] * scale, ox + b[0] * scale, oy + b[1] * scale]);
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const qx = Math.abs(cx - half) - (half - radius);
      const qy = Math.abs(cy - half) - (half - radius);
      const outside = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) + Math.min(Math.max(qx, qy), 0) - radius;
      const tile = Math.max(0, Math.min(1, 0.5 - outside));
      if (tile <= 0) continue;
      const t = (cx + cy) / (2 * size);
      let r = c1[0] + (c2[0] - c1[0]) * t;
      let g = c1[1] + (c2[1] - c1[1]) * t;
      let b = c1[2] + (c2[2] - c1[2]) * t;
      let d = Infinity;
      for (const [ax, ay, bx, by] of segs) d = Math.min(d, segDist(cx, cy, ax, ay, bx, by));
      const ink = Math.max(0, Math.min(1, stroke - d + 0.5));
      r += (255 - r) * ink;
      g += (255 - g) * ink;
      b += (255 - b) * ink;
      const i = (y * size + x) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(tile * 255);
    }
  }
  return px;
}

/** .ico con los tamaños que usa Windows (imágenes de 32 bits sin comprimir: las entiende todo Windows y NSIS). */
export function iconIco(id: string, nombre: string, sizes: number[] = [16, 24, 32, 48, 64, 128, 256]): Uint8Array {
  const images = sizes.map((size) => {
    const rgba = renderIcon(id, nombre, size);
    const maskRow = Math.ceil(size / 32) * 4;
    const bytes = new Uint8Array(40 + size * size * 4 + maskRow * size);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 40, true);
    view.setInt32(4, size, true);
    view.setInt32(8, size * 2, true);
    view.setUint16(12, 1, true);
    view.setUint16(14, 32, true);
    view.setUint32(20, size * size * 4 + maskRow * size, true);
    for (let y = 0; y < size; y += 1) {
      const src = (size - 1 - y) * size * 4;
      for (let x = 0; x < size; x += 1) {
        const o = 40 + (y * size + x) * 4;
        const s = src + x * 4;
        bytes[o] = rgba[s + 2]!;
        bytes[o + 1] = rgba[s + 1]!;
        bytes[o + 2] = rgba[s]!;
        bytes[o + 3] = rgba[s + 3]!;
        if (rgba[s + 3] === 0) {
          const m = 40 + size * size * 4 + y * maskRow + (x >> 3);
          bytes[m] = bytes[m]! | (0x80 >> (x & 7));
        }
      }
    }
    return { size, bytes };
  });
  const headerSize = 6 + 16 * images.length;
  const total = headerSize + images.reduce((n, img) => n + img.bytes.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = headerSize;
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    out[e] = img.size >= 256 ? 0 : img.size;
    out[e + 1] = img.size >= 256 ? 0 : img.size;
    view.setUint16(e + 4, 1, true);
    view.setUint16(e + 6, 32, true);
    view.setUint32(e + 8, img.bytes.length, true);
    view.setUint32(e + 12, offset, true);
    out.set(img.bytes, offset);
    offset += img.bytes.length;
  });
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** .png del icono (para la ventana y la barra de tareas); `deflate` = compresión zlib (en el servidor, zlib.deflateSync). */
export function iconPng(id: string, nombre: string, size: number, deflate: (data: Uint8Array) => Uint8Array): Uint8Array {
  const rgba = renderIcon(id, nombre, size);
  const raw = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflate(raw)), chunk("IEND", new Uint8Array())];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
