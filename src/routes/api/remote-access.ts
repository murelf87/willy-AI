import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import {
  approveWillyAgent,
  denyWillyAgent,
  remoteAccessStatus,
  startDesktopCommanderRemote,
  startWillyAgent,
  startWillyRemote,
  stopDesktopCommanderRemote,
  stopWillyAgent,
  stopWillyRemote,
} from "@/lib/remote-access-server";

export const Route = createFileRoute("/api/remote-access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        return Response.json(
          { ok: true, status: await remoteAccessStatus() },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        let body: { action?: unknown; id?: unknown } = {};
        try { body = (await request.json()) as { action?: unknown; id?: unknown }; } catch { /* vacío */ }
        const action = String(body.action ?? "");
        const id = String(body.id ?? "");
        const result = action === "start-agent" ? await startWillyAgent()
          : action === "stop-agent" ? await stopWillyAgent()
          : action === "approve-agent" ? await approveWillyAgent(id)
          : action === "deny-agent" ? await denyWillyAgent(id)
          : action === "start-desktop" ? await startDesktopCommanderRemote()
          : action === "stop-desktop" ? await stopDesktopCommanderRemote()
          : action === "start-willy" ? await startWillyRemote()
          : action === "stop-willy" ? await stopWillyRemote()
          : { ok: false, error: "Acción remota desconocida." };
        return Response.json(
          { ...result, status: await remoteAccessStatus() },
          { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
