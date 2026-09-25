import { createFileRoute } from "@tanstack/react-router";
import { projectsGet, projectsPost } from "@/lib/project-api-server";
import { projectsBase } from "@/lib/project-store-server";

// Proyectos guardados en el equipo (revisión 19): la única fuente de verdad de Proyectos, SUPER WILLY y el Chat.
// Solo responde a la propia interfaz de WILLY (nunca a otra página web abierta en el navegador). La lógica está en
// lib/project-api-server (probada sin arrancar WILLY) y los datos, en lib/project-store-server.

export const Route = createFileRoute("/api/proyectos")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => projectsGet(request, await projectsBase()),
      POST: async ({ request }: { request: Request }) => projectsPost(request, await projectsBase()),
    },
  },
});
