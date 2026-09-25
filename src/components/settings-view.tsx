import { useEffect, useState } from "react";
import {
  Copy, Database, FolderOpen, HardDrive, Loader2, Lock, Power, RefreshCw, RotateCw, ScrollText, Server, Smartphone,
  Stethoscope, Trash2, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelCard as Card } from "@/components/panel-card";
import { UpdateView } from "@/components/update-view";
import { StatePackCard } from "@/components/state-pack-card";
import { SectionHead, SectionTabs, StatusIcon, Toggle, toneText, type Tone } from "@/components/section-ui";
import { copyText, useSettings } from "@/lib/workspace-store";
import { usePersistentState } from "@/lib/persistent-state";
import { formatBytes } from "@/lib/profile";
import { openView } from "@/lib/background-tasks";
import { requestSectionTab, useSectionTab } from "@/lib/section-tabs";
import {
  fetchCachePreview, fetchDependencies, fetchLogs, fetchStorage, fetchSystemInfo, runDiagnosis, systemAction, waitForRestart,
  type CachePreview, type DependencyReport, type DiagReport, type LogSource, type StorageReport, type SystemInfo,
} from "@/lib/maintenance-client";
import { apiAuthService } from "@/services/api-auth-service";
import { backendOn, health, listOrganizations, refreshData, useBackend, type Organization } from "@/services/backend";
import type { Ping } from "@/types/domain";

// AJUSTES (revisión 20): lo que antes estaba repartido entre «Configuración», «Estado del sistema» y el «Workspace» global,
// ordenado en General · Sistema · Almacenamiento · Diagnóstico (y Avanzado, oculto). Cada botón hace lo que dice: reiniciar
// y detener cierran de verdad el servidor, vaciar la caché borra de verdad (y dice cuánto), y los registros nunca enseñan
// claves. Lo de la IA (Ollama, modelos, IA externas, agentes) está en el Centro de Inteligencia.

