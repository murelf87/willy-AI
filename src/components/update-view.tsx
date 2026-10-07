import { useState } from "react";
import { CheckCircle2, Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SystemInfo } from "@/lib/maintenance-client";
import { systemAction } from "@/lib/maintenance-client";

const REPO = "murelf87/willy-AI";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

const dateText = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
};

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
  const currentLabel = info ? `WILLY AI v${info.version} · r${info.revision}` : "";

  const checkUpdate = async () => {
    setCheck({ status: "checking" });
    try {
      const res = await fetch(API_URL, { headers: { "User-Agent": "WILLY-AI-Web/1.0" } });
      if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
      const data = await res.json() as { tag_name?: string };
      const latestVer = (data.tag_name ?? "").replace(/^v/, "");
      if (!latestVer) throw new Error("No se encontró la versión en GitHub.");
      const currentVer = info?.version ?? "0.0.0";
      setCheck(isNewer(currentVer, latestVer)
        ? { status: "update-available", version: latestVer }
        : { status: "up-to-date", version: latestVer });
    } catch (e) {
      setCheck({ status: "error", msg: e instanceof Error ? e.message : "Error desconocido" });
    }
  };

  const installUpdate = async () => {
    setCheck({ status: "installing" });
    try {
      const result = await systemAction("instalar-actualizacion") as { ok: boolean; error?: string; latestVersion?: string };
      setCheck(result.ok
        ? { status: "done", version: result.latestVersion ?? "" }
        : { status: "error", msg: result.error ?? "No se pudo instalar la actualización." });
    } catch (e) {
      setCheck({ status: "error", msg: e instanceof Error ? e.message : "Error desconocido" });
    }
  };

  const isBusy = check.status === "checking" || check.status === "installing";

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <RefreshCw className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Actualizaciones</p>
          {info ? (
            <>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Versión instalada y sincronizada</p>
              <p className="mt-0.5 break-words text-sm font-bold text-green-600 dark:text-green-400">{currentLabel}</p>
              {last?.at && <p className="mt-1 text-xs leading-5 text-muted-foreground">Última instalación registrada el {dateText(last.at)}.</p>}
            </>
          ) : (
            <p className="mt-1 text-xs leading-5 text-destructive">No se pudo leer la versión actual: el servidor de WILLY no respondió.</p>
          )}
        </div>
        {info && (
          <span className="w-fit rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 font-mono text-xs font-bold text-green-600 dark:text-green-400">
            v{info.version} · r{info.revision}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" className="gap-2" disabled={isBusy || check.status === "done"} onClick={() => void checkUpdate()}>
          {check.status === "checking" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {check.status === "checking" ? "Sincronizando…" : "Comprobar sincronización"}
        </Button>

        {check.status === "up-to-date" && info && (
          <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-3.5" />
            Sin cambios pendientes · {currentLabel}
          </span>
        )}

        {check.status === "done" && (
          <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-3.5" />
            Sincronización iniciada. WILLY volverá a abrirse cuando termine.
          </span>
        )}

        {check.status === "error" && <span className="text-xs text-destructive">{check.msg}</span>}
      </div>

      {check.status === "update-available" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-primary">Hay cambios disponibles para sincronizar.</p>
            <p className="mt-0.5 text-xs text-muted-foreground">WILLY hará copia de seguridad, sincronizará el código y solo mostrará el nuevo estado después de arrancar correctamente.</p>
          </div>
          <Button size="sm" className="gap-2" disabled={isBusy} onClick={() => void installUpdate()}>
            <Download className="size-3.5" />Sincronizar
          </Button>
        </div>
      )}

      {check.status === "installing" && (
        <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground">Sincronizando versión…</p>
        </div>
      )}

      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>Antes de instalar cambios WILLY hace una copia de seguridad. Si algo falla, vuelve automáticamente a la versión funcional anterior.</span>
      </p>
    </section>
  );
}
