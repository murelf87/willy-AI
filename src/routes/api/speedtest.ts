import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import { measureDownload, measureLatency, measureUpload, networkInfo, qualitySummary } from "@/lib/speedtest-server";

export const Route = createFileRoute("/api/speedtest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        return Response.json({ ok: true, info: await networkInfo() }, { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        let body: Record<string, unknown> = {};
        try { body = await request.json() as Record<string, unknown>; } catch { /* vacío */ }
        const action = String(body["action"] ?? "");
        try {
          if (action === "info") return Response.json({ ok: true, info: await networkInfo() }, { headers: { "Cache-Control": "no-store" } });
          if (action === "latency") return Response.json({ ok: true, result: await measureLatency(Number(body["samples"] ?? 10)) }, { headers: { "Cache-Control": "no-store" } });
          if (action === "download") return Response.json({ ok: true, result: await measureDownload() }, { headers: { "Cache-Control": "no-store" } });
          if (action === "upload") return Response.json({ ok: true, result: await measureUpload() }, { headers: { "Cache-Control": "no-store" } });
          if (action === "quality") {
            const result = qualitySummary({
              download: Number(body["download"] ?? 0),
              upload: Number(body["upload"] ?? 0),
              latency: Number(body["latency"] ?? 0),
              jitter: Number(body["jitter"] ?? 0),
              loss: body["loss"] == null ? null : Number(body["loss"]),
            });
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          return Response.json({ ok: false, error: "Acción de velocidad desconocida." }, { status: 400 });
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
        }
      },
    },
  },
});
