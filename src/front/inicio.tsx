// INICIO (diseño de las maquetas de 24/09). Todo lo que enseña es real: el nombre del perfil, los proyectos con su plan y
// su progreso calculado (project-progress), los trabajos en segundo plano (background-tasks), lo que espera una decisión
// tuya, los avisos (notifications) y las operaciones de la Autoconstrucción. Sin datos de ejemplo: cuando no hay nada,
// lo dice y ofrece el siguiente paso.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowRight, BookOpen, Check, ChevronRight, FolderKanban, FolderOpen, Hammer, Image as ImageIcon, Languages,
  LayoutGrid, Loader2, MessageSquare, Mic, MoreHorizontal, Paperclip, Pause, Play, Plus, RotateCcw, ScanText, Send, Sparkles, Square,
  Trash2, UserRound, Video, Wand2, X,
} from "lucide-react";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import type { View } from "@/components/app-sections";
import { openView, useBackgroundTasks, type BackgroundTask } from "@/lib/background-tasks";
import { useNotices, type Notice } from "@/lib/notifications";
import { usePersistentState } from "@/lib/persistent-state";
import { useProfile } from "@/lib/profile";
import {
  STATUS_LABEL, computeProgress, needsAttention, normalizePlan, planJsonRequest, primaryAction, projectStatus, relativeTime, sortProjects,
  type ProgressInfo, type ProjectPlan, type ProjectStatusId,
} from "@/lib/project-progress";
import { sendToSuperWilly } from "@/lib/super-willy-handoff";
import { fetchSelfStatus, type StatusBody } from "@/lib/self-build-client";
import { SYSTEM_PROJECT_DESC, SYSTEM_PROJECT_NAME, systemPlan } from "@/lib/system-project";
import { useViewActive } from "@/lib/view-active";
import { startDictation, voiceSupported, type VoiceSession } from "@/lib/voice-input";
import { useSettings } from "@/lib/workspace-store";
import { projectService, useProjects } from "@/services/project-service";
import { isExampleProject, type Ping, type Project } from "@/types/domain";
import { WillyMascot } from "@/front/mascot";

export type InicioProps = {
  ping: Ping;
  onNav: (view: View, tab?: string) => void;
  onNewProject: () => void;
  onOpenProject: (p: Project) => void;
  /** Abre una conversación nueva en el Chat con lo escrito en la caja (y lo envía). */
  onAskWilly: (text: string, files: File[]) => void;
};

// ───────────────────────────────────────────────────────────────────────────── piezas visuales

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5 ${className}`}>{children}</section>;
}

function CardHead({ title, count, action, right }: { title: string; count?: number; action?: { label: string; onClick: () => void }; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[15px] font-bold">
        {title}
        {typeof count === "number" && count > 0 && <span className="grid size-5 place-items-center rounded-full bg-destructive text-[11px] font-bold text-destructive-foreground">{count}</span>}
      </h2>
      {right}
      {action && (
        <button type="button" onClick={action.onClick} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          {action.label} <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}

const STATUS_CHIP: Record<ProjectStatusId, string> = {
  planificando: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  desarrollo: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  trabajando: "bg-primary/10 text-primary",
  decision: "bg-warning/20 text-amber-700 dark:text-amber-300",
  pausado: "bg-warning/20 text-amber-700 dark:text-amber-300",
  bloqueado: "bg-destructive/10 text-destructive",
  validando: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  listo: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  completado: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  error: "bg-destructive/10 text-destructive",
  archivado: "bg-muted text-muted-foreground",
};

function StatusChip({ status, system = false }: { status: ProjectStatusId; system?: boolean }) {
  if (system) return <span className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-bold text-primary">Sistema</span>;
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_CHIP[status]}`}>{STATUS_LABEL[status]}</span>;
}

