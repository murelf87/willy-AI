import { useEffect, useRef, useState, type ReactNode } from "react";
import { AGENTS } from "@/lib/project-work";
import { Activity, Bot, Check, Clock, Cloud, Cpu, Download, Gauge, LayoutDashboard, Loader2, MemoryStick, Play, RefreshCw, RotateCw, ScrollText, Settings2, Sparkles, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard as Card } from "@/components/panel-card";
import { EngineCheck } from "@/components/engine-check";
import { EnginesPanel } from "@/components/engines-panel";
import { ExternalAiPanel, useExternalAi } from "@/components/chat-engine-chip";
import { engineCommand } from "@/lib/engines-client";
import { BUILD_ORDER, CHAT_ORDER, KIND_CLOUD_ORDER, usableInOrder } from "@/lib/routing-table";
import { planChain, TASK_LABELS, type TaskKind } from "@/services/orchestrator";
import { SectionHead, SectionTabs, StatusIcon, Toggle, type Tone } from "@/components/section-ui";
import { useViewActive } from "@/lib/view-active";
import { requestSectionTab, useSectionTab } from "@/lib/section-tabs";
import { fetchOllama, runDiagnosis, systemAction, type OllamaReport } from "@/lib/maintenance-client";
import { openView } from "@/lib/background-tasks";
import { CHAT_EVENT, listThreads } from "@/lib/chat-history";
import { relativeTime } from "@/lib/project-progress";
import { listSessions } from "@/services/worklog";
import { formatMB } from "@/lib/system-info";
import { formatBytes } from "@/lib/profile";
import { pingEndpoint, useSettings } from "@/lib/workspace-store";
import { aiService } from "@/services/ai-service";
import { readSuperMode, writeSuperMode, SUPER_MODES, SUPER_MODE_EVENT, type SuperMode } from "@/lib/super-willy";
import {
  CATALOG_TAGS, MODEL_CATALOG, pullModel, removeModel,
  type CatalogModel, type CatalogTag, type PullProgress,
} from "@/services/model-catalog";
import type { Ping } from "@/types/domain";

// CENTRO DE INTELIGENCIA (revisión 29, rediseño sobre maquetas del dueño 24/09/2026): todas las IA de WILLY en un sitio.
// «Resumen» reúne, con datos reales de los apartados que ya existían, lo que antes había que ir a buscar a cada pestaña.
// «Modelos» junta la IA de tu equipo (Ollama, antes su propia pestaña) con el catálogo: es lo mismo, visto junto.
// «Proveedores» es la antigua «IA externas», con el mismo panel de siempre (EnginesPanel/ExternalAiPanel), solo con otro
// nombre y sus tarjetas reordenadas como en la maqueta. «Agentes» sigue igual: los 5 papeles reales de SUPER WILLY.
// «Uso y costes» es nuevo: peticiones de hoy por proveedor (lo que ya cuenta engines-server para el tope diario) — no hay
// «coste» en euros porque WILLY solo usa niveles gratuitos (nunca gasta dinero por su cuenta, así que el coste real es 0).
//
// «Routing» (25/09/2026) enseña la tabla de enrutado que se usa de verdad: los órdenes del chat, del «plug and play» y de
// la Autoconstrucción viven ahora en un solo sitio (routing-table.ts) y esta pestaña lee esa misma tabla más el estado real
// de cada IA externa. De los 4 interruptores de la maqueta, dos existen de verdad (usar IA externas y externas primero en el
// automático = calidad/ahorro) y se cambian aquí con las mismas órdenes que Proveedores y el chat; los otros dos son reglas
// fijas de WILLY (relevo a tu equipo y solo gratis) y se enseñan como tales, sin un interruptor falso. «Resumen» sigue
// trayendo el selector real de modo de SUPER WILLY (Externa primero / Híbrida / Local primero / Solo local).

export const INTELLIGENCE_TABS = ["resumen", "modelos", "proveedores", "agentes", "routing", "uso"] as const;
export type IntelligenceTab = (typeof INTELLIGENCE_TABS)[number];

const TAB_LABELS: ReadonlyArray<readonly [IntelligenceTab, string]> = [
  ["resumen", "Resumen"],
  ["modelos", "Modelos"],
  ["proveedores", "Proveedores"],
  ["agentes", "Agentes"],
  ["routing", "Routing"],
  ["uso", "Uso y costes"],
];

/** Los papeles que SUPER WILLY tiene en cuenta al construir o cambiar un proyecto (se le indican en cada petición del proyecto). */
export { AGENTS } from "@/lib/project-work";

/**
 * Cómo se ven en pantalla los papeles de los agentes: son los de project-work.ts (sus nombres internos siguen igual porque
 * van en las peticiones y en tus ajustes guardados); aquí solo se ponen en español, como pide el diseño del dueño.
 */
const AGENT_LABEL: Record<string, string> = { Analist: "Analista", Programmer: "Programador", Tester: "Revisor", Debugger: "Depurador", Designer: "Diseñador UI" };
const agentLabel = (name: string): string => AGENT_LABEL[name] ?? name;

