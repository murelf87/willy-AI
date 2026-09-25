import { useEffect, useMemo, useRef, useState } from "react";
import { Hammer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GeneratedFile } from "@/types/domain";
import {
  FACTORY_CHECK_LABELS, FACTORY_STEPS, packageFingerprintText, planDesktopPackage,
  type FactoryCheckStatus, type FactoryReport,
} from "@/lib/desktop-format";

/** Lo que la fábrica sabe de este proyecto: su último informe y si corresponde al código que hay ahora. */
export type FactoryState = { report: FactoryReport; fresh: boolean } | null;

type Job = { id: string; step: string; log: string[]; done: boolean; report: FactoryReport | null; error: string | null };
type Tools = { windows: boolean; compilador: boolean; motor: boolean };

const MARK: Record<FactoryCheckStatus, { mark: string; tone: string; label: string }> = {
  superada: { mark: "✓", tone: "text-emerald-600", label: "superada" },
  fallida: { mark: "✗", tone: "text-destructive", label: "fallida" },
  pendiente: { mark: "○", tone: "text-muted-foreground", label: "pendiente" },
  "no-aplica": { mark: "—", tone: "text-muted-foreground", label: "no aplica" },
};

async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `La fábrica responde ${res.status}`);
  return data;
}

/**
 * Fábrica de instaladores de una réplica para Windows: monta el programa, compila su instalador y lo prueba DE VERDAD en
 * este equipo (instalación limpia, primer arranque, pruebas de aceptación aisladas y desinstalación).
 */
