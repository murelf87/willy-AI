// Ruta /admin — panel privado del propietario. La puerta de entrada es el rol
// de la sesión; la autorización real la validará el backend (TODO(backend)),
// pero el frontend nunca muestra nada sin el rol correcto.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity, ArrowLeft, CalendarRange, Cpu, FolderKanban, Gauge, Globe, Lock, Presentation, ToggleLeft, ToggleRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusScreen } from "@/components/status-screens";
import { authService, useSession } from "@/services/auth-service";
import { buildDemoHtml, buildReport } from "@/services/demo-service";
import { downloadFile } from "@/lib/workspace-store";
import { aiService } from "@/services/ai-service";
import { useFlags, setFlag, readFlags, DEFAULT_FLAGS } from "@/services/flags";
import { DEFAULT_SETTINGS, useSettings } from "@/lib/workspace-store";
import { useProjectsDetail } from "@/services/project-service";
import type { Flags } from "@/services/flags";

const FLAG_LABEL: Record<keyof Flags, string> = {
  visualEditor: "Modo «Editar interfaz»",
  draftPublish: "Borrador / publicado",
  telemetry: "Diagnóstico técnico",
};

function AdminPanel() {
  const { session } = useSession();
  const flags = useFlags();
  const [settings] = useSettings();
  const { projects, versions } = useProjectsDetail();
  const [health, setHealth] = useState<{ state: "checking" | "ok" | "fail"; detail: string }>({
    state: "checking",
    detail: "Comprobando…",
  });

  useEffect(() => {
    let alive = true;
    void aiService.health(settings.endpoint).then((r) => {
      if (!alive) return;
      setHealth(r.ok ? { state: "ok", detail: `Motor local respondiendo en ${settings.endpoint}` } : { state: "fail", detail: r.error });
    });
    return () => {
      alive = false;
    };
  }, [settings.endpoint]);

  const report = buildReport(projects, versions);
  const t = report.totals;

  const exportAudit = () => {
    const html = buildDemoHtml(report, "WILLY AI · Admin");
    downloadFile("willy-ai-auditoria.html", html, "text/html;charset=utf-8");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="safe-header sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur">
        <Button variant="ghost" size="icon" className="size-9" onClick={() => { window.location.href = "/app"; }} aria-label="Volver al panel">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold">Panel del propietario</p>
          <p className="truncate text-[11px] text-muted-foreground">{session?.email}</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-semibold text-primary">
          <Lock className="size-3" />Solo propietario
        </span>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: FolderKanban, label: "Proyectos", value: t.projects },
            { icon: CalendarRange, label: "Versiones", value: t.versions },
            { icon: Cpu, label: "Archivos", value: t.files },
            { icon: Gauge, label: "Líneas", value: t.lines },
          ].map(({ icon: Icon, label, value }) => (
            <Card key={label} className="flex items-center gap-3">
              <Icon className="size-5 shrink-0 text-primary" />
              <div>
                <p className="font-display text-xl font-bold">{value}</p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
              </div>
            </Card>
          ))}
        </section>

        <Card>
          <p className="text-sm font-semibold">Motor de IA local</p>
          <p className="mt-1 flex items-center gap-2 text-sm">
            {health.state === "ok" && <span className="size-2 rounded-full bg-emerald-500" />}
            {health.state === "checking" && <span className="size-2 animate-pulse rounded-full bg-amber-500" />}
            {health.state === "fail" && <span className="size-2 rounded-full bg-red-500" />}
            <span className="text-muted-foreground">{health.detail}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Modelo activo: {settings.model}</p>
        </Card>

        <Card>
          <p className="text-sm font-semibold">Funciones experimentales</p>
          <p className="mt-1 text-xs text-muted-foreground">Se activan para probarlas sin afectar a lo que ya funciona.</p>
          <div className="mt-3 space-y-2">
            {(Object.keys(FLAG_LABEL) as Array<keyof Flags>).map((name) => (
              <div key={name} className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2">
                <span className="min-w-0 flex-1 text-sm">{FLAG_LABEL[name]}</span>
                <button
                  onClick={() => setFlag(name, !flags[name])}
                  aria-label={`${FLAG_LABEL[name]}: ${flags[name] ? "activada" : "desactivada"}`}
                  className="text-primary"
                >
                  {flags[name] ? <ToggleRight className="size-6" /> : <ToggleLeft className="size-6" />}
                </button>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="text-sm font-semibold">Diagnóstico y demo</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Telemetría técnica: {readFlags().telemetry ? "activada (solo en tu equipo)" : "desactivada"}. Ajustes del motor: {settings.endpoint} · modelos en {DEFAULT_SETTINGS.modelsPath ? "carpeta local" : "—"}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" className="gap-2" onClick={exportAudit}>
              <Presentation className="size-4" />Descargar informe de avance
            </Button>
            <a
              href="https://status.ollama.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              <Globe className="size-4" />Guía del motor local
            </a>
          </div>
        </Card>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="size-3.5" />Cada operación sensible se validará también en el backend cuando se conecte (TODO registrado en los servicios).
        </p>
      </main>
    </div>
  );
}

function AdminGate() {
  const { session, ready, isOwner } = useSession();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setChecking(false), 250);
    return () => window.clearTimeout(timer);
  }, []);

  if (!ready || checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (!session || !isOwner) {
    return <StatusScreen kind="403" />;
  }

  return <AdminPanel />;
}

export const Route = createFileRoute("/admin")({
  component: AdminGate,
  head: () => ({
    meta: [
      { title: "WILLY AI · Panel del propietario" },
      { name: "description", content: "Área privada del propietario de WILLY AI." },
      { name: "robots", content: "noindex" },
    ],
  }),
});
