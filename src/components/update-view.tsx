import { useState, useRef } from "react";
import { CheckCircle2, Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SystemInfo } from "@/lib/maintenance-client";
import { systemAction } from "@/lib/maintenance-client";

// Actualizaciones (Ajustes → Sistema). Comprueba GitHub Releases y, si hay versión nueva,
// descarga e instala automáticamente desde el propio servidor de WILLY (solo desde localhost).

const REPO = "murelf87/willy-AI";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

const dateText = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
};

/** Compara versiones semver simples: devuelve true si latest > current */
const isNewer = (current: string, latest: string): boolean => {
  const parse = (v: string): [number, number, number] => {
    const parts = v.replace(/^v/, "").split(".").map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [ca, cb, cc] = parse(current);
  const [la, lb, lc] = parse(latest);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
};

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; version: string }
  | { status: "update-available"; version: string }
  | { status: "installing" }
  | { status: "done"; version: string }
  | { status: "error"; msg: string };

export function UpdateView({ info }: { info: SystemInfo | null }) {
  const last = info?.lastUpdate ?? null;
  const [check, setCheck] = useState<CheckState>({ status: "idle" });

  const checkUpdate = async () => {
    setCheck({ status: "checking" });
    try {
      const res = await fetch(API_URL, { headers: { "User-Agent": "WILLY-AI-Web/1.0" } });
      if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
      const data = await res.json() as { tag_name?: string };
      const latestVer = (data.tag_name ?? "").replace(/^v/, "");
      if (!latestVer) throw new Error("No se encontró la versión en GitHub.");
      const currentVer = info?.version ?? "0.0.0";
      if (isNewer(currentVer, latestVer)) {
        setCheck({ status: "update-available", version: latestVer });
      } else {
        setCheck({ status: "up-to-date", version: latestVer });
      }
    } catch (e) {
      setCheck({ status: "error", msg: e instanceof Error ? e.message : "Error desconocido" });
    }
  };

  const installUpdate = async () => {
    setCheck((prev) => ({ ...prev, status: "installing" } as CheckState));
    try {
      const result = await systemAction("instalar-actualizacion") as { ok: boolean; message?: string; error?: string; latestVersion?: string };
      if (result.ok) {
        setCheck({ status: "done", version: result.latestVersion ?? "" });
      } else {
        setCheck({ status: "error", msg: result.error ?? "No se pudo instalar la actualización." });
      }
    } catch (e) {
      setCheck({ status: "error", msg: e instanceof Error ? e.message : "Error desconocido" });
    }
  };

  const isBusy = check.status === "checking" || check.status === "installing";

  const versionSpanRef = useRef<HTMLSpanElement>(null);
  const versionWarningRef = useRef<HTMLParagraphElement>(null);
  const versionMainRef = useRef<HTMLParagraphElement>(null);
  const [versionError, setVersionError] = useState<string | null>(null);

  const handleUpdateVersion = () => {
    if (!info) {
      setVersionError("Información de versión no disponible.");
      return;
    }
    const expected = `v${info.version} · r${info.revision}`;
    const spanText = versionSpanRef.current?.textContent?.trim() ?? "";
    const warningText = versionWarningRef.current?.textContent?.trim() ?? "";
    const mainText = versionMainRef.current?.textContent?.trim() ?? "";
    const mismatched = [spanText, warningText, mainText].some((t) => !t.includes(expected));
    if (mismatched) {
      setVersionError("Las versiones mostradas no coinciden. Acción no completada.");
    } else {
      setVersionError(null);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <RefreshCw className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Actualizaciones</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground" ref={versionMainRef}>
            {info
              ? `Tienes WILLY AI ${info.version} (revisión ${info.revision}).`
              : "No se pudo leer la versión: el servidor de WILLY no respondió."}
            {last?.at ? ` La última actualización (${last.version}) se instaló el ${dateText(last.at)}.` : ""}
          </p>
        </div>
        {info && (
          <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs font-semibold text-green-500" ref={versionSpanRef}>
            v{info.version} · r{info.revision}
          </span>
        )}
        {info && info.version !== "0.0.47" && (
          <p className="mt-1 text-xs text-red-500" ref={versionWarningRef}>
            Advertencia: la versión mostrada no coincide con la versión establecida (0.0.47).
          </p>
        )}
      </div>

      {/* Botón comprobar */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          className="gap-2"
          disabled={isBusy || check.status === "done"}
          onClick={() => void checkUpdate()}
        >
          {check.status === "checking" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {check.status === "checking" ? "Comprobando…" : "Comprobar actualización"}
        </Button>

        {check.status === "up-to-date" && (
          <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-3.5" />
            Ya tienes la última versión ({check.version})
          </span>
        )}

        {check.status === "done" && (
          <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-3.5" />
            Instalador en marcha{check.version ? ` (v${check.version})` : ""}. Sigue las instrucciones en pantalla.
          </span>
        )}

        {check.status === "error" && (
          <span className="text-xs text-destructive">
            {check.msg}
          </span>
        )}
      </div>

      {/* Banner de actualización disponible + botón instalar */}
      {check.status === "update-available" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-primary">¡Nueva versión disponible: v{check.version}!</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              WILLY descargará e instalará la nueva versión automáticamente. Puede cerrarse unos segundos y volver a abrirse.
            </p>
          </div>
          <Button size="sm" className="gap-2" disabled={isBusy} onClick={() => void installUpdate()}>
            <Download className="size-3.5" />
            {`Actualizar a v${check.version}`}
          </Button>
        </div>
      )}

      {/* Banner instalando */}
      {check.status === "installing" && (
        <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground">Descargando e instalando la actualización… puede tardar unos minutos.</p>
        </div>
      )}

      {last && last.notes.length > 0 && (
        <details className="mt-3 rounded-md border border-border bg-background p-3">
          <summary className="cursor-pointer text-xs font-semibold">Qué trajo la última actualización</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {last.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </details>
      )}

      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          Las actualizaciones hacen una copia de seguridad antes de instalar. Si algo falla, WILLY vuelve solo a como estaba.
          Solo funciona desde el propio ordenador donde está instalado WILLY.
        </span>
      </p>
        {versionError && <p className="mt-2 text-xs text-red-500">{versionError}</p>}
        <Button size="sm" onClick={handleUpdateVersion}>Actualizar versión de texto</Button>
    </section>
  );
}