export function FactorySection({ projectId, projectName, files, onChange }: {
  projectId: string;
  projectName: string;
  files: GeneratedFile[];
  onChange: (state: FactoryState) => void;
}) {
  const plan = useMemo(() => planDesktopPackage(files.map((f) => ({ path: f.path, content: f.content })), { name: projectName }), [files, projectName]);
  const [huella, setHuella] = useState("");
  const [report, setReport] = useState<FactoryReport | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [tools, setTools] = useState<Tools | null>(null);
  const [error, setError] = useState("");
  const avisar = useRef(onChange);
  avisar.current = onChange;

  useEffect(() => {
    let vivo = true;
    void sha256Hex(packageFingerprintText(plan)).then((h) => { if (vivo) setHuella(h); });
    return () => { vivo = false; };
  }, [plan]);

  useEffect(() => {
    let vivo = true;
    setReport(null);
    setJob(null);
    setError("");
    getJson<{ informe: FactoryReport | null; trabajo: Job | null }>(`/api/fabrica?proyecto=${encodeURIComponent(projectId)}`)
      .then((r) => {
        if (!vivo) return;
        setReport(r.informe);
        if (r.trabajo) setJob(r.trabajo);
      })
      .catch(() => { /* la fábrica solo existe en WILLY instalado: sin ella, la sección lo dice abajo */ });
    getJson<Tools>("/api/fabrica").then((t) => { if (vivo) setTools(t); }).catch(() => { if (vivo) setTools(null); });
    return () => { vivo = false; };
  }, [projectId]);

  useEffect(() => {
    if (!job || job.done) return;
    const id = job.id;
    const timer = setInterval(() => {
      getJson<{ trabajo: Job }>(`/api/fabrica?trabajo=${encodeURIComponent(id)}`)
        .then((r) => {
          setJob(r.trabajo);
          if (r.trabajo.done) {
            if (r.trabajo.report) setReport(r.trabajo.report);
            if (r.trabajo.error) setError(r.trabajo.error);
          }
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
          setJob((j) => (j ? { ...j, done: true } : j));
        });
    }, 1500);
    return () => clearInterval(timer);
  }, [job?.id, job?.done]);

  const fresh = Boolean(report && huella && report.huella === huella);
  useEffect(() => {
    avisar.current(report ? { report, fresh } : null);
  }, [report, fresh]);

  const running = Boolean(job && !job.done);
  const faltaHerramienta = tools ? (!tools.compilador ? "Falta el compilador de instaladores de WILLY (tools/nsis): vuelve a aplicar la última actualización." : !tools.motor ? "Falta el motor de Node de WILLY (tools/node.exe)." : "") : "";

  const start = async () => {
    setError("");
    try {
      const res = await fetch("/api/fabrica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "fabricar", proyecto: projectId, nombre: projectName, archivos: files.map((f) => ({ path: f.path, content: f.content })) }),
      });
      const data = (await res.json()) as { ok: boolean; job?: string; error?: string };
      if (!res.ok || !data.ok || !data.job) throw new Error(data.error ?? `La fábrica responde ${res.status}`);
      setJob({ id: data.job, step: FACTORY_STEPS[0], log: [], done: false, report: null, error: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stepIndex = job ? Math.max(0, FACTORY_STEPS.indexOf(job.step as (typeof FACTORY_STEPS)[number])) : 0;
  const pct = running ? Math.round(((stepIndex + 0.5) / FACTORY_STEPS.length) * 100) : 0;
  const superadas = report ? report.comprobaciones.filter((c) => c.estado === "superada").length : 0;
  const aplicables = report ? report.comprobaciones.filter((c) => c.estado !== "no-aplica").length : 0;

  return (
    <section className="mt-3 rounded-xl border border-border bg-card p-4" aria-label="Fábrica de instaladores">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Fábrica de instaladores (Windows)</h3>
        {report && <span className="text-xs text-muted-foreground">{superadas} de {aplicables} comprobaciones superadas{fresh ? "" : " · de un código anterior"}</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Monta el programa con su propio motor, compila su instalador y lo prueba de verdad en este equipo: lo instala en una carpeta vacía, lo arranca, ejecuta sus pruebas de aceptación aisladas y lo desinstala. No toca el programa si ya lo tienes instalado.
      </p>

      {faltaHerramienta && <p className="mt-2 text-xs text-destructive">{faltaHerramienta}</p>}
      {tools && !tools.windows && <p className="mt-2 text-xs text-amber-600">Este equipo no es Windows: se puede compilar el instalador, pero instalarlo y probarlo solo se puede en Windows.</p>}

      {plan.errores.length > 0 && (
        <div className="mt-2 text-xs text-destructive" role="alert">
          <p className="font-semibold">Antes de fabricar hay que corregir:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{plan.errores.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {plan.avisos.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-600" aria-label="Avisos del formato">
          {plan.avisos.slice(0, 5).map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void start()} disabled={running || !plan.ok || Boolean(faltaHerramienta)} className="gap-2">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />}
          {running ? "Fabricando…" : report ? "Volver a crear y probar" : "Crear instalador y probarlo"}
        </Button>
        {report && !fresh && !running && <span className="text-xs text-amber-600">El código ha cambiado desde la última prueba: vuelve a crearlo para que cuente.</span>}
      </div>

      {running && job && (
        <div className="mt-3" role="status" aria-live="polite">
          <p className="text-xs font-medium">{job.step} ({stepIndex + 1} de {FACTORY_STEPS.length})</p>
          <div role="progressbar" aria-label="Avance de la fábrica" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Compilar el instalador tarda alrededor de un minuto: lleva dentro su propio motor.</p>
        </div>
      )}

      {report && (
        <ul className="mt-3 space-y-1.5 text-sm" aria-label="Resultado de la fábrica">
          {report.comprobaciones.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <span className={`w-4 shrink-0 text-center font-bold ${MARK[c.estado].tone}`} aria-hidden>{MARK[c.estado].mark}</span>
              <span className="min-w-0 flex-1">
                {FACTORY_CHECK_LABELS[c.id]} <span className="text-xs text-muted-foreground">· {MARK[c.estado].label}</span>
                <span className="block whitespace-pre-line break-words text-xs text-muted-foreground">{c.detalle}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {report?.instalador && (
        <p className="mt-2 break-all text-xs text-muted-foreground">
          {report.instalador.archivo} · {(report.instalador.bytes / 1024 / 1024).toFixed(1)} MB · SHA-256 {report.instalador.sha256.slice(0, 16)}… · {new Date(report.creado).toLocaleString("es-ES")}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    </section>
  );
}