export const SETTINGS_TABS = ["general", "sistema", "almacenamiento", "diagnostico", "avanzado"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

const TAB_LABELS: ReadonlyArray<readonly [SettingsTab, string]> = [
  ["general", "General"],
  ["sistema", "Sistema"],
  ["almacenamiento", "Almacenamiento"],
  ["diagnostico", "Diagnóstico"],
  ["avanzado", "Avanzado"],
];

/** ¿Estás usando WILLY en el propio ordenador (y no desde el móvil)? Reiniciar y detener solo se ofrecen ahí. */
const onThisComputer = (): boolean => typeof window !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

const timeText = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export function SettingsView({ ping }: { ping: Ping }) {
  const [advanced, setAdvanced] = usePersistentState("ajustes:avanzado", false);
  const [tab, setTab] = useSectionTab<SettingsTab>("ajustes", SETTINGS_TABS, "general");
  const shownTab: SettingsTab = tab === "avanzado" && !advanced ? "general" : tab;
  const tabs = advanced ? TAB_LABELS : TAB_LABELS.filter(([id]) => id !== "avanzado");
  return (
    <>
      <SectionHead title="Ajustes" desc="WILLY AI en tu equipo: estado, espacio, copias, diagnóstico y avisos." />
      <SectionTabs label="Apartados de Ajustes" tabs={tabs} value={shownTab} onChange={setTab} />
      {shownTab === "general" && <GeneralTab ping={ping} />}
      {shownTab === "sistema" && <SystemTab ping={ping} />}
      {shownTab === "almacenamiento" && <StorageTab ping={ping} />}
      {shownTab === "diagnostico" && <DiagnosisTab ping={ping} />}
      {shownTab === "avanzado" && <AdvancedTab ping={ping} />}
      <div className="mt-6 flex items-center gap-3 border-t border-border pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Opciones avanzadas</p>
          <p className="text-xs text-muted-foreground">Para técnicos: piezas de compilación, datos técnicos y conexión a otro servidor.</p>
        </div>
        <Toggle
          on={advanced}
          label="Opciones avanzadas"
          onClick={() => {
            const next = !advanced;
            setAdvanced(next);
            if (next) setTab("avanzado");
            else if (tab === "avanzado") setTab("general");
          }}
        />
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────── General

function GeneralTab({ ping }: { ping: Ping }) {
  const [settings, update] = useSettings();
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Avisos</p>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm">Notificaciones</p>
            <p className="text-xs text-muted-foreground">Avisos en la campana cuando WILLY termina una tarea.</p>
          </div>
          <Toggle on={settings.notify} label="Notificaciones" onClick={() => { update({ notify: !settings.notify }); ping(settings.notify ? "Notificaciones desactivadas." : "Notificaciones activadas."); }} />
        </div>
        <div className={`flex items-center gap-3 ${settings.notify ? "" : "pointer-events-none opacity-50"}`}>
          <div className="min-w-0 flex-1">
            <p className="text-sm">Avisar de cada paso</p>
            <p className="text-xs text-muted-foreground">Incluye los pasos intermedios, no solo el resultado final.</p>
          </div>
          <Toggle on={settings.notifySteps} label="Avisar de cada paso" disabled={!settings.notify} onClick={() => { update({ notifySteps: !settings.notifySteps }); ping(settings.notifySteps ? "Solo recibirás los avisos importantes." : "Recibirás todos los pasos."); }} />
        </div>
        <div className={`flex items-center gap-3 ${settings.notify ? "" : "pointer-events-none opacity-50"}`}>
          <div className="min-w-0 flex-1">
            <p className="text-sm">Sonido del aviso</p>
            <p className="text-xs text-muted-foreground">Un pitido corto al completarse una tarea.</p>
          </div>
          <Toggle on={settings.notifySound} label="Sonido del aviso" disabled={!settings.notify} onClick={() => { update({ notifySound: !settings.notifySound }); ping(settings.notifySound ? "Sonido desactivado." : "Sonido activado."); }} />
        </div>
      </Card>
      <IphoneCard ping={ping} />
      <AccesoCard ping={ping} />
    </div>
  );
}

type AccesoEstado = { activo: boolean; configurado: boolean; sesion: boolean; local: boolean };

/** Contraseña para usar WILLY desde fuera de este ordenador (móvil por Wi-Fi, servidor en Internet). Aquí nunca se pide. */
function AccesoCard({ ping }: { ping: Ping }) {
  const [estado, setEstado] = useState<AccesoEstado | null>(null);
  const [pass, setPass] = useState("");
  const [repite, setRepite] = useState("");
  const [saving, setSaving] = useState(false);
  const load = async () => {
    try {
      const res = await fetch("/api/acceso", { cache: "no-store" });
      setEstado((await res.json()) as AccesoEstado);
    } catch {
      setEstado(null);
    }
  };
  useEffect(() => { void load(); }, []);

  const configurar = async (activo: boolean, contrasena?: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/acceso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "configurar", activo, ...(contrasena ? { contrasena } : {}) }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) return ping(`⚠️ ${data.error || "No se pudo guardar el acceso."}`);
      setPass("");
      setRepite("");
      await load();
      ping(contrasena ? (activo ? "Contraseña guardada. Desde fuera de este ordenador ya se pide." : "Contraseña guardada (el acceso sigue desactivado).") : activo ? "Acceso con contraseña activado." : "Acceso con contraseña desactivado.");
    } catch {
      ping("⚠️ El servidor de WILLY no respondió.");
    } finally {
      setSaving(false);
    }
  };

  const guardar = () => {
    if (pass.length < 8) return ping("⚠️ La contraseña debe tener al menos 8 caracteres.");
    if (pass !== repite) return ping("⚠️ Las dos contraseñas no coinciden.");
    void configurar(estado?.configurado ? estado.activo : true, pass);
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <Lock className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Acceso desde fuera (contraseña)</p>
          <p className="text-xs text-muted-foreground">Pide una contraseña cuando WILLY AI se usa desde el móvil (Wi-Fi) o desde tu servidor. En este ordenador nunca se pide.</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">Pedir contraseña fuera de este ordenador</p>
          <p className="text-xs text-muted-foreground">{estado === null ? "Comprobando…" : !estado.configurado ? "Guarda primero una contraseña." : estado.activo ? "Activado: sin la contraseña no se entra desde fuera." : "Desactivado: desde fuera se entra sin contraseña."}</p>
        </div>
        <Toggle on={!!estado?.activo} label="Pedir contraseña fuera de este ordenador" disabled={saving || !estado?.configurado} onClick={() => void configurar(!estado?.activo)} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input type="password" autoComplete="new-password" placeholder="Contraseña nueva (mínimo 8 caracteres)" value={pass} onChange={(e) => setPass(e.target.value)} disabled={saving} />
        <Input type="password" autoComplete="new-password" placeholder="Repite la contraseña" value={repite} onChange={(e) => setRepite(e.target.value)} disabled={saving} />
      </div>
      <Button size="sm" className="gap-2" disabled={saving || !pass} onClick={guardar}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}Guardar contraseña
      </Button>
    </Card>
  );
}

