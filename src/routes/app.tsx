import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useDarkTheme } from "@/hooks/use-dark-theme";
import {
  BookOpen, Brain, ChevronDown, Clock, FileCode2, FileText, FolderKanban, Github, Home, LayoutGrid, Menu as MenuIcon,
  MessageSquare, Moon, PanelLeftClose, PanelLeftOpen, Plus, Presentation, Settings, Sparkles, Sun, Trash2, Wrench, X,
  Zap, KeyRound, Headphones, ScanText, Video, Languages, Puzzle, Hammer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { NewProjectModal, PROJECT_ICONS, SectionView, type View } from "@/components/app-sections";
import { MOVED_VIEWS, requestSectionTab } from "@/lib/section-tabs";
import { authService } from "@/services/auth-service";
import { UserAvatar } from "@/components/user-avatar";
import { useProfile } from "@/lib/profile";
import { useSettings, type Settings as WorkspaceSettings } from "@/lib/workspace-store";
import { pushNotice } from "@/lib/notifications";
import { NotificationBell } from "@/components/notification-bell";
import { OfflineBanner } from "@/components/status-screens";
import { useLocalModels } from "@/lib/use-local-models";
import type { GeneratedFile } from "@/lib/ai-standard";
import { sendToSuperWilly } from "@/lib/super-willy-handoff";
import { ThinkingDots } from "@/components/thinking-dots";
import { loadOwnerBrain } from "@/lib/owner-brain";
import { CHAT_EVENT, deleteThread, listThreads, newThreadId, type ChatThread } from "@/lib/chat-history";
import { projectService, useProjects } from "@/services/project-service";
import { PROJECTS_EVENT } from "@/services/disk-project-service";
import { requestOpenProject } from "@/lib/super-willy-projects";
import { apiAuthService } from "@/services/api-auth-service";
import { backendOn } from "@/services/backend";
import type { Project } from "@/types/domain";
import { ViewActiveContext } from "@/lib/view-active";
import { ModelPicker } from "@/components/model-picker";
import { BackgroundTray } from "@/components/background-tray";
import { OPEN_VIEW_EVENT } from "@/lib/background-tasks";
import { UpdateNotice } from "@/components/update-notice";
import { saveBrief } from "@/lib/project-brief";
import { addProjectMemory } from "@/lib/project-memory";
import { dossierMarkdown, researchPromptBlock, runResearch, webSearch } from "@/lib/innovation-research";
import { designSystemSkeleton, needsVisualDirections } from "@/lib/design-intelligence";
import { needsTechPlan, techPlanSkeleton } from "@/lib/technical-plan";
import { rebuildDocs, saveRebuildRequest, systemSoftwareKinds } from "@/lib/product-rebuild";
// Armazón nuevo (conversación «WILLY AI FRONT», regla 21 de COORDINACION-IAS.md): barra superior, menú lateral y pantalla Inicio.
import { FrontShell } from "@/front/shell";
import { InicioScreen } from "@/front/inicio";
import { ChatsScreen } from "@/front/chats";
import { HerramientasScreen } from "@/front/herramientas";
import { sendToChat } from "@/front/chat-handoff";
// La conversación en sí (mensajes, IA local/externa, voz, adjuntos…) vive en components/chat-panel.tsx desde el 25/09/2026.
import { ChatPanel } from "@/components/chat-panel";
export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "WILLY AI — Espacio de trabajo" },
      { name: "description", content: "Panel de trabajo de WILLY AI: chat con agentes, vista previa en vivo, código, archivos y terminal." },
      { property: "og:title", content: "WILLY AI — Espacio de trabajo" },
      { property: "og:description", content: "Chat con agentes, vista previa en vivo, código, archivos y terminal en un solo lugar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Workspace,
});

