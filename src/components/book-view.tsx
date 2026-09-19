// Libros: crea un libro completo y profesional listo para publicar y cobrar.
// Incluye portada descargable, manuscrito en Markdown y versión imprimible (PDF).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Download, FileText, Image as ImageIcon, Loader2, Play, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";
import { useSettings } from "@/lib/workspace-store";
import { aiService } from "@/services/ai-service";
import { runTask } from "@/services/orchestrator";
import { speakText, type SpeechHandle } from "@/lib/tts-voice";
import {
  BOOK_ASK, BOOK_GENRES, BOOK_MUST, BOOK_TONES, bookBrief, bookHtml, emptyBook, type BookSpec,
} from "@/services/book-template";

const KEY = "willy-libro";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

const input = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary";

const COVERS = [
  { id: "noche", name: "Noche", bg: "#0b0d14", fg: "#f4f6ff", accent: "#6d8bff" },
  { id: "arena", name: "Arena", bg: "#efe6d6", fg: "#241d13", accent: "#b4714a" },
  { id: "bosque", name: "Bosque", bg: "#10241d", fg: "#eaf6ef", accent: "#5fc39a" },
  { id: "granate", name: "Granate", bg: "#3a0d1a", fg: "#fdeef1", accent: "#e0708d" },
  { id: "papel", name: "Papel", bg: "#ffffff", fg: "#12121a", accent: "#2f6df6" },
  { id: "eclipse", name: "Eclipse", bg: "#1b1030", fg: "#f2ecff", accent: "#b17bff" },
];

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(text: string) {
  return (text || "libro").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "libro";
}