/** Instalador para el móvil: crea el icono de WILLY AI en la pantalla de inicio (misma red Wi-Fi). */
function IphoneCard({ ping }: { ping: Ping }) {
  const [lan, setLan] = useState<{ url: string; lan: string; port: string } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/lan");
        setLan(await res.json());
      } catch {
        setLan(null);
      }
    })();
  }, []);

  return (
    <Card>
      <div className="mb-2 flex items-center gap-3">
        <Smartphone className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Móvil (iPhone y Android)</p>
          <p className="text-xs text-muted-foreground">Usa WILLY AI desde el móvil conectado a tu misma red Wi-Fi: chat, archivos, SUPER WILLY y YouTube en español.</p>
        </div>
      </div>
      {lan?.url ? (
        <>
          <p className="mb-2 rounded-lg border border-border bg-background p-2 font-mono text-xs">{lan.url}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => ping(`Abre ${lan.url} en el navegador del móvil (Safari) y usa «Añadir a pantalla de inicio».`)}>Cómo instalarlo</Button>
            <Button type="button" variant="secondary" onClick={async () => { const ok = await copyText(lan.url); ping(ok ? "Dirección copiada. Pégala en el navegador del móvil." : `Copia esta dirección: ${lan.url}`); }}>Copiar dirección</Button>
            <a href={`/api/iphone?host=${encodeURIComponent(`${lan.lan}:${lan.port}`)}`} download className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm">Descargar instalador para iPhone</a>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No se ha podido detectar la red de tu casa. Comprueba que el PC y el móvil están en el mismo Wi-Fi.</p>
      )}
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── Sistema

