/**
 * dubbing-view.tsx — Pantalla «Doblar vídeos» (Video Dubbing Studio)
 * Flujo de 4 pasos:
 *   1. Subir vídeo  →  2. Transcribir  →  3. Traducir/Adaptar  →  4. Sintetizar y fusionar
 *
 * Motores reutilizados:
 *   - /api/iphone  (action: "transcribir")  — Whisper STT
 *   - /api/chat                              — traducción con LLM
 *   - /api/avatar  (action: "voice-test")   — síntesis de voz TTS
 *   - /api/avatar  (action: "montaje")      — fusión audio+vídeo con ffmpeg
 */

import { useState, useRef } from "react";
import {
  ArrowRight, Check, ChevronDown, ChevronUp, Download,
  Film, Loader2, Mic, Upload, Languages, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Tipos ──────────────────────────────────────────────────────────────────

type IdiomaTarget = "es" | "en" | "fr" | "de" | "it" | "pt";

type UploadState = {
  file: File | null;
  b64: string | null;
  nombre: string;
  error: string;
  cargando: boolean;
};

type TranscribeState = {
  texto: string;
  generando: boolean;
  error: string;
  listo: boolean;
};

type TranslateState = {
  idioma: IdiomaTarget;
  texto: string;
  generando: boolean;
  error: string;
};

type SynthState = {
  generando: boolean;
  error: string;
  resultB64: string | null;
  resultMime: string | null;
  fileName: string | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

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

const IDIOMAS: { id: IdiomaTarget; label: string }[] = [
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
  { id: "it", label: "Italiano" },
  { id: "pt", label: "Português" },
];

const MAX_MB = 500;
const ACCEPTED = ["video/mp4", "video/webm", "video/quicktime"];

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

function StepHeader({ n, title, done, active, onClick }: {
  n: number; title: string; done: boolean; active: boolean; onClick: () => void;
}) {
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
      {active
        ? <ChevronUp className="ml-auto size-4 text-muted-foreground" />
        : <ChevronDown className="ml-auto size-4 text-muted-foreground" />}
    </button>
  );
}

// ── Paso 1: Subir vídeo ────────────────────────────────────────────────────

function UploadStep({ state, onChange, onNext }: {
  state: UploadState;
  onChange: (s: Partial<UploadState>) => void;
  onNext: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handleFile = async (file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      onChange({ error: "Formato no soportado. Usa MP4, WebM o MOV." });
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      onChange({ error: `El vídeo supera el límite de ${MAX_MB} MB.` });
      return;
    }
    onChange({ cargando: true, error: "" });
    try {
      const b64 = await fileToB64(file);
      onChange({ file, b64, nombre: file.name, cargando: false, error: "" });
    } catch {
      onChange({ cargando: false, error: "No se pudo leer el archivo." });
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault(); setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) void handleFile(f);
        }}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors",
          drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/20",
        )}
      >
        <Film className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground text-center">
          Arrastra un vídeo aquí o haz clic para seleccionarlo<br />
          <span className="text-xs">MP4, WebM, MOV · máx. {MAX_MB} MB</span>
        </p>
        {state.cargando && <Loader2 className="size-5 animate-spin text-primary" />}
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
        />
      </div>

      {state.file && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <Upload className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{state.nombre}</p>
            <p className="text-xs text-muted-foreground">
              {(state.file.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          </div>
          <Check className="size-4 text-green-500" />
        </div>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button
        className="w-full"
        disabled={!state.file || state.cargando}
        onClick={onNext}
      >
        Continuar <ArrowRight className="ml-2 size-4" />
      </Button>
    </div>
  );
}

// ── Paso 2: Transcribir ────────────────────────────────────────────────────

function TranscribeStep({ videoB64, state, onChange, onNext }: {
  videoB64: string | null;
  state: TranscribeState;
  onChange: (s: Partial<TranscribeState>) => void;
  onNext: () => void;
}) {
  const transcribir = async () => {
    if (!videoB64) return;
    onChange({ generando: true, error: "", listo: false });
    try {
      const body: Record<string, unknown> = {};
      body["action"] = "transcribir";
      body["audio"] = videoB64;
      body["ext"] = "mp4";
      body["lang"] = "auto";

      const res = await fetch("/api/iphone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { text?: string; error?: string; message?: string };

      if (!res.ok || data["error"]) {
        const msg = String(data["error"] ?? data["message"] ?? `Error ${res.status}`);
        // Detectar si Whisper no está listo
        if (msg.toLowerCase().includes("whisper") || msg.toLowerCase().includes("preparar") || res.status === 503) {
          throw new Error("Necesitas preparar la transcripción primero (Más → Transcribir)");
        }
        throw new Error(msg);
      }

      const texto = data["text"] ?? "";
      if (!texto) throw new Error("La transcripción llegó vacía.");
      onChange({ texto, generando: false, listo: true });
    } catch (e: unknown) {
      onChange({ generando: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Usa Whisper para extraer el texto hablado del vídeo. Si es la primera vez,
        necesitarás preparar el motor desde <strong>Más → Transcribir</strong>.
      </p>

      <Button
        variant="secondary"
        className="w-full"
        disabled={state.generando || !videoB64}
        onClick={() => void transcribir()}
      >
        {state.generando
          ? <><Loader2 className="mr-2 size-4 animate-spin" /> Transcribiendo…</>
          : <><Mic className="mr-2 size-4" /> Transcribir con Whisper</>}
      </Button>

      {state.listo && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Transcripción (editable)
          </label>
          <textarea
            value={state.texto}
            onChange={(e) => onChange({ texto: e.target.value })}
            rows={8}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      )}

      {state.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <Button
        className="w-full"
        disabled={!state.listo || !state.texto.trim()}
        onClick={onNext}
      >
        Continuar <ArrowRight className="ml-2 size-4" />
      </Button>
    </div>
  );
}

// ── Paso 3: Traducir / Adaptar ─────────────────────────────────────────────

function TranslateStep({ original, state, onChange, onNext }: {
  original: string;
  state: TranslateState;
  onChange: (s: Partial<TranslateState>) => void;
  onNext: () => void;
}) {
  const traducir = async () => {
    if (!original.trim()) return;
    onChange({ generando: true, error: "" });
    try {
      const idiomaNombre = IDIOMAS.find((l) => l.id === state.idioma)?.label ?? state.idioma;
      const prompt = [
        `Traduce el siguiente texto al ${idiomaNombre}.`,
        `Mantén el estilo oral, natural y las pausas. No añadas explicaciones.`,
        `Texto original:\n${original}`,
      ].join(" ");

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }], stream: false }),
      });
      const data = await res.json() as { content?: string; text?: string; error?: string };
      const texto = data["content"] ?? data["text"] ?? "";
      if (!texto) throw new Error(data["error"] ?? "La IA no generó traducción.");
      onChange({ texto, generando: false });
    } catch (e: unknown) {
      onChange({ generando: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
          Idioma destino
        </label>
        <div className="flex flex-wrap gap-2">
          {IDIOMAS.map((l) => (
            <button
              key={l.id}
              onClick={() => onChange({ idioma: l.id })}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                state.idioma === l.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-primary/50",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <Button
        variant="secondary"
        className="w-full"
        disabled={state.generando}
        onClick={() => void traducir()}
      >
        {state.generando
          ? <><Loader2 className="mr-2 size-4 animate-spin" /> Traduciendo…</>
          : <><Languages className="mr-2 size-4" /> Traducir con IA</>}
      </Button>

      {state.texto && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Traducción (editable)
          </label>
          <textarea
            value={state.texto}
            onChange={(e) => onChange({ texto: e.target.value })}
            rows={8}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      )}

      {state.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <Button
        className="w-full"
        disabled={!state.texto.trim()}
        onClick={onNext}
      >
        Continuar <ArrowRight className="ml-2 size-4" />
      </Button>
    </div>
  );
}

// ── Paso 4: Sintetizar y fusionar ──────────────────────────────────────────

function SynthStep({ translatedText, videoB64, state, onChange }: {
  translatedText: string;
  videoB64: string | null;
  state: SynthState;
  onChange: (s: Partial<SynthState>) => void;
}) {
  const generar = async () => {
    if (!translatedText.trim() || !videoB64) return;
    onChange({ generando: true, error: "", resultB64: null, resultMime: null, fileName: null });
    try {
      // 1. Síntesis de voz
      const bodyVoz: Record<string, unknown> = {};
      bodyVoz["action"] = "voice-test";
      bodyVoz["text"] = translatedText;

      const vozRes = await avatarPost(bodyVoz);
      const vozData = await vozRes.json() as { audio?: string; b64?: string; error?: string };
      if (!vozRes.ok || vozData["error"]) {
        throw new Error(vozData["error"] ?? `Error síntesis de voz: ${vozRes.status}`);
      }
      const audioB64 = vozData["audio"] ?? vozData["b64"] ?? "";
      if (!audioB64) throw new Error("La síntesis de voz no devolvió audio.");

      // 2. Montaje vídeo + audio
      const bodyMontaje: Record<string, unknown> = {};
      bodyMontaje["action"] = "montaje";
      bodyMontaje["video"] = videoB64;
      bodyMontaje["subtitles"] = translatedText;
      bodyMontaje["formato"] = "original";
      bodyMontaje["audio_doblaje"] = audioB64;

      const montajeRes = await avatarPost(bodyMontaje);
      const montajeData = await montajeRes.json() as {
        video?: string; file?: string; b64?: string; mime?: string; filename?: string; error?: string;
      };
      if (!montajeRes.ok || montajeData["error"]) {
        throw new Error(montajeData["error"] ?? `Error en montaje: ${montajeRes.status}`);
      }

      const b64 = montajeData["video"] ?? montajeData["file"] ?? montajeData["b64"] ?? "";
      if (!b64) throw new Error("El servidor no devolvió el vídeo doblado.");

      onChange({
        generando: false,
        resultB64: b64,
        resultMime: montajeData["mime"] ?? "video/mp4",
        fileName: montajeData["filename"] ?? "video-doblado.mp4",
      });
    } catch (e: unknown) {
      onChange({ generando: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const descargar = () => {
    if (!state.resultB64 || !state.resultMime || !state.fileName) return;
    const blob = b64toBlob(state.resultB64, state.resultMime);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        WILLY sintetizará la voz en el idioma elegido y la fusionará con el vídeo original.
      </p>

      {!state.resultB64 && (
        <Button
          className="w-full"
          disabled={state.generando || !translatedText.trim() || !videoB64}
          onClick={() => void generar()}
        >
          {state.generando
            ? <><Loader2 className="mr-2 size-4 animate-spin" /> Generando vídeo doblado…</>
            : <><Wand2 className="mr-2 size-4" /> Sintetizar y fusionar</>}
        </Button>
      )}

      {state.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      {state.resultB64 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3">
            <Check className="size-5 text-green-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">¡Vídeo doblado listo!</p>
              <p className="text-xs text-muted-foreground">{state.fileName}</p>
            </div>
          </div>
          <Button className="w-full" onClick={descargar}>
            <Download className="mr-2 size-4" /> Descargar vídeo doblado
          </Button>
          <Button variant="outline" className="w-full" onClick={() => void generar()}>
            <Wand2 className="mr-2 size-4" /> Regenerar
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Vista principal ────────────────────────────────────────────────────────

export function DubbingView() {
  const [step, setStep] = useState(1);

  const [upload, setUpload] = useState<UploadState>({
    file: null, b64: null, nombre: "", error: "", cargando: false,
  });
  const [transcribe, setTranscribe] = useState<TranscribeState>({
    texto: "", generando: false, error: "", listo: false,
  });
  const [translate, setTranslate] = useState<TranslateState>({
    idioma: "es", texto: "", generando: false, error: "",
  });
  const [synth, setSynth] = useState<SynthState>({
    generando: false, error: "", resultB64: null, resultMime: null, fileName: null,
  });

  const done1 = !!upload.file;
  const done2 = transcribe.listo && !!transcribe.texto.trim();
  const done3 = !!translate.texto.trim();

  const goTo = (n: number) => {
    if (n === 2 && !done1) return;
    if (n === 3 && !done2) return;
    if (n === 4 && !done3) return;
    setStep(n);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-2 p-4 pb-12">
      {/* Cabecera */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
          <Film className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Doblar vídeos</h1>
          <p className="text-sm text-muted-foreground">Transcribe, traduce y sintetiza voz en 4 pasos</p>
        </div>
      </div>

      {/* Paso 1 */}
      <div className="rounded-xl overflow-hidden">
        <StepHeader n={1} title="Subir vídeo" done={done1} active={step === 1} onClick={() => goTo(1)} />
        {step === 1 && (
          <div className="px-4 pb-4">
            <UploadStep
              state={upload}
              onChange={(s) => setUpload((prev) => ({ ...prev, ...s }))}
              onNext={() => setStep(2)}
            />
          </div>
        )}
      </div>

      {/* Paso 2 */}
      <div className="rounded-xl overflow-hidden">
        <StepHeader n={2} title="Transcribir" done={done2} active={step === 2} onClick={() => goTo(2)} />
        {step === 2 && (
          <div className="px-4 pb-4">
            <TranscribeStep
              videoB64={upload.b64}
              state={transcribe}
              onChange={(s) => setTranscribe((prev) => ({ ...prev, ...s }))}
              onNext={() => setStep(3)}
            />
          </div>
        )}
      </div>

      {/* Paso 3 */}
      <div className="rounded-xl overflow-hidden">
        <StepHeader n={3} title="Traducir / Adaptar" done={done3} active={step === 3} onClick={() => goTo(3)} />
        {step === 3 && (
          <div className="px-4 pb-4">
            <TranslateStep
              original={transcribe.texto}
              state={translate}
              onChange={(s) => setTranslate((prev) => ({ ...prev, ...s }))}
              onNext={() => setStep(4)}
            />
          </div>
        )}
      </div>

      {/* Paso 4 */}
      <div className="rounded-xl overflow-hidden">
        <StepHeader n={4} title="Sintetizar y fusionar" done={!!synth.resultB64} active={step === 4} onClick={() => goTo(4)} />
        {step === 4 && (
          <div className="px-4 pb-4">
            <SynthStep
              translatedText={translate.texto}
              videoB64={upload.b64}
              state={synth}
              onChange={(s) => setSynth((prev) => ({ ...prev, ...s }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
