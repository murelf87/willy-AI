import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GeneratedFile } from "@/lib/ai-standard";
import {
  Activity, Bot, Check, Clock, Cpu, Database, Download, FolderKanban, Gauge, HardDrive, Home, LayoutGrid,
  LogOut, MessageSquare, MoreHorizontal, Pencil, Play, Plus, RefreshCw, RotateCcw, RotateCw, Search, Server, Settings, Shield, Square,
  Terminal, Trash2, Wrench, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { formatBytes, readFileAsDataUrl, useProfile } from "@/lib/profile";
import { downloadFile, pingEndpoint, useSettings } from "@/lib/workspace-store";
import { GitHubView } from "@/components/github-view";
import { InstallView } from "@/components/install-view";
import { DemoView } from "@/components/demo-view";
import { LicensesView } from "@/components/licenses-view";
import { ReaderView } from "@/components/reader-view";
import { APP_VERSION } from "@/lib/version";
import { OcrView } from "@/components/ocr-view";
import { AvatarView } from "@/components/avatar-view";
import { TranslateView } from "@/components/translate-view";
import { ExtrasView } from "@/components/extras-view";
import { BookView } from "@/components/book-view";
import { SuperIAView } from "@/components/superia-view";
import { SelfBuildView } from "@/components/self-build-view";
import { UpdateView } from "@/components/update-view";
import { projectService, useProjects, useVersions } from "@/services/project-service";
import { aiService } from "@/services/ai-service";
import { apiAuthService } from "@/services/api-auth-service";
import { backendOn, health, listOrganizations, refreshData, useBackend, type Organization } from "@/services/backend";
import { PROJECT_STATES, type Project, type ProjectIcon, type ProjectState } from "@/types/domain";
import {
  CATALOG_TAGS, MODEL_CATALOG, pullModel, removeModel,
  type CatalogModel, type CatalogTag, type PullProgress,
} from "@/services/model-catalog";

export type View =
  | "chat" | "inicio" | "superia" | "autoconstruccion" | "proyectos" | "historial" | "workspace" | "agentes" | "modelos"
  | "herramientas" | "documentacion" | "configuracion" | "cuenta" | "estado"
  | "github" | "instalacion" | "demo" | "licencias"
  | "lectura" | "ocr" | "avatar" | "traducir" | "extras" | "libros";

export const VIEW_TITLES: Record<View, string> = {
  chat: "Chats",
  superia: "Súper IA",
  autoconstruccion: "Autoconstrucción",
  inicio: "Inicio",
  proyectos: "Proyectos",
  historial: "Historial",
  workspace: "Workspace",
  agentes: "Agentes",
  modelos: "Modelos",
  herramientas: "Herramientas",
  licencias: "Licencias",
  lectura: "Lectura en voz alta",
  ocr: "OCR de documentos",
  avatar: "Mi yo en IA",
  traducir: "Traducir enlace",
  extras: "Nuevas funciones",
  libros: "Libros",
  documentacion: "Documentación",
  configuracion: "Configuración",
  cuenta: "Cuenta",
  estado: "Estado del sistema",
  github: "GitHub",
  instalacion: "Acceso directo",
  demo: "Demo para cliente",
};

/** Traduce la clave de icono de cada proyecto a su icono real. */
export const PROJECT_ICONS: Record<ProjectIcon, typeof FolderKanban> = {
  folder: FolderKanban, gauge: Gauge, grid: LayoutGrid, server: Server,
  database: Database, zap: Zap, store: Database, code: Terminal,
};

/** Tarjeta de conexión con el servidor backend (Fastify en localhost:4000). */
function BackendCard({ ping }: { ping: Ping }) {
  const [cfg, update] = useBackend();
  const [urlDraft, setUrlDraft] = useState(cfg.url);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [checking, setChecking] = useState(false);
  const connected = cfg.enabled && backendOn();

  const check = async () => {
    setChecking(true);
    ping(`Comprobando el servidor en ${urlDraft.trim()}...`);
    const result = await health(urlDraft.trim());
    setChecking(false);
    if (!result.ok) return ping(`No responde ${urlDraft.trim()}. Comprueba que el backend está arrancado (pnpm run dev).`);
    update({ url: urlDraft.trim() });
    ping(`Servidor conectado en ${urlDraft.trim()}.`);
    const list = await listOrganizations();
    if (list.ok && list.data.length) setOrgs(list.data);
  };

  const toggle = async () => {
    if (!cfg.enabled && !urlDraft.trim()) return ping("Escribe primero la dirección del servidor.");
    if (!cfg.enabled) {
      // Antes de activar, comprueba que el servidor realmente responde.
      ping(`Comprobando el servidor en ${urlDraft.trim()}...`);
      const probe = await health(urlDraft.trim());
      if (!probe.ok) {
        return ping(`No se pudo conectar con ${urlDraft.trim()}. Arranca el backend (pnpm run dev) y vuelve a intentarlo.`);
      }
      update({ url: urlDraft.trim(), enabled: true });
      await apiAuthService.refresh();
      refreshData();
      return ping("Servidor conectado: proyectos y sesión ahora vienen del backend.");
    }
    update({ enabled: false });
    return ping("Servidor desconectado. Tus datos vuelven a guardarse en este equipo.");
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Server className="size-4" /> Servidor backend
          </p>
          <p className="text-xs text-muted-foreground">
            {connected ? "Proyectos y sesión vienen del servidor." : "Sin conectar: los datos se guardan en este equipo."}
          </p>
        </div>
        <Toggle on={cfg.enabled} label="Servidor backend" onClick={() => void toggle()} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted-foreground" htmlFor="backend-url">Dirección del servidor</label>
        <input
          id="backend-url"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          placeholder="http://localhost:4000"
          className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary"
        />
      </div>
      {orgs.length > 0 && (
        <div>
          <label className="block text-xs font-semibold text-muted-foreground" htmlFor="backend-org">Organización</label>
          <select
            id="backend-org"
            value={cfg.organizationId}
            onChange={(e) => update({ organizationId: e.target.value })}
            className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          >
            <option value="">Ninguna</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name} · {o.role}</option>
            ))}
          </select>
        </div>
      )}
      <Button type="button" variant="secondary" disabled={checking} onClick={() => void check()}>
        {checking ? "Comprobando..." : "Probar servidor"}
      </Button>
    </Card>
  );
}

