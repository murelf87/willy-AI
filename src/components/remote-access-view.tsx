import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, MonitorUp, Power, PowerOff, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard } from "@/components/panel-card";

type Status = {
  desktopCommander: { installed: boolean; running: boolean; pids: number[]; detail: string };
  willyRemote: { running: boolean; port: number; detail: string };
};

async function request(action?: string): Promise<{ ok: boolean; status?: Status; error?: string }> {
  try {
    const res = action
      ? await fetch("/api/remote-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })
      : await fetch("/api/remote-access", { cache: "no-store" });
    return (await res.json()) as { ok: boolean; status?: Status; error?: string };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

function StatePill({ on, text }: { on: boolean; text: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-border bg-muted text-muted-foreground"}`}>
    {on ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}{text}
  </span>;
}

export function RemoteAccessView({ ping }: { ping: (message: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const res = await request();
    if (res.ok && res.status) { setStatus(res.status); setError(""); }
    else if (res.error) setError(res.error);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (action: string, label: string) => {
    if (busy) return;
    setBusy(action); setError("");
    const res = await request(action);
    setBusy("");
    if (res.status) setStatus(res.status);
    if (!res.ok) { setError(res.error ?? "No se pudo completar la acción."); ping(`⚠️ ${res.error ?? "No se pudo completar la acción remota."}`); return; }
    ping(label);
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><MonitorUp className="size-6 text-primary" /><h1 className="text-2xl font-bold">Equipo remoto</h1></div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Activa un puente autorizado para que una IA conectada pueda trabajar en este PC. WILLY muestra el estado real: nunca aparenta estar conectado si el agente no está activo.</p>
      </div>
      <Button variant="outline" className="gap-2" onClick={() => void refresh()} disabled={Boolean(busy)}><RefreshCw className="size-4" />Actualizar estado</Button>
    </div>

    {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

    <div className="grid gap-4 lg:grid-cols-2">
      <PanelCard className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div><p className="font-semibold">Desktop Commander Remote</p><p className="mt-1 text-xs text-muted-foreground">Puente para una IA externa autorizada, como esta conversación de ChatGPT, para inspeccionar archivos, ejecutar comandos y trabajar en tu PC.</p></div>
          <StatePill on={Boolean(status?.desktopCommander.running)} text={status?.desktopCommander.running ? "Activo" : "Detenido"} />
        </div>
        <p className="text-sm text-muted-foreground">{status?.desktopCommander.detail ?? "Comprobando…"}</p>
        <div className="flex flex-wrap gap-2">
          <Button className="gap-2" disabled={busy !== "" || status?.desktopCommander.running || status?.desktopCommander.installed === false} onClick={() => void run("start-desktop", "Desktop Commander Remote activado.")}>
            {busy === "start-desktop" ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}Activar acceso remoto
          </Button>
          <Button variant="outline" className="gap-2" disabled={busy !== "" || !status?.desktopCommander.running} onClick={() => void run("stop-desktop", "Desktop Commander Remote detenido.")}>
            <PowerOff className="size-4" />Detener
          </Button>
        </div>
        {status?.desktopCommander.running && <p className="text-xs text-muted-foreground">Proceso(s) activo(s): {status.desktopCommander.pids.join(", ") || "detectado"}. La conexión externa sigue requiriendo autorización.</p>}
      </PanelCard>

      <PanelCard className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div><p className="font-semibold">Servidor remoto de WILLY</p><p className="mt-1 text-xs text-muted-foreground">Canal propio de WILLY para móvil u otro dispositivo. Las acciones remotas se diseñaron para requerir aprobación explícita.</p></div>
          <StatePill on={Boolean(status?.willyRemote.running)} text={status?.willyRemote.running ? "Activo" : "Detenido"} />
        </div>
        <p className="text-sm text-muted-foreground">{status?.willyRemote.detail ?? "Comprobando…"}</p>
        <div className="flex flex-wrap gap-2">
          <Button className="gap-2" disabled={busy !== "" || status?.willyRemote.running} onClick={() => void run("start-willy", "Servidor remoto de WILLY activado.")}>
            {busy === "start-willy" ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}Activar servidor WILLY
          </Button>
          <Button variant="outline" className="gap-2" disabled={busy !== "" || !status?.willyRemote.running} onClick={() => void run("stop-willy", "Servidor remoto de WILLY detenido.")}>
            <PowerOff className="size-4" />Detener
          </Button>
        </div>
      </PanelCard>
    </div>

    <PanelCard className="space-y-3">
      <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><p className="font-semibold">Reglas de seguridad del acceso remoto</p></div>
      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />El estado se comprueba en directo; no se marca como conectado si el proceso no existe.</p>
        <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />Las claves de IA y credenciales no se muestran en esta pantalla.</p>
        <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />Activar el agente no concede por sí solo acceso a terceros: hace falta una conexión autorizada.</p>
        <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />Puedes detener el acceso remoto desde aquí en cualquier momento.</p>
      </div>
    </PanelCard>
  </div>;
}
