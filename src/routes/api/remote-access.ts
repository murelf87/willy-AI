import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import {
  decideOwnRemoteApproval,
  ownRemoteApprovals,
  remoteAccessStatus,
  startDesktopCommanderRemote,
  startOwnRemoteAgent,
  startWillyRemote,
  stopDesktopCommanderRemote,
  stopOwnRemoteAgent,
  stopWillyRemote,
  testOwnRemoteAgent,
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
        try { body = await request.json() as { action?: unknown; id?: unknown }; } catch { /* vacío */ }

        const action = String(body.action ?? "");
        try {
          if (action === "start-agent") {
            const result = await startOwnRemoteAgent();
            return Response.json({ ...result, status: await remoteAccessStatus() }, { status: result.ok ? 200 : 400 });
          }
          if (action === "stop-agent") {
            const result = await stopOwnRemoteAgent();
            return Response.json({ ...result, status: await remoteAccessStatus() }, { status: result.ok ? 200 : 400 });
          }
          if (action === "test-agent") {
            const result = await testOwnRemoteAgent();
            return Response.json({ ok: true, result, status: await remoteAccessStatus() });
          }
          if (action === "agent-approvals") {
            return Response.json({ ok: true, approvals: await ownRemoteApprovals(), status: await remoteAccessStatus() });
          }
          if (action === "agent-approve" || action === "agent-deny") {
            const id = String(body.id ?? "");
            if (!id) return Response.json({ ok: false, error: "Falta el ID de aprobación." }, { status: 400 });
            const result = await decideOwnRemoteApproval(id, action === "agent-approve");
            return Response.json({ ok: true, result, approvals: await ownRemoteApprovals(), status: await remoteAccessStatus() });
          }

          const result = action === "start-desktop"
            ? await startDesktopCommanderRemote()
            : action === "stop-desktop"
              ? await stopDesktopCommanderRemote()
              : action === "start-willy"
                ? await startWillyRemote()
                : action === "stop-willy"
                  ? await stopWillyRemote()
                  : { ok: false, error: "Acción remota desconocida." };

          return Response.json(
            { ...result, status: await remoteAccessStatus() },
            { status: result.ok ? 200 : 400 },
          );
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : String(error), status: await remoteAccessStatus() },
            { status: 500 },
          );
        }
      },
    },
  },
});
