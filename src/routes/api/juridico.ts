import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import {
  fetchOfficialLegalDocument,
  getBoeAuxTable,
  getBoeDailySummary,
  getBoeLegislationText,
  getBojaText,
  getEuDocumentByCelex,
  legalServerStatus,
  legalSourceCatalog,
  loadLegalCases,
  officialLegalLinks,
  saveLegalCases,
  searchBoeLegislation,
  searchBoja,
  searchEuCaseLaw,
  searchEuLegislation,
} from "@/lib/juridico-server";

export const Route = createFileRoute("/api/juridico")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        return Response.json(
          { ok: true, status: legalServerStatus(), sources: legalSourceCatalog() },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        let body: Record<string, unknown> = {};
        try {
          body = await request.json() as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, error: "Petición no válida." }, { status: 400 });
        }

        const action = String(body["action"] ?? "");
        try {
          if (action === "boe-search") {
            const query = String(body["query"] ?? "").trim();
            const results = await searchBoeLegislation(query, Number(body["limit"] ?? 8));
            return Response.json({ ok: true, results, links: officialLegalLinks(query) }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "boe-text") {
            const result = await getBoeLegislationText(String(body["id"] ?? ""));
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "boja-search") {
            const query = String(body["query"] ?? "").trim();
            const results = await searchBoja(query, Number(body["limit"] ?? 10));
            return Response.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "boja-text") {
            const result = await getBojaText(String(body["id"] ?? ""));
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "eu-law-search") {
            const query = String(body["query"] ?? "").trim();
            const results = await searchEuLegislation(query, Number(body["limit"] ?? 10));
            return Response.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "eu-case-search") {
            const query = String(body["query"] ?? "").trim();
            const results = await searchEuCaseLaw(query, Number(body["limit"] ?? 10));
            return Response.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "eu-celex-text") {
            const result = await getEuDocumentByCelex(String(body["celex"] ?? ""));
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "boe-summary") {
            const result = await getBoeDailySummary(String(body["date"] ?? ""), false);
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "borme-summary") {
            const result = await getBoeDailySummary(String(body["date"] ?? ""), true);
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "boe-aux") {
            const result = await getBoeAuxTable(String(body["name"] ?? ""));
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "official-links") {
            const query = String(body["query"] ?? "").trim();
            return Response.json({ ok: true, links: officialLegalLinks(query) }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "official-document") {
            const result = await fetchOfficialLegalDocument(String(body["url"] ?? ""));
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "source-catalog") {
            return Response.json({ ok: true, sources: legalSourceCatalog() }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "cases-load") {
            return Response.json({ ok: true, cases: await loadLegalCases() }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "cases-save") {
            const saved = await saveLegalCases(body["cases"]);
            return Response.json({ ok: true, saved }, { headers: { "Cache-Control": "no-store" } });
          }

          return Response.json({ ok: false, error: "Acción jurídica desconocida." }, { status: 400 });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            { status: 502 },
          );
        }
      },
    },
  },
});
