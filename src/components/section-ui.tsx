import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

// Piezas pequeñas que comparten las pantallas de secciones (Ajustes, Centro de Inteligencia, Proyectos…): la cabecera,
// el interruptor, las pestañas y la marca de estado. Antes cada pantalla tenía su propia copia.

export function SectionHead({ title, desc, action }: { title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-bold sm:text-2xl">{title}</h1>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      {action}
    </div>
  );
}

export function Toggle({ on, onClick, label, disabled = false }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-primary" : "bg-muted"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-background transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** Pestañas de una pantalla (botones con aria-pressed, para que se puedan usar con el teclado y los lectores de pantalla). */
export function SectionTabs<T extends string>({ tabs, value, onChange, label }: { tabs: ReadonlyArray<readonly [T, string]>; value: T; onChange: (tab: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex w-full flex-wrap gap-1 rounded-lg border border-border bg-card p-1 sm:w-fit">
      {tabs.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${value === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export type Tone = "ok" | "aviso" | "fallo" | "info";

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-emerald-600",
  aviso: "text-amber-600",
  fallo: "text-destructive",
  info: "text-muted-foreground",
};

/** Icono de estado: bien, aviso, fallo o información. */
export function StatusIcon({ tone, className = "size-4" }: { tone: Tone; className?: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "aviso" ? AlertTriangle : tone === "fallo" ? XCircle : Info;
  return <Icon className={`${className} shrink-0 ${TONE_CLASS[tone]}`} aria-hidden="true" />;
}

export const toneText = (tone: Tone): string => TONE_CLASS[tone];
