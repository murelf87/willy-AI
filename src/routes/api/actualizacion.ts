// Aviso de actualización: dice qué versión está en marcha y si hay una nota de «ya se ha actualizado» sin aceptar.
import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import { APP_VERSION } from "@/lib/version";
import { sanitizeNotice, type Notice } from "@/lib/update-notice";
import { privateDataDir } from "@/lib/project-root";

const tabs = new Map<string, number>();

async function file(): Promise<string> {
  const path = await import("node:path");
  return path.join(await privateDataDir(), "actualizacion.json");
}

async function read(): Promise<Notice | null> {
  try {
    const fs = await import("node:fs/promises");
    return sanitizeNotice(JSON.parse(await fs.readFile(await file(), "utf8")));
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/actualizacion")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        const now = Date.now();
        const tab = new URL(request.url).searchParams.get("tab");
        if (tab && /^[\w-]{4,40}$/.test(tab)) tabs.set(tab, now);
        for (const [id, at] of tabs) if (now - at > 20_000) tabs.delete(id);
        const notice = await read();
        return Response.json({ version: APP_VERSION, notice: notice && !notice.ack ? notice : null, tabs: tabs.size }, { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        let body: { action?: string } = {};
        try { body = (await request.json()) as { action?: string }; } catch { /* vacío */ }
        if (body.action !== "ack") return Response.json({ error: "Acción desconocida." }, { status: 400 });
        const notice = await read();
        if (notice) {
          const fs = await import("node:fs/promises");
          const target = await file();
          await fs.writeFile(target, JSON.stringify({ ...notice, ack: true, ackAt: new Date().toISOString() }, null, 2), "utf8");
        }
        return Response.json({ ok: true });
      },
    },
  },
});
