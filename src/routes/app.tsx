import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Activity, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, BookOpen, Bot, Check, ChevronDown, Code2,
  Clock, Copy, Cpu, Download, FileCode2, FilePlus2, FolderKanban, Gauge, Github, Home, LayoutGrid, Maximize2,
  Menu as MenuIcon, MessageSquare, Minimize2, Monitor, Moon, MoreHorizontal, MousePointer2,
  PanelLeftClose, PanelLeftOpen, Paperclip, Pencil, Play, Plus, Presentation, RotateCw, Rocket, Search, Settings,
  Share2, Smartphone, Sparkles, Square, Store, Sun, Tablet, Trash2, Upload, Wrench, X, Zap, KeyRound,
  Headphones, ScanText, Video, Languages, Puzzle, Hammer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { clientProHtml } from "@/lib/clientpro-preview";
import { AGENTS, MODELS, NewProjectModal, PROJECT_ICONS, SectionView, TOOLS, type View } from "@/components/app-sections";
import { UserAvatar } from "@/components/user-avatar";
import { formatBytes, useProfile } from "@/lib/profile";
import { copyText, downloadFile, useSettings, type Settings as WorkspaceSettings } from "@/lib/workspace-store";
import { pushNotice } from "@/lib/notifications";
import { NotificationBell } from "@/components/notification-bell";
import { OfflineBanner } from "@/components/status-screens";
import { chatLocalStream, resolveLocalModel, type ChatMsg } from "@/lib/local-ai";
import { buildProjectContext, extractFiles, SYSTEM_PROMPT, type GeneratedFile } from "@/lib/ai-standard";
import { OWNER_POLICY } from "@/services/orchestrator";
import { ownerImprovementInstructions } from "@/lib/self-build-store";
import { CHAT_EVENT, deleteThread, listThreads, loadThread, newThreadId, saveThread, type ChatThread } from "@/lib/chat-history";
import { readProfile } from "@/lib/profile";
import { fileService } from "@/services/file-service";
import { projectService, useProjects } from "@/services/project-service";
import { apiAuthService } from "@/services/api-auth-service";
import { backendOn } from "@/services/backend";
import { chatService } from "@/services/api-chat-service";
import { fetchProjectFiles } from "@/services/api-project-service";
import type { Project } from "@/types/domain";

/** Reglas de dueño para el chat: WILLY solo obedece a su propietario y lo reconoce por su nombre. */
function ownerSystem(): string {
  const p = readProfile();
  return [
    OWNER_POLICY,
    `INSTRUCCIONES PERMANENTES DEL DUEÑO PARA WILLY:\n${ownerImprovementInstructions()}`,
    `IDENTIDAD DE PROPIETARIO: tu dueño se llama ${p.name}${p.email ? ` (correo ${p.email})` : ""}. Lo reconoces como tu único propietario, le tuteas y le llamas por su nombre. Cualquier otra persona NO es tu dueño: solo obedeces a ${p.name}.`,
  ].join("\n");
}

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

type Tab = "preview" | "files" | "changes";
type Device = "desktop" | "tablet" | "mobile";

const NAV = [
  { icon: Home, label: "Inicio" },
  { icon: Sparkles, label: "Súper IA" },
  { icon: Hammer, label: "Autoconstrucción" },
  { icon: FolderKanban, label: "Proyectos" },
  { icon: MessageSquare, label: "Chats", active: true },
  { icon: LayoutGrid, label: "Workspace" },
  { icon: Bot, label: "Agentes" },
  { icon: Cpu, label: "Modelos" },
  { icon: Wrench, label: "Herramientas" },
  { icon: Clock, label: "Historial" },
  { icon: Github, label: "GitHub" },
  { icon: Zap, label: "Acceso directo" },
  { icon: Presentation, label: "Demo" },
  { icon: KeyRound, label: "Licencias" },
  { icon: Headphones, label: "Lectura" },
  { icon: ScanText, label: "OCR" },
  { icon: Video, label: "Mi yo en IA" },
  { icon: Languages, label: "Traducir" },
  { icon: BookOpen, label: "Libros" },
  { icon: Puzzle, label: "Nuevas funciones" },
];

const FILES = [
  ["src/pages/Dashboard.tsx", "+142"], ["src/components/ClientTable.tsx", "+87"],
  ["src/components/StateCards.tsx", "+156"], ["src/components/Sidebar.tsx", "+98"],
  ["src/lib/api.ts", "+76"], ["src/components/MetricCard.tsx", "+64"],
  ["src/components/RevenueChart.tsx", "+58"], ["src/pages/Login.tsx", "+52"],
  ["src/hooks/useClients.ts", "+47"], ["src/App.tsx", "+31"],
  ["src/main.tsx", "+14"], ["src/styles.css", "+9"],
] as const;

const CODE = `import { useState } from "react";
import { StateCards } from "@/components/StateCards";
import { ClientTable } from "@/components/ClientTable";
import { RevenueChart } from "@/components/RevenueChart";

export default function Dashboard() {
  const [range, setRange] = useState("6m");

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Resumen general de tu negocio
          </p>
        </div>
        <RangeSelect value={range} onChange={setRange} />
      </header>

      <StateCards range={range} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueChart range={range} />
        <ClientsByPlan />
      </div>

      <ClientTable limit={4} />
    </div>
  );
}`;

