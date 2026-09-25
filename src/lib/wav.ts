// Unir varios audios WAV (todos con el mismo formato, como los que saca Piper) en uno solo, con una pausa corta entre trozos.

function tag(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);
}

function parseWav(b: Uint8Array): { fmt: Uint8Array; data: Uint8Array } {
  if (b.length < 12 || tag(b, 0) !== "RIFF" || tag(b, 8) !== "WAVE") throw new Error("Uno de los trozos de audio no es un WAV válido.");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fmt: Uint8Array | null = null;
  let data: Uint8Array | null = null;
  let offset = 12;
  while (offset + 8 <= b.length) {
    const id = tag(b, offset);
    const start = offset + 8;
    const size = Math.min(view.getUint32(offset + 4, true), b.length - start);
    if (id === "fmt ") fmt = b.slice(start, start + size);
    else if (id === "data") { data = b.subarray(start, start + size); break; }
    offset = start + size + (size & 1);
  }
  if (!fmt || fmt.length < 16 || !data) throw new Error("Un trozo de audio está incompleto.");
  return { fmt, data };
}

export function concatWav(parts: Uint8Array[], gapMs = 250): Uint8Array {
  if (!parts.length) throw new Error("No hay audio que unir.");
  const parsed = parts.map(parseWav);
  const first = parsed[0]!.fmt.slice(0, 16);
  for (const p of parsed) if (p.fmt.slice(0, 16).some((byte, i) => byte !== first[i])) throw new Error("Los trozos de audio tienen formatos distintos.");
  const view = new DataView(first.buffer, first.byteOffset, 16);
  const byteRate = view.getUint32(8, true);
  const blockAlign = Math.max(1, view.getUint16(12, true));
  const gap = Math.floor((byteRate * gapMs) / 1000 / blockAlign) * blockAlign;
  const total = parsed.reduce((sum, p) => sum + p.data.length, 0) + gap * (parsed.length - 1);
  const out = new Uint8Array(44 + total);
  const dv = new DataView(out.buffer);
  const put = (o: number, s: string) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  put(0, "RIFF"); dv.setUint32(4, 36 + total, true); put(8, "WAVE"); put(12, "fmt "); dv.setUint32(16, 16, true); out.set(first, 20); put(36, "data"); dv.setUint32(40, total, true);
  let at = 44;
  parsed.forEach((p, i) => { out.set(p.data, at); at += p.data.length; if (i < parsed.length - 1) at += gap; });
  return out;
}