export function BookView() {
  const [settings] = useSettings();
  const [spec, setSpec] = useState<BookSpec>(emptyBook);
  const [cover, setCover] = useState(COVERS[0]!.id);
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState("");
  const [extras, setExtras] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const speech = useRef<SpeechHandle | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { spec: BookSpec; text: string; cover: string; extras: string[] };
        setSpec({ ...emptyBook(), ...saved.spec });
        setText(saved.text ?? "");
        setCover(saved.cover ?? COVERS[0]!.id);
        setExtras(saved.extras ?? []);
      }
    } catch { /* sin guardado previo */ }
    void aiService.models(settings.endpoint).then((r) => { if (r.ok) setAvailable(r.data.map((m) => m.name)); });
    return () => speech.current?.stop();
  }, [settings.endpoint]);

  const persist = (next: Partial<{ spec: BookSpec; text: string; cover: string; extras: string[] }>) => {
    const data = { spec, text, cover, extras, ...next };
    window.localStorage.setItem(KEY, JSON.stringify(data));
  };

  const set = <K extends keyof BookSpec>(key: K, value: BookSpec[K]) => {
    const next = { ...spec, [key]: value };
    setSpec(next);
    persist({ spec: next });
  };

  /** Dibuja la portada en el lienzo con el estilo elegido. */
  const paint = () => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const theme = COVERS.find((t) => t.id === cover) ?? COVERS[0]!;
    const w = c.width, h = c.height;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 8;
    ctx.strokeRect(46, 46, w - 92, h - 92);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(46, h * 0.52, w - 92, 6);

    const wrap = (value: string, max: number, size: number) => {
      ctx.font = `bold ${size}px Georgia, serif`;
      const words = value.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > max && line) { lines.push(line); line = word; } else line = test;
      }
      if (line) lines.push(line);
      return lines;
    };

    ctx.textAlign = "center";
    ctx.fillStyle = theme.fg;
    const titleLines = wrap((spec.title || "Título del libro").toUpperCase(), w - 180, 78);
    titleLines.forEach((l, i) => ctx.fillText(l, w / 2, h * 0.34 + i * 92));

    if (spec.subtitle) {
      ctx.font = "italic 40px Georgia, serif";
      ctx.fillStyle = theme.accent;
      ctx.fillText(spec.subtitle, w / 2, h * 0.52 - 40);
    }
    ctx.font = "34px Georgia, serif";
    ctx.fillStyle = theme.fg;
    ctx.fillText((spec.author || "Nombre del autor").toUpperCase(), w / 2, h * 0.84);
  };

  useEffect(paint, [spec.title, spec.subtitle, spec.author, cover]);

  const downloadCover = () => {
    const c = canvas.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `portada-${slug(spec.title)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const toggleExtra = (item: string) => {
    const next = extras.includes(item) ? extras.filter((e) => e !== item) : [...extras, item];
    setExtras(next);
    persist({ extras: next });
  };

  const write = async () => {
    if (running) { abort.current?.abort(); return; }
    if (!spec.idea.trim() && !spec.title.trim()) {
      pushNotice("Escribe al menos el título o la idea del libro.", "warn");
      return;
    }
    setRunning(true);
    setText("");
    setStep("Preparando el libro…");
    const controller = new AbortController();
    abort.current = controller;
    const prompt = extras.length
      ? `${bookBrief(spec)}\n\nIncluye además:\n${extras.map((e) => `- ${e}`).join("\n")}`
      : bookBrief(spec);
    const res = await runTask({
      endpoint: settings.endpoint,
      kind: "escritura",
      preferred: settings.model,
      available,
      signal: controller.signal,
      prompt,
      onStep: (s) => setStep(typeof s === "string" ? s : `Escribiendo con ${(s as { model?: string }).model ?? "la IA"}…`),
      onDelta: (d) => setText((t) => t + d),
    });
    setRunning(false);
    abort.current = null;
    setStep("");
    if (!res.ok) {
      pushNotice(`⚠️ ${res.error}`, "warn");
      setText((t) => t || `⚠️ ${res.error}`);
      return;
    }
    setText(res.data.text);
    persist({ text: res.data.text });
    pushNotice("📚 Libro terminado. Ya puedes descargarlo y publicarlo.", "success");
  };

  const print = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(bookHtml(spec, text));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  const listen = () => {
    if (speaking) { speech.current?.stop(); setSpeaking(false); return; }
    setSpeaking(true);
    speech.current = speakText(text.slice(0, 6000), {
      voice: window.localStorage.getItem("willy-voz") ?? "Kore",
      onEnd: () => setSpeaking(false),
      onError: (m) => { setSpeaking(false); pushNotice(`⚠️ ${m}`, "warn"); },
    });
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm font-semibold"><BookOpen className="mr-2 inline size-4 text-primary" />Libro completo listo para publicar</p>
        <p className="text-xs text-muted-foreground">Rellena lo básico y la IA escribe el libro entero, con portada, créditos, índice, capítulos y ficha de venta.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Título"><input className={input} value={spec.title} onChange={(e) => set("title", e.target.value)} placeholder="El título de tu libro" /></Field>
            <Field label="Subtítulo"><input className={input} value={spec.subtitle} onChange={(e) => set("subtitle", e.target.value)} placeholder="Frase que lo explica" /></Field>
            <Field label="Autor"><input className={input} value={spec.author} onChange={(e) => set("author", e.target.value)} placeholder="Tu nombre" /></Field>
            <Field label="Género">
              <select className={input} value={spec.genre} onChange={(e) => set("genre", e.target.value)}>
                {BOOK_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Público"><input className={input} value={spec.audience} onChange={(e) => set("audience", e.target.value)} /></Field>
            <Field label="Tono">
              <select className={input} value={spec.tone} onChange={(e) => set("tone", e.target.value)}>
                {BOOK_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Capítulos"><input type="number" min={3} max={40} className={input} value={spec.chapters} onChange={(e) => set("chapters", Number(e.target.value) || 10)} /></Field>
            <Field label="Palabras por capítulo"><input type="number" min={500} max={6000} step={100} className={input} value={spec.wordsPerChapter} onChange={(e) => set("wordsPerChapter", Number(e.target.value) || 1800)} /></Field>
          </div>
          <Field label="Idea o tema del libro">
            <textarea
              className="min-h-24 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-primary"
              value={spec.idea}
              onChange={(e) => set("idea", e.target.value)}
              placeholder="De qué trata, qué quieres contar y qué debe llevarse el lector."
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button className="gap-2" onClick={write} disabled={false}>
              {running ? <Square className="size-4" /> : <Play className="size-4" />}
              {running ? "Parar" : "Escribir el libro"}
            </Button>
            {running && <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{step}</span>}
            {!running && words > 0 && <span className="text-xs text-muted-foreground">{words.toLocaleString("es-ES")} palabras escritas</span>}
          </div>
        </Card>

        <Card className="space-y-3">
          <p className="text-sm font-semibold"><ImageIcon className="mr-2 inline size-4 text-primary" />Portada</p>
          <canvas ref={canvas} width={1000} height={1500} className="mx-auto w-full max-w-56 rounded-lg border border-border" />
          <div className="flex flex-wrap gap-2">
            {COVERS.map((t) => (
              <button
                key={t.id}
                onClick={() => { setCover(t.id); persist({ cover: t.id }); }}
                className={`rounded-md border px-2.5 py-1 text-xs ${cover === t.id ? "border-primary text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                style={{ background: t.bg, color: t.fg }}
              >
                {t.name}
              </button>
            ))}
          </div>
          <Button variant="secondary" className="w-full gap-2" onClick={downloadCover}><Download className="size-4" />Descargar portada (PNG)</Button>
        </Card>
      </div>

      <Card className="space-y-3">
        <p className="text-sm font-semibold">Lo que llevará el libro como mínimo</p>
        <ul className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          {BOOK_MUST.map((m) => <li key={m}>• {m}</li>)}
        </ul>
        <p className="pt-1 text-sm font-semibold">Añadidos opcionales</p>
        <div className="flex flex-wrap gap-2">
          {BOOK_ASK.map((a) => (
            <button
              key={a}
              onClick={() => toggleExtra(a)}
              className={`rounded-full border px-3 py-1 text-xs ${extras.includes(a) ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {a}
            </button>
          ))}
        </div>
      </Card>

      {text && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold"><FileText className="mr-2 inline size-4 text-primary" />Manuscrito</p>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="gap-2" onClick={() => download(`${slug(spec.title)}.md`, text, "text/markdown")}><Download className="size-4" />Markdown</Button>
              <Button variant="secondary" size="sm" className="gap-2" onClick={() => download(`${slug(spec.title)}.html`, bookHtml(spec, text), "text/html")}><Download className="size-4" />HTML</Button>
              <Button variant="secondary" size="sm" className="gap-2" onClick={print}><FileText className="size-4" />Guardar como PDF</Button>
              <Button variant="secondary" size="sm" className="gap-2" onClick={listen}><Volume2 className="size-4" />{speaking ? "Parar" : "Escuchar"}</Button>
            </div>
          </div>
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm leading-relaxed text-foreground">{text}</pre>
        </Card>
      )}
    </div>
  );
}
