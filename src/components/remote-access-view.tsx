import { useCallback, useEffect, useState } from "react";
import {
  Check, CheckCircle2, Clipboard, FileText, HardDrive, Loader2, MonitorUp, Power, PowerOff,
  RefreshCw, ShieldCheck, Terminal, Wifi, WifiOff, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard } from "@/components/panel-card";

type Pending = { id: string; name: string; summary: string; args?: unknown; createdAt: number };
type Status = {
  willyAgent: {
    installed: boolean;
    running: boolean;
    port: number;
    mcpUrl: string;
    detail: string;
    approvalMode: string;
    pending: Pending[];
  };
  desktopCommander: { installed: boolean; running: boolean; pids: number[]; detail: string };
  willyRemote: { running: boolean; port: number; detail: string };
};

async function request(action?: string, id?: string): Promise<{ ok: boolean; status?: Status; error?: string }> {
  try {
    const res = action
      ? await fetch("/api/remote-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...(id ? { id } : {}) }),
        })
      : await fetch("/api/remote-access", { cache: "no-store" });
    return (await res.json()) as { ok: boolean; status?: Status; error?: string };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

function StatePill({ on, text }: { on: boolean; text: string }) {
  return <span className={"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold " + (on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-border bg-muted text-muted-foreground")}>
    {on ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}{text}
  </span>;
}

export function RemoteAccessView({ ping }: { ping: (message: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const res = await request();
    if (res.ok && res.status) { setStatus(res.status); setError(""); }
    else if (res.error) setError(res.error);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (action: string, label: string, id?: string) => {
    if (busy) return;
    setBusy(id ? action + ":" + id : action); setError("");
    const res = await request(action, id);
    setBusy("");
    if (res.status) setStatus(res.status);
    if (!res.ok) { setError(res.error ?? "No se pudo completar la acción."); ping("⚠️ " + (res.error ?? "No se pudo completar la acción remota.")); return; }
    ping(label);
  };

  const copyMcp = async () => {
    const value = status?.willyAgent.mcpUrl;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return <div className="min-w-0 space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><MonitorUp className="size-6 shrink-0 text-primary" /><h1 className="text-2xl font-bold">Equipo remoto</h1></div>
        <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">WILLY Remote Agent es el agente propio de WILLY para trabajar en tu PC sin depender de Desktop Commander. Por defecto está cerrado a localhost y cada acción sobre el equipo exige aprobación en esta pantalla.</p>
      </div>
      <Button variant="outline" className="w-full gap-2 sm:w-auto" onClick={() => void refresh()} disabled={Boolean(busy)}><RefreshCw className="size-4" />Actualizar estado</Button>
    </div>

    {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

    <PanelCard className="space-y-4 border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><p className="font-bold">WILLY Remote Agent</p><span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">PROPIO</span></div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Agente MCP local de WILLY: archivos, terminal, procesos, sistema, apertura de URLs y captura de pantalla. Todo queda auditado y las operaciones esperan tu aprobación.</p>
        </div>
        <StatePill on={Boolean(status?.willyAgent.running)} text={status?.willyAgent.running ? "Activo" : "Detenido"} />
      </div>

      <p className="text-sm text-muted-foreground">{status?.willyAgent.detail ?? "Comprobando…"}</p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-background/70 p-3"><HardDrive className="mb-2 size-4 text-primary"/><p className="text-xs font-semibold">Archivos</p><p className="mt-1 text-[10px] text-muted-foreground">Listar, leer, escribir, reemplazar y borrar con permiso.</p></div>
        <div className="rounded-lg border border-border bg-background/70 p-3"><Terminal className="mb-2 size-4 text-primary"/><p className="text-xs font-semibold">Terminal</p><p className="mt-1 text-[10px] text-muted-foreground">PowerShell/shell y procesos, siempre con aprobación.</p></div>
        <div className="rounded-lg border border-border bg-background/70 p-3"><MonitorUp className="mb-2 size-4 text-primary"/><p className="text-xs font-semibold">Pantalla</p><p className="mt-1 text-[10px] text-muted-foreground">Captura de pantalla aprobada y apertura de URLs.</p></div>
        <div className="rounded-lg border border-border bg-background/70 p-3"><FileText className="mb-2 size-4 text-primary"/><p className="text-xs font-semibold">Auditoría</p><p className="mt-1 text-[10px] text-muted-foreground">Registro local de solicitudes, aprobaciones, denegaciones y ejecución.</p></div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button className="w-full gap-2 sm:w-auto" disabled={busy !== "" || status?.willyAgent.running || status?.willyAgent.installed === false} onClick={() => void run("start-agent", "WILLY Remote Agent activado.")}>
          {busy === "start-agent" ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}Activar WILLY Agent
        </Button>
        <Button variant="outline" className="w-full gap-2 sm:w-auto" disabled={busy !== "" || !status?.willyAgent.running} onClick={() => void run("stop-agent", "WILLY Remote Agent detenido.")}><PowerOff className="size-4" />Detener</Button>
      </div>

      <div className="rounded-lg border border-border bg-background/70 p-3">
        <p className="text-[11px] font-semibold">Endpoint MCP local</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-2.5 py-2 text-xs">{status?.willyAgent.mcpUrl ?? "http://127.0.0.1:4050/mcp"}</code>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void copyMcp()} disabled={!status?.willyAgent.running}>{copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}{copied ? "Copiado" : "Copiar URL"}</Button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">El agente escucha en 127.0.0.1 por defecto. Para conectarlo desde fuera sin publicar el PC en Internet, usa un túnel MCP seguro. El agente no ejecuta ninguna acción solicitada hasta que la apruebes aquí.</p>
      </div>
    </PanelCard>

    <PanelCard className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">Aprobaciones pendientes</p><p className="mt-1 text-xs text-muted-foreground">Modo actual: {status?.willyAgent.approvalMode ?? "Preguntar siempre"}. Una IA puede solicitar una acción, pero WILLY no la ejecuta hasta tu aprobación.</p></div><span className="rounded-full border border-border bg-muted px-2 py-1 text-xs font-bold">{status?.willyAgent.pending.length ?? 0}</span></div>
      {!status?.willyAgent.pending.length ? <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No hay acciones esperando permiso.</p> : <div className="space-y-2">
        {status.willyAgent.pending.map((item) => <div key={item.id} className="rounded-lg border border-border bg-background p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><p className="text-xs font-bold">{item.name}</p><p className="mt-1 break-words text-xs text-muted-foreground">{item.summary}</p><p className="mt-1 text-[10px] text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p></div>
            <div className="flex gap-2"><Button size="sm" className="gap-1.5" disabled={busy !== ""} onClick={() => void run("approve-agent", "Acción de WILLY Agent aprobada y ejecutada.", item.id)}>{busy === "approve-agent:" + item.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Permitir</Button><Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== ""} onClick={() => void run("deny-agent", "Acción remota denegada.", item.id)}><X className="size-3.5" />Denegar</Button></div>
          </div>
        </div>)}
      </div>}
    </PanelCard>

    <div className="grid gap-4 lg:grid-cols-2">
      <PanelCard className="space-y-3">
        <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">Servidor remoto móvil de WILLY</p><p className="mt-1 text-xs text-muted-foreground">Canal propio para móvil u otro dispositivo de tu red, separado del agente MCP.</p></div><StatePill on={Boolean(status?.willyRemote.running)} text={status?.willyRemote.running ? "Activo" : "Detenido"} /></div>
        <p className="text-sm text-muted-foreground">{status?.willyRemote.detail ?? "Comprobando…"}</p>
        <div className="flex flex-col gap-2 sm:flex-row"><Button className="gap-2" disabled={busy !== "" || status?.willyRemote.running} onClick={() => void run("start-willy", "Servidor remoto móvil de WILLY activado.")}>{busy === "start-willy" ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}Activar servidor</Button><Button variant="outline" className="gap-2" disabled={busy !== "" || !status?.willyRemote.running} onClick={() => void run("stop-willy", "Servidor remoto móvil detenido.")}><PowerOff className="size-4" />Detener</Button></div>
      </PanelCard>

      <PanelCard className="space-y-3 opacity-80">
        <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">Desktop Commander · compatibilidad</p><p className="mt-1 text-xs text-muted-foreground">Se conserva como alternativa, pero WILLY Remote Agent ya no depende de él.</p></div><StatePill on={Boolean(status?.desktopCommander.running)} text={status?.desktopCommander.running ? "Activo" : "Opcional"} /></div>
        <p className="text-sm text-muted-foreground">{status?.desktopCommander.detail ?? "Comprobando…"}</p>
        {status?.desktopCommander.installed && <div className="flex flex-col gap-2 sm:flex-row"><Button variant="outline" className="gap-2" disabled={busy !== "" || status?.desktopCommander.running} onClick={() => void run("start-desktop", "Desktop Commander Remote activado como compatibilidad.")}><Power className="size-4" />Activar legado</Button><Button variant="outline" className="gap-2" disabled={busy !== "" || !status?.desktopCommander.running} onClick={() => void run("stop-desktop", "Desktop Commander Remote detenido.")}><PowerOff className="size-4" />Detener</Button></div>}
      </PanelCard>
    </div>

    <PanelCard className="space-y-3">
      <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><p className="font-semibold">Seguridad de WILLY Remote Agent</p></div>
      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />Escucha solo en localhost por defecto; no publica tu PC en Internet.</p>
        <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />Cada acción sobre el equipo entra en una cola de aprobación local.</p>
        <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />Las operaciones quedan auditadas en datos-privados/willy-agent/audit.jsonl.</p>
        <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />Puedes detener el agente inmediatamente desde esta pantalla.</p>
      </div>
    </PanelCard>
  </div>;
}
