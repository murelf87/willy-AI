import { createFileRoute } from "@tanstack/react-router";

/**
 * GET  /api/remote-status  → { running: boolean, clients: number, code?: string }
 * POST /api/remote-status  → arranca el servidor remoto si no está corriendo
 */
export const Route = createFileRoute("/api/remote-status")({
  server: {
    handlers: {
      GET: async () => {
        try {
          // Comprobar si el servidor remoto responde en :4040/health
          const res = await fetch("http://127.0.0.1:4040/health", {
            signal: AbortSignal.timeout(1500),
          });
          if (res.ok) {
            const data = (await res.json()) as { ok: boolean; clients: number };
            return Response.json({ running: true, clients: data.clients ?? 0 });
          }
        } catch {
          // No responde → no está corriendo
        }
        return Response.json({ running: false, clients: 0 });
      },

      POST: async () => {
        // Intentar arrancar el servidor remoto
        try {
          // Primero comprobar si ya está corriendo
          const check = await fetch("http://127.0.0.1:4040/health", {
            signal: AbortSignal.timeout(1000),
          }).catch(() => null);

          if (check?.ok) {
            return Response.json({ ok: true, started: false, message: "El servidor ya estaba activo." });
          }

          // Intentar arrancar usando Node.js child_process
          const { spawn } = await import("node:child_process");
          const path = await import("node:path");
          const fs = await import("node:fs");

          const candidates = [
            path.join(process.cwd(), "willy-remote-server.mjs"),
          ];

          const scriptPath = candidates.find((p) => fs.existsSync(p));
          if (!scriptPath) {
            return Response.json({ ok: false, message: "Script willy-remote-server.mjs no encontrado en el directorio raíz." }, { status: 404 });
          }

          const child = spawn(process.execPath, [scriptPath], {
            detached: true,
            stdio: "ignore",
            env: { ...process.env, REMOTE_PORT: "4040" },
          });
          child.unref();

          // Esperar hasta 3s a que arranque
          for (let i = 0; i < 6; i++) {
            await new Promise((r) => setTimeout(r, 500));
            const ready = await fetch("http://127.0.0.1:4040/health", {
              signal: AbortSignal.timeout(500),
            }).catch(() => null);
            if (ready?.ok) {
              return Response.json({ ok: true, started: true, message: "Servidor remoto arrancado correctamente." });
            }
          }

          return Response.json({ ok: false, message: "El servidor tardó demasiado en arrancar. Prueba a ejecutarlo manualmente: node willy-remote-server.mjs" }, { status: 500 });
        } catch (err) {
          return Response.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, { status: 500 });
        }
      },
    },
  },
});
