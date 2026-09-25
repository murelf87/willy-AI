import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_VERSION } from "@/lib/version";
import { decide, expectedRestartMs, noticeTitle, rememberRestartMs, restartProgress, type Poll, type Ui } from "@/lib/update-notice";

/**
 * Globo de actualización: «WILLY AI se ha actualizado a la versión X». No se quita solo: se queda hasta que pulses Aceptar, aunque
 * recargues o abras WILLY en otro navegador. Si esta pestaña lleva el programa viejo, se recarga sola (lo que escribías queda guardado).
 */
export function UpdateNotice() {
  const [ui, setUi] = useState<Ui>({ kind: "none" });
  const missed = useRef(0);
  const tab = useRef(Math.random().toString(36).slice(2, 12));
  // Reinicio: desde cuándo no responde el programa y cuánto suele tardar (para la barra del 1 al 100 % y el tiempo que queda).
  const downSince = useRef<number | null>(null);
  const [expected, setExpected] = useState(() => expectedRestartMs(typeof window === "undefined" ? null : window.localStorage));
  const [back, setBack] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const poll = async () => {
      let result: Poll = null;
      try {
        const res = await fetch(`/api/actualizacion?tab=${tab.current}`, { cache: "no-store" });
        if (res.ok) result = (await res.json()) as Poll;
      } catch { /* servidor reiniciándose */ }
      missed.current = result ? 0 : missed.current + 1;
      if (!result && downSince.current === null) downSince.current = Date.now();
      if (result && downSince.current !== null) {
        // Ha vuelto: se apunta lo que ha tardado para que la próxima barra vaya al ritmo real de este equipo.
        const took = Date.now() - downSince.current;
        rememberRestartMs(window.localStorage, took);
        setExpected(expectedRestartMs(window.localStorage));
        downSince.current = null;
        setBack(true);
        window.setTimeout(() => { if (alive) setBack(false); }, 2500);
      }
      const next = decide(APP_VERSION, result, missed.current);
      if (!alive) return;
      // Mientras el programa no responde se pregunta cada 1,5 s (para enseñar el 100 % en cuanto vuelva); si no, cada 6 s.
      timer = window.setTimeout(() => void poll(), result ? 6000 : 1500);
      setUi(next.ui);
      if (next.reload && result) {
        // Una sola recarga por versión: si algo fallara, no se entra en un bucle.
        try {
          if (window.sessionStorage.getItem("willy-recarga") === result.version) return;
          window.sessionStorage.setItem("willy-recarga", result.version);
        } catch { /* sin sessionStorage */ }
        window.setTimeout(() => window.location.reload(), 800);
      }
    };
    void poll();
    const onFocus = () => { if (!missed.current) void poll(); };
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, []);

  // La barra avanza de 1 en 1 en tiempo real mientras dura el reinicio.
  useEffect(() => {
    if (ui.kind !== "waiting" && !back) return;
    const tick = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(tick);
  }, [ui.kind, back]);

  const accept = async () => {
    try { await fetch("/api/actualizacion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ack" }) }); } catch { /* se reintenta al volver a preguntar */ }
    setUi({ kind: "none" });
  };
  if (ui.kind === "none" && !back) return null;
  const box = "fixed bottom-4 right-4 z-[200] w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-card p-4 shadow-2xl";
  const progress = restartProgress(downSince.current === null ? 0 : now - downSince.current, expected, back);
  if (ui.kind === "none") return createPortal(<RestartBox pct={100} remainingText={progress.remainingText} />, document.body);
  return createPortal(
    ui.kind === "balloon" ? (
      <div role="alert" className={`${box} border-emerald-500/60`}>
        <p className="flex items-start gap-2 text-sm font-semibold"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />{noticeTitle(ui.notice)}</p>
        {ui.notice.notes.length > 0 && <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-auto pl-5 text-xs leading-5 text-muted-foreground">{ui.notice.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        <div className="mt-3 flex justify-end"><Button size="sm" onClick={() => void accept()}>Aceptar</Button></div>
      </div>
    ) : ui.kind === "stale" ? (
      <div role="status" className={`${box} border-primary/60`}><p className="flex items-center gap-2 text-sm"><RefreshCw className="size-4 animate-spin text-primary" />Hay una versión nueva ({ui.serverVersion}). Recargando…</p></div>
    ) : (
      <RestartBox pct={progress.pct} remainingText={progress.remainingText} />
    ),
    document.body,
  );
}

/** Aviso de reinicio con barra del 1 al 100 % (de 1 en 1, en tiempo real) y el tiempo que queda. */
function RestartBox({ pct, remainingText }: { pct: number; remainingText: string }) {
  const done = pct >= 100;
  return (
    <div role="status" aria-live="polite" className={`fixed bottom-4 right-4 z-[200] w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-card p-4 shadow-2xl ${done ? "border-emerald-500/60" : "border-border"}`}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {done ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <Loader2 className="size-4 shrink-0 animate-spin" />}
        {done ? "WILLY AI ya ha vuelto." : "WILLY AI se está reiniciando (actualización). Esta ventana seguirá sola…"}
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={100} aria-valuenow={pct} aria-label="Reinicio de WILLY AI">
        <div className={`h-full rounded-full transition-[width] duration-200 ${done ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 flex justify-between text-xs text-muted-foreground"><span className="font-semibold tabular-nums text-foreground">{pct} %</span><span>{remainingText}</span></p>
    </div>
  );
}
