import { useState } from "react";
import { Button } from "@/components/ui/button";
import { evidenceImageOf } from "@/lib/engines-client";
import { evidenceMarkdown, summarize, type EvidenceReport } from "@/lib/evidence";

const MARK = { ok: "✔", fallo: "✘", info: "•" } as const;
const TONE = { ok: "text-emerald-600", fallo: "text-destructive", info: "text-muted-foreground" } as const;

/** Las pruebas de que un cambio hace lo pedido: comprobaciones con su antes/después y, si hay navegador, las capturas. */
export function EvidencePanel({ report, request, ping }: { report: EvidenceReport; request: string; ping: (message: string) => void }) {
  const [images, setImages] = useState<{ before: string | null; after: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const stats = summarize(report.items);

  const loadImages = async () => {
    if (!report.screenshots) return;
    setLoading(true);
    const [before, after] = await Promise.all([evidenceImageOf(report.screenshots.backup, "antes.png"), evidenceImageOf(report.screenshots.backup, "despues.png")]);
    setImages({ before, after });
    setLoading(false);
  };

  const copy = async () => {
    const text = evidenceMarkdown(report, request);
    try {
      await navigator.clipboard.writeText(text);
      ping("Informe de evidencias copiado.");
    } catch {
      ping("No pude copiar el informe al portapapeles.");
    }
  };

  return (
    <details className="mt-3 rounded-md border border-border bg-background p-3 text-xs" open={stats.fallos > 0}>
      <summary className="cursor-pointer font-semibold">
        Evidencias: {stats.ok} comprobadas{stats.fallos ? ` · ${stats.fallos} fallos` : ""} · {stats.info} informativas
      </summary>
      <ul className="mt-2 space-y-1.5">
        {report.items.map((item, index) => (
          <li key={`${item.title}-${index}`} className="leading-5">
            <span className={`mr-1.5 font-bold ${TONE[item.status]}`}>{MARK[item.status]}</span>
            <span className="font-semibold">{item.title}</span> <span className="text-muted-foreground">— {item.detail}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {report.screenshots && !images && (
          <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={loading} onClick={() => void loadImages()}>
            {loading ? "Cargando…" : `Ver capturas antes / después (cambió el ${report.screenshots.changedPct} %)`}
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void copy()}>Copiar informe</Button>
      </div>
      {images && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([["Antes", images.before], ["Después", images.after]] as const).map(([title, src]) => (
            <figure key={title}>
              <figcaption className="mb-1 font-semibold">{title}</figcaption>
              {src ? <img src={src} alt={`Pantalla inicial: ${title.toLowerCase()}`} className="w-full rounded-md border border-border" /> : <p className="text-muted-foreground">No disponible.</p>}
            </figure>
          ))}
        </div>
      )}
      {report.engine && <p className="mt-2 text-muted-foreground">Motor: {report.engine}</p>}
    </details>
  );
}
