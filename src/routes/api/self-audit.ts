import { createFileRoute } from "@tanstack/react-router";
import { projectRoot } from "@/lib/project-root";
import { runTypeCheck, checkFile } from "@/lib/self-audit";

// Endpoint de autoauditoría: la IA local puede detectar errores TypeScript
// sin intervención humana desde la pestaña Autoconstrucción.

function rejectForeignRequest(request: Request): string | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "Petición bloqueada: procede de otra página web.";
  if (!site) {
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        return "Petición bloqueada: origen no válido.";
      }
      const host = request.headers.get("host") ?? new URL(request.url).host;
      if (originHost !== host) return "Petición bloqueada: procede de otra página web.";
    }
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return "Petición bloqueada: formato no permitido.";
  return null;
}

type IncomingBody = { action?: unknown; file?: unknown };

export const Route = createFileRoute("/api/self-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const foreign = rejectForeignRequest(request);
        if (foreign) return Response.json({ ok: false, error: foreign }, { status: 403 });

        let body: IncomingBody;
        try {
          body = (await request.json()) as IncomingBody;
        } catch {
          return Response.json({ ok: false, error: "Petición no válida." }, { status: 400 });
        }

        const root = await projectRoot();
        if (!root) return Response.json({ ok: false, error: "No se encontró la instalación editable de WILLY AI." }, { status: 503 });

        if (body.action === "type-check") {
          try {
            const result = await runTypeCheck(root);
            return Response.json({ ok: true, audit: result });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "Error al ejecutar la comprobación de tipos." }, { status: 500 });
          }
        }

        if (body.action === "check-file") {
          const filePath = typeof body.file === "string" ? body.file.trim() : "";
          if (!filePath) return Response.json({ ok: false, error: "Indica el archivo a comprobar." }, { status: 400 });
          try {
            const result = await checkFile(root, filePath);
            return Response.json({ ok: true, audit: result });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "Error al comprobar el archivo." }, { status: 500 });
          }
        }

        return Response.json({ ok: false, error: `Acción desconocida: ${String(body.action)}` }, { status: 400 });
      },
    },
  },
});
