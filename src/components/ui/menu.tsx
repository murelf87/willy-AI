import { useEffect, useRef, useState, type ReactNode } from "react";

/** Menú desplegable accesible: se cierra al pulsar fuera o con Escape. Con `wide`, un panel ancho (para listas con casillas y campos). */
export function Menu({ trigger, children, align = "start", label, up = false, wide = false }: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  label: string;
  up?: boolean;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role={wide ? "dialog" : "menu"}
          aria-label={label}
          className={`z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-2xl ${
            wide
              // En pantallas estrechas el panel ancho ocupa el ancho de la pantalla (fijo bajo la barra); en las demás cuelga del botón.
              ? `fixed inset-x-3 top-16 w-auto sm:absolute sm:inset-x-auto sm:top-[calc(100%+6px)] sm:w-[22rem] ${align === "end" ? "sm:right-0" : "sm:left-0"}`
              : `absolute w-64 ${up ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"} ${align === "end" ? "right-0" : "left-0"}`
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, active, danger }: {
  onClick: () => void; children: ReactNode; active?: boolean; danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
        danger ? "text-destructive hover:bg-destructive/10" : active ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{children}</p>;
}
