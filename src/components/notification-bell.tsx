import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, CheckCheck, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearNotices, markAllRead, removeNotice, useNotices, type Notice } from "@/lib/notifications";

const ICON = {
  success: Check,
  warn: TriangleAlert,
  info: Bell,
} as const;

const TONE = {
  success: "text-emerald-500",
  warn: "text-amber-500",
  info: "text-primary",
} as const;

function Row({ n }: { n: Notice }) {
  const Icon = ICON[n.kind];
  return (
    <li className={`flex items-start gap-2 border-b border-border/60 px-3 py-2.5 last:border-0 ${n.read ? "opacity-60" : ""}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[n.kind]}`} />
      <div className="min-w-0 flex-1">
        <p className="break-words text-xs leading-relaxed">{n.text}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{n.time}</p>
      </div>
      <button
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => removeNotice(n.id)}
        aria-label="Descartar aviso"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

/** Campana de avisos del panel: muestra los pasos completados por WILLY. */
export function NotificationBell({ enabled, onOpenSettings }: { enabled: boolean; onOpenSettings: () => void }) {
  const { notices, unread } = useNotices();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread) markAllRead();
        }}
        aria-label={unread ? `Avisos (${unread} sin leer)` : "Avisos"}
        aria-expanded={open}
      >
        {enabled ? <Bell className="size-5" /> : <BellOff className="size-5 text-muted-foreground" />}
        {enabled && unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Avisos</p>
            <div className="flex items-center gap-1">
              <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={markAllRead} aria-label="Marcar todo como leído"><CheckCheck className="size-4" /></button>
              <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={clearNotices} aria-label="Vaciar avisos"><X className="size-4" /></button>
            </div>
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {notices.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                {enabled ? "Sin avisos por ahora. Te avisaré de cada paso que WILLY complete." : "Las notificaciones están desactivadas."}
              </li>
            ) : (
              notices.map((n) => <Row key={n.id} n={n} />)
            )}
          </ul>

          <button
            className="w-full border-t border-border px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => { setOpen(false); onOpenSettings(); }}
          >
            Ajustes de notificaciones
          </button>
        </div>
      )}
    </div>
  );
}
