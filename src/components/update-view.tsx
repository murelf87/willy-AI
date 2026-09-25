import { RefreshCw, ShieldCheck } from "lucide-react";
import type { SystemInfo } from "@/lib/maintenance-client";

// Actualizaciones (Ajustes → Sistema). Antes pedía un «.exe» y lo volvía a descargar, sin instalar nada: las
// actualizaciones de WILLY llegan como un archivo «ACTUALIZAR_WILLY_AI_….bat». Aquí se enseña lo que hay de verdad: la
// versión que tienes, la última actualización instalada (con lo que trajo) y cómo se instala la siguiente.

const dateText = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
};

export function UpdateView({ info }: { info: SystemInfo | null }) {
  const last = info?.lastUpdate ?? null;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><RefreshCw className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Actualizaciones</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {info ? `Tienes WILLY AI ${info.version} (revisión ${info.revision}).` : "No se pudo leer la versión: el servidor de WILLY no respondió."}
            {last?.at ? ` La última actualización (${last.version}) se instaló el ${dateText(last.at)}.` : ""}
          </p>
        </div>
        {info && <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs font-semibold">v{info.version} · r{info.revision}</span>}
      </div>
      {last && last.notes.length > 0 && (
        <details className="mt-3 rounded-md border border-border bg-background p-3">
          <summary className="cursor-pointer text-xs font-semibold">Qué trajo la última actualización</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {last.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </details>
      )}
      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>Las actualizaciones llegan como un archivo «ACTUALIZAR_WILLY_AI_….bat»: ábrelo con doble clic. Antes de cambiar nada hace una copia de seguridad y, si algo falla, WILLY vuelve solo a como estaba.</span>
      </p>
    </section>
  );
}
