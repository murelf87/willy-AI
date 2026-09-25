// PROYECTOS COMO CENTRO DE CONTROL (rediseño, fases 7 y 8; puntos 40-76). De un vistazo: qué se está construyendo, cuánto
// lleva, cuánto falta, en qué fase está, si WILLY está trabajando, si necesita algo de ti y si se puede continuar.
// - Arriba, fijado, «Sistema WILLY»: SÚPER IA como proyecto del sistema (su progreso sale de su plan; no se puede borrar).
// - Después tus proyectos, por secciones (necesitan atención, en desarrollo, pausados, completados, archivados), con
//   búsqueda, filtros, orden y vista en cuadrícula o lista.
// - Cada tarjeta: tipo, estado, fase, progreso REAL (con lo que falta en %), última actividad y el botón que toca
//   (Continuar, Abrir, Resolver, Reanudar). Sin plan: «Progreso no calculado» y «Analizar proyecto» (nunca un % inventado).
// - Al pulsar la barra: el progreso por hitos y «qué falta», donde puedes marcar tareas o añadir alcance.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowRight, Check, Circle, CircleDot, Database, Download, FolderKanban, Gauge,
  LayoutGrid, List, ListChecks, Loader2, MoreHorizontal, Pause, Play, Plus, RotateCcw, Search, Server, Sparkles, Terminal,
  Trash2, Wand2, Wrench, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { SectionHead as Head } from "@/components/section-ui";
import { PanelCard as Card } from "@/components/panel-card";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { openView, useBackgroundTasks } from "@/lib/background-tasks";
import { fetchLogs } from "@/lib/maintenance-client";
import { usePersistentState } from "@/lib/persistent-state";
import { TYPE_LABELS } from "@/lib/project-brief";
import { KIND_LABELS } from "@/lib/project-discovery";
import {
  FILTER_LABEL, SORT_LABEL, STATUS_LABEL, addTask, computeProgress, effectiveStatus, matchesFilter, needsAttention, normalizePlan,
  planJsonRequest, primaryAction, projectStatus, relativeTime, setTaskStatus, sortProjects,
  type PlanTask, type ProgressInfo, type ProjectFilter, type ProjectPlan, type ProjectSort, type ProjectStatusId,
} from "@/lib/project-progress";
import { sendToSuperWilly } from "@/lib/super-willy-handoff";
import { SYSTEM_HISTORY, SYSTEM_PROJECT_DESC, SYSTEM_PROJECT_ID, SYSTEM_PROJECT_NAME, SYSTEM_REVISION_DATE, systemPlan } from "@/lib/system-project";
import { useSettings } from "@/lib/workspace-store";
import { saveProjectPlan } from "@/services/disk-project-service";
import { fileService } from "@/services/file-service";
import { projectService, useProjects } from "@/services/project-service";
import { fileCountOf, isExampleProject, type Ping, type Project, type ProjectIcon, type ProjectState } from "@/types/domain";

const ICONS: Record<ProjectIcon, typeof FolderKanban> = {
  folder: FolderKanban, gauge: Gauge, grid: LayoutGrid, server: Server, database: Database, zap: Zap, store: Database, code: Terminal,
};

