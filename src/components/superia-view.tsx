// Súper IA: una sola pantalla desde la que pedir cualquier cosa. El orquestador
// elige el modelo, pasa el relevo si uno falla y nunca devuelve un "no sé".

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookOpen, Brain, Check, Copy, Download, FileText, Loader2, Mail, Mic, Phone,
  Play, RotateCcw, Sparkles, Square, Trash2, User, Volume2, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/workspace-store";
import { pushNotice } from "@/lib/notifications";
import { aiService } from "@/services/ai-service";
import {
  TASK_LABELS, detectTask, learningStats, rememberNote, resetLearning, runTask, selfRepair,
  type RunStep, type TaskKind,
} from "@/services/orchestrator";
import { PLAYBOOKS, detectPlaybook, playbookBrief } from "@/services/playbooks";
import { DESIGN_STYLES, redesignBrief } from "@/services/design-themes";
import { estimateChars, estimateSeconds, formatDuration, progressOf, recordSpeed } from "@/services/estimator";
import { startDictation, voiceSupported, type VoiceSession } from "@/lib/voice-input";
import {
  emptySession, lastSession, removeSession, saveSession, coveredItems, extractPending,
  type WorkSession,
} from "@/services/worklog";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}</div>;
}

// --------------------------------------------------------------- capacidades

type Capability = {
  id: string;
  icon: typeof Sparkles;
  name: string;
  desc: string;
  kind: TaskKind;
  template: string;
};

const CAPABILITIES: Capability[] = [
  {
    id: "investigar",
    icon: BookOpen,
    name: "Investigar como un profesional",
    desc: "Abogado, médico, ingeniero, financiero… un informe completo con fuentes y conclusiones.",
    kind: "investigacion",
    template:
      "Actúa como [profesión: abogado / médico / ingeniero / analista financiero] con 20 años de experiencia.\nInvestiga a fondo: [tema].\nEntrega: resumen ejecutivo, análisis por puntos, riesgos, recomendaciones accionables y próximos pasos.",
  },
  {
    id: "web",
    icon: Wand2,
    name: "Crear webs y aplicaciones",
    desc: "Describe la idea y recibes el código completo, responsive y funcional.",
    kind: "web",
    template:
      "Crea [una web / una app] de [tema].\nPúblico: [quién la usa].\nSecciones: [listado].\nEstilo: moderno y profesional, nada de plantilla genérica.\nEntrega el código completo (HTML/CSS/JS o React), responsive, simétrico y con todos los botones funcionando.",
  },
  {
    id: "traducir",
    icon: FileText,
    name: "Traducir cualquier texto",
    desc: "Traducción natural al español (o a cualquier idioma) conservando el formato.",
    kind: "traduccion",
    template: "Traduce al español de España, con naturalidad y conservando el formato:\n\n[pega aquí el texto]",
  },
  {
    id: "correos",
    icon: Mail,
    name: "Correos masivos y automáticos",
    desc: "Genera la campaña personalizada y el archivo listo para enviar.",
    kind: "escritura",
    template:
      "Prepara una campaña de correo para [objetivo].\nDestinatarios: [tipo de cliente].\nEntrega: asunto (3 variantes), cuerpo del correo con campos personalizables {{nombre}} {{empresa}}, versión corta de seguimiento y un CSV de ejemplo con las columnas necesarias.",
  },
  {
    id: "llamadas",
    icon: Phone,
    name: "Llamadas con voz real",
    desc: "Guion de llamada y locución lista para leer en voz alta con la voz del sistema.",
    kind: "escritura",
    template:
      "Escribe el guion de una llamada telefónica para [objetivo].\nIncluye: apertura, presentación, preguntas clave, respuestas a las 5 objeciones más comunes, cierre y despedida.\nTono natural de conversación, frases cortas para leer en alto.",
  },
  {
    id: "avatar",
    icon: User,
    name: "Tu yo en IA (avatar y contenido)",
    desc: "Clona tu forma de hablar y genera contenido con tu estilo.",
    kind: "escritura",
    template:
      "Usando mi perfil de estilo, escribe [tipo de contenido: post, guion de vídeo, newsletter] sobre [tema].\nMantén exactamente mi tono, mis expresiones y mi forma de estructurar las ideas.",
  },
  {
    id: "integrar",
    icon: Brain,
    name: "Integrar con programas y archivos",
    desc: "Conecta la IA con Excel, Word, carpetas, APIs o cualquier programa.",
    kind: "codigo",
    template:
      "Quiero integrar la IA con [programa o tipo de archivo: Excel, Word, PDF, una carpeta, una API].\nObjetivo: [qué debe hacer automáticamente].\nEntrega el script completo listo para ejecutar en Windows, con instrucciones paso a paso y sin dependencias de pago.",
  },
];

