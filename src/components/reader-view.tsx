// Lectura en voz alta: sueltas un PDF (o cualquier texto) y lo escuchas con una voz natural
// de España, humana de verdad, con pausas y ritmo ajustables (nunca la voz robótica de Windows).

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Pause, Play, Upload, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard as Card } from "@/components/panel-card";
import { CopyTextButton, DownloadTextButton } from "@/components/text-actions";
import { usePersistentState } from "@/lib/persistent-state";
import { pushNotice } from "@/lib/notifications";
import { extractAnyText } from "@/lib/pdf-text";
import { chunkForSpeech, type SpeechHandle } from "@/lib/tts-voice";
import { speakBest } from "@/lib/natural-voice";
import { NaturalVoicesCard } from "@/components/natural-voices-card";
import { useSharedVoice } from "@/components/voice-select";

export function ReaderView() {
  const [text, setText] = usePersistentState("lector:texto", "");
  const [fileName, setFileName] = usePersistentState("lector:archivo", "");
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [chunk, setChunk] = useState({ index: 0, total: 0 });
  const [drag, setDrag] = useState(false);
  // La voz elegida vale para todas las pestañas (y cambia en vivo en las que ya están abiertas).
  const { voice: naturalVoice, setVoice: setNaturalVoice } = useSharedVoice();
  const handle = useRef<SpeechHandle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => handle.current?.stop(), []);

  const load = async (file: File) => {
    setLoading(true);
    setFileName(file.name);
    try {
      const content = await extractAnyText(file);
      const clean = content.replace(/--- Página \d+ ---/g, "").replace(/\n{3,}/g, "\n\n").trim();
      if (!clean) {
        pushNotice("Ese documento no tiene texto seleccionable. Pásalo por la pestaña OCR.", "warn");
      }
      setText(clean);
    } catch {
      pushNotice("No se ha podido leer ese archivo.", "warn");
    }
    setLoading(false);
  };

  const stop = () => {
    handle.current?.stop();
    handle.current = null;
    setSpeaking(false);
    setChunk({ index: 0, total: 0 });
  };

  const play = () => {
    if (!text.trim()) return;
    stop();
    setSpeaking(true);
    handle.current = speakBest(text, {
      ...(naturalVoice ? { naturalVoice } : {}),
      onPreparing: (message) => pushNotice(message, "info"),
      onChunk: (index, total) => setChunk({ index: index + 1, total }),
      onEnd: () => {
        setSpeaking(false);
        setChunk({ index: 0, total: 0 });
        pushNotice("Lectura terminada.", "success");
      },
      onError: (message) => {
        setSpeaking(false);
        pushNotice(`⚠️ ${message}`, "warn");
      },
    });
  };

  const words = (text.match(/\S+/g) ?? []).length;
  const minutes = Math.max(1, Math.round(words / 150));

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
          if (file) void load(file);
        }}
      >
        <Upload className="mx-auto size-6 text-primary" />
        <p className="mt-2 text-sm font-semibold">Suelta aquí tu PDF o pulsa para elegirlo</p>
        <p className="text-xs text-muted-foreground">
          PDF, Word, LibreOffice, PowerPoint, Excel, EPUB, HTML, RTF, subtítulos, texto… El documento se lee en tu propio equipo, no se sube a ningún sitio.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" className="gap-2" onClick={() => fileRef.current?.click()} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
            {loading ? "Abriendo…" : "Elegir documento"}
          </Button>
          {fileName && <span className="self-center text-xs text-muted-foreground">{fileName}</span>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.csv,.json,.docx,.odt,.pptx,.xlsx,.epub,.html,.htm,.rtf,.srt,.vtt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void load(file);
          }}
        />
      </Card>

      <NaturalVoicesCard text={text} fileName={fileName} voice={naturalVoice} onVoice={setNaturalVoice} />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold"><Volume2 className="mr-2 inline size-4 text-primary" />Texto que se va a leer</p>
          <span className="text-xs text-muted-foreground">
            {words.toLocaleString("es-ES")} palabras · unos {minutes} min · {chunkForSpeech(text).length} tramos
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Aquí aparecerá el texto del PDF. También puedes pegar o escribir lo que quieras escuchar."
          className="h-64 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary"
        />
        <div className="flex flex-wrap gap-2">
          {speaking ? (
            <Button variant="outline" className="gap-2" onClick={stop}>
              <Pause className="size-4" />Parar la lectura
            </Button>
          ) : (
            <Button className="gap-2" onClick={play} disabled={!text.trim()}>
              <Play className="size-4" />Leer en voz alta
            </Button>
          )}
          <CopyTextButton text={text} />
          <DownloadTextButton text={text} fileBaseName={fileName} label="Descargar texto" />
        </div>
        {speaking && chunk.total > 0 && (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round((chunk.index / chunk.total) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Leyendo el tramo {chunk.index} de {chunk.total}.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
