import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import { remoteAccessStatus, startDesktopCommanderRemote, startWillyRemote, stopDesktopCommanderRemote, stopWillyRemote } from "@/lib/remote-access-server";

export const Route = createFileRoute("/api/remote-access")({
  server: { handlers: {
    GET: async ({ request }) => {
      const blocked = blockForeignSite(request);
      if (blocked) return blocked;
      return Response.json({ ok: true, status: await remoteAccessStatus() }, { headers: { "Cache-Control": "no-store" } });
    },
    POST: async ({ request }) => {
      const blocked = blockForeignSite(request);
      if (blocked) return blocked;
      let body: { action?: unknown } = {};
      try { body = (await request.json()) as { action?: unknown }; } catch { /* vacío */ }
      const action = String(body.action ?? "");
      const result = action === "start-desktop" ? await startDesktopCommanderRemote()
        : action === "stop-desktop" ? await stopDesktopCommanderRemote()
        : action === "start-willy" ? await startWillyRemote()
        : action === "stop-willy" ? await stopWillyRemote()
        : { ok: false, error: "Acción remota desconocida." };
      return Response.json({ ...result, status: await remoteAccessStatus() }, { status: result.ok ? 200 : 400 });
    },
  } },
});
