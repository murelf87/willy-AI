// Lee una página web desde el servidor (el navegador no puede por seguridad) y devuelve su texto limpio
// para traducirlo o resumirlo. También busca en internet y lee las mejores páginas para que la IA local
// responda con fuentes. Solo abre direcciones públicas de internet.

import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import { askWeb, safeGet } from "@/lib/web-fetch";
import { htmlToText, titleOf } from "@/lib/web-search";
import { runConnector } from "@/lib/data-connectors";
import { createRateLimiter } from "@/lib/rate-limit";

/** Límite de búsquedas por minuto, para que un fallo no dispare cientos de peticiones a los buscadores. */
const tooMany = createRateLimiter(20);

/** Límite de consultas a fuentes de datos por minuto (las fuentes gratuitas piden educación). */
const tooManyData = createRateLimiter(40);

export const Route = createFileRoute("/api/fetch-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;

        let body: { url?: unknown; ask?: unknown; connector?: unknown; params?: unknown };
        try {
          body = (await request.json()) as { url?: unknown; ask?: unknown; connector?: unknown; params?: unknown };
        } catch {
          return Response.json({ error: "Petición no válida." }, { status: 400 });
        }

        // Fuentes de datos en tiempo real (tiempo, divisas, terremotos, precio de la luz…): cada una solo puede abrir SUS direcciones
        // (lista cerrada) y siempre a través de la lectura segura de direcciones públicas.
        if (typeof body.connector === "string") {
          if (tooManyData()) return Response.json({ error: "Demasiadas consultas seguidas. Espera un minuto." }, { status: 429 });
          const result = await runConnector(body.connector, body.params, {
            get: async (url) => {
              const page = await safeGet(url, "application/json,application/xml,text/xml,text/csv,text/plain,*/*");
              return { status: page.status, body: page.body };
            },
          });
          if (!result.ok) return Response.json({ error: result.error }, { status: 502 });
          return Response.json({ ok: true, source: result.name, fetchedAt: result.fetchedAt, cached: result.cached, pages: [result.page] });
        }

        // Buscar en internet y leer las mejores páginas.
        if (typeof body.ask === "string") {
          const query = body.ask.trim().slice(0, 200);
          if (query.length < 3) return Response.json({ error: "Escribe qué quieres buscar." }, { status: 400 });
          if (tooMany()) return Response.json({ error: "Demasiadas búsquedas seguidas. Espera un minuto." }, { status: 429 });
          try {
            const found = await askWeb(query);
            if (!found.results.length) {
              return Response.json({ error: "No he podido obtener resultados de internet ahora mismo (¿hay conexión?). Prueba de nuevo en un momento." }, { status: 502 });
            }
            return Response.json(found);
          } catch {
            return Response.json({ error: "La búsqueda en internet ha fallado." }, { status: 502 });
          }
        }

        // Leer una dirección concreta.
        const url = typeof body.url === "string" ? body.url.trim() : "";
        if (!/^https?:\/\//i.test(url)) {
          return Response.json({ error: "Pega un enlace que empiece por http:// o https://" }, { status: 400 });
        }
        try {
          const page = await safeGet(url, "text/html,text/plain,*/*");
          if (page.status < 200 || page.status >= 300) return Response.json({ error: `La página ha respondido ${page.status}.` }, { status: 502 });
          const isHtml = page.type.includes("text/html");
          const text = isHtml ? htmlToText(page.body) : page.body.trim();
          if (!text) return Response.json({ error: "Esa página no tiene texto legible." }, { status: 422 });
          return Response.json({ title: (isHtml ? titleOf(page.body) : "") || url, text: text.slice(0, 120000), url: page.url });
        } catch (error) {
          const message = error instanceof Error && /no permitida/i.test(error.message) ? "Esa dirección no está permitida." : "No se ha podido abrir ese enlace.";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
