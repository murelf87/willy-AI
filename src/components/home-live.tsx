import { useEffect, useState, type ReactNode } from "react";
import { Cpu, Database, FolderKanban, HardDrive, MemoryStick, Power, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { advise, formatMB, isHighPerformance, type SystemSnapshot } from "@/lib/system-info";
import { refreshNow, useSystem } from "@/lib/use-system";
import { useViewActive } from "@/lib/view-active";

// Contenido en directo de la pestaña Inicio: datos reales del equipo (se actualizan solos cada 2 segundos)
// y botones para dejar más memoria y espacio a la IA.

function Box({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}</div>;
}

const tone = (percent: number): string => (percent >= 92 ? "bg-destructive" : percent >= 80 ? "bg-amber-500" : "bg-primary");

function Bar({ label, detail, percent }: { label: string; detail: string; percent: number | null }) {
  const value = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{percent === null ? "—" : `${percent} %`}{detail ? ` · ${detail}` : ""}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all duration-700 ${tone(value)}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/** Minigráfico con las últimas lecturas. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-8" />;
  return (
    <div className="flex h-8 items-end gap-px" aria-hidden="true">
      {values.map((value, index) => (
        <div key={index} className={`w-full rounded-sm ${tone(value)} opacity-70`} style={{ height: `${Math.max(4, value)}%` }} />
      ))}
    </div>
  );
}

function useSecondsSince(time: number): number {
  const [now, setNow] = useState(() => Date.now());
  const active = useViewActive();
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return time ? Math.max(0, Math.round((now - time) / 1000)) : 0;
}

/** ¿Hay conexión a internet ahora mismo? (lo que dice el navegador, al día). */
function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Las tarjetas de arriba: modelo activo, proyectos, motor de IA y conexión, con el estado real. */
export function LiveStatusCards({ model, projects }: { model: string; projects: number }) {
  const { snapshot } = useSystem();
  const online = useOnline();
  const loaded = snapshot?.engine.loaded.some((entry) => entry.name === model || entry.name.startsWith(`${model}:`)) ?? false;
  const engine = snapshot ? (snapshot.engine.alive ? `En línea · ${snapshot.engine.installed} modelo(s) instalados` : "Parado") : "Comprobando…";
  const cards: Array<[string, string, ReactNode, boolean]> = [
    ["Modelo activo", snapshot ? `${model}${loaded ? " · en memoria" : " · sin cargar"}` : model, <Cpu key="a" className="size-4 text-primary" />, false],
    ["Proyectos", `${projects} en tu equipo`, <FolderKanban key="b" className="size-4 text-primary" />, false],
    ["Motor de IA", engine, <Database key="c" className="size-4 text-primary" />, !!snapshot && !snapshot.engine.alive],
    ["Conexión", online ? "Con internet" : "Sin internet (la IA de tu equipo sigue funcionando)", <Power key="d" className="size-4 text-primary" />, !online],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(([title, value, icon, warn]) => (
        <Box key={title}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{title}</div>
          <p className={`mt-1.5 truncate text-sm font-semibold ${warn ? "text-destructive" : ""}`} title={value}>{value}</p>
        </Box>
      ))}
    </div>
  );
}

/** «Recursos de tu equipo»: procesador, memoria, gráfica y disco reales, en directo. */
export function LiveResources() {
  const { snapshot, error, cpuHistory, updatedAt } = useSystem();
  const ago = useSecondsSince(updatedAt);
  const s = snapshot;
  return (
    <Box>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Recursos de tu equipo</p>
        <span className={`flex items-center gap-1.5 text-[11px] ${error ? "text-destructive" : "text-muted-foreground"}`}>
          <span className={`size-1.5 rounded-full ${error ? "bg-destructive" : "animate-pulse bg-emerald-500"}`} />
          {error ? "sin datos" : s ? `en directo · hace ${ago} s` : "leyendo…"}
        </span>
      </div>
      {error && !s && <p className="text-xs text-muted-foreground">No se pudo leer el equipo ({error}). Estos datos solo están en el programa instalado de WILLY AI.</p>}
      {s && (
        <div className="space-y-3">
          <div>
            <Bar label={`Procesador · ${s.cpu.cores} núcleos`} detail="" percent={s.cpu.percent} />
            <Spark values={cpuHistory} />
          </div>
          <Bar label="Memoria (RAM)" detail={`${formatMB(s.memory.usedMB)} de ${formatMB(s.memory.totalMB)}`} percent={s.memory.percent} />
          {s.gpu ? (
            <>
              <Bar label={`Gráfica · ${s.gpu.name}${s.gpu.temperature !== null ? ` · ${s.gpu.temperature} °C` : ""}`} detail="" percent={s.gpu.utilization} />
              <Bar label="Memoria de la gráfica" detail={`${formatMB(s.gpu.vramUsedMB)} de ${formatMB(s.gpu.vramTotalMB)}`} percent={Math.round((s.gpu.vramUsedMB / s.gpu.vramTotalMB) * 100)} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No se detecta una gráfica NVIDIA (o su programa nvidia-smi no está disponible), así que no se puede medir.</p>
          )}
          {s.disk && <Bar label={`Disco ${s.disk.drive}`} detail={`${s.disk.freeGB.toFixed(0)} GB libres de ${s.disk.totalGB.toFixed(0)}`} percent={s.disk.percent} />}
        </div>
      )}
    </Box>
  );
}

type ActResult = { ok: boolean; error?: string; message?: string; unloaded?: string[]; removable?: unknown[]; totalMB?: number; removed?: number; freedMB?: number };

async function act(action: string, extra: Record<string, unknown> = {}): Promise<ActResult> {
  try {
    const res = await fetch("/api/engine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    return (await res.json().catch(() => ({ ok: false, error: `El servidor respondió ${res.status}.` }))) as ActResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo hablar con el servidor." };
  }
}

/** Modelos en memoria, consejos, botones de optimización y procesos que más memoria usan. */
export function LiveTools({ ping }: { ping: (message: string) => void }) {
  const { snapshot: s } = useSystem();
  const [working, setWorking] = useState("");

  const run = async (label: string, job: () => Promise<void>) => {
    if (working) return;
    setWorking(label);
    try {
      await job();
    } finally {
      setWorking("");
      refreshNow();
    }
  };

  const unload = (model?: string) =>
    run("unload", async () => {
      const result = await act("unload", model ? { model } : {});
      const unloaded = result.unloaded ?? [];
      ping(result.ok ? (unloaded.length ? `✅ Memoria liberada: ${unloaded.join(", ")}.` : result.message ?? "No había modelos cargados.") : `⚠️ ${result.error}`);
    });

  const clean = () =>
    run("clean", async () => {
      const preview = await act("backups-preview");
      if (!preview.ok) return ping(`⚠️ ${preview.error}`);
      const count = (preview.removable ?? []).length;
      if (!count) return ping("No hay copias antiguas que borrar: solo quedan las más recientes.");
      if (!window.confirm(`Se borrarán ${count} copia(s) antigua(s) de WILLY (${formatMB(preview.totalMB ?? 0)}). Se conservan siempre las más recientes, así que podrás seguir deshaciendo cambios. ¿Continuar?`)) return;
      const done = await act("backups-clean");
      ping(done.ok ? `✅ Copias antiguas borradas: ${done.removed ?? 0}. Espacio liberado: ${formatMB(done.freedMB ?? 0)}.` : `⚠️ ${done.error}`);
    });

  const high = isHighPerformance(s?.power);
  const power = () =>
    run("power", async () => {
      if (!high && !window.confirm("Se cambiará el plan de energía de Windows a «Alto rendimiento»: la IA irá más rápido y el equipo gastará más batería y hará más ruido. Podrás deshacerlo con el botón «Volver al plan anterior». ¿Continuar?")) return;
      const result = await act(high ? "power-restore" : "power-high");
      ping(result.ok ? (high ? "✅ Plan de energía anterior restaurado." : "✅ Plan «Alto rendimiento» activado.") : `⚠️ ${result.error}`);
    });

  if (!s) return null;
  const tips = advise(s as SystemSnapshot);
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <Box>
        <p className="mb-3 text-sm font-semibold">Modelos de IA en memoria ahora</p>
        {s.engine.loaded.length === 0 ? (
          <p className="text-xs text-muted-foreground">{s.engine.alive ? "Ninguno: la IA no está usando memoria ahora mismo." : "El motor de IA no responde."}</p>
        ) : (
          <ul className="space-y-2">
            {s.engine.loaded.map((model) => {
              const share = model.sizeMB > 0 ? Math.round((model.vramMB / model.sizeMB) * 100) : 0;
              return (
                <li key={model.name} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono font-semibold">{model.name}</span>
                    <span className="text-muted-foreground">{formatMB(model.sizeMB)} · {s.gpu ? `${share} % en la gráfica` : "en el procesador"}</span>
                  </span>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!working} onClick={() => void unload(model.name)}>Liberar</Button>
                </li>
              );
            })}
          </ul>
        )}
        {tips.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
            {tips.map((tip) => <li key={tip}>💡 {tip}</li>)}
          </ul>
        )}
      </Box>
      <Box>
        <p className="mb-3 text-sm font-semibold">Optimizar el equipo</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={!!working || !s.engine.loaded.length} onClick={() => void unload()}>
            <MemoryStick className="size-3.5" />{working === "unload" ? "Liberando…" : "Liberar memoria de la IA"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!!working} onClick={() => void clean()}>
            <Trash2 className="size-3.5" />{working === "clean" ? "Mirando…" : `Limpiar copias antiguas${s.backups && s.backups.removableMB > 0 ? ` (${formatMB(s.backups.removableMB)})` : ""}`}
          </Button>
          {s.platform === "win32" && s.power && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!!working} onClick={() => void power()}>
              <Zap className="size-3.5" />{high ? "Volver al plan anterior" : "Activar Alto rendimiento"}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {s.power ? `Plan de energía actual: ${s.power.name || "desconocido"}. ` : ""}
          «Liberar memoria» descarga los modelos que no estás usando; la IA los vuelve a cargar sola cuando la necesites (la primera respuesta tarda un poco más).
        </p>
        {s.processes && s.processes.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><HardDrive className="size-3.5 text-primary" />Programas que más memoria usan</p>
            <ul className="space-y-1 text-xs">
              {s.processes.map((proc) => (
                <li key={proc.name} className="flex justify-between gap-2 text-muted-foreground">
                  <span className="min-w-0 truncate">{proc.name}{proc.count > 1 ? ` (${proc.count})` : ""}</span>
                  <span className="shrink-0 tabular-nums">{formatMB(proc.memoryMB)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Si no los usas, ciérralos tú mismo para dejar más memoria a la IA. WILLY no cierra programas por su cuenta.</p>
          </div>
        )}
      </Box>
    </div>
  );
}
