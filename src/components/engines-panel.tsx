import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { engineCommand, engineStatus } from "@/lib/engines-client";
import type { PublicEngine, PublicStatus } from "@/lib/engines-server";

const hour = (time: number) => new Date(time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

function badge(engine: PublicEngine, master: boolean): { text: string; tone: string } {
  if (!engine.hasKey) return { text: "Sin clave", tone: "text-muted-foreground" };
  if (!engine.enabled) return { text: "Desactivado", tone: "text-muted-foreground" };
  if (!master) return { text: "Listo (motores externos apagados)", tone: "text-muted-foreground" };
  if (engine.available) return { text: "Disponible", tone: "text-emerald-600" };
  if (engine.cooldownUntil) return { text: `En espera hasta las ${hour(engine.cooldownUntil)}`, tone: "text-amber-600" };
  return { text: engine.reason || "No disponible", tone: "text-amber-600" };
}

/**
 * Claves de IA externa (opcionales): añadir, probar, desactivar sin borrar o borrar del todo, con estado y aviso de
 * privacidad. Sirven para toda la app (chats y Autoconstrucción); también se puede añadir una clave rápida desde el
 * botón «IA externa» de cualquier chat, pero aquí está el control completo.
 */
export function EnginesPanel({ ping }: { ping: (message: string) => void }) {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setStatus(await engineStatus());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (id: string, action: Parameters<typeof engineCommand>[0], payload: Record<string, unknown>, note?: string) => {
    setBusy(id);
    const result = await engineCommand(action, payload);
    if (result.status) setStatus(result.status);
    else await refresh();
    setNotes((current) => ({ ...current, [id]: result.ok ? note ?? (result.model ? `Clave válida. Modelo elegido: ${result.model}.` : "") : result.error ?? "No se pudo completar." }));
    if (action === "engines-save-key" && result.ok) setKeys((current) => ({ ...current, [id]: "" }));
    setBusy("");
  };

  return (
    <details className="rounded-lg border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-semibold">Claves de IA externa (opcional): añadir, probar, desactivar o borrar</summary>
      {!status ? (
        <p className="mt-3 text-xs text-muted-foreground">No se pudo leer el estado de los motores.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-5 text-muted-foreground">
            Solo servicios oficiales con nivel gratuito. Cuando a uno se le acaba la cuota, pide pago o rechaza la clave, WILLY pasa al siguiente y lo vuelve a probar cuando toca; los cambios los aplica WILLY, así que cada motor continúa desde donde lo dejó el anterior. Las claves se guardan solo en este equipo y nunca vuelven a mostrarse.
          </p>
          <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-xs leading-5">
            <input type="checkbox" className="mt-0.5" checked={status.master} onChange={(event) => void run("master", "engines-master", { on: event.target.checked })} />
            <span>
              <span className="font-semibold">Permitir IA externa en WILLY (interruptor general).</span> Afecta a la vez a todos los chats (PC, móvil, Súper IA) y a la Autoconstrucción: si lo apagas, todos usan solo tu equipo. Lo que escribas, los archivos que subas y el código de WILLY relacionado saldrán de este equipo hacia el servicio elegido. Nunca se envían tus chats ni tus proyectos sin que tú lo pidas.
            </span>
          </label>
          <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-5">
            <span className="font-semibold">Orden en la Autoconstrucción:</span> siempre prueba primero la IA externa gratuita que mejor vaya (con clave, activada y disponible) y deja tu equipo como último recurso. Es así siempre, no depende de ningún ajuste.
          </p>
          <p className="text-xs text-muted-foreground">Límite de seguridad: {status.dailyCap} peticiones al día por motor.</p>
          <ul className="space-y-2">
            {status.engines.map((engine) => {
              const state = badge(engine, status.master);
              return (
                <li key={engine.id} className="rounded-md border border-border bg-background p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{engine.name}</span>
                    <span className={state.tone}>{state.text}</span>
                    {engine.hasKey && <span className="text-muted-foreground">clave ····{engine.last4}{engine.model ? ` · ${engine.model}` : ""} · {engine.used}/{engine.cap} hoy</span>}
                  </div>
                  <p className="mt-1 leading-5 text-muted-foreground">{engine.dataNote}</p>
                  {engine.hasKey && engine.reason && engine.enabled && !engine.available && <p className="mt-1 leading-5 text-amber-600">{engine.reason}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a href={engine.keyUrl} target="_blank" rel="noopener noreferrer" className="rounded-md border border-border px-2 py-1 font-semibold hover:bg-muted">Conseguir clave gratis</a>
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={keys[engine.id] ?? ""}
                      onChange={(event) => setKeys((current) => ({ ...current, [engine.id]: event.target.value }))}
                      placeholder={engine.hasKey ? "Pega una clave nueva para cambiarla" : "Pega aquí tu clave"}
                      className="min-w-48 flex-1 rounded-md border border-border bg-background px-2 py-1 outline-none focus:border-primary"
                      aria-label={`Clave de ${engine.name}`}
                    />
                    <Button size="sm" className="h-7 text-xs" disabled={busy === engine.id || !(keys[engine.id] ?? "").trim()} onClick={() => void run(engine.id, "engines-save-key", { id: engine.id, key: keys[engine.id] }, "Clave guardada en este equipo.")}>Guardar</Button>
                    {engine.hasKey && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === engine.id} onClick={() => void run(engine.id, "engines-test", { id: engine.id })}>Probar</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === engine.id} onClick={() => void run(engine.id, "engines-enable", { id: engine.id, on: !engine.enabled }, engine.enabled ? "Desactivado." : "Activado.")}>{engine.enabled ? "Desactivar" : "Activar"}</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === engine.id} onClick={() => { if (window.confirm(`Se borrará la clave de ${engine.name} de este equipo. ¿Continuar?`)) void run(engine.id, "engines-remove-key", { id: engine.id }, "Clave borrada."); }}>Quitar</Button>
                      </>
                    )}
                  </div>
                  {notes[engine.id] && <p className="mt-2 leading-5">{notes[engine.id]}</p>}
                </li>
              );
            })}
          </ul>
          <p className="text-xs leading-5 text-muted-foreground">Estos motores no están probados con tus claves reales: pulsa «Probar» tras guardar cada clave. ChatGPT, Claude, Grok y Perplexity no tienen API gratuita: se usan con «Usar otra IA» en cada mejora.</p>
        </div>
      )}
    </details>
  );
}
