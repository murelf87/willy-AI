// SUPER WILLY: con qué IA trabaja (Externa primero · Híbrida · Local primero · Solo local), APARTE de la pestaña Chat.
// Enseña si hay IA externas listas y deja añadir claves gratuitas sin salir; también el modelo de tu equipo de respaldo.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Cpu } from "lucide-react";
import { ExternalAiPanel, refreshExternalStatus, useExternalAi } from "@/components/chat-engine-chip";
import { readyNow } from "@/lib/chat-cloud";
import { isChatModel } from "@/lib/local-ai";
import { SUPER_MODES, type SuperMode } from "@/lib/super-willy";

/** «Groq +2 listas», «ninguna con clave»… en palabras sencillas. */
function cloudSummary(ai: ReturnType<typeof useExternalAi>): string {
  const status = ai.status;
  if (!status) return ai.loading ? "consultando…" : "sin datos";
  if (!status.master) return "IA externas desactivadas: contesta tu equipo";
  const withKey = status.engines.filter((e) => e.hasKey);
  if (!withKey.length) return "sin claves: contesta tu equipo";
  const ready = withKey.filter((e) => readyNow(e));
  if (!ready.length) return "ninguna lista ahora: contesta tu equipo";
  return `${ready.length} IA externa${ready.length > 1 ? "s" : ""} lista${ready.length > 1 ? "s" : ""}`;
}

export function SuperModeChip({ mode, onMode, available, localModel, onLocalModel }: {
  mode: SuperMode;
  onMode: (mode: SuperMode) => void;
  available: string[];
  localModel: string;
  onLocalModel: (name: string) => void;
}) {
  const ai = useExternalAi();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = SUPER_MODES.find((m) => m.id === mode) ?? SUPER_MODES[0]!;
  const chatModels = available.filter(isChatModel);

  useEffect(() => {
    if (!open) return;
    void refreshExternalStatus();
    const onDown = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={box} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`IA de SUPER WILLY: ${current.label}`}
        title="Con qué IA trabaja SUPER WILLY (aparte de la pestaña Chat)"
        className="inline-flex max-w-[20rem] items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
      >
        <span aria-hidden>{current.icon}</span>
        <span className="truncate">{current.label}{mode !== "solo-local" ? ` · ${cloudSummary(ai)}` : ""}</span>
        <ChevronDown className="size-3 shrink-0" />
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="IA de SUPER WILLY"
          className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-[70vh] w-[24rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-border bg-card p-3 text-xs shadow-2xl"
        >
          <h3 className="text-sm font-semibold">Con qué IA trabaja SUPER WILLY</h3>
          <p className="mb-2 leading-4 text-muted-foreground">Es aparte de la pestaña Chat. Tu equipo tiene poca memoria gráfica, por eso lo recomendado es «Externa primero» (solo IA gratuitas).</p>
          <div className="mb-3 space-y-1" role="radiogroup" aria-label="Modo de IA de SUPER WILLY">
            {SUPER_MODES.map((m) => (
              <label key={m.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 ${mode === m.id ? "border-primary/50 bg-primary/10" : "border-border hover:bg-accent/40"}`}>
                <input type="radio" name="superwilly-modo" className="mt-0.5 accent-primary" checked={mode === m.id} onChange={() => onMode(m.id)} />
                <span className="min-w-0">
                  <span className="font-semibold text-foreground">{m.icon} {m.label}{m.id === "externa" ? " (recomendado)" : ""}</span>
                  <span className="block leading-4 text-muted-foreground">{m.desc}</span>
                </span>
              </label>
            ))}
          </div>

          <label className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border px-2.5 py-2">
            <Cpu className="size-3.5 text-primary" />
            <span className="font-semibold text-foreground">Modelo de tu equipo:</span>
            <select
              value={localModel && chatModels.includes(localModel) ? localModel : ""}
              onChange={(e: { target: { value: string } }) => onLocalModel(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 font-mono"
              aria-label="Modelo de tu equipo para SUPER WILLY"
            >
              <option value="">Automático (el mejor para cada tarea)</option>
              {chatModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="w-full leading-4 text-muted-foreground">{chatModels.length ? "Aparte del modelo de la pestaña Chat." : "No hay modelos instalados en tu equipo (descárgalos en «Modelos»)."}</span>
          </label>

          {mode !== "solo-local" && <ExternalAiPanel ai={ai} compact keysOnly />}
        </section>
      )}
    </div>
  );
}