const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const kindLabel = (kind: string | undefined): string | null => {
  if (!kind) return null;
  const label = (KIND_LABELS as Record<string, string>)[kind] ?? TYPE_LABELS[kind] ?? kind;
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/** Colores de cada estado (con texto siempre: el color nunca es lo único que lo dice). */
const STATUS_TONE: Record<ProjectStatusId, string> = {
  planificando: "border-sky-500/40 text-sky-700 dark:text-sky-300",
  desarrollo: "border-primary/40 text-primary",
  trabajando: "border-primary/60 bg-primary/10 text-primary",
  decision: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  pausado: "border-border text-muted-foreground",
  bloqueado: "border-destructive/50 bg-destructive/10 text-destructive",
  validando: "border-violet-500/40 text-violet-700 dark:text-violet-300",
  listo: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  completado: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  error: "border-destructive/50 bg-destructive/10 text-destructive",
  archivado: "border-border text-muted-foreground",
};

type Row = { p: Project; plan: ProjectPlan | null; progress: ProgressInfo; status: ProjectStatusId; working: boolean; job: string | null };
type Detail = { kind: "proyecto"; id: string } | { kind: "sistema" } | null;
type SystemInfo = { updatedAt: string | null; errors: number | null; lastErrors: string[] };

const SECTIONS: Array<{ id: string; title: string; match: (s: ProjectStatusId) => boolean }> = [
  { id: "atencion", title: "Necesitan tu atención", match: needsAttention },
  { id: "desarrollo", title: "En desarrollo", match: (s) => s === "planificando" || s === "desarrollo" || s === "trabajando" || s === "validando" },
  { id: "pausados", title: "Pausados", match: (s) => s === "pausado" },
  { id: "completados", title: "Completados", match: (s) => s === "completado" || s === "listo" },
  { id: "archivados", title: "Archivados", match: (s) => s === "archivado" },
];

export function ProjectsView({ ping, onNewProject, onOpenProject }: { ping: Ping; onNewProject: () => void; onOpenProject: (p: Project) => void }) {
  const [settings] = useSettings();
  const { projects, trashed, loading } = useProjects();
  const tasks = useBackgroundTasks();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = usePersistentState<ProjectFilter>("proyectos:filtro", "todos");
  const [sort, setSort] = usePersistentState<ProjectSort>("proyectos:orden", "actividad");
  const [layout, setLayout] = usePersistentState<"cuadricula" | "lista">("proyectos:vista", "cuadricula");
  // Los 6 proyectos de ejemplo de antes no cuentan como tuyos: se ocultan (no se borran) y se pueden ver con un botón.
  const [showExamples, setShowExamples] = usePersistentState("proyectos:ver-ejemplos", false);
  const [detail, setDetail] = useState<Detail>(null);
  const [system, setSystem] = useState<SystemInfo>({ updatedAt: null, errors: null, lastErrors: [] });
  const [now, setNow] = useState(() => Date.now());

  // «Hace 5 min» se mantiene al día sin recargar nada.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // SÚPER IA: cuándo se instaló esta versión y los errores de verdad que ha habido desde que arrancó (Ajustes → Diagnóstico).
  useEffect(() => {
    let alive = true;
    void fetchLogs(false).then((r) => {
      if (!alive || !r || !Array.isArray(r.sources)) return;
      const errors = r.sources.find((s) => s.id === "errores");
      const update = r.sources.find((s) => s.id === "actualizacion");
      setSystem({ updatedAt: update?.updatedAt ?? null, errors: errors ? errors.total : null, lastErrors: errors?.lines.slice(-3) ?? [] });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  // SUPER WILLY trabajando (aunque estés aquí): en qué proyecto y qué está haciendo ahora.
  const job = tasks.find((t) => t.id === "superia" && t.state === "trabajando") ?? null;
  const workingId = job ? (job.projectId ?? settings.projectId ?? null) : null;

  const mine = useMemo(() => projects.filter((p) => !isExampleProject(p)), [projects]);
  const examples = projects.length - mine.length;
  const rows: Row[] = useMemo(() => (showExamples ? projects : mine).map((p) => {
    const plan = normalizePlan(p.plan ?? null);
    const progress = computeProgress(plan);
    const working = Boolean(workingId) && p.id === workingId;
    return { p, plan, progress, status: projectStatus({ state: p.state, working, plan, progress }), working, job: working ? job?.detail ?? "Trabajando…" : null };
  }), [projects, mine, showExamples, workingId, job?.detail]);

  const sysPlan = useMemo(() => systemPlan(), []);
  const sysProgress = useMemo(() => computeProgress(sysPlan), [sysPlan]);

  const q = norm(query.trim());
  const matchesQuery = (r: Row) => !q || norm(`${r.p.name} ${r.p.desc} ${kindLabel(r.p.kind) ?? ""}`).includes(q);
  const visible = rows.filter((r) => matchesQuery(r) && matchesFilter(r.status, false, filter));
  const showSystem = matchesFilter("desarrollo", true, filter) && (!q || norm(`${SYSTEM_PROJECT_NAME} super ia sistema willy`).includes(q));

  const counts = {
    total: rows.length,
    active: rows.filter((r) => ["planificando", "desarrollo", "trabajando", "validando"].includes(r.status)).length,
    done: rows.filter((r) => r.status === "completado" || r.status === "listo").length,
    attention: rows.filter((r) => needsAttention(r.status)).length,
  };

  // ----------------------------------------------------------------------------------------------- acciones
  const doRename = (p: Project) => {
    const name = window.prompt("Nuevo nombre del proyecto:", p.name);
    if (!name || name.trim() === p.name) return;
    void projectService.rename(p.id, name).then((r) => ping(r.ok ? `Proyecto renombrado a «${r.data.name}».` : `⚠️ ${r.error}`));
  };
  const doDuplicate = (p: Project) => void projectService.duplicate(p.id).then((r) => ping(r.ok ? `Copia creada: «${r.data.name}».` : `⚠️ ${r.error}`));
  const doState = (p: Project, state: ProjectState, text: string) => void projectService.setState(p.id, state).then((r) => ping(r.ok ? `«${p.name}» ${text}.` : `⚠️ ${r.error}`));
  const doSoftDelete = (p: Project) => void projectService.softDelete(p.id).then((r) => ping(r.ok ? `«${p.name}» se ha movido a la papelera.` : `⚠️ ${r.error}`));
  const doRestore = (p: Project) => void projectService.restore(p.id).then((r) => ping(r.ok ? `«${p.name}» restaurado.` : `⚠️ ${r.error}`));
  const doDestroy = (p: Project) => {
    if (!window.confirm(`¿Eliminar definitivamente «${p.name}» y sus versiones? Esta acción no se puede deshacer.`)) return;
    void projectService.destroy(p.id).then((r) => ping(r.ok ? `«${p.name}» eliminado definitivamente.` : `⚠️ ${r.error}`));
  };
  const doExport = (p: Project) => void projectService.get(p.id).then(async (full) => {
    if (!full?.files.length) { ping("Este proyecto todavía no tiene archivos que exportar."); return; }
    const r = await fileService.exportZip(full.name, full.files);
    ping(r.ok ? `«${full.name}» descargado en un ZIP (${r.data} archivos).` : `⚠️ ${r.error}`);
  });
  const analyze = (p: Project) => {
    sendToSuperWilly({ text: planJsonRequest(p.kind ?? "web", "analizar"), action: "cambio", attachments: [], images: [], urls: [], from: "proyectos", projectId: p.id, autoRun: true, analysis: true });
    ping(`WILLY está analizando «${p.name}» para calcular su progreso real.`);
  };
  const act = (r: Row) => {
    const a = primaryAction(r.status);
    if (a === "Reanudar") void projectService.setState(r.p.id, "Activo").then((res) => { if (res.ok) onOpenProject(res.data); else ping(`⚠️ ${res.error}`); });
    else onOpenProject(r.p);
  };

  const menuFor = (r: Row, close: () => void): ReactNode => (
    <>
      <MenuLabel>{r.p.name}</MenuLabel>
      <MenuItem onClick={() => { close(); onOpenProject(r.p); }}>Abrir en SUPER WILLY</MenuItem>
      <MenuItem onClick={() => { close(); setDetail({ kind: "proyecto", id: r.p.id }); }}>Ver el progreso</MenuItem>
      <MenuItem onClick={() => { close(); doRename(r.p); }}>Renombrar</MenuItem>
      <MenuItem onClick={() => { close(); doDuplicate(r.p); }}>Duplicar</MenuItem>
      {r.p.state === "Pausado"
        ? <MenuItem onClick={() => { close(); doState(r.p, "Activo", "vuelve a estar en marcha"); }}><Play className="size-4" />Reanudar</MenuItem>
        : r.p.state !== "Archivado" && <MenuItem onClick={() => { close(); doState(r.p, "Pausado", "queda en pausa"); }}><Pause className="size-4" />Pausar</MenuItem>}
      {r.p.state === "Archivado"
        ? <MenuItem onClick={() => { close(); doState(r.p, "Activo", "vuelve a estar en marcha"); }}><ArchiveRestore className="size-4" />Desarchivar</MenuItem>
        : <MenuItem onClick={() => { close(); doState(r.p, "Archivado", "queda archivado (no se borra nada)"); }}><Archive className="size-4" />Archivar</MenuItem>}
      <MenuItem onClick={() => { close(); doExport(r.p); }}><Download className="size-4" />Exportar (ZIP)</MenuItem>
      <div className="my-1 h-px bg-border" />
      <MenuItem danger onClick={() => { close(); doSoftDelete(r.p); }}><Trash2 className="size-4" />Mover a la papelera</MenuItem>
    </>
  );

  const detailRow = detail?.kind === "proyecto" ? rows.find((r) => r.p.id === detail.id) ?? null : null;

  return (
    <>
      <Head
        title="Proyectos"
        desc="Todo lo que WILLY está construyendo y manteniendo, guardado en tu propio disco."
        action={<Button className="gap-2" onClick={onNewProject}><Plus className="size-4" />Nuevo proyecto</Button>}
      />
      <p className="-mt-2 mb-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground" data-resumen-proyectos>
        <span><strong className="text-foreground">{counts.total}</strong> proyecto{counts.total === 1 ? "" : "s"}</span>
        <span><strong className="text-foreground">{counts.active}</strong> activo{counts.active === 1 ? "" : "s"}</span>
        <span><strong className="text-foreground">{counts.done}</strong> completado{counts.done === 1 ? "" : "s"}</span>
        <span className={counts.attention ? "font-semibold text-amber-700 dark:text-amber-300" : ""}><strong className={counts.attention ? "" : "text-foreground"}>{counts.attention}</strong> necesita{counts.attention === 1 ? "" : "n"} atención</span>
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 basis-60 items-center gap-2 rounded-lg border border-border bg-card px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input value={query} onChange={(e: { target: { value: string } }) => setQuery(e.target.value)} placeholder="Buscar proyecto..." className="h-10 w-full min-w-0 bg-transparent text-sm outline-none" aria-label="Buscar proyecto" />
        </div>
        <select value={sort} onChange={(e: { target: { value: string } }) => setSort(e.target.value as ProjectSort)} aria-label="Ordenar proyectos" className="h-10 rounded-lg border border-border bg-card px-2 text-sm">
          {(Object.keys(SORT_LABEL) as ProjectSort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
        </select>
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Cómo ver los proyectos">
          <button type="button" aria-pressed={layout === "cuadricula"} onClick={() => setLayout("cuadricula")} title="Cuadrícula" aria-label="Cuadrícula" className={`flex size-9 items-center justify-center rounded-md ${layout === "cuadricula" ? "bg-accent text-foreground" : "text-muted-foreground"}`}><LayoutGrid className="size-4" /></button>
          <button type="button" aria-pressed={layout === "lista"} onClick={() => setLayout("lista")} title="Lista" aria-label="Lista" className={`flex size-9 items-center justify-center rounded-md ${layout === "lista" ? "bg-accent text-foreground" : "text-muted-foreground"}`}><List className="size-4" /></button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar proyectos">
        {(Object.keys(FILTER_LABEL) as ProjectFilter[]).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {FILTER_LABEL[f]}{f === "atencion" && counts.attention ? ` (${counts.attention})` : ""}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Cargando proyectos...</p>}

      {showSystem && (
        <section aria-label="Sistema WILLY" className="mb-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Sistema WILLY</h2>
          <SystemCard progress={sysProgress} info={system} now={now} onProgress={() => setDetail({ kind: "sistema" })} />
        </section>
      )}

      {SECTIONS.map((section) => {
        const items = sortProjects(visible.filter((r) => section.match(r.status)).map((r) => ({ ...r, name: r.p.name, updatedAt: r.p.updatedAt, createdAt: r.p.createdAt, percent: r.progress.percent })), sort);
        if (!items.length) return null;
        return (
          <section key={section.id} aria-label={section.title} className="mb-6">
            <h2 className={`mb-2 text-xs font-bold uppercase tracking-wide ${section.id === "atencion" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{section.title} <span className="font-normal">· {items.length}</span></h2>
            {layout === "cuadricula" ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((r) => (
                  <ProjectCard key={r.p.id} row={r} now={now} onAction={() => act(r)} onProgress={() => setDetail({ kind: "proyecto", id: r.p.id })} onAnalyze={() => analyze(r.p)} menu={(close) => menuFor(r, close)} />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[640px] text-sm" aria-label={`${section.title}: lista`}>
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b border-border"><th className="px-3 py-2 font-semibold">Proyecto</th><th className="px-3 py-2 font-semibold">Estado</th><th className="px-3 py-2 font-semibold">Progreso</th><th className="px-3 py-2 font-semibold">Fase</th><th className="px-3 py-2 font-semibold">Última actividad</th><th className="px-3 py-2" /></tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.p.id} className="border-b border-border/60 last:border-b-0" aria-label={`Proyecto ${r.p.name}`}>
                        <td className="px-3 py-2"><span className="block truncate font-semibold">{r.p.name}</span><span className="block truncate text-xs text-muted-foreground">{kindLabel(r.p.kind) ?? "Proyecto"}</span></td>
                        <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                        <td className="w-40 px-3 py-2"><ProgressBar name={r.p.name} progress={r.progress} compact onOpen={() => setDetail({ kind: "proyecto", id: r.p.id })} /></td>
                        <td className="max-w-48 truncate px-3 py-2 text-xs text-muted-foreground" title={r.progress.phase}>{r.job ? `Ahora: ${r.job}` : r.progress.phase}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{relativeTime(r.p.updatedAt, now)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="secondary" className="h-8" aria-label={`${primaryAction(r.status)}: ${r.p.name}`} onClick={() => act(r)}>{primaryAction(r.status)}</Button>
                            <Menu label={`Acciones de ${r.p.name}`} align="end" trigger={({ toggle }) => (
                              <button type="button" onClick={toggle} aria-label={`Acciones de ${r.p.name}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"><MoreHorizontal className="size-4" /></button>
                            )}>{(close) => menuFor(r, close)}</Menu>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {!loading && mine.length === 0 && !query.trim() && !showExamples && (filter === "todos" || filter === "desarrollo") && (
        <Card className="space-y-2 text-sm">
          <p className="font-semibold">Todavía no tienes proyectos.</p>
          <p className="text-xs text-muted-foreground">Cuéntale a SUPER WILLY qué quieres crear: te hará unas preguntas, te propondrá funciones y el proyecto aparecerá aquí solo, guardado en tu equipo, con su progreso real.</p>
          <Button size="sm" className="gap-2" onClick={() => openView("superia")}><Sparkles className="size-4" />Ir a SUPER WILLY</Button>
        </Card>
      )}
      {!loading && visible.length === 0 && (rows.length > 0 || query.trim()) && !(filter === "sistema" && showSystem) && (
        <p className="text-sm text-muted-foreground">{query.trim() ? "Ningún proyecto coincide con la búsqueda." : `Ningún proyecto en «${FILTER_LABEL[filter]}».`}</p>
      )}
      {examples > 0 && (
        <button className="mt-3 text-xs font-semibold text-primary" onClick={() => setShowExamples(!showExamples)}>
          {showExamples ? "Ocultar los proyectos de ejemplo" : `Ver los ${examples} proyecto(s) de ejemplo de antes`}
        </button>
      )}
      {trashed.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Papelera</p>
          <div className="space-y-2">
            {trashed.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                <Trash2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => doRestore(p)}><RotateCcw className="size-3.5" />Restaurar</Button>
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => doDestroy(p)}><X className="size-3.5" />Eliminar</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {detailRow && (
        <ProgressModal row={detailRow} onClose={() => setDetail(null)} onOpen={() => { setDetail(null); onOpenProject(detailRow.p); }} onAnalyze={() => { setDetail(null); analyze(detailRow.p); }} ping={ping} />
      )}
      {detail?.kind === "sistema" && <SystemModal progress={sysProgress} plan={sysPlan} info={system} onClose={() => setDetail(null)} />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ piezas
function StatusChip({ status }: { status: ProjectStatusId }) {
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`} data-estado-proyecto={status}>
      {status === "trabajando" ? <Loader2 className="size-3 animate-spin" /> : needsAttention(status) ? <AlertTriangle className="size-3" /> : <span aria-hidden>●</span>}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** La barra de progreso REAL (o «Progreso no calculado»). Al pulsarla: el progreso por hitos y lo que falta. */
function ProgressBar({ name, progress, onOpen, compact = false }: { name: string; progress: ProgressInfo; onOpen: () => void; compact?: boolean }) {
  if (!progress.known) {
    return (
      <button type="button" onClick={onOpen} className="w-full text-left text-xs text-muted-foreground hover:text-foreground" aria-label={`Ver el progreso de ${name}`} data-progreso="no-calculado">
        <span className="font-semibold">—</span> Progreso no calculado
      </button>
    );
  }
  const pct = progress.percent ?? 0;
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Ver el progreso de ${name}`} data-progreso={pct}>
      {!compact && (
        <span className="mb-1 flex items-baseline justify-between text-xs">
          <span><strong className="text-sm text-foreground">{pct} %</strong> completado</span>
          <span className="text-muted-foreground">{progress.remaining} % restante</span>
        </span>
      )}
      <span className="block h-2 overflow-hidden rounded-full bg-accent" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Progreso de ${name}`}>
        <span className={`block h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </span>
      {compact && <span className="mt-0.5 block text-[11px] text-muted-foreground">{pct} % · faltan {progress.remaining} %</span>}
    </button>
  );
}

function ProjectCard({ row, now, onAction, onProgress, onAnalyze, menu }: {
  row: Row; now: number; onAction: () => void; onProgress: () => void; onAnalyze: () => void; menu: (close: () => void) => ReactNode;
}) {
  const { p, progress, status } = row;
  const Icon = ICONS[p.icon as ProjectIcon] ?? FolderKanban;
  const action = primaryAction(status);
  const attention = row.plan?.attention;
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4" aria-label={`Proyecto ${p.name}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="size-5 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{p.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{kindLabel(p.kind) ?? "Proyecto"}</span>
          </span>
        </span>
        <Menu label={`Acciones de ${p.name}`} align="end" trigger={({ toggle }) => (
          <button type="button" onClick={toggle} aria-label={`Acciones de ${p.name}`} className="rounded-md p-1 text-muted-foreground hover:bg-accent/60 hover:text-foreground"><MoreHorizontal className="size-4" /></button>
        )}>{menu}</Menu>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip status={status} />
        {(p.origin === "super-willy" || isExampleProject(p)) && (
          <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold ${p.origin === "super-willy" ? "border-primary/40 text-primary" : "border-border text-muted-foreground"}`}>
            {p.origin === "super-willy" ? <><Sparkles className="mr-1 inline size-3" />SUPER WILLY</> : "Ejemplo (sin trabajo)"}
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">{p.desc || "Sin descripción."}</p>
      {attention && (
        <p className={`rounded-lg border px-2 py-1.5 text-xs ${attention.kind === "decision" ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" : "border-destructive/40 bg-destructive/10 text-destructive"}`} data-atencion={attention.kind}>
          <strong>{attention.kind === "decision" ? "⚠ Necesita tu decisión: " : attention.kind === "bloqueo" ? "Bloqueado — falta: " : "Error: "}</strong>{attention.reason}
        </p>
      )}
      {/* La fase (o lo que hace WILLY ahora). Si hay algo pendiente de ti, ya lo dice el aviso; sin plan, no hay fase que decir. */}
      {(row.job || (progress.known && !attention)) && (
        <p className="truncate text-xs" title={row.job ?? progress.phase}>
          {row.job ? <><span className="font-semibold text-primary">Ahora:</span> {row.job}</> : <><span className="text-muted-foreground">Fase:</span> {progress.phase}</>}
        </p>
      )}
      <ProgressBar name={p.name} progress={progress} onOpen={onProgress} />
      {!progress.known && status !== "archivado" && (
        <Button size="sm" variant="outline" className="h-8 w-fit gap-1.5 text-xs" onClick={onAnalyze}><Wand2 className="size-3.5" />Analizar proyecto</Button>
      )}
      <div className="mt-auto flex items-center gap-2 pt-1">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={new Date(p.updatedAt).toLocaleString("es-ES")}>Actualizado: {relativeTime(p.updatedAt, now).replace(/^Hace/, "hace").replace(/^Ahora$/, "ahora").replace(/^Ayer$/, "ayer")} · {fileCountOf(p)} archivo(s)</span>
        <Button size="sm" variant={needsAttention(status) ? "default" : "secondary"} className="h-8 gap-1.5" aria-label={`${action}: ${p.name}`} onClick={onAction}>
          {action}<ArrowRight className="size-3.5" />
        </Button>
      </div>
    </article>
  );
}

function SystemCard({ progress, info, now, onProgress }: { progress: ProgressInfo; info: SystemInfo; now: number; onProgress: () => void }) {
  const updated = info.updatedAt ?? SYSTEM_REVISION_DATE;
  return (
    <article className="flex flex-col gap-2 rounded-xl border-2 border-primary/40 bg-primary/5 p-4" aria-label={`Proyecto ${SYSTEM_PROJECT_NAME}`} data-proyecto-sistema={SYSTEM_PROJECT_ID}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-base font-bold"><Sparkles className="size-5 text-primary" />{SYSTEM_PROJECT_NAME}</span>
        <span className="rounded-full border border-primary/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">Sistema</span>
      </div>
      <p className="text-sm text-muted-foreground">{SYSTEM_PROJECT_DESC}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusChip status="desarrollo" />
        <span className="text-muted-foreground">Fase:</span> <span className="font-semibold">{progress.phase}</span>
      </div>
      <ProgressBar name={SYSTEM_PROJECT_NAME} progress={progress} onOpen={onProgress} />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">Actualizado: {relativeTime(updated, now).toLowerCase()} · {info.errors === null ? "errores: sin datos" : info.errors ? `${info.errors} error(es) desde que arrancó` : "sin errores desde que arrancó"}</span>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={onProgress}><ListChecks className="size-3.5" />Ver progreso</Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => openView("superia")}><Sparkles className="size-3.5" />Abrir SUPER WILLY</Button>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => openView("autoconstruccion")}><Wrench className="size-3.5" />Continuar desarrollo</Button>
      </div>
    </article>
  );
}

function Milestones({ progress }: { progress: ProgressInfo }) {
  return (
    <ul className="space-y-1.5" aria-label="Progreso por hitos">
      {progress.milestones.map((m) => (
        <li key={m.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-sm">
          {m.state === "hecho" ? <Check className="size-4 text-emerald-500" /> : m.state === "en-curso" ? <CircleDot className="size-4 text-primary" /> : <Circle className="size-4 text-muted-foreground" />}
          <span className="min-w-0">
            <span className="flex items-baseline justify-between gap-2"><span className="truncate">{m.name}</span><span className="shrink-0 text-[11px] text-muted-foreground">{m.total ? `${m.done}/${m.total}` : "sin tareas"}</span></span>
            <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-accent"><span className={`block h-full ${m.state === "hecho" ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${m.percent ?? 0}%` }} /></span>
          </span>
          <span className="text-right font-mono text-xs">{m.percent === null ? "—" : `${m.percent} %`}</span>
        </li>
      ))}
    </ul>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscapeToClose(onClose);
  return (
    <div className="safe-modal fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-3 backdrop-blur-sm" onMouseDown={(e: { target: EventTarget; currentTarget: EventTarget }) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={title} className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border p-4">
          <h2 className="min-w-0 flex-1 font-display text-lg font-bold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></Button>
        </div>
        <div className="min-h-0 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

const BY_LABEL: Record<string, string> = { entrevista: "de la entrevista", willy: "marcada por WILLY", dueno: "marcada por ti", analisis: "del análisis", sistema: "del sistema" };

/** PROGRESO DEL PROYECTO (rediseño, puntos 66-67): por hitos, qué falta (derivado del plan real) y lo que puedes marcar tú. */
function ProgressModal({ row, onClose, onOpen, onAnalyze, ping }: { row: Row; onClose: () => void; onOpen: () => void; onAnalyze: () => void; ping: Ping }) {
  const { p, plan, progress } = row;
  const [busy, setBusy] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [milestone, setMilestone] = useState(plan?.milestones.find((m) => ["frontend", "endpoints", "logica"].includes(m.id))?.id ?? plan?.milestones[0]?.id ?? "");
  const save = (next: ProjectPlan, text: string) => {
    setBusy(true);
    void saveProjectPlan(p.id, next, { touch: true }).then((r) => {
      setBusy(false);
      ping(r.ok ? text : `⚠️ ${r.error}`);
    });
  };
  const toggle = (t: PlanTask, done: boolean) => {
    if (!plan || t.auto) return;
    save(setTaskStatus(plan, t.id, done ? "hecha" : "pendiente"), done ? `«${t.title}» marcada como hecha.` : `«${t.title}» vuelve a estar pendiente.`);
  };
  const add = () => {
    if (!plan || !newTask.trim()) return;
    const name = plan.milestones.find((m) => m.id === milestone)?.name ?? "";
    save(addTask(plan, name, newTask, 2), `Tarea añadida: «${newTask.trim()}». El alcance crece: el porcentaje puede bajar.`);
    setNewTask("");
  };
  const done = plan ? plan.milestones.flatMap((m) => m.tasks.filter((t) => effectiveStatus(t, plan.evidence) === "hecha").map((t) => ({ m: m.name, t }))) : [];
  return (
    <Modal title={`Progreso del proyecto · ${p.name}`} onClose={onClose}>
      {!progress.known ? (
        <div className="space-y-3 text-sm">
          <p><strong>Progreso no calculado.</strong> Este proyecto todavía no tiene plan (hitos y tareas), así que WILLY no se inventa un porcentaje.</p>
          <p className="text-muted-foreground">«Analizar proyecto»: WILLY revisa sus archivos de verdad, hace su plan con lo que ya está hecho y lo que falta, y desde ese momento el progreso es real. No cambia ningún archivo.</p>
          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" onClick={onAnalyze}><Wand2 className="size-4" />Analizar proyecto</Button>
            <Button variant="secondary" onClick={onOpen}>Abrir en SUPER WILLY</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
            <p className="text-3xl font-bold" data-progreso-total={progress.percent}>{progress.percent} %</p>
            <p className="pb-1 text-muted-foreground">completado · faltan {progress.remaining} %</p>
            <p className="w-full text-xs text-muted-foreground">Fase: <span className="font-semibold text-foreground">{progress.phase}</span> · Plan {plan?.source === "entrevista" ? "sacado de la entrevista" : plan?.source === "analisis" ? "hecho al analizar el proyecto" : "hecho por WILLY"}</p>
          </div>
          <Milestones progress={progress} />
          {plan?.evidence.tests && plan.evidence.tests.total > 0 && (
            <p className="text-xs" data-pruebas-proyecto>
              <span className="font-semibold">Pruebas automáticas:</span> {plan.evidence.tests.passed} de {plan.evidence.tests.total} bien
              {plan.evidence.tests.failed > 0 && <span className="text-destructive"> · {plan.evidence.tests.failed} falla{plan.evidence.tests.failed === 1 ? "" : "n"}</span>}
              {plan.evidence.filesKey && plan.evidence.tests.key !== plan.evidence.filesKey && <span className="text-amber-600 dark:text-amber-400"> · de antes del último cambio</span>}
            </p>
          )}
          {!progress.dod.met && progress.dod.missing.length > 0 && (
            <p className="rounded-lg border border-border bg-accent/40 px-3 py-2 text-xs" data-falta-100><strong>Para el 100 %:</strong> {progress.dod.missing.join(" · ")}.</p>
          )}
          <div>
            <p className="mb-1.5 font-semibold">Qué falta para terminar{progress.pending.length ? ` (${progress.pending.length})` : ""}</p>
            {progress.pending.length === 0 ? <p className="text-xs text-muted-foreground">Nada: todas las tareas están hechas.</p> : (
              <ul className="space-y-1" aria-label="Qué falta">
                {progress.pending.map(({ milestone: m, task }) => (
                  <li key={task.id} className="flex items-start gap-2 text-xs">
                    {task.auto
                      ? <span className="mt-0.5 inline-block size-3.5 shrink-0 rounded-sm border border-dashed border-muted-foreground/60" title="Se comprueba solo" />
                      : <input type="checkbox" className="mt-0.5" disabled={busy} checked={false} onChange={() => toggle(task, true)} aria-label={`Marcar como hecha: ${task.title}`} />}
                    <span className="min-w-0 flex-1"><span className="font-medium">{task.title}</span> <span className="text-muted-foreground">· {m}{task.auto ? " · se comprueba solo" : task.status === "en-curso" ? " · en curso" : ""}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={newTask} onChange={(e: { target: { value: string } }) => setNewTask(e.target.value)} placeholder="Añadir algo que falta…" aria-label="Nueva tarea" className="h-9 min-w-0 flex-1 basis-48 rounded-md border border-border bg-background px-2 text-sm" />
            <select value={milestone} onChange={(e: { target: { value: string } }) => setMilestone(e.target.value)} aria-label="Hito de la nueva tarea" className="h-9 rounded-md border border-border bg-background px-2 text-sm">
              {plan?.milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <Button size="sm" variant="secondary" className="h-9 gap-1.5" disabled={busy || !newTask.trim()} onClick={add}><Plus className="size-3.5" />Añadir</Button>
          </div>
          {done.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Hecho ({done.length})</summary>
              <ul className="mt-1.5 space-y-1" aria-label="Hecho">
                {done.map(({ m, t }) => (
                  <li key={t.id} className="flex items-start gap-2 text-xs">
                    {t.auto ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" /> : <input type="checkbox" className="mt-0.5" disabled={busy} checked onChange={() => toggle(t, false)} aria-label={`Volver a pendiente: ${t.title}`} />}
                    <span className="min-w-0 flex-1">{t.title} <span className="text-muted-foreground">· {m} · {t.auto ? "comprobado solo" : BY_LABEL[t.by ?? ""] ?? ""}</span></span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            <Button variant="ghost" onClick={onAnalyze} className="gap-1.5"><Wand2 className="size-4" />Volver a analizar</Button>
            <Button onClick={onOpen} className="gap-1.5">Abrir en SUPER WILLY<ArrowRight className="size-4" /></Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** SÚPER IA: su progreso por hitos, lo que falta (mejoras), sus versiones y pruebas, y los errores de verdad. */
function SystemModal({ progress, plan, info, onClose }: { progress: ProgressInfo; plan: ProjectPlan; info: SystemInfo; onClose: () => void }) {
  return (
    <Modal title={`${SYSTEM_PROJECT_NAME} · proyecto del sistema`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <p className="text-3xl font-bold" data-progreso-total={progress.percent}>{progress.percent} %</p>
          <p className="pb-1 text-muted-foreground">completado · faltan {progress.remaining} %</p>
          <p className="w-full text-xs text-muted-foreground">Fase: <span className="font-semibold text-foreground">{progress.phase}</span>. Sale de lo que ya está hecho en esta versión de WILLY frente a todo lo que pide el rediseño (no es un número puesto a mano).</p>
        </div>
        <Milestones progress={progress} />
        <div>
          <p className="mb-1.5 font-semibold">Mejoras pendientes ({progress.pending.length})</p>
          <ul className="space-y-1" aria-label="Mejoras pendientes">
            {progress.pending.map(({ milestone, task }) => <li key={task.id} className="text-xs"><Circle className="mr-1.5 inline size-3 text-muted-foreground" />{task.title} <span className="text-muted-foreground">· {milestone}</span></li>)}
          </ul>
        </div>
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Hecho ({plan.milestones.flatMap((m) => m.tasks).filter((t) => t.status === "hecha").length})</summary>
          <ul className="mt-1.5 space-y-1" aria-label="Hecho">
            {plan.milestones.flatMap((m) => m.tasks.filter((t) => t.status === "hecha").map((t) => <li key={t.id} className="text-xs"><Check className="mr-1.5 inline size-3 text-emerald-500" />{t.title} <span className="text-muted-foreground">· {m.name}</span></li>))}
          </ul>
        </details>
        <div>
          <p className="mb-1.5 font-semibold">Versiones y pruebas</p>
          <ul className="space-y-1" aria-label="Versiones de SÚPER IA">
            {SYSTEM_HISTORY.map((h) => <li key={h.rev} className="text-xs"><span className="font-semibold">Revisión {h.rev}</span> · {h.title}{h.checks ? <span className="text-muted-foreground"> · {h.checks} comprobaciones automáticas, 0 fallos</span> : null}</li>)}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 font-semibold">Errores</p>
          <p className="text-xs text-muted-foreground" data-errores-sistema>{info.errors === null ? "No se han podido leer los registros ahora mismo." : info.errors ? `${info.errors} error(es) del servidor desde que arrancó WILLY. Detalle en Ajustes → Diagnóstico.` : "Ningún error del servidor desde que arrancó WILLY."}</p>
          {info.lastErrors.length > 0 && <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-destructive">{info.lastErrors.map((l, i) => <li key={i} className="truncate" title={l}>{l}</li>)}</ul>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" className="gap-1.5" onClick={() => { onClose(); openView("superia"); }}><Sparkles className="size-4" />Abrir SUPER WILLY</Button>
          <Button className="gap-1.5" onClick={() => { onClose(); openView("autoconstruccion"); }}><Wrench className="size-4" />Continuar desarrollo</Button>
        </div>
      </div>
    </Modal>
  );
}
