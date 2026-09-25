// SUPER WILLY · panel de la ENTREVISTA DEL PROYECTO. Toda la lógica está en lib/project-discovery (pura y probada); aquí
// solo se enseña como una conversación: WILLY pregunta por bloques con opciones (A, B, C…), recomienda y explica; el dueño
// pulsa o escribe arriba («1C, 2B»), decide las funciones y ve el resumen antes de construir.

import { useState } from "react";
import { Check, ChevronRight, ClipboardList, Hammer, ListChecks, Loader2, Pencil, Plus, Sparkles, Wand2, X } from "lucide-react";
import { PanelCard as Card } from "@/components/panel-card";
import { Button } from "@/components/ui/button";
import {
  FEATURE_CHOICES, STEP_TITLES, addFeature, advance, answerOf, answersText, briefOf, choose, featuresOf, goTo, letterOf, progressOf,
  questionsFor, rename, requirementsCount, setFeatureChoice, setMode, stepComplete, stepsOf, summaryOf, toggleFeature,
  applyAllRecommendations, applyRecommendations,
  type DiscoveryState, type FeatureTier, type StepId,
} from "@/lib/project-discovery";

const TIER_TITLES: Record<FeatureTier, string> = {
  imprescindible: "Imprescindibles",
  recomendada: "Recomendadas",
  opcional: "Opcionales",
  futura: "Para más adelante",
};

