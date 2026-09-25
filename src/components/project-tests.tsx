// PRUEBAS AUTOMÁTICAS DE CADA PROYECTO (rediseño, revisión 28). En el taller de SUPER WILLY, el botón «Pruebas» y su panel: las
// pruebas del proyecto (pruebas/*.spec.js, con el formato de Playwright) que WILLY pasa SOLO, en tu equipo y sin que se vea,
// haciendo lo que haría una persona (escribir, pulsar, elegir…) con la página de verdad. Después de cada cambio se pasan solas
// (si está encendido); cada prueba dice si va bien o qué falla, en palabras de cualquiera (y con el detalle para la IA), con
// «Repetir», «Arreglar lo que falla» y «Escribir las pruebas». Mientras se pasan, WILLY sigue funcionando y el foco no se mueve.

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, FlaskConical, Loader2, MinusCircle, Play, RotateCw, Square, Wand2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildRun, filesKeyOf, isTypeScriptTest, loadErrorResult, normalizeResult, prepareTestSource, testFilesOf, testsSummary,
  type TestResult, type TestRun, type TestsEvidence, type TranspiledTest,
} from "@/lib/project-tests";
import { runTestSession, testSessionRunning } from "@/lib/test-session";
import type { RunnerFile } from "@/lib/test-runner";
import { transpileProjectTests } from "@/services/disk-project-service";
import type { GeneratedFile } from "@/types/domain";

/** La última pasada de cada proyecto (mientras WILLY está abierto): cambiar de pestaña o de proyecto no la pierde. */
const LAST = new Map<string, TestRun>();

export type TestsProgress = { done: number; total: number; current: string | null; step: string | null };
export type ProjectTests = {
  /** Archivos de pruebas que WILLY pasa (Playwright) y los que no (unitarias). */
  runnable: GeneratedFile[];
  unit: string[];
  /** Huella de los archivos de ahora. */
  key: string;
  run: TestRun | null;
  /** Sin pasada en esta sesión: lo apuntado en el plan de la última vez, si es de estos mismos archivos. */
  known: TestsEvidence | null;
  /** La última pasada es de otros archivos (el proyecto ha cambiado desde entonces). */
  stale: boolean;
  busy: boolean;
  progress: TestsProgress | null;
  start: (only?: string[] | null) => void;
  stop: () => void;
};

export type PageSource = { pages: string[]; main: string | null; htmlOf: (page: string) => Promise<string | null> };

/**
 * Pasar las pruebas del proyecto. Con `auto`, se pasan solas cuando la vista previa está lista con unos archivos que todavía no
 * se han probado (después de cada cambio de WILLY), si WILLY no está trabajando. `known` es lo apuntado en el plan de la última
 * pasada: si es de estos mismos archivos, abrir el proyecto no las vuelve a pasar (y el botón dice cómo fueron).
 */
