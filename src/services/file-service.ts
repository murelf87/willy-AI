// Archivos del proyecto: descarga individual, paquete ZIP y validación básica
// del código generado. Cuando exista backend, `FileService` pasará a leer y
// escribir en el sistema de archivos real del equipo.

import { downloadZip, type ZipEntry } from "@/lib/zip";
import { downloadFile } from "@/lib/workspace-store";
import { fail, ok, type GeneratedFile, type ServiceResult } from "@/types/domain";

export type CheckIssue = { path: string; level: "error" | "aviso"; message: string };

export interface FileService {
  exportZip(projectName: string, files: GeneratedFile[]): Promise<ServiceResult<number>>;
  exportOne(file: GeneratedFile): void;
  check(files: GeneratedFile[]): CheckIssue[];
}

/** Comprobaciones reales y baratas sobre el código generado. */
function checkFiles(files: GeneratedFile[]): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const f of files) {
    const text = f.content;
    if (!text.trim()) {
      issues.push({ path: f.path, level: "error", message: "El archivo está vacío." });
      continue;
    }
    if (/\.\.\.\s*(resto del código|etc\.?)/i.test(text) || /\/\/\s*TODO/i.test(text)) {
      issues.push({ path: f.path, level: "aviso", message: "Contiene código incompleto o pendiente." });
    }
    const pairs: Array<[string, string]> = [["{", "}"], ["(", ")"], ["[", "]"]];
    for (const [open, close] of pairs) {
      const diff = text.split(open).length - text.split(close).length;
      if (diff !== 0) {
        issues.push({ path: f.path, level: "error", message: `Faltan símbolos «${diff > 0 ? close : open}».` });
      }
    }
    if (/\.html?$/i.test(f.path)) {
      if (!/<meta[^>]+viewport/i.test(text)) {
        issues.push({ path: f.path, level: "aviso", message: "Sin etiqueta de adaptación a móvil." });
      }
      const buttons = text.match(/<button[\s>]/gi)?.length ?? 0;
      const handlers = text.match(/onclick=|addEventListener\(/gi)?.length ?? 0;
      if (buttons > 0 && handlers === 0) {
        issues.push({ path: f.path, level: "aviso", message: "Hay botones sin ninguna acción." });
      }
    }
  }
  return issues;
}

class LocalFileService implements FileService {
  async exportZip(projectName: string, files: GeneratedFile[]) {
    if (!files.length) return fail<number>("Todavía no hay archivos generados que exportar.");
    const entries: ZipEntry[] = files.map((f) => ({ path: f.path, content: f.content }));
    entries.push({
      path: "README.md",
      content: `# ${projectName}\n\nProyecto generado con WILLY AI en tu equipo.\n\nArchivos: ${files.length}\nFecha: ${new Date().toLocaleString("es-ES")}\n`,
    });
    const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "proyecto";
    await downloadZip(`${slug}.zip`, entries);
    return ok(entries.length);
  }

  exportOne(file: GeneratedFile) {
    downloadFile(file.path.split("/").pop() ?? "archivo.txt", file.content);
  }

  check(files: GeneratedFile[]) {
    return checkFiles(files);
  }
}

export const fileService: FileService = new LocalFileService();