export function ProjectDiscoveryPanel({ state, onChange, onBuild, onExit, onRecommendMore, recommending, busy, understood }: {
  state: DiscoveryState;
  onChange: (next: DiscoveryState) => void;
  onBuild: () => void;
  onExit: () => void;
  onRecommendMore: () => void;
  recommending: boolean;
  busy: boolean;
  /** Lo que WILLY entendió de lo último que escribió el dueño (se enseña debajo del bloque). */
  understood: string;
}) {
  const [newFeature, setNewFeature] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(state.name);
  const progress = progressOf(state);
  const steps = stepsOf(state);
  const done = steps.filter((s) => s !== state.step && s !== "resumen" && steps.indexOf(s) < steps.indexOf(state.step) && stepComplete(state, s));
  const complete = stepComplete(state, state.step);

  const next = () => onChange(advance(state.step === "funciones" && !state.featureChoice ? setFeatureChoice(state, "B") : state));
  const addOwnFeature = () => {
    const label = newFeature.trim();
    if (!label) return;
    onChange(addFeature(state, label));
    setNewFeature("");
  };

  return (
    <Card className="space-y-4 border-primary/40" data-testid="entrevista">
      {/* ---------------------------------------------------------- cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Entrevista del proyecto</p>
          {editingName ? (
            <form className="mt-1 flex items-center gap-1.5" onSubmit={(e: { preventDefault: () => void }) => { e.preventDefault(); onChange(rename(state, draftName)); setEditingName(false); }}>
              <input value={draftName} onChange={(e: { target: { value: string } }) => setDraftName(e.target.value)} aria-label="Nombre del proyecto" className="h-8 min-w-0 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary" autoFocus />
              <Button size="sm" type="submit" className="h-8">Guardar</Button>
            </form>
          ) : (
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <span className="truncate">{state.name}</span>
              <button type="button" onClick={() => { setDraftName(state.name); setEditingName(true); }} title="Cambiar el nombre" aria-label="Cambiar el nombre del proyecto" className="text-muted-foreground hover:text-foreground">
                <Pencil className="size-3.5" />
              </button>
            </h2>
          )}
          <p className="text-xs text-muted-foreground">Paso {progress.index} de {progress.total} · {progress.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-full border border-border text-xs" role="group" aria-label="Cómo se toman las decisiones">
            {(["guiado", "auto"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={state.mode === m}
                onClick={() => onChange(setMode(state, m))}
                title={m === "guiado" ? "WILLY pregunta, recomienda y espera tu decisión" : "WILLY decide lo técnico con sus recomendaciones y te enseña el resumen antes de construir"}
                className={`px-2.5 py-1 ${state.mode === m ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m === "guiado" ? "Guiado" : "Auto"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={onExit} title="La entrevista queda guardada: la puedes continuar cuando quieras">
            <X className="size-4" />Salir
          </Button>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Avance de la entrevista" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.index}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((progress.index / progress.total) * 100)}%` }} />
      </div>

      {/* ------------------------------------------------ lo ya decidido */}
      {done.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border bg-background/60 p-2.5 text-xs">
          <p className="font-semibold text-muted-foreground">Lo que ya hemos decidido</p>
          {done.map((s) => (
            <div key={s} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0"><Check className="mr-1 inline size-3 text-emerald-600" />{STEP_TITLES[s]}: <span className="font-mono">{answersText(state, s)}</span></span>
              <button type="button" className="text-primary underline" onClick={() => onChange(goTo(state, s))}>Cambiar</button>
            </div>
          ))}
        </div>
      )}

      {/* --------------------------------------------------- paso actual */}
      {state.step === "funciones" ? (
        <FeaturesStep state={state} onChange={onChange} newFeature={newFeature} setNewFeature={setNewFeature} addOwnFeature={addOwnFeature} onRecommendMore={onRecommendMore} recommending={recommending} />
      ) : state.step === "resumen" ? (
        <SummaryStep state={state} />
      ) : (
        <QuestionsStep state={state} step={state.step} onChange={onChange} />
      )}

      {understood && <p className="rounded-md bg-primary/5 px-2.5 py-1.5 text-xs text-muted-foreground" role="status">Entendido: {understood}</p>}

      {/* --------------------------------------------------------- botones */}
      {state.step === "resumen" ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold">¿Quieres cambiar algo antes de comenzar?</p>
          <p className="text-xs text-muted-foreground">Puedes escribirlo arriba (por ejemplo «el cliente también quiere un blog») o volver a cualquier paso.</p>
          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" onClick={onBuild} disabled={busy}><Hammer className="size-4" />Construir el proyecto</Button>
            <Button variant="outline" className="gap-2" onClick={() => onChange(goTo(state, steps[0] ?? "producto"))} disabled={busy}><Pencil className="size-4" />Cambiar algo</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {state.step !== "funciones" && (
            <Button variant="secondary" className="gap-2" onClick={() => onChange(applyRecommendations(state, state.step))}><Wand2 className="size-4" />Usar las recomendaciones de WILLY</Button>
          )}
          <Button className="gap-2" onClick={next} disabled={state.step !== "funciones" && !complete}>
            {state.step === "funciones" ? "Continuar" : "Siguiente"}<ChevronRight className="size-4" />
          </Button>
          <button type="button" className="text-xs text-primary underline" onClick={() => onChange(applyAllRecommendations(state))} title="Aplica lo que recomienda WILLY en todo lo que falta y te enseña el resumen (no construye nada todavía)">
            Usar todas las recomendaciones y ver el resumen
          </button>
          {state.step !== "funciones" && <span className="w-full text-xs text-muted-foreground">También puedes responder escribiendo arriba, por ejemplo «1C, 2B» o «haz lo que recomiendas».</span>}
        </div>
      )}

      {/* ------------------------------------------------------ brief vivo */}
      <details className="rounded-lg border border-border p-2.5 text-xs" open>
        <summary className="flex cursor-pointer items-center gap-1.5 font-semibold"><ClipboardList className="size-3.5 text-primary" />Brief del proyecto (se actualiza solo)</summary>
        <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[9rem_1fr]">
          {briefOf(state).map((line) => (
            <div key={line.label} className="contents">
              <dt className="font-semibold text-muted-foreground">{line.label}</dt>
              <dd className={line.value === "pendiente" ? "text-muted-foreground/70 italic" : ""}>{line.value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </Card>
  );
}

function QuestionsStep({ state, step, onChange }: { state: DiscoveryState; step: StepId; onChange: (next: DiscoveryState) => void }) {
  const qs = questionsFor(state, step);
  const first = stepsOf(state)[0] === step;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        {first ? "Perfecto. Antes de construirlo quiero cerrar contigo las decisiones principales, por bloques. Empecemos por el producto." : `Ahora: ${STEP_TITLES[step].toLowerCase()}.`}
      </p>
      {qs.map((q, i) => {
        const current = answerOf(state, q);
        return (
          <div key={q.id} className="rounded-lg border border-border p-3" data-question={q.id}>
            <p className="text-sm font-semibold">{i + 1}. {q.text}</p>
            <div className="mt-2 grid gap-1.5">
              {q.options.map((o) => {
                const selected = current === o.id;
                const recommended = q.recommended === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onChange(choose(state, q.id, o.id))}
                    className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition ${selected ? "border-primary bg-primary/10 font-semibold" : "border-border hover:border-primary/50 hover:bg-accent/40"}`}
                  >
                    <span className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>{letterOf(q, o.id)}</span>
                    <span className="min-w-0 flex-1">{o.label}</span>
                    {recommended && <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Recomendado</span>}
                  </button>
                );
              })}
            </div>
            {q.known && !state.answers[q.id] ? (
              <p className="mt-1.5 text-xs text-muted-foreground">Ya me lo dijiste ({q.known.because}). Si quieres otra cosa, elígela.</p>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Mi recomendación: {letterOf(q, q.recommended)}</span> — {q.reason}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FeaturesStep({ state, onChange, newFeature, setNewFeature, addOwnFeature, onRecommendMore, recommending }: {
  state: DiscoveryState;
  onChange: (next: DiscoveryState) => void;
  newFeature: string;
  setNewFeature: (v: string) => void;
  addOwnFeature: () => void;
  onRecommendMore: () => void;
  recommending: boolean;
}) {
  const features = featuresOf(state);
  return (
    <div className="space-y-3">
      <p className="text-sm">Además de lo que has pedido, creo que este producto debería incluir:</p>
      <div className="grid gap-3 md:grid-cols-2">
        {(["imprescindible", "recomendada", "opcional", "futura"] as const).map((tier) => {
          const items = features.filter((f) => f.tier === tier);
          if (!items.length) return null;
          return (
            <div key={tier} className="rounded-lg border border-border p-2.5" data-tier={tier}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{TIER_TITLES[tier]}</p>
              <ul className="space-y-0.5">
                {items.map((f) => (
                  <li key={f.id}>
                    <label className={`flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/40 ${tier === "futura" ? "cursor-default opacity-70" : ""}`}>
                      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={f.on} disabled={tier === "futura"} onChange={() => onChange(toggleFeature(state, f.id))} aria-label={f.label} />
                      <span className="min-w-0 flex-1">{f.label}{f.source === "dueño" ? <span className="ml-1 text-[10px] font-semibold text-primary">(tuya)</span> : f.source === "ia" ? <span className="ml-1 text-[10px] font-semibold text-amber-600">(idea nueva)</span> : null}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Lo de «para más adelante» no se construye ahora, pero el código queda preparado. Según lo que decidas después (pagos, avisos, datos…), añadiré lo que haga falta.</p>
      <div>
        <p className="mb-1.5 text-sm font-semibold">¿Qué incluimos?</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qué funciones incluimos">
          {FEATURE_CHOICES.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={state.featureChoice === o.id}
              onClick={() => onChange(setFeatureChoice(state, o.id))}
              className={`rounded-md border px-2.5 py-1.5 text-left text-sm ${state.featureChoice === o.id ? "border-primary bg-primary/10 font-semibold" : "border-border hover:border-primary/50"}`}
            >
              {o.id}) {o.label}{o.id === "B" && <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Recomendado</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex min-w-0 flex-1 gap-1.5" onSubmit={(e: { preventDefault: () => void }) => { e.preventDefault(); addOwnFeature(); }}>
          <input
            value={newFeature}
            onChange={(e: { target: { value: string } }) => setNewFeature(e.target.value)}
            placeholder="Añadir función o requisito del cliente…"
            aria-label="Añadir función"
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          />
          <Button type="submit" variant="outline" className="h-9 gap-1.5" disabled={!newFeature.trim()}><Plus className="size-4" />Añadir</Button>
        </form>
        <Button variant="secondary" className="h-9 gap-1.5" onClick={onRecommendMore} disabled={recommending}>
          {recommending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}Recomendarme más
        </Button>
      </div>
    </div>
  );
}

function SummaryStep({ state }: { state: DiscoveryState }) {
  const n = requirementsCount(state);
  const sections = summaryOf(state);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ListChecks className="size-5 text-primary" />
        <p className="text-base font-bold">Esto es lo que vamos a construir</p>
        <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{n} requisitos</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {sections.map((s) => (
          <div key={s.title} className={`rounded-lg border border-border p-2.5 ${s.title.startsWith("FUNCIONES") ? "md:row-span-2" : ""}`}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</p>
            <ul className="space-y-0.5 text-sm">
              {s.items.map((item, i) => <li key={`${s.title}-${i}`} className="break-words">{s.items.length > 1 ? "· " : ""}{item}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
