import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Code2,
  Database,
  Menu,
  MessageSquareText,
  Moon,
  Play,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useDarkTheme } from "@/hooks/use-dark-theme";

import { Button } from "@/components/ui/button";
import { authService } from "@/services/auth-service";
import { APP_VERSION } from "@/lib/version";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WILLY AI — Crea. Desarrolla. Sin límites." },
      { name: "description", content: "Convierte una idea en un producto digital completo con WILLY AI." },
      { property: "og:title", content: "WILLY AI — Crea. Desarrolla. Sin límites." },
      { property: "og:description", content: "Convierte una idea en un producto digital completo con WILLY AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const benefits = [
  { icon: Bot, title: "IA que construye", copy: "De la idea al código con agentes especializados." },
  { icon: ShieldCheck, title: "Privacidad total", copy: "Tu trabajo y tus datos siempre bajo tu control." },
  { icon: Code2, title: "Entorno completo", copy: "Chat, editor, archivos y vista previa en un solo lugar." },
  { icon: Zap, title: "100% en tu equipo", copy: "Preparado para conectar con tus modelos locales." },
];

function Index() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "recover" | null>(null);
  const navigate = useNavigate();
  const [infoPanel, setInfoPanel] = useState<"privacy" | "terms" | "contact" | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [dark, setDark] = useDarkTheme();

  useEffect(() => {
    const closeDesktopMenu = () => {
      if (window.innerWidth >= 1024) setMobileOpen(false);
    };
    window.addEventListener("resize", closeDesktopMenu);
    return () => window.removeEventListener("resize", closeDesktopMenu);
  }, []);

  const toggleTheme = () => {
    const nextDark = !dark;
    setDark(nextDark);
    setMobileOpen(false);
    document.documentElement.classList.toggle("dark", nextDark);
    window.localStorage.setItem("willy-theme", nextDark ? "dark" : "light");
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileOpen(false);
  };

  const submitAccess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = (new FormData(form).get("email") as string | null)?.trim() ?? "";
    if (!email) return;
    setSubmitted(true);
    const res = await authService.signIn({ name: email.split("@")[0] ?? "Invitado", email });
    if (res.ok) void navigate({ to: "/app" });
  };


  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-xl">
        <div className="safe-header mx-auto grid h-16 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:px-8">
          <Button variant="ghost" onClick={() => scrollTo("inicio")} className="min-w-0 justify-self-start px-0 hover:bg-transparent" aria-label="Ir al inicio">
            <LogoMark />
            <span className="truncate font-display text-base font-bold">WILLY AI</span>
          </Button>
          <nav className="hidden items-center gap-1 lg:flex xl:gap-4" aria-label="Navegación principal">
            <Button variant="ghost" size="sm" onClick={() => scrollTo("producto")}>Producto</Button>
            <Button variant="ghost" size="sm" onClick={() => scrollTo("funciones")}>Funcionalidades</Button>
            <Button variant="ghost" size="sm" onClick={() => scrollTo("precios")}>Precios</Button>
            <Button variant="ghost" size="sm" onClick={() => scrollTo("recursos")}>Recursos <ChevronDown className="size-3.5" /></Button>
          </nav>
          <div className="hidden shrink-0 items-center justify-self-end gap-2 lg:flex">
            <Button variant="ghost" size="sm" onClick={() => setAuthMode("login")}>Iniciar sesión</Button>
            <Button variant="secondary" size="sm" onClick={() => void navigate({ to: "/app" })}>Ver panel <ArrowRight className="size-3.5" /></Button>
            <Button size="sm" onClick={() => setAuthMode("register")}>Comenzar <ArrowRight className="size-3.5" /></Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={dark ? "Activar tema claro" : "Activar tema oscuro"} title={dark ? "Tema claro" : "Tema oscuro"}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
          <div className="flex shrink-0 items-center gap-1 lg:hidden">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={dark ? "Activar tema claro" : "Activar tema oscuro"}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setMobileOpen((value) => !value)} aria-label="Abrir menú">
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          </div>
        </div>
        {mobileOpen && (
          <nav className="safe-menu max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-border bg-background px-4 py-4 sm:px-6 lg:hidden">
            <div className="mx-auto flex max-w-3xl flex-col gap-1">
              {[{ label: 'Producto', id: 'producto' }, { label: 'Funcionalidades', id: 'funciones' }, { label: 'Precios', id: 'precios' }, { label: 'Recursos', id: 'recursos' }].map(({ label, id }) => (
                <Button key={id} variant="ghost" className="justify-start" onClick={() => scrollTo(id)}>{label}</Button>
              ))}
              <Button variant="secondary" className="mt-3" onClick={() => { setMobileOpen(false); setAuthMode("login"); }}>Iniciar sesión</Button>
              <Button variant="secondary" onClick={() => { setMobileOpen(false); void navigate({ to: "/app" }); }}>Ver panel</Button>
              <Button onClick={() => { setMobileOpen(false); setAuthMode("register"); }}>Comenzar</Button>
            </div>
          </nav>
        )}
      </header>

      <section id="inicio" className="surface-signature relative pt-16 lg:min-h-[760px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_42%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_34%)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-16 md:gap-14 md:py-20 lg:min-h-[700px] lg:grid-cols-2 lg:px-8">
          <div className="mx-auto min-w-0 max-w-2xl animate-rise text-center lg:mx-0 lg:text-left">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-brand-cyan">
              <Sparkles className="size-3.5" /> La nueva forma de crear software
            </div>
            <h1 className="font-display text-4xl font-bold leading-[1.05] sm:text-6xl lg:text-7xl">
              Crea. Desarrolla.<br /><span className="text-brand-gradient">Sin límites.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg lg:mx-0">
              Convierte una idea en un producto digital real. Describe lo que necesitas y WILLY AI diseña, programa y mejora contigo.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <Button size="lg" className="w-full sm:w-auto" onClick={() => setAuthMode("register")}>Comenzar ahora <ArrowRight className="size-4" /></Button>
              <Button size="lg" className="w-full sm:w-auto" variant="secondary" onClick={() => setDemoOpen(true)}><Play className="size-4 fill-current" /> Ver demostración</Button>
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-3 text-xs text-muted-foreground lg:justify-start">
              {['Sin tarjeta', 'Privacidad total', 'Listo en minutos'].map((item) => <span key={item} className="flex items-center gap-2"><Check className="size-3.5 text-brand-cyan" />{item}</span>)}
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section id="funciones" className="border-y border-border bg-panel py-8">
        <div className="mx-auto grid max-w-7xl divide-y divide-border px-4 sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:px-6 lg:grid-cols-4 lg:px-8">
          {benefits.map(({ icon: Icon, title, copy }) => (
            <article key={title} className="grid min-h-32 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 px-5 py-6">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-brand-cyan"><Icon className="size-5" /></div>
              <div><h2 className="text-sm font-bold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{copy}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section id="producto" className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center"><p className="text-sm font-bold text-brand-cyan">UN EQUIPO, NO UNA HERRAMIENTA</p><h2 className="mt-3 font-display text-3xl font-bold sm:text-5xl">Todo lo que necesitas para pasar de idea a producto.</h2></div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
            {[{ icon: MessageSquareText, title: 'Describe tu visión', copy: 'Habla con WILLY AI de forma natural. Entiende objetivos, contexto y prioridades.' }, { icon: Bot, title: 'Los agentes construyen', copy: 'Diseño, programación y pruebas trabajan coordinados sobre tu proyecto.' }, { icon: Database, title: 'Tú mantienes el control', copy: 'Revisa cada cambio, conecta tus servicios y exporta el código cuando quieras.' }].map(({ icon: Icon, title, copy }, index) => (
              <article key={title} className="flex min-h-80 flex-col items-center bg-card p-6 text-center sm:p-8"><span className="font-display text-sm text-primary">0{index + 1}</span><Icon className="mt-8 size-7 text-brand-cyan sm:mt-12" /><h3 className="mt-5 font-display text-xl font-bold">{title}</h3><p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{copy}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section id="precios" className="border-y border-border bg-panel py-16 sm:py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 text-center sm:px-6 lg:px-8">
          <div><p className="text-sm font-bold text-brand-cyan">ACCESO INICIAL</p><h2 className="mt-3 font-display text-3xl font-bold">Empieza gratis. Escala cuando lo necesites.</h2><p className="mt-3 text-muted-foreground">Explora el espacio de trabajo sin tarjeta de crédito.</p></div>
          <Button size="lg" className="w-full sm:w-auto" onClick={() => setAuthMode("register")}>Solicitar acceso <ArrowRight className="size-4" /></Button>
        </div>
      </section>

      <section id="recursos" className="bg-background py-16 sm:py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 text-center sm:px-6 lg:px-8">
          <div><p className="text-sm font-bold text-brand-cyan">RECURSOS</p><h2 className="mt-3 font-display text-3xl font-bold">Construye con claridad.</h2><p className="mx-auto mt-3 max-w-xl text-muted-foreground">Guías, ejemplos y documentación estarán disponibles dentro de tu espacio de trabajo.</p></div>
          <Button className="w-full sm:w-auto" variant="secondary" onClick={() => setDemoOpen(true)}>Explorar demostración <ArrowRight className="size-4" /></Button>
        </div>
      </section>

      <section id="acceso" className="surface-signature border-t border-border bg-panel py-16 sm:py-24">
        <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Tu próxima idea empieza aquí.</h2>
          <p className="mt-4 text-muted-foreground">Únete al acceso anticipado de WILLY AI.</p>
          {submitted ? (
            <div className="mt-8 rounded-md border border-brand-cyan/30 bg-brand-cyan/10 p-5 text-sm"><Check className="mx-auto mb-2 size-5 text-brand-cyan" />Solicitud recibida. Te avisaremos cuando tu acceso esté disponible.</div>
          ) : (
            <form onSubmit={submitAccess} className="mx-auto mt-8 flex max-w-lg flex-col gap-3 sm:flex-row">
              <label htmlFor="access-email" className="sr-only">Correo electrónico</label>
              <input id="access-email" name="email" required type="email" placeholder="tu@email.com" className="h-12 flex-1 rounded-md border border-input bg-background px-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
               <Button type="submit" size="lg" className="w-full sm:w-auto">Solicitar acceso</Button>
            </form>
          )}
        </div>
      </section>

      <footer className="border-t border-border bg-background py-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center justify-items-center gap-4 px-4 text-center text-xs text-muted-foreground sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:px-8">
          <div className="flex items-center gap-2"><LogoMark /><span className="font-bold text-foreground">WILLY AI</span></div>
          <span className="min-w-0">© 2026 WILLY AI. Crea. Desarrolla. Sin límites. <span className="ml-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px]">v{APP_VERSION}</span></span>
          <nav className="flex flex-wrap items-center justify-center gap-1" aria-label="Información legal">
            <Button variant="ghost" size="sm" onClick={() => setInfoPanel("privacy")}>Privacidad</Button>
            <Button variant="ghost" size="sm" onClick={() => setInfoPanel("terms")}>Términos</Button>
            <Button variant="ghost" size="sm" onClick={() => setInfoPanel("contact")}>Contacto</Button>
          </nav>
        </div>
      </footer>

      {authMode && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthMode(null)} />}
      {demoOpen && <DemoModal onClose={() => setDemoOpen(false)} />}
      {infoPanel && <InfoModal kind={infoPanel} onClose={() => setInfoPanel(null)} />}
    </main>
  );
}

function LogoMark() {
  return <span className="font-display text-2xl font-bold leading-none text-brand-gradient" aria-hidden="true">W</span>;
}

function ProductPreview() {
  return (
    <div className="relative mx-auto min-w-0 w-full max-w-2xl animate-rise [animation-delay:180ms]">
      <div className="absolute -inset-6 bg-[radial-gradient(circle,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_65%)] blur-2xl" />
      <div className="relative overflow-hidden rounded-lg border border-border bg-panel-elevated shadow-2xl">
        <div className="flex h-10 items-center gap-2 border-b border-border px-4"><span className="size-2 rounded-full bg-destructive" /><span className="size-2 rounded-full bg-chart-4" /><span className="size-2 rounded-full bg-chart-2" /><span className="ml-3 text-[10px] text-muted-foreground">willy-ai / nuevo-proyecto</span></div>
        <div className="grid min-h-[320px] grid-cols-[54px_minmax(0,1fr)] sm:min-h-[390px] sm:grid-cols-[150px_minmax(0,1fr)]">
          <aside className="border-r border-border bg-background/50 p-3"><p className="mb-5 hidden text-[10px] font-bold text-muted-foreground sm:block">EXPLORADOR</p>{['app', 'components', 'styles', 'index.tsx'].map((item, index) => <div key={item} className={`mb-1 flex items-center gap-2 rounded px-2 py-2 text-[10px] ${index === 3 ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}><Code2 className="size-3" /><span className="hidden sm:inline">{item}</span></div>)}</aside>
          <div className="grid grid-rows-[1fr_auto]">
            <div className="overflow-hidden p-4 font-mono text-[9px] leading-5 text-muted-foreground sm:p-5 sm:text-[11px] sm:leading-6"><p className="truncate text-brand-violet">export default function Idea() {'{'}</p><p className="pl-2 text-brand-cyan sm:pl-4">return (</p><p className="truncate pl-4 text-foreground sm:pl-8">&lt;Product ready={'{'}true{'}'} /&gt;</p><p className="pl-2 text-brand-cyan sm:pl-4">)</p><p className="text-brand-violet">{'}'}</p><div className="mt-7 space-y-3"><div className="h-2 w-4/5 rounded bg-accent" /><div className="h-2 w-3/5 rounded bg-accent" /><div className="h-2 w-2/3 animate-code rounded bg-primary/60" /></div></div>
            <div className="border-t border-border bg-background/60 p-3 sm:p-4"><div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3"><div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold">W</div><div className="min-w-0"><p className="truncate text-[11px] font-semibold sm:text-xs">Construyendo tu idea...</p><p className="truncate text-[9px] text-muted-foreground sm:text-[10px]">Componentes, lógica y experiencia conectados</p></div><span className="size-2 shrink-0 animate-pulse rounded-full bg-brand-cyan" /></div></div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 inset-x-0 text-center font-display text-lg italic text-brand-cyan">Ideas en realidades</div>
    </div>
  );
}

function ModalShell({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return <div className="safe-modal fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-background/85 p-3 backdrop-blur-md sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={title} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-6"><div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><div className="flex min-w-0 items-center gap-2"><LogoMark /><span className="truncate font-display font-bold">{title}</span></div><Button className="shrink-0" variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></Button></div>{children}</section></div>;
}

function AuthModal({ mode, setMode, onClose }: { mode: "login" | "register" | "recover"; setMode: (mode: "login" | "register" | "recover") => void; onClose: () => void }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const titles = { login: "Acceso a WILLY AI", register: "Crea tu cuenta", recover: "Recuperar contraseña" };
  const success = { login: "Datos verificados", register: "Registro preparado", recover: "Solicitud preparada" };
  return <ModalShell onClose={onClose} title={titles[mode]}>{done ? <div className="py-8 text-center"><Check className="mx-auto size-8 text-brand-cyan" /><h3 className="mt-4 font-display text-xl font-bold">{success[mode]}</h3><p className="mt-2 text-sm text-muted-foreground">Esta acción quedará activa al conectar el sistema de cuentas.</p><Button className="mt-6" onClick={() => { onClose(); if (mode === "login") void navigate({ to: "/app" }); }}>{mode === "login" ? "Entrar al espacio de trabajo" : "Entendido"}</Button></div> : <form onSubmit={async (event) => {
    event.preventDefault();
    setError("");
    if (mode !== "login") { setDone(true); return; }
    const form = event.currentTarget;
    const email = (form.querySelector("#login-email") as HTMLInputElement).value;
    const password = (form.querySelector("#login-password") as HTMLInputElement).value;
    setBusy(true);
    const result = await authService.signIn({ name: "", email, password });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onClose();
    void navigate({ to: "/app" });
  }} className="space-y-4">
    {mode === "login" && <p className="rounded-md border border-border bg-background/60 p-3 text-xs text-muted-foreground">Acceso del dueño: <b className="text-foreground">admin@willy.ai</b> / <b className="text-foreground">WillyAdmin2026</b>. Cámbialo en Licencias.</p>}
    {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}
    {mode === "register" && <Field id="register-name" label="Nombre" type="text" placeholder="Tu nombre" />}
    <Field id={`${mode}-email`} label="Email" type="email" placeholder="tu@email.com" />
    {mode !== "recover" && <Field id={`${mode}-password`} label="Contraseña" type="password" placeholder="••••••••" minLength={6} />}
    {mode === "register" && <><Field id="register-confirm" label="Confirmar contraseña" type="password" placeholder="••••••••" minLength={6} /><label className="flex items-start gap-2 text-xs text-muted-foreground"><input required type="checkbox" className="mt-0.5 size-4 accent-primary" />Acepto los términos y la política de privacidad.</label></>}
    {mode === "login" && <Button variant="ghost" size="sm" className="h-auto px-0" onClick={() => setMode("recover")}>¿Olvidaste tu contraseña?</Button>}
    <Button type="submit" disabled={busy} className="w-full">{mode === "login" ? (busy ? "Comprobando..." : "Iniciar sesión") : mode === "register" ? "Crear cuenta" : "Enviar enlace"}</Button>
    <p className="text-center text-xs text-muted-foreground">{mode === "login" ? <>¿No tienes cuenta? <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setMode("register")}>Regístrate</button></> : <>¿Ya tienes cuenta? <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setMode("login")}>Inicia sesión</button></>}</p>
  </form>}</ModalShell>;
}

function Field({ id, label, type, placeholder, minLength }: { id: string; label: string; type: string; placeholder: string; minLength?: number }) {
  return <div><label htmlFor={id} className="mb-2 block text-xs font-semibold">{label}</label><input id={id} type={type} required minLength={minLength} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder={placeholder} /></div>;
}

function InfoModal({ kind, onClose }: { kind: "privacy" | "terms" | "contact"; onClose: () => void }) {
  const content = {
    privacy: { title: "Privacidad", copy: "WILLY AI protegerá los proyectos, conversaciones y datos de cada cuenta. El texto legal definitivo se incorporará antes del lanzamiento." },
    terms: { title: "Términos de uso", copy: "Las condiciones definitivas de uso, propiedad del código y límites del servicio se publicarán antes de abrir el acceso." },
    contact: { title: "Contacto", copy: "El canal oficial de soporte y su dirección de correo se añadirán cuando se definan los datos públicos del proyecto." },
  }[kind];
  return <ModalShell onClose={onClose} title={content.title}><p className="text-sm leading-7 text-muted-foreground">{content.copy}</p><Button className="mt-6 w-full" onClick={onClose}>Cerrar</Button></ModalShell>;
}

function DemoModal({ onClose }: { onClose: () => void }) {
  return <ModalShell onClose={onClose} title="WILLY AI en acción"><div className="rounded-md border border-border bg-background p-5"><div className="flex gap-3"><div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold">TÚ</div><p className="text-sm leading-6">Crea una aplicación para gestionar clientes, facturas y métricas.</p></div><div className="my-5 h-px bg-border" /><div className="flex gap-3"><div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-brand-cyan"><Bot className="size-4" /></div><div><p className="text-sm font-semibold">Plan preparado</p><ul className="mt-3 space-y-2 text-xs text-muted-foreground">{['Estructura y navegación', 'Datos y autenticación', 'Panel y métricas', 'Pruebas y entrega'].map((item) => <li key={item} className="flex items-center gap-2"><Check className="size-3.5 text-brand-cyan" />{item}</li>)}</ul></div></div></div><Button className="mt-5 w-full" onClick={onClose}>Continuar explorando</Button></ModalShell>;
}