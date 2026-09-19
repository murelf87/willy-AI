// Lee una página web desde el servidor (el navegador no puede por seguridad)
// y devuelve su texto limpio para traducirlo o resumirlo.

import { createFileRoute } from "@tanstack/react-router";

function toPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleOf(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1]!.replace(/\s+/g, " ").trim() : "";
}

export const Route = createFileRoute("/api/fetch-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let url = "";
        try {
          const body = (await request.json()) as { url?: string };
          url = (body.url ?? "").trim();
        } catch {
          return Response.json({ error: "Petición no válida." }, { status: 400 });
        }

        if (!/^https?:\/\//i.test(url)) {
          return Response.json({ error: "Pega un enlace que empiece por http:// o https://" }, { status: 400 });
        }

        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; WillyAI/1.0)", Accept: "text/html,text/plain,*/*" },
            redirect: "follow",
          });
          if (!res.ok) {
            return Response.json({ error: `La página ha respondido ${res.status}.` }, { status: 502 });
          }
          const type = res.headers.get("content-type") ?? "";
          const raw = await res.text();
          const text = type.includes("text/html") ? toPlainText(raw) : raw.trim();
          if (!text) return Response.json({ error: "Esa página no tiene texto legible." }, { status: 422 });
          return Response.json({ title: titleOf(raw) || url, text: text.slice(0, 120000), url });
        } catch {
          return Response.json({ error: "No se ha podido abrir ese enlace." }, { status: 502 });
        }
      },
    },
  },
});
