// TRANSCRIBIR AUDIO O VÍDEO (Herramientas → Audio y voz): lo que se dice en un audio o un vídeo, a texto y a subtítulos (.srt),
// en tu equipo con Whisper (lib/transcribir.ts). Usa el motor de IA de Chatterbox (su PyTorch) y ffmpeg; el modelo se baja
// una sola vez cuando pulsas «Preparar». El archivo va a WILLY por trozos y no sale de tu ordenador.
import { useEffect, useRef, useState } from "react";
import { AudioLines, Download, Loader2, MessageSquare, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard as Card } from "@/components/panel-card";
import { CopyTextButton, DownloadTextButton } from "@/components/text-actions";
import { usePersistentState } from "@/lib/persistent-state";
import { pushNotice } from "@/lib/notifications";
import { openView } from "@/lib/background-tasks";
import { sendToChat } from "@/front/chat-handoff";

type Segment = { start: number; end: number; text: string };
type Result = { text: string; segments: Segment[]; seconds: number; device: string; cudaError: string; name: string };
type Job = { id: string; kind: "preparar" | "transcribir"; status: "activo" | "listo" | "error"; text: string; pct: number; error: string; result: Result | null };
type Status = { engine: boolean; ready: boolean; model: string; gb: string; gpu: string; chunk: number; maxFile: number; job: Job | null };

const LANGS: Array<[string, string]> = [
  ["es", "Español"], ["auto", "Detectar el idioma"], ["en", "Inglés"], ["fr", "Francés"], ["de", "Alemán"],
  ["it", "Italiano"], ["pt", "Portugués"], ["ca", "Catalán"], ["gl", "Gallego"], ["eu", "Euskera"],
];

async function call(body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/voces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return res.ok && !data["error"] ? { ok: true, data } : { ok: false, error: String(data["error"] ?? `El servidor respondió ${res.status}.`) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo hablar con WILLY." };
  }
}

/** Un trozo del archivo en base64 (sin la cabecera «data:…;base64,»). */
const chunkBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => { const s = String(reader.result); resolve(s.slice(s.indexOf(",") + 1)); };
  reader.onerror = () => reject(new Error("No pude leer el archivo."));
  reader.readAsDataURL(blob);
});

const pad = (n: number, width = 2) => String(Math.floor(n)).padStart(width, "0");
/** Tiempo de subtítulo: 00:01:02,345 */
export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${pad(ms / 3_600_000)}:${pad((ms % 3_600_000) / 60_000)}:${pad((ms % 60_000) / 1000)},${pad(ms % 1000, 3)}`;
}
/** Subtítulos .srt a partir de los trozos con tiempo que devuelve Whisper. */
export function toSrt(segments: Segment[]): string {
  return segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(Math.max(s.end, s.start + 0.5))}\n${s.text}\n`).join("\n");
}
const duration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return s >= 60 ? `${Math.floor(s / 60)} min ${pad(s % 60)} s` : `${s} s`;
};

