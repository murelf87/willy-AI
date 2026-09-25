// ARMAZÓN NUEVO (diseño de las maquetas de 24/09): barra superior (marca, «IA: Auto», «Todo operativo», avisos, tema y
// cuenta), barra lateral compacta por secciones con la tarjeta «Estado de WILLY», y el hueco donde van las pantallas.
// No tiene lógica propia de negocio: todo lo que enseña sale de lo que ya existe (chat-cloud, use-system, background-tasks,
// notifications, self-health) y las pantallas de dentro son las de siempre (o las nuevas de src/front).
import { useId, type ReactNode } from "react";
import {
  ArrowRight, AudioLines, BookOpen, Brain, Check, ChevronDown, ChevronRight, CircleDot, Clock, Cloud, Cpu, FileText, FolderKanban, Github,
  Headphones, Home, KeyRound, Languages, LayoutGrid, Menu as MenuIcon, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen,
  Presentation, Puzzle, ScanText, Settings, Sparkles, Sun, Video, Wrench, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { ExternalAiPanel, refreshExternalStatus, useExternalAi } from "@/components/chat-engine-chip";
import { NotificationBell } from "@/components/notification-bell";
import { UpdateNotice } from "@/components/update-notice";
import { UserAvatar } from "@/components/user-avatar";
import type { View } from "@/components/app-sections";
import { capabilityLabels } from "@/lib/capability-registry";
import { useLocalModels } from "@/lib/use-local-models";
import { usePersistentState } from "@/lib/persistent-state";
import type { Settings as WorkspaceSettings } from "@/lib/workspace-store";
import type { Ping } from "@/types/domain";
import { aiPolicyOf, healthText, healthTone, useAiPick, useHealth, useLocalEngine, useWork } from "@/front/status";

type NavItem = { icon: typeof Home; label: string; view: View; tab?: string };

const NAV_TOP: NavItem[] = [
  { icon: Home, label: "Inicio", view: "inicio" },
  { icon: MessageSquare, label: "Chats", view: "chat" },
];

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  { title: "Inteligencia", items: [
    { icon: Sparkles, label: "Súper IA", view: "superia" },
    { icon: Brain, label: "Centro de Inteligencia", view: "inteligencia" },
    { icon: Wrench, label: "Autoconstrucción", view: "autoconstruccion" },
  ] },
  { title: "Trabajo", items: [
    { icon: FolderKanban, label: "Proyectos", view: "proyectos" },
    { icon: LayoutGrid, label: "Herramientas", view: "herramientas" },
  ] },
  { title: "Integraciones", items: [{ icon: Github, label: "GitHub", view: "github" }] },
  { title: "Sistema", items: [{ icon: Settings, label: "Ajustes", view: "ajustes" }] },
];

// Pantallas que las maquetas reúnen dentro de «Herramientas» y «Ajustes»; hasta que esas dos pantallas nuevas estén
// hechas siguen aquí, en un desplegable, para no dejar ninguna ruta sin salida.
const NAV_MORE: NavItem[] = [
  { icon: BookOpen, label: "Libros", view: "libros" },
  { icon: Headphones, label: "Lectura", view: "lectura" },
  { icon: ScanText, label: "OCR", view: "ocr" },
  { icon: AudioLines, label: "Transcribir", view: "transcribir" },
  { icon: Languages, label: "Traducir", view: "traducir" },
  { icon: Video, label: "Mi yo en IA", view: "avatar" },
  { icon: Puzzle, label: "Nuevas funciones", view: "extras" },
  { icon: Clock, label: "Historial", view: "historial" },
  { icon: Presentation, label: "Demo", view: "demo" },
  { icon: Zap, label: "Acceso directo", view: "instalacion" },
  { icon: KeyRound, label: "Licencias", view: "licencias" },
  { icon: FileText, label: "Documentación", view: "documentacion" },
];

export type FrontShellProps = {
  view: View;
  onNav: (view: View, tab?: string) => void;
  dark: boolean;
  toggleTheme: () => void;
  navOpen: boolean;
  onOpenNav: () => void;
  onCloseNav: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  ping: Ping;
  settings: WorkspaceSettings;
  updateSettings: (patch: Partial<WorkspaceSettings>) => void;
  /** Alguna IA está escribiendo ahora mismo (chat). */
  generating: boolean;
  children: ReactNode;
};

