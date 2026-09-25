import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FactorySection, type FactoryState } from "@/components/factory-section";
import { cn } from "@/lib/utils";
import type { GeneratedFile } from "@/types/domain";
import {
  DEFAULT_REQUEST, REQUEST_PATH, STATE_PATH, deliveryStatus, evaluateGates, initialState, loadRebuildRequest, progress, readState, requestFromStateFile,
  targetFeasibility, type GateStatus, type ModuleStatus, type RebuildRequest,
} from "@/lib/product-rebuild";

const MODULE_MARK: Record<ModuleStatus, { mark: string; tone: string; label: string }> = {
  verificado: { mark: "✓", tone: "text-emerald-600", label: "verificado" },
  implementado: { mark: "●", tone: "text-amber-600", label: "implementado, sin verificar" },
  "en-curso": { mark: "●", tone: "text-amber-600", label: "en curso" },
  pendiente: { mark: "○", tone: "text-muted-foreground", label: "pendiente" },
  bloqueado: { mark: "✗", tone: "text-destructive", label: "bloqueado" },
};

const GATE_MARK: Record<GateStatus, { mark: string; tone: string; label: string }> = {
  superada: { mark: "✓", tone: "text-emerald-600", label: "superada" },
  parcial: { mark: "●", tone: "text-amber-600", label: "parcial" },
  pendiente: { mark: "○", tone: "text-muted-foreground", label: "pendiente" },
  fallida: { mark: "✗", tone: "text-destructive", label: "fallida" },
  "no-aplica": { mark: "—", tone: "text-muted-foreground", label: "no aplica" },
};

/**
 * Panel de una réplica funcional: avance por módulos (lo que informa la construcción, sin contar como verificado lo que no
 * tiene prueba), comprobaciones que hace WILLY de verdad y si se puede entregar. Hasta FINAL_VERIFIED no hay descargas.
 */
