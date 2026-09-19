// Compatibilidad: la voz se genera localmente con las voces españolas de Windows.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async () => new Response(
        JSON.stringify({ error: "La voz se reproduce localmente en el dispositivo." }),
        { status: 410, headers: { "Content-Type": "application/json" } },
      ),
    },
  },
});