export function IntelligenceCenter({ ping }: { ping: Ping }) {
  const [tab, setTab] = useSectionTab<IntelligenceTab>("inteligencia", INTELLIGENCE_TABS, "resumen");
  const [report, setReport] = useState<OllamaReport | null>(null);
  const [state, setState] = useState<"cargando" | "ok" | "error">("cargando");
  const active = useViewActive();

  const load = async (announce = false) => {
    setState("cargando");
    const data = await fetchOllama();
    setReport(data);
    setState(data ? "ok" : "error");
    if (announce) ping(!data ? "⚠️ El servidor de WILLY no respondió." : data.alive ? `La IA de tu equipo responde (Ollama ${data.version ?? ""}, ${data.models.length} modelo(s)).` : "La IA de tu equipo (Ollama) no responde.");
  };

  useEffect(() => {
    // Solo mientras se ve: una pestaña oculta no consulta nada.
    if (!active) return;
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 20_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <>
      <SectionHead title="Centro de Inteligencia" desc="Todas las IA de WILLY en un sitio: la de tu equipo, las externas gratuitas, los modelos y los agentes." />
      <SectionTabs label="Apartados del Centro de Inteligencia" tabs={TAB_LABELS} value={tab} onChange={setTab} />
      {tab === "resumen" && <SummaryTab report={report} state={state} onGo={setTab} ping={ping} />}
      {tab === "modelos" && <ModelsTab ping={ping} report={report} state={state} onRefresh={() => void load(true)} onChanged={() => void load()} />}
      {tab === "proveedores" && <ProvidersTab ping={ping} />}
      {tab === "agentes" && <AgentsTab ping={ping} />}
      {tab === "routing" && <RoutingTab report={report} onGo={setTab} ping={ping} />}
      {tab === "uso" && <UsageTab report={report} />}
    </>
  );
}

// ───────────────────────────────────────────────────────────── Resumen

function ModeCard() {
  const [mode, setMode] = useState<SuperMode>("externa");
  useEffect(() => {
    const sync = () => setMode(readSuperMode());
    sync();
    window.addEventListener(SUPER_MODE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(SUPER_MODE_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const current = SUPER_MODES.find((m) => m.id === mode) ?? SUPER_MODES[0]!;
  return (
    <Card>
      <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Sparkles className="size-4 text-primary" />Modo de SUPER WILLY</p>
      <p className="mb-2 text-lg font-semibold">{current.icon} {current.label}</p>
      <p className="mb-3 text-xs text-muted-foreground">{current.desc}</p>
      <div className="space-y-1" role="radiogroup" aria-label="Modo de IA de SUPER WILLY">
        {SUPER_MODES.map((m) => (
          <label key={m.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${mode === m.id ? "border-primary/50 bg-primary/10" : "border-border hover:bg-accent/40"}`}>
            <input type="radio" name="ci-superwilly-modo" className="mt-0.5 accent-primary" checked={mode === m.id} onChange={() => { writeSuperMode(m.id); setMode(m.id); }} />
            <span className="min-w-0"><span className="font-semibold text-foreground">{m.icon} {m.label}</span></span>
          </label>
        ))}
      </div>
    </Card>
  );
}

function StatCard({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: Tone | undefined }) {
  return (
    <Card className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-semibold ${tone === "ok" ? "text-emerald-600" : tone === "fallo" ? "text-destructive" : tone === "aviso" ? "text-amber-600" : ""}`}>{value}</p>
      </div>
    </Card>
  );
}

function SummaryTab({ report, state, onGo, ping }: { report: OllamaReport | null; state: "cargando" | "ok" | "error"; onGo: (tab: IntelligenceTab) => void; ping: Ping }) {
  const ai = useExternalAi();
  const engines = ai.status?.engines ?? [];
  const withKey = engines.filter((e) => e.hasKey);
  const ready = engines.filter((e) => e.hasKey && e.enabled && e.available);
  const localOk = report?.alive ?? false;
  const salud: Tone = localOk && (!withKey.length || ready.length > 0 || engines.every((e) => !e.hasKey)) ? "ok" : localOk || ready.length ? "aviso" : "fallo";
  const [diag, setDiag] = useState<{ overall: string; notes: string[]; at: number } | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  // «Ejecutar diagnóstico» y «Ver logs» (maqueta): el mismo diagnóstico completo de Ajustes → Diagnóstico, sin salir de aquí.
  const diagnose = async () => {
    setDiagBusy(true);
    const r = await runDiagnosis();
    setDiagBusy(false);
    if (!r.ok) { ping(`⚠️ ${r.error}`); return; }
    const notes = r.report.checks.filter((c) => c.status === "fallo" || c.status === "aviso").map((c) => c.label);
    setDiag({ overall: r.report.overall, notes, at: Date.now() });
    ping(r.report.overall === "todo bien" ? "Diagnóstico terminado: todo bien." : `Diagnóstico terminado: ${r.report.overall}.`);
  };
  const openDiagnosis = () => { requestSectionTab("ajustes", "diagnostico"); openView("ajustes"); };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Cloud className="size-4" />} label="Proveedores con clave" value={String(withKey.length)} />
        <StatCard icon={<Sparkles className="size-4" />} label="Listos ahora mismo" value={String(ready.length)} tone={ready.length ? "ok" : undefined} />
        <StatCard icon={<Cpu className="size-4" />} label="Modelos en tu equipo" value={state === "cargando" ? "…" : report?.alive ? String(report.models.length) : "—"} tone={report?.alive ? "ok" : undefined} />
        <StatCard icon={<Gauge className="size-4" />} label="Salud general" value={state === "cargando" ? "Comprobando…" : salud === "ok" ? "Todo operativo" : salud === "aviso" ? "Revisar" : "Con problemas"} tone={salud} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <RoutingSummaryCard report={report} onGo={onGo} />
        <Card>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><LayoutDashboard className="size-4 text-primary" />Salud y diagnóstico</p>
          <Row label="IA de tu equipo (Ollama)" value={state === "cargando" ? "Comprobando…" : report?.alive ? `Operativo (Ollama ${report.version ?? ""})` : "No responde"} tone={report?.alive ? "ok" : state === "cargando" ? undefined : "fallo"} />
          <Row label="Proveedores externos con clave" value={withKey.length ? `${ready.length} de ${withKey.length} disponibles ahora` : "Ninguno configurado"} tone={withKey.length && ready.length === 0 ? "aviso" : undefined} />
          <Row label="Última comprobación" value={report ? new Date(report.checkedAt).toLocaleTimeString("es-ES") : "—"} />
          <AvatarEnginesStatus />
          {diag && (
            <p className={`mt-2 text-xs font-semibold ${diag.notes.length ? "text-amber-600" : "text-emerald-600"}`}>
              Diagnóstico de las {new Date(diag.at).toLocaleTimeString("es-ES")}: {diag.overall}{diag.notes.length ? ` · ${diag.notes.slice(0, 4).join(", ")}` : ""}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5" disabled={diagBusy} onClick={() => void diagnose()}>
              {diagBusy ? <Loader2 className="size-4 animate-spin" /> : <Stethoscope className="size-4" />}{diagBusy ? "Comprobando…" : "Ejecutar diagnóstico"}
            </Button>
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={openDiagnosis}><ScrollText className="size-4" />Ver logs</Button>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <ProvidersSummaryCard report={report} onGo={onGo} ping={ping} />
        <GlobalPrefsCard onGo={onGo} ping={ping} />
      </div>

      <ModeCard />

      <div className="grid gap-3 lg:grid-cols-3">
        <CapabilitiesSummaryCard report={report} onGo={onGo} />
        <Card>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Bot className="size-4 text-primary" />Agentes y especialistas</p>
          <p className="mb-2 text-xs text-muted-foreground">Los papeles que SUPER WILLY tiene en cuenta al construir o cambiar un proyecto.</p>
          <div className="grid gap-1.5">
            {AGENTS.map((agent) => (
              <div key={agent.name} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs">
                <Bot className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 truncate"><span className="font-semibold">{agentLabel(agent.name)}</span> · {agent.role}</span>
              </div>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => onGo("agentes")}>Gestionar agentes</Button>
        </Card>
        <RecentModelsCard onGo={onGo} />
      </div>
    </div>
  );
}

/** Enrutado inteligente, en corto (maqueta): qué IA contesta ahora en cada sitio; el detalle y los interruptores, en «Routing». */
function RoutingSummaryCard({ report, onGo }: { report: OllamaReport | null; onGo: (tab: IntelligenceTab) => void }) {
  const { contexts } = useRoutingNow(report);
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold"><Activity className="size-4 text-primary" />Enrutado inteligente</p>
          <p className="text-xs text-muted-foreground">WILLY decide qué IA contesta según el sitio, la tarea y lo que está disponible ahora mismo.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => onGo("routing")}><Settings2 className="size-4" />Editar reglas</Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {contexts.map((c) => (
          <div key={c.title} className="rounded-lg border border-border p-2.5">
            <p className="text-xs font-semibold">{c.title}</p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{c.short}</p>
          </div>
        ))}
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs">
        <li>Prioridad: las IA externas gratuitas (nunca nada de pago).</li>
        <li>Relevo: tu equipo (Ollama) si ninguna externa puede.</li>
        <li>Si un proveedor falla o se queda sin cuota, pasa solo al siguiente.</li>
      </ol>
    </Card>
  );
}

/** Proveedores y APIs, en corto (maqueta): las IA con clave, su modelo, si están listas y «Probar» (la misma prueba de Proveedores). */
function ProvidersSummaryCard({ report, onGo, ping }: { report: OllamaReport | null; onGo: (tab: IntelligenceTab) => void; ping: Ping }) {
  const ai = useExternalAi();
  const status = ai.status;
  const shown = (status?.engines ?? []).filter((e) => e.hasKey);
  const [busy, setBusy] = useState("");
  // Una petición real con tu clave (cuenta para el tope diario de seguridad, como la prueba de Proveedores).
  const test = async (id: string, name: string) => {
    setBusy(id);
    const r = await engineCommand("engines-test", { id });
    if (r.status) ai.putStatus(r.status);
    ping(r.ok ? `${name} responde${r.model ? ` (${r.model})` : ""}.` : `⚠️ ${name}: ${r.error ?? "no responde."}`);
    setBusy("");
  };
  const localModels = report?.models.length ?? 0;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold"><Cloud className="size-4 text-primary" />Proveedores y APIs</p>
          <p className="text-xs text-muted-foreground">Las IA con clave en este equipo, el modelo que usa cada una y si está lista ahora.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => onGo("proveedores")}>Añadir proveedor</Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((e) => {
          const ok = !!status?.master && e.enabled && e.available;
          const label = ok ? "Disponible" : !status?.master ? "Apagada" : !e.enabled ? "Desactivada" : "En espera";
          return (
            <div key={e.id} className="rounded-lg border border-border p-2.5" title={ok ? "" : e.reason}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{e.name}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>{label}</span>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground" title={e.model}>{e.model || "modelo automático"}</p>
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy === e.id} onClick={() => void test(e.id, e.name)}>
                  {busy === e.id ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}Probar
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onGo("proveedores")}>Configurar</Button>
              </div>
            </div>
          );
        })}
        <div className="rounded-lg border border-border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">Ollama (tu equipo)</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${report?.alive ? "bg-primary/15 text-primary" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>{report?.alive ? "Local" : "No responde"}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{report?.alive ? `${localModels} modelo${localModels === 1 ? "" : "s"} en tu equipo` : "Arráncala desde Modelos"}</p>
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onGo("modelos")}>Configurar</Button>
          </div>
        </div>
      </div>
      {!status && <p className="mt-2 text-xs text-muted-foreground">Leyendo el estado de las IA externas…</p>}
    </Card>
  );
}

/** Capacidades por tarea, en corto (maqueta): la IA principal que contestaría ahora y el relevo de tu equipo. */
function CapabilitiesSummaryCard({ report, onGo }: { report: OllamaReport | null; onGo: (tab: IntelligenceTab) => void }) {
  const { status, now, pretty, localFor } = useRoutingNow(report);
  const kinds: TaskKind[] = ["general", "codigo", "traduccion", "web", "vision"];
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Cpu className="size-4 text-primary" />Capacidades por tarea</p>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onGo("routing")}>Ver detalles</Button>
      </div>
      <ul className="space-y-1.5">
        {kinds.map((kind) => {
          const ids = status?.mode === "ahorro" ? [] : now(KIND_CLOUD_ORDER[kind] ?? KIND_CLOUD_ORDER["general"]!);
          const first = ids[0];
          const local = localFor(kind);
          return (
            <li key={kind} className="rounded-lg border border-border/70 px-2.5 py-1.5 text-xs">
              <p className="font-semibold">{TASK_LABELS[kind]}</p>
              <p className="truncate text-muted-foreground" title={`${first ? pretty(first) : "Tu equipo"}${local ? ` · relevo: ${local}` : ""}`}>Principal: {first ? pretty(first) : "tu equipo"}{local ? ` · Relevo: ${local}` : ""}</p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

type RecentUse = { at: number; model: string; task: string; where: "Chat" | "SUPER WILLY" };

/**
 * Las últimas respuestas de verdad (maqueta: «Modelos en uso reciente»): el último mensaje de WILLY de cada chat (con la IA que
 * lo dio) y las respuestas de SUPER WILLY en cada proyecto. Solo lo que ya guarda este equipo: nada inventado.
 */
function recentModelUse(limit: number): RecentUse[] {
  const out: RecentUse[] = [];
  for (const thread of listThreads()) {
    const last = [...thread.messages].reverse().find((m) => m.who === "willy" && m.by);
    if (last?.by) out.push({ at: chatMessageAt(thread.updatedAt, last.time), model: last.by, task: thread.title || "Conversación", where: "Chat" });
  }
  for (const session of listSessions()) {
    const turns = (session.turns ?? []).filter((t) => t.role === "ia" && t.model && t.model !== "WILLY").slice(-3);
    for (const turn of turns) out.push({ at: turn.at, model: turn.model ?? "", task: session.title || "Proyecto", where: "SUPER WILLY" });
  }
  return out.filter((u) => u.at > 0 && u.model).sort((a, b) => b.at - a.at).slice(0, limit);
}

/** La hora del mensaje («12:44», la que se ve en el chat) en el día en que se guardó la conversación por última vez. */
function chatMessageAt(updatedAt: number, time: string): number {
  const hm = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!hm) return updatedAt;
  const d = new Date(updatedAt);
  d.setHours(Number(hm[1] ?? 0), Number(hm[2] ?? 0), 0, 0);
  const at = d.getTime();
  return at > updatedAt ? at - 86_400_000 : at;
}

const modelName = (label: string): string => (label.includes(" · ") ? label.slice(label.lastIndexOf(" · ") + 3) : label);

function RecentModelsCard({ onGo }: { onGo: (tab: IntelligenceTab) => void }) {
  const active = useViewActive();
  const [rows, setRows] = useState<RecentUse[] | null>(null);
  useEffect(() => {
    if (!active) return;
    const load = () => setRows(recentModelUse(6));
    load();
    window.addEventListener(CHAT_EVENT, load);
    return () => window.removeEventListener(CHAT_EVENT, load);
  }, [active]);
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Clock className="size-4 text-primary" />Modelos en uso reciente</p>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onGo("uso")}>Ver uso</Button>
      </div>
      {rows === null ? <p className="text-xs text-muted-foreground">Leyendo…</p> : !rows.length ? <p className="text-xs text-muted-foreground">Todavía no hay respuestas guardadas en este equipo.</p> : (
        <table className="w-full table-fixed text-left text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="w-20 py-1.5 pr-2 font-semibold">Cuándo</th>
              <th className="py-1.5 pr-2 font-semibold">Modelo</th>
              <th className="py-1.5 font-semibold">Dónde</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.at}-${i}`} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 pr-2 text-muted-foreground">{relativeTime(new Date(r.at).toISOString())}</td>
                <td className="truncate py-1.5 pr-2 font-semibold" title={r.model}>{modelName(r.model)}</td>
                <td className="truncate py-1.5 text-muted-foreground" title={`${r.where}: ${r.task}`}>{r.where === "Chat" ? `Chat · ${r.task}` : r.task}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── Tu equipo (Ollama) + Modelos

function Row({ label, value, tone }: { label: string; value: string; tone?: Tone | undefined }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "aviso" ? "text-amber-600" : tone === "fallo" ? "text-destructive" : "";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`break-all text-right text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}

/** Estado en directo de los motores de creación de AVATAR AI (vídeo/imagen con ComfyUI y voces: Gemini, Chatterbox, Kokoro o Piper): mismos endpoints que sus propias pantallas, sin datos inventados. */
function AvatarEnginesStatus() {
  const [state, setState] = useState<"cargando" | "ok" | "error">("cargando");
  const [comfy, setComfy] = useState<{ running: boolean; gpu: string; freeGb: number; error: string } | null>(null);
  const [voces, setVoces] = useState<{ count: number; active: string; chatterbox: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/avatar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) }).then((r) => r.json()).catch(() => null),
      fetch("/api/voces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) }).then((r) => r.json()).catch(() => null),
    ]).then(([a, v]) => {
      if (!alive) return;
      if (a?.ok) setComfy({ running: !!a.comfy?.running, gpu: a.comfy?.gpu || "", freeGb: Number(a.comfy?.freeGb ?? 0), error: a.comfy?.error || "" });
      if (v?.ok) {
        const list: Array<{ id?: string; label?: string; active?: boolean }> = Array.isArray(v.installed) ? v.installed : [];
        const act = list.find((x) => x.active);
        setVoces({ count: list.length, active: act?.label || act?.id || "", chatterbox: !!v.extra?.chatterbox?.ready });
      }
      setState(a?.ok || v?.ok ? "ok" : "error");
    });
    return () => { alive = false; };
  }, []);

  const comfyValue = state === "cargando" ? "Comprobando…" : comfy?.running ? `Operativo${comfy.gpu ? ` · ${comfy.gpu}` : ""} · ${comfy.freeGb} GB libres` : comfy ? "Parado" : "No comprobado";
  const comfyTone: Tone | undefined = state === "cargando" ? undefined : comfy?.running ? "ok" : "aviso";
  const vocesValue = state === "cargando" ? "Comprobando…" : voces ? (voces.count ? `${voces.active ? `${voces.active} · ` : ""}${voces.count} ${voces.count === 1 ? "voz instalada" : "voces instaladas"}${voces.chatterbox ? " · Chatterbox lista" : ""}` : "Ninguna voz instalada") : "No comprobado";
  const vocesTone: Tone | undefined = state === "cargando" ? undefined : voces?.count ? "ok" : "aviso";

  return (
    <>
      <Row label="Motor de vídeo e imagen (ComfyUI)" value={comfyValue} tone={comfyTone} />
      <Row label="Motor de voces" value={vocesValue} tone={vocesTone} />
    </>
  );
}

/** La explicación de si la IA de tu equipo usa la tarjeta gráfica o solo el procesador (el aviso pendiente de «Salud»). */
function GpuHealth({ report }: { report: OllamaReport }) {
  const usage = report.usage;
  const gpu = report.gpu ? `${report.gpu.name} · ${formatMB(report.gpu.vramTotalMB)} de memoria de vídeo` : "No se ha detectado una tarjeta gráfica NVIDIA.";
  if (usage.state === "procesador") {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" role="status">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-500"><StatusIcon tone="aviso" />Va solo con el procesador</p>
        <p className="mt-1 text-xs">«{usage.model}» se está calculando sin la tarjeta gráfica, por eso tarda más en contestar.</p>
        <p className="mt-1 text-xs"><span className="font-semibold">Por qué:</span> {usage.reason}</p>
        <p className="mt-1 text-xs"><span className="font-semibold">Qué hacer:</span> {usage.fix}</p>
      </div>
    );
  }
  if (usage.state === "mixto") {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" role="status">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-500"><StatusIcon tone="aviso" />Parte en la gráfica y parte en el procesador</p>
        <p className="mt-1 text-xs">«{usage.model}» solo está al {usage.share} % en la tarjeta gráfica; el resto va al procesador y es más lento. Un modelo más pequeño (de unos 7B) cabe entero.</p>
        <p className="mt-1 text-xs text-muted-foreground">{gpu}</p>
      </div>
    );
  }
  if (usage.state === "grafica") {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3" role="status">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-500"><StatusIcon tone="ok" />Usa la tarjeta gráfica</p>
        <p className="mt-1 text-xs">«{usage.model}» está entero en la tarjeta gráfica: va a la máxima velocidad de tu equipo.</p>
        <p className="mt-1 text-xs text-muted-foreground">{gpu}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border p-3" role="status">
      <p className="flex items-center gap-2 text-sm font-semibold"><StatusIcon tone="info" />Todavía no se sabe si usa la gráfica</p>
      <p className="mt-1 text-xs text-muted-foreground">Ahora no hay ningún modelo cargado. En cuanto la IA de tu equipo conteste algo, aquí verás si calcula con la tarjeta gráfica o solo con el procesador.</p>
      <p className="mt-1 text-xs text-muted-foreground">{gpu}</p>
    </div>
  );
}

