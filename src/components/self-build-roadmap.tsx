// Autoconstrucción · VISIÓN, ROADMAP, MÓDULOS y TAREAS (maqueta del dueño, 24/09/2026). Nada inventado: todo sale del plan del
// proyecto del sistema (lib/system-project.ts: lo que ya está hecho, en qué revisión llegó y lo que falta), del motor de progreso
// de siempre (computeProgress, el mismo que mide cualquier proyecto), del diario de la Autoconstrucción (las mejoras de verdad,
// con su resultado) y del estado real de WILLY (versión instalada y salud).
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeProgress, type MilestoneProgress, type PlanTask } from "@/lib/project-progress";
import { SYSTEM_HISTORY, SYSTEM_REVISION, systemPlan } from "@/lib/system-project";
import { APP_VERSION } from "@/lib/version";
import { fetchSelfStatus } from "@/lib/self-build-client";
import type { OperationOutcome, OperationSummary } from "@/lib/self-build-journal";
import { SelfBuildHealth, type SelfBuildTab } from "@/components/self-build-panels";

type Ping = (message: string) => void;

const STATE_LABEL: Record<MilestoneProgress["state"], string> = { hecho: "Hecho", "en-curso": "En desarrollo", pendiente: "Planificado", vacio: "Sin tareas" };
const STATE_TONE: Record<MilestoneProgress["state"], string> = {
  hecho: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "en-curso": "bg-primary/15 text-primary",
  pendiente: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  vacio: "bg-muted text-muted-foreground",
};