export function TranscribeView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState("");
  const [lang, setLang] = usePersistentState("transcribir:idioma", "es");
  const [text, setText] = usePersistentState("transcribir:texto", "");
  const [segments, setSegments] = usePersistentState<Segment[]>("transcribir:tiempos", []);
  const [name, setName] = usePersistentState("transcribir:archivo", "");
  const [job, setJob] = useState<Job | null>(null);
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const r = await call({ action: "stt-status" });
    if (!r.ok) { setProblem(r.error); return; }
    setProblem("");
    const s = r.data as unknown as Status;
    setStatus(s);
    if (s.job && s.job.status === "activo") setJob(s.job);
  };
  useEffect(() => { void refresh(); }, []);

  // Sigue el trabajo en marcha (preparar o transcribir) hasta que acabe.
  useEffect(() => {
    if (!job || job.status !== "activo") return;
    const id = job.id;
    const timer = window.setInterval(() => {
      void call({ action: "stt-job", id }).then((r) => {
        if (!r.ok) return;
        const next = r.data["job"] as Job;
        setJob(next);
        if (next.status === "listo" && next.kind === "transcribir" && next.result) {
          setText(next.result.text);
          setSegments(next.result.segments);
          setName(next.result.name);
          pushNotice(next.text, next.result.text ? "success" : "warn");
          if (next.result.cudaError) pushNotice(`Se hizo con el procesador porque la tarjeta gráfica no pudo: ${next.result.cudaError}`, "info");
        } else if (next.status === "listo" && next.kind === "preparar") {
          pushNotice("La transcripción ya está lista para usar.", "success");
          void refresh();
        } else if (next.status === "error") pushNotice(`⚠️ ${next.error}`, "warn");
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  const busy = !!upload || job?.status === "activo";

  const prepare = async () => {
    const r = await call({ action: "stt-prepare" });
    if (!r.ok) return pushNotice(`⚠️ ${r.error}`, "warn");
    if (r.data["job"]) setJob(r.data["job"] as Job);
    else void refresh();
  };

  const run = async (file: File) => {
    if (busy) return;
    if (!status?.ready) return pushNotice("Primero hay que preparar la transcripción (botón «Preparar»).", "warn");
    if (file.size > status.maxFile) return pushNotice("El archivo es demasiado grande (máximo 2 GB).", "warn");
    const begin = await call({ action: "stt-begin", name: file.name, size: file.size });
    if (!begin.ok) return pushNotice(`⚠️ ${begin.error}`, "warn");
    const uploadId = String(begin.data["upload"]);
    const chunk = Number(begin.data["chunk"]) || status.chunk;
    const total = Math.max(1, Math.ceil(file.size / chunk));
    setUpload({ done: 0, total });
    try {
      for (let i = 0; i < total; i += 1) {
        const data = await chunkBase64(file.slice(i * chunk, Math.min(file.size, (i + 1) * chunk)));
        const r = await call({ action: "stt-chunk", upload: uploadId, index: i, data });
        if (!r.ok) throw new Error(r.error);
        setUpload({ done: i + 1, total });
      }
    } catch (error) {
      setUpload(null);
      return pushNotice(`⚠️ ${error instanceof Error ? error.message : "No se pudo subir el archivo."}`, "warn");
    }
    setUpload(null);
    const r = await call({ action: "stt-run", upload: uploadId, language: lang });
    if (!r.ok) return pushNotice(`⚠️ ${r.error}`, "warn");
    setName(file.name);
    setJob(r.data["job"] as Job);
  };

  const downloadSrt = () => {
    const url = URL.createObjectURL(new Blob([toSrt(segments)], { type: "application/x-subrip;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name || "subtitulos").replace(/\.[^.]+$/, "")}.srt`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const preparing = job?.kind === "preparar" && job.status === "activo";
  const transcribing = job?.kind === "transcribir" && job.status === "activo";

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><AudioLines className="size-4 text-primary" />Transcribir audio o vídeo</p>
        <p className="text-xs leading-5 text-muted-foreground">Convierte en texto lo que se dice en un audio o un vídeo (una reunión, una nota de voz, un vídeo tuyo) y te da también los subtítulos. Todo en tu equipo, con Whisper.</p>
        {!status && !problem && <p className="text-xs text-muted-foreground">Comprobando…</p>}
        {problem && <p className="text-xs text-destructive">{problem}</p>}
        {status && !status.engine && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-3 text-xs">
            <p className="min-w-0 flex-1 leading-5">Usa el mismo motor de IA que la voz <b>Chatterbox</b>. Instálalo primero en Lectura → Voces más humanas y vuelve aquí.</p>
            <Button size="sm" variant="secondary" onClick={() => openView("lectura")}>Ir a Lectura</Button>
          </div>
        )}
        {status?.engine && !status.ready && (
          <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            <p className="leading-5">Falta el modelo de Whisper (<code>{status.model}</code>): se descarga <b>una sola vez</b> ({status.gb} GB, desde Hugging Face) y después funciona sin internet.</p>
            <Button size="sm" className="gap-1.5" disabled={preparing || transcribing} onClick={() => void prepare()}>
              {preparing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {preparing ? "Preparando…" : "Preparar la transcripción"}
            </Button>
          </div>
        )}
        {status?.ready && <p className="text-xs text-emerald-600">Lista · Whisper large-v3 turbo en tu equipo{status.gpu ? ` (${status.gpu})` : ""}.</p>}
        {preparing && job && (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(2, job.pct)}%` }} /></div>
            <p className="text-xs text-muted-foreground">{job.text}</p>
          </div>
        )}
        {job?.kind === "preparar" && job.status === "error" && <p className="text-xs text-destructive">⚠️ {job.error}</p>}
      </Card>

      <Card
        className={`border-dashed text-center transition ${drag ? "border-primary bg-accent/40" : ""}`}
        onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e: React.DragEvent) => {
          e.preventDefault();
          setDrag(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void run(file);
        }}
      >
        <Upload className="mx-auto size-6 text-primary" />
        <p className="mt-2 text-sm font-semibold">Suelta un audio o un vídeo</p>
        <p className="text-xs text-muted-foreground">MP3, WAV, M4A, OGG, MP4, MOV, WEBM… hasta 2 GB. Nada sale de tu equipo.</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary"
            aria-label="Idioma del audio"
          >
            {LANGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <Button variant="secondary" className="gap-2" onClick={() => fileRef.current?.click()} disabled={busy || !status?.ready}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <AudioLines className="size-4" />}
            {upload ? "Subiendo…" : transcribing ? "Transcribiendo…" : "Elegir archivo"}
          </Button>
          {name && <span className="text-xs text-muted-foreground">{name}</span>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void run(file);
          }}
        />
      </Card>

      {(upload || transcribing || (job?.kind === "transcribir" && job.status === "error")) && (
        <Card className="space-y-2">
          {upload && (
            <>
              <p className="text-sm font-semibold">Subiendo el archivo a WILLY…</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((upload.done / upload.total) * 100)}%` }} /></div>
              <p className="text-xs text-muted-foreground">Trozo {upload.done} de {upload.total}</p>
            </>
          )}
          {transcribing && job && <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin text-primary" />{job.text}</p>}
          {job?.kind === "transcribir" && job.status === "error" && <p className="text-sm text-destructive">⚠️ {job.error}</p>}
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Texto</p>
          <span className="text-xs text-muted-foreground">
            {(text.match(/\S+/g) ?? []).length} palabras{segments.length ? ` · ${segments.length} subtítulos · ${duration(segments[segments.length - 1]?.end ?? 0)}` : ""}
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Aquí aparecerá lo que se dice en el audio. Puedes corregirlo antes de copiarlo o descargarlo."
          className="h-64 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary"
        />
        <div className="flex flex-wrap gap-2">
          <CopyTextButton text={text} />
          <DownloadTextButton text={text} fileBaseName={name} fallbackName="transcripcion" />
          <Button variant="outline" className="gap-2" disabled={!segments.length} onClick={downloadSrt}><Download className="size-4" />Subtítulos (.srt)</Button>
          <Button variant="ghost" className="gap-2" disabled={!text.trim()} onClick={() => sendToChat({ text: `Resume esta transcripción en pocos puntos claros (y, si las hay, las decisiones y las tareas pendientes):\n\n${text.trim()}` })}><MessageSquare className="size-4" />Resumir en el Chat</Button>
        </div>
        {segments.length > 0 && <p className="text-xs text-muted-foreground">Los subtítulos salen de lo que oyó Whisper; si corriges el texto de arriba, no cambian.</p>}
      </Card>
    </div>
  );
}
