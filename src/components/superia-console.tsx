import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, CheckCircle2, Clock3, FolderKanban, LayoutDashboard, Loader2, MonitorUp, Plus, RefreshCw, Search, Settings2, Sparkles, Star, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard as Card } from "@/components/panel-card";
import { DataSourcesCard } from "@/components/data-sources-card";
import { CATEGORIES, TOOLS, readFavorites, toggleFavorite, recordToolUse, type Tool } from "@/front/tools-registry";
import { sendToChat } from "@/front/chat-handoff";
import { openView } from "@/lib/background-tasks";
import { requestSectionTab } from "@/lib/section-tabs";
import { saveDraft } from "@/lib/persistent-state";
import { pushNotice } from "@/lib/notifications";
import { engineStatus } from "@/lib/engines-client";
import type { PublicStatus } from "@/lib/engines-server";
import { SUPERIA_SKILLS } from "@/lib/superia-skills";
import { TASK_LABELS } from "@/services/orchestrator";
import type { PromptCard } from "@/services/prompt-library";
import { listSessions, type WorkSession } from "@/services/worklog";

export type ConsoleTab = "trabajo" | "habilidades" | "historial" | "ajustes";
const TABS = [
  { id: "trabajo", name: "Mesa de trabajo", icon: LayoutDashboard },
  { id: "habilidades", name: "Habilidades", icon: Sparkles },
  { id: "historial", name: "Historial", icon: Clock3 },
  { id: "ajustes", name: "Ajustes y motores", icon: Settings2 },
] as const;
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

type Props = {
  tab: ConsoleTab; onTab: (tab: ConsoleTab) => void;
  children: ReactNode; preferences: ReactNode; mode: ReactNode;
  busy: boolean; localModels: string[]; onRefreshLocal: () => Promise<void>;
  onPrepare: (card: PromptCard) => void; onRun: (card: PromptCard) => void;
  onResume: (session: WorkSession) => void; onNew: () => void;
  projectName?: string; onReturn: () => void;
};

