// Aviso de actualización: dice qué versión está en marcha y si hay una nota de «ya se ha actualizado» sin aceptar.
// También expone actualizaciones pendientes de confirmación (actualizacion-pendiente.json) para el diálogo previo a la instalación.
import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import { APP_VERSION } from "@/lib/version";
import { sanitizeNotice, type Notice, type PendingUpdate } from "@/lib/update-notice";
import { privateDataDir } from "@/lib/project-root";

const tabs = new Map<string, number>();

async function file(): Promise<string> {
  const path = await import("node:path");
  return path.join(await privateDataDir(), "actualizacion.json");
}

async function pendingFile(): Promise<string> {
  const path = await import("node:path");
  return path.join(await privateDataDir(), "actualizacion-pendiente.json");
}

async function read(): Promise<Notice | null> {
  try {
    const fs = await import("node:fs/promises");
    return sanitizeNotice(JSON.parse(await fs.readFile(await file(), "utf8")));
  } catch {
    return null;
  }
}

/** Lee la actualización pendiente de confirmación (escrita por el actualizador antes de instalar). */
async function readPending(): Promise<PendingUpdate | null> {
  try {
    const fs = await import("node:fs/promises");
    const raw = JSON.parse(await fs.readFile(await pendingFile(), "utf8")) as Record<string, unknown>;
    // Ya fue confirmada: el actualizador borra el archivo al instalar, pero si no lo borra se comprueba el campo.
    if (raw["confirmed"] === true || raw["cancelled"] === true) return null;
    const version = typeof raw["version"] === "string" ? raw["version"].trim().slice(0, 40) : "";
    if (!/^\d+\.\d+/.test(version)) return null;
    const label = typeof raw["label"] === "string" ? raw["label"].trim().slice(0, 200) : "";
    const at = typeof raw["at"] === "string" ? raw["at"].trim().slice(0, 40) : new Date().toISOString();
    return { version, label, at };
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
        const pendingUpdate = await readPending();
        return Response.json({ version: APP_VERSION, notice: notice && !notice.ack ? notice : null, pendingUpdate: pendingUpdate ?? null, tabs: tabs.size }, { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        let body: { action?: string } = {};
        try { body = (await request.json()) as { action?: string }; } catch { /* vacío */ }
        if (body.action === "confirm-update") {
          // El usuario ha aceptado instalar la actualización pendiente: se marca como confirmada en el archivo.
          try {
            const fs = await import("node:fs/promises");
            const target = await pendingFile();
            const raw = JSON.parse(await fs.readFile(target, "utf8")) as Record<string, unknown>;
            await fs.writeFile(target, JSON.stringify({ ...raw, confirmed: true, confirmedAt: new Date().toISOString() }, null, 2), "utf8");
          } catch { /* el archivo ya no existe o no se puede escribir */ }
          return Response.json({ ok: true });
        }
        if (body.action === "cancel-update") {
          // El usuario ha cancelado: se marca como cancelada para que no vuelva a aparecer hasta la próxima comprobación.
          try {
            const fs = await import("node:fs/promises");
            const target = await pendingFile();
            const raw = JSON.parse(await fs.readFile(target, "utf8")) as Record<string, unknown>;
            await fs.writeFile(target, JSON.stringify({ ...raw, cancelled: true, cancelledAt: new Date().toISOString() }, null, 2), "utf8");
          } catch { /* el archivo ya no existe */ }
          return Response.json({ ok: true });
        }
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
