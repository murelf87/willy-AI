// SUPER WILLY · EDICIÓN VISUAL (rediseño, revisión 24 · fase 10). Las herramientas visuales del taller del proyecto:
// - «Seleccionar elemento» (puntos 17-18): el panel «¿Qué quieres cambiar?» del elemento que has tocado, con cambios rápidos.
//   Los detalles técnicos (selector, HTML, estilos, archivo y línea) van a la IA; aquí solo se ven en el modo avanzado.
// - «Revisar diseño» (puntos 19-20): la revisión en ordenador, tableta y móvil (marcos ocultos que pintan la página a cada
//   ancho y la miden), las CAPTURAS de verdad hechas con el navegador del equipo, la opinión (opcional) de una IA con visión y
//   «Arreglar lo elegido» sin cambiar el diseño aprobado.
// - «Comparar» (punto 22): ANTES | DESPUÉS (o dos versiones cualesquiera) lado a lado, al mismo tamaño y moviéndose a la vez.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Eye, ImageOff, Loader2, MousePointerClick, RotateCw, ScanEye, Sparkles, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import type { GeneratedFile } from "@/lib/ai-standard";
import {
  countsByDevice, designVisionPrompt, devicesText, LEVEL_LABEL, mergeReview, REVIEW_DEVICES, REVIEW_SIZES, reviewSummary,
  type CaptureResult, type ReviewDevice, type ReviewIssue, type Shot,
} from "@/lib/design-review";
import { changeSummary, compareFiles } from "@/lib/line-diff";
import { previewOf } from "@/lib/live-files";
import { listLocalModels } from "@/lib/local-ai";
import { usePersistentState } from "@/lib/persistent-state";
import { asMonitorMessage, pageToken, sendOrder, withMonitor, type RawIssue } from "@/lib/preview-runtime";
import { describerCandidates, describeWithRelay, sizeHint } from "@/lib/vision";
import { pickedLabel, quickChanges, technicalDetails, type PickedElement, type SourceHit } from "@/lib/visual-edit";
import { compileProjectPreview, fetchVersion } from "@/services/disk-project-service";
import { compileTarget, issueText, type CompileOutcome } from "@/lib/project-compile";
import type { ProjectVersion } from "@/types/domain";

/** El motor local (para la IA con visión que mira las capturas). */
export type VisionConfig = { endpoint: string; model: string };

const fmtDate = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };

