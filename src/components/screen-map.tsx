// SUPER WILLY · MAPA DE PANTALLAS (rediseño, revisión 26). Todas las pantallas del proyecto de un vistazo: las rutas de una
// aplicación de una sola página («#/reservas»…) y sus páginas HTML, cada una en pequeño (la página de verdad, en un marco
// aislado y sin poder tocarla), si se ve bien, se queda en blanco o da error, y «Abrir» para ir a ella en la vista previa o
// «Reparar» si falla. Las miniaturas se cargan de pocas en pocas (una aplicación pesada no puede atascar WILLY).

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, LayoutGrid, Loader2, RotateCw, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { asMonitorMessage, pageToken, qualityOf, withMonitor } from "@/lib/preview-runtime";
import { screenMapSummary, type Routing, type Screen, type ScreenHealth } from "@/lib/screen-map";

/** Tamaño de la pantalla que se pinta en cada miniatura (el mismo aparato que la vista previa). */
const VIEWPORTS = { ordenador: { width: 1280, height: 800 }, tablet: { width: 768, height: 1024 }, movil: { width: 390, height: 844 } } as const;
export type MapDevice = keyof typeof VIEWPORTS;
/** Miniaturas cargándose a la vez, como mucho. */
const AT_ONCE = 3;
/** Si una pantalla no contesta en este tiempo, se da por «sin respuesta» (no se decide que esté rota). */
export const MINI_TIMEOUT_MS = 12_000;
const THUMB = 176;

const STATUS: Record<ScreenHealth["status"], { text: string; cls: string }> = {
  cargando: { text: "Comprobando…", cls: "text-muted-foreground" },
  bien: { text: "Se ve bien", cls: "text-emerald-600 dark:text-emerald-400" },
  "en-blanco": { text: "Se queda en blanco", cls: "text-destructive" },
  error: { text: "Da un error", cls: "text-destructive" },
  "sin-respuesta": { text: "Sin respuesta", cls: "text-amber-600 dark:text-amber-400" },
};

