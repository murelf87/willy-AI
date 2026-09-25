// Estudio de avatar: motores locales (ComfyUI, Piper) para crear un vídeo con tu cara y tu voz. Todo ocurre en este equipo.
import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import { avatarAction } from "@/lib/avatar-server";
import { createRateLimiter } from "@/lib/rate-limit";
import { privateDataDir } from "@/lib/project-root";

const tooMany = createRateLimiter(240);

export const Route = createFileRoute("/api/avatar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        if (tooMany()) return Response.json({ error: "Demasiadas peticiones seguidas." }, { status: 429 });
        if (Number(request.headers.get("content-length") ?? 0) > 200 * 2 ** 20) return Response.json({ error: "Los archivos son demasiado grandes." }, { status: 413 });
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "Petición no válida." }, { status: 400 });
        }
        try {
          const result = await avatarAction(await privateDataDir(), body && typeof body === "object" ? body : {});
          if (result.file) return new Response(result.file.bytes as BodyInit, { headers: { "Content-Type": result.file.mime, "Content-Disposition": `attachment; filename="${result.file.name}"`, "Cache-Control": "no-store" } });
          return Response.json(result, { status: result.error ? 400 : 200 });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Error inesperado." }, { status: 500 });
        }
      },
    },
  },
});
