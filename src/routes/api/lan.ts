import { createFileRoute } from "@tanstack/react-router";
import os from "node:os";

/**
 * Devuelve la dirección local del ordenador (Wi-Fi de casa) para que el móvil
 * pueda conectarse al WILLY AI del PC por la misma red.
 */
export const Route = createFileRoute("/api/lan")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const port = new URL(request.url).port || process.env["APP_PORT"] || "3000";
        let lan = "";
        try {
          const nets = os.networkInterfaces();
          for (const list of Object.values(nets)) {
            for (const net of list ?? []) {
              if (net.family === "IPv4" && !net.internal) {
                if (net.address.startsWith("192.168.") || net.address.startsWith("10.")) lan = net.address;
              }
            }
          }
          if (!lan) {
            for (const list of Object.values(nets)) {
              for (const net of list ?? []) {
                if (net.family === "IPv4" && !net.internal) lan = net.address;
              }
            }
          }
        } catch {
          /* sin acceso a las tarjetas de red */
        }
        return Response.json(
          { lan, port, url: lan ? `http://${lan}:${port}/movil` : "" },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
