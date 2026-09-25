import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, Database, Loader2, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CATALOG, type Connector } from "@/lib/data-connectors";
import { SOURCES_EVENT, SOURCES_REPORT_KEY, callConnector, readSources, writeSources } from "@/lib/data-sources-store";
import type { Group } from "@/lib/data-helpers";

type Outcome = { state: "running" | "ok" | "fail"; ms: number; text: string; error: string; fetchedAt: string; cached: boolean; url: string };
const GROUPS: Group[] = ["Tiempo y clima", "Dinero", "España", "Conocimiento", "Mundo", "Ciencia y salud", "Tecnología", "Ocio y deporte"];
const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

/**
 * Fuentes de datos en tiempo real, gratuitas y sin clave, para tu IA local: tiempo, divisas, criptomonedas, precio de la luz,
 * terremotos, noticias, Wikipedia, ciencia… Desde el chat se consultan solas cuando preguntas por ellas (y se cita la fuente).
 * Aquí las activas o apagas, pruebas que funcionan en tu equipo y las consultas a mano.
 */
export function DataSourcesCard({ ping }: { ping: (message: string) => void }) {
  const [settings, setSettings] = useState(readSources);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>({});
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const sync = () => setSettings(readSources());
    window.addEventListener(SOURCES_EVENT, sync);
    return () => window.removeEventListener(SOURCES_EVENT, sync);
  }, []);

  const change = (next: typeof settings) => {
    setSettings(next);
    writeSources(next);
  };

  const run = async (connector: Connector, params: Record<string, string>): Promise<Outcome> => {
    setOutcomes((current) => ({ ...current, [connector.id]: { state: "running", ms: 0, text: "", error: "", fetchedAt: "", cached: false, url: "" } }));
    const started = performance.now();
    const result = await callConnector(connector.id, params);
    const ms = performance.now() - started;
    const outcome: Outcome = result.ok
      ? { state: "ok", ms, text: result.text, error: "", fetchedAt: result.fetchedAt, cached: result.cached, url: result.url }
      : { state: "fail", ms, text: "", error: result.error, fetchedAt: "", cached: false, url: "" };
    setOutcomes((current) => ({ ...current, [connector.id]: outcome }));
    return outcome;
  };

  const testAll = async () => {
    setTesting(true);
    const lines: string[] = [];
    for (const connector of CATALOG) {
      const outcome = await run(connector, connector.sample);
      lines.push(`- ${outcome.state === "ok" ? "✔" : "✘"} **${connector.name}** (${connector.id}) — ${seconds(outcome.ms)}${outcome.state === "ok" ? "" : ` — ${outcome.error}`}`);
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
    const failed = lines.filter((line) => line.startsWith("- ✘")).length;
    const report = `# Prueba de fuentes de datos (${new Date().toLocaleString("es-ES")})\n${lines.join("\n")}\n\n${CATALOG.length - failed} de ${CATALOG.length} funcionan en este equipo.`;
    try {
      window.localStorage.setItem(SOURCES_REPORT_KEY, report);
    } catch {
      /* sin almacenamiento */
    }
    setTesting(false);
    ping(failed ? `${CATALOG.length - failed} de ${CATALOG.length} fuentes funcionan. Las que fallan se muestran en rojo con el motivo.` : `Las ${CATALOG.length} fuentes funcionan en tu equipo.`);
  };

  const copyReport = async () => {
    let report = "";
    try {
      report = window.localStorage.getItem(SOURCES_REPORT_KEY) ?? "";
    } catch {
      /* sin almacenamiento */
    }
    if (!report) return ping("Pulsa antes «Probar todas».");
    try {
      await navigator.clipboard.writeText(report);
      ping("Informe copiado.");
    } catch {
      ping("No pude copiar el informe.");
    }
  };

  const copy = async (text: string, message = "Copiado.") => {
    try {
      await navigator.clipboard.writeText(text);
      ping(message);
    } catch {
      ping("No pude copiar al portapapeles.");
    }
  };

  const grouped = useMemo(() => GROUPS.map((group) => ({ group, items: CATALOG.filter((c) => c.group === group) })).filter((entry) => entry.items.length), []);
  const value = (connector: Connector, name: string) => inputs[connector.id]?.[name] ?? connector.sample[name] ?? "";

  return (
    <section className="mb-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Database className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Fuentes de datos en tiempo real</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {CATALOG.length} fuentes gratuitas y sin clave para tu IA local. En el chat pregunta con normalidad («¿qué tiempo hace en Sevilla mañana?», «¿a cuánto está el dólar?», «precio de la luz hoy») y WILLY consulta la fuente adecuada y responde citándola, con la hora del dato. Solo sale de tu equipo el dato mínimo (la ciudad, la divisa…), nunca tu mensaje ni tus archivos.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-3 text-xs">
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={settings.enabled} onChange={(event) => change({ ...settings, enabled: event.target.checked })} />
          Consultar estas fuentes desde el chat
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Tu ciudad (para «qué tiempo hace hoy»):</span>
          <input value={settings.place} onChange={(event) => change({ ...settings, place: event.target.value.slice(0, 80) })} placeholder="Sevilla" className="w-40 rounded-md border border-border bg-card px-2 py-1 outline-none focus:border-primary" aria-label="Tu ciudad" />
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" disabled={testing} onClick={() => void testAll()}>{testing ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}{testing ? "Probando…" : "Probar todas"}</Button>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void copyReport()}><ClipboardCopy className="size-3.5" />Copiar informe</Button>
        </div>
      </div>

      <div className="mt-3 space-y-4">
        {grouped.map(({ group, items }) => (
          <div key={group}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
            <ul className="space-y-2">
              {items.map((connector) => {
                const outcome = outcomes[connector.id];
                const on = !settings.off.includes(connector.id);
                return (
                  <li key={connector.id} className="rounded-md border border-border bg-background p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" checked={on} onChange={(event) => change({ ...settings, off: event.target.checked ? settings.off.filter((id) => id !== connector.id) : [...settings.off, connector.id] })} aria-label={`Usar ${connector.name} en el chat`} />
                        {connector.name}
                      </label>
                      {outcome?.state === "running" && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />consultando…</span>}
                      {outcome?.state === "ok" && <span className="flex items-center gap-1 font-semibold text-emerald-600"><Check className="size-3.5" />funciona · {seconds(outcome.ms)}{outcome.cached ? " · de la memoria" : ""}</span>}
                      {outcome?.state === "fail" && <span className="flex items-center gap-1 font-semibold text-destructive"><X className="size-3.5" />falla</span>}
                      <div className="ml-auto flex gap-2">
                        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={outcome?.state === "running"} onClick={() => void run(connector, connector.sample)}>Probar</Button>
                        <Button type="button" size="sm" variant={open === connector.id ? "secondary" : "ghost"} className="h-7 text-xs" onClick={() => setOpen(open === connector.id ? null : connector.id)}>Consultar</Button>
                      </div>
                    </div>
                    <p className="mt-1 leading-5 text-muted-foreground">{connector.summary} <span className="text-foreground">{connector.provides}</span></p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {connector.examples.map((example) => (
                        <button key={example} type="button" onClick={() => void copy(example, "Ejemplo copiado: pégalo en el chat.")} className="rounded-full border border-border px-2 py-0.5 text-[11px] hover:border-primary hover:text-primary" title="Copiar para probarlo en el chat">{example}</button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">Límites: {connector.limits} · <a href={connector.site} target="_blank" rel="noopener noreferrer" className="underline">sitio del servicio</a></p>
                    {outcome?.state === "fail" && <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 leading-5">{outcome.error}</p>}
                    {open === connector.id && (
                      <div className="mt-2 space-y-2 rounded-md border border-border bg-card p-2">
                        {connector.params.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {connector.params.map((param) => (
                              <label key={param.name} className="flex flex-col gap-0.5">
                                <span className="text-muted-foreground">{param.label}{param.required ? " *" : ""}</span>
                                <input value={value(connector, param.name)} onChange={(event) => setInputs((current) => ({ ...current, [connector.id]: { ...(current[connector.id] ?? connector.sample), [param.name]: event.target.value } }))} placeholder={param.placeholder} className="w-44 rounded-md border border-border bg-background px-2 py-1 outline-none focus:border-primary" />
                              </label>
                            ))}
                          </div>
                        )}
                        <Button type="button" size="sm" className="h-7 text-xs" disabled={outcome?.state === "running"} onClick={() => void run(connector, Object.fromEntries(connector.params.map((param) => [param.name, value(connector, param.name)])))}>Consultar ahora</Button>
                        {outcome?.state === "ok" && (
                          <div>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2 leading-5">{outcome.text}</pre>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                              <span>Consultado {outcome.fetchedAt ? new Date(outcome.fetchedAt).toLocaleTimeString("es-ES") : ""}</span>
                              <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => void copy(outcome.text)}>Copiar</Button>
                              {outcome.url && <a href={outcome.url} target="_blank" rel="noopener noreferrer" className="underline">Abrir la fuente</a>}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-4 text-muted-foreground">Las respuestas se basan en lo que devuelve cada servicio y pueden tener retraso: WILLY indica siempre la fuente y la hora del dato. Los formatos de cada servicio están tomados de su documentación: si alguno cambia, «Probar» te lo dirá. No es asesoramiento financiero ni médico.</p>
    </section>
  );
}
