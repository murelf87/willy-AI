import { Check, CircleAlert, CircleHelp, Loader2, X } from "lucide-react";
import { clearBackgroundTask, openView, useBackgroundTasks, type BackgroundTask } from "@/lib/background-tasks";

const ICON: Record<BackgroundTask["state"], typeof Check> = { trabajando: Loader2, listo: Check, pregunta: CircleHelp, error: CircleAlert };
const TONE: Record<BackgroundTask["state"], string> = {
  trabajando: "border-primary/40 text-primary",
  listo: "border-emerald-500/50 text-emerald-600",
  pregunta: "border-amber-500/60 text-amber-600",
  error: "border-destructive/50 text-destructive",
};

/**
 * Bandeja flotante (abajo a la derecha) con los trabajos de IA minimizados o en pestañas ocultas.
 * Pulsar uno lo vuelve a abrir; los terminados se pueden descartar con la X.
 */
export function BackgroundTray({ placement = "bottom", offset = 16 }: { placement?: "bottom" | "top"; offset?: number }) {
  const tasks = useBackgroundTasks();
  if (!tasks.length) return null;
  return (
    <div className="pointer-events-none fixed right-3 z-[60] flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-2" style={placement === "top" ? { top: offset } : { bottom: offset }} aria-live="polite" aria-label="Trabajos de IA en segundo plano">
      {tasks.map((task) => {
        const Icon = ICON[task.state];
        return (
          <div key={task.id} className={`pointer-events-auto flex items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-xl ${TONE[task.state]}`}>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => { if (task.restore) task.restore(); else if (task.view) openView(task.view); }}
              title="Abrir"
            >
              <Icon className={`size-4 shrink-0 ${task.state === "trabajando" ? "animate-spin" : ""}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-foreground">{task.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {task.detail ?? (task.state === "trabajando" ? "Trabajando en segundo plano…" : task.state === "pregunta" ? "Tiene una pregunta para ti" : task.state === "listo" ? "Terminado: pulsa para verlo" : "Algo ha fallado: pulsa para verlo")}
                </span>
              </span>
            </button>
            {task.state !== "trabajando" && (
              <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { if (task.dismiss) task.dismiss(); clearBackgroundTask(task.id); }} aria-label={`Descartar aviso de ${task.title}`}>
                <X className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
