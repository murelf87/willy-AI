import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, Loader2, Play, Trash2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";
import { exportNaturalAudio, speakBest, voiceCall, voiceStatus, type VoiceStatus } from "@/lib/natural-voice";
import type { SpeechHandle } from "@/lib/tts-voice";
import { MasVoces, type ExtraView } from "@/components/mas-voces";

/**
 * Voces naturales (Piper): humanas de verdad, gratis y sin internet una vez descargadas. Es la ÚNICA voz que
 * usa WILLY para leer en voz alta (nunca la robótica de Windows): si no está lista, WILLY la instala sola.
 * El ritmo y la pausa entre frases se ajustan aquí y valen para toda la aplicación.
 */
export function NaturalVoicesCard({ text, fileName, voice, onVoice }: { text: string; fileName: string; voice: string; onVoice: (id: string) => void }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [pace, setPace] = useState({ lengthScale: 1.08, sentenceSilence: 0.55 });
  const sample = useRef<SpeechHandle | null>(null);
  const abort = useRef<AbortController | null>(null);
  const paceTimer = useRef<number | null>(null);

  const refresh = async () => {
    const s = await voiceStatus();
    if (!s) return setUnavailable(true);
    setUnavailable(false);
    setStatus(s);
    setPace(s.pace);
    // Si la voz elegida ya no existe, se usa la activa del equipo.
    if (voice && !s.installed.some((v) => v.id === voice)) onVoice(s.installed.find((v) => v.active)?.id ?? "");
  };
  useEffect(() => { void refresh(); return () => { sample.current?.stop(); abort.current?.abort(); if (paceTimer.current) window.clearTimeout(paceTimer.current); }; }, []);
  const busy = status?.job?.status === "activo";
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (status?.job?.status === "error") pushNotice(`⚠️ ${status.job.error}`, "warn");
    if (status?.job?.status === "listo") pushNotice(`Listo: ${status.job.label}.`, "success");
  }, [status?.job?.status, status?.job?.id]);

  const act = async (body: Record<string, unknown>) => {
    const res = await voiceCall(body);
    if (!res.ok) pushNotice(`⚠️ ${res.error}`, "warn");
    await refresh();
  };
  const test = (id: string) => {
    sample.current?.stop();
    sample.current = speakBest("Hola, así suena esta voz leyendo tus documentos en voz alta.", { naturalVoice: id, onPreparing: (m) => pushNotice(m, "info"), onError: (m) => pushNotice(`⚠️ ${m}`, "warn") });
  };
  const savePace = (next: { lengthScale: number; sentenceSilence: number }) => {
    setPace(next);
    if (paceTimer.current) window.clearTimeout(paceTimer.current);
    // Se guarda medio segundo después de soltar el tirador, para no disparar una petición por cada píxel.
    paceTimer.current = window.setTimeout(() => { void voiceCall({ action: "set-pace", lengthScale: next.lengthScale, sentenceSilence: next.sentenceSilence }); }, 500);
  };
  const save = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setExporting({ done: 0, total: 1 });
    try {
      const blob = await exportNaturalAudio(text, voice || undefined, (done, total) => setExporting({ done, total }), controller.signal);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(fileName || "documento").replace(/\.[^.]+$/, "")}.wav`;
      a.click();
      URL.revokeObjectURL(url);
      pushNotice("Audio guardado.", "success");
    } catch (error) {
      pushNotice(`⚠️ ${error instanceof Error ? error.message : "No se pudo crear el audio."}`, "warn");
    }
    setExporting(null);
    abort.current = null;
  };

  const renderVoice = (c: NonNullable<typeof status>["catalog"][number]) => {
    const inst = status?.installed.find((v) => v.id === c.id);
    const chosen = !!inst && (voice ? voice === c.id : inst.active);
    return (
      <div key={c.id} className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 ${chosen ? "border-primary bg-accent/40" : "border-border"}`}>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{c.label}{c.recommended ? " ★" : ""}</p>
          <p className="text-xs text-muted-foreground">Calidad {c.quality} · ≈ {c.mb} MB{chosen ? " · en uso" : ""}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {inst ? (
            <>
              <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Probar" onClick={() => test(c.id)}><Play className="size-4" /></Button>
              <Button type="button" size="sm" variant={chosen ? "secondary" : "outline"} className="h-8 gap-1 text-xs" onClick={() => { onVoice(c.id); void act({ action: "set-voice", id: c.id }); }}>{chosen ? <Check className="size-3.5" /> : null}{chosen ? "Elegida" : "Usar"}</Button>
              <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Quitar" disabled={busy} onClick={() => void act({ action: "remove-voice", id: c.id })}><Trash2 className="size-4" /></Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={busy || !status?.piper.ready} title={status?.piper.ready ? "" : "Primero instala el motor de voz"} onClick={() => void act({ action: "download-voice", id: c.id })}><Download className="size-3.5" />Descargar</Button>
          )}
        </div>
      </div>
    );
  };

  const extraView = (status as (VoiceStatus & { extra?: ExtraView }) | null)?.extra;
  // Solo voces naturales: las básicas de Piper (y su ritmo y pausas) se borraron, así que no se muestran.
  const basic = !!status && !extraView?.onlyNatural;
  const spain = status?.catalog.filter((c) => c.group === "España") ?? [];
  const others = status?.catalog.filter((c) => c.group !== "España") ?? [];

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold"><Volume2 className="mr-2 inline size-4 text-primary" />Voz natural de España (humana, no robótica)</p>
      </div>
      {unavailable && <p className="text-xs text-destructive">No pude consultar las voces. ¿Está WILLY arrancado?</p>}
      {basic && status && !status.piper.ready && (
        <div className="space-y-2 rounded-md border border-border bg-background p-3 text-xs leading-5">
          <p>Falta el <b>motor de voz</b> (Piper, ≈ 20 MB). WILLY lo instala solo en cuanto pidas escuchar algo, o puedes adelantarlo aquí.</p>
          {status.piper.canInstall
            ? <Button type="button" size="sm" className="gap-2" disabled={busy} onClick={() => void act({ action: "install-piper" })}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Instalar el motor de voz ahora</Button>
            : <p className="text-muted-foreground">En este sistema instálalo con <code>pip install piper-tts</code> (modo «python -m piper» en Estudio de avatar).</p>}
        </div>
      )}
      {status?.job && (status.job.status === "activo" || status.job.status === "error") && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full transition-all ${status.job.status === "error" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${status.job.status === "error" ? 100 : status.job.pct}%` }} /></div>
          <p className="text-xs text-muted-foreground">{status.job.status === "error" ? status.job.error : `${status.job.text} ${status.job.pct}%`}</p>
        </div>
      )}
      {extraView && (
        <MasVoces extra={extraView} voice={voice} onVoice={onVoice} busy={busy} refresh={refresh} />
      )}
      {status && !basic && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>Solo se usan voces naturales: las voces básicas de Piper, más robóticas, están borradas.</p>
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => void act({ action: "extra-config", cfg: { onlyNatural: false } })}>Volver a mostrar las voces básicas</Button>
        </div>
      )}
      {basic && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Voces básicas de Piper (sin internet; suenan más robóticas; ★ = las mejores)</p>
          <div className="grid gap-2 md:grid-cols-2">{spain.map(renderVoice)}</div>
        </div>
      )}
      {basic && (
        <div className="border-t border-border pt-2">
          <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowOthers((v) => !v)}>
            <ChevronDown className={`size-3.5 transition-transform ${showOthers ? "rotate-180" : ""}`} />
            {showOthers ? "Ocultar otras variantes y otros idiomas" : "Ver otras variantes (México, Argentina, catalán) y otros idiomas"}
          </button>
          {showOthers && (
            <div className="mt-2 grid gap-2 md:grid-cols-2">{others.map(renderVoice)}</div>
          )}
        </div>
      )}
      {basic && (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ritmo y pausas (para toda la aplicación)</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="w-32 shrink-0 text-xs text-muted-foreground" htmlFor="ritmo">Ritmo de lectura</label>
            <input id="ritmo" type="range" min={0.85} max={1.4} step={0.02} value={pace.lengthScale} onChange={(e) => savePace({ ...pace, lengthScale: Number(e.target.value) })} className="h-1 w-40 accent-primary" />
            <span className="text-xs text-muted-foreground">{pace.lengthScale <= 0.95 ? "rápido" : pace.lengthScale >= 1.2 ? "muy pausado" : "natural"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="w-32 shrink-0 text-xs text-muted-foreground" htmlFor="pausas">Pausa entre frases</label>
            <input id="pausas" type="range" min={0.2} max={1} step={0.05} value={pace.sentenceSilence} onChange={(e) => savePace({ ...pace, sentenceSilence: Number(e.target.value) })} className="h-1 w-40 accent-primary" />
            <span className="text-xs text-muted-foreground">{pace.sentenceSilence.toFixed(2)} s</span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" className="gap-2" disabled={!text.trim() || !status?.installed.length || !!exporting} onClick={() => void save()}>
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Guardar el documento como audio (.wav)
        </Button>
        {exporting && <><span className="text-xs text-muted-foreground">Creando el audio… {exporting.done} de {exporting.total}</span><Button type="button" size="sm" variant="ghost" onClick={() => abort.current?.abort()}>Cancelar</Button></>}
      </div>
    </div>
  );
}
