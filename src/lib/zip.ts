/** Generador de archivos ZIP en el navegador, sin dependencias externas. */

export type ZipEntry = { path: string; content: string };

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

/** Crea un ZIP (sin compresión) con los archivos indicados. */
export function createZip(entries: ZipEntry[], when = new Date()): Blob {
  const encoder = new TextEncoder();
  const { time, date } = dosTime(when);
  const locals: BlobPart[] = [];
  const centrals: BlobPart[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path.replace(/^\/+/, ""));
    const data = encoder.encode(entry.content);
    const sum = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // sin compresión
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, sum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    locals.push(local.buffer, name, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, sum, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(central.buffer, name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = centrals.reduce((n, part) => n + (part as ArrayBuffer | Uint8Array).byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...locals, ...centrals, end.buffer], { type: "application/zip" });
}

/** Descarga un ZIP con los archivos indicados. */
export function downloadZip(name: string, entries: ZipEntry[]) {
  const url = URL.createObjectURL(createZip(entries));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".zip") ? name : `${name}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