// ----------------------------------------------------------------- voz local

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text.slice(0, 4000));
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("es"));
  if (voice) utter.voice = voice;
  utter.lang = "es-ES";
  window.speechSynthesis.speak(utter);
  return true;
}

// ------------------------------------------------------------------ pantalla

export function SuperIAView() {
  const [settings] = useSettings();
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<TaskKind | "auto">("auto");
  const [answer, setAnswer] = useState("");
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [running, setRunning] = useState(false);
  const [solvedBy, setSolvedBy] = useState<string | null>(null);
  const [available, setAvailable] = useState<string[]>([]);
  const [persona, setPersona] = useState("");
  const abort = useRef<AbortController | null>(null);
  const voice = useRef<VoiceSession | null>(null);
  const [dictating, setDictating] = useState(false);
  const [partial, setPartial] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [written, setWritten] = useState(0);
  const [totalEst, setTotalEst] = useState(0);
  const [notes, setNotes] = useState("");
  const [session, setSession] = useState<WorkSession | null>(null);
  const [restore, setRestore] = useState<WorkSession | null>(null);
  const [proposal, setProposal] = useState(false);

  useEffect(() => {
    setPersona(window.localStorage.getItem("willy-persona") ?? "");
    void aiService.models(settings.endpoint).then((r) => {
      if (r.ok) setAvailable(r.data.map((m) => m.name));
    });
    const last = lastSession();
    if (last) setRestore(last);
  }, [settings.endpoint]);

  const pb = useMemo(() => detectPlaybook(prompt || session?.prompt || ""), [prompt, session?.prompt]);
  const doneCount = pb ? pb.must.filter((m) => session?.done.includes(m)).length : 0;

  const stats = useMemo(() => learningStats().slice(0, 6), [answer]);

  const savePersona = (value: string) => {
    setPersona(value);
    window.localStorage.setItem("willy-persona", value);
  };

  /** Decide un punto opcional o una pregunta de la IA: sí se incluye, no se descarta. */
  const decide = (item: string, want: boolean) => {
    const cur = session ?? emptySession();
    const next = saveSession({
      ...cur,
      playbookId: pb?.id ?? cur.playbookId,
      accepted: want ? [...new Set([...cur.accepted, item])] : cur.accepted,
      rejected: want ? cur.rejected : [...new Set([...cur.rejected, item])],
      pending: cur.pending.filter((p) => p !== item),
    });
    setSession(next);
  };

  const toggleDone = (item: string) => {
    const cur = session ?? emptySession();
    const next = saveSession({
      ...cur,
      playbookId: pb?.id ?? cur.playbookId,
      done: cur.done.includes(item) ? cur.done.filter((d) => d !== item) : [...cur.done, item],
    });
    setSession(next);
  };

  const resume = (s: WorkSession) => {
    setSession(s);
    setPrompt(s.prompt);
    setAnswer(s.answer);
    setSolvedBy(s.model);
    setRestore(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const execute = async (text: string, forced?: TaskKind, label = "Tarea") => {
    if (!text.trim() || running) return;
    setRunning(true);
    setProposal(false);
    setAnswer("");
    setSteps([]);
    setSolvedBy(null);
    setWritten(0);
    setStartedAt(Date.now());
    setTotalEst(estimateChars(pb, session?.accepted.length ?? 0, text));
    const controller = new AbortController();
    abort.current = controller;

    const brief = pb ? playbookBrief(pb, session?.accepted ?? [], session?.rejected ?? []) : "";
    const result = await runTask({
      endpoint: settings.endpoint,
      prompt: brief ? `${text}\n\n${brief}` : text,
      preferred: settings.model,
      available,
      ...(forced ?? (kind !== "auto" ? kind : undefined) ? { kind: forced ?? (kind as TaskKind) } : {}),
      ...(persona.trim() ? { context: `Perfil de estilo del propietario:\n${persona.trim()}` } : {}),
      signal: controller.signal,
      onDelta: (d) => {
        setAnswer((a) => a + d);
        setWritten((w) => w + d.length);
      },
      onStep: (s) => setSteps((prev) => [...prev.filter((p) => p.model !== s.model || p.state !== "probando"), s]),
    });

    if (startedAt) recordSpeed(result.ok ? result.data.text.length : written, Date.now() - startedAt);
    setRunning(false);
    setStartedAt(null);
    abort.current = null;
    if (!result.ok) {
      setAnswer(`⚠️ ${result.error}`);
      pushNotice(`⚠️ ${result.error}`, "warn");
      return;
    }
    setAnswer(result.data.text);
    setSolvedBy(result.data.model);
    rememberNote(result.data.kind, text.slice(0, 120));
    if (pb) {
      const cur = session ?? emptySession();
      const cov = coveredItems(result.data.text, pb.must);
      const pend = extractPending(result.data.text);
      const next = saveSession({
        ...cur,
        prompt: text,
        answer: result.data.text,
        playbookId: pb.id,
        done: [...new Set([...cur.done, ...cov])],
        accepted: cur.accepted.filter((a) => pb.ask.includes(a)),
        rejected: cur.rejected.filter((a) => pb.ask.includes(a)),
        pending: pend.filter((p) => !cur.accepted.includes(p) && !cur.rejected.includes(p)),
        model: result.data.model,
      });
      setSession(next);
      setProposal(true);
    }
    pushNotice(
      result.data.relays > 0
        ? `${label} resuelta por ${result.data.model} tras ${result.data.relays} relevo(s).`
        : `${label} resuelta por ${result.data.model}.`,
      "success",
    );
  };

  const repair = async () => {
    if (running) return;
    setRunning(true);
    setAnswer("");
    setSteps([]);
    const result = await selfRepair({
      endpoint: settings.endpoint,
      preferred: settings.model,
      available,
      subject: "Última respuesta de la IA",
      problem: answer || prompt || "La respuesta anterior estaba incompleta o no funcionaba.",
      onStep: (s) => setSteps((prev) => [...prev, s]),
    });
    setRunning(false);
    if (!result.ok) return pushNotice(`⚠️ ${result.error}`, "warn");
    setAnswer(result.data.text);
    setSolvedBy(result.data.model);
    pushNotice("Autorreparación completada.", "success");
  };

  const toggleVoice = () => {
    if (dictating) {
      voice.current?.stop();
      voice.current = null;
      setDictating(false);
      setPartial("");
      return;
    }
    const s = startDictation({
      onText: (t) => setPrompt((p) => (p ? `${p} ${t}` : t)),
      onPartial: setPartial,
      onError: (m) => {
        pushNotice(`⚠️ ${m}`, "warn");
        voice.current?.stop();
        voice.current = null;
        setDictating(false);
        setPartial("");
      },
      onEnd: () => {
        setDictating(false);
        setPartial("");
      },
    });
    if (!s) {
      pushNotice("⚠️ Este navegador no soporta dictado. Prueba con Chrome o Edge.", "warn");
      return;
    }
    voice.current = s;
    setDictating(true);
  };

  const redesign = (styleId: string | null) => {
    if (running) return;
    const style = DESIGN_STYLES.find((s) => s.id === styleId) ?? null;
    const target = session?.prompt || prompt || "el último proyecto generado";
    void execute(redesignBrief(style, notes, target), "web", "Rediseño completo");
  };

  const download = () => {
    const blob = new Blob([answer], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `willy-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      {restore && !session && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/40">
          <p className="min-w-0 text-sm">
            <span className="font-semibold">Continuar donde lo dejaste:</span>{" "}
            <span className="text-muted-foreground">{restore.title}</span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => resume(restore)}>Continuar</Button>
            <Button size="sm" variant="outline" onClick={() => { removeSession(restore.id); setRestore(null); }}>
              Descartar
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Súper IA</h1>
          <p className="text-sm text-muted-foreground">
            Pide lo que quieras. Se elige el mejor modelo y, si uno no lo resuelve, entra otro automáticamente.
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {available.length ? `${available.length} modelo(s) en tu equipo` : "Sin motor local detectado"}
        </span>
      </div>

      {/* ------------------------------------------------ petición universal */}
      <Card className="space-y-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          placeholder="Ejemplo: investiga el mercado de gimnasios en Madrid y crea la web de captación con formulario de reservas."
          className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as TaskKind | "auto")}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="auto">Detectar solo ({TASK_LABELS[detectTask(prompt || "hola")]})</option>
            {(Object.keys(TASK_LABELS) as TaskKind[]).map((k) => (
              <option key={k} value={k}>{TASK_LABELS[k]}</option>
            ))}
          </select>

          {running ? (
            <Button variant="outline" className="gap-2" onClick={() => { abort.current?.abort(); setRunning(false); }}>
              <Square className="size-4" />Detener
            </Button>
          ) : (
            <Button className="gap-2" onClick={() => void execute(prompt)} disabled={!prompt.trim()}>
              <Play className="size-4" />Ejecutar
            </Button>
          )}

          <Button variant="secondary" className="gap-2" onClick={() => void repair()} disabled={running}>
            <RotateCcw className="size-4" />Autorreparar
          </Button>
          {voiceSupported() && (
            <Button
              variant={dictating ? "primary" : "outline"}
              size="icon"
              className="ml-auto shrink-0"
              onClick={toggleVoice}
              title={dictating ? "Parar el dictado" : "Dictar por voz"}
              aria-label={dictating ? "Parar el dictado" : "Dictar por voz"}
            >
              <Mic className={`size-4 ${dictating ? "animate-pulse" : ""}`} />
            </Button>
          )}
        </div>

        {running && totalEst > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Generando…</span>
              <span>
                {progressOf(written, totalEst, startedAt ? Date.now() - startedAt : 0).pct}%
                {progressOf(written, totalEst, startedAt ? Date.now() - startedAt : 0).remaining !== null &&
                  ` · quedan ~${formatDuration(progressOf(written, totalEst, startedAt ? Date.now() - startedAt : 0).remaining ?? 0)}`}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressOf(written, totalEst, startedAt ? Date.now() - startedAt : 0).pct}%` }} />
            </div>
          </div>
        ) : !running && (prompt.trim() || pb) ? (
          <p className="text-xs text-muted-foreground">
            Duración estimada de esta tarea: ~{formatDuration(estimateSeconds(pb, session?.accepted.length ?? 0, prompt))}.
            Se ajusta con cada ejecución a la velocidad real de tu equipo.
          </p>
        ) : null}

        {steps.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {steps.map((s, i) => (
              <span
                key={`${s.model}-${i}`}
                title={s.detail ?? ""}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  s.state === "ok"
                    ? "border-emerald-500/40 text-emerald-500"
                    : s.state === "relevo"
                      ? "border-amber-500/40 text-amber-500"
                      : "border-border text-muted-foreground"
                }`}
              >
                {s.state === "probando" && <Loader2 className="size-3 animate-spin" />}
                {s.state === "ok" && <Check className="size-3" />}
                {s.model}
                {s.state === "relevo" ? " · relevo" : ""}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* ---------------------------------------------- guía de entrega (playbook) */}
      {pb && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="size-4 text-primary" />Guía de entrega: {pb.name}
            </p>
            <span className="text-xs text-muted-foreground">
              {doneCount}/{pb.must.length} imprescindibles · listo para entregar a un cliente
            </span>
          </div>
          <ul className="space-y-1">
            {pb.must.map((m) => {
              const done = session?.done.includes(m) ?? false;
              return (
                <li key={m}>
                  <button
                    type="button"
                    onClick={() => toggleDone(m)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent/40"
                  >
                    <Check className={`mt-0.5 size-4 shrink-0 ${done ? "text-emerald-500" : "text-muted-foreground/40"}`} />
                    <span className={done ? "text-muted-foreground line-through" : ""}>{m}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {pb.ask.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                Opcional: decide qué incluir y la IA lo tendrá en cuenta
              </p>
              {pb.ask.map((a) => {
                const yes = session?.accepted.includes(a);
                const no = session?.rejected.includes(a);
                return (
                  <div key={a} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
                    <span className="min-w-0 text-sm">{a}</span>
                    {yes ? (
                      <span className="text-xs font-semibold text-emerald-500">Incluido</span>
                    ) : no ? (
                      <span className="text-xs text-muted-foreground">Descartado</span>
                    ) : (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => decide(a, true)}>Sí</Button>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => decide(a, false)}>No</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {session?.pending.length ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-amber-500">Preguntas de la IA:</p>
              {session.pending.map((p) => (
                <div key={p} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 px-2 py-1.5">
                  <span className="min-w-0 text-sm">{p}</span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => decide(p, true)}>Sí</Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => decide(p, false)}>No</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      )}

      {/* ------------------- propuesta de rediseño: solo al terminar un proyecto */}
      {pb && proposal && !running && (
        <Card className="space-y-3 border-primary/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              <Wand2 className="mr-2 inline size-4 text-primary" />La IA propone: ¿cambio de diseño completo?
            </p>
            <Button size="sm" variant="ghost" onClick={() => setProposal(false)}>
              Ahora no
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            El proyecto «{session?.prompt.slice(0, 60) || prompt.slice(0, 60)}…» ya está terminado. Si quieres, la IA
            rehace su interfaz entera con otro estilo, sin tocar la funcionalidad.
          </p>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Indicaciones opcionales: colores de marca, marca, referencias…"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
            {DESIGN_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={running}
                onClick={() => redesign(s.id)}
                className="rounded-lg border border-border p-3 text-left transition hover:border-primary/60 hover:bg-accent/40 disabled:opacity-50"
              >
                <p className="text-sm font-semibold">{s.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.desc}</p>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            También puedes ignorar la propuesta y pedir un rediseño más tarde con texto libre: «hazme otro diseño
            completamente distinto para la tienda».
          </p>
        </Card>
      )}

      {/* ------------------------------------------------------- resultado */}
      {(answer || running) && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              Resultado{solvedBy ? ` · resuelto por ${solvedBy}` : running ? " · trabajando…" : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" className="gap-2" onClick={() => { void navigator.clipboard.writeText(answer); pushNotice("Copiado al portapapeles.", "success"); }}>
                <Copy className="size-4" />Copiar
              </Button>
              <Button size="sm" variant="secondary" className="gap-2" onClick={download}>
                <Download className="size-4" />Descargar
              </Button>
              <Button size="sm" variant="secondary" className="gap-2" onClick={() => { if (!speak(answer)) pushNotice("⚠️ Este navegador no tiene voz.", "warn"); }}>
                <Volume2 className="size-4" />Leer en voz alta
              </Button>
            </div>
          </div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-sm leading-relaxed">
            {answer || "…"}
          </pre>
        </Card>
      )}

      {/* ----------------------------------------------------- capacidades */}
      <div>
        <h2 className="mb-2 text-lg font-bold">Qué puedes pedirle</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <Card key={c.id} className="flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <c.icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.desc}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setPrompt(c.template); setKind(c.kind); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  Usar plantilla
                </Button>
                <Button size="sm" variant="outline" onClick={() => void execute(c.template, c.kind, c.name)} disabled={running}>
                  Ejecutar ya
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* --------------------------------------------------------- mi yo IA */}
      <Card className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Mic className="size-4 text-primary" />Mi yo en IA</p>
        <p className="text-xs text-muted-foreground">
          Describe cómo hablas y escribes. Se añade a todas las peticiones para que el contenido suene a ti.
        </p>
        <textarea
          value={persona}
          onChange={(e) => savePersona(e.target.value)}
          rows={3}
          placeholder="Ejemplo: hablo directo y cercano, frases cortas, sin tecnicismos, con ejemplos reales y un toque de humor."
          className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
        />
      </Card>

      {/* ------------------------------------------------------ aprendizaje */}
      <Card className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold"><Brain className="size-4 text-primary" />Lo que la IA ha aprendido</p>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => { resetLearning(); pushNotice("Aprendizaje reiniciado.", "info"); }}>
            <Trash2 className="size-4" />Reiniciar
          </Button>
        </div>
        {stats.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía sin datos. Con cada tarea resuelta, el modelo que acierta sube en la cadena de relevo.</p>
        ) : (
          <div className="space-y-1.5">
            {stats.map((s) => (
              <div key={`${s.kind}-${s.model}`} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{TASK_LABELS[s.kind]}</span>
                <span className="font-mono">{s.model}</span>
                <span className="font-semibold text-primary">{s.wins} acierto(s)</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