function LocalEngineSection({ report, state, onRefresh, ping }: { report: OllamaReport | null; state: "cargando" | "ok" | "error"; onRefresh: () => void; ping: Ping }) {
  const [working, setWorking] = useState<"" | "reiniciar" | "arrancar" | "liberar">("");
  const [settings, update] = useSettings();
  const [endpointDraft, setEndpointDraft] = useState(settings.endpoint);
  const [testing, setTesting] = useState(false);
  useEffect(() => { setEndpointDraft(settings.endpoint); }, [settings.endpoint]);

  const restart = async () => {
    if (!window.confirm("¿Reiniciar la IA de tu equipo (Ollama)? Si está contestando algo, se cortará. Tarda unos segundos.")) return;
    setWorking("reiniciar");
    const result = await systemAction("reiniciar-ollama");
    setWorking("");
    ping(result.ok ? result.message ?? "La IA de tu equipo se ha reiniciado." : `⚠️ ${result.error ?? "No se pudo reiniciar."}`);
    onRefresh();
  };
  const start = async () => {
    setWorking("arrancar");
    ping("Preparando la IA de tu equipo. Si hay que instalarla o bajar el primer modelo, puede tardar unos minutos.");
    try {
      const res = await fetch("/api/engine", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string; pulling?: boolean; model?: string };
      ping(!res.ok || !data.ok ? `⚠️ ${data.error ?? "No se pudo arrancar."}` : data.pulling ? "La IA de tu equipo ya está en marcha y está bajando su primer modelo." : `La IA de tu equipo ya está en marcha con «${data.model ?? ""}».`);
    } catch {
      ping("⚠️ No hay respuesta del servidor de WILLY.");
    }
    setWorking("");
    onRefresh();
  };
  const unload = async () => {
    setWorking("liberar");
    try {
      const res = await fetch("/api/engine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unload" }) });
      const data = (await res.json()) as { ok?: boolean; error?: string; unloaded?: string[]; message?: string };
      ping(data.ok ? data.message ?? `Memoria liberada: ${(data.unloaded ?? []).join(", ") || "nada cargado"}.` : `⚠️ ${data.error ?? "No se pudo liberar la memoria."}`);
    } catch {
      ping("⚠️ No hay respuesta del servidor de WILLY.");
    }
    setWorking("");
    onRefresh();
  };

  if (!report) {
    return state === "cargando"
      ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Comprobando la IA de tu equipo…</p>
      : <Card className="text-sm text-muted-foreground">No se pudo comprobar: el servidor de WILLY no respondió. <Button size="sm" variant="secondary" className="ml-2" onClick={onRefresh}>Reintentar</Button></Card>;
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Cpu className="size-4 text-primary" />
          <p className="min-w-0 flex-1 text-sm font-semibold">IA de tu equipo (Ollama)</p>
          <Button size="sm" variant="secondary" className="gap-2" disabled={state === "cargando" || working !== ""} onClick={onRefresh}>
            <RefreshCw className={`size-4 ${state === "cargando" ? "animate-spin" : ""}`} />Comprobar
          </Button>
        </div>
        <Row label="Estado" value={report.alive ? "Responde" : "No responde"} tone={report.alive ? "ok" : "fallo"} />
        <Row label="Versión" value={report.version ? `Ollama ${report.version}` : "—"} />
        <Row label="Dirección" value={report.url} />
        <Row label="Modelos descargados" value={report.alive ? String(report.models.length) : "—"} />
        <Row label="Última comprobación" value={new Date(report.checkedAt).toLocaleTimeString("es-ES")} />
        <div className="mt-3 flex flex-wrap gap-2">
          {report.alive ? (
            <Button size="sm" className="gap-2" disabled={working !== ""} onClick={() => void restart()}>
              {working === "reiniciar" ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}Reiniciar
            </Button>
          ) : (
            <Button size="sm" className="gap-2" disabled={working !== ""} onClick={() => void start()}>
              {working === "arrancar" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Arrancar la IA de mi equipo
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-primary" />Salud: ¿usa la tarjeta gráfica?</p>
        <GpuHealth report={report} />
        {report.loaded.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold">Cargados en memoria ahora</p>
            <ul className="mt-1 space-y-1">
              {report.loaded.map((model) => (
                <li key={model.name} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-mono">{model.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatMB(model.sizeMB)} · {model.sizeMB > 0 ? Math.round((model.vramMB / model.sizeMB) * 100) : 0} % en la gráfica</span>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="mt-2 gap-2" disabled={working !== ""} onClick={() => void unload()}>
              {working === "liberar" ? <Loader2 className="size-4 animate-spin" /> : <MemoryStick className="size-4" />}Liberar memoria
            </Button>
          </div>
        )}
      </Card>

      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Detalles técnicos</summary>
        <div className="mt-2">
          <Row label="Programa" value={report.program ?? "No encontrado en las carpetas habituales"} />
          <Row label="Carpeta de modelos" value={report.modelsDir.path} />
          <Row label="De dónde sale" value={report.modelsDir.source === "OLLAMA_MODELS" ? "Tu ajuste OLLAMA_MODELS" : "La carpeta de siempre de Ollama"} />
          <Row label="Ocupa" value={!report.modelsDir.exists ? "La carpeta todavía no existe" : report.modelsDir.bytes === null ? "—" : `${report.modelsDir.partial ? "más de " : ""}${formatBytes(report.modelsDir.bytes)}`} />
        </div>
        <form
          className="mt-3 space-y-2"
          onSubmit={(event: { preventDefault: () => void }) => {
            event.preventDefault();
            update({ endpoint: endpointDraft.trim() });
            ping("Dirección guardada.");
          }}
        >
          <label className="block text-xs font-semibold text-muted-foreground" htmlFor="endpoint">Dirección de un motor alternativo (opcional)</label>
          <input id="endpoint" value={endpointDraft} onChange={(e: { target: { value: string } }) => setEndpointDraft(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary" />
          <p className="text-xs text-muted-foreground">Solo si usas otro motor compatible (por ejemplo LM Studio) para ver sus modelos. WILLY habla siempre con Ollama en {report.url}.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm">Guardar</Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={testing}
              onClick={async () => {
                setTesting(true);
                const ok = await pingEndpoint(endpointDraft.trim());
                setTesting(false);
                ping(ok ? `Responde ${endpointDraft.trim()}.` : `No responde ${endpointDraft.trim()}.`);
              }}
            >
              {testing ? "Probando…" : "Probar"}
            </Button>
          </div>
        </form>
      </details>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Proveedores (antes «IA externas»)

function ProvidersTab({ ping }: { ping: Ping }) {
  const ai = useExternalAi();
  return (
    <div className="space-y-3">
      <Card>
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><Cloud className="size-4 text-amber-600" />Con qué IA habla el Chat</p>
        <p className="mb-3 text-xs text-muted-foreground">Las IA externas gratuitas (con tu clave) son más rápidas que la de tu equipo. Si a una se le acaba lo gratis, WILLY pasa sola a la siguiente y, si no queda ninguna, contesta tu equipo.</p>
        <ExternalAiPanel ai={ai} />
      </Card>
      <EnginesPanel ping={ping} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Modelos (Ollama + catálogo)

function ModelsTab({ ping, report, state, onRefresh, onChanged }: { ping: Ping; report: OllamaReport | null; state: "cargando" | "ok" | "error"; onRefresh: () => void; onChanged: () => void }) {
  const [settings, update] = useSettings();
  const active = useViewActive();
  const [engineModels, setEngineModels] = useState<string[] | null>(null);
  const [engineState, setEngineState] = useState<"checking" | "ok" | "fail">("checking");
  const [catalogTab, setCatalogTab] = useState<"catalogo" | "instalados">("catalogo");
  const [catalogTag, setCatalogTag] = useState<CatalogTag>("Todos");
  const [pulls, setPulls] = useState<Record<string, PullProgress>>({});
  const pullControllers = useRef<Record<string, AbortController>>({});

  const checkModels = (announce = false) => {
    setEngineState("checking");
    void aiService.models(settings.endpoint).then((r) => {
      if (r.ok) {
        setEngineModels(r.data.map((m) => m.name));
        setEngineState("ok");
        if (announce) ping(`${r.data.length} modelo(s) en tu equipo.`);
      } else {
        setEngineModels(null);
        setEngineState("fail");
        if (announce) ping(`⚠️ ${r.error} Arranca la IA de tu equipo aquí arriba.`);
      }
    });
  };
  useEffect(() => {
    // Solo mientras se ve: la lista se refresca sola (si arrancas el motor o bajas un modelo, aparece sin recargar).
    if (!active) return;
    checkModels();
    const timer = window.setInterval(() => checkModels(), 10000);
    const onFocus = () => checkModels();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, settings.endpoint]);

  const startPull = async (m: CatalogModel) => {
    if (pulls[m.name]) return;
    const controller = new AbortController();
    pullControllers.current[m.name] = controller;
    setPulls((p) => ({ ...p, [m.name]: { status: "preparando", percent: null } }));
    ping(`Descargando ${m.label} (${m.size})…`);
    const result = await pullModel(settings.endpoint, m.name, (progress) => setPulls((p) => ({ ...p, [m.name]: progress })), controller.signal);
    setPulls((p) => {
      const next = { ...p };
      delete next[m.name];
      return next;
    });
    delete pullControllers.current[m.name];
    if (!result.ok) return ping(`⚠️ ${result.error}`);
    ping(`${m.label} ya está instalado en tu equipo.`);
    checkModels();
    onChanged();
  };
  const cancelPull = (name: string) => {
    pullControllers.current[name]?.abort();
    ping(`Descarga de ${name} cancelada.`);
  };
  const pullAll = async () => {
    const pending = MODEL_CATALOG.filter((m) => !pulls[m.name] && !(engineState === "ok" && engineModels?.some((n) => n === m.name || n === `${m.name}:latest`)));
    if (!pending.length) return ping("Todos los modelos del catálogo ya están instalados en tu equipo.");
    ping(`Descargando todos los modelos (${pending.length} en cola)…`);
    for (const m of pending) await startPull(m);
    ping("Cola de descargas terminada.");
  };
  const deleteModel = async (name: string) => {
    if (!window.confirm(`¿Borrar «${name}» de tu equipo? Para volver a usarlo habrá que descargarlo otra vez.`)) return;
    const result = await removeModel(settings.endpoint, name);
    if (!result.ok) return ping(`⚠️ ${result.error}`);
    ping(`${name} borrado del disco.`);
    checkModels();
    onChanged();
  };
  const installed = (name: string) => engineState === "ok" && (engineModels?.some((n) => n === name || n === `${name}:latest`) ?? false);

  return (
    <div className="space-y-3">
      <LocalEngineSection report={report} state={state} onRefresh={onRefresh} ping={ping} />

      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {engineState === "checking" ? "Comprobando los modelos de tu equipo…" : engineState === "ok" ? "Todos son gratuitos y se descargan a tu equipo." : "La IA de tu equipo no responde: arráncala arriba para descargar o usar modelos."}
        </p>
        <Button size="sm" variant="secondary" className="gap-2" onClick={() => checkModels(true)}>
          <RefreshCw className={`size-4 ${engineState === "checking" ? "animate-spin" : ""}`} />Comprobar
        </Button>
      </div>

      <EngineCheck />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex w-fit gap-1 rounded-lg border border-border bg-card p-1">
          {([["catalogo", "Catálogo gratuito"], ["instalados", "En tu equipo"]] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={catalogTab === id} onClick={() => setCatalogTab(id)} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${catalogTab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
        {catalogTab === "catalogo" && (
          <Button size="sm" variant="secondary" className="gap-2" disabled={Object.keys(pulls).length > 0 || engineState !== "ok"} onClick={() => void pullAll()}>
            <Download className="size-4" />Descargar todos
          </Button>
        )}
      </div>

      {catalogTab === "catalogo" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {CATALOG_TAGS.map((t) => (
              <button key={t} type="button" onClick={() => setCatalogTag(t)} className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${catalogTag === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {MODEL_CATALOG.filter((m) => catalogTag === "Todos" || m.tag === catalogTag).map((m) => {
              const has = installed(m.name);
              const progress = pulls[m.name];
              return (
                <Card key={m.name} className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <Cpu className="mt-0.5 size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {m.label}
                        {m.best && <span className="rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-semibold text-primary">Recomendado</span>}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">{m.name}</p>
                    </div>
                    {has && <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-500"><span className="size-2 rounded-full bg-emerald-500" />Instalado</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                  <p className="text-[11px] text-muted-foreground">{m.tag} · Descarga {m.size} · Memoria recomendada {m.ram} · Gratis</p>
                  {progress ? (
                    <div className="space-y-2">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent ?? 5}%` }} /></div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground">{progress.status}{progress.percent !== null ? ` · ${progress.percent}%` : ""}</p>
                        <Button size="sm" variant="outline" onClick={() => cancelPull(m.name)}>Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {has ? (
                        settings.model === m.name
                          ? <span className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Check className="size-4" />En uso</span>
                          : <Button size="sm" variant="secondary" onClick={() => { update({ model: m.name }); ping(`Modelo activo: ${m.label}`); }}>Usar</Button>
                      ) : (
                        <Button size="sm" className="gap-2" disabled={engineState !== "ok"} onClick={() => void startPull(m)}><Download className="size-4" />Descargar</Button>
                      )}
                      {has && <Button size="sm" variant="outline" onClick={() => void deleteModel(m.name)}>Borrar</Button>}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {catalogTab === "instalados" && (
        <div className="space-y-2">
          {engineState === "fail" && <Card className="text-sm text-muted-foreground">La IA de tu equipo no responde: no se puede leer lo que tienes instalado.</Card>}
          {engineState === "ok" && !engineModels?.length && <Card className="text-sm text-muted-foreground">Todavía no hay ningún modelo en tu equipo. Ve al catálogo y descarga el recomendado.</Card>}
          {(engineModels ?? []).map((name) => {
            const info = MODEL_CATALOG.find((m) => m.name === name || `${m.name}:latest` === name);
            const detail = report?.models.find((m) => m.name === name);
            return (
              <Card key={name} className="flex flex-wrap items-center gap-3">
                <Cpu className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-semibold">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {info ? `${info.label} · ${info.tag}` : "Modelo de tu equipo"}
                    {detail ? ` · ${formatMB(detail.sizeMB)}${detail.params ? ` · ${detail.params}` : ""}` : info ? ` · ${info.size}` : ""}
                  </p>
                </div>
                {settings.model === name
                  ? <span className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Check className="size-4" />En uso</span>
                  : <Button size="sm" variant="secondary" onClick={() => { update({ model: name }); ping(`Modelo activo: ${name}`); }}>Usar</Button>}
                <Button size="sm" variant="outline" onClick={() => void deleteModel(name)}>Borrar</Button>
              </Card>
            );
          })}
        </div>
      )}

      {report && (
        <p className="text-xs text-muted-foreground">
          Los modelos se guardan en <span className="break-all font-mono">{report.modelsDir.path}</span>
          {report.modelsDir.bytes !== null ? ` (${report.modelsDir.partial ? "más de " : ""}${formatBytes(report.modelsDir.bytes)})` : ""}.
        </p>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Agentes

function AgentsTab({ ping }: { ping: Ping }) {
  const [settings, update] = useSettings();
  return (
    <div className="space-y-3">
      <Card className="text-xs text-muted-foreground">
        Son los papeles que SUPER WILLY tiene en cuenta cuando construye o cambia un proyecto: se le indican en cada petición del proyecto. No son programas aparte ni usan un modelo distinto: contesta la IA de SUPER WILLY.
      </Card>
      <div className="grid gap-2 sm:grid-cols-2">
        {AGENTS.map((agent) => {
          const on = settings.agents.includes(agent.name);
          return (
            <Card key={agent.name} className="flex items-center gap-3">
              <Bot className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{agentLabel(agent.name)}</p>
                <p className="text-xs text-muted-foreground">{agent.role}</p>
              </div>
              <Toggle
                on={on}
                label={`Activar ${agentLabel(agent.name)}`}
                onClick={() => {
                  update({ agents: on ? settings.agents.filter((n) => n !== agent.name) : [...settings.agents, agent.name] });
                  ping(`${agentLabel(agent.name)} ${on ? "desactivado" : "activado"}.`);
                }}
              />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Routing

/**
 * Lo que decide el enrutado AHORA MISMO (lo usan «Routing» y el «Resumen»): la misma tabla que usa el programa
 * (routing-table.ts) con el estado real de cada IA externa, el modo de SUPER WILLY y los modelos de tu equipo.
 */
function useRoutingNow(report: OllamaReport | null) {
  const ai = useExternalAi();
  const status = ai.status;
  const engines = status?.engines ?? [];
  const master = status?.master ?? false;
  const [mode, setMode] = useState<SuperMode>("externa");
  useEffect(() => {
    const sync = () => setMode(readSuperMode());
    sync();
    window.addEventListener(SUPER_MODE_EVENT, sync);
    return () => window.removeEventListener(SUPER_MODE_EVENT, sync);
  }, []);
  const superMode = SUPER_MODES.find((m) => m.id === mode) ?? SUPER_MODES[0]!;
  const installed = (report?.models ?? []).map((m) => m.name);
  const nameOf = (id: string) => engines.find((e) => e.id === id)?.name ?? id;
  const modelOf = (id: string) => engines.find((e) => e.id === id)?.model ?? "";
  const now = (order: readonly string[]) => (master ? usableInOrder(order, engines) : []);
  const localFor = (kind: TaskKind) => (installed.length ? planChain(kind, undefined, installed)[0] ?? "" : "");
  const pretty = (id: string) => `${nameOf(id)}${modelOf(id) ? ` · ${modelOf(id)}` : ""}`;
  const chatNow = now(CHAT_ORDER);
  const buildNow = now(BUILD_ORDER);
  const cloudOrLocal = (id: string | undefined) => (id ? pretty(id) : master ? "tu equipo (ninguna externa disponible)" : "tu equipo (IA externas apagadas)");
  const contexts = [
    { title: "Chat general", desc: "Por defecto contesta tu equipo. Si eliges «IA externa», prueba en este orden (las que marques van antes) y, si todas fallan, vuelve a tu equipo.", order: CHAT_ORDER, first: chatNow[0], short: `Tu equipo, o la externa que elijas. Externa ahora: ${cloudOrLocal(chatNow[0])}.` },
    { title: "Automático («plug and play»)", desc: "Elige según el tipo de petición (tabla de abajo). Lo sensible (DNI, IBAN, claves…) y los adjuntos se quedan en tu equipo.", order: null, first: undefined, short: "Según el tipo de petición. Lo sensible y los adjuntos no salen de tu equipo." },
    { title: "Súper IA", desc: `Modo de SUPER WILLY: ${superMode.icon} ${superMode.label}. ${superMode.desc}`, order: null, first: undefined, short: `${superMode.icon} ${superMode.label}` },
    { title: "Autoconstrucción", desc: "Regla fija: siempre la IA externa gratuita de más calidad que esté disponible; tu equipo es el último recurso.", order: BUILD_ORDER, first: buildNow[0], short: `Ahora: ${cloudOrLocal(buildNow[0])}.` },
  ];
  return { status, master, nameOf, pretty, now, localFor, contexts };
}

/** Preferencias globales («Routing» y «Resumen»): los dos interruptores que existen de verdad y las reglas fijas, tal cual. */
function GlobalPrefsCard({ onGo, ping }: { onGo: (tab: IntelligenceTab) => void; ping: Ping }) {
  const ai = useExternalAi();
  const status = ai.status;
  const master = status?.master ?? false;
  const [busy, setBusy] = useState("");
  const setMaster = async (on: boolean) => {
    setBusy("master");
    const r = await engineCommand("engines-master", { on });
    if (r.ok && r.status) ai.putStatus(r.status);
    ping(r.ok ? (on ? "IA externas activadas." : "IA externas desactivadas: contesta tu equipo.") : `⚠️ ${r.error ?? "No se pudo cambiar."}`);
    setBusy("");
  };
  const setAutoMode = async (next: "calidad" | "ahorro") => {
    setBusy("mode");
    const r = await engineCommand("engines-mode", { mode: next });
    if (r.ok && r.status) ai.putStatus(r.status);
    ping(r.ok ? (next === "calidad" ? "Automático: primero la IA externa gratuita." : "Automático: primero tu equipo.") : `⚠️ ${r.error ?? "No se pudo cambiar."}`);
    setBusy("");
  };

  return (
    <Card>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-primary" />Preferencias globales</p>
      <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2">
        <div className="min-w-0"><p className="text-sm font-semibold">Usar IA externas gratuitas</p><p className="text-xs text-muted-foreground">Interruptor general de las IA en la nube (el mismo que en Proveedores).</p></div>
        <Toggle on={master} label="Usar IA externas gratuitas" onClick={() => { if (!busy && status) void setMaster(!master); }} />
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2">
        <div className="min-w-0"><p className="text-sm font-semibold">Externas primero en el automático</p><p className="text-xs text-muted-foreground">Apagado = modo ahorro: primero tu equipo. La Autoconstrucción no cambia: allí la externa va siempre primero.</p></div>
        <Toggle on={status?.mode !== "ahorro"} label="Externas primero en el automático" onClick={() => { if (!busy && status) void setAutoMode(status.mode === "ahorro" ? "calidad" : "ahorro"); }} />
      </div>
      <Row label="Relevo a tu equipo si falla una externa" value="Siempre (regla fija)" tone="ok" />
      <Row label="Solo gratis" value="Siempre (regla fija)" tone="ok" />
      <Row label="Preguntar antes de usar pago" value="No hace falta: WILLY nunca usa nada de pago" />
      <Row label="Tope diario de seguridad" value={status ? `${status.dailyCap} peticiones por IA y día` : "—"} />
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => onGo("proveedores")}>Claves y proveedores</Button>
    </Card>
  );
}

/** Tipos de petición que WILLY distingue (los mismos del orquestador y del «plug and play»), en el orden de la maqueta. */
const ROUTE_KINDS: TaskKind[] = ["general", "codigo", "web", "traduccion", "escritura", "investigacion", "razonamiento", "datos", "vision"];

/**
 * Routing: la tabla de enrutado que WILLY usa DE VERDAD (routing-table.ts), con lo que está disponible ahora mismo. Nada es
 * ilustrativo: los órdenes salen de la misma tabla que usan el chat, el «plug and play» y la Autoconstrucción, y «ahora mismo»
 * sale del estado real de cada IA externa (con clave, activada y con cuota). Los dos interruptores que existen de verdad
 * (usar IA externas y calidad/ahorro) se cambian aquí mismo con las mismas órdenes que Proveedores y el chat; lo que es una regla
 * fija de WILLY se enseña como tal, sin un interruptor falso.
 */
function RoutingTab({ report, onGo, ping }: { report: OllamaReport | null; onGo: (tab: IntelligenceTab) => void; ping: Ping }) {
  const { status, master, nameOf, pretty, now, localFor, contexts } = useRoutingNow(report);

  return (
    <div className="space-y-3">
      <Card>
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><Activity className="size-4 text-primary" />Enrutado inteligente</p>
        <p className="mb-3 text-xs text-muted-foreground">Qué IA contesta en cada sitio de WILLY. Es la misma tabla que usa el programa, no un dibujo: si cambias una clave o se acaba una cuota, esto cambia solo.</p>
        <div className="grid gap-2 lg:grid-cols-2">
          {contexts.map((c) => (
            <div key={c.title} className="rounded-lg border border-border p-2.5">
              <p className="text-sm font-semibold">{c.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.desc}</p>
              {c.order ? <p className="mt-1.5 text-xs"><span className="text-muted-foreground">Orden: </span>{c.order.map(nameOf).join(" → ")} → tu equipo</p> : null}
              {c.order ? <p className={`mt-1 text-xs font-semibold ${c.first ? "text-emerald-600" : "text-amber-600"}`}>Ahora mismo: {c.first ? pretty(c.first) : master ? "ninguna externa disponible · contesta tu equipo" : "IA externas desactivadas · contesta tu equipo"}</p> : null}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><Cpu className="size-4 text-primary" />Capacidades por tarea</p>
        <p className="mb-2 text-xs text-muted-foreground">En el automático: la IA externa que contestaría ahora, la de respaldo y el modelo de tu equipo que haría el relevo.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-2 font-semibold">Tarea</th>
                <th className="py-1.5 pr-2 font-semibold">Principal</th>
                <th className="py-1.5 pr-2 font-semibold">Respaldo</th>
                <th className="py-1.5 font-semibold">En tu equipo</th>
              </tr>
            </thead>
            <tbody>
              {ROUTE_KINDS.map((kind) => {
                const ids = status?.mode === "ahorro" ? [] : now(KIND_CLOUD_ORDER[kind] ?? KIND_CLOUD_ORDER["general"]!);
                const local = localFor(kind);
                return (
                  <tr key={kind} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-2 font-semibold">{TASK_LABELS[kind]}</td>
                    <td className="py-1.5 pr-2">{ids[0] ? pretty(ids[0]) : <span className="text-muted-foreground">{status?.mode === "ahorro" ? "Tu equipo (modo ahorro)" : "Tu equipo"}</span>}</td>
                    <td className="py-1.5 pr-2">{ids[1] ? nameOf(ids[1]) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-1.5">{local || <span className="text-muted-foreground">{report?.alive ? "sin modelo de conversación" : "Ollama no responde"}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <GlobalPrefsCard onGo={onGo} ping={ping} />

        <Card>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Check className="size-4 text-primary" />Reglas de enrutado</p>
          <ol className="list-decimal space-y-1.5 pl-4 text-xs">
            <li>Solo niveles gratuitos: WILLY nunca gasta dinero por su cuenta (en OpenRouter, solo modelos «:free»).</li>
            <li>Si una IA externa se queda sin cuota, pide pago o rechaza la clave, sale de la rueda y se vuelve a probar sola cuando toca.</li>
            <li>Tu equipo (Ollama) es siempre el último recurso: nunca te quedas sin respuesta.</li>
            <li>En el automático, lo sensible (DNI, IBAN, claves…) y los archivos adjuntos no salen de tu equipo.</li>
            <li>Cada respuesta dice qué IA la dio y por qué se eligió.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Uso y costes

function UsageTab({ report }: { report: OllamaReport | null }) {
  const ai = useExternalAi();
  const engines = ai.status?.engines ?? [];
  const withKey = engines.filter((e) => e.hasKey);
  const cap = ai.status?.dailyCap ?? 0;

  return (
    <div className="space-y-3">
      <Card className="text-xs leading-5 text-muted-foreground">
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground"><Activity className="size-4 text-primary" />Coste: 0 €</p>
        WILLY solo usa niveles gratuitos de cada proveedor y nunca gasta dinero por su cuenta (lo dice el propio enrutador: «WILLY nunca gasta dinero por su cuenta»). Por eso aquí no hay facturas: lo que hay son las peticiones de hoy, para que veas si algún proveedor se está quedando sin cuota gratuita.
      </Card>

      <Card>
        <p className="mb-2 text-sm font-semibold">Peticiones de hoy por proveedor</p>
        {!withKey.length ? (
          <p className="text-xs text-muted-foreground">Todavía no has añadido ninguna clave de IA externa: solo se está usando la IA de tu equipo (sin tope, sin coste). Añádelas en «Proveedores».</p>
        ) : (
          <div className="space-y-2">
            {withKey.map((e) => {
              const pct = cap > 0 ? Math.min(100, Math.round((e.used / cap) * 100)) : 0;
              return (
                <div key={e.id} className="rounded-lg border border-border p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-foreground">{e.name}{e.model ? ` · ${e.model}` : ""}</span>
                    <span className="text-muted-foreground">{e.used}/{e.cap} hoy</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${pct >= 90 ? "bg-destructive" : pct >= 60 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">Límite de seguridad: {cap} peticiones al día por proveedor (lo fija WILLY para no pasarse nunca del nivel gratuito).</p>
      </Card>

      <Card className="text-xs text-muted-foreground">
        <p className="mb-1 font-semibold text-foreground">IA de tu equipo (Ollama)</p>
        {report?.alive ? "Sin tope de peticiones y sin coste: se ejecuta en tu propio equipo." : "No se puede comprobar ahora mismo: la IA de tu equipo no responde."}
      </Card>
    </div>
  );
}