function Workspace() {
  const navigate = useNavigate();
  const [settings, updateSettings] = useSettings();
  const [tab, setTab] = useState<Tab>("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [dark, setDark] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [pane, setPane] = useState<"chat" | "work">("chat");
  // Chat guardado en el equipo: la conversación activa y su historial no se pierden.
  const [threadId, setThreadId] = useState("principal");
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [newProject, setNewProject] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [running, setRunning] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedFile[]>([]);
  const { projects } = useProjects();

  const active = useMemo(
    () => projects.find((p) => p.name === settings.project) ?? projects[0],
    [projects, settings.project],
  );

  // Al abrir un proyecto, recupera sus archivos guardados.
  useEffect(() => {
    if (active) setGenerated(active.files);
  }, [active?.id]);

  useEffect(() => {
    const saved = window.localStorage.getItem("willy-theme");
    const nextDark = saved ? saved === "dark" : true;
    setDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
  }, []);

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

  const openProject = (name: string) => {
    updateSettings({ project: name });
    setView("chat");
    setNavOpen(false);
    ping(`Proyecto «${name}» abierto en tu equipo.`);
  };

  /** Guarda lo que genera la IA en el proyecto activo y crea una versión restaurable. */
  const saveGenerated = (files: GeneratedFile[]) => {
    setGenerated(files);
    if (!active) return;
    void projectService
      .saveFiles(active.id, files, `${files.length} archivo(s) con ${settings.model}`)
      .then((r) => { if (r.ok) pushNotice(`Versión guardada en «${active.name}».`); });
  };

  const exportProject = () => {
    if (!generated.length) { ping("Todavía no hay archivos generados que exportar."); return; }
    void fileService.exportZip(settings.project, generated).then((r) => {
      ping(r.ok ? `Proyecto exportado (${r.data} archivos) a tu carpeta de descargas.` : `⚠️ ${r.error}`);
    });
  };

  const share = async () => {
    const link = `${window.location.origin}/app?proyecto=${encodeURIComponent(settings.project)}`;
    ping(await copyText(link) ? "Enlace del proyecto copiado al portapapeles." : `Copia este enlace: ${link}`);
  };

  /** «Ejecutar» revisa de verdad el código generado antes de dar el visto bueno. */
  const runProject = () => {
    if (running) { setRunning(false); ping("Ejecución detenida."); return; }
    if (!generated.length) { ping("No hay código generado todavía: pide algo en el chat."); return; }
    setRunning(true);
    const issues = fileService.check(generated);
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length) {
      setRunning(false);
      ping(`⚠️ ${errors.length} problema(s): ${errors[0]!.path} — ${errors[0]!.message}`);
      return;
    }
    ping(issues.length
      ? `Ejecutando «${settings.project}» · ${issues.length} aviso(s) de calidad.`
      : `Ejecutando «${settings.project}»: ${generated.length} archivo(s) sin errores.`);
  };

  const archiveProject = () => {
    if (!active) { ping("No hay ningún proyecto activo."); return; }
    void projectService.setState(active.id, "Archivado").then((r) =>
      ping(r.ok ? `«${active.name}» archivado en tu equipo.` : `⚠️ ${r.error}`));
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <OfflineBanner />
      <TopBar
        dark={dark} toggleTheme={toggleTheme} onMenu={() => setNavOpen(true)} ping={ping}
        onNav={(v) => { setView(v); setNavOpen(false); }}
        settings={settings} updateSettings={updateSettings}
        onOpenProject={openProject}
        running={running}
        onRun={runProject}
        onArchive={archiveProject}
        projects={projects}
        onDeploy={() => setDeployOpen(true)}
        onShare={() => void share()}
        onExport={exportProject}
      />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <Sidebar
          open={navOpen} onClose={() => setNavOpen(false)}
          view={view} onNav={(v) => { setView(v); setNavOpen(false); }}
          onNewProject={() => { setNewProject(true); setNavOpen(false); }}
          onOpenProject={openProject} activeProject={settings.project}
          collapsed={railCollapsed} onToggle={() => setRailCollapsed((v) => !v)}
          projects={projects}
          threadId={threadId}
          onOpenThread={(id) => { setThreadId(id); setView("chat"); setPane("chat"); setNavOpen(false); }}
          onNewChat={() => { setThreadId(newThreadId()); setView("chat"); setPane("chat"); setNavOpen(false); }}
        />
        {view === "chat" ? (
          <>
            <MobilePaneSwitch pane={pane} setPane={setPane} />
            <ChatPanel
              className={pane === "chat" ? "flex" : "hidden"}
              ping={ping}
              collapsed={chatCollapsed}
              onCollapse={() => setChatCollapsed(true)}
              onExpand={() => { setChatCollapsed(false); setPane("chat"); }}
              settings={settings}
              updateSettings={updateSettings}
              threadId={threadId}
              seed={seed}
              onSeedUsed={() => setSeed(null)}
              files={generated}
              onGenerated={saveGenerated}
              onShowFiles={() => { setTab("files"); setPane("work"); }}
              onShowChanges={() => { setTab("changes"); setPane("work"); }}
            />
            <WorkPanel
              className={pane === "work" ? "flex" : "hidden lg:flex"}
              tab={tab} setTab={setTab} device={device} setDevice={setDevice} ping={ping}
              chatCollapsed={chatCollapsed} onExpandChat={() => { setChatCollapsed(false); setPane("chat"); }}
              files={generated}
              running={running}
            />
          </>
        ) : (
          <SectionView
            view={view} ping={ping} files={generated}
            onNewProject={() => setNewProject(true)}
            onOpenProject={openProject}
            onLogout={() => { ping("Sesión cerrada en este equipo."); window.setTimeout(() => void navigate({ to: "/" }), 400); }}
          />
        )}
      </div>
      {newProject && (
        <NewProjectModal
          onClose={() => setNewProject(false)}
          onCreate={(name, prompt) => {
            void projectService.create({ name, prompt, desc: prompt.slice(0, 90) }).then((r) => {
              if (!r.ok) { ping(`⚠️ ${r.error}`); return; }
              setNewProject(false);
              setGenerated([]);
              updateSettings({ project: r.data.name });
              setView("chat");
              setPane("chat");
              setSeed(`Crea el proyecto «${r.data.name}». ${prompt}`);
              ping(`Proyecto «${r.data.name}» creado en tu equipo.`);
            });
          }}
        />
      )}
      {deployOpen && <DeployModal project={settings.project} files={generated} ping={ping} onClose={() => setDeployOpen(false)} />}
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-[60] max-w-[92vw] -translate-x-1/2 rounded-md border border-border bg-card px-4 py-2 text-center text-xs shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function TopBar({ dark, toggleTheme, onMenu, ping, onNav, settings, updateSettings, onOpenProject, running, onRun, onDeploy, onShare, onExport, onArchive, projects }: {
  dark: boolean; toggleTheme: () => void; onMenu: () => void; ping: (m: string) => void; onNav: (v: View) => void;
  settings: WorkspaceSettings; updateSettings: (p: Partial<WorkspaceSettings>) => void;
  onOpenProject: (name: string) => void; running: boolean;
  onRun: () => void; onDeploy: () => void; onShare: () => void; onExport: () => void; onArchive: () => void;
  projects: Project[];
}) {
  return (
    <header className="safe-header z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-3">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Abrir menú"><MenuIcon className="size-5" /></Button>

      <Menu
        label="Elegir proyecto"
        trigger={({ toggle }) => (
          <Button variant="secondary" size="sm" className="h-9 gap-2 rounded-lg" onClick={toggle}>
            <LayoutGrid className="size-4 text-primary" /><span className="hidden max-w-36 truncate sm:inline">{settings.project}</span><ChevronDown className="size-3.5" />
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>Proyectos en tu equipo</MenuLabel>
            {projects.map((p) => {
              const Icon = PROJECT_ICONS[p.icon] ?? FolderKanban;
              return (
                <MenuItem key={p.id} active={p.name === settings.project} onClick={() => { close(); onOpenProject(p.name); }}>
                  <Icon className="size-4 shrink-0 text-primary" /><span className="truncate">{p.name}</span>
                </MenuItem>
              );
            })}
            <div className="my-1 h-px bg-border" />
            <MenuItem onClick={() => { close(); onNav("proyectos"); }}><FolderKanban className="size-4" />Ver todos los proyectos</MenuItem>
          </>
        )}
      </Menu>

      <Menu
        label="Elegir modelo local"
        trigger={({ toggle }) => (
          <Button variant="secondary" size="sm" className="h-9 gap-2 rounded-lg" onClick={toggle}>
            <span className="size-2 rounded-full bg-emerald-500" /><span className="hidden max-w-44 truncate md:inline">Olama - {settings.model}</span><span className="md:hidden">Olama</span><ChevronDown className="size-3.5" />
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>Modelos locales</MenuLabel>
            {MODELS.map((m) => (
              <MenuItem key={m.name} active={m.name === settings.model} onClick={() => { close(); updateSettings({ model: m.name }); ping(`Modelo activo: ${m.name}`); }}>
                <Cpu className="size-4 shrink-0 text-primary" /><span className="truncate font-mono text-xs">{m.name}</span>
              </MenuItem>
            ))}
            <div className="my-1 h-px bg-border" />
            <MenuItem onClick={() => { close(); onNav("modelos"); }}><Settings className="size-4" />Gestionar modelos</MenuItem>
          </>
        )}
      </Menu>

      <Button variant="ghost" size="sm" className="hidden h-9 gap-2 text-muted-foreground xl:inline-flex" onClick={() => onNav("estado")}>
        <AudioWaveform className={`size-4 ${running ? "text-primary" : ""}`} />{running ? "Generando respuesta..." : "En reposo"}
      </Button>
      <div className="flex-1" />

      <Button size="sm" className="h-9 gap-1.5 rounded-lg" onClick={onRun}>
        {running ? <Square className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}{running ? "Detener" : "Ejecutar"}
      </Button>
      <Button variant="secondary" size="sm" className="hidden h-9 gap-1.5 rounded-lg sm:inline-flex" onClick={onDeploy}><Rocket className="size-4" /><span className="hidden md:inline">Deploy</span></Button>
      <Button variant="secondary" size="sm" className="hidden h-9 gap-1.5 rounded-lg sm:inline-flex" onClick={onShare}><Share2 className="size-4" /><span className="hidden md:inline">Compartir</span></Button>

      <Menu
        label="Más opciones del proyecto"
        align="end"
        trigger={({ toggle }) => (
          <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={toggle} aria-label="Más opciones"><MoreHorizontal className="size-5" /></Button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>{settings.project}</MenuLabel>
            <MenuItem onClick={() => { close(); onExport(); }}><Download className="size-4" />Exportar proyecto</MenuItem>
            <MenuItem onClick={() => { close(); void copyText(settings.project).then((ok) => ping(ok ? "Nombre copiado." : "No se pudo copiar.")); }}><Copy className="size-4" />Copiar nombre</MenuItem>
            <MenuItem onClick={() => { close(); onNav("configuracion"); }}><Settings className="size-4" />Ajustes del proyecto</MenuItem>
            <MenuItem onClick={() => { close(); onNav("workspace"); }}><Wrench className="size-4" />Entorno local</MenuItem>
            <div className="my-1 h-px bg-border" />
            <MenuItem danger onClick={() => { close(); onArchive(); }}><Trash2 className="size-4" />Archivar proyecto</MenuItem>
          </>
        )}
      </Menu>

      <NotificationBell enabled={settings.notify} onOpenSettings={() => onNav("configuracion")} />
      <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Cambiar tema">{dark ? <Sun className="size-5" /> : <Moon className="size-5" />}</Button>
      <button className="shrink-0 rounded-full" onClick={() => onNav("cuenta")} aria-label="Cuenta"><UserAvatar size={36} /></button>
    </header>
  );
}

function DeployModal({ project, files, ping, onClose }: { project: string; files: GeneratedFile[]; ping: (m: string) => void; onClose: () => void }) {
  const [target, setTarget] = useState("Servidor local (localhost:3000)");
  const [step, setStep] = useState<"form" | "building" | "done">("form");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const deploy = async () => {
    if (!files.length) { ping("No hay código generado todavía: pide algo en el chat."); return; }
    setStep("building");
    const result = await fileService.exportZip(project, files);
    if (!result.ok) { setStep("form"); ping(`⚠️ ${result.error}`); return; }
    setStep("done");
    ping(`«${project}» empaquetado (${result.data} archivos) para ${target}.`);
  };

  return (
    <div className="safe-modal fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="Desplegar proyecto" className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold">Desplegar «{project}»</h2>
            <p className="text-sm text-muted-foreground">La publicación se hace en tu propia máquina o en tu red local.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></Button>
        </div>

        {step !== "done" && (
          <>
            <label className="block text-xs font-semibold text-muted-foreground" htmlFor="deploy-target">Destino</label>
            <select id="deploy-target" value={target} onChange={(e) => setTarget(e.target.value)} className="mb-4 mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary">
              <option>Servidor local (localhost:3000)</option>
              <option>Equipo de la red (192.168.1.100)</option>
              <option>Carpeta estática en disco</option>
            </select>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button className="gap-2" onClick={deploy} disabled={step === "building"}><Rocket className="size-4" />{step === "building" ? "Publicando..." : "Publicar"}</Button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <p className="rounded-lg border border-border bg-background p-3 font-mono text-xs text-emerald-500">✓ Paquete ZIP con {files.length} archivo(s) descargado para publicar en {target}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStep("form")}>Publicar de nuevo</Button>
              <Button onClick={onClose}>Cerrar</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const NAV_VIEW: Record<string, View> = {
  Inicio: "inicio", "Súper IA": "superia", Autoconstrucción: "autoconstruccion", Proyectos: "proyectos", Chats: "chat", Workspace: "workspace",
  Agentes: "agentes", Modelos: "modelos", Herramientas: "herramientas", Historial: "historial",
  GitHub: "github", "Acceso directo": "instalacion", Demo: "demo", Licencias: "licencias",
  Lectura: "lectura", OCR: "ocr", "Mi yo en IA": "avatar", Traducir: "traducir",
  "Nuevas funciones": "extras", Libros: "libros",
};

function Sidebar({ open, onClose, view, onNav, onNewProject, onOpenProject, activeProject, collapsed, onToggle, projects, threadId, onOpenThread, onNewChat }: {
  open: boolean; onClose: () => void;
  view: View; onNav: (v: View) => void; onNewProject: () => void;
  onOpenProject: (name: string) => void; activeProject: string;
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
          {NAV.map(({ icon: Icon, label }) => (
            <button key={label} onClick={() => onNav(NAV_VIEW[label] ?? "chat")} title={label} aria-label={label} className={`flex size-9 items-center justify-center rounded-md ${view === (NAV_VIEW[label] ?? "chat") ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
              <Icon className="size-4" />
            </button>
          ))}
          <div className="mt-auto flex flex-col items-center gap-1">
            <button onClick={() => onNav("documentacion")} title="Documentación" aria-label="Documentación" className={`flex size-9 items-center justify-center rounded-md ${view === "documentacion" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}><BookOpen className="size-4" /></button>
            <button onClick={() => onNav("configuracion")} title="Configuración" aria-label="Configuración" className={`flex size-9 items-center justify-center rounded-md ${view === "configuracion" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}><Settings className="size-4" /></button>
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
        <div className="space-y-0.5">
          {NAV.map(({ icon: Icon, label, active }) => (
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
              <button key={p.id} onClick={() => onOpenProject(p.name)} className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${p.name === activeProject && view === "chat" ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
                <Icon className="size-4" /><span className="truncate">{p.name}</span>
              </button>
            );
          })}
          {projects.length === 0 && <p className="px-2.5 py-1 text-xs text-muted-foreground">Sin proyectos todavía.</p>}
        </div>
        <div className="mt-auto space-y-0.5 pt-4">
          <SideItem icon={BookOpen} label="Documentación" active={view === "documentacion"} onClick={() => onNav("documentacion")} />
          <SideItem icon={Settings} label="Configuración" active={view === "configuracion"} onClick={() => onNav("configuracion")} />
          <SideItem icon={Activity} label="Estado del sistema" active={view === "estado"} badge={<span className="size-2 rounded-full bg-emerald-500" />} onClick={() => onNav("estado")} />
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

function MobilePaneSwitch({ pane, setPane }: { pane: "chat" | "work"; setPane: (p: "chat" | "work") => void }) {
  return (
    <div className="z-10 flex shrink-0 items-center gap-1 border-b border-border bg-card p-1.5 lg:hidden">
      {(["chat", "work"] as const).map((p) => (
        <button key={p} onClick={() => setPane(p)} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold ${pane === p ? "bg-accent text-foreground" : "text-muted-foreground"}`}>
          {p === "chat" ? "Chat" : "Vista previa"}
        </button>
      ))}
    </div>
  );
}

type MsgItem = { who: "you" | "willy"; time: string; text: string; generating?: boolean; files?: { path: string; lang?: string; content: string }[]; download?: { name: string; url: string; size: number }; engine?: boolean };

// El dueño puede pedir el instalable dentro del propio chat.
const INSTALLER_ASK = /(instalador|instalable|setup\.exe|\.exe\b|nueva versi[oó]n|act?ualiz[aá](?:me|r|te)?)/i;

async function buildInstallerHere(): Promise<{ ok: true; name: string; url: string; size: number; version: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/build-installer", { method: "POST" });
    const data = (await res.json()) as { ok?: boolean; error?: string; name?: string; url?: string; size?: number; version?: string };
    if (!res.ok || !data.ok || !data.name || !data.url) return { ok: false, error: data.error ?? "No se pudo generar el instalador." };
    return { ok: true, name: data.name, url: data.url, size: data.size ?? 0, version: data.version ?? "" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function ChatPanel({ className, ping, collapsed, onCollapse, onExpand, settings, updateSettings, threadId, seed, onSeedUsed, onShowFiles, onShowChanges, files, onGenerated }: {
  className: string; ping: (m: string) => void; collapsed: boolean; onCollapse: () => void; onExpand: () => void;
  settings: WorkspaceSettings; updateSettings: (p: Partial<WorkspaceSettings>) => void;
  threadId: string;
  seed: string | null; onSeedUsed: () => void; onShowFiles: () => void; onShowChanges: () => void;
  files: GeneratedFile[]; onGenerated: (files: GeneratedFile[]) => void;
}) {
  const [messages, setMessages] = useState<MsgItem[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<{ name: string; size: number; file: File }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [chip, setChip] = useState<null | "ajustar" | "contexto" | "herramientas" | "modelo">(null);
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Cargar el chat guardado al abrir o al cambiar de conversación.
  useEffect(() => {
    const saved = loadThread(threadId);
    setMessages(saved ? saved.messages : []);
  }, [threadId]);

  // Guardar cada mensaje en el equipo: lo que hablas no se borra nunca.
  useEffect(() => {
    if (!messages.length) return;
    const timer = window.setTimeout(() => {
      saveThread(threadId, messages.map(({ who, time, text, files, download }) => ({ who, time, text, ...(files?.length ? { files: files.map((f) => ({ path: f.path, content: f.content })) } : {}), ...(download ? { download } : {}) })));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [messages, threadId]);

  // Si llega una semilla (proyecto nuevo creado), arranca la conversación con ella.
  useEffect(() => {
    if (!seed) return;
    const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    setMessages((m) => [
      ...m,
      { who: "you", time, text: seed },
      { who: "willy", time, text: "Perfecto. Voy a montar la estructura del proyecto en tu equipo con los agentes Analist y Programmer. Verás el avance en el plan y en la vista previa." },
    ]);
    onSeedUsed();
  }, [seed, onSeedUsed]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const addFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setAttachments((a) => [...a, ...files.map((f) => ({ name: f.name, size: f.size, file: f }))]);
    ping(files.length === 1 ? `Archivo «${files[0]!.name}» adjuntado.` : `${files.length} archivos adjuntados.`);
  };

  const updateLast = (fn: (m: MsgItem) => MsgItem) =>
    setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attachments.length) || busy) return;
    const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    const attachLines = attachments.map((f) => `📎 ${f.name} · ${formatBytes(f.size)}`).join("\n");
    const body = [text, attachLines].filter(Boolean).join("\n");
    const sent = text;
    const carried = attachments.slice();
    setDraft("");
    setAttachments([]);
    setMessages((m) => [...m, { who: "you", time, text: body }]);
    setBusy(true);
    setMessages((m) => [...m, { who: "willy", time, text: "", generating: true }]);
    // El botón de stop corta la generación en marcha sin borrar lo escrito.
    const controller = new AbortController();
    abortRef.current = controller;
    const stopped = () => controller.signal.aborted;

    // "Dame el instalador / actualízate": lo prepara aquí mismo y da un botón de descarga.
    if (INSTALLER_ASK.test(sent)) {
      const built = await buildInstallerHere();
      if (built.ok) {
        const mb = (built.size / (1024 * 1024)).toFixed(1);
        updateLast((m) => ({
          ...m,
          generating: false,
          download: { name: built.name, url: built.url, size: built.size },
          text: `✅ Listo. He generado el instalador de la versión ${built.version} (${mb} MB) en tu equipo. Pulsa «Descargar» aquí mismo, ejecuta el archivo y se instala solo: cierra la versión anterior, la sustituye y abre WILLY AI en localhost:3000 sin que tengas que hacer nada más.`,
        }));
      } else {
        updateLast((m) => ({ ...m, generating: false, text: `⚠️ No he podido generar el instalador en este momento. ${built.error}` }));
      }
      ping("Instalador preparado en el chat.");
      setBusy(false);
      return;
    }


    // Con el backend conectado, quien genera es el servidor (respuesta en directo).
    if (backendOn()) {
      const projects = await projectService.list();
      const target = projects.find((p) => p.name === settings.project) ?? projects[0];
      if (!target) {
        updateLast((m) => ({ ...m, generating: false, text: "Todavía no hay proyectos en el servidor. Crea uno con «Nuevo proyecto»." }));
        setBusy(false);
        return;
      }
      const conv = await chatService.open(target.id);
      if (!conv.ok) {
        updateLast((m) => ({ ...m, generating: false, text: `⚠️ No se pudo abrir la conversación en el servidor: ${conv.error}` }));
        ping("El servidor rechazó la conversación.");
        setBusy(false);
        return;
      }
      const result = await chatService.send({
        projectId: target.id,
        conversationId: conv.data.id,
        text: body,
        onDelta: (delta) => updateLast((m) => ({ ...m, text: m.text + delta })),
        signal: controller.signal,
      });
      if (!result.ok) {
        if (stopped()) {
          updateLast((m) => ({ ...m, generating: false, text: `${m.text.trimEnd()}\n\n⏹️ Generación detenida.` }));
          setBusy(false);
          return;
        }
        updateLast((m) => ({ ...m, generating: false, text: `⚠️ ${result.error}` }));
        ping("El servidor no pudo completar la tarea.");
        setBusy(false);
        return;
      }
      const made = extractFiles(result.data.text);
      if (made.length) onGenerated(made);
      updateLast((m) => ({
        ...m,
        generating: false,
        ...(made.length ? { files: made } : {}),
        text: made.length
          ? `${(m.text.trimEnd() || "Hecho.").trimEnd()}\n\n✅ ${made.length} archivo(s) generados: ${made.map((f) => f.path).join(", ")}. Descárgalos aquí o ábrelos en Archivos y la vista previa.`
          : m.text.trimEnd() || result.data.text || "Hecho. Revisa el resultado en la vista previa.",
      }));
      ping(made.length ? `${made.length} archivo(s) generados por el servidor.` : "Respuesta completada por el servidor.");
      // Los archivos reales del proyecto se recargan desde el servidor.
      void fetchProjectFiles(target.id).then((serverFiles) => {
        if (serverFiles.length) onGenerated(serverFiles);
      });
      setBusy(false);
      return;
    }

    // Motor local real (Ollama / Forge / LM Studio), sin conexiones externas.
    let streamed = false;
    try {
      const contextFiles = await Promise.all(
        carried
          .filter((f) => f.file.size < 200_000 && !f.file.type.startsWith("image/"))
          .slice(0, 4)
          .map(async (f) => `--- ${f.name} ---\n${(await f.file.text()).slice(0, 4000)}`),
      );
      const history: ChatMsg[] = messages.slice(-8).map((m) => ({
        role: m.who === "you" ? "user" : "assistant",
        content: m.text,
      }));
      const request = [sent || "Analiza los archivos adjuntos y propón los cambios.", ...contextFiles].join("\n\n");
      const aiMessages: ChatMsg[] = [
        {
          role: "system",
          content: `${ownerSystem()}\n\n${SYSTEM_PROMPT}\n\n${buildProjectContext({ project: settings.project, model: settings.model, agents: settings.agents, tools: settings.tools, files })}`,
        },
        ...history,
        { role: "user", content: request },
      ];
      const onAiDelta = (delta: string) => {
        streamed = true;
        updateLast((m) => ({ ...m, text: m.text + delta }));
      };
      const full = await chatLocalStream({
        endpoint: settings.endpoint,
        model: await resolveLocalModel(settings.endpoint, settings.model),
        messages: aiMessages,
        onDelta: onAiDelta,
        signal: controller.signal,
      });

      const made = extractFiles(full);
      if (made.length) {
        onGenerated(made);
        updateLast((m) => ({
          ...m,
          generating: false,
          files: made,
          text: `${m.text.trimEnd()}\n\n✅ ${made.length} archivo(s) generados. Descárgalos aquí mismo o ábrelos en Archivos, el editor de código y la vista previa.`,
        }));
        ping(`${made.length} archivo(s) generados con ${settings.model}.`);
      } else {
        updateLast((m) => ({ ...m, generating: false, text: m.text.trimEnd() || full }));
        ping("Respuesta completada con tu IA local.");
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (stopped()) {
        // Stop pulsado: se conserva lo ya escrito y se marca como detenido.
        updateLast((m) => ({ ...m, generating: false, text: `${m.text.trimEnd()}\n\n⏹️ Generación detenida.` }));
        ping("Generación detenida. Puedes seguir escribiendo cuando quieras.");
      } else if (streamed) {
        updateLast((m) => ({ ...m, generating: false, text: `${m.text.trimEnd()}\n\n⚠️ La conexión con la IA se ha interrumpido: ${detail}` }));
        ping("Conexión con la IA interrumpida.");
      } else {
        updateLast((m) => ({
          ...m,
          generating: false,
          engine: true,
          text: [
            "El motor de IA de tu equipo todavía no está en marcha, por eso no he podido contestar.",
            "",
            "Pulsa el botón de abajo: lo instalo, lo arranco y descargo el primer modelo por ti. No tienes que hacer nada más.",
            "",
            `Detalle técnico: ${detail}`,
          ].join("\n"),
        }));
        ping("El motor local no ha podido responder.");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
  };

  // Deja el motor de IA del equipo listo: lo instala, lo arranca y baja el primer modelo.
  const repairEngine = async () => {
    if (fixing) return;
    setFixing(true);
    ping("Preparando el motor de IA de tu equipo. Puede tardar unos minutos.");
    const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    try {
      const res = await fetch("/api/engine", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string; models?: string[]; pulling?: boolean; model?: string };
      if (!res.ok || !data.ok) {
        setMessages((m) => [...m, { who: "willy", time, text: `⚠️ ${data.error ?? "No he podido preparar el motor de IA."}`, engine: true }]);
      } else if (data.pulling) {
        setMessages((m) => [...m, { who: "willy", time, text: "✅ Motor de IA arrancado. Estoy descargando el primer modelo en segundo plano; en unos minutos podrás escribirme y te responderé." }]);
      } else {
        setMessages((m) => [...m, { who: "willy", time, text: `✅ Todo listo. El motor de IA está funcionando con «${data.model}». Escríbeme y te respondo.` }]);
      }
    } catch (error) {
      setMessages((m) => [...m, { who: "willy", time, text: `⚠️ No he podido preparar el motor: ${error instanceof Error ? error.message : String(error)}`, engine: true }]);
    } finally {
      setFixing(false);
    }
  };

  const exportChat = () => {
    const md = messages.map((m) => `**${m.who === "you" ? "Tú" : "WILLY AI"}** (${m.time})\n\n${m.text}`).join("\n\n---\n\n");
    downloadFile("conversacion-willy-ai.md", `# Conversación con WILLY AI\n\n${md}`, "text/markdown;charset=utf-8");
    ping("Conversación exportada a tu carpeta de descargas.");
  };

  const visible = searchQ.trim()
    ? messages.filter((m) => m.text.toLowerCase().includes(searchQ.trim().toLowerCase()))
    : messages;


  if (collapsed) {
    return (
      <section className={`${className} w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-background py-3`} aria-label="Chat plegado">
        <Button variant="ghost" size="icon" className="size-9" onClick={onExpand} aria-label="Mostrar chat"><PanelLeftOpen className="size-4" /></Button>
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground" style={{ writingMode: "vertical-rl" }}>Chat</span>
      </section>
    );
  }

  return (
    <section className={`${className} min-h-0 min-w-0 flex-1 flex-col border-r border-border bg-background`} aria-label="Chat con WILLY AI">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button variant="ghost" size="icon" className="hidden size-8 shrink-0 lg:inline-flex" onClick={onCollapse} aria-label="Plegar chat"><PanelLeftClose className="size-4" /></Button>
        <h2 className="flex-1 truncate text-sm font-semibold">Chat con WILLY AI</h2>
        <Button variant="ghost" size="icon" className={`size-8 ${searchOpen ? "text-primary" : ""}`} onClick={() => { setSearchOpen((v) => !v); setSearchQ(""); }} aria-label="Buscar en la conversación"><Search className="size-4" /></Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={exportChat} aria-label="Exportar conversación"><Upload className="size-4" /></Button>
        <Button variant="ghost" size="icon" className={`size-8 ${comparing ? "text-primary" : ""}`} onClick={() => { setComparing((v) => !v); ping(comparing ? "Comparación cerrada." : "Comparando con la versión anterior del proyecto."); }} aria-label="Comparar versiones"><ArrowLeftRight className="size-4" /></Button>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
          <Search className="size-3.5 text-muted-foreground" />
          <input autoFocus value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Buscar en los mensajes..." aria-label="Buscar en los mensajes" className="h-7 w-full bg-transparent text-sm outline-none" />
          {searchQ && <button onClick={() => setSearchQ("")} aria-label="Limpiar búsqueda"><X className="size-3.5 text-muted-foreground" /></button>}
        </div>
      )}
      {comparing && (
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <ArrowLeftRight className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">Comparando con la versión anterior: <span className="font-semibold text-foreground">12 archivos, +927 líneas</span></span>
          <button className="ml-auto shrink-0 font-semibold text-primary" onClick={() => { setComparing(false); onShowChanges(); }}>Ver cambios</button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {visible.map((m, i) => (
            <Msg key={`${m.time}-${i}`} who={m.who} time={m.time}>
              {m.text && <MessageBody text={m.text} onOpenFiles={onShowFiles} />}
              {m.download && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
                  <Download className="size-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">{m.download.name}</p>
                    <p className="text-[10px] text-muted-foreground">{(m.download.size / (1024 * 1024)).toFixed(1)} MB · instalable oficial de WILLY AI</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                    onClick={() => { window.location.href = m.download!.url; ping("Descargando instalador..."); }}
                    aria-label={`Descargar ${m.download.name}`}
                  >
                    <Download className="size-3.5" />Descargar
                  </Button>
                </div>
              )}
              {m.engine && (
                <div className="mt-2">
                  <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={fixing} onClick={() => void repairEngine()}>
                    {fixing ? "Preparando el motor..." : "Arrancar la IA de mi equipo"}
                  </Button>
                </div>
              )}
              {m.files?.length ? (
                <div className="mt-2 flex flex-col gap-1.5">
                  {m.files.map((f) => (
                    <div key={f.path} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
                      <FileCode2 className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{f.path}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{f.content.split("\n").length} líneas</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                        onClick={() => { downloadFile(f.path.split("/").pop() ?? f.path, f.content, "text/plain;charset=utf-8"); ping(`«${f.path}» descargado.`); }}
                        aria-label={`Descargar ${f.path}`}
                      >
                        <Download className="size-3.5" />Descargar
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              {m.generating && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="size-2 animate-pulse rounded-full bg-primary" />
                  Generando con {settings.model} en tu equipo...
                </p>
              )}
            </Msg>
          ))}
          {searchQ && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">Ningún mensaje coincide con «{searchQ}».</p>
          )}
          {!searchQ && visible.length === 0 && (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Pide lo que necesites y WILLY lo hará. Nada más: no habla si no le preguntas. Todo lo que escribas se guarda automáticamente en «Recientes», así no se pierde nunca.
            </p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="safe-modal shrink-0 border-t border-border bg-card p-2.5 sm:p-3">
        <div className="mx-auto max-w-2xl">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((f, i) => (
                <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                  <Paperclip className="size-3 text-primary" />
                  <span className="max-w-40 truncate font-medium text-foreground">{f.name}</span>
                  <span className="shrink-0">{formatBytes(f.size)}</span>
                  <button onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))} aria-label={`Quitar ${f.name}`} className="rounded-full hover:text-foreground"><X className="size-3.5" /></button>
                </span>
              ))}
            </div>
          )}
          <div
            className={`flex items-center gap-2 rounded-lg border bg-background px-3 py-2 ${dragging ? "border-primary ring-2 ring-primary/30" : "border-input"}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          >
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} aria-hidden="true" />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="Escribe un mensaje o arrastra archivos..." className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Mensaje para WILLY AI" />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => fileRef.current?.click()} aria-label="Adjuntar"><Paperclip className="size-4" /></Button>
            {busy && (
              <Button variant="outline" size="icon" className="size-8 shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10" onClick={stopGeneration} aria-label="Detener la IA" title="Detener la IA"><Square className="size-4" /></Button>
            )}
            <Button size="icon" className="size-8 shrink-0 rounded-full" onClick={() => void send()} disabled={busy || (!draft.trim() && !attachments.length)} aria-label="Enviar"><ArrowUp className="size-4" /></Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Menu up label="Ajustar la respuesta" trigger={({ toggle }) => <Chip icon={Plus} label="Ajustar" onClick={toggle} />}>
              {(close) => (
                <>
                  <MenuLabel>Peticiones rápidas</MenuLabel>
                  {["Haz la respuesta más breve y directa.", "Explica el plan paso a paso con más detalle.", "Añade pruebas automáticas a lo que generes."].map((t) => (
                    <MenuItem key={t} onClick={() => { close(); setDraft(t); }}>{t}</MenuItem>
                  ))}
                </>
              )}
            </Menu>
            <Menu up label="Contexto del proyecto" trigger={({ toggle }) => <Chip icon={MessageSquare} label="Contexto" onClick={toggle} />}>
              {(close) => (
                <>
                  <MenuLabel>Contexto actual</MenuLabel>
                  <MenuItem onClick={() => { close(); ping(`Contexto: proyecto «${settings.project}» con ${files.length || FILES.length} archivos.`); }}><FolderKanban className="size-4" /><span className="truncate">{settings.project} · {files.length || FILES.length} archivos</span></MenuItem>
                  <MenuItem onClick={() => { close(); ping(`Modelo en contexto: ${settings.model}`); }}><Cpu className="size-4" /><span className="truncate font-mono text-xs">{settings.model}</span></MenuItem>
                  <MenuItem onClick={() => { close(); ping(`${settings.agents.length} agentes activos: ${settings.agents.join(", ")}.`); }}><Bot className="size-4" />{settings.agents.length} agentes activos</MenuItem>
                  <MenuItem onClick={() => { close(); ping("Adjunta archivos con el clip o arrastrándolos al mensaje."); }}><Paperclip className="size-4" />Añadir archivos al contexto</MenuItem>
                </>
              )}
            </Menu>
            <Menu up label="Herramientas disponibles" trigger={({ toggle }) => <Chip icon={Wrench} label="Herramientas" onClick={toggle} />}>
              {(close) => (
                <>
                  <MenuLabel>Herramientas del equipo</MenuLabel>
                  {TOOLS.map((t) => (
                    <MenuItem
                      key={t.name}
                      active={settings.tools.includes(t.name)}
                      onClick={() => { const on = settings.tools.includes(t.name); updateSettings({ tools: on ? settings.tools.filter((n) => n !== t.name) : [...settings.tools, t.name] }); ping(`${t.name}: ${on ? "desactivada" : "activada"}.`); }}
                    >
                      <t.icon className="size-4" />{t.name}
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>
            <Menu up label="Elegir modelo local" trigger={({ toggle }) => <Chip icon={Cpu} label={settings.model.split(":")[0] ?? "Olama"} chevron onClick={toggle} />}>
              {(close) => (
                <>
                  <MenuLabel>Modelos locales</MenuLabel>
                  {MODELS.map((m) => (
                    <MenuItem key={m.name} active={m.name === settings.model} onClick={() => { close(); updateSettings({ model: m.name }); ping(`Modelo activo: ${m.name}`); }}>
                      <Cpu className="size-4" /><span className="truncate font-mono text-xs">{m.name}</span>
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>
          </div>
        </div>
      </div>
    </section>
  );
}

function Chip({ icon: Icon, label, chevron, onClick }: { icon: typeof Plus; label: string; chevron?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground">
      <Icon className="size-3.5" />{label}{chevron && <ChevronDown className="size-3" />}
    </button>
  );
}

function Msg({ who, time, children }: { who: "you" | "willy"; time: string; children: ReactNode }) {
  return (
    <article>
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${who === "you" ? "bg-primary text-primary-foreground" : "bg-accent text-primary"}`}>
          {who === "you" ? "TÚ" : <Bot className="size-4" />}
        </span>
        <span className="text-xs font-semibold">{who === "you" ? "Tú" : "WILLY AI"}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{time}</span>
      </div>
      <div className="pl-9">{children}</div>
    </article>
  );
}

/** Mensaje de WILLY: texto normal y bloques de código como tarjetas compactas (el código vive en el editor). */
function MessageBody({ text, onOpenFiles }: { text: string; onOpenFiles: () => void }) {
  const re = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(<PlainLines key={`t${k++}`} lines={text.slice(last, m.index)} />);
    const path = (m[1] ?? "").trim().match(/([\w./@-]+\.[A-Za-z0-9]+)/)?.[1];
    if (path) {
      const lines = (m[2] ?? "").split("\n").length;
      nodes.push(
        <button key={`c${k++}`} onClick={onOpenFiles} className="mt-2 flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent/50">
          <FileCode2 className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{lines} líneas · ver en el editor</span>
        </button>,
      );
    } else {
      nodes.push(<PlainLines key={`c${k++}`} lines={m[0]} />);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<PlainLines key={`t${k++}`} lines={text.slice(last)} />);
  return <>{nodes}</>;
}

function PlainLines({ lines }: { lines: string }) {
  return (
    <>
      {lines.split("\n").map((line, j) => (
        <p key={j} className={`text-sm leading-6 ${line.startsWith("✅") ? "font-semibold text-emerald-500" : line.startsWith("⚠️") || line.startsWith("(") ? "text-muted-foreground" : ""}`}>
          {line || "\u00A0"}
        </p>
      ))}
    </>
  );
}

type Design = { id: number; name: string };

function blankDesignHtml(name: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>*,*::before,*::after{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f7fb;color:#0f172a;display:grid;place-items:center;min-height:100vh;padding:clamp(16px,5vw,40px)}
.card{width:min(100%,560px);margin-inline:auto;text-align:center;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:clamp(24px,6vw,40px);box-shadow:0 18px 40px rgba(15,23,42,.08)}
h1{margin:0 0 10px;font-size:clamp(20px,4.5vw,26px);line-height:1.2;overflow-wrap:anywhere}
p{margin:0 auto;max-width:44ch;color:#475569;line-height:1.6;font-size:clamp(13px,3.4vw,14px)}
.tag{display:inline-block;margin-bottom:16px;padding:5px 12px;border-radius:999px;background:#eef2ff;color:#4338ca;font-size:11px;font-weight:700;letter-spacing:.04em}
img,svg{max-width:100%;height:auto}</style></head>
<body><div class="card"><span class="tag">NUEVO DISEÑO COMPLETO</span><h1>${name}</h1><p>Lienzo vacío listo para generar. Escribe en el chat lo que quieres construir y WILLY AI creará esta pantalla con tu modelo local: responsive, simétrica y con todos los botones funcionando.</p></div></body></html>`;
}

/** Garantiza que cualquier HTML mostrado en la vista previa sea fluido y esté centrado. */
const RESPONSIVE_GUARD = `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>*,*::before,*::after{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden}
img,video,svg,canvas,iframe,table{max-width:100%;height:auto}
pre,code{white-space:pre-wrap;overflow-wrap:anywhere}</style>`;

function withResponsiveGuard(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${RESPONSIVE_GUARD}`);
  return `${RESPONSIVE_GUARD}${html}`;
}

function WorkPanel({ className, tab, setTab, device, setDevice, ping, chatCollapsed, onExpandChat, running, files }: {
  className: string; tab: Tab; setTab: (t: Tab) => void; device: Device; setDevice: (d: Device) => void;
  ping: (m: string) => void; chatCollapsed: boolean; onExpandChat: () => void; running: boolean; files: GeneratedFile[];
}) {
  const [designs, setDesigns] = useState<Design[]>([{ id: 1, name: "ClientPro" }]);
  const [activeDesign, setActiveDesign] = useState(1);
  const [codeOpen, setCodeOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const nextId = useRef(2);
  const [history, setHistory] = useState<number[]>([1]);
  const [histPos, setHistPos] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const goto = (id: number) => {
    setActiveDesign(id);
    setHistory((h) => [...h.slice(0, histPos + 1), id]);
    setHistPos((p) => p + 1);
  };
  const back = () => {
    if (histPos === 0) { ping("Sin historial atrás."); return; }
    const pos = histPos - 1;
    setHistPos(pos);
    setActiveDesign(history[pos]!);
  };
  const forward = () => {
    if (histPos >= history.length - 1) { ping("Sin historial adelante."); return; }
    const pos = histPos + 1;
    setHistPos(pos);
    setActiveDesign(history[pos]!);
  };
  const fullscreen = () => {
    const el = previewRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => ping("Tu navegador no permite pantalla completa aquí."));
  };

  const width = device === "desktop" ? "100%" : device === "tablet" ? "768px" : "390px";
  const current = designs.find((d) => d.id === activeDesign) ?? designs[0]!;
  const genHtml = files.find((f) => f.path.endsWith(".html"));
  const doc = withResponsiveGuard(current.id === 1 ? (genHtml?.content ?? clientProHtml) : blankDesignHtml(current.name));
  const fileList = files.length
    ? files.map((f) => ({ path: f.path, delta: `+${f.content.split("\n").length}` }))
    : FILES.map(([f, n]) => ({ path: f, delta: n }));

  const addDesign = () => {
    const id = nextId.current++;
    setDesigns((d) => [...d, { id, name: `Diseño ${id}` }]);
    goto(id);
    setTab("preview");
    ping(`Sub-pestaña «Diseño ${id}» creada para un diseño completo nuevo.`);
  };

  const closeDesign = (id: number) => {
    if (designs.length === 1) { ping("Debe quedar al menos un diseño abierto."); return; }
    const rest = designs.filter((d) => d.id !== id);
    setDesigns(rest);
    if (activeDesign === id) {
      setActiveDesign(rest[0]!.id);
      setHistory([rest[0]!.id]);
      setHistPos(0);
    }
    ping("Sub-pestaña cerrada.");
  };

  return (
    <section className={`${className} min-h-0 min-w-0 flex-1 flex-col bg-panel`} aria-label="Espacio de trabajo">
      <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-2">
        {chatCollapsed && (
          <Button variant="ghost" size="icon" className="hidden size-8 shrink-0 lg:inline-flex" onClick={onExpandChat} aria-label="Mostrar chat"><PanelLeftOpen className="size-4" /></Button>
        )}
        <TabBtn on={tab === "preview"} onClick={() => setTab("preview")} icon={Monitor} label="Vista previa" />
        <TabBtn on={codeOpen} onClick={() => { setCodeOpen((v) => !v); ping(codeOpen ? "Panel de código cerrado." : "Código y terminal abiertos abajo."); }} icon={Code2} label="Código" />
        <TabBtn on={tab === "files"} onClick={() => setTab("files")} icon={FolderKanban} label="Archivos" />
        <TabBtn on={tab === "changes"} onClick={() => setTab("changes")} icon={ArrowLeftRight} label="Cambios" />
        <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={addDesign} aria-label="Nuevo diseño completo"><Plus className="size-4" /></Button>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card/60 px-2">
        {designs.map((d) => (
          <span key={d.id} className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold ${d.id === activeDesign ? "bg-accent text-foreground" : "text-muted-foreground"}`}>
            <button onClick={() => goto(d.id)}>{d.name}</button>
            <button onClick={() => closeDesign(d.id)} aria-label={`Cerrar ${d.name}`}><X className="size-3 hover:text-foreground" /></button>
          </span>
        ))}
        <button onClick={addDesign} className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-accent">+ Nuevo diseño</button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "preview" && (
          <>
            <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-2">
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={back} disabled={histPos === 0} aria-label="Atrás"><ArrowLeft className="size-4" /></Button>
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={forward} disabled={histPos >= history.length - 1} aria-label="Adelante"><ArrowRight className="size-4" /></Button>
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => { setReloadKey((k) => k + 1); ping("Vista previa recargada."); }} aria-label="Recargar"><RotateCw className="size-4" /></Button>
              <div className="mx-1 hidden h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs text-muted-foreground sm:flex">
                <span className="truncate">http://localhost:3000/{current.name.toLowerCase().replace(/\s+/g, "-")}</span>
                {running && <span className="ml-auto flex shrink-0 items-center gap-1.5 text-primary"><span className="size-1.5 animate-pulse rounded-full bg-primary" />generando…</span>}
              </div>
              <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
                {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([d, Icon]) => (
                  <button key={d} onClick={() => setDevice(d)} aria-label={`Vista ${d}`} className={`flex size-7 items-center justify-center rounded ${device === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}><Icon className="size-3.5" /></button>
                ))}
              </div>
              <Button variant="ghost" size="sm" className={`h-8 shrink-0 gap-1.5 text-xs ${selectMode ? "text-primary" : ""}`} onClick={() => { setSelectMode((v) => !v); setSelected(null); ping(selectMode ? "Modo selección desactivado." : `Modo selección activo en «${current.name}»: toca un elemento para marcarlo.`); }}><MousePointer2 className="size-3.5" /><span className="hidden xl:inline">Seleccionar elemento</span></Button>
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={fullscreen} aria-label="Pantalla completa"><Maximize2 className="size-4" /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-accent/40 p-2 sm:p-3">
              <div ref={previewRef} className="relative mx-auto h-full overflow-hidden rounded-lg border border-border bg-white shadow-lg transition-all" style={{ width, maxWidth: "100%" }}>
                <iframe key={`${current.id}-${reloadKey}`} title={`Vista previa de ${current.name}`} srcDoc={doc} className="size-full" sandbox="allow-scripts" />
                {selectMode && (
                  <button
                    aria-label="Seleccionar elemento de la vista previa"
                    className="absolute inset-0 z-10 cursor-crosshair"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = Math.round(e.clientX - rect.left);
                      const y = Math.round(e.clientY - rect.top);
                      setSelected(`x:${x} y:${y}`);
                      setSelectMode(false);
                      ping(`Elemento marcado en «${current.name}» (x:${x}, y:${y}). Pídeme en el chat qué quieres cambiar ahí.`);
                    }}
                  />
                )}
              </div>
              {selected && <p className="pt-1.5 text-center text-[11px] text-muted-foreground">Elemento seleccionado en {current.name}: {selected}</p>}
            </div>
          </>
        )}

        {tab === "files" && (
          <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
            <p className="text-sm font-semibold">Archivos del proyecto <span className="text-muted-foreground">({fileList.length})</span></p>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
              {fileList.map((f) => (
                <li key={f.path}>
                  <button onClick={() => { setCodeOpen(true); ping(`${f.path} abierto en el editor de abajo.`); }} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent/50">
                    <span className="flex min-w-0 items-center gap-2 font-mono text-xs"><FileCode2 className="size-3.5 shrink-0 text-primary" /><span className="truncate">{f.path}</span></span>
                    <span className="shrink-0 font-mono text-xs text-emerald-500">{f.delta}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "changes" && (
          <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
            <p className="text-sm font-semibold">Cambios de esta versión</p>
            <ul className="mt-3 space-y-2">
              {fileList.slice(0, 5).map((f) => (
                <li key={f.path}>
                  <button onClick={() => { setCodeOpen(true); ping(`Diferencias de ${f.path} en el editor de abajo.`); }} className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent/50">
                    <FilePlus2 className="size-4 shrink-0 text-emerald-500" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
                    <span className="shrink-0 font-mono text-xs text-emerald-500">{f.delta}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              {files.length
                ? `${files.length} archivo(s) generados por tu modelo local · ${files.reduce((n, f) => n + f.content.split("\n").length, 0)} líneas · 0 eliminadas.`
                : "12 archivos creados o modificados · 927 líneas añadidas · 0 eliminadas."}
            </p>
          </div>
        )}
      </div>

      {codeOpen && <BottomPanel ping={ping} onClose={() => setCodeOpen(false)} files={files} />}
    </section>
  );
}

function TabBtn({ on, onClick, icon: Icon, label }: { on: boolean; onClick: () => void; icon: typeof Monitor; label: string }) {
  return (
    <button onClick={onClick} className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${on ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
      <Icon className="size-3.5" />{label}
    </button>
  );
}

function BottomPanel({ ping, onClose, files }: { ping: (m: string) => void; onClose: () => void; files: GeneratedFile[] }) {
  const [tabs, setTabs] = useState<string[]>(files.length ? files.map((f) => f.path) : ["Dashboard.tsx"]);
  const [active, setActive] = useState(files.length ? files[0]!.path : "Dashboard.tsx");
  const [tall, setTall] = useState(false);
  const [terminal, setTerminal] = useState(true);
  const nextFile = useRef(1);

  useEffect(() => {
    setTabs((t) => {
      const missing = files.map((f) => f.path).filter((p) => !t.includes(p));
      return missing.length ? [...t, ...missing] : t;
    });
  }, [files]);

  const addTab = () => {
    const name = `Nuevo${nextFile.current++}.tsx`;
    setTabs((t) => [...t, name]);
    setActive(name);
    ping(`Archivo ${name} añadido al editor.`);
  };
  const closeTab = (name: string) => {
    if (tabs.length === 1) { onClose(); return; }
    const rest = tabs.filter((t) => t !== name);
    setTabs(rest);
    if (active === name) setActive(rest[0]!);
  };

  return (
    <div className={`grid shrink-0 grid-cols-1 divide-y divide-border border-t border-border ${tall ? "h-[60vh]" : "h-56 md:h-52"} ${terminal ? "md:grid-cols-2 md:divide-x md:divide-y-0" : ""}`}>
      <div className="flex min-h-0 min-w-0 flex-col bg-[oklch(0.17_0.02_265)]">
        <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 text-[11px] text-muted-foreground">
          {tabs.map((t) => (
            <span key={t} className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 ${active === t ? "bg-white/10 text-foreground" : ""}`}>
              <button onClick={() => setActive(t)}>{t}</button>
              <button onClick={() => closeTab(t)} aria-label={`Cerrar ${t}`}><X className="size-3" /></button>
            </span>
          ))}
          <button onClick={addTab} aria-label="Nuevo archivo"><Plus className="size-3.5" /></button>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <button onClick={() => { setTerminal((v) => !v); ping(terminal ? "Terminal oculta." : "Terminal visible."); }} aria-label="Mostrar u ocultar terminal"><MoreHorizontal className="size-3.5" /></button>
            <button onClick={() => setTall((v) => !v)} aria-label="Ampliar o reducir el panel">{tall ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</button>
            <button onClick={onClose} aria-label="Cerrar panel de código"><X className="size-3.5" /></button>
          </span>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[10px] leading-4 text-foreground/85"><code>{files.find((f) => f.path === active)?.content ?? (active === "Dashboard.tsx" ? CODE : `// ${active}\nexport default function Nuevo() {\n  return <div>Componente generado por WILLY AI</div>;\n}`)}</code></pre>
      </div>
      {terminal && (
        <div className="flex min-h-0 min-w-0 flex-col bg-[oklch(0.17_0.02_265)]">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2 text-[11px]">
            <TerminalIcon className="size-3.5 text-muted-foreground" /><span className="text-foreground">Terminal</span>
            <button className="ml-auto" onClick={() => setTerminal(false)} aria-label="Cerrar terminal"><X className="size-3.5 text-muted-foreground" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[10px] leading-4 sm:text-[11px] sm:leading-5">
            <p className="text-foreground/90">&gt; npm run dev</p>
            <p className="mt-1 text-emerald-400">VITE v5.0.0  ready in 432 ms</p>
            <p className="mt-1 text-foreground/70">  ➜  Local:   <span className="text-sky-400">http://localhost:3000/</span></p>
            <p className="text-foreground/70">  ➜  Network: <span className="text-sky-400">http://192.168.1.100:3000/</span></p>
            <p className="text-foreground/70">  ➜  press h to show help</p>
            <p className="mt-2 text-emerald-400">✓ Compiled successfully</p>
            <p className="text-sky-400">✓ page reload  src/pages/Dashboard.tsx</p>
          </div>
        </div>
      )}
    </div>
  );
}

function TerminalIcon({ className }: { className: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M4 17l6-5-6-5M12 19h8" /></svg>;
}

function PanelsTop({ className }: { className: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>;
}

function PanelsTopLeft({ className }: { className: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16"/></svg>;
}

function Braces({ className }: { className: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/></svg>;
}

function AudioWaveform({ className }: { className: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 9v6M22 12h-2" /></svg>;
}

function LogoMark() {
  return <span className="font-display text-xl font-bold leading-none text-brand-gradient" aria-hidden="true">W</span>;
}
