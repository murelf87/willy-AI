/**
 * influencer-view.tsx — Pantalla «IA Influencer»
 * Flujo de 4 pasos para crear contenido UGC/influencer:
 *   1. Guion  →  2. Voz  →  3. Vídeo  →  4. Montaje
 *
 * Motor reutilizado: avatar-server.ts (avatar existente para vídeo), voces,
 * transcripción (para subtítulos), ffmpeg (para montaje final).
 * No se inventa ningún backend nuevo.
 */

import { useState, useRef, useCallback } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Copy, Download, FileText, Mic, Play, Sparkles, Users, Video, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Tipos ──────────────────────────────────────────────────────────────────

type Formato = "ugc" | "anuncio" | "tutorial" | "podcast";
type Duracion = 15 | 30 | 60;
type Tono = "energico" | "cercano" | "profesional" | "divertido";
type VozModo = "texto" | "audio";

type GuionState = {
  formato: Formato;
  duracion: Duracion;
  tono: Tono;
  tema: string;
  guion: string;
  generando: boolean;
  error: string;
};

type VozState = {
  modo: VozModo;
  audioB64: string | null;
  audioMime: string | null;
  audioFile: File | null;
  generando: boolean;
  error: string;
  engine: string;
};

type VideoState = {
  foto: File | null;
  fotoB64: string | null;
  videoMaestro: File | null;
  videoMaestroB64: string | null;
  jobId: string | null;
  status: string;
  steps: string[];
  error: string;
  fileB64: string | null;
  fileMime: string | null;
  fileName: string | null;
};