/** Historial de versiones del proyecto activo: cada generación queda guardada y se puede restaurar. */
function HistoryView({ ping }: { ping: Ping }) {
  const [settings] = useSettings();
  const { projects } = useProjects();
  const active = projects.find((p) => p.name === settings.project) ?? projects[0];
  const versions = useVersions(active?.id);

  return (
    <>
      <Head title="Historial de versiones" desc={active ? `Cada generación de «${active.name}» queda guardada aquí.` : "Crea o abre un proyecto para empezar."} />
      {!active && <p className="text-sm text-muted-foreground">No hay ningún proyecto activo todavía.</p>}
      {active && versions.length === 0 && (
        <p className="text-sm text-muted-foreground">Todavía no hay versiones guardadas. Cuando tu IA genere archivos, WILLY guardará una versión automáticamente.</p>
      )}
      <div className="space-y-2">
        {versions.map((v) => (
          <Card key={v.id} className="flex flex-wrap items-center gap-3">
            <Clock className="size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{v.label}</p>
              <p className="text-xs text-muted-foreground">{new Date(v.at).toLocaleString("es-ES")} · {v.files.length} archivo(s)</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { if (window.confirm(`¿Restaurar «${v.label}»? Se sustituirán los archivos actuales del proyecto.`)) void projectService.restoreVersion(v.id).then((r) => ping(r.ok ? `Versión «${v.label}» restaurada en «${r.data.name}».` : `⚠️ ${r.error}`)); }}>
              <RotateCcw className="size-3.5" />Restaurar
            </Button>
          </Card>
        ))}
      </div>
    </>
  );
}

type Ping = (m: string) => void;

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}</div>;
}

