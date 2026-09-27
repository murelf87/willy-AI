/**
 * model-install.ts — descargador genérico de modelos IA para WILLY AI
 * Descarga un archivo desde una URL remota a una carpeta local de ComfyUI,
 * con progreso en bytes, archivo .descarga temporal y validación básica.
 */

export type ModelInstallStatus = {
  status: "idle" | "downloading" | "done" | "error";
  progress?: number;   // 0-100
  downloaded?: number; // bytes descargados
  total?: number;      // bytes totales (0 si no se conoce)
  error?: string;
  filename?: string;
};

// Job en memoria por instalación en curso
const activeJobs = new Map<string, {
  controller: AbortController;
  status: ModelInstallStatus;
}>();

export function getModelInstallStatus(jobId: string): ModelInstallStatus {
  return activeJobs.get(jobId)?.status ?? { status: "idle" };
}

export function cancelModelInstall(jobId: string): void {
  activeJobs.get(jobId)?.controller.abort();
}

/**
 * Inicia la descarga en background. Devuelve un jobId para consultar el estado.
 * comfyuiRoot: ruta a la carpeta raíz de ComfyUI, p. ej. "C:/ComfyUI"
 * folder: subcarpeta dentro de models/, p. ej. "checkpoints"
 * filename: nombre del archivo destino
 * url: URL de descarga directa
 */
export async function startModelInstall(params: {
  comfyuiRoot: string;
  folder: string;
  filename: string;
  url: string;
}): Promise<string> {
  const { comfyuiRoot, folder, filename, url } = params;
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const status: ModelInstallStatus = { status: "downloading", progress: 0, downloaded: 0, total: 0, filename };

  activeJobs.set(jobId, { controller, status });

  // Ejecutar en background (no await)
  void (async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const destDir = path.join(comfyuiRoot, "models", folder);
    const destPath = path.join(destDir, filename);
    const tmpPath = destPath + ".descarga";

    try {
      await fs.promises.mkdir(destDir, { recursive: true });

      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        throw new Error("La URL devuelve HTML, no un modelo. Comprueba la URL de descarga directa.");
      }

      const total = parseInt(response.headers.get("content-length") ?? "0", 10);
      status.total = total;

      const writer = fs.createWriteStream(tmpPath);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No se pudo leer el body de la respuesta.");

      let downloaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        downloaded += value.length;
        status.downloaded = downloaded;
        status.progress = total > 0 ? Math.round((downloaded / total) * 100) : -1;
        await new Promise<void>((res, rej) => writer.write(value, (err) => (err ? rej(err) : res())));
      }

      await new Promise<void>((res, rej) => writer.end((err: Error | null) => (err ? rej(err) : res())));

      // Validar tamaño mínimo (1 MB)
      const stat = await fs.promises.stat(tmpPath);
      if (stat.size < 1_000_000) {
        throw new Error(`Archivo demasiado pequeño (${stat.size} bytes). Puede que la URL no sea correcta.`);
      }

      await fs.promises.rename(tmpPath, destPath);
      status.status = "done";
      status.progress = 100;
    } catch (err: unknown) {
      status.status = "error";
      status.error = err instanceof Error ? err.message : String(err);
      // Limpiar temporal si existe
      try {
        const fs2 = await import("node:fs");
        const path2 = await import("node:path");
        const tmpPath2 = path2.join(params.comfyuiRoot, "models", params.folder, params.filename + ".descarga");
        await fs2.promises.unlink(tmpPath2).catch(() => {});
      } catch {}
    }
  })();

  return jobId;
}
