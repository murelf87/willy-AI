// Autoconstrucción · subapartados CAMBIOS (qué hizo WILLY), VERSIÓN (versiones y vuelta atrás) y SALUD (estado actual). Desde el
// 25/09/2026 las pestañas siguen la maqueta del dueño (Visión · Roadmap · Módulos · Tareas · Cambios · Versión · Logs, más «Nueva
// mejora»); Visión, Roadmap, Módulos y Tareas viven en self-build-roadmap.tsx.
// Todo sale del servidor de este equipo (diario, registro de versiones y copias verificadas): la pantalla nunca inventa un
// resultado y una mejora fallida nunca aparece como éxito.
import { useCallback, useEffect, useRef, useState } from "react";
// Solo iconos que ya usa el resto de WILLY (existen seguro en la versión instalada de lucide-react).
import { Activity, CheckCircle2, Circle, CircleAlert, Clock, Gauge, LayoutGrid, ListChecks, Package, Play, Plus, RefreshCw, RotateCcw, Save, ScrollText, ShieldCheck, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OperationOutcome, OperationSummary } from "@/lib/self-build-journal";
import type { VersionEntry, Verdict } from "@/lib/self-build-versions";
import type { HealthCheck, HealthReport, StatusBody } from "@/lib/self-build-manager";
import { fetchSelfHealth, fetchSelfStatus, recoverSelfBuild, revertSelfVersion, waitForRestart } from "@/lib/self-build-client";

type Ping = (message: string) => void;

export type SelfBuildTab = "vision" | "roadmap" | "modulos" | "tareas" | "historial" | "versiones" | "logs" | "mejorar" | "salud" | "auditorias";

/** Pestañas de la maqueta, en su orden. «mejorar» (el formulario) se abre con «Nueva mejora»; «salud» se sigue aceptando (enlaces
 * antiguos) y enseña Visión, que ya trae la salud. Los ids de siempre no cambian: los enlaces directos siguen funcionando. */
export const SELF_BUILD_TABS: Array<{ id: SelfBuildTab; label: string; hint: string; hidden?: boolean }> = [
  { id: "vision", label: "Visión", hint: "Dónde está WILLY, su progreso y su salud" },
  { id: "roadmap", label: "Roadmap", hint: "Qué llegó en cada revisión y qué viene" },
  { id: "modulos", label: "Módulos", hint: "Cada parte de SÚPER IA con su progreso" },
  { id: "tareas", label: "Tareas", hint: "Lo que falta y lo que ya está hecho" },
  { id: "historial", label: "Cambios", hint: "Qué hizo WILLY en cada mejora, paso a paso" },
  { id: "versiones", label: "Versión", hint: "Versiones y volver atrás" },
  { id: "logs", label: "Logs", hint: "Registros del programa" },
  { id: "mejorar", label: "Nueva mejora", hint: "Escribe qué cambiar", hidden: true },
  { id: "salud", label: "Salud", hint: "Estado actual", hidden: true },
  { id: "auditorias", label: "Auditorías", hint: "Revisiones automáticas de TypeScript programadas" },
];

const TAB_ICON = { vision: Gauge, roadmap: Activity, modulos: LayoutGrid, tareas: ListChecks, historial: Clock, versiones: Package, logs: ScrollText, mejorar: Wrench, salud: Activity, auditorias: ShieldCheck } as const;

