/** «Pensando…» con tres puntos en movimiento: sustituye a los antiguos «Generando…». */
export function ThinkingDots({ label = "Pensando" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1" role="status" aria-live="polite">
      {label}
      <span className="inline-flex items-end gap-0.5 pb-0.5" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span key={index} className="size-1 animate-bounce rounded-full bg-current" style={{ animationDelay: `${index * 160}ms` }} />
        ))}
      </span>
    </span>
  );
}