function Bar({ percent }: { percent: number | null }) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${p}%` }} />
    </div>
  );
}

/** El plan del sistema y su progreso (se calcula una vez: el plan es fijo en esta versión de WILLY). */
function useSystemProgress() {
  const plan = useMemo(() => systemPlan(), []);
  const progress = useMemo(() => computeProgress(plan), [plan]);
  return { plan, progress };
}

/** Las mejoras de verdad que ha hecho la Autoconstrucción (del diario), las más recientes primero. */
function useRecentOperations(limit: number): { ops: OperationSummary[]; label: string; state: "cargando" | "ok" | "error" } {
  const [data, setData] = useState<{ ops: OperationSummary[]; label: string; state: "cargando" | "ok" | "error" }>({ ops: [], label: "", state: "cargando" });
  useEffect(() => {
    let alive = true;
    fetchSelfStatus()
      .then((s) => { if (alive) setData({ ops: [...s.operations].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit), label: s.version.label, state: "ok" }); })
      .catch(() => { if (alive) setData({ ops: [], label: "", state: "error" }); });
    return () => { alive = false; };
  }, [limit]);
  return data;
}

const ago = (iso: string): string => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
};

/** Cómo acabó cada mejora, en palabras cortas (el diario vive en el servidor: aquí solo se nombra su resultado). */
const OUTCOME: Record<OperationOutcome, { label: string; tone: string }> = {
  instalada: { label: "Instalada", tone: "text-emerald-600" },
  aplicada: { label: "Aplicada", tone: "text-emerald-600" },
  descartada: { label: "Descartada · no se tocó nada", tone: "text-destructive" },
  restaurada: { label: "Descartada · se restauró todo", tone: "text-destructive" },
  recuperada: { label: "Recuperada tras un cierre", tone: "text-amber-600" },
  "vuelta-atras": { label: "Vuelta atrás", tone: "text-amber-600" },
  "en-curso": { label: "En curso", tone: "text-primary" },
  interrumpida: { label: "Interrumpida", tone: "text-amber-600" },
};

// ───────────────────────────────────────────────────────────── Visión

export function SelfBuildVision({ ping, onGo }: { ping: Ping; onGo: (tab: SelfBuildTab) => void }) {
  const { progress } = useSystemProgress();
  const recent = useRecentOperations(5);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Roadmap de WILLY</p>
              <p className="text-xs text-muted-foreground">Lo que ya tiene WILLY AI y lo que le falta, con el progreso real de cada módulo.</p>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => onGo("mejorar")}><Plus className="size-4" />Nueva mejora</Button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1"><Bar percent={progress.percent} /></div>
            <span className="text-sm font-bold">{progress.percent === null ? "—" : `${Math.round(progress.percent)} %`}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Fase: {progress.phase} · WILLY AI {recent.label || `v${APP_VERSION} (revisión ${SYSTEM_REVISION})`}</p>
          <ul className="mt-3 space-y-2">
            {progress.milestones.map((m) => (
              <li key={m.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                <span className="truncate text-sm">{m.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_TONE[m.state]}`}>{STATE_LABEL[m.state]}</span>
                <div className="col-span-2 flex items-center gap-2"><div className="flex-1"><Bar percent={m.percent} /></div><span className="w-10 text-right text-xs text-muted-foreground">{m.percent === null ? "—" : `${Math.round(m.percent)} %`}</span></div>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => onGo("modulos")}>Ver los módulos</Button>
        </section>
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Mejoras recientes</p>
            <Button size="sm" variant="ghost" onClick={() => onGo("historial")}>Ver todas</Button>
          </div>
          {recent.state === "cargando" && <p className="mt-2 text-xs text-muted-foreground">Leyendo el diario…</p>}
          {recent.state === "error" && <p className="mt-2 text-xs text-destructive">No se pudo leer el diario de la Autoconstrucción.</p>}
          {recent.state === "ok" && recent.ops.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Todavía no hay mejoras en el diario.</p>}
          <ul className="mt-2 space-y-2">
            {recent.ops.map((op) => (
              <li key={op.op} className="rounded-md border border-border/70 p-2">
                <p className="line-clamp-2 text-xs font-semibold">{op.objective}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground"><span className={OUTCOME[op.outcome]?.tone ?? ""}>{OUTCOME[op.outcome]?.label ?? op.outcome}</span> · {ago(op.at)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <SelfBuildHealth ping={ping} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Roadmap

export function SelfBuildRoadmap() {
  const { progress } = useSystemProgress();
  const next = progress.pending.slice(0, 8);
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold">Lo siguiente</p>
        <p className="text-xs text-muted-foreground">Lo que falta del plan, en el orden en que toca.</p>
        {next.length === 0 ? <p className="mt-2 text-sm text-emerald-600">No queda nada pendiente en el plan de esta versión.</p> : (
          <ol className="mt-2 space-y-1.5">
            {next.map((item) => (
              <li key={item.task.id} className="flex items-start gap-2 text-sm"><Circle className="mt-0.5 size-4 shrink-0 text-amber-500" /><span><span className="font-semibold">{progress.milestones.find((m) => m.id === item.milestone)?.name ?? item.milestone}:</span> {item.task.title}</span></li>
            ))}
          </ol>
        )}
      </section>
      <section className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold">Lo que ya llegó</p>
        <p className="text-xs text-muted-foreground">Cada revisión del rediseño, con sus comprobaciones automáticas.</p>
        <ol className="mt-2 space-y-2 border-l border-border pl-4">
          {SYSTEM_HISTORY.map((h) => (
            <li key={h.rev} className="relative">
              <CheckCircle2 className="absolute -left-[1.4rem] top-0.5 size-4 bg-card text-emerald-500" />
              <p className="text-sm"><span className="font-semibold">Revisión {h.rev}</span> · {h.title}</p>
              <p className="text-[11px] text-muted-foreground">{h.checks ? `${h.checks} comprobaciones automáticas, sin fallos` : "Sin comprobaciones contadas"}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Módulos

export function SelfBuildModules() {
  const { plan, progress } = useSystemProgress();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {plan.milestones.map((m) => {
        const mp = progress.milestones.find((x) => x.id === m.id);
        return (
          <section key={m.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{m.name}</p>
              {mp && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_TONE[mp.state]}`}>{STATE_LABEL[mp.state]}</span>}
            </div>
            <div className="mt-2 flex items-center gap-2"><div className="flex-1"><Bar percent={mp?.percent ?? null} /></div><span className="text-xs text-muted-foreground">{mp ? `${mp.done}/${mp.total}` : "—"}</span></div>
            <ul className="mt-2 space-y-1">
              {m.tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-xs">{t.status === "hecha" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}<span className={t.status === "hecha" ? "" : "font-semibold"}>{t.title}</span></li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Tareas

type TaskFilter = "pendientes" | "hechas" | "todas";

export function SelfBuildTasks() {
  const { plan } = useSystemProgress();
  const [filter, setFilter] = useState<TaskFilter>("pendientes");
  const rows = useMemo(() => {
    const all: Array<{ module: string; task: PlanTask }> = plan.milestones.flatMap((m) => m.tasks.map((task) => ({ module: m.name, task })));
    const pending = all.filter((r) => r.task.status !== "hecha");
    const done = all.filter((r) => r.task.status === "hecha");
    return filter === "pendientes" ? pending : filter === "hechas" ? done : [...pending, ...done];
  }, [plan, filter]);
  const counts = useMemo(() => {
    const all = plan.milestones.flatMap((m) => m.tasks);
    return { pendientes: all.filter((t) => t.status !== "hecha").length, hechas: all.filter((t) => t.status === "hecha").length, todas: all.length };
  }, [plan]);
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div role="tablist" aria-label="Filtrar tareas" className="mb-3 flex flex-wrap gap-1">
        {(["pendientes", "hechas", "todas"] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {f === "pendientes" ? "Pendientes" : f === "hechas" ? "Hechas" : "Todas"} ({counts[f]})
          </button>
        ))}
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{filter === "pendientes" ? "No queda nada pendiente en el plan de esta versión." : "No hay tareas."}</p> : (
        <ul className="divide-y divide-border/60">
          {rows.map(({ module, task }) => (
            <li key={task.id} className="flex items-start gap-2 py-2 text-sm">
              {task.status === "hecha" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 size-4 shrink-0 text-amber-500" />}
              <span className="min-w-0"><span className="text-xs text-muted-foreground">{module} · </span>{task.title}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