export function SelfBuildTabs({ tab, onChange }: { tab: SelfBuildTab; onChange: (tab: SelfBuildTab) => void }) {
  return (
    <div className="flex items-center gap-2">
      {/* Scroll horizontal en móvil, wrap en escritorio */}
      <div className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border bg-background p-1 scrollbar-none">
        <div role="tablist" aria-label="Apartados de la Autoconstrucción" className="flex gap-1 sm:flex-wrap">
          {SELF_BUILD_TABS.filter((entry) => !entry.hidden).map(({ id, label, hint }) => {
            const Icon = TAB_ICON[id];
            const active = tab === id || (id === "vision" && tab === "salud");
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                title={hint}
                onClick={() => onChange(id)}
                className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors sm:px-3 ${active ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
              >
                <Icon className="size-4 shrink-0" />
                {/* Label visible en sm+ o cuando está activo */}
                <span className={`${active ? "inline" : "hidden sm:inline"}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <Button className={`shrink-0 gap-2 ${tab === "mejorar" ? "shadow-glow" : ""}`} variant={tab === "mejorar" ? "primary" : "secondary"} aria-pressed={tab === "mejorar"} onClick={() => onChange("mejorar")}><Plus className="size-4" /><span className="hidden sm:inline">Nueva mejora</span></Button>
    </div>
  );
}

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
};

/** Estado del servidor, compartido por Historial y Versiones. */
function useSelfStatus() {
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await fetchSelfStatus());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el estado.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { status, error, loading, reload };
}

function LoadState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  if (loading) return <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Leyendo lo que hay en tu equipo…</p>;
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        <CircleAlert className="size-4 text-destructive" />
        <span className="min-w-0 flex-1">No se pudo leer el estado de la Autoconstrucción: {error}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>Reintentar</Button>
      </div>
    );
  }
  return null;
}

/** Aviso de lo que se ha recuperado o de lo que está pendiente (una operación a medias). */
function RecoveryNotice({ status, ping, onChanged }: { status: StatusBody; ping: Ping; onChanged: () => void }) {
  const [working, setWorking] = useState(false);
  const { recovery, marker, running, restartRollback } = status;
  const retry = async () => {
    setWorking(true);
    try {
      const result = await recoverSelfBuild();
      ping(result.state === "bloqueada" ? `⚠️ ${result.message}` : result.message || "No había nada que recuperar.");
    } catch (error) {
      ping(`⚠️ ${error instanceof Error ? error.message : "No se pudo recuperar."}`);
    } finally {
      setWorking(false);
      onChanged();
    }
  };
  if (restartRollback) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <span>{restartRollback.kind === "vuelta-atras" ? "La versión a la que volvías no arrancó" : "La versión nueva no arrancó al reiniciar"}: WILLY volvió solo a la que funcionaba y dejó el código como estaba. {restartRollback.detail}</span>
      </div>
    );
  }
  if (recovery.state === "recuperada" || recovery.state === "completada") {
    return (
      <div role="status" className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>{recovery.message}</span>
      </div>
    );
  }
  if (recovery.state === "bloqueada" || (marker && !running)) {
    return (
      <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1">{recovery.message || `Hay una operación a medias: «${marker?.objective ?? ""}».`} Mientras tanto no se aplica ninguna mejora nueva.</span>
        <Button size="sm" variant="outline" className="gap-2" disabled={working} onClick={() => void retry()}><RefreshCw className="size-3.5" />{working ? "Recuperando…" : "Recuperar ahora"}</Button>
      </div>
    );
  }
  return null;
}

// --------------------------------------------------------------------------------------------------------- HISTORIAL

const OUTCOME: Record<OperationOutcome, { label: string; tone: string }> = {
  instalada: { label: "✓ Instalada", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  aplicada: { label: "✓ Aplicada (vista previa)", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  "vuelta-atras": { label: "↩ Vuelta atrás hecha", tone: "border-primary/40 bg-primary/10 text-primary" },
  descartada: { label: "✗ Descartada · no se tocó nada", tone: "border-destructive/40 bg-destructive/10 text-destructive" },
  restaurada: { label: "✗ Descartada · se restauró todo", tone: "border-destructive/40 bg-destructive/10 text-destructive" },
  recuperada: { label: "↺ Recuperada tras un cierre", tone: "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  "en-curso": { label: "… En curso", tone: "border-primary/40 bg-primary/10 text-primary" },
  interrumpida: { label: "⚠ Interrumpida", tone: "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
};

const STEP_LABEL: Record<string, string> = {
  CANDIDATE_CREATED: "versión candidata aparte",
  BUILD_SUCCESS: "compilación",
  TYPECHECK_SUCCESS: "tipos",
  TEST_SUCCESS: "prueba aparte",
  READY: "candidata lista",
  BACKUP_VERIFIED: "copia verificada",
  FILES_MODIFIED: "archivos",
  PROMOTED: "instalación",
  RESTART_SCHEDULED: "reinicio",
  HEALTH_CHECK: "arranque comprobado",
};

function trail(op: OperationSummary): string {
  return op.steps.map((step) => STEP_LABEL[step]).filter((label, index, all): label is string => !!label && all.indexOf(label) === index).join(" ✓ · ");
}

export function SelfBuildHistory({ ping }: { ping: Ping }) {
  const { status, error, loading, reload } = useSelfStatus();
  if (!status) return <LoadState loading={loading} error={error} onRetry={() => void reload()} />;
  return (
    <section className="space-y-3" aria-label="Historial de la Autoconstrucción">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Cada intento de mejorar WILLY, paso a paso, tal como quedó anotado en tu equipo.</p>
        <Button size="sm" variant="outline" className="gap-2" disabled={loading} onClick={() => void reload()}><RefreshCw className="size-3.5" />Actualizar</Button>
      </div>
      <RecoveryNotice status={status} ping={ping} onChanged={() => void reload()} />
      {status.operations.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Todavía no hay nada en el historial: aparecerá cada mejora que WILLY intente, con su resultado real.</p>
      ) : (
        <ul className="space-y-2">
          {status.operations.map((op) => {
            const outcome = OUTCOME[op.outcome];
            const steps = trail(op);
            return (
              <li key={op.op} className="rounded-lg border border-border bg-card p-3" data-outcome={op.outcome}>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{op.objective || (op.kind === "vuelta-atras" ? "Volver atrás" : "Mejora de WILLY AI")}</p>
                    <p className="text-xs text-muted-foreground">{when(op.at)}</p>
                  </div>
                  <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold ${outcome.tone}`}>{outcome.label}</span>
                </div>
                {op.detail && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{op.detail}</p>}
                {steps && <p className="mt-1 text-xs text-muted-foreground">Pasos: {steps} ✓</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------------------------------------- VERSIONES

const STATUS_LABEL: Record<VersionEntry["status"], string> = {
  ACTIVA: "● ACTUAL",
  ESTABLE: "✓ ESTABLE",
  SUSTITUIDA: "SUSTITUIDA",
  REVERTIDA: "⚠ REVERTIDA",
  FALLIDA: "✗ DESCARTADA",
};

const HEALTH_LABEL: Record<VersionEntry["health"], string> = {
  PASS: "arrancó y responde",
  PENDIENTE: "pendiente de reiniciar",
  FAIL: "no arrancó",
  "N/A": "vista previa (sin programa instalado)",
};

const TEST_LABEL: Record<string, string> = {
  evidenciasCodigo: "Hace lo pedido (código)",
  sintaxis: "Sintaxis",
  candidata: "Versión candidata aparte",
  tipos: "Tipos (TypeScript)",
  copiaArchivos: "Copia verificada de archivos",
  compilacion: "Compilación",
  pruebaAparte: "Prueba aparte del programa nuevo",
  evidencias: "Evidencias",
  copiaPrograma: "Copia verificada del programa",
  instalacion: "Instalación",
  health: "Arranque tras reiniciar",
};

const VERDICT: Record<Verdict, string> = { PASS: "✓", FAIL: "✗", NOT_VERIFIED: "sin comprobar", "N/A": "no aplica" };

const CHANGELOG: Array<[keyof VersionEntry["changelog"], string]> = [["nuevo", "NUEVO"], ["mejorado", "MEJORADO"], ["corregido", "CORREGIDO"], ["tecnico", "TÉCNICO"]];

export function SelfBuildVersions({ ping }: { ping: Ping }) {
  const { status, error, loading, reload } = useSelfStatus();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  if (!status) return <LoadState loading={loading} error={error} onRetry={() => void reload()} />;
  const byId = (id: string | null | undefined) => status.versions.find((entry) => entry.id === id) ?? null;

  const revert = async (entry: VersionEntry) => {
    setWorking(true);
    try {
      const result = await revertSelfVersion(entry.id);
      setConfirming(null);
      ping(`↩ Vuelta atrás hecha: WILLY vuelve a ${result.backTo || "la versión anterior"}.${result.restarting ? " Reiniciando…" : ""}${result.notes?.length ? ` ${result.notes.join(" ")}` : ""}`);
      if (result.restarting) {
        await waitForRestart();
        window.location.reload();
        return;
      }
    } catch (err) {
      ping(`⚠️ No se volvió atrás: ${err instanceof Error ? err.message : "error desconocido"}`);
    } finally {
      setWorking(false);
      void reload();
    }
  };

  return (
    <section className="space-y-3" aria-label="Versiones de WILLY AI">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Versión actual: <strong className="text-foreground">{status.version.label}</strong>
          {status.lastKnownGood ? <> · última buena comprobada: <strong className="text-foreground">{status.lastKnownGood.label}</strong></> : null}
        </p>
        <Button size="sm" variant="outline" className="gap-2" disabled={loading || working} onClick={() => void reload()}><RefreshCw className="size-3.5" />Actualizar</Button>
      </div>
      <RecoveryNotice status={status} ping={ping} onChanged={() => void reload()} />
      {status.healthConfirmed && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          <span>La versión {status.healthConfirmed.label} arrancó y responde: queda como última buena.</span>
        </div>
      )}
      {status.versions.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Todavía no hay versiones anotadas.</p>
      ) : (
        <ul className="space-y-2">
          {status.versions.map((entry) => {
            const active = entry.id === status.active?.id;
            const canRevert = active && entry.kind === "autoconstruccion" && entry.rollback && !status.running && !status.marker;
            const previous = byId(entry.previous);
            const tests = Object.entries(entry.tests);
            return (
              <li key={entry.id} className={`rounded-lg border bg-card p-3 ${active ? "border-primary/60" : "border-border"}`} data-status={entry.status}>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {entry.label}
                      <span className={`ml-2 rounded-md border px-1.5 py-0.5 text-[11px] ${entry.status === "REVERTIDA" || entry.status === "FALLIDA" ? "border-amber-500/50 text-amber-600 dark:text-amber-400" : active ? "border-primary/50 text-primary" : "border-border text-muted-foreground"}`}>{STATUS_LABEL[entry.status]}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {when(entry.promotedAt ?? entry.at)} · {entry.kind === "oficial" ? "versión oficial (instalada con su actualizador)" : `salud: ${HEALTH_LABEL[entry.health]}`}
                    </p>
                  </div>
                  {canRevert && confirming !== entry.id && (
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => setConfirming(entry.id)}><RotateCcw className="size-3.5" />Volver a la versión anterior</Button>
                  )}
                </div>
                {entry.kind === "autoconstruccion" && <p className="mt-2 text-xs leading-5">{entry.objective}</p>}
                {entry.reason && entry.status === "REVERTIDA" && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Revertida: {entry.reason}</p>}
                {CHANGELOG.some(([key]) => entry.changelog[key].length) && (
                  <dl className="mt-2 grid gap-1 text-xs">
                    {CHANGELOG.filter(([key]) => entry.changelog[key].length).map(([key, label]) => (
                      <div key={key} className="flex gap-2"><dt className="w-24 shrink-0 font-semibold text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{entry.changelog[key].join(" · ")}</dd></div>
                    ))}
                  </dl>
                )}
                {tests.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1 text-[11px]">
                    {tests.map(([name, verdict]) => (
                      <span key={name} className={`rounded border px-1.5 py-0.5 ${verdict === "PASS" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : verdict === "FAIL" ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}>{TEST_LABEL[name] ?? name}: {VERDICT[verdict] ?? verdict}</span>
                    ))}
                  </p>
                )}
                {confirming === entry.id && (
                  <div role="alertdialog" aria-label="Confirmar vuelta atrás" className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs leading-5">
                    <p className="font-semibold">¿Volver a {previous?.label ?? "la versión anterior"}?</p>
                    <p className="mt-1">Se deshace «{entry.objective}»: sus {entry.files.length} archivo(s){status.server.installed ? " y el programa" : ""} vuelven a como estaban antes. Primero se guarda (y se comprueba) una copia de cómo está todo ahora{status.server.installed ? " y WILLY se reinicia" : ""}.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" className="gap-2" disabled={working} onClick={() => void revert(entry)}><RotateCcw className="size-3.5" />{working ? "Volviendo atrás…" : "Sí, volver atrás"}</Button>
                      <Button size="sm" variant="outline" disabled={working} onClick={() => setConfirming(null)}>Cancelar</Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <details className="rounded-lg border border-border bg-card p-3 text-xs">
        <summary className="cursor-pointer font-semibold">Copias guardadas en tu equipo ({status.backups.length})</summary>
        <p className="mt-2 text-muted-foreground">Carpeta «copias-autoconstruccion» de la instalación. Se guardan las 10 más recientes; la de la versión actual, la de la última buena y las de las 3 últimas estables nunca se borran.</p>
        <ul className="mt-2 space-y-1">
          {status.backups.map((backup) => (
            <li key={backup.name} className="flex flex-wrap gap-2 rounded border border-border px-2 py-1">
              <span className="min-w-0 flex-1 truncate">{backup.reason || backup.name}</span>
              <span className="text-muted-foreground">{when(backup.createdAt)} · {backup.files} archivo(s){backup.program ? " + programa" : ""}</span>
              <span className={backup.status === "verificada" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{backup.status === "verificada" ? "✓ verificada" : "sin verificar (anterior)"}</span>
              {backup.protected && <span className="text-primary">protegida</span>}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------------------ SALUD

const CHECK_ICON: Record<HealthCheck["status"], { Icon: typeof CheckCircle2; tone: string; label: string }> = {
  ok: { Icon: CheckCircle2, tone: "text-emerald-500", label: "bien" },
  aviso: { Icon: TriangleAlert, tone: "text-amber-500", label: "aviso" },
  fallo: { Icon: CircleAlert, tone: "text-destructive", label: "fallo" },
  info: { Icon: Circle, tone: "text-muted-foreground", label: "información" },
};

export function SelfBuildHealth({ ping }: { ping: Ping }) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  // El aviso se lee de una referencia: así la comprobación se hace UNA vez al abrir, no cada vez que la pantalla se redibuja.
  const pingRef = useRef(ping);
  pingRef.current = ping;
  const run = useCallback(async (announce: boolean) => {
    setChecking(true);
    try {
      const next = await fetchSelfHealth();
      setReport(next);
      setError("");
      if (announce) pingRef.current(next.overall === "funcionando" ? "✅ Comprobación terminada: todo funciona." : `Comprobación terminada: WILLY está ${next.overall}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo comprobar.");
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => { void run(false); }, [run]);

  const overall = report?.overall;
  return (
    <section className="space-y-3" aria-label="Salud de WILLY AI">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {overall === "funcionando" ? <CheckCircle2 className="size-6 text-emerald-500" /> : overall === "con avisos" ? <TriangleAlert className="size-6 text-amber-500" /> : overall === "con fallos" ? <CircleAlert className="size-6 text-destructive" /> : <Activity className="size-6 text-muted-foreground" />}
          <div>
            <p className="text-base font-bold">WILLY AI {overall ? (overall === "funcionando" ? "funcionando" : overall) : checking ? "· comprobando…" : ""}</p>
            {report && <p className="text-xs text-muted-foreground">Última comprobación: {when(report.at)}</p>}
          </div>
        </div>
        <Button size="sm" variant="outline" className="gap-2" disabled={checking} onClick={() => void run(true)}><RefreshCw className="size-3.5" />{checking ? "Comprobando…" : "Comprobar ahora"}</Button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">No se pudo comprobar: {error}</p>}
      {report && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {report.checks.map((check) => {
            const { Icon, tone, label } = CHECK_ICON[check.status];
            return (
              <li key={check.id} className="flex items-start gap-2 rounded-lg border border-border bg-card p-3" data-check={check.id} data-status={check.status}>
                <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-label={label} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{check.label}</p>
                  <p className="text-xs leading-5 text-muted-foreground">{check.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------------------ AUDITORÍAS

type AuditScheduleUI = {
  enabled: boolean;
  days: number[];
  hour: number;
  minute: number;
  everyWeeks: number;
};

type AuditLogEntryUI = {
  id: string;
  startedAt: number;
  finishedAt: number;
  triggeredBy: "schedule" | "manual";
  result: { ok: boolean; errors: unknown[]; warnings: unknown[]; summary: string };
};

const WEEKDAYS_UI = [
  { d: 1, label: "L" }, { d: 2, label: "M" }, { d: 3, label: "X" }, { d: 4, label: "J" },
  { d: 5, label: "V" }, { d: 6, label: "S" }, { d: 0, label: "D" },
];

const DEFAULT_SCHEDULE_UI: AuditScheduleUI = { enabled: false, days: [], hour: 3, minute: 0, everyWeeks: 1 };

async function apiAudit(body: Record<string, unknown>) {
  const res = await fetch("/api/self-audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export function SelfBuildAudits({ ping }: { ping: Ping }) {
  const [schedule, setSchedule] = useState<AuditScheduleUI>(DEFAULT_SCHEDULE_UI);
  const [draft, setDraft] = useState<AuditScheduleUI>(DEFAULT_SCHEDULE_UI);
  const [nextRun, setNextRun] = useState<number | null>(null);
  const [log, setLog] = useState<AuditLogEntryUI[]>([]);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [runResult, setRunResult] = useState<string>("");
  const pingRef = useRef(ping);
  pingRef.current = ping;

  const load = useCallback(async () => {
    try {
      const data = await apiAudit({ action: "schedule-get" });
      if (data["ok"]) {
        const s = data["schedule"] as AuditScheduleUI;
        setSchedule(s);
        setDraft(s);
        setNextRun((data["nextRunAt"] as number | null) ?? null);
        setLog((data["log"] as AuditLogEntryUI[]) ?? []);
      }
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const data = await apiAudit({ action: "schedule-set", schedule: draft });
      if (data["ok"]) {
        setSchedule(draft);
        setNextRun((data["nextRunAt"] as number | null) ?? null);
        pingRef.current("✅ Horario de auditorías guardado.");
      } else {
        setError(String(data["error"] ?? "No se pudo guardar."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    setError("");
    setRunResult("");
    pingRef.current("🔍 Auditando el código TypeScript…");
    try {
      const data = await apiAudit({ action: "run-now" });
      if (data["ok"]) {
        const entry = data["entry"] as AuditLogEntryUI;
        setLog((prev) => [...prev.slice(-9), entry]);
        const errCount = (entry.result.errors as unknown[]).length;
        const warnCount = (entry.result.warnings as unknown[]).length;
        const msg = errCount === 0 ? "✅ Sin errores TypeScript." : `⚠️ ${errCount} error(es), ${warnCount} aviso(s).`;
        setRunResult(msg);
        pingRef.current(`Auditoría completada: ${msg}`);
      } else {
        setError(String(data["error"] ?? "No se pudo auditar."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al auditar.");
    } finally {
      setRunning(false);
    }
  };

  const toggleDay = (d: number) => {
    setDraft((prev) => ({
      ...prev,
      days: prev.days.includes(d) ? prev.days.filter((x) => x !== d) : [...prev.days, d],
    }));
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(schedule);

  return (
    <section className="space-y-5" aria-label="Auditorías automáticas de TypeScript">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">Auditorías automáticas</h3>
          <p className="text-xs text-muted-foreground">WILLY revisa el código TypeScript en los días y horas que elijas.</p>
        </div>
        <Button size="sm" className="gap-2" disabled={running} onClick={() => void runNow()}>
          <Play className="size-3.5" />{running ? "Auditando…" : "Auditar ahora"}
        </Button>
      </div>

      {runResult && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">{runResult}</p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
      )}

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm font-semibold">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={draft.enabled}
            onChange={(e) => setDraft((p) => ({ ...p, enabled: e.target.checked }))}
          />
          Auditoría automática activada
        </label>

        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Días (vacío = todos los días)</p>
          <div className="flex gap-1.5">
            {WEEKDAYS_UI.map(({ d, label }) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`size-8 rounded-full text-xs font-bold transition-colors ${draft.days.includes(d) ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground hover:bg-accent"}`}
                aria-pressed={draft.days.includes(d)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Hora</p>
            <div className="flex items-center gap-1">
              <input
                type="number" min={0} max={23} value={draft.hour}
                onChange={(e) => setDraft((p) => ({ ...p, hour: Math.max(0, Math.min(23, Number(e.target.value))) }))}
                className="w-14 rounded border border-border bg-background px-2 py-1 text-center text-sm"
              />
              <span className="text-muted-foreground">:</span>
              <input
                type="number" min={0} max={59} value={draft.minute}
                onChange={(e) => setDraft((p) => ({ ...p, minute: Math.max(0, Math.min(59, Number(e.target.value))) }))}
                className="w-14 rounded border border-border bg-background px-2 py-1 text-center text-sm"
              />
              <span className="text-xs text-muted-foreground ml-1">(hora local)</span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Cada cuántas semanas</p>
            <select
              value={draft.everyWeeks}
              onChange={(e) => setDraft((p) => ({ ...p, everyWeeks: Number(e.target.value) }))}
              className="rounded border border-border bg-background px-2 py-1 text-sm"
            >
              {[1, 2, 3, 4, 6, 8, 12, 26, 52].map((n) => (
                <option key={n} value={n}>{n === 1 ? "Cada semana" : `Cada ${n} semanas`}</option>
              ))}
            </select>
          </div>
        </div>

        {nextRun && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="size-3.5" />
            Próxima auditoría: {new Date(nextRun).toLocaleString()}
          </p>
        )}

        <Button size="sm" variant="outline" className="gap-2" disabled={saving || !dirty} onClick={() => void save()}>
          <Save className="size-3.5" />{saving ? "Guardando…" : "Guardar horario"}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Últimas auditorías</p>
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay auditorías registradas.</p>
        ) : (
          <ul className="space-y-2">
            {[...log].reverse().map((entry) => {
              const errCount = (entry.result.errors as unknown[]).length;
              const warnCount = (entry.result.warnings as unknown[]).length;
              const ok = entry.result.ok;
              return (
                <li key={entry.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <span className={ok ? "text-emerald-500" : "text-amber-500"}>{ok ? <CheckCircle2 className="size-3.5 inline" /> : <TriangleAlert className="size-3.5 inline" />}</span>
                  <span className="flex-1 font-medium">{entry.result.summary || (ok ? "Sin errores" : `${errCount} error(es)`)}</span>
                  <span className="text-muted-foreground">{errCount > 0 ? `${errCount} error(es)` : "✓"}{warnCount > 0 ? ` · ${warnCount} aviso(s)` : ""}</span>
                  <span className="text-muted-foreground">{entry.triggeredBy === "manual" ? "Manual" : "Automática"}</span>
                  <span className="text-muted-foreground">{new Date(entry.startedAt).toLocaleString()}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
