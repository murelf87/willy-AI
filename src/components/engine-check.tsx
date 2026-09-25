import { useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";
import { useSettings } from "@/lib/workspace-store";
import { chatLocalStream, listLocalModels } from "@/lib/local-ai";
import { SYSTEM_PROMPT } from "@/lib/ai-standard";
import { visionModelsOf } from "@/lib/capabilities";
import { describeImage } from "@/lib/vision";
import { LAST_REPORT_KEY, checkMarkdown, runEngineCheck, type CheckStep } from "@/lib/engine-check";

const MARK = { ok: "✔", aviso: "⚠", fallo: "✘" } as const;
const TONE = { ok: "text-emerald-600", aviso: "text-amber-600", fallo: "text-destructive" } as const;

/** Imagen de prueba con un texto conocido: si el modelo de visión la lee bien, ve de verdad. */
async function makeImage(text: string): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 220;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("El navegador no puede crear la imagen de prueba.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111111";
  context.font = "bold 110px Arial, Helvetica, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/** Prueba de verdad, en tu equipo, si el chat y cada modelo de visión funcionan, y cuánto tardan. */
export function EngineCheck() {
  const [settings] = useSettings();
  const [steps, setSteps] = useState<CheckStep[]>([]);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState("");
  const abort = useRef<AbortController | null>(null);

  const start = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setSteps([]);
    setRunning(true);
    setPhase("Probando el motor y el chat…");
    const result = await runEngineCheck(
      {
        listModels: () => listLocalModels(settings.endpoint),
        chat: (model, messages, signal) => chatLocalStream({ endpoint: settings.endpoint, model, messages, signal, maxOutputTokens: 40, temperature: 0 }),
        describe: (model, dataUrl, prompt, signal) => describeImage(model, dataUrl, { prompt, signal }),
        makeImage,
        now: () => Date.now(),
        systemPrompt: SYSTEM_PROMPT,
        visionModels: (installed) => visionModelsOf(installed),
        ping: async () => { try { return (await fetch("/api/actualizacion", { cache: "no-store" })).ok; } catch { return false; } },
      },
      { chatModel: settings.model, signal: controller.signal, onStep: (step) => { setSteps((current) => [...current, step]); setPhase(step.id === "chat" || step.id === "largo" ? "Probando las imágenes (un modelo grande puede tardar unos minutos)…" : ""); } },
    ).catch((error: unknown) => [{ id: "error", title: "La comprobación se interrumpió", status: "fallo" as const, detail: error instanceof Error ? error.message : String(error) }]);
    if (controller.signal.aborted) pushNotice("Comprobación detenida.", "warn");
    else {
      setSteps(result);
      // Se guarda para que vaya en el paquete de «Continuar el desarrollo» (Configuración).
      try {
        window.localStorage.setItem(LAST_REPORT_KEY, checkMarkdown(result, { chatModel: settings.model, when: new Date().toLocaleString("es-ES") }));
      } catch {
        /* sin almacenamiento */
      }
    }
    setRunning(false);
    setPhase("");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(checkMarkdown(steps, { chatModel: settings.model, when: new Date().toLocaleString("es-ES") }));
      pushNotice("Informe copiado.", "success");
    } catch {
      pushNotice("No pude copiar el informe.", "warn");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">¿No va el chat o no lee las imágenes? Compruébalo aquí</p>
          <p className="text-xs text-muted-foreground">Prueba de verdad, en tu equipo, si el motor responde, si el chat entiende un mensaje largo y si cada modelo de visión sabe leer una imagen, y cuánto tarda cada cosa. Con modelos grandes puede tardar unos minutos.</p>
        </div>
        {running ? (
          <Button variant="outline" className="gap-2" onClick={() => abort.current?.abort()}><Square className="size-4" />Detener</Button>
        ) : (
          <Button variant="secondary" className="gap-2" onClick={() => void start()}><Play className="size-4" />Comprobar ahora</Button>
        )}
      </div>
      {running && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />{phase || "Trabajando…"}</p>}
      {steps.length > 0 && (
        <div className="mt-3 space-y-2 text-xs">
          <ul className="space-y-1.5">
            {steps.map((step, index) => (
              <li key={`${step.id}-${index}`} className={`leading-5 ${step.id === "resumen" ? "rounded-md border border-border bg-background p-2" : ""}`}>
                <span className={`mr-1.5 font-bold ${TONE[step.status]}`}>{MARK[step.status]}</span>
                <span className="font-semibold">{step.title}</span>{step.seconds !== undefined && <span className="text-muted-foreground"> ({step.seconds.toFixed(1)} s)</span>} <span className="text-muted-foreground">— {step.detail}</span>
              </li>
            ))}
          </ul>
          {!running && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void copy()}>Copiar informe</Button>}
        </div>
      )}
    </div>
  );
}
