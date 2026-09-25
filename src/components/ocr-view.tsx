// OCR: saca el texto de fotos, escaneos y PDFs escaneados. Todo en el equipo.

import { useEffect, useRef, useState } from "react";
import { Loader2, Play, ScanText, Square, Upload, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard as Card } from "@/components/panel-card";
import { CopyTextButton, DownloadTextButton } from "@/components/text-actions";
import { usePersistentState } from "@/lib/persistent-state";
import { pushNotice } from "@/lib/notifications";
import { recognizeDocument, type OcrProgress } from "@/lib/ocr";
import type { SpeechHandle } from "@/lib/tts-voice";
import { speakBest } from "@/lib/natural-voice";
import { VoiceSelect } from "@/components/voice-select";

const LANGS = [
  { id: "spa", name: "Español" },
  { id: "eng", name: "Inglés" },
  { id: "fra", name: "Francés" },
  { id: "deu", name: "Alemán" },
  { id: "ita", name: "Italiano" },
  { id: "por", name: "Portugués" },
  { id: "spa+eng", name: "Español + inglés" },
];

export function OcrView() {
  const [text, setText] = usePersistentState("ocr:texto", "");
  const [name, setName] = usePersistentState("ocr:archivo", "");
  const [lang, setLang] = useState("spa");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [drag, setDrag] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const speech = useRef<SpeechHandle | null>(null);

  useEffect(() => () => {
    speech.current?.stop();
    if (thumb) URL.revokeObjectURL(thumb);
  }, [thumb]);

  const run = async (file: File) => {
    setBusy(true);
    setText("");
    setName(file.name);
    setThumb(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    setProgress({ page: 1, total: 1, percent: 0, stage: "Preparando el motor" });
    try {
      const out = await recognizeDocument(file, setProgress, lang);
      setText(out);
      pushNotice(out ? `Texto reconocido en ${file.name}.` : "No se ha encontrado texto en ese documento.", out ? "success" : "warn");
    } catch {
      pushNotice("No se ha podido reconocer ese documento.", "warn");
    }
    setBusy(false);
    setProgress(null);
  };

  const toggleSpeech = () => {
    if (speaking) {
      speech.current?.stop();
      speech.current = null;
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    const naturalVoice = window.localStorage.getItem("willy-voz-natural") ?? "";
    speech.current = speakBest(text, {
      ...(naturalVoice ? { naturalVoice } : {}),
      onPreparing: (m) => pushNotice(m, "info"),
      onEnd: () => setSpeaking(false),
      onError: (m) => { setSpeaking(false); pushNotice(`⚠️ ${m}`, "warn"); },
    });
  };

  return (
    <div className="space-y-4">
      <Card
        className={`border-dashed text-center transition ${drag ? "border-primary bg-accent/40" : ""}`}
        onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e: React.DragEvent) => {
          e.preventDefault();
          setDrag(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !busy) void run(file);
        }}
      >
        <Upload className="mx-auto size-6 text-primary" />
        <p className="mt-2 text-sm font-semibold">Suelta una foto, un escaneo o un PDF escaneado</p>
        <p className="text-xs text-muted-foreground">
          Reconoce el texto aunque el documento sea una imagen. Nada sale de tu equipo.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary"
            aria-label="Idioma del documento"
          >
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <Button variant="secondary" className="gap-2" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanText className="size-4" />}
            {busy ? "Reconociendo…" : "Elegir documento"}
          </Button>
          {name && <span className="text-xs text-muted-foreground">{name}</span>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void run(file);
          }}
        />
      </Card>

      {progress && (
        <Card className="space-y-2">
          <p className="text-sm font-semibold">{progress.stage}…</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            Página {progress.page} de {progress.total} · {progress.percent}%
          </p>
        </Card>
      )}

      {thumb && (
        <Card>
          <img src={thumb} alt="Documento cargado" loading="lazy" className="mx-auto max-h-64 rounded-lg object-contain" />
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Texto reconocido</p>
          <span className="text-xs text-muted-foreground">{(text.match(/\S+/g) ?? []).length} palabras</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Aquí aparecerá el texto del documento. Puedes corregirlo antes de copiarlo o escucharlo."
          className="h-64 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary"
        />
        <div className="flex flex-wrap gap-2">
          <Button variant={speaking ? "outline" : "primary"} className="gap-2" onClick={toggleSpeech} disabled={!text.trim()}>
            {speaking ? <Square className="size-4" /> : <Volume2 className="size-4" />}
            {speaking ? "Parar" : "Escucharlo"}
          </Button>
          <VoiceSelect className="self-center" />
          <CopyTextButton text={text} />
          <DownloadTextButton text={text} fileBaseName={name} fallbackName="reconocido" />
          <Button
            variant="ghost"
            className="gap-2"
            disabled={!text.trim()}
            onClick={() => {
              window.localStorage.setItem("willy-texto-ocr", text);
              pushNotice("Texto guardado. Ábrelo desde Lectura en voz alta o Súper IA.", "info");
            }}
          >
            <Play className="size-4" />Enviar a la IA
          </Button>
        </div>
      </Card>
    </div>
  );
}