/** El marco de la vista previa: al ancho real del dispositivo (su «viewport» cambia de verdad); si no cabe, se ve a escala. */
export function PreviewStage({ width, children }: { width: number | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setRoom(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setRoom(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = width && room && room < width ? room / width : 1;
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-accent/40 p-2 sm:p-3">
      <div ref={ref} className="h-full w-full">
        <div className="mx-auto h-full overflow-hidden rounded-lg border border-border bg-white shadow-lg" style={{ width: width ? Math.floor(width * scale) : "100%" }} data-ancho-vista={width ?? "completo"}>
          <div style={width ? { width, height: `${100 / scale}%`, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "0 0" } : { width: "100%", height: "100%" }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Seleccionar elemento

/** «¿Qué quieres cambiar?» del elemento que el dueño ha tocado en la vista previa. */
export function ElementPanel({ picked, hits, running, onAsk, onRepick, onClose }: {
  picked: PickedElement; hits: SourceHit[]; running: boolean;
  onAsk: (wish: string) => void; onRepick: () => void; onClose: () => void;
}) {
  const [wish, setWish] = useState("");
  const [advanced, setAdvanced] = usePersistentState<boolean>("superwilly:detalles-tecnicos", false);
  const label = pickedLabel(picked);
  const send = (text: string) => {
    const t = text.trim();
    if (!t || running) return;
    onAsk(t);
    setWish("");
  };
  return (
    <div className="shrink-0 border-b border-violet-500/30 bg-violet-500/5 px-3 py-2.5 text-xs" role="region" aria-label="Elemento elegido" data-elemento-elegido={picked.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <MousePointerClick className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
        <p className="min-w-0 flex-1 font-semibold" data-elegido-texto>
          Has elegido {label}{picked.inside && <span className="font-normal text-muted-foreground"> · dentro de: {picked.inside}</span>}
        </p>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onRepick} disabled={running}>Elegir otro</Button>
        <button type="button" onClick={onClose} aria-label="Quitar la selección" title="Quitar la selección" className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      <form className="mt-2 flex items-center gap-2" onSubmit={(e: { preventDefault: () => void }) => { e.preventDefault(); send(wish); }}>
        <input
          value={wish}
          onChange={(e: { target: { value: string } }) => setWish(e.target.value)}
          placeholder="¿Qué quieres cambiar? (por ejemplo: «ponlo más pequeño»)"
          aria-label="¿Qué quieres cambiar?"
          disabled={running}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
        />
        <Button type="submit" size="sm" className="h-8 shrink-0 gap-1.5 px-2.5 text-xs" disabled={running || !wish.trim()}><Wand2 className="size-3.5" />Pedir a WILLY</Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Cambios rápidos">
        {quickChanges(picked.kind).map((q) => (
          <button key={q} type="button" disabled={running} onClick={() => send(q)} className="rounded-full border border-border bg-background px-2 py-0.5 hover:border-primary hover:text-primary disabled:opacity-50">{q}</button>
        ))}
      </div>
      {running && <p className="mt-1.5 flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />WILLY está cambiando {label}…</p>}
      <button type="button" aria-pressed={advanced} onClick={() => setAdvanced(!advanced)} className="mt-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
        {advanced ? "Ocultar los detalles técnicos" : "Detalles técnicos (avanzado)"}
      </button>
      {advanced && (
        <dl className="mt-1.5 grid gap-1 rounded-md border border-border bg-background p-2 font-mono text-[11px]" aria-label="Detalles técnicos del elemento">
          {technicalDetails(picked, hits).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="break-all">{v}</dd></div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Revisar diseño

/** Una revisión en marcha o hecha: la página revisada, lo que ha encontrado cada tamaño y las capturas. */
export type ReviewRun = {
  id: number;
  page: string;
  hash: string | null;
  /** La página tal como se revisó (para saber si ha cambiado después). */
  html: string;
  /** Lo que ha encontrado cada tamaño (null: no se pudo revisar a tiempo); sin la clave, todavía revisando. */
  byDevice: Partial<Record<ReviewDevice, RawIssue[] | null>>;
  staticIssues: RawIssue[];
  shots: { status: "cargando" | "ok" | "error"; data?: CaptureResult; error?: string };
};

/** Si un tamaño no contesta en este tiempo, se da por no revisado (la página no deja ejecutar scripts, tarda muchísimo…). */
export const REVIEW_TIMEOUT_MS = 15_000;

/**
 * Los marcos ocultos de la revisión: la misma página (y la misma ruta) a 1280, 768 y 390 px, cada uno con su marca. Se ven
 * (para el navegador) pero no se ven (para ti): transparentes y detrás de todo, sin recibir clics.
 */
export function ReviewFrames({ runId, html, hash, onResult }: { runId: number; html: string; hash: string | null; onResult: (device: ReviewDevice, problems: RawIssue[] | null) => void }) {
  const refs = useRef<Partial<Record<ReviewDevice, HTMLIFrameElement | null>>>({});
  const tokens = useMemo(() => Object.fromEntries(REVIEW_DEVICES.map((d) => [d, `rev${runId}.${d}`])) as Record<ReviewDevice, string>, [runId]);
  const docs = useMemo(() => Object.fromEntries(REVIEW_DEVICES.map((d) => [d, withMonitor(html, { hash, token: tokens[d], review: true })])) as Record<ReviewDevice, string>, [html, hash, tokens]);
  const cb = useRef(onResult);
  cb.current = onResult;
  useEffect(() => {
    const done = new Set<ReviewDevice>();
    const onMessage = (e: MessageEvent) => {
      for (const d of REVIEW_DEVICES) {
        if (e.source !== refs.current[d]?.contentWindow) continue;
        const m = asMonitorMessage(e.data, tokens[d]);
        if (m?.tipo === "revision" && !done.has(d)) { done.add(d); cb.current(d, m.problemas); }
      }
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => { for (const d of REVIEW_DEVICES) if (!done.has(d)) { done.add(d); cb.current(d, null); } }, REVIEW_TIMEOUT_MS);
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(timer); };
  }, [tokens]);
  return (
    <div aria-hidden="true" style={{ position: "fixed", left: 0, top: 0, width: 0, height: 0, overflow: "visible", opacity: 0, pointerEvents: "none", zIndex: -1 }} data-revision-marcos={runId}>
      {REVIEW_DEVICES.map((d) => (
        <iframe
          key={`${runId}-${d}`}
          ref={(el: HTMLIFrameElement | null) => { refs.current[d] = el; }}
          title={`Revisión del diseño (${REVIEW_SIZES[d].label})`}
          srcDoc={docs[d]}
          sandbox="allow-scripts allow-forms"
          tabIndex={-1}
          style={{ position: "absolute", left: 0, top: 0, width: REVIEW_SIZES[d].width, height: REVIEW_SIZES[d].height, border: 0, background: "#fff" }}
        />
      ))}
    </div>
  );
}

type VisionState = { status: "idle" | "mirando" | "hecho" | "error"; notes: Array<{ device: ReviewDevice; model: string; text: string }>; stage?: string; error?: string };

const LEVEL_CLASS: Record<ReviewIssue["level"], string> = {
  error: "bg-destructive/15 text-destructive",
  aviso: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  sugerencia: "bg-primary/10 text-primary",
};

/** El resultado de «Revisar diseño»: capturas, problemas (elige cuáles arreglar), la IA de visión y «Arreglar lo elegido». */
export function DesignReviewPanel({ run, stale, running, vision, onSee, onFix, onRerun, onClose }: {
  run: ReviewRun; stale: boolean; running: boolean; vision?: VisionConfig | undefined;
  onSee: (issue: ReviewIssue) => void; onFix: (issues: ReviewIssue[], visionNotes: string[]) => void; onRerun: () => void; onClose: () => void;
}) {
  const checked = REVIEW_DEVICES.filter((d) => Array.isArray(run.byDevice[d]));
  const pending = REVIEW_DEVICES.filter((d) => !(d in run.byDevice));
  const issues = useMemo(() => mergeReview(run.byDevice, run.staticIssues), [run.byDevice, run.staticIssues]);
  const counts = countsByDevice(issues, checked);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const touched = useRef(false);
  useEffect(() => { touched.current = false; }, [run.id]);
  // Por defecto se eligen los importantes y los avisos (las sugerencias, si tú quieres).
  useEffect(() => { if (!touched.current) setChosen(new Set(issues.filter((i) => i.level !== "sugerencia").map((i) => i.id))); }, [issues]);
  const [open, setOpen] = useState(true);
  const [shot, setShot] = useState<Shot | null>(null);
  const [seen, setSeen] = useState<VisionState>({ status: "idle", notes: [] });
  const [useVision, setUseVision] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { abortRef.current?.abort(); setSeen({ status: "idle", notes: [] }); }, [run.id]);

  const toggle = (id: string) => {
    touched.current = true;
    setChosen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const lookWithVision = async () => {
    const shots = run.shots.data?.shots ?? [];
    if (!vision || !shots.length) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSeen({ status: "mirando", notes: [], stage: "Buscando un modelo con visión en tu equipo…" });
    const installed = await listLocalModels(vision.endpoint).catch(() => [] as string[]);
    if (controller.signal.aborted) return;
    const models = describerCandidates(vision.model, installed);
    if (!models.length) {
      setSeen({ status: "error", notes: [], error: "Para que una IA mire las capturas hace falta un modelo con visión en tu equipo (por ejemplo gemma3:4b o qwen2.5vl:3b). Instálalo desde Centro de Inteligencia → Modelos." });
      return;
    }
    const notes: VisionState["notes"] = [];
    // El móvil y el ordenador (la tableta suele estar entre los dos): con un modelo en el procesador, cada una tarda.
    const wanted = (["movil", "ordenador"] as ReviewDevice[]).map((d) => shots.find((s) => s.device === d)).filter((s): s is Shot => Boolean(s));
    for (const s of wanted) {
      if (controller.signal.aborted) return;
      const r = await describeWithRelay(models, s.image, {
        prompt: designVisionPrompt(s.device),
        signal: controller.signal,
        onTry: (model) => setSeen((p) => ({ ...p, stage: `Mirando la captura de ${REVIEW_SIZES[s.device].label.toLowerCase()} con ${model}…${sizeHint(model)}` })),
      });
      if (controller.signal.aborted) return;
      if (!r.ok) {
        setSeen({ status: notes.length ? "hecho" : "error", notes, error: r.error });
        return;
      }
      notes.push({ device: s.device, model: r.model, text: r.text });
      setSeen((p) => ({ ...p, notes: [...notes] }));
    }
    setSeen({ status: "hecho", notes });
  };
  const stopVision = () => { abortRef.current?.abort(); setSeen((p) => ({ status: p.notes.length ? "hecho" : "idle", notes: p.notes, ...(p.error ? { error: p.error } : {}) })); };

  const selected = issues.filter((i) => chosen.has(i.id));
  const visionNotes = useVision && seen.notes.length ? seen.notes.map((n) => `${REVIEW_SIZES[n.device].label}: ${n.text}`) : [];
  const summary = pending.length ? `Revisando el diseño de «${run.page}»${run.hash ? ` (${run.hash})` : ""}…` : reviewSummary(issues, checked);
  return (
    <div className="shrink-0 border-b border-border bg-card text-xs" role="region" aria-label="Revisión del diseño">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {pending.length ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" /> : <ScanEye className={`size-4 shrink-0 ${issues.some((i) => i.level === "error") ? "text-destructive" : issues.length ? "text-amber-500" : "text-emerald-500"}`} />}
        <p className="min-w-[12rem] flex-1 font-semibold" data-resumen-revision>{summary}</p>
        {REVIEW_DEVICES.map((d) => {
          const n = counts[d];
          const text = pending.includes(d) ? "…" : n === null ? "sin revisar" : n === 0 ? "✓" : String(n);
          return (
            <span key={d} data-revision-tamano={d} data-revision-cuenta={pending.includes(d) ? "" : n === null ? "x" : String(n)}
              className={`shrink-0 rounded-full border px-2 py-0.5 font-semibold ${n ? "border-amber-500/40 text-amber-700 dark:text-amber-400" : n === 0 ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-border text-muted-foreground"}`}>
              {REVIEW_SIZES[d].label}: {text}
            </span>
          );
        })}
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground">{open ? "Plegar" : "Desplegar"}</button>
        <button type="button" onClick={onClose} aria-label="Cerrar la revisión del diseño" className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      {open && (
        <div className="max-h-[42vh] overflow-auto border-t border-border px-3 py-2">
          {stale && (
            <p className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1" data-revision-antigua>
              La página ha cambiado desde esta revisión.
              <button type="button" onClick={onRerun} disabled={running} className="font-semibold text-primary">Volver a revisar</button>
            </p>
          )}
          <div aria-label="Capturas de verdad" role="group">
            {run.shots.status === "cargando" && <p className="flex items-center gap-1.5 text-muted-foreground" data-capturas="cargando"><Loader2 className="size-3.5 animate-spin" />Haciendo capturas de verdad con el navegador de tu equipo…</p>}
            {run.shots.status === "error" && <p className="flex items-center gap-1.5 text-muted-foreground" data-capturas="error"><ImageOff className="size-3.5 shrink-0" />{run.shots.error}</p>}
            {run.shots.status === "ok" && run.shots.data && (
              <>
                <p className="mb-1 text-muted-foreground">Así se ve de verdad (capturas hechas con {run.shots.data.browser} en tu equipo):</p>
                <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Capturas" data-capturas="ok">
                  {run.shots.data.shots.map((s) => (
                    <li key={s.device} className="shrink-0">
                      <button type="button" onClick={() => setShot(s)} aria-label={`Ver la captura en ${REVIEW_SIZES[s.device].label.toLowerCase()}`} className="rounded-md border border-border bg-background p-1 text-left hover:border-primary">
                        <img src={s.image} alt={`Captura en ${REVIEW_SIZES[s.device].label.toLowerCase()}`} className="h-24 w-auto rounded-sm" />
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">{REVIEW_SIZES[s.device].label} · {s.width} px</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {run.shots.data.errors.length > 0 && <p className="text-muted-foreground">Sin captura: {run.shots.data.errors.join(" · ")}</p>}
              </>
            )}
          </div>
          {pending.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Midiendo la página en {pending.map((d) => REVIEW_SIZES[d].label.toLowerCase()).join(", ")}…</p>
          )}
          {!pending.length && !issues.length && checked.length > 0 && (
            <p className="mt-2 text-emerald-600 dark:text-emerald-400">✓ No se sale nada, no se tapa nada, se lee bien y los botones tienen buen tamaño.</p>
          )}
          {issues.length > 0 && (
            <ul className="mt-2 space-y-1" aria-label="Problemas de diseño">
              {issues.map((i) => (
                <li key={i.id} className="flex items-start gap-2" data-problema={i.kind} data-nivel={i.level}>
                  <input type="checkbox" className="mt-0.5" checked={chosen.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Arreglar: ${i.text}`} />
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${LEVEL_CLASS[i.level]}`}>{LEVEL_LABEL[i.level]}</span>
                  <span className="min-w-0 flex-1">{i.text} <span className="text-muted-foreground">({devicesText(i.devices)})</span></span>
                  {i.selector && <button type="button" onClick={() => onSee(i)} className="shrink-0 font-semibold text-primary" aria-label={`Ver dónde está: ${i.text}`}><Eye className="mr-0.5 inline size-3.5" />Ver</button>}
                </li>
              ))}
            </ul>
          )}
          {run.shots.status === "ok" && vision && (
            <div className="mt-2 rounded-md border border-border p-2" role="region" aria-label="Opinión de la IA de visión">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-[12rem] flex-1">Una IA con visión de tu equipo puede mirar las capturas y opinar del diseño (tarda más; las imágenes no salen de tu equipo).</span>
                {seen.status === "mirando" ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={stopVision}>Parar</Button>
                ) : (
                  <Button size="sm" variant="secondary" className="h-7 gap-1.5 px-2 text-xs" onClick={() => void lookWithVision()}><Eye className="size-3.5" />{seen.notes.length ? "Que las mire otra vez" : "Que la IA mire las capturas"}</Button>
                )}
              </div>
              {seen.status === "mirando" && <p className="mt-1 flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{seen.stage}</p>}
              {seen.error && <p className="mt-1 text-destructive" data-vision-error>{seen.error}</p>}
              {seen.notes.length > 0 && (
                <>
                  <ul className="mt-1 space-y-1" aria-label="Lo que ha visto la IA">
                    {seen.notes.map((n) => (
                      <li key={n.device} className="whitespace-pre-wrap rounded bg-accent/40 p-1.5"><span className="font-semibold">{REVIEW_SIZES[n.device].label}</span> <span className="text-muted-foreground">({n.model})</span>: {n.text}</li>
                    ))}
                  </ul>
                  <label className="mt-1 flex items-center gap-1.5">
                    <input type="checkbox" checked={useVision} onChange={(e: { target: { checked: boolean } }) => setUseVision(e.target.checked)} />
                    Tener en cuenta lo que ha visto la IA al arreglar
                  </label>
                </>
              )}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={running || pending.length > 0 || (!selected.length && !visionNotes.length)} onClick={() => onFix(selected, visionNotes)}>
              <Wand2 className="size-3.5" />Arreglar lo elegido ({selected.length})
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={onRerun} disabled={running || pending.length > 0}><RotateCw className="size-3.5" />Volver a revisar</Button>
            <span className="min-w-[12rem] flex-1 text-muted-foreground">WILLY arregla solo lo elegido, sin cambiar tu diseño; si hiciera falta un cambio grande, te pregunta antes.</span>
          </div>
        </div>
      )}
      {shot && <ShotModal shot={shot} onClose={() => setShot(null)} />}
    </div>
  );
}

function ShotModal({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  useEscapeToClose(onClose);
  const label = REVIEW_SIZES[shot.device].label;
  return (
    <div className="safe-modal fixed inset-0 z-50 flex flex-col bg-background/95" role="dialog" aria-label={`Captura en ${label.toLowerCase()}`}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Captura de verdad · {label} ({shot.width}×{shot.height} px)</span>
        <Button size="sm" className="h-9 gap-1.5" onClick={onClose}><X className="size-4" />Cerrar</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <img src={shot.image} alt={`Captura en ${label.toLowerCase()}`} className="mx-auto block max-w-none rounded border border-border" style={{ width: shot.width }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Comparar

const NOW = "ahora";

type Side = { state: "cargando" } | { state: "error" } | { state: "sin-pagina"; files: GeneratedFile[] } | { state: "no-compila"; files: GeneratedFile[]; error: string } | { state: "ok"; files: GeneratedFile[]; html: string };
type PaneState = "cargando" | "lista" | "error" | "en-blanco";

/**
 * ANTES | DESPUÉS (punto 22): dos versiones del proyecto lado a lado (por defecto, la de antes del último cambio y lo de ahora),
 * con la misma página y ruta, al mismo tamaño de pantalla, y moviéndose a la vez si quieres. Encima, qué archivos cambiaron.
 */
export function CompareStage({ projectId, files, versions, page, hash, width, onClose }: {
  projectId: string; files: GeneratedFile[]; versions: ProjectVersion[]; page: string | null; hash: string | null; width: number; onClose: () => void;
}) {
  const [left, setLeft] = useState<string>(() => versions[1]?.id ?? versions[0]?.id ?? NOW);
  const [right, setRight] = useState<string>(NOW);
  const [sync, setSync] = usePersistentState<boolean>("superwilly:comparar-a-la-vez", true);
  const cache = useRef(new Map<string, GeneratedFile[] | null | "cargando">());
  const [, setTick] = useState(0);
  useEffect(() => {
    for (const id of [left, right]) {
      if (id === NOW || cache.current.has(id)) continue;
      cache.current.set(id, "cargando");
      void fetchVersion(id).then((v) => { cache.current.set(id, v ? v.files : null); setTick((n) => n + 1); });
    }
  }, [left, right]);
  // Rev25: en un proyecto React/Vite, cada lado se compila en el equipo (lo de ahora y la versión elegida).
  const built = useRef(new Map<string, CompileOutcome | "cargando" | null>());
  const needsBuild = (f: GeneratedFile[]): boolean => {
    const t = compileTarget(f);
    return Boolean(t) && (previewOf(f, page).kind === "sin-vista" || page === t?.entry);
  };
  useEffect(() => {
    for (const id of [left, right]) {
      const f = id === NOW ? files : cache.current.get(id);
      if (!Array.isArray(f) || !needsBuild(f) || built.current.has(id)) continue;
      built.current.set(id, "cargando");
      void compileProjectPreview(projectId, id === NOW ? undefined : id).then((r) => { built.current.set(id, r.ok ? r.data : null); setTick((n) => n + 1); });
    }
  });
  const sideOf = (id: string): Side => {
    const f = id === NOW ? files : cache.current.get(id);
    if (f === undefined || f === "cargando") return { state: "cargando" };
    if (f === null) return { state: "error" };
    if (needsBuild(f)) {
      const b = built.current.get(id);
      if (b === undefined || b === "cargando") return { state: "cargando" };
      if (b === null) return { state: "error" };
      return b.ok ? { state: "ok", files: f, html: b.html } : { state: "no-compila", files: f, error: issueText(b.errors[0] ?? { file: "", line: 0, column: 0, text: "no compila" }) };
    }
    const info = previewOf(f, page);
    return info.kind === "pagina" && info.html ? { state: "ok", files: f, html: info.html } : { state: "sin-pagina", files: f };
  };
  const L = sideOf(left);
  const R = sideOf(right);
  const lHtml = L.state === "ok" ? L.html : "";
  const rHtml = R.state === "ok" ? R.html : "";
  const lTok = useMemo(() => pageToken(lHtml, "cmpA"), [lHtml]);
  const rTok = useMemo(() => pageToken(rHtml, "cmpB"), [rHtml]);
  const lDoc = useMemo(() => (lHtml ? withMonitor(lHtml, { hash, token: lTok, sync: true }) : null), [lHtml, hash, lTok]);
  const rDoc = useMemo(() => (rHtml ? withMonitor(rHtml, { hash, token: rTok, sync: true }) : null), [rHtml, hash, rTok]);
  const lRef = useRef<HTMLIFrameElement | null>(null);
  const rRef = useRef<HTMLIFrameElement | null>(null);
  const [lState, setLState] = useState<PaneState>("cargando");
  const [rState, setRState] = useState<PaneState>("cargando");
  useEffect(() => setLState("cargando"), [lDoc]);
  useEffect(() => setRState("cargando"), [rDoc]);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const toks = useRef({ l: lTok, r: rTok });
  toks.current = { l: lTok, r: rTok };
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const fromL = e.source === lRef.current?.contentWindow;
      const fromR = e.source === rRef.current?.contentWindow;
      if (!fromL && !fromR) return;
      const m = asMonitorMessage(e.data, fromL ? toks.current.l : toks.current.r);
      if (!m) return;
      const set = fromL ? setLState : setRState;
      if (m.tipo === "error") set("error");
      if (m.tipo === "calidad") set((s) => (s === "error" ? s : m.texto === 0 && m.medios === 0 && m.elementos < 5 ? "en-blanco" : "lista"));
      if (m.tipo === "scroll" && syncRef.current) {
        const other = fromL ? rRef.current : lRef.current;
        sendOrder(other?.contentWindow, fromL ? toks.current.r : toks.current.l, { orden: "desplazar", fraccion: m.fraccion });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEscapeToClose(onClose);

  const label = (id: string): string => {
    if (id === NOW) return "Ahora (lo guardado)";
    const v = versions.find((x) => x.id === id);
    return v ? `${fmtDate(v.at)} · ${v.label.slice(0, 50)}` : "Versión";
  };
  const options = [{ id: NOW, text: label(NOW) }, ...versions.map((v) => ({ id: v.id, text: label(v.id) }))];
  const summary = L.state === "cargando" || R.state === "cargando"
    ? "Cargando las versiones…"
    : L.state === "error" || R.state === "error"
      ? "No se ha podido leer una de las versiones."
      : (() => { const changes = compareFiles(L.files, R.files); return changes.length ? changeSummary(changes) : "Los archivos son iguales en las dos: no hay diferencias."; })();
  const pane = (title: string, id: string, side: Side, doc: string | null, ref: { current: HTMLIFrameElement | null }, state: PaneState, which: "antes" | "despues") => (
    <div className="flex min-h-0 min-w-0 flex-col bg-panel" data-comparar-lado={which}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-card px-2 text-[11px]">
        <span className={`rounded px-1.5 py-0.5 font-bold uppercase ${which === "antes" ? "bg-accent text-foreground" : "bg-primary/15 text-primary"}`}>{title}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={label(id)}>{label(id)}</span>
        {side.state === "ok" && <span data-estado-comparar={state} className={state === "lista" ? "text-emerald-600 dark:text-emerald-400" : state === "cargando" ? "text-muted-foreground" : "text-destructive"}>{state === "lista" ? "Se ve bien" : state === "cargando" ? "Cargando…" : state === "error" ? "Con errores" : "En blanco"}</span>}
      </div>
      {side.state === "ok" && doc ? (
        <PreviewStage width={width}>
          <iframe ref={(el: HTMLIFrameElement | null) => { ref.current = el; }} key={which} title={`${title === "ANTES" ? "Antes" : "Después"}: ${label(id)}`} srcDoc={doc} sandbox="allow-scripts allow-forms" className="block border-0 bg-white" style={{ width: "100%", height: "100%" }} />
        </PreviewStage>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
          {side.state === "cargando" ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Cargando…</span> : side.state === "error" ? "No se ha podido leer esta versión." : side.state === "no-compila" ? `Esta versión no compila: ${side.error}` : `Esta versión no tiene la página «${page ?? "principal"}».`}
        </div>
      )}
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col" role="region" aria-label="Comparar versiones">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card/60 px-2 py-1.5 text-xs">
        <label className="flex min-w-0 items-center gap-1 font-semibold">Antes:
          <select value={left} onChange={(e: { target: { value: string } }) => setLeft(e.target.value)} aria-label="Versión de antes (izquierda)" className="h-7 min-w-0 max-w-56 rounded-md border border-border bg-background px-1.5 font-normal">
            {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 items-center gap-1 font-semibold">Después:
          <select value={right} onChange={(e: { target: { value: string } }) => setRight(e.target.value)} aria-label="Versión de después (derecha)" className="h-7 min-w-0 max-w-56 rounded-md border border-border bg-background px-1.5 font-normal">
            {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-muted-foreground">
          <input type="checkbox" checked={sync} onChange={(e: { target: { checked: boolean } }) => setSync(e.target.checked)} />Desplazar a la vez
        </label>
        <span className="min-w-[12rem] flex-1 truncate text-muted-foreground" data-resumen-comparar title={summary}>{summary}</span>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={onClose} aria-label="Cerrar la comparación"><X className="size-3.5" />Cerrar</Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-2 gap-px bg-border md:grid-cols-2 md:grid-rows-1">
        {pane("ANTES", left, L, lDoc, lRef, lState, "antes")}
        {pane("DESPUÉS", right, R, rDoc, rRef, rState, "despues")}
      </div>
    </div>
  );
}