export function useProjectTests(opts: {
  projectId: string; files: GeneratedFile[]; running: boolean; ready: boolean; auto: boolean; known?: TestsEvidence | null;
  source: PageSource; onRun?: (run: TestRun, projectId: string) => void;
}): ProjectTests {
  const { projectId, files } = opts;
  const [run, setRun] = useState<TestRun | null>(() => LAST.get(projectId) ?? null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TestsProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  const { runnable, unit } = useMemo(() => testFilesOf(files), [files]);
  const key = useMemo(() => filesKeyOf(files), [files]);

  useEffect(() => { setRun(LAST.get(projectId) ?? null); setProgress(null); }, [projectId]);
  // Si se cierra el taller (o cambia de proyecto) a mitad, se para.
  useEffect(() => () => { abort.current?.abort(); }, [projectId]);

  const start = (only?: string[] | null) => {
    if (abort.current || testSessionRunning()) return;
    const o = latest.current;
    const pid = o.projectId;
    const snapshot = o.files;
    const fileKey = filesKeyOf(snapshot);
    const { runnable: tests, unit: units } = testFilesOf(snapshot);
    const prev = LAST.get(pid) ?? null;
    // «Repetir» una prueba solo tiene sentido con los mismos archivos; si no, se pasan todas.
    const subset = only?.length && prev?.key === fileKey ? only : null;
    const startedAt = Date.now();
    const finish = (r: TestRun) => {
      LAST.set(pid, r);
      if (latest.current.projectId === pid) { setRun(r); setBusy(false); setProgress(null); }
      latest.current.onRun?.(r, pid);
    };
    if (!tests.length) { finish(buildRun({ key: fileKey, startedAt, ms: 0, results: [], unit: units })); return; }
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setProgress({ done: 0, total: subset?.length ?? 0, current: null, step: "Preparando las pruebas…" });
    void (async () => {
      const broken: TestResult[] = [];
      const prepared: RunnerFile[] = [];
      try {
        // Las pruebas en TypeScript: sin tipos, con el TypeScript de WILLY (en el servidor de tu equipo; no se ejecuta nada).
        const tsFiles = tests.filter((f) => isTypeScriptTest(f.path));
        const transpiled = new Map<string, TranspiledTest>();
        if (tsFiles.length) {
          const r = await transpileProjectTests(tsFiles);
          if (r.ok) for (const t of r.data) transpiled.set(t.path, t);
          else for (const f of tsFiles) broken.push(loadErrorResult(f.path, r.error, 0));
        }
        for (const f of tests) {
          let code = f.content;
          let lineMap: number[] | null = null;
          if (isTypeScriptTest(f.path)) {
            const t = transpiled.get(f.path);
            if (!t) continue;
            if (t.error || !t.code) { broken.push(loadErrorResult(f.path, t.error ?? "no se puede leer", t.line ?? 0)); continue; }
            code = t.code;
            lineMap = t.lineMap ?? null;
          }
          const p = prepareTestSource(f.path, code);
          if (!p.ok) { broken.push(loadErrorResult(f.path, p.error, lineMap?.[p.line - 1] ?? p.line)); continue; }
          prepared.push({ path: f.path, code: p.code, lineMap });
        }
        const src = latest.current.source;
        const outcome = prepared.length ? await runTestSession({
          files: prepared, pages: src.pages, main: src.main, htmlOf: src.htmlOf, only: subset, signal: ctl.signal,
          onEvent: (e) => {
            if (latest.current.projectId !== pid) return;
            if (e.tipo === "listo") setProgress((p) => ({ done: 0, total: subset?.length ?? e.pruebas.length, current: null, step: p?.step ?? null }));
            else if (e.tipo === "empieza") setProgress((p) => (p ? { ...p, current: e.id, step: null } : p));
            else if (e.tipo === "paso") setProgress((p) => (p ? { ...p, step: e.texto } : p));
            else if (e.tipo === "termina") setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          },
        }) : null;
        let results: TestResult[] = [
          ...(subset ? [] : broken),
          ...(subset ? [] : outcome?.loadErrors.map((e) => loadErrorResult(e.archivo, e.mensaje, e.linea)) ?? []),
          ...(outcome?.results.map((r) => normalizeResult(r)) ?? []),
        ];
        if (subset && prev) {
          // «Repetir»: la lista sigue completa (solo cambian las repetidas).
          const fresh = new Map(results.map((r) => [r.id, r]));
          results = prev.results.map((r) => fresh.get(r.id) ?? r);
        }
        const stopped = Boolean(outcome?.stopped || outcome?.timedOut);
        finish(buildRun({ key: fileKey, startedAt, ms: Date.now() - startedAt, results, unit: units, stopped, note: outcome?.fatal ?? (!outcome && !broken.length ? "no hay pruebas que se puedan pasar" : null) }));
      } catch (error) {
        finish(buildRun({ key: fileKey, startedAt, ms: Date.now() - startedAt, results: [], unit: units, note: error instanceof Error ? error.message : String(error) }));
      } finally {
        if (abort.current === ctl) abort.current = null;
      }
    })();
  };
  const stop = () => abort.current?.abort();

  // Solas: con la vista previa lista, WILLY sin trabajar y unos archivos que todavía no se han probado.
  const { auto, ready, running } = opts;
  const knownKey = opts.known?.key ?? null;
  useEffect(() => {
    if (!auto || !ready || running || busy || !runnable.length) return;
    if (run?.key === key || (!run && knownKey === key)) return;
    const t = window.setTimeout(() => start(), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, ready, running, busy, key, run?.key, knownKey, runnable.length]);

  const known = !run && opts.known && opts.known.key === key && opts.known.total > 0 ? opts.known : null;
  return { runnable, unit, key, run, known, stale: Boolean(run && run.key !== key), busy, progress, start, stop };
}

const secs = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);

function ResultRow({ r, busy, onRepeat }: { r: TestResult; busy: boolean; onRepeat: () => void }) {
  const [open, setOpen] = useState(false);
  const icon = r.status === "ok" ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : r.status === "fallo" ? <XCircle className="size-4 shrink-0 text-destructive" /> : <MinusCircle className="size-4 shrink-0 text-muted-foreground" />;
  const where = r.error?.line || r.line ? `${r.error?.file || r.file}, línea ${r.error?.line || r.line}` : r.file;
  return (
    <li className={`rounded-md border px-2.5 py-1.5 ${r.status === "fallo" ? "border-destructive/40 bg-destructive/5" : "border-border bg-background"}`} data-prueba={r.title} data-estado-prueba={r.status}>
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <p className="min-w-0 flex-1 truncate font-medium" title={r.title}>{r.title}</p>
        <span className="shrink-0 text-[11px] text-muted-foreground">{r.status === "saltada" ? "saltada" : r.status === "no-pasada" ? "sin pasar" : secs(r.ms)}</span>
        {r.status !== "saltada" && !r.id.endsWith("(archivo)") && (
          <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40" disabled={busy} onClick={onRepeat} aria-label={`Repetir la prueba ${r.title}`} title="Repetir esta prueba">
            <RotateCw className="size-3.5" />
          </button>
        )}
      </div>
      {r.error && (
        <div className="mt-1 pl-6">
          <p className="break-words text-destructive" data-error-prueba>{r.error.plain}</p>
          <button type="button" className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />Detalle técnico
          </button>
          {open && (
            <div className="mt-1 space-y-1 rounded border border-border bg-muted/40 p-2 font-mono text-[11px]">
              <p className="text-muted-foreground">{where}</p>
              {r.error.detail && <pre className="whitespace-pre-wrap break-words">{r.error.detail}</pre>}
              {r.steps.length > 0 && <p className="whitespace-pre-wrap break-words font-sans">Pasos: {r.steps.join(" → ")}</p>}
              {r.pageErrors.length > 0 && <p className="whitespace-pre-wrap break-words font-sans text-destructive">Errores de la página: {r.pageErrors.join(" | ")}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** El panel «Pruebas» del taller. */
export function TestsPanel({ tests, running, auto, onAuto, onRepair, onWrite, onClose }: {
  tests: ProjectTests; running: boolean; auto: boolean; onAuto: (on: boolean) => void;
  onRepair: (failing: TestResult[]) => void; onWrite: (existing: string[]) => void; onClose: () => void;
}) {
  const { run, busy, progress } = tests;
  const failing = run?.results.filter((r) => r.status === "fallo") ?? [];
  const has = tests.runnable.length > 0;
  const current = progress?.current ? run?.results.find((r) => r.id === progress.current)?.title ?? progress.current.split(" › ").slice(1).join(" › ") : null;
  return (
    <div className="shrink-0 border-b border-border bg-card px-3 py-2.5 text-xs" role="region" aria-label="Pruebas del proyecto" data-panel-pruebas>
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 font-semibold" data-pruebas-resumen>
          Pruebas automáticas · {busy ? "probando…" : !has ? "sin pruebas todavía" : !run && tests.known ? `${tests.known.passed} de ${tests.known.passed + tests.known.failed} bien${tests.known.failed ? ` · ${tests.known.failed} falla${tests.known.failed === 1 ? "" : "n"}` : ""} (la última vez; «Pasar las pruebas» para ver cada una)` : testsSummary(run)}
          {!busy && tests.stale && has && <span className="font-normal text-amber-600 dark:text-amber-400"> · son de antes del último cambio</span>}
        </p>
        {busy ? (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={tests.stop}><Square className="size-3.5" />Parar</Button>
        ) : has ? (
          <Button size="sm" variant="secondary" className="h-7 gap-1.5 px-2 text-xs" onClick={() => tests.start()}><Play className="size-3.5" />Pasar las pruebas</Button>
        ) : null}
        {!busy && failing.length > 0 && !tests.stale && (
          <Button size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={running} onClick={() => onRepair(failing)}><Wand2 className="size-3.5" />Arreglar lo que falla</Button>
        )}
        {!busy && (
          <Button size="sm" variant={has ? "ghost" : "default"} className="h-7 gap-1.5 px-2 text-xs" disabled={running} onClick={() => onWrite(tests.runnable.map((f) => f.path))}>
            <Wand2 className="size-3.5" />{has ? "Añadir pruebas" : "Escribir las pruebas"}
          </Button>
        )}
        <button type="button" onClick={onClose} aria-label="Cerrar las pruebas" className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      <label className="mt-1.5 flex w-fit items-center gap-1.5 text-[11px] text-muted-foreground">
        <input type="checkbox" checked={auto} onChange={(e: { target: { checked: boolean } }) => onAuto(e.target.checked)} />
        Pasarlas solas después de cada cambio
      </label>
      {busy && progress && (
        <div className="mt-2" role="status" aria-live="polite" data-pruebas-progreso>
          <p className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" />
            {progress.total ? `Probando ${Math.min(progress.done + 1, progress.total)} de ${progress.total}` : "Preparando"}{current ? `: «${current}»` : ""}{progress.step ? ` · ${progress.step}` : ""}
          </p>
          {progress.total > 0 && <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>}
        </div>
      )}
      {!has && !busy && (
        <p className="mt-2 text-muted-foreground" data-sin-pruebas>
          Este proyecto aún no tiene pruebas automáticas. Son como un usuario de prueba: WILLY abre tu aplicación sin que la veas, escribe, pulsa y comprueba que todo responde bien, él solo, después de cada cambio. Pulsa «Escribir las pruebas» y WILLY las prepara.
        </p>
      )}
      {run && run.status === "no-arranca" && <p className="mt-2 text-amber-600 dark:text-amber-400" role="note">No se han podido pasar: {run.note}</p>}
      {run && run.results.length > 0 && (
        <ul className="mt-2 max-h-[45vh] space-y-1.5 overflow-auto pb-1" aria-label="Resultado de las pruebas">
          {run.results.map((r) => <ResultRow key={r.id} r={r} busy={busy} onRepeat={() => tests.start([r.id])} />)}
        </ul>
      )}
      {tests.unit.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground" role="note">
          Pruebas unitarias que WILLY no pasa aquí (solo pasa las de Playwright): {tests.unit.slice(0, 4).join(", ")}{tests.unit.length > 4 ? "…" : ""}.
        </p>
      )}
    </div>
  );
}