export function RebuildPanel({ projectId, projectName, files, onDownloadCode }: {
  projectId: string;
  projectName: string;
  files: GeneratedFile[];
  onDownloadCode: (files: GeneratedFile[]) => void;
}) {
  const stateFile = files.find((f) => f.path === STATE_PATH)?.content;
  // El encargo: el que guardó WILLY en este navegador al crear el proyecto; si no está (otro navegador o el móvil), la copia
  // que WILLY dejó en el proyecto; y, en último caso, el estado inicial.
  const saved = loadRebuildRequest(projectId);
  const request: RebuildRequest = saved ?? requestFromStateFile(files.find((f) => f.path === REQUEST_PATH)?.content) ?? requestFromStateFile(stateFile) ?? { reference: "", goal: "", attachments: [], ...DEFAULT_REQUEST };
  const { state, notes } = useMemo(() => readState(stateFile, initialState(request)), [stateFile, projectId]);
  // Programas de Windows: el último informe de la fábrica de instaladores (solo cuenta si corresponde al código actual).
  const [factory, setFactory] = useState<FactoryState>(null);
  const desktop = state.encargo.targets.includes("windows");
  const gates = useMemo(() => evaluateGates(files, state, desktop ? factory : null), [files, state, desktop, factory]);
  const status = deliveryStatus(state, gates);
  const { percent, verified, total } = progress(state.modulos);
  const passed = gates.filter((g) => g.status === "superada").length;
  const applicable = gates.filter((g) => g.status !== "no-aplica").length;
  const installer = files.find((f) => /(^|\/)dist\/.+\.(exe|msi|bat)$/i.test(f.path));
  const factoryInstaller = desktop && factory?.fresh && factory.report.instalador ? factory.report.instalador : null;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4" aria-label={`Replicación de ${projectName}`}>
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-lg font-bold">REPLICACIÓN: {percent} %</h3>
          <span className="text-xs text-muted-foreground">{verified} de {total} módulo(s) verificados con su prueba</span>
        </div>
        <div role="progressbar" aria-label="Avance de la réplica" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <ul className="mt-3 space-y-1.5 text-sm" aria-label="Módulos">
          {state.modulos.map((m) => (
            <li key={m.id} className="flex items-start gap-2">
              <span className={`w-4 shrink-0 text-center font-bold ${MODULE_MARK[m.status].tone}`} aria-hidden>{MODULE_MARK[m.status].mark}</span>
              <span className="min-w-0 flex-1">
                {m.name} <span className="text-xs text-muted-foreground">· {MODULE_MARK[m.status].label}</span>
                {(m.test || m.evidence || m.note) && (
                  <span className="block text-xs text-muted-foreground">
                    {m.test ? `Prueba: ${m.test}. ` : ""}{m.evidence ? `Evidencia: ${m.evidence}. ` : ""}{m.note ?? ""}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {notes.length > 0 && <p className="mt-2 text-xs text-amber-600">{notes.join(" ")}</p>}
        {!saved && <p className="mt-2 text-xs text-muted-foreground">Encargo leído del propio proyecto ({REQUEST_PATH}): este navegador no lo tenía guardado.</p>}
      </section>

      {desktop && <FactorySection projectId={projectId} projectName={projectName} files={files} onChange={setFactory} />}

      <section className="mt-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Comprobaciones de WILLY</h3>
          <span className="text-xs text-muted-foreground">{passed} de {applicable} superadas</span>
        </div>
        <ul className="mt-2 space-y-1.5 text-sm" aria-label="Comprobaciones">
          {gates.map((g) => (
            <li key={g.id} className="flex items-start gap-2">
              <span className={`w-4 shrink-0 text-center font-bold ${GATE_MARK[g.status].tone}`} aria-hidden>{GATE_MARK[g.status].mark}</span>
              <span className="min-w-0 flex-1">{g.label} <span className="text-xs text-muted-foreground">· {GATE_MARK[g.status].label} — {g.detail}</span></span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`mt-3 rounded-xl border p-4 ${status.final ? "border-emerald-500 bg-emerald-500/5" : "border-amber-500/60 bg-amber-500/5"}`} aria-label="Entrega">
        <h3 className="font-display text-lg font-bold">{status.label}</h3>
        {status.final ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {factoryInstaller ? (
              <a href={`/api/fabrica?descargar=${encodeURIComponent(projectId)}`} download={factoryInstaller.archivo} className={cn(buttonVariants(), "gap-2")}>
                <Download className="size-4" />DESCARGAR INSTALADOR
              </a>
            ) : installer && (
              <Button onClick={() => { const url = URL.createObjectURL(new Blob([installer.content], { type: "application/octet-stream" })); const a = document.createElement("a"); a.href = url; a.download = installer.path.split("/").pop() ?? "instalador"; a.click(); URL.revokeObjectURL(url); }} className="gap-2">
                <Download className="size-4" />DESCARGAR INSTALADOR
              </Button>
            )}
            <Button variant="secondary" onClick={() => onDownloadCode(files)} className="gap-2"><Download className="size-4" />DESCARGAR CÓDIGO FUENTE</Button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">Falta por cumplir ({status.missing.length}):</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground" aria-label="Qué falta">
              {status.missing.slice(0, 10).map((item) => <li key={item}>{item}</li>)}
              {status.missing.length > 10 && <li>… y {status.missing.length - 10} más</li>}
            </ul>
          </>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Destinos</h3>
        <ul className="mt-2 space-y-1 text-xs" aria-label="Destinos">
          {state.encargo.targets.map((t) => {
            const f = targetFeasibility(t);
            return (
              <li key={t}>
                <span className={`font-semibold ${f.status === "bloqueado" ? "text-destructive" : f.status === "con-requisitos" ? "text-amber-600" : "text-emerald-600"}`}>{f.label}: {f.status === "posible" ? "posible" : f.status === "con-requisitos" ? "con requisitos" : "bloqueado"}</span>
                <span className="text-muted-foreground"> — {f.why}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