// Menú clasificado por temáticas: cada grupo tiene un título (o ninguno, para los accesos principales de arriba) y sus
// opciones, cada una con su propio icono y nombre. Desde la revisión 20 (rediseño, punto 39): sin «Workspace» global;
// «Modelos» y «Agentes» están dentro del Centro de Inteligencia, y «Configuración» y «Estado del sistema», en Ajustes.
const NAV_GROUPS: { title?: string; items: { icon: typeof Home; label: string; active?: boolean }[] }[] = [
  {
    items: [
      { icon: Home, label: "Inicio" },
      { icon: MessageSquare, label: "Chats", active: true },
    ],
  },
  {
    title: "Inteligencia",
    items: [
      { icon: Sparkles, label: "SUPER WILLY" },
      { icon: Brain, label: "Centro de Inteligencia" },
      { icon: Hammer, label: "Autoconstrucción" },
    ],
  },
  {
    title: "Desarrollo",
    items: [
      { icon: FolderKanban, label: "Proyectos" },
      { icon: Wrench, label: "Herramientas" },
      { icon: Github, label: "GitHub" },
    ],
  },
  {
    title: "Multimedia",
    items: [
      { icon: BookOpen, label: "Libros" },
      { icon: Headphones, label: "Lectura" },
      { icon: ScanText, label: "OCR" },
      { icon: Languages, label: "Traducir" },
      { icon: Video, label: "Mi yo en IA" },
    ],
  },
  {
    title: "Más",
    items: [
      { icon: Puzzle, label: "Nuevas funciones" },
      { icon: Clock, label: "Historial" },
      { icon: Presentation, label: "Demo" },
      { icon: Zap, label: "Acceso directo" },
      { icon: KeyRound, label: "Licencias" },
    ],
  },
  {
    title: "Sistema",
    items: [{ icon: Settings, label: "Ajustes" }],
  },
];
// Lista plana (mismo orden) para el menú plegado, que solo muestra iconos.
const NAV = NAV_GROUPS.flatMap((g) => g.items);

