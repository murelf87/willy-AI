import { useEffect, useState } from "react";
import { ArchiveRestore, Bot, Check, Download, FileUp, Save, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadFile, useSettings } from "@/lib/workspace-store";
import {
  DEFAULT_INSTRUCTIONS,
  EVENT,
  readSelfBuild,
  writeSelfBuild,
  type WillyImprovement,
} from "@/lib/self-build-store";
import { aiService } from "@/services/ai-service";
import type { ChatMsg } from "@/lib/local-ai";
import { APP_VERSION } from "@/lib/version";

type Ping = (message: string) => void;

export function SelfBuildView({ ping }: { ping: Ping }) {
  const [settings] = useSettings();
  const [state, setState] = useState(readSelfBuild);
  const [request, setRequest] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const sync = () => setState(readSelfBuild());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const persist = (next: typeof state) => {
    setState(next);
    writeSelfBuild(next);
  };

  const propose = async () => {
    if (!request.trim()) return ping("Describe primero la mejora que quieres para WILLY.");
    setWorking(true);
    const messages: ChatMsg[] = [
      {
        role: "system",
        content: `Eres el arquitecto de mantenimiento de WILLY AI. Solo propones mejoras de la propia aplicación, nunca de los proyectos del usuario. No aplicas cambios directamente. Debes conservar todo lo existente, exigir copia de seguridad, separar riesgos y explicar una comprobación final. Instrucciones permanentes del dueño:\n${state.instructions}`,
      },
      {
        role: "user",
        content: `Prepara una propuesta controlada para esta mejora de WILLY AI: ${request.trim()}\n\nDevuelve: objetivo, archivos o ajustes afectados, pasos, riesgos, copia de seguridad y validación.`,
      },
    ];
    const result = await aiService.chat({ endpoint: settings.endpoint, model: settings.model, messages });
    setWorking(false);
    if (!result.ok) return ping(`⚠️ ${result.error}`);
    const improvement: WillyImprovement = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      request: request.trim(),
      proposal: result.data,
      status: "pendiente",
    };
    persist({ ...state, improvements: [improvement, ...state.improvements].slice(0, 30) });
    setRequest("");
    ping("Propuesta preparada para tu revisión. Aún no se ha aplicado nada.");
  };

  const apply = (item: WillyImprovement) => {
    const backup = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      instructions: state.instructions,
      reason: item.request,
    };
    persist({
      ...state,
      backups: [backup, ...state.backups].slice(0, 20),
      improvements: state.improvements.map((entry) => entry.id === item.id ? { ...entry, status: "aplicada" as const } : entry),
    });
    ping("Mejora aprobada y copia de seguridad creada. Se incluirá en la próxima actualización de WILLY.");
  };

  const restore = (id: string) => {
    const backup = state.backups.find((entry) => entry.id === id);
    if (!backup) return;
    persist({ ...state, instructions: backup.instructions });
    ping("Instrucciones restauradas desde la copia de seguridad.");
  };

  const exportBackup = () => {
    downloadFile(
      `willy-ai-${APP_VERSION}-configuracion.json`,
      JSON.stringify({ version: APP_VERSION, exportedAt: new Date().toISOString(), ...state }, null, 2),
      "application/json;charset=utf-8",
    );
    ping("Copia de seguridad descargada.");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Autoconstrucción</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Mejora WILLY de forma separada a tus proyectos, con revisión y copia de seguridad antes de aplicar.</p>
        </div>
        <Button variant="secondary" className="gap-2 self-start" onClick={exportBackup}><Download className="size-4" />Copia de seguridad</Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h2 className="text-sm font-semibold">Instrucciones permanentes del dueño</h2></div>
          <textarea
            value={state.instructions}
            onChange={(event) => setState({ ...state, instructions: event.target.value })}
            className="min-h-44 w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-6 outline-none focus:border-primary"
            aria-label="Instrucciones permanentes"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button className="gap-2" onClick={() => { persist(state); ping("Instrucciones permanentes guardadas."); }}><Save className="size-4" />Guardar</Button>
            <Button variant="outline" onClick={() => persist({ ...state, instructions: DEFAULT_INSTRUCTIONS })}>Restablecer</Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2"><Sparkles className="size-5 text-primary" /><h2 className="text-sm font-semibold">Nueva mejora</h2></div>
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="Ejemplo: mejora la memoria de WILLY sin cambiar mis proyectos"
            className="min-h-32 w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-6 outline-none focus:border-primary"
            aria-label="Mejora solicitada"
          />
          <Button className="mt-3 w-full gap-2" disabled={working} onClick={() => void propose()}><Bot className="size-4" />{working ? "Analizando con tu IA local…" : "Preparar propuesta"}</Button>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">La propuesta no modifica el programa. Tú decides si se aprueba para una actualización posterior.</p>
        </section>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Propuestas de mejora</h2>
        <div className="space-y-2">
          {state.improvements.length === 0 && <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Todavía no hay propuestas.</div>}
          {state.improvements.map((item) => (
            <article key={item.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{item.request}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("es-ES")} · {item.status}</p>
                </div>
                {item.status === "pendiente" && <Button size="sm" className="gap-2" onClick={() => apply(item)}><Check className="size-4" />Aprobar con copia</Button>}
                {item.status === "pendiente" && <Button size="sm" variant="outline" className="gap-2" onClick={() => persist({ ...state, improvements: state.improvements.map((entry) => entry.id === item.id ? { ...entry, status: "descartada" as const } : entry) })}><Trash2 className="size-4" />Descartar</Button>}
              </div>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-sans text-xs leading-5 text-muted-foreground">{item.proposal}</pre>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Copias disponibles</h2>
        <div className="space-y-2">
          {state.backups.length === 0 && <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">La primera copia se creará al aprobar una mejora.</div>}
          {state.backups.map((backup) => (
            <div key={backup.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
              <FileUp className="size-4 text-primary" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">Antes de: {backup.reason}</p><p className="text-xs text-muted-foreground">{new Date(backup.createdAt).toLocaleString("es-ES")}</p></div>
              <Button size="sm" variant="secondary" className="gap-2" onClick={() => restore(backup.id)}><ArchiveRestore className="size-4" />Restaurar</Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}