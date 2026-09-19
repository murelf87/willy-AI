// Nuevas funciones: el propietario añade sus propias herramientas sin programar.
// Cada una queda guardada con su nombre y funciona igual que las de fábrica.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Loader2, Play, Plus, Puzzle, Sparkles, Square, Trash2, Volume2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";
import { useSettings } from "@/lib/workspace-store";
import { aiService } from "@/services/ai-service";
import { TASK_LABELS, runTask, type TaskKind } from "@/services/orchestrator";
import { speakText, type SpeechHandle } from "@/lib/tts-voice";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}</div>;
}

export type Extra = {
  id: string;
  name: string;
  desc: string;
  placeholder: string;
  instructions: string;
  kind: TaskKind;
};

const KEY = "willy-extras";

function listExtras(): Extra[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Extra[]) : [];
  } catch {
    return [];
  }
}

function saveExtras(list: Extra[]) {
  window.localStorage.setItem(KEY, JSON.stringify(list));
}

const IDEAS = [
  { name: "Resumir reuniones", desc: "Convierte notas en acuerdos y tareas", instructions: "Resume la reunión en: acuerdos, tareas con responsable y fecha, y temas pendientes." },
  { name: "Contratos y presupuestos", desc: "Redacta documentos listos para firmar", instructions: "Redacta un presupuesto o contrato profesional en español, con partidas, importes, plazos y condiciones." },
  { name: "Campañas de correo", desc: "Secuencia de correos para vender", instructions: "Crea una secuencia de 4 correos de venta con asunto, cuerpo y llamada a la acción para cada uno." },
  { name: "Analizar datos", desc: "Saca conclusiones de una tabla", instructions: "Analiza los datos aportados y devuelve conclusiones, cifras clave y recomendaciones concretas." },
];