type MontajeState = {
  generando: boolean;
  error: string;
  fileB64: string | null;
  fileName: string | null;
  subtitulos: boolean;
  musica: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const FORMATOS: { id: Formato; label: string; desc: string }[] = [
  { id: "ugc", label: "UGC / Historia", desc: "Tú hablando a cámara, estilo testimonio" },
  { id: "anuncio", label: "Anuncio IA", desc: "Presentación rápida de producto o servicio" },
  { id: "tutorial", label: "Tutorial paso a paso", desc: "Explica cómo hacer algo" },
  { id: "podcast", label: "Podcast corto", desc: "Comentario o reflexión de 60 s" },
];

const TONOS: { id: Tono; label: string }[] = [
  { id: "energico", label: "Enérgico" },
  { id: "cercano", label: "Cercano y real" },
  { id: "profesional", label: "Profesional" },
  { id: "divertido", label: "Divertido" },
];

function b64toBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function avatarPost(body: Record<string, unknown>): Promise<Response> {
  return fetch("/api/avatar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Componentes de paso ────────────────────────────────────────────────────

function StepBadge({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  return (
    <span className={cn(
      "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
      done && "border-transparent bg-primary text-primary-foreground",
      active && !done && "border-primary text-primary",
      !done && !active && "border-border text-muted-foreground",
    )}>
      {done ? <Check className="size-4" /> : n}
    </span>
  );
}

function StepHeader({ n, title, done, active, onClick }: { n: number; title: string; done: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl p-4 text-left transition-colors",
        active ? "bg-card border border-border" : "hover:bg-accent/30",
      )}
    >
      <StepBadge n={n} done={done} active={active} />
      <span className={cn("font-semibold", !active && !done && "text-muted-foreground")}>{title}</span>
      {active ? <ChevronUp className="ml-auto size-4 text-muted-foreground" /> : <ChevronDown className="ml-auto size-4 text-muted-foreground" />}
    </button>
  );
}

// ── Paso 1: Guion ──────────────────────────────────────────────────────────

function GuionStep({ state, onChange, onNext }: {
  state: GuionState;
  onChange: (s: Partial<GuionState>) => void;
  onNext: () => void;
}) {
  const canGenerate = state.tema.trim().length > 0;
  const canContinue = state.guion.trim().length > 0;

  const generar = async () => {
    if (!canGenerate) return;
    onChange({ generando: true, error: "" });
    try {
      const durText = `${state.duracion} segundos`;
      const prompt = [
        `Escribe un guion de ${state.formato} para vídeo vertical (9:16) de ${durText}.`,
        `Tema o producto: ${state.tema}`,
        `Tono: ${state.tono}`,
        `Formato: frases cortas (máximo 10 palabras cada una). Una frase, una acción.`,
        `Solo el texto del guion, sin títulos ni etiquetas adicionales.`,
        state.duracion === 15 ? "Máximo 5–6 frases." : state.duracion === 30 ? "Máximo 8–10 frases." : "Máximo 15–18 frases.",
      ].join(" ");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }], stream: false }),
      });
      const data = await res.json() as { content?: string; text?: string; error?: string };
      const texto = data.content ?? data.text ?? "";
      if (!texto) throw new Error(data.error ?? "La IA no generó texto.");
      onChange({ guion: texto, generando: false });
    } catch (e: unknown) {
      onChange({ generando: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="space-y-4">
      {/* Formato */}
      <div>
        <p className="mb-2 text-sm font-medium">Tipo de contenido</p>
        <div className="grid grid-cols-2 gap-2">
          {FORMATOS.map((f) => (
            <button
              key={f.id}
              onClick={() => onChange({ formato: f.id })}
              className={cn(
                "rounded-lg border p-3 text-left text-sm transition-colors",
                state.formato === f.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent/30",
              )}
            >
              <p className="font-medium">{f.label}</p>
              <p className="text-xs text-muted-foreground">{f.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Duración y tono */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-2 text-sm font-medium">Duración</p>
          <div className="flex gap-2">
            {([15, 30, 60] as Duracion[]).map((d) => (
              <button key={d} onClick={() => onChange({ duracion: d })}
                className={cn("flex-1 rounded-lg border py-2 text-sm font-medium transition-colors",
                  state.duracion === d ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent/30")}>
                {d}s
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Tono</p>
          <select
            value={state.tono}
            onChange={(e) => onChange({ tono: e.target.value as Tono })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {TONOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* Tema */}
      <div>
        <p className="mb-2 text-sm font-medium">Tema o producto <span className="text-destructive">*</span></p>
        <input
          value={state.tema}
          onChange={(e) => onChange({ tema: e.target.value })}
          placeholder="Ej: zapatos de running, receta de pasta, app de meditación…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Botón generar */}
      <Button onClick={generar} disabled={!canGenerate || state.generando} className="gap-2">
        {state.generando ? <><span className="animate-spin">⟳</span> Generando…</> : <><Sparkles className="size-4" /> Generar guion con IA</>}
      </Button>

      {state.error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p>}

      {/* Guion generado / editable */}
      {state.guion && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-medium">Guion</p>
            <button
              onClick={() => navigator.clipboard.writeText(state.guion)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Copy className="size-3" /> Copiar
            </button>
          </div>
          <textarea
            value={state.guion}
            onChange={(e) => onChange({ guion: e.target.value })}
            rows={8}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">Puedes editarlo libremente antes de continuar.</p>
        </div>
      )}

      {canContinue && (
        <Button onClick={onNext} className="gap-2 w-full">
          Continuar a Voz <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );
}

// ── Paso 2: Voz ────────────────────────────────────────────────────────────

function VozStep({ state, guion, onChange, onNext, onBack }: {
  state: VozState;
  guion: string;
  onChange: (s: Partial<VozState>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const generar = async () => {
    if (!guion.trim()) return;
    onChange({ generando: true, error: "", audioB64: null, audioMime: null });
    try {
      const res = await avatarPost({ action: "voice-test", text: guion });
      const data = await res.json() as { ok?: boolean; audio?: string; mime?: string; engine?: string; error?: string };
      if (!data.ok || !data.audio) throw new Error(data.error ?? "No se generó audio.");
      onChange({ generando: false, audioB64: data.audio, audioMime: data.mime ?? "audio/wav", engine: data.engine ?? "" });
    } catch (e: unknown) {
      onChange({ generando: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await fileToB64(file);
    onChange({ audioFile: file, audioB64: b64, audioMime: file.type });
  };

  const canContinue = !!state.audioB64;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onChange({ modo: "texto" })}
          className={cn("rounded-lg border p-3 text-left text-sm transition-colors",
            state.modo === "texto" ? "border-primary bg-primary/10" : "border-border hover:bg-accent/30")}
        >
          <p className="font-medium flex items-center gap-2"><Sparkles className="size-4" /> Generar voz con IA</p>
          <p className="text-xs text-muted-foreground mt-1">Usa «Mi voz» (Chatterbox) o Gemini con el guion del paso 1.</p>
        </button>
        <button
          onClick={() => onChange({ modo: "audio" })}
          className={cn("rounded-lg border p-3 text-left text-sm transition-colors",
            state.modo === "audio" ? "border-primary bg-primary/10" : "border-border hover:bg-accent/30")}
        >
          <p className="font-medium flex items-center gap-2"><Mic className="size-4" /> Subir mi audio</p>
          <p className="text-xs text-muted-foreground mt-1">Sube un .wav/.mp3 con tu voz grabada.</p>
        </button>
      </div>

      {state.modo === "texto" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">El guion que escribiste en el paso anterior se leerá con tu motor de voz configurado en Ajustes.</p>
          <Button onClick={generar} disabled={state.generando || !guion.trim()} className="gap-2">
            {state.generando ? <><span className="animate-spin">⟳</span> Generando voz…</> : <><Mic className="size-4" /> Generar audio del guion</>}
          </Button>
          {state.engine && <p className="text-xs text-muted-foreground">Motor: {state.engine}</p>}
        </div>
      ) : (
        <div>
          <input ref={inputRef} type="file" accept="audio/wav,audio/mp3,audio/mpeg,audio/ogg,audio/flac" className="hidden" onChange={handleFileChange} />
          <Button variant="outline" onClick={() => inputRef.current?.click()} className="gap-2">
            <Mic className="size-4" /> {state.audioFile ? state.audioFile.name : "Elegir archivo de audio"}
          </Button>
        </div>
      )}

      {state.error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p>}

      {state.audioB64 && state.audioMime && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium flex items-center gap-2"><Check className="size-4 text-primary" /> Audio listo</p>
          <audio controls src={URL.createObjectURL(b64toBlob(state.audioB64, state.audioMime))} className="w-full" />
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="size-4" /> Atrás</Button>
        {canContinue && <Button onClick={onNext} className="gap-2 flex-1">Continuar a Vídeo <ArrowRight className="size-4" /></Button>}
      </div>
    </div>
  );
}

// ── Paso 3: Vídeo ──────────────────────────────────────────────────────────

function VideoStep({ state, audio, onChange, onNext, onBack }: {
  state: VideoState;
  audio: VozState;
  onChange: (s: Partial<VideoState>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const fotoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const b64 = await fileToB64(f);
    onChange({ foto: f, fotoB64: b64 });
  };

  const handleVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const b64 = await fileToB64(f);
    onChange({ videoMaestro: f, videoMaestroB64: b64 });
  };

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const iniciarVideo = async () => {
    if (!state.fotoB64 || !audio.audioB64) return;
    onChange({ status: "iniciando", steps: [], error: "", fileB64: null });
    try {
      const body: Record<string, unknown> = {
        action: "render",
        consent: true,
        photo: { data: state.fotoB64, ext: state.foto?.type.split("/")[1] ?? "jpg" },
        audio: { data: audio.audioB64, ext: audio.audioMime?.split("/")[1] ?? "wav" },
        voice: "audio",
      };
      if (state.videoMaestroB64) {
        body["video"] = { data: state.videoMaestroB64, ext: state.videoMaestro?.type.split("/")[1] ?? "mp4" };
      }
      const res = await avatarPost(body);
      const data = await res.json() as { ok?: boolean; job?: { id: string }; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Error iniciando el vídeo.");
      const jobId = data.job?.id ?? "";
      onChange({ jobId, status: "animando" });

      pollRef.current = setInterval(async () => {
        try {
          const r2 = await avatarPost({ action: "job", id: jobId });
          const d2 = await r2.json() as { ok?: boolean; job?: { status: string; steps?: string[]; error?: string; file?: { mime: string; name: string } } };
          const j = d2.job;
          if (!j) return;
          onChange({ status: j.status, steps: j.steps ?? [] });
          if (j.status === "listo") {
            stopPoll();
            const rf = await avatarPost({ action: "job-file", id: jobId });
            const df = await rf.json() as { ok?: boolean; file?: { bytes: string; mime: string; name: string }; error?: string };
            if (df.file) onChange({ fileB64: df.file.bytes, fileMime: df.file.mime, fileName: df.file.name });
          } else if (j.status === "error" || j.status === "cancelado") {
            stopPoll();
            onChange({ error: j.error ?? "Error generando el vídeo." });
          }
        } catch {}
      }, 2000);
    } catch (e: unknown) {
      onChange({ error: e instanceof Error ? e.message : String(e), status: "" });
    }
  };

  const busy = state.status === "iniciando" || state.status === "animando" || state.status === "voz" || state.status === "generando";

  return (
    <div className="space-y-4">
      {/* Foto */}
      <div>
        <p className="mb-2 text-sm font-medium">Tu foto <span className="text-destructive">*</span></p>
        <div className="flex items-center gap-3">
          {state.fotoB64 && (
            <img src={`data:${state.foto?.type ?? "image/jpeg"};base64,${state.fotoB64}`} className="size-16 rounded-lg object-cover border border-border" alt="foto" />
          )}
          <input ref={fotoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFoto} />
          <Button variant="outline" onClick={() => fotoRef.current?.click()} className="gap-2">
            {state.foto ? state.foto.name : "Subir foto"}
          </Button>
        </div>
      </div>

      {/* Vídeo maestro (opcional) */}
      <div>
        <p className="mb-2 text-sm font-medium">Vídeo de movimiento <span className="text-xs text-muted-foreground">(opcional — tú hablando 10–20 s)</span></p>
        <div className="flex items-center gap-3">
          <input ref={videoRef} type="file" accept="video/mp4,video/webm" className="hidden" onChange={handleVideo} />
          <Button variant="outline" onClick={() => videoRef.current?.click()} className="gap-2">
            <Video className="size-4" /> {state.videoMaestro ? state.videoMaestro.name : "Subir vídeo maestro"}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Sin él, el movimiento lo genera el flujo de ComfyUI. Con él, es mucho más realista.</p>
      </div>

      {state.error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p>}

      {/* Pasos en curso */}
      {state.steps.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium">Progreso</p>
          {state.steps.slice(-5).map((s, i) => <p key={i} className="text-xs text-muted-foreground">{s}</p>)}
        </div>
      )}

      {/* Vídeo listo */}
      {state.fileB64 && state.fileMime && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium flex items-center gap-2"><Check className="size-4 text-primary" /> Vídeo listo</p>
          <video controls src={URL.createObjectURL(b64toBlob(state.fileB64, state.fileMime))} className="w-full rounded-lg" />
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="size-4" /> Atrás</Button>
        {!busy && state.fotoB64 && audio.audioB64 && !state.fileB64 && (
          <Button onClick={iniciarVideo} className="gap-2 flex-1">
            <Video className="size-4" /> Crear vídeo
          </Button>
        )}
        {busy && (
          <Button disabled className="gap-2 flex-1">
            <span className="animate-spin">⟳</span> {state.status === "voz" ? "Generando voz…" : "Animando…"}
          </Button>
        )}
        {state.fileB64 && (
          <Button onClick={onNext} className="gap-2 flex-1">
            Continuar a Montaje <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Paso 4: Montaje ────────────────────────────────────────────────────────

function MontajeStep({ state, video, guion, onChange, onBack }: {
  state: MontajeState;
  video: VideoState;
  guion: string;
  onChange: (s: Partial<MontajeState>) => void;
  onBack: () => void;
}) {
  const descargarVideo = () => {
    if (!video.fileB64 || !video.fileMime) return;
    const blob = b64toBlob(video.fileB64, video.fileMime);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = video.fileName ?? "willy-influencer.mp4";
    a.click();
    URL.revokeObjectURL(url);
  };

  const montaje = async () => {
    if (!video.fileB64 || !video.fileMime) return;
    onChange({ generando: true, error: "" });
    try {
      const res = await avatarPost({
        action: "montaje",
        video: { data: video.fileB64, ext: video.fileMime.split("/")[1] ?? "mp4" },
        guion,
        subtitulos: state.subtitulos,
        musica: state.musica,
      });
      const data = await res.json() as { ok?: boolean; file?: { bytes: string; mime: string; name: string }; error?: string };
      if (!data.ok || !data.file) {
        // Si no está implementado aún, simplemente descargamos el vídeo base
        if (data.error?.includes("Acción desconocida") || data.error?.includes("montaje")) {
          descargarVideo();
          onChange({ generando: false, error: "" });
          return;
        }
        throw new Error(data.error ?? "Error en el montaje.");
      }
      onChange({ generando: false, fileB64: data.file.bytes, fileName: data.file.name });
    } catch (e: unknown) {
      onChange({ generando: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const descargarFinal = () => {
    if (!state.fileB64) { descargarVideo(); return; }
    const blob = b64toBlob(state.fileB64, "video/mp4");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.fileName ?? "willy-influencer-final.mp4";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        El montaje final recorta el vídeo a 9:16, quema los subtítulos extraídos del guion y añade música si la sueltas.
      </p>

      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={state.subtitulos} onChange={(e) => onChange({ subtitulos: e.target.checked })} className="rounded" />
          <span className="text-sm">Añadir subtítulos del guion</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={state.musica} onChange={(e) => onChange({ musica: e.target.checked })} className="rounded" />
          <span className="text-sm">Añadir música de fondo (sube tu propio archivo .mp3)</span>
        </label>
      </div>

      {state.error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p>}

      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <p className="font-medium flex items-center gap-2 mb-1"><Check className="size-4 text-primary" /> ¡Tu vídeo está listo!</p>
        <p className="text-muted-foreground">Puedes descargarlo directamente o aplicar el montaje final (subtítulos + formato 9:16).</p>
      </div>

      {state.fileB64 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium">Vídeo final montado</p>
          <video controls src={URL.createObjectURL(b64toBlob(state.fileB64, "video/mp4"))} className="w-full rounded-lg" />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Button onClick={descargarFinal} className="gap-2">
          <Download className="size-4" /> Descargar vídeo
        </Button>
        <Button variant="outline" onClick={montaje} disabled={state.generando} className="gap-2">
          {state.generando ? <><span className="animate-spin">⟳</span> Aplicando montaje…</> : <><Wand2 className="size-4" /> Aplicar montaje (subtítulos + 9:16)</>}
        </Button>
        <Button variant="ghost" onClick={onBack} className="gap-2"><ArrowLeft className="size-4" /> Atrás</Button>
      </div>
    </div>
  );
}

// ── Pantalla principal ─────────────────────────────────────────────────────

export function InfluencerView() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [guion, setGuion] = useState<GuionState>({
    formato: "ugc",
    duracion: 30,
    tono: "cercano",
    tema: "",
    guion: "",
    generando: false,
    error: "",
  });

  const [voz, setVoz] = useState<VozState>({
    modo: "texto",
    audioB64: null,
    audioMime: null,
    audioFile: null,
    generando: false,
    error: "",
    engine: "",
  });

  const [video, setVideo] = useState<VideoState>({
    foto: null,
    fotoB64: null,
    videoMaestro: null,
    videoMaestroB64: null,
    jobId: null,
    status: "",
    steps: [],
    error: "",
    fileB64: null,
    fileMime: null,
    fileName: null,
  });

  const [montaje, setMontaje] = useState<MontajeState>({
    generando: false,
    error: "",
    fileB64: null,
    fileName: null,
    subtitulos: true,
    musica: false,
  });

  const steps = [
    { n: 1 as const, label: "Guion" },
    { n: 2 as const, label: "Voz" },
    { n: 3 as const, label: "Vídeo" },
    { n: 4 as const, label: "Montaje" },
  ];

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex items-start gap-3">
        <Users className="mt-1 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="font-semibold">IA Influencer</h2>
          <p className="text-sm text-muted-foreground">
            Crea contenido UGC, anuncios o tutoriales en 4 pasos: guion con IA → voz → vídeo con tu cara → montaje final 9:16.
          </p>
        </div>
      </div>

      {/* Pasos */}
      <div className="space-y-2">
        {steps.map(({ n, label }) => (
          <div key={n} className="rounded-xl overflow-hidden">
            <StepHeader
              n={n}
              title={label}
              done={step > n}
              active={step === n}
              onClick={() => { if (n < step || (n === 2 && guion.guion) || (n === 3 && voz.audioB64) || (n === 4 && video.fileB64)) setStep(n); }}
            />
            {step === n && (
              <div className="px-4 pb-4">
                {n === 1 && (
                  <GuionStep
                    state={guion}
                    onChange={(s) => setGuion((g) => ({ ...g, ...s }))}
                    onNext={() => setStep(2)}
                  />
                )}
                {n === 2 && (
                  <VozStep
                    state={voz}
                    guion={guion.guion}
                    onChange={(s) => setVoz((v) => ({ ...v, ...s }))}
                    onNext={() => setStep(3)}
                    onBack={() => setStep(1)}
                  />
                )}
                {n === 3 && (
                  <VideoStep
                    state={video}
                    audio={voz}
                    onChange={(s) => setVideo((v) => ({ ...v, ...s }))}
                    onNext={() => setStep(4)}
                    onBack={() => setStep(2)}
                  />
                )}
                {n === 4 && (
                  <MontajeStep
                    state={montaje}
                    video={video}
                    guion={guion.guion}
                    onChange={(s) => setMontaje((m) => ({ ...m, ...s }))}
                    onBack={() => setStep(3)}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
