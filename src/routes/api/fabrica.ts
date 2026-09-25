// Fábrica de instaladores: convierte un proyecto con el formato de programa de escritorio en un instalador de Windows y lo
// prueba de verdad en este equipo (instalar, arrancar, pruebas de aceptación aisladas y desinstalar). Todo ocurre aquí.
import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import { projectRoot } from "@/lib/project-root";
import { createRateLimiter } from "@/lib/rate-limit";
import { builtInstaller, currentFactoryJob, defaultTools, factoryJob, lastFactoryReport, startFactoryJob } from "@/lib/installer-factory";
import type { ProjectFile } from "@/lib/desktop-format";

const tooMany = createRateLimiter(240);
const MAX_BODY = 80 * 1024 * 1024;

/** Content-Disposition con el nombre real del instalador (acentos incluidos) y una alternativa sin acentos. */
function attachment(name: string): string {
  const ascii = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const Route = createFileRoute("/api/fabrica")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        const root = await projectRoot();
        if (!root) return Response.json({ ok: false, error: "No se encontró la instalación de WILLY AI." }, { status: 503 });
        const url = new URL(request.url);
        const descargar = url.searchParams.get("descargar");
        if (descargar) {
          const built = await builtInstaller(root, descargar);
          if (!built) return Response.json({ ok: false, error: "Todavía no hay instalador de este proyecto." }, { status: 404 });
          const fs = await import("node:fs/promises");
          const data = await fs.readFile(built.file);
          return new Response(new Uint8Array(data), {
            headers: { "Content-Type": "application/octet-stream", "Content-Disposition": attachment(built.name), "Content-Length": String(data.length), "Cache-Control": "no-store" },
          });
        }
        const trabajo = url.searchParams.get("trabajo");
        if (trabajo) {
          const job = factoryJob(trabajo);
          return job ? Response.json({ ok: true, trabajo: job }) : Response.json({ ok: false, error: "Ese trabajo ya no existe (WILLY se reinició)." }, { status: 404 });
        }
        const proyecto = url.searchParams.get("proyecto");
        if (proyecto) {
          const running = currentFactoryJob();
          return Response.json({ ok: true, informe: await lastFactoryReport(root, proyecto), trabajo: running && running.projectId === proyecto && !running.done ? running : null });
        }
        const tools = await defaultTools(root);
        return Response.json({ ok: true, windows: tools.windows, compilador: Boolean(tools.makensis), motor: Boolean(tools.motor) });
      },

      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        if (tooMany()) return Response.json({ ok: false, error: "Demasiadas peticiones seguidas." }, { status: 429 });
        if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return Response.json({ ok: false, error: "Formato no permitido." }, { status: 415 });
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ ok: false, error: "El proyecto es demasiado grande para empaquetarlo." }, { status: 413 });
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, error: "Petición no válida." }, { status: 400 });
        }
        if (body["accion"] !== "fabricar") return Response.json({ ok: false, error: "Acción desconocida." }, { status: 400 });
        const projectId = String(body["proyecto"] ?? "").slice(0, 120);
        const name = String(body["nombre"] ?? "").trim().slice(0, 120);
        const raw = Array.isArray(body["archivos"]) ? (body["archivos"] as unknown[]) : [];
        if (!projectId || !name) return Response.json({ ok: false, error: "Falta el proyecto o su nombre." }, { status: 400 });
        if (!raw.length || raw.length > 5000) return Response.json({ ok: false, error: "El proyecto no tiene archivos que empaquetar." }, { status: 400 });
        const files: ProjectFile[] = [];
        for (const item of raw) {
          if (!item || typeof item !== "object") continue;
          const f = item as Record<string, unknown>;
          if (typeof f["path"] === "string" && typeof f["content"] === "string") files.push({ path: f["path"], content: f["content"] });
        }
        const root = await projectRoot();
        if (!root) return Response.json({ ok: false, error: "No se encontró la instalación de WILLY AI." }, { status: 503 });
        const tools = await defaultTools(root);
        const description = typeof body["descripcion"] === "string" ? body["descripcion"].slice(0, 300) : "";
        const editor = typeof body["editor"] === "string" ? body["editor"].slice(0, 80) : "";
        const started = startFactoryJob(root, { projectId, name, files, ...(description ? { description } : {}), ...(editor ? { editor } : {}) }, tools);
        return Response.json(started, { status: started.ok ? 200 : 409 });
      },
    },
  },
});
