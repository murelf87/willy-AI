import { useEffect, useState } from "react";
import { ClipboardCopy, Download, FileCheck2, Loader2, Package, RefreshCw, ShieldCheck } from "lucide-react";
import { ClarifyButton } from "@/components/clarify-button";
import { Button } from "@/components/ui/button";
import { claudeMessage, collectClientState, downloadStatePack, fetchPreview } from "@/lib/state-client";
import type { Preview } from "@/lib/state-pack";
import { usePersistentState } from "@/lib/persistent-state";
import { useViewActive } from "@/lib/view-active";
import { useSettings } from "@/lib/workspace-store";

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;

/**
 * «Continuar el desarrollo»: un único .zip con el código actual (con lo que haya cambiado la Autoconstrucción), qué ha
 * cambiado desde la versión oficial, las mejoras hechas con la propia web y el estado del equipo, para pasárselo a Claude
 * y que continúe exactamente desde donde está tu plataforma.
 */
export function StatePackCard({ ping }: { ping: (message: string) => void }) {
  const [settings] = useSettings();
  const [notes, setNotes] = usePersistentState("estado:siguiente-fase", "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useViewActive();

  const refresh = async () => {
    setLoading(true);
    setPreview(await fetchPreview());
    setLoading(false);
  };
  useEffect(() => {
    if (active) void refresh();
  }, [active]);

  const download = async () => {
    setBusy(true);
    const result = await downloadStatePack(collectClientState(notes, { endpoint: settings.endpoint, model: settings.model, agents: settings.agents, tools: settings.tools, project: settings.project }));
    setBusy(false);
    ping(result.ok ? `Paquete «${result.name}» descargado (${mb(result.size)}). Súbelo a la conversación con Claude.` : `⚠️ ${result.error}`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(claudeMessage(preview, notes));
      ping("Mensaje copiado. Pégalo en la conversación con Claude junto con el paquete.");
    } catch {
      ping("No pude copiar el mensaje al portapapeles.");
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Package className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Continuar el desarrollo</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Descarga de una vez todo lo que Claude necesita para seguir mejorando WILLY AI justo desde donde está tu plataforma: el código actual (incluidas las mejoras que hayas hecho con la propia web), qué ha cambiado respecto a la versión oficial y el estado de tu equipo.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => void refresh()} disabled={loading} aria-label="Actualizar el resumen" title="Actualizar el resumen">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
      </div>

      <div className="mt-3 rounded-md border border-border bg-background p-3 text-xs leading-5">
        {preview ? (
          <>
            <p><span className="font-semibold">Código instalado:</span> {preview.sourceVersion || "desconocido"} · {preview.files} archivos ({mb(preview.bytes)})</p>
            {preview.hasRelease ? (
              <p><span className="font-semibold">Frente a la versión oficial {preview.releaseVersion}:</span> {preview.modified} modificado(s) · {preview.added} añadido(s) · {preview.removed} que faltan{preview.modified + preview.added + preview.removed === 0 ? " (todo igual: aún no has cambiado nada con la web)" : " (lo que has cambiado con la web)"}</p>
            ) : (
              <p className="text-muted-foreground">Esta instalación aún no tiene la referencia de la versión oficial: se incluye igualmente todo el código, pero no se puede señalar qué se ha modificado.</p>
            )}
            <p><span className="font-semibold">Copias de mejoras hechas con la web:</span> {preview.backups}</p>
          </>
        ) : (
          <p className="text-muted-foreground">{loading ? "Leyendo el estado de la instalación…" : "No se pudo leer el estado de la instalación. Aun así puedes descargar el paquete."}</p>
        )}
        <p className="mt-2 flex items-start gap-1.5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><span><span className="font-semibold text-foreground">Incluye:</span> código, comparación con la versión oficial, mejoras de la Autoconstrucción, diario de mejoras, versión de Ollama y modelos, memoria y tarjeta gráfica, registro del actualizador y lo que escribas abajo. <span className="font-semibold text-foreground">No incluye</span> tus conversaciones, tus proyectos, ni claves o contraseñas (tampoco las de los motores en la nube).</span></p>
      </div>

      <label className="mt-3 block text-xs">
        <span className="mb-1 block font-semibold">Qué quieres hacer en la siguiente fase (opcional)</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          placeholder="Ej.: quiero que el chat recuerde mis proyectos, y que la Autoconstrucción pueda deshacer una mejora con un clic."
          className="w-full resize-y rounded-md border border-border bg-background p-2 leading-5 outline-none focus:border-primary"
        />
      </label>
      <div className="mt-1"><ClarifyButton context="prompt" compact variant="secondary" label="Que la IA lo entienda exactamente" value={notes} onApply={setNotes} /></div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" className="gap-2" disabled={busy} onClick={() => void download()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}{busy ? "Preparando…" : "Descargar paquete"}</Button>
        <Button type="button" variant="secondary" className="gap-2" onClick={() => void copy()}><ClipboardCopy className="size-4" />Copiar mensaje para Claude</Button>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileCheck2 className="size-4 text-primary" />Un único .zip: súbelo tal cual a la conversación</span>
      </div>
    </section>
  );
}