/** Menú de Súper IA. Reutiliza los ejecutores y destinos reales de WILLY. */
export function SuperIAConsole(p: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("todas");
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites());
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [sources, setSources] = useState(false);
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  useEffect(() => {
    const sync = () => { setSessions(listSessions()); setFavorites(readFavorites()); };
    sync();
    window.addEventListener("willy-worklog-change", sync);
    window.addEventListener("willy:front-tools", sync);
    return () => { window.removeEventListener("willy-worklog-change", sync); window.removeEventListener("willy:front-tools", sync); };
  }, []);
  const refresh = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const [cloud] = await Promise.all([engineStatus(), p.onRefreshLocal()]);
      setStatus(cloud); setCheckedAt(new Date().toLocaleTimeString("es-ES"));
    } finally { setChecking(false); }
  };
  useEffect(() => { if (p.tab === "ajustes") void refresh(); }, [p.tab]);

  const runTool = (tool: Tool) => {
    if (tool.availability !== "disponible" || !tool.action) return;
    recordToolUse(tool.id);
    const action = tool.action;
    if (action.kind === "view") {
      if (action.draftKey && action.tab) saveDraft(action.draftKey, action.tab);
      if (action.tab) requestSectionTab(action.view, action.tab);
      openView(action.view);
    } else if (action.kind === "chat") sendToChat({ text: action.text, autoSend: false });
    else if (action.kind === "nuevo-proyecto") { p.onNew(); p.onTab("trabajo"); }
    else setSources(true);
  };
  const matches = (text: string) => !query.trim() || norm(text).includes(norm(query.trim()));
  const skills = SUPERIA_SKILLS.filter(c => (category === "todas" || category === "plantillas") && matches(`${c.name} ${c.desc} ${TASK_LABELS[c.kind]}`) && (!onlyFavorites || favorites.includes(`superia-${c.id}`)));
  const tools = TOOLS.filter(t => category !== "plantillas" && (category === "todas" || t.categories.some(c => c === category)) && matches(`${t.name} ${t.desc} ${t.categories.join(" ")}`) && (!onlyFavorites || favorites.includes(t.id)));
  const star = (id: string, name: string) => <button type="button" onClick={() => setFavorites(toggleFavorite(id))} aria-label={`${favorites.includes(id) ? "Quitar" : "Añadir"} ${name} ${favorites.includes(id) ? "de" : "a"} favoritos`} aria-pressed={favorites.includes(id)} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><Star className={`size-4 ${favorites.includes(id) ? "fill-primary text-primary" : ""}`} /></button>;

  return <div className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-superia-console>
    <div className="mx-auto w-full max-w-[1440px] space-y-5 p-3 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary"><Sparkles className="size-4" />Tu centro de trabajo</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Súper IA</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Define el resultado. Prepara el encargo, trabaja con tus proyectos y abre la herramienta adecuada desde un solo lugar.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => openView("remoto")}><MonitorUp className="size-4" />Equipo remoto</Button>
          <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => openView("proyectos")}><FolderKanban className="size-4" />Mis proyectos</Button>
          <Button size="sm" className="w-full sm:w-auto" disabled={p.busy} onClick={() => { p.onNew(); p.onTab("trabajo"); }}><Plus className="size-4" />Nueva tarea</Button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4">
          <nav aria-label="Menú de Súper IA" className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1.5 lg:grid-cols-1">
            {TABS.map(t => <button key={t.id} type="button" aria-current={p.tab === t.id ? "page" : undefined} onClick={() => p.onTab(t.id)} className={`flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition sm:text-sm ${p.tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}><t.icon className="size-4 shrink-0" /><span>{t.name}</span>{t.id === "trabajo" && p.busy && <Loader2 className="ml-auto size-3 animate-spin" />}</button>)}
          </nav>
          <div className="hidden space-y-3 rounded-xl border border-border p-4 text-xs lg:block">
            <p className="font-semibold">Un encargo claro, un resultado comprobable</p>
            <p className="leading-relaxed text-muted-foreground">Indica qué necesitas, aporta el material y explica cómo sabrás que está terminado.</p>
            <p className="border-t border-border pt-3 text-muted-foreground">Las herramientas indican su destino y sus requisitos. Abrir una pantalla no ejecuta la tarea.</p>
          </div>
        </aside>

        <main className="min-w-0 space-y-4" aria-label={`Súper IA · ${TABS.find(t => t.id === p.tab)?.name}`}>
          {p.projectName && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm"><span className="min-w-0 break-words">Proyecto abierto: <strong>{p.projectName}</strong></span><Button size="sm" variant="outline" onClick={p.onReturn}>Volver al taller<ArrowRight className="size-4" /></Button></div>}
          {/* Se conserva montada para no perder foco, resultado ni trabajo al cambiar de apartado. */}
          <div hidden={p.tab !== "trabajo"} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-semibold">{p.busy ? <Loader2 className="size-4 animate-spin text-primary" /> : <CheckCircle2 className="size-4 text-muted-foreground" />}{p.busy ? "Tarea en curso" : "Prepara tu siguiente tarea"}</span>
              {p.mode}
            </div>
            {p.children}
            <div className="grid gap-2 sm:grid-cols-3">
              {[{name:"Crear una web o app",id:"app"},{name:"Investigar un tema",id:"investigar"},{name:"Analizar datos",id:"datos"}].map(s => <button key={s.id} type="button" disabled={p.busy} onClick={() => p.onPrepare(SUPERIA_SKILLS.find(c => c.id === s.id)!)} className="flex items-center justify-between gap-3 rounded-xl border border-border p-4 text-left text-sm font-semibold hover:border-primary/50 hover:bg-accent disabled:opacity-50">{s.name}<ArrowRight className="size-4 shrink-0 text-primary" /></button>)}
            </div>
            <Button variant="ghost" className="h-auto min-h-11 whitespace-normal" onClick={() => p.onTab("habilidades")}><BookOpen className="size-4 shrink-0" />Explorar todas las habilidades y herramientas</Button>
          </div>

          {p.tab === "habilidades" && <section className="space-y-4" aria-label="Catálogo de habilidades">
            <div><h2 className="text-xl font-bold">Todo lo que puedes poner en marcha</h2><p className="mt-1 text-sm text-muted-foreground">Plantillas para trabajar aquí y accesos al catálogo completo de WILLY.</p></div>
            <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3"><Search className="size-4 shrink-0 text-muted-foreground" /><input type="search" aria-label="Buscar habilidades y herramientas" placeholder="Busca por tarea: traducir, web, audio…" value={query} onChange={e => setQuery(e.target.value)} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Categoría de habilidades" value={category} onChange={e => setCategory(e.target.value)} className="max-w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"><option value="todas">Todas las categorías</option><option value="plantillas">Plantillas de Súper IA</option>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <Button size="sm" variant={onlyFavorites ? "primary" : "outline"} aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites(!onlyFavorites)}><Star className="size-4" />Favoritas</Button>
              <span className="self-center text-xs text-muted-foreground" role="status">{skills.length + tools.length} resultados</span>
            </div>
            {sources && <Card><div className="mb-3 flex justify-between gap-2"><h3 className="font-semibold">Fuentes de datos</h3><Button size="sm" variant="ghost" onClick={() => setSources(false)}>Cerrar fuentes</Button></div><DataSourcesCard ping={m => pushNotice(m)} /></Card>}
            {skills.length > 0 && <><h3 className="text-sm font-bold">Preparar y ejecutar en Súper IA</h3><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{skills.map(c => <article key={c.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4"><div className="mb-3 flex items-start justify-between gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">{TASK_LABELS[c.kind]}</span>{star(`superia-${c.id}`, c.name)}</div><h4 className="text-sm font-bold">{c.name}</h4><p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">{c.desc}</p><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={p.busy} onClick={() => p.onPrepare(c)}>Preparar encargo</Button><Button size="sm" variant="ghost" disabled={p.busy} onClick={() => { p.onTab("trabajo"); p.onRun(c); }}>Usar mi texto</Button></div></article>)}</div></>}
            {tools.length > 0 && <><h3 className="text-sm font-bold">Herramientas de WILLY</h3><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{tools.map(t => <article key={t.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4"><div className="mb-3 flex items-center justify-between"><t.icon className="size-5 text-primary" />{star(t.id,t.name)}</div><h4 className="text-sm font-bold">{t.name}</h4><p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>{t.note && <p className="mt-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">{t.note}</p>}<p className="mt-3 text-[10px] font-semibold text-muted-foreground">{t.availability !== "disponible" ? "Sin integración operativa" : t.action?.kind === "chat" ? "Se prepara en el Chat" : t.action?.kind === "nuevo-proyecto" ? "Entrevista en Súper IA" : "Abre su espacio de trabajo · requiere configuración"}</p><Button size="sm" variant="outline" className="mt-3 self-start" disabled={p.busy || t.availability !== "disponible" || !t.action} onClick={() => runTool(t)}>{t.availability === "disponible" ? "Abrir herramienta" : "No disponible"}<ArrowRight className="size-3.5" /></Button></article>)}</div></>}
            {!skills.length && !tools.length && <Card className="py-8 text-center"><p className="text-sm text-muted-foreground">No hay coincidencias con estos filtros.</p><Button variant="ghost" onClick={() => { setQuery(""); setCategory("todas"); setOnlyFavorites(false); }}>Restablecer filtros</Button></Card>}
          </section>}

          {p.tab === "historial" && <section className="space-y-4"><div><h2 className="text-xl font-bold">Continúa donde lo dejaste</h2><p className="mt-1 text-sm text-muted-foreground">Hasta 20 conversaciones recientes de este navegador. Los proyectos también están en Mis proyectos.</p></div><input type="search" aria-label="Buscar en el historial de Súper IA" value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} placeholder="Buscar una conversación…" className="w-full rounded-xl border border-border bg-card p-3 text-sm" />{sessions.filter(s => norm(`${s.title} ${s.prompt}`).includes(norm(historyQuery))).map(s => <Card key={s.id} className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{s.title}</h3><p className="mt-1 text-xs text-muted-foreground">{new Date(s.updatedAt).toLocaleString("es-ES")} · {s.projectId ? "Proyecto" : "Conversación"} · {s.turns?.length ?? 0} mensajes</p></div><Button size="sm" variant="outline" disabled={p.busy} onClick={() => { p.onResume(s); p.onTab("trabajo"); }}>Continuar<ArrowRight className="size-4" /></Button></Card>)}{!sessions.filter(s => norm(`${s.title} ${s.prompt}`).includes(norm(historyQuery))).length && <Card className="text-sm text-muted-foreground">No hay conversaciones que mostrar. Las respuestas terminadas se guardarán aquí.</Card>}</section>}

          {p.tab === "ajustes" && <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Motores y preferencias</h2><p className="mt-1 text-sm text-muted-foreground">Estado comunicado por el servidor; no es una prueba de generación.</p></div><Button size="sm" variant="outline" disabled={checking} onClick={() => void refresh()}><RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} />Actualizar estado</Button></div><Card className="space-y-3"><div className="flex flex-wrap gap-2">{p.mode}</div><p className="text-xs text-muted-foreground">{checkedAt ? `Consultado a las ${checkedAt}` : "Consultando…"}</p><p className="text-sm font-semibold">En tu equipo: {p.localModels.length} modelos detectados</p><p className="break-words text-xs text-muted-foreground">{p.localModels.join(" · ") || "No se detectaron modelos locales; revisa la conexión en el Centro de Inteligencia."}</p><div className="border-t border-border pt-3"><p className="text-sm font-semibold">Motores externos {status ? status.master ? "· habilitados" : "· desactivados" : "· sin respuesta del servidor"}</p><div className="mt-3 space-y-2">{status?.engines.map(e => <div key={e.id} className="rounded-lg bg-muted/40 p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong>{e.name}</strong><span>{!status.master ? "Desactivado globalmente" : !e.hasKey ? "Falta clave" : !e.enabled ? "Desactivado" : e.available ? "Disponible según el servidor" : "No disponible ahora"}</span></div><p className="mt-1 break-words text-muted-foreground">{e.model || "Sin modelo seleccionado"}{e.reason ? ` · ${e.reason}` : ""}</p></div>)}</div></div><Button size="sm" variant="outline" onClick={() => openView("inteligencia")}><Wrench className="size-4" />Configurar motores</Button></Card>{p.preferences}</section>}
        </main>
      </div>
    </div>
  </div>;
}
