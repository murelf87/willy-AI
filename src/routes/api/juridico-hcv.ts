import { createFileRoute } from '@tanstack/react-router'
import { blockForeignSite } from "@/lib/same-origin";
import {
  checkEnidocCsv,
  compareHcvArtifacts,
  createHcvForensicReport,
  createHcvPackage,
  hcvDownload,
  hcvForensicDownload,
  hcvStatus,
  storeHcvArtifact,
  type HcvArtifactKind,
} from "@/lib/juridico-hcv-server";

export const Route = createFileRoute("/api/juridico-hcv")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        const url = new URL(request.url);
        const caseId = url.searchParams.get("caseId") ?? "";
        const artifactId = url.searchParams.get("artifactId") ?? undefined;
        const packageId = url.searchParams.get("packageId") ?? undefined;
        const reportId = url.searchParams.get("reportId") ?? undefined;
        const reportFormat = url.searchParams.get("reportFormat") === "json" ? "json" as const : "html" as const;
        if (!caseId || (!artifactId && !packageId && !reportId)) {
          return Response.json({ ok: true, status: hcvStatus() }, { headers: { "Cache-Control": "no-store" } });
        }
        try {
          const result = reportId
            ? await hcvForensicDownload(caseId, reportId, reportFormat)
            : await hcvDownload(caseId, artifactId, packageId);
          return new Response(result.bytes, {
            headers: {
              "Content-Type": result.mime,
              "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`,
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 404 });
        }
      },
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        try {
          const contentType = request.headers.get("content-type") ?? "";
          if (contentType.includes("multipart/form-data")) {
            const form = await request.formData();
            const action = String(form.get("action") ?? "");
            if (action !== "upload") return Response.json({ ok: false, error: "Acción HCV no válida." }, { status: 400 });
            const file = form.get("file");
            if (!(file instanceof File)) return Response.json({ ok: false, error: "Falta el documento." }, { status: 400 });
            const caseId = String(form.get("caseId") ?? "");
            const kind = String(form.get("kind") ?? "aportado") as HcvArtifactKind;
            if (!["aportado","original-hcv","informe-hcv","metadatos-hcv","eni-hcv"].includes(kind)) {
              return Response.json({ ok: false, error: "Tipo de archivo HCV no válido." }, { status: 400 });
            }
            const text = String(form.get("text") ?? "");
            const artifact = await storeHcvArtifact({
              caseId,
              kind,
              name: file.name,
              mime: file.type,
              bytes: new Uint8Array(await file.arrayBuffer()),
              extractedText: text,
            });
            return Response.json({ ok: true, artifact, status: hcvStatus() }, { headers: { "Cache-Control": "no-store" } });
          }

          const body = await request.json() as Record<string, unknown>;
          const action = String(body["action"] ?? "");
          if (action === "status") return Response.json({ ok: true, status: hcvStatus() }, { headers: { "Cache-Control": "no-store" } });
          if (action === "compare") {
            const result = await compareHcvArtifacts(String(body["caseId"] ?? ""), String(body["sourceId"] ?? ""), String(body["officialId"] ?? ""));
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "package") {
            const ids = Array.isArray(body["artifactIds"]) ? (body["artifactIds"] as unknown[]).map(String).slice(0, 20) : [];
            const manifest = body["manifest"] && typeof body["manifest"] === "object" ? body["manifest"] as Record<string, unknown> : {};
            const result = await createHcvPackage(String(body["caseId"] ?? ""), ids, manifest);
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "forensic-report") {
            const ids = Array.isArray(body["artifactIds"]) ? (body["artifactIds"] as unknown[]).map(String).slice(0, 20) : [];
            const comparison = body["comparison"] && typeof body["comparison"] === "object" ? body["comparison"] as Record<string, unknown> : null;
            const result = await createHcvForensicReport({
              caseId: String(body["caseId"] ?? ""),
              artifactIds: ids,
              csv: String(body["csv"] ?? ""),
              officialResult: String(body["officialResult"] ?? "pending"),
              officialResultSource: body["officialResultSource"] == null ? null : String(body["officialResultSource"]),
              comparison,
            });
            return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
          }
          if (action === "enidoc-check") {
            const result = await checkEnidocCsv(String(body["csv"] ?? ""));
            return Response.json({ ok: result.ok, result, status: hcvStatus() }, { status: result.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } });
          }
          return Response.json({ ok: false, error: "Acción HCV desconocida." }, { status: 400 });
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
        }
      },
    },
  },
});
