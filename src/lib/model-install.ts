// Descarga genérica de un archivo de modelo (checkpoint, LoRA, IPAdapter, VAE…) a una carpeta de ComfyUI, en
// segundo plano y con progreso real (bytes, no un porcentaje inventado). A propósito NO trae grabada a fuego
// ninguna dirección de descarga de un checkpoint concreto: son archivos de varios GB y sus direcciones cambian
// de sitio con frecuencia (el mismo motivo por el que comfy-install.ts tampoco lo hace). Quien decide qué
// modelo y desde dónde es quien pega el enlace: WILLY solo lo trae al sitio correcto, comprobando que sea un
// archivo de verdad y no una página de error o de inicio de sesión.
//
// Importante: esta descarga la hace el propio proceso de WILLY, corriendo en tu equipo, con tu conexión a
// internet — no pasa por ninguna sesión de Claude ni por su red restringida.

export type ModelInstallJob = {
  id: string;
  status: "activo" | "listo" | "error" | "cancelado";
  pct: number;
  text: string;
  error: string;
  bytesDone: number;
  bytesTotal: number;
  file: string;
  abort: AbortController;
};

export const MODEL_FOLDERS = ["checkpoints", "loras", "vae", "clip_vision", "ipadapter", "controlnet", "upscale_models"] as const;
export type ModelFolder = (typeof MODEL_FOLDERS)[number];

const NAME_OK = /^[\w][\w.\- ]{0,120}\.(safetensors|ckpt|pt|pth|bin|onnx)$/i;

async function mods() {
  return { fs: await import("node:fs/promises"), path: await import("node:path") };
}

export type ModelInstallDeps = { fetchImpl?: typeof fetch };

/**
 * Descarga `url` dentro de `<dir>/avatar/ComfyUI/models/<folder>/<filename>`. Escribe primero en un archivo
 * `.descarga` y solo lo renombra al final si el tamaño parece el de un modelo real (evita dejar a medias un
 * checkpoint roto si se corta la conexión, y detecta cuando el «modelo» es en realidad una página de error o
 * de inicio de sesión de pocos KB).
 */
export async function downloadModel(dir: string, job: ModelInstallJob, url: string, folder: ModelFolder, filename: string, deps: ModelInstallDeps = {}): Promise<string> {
  if (!/^https:\/\//i.test(url)) throw new Error("La dirección debe ser https://.");
  if (!(MODEL_FOLDERS as readonly string[]).includes(folder)) throw new Error("Carpeta de destino no permitida.");
  if (!NAME_OK.test(filename)) throw new Error("Nombre de archivo no válido (debe acabar en .safetensors, .ckpt, .pt, .pth, .bin o .onnx).");

  const { fs, path } = await mods();
  const destDir = path.join(dir, "avatar", "ComfyUI", "models", folder);
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, filename);
  const tmp = `${dest}.descarga`;

  const res = await (deps.fetchImpl ?? fetch)(url, { redirect: "follow", signal: job.abort.signal });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}. Comprueba el enlace (algunos modelos piden iniciar sesión en el navegador antes de poder descargarse directamente).`);
  if (!res.body) throw new Error("El servidor no envió ningún archivo.");
  if (/text\/html/i.test(type)) throw new Error("Ese enlace devuelve una página web, no un archivo (¿hace falta iniciar sesión o aceptar una licencia primero en el navegador?).");
  job.bytesTotal = Number(res.headers.get("content-length") ?? 0);
  job.file = dest;

  const handle = await fs.open(tmp, "w");
  try {
    const reader = (res.body as unknown as { getReader: () => ReadableStreamDefaultReader<Uint8Array> }).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await handle.write(value);
        job.bytesDone += value.byteLength;
        job.pct = job.bytesTotal ? Math.min(99, Math.round((job.bytesDone / job.bytesTotal) * 100)) : Math.min(99, job.pct + 1);
        job.text = `${(job.bytesDone / 2 ** 20).toFixed(0)} MB${job.bytesTotal ? ` de ${(job.bytesTotal / 2 ** 20).toFixed(0)} MB` : " descargados"}`;
      }
    }
  } finally {
    await handle.close();
  }
  if (job.bytesDone < 1_000_000) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw new Error(`Solo ${job.bytesDone} bytes: eso no es un modelo real. Revisa el enlace (usa el botón «descargar directo» de la página del modelo, no el enlace de la ficha).`);
  }
  await fs.rm(dest, { force: true }).catch(() => undefined);
  await fs.rename(tmp, dest);
  job.pct = 100;
  job.text = `Guardado en models/${folder}/${filename} (${(job.bytesDone / 2 ** 20).toFixed(0)} MB).`;
  return dest;
}
