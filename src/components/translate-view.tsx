// Traductor: pega un enlace (o un documento, o texto) y la IA lo traduce.
// El resultado se puede escuchar con voz española natural.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Download, FileText, Globe, Link2, Loader2, Play, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";
import { useSettings } from "@/lib/workspace-store";
import { aiService } from "@/services/ai-service";
import { runTask } from "@/services/orchestrator";
import { extractAnyText } from "@/lib/pdf-text";
import { speakText, type SpeechHandle } from "@/lib/tts-voice";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}</div>;
}

const LANGS = ["Español de España", "Inglés", "Francés", "Alemán", "Italiano", "Portugués", "Catalán", "Gallego", "Euskera", "Chino", "Árabe"];

export function TranslateView() {
  const [settings] = useSettings();
  const [url, setUrl] = useState("");
  const [source, setSource] = useState("");
  const [origin, setOrigin] = useState("");
  const [target, setTarget] = useState(LANGS[0]!);
  const [out, setOut] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [available, setAvailable] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const speech = useRef<SpeechHandle | null>(null);

  useEffect(() => {
    void aiService.models(settings.endpoint).then((r) => { if (r.ok) setAvailable(r.data.map((m) => m.name)); });
    return () => speech.current?.stop();
  }, [settings.endpoint]);

  const loadUrl = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setOut("");
    try {
      const res = await fetch("/api/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json()) as { text?: string; title?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error ?? "No se ha podido leer la página.");
      setSource(data.text);
      setOrigin(data.title ?? url);
      pushNotice(`Página cargada: ${data.title ?? url}`, "success");
    } catch (err) {
      pushNotice(`⚠️ ${err instanceof Error ? err.message : "No se ha podido leer la página."}`, "warn");
    }
    setLoading(false);
  };

  const loadFile = async (file: File) => {
    setLoading(true);
    try {
      const text = await extractAnyText(file);
      setSource(text.replace(/--- Página \d+ ---/g, "").trim());
      setOrigin(file.name);
    } catch {
      pushNotice("No se ha podido leer ese archivo.", "warn");
    }
    setLoading(false);
  };

  const translate = async () => {
    if (!source.trim() || running) return;
    setRunning(true);
    setOut("");
    const controller = new AbortController();
    abort.current = controller;
    const res = await runTask({
      endpoint: settings.endpoint,
      kind: "traduccion",
      preferred: settings.model,
      available,
      signal: controller.signal,
      prompt:
        `Traduce el siguiente texto a ${target}. Traducción natural y fiel, respetando el formato, los títulos y las listas. ` +
        `No resumas, no añadas comentarios y no dejes nada sin traducir.\n\n"""\n${source.slice(0, 40000)}\n"""`,
      onDelta: (d) => setOut((o) => o + d),
    });
    setRunning(false);
    abort.current = null;
    if (!res.ok) {
      setOut(`⚠️ ${res.error}`);
      pushNotice(`⚠️ ${res.error}`, "warn");
      return;
    }
    setOut(res.data.text);
    pushNotice(`Traducción terminada a ${target}.`, "success");
  };

  const toggleSpeech = () => {
    if (speaking) {
      speech.current?.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speech.current = speakText(out, {
      voice: window.localStorage.getItem("willy-voz") ?? "Kore",
      onEnd: () => setSpeaking(false),
      onError: (m) => { setSpeaking(false); pushNotice(`⚠️ ${m}`, "warn"); },
    });
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm font-semibold"><Link2 className="mr-2 inline size-4 text-primary" />Pega el enlace que quieras traducir</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void loadUrl(); }}
            placeholder="https://…"
            className="h-11 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <Button className="gap-2 shrink-0" onClick={() => void loadUrl()} disabled={loading || !url.trim()}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
            {loading ? "Abriendo…" : "Cargar página"}
          </Button>
          <Button variant="outline" className="gap-2 shrink-0" onClick={() => fileRef.current?.click()} disabled={loading}>
            <FileText className="size-4" />O un documento
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.csv,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void loadFile(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Traducir a</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary"
            aria-label="Idioma de destino"
          >
            {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {running ? (
            <Button variant="outline" className="gap-2" onClick={() => { abort.current?.abort(); setRunning(false); }}>
              <Square className="size-4" />Detener
            </Button>
          ) : (
            <Button className="gap-2" onClick={() => void translate()} disabled={!source.trim()}>
              <Play className="size-4" />Traducir
            </Button>
          )}
          {origin && <span className="truncate text-xs text-muted-foreground">Origen: {origin}</span>}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <p className="text-sm font-semibold">Texto original</p>
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Aquí aparece el texto de la página o del documento. También puedes pegarlo tú."
            className="h-72 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary"
          />
          <p className="text-xs text-muted-foreground">{(source.match(/\S+/g) ?? []).length} palabras</p>
        </Card>

        <Card className="space-y-2">
          <p className="text-sm font-semibold">Traducción</p>
          <div className="h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm leading-relaxed">
            {out || <span className="text-muted-foreground">La traducción aparecerá aquí mientras se escribe.</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={speaking ? "outline" : "secondary"} className="gap-2" onClick={toggleSpeech} disabled={!out.trim()}>
              {speaking ? <Square className="size-4" /> : <Volume2 className="size-4" />}
              {speaking ? "Parar" : "Escucharla"}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              disabled={!out.trim()}
              onClick={() => { void navigator.clipboard.writeText(out); pushNotice("Traducción copiada.", "success"); }}
            >
              <Copy className="size-4" />Copiar
            </Button>
            <Button
              variant="ghost"
              className="gap-2"
              disabled={!out.trim()}
              onClick={() => {
                const url2 = URL.createObjectURL(new Blob([out], { type: "text/plain;charset=utf-8" }));
                const a = document.createElement("a");
                a.href = url2;
                a.download = "traduccion.txt";
                a.click();
                URL.revokeObjectURL(url2);
              }}
            >
              <Download className="size-4" />Descargar
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