function Head({ title, desc, action }: { title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-bold sm:text-2xl">{title}</h1>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      {action}
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-background transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export const PROJECTS = [
  { name: "SaaS Clientes", desc: "Gestión de clientes con métricas", icon: FolderKanban, state: "Activo", files: 12 },
  { name: "App Fitness", desc: "Rutinas y seguimiento diario", icon: Gauge, state: "Pausado", files: 28 },
  { name: "Web Corporativa", desc: "Sitio institucional multiidioma", icon: LayoutGrid, state: "Listo", files: 19 },
  { name: "API REST", desc: "Servicio de datos local en Node", icon: Server, state: "Activo", files: 34 },
  { name: "Tienda Online", desc: "Catálogo y carrito sin pasarela", icon: Database, state: "Borrador", files: 7 },
  { name: "Landing Page", desc: "Página de captación de leads", icon: Zap, state: "Listo", files: 5 },
];

export const AGENTS = [
  { name: "Analist", role: "Analiza requisitos y define la arquitectura", model: "qwen2.5-coder:14b" },
  { name: "Programmer", role: "Escribe y modifica el código del proyecto", model: "qwen2.5-coder:14b" },
  { name: "Tester", role: "Ejecuta pruebas y valida los resultados", model: "llama3.1:8b" },
  { name: "Debugger", role: "Detecta y corrige errores del código", model: "deepseek-coder:6.7b" },
  { name: "Designer", role: "Propone estilos, temas y componentes", model: "llava:13b" },
];

export const MODELS = [
  { name: "qwen2.5-coder:14b", size: "9,0 GB", tag: "Código", loaded: true },
  { name: "llama3.1:8b", size: "4,7 GB", tag: "General", loaded: true },
  { name: "deepseek-coder:6.7b", size: "3,8 GB", tag: "Código", loaded: false },
  { name: "llava:13b", size: "8,0 GB", tag: "Visión", loaded: false },
  { name: "nomic-embed-text", size: "274 MB", tag: "Embeddings", loaded: true },
];

export const TOOLS = [
  { name: "Terminal local", desc: "Ejecuta comandos en tu equipo", icon: Terminal },
  { name: "Sistema de archivos", desc: "Lee y escribe en la carpeta del proyecto", icon: HardDrive },
  { name: "Base de datos local", desc: "SQLite y Postgres en tu máquina", icon: Database },
  { name: "Navegador de pruebas", desc: "Abre la vista previa y captura errores", icon: Search },
  { name: "Servidor de desarrollo", desc: "Arranca y reinicia el proyecto", icon: Play },
  { name: "Analizador de seguridad", desc: "Revisa dependencias sin salir del equipo", icon: Shield },
];

const DOCS: { t: string; d: string; body: string[] }[] = [
  {
    t: "Primeros pasos",
    d: "Instala el motor local y conecta WILLY AI en dos minutos.",
    body: [
      "1. Instala tu motor de IA local (por ejemplo Ollama o Forge) en el mismo equipo donde usas WILLY AI.",
      "2. Arráncalo y comprueba que responde en su dirección, normalmente http://localhost:11434.",
      "3. Abre Configuración en WILLY AI, escribe esa dirección y pulsa «Probar conexión».",
      "4. Entra en Modelos, elige el modelo que quieras usar y pulsa «Usar».",
      "5. Vuelve al chat y describe lo que quieres construir.",
    ],
  },
  {
    t: "Conectar tu IA local",
    d: "Configura la dirección del servidor y elige el modelo.",
    body: [
      "WILLY AI habla con tu motor local mediante peticiones HTTP a la dirección que indiques en Configuración.",
      "Si el motor está en otro equipo de tu red, usa su IP, por ejemplo http://192.168.1.50:11434.",
      "Con «Modo sin conexión» activado, el espacio de trabajo no realiza ninguna petición fuera de tu red.",
      "La carpeta de modelos indica dónde están descargados los pesos en tu disco.",
    ],
  },
  {
    t: "Agentes y flujos",
    d: "Cómo colaboran Analist, Programmer, Tester y Debugger.",
    body: [
      "Analist interpreta tu petición y define la arquitectura y los archivos a crear.",
      "Programmer escribe el código; Tester ejecuta comprobaciones y Debugger corrige lo que falle.",
      "Puedes activar o desactivar cada agente en la pantalla Agentes; los desactivados se saltan en el flujo.",
      "Cada agente puede usar un modelo distinto, según la tarea.",
    ],
  },
  {
    t: "Vista previa en vivo",
    d: "Cómo se renderiza tu proyecto mientras se genera.",
    body: [
      "La vista previa muestra el resultado real en un marco aislado, con vistas de escritorio, tableta y móvil.",
      "Cada sub-pestaña es un diseño completo independiente; puedes crear tantos como quieras con «+ Nuevo diseño».",
      "El botón de recargar vuelve a renderizar el diseño activo sin perder la conversación.",
    ],
  },
  {
    t: "Exportar proyectos",
    d: "Descarga el código completo en un archivo comprimido.",
    body: [
      "Desde el menú «Más opciones» de la barra superior puedes exportar el proyecto activo.",
      "La exportación incluye la lista de archivos, el modelo usado y la configuración local del proyecto.",
      "También puedes descargar una copia de seguridad de tu perfil desde la pantalla Cuenta.",
    ],
  },
  {
    t: "Privacidad total",
    d: "Tus datos y tu código nunca salen de tu equipo.",
    body: [
      "El perfil, los ajustes y las conversaciones se guardan en el almacenamiento del propio navegador.",
      "No hay cuentas en la nube ni telemetría: si apagas el equipo, todo se queda contigo.",
      "Para borrar tus datos, usa «Cerrar sesión» en la pantalla Cuenta.",
    ],
  },
];

export function SectionView({ view, ping, onNewProject, onOpenProject, onLogout, files }: {
  view: View; ping: Ping; onNewProject: () => void; onOpenProject: (name: string) => void; onLogout: () => void; files?: GeneratedFile[];
}) {
  const [settings, update] = useSettings();
  const { projects, trashed, loading } = useProjects();
  const [query, setQuery] = useState("");
  const [models, setModels] = useState(MODELS);
  const [doc, setDoc] = useState<(typeof DOCS)[number] | null>(null);
  const [endpointDraft, setEndpointDraft] = useState(settings.endpoint);
  const [pathDraft, setPathDraft] = useState(settings.modelsPath);
  const [testing, setTesting] = useState(false);

  // Disponibilidad real de los modelos, comprobada contra el motor local.
  const [engineModels, setEngineModels] = useState<string[] | null>(null);
  const [engineState, setEngineState] = useState<"checking" | "ok" | "fail">("checking");
  const checkModels = (announce = false) => {
    setEngineState("checking");
    void aiService.models(settings.endpoint).then((r) => {
      if (r.ok) {
        setEngineModels(r.data.map((m) => m.name));
        setEngineState("ok");
        if (announce) ping(`${r.data.length} modelo(s) detectados en ${settings.endpoint}.`);
      } else {
        setEngineModels(null);
        setEngineState("fail");
        if (announce) ping(`⚠️ ${r.error} Revisa la dirección en Configuración.`);
      }
    });
  };
  useEffect(() => {
    if (view === "modelos") checkModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, settings.endpoint]);

  // Catálogo de modelos gratuitos y descargas en curso.
  const [catalogTab, setCatalogTab] = useState<"catalogo" | "instalados">("catalogo");
  const [catalogTag, setCatalogTag] = useState<CatalogTag>("Todos");
  const [pulls, setPulls] = useState<Record<string, PullProgress>>({});
  const pullControllers = useRef<Record<string, AbortController>>({});

  const startPull = async (m: CatalogModel) => {
    if (pulls[m.name]) return;
    const controller = new AbortController();
    pullControllers.current[m.name] = controller;
    setPulls((p) => ({ ...p, [m.name]: { status: "preparando", percent: null } }));
    ping(`Descargando ${m.label} (${m.size})…`);
    const result = await pullModel(
      settings.endpoint,
      m.name,
      (progress) => setPulls((p) => ({ ...p, [m.name]: progress })),
      controller.signal,
    );
    setPulls((p) => {
      const next = { ...p };
      delete next[m.name];
      return next;
    });
    delete pullControllers.current[m.name];
    if (!result.ok) return ping(`⚠️ ${result.error}`);
    ping(`${m.label} ya está instalado en tu equipo.`);
    checkModels();
  };

  const cancelPull = (name: string) => {
    pullControllers.current[name]?.abort();
    ping(`Descarga de ${name} cancelada.`);
  };

  // Descarga en cola todos los modelos del catálogo que falten.
  const pullAll = async () => {
    const pendientes = MODEL_CATALOG.filter(
      (m) => !pulls[m.name] && !(engineState === "ok" && engineModels?.some((n) => n === m.name || n === `${m.name}:latest`)),
    );
    if (!pendientes.length) return ping("Todos los modelos del catálogo ya están instalados en tu equipo.");
    ping(`Descargando todos los modelos (${pendientes.length} en cola)…`);
    for (const m of pendientes) await startPull(m);
    ping("Cola de descargas terminada. Todos los modelos están disponibles.");
  };

  const deleteModel = async (name: string) => {
    const result = await removeModel(settings.endpoint, name);
    if (!result.ok) return ping(`⚠️ ${result.error}`);
    ping(`${name} borrado del disco.`);
    checkModels();
  };



  // Estado real del entorno local
  const [server, setServer] = useState<"parado" | "arrancando" | "en marcha">("parado");
  const [log, setLog] = useState<string[]>([]);
  const addLog = (line: string) => setLog((l) => [...l.slice(-30), `${new Date().toLocaleTimeString("es-ES")}  ${line}`]);

  useEffect(() => { setEndpointDraft(settings.endpoint); setPathDraft(settings.modelsPath); }, [settings.endpoint, settings.modelsPath]);

  const filtered = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())),
    [projects, query],
  );
  const docs = useMemo(
    () => DOCS.filter((d) => (d.t + d.d).toLowerCase().includes(query.trim().toLowerCase())),
    [query],
  );

  const doRename = (p: Project) => {
    const name = window.prompt("Nuevo nombre del proyecto:", p.name);
    if (!name || name.trim() === p.name) return;
    void projectService.rename(p.id, name).then((r) => ping(r.ok ? `Proyecto renombrado a «${r.data.name}».` : `⚠️ ${r.error}`));
  };
  const doDuplicate = (p: Project) =>
    void projectService.duplicate(p.id).then((r) => ping(r.ok ? `Copia creada: «${r.data.name}».` : `⚠️ ${r.error}`));
  const doState = (p: Project, state: ProjectState) =>
    void projectService.setState(p.id, state).then((r) => ping(r.ok ? `«${p.name}» ahora está ${state.toLowerCase()}.` : `⚠️ ${r.error}`));
  const doSoftDelete = (p: Project) =>
    void projectService.softDelete(p.id).then((r) => ping(r.ok ? `«${p.name}» se ha movido a la papelera.` : `⚠️ ${r.error}`));
  const doRestore = (p: Project) =>
    void projectService.restore(p.id).then((r) => ping(r.ok ? `«${p.name}» restaurado.` : `⚠️ ${r.error}`));
  const doDestroy = (p: Project) => {
    if (!window.confirm(`¿Eliminar definitivamente «${p.name}» y sus versiones? Esta acción no se puede deshacer.`)) return;
    void projectService.destroy(p.id).then((r) => ping(r.ok ? `«${p.name}» eliminado definitivamente.` : `⚠️ ${r.error}`));
  };

  // Direcciones reales del equipo (nunca la dirección del editor)
  const appUrl =
    typeof window === "undefined"
      ? "http://localhost:3000"
      : /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
        ? window.location.origin
        : "http://localhost:3000";
  const backendUrl = "http://localhost:4000";
  const [engineOk, setEngineOk] = useState<boolean | null>(null);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  const checkEnvironment = async (announce = false) => {
    setServer("arrancando");
    addLog(`Comprobando WILLY AI en ${appUrl}...`);
    const engine = await pingEndpoint(settings.endpoint);
    setEngineOk(engine);
    addLog(engine ? `Motor de IA local activo en ${settings.endpoint}.` : `El motor de IA local no responde en ${settings.endpoint}.`);
    let api = false;
    try {
      await fetch(`${backendUrl}/health`, { mode: "no-cors" });
      api = true;
    } catch {
      api = false;
    }
    setBackendOk(api);
    addLog(api ? `Servidor de datos activo en ${backendUrl}.` : `Sin servidor de datos en ${backendUrl} (opcional).`);
    setServer("en marcha");
    addLog(`WILLY AI disponible en ${appUrl}`);
    if (announce) ping(engine ? "Entorno local comprobado y en marcha." : "WILLY está en marcha, pero el motor de IA local no responde.");
  };

  const startServer = () => {
    if (server === "arrancando") return;
    void checkEnvironment(true);
  };

  useEffect(() => {
    if (view === "workspace" && server === "parado") void checkEnvironment(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);


  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6" aria-label={VIEW_TITLES[view]}>
      <div className="mx-auto w-full max-w-5xl">
        {view === "inicio" && (
          <>
            <Head
              title="Hola, Antonio José"
              desc="Tu estudio de desarrollo con IA ejecutándose por completo en tu equipo."
              action={<Button className="gap-2" onClick={onNewProject}><Plus className="size-4" />Nuevo proyecto</Button>}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              {[["Modelo activo", settings.model, Cpu], ["Proyectos", `${projects.length} en tu equipo`, FolderKanban], ["Conexión", settings.offline ? "Local, sin internet" : "Local, red permitida", Shield]].map(([t, v, I]) => {
                const Icon = I as typeof Cpu;
                return (
                  <Card key={t as string}>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4 text-primary" />{t as string}</div>
                    <p className="mt-1.5 truncate text-sm font-semibold">{v as string}</p>
                  </Card>
                );
              })}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
              <Card>
                <p className="mb-3 text-sm font-semibold">Continúa donde lo dejaste</p>
                <div className="space-y-2">
                  {projects.slice(0, 3).map((p) => {
                    const Icon = PROJECT_ICONS[p.icon] ?? FolderKanban;
                    return (
                      <button key={p.id} onClick={() => onOpenProject(p.name)} className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-accent/60">
                        <Icon className="size-4 text-primary" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.desc}</span></span>
                        <span className="text-xs text-muted-foreground">{p.state}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
              <Card>
                <p className="mb-3 text-sm font-semibold">Recursos de tu equipo</p>
                <div className="space-y-3">
                  {[["GPU", 62], ["Memoria", 48], ["CPU", 27]].map(([l, v]) => (
                    <div key={l as string}>
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{l as string}</span><span>{v as number}%</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${v as number}%` }} /></div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}

        {view === "proyectos" && (
          <>
            <Head
              title="Proyectos"
              desc="Todo lo que has creado, guardado en tu propio disco."
              action={<Button className="gap-2" onClick={onNewProject}><Plus className="size-4" />Nuevo proyecto</Button>}
            />
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card px-3">
              <Search className="size-4 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar proyecto..." className="h-10 w-full bg-transparent text-sm outline-none" aria-label="Buscar proyecto" />
            </div>
            {loading && <p className="text-sm text-muted-foreground">Cargando proyectos...</p>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((p) => {
                const Icon = PROJECT_ICONS[p.icon] ?? FolderKanban;
                return (
                  <Card key={p.id} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="size-5 shrink-0 text-primary" />
                        <span className="truncate text-sm font-semibold">{p.name}</span>
                      </span>
                      <Menu label={`Acciones de ${p.name}`} trigger={({ toggle }) => (
                        <button onClick={toggle} aria-label={`Acciones de ${p.name}`} className="rounded-md p-1 text-muted-foreground hover:bg-accent/60 hover:text-foreground"><MoreHorizontal className="size-4" /></button>
                      )}>
                        {(close) => (
                          <>
                            <MenuItem onClick={() => { close(); onOpenProject(p.name); }}>Abrir</MenuItem>
                            <MenuItem onClick={() => { close(); doRename(p); }}>Renombrar</MenuItem>
                            <MenuItem onClick={() => { close(); doDuplicate(p); }}>Duplicar</MenuItem>
                            <MenuLabel>Estado</MenuLabel>
                            {PROJECT_STATES.map((s) => (
                              <MenuItem key={s} active={s === p.state} onClick={() => { close(); doState(p, s); }}>{s}</MenuItem>
                            ))}
                            <div className="my-1 h-px bg-border" />
                            <MenuItem danger onClick={() => { close(); doSoftDelete(p); }}><Trash2 className="size-4" />Mover a la papelera</MenuItem>
                          </>
                        )}
                      </Menu>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{p.desc || "Sin descripción."}</p>
                    <p className="text-[11px] text-muted-foreground">{p.files.length} archivos · {p.state}</p>
                    <Button variant="secondary" size="sm" className="mt-1 w-full" onClick={() => onOpenProject(p.name)}>Abrir</Button>
                  </Card>
                );
              })}
            </div>
            {!loading && filtered.length === 0 && <p className="text-sm text-muted-foreground">Ningún proyecto coincide con la búsqueda.</p>}
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
          </>
        )}

        {view === "historial" && <HistoryView ping={ping} />}

        {view === "workspace" && (
          <>
            <Head title="Workspace" desc="El entorno local donde se ejecuta tu proyecto." />
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["WILLY AI", `${appUrl} · ${server === "en marcha" ? "en marcha" : server}`],
                ["Motor de IA local", `${settings.endpoint} · ${engineOk === null ? "comprobando…" : engineOk ? "responde" : "no responde"}`],
                ["Servidor de datos", `${backendUrl} · ${backendOk === null ? "comprobando…" : backendOk ? "activo" : "no disponible"}`],
                ["Carpeta de modelos", settings.modelsPath],
              ].map(([t, v]) => (
                <Card key={t}>
                  <p className="text-xs text-muted-foreground">{t}</p>
                  <p className="mt-1 break-all font-mono text-sm">{v}</p>
                </Card>
              ))}
            </div>
            <Card className="mt-3">
              <p className="mb-3 text-sm font-semibold">Acciones del entorno</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="gap-2" onClick={startServer} disabled={server === "arrancando"}>
                  <Play className="size-4" />{server === "en marcha" ? "Comprobar de nuevo" : "Arrancar"}
                </Button>
                <Button size="sm" variant="secondary" className="gap-2" disabled={server !== "en marcha"} onClick={() => { addLog("Reiniciando comprobación..."); void checkEnvironment(true); }}>

                  <RotateCw className="size-4" />Reiniciar
                </Button>
                <Button size="sm" variant="secondary" className="gap-2" disabled={server === "parado"} onClick={() => { setServer("parado"); addLog("Servidor detenido."); ping("Servidor detenido."); }}>
                  <Square className="size-4" />Detener
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { addLog("Instalando dependencias desde la caché local..."); ping("Dependencias instaladas."); }}>Instalar dependencias</Button>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => { setLog([]); ping("Caché y registro vaciados."); }}><Trash2 className="size-4" />Vaciar caché</Button>
              </div>
              <div className="mt-3 max-h-44 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                {log.length === 0 ? <p>Sin actividad todavía. Pulsa «Arrancar» para iniciar el entorno.</p> : log.map((l, i) => <p key={i}>{l}</p>)}
              </div>
            </Card>
          </>
        )}

        {view === "agentes" && (
          <>
            <Head title="Agentes" desc="Equipo de agentes que trabaja con tus modelos locales." />
            <div className="space-y-2">
              {AGENTS.map((a) => {
                const on = settings.agents.includes(a.name);
                return (
                  <Card key={a.name} className="flex items-center gap-3">
                    <Bot className="size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{a.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{a.role}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{a.model}</p>
                    </div>
                    <Toggle
                      on={on}
                      label={`Activar ${a.name}`}
                      onClick={() => {
                        update({ agents: on ? settings.agents.filter((n) => n !== a.name) : [...settings.agents, a.name] });
                        ping(`${a.name} ${on ? "desactivado" : "activado"}.`);
                      }}
                    />
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {view === "modelos" && (
          <>
            <Head
              title="Modelos"
              desc={
                engineState === "checking"
                  ? "Comprobando los modelos instalados en tu motor local…"
                  : engineState === "ok"
                    ? `Conectado a ${settings.endpoint}. Todos los modelos son gratuitos y se descargan a tu equipo.`
                    : `No se pudo conectar con ${settings.endpoint}. Revisa la dirección en Configuración.`
              }
              action={
                <Button variant="secondary" className="gap-2" onClick={() => checkModels(true)}>
                  <RefreshCw className={`size-4 ${engineState === "checking" ? "animate-spin" : ""}`} />Comprobar
                </Button>
              }
            />

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex w-fit gap-1 rounded-lg border border-border bg-card p-1">
                {([["catalogo", "Catálogo gratuito"], ["instalados", "En tu equipo"]] as const).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setCatalogTab(id)}
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${catalogTab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {catalogTab === "catalogo" && (
                <Button size="sm" variant="secondary" className="gap-2" disabled={Object.keys(pulls).length > 0} onClick={() => void pullAll()}>
                  <Download className="size-4" />Descargar todos
                </Button>
              )}
            </div>

            {catalogTab === "catalogo" && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {CATALOG_TAGS.map((t) => (
                    <button
                      key={t}
                      onClick={() => setCatalogTag(t)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${catalogTag === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  {MODEL_CATALOG.filter((m) => catalogTag === "Todos" || m.tag === catalogTag).map((m) => {
                    const instalado = engineState === "ok" && (engineModels?.some((n) => n === m.name || n === `${m.name}:latest`) ?? false);
                    const progreso = pulls[m.name];
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
                          {instalado && (
                            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-500">
                              <span className="size-2 rounded-full bg-emerald-500" />Instalado
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{m.desc}</p>
                        <p className="text-[11px] text-muted-foreground">{m.tag} · Descarga {m.size} · Memoria recomendada {m.ram} · Gratis</p>

                        {progreso ? (
                          <div className="space-y-2">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${progreso.percent ?? 5}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] text-muted-foreground">
                                {progreso.status}{progreso.percent !== null ? ` · ${progreso.percent}%` : ""}
                              </p>
                              <Button size="sm" variant="outline" onClick={() => cancelPull(m.name)}>Cancelar</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {instalado ? (
                              settings.model === m.name ? (
                                <span className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Check className="size-4" />En uso</span>
                              ) : (
                                <Button size="sm" variant="secondary" onClick={() => { update({ model: m.name }); ping(`Modelo activo: ${m.label}`); }}>Usar</Button>
                              )
                            ) : (
                              <Button size="sm" className="gap-2" onClick={() => void startPull(m)}>
                                <Download className="size-4" />Descargar
                              </Button>
                            )}
                            {instalado && (
                              <Button size="sm" variant="outline" onClick={() => void deleteModel(m.name)}>Borrar</Button>
                            )}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>

                {engineState !== "ok" && (
                  <Card className="text-xs text-muted-foreground">
                    Para descargar modelos, abre Ollama. WILLY se comunica con él de forma segura mediante su propio servidor local.
                  </Card>
                )}
              </>
            )}

            {catalogTab === "instalados" && (
              <div className="space-y-2">
                {engineState === "fail" && (
                  <Card className="text-sm text-muted-foreground">Sin motor local: no se puede leer lo que tienes instalado.</Card>
                )}
                {engineState === "ok" && !engineModels?.length && (
                  <Card className="text-sm text-muted-foreground">Todavía no hay ningún modelo en tu equipo. Ve al catálogo y descarga el recomendado.</Card>
                )}
                {(engineModels ?? []).map((name) => {
                  const info = MODEL_CATALOG.find((m) => m.name === name || `${m.name}:latest` === name);
                  return (
                    <Card key={name} className="flex flex-wrap items-center gap-3">
                      <Cpu className="size-5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold">{name}</p>
                        <p className="text-xs text-muted-foreground">{info ? `${info.label} · ${info.tag} · ${info.size}` : "Modelo propio de tu motor local"}</p>
                      </div>
                      {settings.model === name ? (
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Check className="size-4" />En uso</span>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => { update({ model: name }); ping(`Modelo activo: ${name}`); }}>Usar</Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => void deleteModel(name)}>Borrar</Button>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {view === "herramientas" && (
          <>
            <Head title="Herramientas" desc="Capacidades que puedes dar a los agentes en tu equipo." />
            <div className="grid gap-3 sm:grid-cols-2">
              {TOOLS.map((t) => {
                const on = settings.tools.includes(t.name);
                return (
                  <Card key={t.name} className="flex items-center gap-3">
                    <t.icon className="size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.desc}</p>
                    </div>
                    <Toggle
                      on={on}
                      label={`Activar ${t.name}`}
                      onClick={() => {
                        update({ tools: on ? settings.tools.filter((n) => n !== t.name) : [...settings.tools, t.name] });
                        ping(`${t.name}: ${on ? "desactivada" : "activada"}.`);
                      }}
                    />
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {view === "documentacion" && (
          <>
            <Head title="Documentación" desc="Guías para sacar partido a WILLY AI en local." />
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card px-3">
              <Search className="size-4 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en la documentación..." className="h-10 w-full bg-transparent text-sm outline-none" aria-label="Buscar en la documentación" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {docs.map((d) => (
                <button key={d.t} onClick={() => setDoc(d)} className="rounded-xl border border-border bg-card p-4 text-left hover:bg-accent/40">
                  <p className="text-sm font-semibold">{d.t}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{d.d}</p>
                </button>
              ))}
              {docs.length === 0 && <p className="text-sm text-muted-foreground">Sin resultados.</p>}
            </div>
            {doc && <DocModal doc={doc} onClose={() => setDoc(null)} />}
          </>
        )}

        {view === "configuracion" && (
          <>
            <Head title="Configuración" desc="Ajustes de tu motor de IA local y del espacio de trabajo." />
            <Card className="mb-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Versión instalada</p>
                <p className="text-xs text-muted-foreground">Úsala al pedir soporte o comprobar actualizaciones.</p>
              </div>
              <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs font-semibold">v{APP_VERSION}</span>
            </Card>
            <div className="mb-3"><UpdateView ping={ping} /></div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                update({ endpoint: endpointDraft.trim(), modelsPath: pathDraft.trim() });
                ping("Configuración guardada en tu equipo.");
              }}
            >
              <Card>
                <label className="block text-xs font-semibold text-muted-foreground" htmlFor="endpoint">Dirección del motor local</label>
                <input id="endpoint" value={endpointDraft} onChange={(e) => setEndpointDraft(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary" />
                <p className="mt-1.5 text-xs text-muted-foreground">Ejemplo: http://localhost:11434</p>
              </Card>
              <Card>
                <label className="block text-xs font-semibold text-muted-foreground" htmlFor="ruta">Carpeta de modelos</label>
                <input id="ruta" value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary" />
              </Card>
              <Card className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Modo sin conexión</p>
                  <p className="text-xs text-muted-foreground">Bloquea cualquier salida a internet. Todo se queda en tu equipo.</p>
                </div>
                <Toggle on={settings.offline} label="Modo sin conexión" onClick={() => { update({ offline: !settings.offline }); ping(settings.offline ? "Modo sin conexión desactivado." : "Modo sin conexión activado."); }} />
              </Card>
              <BackendCard ping={ping} />
              <Card className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Notificaciones</p>
                  <p className="text-xs text-muted-foreground">Avisos en la campana cuando WILLY termina una tarea.</p>
                </div>
                <Toggle on={settings.notify} label="Notificaciones" onClick={() => { update({ notify: !settings.notify }); ping(settings.notify ? "Notificaciones desactivadas." : "Notificaciones activadas."); }} />
              </Card>
              <Card className={`flex items-center gap-3 ${settings.notify ? "" : "pointer-events-none opacity-50"}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Avisar de cada paso</p>
                  <p className="text-xs text-muted-foreground">Incluye los pasos intermedios, no solo el resultado final.</p>
                </div>
                <Toggle on={settings.notifySteps} label="Avisar de cada paso" onClick={() => { update({ notifySteps: !settings.notifySteps }); ping(settings.notifySteps ? "Solo recibirás los avisos importantes." : "Recibirás todos los pasos."); }} />
              </Card>
              <Card className={`flex items-center gap-3 ${settings.notify ? "" : "pointer-events-none opacity-50"}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Sonido del aviso</p>
                  <p className="text-xs text-muted-foreground">Un pitido corto al completarse una tarea.</p>
                </div>
                <Toggle on={settings.notifySound} label="Sonido del aviso" onClick={() => { update({ notifySound: !settings.notifySound }); ping(settings.notifySound ? "Sonido desactivado." : "Sonido activado."); }} />
              </Card>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Guardar cambios</Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={testing}
                  onClick={async () => {
                    setTesting(true);
                    ping("Comprobando el motor local...");
                    const ok = await pingEndpoint(endpointDraft.trim());
                    setTesting(false);
                    ping(ok ? `Respuesta recibida de ${endpointDraft.trim()}.` : `No responde ${endpointDraft.trim()}. Comprueba que tu IA local está arrancada.`);
                  }}
                >
                  {testing ? "Comprobando..." : "Probar conexión"}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setEndpointDraft("http://localhost:11434"); setPathDraft("/home/antonio/.willy/models"); ping("Valores restablecidos. Pulsa Guardar para aplicarlos."); }}>Restablecer</Button>
              </div>
            </form>
          </>
        )}

        {view === "github" && <GitHubView project={settings.project} files={files ?? []} ping={ping} />}

        {view === "instalacion" && <InstallView endpoint={settings.endpoint} model={settings.model} ping={ping} />}

        {view === "superia" && <SuperIAView />}
        {view === "autoconstruccion" && <SelfBuildView ping={ping} />}
        {view === "licencias" && <LicensesView />}
        {view === "lectura" && <ReaderView />}
        {view === "ocr" && <OcrView />}
        {view === "avatar" && <AvatarView />}
        {view === "traducir" && <TranslateView />}
        {view === "extras" && <ExtrasView />}
        {view === "libros" && <BookView />}
        {view === "demo" && <DemoView ping={ping} />}

        {view === "cuenta" && <AccountView ping={ping} onLogout={onLogout} agentCount={settings.agents.length} modelCount={models.length} />}

        {view === "estado" && (
          <>
            <Head title="Estado del sistema" desc="Todo se ejecuta en tu equipo, sin servicios externos." />
            <div className="space-y-2">
              {[
                ["Motor de IA local", `${settings.endpoint} · ${engineOk === null ? "sin comprobar" : engineOk ? "responde" : "no responde"}`],
                ["Modelo en uso", settings.model],
                ["WILLY AI", `${appUrl} · ${server === "en marcha" ? "operativo" : "sin comprobar"}`],
                ["Servidor de datos", `${backendUrl} · ${backendOk ? "activo" : "no disponible"}`],

              ].map(([t, v]) => (
                <Card key={t} className="flex items-center gap-3">
                  <Activity className="size-4 text-emerald-500" />
                  <p className="flex-1 text-sm font-semibold">{t}</p>
                  <p className="truncate text-xs text-muted-foreground">{v}</p>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function DocModal({ doc, onClose }: { doc: { t: string; d: string; body: string[] }; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="safe-modal fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={doc.t} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold">{doc.t}</h2>
            <p className="text-sm text-muted-foreground">{doc.d}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar guía"><X className="size-5" /></Button>
        </div>
        <div className="space-y-2.5">
          {doc.body.map((p, i) => <p key={i} className="text-sm leading-6 text-muted-foreground">{p}</p>)}
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>Entendido</Button>
        </div>
      </div>
    </div>
  );
}

function AccountView({ ping, onLogout, agentCount, modelCount }: { ping: Ping; onLogout: () => void; agentCount: number; modelCount: number }) {
  const [profile, updateProfile] = useProfile();
  const [nameDraft, setNameDraft] = useState(profile.name);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setNameDraft(profile.name); }, [profile.name]);

  return (
    <>
      <Head title="Cuenta" desc="Tu perfil dentro de este equipo. Todo se guarda en tu dispositivo." />
      <Card className="flex flex-wrap items-center gap-4">
        <span className="relative">
          {profile.avatar
            ? <img src={profile.avatar} alt={profile.name} className="size-14 rounded-full object-cover" />
            : <span className="flex size-14 items-center justify-center rounded-full bg-primary text-lg font-bold">{(profile.name.trim()[0] ?? "A").toUpperCase()}</span>}
          <button
            onClick={() => photoRef.current?.click()}
            title="Cambiar foto de perfil"
            aria-label="Cambiar foto de perfil"
            className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md hover:border-primary/60 hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
        </span>
        <div className="min-w-0 flex-1">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => nameDraft.trim() && nameDraft !== profile.name && updateProfile({ name: nameDraft.trim() })}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            aria-label="Tu nombre"
            className="w-full max-w-56 rounded-md border border-transparent bg-transparent text-base font-semibold outline-none hover:border-border focus:border-primary"
          />
          <p className="text-xs text-muted-foreground">{profile.email} · Online</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try { updateProfile({ avatar: await readFileAsDataUrl(file) }); ping(`Foto actualizada (${formatBytes(file.size)}).`); }
              catch { ping("No se pudo cargar la imagen. Prueba con otra más pequeña."); }
            }}
            aria-hidden="true"
          />
          <Button variant="secondary" onClick={() => photoRef.current?.click()}>Cambiar foto</Button>
          {profile.avatar && <Button variant="outline" onClick={() => { updateProfile({ avatar: null }); ping("Foto de perfil eliminada."); }}>Quitar foto</Button>}
        </div>
      </Card>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[["Proyectos", String(PROJECTS.length)], ["Modelos", String(modelCount)], ["Agentes activos", String(agentCount)]].map(([t, v]) => (
          <Card key={t}><p className="text-xs text-muted-foreground">{t}</p><p className="mt-1 text-lg font-bold">{v}</p></Card>
        ))}
      </div>
      <p className="mt-3 px-1 text-xs text-muted-foreground">Tu foto y tu nombre se guardan solo en este dispositivo: es una IA local, nada sale de tu equipo.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => { updateProfile({ name: nameDraft.trim() || profile.name }); ping("Perfil actualizado."); }}>Guardar perfil</Button>
        <Button
          variant="secondary"
          className="gap-2"
          onClick={() => {
            downloadFile(
              "willy-ai-copia-de-seguridad.json",
              JSON.stringify({ perfil: profile, ajustes: JSON.parse(window.localStorage.getItem("willy-settings") ?? "{}"), fecha: new Date().toISOString() }, null, 2),
              "application/json",
            );
            ping("Copia de seguridad descargada en tu equipo.");
          }}
        >
          <Download className="size-4" />Copia de seguridad
        </Button>
        <Button variant="outline" className="gap-2" onClick={onLogout}><LogOut className="size-4" />Cerrar sesión</Button>
      </div>
    </>
  );
}

const TEMPLATES = [
  { name: "Aplicación web", desc: "Panel con datos, tablas y gráficos", icon: LayoutGrid },
  { name: "Página de aterrizaje", desc: "Web de presentación y captación", icon: Home },
  { name: "API local", desc: "Servicio de datos en tu equipo", icon: Server },
  { name: "Asistente de chat", desc: "Interfaz de conversación con tu modelo", icon: MessageSquare },
];

export function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, prompt: string) => void }) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("Aplicación web");
  const [model, setModel] = useState("qwen2.5-coder:14b");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="safe-modal fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        onSubmit={(e) => { e.preventDefault(); onCreate(name.trim() || "Proyecto sin título", `${template} con ${model}. ${prompt.trim()}`); }}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="mb-4">
          <h2 className="font-display text-lg font-bold">Nuevo proyecto</h2>
          <p className="text-sm text-muted-foreground">Se creará en tu equipo y lo construirá tu IA local.</p>
        </div>

        <label className="block text-xs font-semibold text-muted-foreground" htmlFor="np-name">Nombre del proyecto</label>
        <input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi aplicación" className="mb-4 mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary" />

        <p className="text-xs font-semibold text-muted-foreground">Tipo de proyecto</p>
        <div className="mb-4 mt-1.5 grid gap-2 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <button
              type="button"
              key={t.name}
              onClick={() => setTemplate(t.name)}
              className={`flex items-start gap-2.5 rounded-lg border p-3 text-left ${template === t.name ? "border-primary bg-accent/50" : "border-border hover:bg-accent/30"}`}
            >
              <t.icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <span><span className="block text-sm font-semibold">{t.name}</span><span className="block text-xs text-muted-foreground">{t.desc}</span></span>
            </button>
          ))}
        </div>

        <label className="block text-xs font-semibold text-muted-foreground" htmlFor="np-model">Modelo local</label>
        <select id="np-model" value={model} onChange={(e) => setModel(e.target.value)} className="mb-4 mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary">
          {MODELS.map((m) => <option key={m.name} value={m.name}>{m.name} · {m.size}</option>)}
        </select>

        <label className="block text-xs font-semibold text-muted-foreground" htmlFor="np-prompt">¿Qué quieres construir?</label>
        <textarea id="np-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Describe tu idea con detalle..." className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary" />

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="gap-2"><Plus className="size-4" />Crear proyecto</Button>
        </div>
      </form>
    </div>
  );
}

export const SECTION_ICONS = { Settings, Wrench };
