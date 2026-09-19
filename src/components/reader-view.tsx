// Lectura en voz alta: sueltas un PDF (o cualquier texto) y lo escuchas con
// voces españolas naturales, de hombre o de mujer.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Download, FileText, Loader2, Pause, Play, Upload, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";
import { extractAnyText } from "@/lib/pdf-text";
import { SPANISH_VOICES, chunkForSpeech, speakText, voiceById, type SpeechHandle } from "@/lib/tts-voice";

type CardProps = { children: ReactNode; className?: string; onDragOver?: (e: React.DragEvent) => void; onDragLeave?: () => void; onDrop?: (e: React.DragEvent) => void };

function Card({ children, className = "", ...drag }: CardProps) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`} {...drag}>{children}</div>;
}

export function ReaderView() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [voice, setVoice] = useState(() => window.localStorage.getItem("willy-voz") ?? "Kore");
  const [speed, setSpeed] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [chunk, setChunk] = useState({ index: 0, total: 0 });
  const [drag, setDrag] = useState(false);
  const handle = useRef<SpeechHandle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => handle.current?.stop(), []);

  const pickVoice = (id: string) => {
    setVoice(id);
    window.localStorage.setItem("willy-voz", id);
  };

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
    handle.current = speakText(text, {
      voice,
      speed,
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

  const preview = (id: string) => {
    stop();
    pickVoice(id);
    speakText(
      `Hola, soy ${voiceById(id).name}. Así sonará la lectura de tu documento, con una voz natural en español.`,
      { voice: id, onError: (m) => pushNotice(`⚠️ ${m}`, "warn") },
    );
  };

  const words = (text.match(/\S+/g) ?? []).length;
  const minutes = Math.max(1, Math.round(words / 150 / speed));
  const women = SPANISH_VOICES.filter((v) => v.gender === "mujer");
  const men = SPANISH_VOICES.filter((v) => v.gender === "hombre");

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
          PDF, texto, notas… El documento se lee en tu propio equipo, no se sube a ningún sitio.
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
          accept=".pdf,.txt,.md,.csv,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void load(file);
          }}
        />
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-semibold"><Volume2 className="mr-2 inline size-4 text-primary" />Elige la voz</p>
        <div className="grid gap-4 md:grid-cols-2">
          {[{ title: "Voces de mujer", list: women }, { title: "Voces de hombre", list: men }].map((group) => (
            <div key={group.title} className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{group.title}</p>
              {group.list.map((v) => (
                <div
                  key={v.id}
                  className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 transition ${
                    voice === v.id ? "border-primary bg-accent/40" : "border-border"
                  }`}
                >
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => pickVoice(v.id)}>
                    <p className="truncate text-sm font-semibold">{v.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{v.desc}</p>
                  </button>
                  <Button variant="ghost" size="sm" className="shrink-0 gap-1" onClick={() => preview(v.id)}>
                    <Play className="size-3.5" />Probar
                  </Button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-muted-foreground" htmlFor="velocidad">Velocidad</label>
          <input
            id="velocidad"
            type="range"
            min={0.7}
            max={1.4}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="h-1 w-40 accent-primary"
          />
          <span className="text-xs font-semibold">{speed.toFixed(2)}×</span>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Texto que se va a leer</p>
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
          <Button
            variant="secondary"
            className="gap-2"
            disabled={!text.trim()}
            onClick={() => { void navigator.clipboard.writeText(text); pushNotice("Texto copiado.", "success"); }}
          >
            <Copy className="size-4" />Copiar
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            disabled={!text.trim()}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `${(fileName || "documento").replace(/\.[^.]+$/, "")}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="size-4" />Descargar texto
          </Button>
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
              Leyendo el tramo {chunk.index} de {chunk.total} con la voz de {voiceById(voice).name}.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
