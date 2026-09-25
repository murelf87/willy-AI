import { createFileRoute } from "@tanstack/react-router";
import { recentServerErrors } from "@/lib/error-capture";
import { sistemaGet, sistemaPost } from "@/lib/maintenance-api-server";

// Ajustes y Centro de Inteligencia (revisión 20): estado de WILLY, reiniciar y detener de verdad, almacenamiento, caché,
// registros sin claves, diagnóstico y la IA del equipo (Ollama). Solo responde a la propia interfaz de WILLY. La lógica
// está en lib/maintenance-server (probada sin arrancar WILLY) y la validación de cada petición, en lib/maintenance-api-server.

export const Route = createFileRoute("/api/sistema")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => sistemaGet(request, { recentErrors: recentServerErrors }),
      POST: async ({ request }: { request: Request }) => sistemaPost(request, { recentErrors: recentServerErrors }),
    },
  },
});