function Workspace() {
  const navigate = useNavigate();
  const [settings, updateSettings] = useSettings();
  const [dark, setDark] = useDarkTheme();
  const [navOpen, setNavOpen] = useState(false);
  // Chat guardado en el equipo: la conversación activa y su historial no se pierden.
  const [threadId, setThreadId] = useState("principal");
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  // Las pestañas que ya has abierto se quedan VIVAS (ocultas): así no pierdes lo que escribías o generabas en ellas al cambiar de una a otra.
  const [visited, setVisited] = useState<View[]>(["chat"]);
  const shown = visited.includes(view) ? visited : [...visited, view];
  useEffect(() => {
    if (!visited.includes(view)) setVisited(shown);
    // Al cambiar de pestaña se calla cualquier lectura en voz alta que siga sonando.
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  // Lo que el dueño ha enseñado a WILLY (instrucciones y reglas) se trae del equipo al abrir: vale para todos los chats y todas las IA.
  useEffect(() => { void loadOwnerBrain(); }, []);
  // La bandeja de trabajos en segundo plano pide abrir la pestaña de un trabajo (Súper IA, Traducir…) al pulsarlo.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const wanted = (event as CustomEvent<string>).detail;
      if (typeof wanted !== "string" || !wanted) return;
      const moved = MOVED_VIEWS[wanted];
      if (moved) {
        requestSectionTab(moved.view, moved.tab);
        setView(moved.view as View);
      } else setView(wanted as View);
    };
    window.addEventListener(OPEN_VIEW_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_VIEW_EVENT, onOpen);
  }, []);
  const goTo = (target: View, tab?: string) => {
    if (tab) requestSectionTab(target, tab);
    setView(target);
    setNavOpen(false);
  };
  const [newProject, setNewProject] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [generated, setGenerated] = useState<GeneratedFile[]>([]);
  // La IA del chat está escribiendo.
  const [chatBusy, setChatBusy] = useState(false);
  const { projects, loading: projectsLoading } = useProjects();

  // Proyecto actual: el que está abierto en SUPER WILLY (una sola fuente; lo usan la barra de arriba, Historial y GitHub).
  const active = useMemo(
    () => (settings.projectId ? projects.find((p) => p.id === settings.projectId) : undefined)
      ?? (settings.project ? projects.find((p) => p.name === settings.project) : undefined),
    [projects, settings.projectId, settings.project],
  );

  // Sus archivos (la lista de proyectos no trae el contenido), al día cuando SUPER WILLY guarda o se restaura una versión.
  useEffect(() => {
    if (!active) { setGenerated([]); return; }
    let alive = true;
    const load = () => void projectService.get(active.id).then((p) => { if (alive && p) setGenerated(p.files); });
    load();
    window.addEventListener(PROJECTS_EVENT, load);
    return () => { alive = false; window.removeEventListener(PROJECTS_EVENT, load); };
  }, [active?.id]);

  // Con el servidor conectado, recupera la sesión desde la cookie al abrir.
  useEffect(() => {
    if (backendOn()) void apiAuthService.refresh();
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("willy-theme", next ? "dark" : "light");
  };

  const ping = (msg: string) => {
    setToast(msg);
    pushNotice(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  /** Abre un proyecto: SIEMPRE en SUPER WILLY (rev21), con su chat, su vista previa y sus archivos. El Chat ya no tiene taller. */
  const openProject = (p: Project) => {
    setNavOpen(false);
    updateSettings({ projectId: p.id, project: p.name });
    requestOpenProject(p.id);
    setView("superia");
  };

  // Un enlace de «Compartir» (/app?proyecto=<id o nombre>) abre ese proyecto en cuanto la lista está cargada (una vez).
  const sharedLinkDone = useRef(false);
  useEffect(() => {
    if (sharedLinkDone.current || projectsLoading || typeof window === "undefined") return;
    sharedLinkDone.current = true;
    const wanted = new URLSearchParams(window.location.search).get("proyecto");
    if (!wanted) return;
    const found = projects.find((p) => p.id === wanted) ?? projects.find((p) => p.name === wanted);
    if (found) openProject(found);
    else ping(`No encuentro el proyecto «${wanted}» en este equipo.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsLoading, projects]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <OfflineBanner />
      <FrontShell
        view={view} onNav={goTo}
        dark={dark} toggleTheme={toggleTheme}
        navOpen={navOpen} onOpenNav={() => setNavOpen(true)} onCloseNav={() => setNavOpen(false)}
        collapsed={railCollapsed} onToggleCollapsed={() => setRailCollapsed((v) => !v)}
        ping={ping} settings={settings} updateSettings={updateSettings}
        generating={chatBusy}
      >
        {/* El Chat es para conversar (rev21): sin vista previa ni archivos de proyecto. La pantalla Chats (lista de
            conversaciones, favoritos, etiquetas) es del armazón nuevo; la conversación en sí sigue siendo ChatPanel. */}
        <div className={view === "chat" ? "contents" : "hidden"}>
          <ChatsScreen
            threadId={threadId}
            onOpenThread={(id) => { setThreadId(id); setView("chat"); setNavOpen(false); }}
            onNewChat={() => { setThreadId(newThreadId()); setView("chat"); setNavOpen(false); }}
            ping={ping}
          >
            <ChatPanel
              ping={ping}
              settings={settings}
              updateSettings={updateSettings}
              threadId={threadId}
              onBusy={setChatBusy}
              embedded
            />
          </ChatsScreen>
        </div>
        {shown.filter((entry) => entry !== "chat").map((entry) => (
          <div key={entry} className={entry === view ? "contents" : "hidden"}>
            <ViewActiveContext.Provider value={entry === view}>
              {entry === "inicio" ? (
                <InicioScreen
                  ping={ping} onNav={goTo}
                  onNewProject={() => setNewProject(true)}
                  onOpenProject={openProject}
                  onAskWilly={(text, files) => { setThreadId(newThreadId()); sendToChat({ text, files, autoSend: true }); setView("chat"); }}
                />
              ) : entry === "herramientas" ? (
                <HerramientasScreen
                  ping={ping} onNav={goTo}
                  onNewProject={() => setNewProject(true)}
                  onOpenChat={(text, autoSend) => { setThreadId(newThreadId()); sendToChat({ text, autoSend }); setView("chat"); }}
                />
              ) : (
              <SectionView
                view={entry} ping={ping} files={generated}
                onNewProject={() => setNewProject(true)}
                onOpenProject={openProject}
                onLogout={() => {
                  if (!window.confirm("¿Cerrar la sesión en este equipo? Podrás volver a entrar con «Ver panel». El panel de administración (licencias) te pedirá tu correo y tu contraseña.")) return;
                  authService.signOut();
                  ping("Sesión cerrada en este equipo.");
                  window.setTimeout(() => void navigate({ to: "/" }), 400);
                }}
              />
              )}
            </ViewActiveContext.Provider>
          </div>
        ))}
      </FrontShell>
      {newProject && (
        <NewProjectModal
          onClose={() => setNewProject(false)}
          onCreate={(name, prompt, extra) => {
            void (async () => {
              // Si el nombre lo puso WILLY y ya existe, se numera («Tienda 2»…) en vez de fallar.
              const auto = !!extra?.autoName;
              // El tipo (web, app, api…) queda en la ficha: SUPER WILLY no inventa una pantalla para lo que no la tiene.
              const typed = { origin: "nuevo" as const, ...(extra ? { mode: extra.mode } : {}), ...(extra?.brief.inferredType ? { kind: extra.brief.inferredType } : {}) };
              let r = await projectService.create({ name, prompt, desc: (extra?.brief.goal ?? prompt).slice(0, 90), ...typed });
              for (let n = 2; !r.ok && auto && /Ya existe/.test(r.error) && n < 10; n++) {
                r = await projectService.create({ name: `${name} ${n}`, prompt, desc: (extra?.brief.goal ?? prompt).slice(0, 90), ...typed });
              }
              if (!r.ok) { ping(`⚠️ ${r.error}`); return; }
              const project = r.data;
              if (extra) saveBrief(project.id, { ...extra.brief, name: project.name });
              setNewProject(false);
              updateSettings({ projectId: project.id, project: project.name });
              let seedText = extra ? prompt.replace(`«${name}»`, `«${project.name}»`) : `Crea el proyecto «${project.name}». ${prompt}`;
              if (extra?.mode === "innovation") {
                // I+D: primero se busca de verdad qué existe; lo encontrado (con dirección y fecha) abre el dossier y se le da a la IA como sus únicas fuentes.
                ping(`Proyecto innovador «${project.name}» creado. Investigando qué existe ya (búsqueda real en internet)…`);
                const research = await runResearch(extra.brief.userInput, webSearch);
                const dossier = { path: "docs/innovacion.md", lang: "md", content: dossierMarkdown({ ...extra.brief, name: project.name }, research) };
                const plan = { path: "docs/plan-tecnico.md", lang: "md", content: techPlanSkeleton({ ...extra.brief, name: project.name }) };
                await projectService.saveFiles(project.id, [dossier, plan], "Dossier de innovación y plan técnico (inicio)");
                addProjectMemory(project.id, "decision", "Proyecto innovador · I+D: se investiga y se critica antes de construir.");
                addProjectMemory(project.id, "investigacion", research.searched && research.sources.length ? `Búsqueda real (${research.searchedAt.slice(0, 10)}): ${research.sources.length} fuente(s), por ejemplo ${research.sources.slice(0, 3).map((x) => x.title).join("; ")}.` : "No se pudo buscar en internet al crear el proyecto: lo que se diga de lo que ya existe es hipótesis.");
                seedText = `${seedText}\n\n${researchPromptBlock(research)}`;
                ping(research.searched && research.sources.length ? `Investigación: ${research.sources.length} fuente(s) reales guardadas en docs/innovacion.md.` : "No se pudo buscar en internet ahora: WILLY marcará como hipótesis lo que diga sobre lo que ya existe.");
              } else if (extra?.mode === "rebuild" && extra.rebuild) {
                // Replicar aplicación/programa: el encargo queda guardado aparte (solo WILLY lo escribe) y el proyecto arranca con
                // su informe, su matriz de funcionalidades, el estado por módulos, el plan técnico y las reglas de réplica del dueño.
                saveRebuildRequest(project.id, extra.rebuild);
                const docs = rebuildDocs(project.name, extra.rebuild, extra.brief);
                await projectService.saveFiles(project.id, docs, "Réplica: informe, matriz, estado y plan técnico (inicio)");
                const kinds = systemSoftwareKinds(`${extra.rebuild.reference} ${extra.rebuild.goal}`);
                addProjectMemory(project.id, "decision", `Réplica funcional PROPIA (clean-room) de: ${extra.rebuild.reference || "lo que describe el dueño"}. Nombre, identidad, código y assets propios; nada del original.${kinds.length ? ` Software de sistema: ${kinds.join(", ")}.` : ""}`);
                ping(`Réplica «${project.name}» creada. WILLY empieza por la auditoría y el informe; la pestaña «Replicación» del taller muestra el avance y qué falta para poder entregarla.`);
              } else {
                // Proyecto normal: el sistema de diseño (si tiene pantallas) y el plan técnico (empezando en pequeño) arrancan como
                // documentos, a la espera de que elijas la dirección visual y de que WILLY complete el plan.
                if (extra) {
                  const docs = [
                    ...(needsVisualDirections(extra.brief.inferredType) ? [{ path: "docs/design-system.md", lang: "md", content: designSystemSkeleton({ ...extra.brief, name: project.name }) }] : []),
                    ...(needsTechPlan(extra.brief) ? [{ path: "docs/plan-tecnico.md", lang: "md", content: techPlanSkeleton({ ...extra.brief, name: project.name }) }] : []),
                  ];
                  if (docs.length) await projectService.saveFiles(project.id, docs, "Sistema de diseño y plan técnico (inicio)");
                }
                ping(`Proyecto «${project.name}» creado en tu equipo. SUPER WILLY empieza a construirlo.`);
              }
              // Se construye en SUPER WILLY (antes se quedaba en el Chat con un «voy a montar la estructura» que no hacía nada):
              // abre el proyecto con su taller y empieza a trabajar con el encargo completo.
              sendToSuperWilly({ text: seedText, action: "crear", attachments: [], images: [], urls: [], from: "nuevo-proyecto", projectId: project.id, autoRun: true, ...(extra?.model ? { model: extra.model } : {}) });
              setView("superia");
            })();
          }}
        />
      )}
      {/* Debajo de la barra superior y de la cabecera del panel: no tapa botones ni el cuadro del chat. */}
      <BackgroundTray placement="top" offset={108} />
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-[60] max-w-[92vw] -translate-x-1/2 rounded-md border border-border bg-card px-4 py-2 text-center text-xs shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function TopBar({ dark, toggleTheme, onMenu, ping, onNav, settings, updateSettings, onOpenProject, generating, projects }: {
  dark: boolean; toggleTheme: () => void; onMenu: () => void; ping: (m: string) => void; onNav: (v: View, tab?: string) => void;
  settings: WorkspaceSettings; updateSettings: (p: Partial<WorkspaceSettings>) => void;
  onOpenProject: (p: Project) => void; generating: boolean;
  projects: Project[];
}) {
  // Solo los modelos que hay de verdad en tu equipo (antes, si no había ninguno, enseñaba una lista inventada).
  const { models: modelList } = useLocalModels(settings.endpoint);
  return (
    <header className="safe-header z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-3">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Abrir menú"><MenuIcon className="size-5" /></Button>

      <Menu
        label="Elegir proyecto"
        trigger={({ toggle }) => (
          <Button variant="secondary" size="sm" className="h-9 gap-2 rounded-lg" onClick={toggle}>
            <LayoutGrid className="size-4 text-primary" /><span className="hidden max-w-36 truncate sm:inline">{projects.find((p) => p.id === settings.projectId)?.name ?? (settings.project || "Sin proyecto")}</span><ChevronDown className="size-3.5" />
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>Proyectos en tu equipo (se abren en SUPER WILLY)</MenuLabel>
            {projects.map((p) => {
              const Icon = PROJECT_ICONS[p.icon] ?? FolderKanban;
              return (
                <MenuItem key={p.id} active={p.id === settings.projectId || (!settings.projectId && p.name === settings.project)} onClick={() => { close(); onOpenProject(p); }}>
                  <Icon className="size-4 shrink-0 text-primary" /><span className="truncate">{p.name}</span>
                </MenuItem>
              );
            })}
            <div className="my-1 h-px bg-border" />
            <MenuItem onClick={() => { close(); onNav("proyectos"); }}><FolderKanban className="size-4" />Ver todos los proyectos</MenuItem>
          </>
        )}
      </Menu>

      {/* Con qué IA hablas: el modelo de tu equipo o, si está en uso, la IA externa con su nombre (y entonces sin modelos locales). */}
      <ModelPicker
        model={settings.model}
        models={modelList}
        onPickModel={(name) => { updateSettings({ model: name }); ping(`Modelo activo: ${name}`); }}
        onManage={() => onNav("inteligencia", "modelos")}
        ping={ping}
      />

      <Button variant="ghost" size="sm" className="hidden h-9 gap-2 text-muted-foreground xl:inline-flex" onClick={() => onNav("ajustes", "sistema")} title="Estado de WILLY AI (Ajustes → Sistema)">
        <AudioWaveform className={`size-4 ${generating ? "animate-pulse text-primary" : ""}`} />{generating ? <ThinkingDots /> : "En reposo"}
      </Button>
      <div className="flex-1" />

      {/* Ejecutar, Publicar, Compartir y las opciones del proyecto están en el taller del proyecto (SUPER WILLY), desde la rev21. */}
      <UpdateNotice />
      <NotificationBell enabled={settings.notify} onOpenSettings={() => onNav("ajustes", "general")} />
      <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Cambiar tema">{dark ? <Sun className="size-5" /> : <Moon className="size-5" />}</Button>
      <button className="shrink-0 rounded-full" onClick={() => onNav("cuenta")} aria-label="Cuenta"><UserAvatar size={36} /></button>
    </header>
  );
}

const NAV_VIEW: Record<string, View> = {
  Inicio: "inicio", "SUPER WILLY": "superia", "Centro de Inteligencia": "inteligencia", Autoconstrucción: "autoconstruccion",
  Proyectos: "proyectos", Chats: "chat", Herramientas: "herramientas", Historial: "historial", Ajustes: "ajustes",
  GitHub: "github", "Acceso directo": "instalacion", Demo: "demo", Licencias: "licencias",
  Lectura: "lectura", OCR: "ocr", "Mi yo en IA": "avatar", Traducir: "traducir",
  "Nuevas funciones": "extras", Libros: "libros", Transcribir: "transcribir",
};

function Sidebar({ open, onClose, view, onNav, onNewProject, onOpenProject, activeProject, collapsed, onToggle, projects, threadId, onOpenThread, onNewChat }: {
  open: boolean; onClose: () => void;
  view: View; onNav: (v: View, tab?: string) => void; onNewProject: () => void;
  onOpenProject: (p: Project) => void; activeProject: string;
  collapsed: boolean; onToggle: () => void;
  projects: Project[];
  threadId: string; onOpenThread: (id: string) => void; onNewChat: () => void;
}) {
  const [profile] = useProfile();
  // Chats guardados: se mantienen al día con lo que se escribe en el chat.
  const [threads, setThreads] = useState<ChatThread[]>([]);
  useEffect(() => {
    const refresh = () => setThreads(listThreads().slice(0, 6));
    refresh();
    window.addEventListener(CHAT_EVENT, refresh);
    return () => window.removeEventListener(CHAT_EVENT, refresh);
  }, []);

  if (collapsed) {
    return (
      <aside className={`${open ? "flex" : "hidden"} safe-modal fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:static lg:z-auto lg:flex lg:w-12 lg:shrink-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <nav className="safe-menu flex h-full w-12 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-3 lg:w-12" aria-label="Navegación principal plegada">
          <Button variant="ghost" size="icon" className="size-9" onClick={onToggle} aria-label="Desplegar menú"><PanelLeftOpen className="size-4" /></Button>
          <Button variant="ghost" size="icon" className="size-9" onClick={onNewProject} aria-label="Nuevo proyecto"><Plus className="size-4" /></Button>
          <div className="my-1 h-px w-7 bg-border" />
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.title ?? `principal-${gi}`} className={`flex flex-col items-center gap-1 ${gi > 0 ? "mt-1.5 border-t border-border pt-1.5" : ""}`}>
              {group.items.map(({ icon: Icon, label }) => (
                <button key={label} onClick={() => onNav(NAV_VIEW[label] ?? "chat")} title={label} aria-label={label} className={`flex size-9 items-center justify-center rounded-md ${view === (NAV_VIEW[label] ?? "chat") ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          ))}
          <div className="mt-auto flex flex-col items-center gap-1">
            <button onClick={() => onNav("documentacion")} title="Documentación" aria-label="Documentación" className={`flex size-9 items-center justify-center rounded-md ${view === "documentacion" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}><FileText className="size-4" /></button>
            <button onClick={() => onNav("cuenta")} title="Cuenta" aria-label="Cuenta" className="rounded-full"><UserAvatar size={32} /></button>
          </div>
        </nav>
      </aside>
    );
  }

  return (
    <aside className={`${open ? "flex" : "hidden"} safe-modal fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:static lg:z-auto lg:flex lg:w-60 lg:shrink-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <nav className="safe-menu flex h-full w-72 flex-col overflow-y-auto border-r border-border bg-card p-3 lg:w-60" aria-label="Navegación principal">
        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
          <div className="flex items-center gap-2 px-1"><LogoMark /><div><p className="font-display text-sm font-bold leading-tight">WILLY AI</p><p className="text-[10px] text-muted-foreground">Crea. Desarrolla. Sin límites.</p></div></div>
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={onToggle} aria-label="Plegar menú"><PanelLeftClose className="size-4" /></Button>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose} aria-label="Cerrar menú"><X className="size-5" /></Button>
        </div>
        <Button size="sm" className="mb-3 h-9 w-full shrink-0 justify-center gap-1.5 rounded-lg" onClick={onNewProject}><Plus className="size-3.5 fill-current" />Nuevo proyecto</Button>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.title ?? `principal-${gi}`} className={gi === 0 ? "space-y-0.5" : "mt-3 space-y-0.5"}>
            {group.title && (
              <p className="mb-1 px-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{group.title}</p>
            )}
            {group.items.map(({ icon: Icon, label, active }) => (
              <button
                key={label}
                onClick={() => onNav(NAV_VIEW[label] ?? "chat")}
                aria-current={view === (NAV_VIEW[label] ?? "chat") ? "page" : undefined}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${view === (NAV_VIEW[label] ?? "chat") || (active && view === "chat") ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
              >
                <Icon className="size-4" />{label}
              </button>
            ))}
          </div>
        ))}
        <p className="mb-1 mt-4 flex items-center justify-between px-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Recientes
          <button onClick={onNewChat} className="rounded p-0.5 hover:text-foreground" aria-label="Nueva conversación" title="Nueva conversación"><Plus className="size-3.5" /></button>
        </p>
        <div className="space-y-0.5">
          {threads.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenThread(t.id)}
              onKeyDown={(e) => { if (e.key === "Enter") onOpenThread(t.id); }}
              className={`group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${t.id === threadId && view === "chat" ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
            >
              <MessageSquare className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{t.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteThread(t.id); if (t.id === threadId) onNewChat(); }}
                className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:text-foreground"
                aria-label={`Borrar conversación ${t.title}`}
                title="Borrar conversación"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {threads.length === 0 && <p className="px-2.5 py-1 text-xs text-muted-foreground">Tus conversaciones se guardarán aquí.</p>}
        </div>
        <p className="mb-1 mt-4 px-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Proyectos</p>
        <div className="space-y-0.5">
          {projects.slice(0, 6).map((p) => {
            const Icon = PROJECT_ICONS[p.icon] ?? FileCode2;
            return (
              <button key={p.id} onClick={() => onOpenProject(p)} title="Abrir en SUPER WILLY" className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${p.id === activeProject && view === "superia" ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
                <Icon className="size-4" /><span className="truncate">{p.name}</span>
              </button>
            );
          })}
          {projects.length === 0 && <p className="px-2.5 py-1 text-xs text-muted-foreground">Sin proyectos todavía.</p>}
        </div>
        <div className="mt-auto space-y-0.5 pt-4">
          <SideItem icon={FileText} label="Documentación" active={view === "documentacion"} onClick={() => onNav("documentacion")} />
          <button className={`mt-2 flex w-full items-center gap-2.5 rounded-md border border-border bg-background/60 px-2.5 py-2 text-left ${view === "cuenta" ? "border-primary/60" : ""}`} onClick={() => onNav("cuenta")}>
            <UserAvatar size={32} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{profile.name}</span><span className="block text-[10px] text-emerald-500">Online</span></span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </div>
      </nav>
    </aside>
  );
}

function SideItem({ icon: Icon, label, badge, active, onClick }: { icon: typeof BookOpen; label: string; badge?: ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-current={active ? "page" : undefined} className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${active ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
      <Icon className="size-4" />{label}
      {badge && <span className="ml-auto">{badge}</span>}
    </button>
  );
}

function AudioWaveform({ className }: { className: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 9v6M22 12h-2" /></svg>;
}

function LogoMark() {
  return <span className="font-display text-xl font-bold leading-none text-brand-gradient" aria-hidden="true">W</span>;
}
