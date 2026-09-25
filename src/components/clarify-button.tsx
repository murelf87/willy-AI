import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Loader2, Minus, RotateCcw, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";
import { clearBackgroundTask, setBackgroundTask } from "@/lib/background-tasks";
import { useSettings } from "@/lib/workspace-store";
import { aiService } from "@/services/ai-service";
import { planChain } from "@/services/orchestrator";
import { clarify, type ChatFn, type ClarifyResult } from "@/lib/clarify-flow";
import { CONTEXT_TITLE, ambiguitySignals, describeLiterals, type Answer, type ClarifyContext } from "@/lib/clarify";

type Phase = "leyendo" | "dudas" | "listo";

/**
 * «Que la IA lo entienda exactamente»: escribes con tus palabras y este botón las convierte en una instrucción precisa.
 * Antes de reescribir te pregunta (con botones) lo que podría entenderse de dos maneras, te enseña qué ha entendido y
 * qué ha supuesto, y garantiza que ninguno de tus datos (textos entre comillas, cifras, fechas, nombres, archivos) se pierda.
 */
export function ClarifyButton({
  value,
  onApply,
  context,
  label,
  iconOnly = false,
  compact = false,
  variant = "ghost",
  className = "",
}: {
  value: string;
  onApply: (text: string) => void;
  context: ClarifyContext;
  label?: string;
  iconOnly?: boolean;
  compact?: boolean;
  variant?: "ghost" | "secondary" | "outline";
  className?: string;
}) {
  const [settings] = useSettings();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("leyendo");
  const [result, setResult] = useState<ClarifyResult | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  // Minimizada: la IA sigue trabajando y la ventana se queda como un aviso pequeño abajo a la derecha.
  const [minimized, setMinimized] = useState(false);
  const original = useRef("");
  const abort = useRef<AbortController | null>(null);
  const taskId = useRef(`aclarar-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    if (!open || minimized) return;
    // En fase de captura y cortando el evento: Escape cierra SOLO esta ventana, no la de «Nuevo proyecto» que pueda haber debajo.
    // Si la IA todavía está trabajando, Escape la minimiza en vez de cancelarla (no se pierde nada).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (working) setMinimized(true);
      else close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, minimized, working]);

  // Mientras está minimizada, se enseña en la bandeja de trabajos en segundo plano con su estado real.
  useEffect(() => {
    const id = taskId.current;
    if (!open || !minimized) { clearBackgroundTask(id); return; }
    const snippet = original.current.replace(/\s+/g, " ").slice(0, 60);
    setBackgroundTask({
      id,
      title: "Aclarar con IA",
      state: working ? "trabajando" : phase === "dudas" ? "pregunta" : "listo",
      detail: working ? `Leyendo «${snippet}${original.current.length > 60 ? "…" : ""}»` : phase === "dudas" ? "Tiene preguntas para ti: pulsa para responder" : "Versión lista: pulsa para revisarla",
      restore: () => setMinimized(false),
      dismiss: () => close(),
    });
  }, [open, minimized, working, phase]);
  useEffect(() => () => clearBackgroundTask(taskId.current), []);
  const minimizedRef = useRef(false);
  minimizedRef.current = minimized;

  const close = () => {
    abort.current?.abort();
    setOpen(false);
    setMinimized(false);
    setWorking(false);
  };

  /** El modelo que mejor razona de los instalados; si uno falla o se niega, entra el siguiente. */
  const makeChat = async (): Promise<ChatFn> => {
    const models = await aiService.models(settings.endpoint);
    const available = models.ok ? models.data.map((model) => model.name) : [];
    const chain = planChain("razonamiento", settings.model, available).slice(0, 3);
    return async (messages, attempt) => {
      if (!chain.length) return { ok: false, error: "No hay ningún modelo disponible en el motor local." };
      const res = await aiService.chat({ endpoint: settings.endpoint, model: chain[attempt % chain.length]!, messages, maxOutputTokens: 1400, numCtx: 8192, ...(abort.current ? { signal: abort.current.signal } : {}) });
      return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error };
    };
  };

  const run = async (given?: Answer[]) => {
    abort.current = new AbortController();
    setWorking(true);
    setPhase("leyendo");
    const chat = await makeChat();
    const res = await clarify(chat, { text: original.current, context, ...(given?.length ? { answers: given } : {}) });
    if (abort.current?.signal.aborted) return;
    setResult(res);
    setDraft(res.instruction);
    setAnswers({});
    setPhase(res.questions.length ? "dudas" : "listo");
    setWorking(false);
    if (minimizedRef.current) pushNotice(res.questions.length ? "«Aclarar con IA» tiene preguntas para ti (abajo a la derecha)." : "«Aclarar con IA» ha terminado: tienes la versión lista abajo a la derecha.", "success");
  };

  const start = () => {
    // Si ya había una minimizada, el botón simplemente la vuelve a abrir (no empieza otra ni pierde lo hecho).
    if (open && minimized) { setMinimized(false); return; }
    if (!value.trim()) return;
    original.current = value;
    setResult(null);
    setMinimized(false);
    setOpen(true);
    void run();
  };

  const continueWithAnswers = () => {
    if (!result) return;
    const given: Answer[] = result.questions.flatMap((q, index) => (answers[index]?.trim() ? [{ question: q.question, answer: answers[index]!.trim() }] : []));
    if (!given.length) {
      setPhase("listo");
      return;
    }
    void run(given);
  };

  const apply = () => {
    if (!draft.trim()) return;
    onApply(draft.trim());
    close();
    pushNotice("Texto aclarado. Revísalo y envíalo cuando quieras.", "success");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      pushNotice("Copiado.", "success");
    } catch {
      pushNotice("No pude copiar al portapapeles.", "warn");
    }
  };

  const early = ambiguitySignals(original.current || value, context);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={iconOnly ? "icon" : compact ? "sm" : "default"}
        className={`${iconOnly ? "size-8 shrink-0" : "gap-2"} ${className}`}
        disabled={!(open && minimized) && (!value.trim() || working)}
        onClick={start}
        aria-label={open && minimized ? "Volver a abrir «Aclarar con IA» (sigue en segundo plano)" : "Que la IA lo entienda exactamente"}
        title={open && minimized ? "Sigue trabajando en segundo plano: pulsa para verlo" : "Escribe con tus palabras y la IA lo convierte en una instrucción precisa, sin ambigüedades"}
      >
        {open && minimized && working ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
        {!iconOnly && (label ?? "Aclarar con IA")}
      </Button>
      {open && !minimized &&
        createPortal(
          // Pulsar fuera ya NO cancela el trabajo: lo minimiza (sigue en segundo plano, abajo a la derecha).
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={(event) => { event.stopPropagation(); setMinimized(true); }}>
            <div role="dialog" aria-modal="true" aria-label="Aclarar lo que quieres" className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
              <div className="mb-3 flex items-start gap-2">
                <Wand2 className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">Que la IA lo entienda exactamente</h2>
                  <p className="text-xs text-muted-foreground">Tipo de texto: {CONTEXT_TITLE[context]}. Tus palabras no se tocan hasta que pulses «Usar esta versión».</p>
                </div>
                <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => setMinimized(true)} aria-label="Minimizar (sigue trabajando en segundo plano)" title="Minimizar: sigue trabajando en segundo plano"><Minus className="size-4" /></Button>
                <Button type="button" variant="ghost" size="icon" className="size-7" onClick={close} aria-label="Cerrar y cancelar" title="Cerrar y cancelar"><X className="size-4" /></Button>
              </div>

              <div className="mb-3 rounded-md border border-border bg-background p-2 text-xs">
                <p className="mb-1 font-semibold text-muted-foreground">Tus palabras</p>
                <p className="whitespace-pre-wrap break-words">{original.current}</p>
              </div>

              {phase === "leyendo" && (
                <div className="space-y-2 text-xs">
                  <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Leyendo lo que has escrito y buscando lo que se podría entender de dos maneras…</p>
                  {early.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                      {early.map((signal) => <li key={signal.id}><span className="font-semibold text-foreground">«{signal.quote}»</span>: {signal.why}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {phase === "dudas" && result && (
                <div className="space-y-3 text-xs">
                  <p className="font-semibold">Para no equivocarme necesito saber esto (pulsa una respuesta o escribe la tuya):</p>
                  {result.questions.map((question, index) => (
                    <div key={question.question} className="rounded-md border border-border bg-background p-3">
                      <p className="mb-2 font-semibold">{question.question}</p>
                      <div className="flex flex-wrap gap-2">
                        {question.options.map((option) => (
                          <Button key={option} type="button" size="sm" variant={answers[index] === option ? "primary" : "outline"} className="h-7 text-xs" onClick={() => setAnswers((current) => ({ ...current, [index]: option }))}>{option}</Button>
                        ))}
                      </div>
                      <input
                        value={question.options.includes(answers[index] ?? "") ? "" : answers[index] ?? ""}
                        onChange={(event) => setAnswers((current) => ({ ...current, [index]: event.target.value }))}
                        placeholder="Otra respuesta…"
                        className="mt-2 w-full rounded-md border border-border bg-card px-2 py-1.5 outline-none focus:border-primary"
                        aria-label={`Otra respuesta: ${question.question}`}
                      />
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" disabled={working} onClick={continueWithAnswers}>{working ? "Reescribiendo…" : "Continuar"}</Button>
                    <Button type="button" size="sm" variant="outline" disabled={working} onClick={() => setPhase("listo")}>Saltar las preguntas (que suponga lo más probable)</Button>
                  </div>
                </div>
              )}

              {phase === "listo" && result && (
                <div className="space-y-3 text-xs">
                  {result.source === "plantilla" && (
                    <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 leading-5">La IA no pudo reescribirlo ({result.note}). Te dejo una versión ordenada sin IA: tus palabras tal cual, tus datos exactos y reglas para no equivocarse. Revísala.</p>
                  )}
                  {result.understood && (
                    <p className="rounded-md bg-primary/10 p-2 leading-5"><span className="font-semibold">Lo que he entendido:</span> {result.understood}</p>
                  )}
                  <label className="block">
                    <span className="mb-1 block font-semibold">Instrucción para la IA (puedes editarla)</span>
                    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={9} className="w-full resize-y rounded-md border border-border bg-background p-2 leading-5 outline-none focus:border-primary" />
                  </label>
                  {(result.kept.length > 0 || result.repaired.length > 0) && (
                    <p className="leading-5">
                      <span className="font-semibold text-emerald-600">✔ Datos tuyos conservados tal cual:</span> {describeLiterals([...result.kept, ...result.repaired])}.
                      {result.repaired.length > 0 && <span className="text-muted-foreground"> La IA se había dejado {result.repaired.length === 1 ? "uno" : result.repaired.length}: WILLY {result.repaired.length === 1 ? "lo añadió" : "los añadió"} al final ({describeLiterals(result.repaired)}).</span>}
                    </p>
                  )}
                  {result.assumptions.length > 0 && (
                    <div className="leading-5">
                      <p className="font-semibold">He supuesto esto (edítalo arriba si no es así):</p>
                      <ul className="list-disc pl-5 text-muted-foreground">{result.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  )}
                  {result.signals.length > 0 && result.source === "ia" && (
                    <p className="leading-5 text-muted-foreground">Podía malinterpretarse: {result.signals.map((signal) => `«${signal.quote}» (${signal.why})`).join("; ")}.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={apply} disabled={!draft.trim()}>Usar esta versión</Button>
                    <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={working} onClick={() => void run()}><RotateCcw className="size-3.5" />Volver a intentarlo</Button>
                    <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => void copy()}><Copy className="size-3.5" />Copiar</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={close}>Quedarme con mis palabras</Button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
