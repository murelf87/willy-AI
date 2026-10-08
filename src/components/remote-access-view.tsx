import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2, CircleHelp, HardDrive, KeyRound, Loader2, MonitorUp, Power, PowerOff,
  RefreshCw, ShieldCheck, Terminal, Wifi, WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard } from "@/components/panel-card";

type AgentCapabilities = {
  ok: boolean;
  actions: Array<{ name: string; sensitive: boolean }>;
  allowedRoots: string[];
  fullAccess: boolean;
  approvalMode: string;
};

type AgentHealth = {
  ok: boolean;
  version: string;
  pid: number;
  port: number;
  uptime: number;
  pending: number;
  approvalMode: string;
};

type Status = {
  willyAgent: {
    installed: boolean;
    running: boolean;
    detail: string;
    health: AgentHealth | null;
    capabilities: AgentCapabilities | null;
  };
  desktopCommander: { installed: boolean; running: boolean; pids: number[]; detail: string };
  willyRemote: { running: boolean; port: number; detail: string };
};

type Approval = {
  id: string;
  kind: string;
  args: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  status: string;
  requester: string;
};

type ApiResponse = {
  ok: boolean;
  status?: Status;
  approvals?: Approval[];
  result?: unknown;
  error?: string;
};

async function request(action?: string, extra: Record<string, unknown> = {}): Promise<ApiResponse> {
  try {
    const res = action
      ? await fetch("/api/remote-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        })
      : await fetch("/api/remote-access", { cache: "no-store" });
    return await res.json() as ApiResponse;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function StatePill({ on, text }: { on: boolean; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-border bg-muted text-muted-foreground"}`}>
      {on ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
      {text}
    </span>
  );
}

function capabilityLabel(name: string) {
  const map: Record<string, string> = {
    "system.info": "Sistema",
    "fs.list": "Listar archivos",
    "fs.stat": "Datos de archivo",
    "fs.read": "Leer archivos",
    "fs.write": "Escribir archivos",
    "fs.mkdir": "Crear carpetas",
    "fs.delete": "Borrar",
    "fs.move": "Mover",
    "fs.copy": "Copiar",
    "shell.exec": "Terminal",
    "process.list": "Procesos",
    "process.kill": "Cerrar procesos",
    "screenshot.capture": "Capturas",
  };
  return map[name] ?? name;
}

export function RemoteAccessView({ ping }: { ping: (message: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const res = await request();
    if (res.ok && res.status) {
      setStatus(res.status);
      setError("");
      if (res.status.willyAgent.running) {
        const pending = await request("agent-approvals");
        if (pending.ok && pending.approvals) setApprovals(pending.approvals.filter((x) => x.status === "pending"));
      } else {
        setApprovals([]);
      }
    } else if (res.error) {
      setError(res.error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (action: string, label: string, extra: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(action);
    setError("");
    const res = await request(action, extra);
    setBusy("");
    if (res.status) setStatus(res.status);
    if (res.approvals) setApprovals(res.approvals.filter((x) => x.status === "pending"));
    if (!res.ok) {
      const message = res.error ?? "No se pudo completar la acción.";
      setError(message);
      ping("⚠️ " + message);
      return;
    }
    ping(label);
  };

  const agent = status?.willyAgent;
  const caps = agent?.capabilities?.actions ?? [];

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MonitorUp className="size-6 shrink-0 text-primary" />
            <h1 className="text-xl font-bold sm:text-2xl">Equipo remoto</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            WILLY Remote Agent es el puente propio de WILLY para trabajar en este PC sin depender de Desktop Commander.
            Las acciones sensibles requieren aprobación local por defecto y quedan registradas.
          </p>
        </div>
        <Button variant="outline" className="w-full gap-2 sm:w-auto" onClick={() => void refresh()} disabled={Boolean(busy)}>
          <RefreshCw className="size-4" />Actualizar estado
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <PanelCard className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                <ShieldCheck className="size-5 text-primary" />
              </div>
              <div>
                <p className="font-bold">WILLY Remote Agent</p>
                <p className="text-xs text-muted-foreground">Agente remoto propio · principal</p>
              </div>
              <StatePill on={Boolean(agent?.running)} text={agent?.running ? "Activo" : "Detenido"} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{agent?.detail ?? "Comprobando…"}</p>

            {agent?.running && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-background/80 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Versión</p>
                  <p className="mt-1 text-sm font-bold">{agent.health?.version ?? "—"}</p>
                </div>
                <div className="rounded-lg border border-border bg-background/80 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Herramientas</p>
                  <p className="mt-1 text-sm font-bold">{caps.length}</p>
                </div>
                <div className="rounded-lg border border-border bg-background/80 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Aprobaciones</p>
                  <p className="mt-1 text-sm font-bold">{agent.health?.pending ?? 0} pendiente(s)</p>
                </div>
                <div className="rounded-lg border border-border bg-background/80 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Puerto local</p>
                  <p className="mt-1 text-sm font-bold">{agent.health?.port ?? 4050}</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto lg:flex-col">
            <Button
              className="w-full gap-2"
              disabled={busy !== "" || agent?.running || agent?.installed === false}
              onClick={() => void run("start-agent", "WILLY Remote Agent activado.")}
            >
              {busy === "start-agent" ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
              Activar agente propio
            </Button>
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={busy !== "" || !agent?.running}
              onClick={() => void run("test-agent", "Prueba de lectura del agente superada.")}
            >
              <Terminal className="size-4" />Probar agente
            </Button>
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={busy !== "" || !agent?.running}
              onClick={() => void run("stop-agent", "WILLY Remote Agent detenido.")}
            >
              <PowerOff className="size-4" />Detener
            </Button>
          </div>
        </div>

        {!!caps.length && (
          <div className="mt-4 border-t border-border/70 pt-4">
            <p className="text-xs font-semibold">Capacidades disponibles</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {caps.map((cap) => (
                <span
                  key={cap.name}
                  className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${cap.sensitive ? "border-amber-500/30 bg-amber-500/10 text-amber-700" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"}`}
                  title={cap.sensitive ? "Requiere aprobación local por defecto" : "Solo lectura"}
                >
                  {capabilityLabel(cap.name)}{cap.sensitive ? " · permiso" : ""}
                </span>
              ))}
            </div>
            {!!agent?.capabilities?.allowedRoots?.length && (
              <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                <HardDrive className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 break-all">
                  Carpetas autorizadas: {agent.capabilities.allowedRoots.join(" · ")}
                  {agent.capabilities.fullAccess ? " · acceso completo habilitado" : ""}
                </span>
              </div>
            )}
          </div>
        )}
      </PanelCard>

      {!!approvals.length && (
        <PanelCard className="space-y-3 border-amber-500/30">
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-amber-600" />
            <p className="font-semibold">Acciones esperando tu permiso</p>
          </div>
          <div className="space-y-2">
            {approvals.map((item) => (
              <div key={item.id} className="rounded-xl border border-border bg-background p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{capabilityLabel(item.kind)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Solicitado por {item.requester}</p>
                    <pre className="mt-2 max-h-36 overflow-auto rounded-lg bg-muted/60 p-2 text-[10px] leading-4">{JSON.stringify(item.args, null, 2)}</pre>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" onClick={() => void run("agent-approve", "Acción remota aprobada.", { id: item.id })}>Permitir</Button>
                    <Button size="sm" variant="outline" onClick={() => void run("agent-deny", "Acción remota denegada.", { id: item.id })}>Denegar</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </PanelCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <PanelCard className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Desktop Commander</p>
              <p className="mt-1 text-xs text-muted-foreground">Respaldo temporal mientras validamos WILLY Remote Agent. No es necesario para que el agente propio funcione.</p>
            </div>
            <StatePill on={Boolean(status?.desktopCommander.running)} text={status?.desktopCommander.running ? "Activo" : "Detenido"} />
          </div>
          <p className="text-sm text-muted-foreground">{status?.desktopCommander.detail ?? "Comprobando…"}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={busy !== "" || status?.desktopCommander.running || status?.desktopCommander.installed === false}
              onClick={() => void run("start-desktop", "Desktop Commander Remote activado como respaldo.")}
            >
              <Power className="size-4" />Activar respaldo
            </Button>
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={busy !== "" || !status?.desktopCommander.running}
              onClick={() => void run("stop-desktop", "Desktop Commander Remote detenido.")}
            >
              <PowerOff className="size-4" />Detener
            </Button>
          </div>
        </PanelCard>

        <PanelCard className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Servidor móvil heredado</p>
              <p className="mt-1 text-xs text-muted-foreground">Canal WebSocket anterior de WILLY para móvil. Lo conservamos por compatibilidad mientras el agente propio absorbe sus funciones.</p>
            </div>
            <StatePill on={Boolean(status?.willyRemote.running)} text={status?.willyRemote.running ? "Activo" : "Detenido"} />
          </div>
          <p className="text-sm text-muted-foreground">{status?.willyRemote.detail ?? "Comprobando…"}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="w-full gap-2" disabled={busy !== "" || status?.willyRemote.running} onClick={() => void run("start-willy", "Servidor móvil heredado activado.")}>
              <Power className="size-4" />Activar
            </Button>
            <Button variant="outline" className="w-full gap-2" disabled={busy !== "" || !status?.willyRemote.running} onClick={() => void run("stop-willy", "Servidor móvil heredado detenido.")}>
              <PowerOff className="size-4" />Detener
            </Button>
          </div>
        </PanelCard>
      </div>

      <PanelCard className="space-y-3">
        <div className="flex items-center gap-2">
          <CircleHelp className="size-5 text-primary" />
          <p className="font-semibold">Cómo funciona la independencia</p>
        </div>
        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />El agente usa Node.js y APIs del sistema: no necesita Desktop Commander para archivos, terminal, procesos o capturas.</p>
          <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />Las acciones sensibles entran en una cola y esperan tu aprobación local.</p>
          <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />El acceso está limitado a las carpetas autorizadas salvo que habilites expresamente acceso completo.</p>
          <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />Cada operación queda registrada en un log de auditoría local.</p>
          <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />Incluye un endpoint MCP básico para conectar una IA compatible sin depender del proveedor del agente remoto.</p>
          <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />El token del agente se guarda solo en tu PC y nunca se muestra en esta pantalla.</p>
        </div>
      </PanelCard>
    </div>
  );
}
