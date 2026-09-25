// Voces naturales (Piper y las más humanas): descargar motores y voces, y generar el audio para leer documentos en voz alta.
import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import { voicesAction } from "@/lib/voices-server";
import { createRateLimiter } from "@/lib/rate-limit";
import { privateDataDir } from "@/lib/project-root";

const tooMany = createRateLimiter(900);
/** Cabe una grabación de tu voz para Chatterbox (hasta 12 MB, que en base64 son ≈ 16 MB). */
const MAX_BODY = 17 * 2 ** 20;

export const Route = createFileRoute("/api/voces")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        if (tooMany()) return Response.json({ error: "Demasiadas peticiones seguidas." }, { status: 429 });
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "Petición demasiado grande." }, { status: 413 });
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "Petición no válida." }, { status: 400 });
        }
        try {
          const result = await voicesAction(await privateDataDir(), body && typeof body === "object" ? body : {});
          if (result.file) return new Response(result.file.bytes as BodyInit, { headers: { "Content-Type": result.file.mime, "Cache-Control": "no-store" } });
          return Response.json(result, { status: result.error ? 400 : 200 });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Error inesperado." }, { status: 500 });
        }
      },
    },
  },
});