/** Una pantalla en pequeño: la página de verdad a su tamaño real, reducida, y lo que cuenta su vigía (se ve / en blanco / error). */
function MiniScreen({ screen, html, device, active, onResult }: { screen: Screen; html: string | null; device: MapDevice; active: boolean; onResult: (h: ScreenHealth) => void }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const vp = VIEWPORTS[device];
  const scale = THUMB / vp.width;
  const token = useMemo(() => pageToken(html ?? "", `mapa.${screen.id}`).slice(0, 60), [html, screen.id]);
  const doc = useMemo(() => (active && html ? withMonitor(html, { hash: screen.hash, token }) : null), [active, html, screen.hash, token]);
  const cb = useRef(onResult);
  cb.current = onResult;
  useEffect(() => {
    if (!doc) return;
    let done = false;
    let firstError: string | null = null;
    const finish = (h: ScreenHealth) => { if (!done) { done = true; cb.current(h); } };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const m = asMonitorMessage(e.data, token);
      if (!m) return;
      if (m.tipo === "error") { firstError = firstError ?? m.mensaje; finish({ status: "error", error: m.mensaje }); }
      if (m.tipo === "calidad") {
        const q = qualityOf({ text: m.texto, elements: m.elementos, media: m.medios, overflow: m.desborde, width: m.ancho, height: m.alto });
        finish(firstError ? { status: "error", error: firstError } : q.blank ? { status: "en-blanco" } : { status: "bien" });
      }
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => finish({ status: "sin-respuesta" }), MINI_TIMEOUT_MS);
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(timer); };
  }, [doc, token]);
  return (
    <div className="mx-auto overflow-hidden rounded border border-border bg-white" style={{ width: THUMB, height: Math.round(vp.height * scale) }} aria-hidden="true">
      {doc ? (
        <div style={{ width: vp.width, height: vp.height, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <iframe ref={ref} title={`Miniatura de ${screen.label}`} srcDoc={doc} sandbox="allow-scripts allow-forms" tabIndex={-1} className="block border-0 bg-white" style={{ width: "100%", height: "100%", pointerEvents: "none" }} />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-muted-foreground">{html ? "En espera…" : "Ábrela para verla"}</div>
      )}
    </div>
  );
}

/**
 * El mapa: todas las pantallas con su miniatura y su estado, «Abrir» y «Reparar». Si el proyecto usa rutas sin «#», lo dice y
 * ofrece pasarlo a rutas con «#» (solo así se puede abrir cada pantalla en la vista previa).
 */
export function ScreenMapPanel({ screens, routing, htmlOf, currentId, device, running, onOpen, onRepair, onFixRouting, onChecked, onRecheck, onClose }: {
  screens: Screen[]; routing: Routing; htmlOf: (s: Screen) => string | null; currentId: string | null; device: MapDevice; running: boolean;
  onOpen: (s: Screen) => void; onRepair: (s: Screen, h: ScreenHealth) => void; onFixRouting: () => void;
  /** Cuando ya se han comprobado todas (una vez): el resumen, para la consola del proyecto. */
  onChecked?: (summary: string, broken: Array<{ screen: Screen; health: ScreenHealth }>) => void;
  onRecheck: () => void; onClose: () => void;
}) {
  const [health, setHealth] = useState<Record<string, ScreenHealth>>({});
  const htmls = useMemo(() => Object.fromEntries(screens.map((s) => [s.id, htmlOf(s)])) as Record<string, string | null>, [screens, htmlOf]);
  // Se cargan de pocas en pocas: cada una que termina deja paso a la siguiente.
  const finished = screens.filter((s) => health[s.id] && health[s.id]!.status !== "cargando").length;
  const allowed = finished + AT_ONCE;
  const withHtml = screens.filter((s) => htmls[s.id]);
  const done = withHtml.every((s) => health[s.id] && health[s.id]!.status !== "cargando");
  const told = useRef(false);
  const cb = useRef(onChecked);
  cb.current = onChecked;
  useEffect(() => {
    if (told.current || !done || !withHtml.length) return;
    told.current = true;
    const checked = withHtml;
    cb.current?.(screenMapSummary(checked, health), checked.filter((s) => health[s.id]?.status === "error" || health[s.id]?.status === "en-blanco").map((s) => ({ screen: s, health: health[s.id]! })));
  }, [done, withHtml, health]);
  const blocked = (s: Screen) => routing.kind === "historial" && Boolean(s.hash);
  let order = 0;
  return (
    <div className="shrink-0 border-b border-border bg-card px-3 py-2.5 text-xs" role="region" aria-label="Mapa de pantallas" data-mapa-pantallas={screens.length}>
      <div className="flex flex-wrap items-center gap-2">
        <LayoutGrid className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 font-semibold" data-mapa-resumen>Mapa de pantallas · {screenMapSummary(withHtml.length ? withHtml : screens, health)}</p>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={onRecheck} title="Volver a comprobar todas las pantallas"><RotateCw className="size-3.5" />Comprobar otra vez</Button>
        <button type="button" onClick={onClose} aria-label="Cerrar el mapa de pantallas" className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      {routing.kind === "historial" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2" role="note" data-rutas-sin-almohadilla>
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-[12rem] flex-1">{routing.detail} Para poder abrir cada pantalla aquí, el proyecto tiene que usar rutas con «#».</p>
          <Button size="sm" variant="secondary" className="h-7 gap-1.5 px-2 text-xs" disabled={running} onClick={onFixRouting}><Wand2 className="size-3.5" />Pasar a rutas con #</Button>
        </div>
      )}
      {routing.kind === "ninguna" && screens.length <= 1 && (
        <p className="mt-2 text-muted-foreground" role="note" data-sin-rutas>Esta aplicación no tiene rutas: se ve como una sola pantalla. Si cambia de pantalla sin ruta (pestañas, pasos…), pídele a WILLY rutas con «#» y aquí verás cada una.</p>
      )}
      <ul className="mt-2 grid max-h-[45vh] grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2 overflow-auto pb-1" aria-label="Pantallas del proyecto">
        {screens.map((s) => {
          const html = htmls[s.id] ?? null;
          const h = health[s.id];
          const active = Boolean(html) && !blocked(s) && (Boolean(h) || order++ < allowed);
          const st = !html || blocked(s) ? null : h ?? { status: "cargando" as const };
          const bad = st?.status === "error" || st?.status === "en-blanco";
          return (
            <li key={s.id} className={`flex min-w-0 flex-col gap-1.5 rounded-lg border bg-background p-2 ${s.id === currentId ? "border-primary ring-1 ring-primary/40" : bad ? "border-destructive/50" : "border-border"}`} data-pantalla={s.hash ?? s.page} data-estado-pantalla={st?.status ?? "sin-comprobar"}>
              {blocked(s) ? (
                <div className="mx-auto flex items-center justify-center rounded border border-dashed border-border px-2 text-center text-[11px] text-muted-foreground" style={{ width: THUMB, height: 110 }}>Con rutas sin «#» no se puede abrir aquí</div>
              ) : (
                <MiniScreen screen={s} html={html} device={device} active={active} onResult={(r) => setHealth((cur) => (cur[s.id] ? cur : { ...cur, [s.id]: r }))} />
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold" title={s.label}>{s.label}{s.id === currentId && <span className="font-normal text-muted-foreground"> · la que ves</span>}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground" title={`${s.page}${s.hash ?? ""}${s.file ? ` · ${s.file} (línea ${s.line ?? 0})` : ""}`}>{s.hash ?? s.page}</p>
                {st && (
                  <p className={`flex items-center gap-1 font-semibold ${STATUS[st.status].cls}`} title={st.error ?? ""}>
                    {st.status === "cargando" ? <Loader2 className="size-3 animate-spin" /> : st.status === "bien" ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
                    {STATUS[st.status].text}
                  </p>
                )}
                {st?.status === "error" && st.error && <p className="line-clamp-2 break-words text-[11px] text-destructive" data-error-pantalla>{st.error}</p>}
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5">
                <Button size="sm" variant={s.id === currentId ? "ghost" : "secondary"} className="h-7 px-2 text-xs" disabled={blocked(s) || s.id === currentId} onClick={() => onOpen(s)} aria-label={`Abrir la pantalla ${s.label}`}>Abrir</Button>
                {bad && st && <Button size="sm" className="h-7 gap-1 px-2 text-xs" disabled={running} onClick={() => onRepair(s, st)} aria-label={`Reparar la pantalla ${s.label}`}><Wand2 className="size-3.5" />Reparar</Button>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