function ProgressBar({ progress, className = "" }: { progress: ProgressInfo; className?: string }) {
  if (!progress.known || progress.percent === null) {
    return <div className={`text-xs text-muted-foreground ${className}`}>Progreso no calculado</div>;
  }
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${progress.percent}%` }} />
      </div>
      <span className="shrink-0 text-sm font-bold tabular-nums">{progress.percent} %</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────── datos

type Row = { p: Project; plan: ProjectPlan | null; progress: ProgressInfo; status: ProjectStatusId; working: boolean };

function useRows(): { rows: Row[]; loading: boolean; tasks: BackgroundTask[] } {
  const { projects, loading } = useProjects();
  const tasks = useBackgroundTasks();
  const [settings] = useSettings();
  const job = tasks.find((t) => t.id === "superia" && t.state === "trabajando") ?? null;
  const workingId = job ? (job.projectId ?? settings.projectId ?? null) : null;
  const rows = useMemo(() => {
    const mine = projects.filter((p) => !isExampleProject(p) && p.state !== "Archivado");
    const built = mine.map((p): Row => {
      const plan = normalizePlan(p.plan ?? null);
      const progress = computeProgress(plan);
      const working = Boolean(workingId) && p.id === workingId;
      return { p, plan, progress, status: projectStatus({ state: p.state, working, plan, progress }), working };
    });
    const order = sortProjects(built.map((r) => ({ ...r, name: r.p.name, updatedAt: r.p.updatedAt, createdAt: r.p.createdAt, percent: r.progress.percent })), "actividad");
    return order.map((o) => built.find((r) => r.p.id === o.p.id)!);
  }, [projects, workingId]);
  return { rows, loading, tasks };
}

/** Las operaciones recientes de la Autoconstrucción, para «Actividad reciente» (se consultan al abrir la pantalla). */
function useSelfBuildActivity(): StatusBody["operations"] {
  const active = useViewActive();
  const [ops, setOps] = useState<StatusBody["operations"]>([]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void fetchSelfStatus().then((s) => { if (alive) setOps(s.operations.slice(-6)); }).catch(() => undefined);
    return () => { alive = false; };
  }, [active]);
  return ops;
}

type Attention = { id: string; title: string; reason: string; kind: "decision" | "revision" | "error"; when: string; action: { label: "Resolver" | "Revisar"; run: () => void } };

// ───────────────────────────────────────────────────────────────────────────── caja «Escribe tu idea…»

function AskBox({ onAsk, ping }: { onAsk: (text: string, files: File[]) => void; ping: Ping }) {
  const [text, setText] = usePersistentState("front:inicio:idea", "");
  const [files, setFiles] = useState<File[]>([]);
  const [listening, setListening] = useState(false);
  const voice = useRef<VoiceSession | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => voice.current?.stop(), []);

  const add = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    setFiles((f) => [...f, ...picked]);
    ping(picked.length === 1 ? `Archivo «${picked[0]!.name}» adjuntado.` : `${picked.length} archivos adjuntados.`);
  };
  const send = () => {
    const clean = text.trim();
    if (!clean && !files.length) { areaRef.current?.focus(); return; }
    onAsk(clean, files);
    setText("");
    setFiles([]);
  };
  const toggleVoice = () => {
    if (listening) { voice.current?.stop(); voice.current = null; setListening(false); return; }
    if (!voiceSupported()) { ping("Este navegador no permite usar el micrófono. Prueba con Chrome, Edge o Firefox."); return; }
    const session = startDictation({
      lang: "es-ES",
      onText: (t) => setText((c) => `${c}${c && !c.endsWith(" ") ? " " : ""}${t}`),
      onStatus: (m) => ping(m),
      onError: (m) => { setListening(false); voice.current = null; ping(m); },
      onEnd: () => { setListening(false); voice.current = null; },
    });
    if (!session) { ping("No se pudo iniciar el micrófono."); return; }
    voice.current = session;
    setListening(true);
  };
  const IconBtn = ({ label, onClick, children, active = false }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) => (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`grid size-9 place-items-center rounded-lg ${active ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>{children}</button>
  );
  return (
    <div className="rounded-2xl border border-border bg-card p-2 shadow-card">
      <div className="flex items-end gap-2">
        <span className="grid size-9 shrink-0 place-items-center text-primary" aria-hidden="true"><Sparkles className="size-5" /></span>
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Escribe tu idea, proyecto o consulta..."
          aria-label="Escribe tu idea, proyecto o consulta"
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] leading-5 outline-none placeholder:text-muted-foreground"
          style={{ height: "auto" }}
          onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${Math.min(160, el.scrollHeight)}px`; }}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <input ref={imageRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          <IconBtn label="Adjuntar imagen" onClick={() => imageRef.current?.click()}><ImageIcon className="size-[18px]" /></IconBtn>
          <IconBtn label="Adjuntar archivo" onClick={() => fileRef.current?.click()}><Paperclip className="size-[18px]" /></IconBtn>
          <IconBtn label={listening ? "Detener el dictado" : "Dictar por voz"} onClick={toggleVoice} active={listening}>{listening ? <Square className="size-4 fill-current" /> : <Mic className="size-[18px]" />}</IconBtn>
          <button type="button" onClick={send} aria-label="Enviar a WILLY" title="Enviar a WILLY" className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-glow hover:bg-primary/90"><Send className="size-4" /></button>
        </div>
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 pb-1 pt-1">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
              <Paperclip className="size-3" />{f.name}
              <button type="button" onClick={() => setFiles((list) => list.filter((_, j) => j !== i))} aria-label={`Quitar ${f.name}`} className="rounded p-0.5 hover:bg-background"><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────── pantalla

export function InicioScreen({ ping, onNav, onNewProject, onOpenProject, onAskWilly }: InicioProps) {
  const [profile] = useProfile();
  const { rows, loading, tasks } = useRows();
  const { notices } = useNotices();
  const ops = useSelfBuildActivity();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);

  const last = rows[0] ?? null;
  const working = tasks.filter((t) => t.state === "trabajando");
  const sysProgress = useMemo(() => computeProgress(systemPlan()), []);

  // Lo que espera algo de ti: trabajos con pregunta o error y proyectos bloqueados o esperando una decisión.
  const attention: Attention[] = [
    ...tasks.filter((t) => t.state === "pregunta" || t.state === "error").map((t): Attention => ({
      id: `tarea-${t.id}`, title: t.title, reason: t.detail ?? (t.state === "error" ? "Ha fallado" : "Tiene una pregunta para ti"),
      kind: t.state === "error" ? "error" : "decision", when: "",
      action: { label: t.state === "error" ? "Revisar" : "Resolver", run: () => { if (t.restore) t.restore(); else if (t.view) openView(t.view); } },
    })),
    ...rows.filter((r) => needsAttention(r.status)).map((r): Attention => ({
      id: `proyecto-${r.p.id}`, title: r.p.name, reason: r.plan?.attention?.reason ?? STATUS_LABEL[r.status],
      kind: r.status === "error" ? "error" : r.status === "decision" ? "decision" : "revision", when: relativeTime(r.plan?.attention?.at ?? r.p.updatedAt, now),
      action: { label: "Resolver", run: () => onOpenProject(r.p) },
    })),
  ];

  // Actividad reciente: avisos de WILLY y operaciones de la Autoconstrucción, por fecha.
  type Activity = { id: string; title: string; detail: string; at: number; icon: typeof Sparkles };
  const activity: Activity[] = [
    ...notices.map((n: Notice): Activity => ({ id: `aviso-${n.id}`, title: n.text.length > 60 ? `${n.text.slice(0, 60)}…` : n.text, detail: n.kind === "warn" ? "Aviso" : n.kind === "success" ? "Hecho" : "Información", at: n.at, icon: n.kind === "warn" ? AlertTriangle : Check })),
    ...ops.map((o): Activity => ({ id: `op-${o.op}`, title: o.objective.length > 60 ? `${o.objective.slice(0, 60)}…` : o.objective, detail: `Autoconstrucción · ${o.detail || o.outcome}`, at: Date.parse(o.at) || 0, icon: Hammer })),
  ].sort((a, b) => b.at - a.at).slice(0, 5);

  const quick: Array<{ icon: typeof Plus; title: string; desc: string; onClick: () => void; primary?: boolean }> = [
    { icon: Plus, title: "Crear proyecto", desc: "Construye algo nuevo con Súper IA", onClick: onNewProject, primary: true },
    { icon: MessageSquare, title: "Hablar con WILLY", desc: "Conversación general", onClick: () => onNav("chat") },
    { icon: LayoutGrid, title: "Usar herramientas", desc: "OCR, traducir, vídeo, datos...", onClick: () => onNav("herramientas") },
    { icon: FolderOpen, title: "Ver mis proyectos", desc: "Todo lo que estás construyendo", onClick: () => onNav("proyectos") },
  ];

  // Herramientas rápidas: solo las que abren una pantalla real. Las dos marcadas «pendiente» esperan la decisión del dueño.
  const tools: Array<{ icon: typeof Languages; title: string; desc: string; onClick?: () => void; pending?: string }> = [
    { icon: Languages, title: "Traducir", desc: "Texto, documentos y vídeo", onClick: () => onNav("traducir") },
    { icon: ScanText, title: "OCR", desc: "Extrae texto de imágenes y PDFs", onClick: () => onNav("ocr") },
    { icon: UserRound, title: "IA Influencer", desc: "Crea contenido con IA", pending: "Pendiente de decidir qué abre (no existe todavía ninguna pantalla «IA Influencer»; lo más parecido es «Mi yo en IA»)." },
    { icon: Video, title: "Vídeo IA", desc: "Genera, edita y dobla vídeos", pending: "Pendiente de decidir qué abre: hoy existen «Traducir» (vídeo doblado y narrado) y «Mi yo en IA» (vídeo con tu cara)." },
    { icon: BookOpen, title: "Lectura", desc: "Lee y resume documentos", onClick: () => onNav("lectura") },
    { icon: MoreHorizontal, title: "Más herramientas", desc: "Explora todas las capacidades", onClick: () => onNav("herramientas") },
  ];

  const firstName = profile.name.trim() || "Antonio";

  return (
    <section className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-background" aria-label="Inicio">
      <div className="mx-auto w-full max-w-[1240px] px-4 pb-8 pt-5 sm:px-6">
        {/* Cabecera con la mascota */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-tight sm:text-[32px]"><span aria-hidden="true">👋 </span>Hola, {firstName}</h1>
            <p className="mt-1 text-lg font-bold">¿Qué quieres hacer hoy?</p>
            <p className="text-sm text-muted-foreground">Describe una idea, pregunta o tarea, y WILLY te ayudará.</p>
          </div>
          <div className="hidden shrink-0 items-center gap-3 md:flex">
            <WillyMascot className="h-28 w-auto" />
            <p className="max-w-[170px] font-display text-[15px] font-semibold leading-snug text-primary">“Tus ideas,<br />mis herramientas,<br /><span className="font-extrabold">sin límites.”</span></p>
          </div>
        </div>

        <AskBox onAsk={onAskWilly} ping={ping} />

        {/* Accesos */}
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {quick.map((q) => (
            <button key={q.title} type="button" onClick={q.onClick}
              className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition-transform hover:-translate-y-0.5 ${q.primary ? "border-primary bg-primary text-primary-foreground shadow-glow" : "border-border bg-card shadow-card hover:border-primary/40"}`}>
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${q.primary ? "bg-white/15" : "bg-accent text-primary"}`}><q.icon className="size-5" /></span>
              <span className="min-w-0"><span className="block text-[15px] font-bold">{q.title}</span><span className={`block truncate text-xs ${q.primary ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{q.desc}</span></span>
            </button>
          ))}
        </div>

        {/* Continúa · Atención · Trabajando */}
        <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_1fr_1fr]">
          <Card>
            <CardHead title="Continúa donde lo dejaste" action={{ label: "Ver todos", onClick: () => onNav("proyectos") }} />
            {loading && !last && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Leyendo tus proyectos…</p>}
            {!loading && !last && (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Todavía no tienes proyectos. <button type="button" onClick={onNewProject} className="font-semibold text-primary hover:underline">Crea el primero con Súper IA</button>.
              </div>
            )}
            {last && <ContinueCard row={last} now={now} ping={ping} onOpen={onOpenProject} onProgress={() => onNav("proyectos")} />}
          </Card>

          <Card>
            <CardHead title="Necesita tu atención" count={attention.length} action={{ label: "Ver todas", onClick: () => onNav("proyectos") }} />
            {attention.length === 0 && <p className="text-sm text-muted-foreground">Nada pendiente de ti ahora mismo.</p>}
            <div className="space-y-2">
              {attention.slice(0, 3).map((a) => (
                <div key={a.id} className={`flex items-center gap-3 rounded-xl border p-3 ${a.kind === "error" ? "border-destructive/30 bg-destructive/5" : "border-warning/50 bg-warning/10"}`}>
                  <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${a.kind === "error" ? "bg-destructive/10 text-destructive" : "bg-warning/25 text-amber-700 dark:text-amber-300"}`}><AlertTriangle className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{a.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.reason}</span>
                    {a.when && <span className="block text-[11px] text-muted-foreground">{a.when}</span>}
                  </span>
                  <button type="button" onClick={a.action.run} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold ${a.kind === "error" ? "bg-destructive/10 text-destructive hover:bg-destructive/20" : "bg-card text-foreground shadow-card hover:bg-accent"}`}>{a.action.label}</button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead title="WILLY está trabajando" right={<span className={`flex items-center gap-1.5 text-xs font-semibold ${working.length ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${working.length ? "animate-pulse bg-success" : "bg-muted-foreground/50"}`} />{working.length ? `${working.length} tarea${working.length > 1 ? "s" : ""} en curso` : "En reposo"}</span>} />
            {working.length === 0 && <p className="text-sm text-muted-foreground">Ahora mismo no hay ningún trabajo en marcha. Lo que pidas a Súper IA, Traducir o Mi yo en IA aparecerá aquí.</p>}
            <div className="space-y-3">
              {working.slice(0, 2).map((t) => {
                const projectRow = t.projectId ? rows.find((r) => r.p.id === t.projectId) : undefined;
                return (
                  <div key={t.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary"><Loader2 className="size-4 animate-spin" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{projectRow?.p.name ?? t.title}</span><span className="block truncate text-xs text-muted-foreground">{t.detail ?? "Trabajando…"}</span></span>
                      <button type="button" onClick={() => { if (t.restore) t.restore(); else if (t.view) openView(t.view); }} className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-primary hover:bg-accent">Ver</button>
                    </div>
                    {projectRow && projectRow.progress.known ? <ProgressBar progress={projectRow.progress} className="mt-2" /> : (
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-label="Progreso no medible todavía"><div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" /></div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Proyectos recientes · Actividad reciente */}
        <div className="mt-3 grid gap-3 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHead title="Proyectos recientes" action={{ label: "Ver todos", onClick: () => onNav("proyectos") }} />
            <div className="grid gap-3 sm:grid-cols-3">
              <button type="button" onClick={() => onNav("superia")} className="rounded-xl border border-border p-3 text-left hover:border-primary/40">
                <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-accent text-primary"><Sparkles className="size-4" /></span><span className="min-w-0"><span className="block truncate text-sm font-bold">{SYSTEM_PROJECT_NAME}</span><span className="block truncate text-[11px] text-muted-foreground">Sistema principal de WILLY</span></span></div>
                <ProgressBar progress={sysProgress} className="mt-3" />
                <div className="mt-2"><StatusChip status="desarrollo" system /></div>
                <span className="sr-only">{SYSTEM_PROJECT_DESC}</span>
              </button>
              {rows.slice(0, 2).map((r) => (
                <button key={r.p.id} type="button" onClick={() => onOpenProject(r.p)} className="rounded-xl border border-border p-3 text-left hover:border-primary/40">
                  <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-accent text-primary"><FolderKanban className="size-4" /></span><span className="min-w-0"><span className="block truncate text-sm font-bold">{r.p.name}</span><span className="block truncate text-[11px] text-muted-foreground">{r.p.desc || "Sin descripción"}</span></span></div>
                  <ProgressBar progress={r.progress} className="mt-3" />
                  <div className="mt-2"><StatusChip status={r.status} /></div>
                </button>
              ))}
              {rows.length === 0 && !loading && (
                <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground sm:col-span-2">Aquí saldrán tus proyectos en cuanto crees el primero.</div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="Actividad reciente" action={{ label: "Ver todas", onClick: () => onNav("historial") }} />
            {activity.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay actividad registrada en este equipo.</p>}
            <ul className="space-y-2.5">
              {activity.map((a) => (
                <li key={a.id} className="flex items-start gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary"><a.icon className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{a.title}</span><span className="block truncate text-xs text-muted-foreground">{a.detail}</span></span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{a.at ? relativeTime(new Date(a.at).toISOString(), now) : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Herramientas rápidas */}
        <Card className="mt-3">
          <CardHead title="Herramientas rápidas" action={{ label: "Ver todas las herramientas", onClick: () => onNav("herramientas") }} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tools.map((t) => (
              <button key={t.title} type="button"
                onClick={t.onClick ?? (() => ping(`«${t.title}»: ${t.pending ?? "pendiente"}`))}
                title={t.pending}
                aria-describedby={t.pending ? `pendiente-${t.title}` : undefined}
                className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left ${t.pending ? "border-dashed border-border opacity-80" : "border-border hover:border-primary/40"}`}>
                <span className="grid size-9 place-items-center rounded-lg bg-accent text-primary"><t.icon className="size-[18px]" /></span>
                <span className="text-sm font-bold">{t.title}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">{t.desc}</span>
                {t.pending && <span id={`pendiente-${t.title}`} className="rounded-md bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">Pendiente de decisión</span>}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}

function ContinueCard({ row, now, ping, onOpen, onProgress }: { row: Row; now: number; ping: Ping; onOpen: (p: Project) => void; onProgress: () => void }) {
  const { p, progress, status } = row;
  const action = primaryAction(status);
  const act = () => {
    if (action === "Reanudar") void projectService.setState(p.id, "Activo").then((r) => { if (r.ok) onOpen(r.data); else ping(`⚠️ ${r.error}`); });
    else onOpen(p);
  };
  const doState = (state: "Activo" | "Pausado", text: string) => void projectService.setState(p.id, state).then((r) => ping(r.ok ? `«${p.name}» ${text}.` : `⚠️ ${r.error}`));
  // «Analizar proyecto»: el mismo encargo real que usa la pantalla Proyectos (WILLY revisa los archivos y hace el plan, sin cambiar nada).
  const analyze = () => {
    sendToSuperWilly({ text: planJsonRequest(p.kind ?? "web", "analizar"), action: "cambio", attachments: [], images: [], urls: [], from: "proyectos", projectId: p.id, autoRun: true, analysis: true });
    ping(`WILLY está analizando «${p.name}» para calcular su progreso real.`);
  };
  return (
    <div className="rounded-xl border border-border p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary"><FolderKanban className="size-5" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-bold">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.desc || "Sin descripción"}</span></span>
        <StatusChip status={status} />
      </div>
      <ProgressBar progress={progress} className="mt-3" />
      {progress.known ? (
        <p className="mt-2 text-sm"><span className="font-semibold">Fase actual:</span> {progress.phase || STATUS_LABEL[status]}</p>
      ) : (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sin plan todavía.</span>
          <button type="button" onClick={analyze} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-bold hover:border-primary/50 hover:bg-accent"><Wand2 className="size-3.5" />Analizar proyecto</button>
        </p>
      )}
      <p className="text-xs text-muted-foreground">Última actividad: {relativeTime(p.updatedAt, now).toLowerCase()}</p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={act} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-glow hover:bg-primary/90">{action}</button>
        <Menu label={`Acciones de ${p.name}`} align="end" trigger={({ toggle }) => (
          <button type="button" onClick={toggle} aria-label={`Más acciones de ${p.name}`} className="grid size-9 place-items-center rounded-lg border border-border hover:bg-accent"><MoreHorizontal className="size-4" /></button>
        )}>
          {(close) => (
            <>
              <MenuLabel>{p.name}</MenuLabel>
              <MenuItem onClick={() => { close(); onOpen(p); }}><Wand2 className="size-4" />Abrir en Súper IA</MenuItem>
              <MenuItem onClick={() => { close(); onProgress(); }}><ChevronRight className="size-4" />Ver el progreso</MenuItem>
              {p.state === "Pausado"
                ? <MenuItem onClick={() => { close(); doState("Activo", "vuelve a estar en marcha"); }}><Play className="size-4" />Reanudar</MenuItem>
                : <MenuItem onClick={() => { close(); doState("Pausado", "queda en pausa"); }}><Pause className="size-4" />Pausar</MenuItem>}
              <MenuItem onClick={() => { close(); void projectService.duplicate(p.id).then((r) => ping(r.ok ? `Copia creada: «${r.data.name}».` : `⚠️ ${r.error}`)); }}><RotateCcw className="size-4" />Duplicar</MenuItem>
              <div className="my-1 h-px bg-border" />
              <MenuItem danger onClick={() => { close(); void projectService.softDelete(p.id).then((r) => ping(r.ok ? `«${p.name}» se ha movido a la papelera.` : `⚠️ ${r.error}`)); }}><Trash2 className="size-4" />Mover a la papelera</MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}