function Row({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-right text-sm font-semibold ${tone ? toneText(tone) : ""}`}>{value}</span>
    </div>
  );
}

function SystemTab({ ping }: { ping: Ping }) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [status, setStatus] = useState<"cargando" | "ok" | "sin-respuesta">("cargando");
  const [phase, setPhase] = useState<"" | "reiniciando" | "confirmar-detener" | "deteniendo" | "detenido">("");
  const local = onThisComputer();

  const load = async (announce = false) => {
    setStatus("cargando");
    const data = await fetchSystemInfo();
    setInfo(data);
    setStatus(data ? "ok" : "sin-respuesta");
    if (announce) ping(data ? `WILLY AI responde (encendido desde hace ${data.uptime}).` : "⚠️ El servidor de WILLY no responde.");
  };
  useEffect(() => { void load(); }, []);

  const restart = async () => {
    if (!window.confirm("¿Reiniciar WILLY AI ahora? Tarda unos 10 segundos. Si una IA está escribiendo una respuesta, se cortará.")) return;
    setPhase("reiniciando");
    const result = await systemAction("reiniciar");
    if (!result.ok) {
      setPhase("");
      ping(`⚠️ ${result.error ?? "No se pudo reiniciar."}`);
      return;
    }
    ping(result.message ?? "WILLY AI se está reiniciando.");
    if (await waitForRestart()) window.location.reload();
    else {
      setPhase("");
      ping("⚠️ WILLY todavía no ha vuelto a responder. Espera un poco más o ábrelo con su acceso directo.");
    }
  };

  const stop = async () => {
    setPhase("deteniendo");
    const result = await systemAction("detener");
    if (!result.ok) {
      setPhase("");
      ping(`⚠️ ${result.error ?? "No se pudo detener."}`);
      return;
    }
    setPhase("detenido");
  };

  if (phase === "detenido") {
    return (
      <Card className="space-y-2 border-amber-500/40">
        <p className="flex items-center gap-2 text-sm font-semibold"><Power className="size-4 text-amber-600" />WILLY AI se ha detenido</p>
        <p className="text-sm text-muted-foreground">Esta página ya no funcionará hasta que lo vuelvas a abrir. Para usarlo otra vez, ábrelo desde su acceso directo del escritorio.</p>
      </Card>
    );
  }

  const installed = info?.installed ?? false;
  const canControl = status === "ok" && installed && local && phase === "";
  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Server className="size-4 text-primary" />
          <p className="min-w-0 flex-1 text-sm font-semibold">Estado de WILLY AI</p>
          <Button size="sm" variant="secondary" className="gap-2" disabled={status === "cargando" || phase !== ""} onClick={() => void load(true)}>
            <RefreshCw className={`size-4 ${status === "cargando" ? "animate-spin" : ""}`} />Comprobar
          </Button>
        </div>
        <Row label="Estado" value={status === "cargando" ? "Comprobando…" : status === "ok" ? (phase === "reiniciando" ? "Reiniciando…" : "En marcha") : "No responde"} tone={status === "ok" ? "ok" : status === "sin-respuesta" ? "fallo" : "info"} />
        {info && (
          <>
            <Row label="Versión" value={`${info.version} · revisión ${info.revision}`} />
            <Row label="Puerto" value={String(info.port)} />
            <Row label="Encendido desde hace" value={info.uptime} />
            <Row label="Programa" value={info.installed ? "Instalado en este equipo" : "Vista previa (no es el programa instalado)"} />
            {info.busy && <Row label="Autoconstrucción" value="Trabajando ahora mismo" tone="aviso" />}
            {info.updating && <Row label="Actualización" value="Instalándose ahora mismo" tone="aviso" />}
            <Row label="Última comprobación" value={timeText(info.checkedAt)} />
          </>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" className="gap-2" disabled={!canControl} onClick={() => void restart()}>
            {phase === "reiniciando" ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}Reiniciar
          </Button>
          <Button size="sm" variant="outline" className="gap-2" disabled={!canControl} onClick={() => setPhase("confirmar-detener")}>
            <Power className="size-4" />Detener
          </Button>
        </div>
        {!local && <p className="mt-2 text-xs text-muted-foreground">Reiniciar y Detener solo se pueden usar desde el propio ordenador, no desde el móvil.</p>}
        {local && info && !installed && <p className="mt-2 text-xs text-muted-foreground">Reiniciar y Detener solo funcionan en el programa instalado.</p>}
        {phase === "confirmar-detener" && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" role="alertdialog" aria-label="Confirmar detener WILLY AI">
            <p className="text-sm font-semibold">¿Detener WILLY AI?</p>
            <p className="mt-1 text-xs text-muted-foreground">Se cerrará el programa y esta página dejará de funcionar. Para volver a usarlo tendrás que abrirlo con su acceso directo del escritorio. La IA de tu equipo (Ollama) no se cierra.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="border-destructive/60 text-destructive" onClick={() => void stop()}>Sí, detener WILLY AI</Button>
              <Button size="sm" variant="secondary" onClick={() => setPhase("")}>Cancelar</Button>
            </div>
          </div>
        )}
        {phase === "deteniendo" && <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Deteniendo…</p>}
      </Card>
      <UpdateView info={info} />
      <MaintenanceCard ping={ping} />
    </div>
  );
}

function MaintenanceCard({ ping }: { ping: Ping }) {
  const [preview, setPreview] = useState<CachePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const look = async () => {
    setBusy(true);
    const data = await fetchCachePreview();
    setBusy(false);
    if (!data) ping("⚠️ No se pudo consultar la caché.");
    setPreview(data);
  };
  const clean = async () => {
    setBusy(true);
    const result = await systemAction("limpiar-cache");
    setBusy(false);
    ping(result.ok ? result.message ?? "Caché vaciada." : `⚠️ ${result.error ?? "No se pudo vaciar la caché."}`);
    await look();
  };
  const cleanBrowser = async () => {
    const result = await systemAction("limpiar-navegador");
    if (!result.ok) return ping(`⚠️ ${result.error ?? "No se pudo vaciar la caché del navegador."}`);
    ping(result.message ?? "Caché del navegador vaciada.");
    window.setTimeout(() => window.location.reload(), 800);
  };
  return (
    <Card>
      <p className="flex items-center gap-2 text-sm font-semibold"><Wrench className="size-4 text-primary" />Mantenimiento</p>
      <p className="mt-1 text-xs text-muted-foreground">Vaciar la caché borra archivos temporales que WILLY vuelve a crear solo cuando los necesita. Nunca toca tus proyectos, tus conversaciones ni tus ajustes.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" className="gap-2" disabled={busy} onClick={() => void look()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Ver qué se puede vaciar
        </Button>
        <Button size="sm" variant="outline" onClick={() => void cleanBrowser()}>Vaciar la caché del navegador</Button>
      </div>
      {preview && (
        <div className="mt-3 space-y-2">
          {preview.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay nada que vaciar: la caché está limpia.</p>
          ) : (
            <ul className="space-y-1">
              {preview.items.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0">{item.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatBytes(item.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.blocked && <p className="text-xs text-amber-600">{preview.blocked}</p>}
          {preview.items.length > 0 && (
            <Button size="sm" className="gap-2" disabled={busy || Boolean(preview.blocked)} onClick={() => void clean()}>
              <Trash2 className="size-4" />Vaciar caché ({formatBytes(preview.totalBytes)})
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── Almacenamiento

function StorageTab({ ping }: { ping: Ping }) {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [state, setState] = useState<"cargando" | "ok" | "error">("cargando");
  const [cleaning, setCleaning] = useState(false);
  const load = async () => {
    setState("cargando");
    const data = await fetchStorage();
    setReport(data);
    setState(data ? "ok" : "error");
  };
  useEffect(() => { void load(); }, []);

  const cleanBackups = async () => {
    if (!report || !window.confirm(`¿Borrar ${report.removable.count} copia(s) antigua(s)? Se conservan siempre las más recientes y las que usa «Volver a la versión anterior».`)) return;
    setCleaning(true);
    const result = await systemAction("limpiar-copias");
    setCleaning(false);
    ping(result.ok ? result.message ?? "Copias antiguas borradas." : `⚠️ ${result.error ?? "No se pudieron borrar."}`);
    await load();
  };

  if (state === "cargando" && !report) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Midiendo el espacio…</p>;
  if (!report) return <Card className="text-sm text-muted-foreground">No se pudo leer el almacenamiento: el servidor de WILLY no respondió. <Button size="sm" variant="secondary" className="ml-2" onClick={() => void load()}>Reintentar</Button></Card>;

  return (
    <div className="space-y-3">
      {report.disk && (
        <Card>
          <p className="flex items-center gap-2 text-sm font-semibold"><HardDrive className="size-4 text-primary" />Disco {report.disk.drive}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${report.disk.percent >= 92 ? "bg-destructive" : report.disk.percent >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, report.disk.percent)}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{report.disk.freeGB.toFixed(1).replace(".", ",")} GB libres de {report.disk.totalGB.toFixed(0)} GB ({report.disk.percent} % ocupado)</p>
        </Card>
      )}
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold"><FolderOpen className="size-4 text-primary" />Dónde están tus datos</p>
        <p className="mt-1 break-all rounded-md border border-border bg-background p-2 font-mono text-xs">{report.dataDir}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" className="gap-2" onClick={async () => { const ok = await copyText(report.dataDir); ping(ok ? "Ruta copiada." : `La ruta es: ${report.dataDir}`); }}><Copy className="size-4" />Copiar la ruta</Button>
          <Button size="sm" variant="ghost" className="gap-2" onClick={() => void load()}><RefreshCw className="size-4" />Volver a medir</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Las actualizaciones nunca tocan esta carpeta. Ojo: si desinstalas WILLY AI, se borra con él.</p>
      </Card>
      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold"><Database className="size-4 text-primary" />Qué ocupa cada cosa</p>
        <ul className="mt-2 space-y-2">
          {report.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm">{item.label}{item.count !== undefined ? ` · ${item.count} proyecto(s)` : ""}</span>
                <span className="block text-xs text-muted-foreground">{item.detail}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{item.partial ? "más de " : ""}{formatBytes(item.bytes)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <p className="text-sm font-semibold">Copias de seguridad antiguas</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {report.removable.count
            ? `Hay ${report.removable.count} copia(s) antigua(s) (${formatBytes(report.removable.mb * 1048576)}) que se pueden borrar sin riesgo. Las más recientes y las que usa «Volver a la versión anterior» se conservan siempre.`
            : "No hay copias antiguas que borrar: solo quedan las recientes y las protegidas."}
        </p>
        {report.removable.count > 0 && (
          <Button size="sm" variant="secondary" className="mt-2 gap-2" disabled={cleaning} onClick={() => void cleanBackups()}>
            {cleaning ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Borrar copias antiguas
          </Button>
        )}
      </Card>
      <Card>
        <p className="text-sm font-semibold">Restaurar</p>
        <p className="mt-1 text-xs text-muted-foreground">Para volver a una versión anterior de WILLY usa «Versiones» en la Autoconstrucción. Si WILLY no llega ni a abrirse, usa «Recuperar WILLY AI» (en el menú Inicio de Windows): vuelve solo a la última versión buena.</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => { requestSectionTab("autoconstruccion", "versiones"); openView("autoconstruccion"); }}>Abrir Versiones</Button>
      </Card>
      <p className="text-xs text-muted-foreground">Medido a las {timeText(report.checkedAt)}.</p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Diagnóstico

function DiagnosisTab({ ping }: { ping: Ping }) {
  const [report, setReport] = useState<DiagReport | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    const result = await runDiagnosis();
    setRunning(false);
    if (!result.ok) return ping(`⚠️ ${result.error}`);
    setReport(result.report);
    ping(result.report.overall === "todo bien" ? "Diagnóstico terminado: todo bien." : `Diagnóstico terminado: ${result.report.overall}.`);
  };
  const overallTone: Tone = report ? (report.overall === "con fallos" ? "fallo" : report.overall === "con avisos" ? "aviso" : "ok") : "info";
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Stethoscope className="size-5 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Diagnóstico completo</p>
            <p className="text-xs text-muted-foreground">Comprueba de verdad WILLY, la IA de tu equipo, la tarjeta gráfica, las IA externas, internet, el disco, la memoria, el guardado de proyectos, las copias y los errores.</p>
          </div>
          <Button className="gap-2" disabled={running} onClick={() => void run()}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Stethoscope className="size-4" />}{running ? "Comprobando…" : "Ejecutar diagnóstico"}
          </Button>
        </div>
        {report && (
          <div className="mt-3">
            <p className={`mb-2 flex items-center gap-2 text-sm font-semibold ${toneText(overallTone)}`}><StatusIcon tone={overallTone} />Resultado: {report.overall} · {new Date(report.at).toLocaleTimeString("es-ES")}</p>
            <ul className="space-y-2">
              {report.checks.map((check) => (
                <li key={check.id} className="flex gap-2 rounded-lg border border-border p-2.5">
                  <StatusIcon tone={check.status} className="mt-0.5 size-4" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{check.label}</p>
                    <p className="text-xs text-muted-foreground">{check.detail}</p>
                    {check.fix && <p className="mt-1 text-xs"><span className="font-semibold">Qué hacer:</span> {check.fix}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <LogsCard />
      <StatePackCard ping={ping} />
    </div>
  );
}

/** Registros del programa (también se ven en Autoconstrucción → Logs). */
export function LogsCard() {
  const [full, setFull] = useState(false);
  const [sources, setSources] = useState<LogSource[] | null>(null);
  const [state, setState] = useState<"cargando" | "ok" | "error">("cargando");
  const load = async (complete: boolean) => {
    setState("cargando");
    const data = await fetchLogs(complete);
    setSources(data?.sources ?? null);
    setState(data ? "ok" : "error");
  };
  useEffect(() => { void load(full); }, [full]);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <ScrollText className="size-4 text-primary" />
        <p className="min-w-0 flex-1 text-sm font-semibold">Registros</p>
        <Button size="sm" variant="ghost" className="gap-2" onClick={() => void load(full)}><RefreshCw className={`size-4 ${state === "cargando" ? "animate-spin" : ""}`} />Actualizar</Button>
        <Button size="sm" variant="secondary" onClick={() => setFull((value) => !value)}>{full ? "Ver solo el resumen" : "Ver registros completos"}</Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Las claves, tokens y contraseñas se ocultan siempre.</p>
      {state === "error" && <p className="mt-2 text-xs text-destructive">No se pudieron leer los registros: el servidor de WILLY no respondió.</p>}
      <div className="mt-2 space-y-3">
        {(sources ?? []).map((source) => (
          <div key={source.id}>
            <p className="text-xs font-semibold">{source.label}{source.updatedAt ? <span className="font-normal text-muted-foreground"> · {new Date(source.updatedAt).toLocaleString("es-ES")}</span> : null}</p>
            {source.lines.length === 0 ? (
              <p className="text-xs text-muted-foreground">{source.missing ? "Todavía no hay registro." : "Nada que contar."}</p>
            ) : (
              <pre className={`mt-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-5 text-muted-foreground ${full ? "max-h-96" : "max-h-40"}`}>{source.lines.join("\n")}</pre>
            )}
            {!full && source.total > source.lines.length && <p className="text-[11px] text-muted-foreground">Últimas {source.lines.length} de {source.total} líneas.</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── Avanzado

function AdvancedTab({ ping }: { ping: Ping }) {
  const [deps, setDeps] = useState<DependencyReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  useEffect(() => { void fetchSystemInfo().then(setInfo); }, []);
  const check = async () => {
    setChecking(true);
    const data = await fetchDependencies();
    setChecking(false);
    if (!data) return ping("⚠️ No se pudieron comprobar las piezas.");
    setDeps(data);
  };
  return (
    <div className="space-y-3">
      <Card>
        <p className="text-sm font-semibold">Piezas para compilar (dependencias)</p>
        <p className="mt-1 text-xs text-muted-foreground">La Autoconstrucción necesita estas piezas para compilar las mejoras. WILLY no las instala por su cuenta (en tu equipo no hay npm): si falta alguna, la repone la próxima actualización oficial.</p>
        <Button size="sm" variant="secondary" className="mt-2 gap-2" disabled={checking} onClick={() => void check()}>
          {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Comprobar las piezas
        </Button>
        {deps && (
          <p className={`mt-2 flex items-center gap-2 text-xs ${deps.missing.length ? "text-amber-600" : "text-emerald-600"}`}>
            <StatusIcon tone={!deps.packageJson ? "info" : deps.missing.length ? "aviso" : "ok"} />
            {!deps.packageJson ? "No se encuentra package.json (esto es la vista previa)." : deps.missing.length ? `Faltan ${deps.missing.length} de ${deps.total}: ${deps.missing.join(", ")}.` : `Están las ${deps.total} piezas.`}
          </p>
        )}
      </Card>
      {info && (
        <Card>
          <p className="text-sm font-semibold">Datos técnicos</p>
          <Row label="Carpeta de instalación" value={info.root} />
          <Row label="Node" value={info.node} />
          <Row label="Proceso" value={String(info.pid)} />
          <Row label="Sistema" value={info.platform} />
        </Card>
      )}
      <BackendCard ping={ping} />
      <a href="/api/sistema?registros&completos=1" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs text-primary underline-offset-2 hover:underline"><ScrollText className="size-3.5" />Ver los registros completos en bruto (sin claves)</a>
    </div>
  );
}

/** Conexión opcional a otro servidor de datos (Fastify en localhost:4000). */
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
      ping(`Comprobando el servidor en ${urlDraft.trim()}...`);
      const probe = await health(urlDraft.trim());
      if (!probe.ok) return ping(`No se pudo conectar con ${urlDraft.trim()}. Arranca el backend (pnpm run dev) y vuelve a intentarlo.`);
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
          <p className="flex items-center gap-2 text-sm font-semibold"><Server className="size-4" /> Servidor de datos externo (opcional)</p>
          <p className="text-xs text-muted-foreground">{connected ? "Proyectos y sesión vienen de ese servidor." : "Sin conectar: tus datos se guardan en este equipo (lo normal)."}</p>
        </div>
        <Toggle on={cfg.enabled} label="Servidor de datos externo" onClick={() => void toggle()} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted-foreground" htmlFor="backend-url">Dirección del servidor</label>
        <input id="backend-url" value={urlDraft} onChange={(e: { target: { value: string } }) => setUrlDraft(e.target.value)} placeholder="http://localhost:4000" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary" />
      </div>
      {orgs.length > 0 && (
        <div>
          <label className="block text-xs font-semibold text-muted-foreground" htmlFor="backend-org">Organización</label>
          <select id="backend-org" value={cfg.organizationId} onChange={(e: { target: { value: string } }) => update({ organizationId: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary">
            <option value="">Ninguna</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}
          </select>
        </div>
      )}
      <Button type="button" variant="secondary" disabled={checking} onClick={() => void check()}>{checking ? "Comprobando..." : "Probar servidor"}</Button>
    </Card>
  );
}