export function FrontShell(p: FrontShellProps) {
  return (
    <>
      <TopBar
        onMenu={p.onOpenNav} onNav={p.onNav} dark={p.dark} toggleTheme={p.toggleTheme} ping={p.ping}
        settings={p.settings} updateSettings={p.updateSettings} generating={p.generating}
      />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <Sidebar
          open={p.navOpen} onClose={p.onCloseNav} view={p.view} onNav={p.onNav}
          collapsed={p.collapsed} onToggle={p.onToggleCollapsed}
        />
        {p.children}
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────── barra superior

/** Logotipo de WILLY fiel a la maqueta: una «W» gruesa de trazos redondeados con degradado azul → violeta → púrpura, sin caja. */
export function LogoMark({ size = 30, className = "" }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg width={size} height={Math.round(size * 0.8)} viewBox="0 0 50 40" fill="none" aria-hidden="true" className={`shrink-0 ${className}`}>
      <defs>
        <linearGradient id={`${id}-w`} x1="4" y1="20" x2="46" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3d7bf7" />
          <stop offset="0.5" stopColor="#6b46f6" />
          <stop offset="1" stopColor="#a955f7" />
        </linearGradient>
      </defs>
      <path d="M8 10 L16 31 L25 14.5 L34 31 L42 10" stroke={`url(#${id}-w)`} strokeWidth="10.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TopBar({ onMenu, onNav, dark, toggleTheme, ping, settings, updateSettings, generating }: {
  onMenu: () => void; onNav: (view: View, tab?: string) => void; dark: boolean; toggleTheme: () => void; ping: Ping;
  settings: WorkspaceSettings; updateSettings: (patch: Partial<WorkspaceSettings>) => void; generating: boolean;
}) {
  return (
    <header className="safe-header z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:px-4">
      <Button variant="ghost" size="icon" className="size-9 lg:hidden" onClick={onMenu} aria-label="Abrir menú"><MenuIcon className="size-5" /></Button>
      <button type="button" className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/60 lg:hidden" onClick={() => onNav("inicio")} aria-label="Ir a Inicio">
        <LogoMark size={28} />
        <span className="font-display text-base font-extrabold tracking-tight">WILLY AI</span>
      </button>
      <div className="flex-1" />
      <AiPolicyMenu settings={settings} updateSettings={updateSettings} onNav={onNav} ping={ping} generating={generating} />
      <HealthPill onNav={onNav} />
      <UpdateNotice />
      <NotificationBell enabled={settings.notify} onOpenSettings={() => onNav("ajustes", "general")} />
      <Button variant="ghost" size="icon" className="size-9 rounded-full" onClick={toggleTheme} aria-label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"} title={dark ? "Tema claro" : "Tema oscuro"}>
        {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      </Button>
      <button type="button" className="shrink-0 rounded-full ring-2 ring-transparent hover:ring-primary/40" onClick={() => onNav("cuenta")} aria-label="Tu cuenta" title="Tu cuenta">
        <UserAvatar size={34} />
      </button>
    </header>
  );
}

/** «IA: Auto ▾»: la política REAL con la que contestan los chats (la misma que usan el Chat, el móvil y SUPER WILLY). */
function AiPolicyMenu({ settings, updateSettings, onNav, ping, generating }: {
  settings: WorkspaceSettings; updateSettings: (patch: Partial<WorkspaceSettings>) => void; onNav: (view: View, tab?: string) => void; ping: Ping; generating: boolean;
}) {
  const ai = useExternalAi();
  const pick = useAiPick();
  const policy = aiPolicyOf(pick, ai.status);
  const { models } = useLocalModels(settings.endpoint);
  const choose = (id: string, text: string) => { ai.choose(id); ping(text); };
  const options: Array<{ id: string; label: string; detail: string; icon: typeof Sparkles }> = [
    { id: "smart", label: "Auto", detail: "WILLY elige la mejor IA para cada petición", icon: Sparkles },
    { id: "local", label: "Solo mi equipo", detail: `Nada sale de tu ordenador (${settings.model})`, icon: Cpu },
    { id: "externas", label: "IA externa primero", detail: "Las gratuitas con clave, en tu orden; si no, tu equipo", icon: Cloud },
  ];
  return (
    <Menu
      wide
      align="end"
      label="Con qué IA trabaja WILLY"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={() => { if (!open) void refreshExternalStatus(5_000); toggle(); }}
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-secondary px-3 text-sm font-semibold hover:border-primary/50"
          aria-label={`IA en uso: ${policy.label}. ${policy.detail}`}
          title={policy.detail}
        >
          <Sparkles className={`size-4 shrink-0 text-primary ${generating ? "animate-pulse" : ""}`} />
          <span className="hidden sm:inline"><span className="text-muted-foreground">IA:</span> {policy.label}</span>
          <span className="sm:hidden">{policy.short}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Cómo elige WILLY la IA</MenuLabel>
          {options.map((o) => (
            <MenuItem key={o.id} active={pick === o.id} onClick={() => { close(); choose(o.id, `IA: ${o.label}. ${o.detail}.`); }}>
              <o.icon className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1"><span className="block">{o.label}</span><span className="block text-[11px] font-normal text-muted-foreground">{o.detail}</span></span>
              {pick === o.id && <Check className="size-4 shrink-0 text-primary" />}
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-border" />
          <MenuLabel>Modelo de tu equipo</MenuLabel>
          {models.length === 0 && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">Todavía no hay modelos en tu equipo (o su IA está parada).</p>}
          {models.slice(0, 8).map((name) => (
            <MenuItem key={name} active={name === settings.model} onClick={() => { close(); updateSettings({ model: name }); ping(`Modelo de tu equipo: ${name}`); }}>
              <Cpu className="size-4 shrink-0 text-primary" /><span className="truncate font-mono text-xs">{name}</span>
              {capabilityLabels(name).map((label) => <span key={label} className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{label}</span>)}
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-border" />
          <div className="p-1.5"><ExternalAiPanel ai={ai} compact /></div>
          <div className="my-1 h-px bg-border" />
          <MenuItem onClick={() => { close(); onNav("inteligencia"); }}><Brain className="size-4" />Abrir el Centro de Inteligencia</MenuItem>
        </>
      )}
    </Menu>
  );
}

const TONE_DOT: Record<"ok" | "aviso" | "fallo" | "neutro", string> = {
  ok: "bg-success", aviso: "bg-warning", fallo: "bg-destructive", neutro: "bg-muted-foreground/60 animate-pulse",
};

/** «● Todo operativo»: la salud real del programa (Autoconstrucción → salud). Pulsar abre Ajustes → Sistema. */
function HealthPill({ onNav }: { onNav: (view: View, tab?: string) => void }) {
  const health = useHealth();
  const tone = healthTone(health);
  return (
    <button
      type="button"
      onClick={() => onNav("ajustes", "sistema")}
      className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-secondary px-3 text-sm font-semibold hover:border-primary/50 md:flex"
      title={health.report ? `${health.report.checks.length} comprobaciones · ${new Date(health.report.at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "Comprobando la salud de WILLY"}
      aria-label={`Estado del sistema: ${healthText(health)}`}
    >
      <span className={`size-2 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
      {healthText(health)}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────── barra lateral

function NavButton({ item, active, onClick, compact = false }: { item: NavItem; active: boolean; onClick: () => void; compact?: boolean }) {
  const Icon = item.icon;
  if (compact) {
    return (
      <button type="button" onClick={onClick} title={item.label} aria-label={item.label} aria-current={active ? "page" : undefined}
        className={`grid size-10 place-items-center rounded-xl ${active ? "bg-accent text-primary" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
        <Icon className="size-[18px]" />
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${active ? "bg-accent font-bold text-foreground" : "font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
      <Icon className={`size-[18px] shrink-0 ${active ? "text-primary" : ""}`} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

function Sidebar({ open, onClose, view, onNav, collapsed, onToggle }: {
  open: boolean; onClose: () => void; view: View; onNav: (view: View, tab?: string) => void; collapsed: boolean; onToggle: () => void;
}) {
  const [moreOpen, setMoreOpen] = usePersistentState("front:menu-mas", false);
  const go = (item: NavItem) => { onNav(item.view, item.tab); onClose(); };
  const isActive = (item: NavItem) => view === item.view;
  const moreActive = NAV_MORE.some(isActive);

  if (collapsed) {
    return (
      <aside className={`${open ? "flex" : "hidden"} safe-modal fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:static lg:z-auto lg:flex lg:w-16 lg:shrink-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <nav className="safe-menu scroll-thin flex h-full w-16 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-3" aria-label="Navegación principal plegada">
          <Button variant="ghost" size="icon" className="size-10" onClick={onToggle} aria-label="Desplegar menú"><PanelLeftOpen className="size-[18px]" /></Button>
          <div className="my-1 h-px w-8 bg-border" />
          {NAV_TOP.map((item) => <NavButton key={item.view} item={item} active={isActive(item)} onClick={() => go(item)} compact />)}
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mt-1.5 flex flex-col items-center gap-1 border-t border-border pt-1.5">
              {group.items.map((item) => <NavButton key={item.view} item={item} active={isActive(item)} onClick={() => go(item)} compact />)}
            </div>
          ))}
          <div className="mt-1.5 flex flex-col items-center gap-1 border-t border-border pt-1.5">
            {NAV_MORE.map((item) => <NavButton key={item.view} item={item} active={isActive(item)} onClick={() => go(item)} compact />)}
          </div>
          <div className="mt-auto pt-2"><StatusDot onClick={() => onNav("ajustes", "sistema")} /></div>
        </nav>
      </aside>
    );
  }

  return (
    <aside className={`${open ? "flex" : "hidden"} safe-modal fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:static lg:z-auto lg:flex lg:w-[248px] lg:shrink-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <nav className="safe-menu flex h-full w-[280px] flex-col border-r border-border bg-card lg:w-[248px]" aria-label="Navegación principal">
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-3">
          <div className="mb-3 flex items-center gap-2.5 px-1">
            <LogoMark size={36} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[17px] font-extrabold leading-tight tracking-tight">WILLY AI</p>
              <p className="truncate text-[11px] leading-tight text-muted-foreground">Crea. Desarrolla. Sin límites.</p>
            </div>
            <Button variant="ghost" size="icon" className="hidden size-8 lg:inline-flex" onClick={onToggle} aria-label="Plegar menú"><PanelLeftClose className="size-4" /></Button>
            <Button variant="ghost" size="icon" className="size-8 lg:hidden" onClick={onClose} aria-label="Cerrar menú"><X className="size-5" /></Button>
          </div>

          <div className="space-y-0.5">
            {NAV_TOP.map((item) => <NavButton key={item.view} item={item} active={isActive(item)} onClick={() => go(item)} />)}
          </div>
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mt-4 space-y-0.5">
              <p className="mb-1 px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{group.title}</p>
              {group.items.map((item) => <NavButton key={item.view} item={item} active={isActive(item)} onClick={() => go(item)} />)}
            </div>
          ))}
          <div className="mt-4 space-y-0.5">
            <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen}
              className={`flex w-full items-center gap-2 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${moreActive && !moreOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              {moreOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}Más
            </button>
            {moreOpen && NAV_MORE.map((item) => <NavButton key={item.view} item={item} active={isActive(item)} onClick={() => go(item)} />)}
          </div>
        </div>
        <div className="shrink-0 px-3 pb-3">
          <StatusCard onDetails={() => { onNav("ajustes", "sistema"); onClose(); }} />
        </div>
      </nav>
    </aside>
  );
}

// ───────────────────────────────────────────────────────────────────────────── tarjeta «Estado de WILLY»

function StatusDot({ onClick }: { onClick: () => void }) {
  const health = useHealth();
  return (
    <button type="button" onClick={onClick} title={`Estado de WILLY: ${healthText(health)}`} aria-label={`Estado de WILLY: ${healthText(health)}`} className="grid size-10 place-items-center rounded-xl hover:bg-accent/60">
      <span className={`size-2.5 rounded-full ${TONE_DOT[healthTone(health)]}`} />
    </button>
  );
}

function StatusCard({ onDetails }: { onDetails: () => void }) {
  const health = useHealth();
  const local = useLocalEngine();
  const work = useWork();
  const ai = useExternalAi();
  const pick = useAiPick();
  const policy = aiPolicyOf(pick, ai.status);
  const tone = healthTone(health);
  const worst = tone === "fallo" || local.state === "parado" ? "fallo" : tone === "aviso" || work.failed > 0 || work.waiting > 0 ? "aviso" : tone === "ok" ? "ok" : "neutro";
  const headline = worst === "ok" ? "Todo correcto" : worst === "aviso" ? "Con avisos" : worst === "fallo" ? "Necesita revisión" : "Comprobando…";
  const systemText = health.state === "funcionando" ? "Normal" : health.state === "con avisos" ? "Con avisos" : health.state === "con fallos" ? "Con fallos" : health.state === "sin-respuesta" ? "Sin respuesta" : "Comprobando…";
  const projectsText = work.working > 0 ? `${work.working} trabajando` : work.waiting > 0 ? `${work.waiting} esperando` : "En reposo";
  const rows: Array<[string, string, string]> = [
    ["IA", policy.label, policy.detail],
    ["Local", local.text, local.state === "activo" ? `${local.models} modelo(s) instalados` : local.state === "parado" ? "La IA de tu equipo no responde" : "Leyendo el estado del equipo"],
    ["Proyectos", projectsText, work.working > 0 ? "WILLY está trabajando ahora mismo" : "Ningún trabajo en marcha"],
    ["Sistema", systemText, health.report ? `${health.report.checks.filter((c) => c.status === "ok").length} de ${health.report.checks.length} comprobaciones correctas` : "Salud del programa"],
  ];
  return (
    <div className="rounded-2xl border border-border bg-background/70 p-3" aria-label="Estado de WILLY">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold"><CircleDot className="size-4 text-primary" />Estado de WILLY</div>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span className={`size-2 rounded-full ${TONE_DOT[worst]}`} aria-hidden="true" />{headline}</div>
      <dl className="space-y-1 text-xs">
        {rows.map(([label, value, title]) => (
          <div key={label} className="flex items-center justify-between gap-2" title={title}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate font-semibold text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={onDetails} className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-primary hover:bg-accent/70">
        Ver detalles <ArrowRight className="size-3.5" />
      </button>
    </div>
  );
}

