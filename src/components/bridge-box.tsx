import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SITES, packFor } from "@/lib/bridge";
import { applyExternalAnswer } from "@/lib/self-build-runner";
import type { WillyImprovement } from "@/lib/self-build-store";
import { downloadFile } from "@/lib/workspace-store";
import { APP_VERSION } from "@/lib/version";

/** Usar otra IA (ChatGPT, Claude, Gemini, Grok, Perplexity…) a mano: WILLY prepara el paquete, tú pegas la respuesta y WILLY la aplica con pruebas. */
export function BridgeBox({ item, ping }: { item: WillyImprovement; ping: (message: string) => void }) {
  const [answer, setAnswer] = useState("");
  const [site, setSite] = useState("otro servicio");
  const [busy, setBusy] = useState(false);

  const open = async (target: (typeof SITES)[number]) => {
    const pack = await packFor(item, APP_VERSION);
    setSite(target.name);
    try {
      await navigator.clipboard.writeText(pack);
      ping(`Paquete copiado. Pégalo en ${target.name} (se abre en otra pestaña) y trae aquí su respuesta.`);
    } catch {
      downloadFile("para-otra-ia.txt", pack, "text/plain;charset=utf-8");
      ping(`No pude copiar: se ha descargado «para-otra-ia.txt». Pégalo en ${target.name}.`);
    }
    window.open(target.url, "_blank", "noopener,noreferrer");
  };

  const apply = async () => {
    setBusy(true);
    await applyExternalAnswer(item, answer, site, ping);
    setBusy(false);
  };

  return (
    <details className="mt-3 rounded-md border border-border bg-background p-3 text-xs">
      <summary className="cursor-pointer font-semibold">Usar otra IA (ChatGPT, Claude, Gemini, Grok, Perplexity…)</summary>
      <p className="mt-2 leading-5 text-muted-foreground">1) Elige un servicio: WILLY copia el paquete con tu petición y el código y abre su página. 2) Pega el paquete y copia su respuesta. 3) Pégala aquí: WILLY la aplica con copia de seguridad, compilación y pruebas.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {SITES.map((entry) => (
          <Button key={entry.id} size="sm" variant="secondary" className="h-7 text-xs" onClick={() => void open(entry)}>{entry.name}</Button>
        ))}
      </div>
      <textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder="Pega aquí la respuesta de la otra IA (con los bloques «replace» o los archivos con su ruta)"
        className="mt-3 min-h-24 w-full rounded-md border border-border bg-card p-2 outline-none focus:border-primary"
        aria-label="Respuesta de otra IA"
      />
      <Button size="sm" className="mt-2 h-8 gap-2 text-xs" disabled={busy || !answer.trim()} onClick={() => void apply()}>{busy ? "Aplicando…" : "Aplicar y comprobar"}</Button>
    </details>
  );
}