export function ExtrasView() {
  const [settings] = useSettings();
  const [extras, setExtras] = useState<Extra[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [instructions, setInstructions] = useState("");
  const [kind, setKind] = useState<TaskKind>("general");
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [available, setAvailable] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const speech = useRef<SpeechHandle | null>(null);

  useEffect(() => {
    setExtras(listExtras());
    void aiService.models(settings.endpoint).then((r) => { if (r.ok) setAvailable(r.data.map((m) => m.name)); });
    return () => speech.current?.stop();
  }, [settings.endpoint]);

  const current = extras.find((e) => e.id === active) ?? null;

  const create = () => {
    if (!name.trim() || !instructions.trim()) return;
    const extra: Extra = {
      id: `extra-${Date.now()}`,
      name: name.trim(),
      desc: desc.trim() || "Función personalizada",
      placeholder: "Escribe aquí lo que quieres que haga…",
      instructions: instructions.trim(),
      kind,
    };
    const next = [extra, ...extras];
    setExtras(next);
    saveExtras(next);
    setCreating(false);
    setName(""); setDesc(""); setInstructions(""); setKind("general");
    setActive(extra.id);
    pushNotice(`Nueva función añadida: ${extra.name}.`, "success");
  };

  const remove = (id: string) => {
    const next = extras.filter((e) => e.id !== id);
    setExtras(next);
    saveExtras(next);
    if (active === id) setActive(null);
  };

  /** La IA redacta las instrucciones de la nueva función a partir de una frase. */
  const draft = async () => {
    if (!desc.trim() && !name.trim()) return;
    setDrafting(true);
    const res = await runTask({
      endpoint: settings.endpoint,
      kind: "escritura",
      preferred: settings.model,
      available,
      prompt:
        `Quiero una función nueva en mi herramienta llamada "${name || desc}". ${desc}\n\n` +
        "Escribe SOLO las instrucciones que debe seguir la IA cada vez que yo la use: qué debe producir, con qué estructura y con qué nivel de detalle. " +
        "En español, en segunda persona, sin introducciones ni explicaciones.",
    });
    setDrafting(false);
    if (!res.ok) {
      pushNotice(`⚠️ ${res.error}`, "warn");
      return;
    }
    setInstructions(res.data.text.trim());
  };

  const run = async () => {
    if (!current || !input.trim() || running) return;
    setRunning(true);
    setResult("");
    const controller = new AbortController();
    abort.current = controller;
    const res = await runTask({
      endpoint: settings.endpoint,
      kind: current.kind,
      preferred: settings.model,
      available,
      signal: controller.signal,
      prompt: `${current.instructions}\n\nEntrada del propietario:\n${input}`,
      onDelta: (d) => setResult((r) => r + d),
    });
    setRunning(false);
    abort.current = null;
    if (!res.ok) {
      setResult(`⚠️ ${res.error}`);
      pushNotice(`⚠️ ${res.error}`, "warn");
      return;
    }
    setResult(res.data.text);
  };

  const toggleSpeech = () => {
    if (speaking) {
      speech.current?.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speech.current = speakText(result, {
      voice: window.localStorage.getItem("willy-voz") ?? "Kore",
      onEnd: () => setSpeaking(false),
      onError: (m) => { setSpeaking(false); pushNotice(`⚠️ ${m}`, "warn"); },
    });
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold"><Puzzle className="mr-2 inline size-4 text-primary" />Tus funciones</p>
          <p className="text-xs text-muted-foreground">Añade todas las que quieras: quedan guardadas y listas para usar.</p>
        </div>
        <Button className="gap-2" onClick={() => setCreating((c) => !c)}>
          <Plus className="size-4" />{creating ? "Cerrar" : "Añadir función"}
        </Button>
      </Card>

      {creating && (
        <Card className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre de la función"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Para qué sirve, en una frase"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Qué debe hacer la IA cada vez que uses esta función. Si no sabes cómo explicarlo, pulsa «Que lo redacte la IA»."
            className="h-32 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TaskKind)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              aria-label="Tipo de tarea"
            >
              {Object.entries(TASK_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <Button variant="secondary" className="gap-2" onClick={() => void draft()} disabled={drafting || (!name.trim() && !desc.trim())}>
              {drafting ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              Que lo redacte la IA
            </Button>
            <Button className="gap-2" onClick={create} disabled={!name.trim() || !instructions.trim()}>
              <Plus className="size-4" />Crear función
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <span className="self-center text-xs text-muted-foreground">Ideas rápidas:</span>
            {IDEAS.map((idea) => (
              <button
                key={idea.name}
                type="button"
                onClick={() => { setName(idea.name); setDesc(idea.desc); setInstructions(idea.instructions); }}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/60 hover:bg-accent/40"
              >
                {idea.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      {extras.length === 0 ? (
        <Card className="text-sm text-muted-foreground">
          Todavía no has añadido ninguna función. Pulsa «Añadir función» y crea la tuya: puedes describirla con tus
          palabras y la IA redacta el resto.
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {extras.map((e) => (
            <div
              key={e.id}
              className={`rounded-xl border p-4 transition ${active === e.id ? "border-primary bg-accent/30" : "border-border bg-card hover:border-primary/50"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setActive(e.id); setResult(""); setInput(""); }}>
                  <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" />{e.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{e.desc}</p>
                  <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">{TASK_LABELS[e.kind]}</p>
                </button>
                <Button variant="ghost" size="sm" aria-label={`Eliminar ${e.name}`} onClick={() => remove(e.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {current && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold">{current.name}</p>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={current.placeholder}
            className="h-28 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
          />
          <div className="flex flex-wrap gap-2">
            {running ? (
              <Button variant="outline" className="gap-2" onClick={() => { abort.current?.abort(); setRunning(false); }}>
                <Square className="size-4" />Detener
              </Button>
            ) : (
              <Button className="gap-2" onClick={() => void run()} disabled={!input.trim()}>
                <Play className="size-4" />Ejecutar
              </Button>
            )}
            {running && <Loader2 className="size-5 animate-spin self-center text-primary" />}
          </div>
          {result && (
            <>
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm leading-relaxed">{result}</div>
              <div className="flex flex-wrap gap-2">
                <Button variant={speaking ? "outline" : "secondary"} className="gap-2" onClick={toggleSpeech}>
                  {speaking ? <Square className="size-4" /> : <Volume2 className="size-4" />}
                  {speaking ? "Parar" : "Escucharlo"}
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => { void navigator.clipboard.writeText(result); pushNotice("Copiado.", "success"); }}
                >
                  <Copy className="size-4" />Copiar
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
