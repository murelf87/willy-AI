// Libros: la IA escribe el libro por capítulos (con la mejor IA disponible, en relevo), subes tu portada, ves la maqueta página a página
// tal y como se imprimirá y, cuando la aceptas, lo exportas (PDF para imprimir, EPUB, HTML, Markdown).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Check, ChevronLeft, ChevronRight, Download, FileText, Image as ImageIcon, Loader2, Maximize2, Play, RefreshCw, Square, Trash2, Upload, Volume2, X } from "lucide-react";
import { PanelCard as Card } from "@/components/panel-card";
import { Button } from "@/components/ui/button";
import { ClarifyButton } from "@/components/clarify-button";
import { pushNotice } from "@/lib/notifications";
import { useSettings } from "@/lib/workspace-store";
import { chatLocalStream, listLocalModels } from "@/lib/local-ai";
import { cloudChat, engineStatus } from "@/lib/engines-client";
import type { PublicStatus } from "@/lib/engines-server";
import { speakBest } from "@/lib/natural-voice";
import type { SpeechHandle } from "@/lib/tts-voice";
import { BOOK_ASK, BOOK_GENRES, BOOK_MUST, BOOK_TONES, emptyBook, type BookSpec } from "@/services/book-template";
import { bookSteps, emptyDoc, importManuscript, rewriteChapter, runBook, wordsOf, type BookDoc, type Progress, type RelayDeps } from "@/lib/book-engine";
import { DEFAULT_BACK, DEFAULT_LAYOUT, FONTS, TRIMS, backPage, bookCss, buildEpub, coverPage, coverSpreadHtml, fingerprint, fullDocument, layoutBook, layoutWarnings, pageHtml, type BackCover, type BookInput, type LayoutOptions, type Page } from "@/lib/book-layout";
import { makeDomFits } from "@/lib/book-dom";
import { delBlob, getBlob, putBlob } from "@/lib/blob-store";
import { checkImageFile, formatBytes, printQuality, readImageInfo, spineMm } from "@/lib/image-info";
import { VoiceSelect } from "@/components/voice-select";

const KEY = "willy-libro-2";
const OLD_KEY = "willy-libro";
const COVER_KEY = "willy-libro-portada";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs text-muted-foreground">{label}{children}</label>;
}
const input = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary";
const area = "w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-primary";

const COVERS = [
  { id: "noche", name: "Noche", bg: "#0b0d14", fg: "#f4f6ff", accent: "#6d8bff" },
  { id: "arena", name: "Arena", bg: "#efe6d6", fg: "#241d13", accent: "#b4714a" },
  { id: "bosque", name: "Bosque", bg: "#10241d", fg: "#eaf6ef", accent: "#5fc39a" },
  { id: "granate", name: "Granate", bg: "#3a0d1a", fg: "#fdeef1", accent: "#e0708d" },
  { id: "papel", name: "Papel", bg: "#ffffff", fg: "#12121a", accent: "#2f6df6" },
  { id: "eclipse", name: "Eclipse", bg: "#1b1030", fg: "#f2ecff", accent: "#b17bff" },
];

type Slot = "front" | "back" | "author";
type ImgMeta = { w: number; h: number; type: string; size: number; name: string };
type Saved = {
  spec: BookSpec; doc: BookDoc; extras: string[]; layout: LayoutOptions; pick: string;
  front: { dedication: string; ack: string; about: string };
  coverKind: "subida" | "generada"; theme: string;
  imgs: Partial<Record<Slot, ImgMeta>>; paper: "blanco" | "crema";
  back: { bio: string; quote: string; price: string; isbn: string; bgColor: string; overlay: number; barcode: boolean; useBgImage: boolean; usePhoto: boolean };
  accepted: { fp: string; at: string; pages: number } | null;
};
const initial = (): Saved => ({ spec: emptyBook(), doc: emptyDoc(), extras: [], layout: DEFAULT_LAYOUT, pick: "auto", front: { dedication: "", ack: "", about: "" }, coverKind: "generada", theme: COVERS[0]!.id, imgs: {}, paper: "blanco", back: { bio: "", quote: "", price: "", isbn: "", bgColor: "#111111", overlay: 0.45, barcode: true, useBgImage: true, usePhoto: true }, accepted: null });

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error("No pude leer la imagen.")); r.readAsDataURL(blob); });
}
/** En un HTML que se descarga, las imágenes tienen que ir dentro del archivo (las direcciones «blob:» solo valen en esta pestaña). */
async function inlineBlobUrls(html: string): Promise<string> {
  let out = html;
  for (const url of new Set(html.match(/blob:[^"')\s]+/g) ?? [])) out = out.split(url).join(await blobToDataUrl(await (await fetch(url)).blob()));
  return out;
}

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
const slug = (t: string) => (t || "libro").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "libro";

function ImageInfo({ slot, meta, mmW, mmH, onView, onDrop }: { slot: string; meta: ImgMeta | undefined; mmW: number; mmH: number; onView: () => void; onDrop: () => void }) {
  if (!meta) return null;
  const q = printQuality(meta.w, meta.h, mmW, mmH);
  return (
    <div className="space-y-1 rounded-md border border-border bg-background p-2 text-[11px] leading-4" data-slot={slot}>
      <p className="text-muted-foreground">{meta.w} × {meta.h} px · {formatBytes(meta.size)} · original sin tocar</p>
      <p className={q.level === "baja" ? "text-destructive" : q.level === "aceptable" ? "text-amber-600" : "text-emerald-600"}>{q.level === "ideal" ? "✓" : "⚠"} {q.text}</p>
      <div className="flex gap-1"><Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onView}><Maximize2 className="size-3" />Ver a tamaño real</Button><Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onDrop}><Trash2 className="size-3" />Quitar</Button></div>
    </div>
  );
}

export function BookView() {
  const [settings] = useSettings();
  const [S, setS] = useState<Saved>(initial);
  const [loaded, setLoaded] = useState(false);
  const [urls, setUrls] = useState<Partial<Record<Slot, string>>>({});
  const [viewer, setViewer] = useState<Slot | null>(null);
  const [viewScale, setViewScale] = useState(0);
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [locals, setLocals] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [engineNow, setEngineNow] = useState("");
  const [live, setLive] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [building, setBuilding] = useState(false);
  const [preview, setPreview] = useState<{ pages: Page[]; fp: string; cover: string | null; back: BackCover; opts: LayoutOptions } | null>(null);
  const [spread, setSpread] = useState(0);
  const [zoom, setZoom] = useState(0.7);
  const [speaking, setSpeaking] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const speech = useRef<SpeechHandle | null>(null);
  const fileRefs = { front: useRef<HTMLInputElement>(null), back: useRef<HTMLInputElement>(null), author: useRef<HTMLInputElement>(null) };
  const { spec, doc, layout } = S;
  const update = (patch: Partial<Saved>) => setS((s) => ({ ...s, ...patch }));
  const setSpec = <K extends keyof BookSpec>(key: K, value: BookSpec[K]) => setS((s) => ({ ...s, spec: { ...s.spec, [key]: value } }));

  // Carga (y migración del libro de la versión anterior)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setS({ ...initial(), ...(JSON.parse(raw) as Partial<Saved>) });
      else {
        const old = window.localStorage.getItem(OLD_KEY);
        if (old) {
          const o = JSON.parse(old) as { spec?: BookSpec; text?: string; cover?: string; extras?: string[] };
          const chapters = importManuscript(o.text ?? "");
          setS({ ...initial(), spec: { ...emptyBook(), ...(o.spec ?? {}) }, extras: o.extras ?? [], theme: o.cover ?? COVERS[0]!.id, doc: { ...emptyDoc(), chapters, outline: chapters.map((c) => ({ title: c.title, summary: "" })), engines: chapters.length ? ["importado"] : [] } });
        }
      }
    } catch { /* sin guardado previo */ }
    void (async () => {
      // Las fotos originales viven en IndexedDB. La portada de la versión anterior (guardada como texto) se pasa allí una sola vez.
      try {
        const legacy = window.localStorage.getItem(COVER_KEY);
        if (legacy && !(await getBlob("front"))) {
          const blob = await (await fetch(legacy)).blob();
          await putBlob("front", blob);
          const info = await readImageInfo(blob);
          setS((x) => ({ ...x, coverKind: "subida", imgs: { ...x.imgs, front: { w: info.w, h: info.h, type: blob.type, size: blob.size, name: "portada" } } }));
        }
        if (legacy) window.localStorage.removeItem(COVER_KEY);
      } catch { /* sin portada anterior */ }
      const next: Partial<Record<Slot, string>> = {};
      for (const slot of ["front", "back", "author"] as Slot[]) { const blob = await getBlob(slot); if (blob) next[slot] = URL.createObjectURL(blob); }
      setUrls((old) => { Object.values(old).forEach((u) => u && URL.revokeObjectURL(u)); return next; });
    })();
    setLoaded(true);
    void engineStatus().then(setStatus);
    void listLocalModels(settings.endpoint, { chatOnly: true }).then(setLocals).catch(() => setLocals([]));
    return () => { speech.current?.stop(); abort.current?.abort(); };
  }, [settings.endpoint]);
  useEffect(() => () => { Object.values(urls).forEach((u) => u && URL.revokeObjectURL(u)); }, []);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(S)); } catch { pushNotice("El libro es muy grande para guardarlo en el navegador: descárgalo para no perderlo.", "warn"); }
  }, [S, loaded]);

  const plan = useMemo(() => bookSteps(status, locals, S.pick), [status, locals, S.pick]);

  // Portada generada
  const paint = () => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const theme = COVERS.find((t) => t.id === S.theme) ?? COVERS[0]!;
    const w = c.width, h = c.height;
    ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 8; ctx.strokeRect(46, 46, w - 92, h - 92);
    ctx.fillStyle = theme.accent; ctx.fillRect(46, h * 0.52, w - 92, 6);
    const wrap = (value: string, max: number, size: number) => {
      ctx.font = `bold ${size}px Georgia, serif`;
      const lines: string[] = [];
      let line = "";
      for (const word of value.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > max && line) { lines.push(line); line = word; } else line = test;
      }
      if (line) lines.push(line);
      return lines;
    };
    ctx.textAlign = "center"; ctx.fillStyle = theme.fg;
    wrap((spec.title || "Título del libro").toUpperCase(), w - 180, 78).forEach((l, i) => ctx.fillText(l, w / 2, h * 0.34 + i * 92));
    if (spec.subtitle) { ctx.font = "italic 40px Georgia, serif"; ctx.fillStyle = theme.accent; ctx.fillText(spec.subtitle, w / 2, h * 0.52 - 40); }
    ctx.font = "34px Georgia, serif"; ctx.fillStyle = theme.fg;
    ctx.fillText((spec.author || "Nombre del autor").toUpperCase(), w / 2, h * 0.84);
  };
  useEffect(paint, [spec.title, spec.subtitle, spec.author, S.theme, S.coverKind]);
  const currentCover = (): string | null => (S.coverKind === "subida" && urls.front ? urls.front : canvas.current ? canvas.current.toDataURL("image/jpeg", 0.92) : null);

  /** Guarda la foto ORIGINAL (sin recomprimir ni reducir) y mide su calidad. */
  const putImage = async (slot: Slot, file: File) => {
    const problem = checkImageFile(file);
    if (problem) { pushNotice(`⚠️ ${problem}`, "warn"); return; }
    try {
      const info = await readImageInfo(file);
      if (!(await putBlob(slot, file))) pushNotice("El navegador no deja guardar imágenes grandes: se usará en esta sesión y no sobrevivirá a recargar la página.", "warn");
      const url = URL.createObjectURL(file);
      setUrls((u) => { if (u[slot]) URL.revokeObjectURL(u[slot]!); return { ...u, [slot]: url }; });
      setS((x) => ({ ...x, ...(slot === "front" ? { coverKind: "subida" as const } : {}), accepted: null, imgs: { ...x.imgs, [slot]: { w: info.w, h: info.h, type: file.type, size: file.size, name: file.name } } }));
      pushNotice(`Foto guardada tal cual: ${info.w} × ${info.h} px (${formatBytes(file.size)}).`, "success");
    } catch (error) { pushNotice(`⚠️ ${error instanceof Error ? error.message : "No pude leer la imagen."}`, "warn"); }
  };
  const dropImage = async (slot: Slot) => {
    await delBlob(slot);
    setUrls((u) => { if (u[slot]) URL.revokeObjectURL(u[slot]!); const { [slot]: _gone, ...rest } = u; return rest; });
    setS((x) => { const { [slot]: _g, ...imgs } = x.imgs; return { ...x, imgs, accepted: null, ...(slot === "front" ? { coverKind: "generada" as const } : {}) }; });
  };
  const trim = TRIMS[layout.trim];
  const backCover: BackCover = { ...DEFAULT_BACK, blurb: doc.blurb, bio: S.back.bio, quote: S.back.quote, price: S.back.price, isbn: S.back.isbn, bgColor: S.back.bgColor, overlay: S.back.overlay, barcode: S.back.barcode, bgImage: S.back.useBgImage ? urls.back ?? null : null, photo: S.back.usePhoto ? urls.author ?? null : null };
  const setBack = (patch: Partial<Saved["back"]>) => setS((x) => ({ ...x, back: { ...x.back, ...patch }, accepted: null }));

  // El libro como datos
  const bookInput: BookInput = useMemo(() => ({ title: spec.title, subtitle: spec.subtitle, author: spec.author, language: "es", year: new Date().getFullYear(), dedication: S.front.dedication, acknowledgements: S.front.ack, about: S.front.about, prologue: doc.prologue, epilogue: doc.epilogue, blurb: doc.blurb, chapters: doc.chapters.map((c) => ({ title: c.title, text: c.text })), authorPhoto: S.back.usePhoto && urls.author && S.imgs.author ? { url: urls.author, w: S.imgs.author.w, h: S.imgs.author.h } : null }), [spec, S.front, doc, S.back.usePhoto, urls.author, S.imgs.author]);
  const coverKey = S.coverKind === "subida" ? JSON.stringify(S.imgs.front ?? {}) : `${S.theme}|${spec.title}|${spec.subtitle}|${spec.author}`;
  const fp = useMemo(() => fingerprint({ bookInput: { ...bookInput, authorPhoto: bookInput.authorPhoto ? { w: bookInput.authorPhoto.w, h: bookInput.authorPhoto.h } : null }, layout, coverKey, kind: S.coverKind, back: S.back, imgs: S.imgs, blurb: doc.blurb }), [bookInput, layout, coverKey, S.coverKind, S.back, S.imgs, doc.blurb]);
  const accepted = S.accepted?.fp === fp && preview?.fp === fp;
  const totalWords = doc.chapters.reduce((n, c) => n + c.words, 0) + wordsOf(doc.prologue) + wordsOf(doc.epilogue);

  // Escribir
  const makeDeps = (signal: AbortSignal): RelayDeps => ({
    cloud: (id, messages, o) => cloudChat(id, messages, o.maxTokens, o.temperature),
    local: (model, messages, o) => chatLocalStream({ endpoint: settings.endpoint, model, messages, temperature: o.temperature, maxOutputTokens: o.maxTokens, numCtx: 8192, signal, ...(o.onDelta ? { onDelta: o.onDelta } : {}) }),
  });
  const specForRun = (): BookSpec => ({ ...spec, idea: S.extras.length ? `${spec.idea}\nAdemás incluye: ${S.extras.join("; ")}` : spec.idea });
  const write = async (fresh: boolean) => {
    if (running) { abort.current?.abort(); return; }
    if (!spec.idea.trim() && !spec.title.trim()) { pushNotice("Escribe al menos el título o la idea del libro.", "warn"); return; }
    if (!plan.steps.length) { pushNotice("No hay ninguna IA disponible para escribir. Arranca Ollama o activa un motor externo.", "warn"); return; }
    if (fresh && doc.chapters.length && !window.confirm("Esto borra el libro actual y empieza de cero. ¿Seguro?")) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setLive(""); setProgress(null); setPreview(null);
    for (const n of plan.notes) pushNotice(n, "info");
    const res = await runBook({ spec: specForRun(), doc: fresh ? emptyDoc() : doc, steps: plan.steps, deps: makeDeps(controller.signal), onDoc: (d) => update({ doc: d, accepted: null }), onProgress: setProgress, onDelta: (d) => setLive((t) => (t + d).slice(-1500)), onStep: setEngineNow, signal: controller.signal });
    setRunning(false); abort.current = null; setEngineNow(""); setLive("");
    if (res.ok) { update({ doc: res.doc }); pushNotice("📚 Libro escrito. Revisa la maqueta y acéptala para exportarlo.", "success"); }
    else pushNotice(`⚠️ ${res.error ?? "No se pudo terminar."} Lo escrito hasta ahora está guardado: pulsa «Continuar».`, "warn");
  };
  const redo = async (index: number) => {
    if (running) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setProgress({ phase: "capitulo", index: index + 1, total: spec.chapters, label: doc.outline[index]?.title ?? "" });
    const res = await rewriteChapter({ spec: specForRun(), doc, index, steps: plan.steps, deps: makeDeps(controller.signal), instruction: note, signal: controller.signal });
    setRunning(false); abort.current = null; setProgress(null);
    if (res.ok) { update({ doc: res.doc, accepted: null }); pushNotice(`Capítulo ${index + 1} reescrito.`, "success"); }
    else pushNotice(`⚠️ ${res.error}`, "warn");
  };
  const editChapter = (index: number, text: string) => update({ doc: { ...doc, chapters: doc.chapters.map((c, i) => (i === index ? { ...c, text, words: wordsOf(text), engine: c.engine.endsWith(" (editado)") ? c.engine : `${c.engine} (editado)` } : c)) }, accepted: null });

  // Maqueta
  const buildPreview = async () => {
    if (!doc.chapters.length) { pushNotice("Todavía no hay capítulos que maquetar.", "warn"); return; }
    setBuilding(true);
    await new Promise((r) => setTimeout(r, 40));
    const m = makeDomFits(layout);
    try {
      const res = layoutBook(bookInput, layout, m.fits);
      setPreview({ pages: res.pages, fp, cover: currentCover(), back: backCover, opts: layout });
      setSpread(0);
    } catch (error) { pushNotice(`⚠️ ${error instanceof Error ? error.message : "No se pudo maquetar."}`, "warn"); }
    finally { m.dispose(); setBuilding(false); }
  };
  const spreads = useMemo(() => {
    if (!preview) return [] as string[][];
    const pages = preview.pages.map(pageHtml);
    const out: string[][] = [];
    const cover = coverPage(preview.cover);
    if (cover) out.push([cover]);
    if (pages.length) out.push([pages[0]!]);
    for (let i = 1; i < pages.length; i += 2) out.push(pages.slice(i, i + 2));
    const back = backPage(preview.back);
    if (back) out.push([back]);
    return out;
  }, [preview]);
  const t = trim;
  const warnings = preview ? layoutWarnings(bookInput, preview.pages.length, !!preview.cover) : [];
  const accept = () => { if (preview?.fp !== fp) return; update({ accepted: { fp, at: new Date().toISOString(), pages: preview.pages.length } }); pushNotice("Maqueta aceptada. Ya puedes exportar el libro.", "success"); };

  // Exportar
  const printPdf = () => {
    if (!preview || !accepted) return;
    const win = window.open("", "_blank");
    if (!win) { pushNotice("El navegador bloqueó la ventana. Permite ventanas emergentes para esta página.", "warn"); return; }
    win.document.write(fullDocument(preview.pages, preview.opts, spec.title, preview.cover, preview.back));
    win.document.close(); win.focus();
    setTimeout(() => win.print(), 500);
  };
  const exportEpub = async () => {
    if (!accepted) return;
    const original = S.coverKind === "subida" ? await getBlob("front") : null;
    const cover = original ? { bytes: new Uint8Array(await original.arrayBuffer()), mime: original.type } : preview?.cover?.startsWith("data:") ? { bytes: Uint8Array.from(atob(preview.cover.split(",")[1] ?? ""), (c) => c.charCodeAt(0)), mime: "image/jpeg" } : null;
    const bytes = await buildEpub(bookInput, layout, cover, crypto.randomUUID(), new Date().toISOString());
    download(`${slug(spec.title)}.epub`, bytes as BlobPart, "application/epub+zip");
  };
  const manuscript = () => [`# ${spec.title}`, spec.subtitle && `*${spec.subtitle}*`, spec.author && `**${spec.author}**`, doc.prologue && `## Prólogo\n\n${doc.prologue}`, ...doc.chapters.map((c) => `## Capítulo ${c.n}. ${c.title}\n\n${c.text}`), doc.epilogue && `## Epílogo\n\n${doc.epilogue}`].filter(Boolean).join("\n\n");
  const listen = () => {
    if (speaking) { speech.current?.stop(); setSpeaking(false); return; }
    const first = doc.chapters[0]?.text ?? "";
    if (!first) return;
    setSpeaking(true);
    const naturalVoice = window.localStorage.getItem("willy-voz-natural") ?? "";
    speech.current = speakBest(first.slice(0, 6000), { ...(naturalVoice ? { naturalVoice } : {}), onPreparing: (m) => pushNotice(m, "info"), onEnd: () => setSpeaking(false), onError: (m) => { setSpeaking(false); pushNotice(`⚠️ ${m}`, "warn"); } });
  };
  const setLayout = (patch: Partial<LayoutOptions>) => update({ layout: { ...layout, ...patch } });
  const external = plan.steps.some((s) => s.kind === "cloud");
  const pct = progress && progress.total ? Math.round(((progress.phase === "capitulo" ? progress.index - 1 : progress.index) / progress.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm font-semibold"><BookOpen className="mr-2 inline size-4 text-primary" />Libro completo: escrito por capítulos, maquetado y listo para publicar</p>
        <p className="text-xs text-muted-foreground">La IA escribe el esquema y cada capítulo por separado (con la mejor IA disponible), tú subes tu portada, ves cómo queda cada página y, cuando lo aceptas, lo exportas.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Título"><input className={input} value={spec.title} onChange={(e) => setSpec("title", e.target.value)} placeholder="El título de tu libro" /></Field>
            <Field label="Subtítulo"><input className={input} value={spec.subtitle} onChange={(e) => setSpec("subtitle", e.target.value)} placeholder="Frase que lo explica" /></Field>
            <Field label="Autor"><input className={input} value={spec.author} onChange={(e) => setSpec("author", e.target.value)} placeholder="Tu nombre" /></Field>
            <Field label="Género"><select className={input} value={spec.genre} onChange={(e) => setSpec("genre", e.target.value)}>{BOOK_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
            <Field label="Público"><input className={input} value={spec.audience} onChange={(e) => setSpec("audience", e.target.value)} /></Field>
            <Field label="Tono"><select className={input} value={spec.tone} onChange={(e) => setSpec("tone", e.target.value)}>{BOOK_TONES.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
            <Field label="Capítulos"><input type="number" min={3} max={40} className={input} value={spec.chapters} onChange={(e) => setSpec("chapters", Math.min(40, Math.max(3, Number(e.target.value) || 10)))} /></Field>
            <Field label="Palabras por capítulo"><input type="number" min={500} max={6000} step={100} className={input} value={spec.wordsPerChapter} onChange={(e) => setSpec("wordsPerChapter", Number(e.target.value) || 1800)} /></Field>
          </div>
          <Field label="Idea o tema del libro">
            <textarea className={`${area} min-h-24`} value={spec.idea} onChange={(e) => setSpec("idea", e.target.value)} placeholder="De qué trata, qué quieres contar y qué debe llevarse el lector." />
            <div className="mt-2"><ClarifyButton context="libro" compact variant="secondary" label="Que la IA lo entienda exactamente" value={spec.idea} onApply={(text) => setSpec("idea", text)} /></div>
          </Field>
          <Field label="IA que escribe el libro">
            <select className={input} value={S.pick} onChange={(e) => update({ pick: e.target.value })}>
              <option value="auto">Automático: la mejor disponible (en relevo)</option>
              <option value="local">Solo este equipo (nada sale de tu ordenador)</option>
              {(status?.engines ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}{!e.hasKey ? " — sin clave" : !e.enabled ? " — apagado" : !status?.master ? " — motores externos desactivados" : !e.available ? " — no disponible" : ""}</option>)}
            </select>
          </Field>
          <p className="text-xs leading-5 text-muted-foreground">
            Orden de prueba: {plan.steps.length ? plan.steps.slice(0, 6).map((s) => s.label).join(" › ") : "ninguna IA disponible"}{plan.steps.length > 6 ? " …" : ""}. {plan.notes.join(" ")}
            {external && <b className="text-amber-600"> Con IA externa, el texto de tu libro sale de tu equipo hacia ese proveedor.</b>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button className="gap-2" onClick={() => void write(false)}>{running ? <Square className="size-4" /> : <Play className="size-4" />}{running ? "Parar" : doc.chapters.length ? "Continuar donde se quedó" : "Escribir el libro"}</Button>
            {!running && doc.chapters.length > 0 && <Button variant="outline" className="gap-2" onClick={() => void write(true)}><RefreshCw className="size-4" />Empezar de cero</Button>}
            {!running && totalWords > 0 && <span className="text-xs text-muted-foreground">{totalWords.toLocaleString("es-ES")} palabras · {doc.chapters.length}/{spec.chapters} capítulos</span>}
          </div>
          {(running || progress) && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">{running && <Loader2 className="size-3.5 animate-spin" />}{progress ? `${progress.phase === "capitulo" ? `Capítulo ${progress.index} de ${progress.total}: ` : ""}${progress.label}` : ""}{engineNow && ` · con ${engineNow}`}</p>
              {live && <p className="line-clamp-3 rounded-md bg-background p-2 text-[11px] leading-4 text-muted-foreground">{live}</p>}
            </div>
          )}
        </Card>

        <Card className="space-y-3">
          <p className="text-sm font-semibold"><ImageIcon className="mr-2 inline size-4 text-primary" />Portada</p>
          {S.coverKind === "subida" && urls.front
            ? <img src={urls.front} alt="Portada" className="mx-auto w-full max-w-56 rounded-lg border border-border" />
            : <canvas ref={canvas} width={1000} height={1500} className="mx-auto w-full max-w-56 rounded-lg border border-border" />}
          {S.coverKind === "subida" && <canvas ref={canvas} width={1000} height={1500} className="hidden" />}
          <input ref={fileRefs.front} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void putImage("front", f); }} />
          <Button className="w-full gap-2" onClick={() => fileRefs.front.current?.click()}><Upload className="size-4" />Subir mi portada (foto original)</Button>
          <ImageInfo slot="front" meta={S.imgs.front} mmW={trim.w} mmH={trim.h} onView={() => { setViewScale(0); setViewer("front"); }} onDrop={() => void dropImage("front")} />
          <div className="flex flex-wrap gap-2">
            {COVERS.map((c) => (
              <button key={c.id} onClick={() => update({ theme: c.id, coverKind: "generada" })} className={`rounded-md border px-2.5 py-1 text-xs ${S.coverKind === "generada" && S.theme === c.id ? "border-primary" : "border-border"}`} style={{ background: c.bg, color: c.fg }}>{c.name}</button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{S.coverKind === "subida" ? "Se usa tu foto tal cual la subiste (sin reducirla ni recomprimirla). Elige un color para volver a la generada." : "Se usa la portada generada. Sube la tuya si prefieres."}</p>
        </Card>
      </div>

      <Card className="space-y-3">
        <p className="text-sm font-semibold"><BookOpen className="mr-2 inline size-4 text-primary" />Cubierta completa: contraportada · lomo · portada</p>
        <style>{bookCss(layout)}</style>
        <div className="overflow-auto rounded-lg bg-secondary/60 p-4">
          <div className="mx-auto w-max" style={{ zoom: 0.42 }} dangerouslySetInnerHTML={{ __html: coverSpreadHtml({ front: S.coverKind === "subida" ? urls.front ?? null : null, back: backCover, spineMm: spineMm(preview?.pages.length ?? Math.max(24, Math.ceil(totalWords / 280) + 10), S.paper), title: spec.title, author: spec.author, opts: layout, frontBg: (COVERS.find((c) => c.id === S.theme) ?? COVERS[0]!).bg }) }} />
        </div>
        <p className="text-xs text-muted-foreground">Lomo orientativo de {spineMm(preview?.pages.length ?? Math.max(24, Math.ceil(totalWords / 280) + 10), S.paper)} mm ({preview ? `${preview.pages.length} páginas` : "estimado"}, papel {S.paper}). Confírmalo con la plantilla de tu imprenta.
          <select className="ml-2 rounded border border-border bg-background px-1 py-0.5" value={S.paper} onChange={(e) => update({ paper: e.target.value as Saved["paper"] })}><option value="blanco">papel blanco</option><option value="crema">papel crema</option></select></p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">Texto de la contraportada</p>
            <textarea className={`${area} min-h-28`} value={doc.blurb} onChange={(e) => update({ doc: { ...doc, blurb: e.target.value }, accepted: null })} placeholder="Sinopsis de venta (la IA la escribe con el libro; aquí la puedes cambiar)." />
            <Field label="Cita o frase destacada (opcional)"><input className={input} value={S.back.quote} onChange={(e) => setBack({ quote: e.target.value })} /></Field>
            <Field label="Biografía breve (opcional, solo lo que tú escribas)"><textarea className={`${area} min-h-16`} value={S.back.bio} onChange={(e) => setBack({ bio: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Precio (opcional)"><input className={input} value={S.back.price} onChange={(e) => setBack({ price: e.target.value })} placeholder="14,90 €" /></Field>
              <Field label="ISBN (opcional)"><input className={input} value={S.back.isbn} onChange={(e) => setBack({ isbn: e.target.value })} placeholder="978-…" /></Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={S.back.barcode} onChange={(e) => setBack({ barcode: e.target.checked })} />Dejar la zona del código de barras (51 × 30 mm)</label>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">Fondo de la contraportada</p>
            <div className="flex flex-wrap items-center gap-2">
              {COVERS.map((c) => <button key={c.id} onClick={() => setBack({ bgColor: c.bg })} className={`size-7 rounded-md border ${S.back.bgColor === c.bg ? "border-primary ring-2 ring-primary/40" : "border-border"}`} style={{ background: c.bg }} aria-label={c.name} />)}
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(S.back.bgColor) ? S.back.bgColor : "#111111"} onChange={(e) => setBack({ bgColor: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-border bg-background" aria-label="Otro color" />
            </div>
            <input ref={fileRefs.back} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void putImage("back", f); }} />
            <Button variant="secondary" size="sm" className="gap-2" onClick={() => fileRefs.back.current?.click()}><Upload className="size-4" />Foto de fondo (original)</Button>
            <ImageInfo slot="back" meta={S.imgs.back} mmW={trim.w} mmH={trim.h} onView={() => { setViewScale(0); setViewer("back"); }} onDrop={() => void dropImage("back")} />
            {S.imgs.back && <div className="space-y-1"><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={S.back.useBgImage} onChange={(e) => setBack({ useBgImage: e.target.checked })} />Usar la foto de fondo</label><label className="flex items-center gap-2 text-xs text-muted-foreground">Oscurecer para leer el texto<input type="range" min={0} max={0.85} step={0.05} value={S.back.overlay} onChange={(e) => setBack({ overlay: Number(e.target.value) })} /></label></div>}
            <p className="pt-2 text-xs font-semibold text-muted-foreground">Foto del autor</p>
            <input ref={fileRefs.author} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void putImage("author", f); }} />
            <Button variant="secondary" size="sm" className="gap-2" onClick={() => fileRefs.author.current?.click()}><Upload className="size-4" />Subir foto del autor (original)</Button>
            <ImageInfo slot="author" meta={S.imgs.author} mmW={22} mmH={22} onView={() => { setViewScale(0); setViewer("author"); }} onDrop={() => void dropImage("author")} />
            {S.imgs.author && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={S.back.usePhoto} onChange={(e) => setBack({ usePhoto: e.target.checked })} />Ponerla en la contraportada y en «Sobre el autor»</label>}
          </div>
        </div>
      </Card>

      {viewer && urls[viewer] && S.imgs[viewer] && (
        <div className="fixed inset-0 z-[150] flex flex-col bg-black/85 p-4" role="dialog" aria-label="Foto a tamaño real">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-white">
            <span className="font-semibold">{S.imgs[viewer]!.name} · {S.imgs[viewer]!.w} × {S.imgs[viewer]!.h} px · {formatBytes(S.imgs[viewer]!.size)}</span>
            <span className="ml-auto flex gap-1">
              {[["Ajustar", 0], ["25 %", 0.25], ["50 %", 0.5], ["100 % (real)", 1], ["200 %", 2]].map(([label, v]) => <Button key={String(label)} size="sm" variant={viewScale === v ? "secondary" : "outline"} className="h-7 text-xs" onClick={() => setViewScale(v as number)}>{label}</Button>)}
              <Button size="icon" variant="outline" className="size-7" onClick={() => setViewer(null)} aria-label="Cerrar"><X className="size-4" /></Button>
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-neutral-900 p-2">
            <img src={urls[viewer]} alt="" className="mx-auto block" style={viewScale ? { width: S.imgs[viewer]!.w * viewScale, maxWidth: "none", imageRendering: viewScale >= 2 ? "pixelated" : "auto" } : { maxWidth: "100%", maxHeight: "calc(100vh - 6rem)", objectFit: "contain" }} />
          </div>
        </div>
      )}

      <Card className="space-y-3">
        <p className="text-sm font-semibold">Páginas del autor (opcionales)</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Dedicatoria"><textarea className={`${area} min-h-16`} value={S.front.dedication} onChange={(e) => update({ front: { ...S.front, dedication: e.target.value } })} placeholder="Para…" /></Field>
          <Field label="Agradecimientos"><textarea className={`${area} min-h-16`} value={S.front.ack} onChange={(e) => update({ front: { ...S.front, ack: e.target.value } })} placeholder="Gracias a…" /></Field>
          <Field label="Sobre el autor (solo lo que tú escribas: la IA no lo inventa)"><textarea className={`${area} min-h-16`} value={S.front.about} onChange={(e) => update({ front: { ...S.front, about: e.target.value } })} placeholder="Quién eres, en pocas líneas." /></Field>
        </div>
        <p className="pt-1 text-xs font-semibold text-muted-foreground">Añadidos opcionales para la IA</p>
        <div className="flex flex-wrap gap-2">
          {BOOK_ASK.map((a) => <button key={a} onClick={() => update({ extras: S.extras.includes(a) ? S.extras.filter((x) => x !== a) : [...S.extras, a] })} className={`rounded-full border px-3 py-1 text-xs ${S.extras.includes(a) ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>{a}</button>)}
        </div>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Lo que llevará el libro como mínimo</summary><ul className="mt-1 grid gap-1 sm:grid-cols-2">{BOOK_MUST.map((m) => <li key={m}>• {m}</li>)}</ul></details>
      </Card>

      {doc.chapters.length > 0 && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold"><FileText className="mr-2 inline size-4 text-primary" />Capítulos</p>
            <input className="ml-auto h-8 w-64 rounded-md border border-border bg-background px-2 text-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Al rehacer, qué cambiar (opcional)" />
            <Button variant="secondary" size="sm" className="gap-2" onClick={listen}><Volume2 className="size-4" />{speaking ? "Parar" : "Escuchar el 1"}</Button>
            <VoiceSelect className="self-center" />
          </div>
          <ul className="space-y-2">
            {doc.chapters.map((c, i) => (
              <li key={c.n} className="rounded-lg border border-border bg-background p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Capítulo {c.n}. {c.title}</span>
                  <span className="text-muted-foreground">{c.words.toLocaleString("es-ES")} palabras · {c.engine}</span>
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(editing === i ? null : i)}>{editing === i ? "Cerrar" : "Editar"}</Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={running} onClick={() => void redo(i)}><RefreshCw className="size-3" />Rehacer</Button>
                  </span>
                </div>
                {editing === i && <textarea className={`${area} mt-2 h-64`} value={c.text} onChange={(e) => editChapter(i, e.target.value)} />}
              </li>
            ))}
          </ul>
          {(doc.prologue || doc.epilogue || doc.blurb) && <p className="text-xs text-muted-foreground">Además: {[doc.prologue && "prólogo", doc.epilogue && "epílogo", doc.blurb && "contraportada", doc.sheet && "ficha de publicación"].filter(Boolean).join(", ")}. Motores que intervinieron: {doc.engines.join(" · ") || "—"}.</p>}
        </Card>
      )}

      {doc.chapters.length > 0 && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold">Maquetación y vista previa</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Tamaño"><select className={input} value={layout.trim} onChange={(e) => setLayout({ trim: e.target.value as LayoutOptions["trim"] })}>{Object.entries(TRIMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            <Field label="Letra"><select className={input} value={layout.font} onChange={(e) => setLayout({ font: e.target.value as LayoutOptions["font"] })}>{Object.entries(FONTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            <Field label="Cuerpo (pt)"><input type="number" min={9} max={14} step={0.5} className={input} value={layout.sizePt} onChange={(e) => setLayout({ sizePt: Math.min(14, Math.max(9, Number(e.target.value) || 11)) })} /></Field>
            <Field label="Interlineado"><input type="number" min={1.2} max={1.9} step={0.05} className={input} value={layout.lineHeight} onChange={(e) => setLayout({ lineHeight: Math.min(1.9, Math.max(1.2, Number(e.target.value) || 1.45)) })} /></Field>
            <label className="flex items-end gap-2 pb-2 text-xs text-muted-foreground"><input type="checkbox" checked={layout.dropCap} onChange={(e) => setLayout({ dropCap: e.target.checked })} />Letra capital</label>
            <label className="flex items-end gap-2 pb-2 text-xs text-muted-foreground"><input type="checkbox" checked={layout.aiNote} onChange={(e) => setLayout({ aiNote: e.target.checked })} />Nota de IA en créditos</label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button className="gap-2" onClick={() => void buildPreview()} disabled={building || running}>{building ? <Loader2 className="size-4 animate-spin" /> : <BookOpen className="size-4" />}{preview ? "Volver a maquetar" : "Ver cómo quedará el libro"}</Button>
            {preview && preview.fp !== fp && <span className="text-xs text-amber-600">La vista previa está desactualizada: cambiaste algo. Vuelve a maquetar.</span>}
            {preview && <span className="text-xs text-muted-foreground">{preview.pages.length} páginas · {t.label}</span>}
          </div>
          {warnings.length > 0 && <ul className="space-y-0.5 text-xs text-amber-600">{warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
          {preview && spreads.length > 0 && (
            <div className="space-y-3">
              <style>{bookCss(preview.opts)}</style>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Button size="icon" variant="outline" className="size-8" disabled={spread === 0} onClick={() => setSpread(0)} aria-label="Primera">«</Button>
                <Button size="icon" variant="outline" className="size-8" disabled={spread === 0} onClick={() => setSpread((s) => Math.max(0, s - 1))} aria-label="Anterior"><ChevronLeft className="size-4" /></Button>
                <span className="tabular-nums text-muted-foreground">Vista {spread + 1} de {spreads.length}</span>
                <Button size="icon" variant="outline" className="size-8" disabled={spread >= spreads.length - 1} onClick={() => setSpread((s) => Math.min(spreads.length - 1, s + 1))} aria-label="Siguiente"><ChevronRight className="size-4" /></Button>
                <Button size="icon" variant="outline" className="size-8" disabled={spread >= spreads.length - 1} onClick={() => setSpread(spreads.length - 1)} aria-label="Última">»</Button>
                <label className="ml-auto flex items-center gap-2 text-muted-foreground">Zoom<input type="range" min={0.4} max={1.2} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
              </div>
              <div className="overflow-auto rounded-lg bg-secondary/60 p-4">
                <div className="mx-auto flex w-max items-start justify-center gap-1" style={{ zoom }}>
                  {spreads[Math.min(spread, spreads.length - 1)]!.map((html, i) => <div key={`${spread}-${i}`} className="shadow-lg" dangerouslySetInnerHTML={{ __html: html }} />)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3">
                {accepted
                  ? <p className="flex items-center gap-2 text-sm font-semibold text-emerald-600"><Check className="size-4" />Maqueta aceptada ({S.accepted?.pages} páginas). Si cambias algo, habrá que revisarla otra vez.</p>
                  : <p className="text-xs text-muted-foreground">Repasa las páginas. Si estás conforme, acepta la maqueta para poder exportar.</p>}
                {!accepted && <Button className="ml-auto gap-2" disabled={preview.fp !== fp} onClick={accept}><Check className="size-4" />Aceptar la maqueta</Button>}
              </div>
            </div>
          )}
        </Card>
      )}

      {doc.chapters.length > 0 && (
        <Card className="space-y-2">
          <p className="text-sm font-semibold">Exportar {accepted ? "" : "(disponible al aceptar la maqueta)"}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" className="gap-2" disabled={!accepted} onClick={printPdf}><FileText className="size-4" />PDF para imprimir</Button>
            <Button variant="secondary" size="sm" className="gap-2" disabled={!accepted} onClick={() => void exportEpub()}><Download className="size-4" />EPUB</Button>
            <Button variant="secondary" size="sm" className="gap-2" disabled={!accepted || !preview} onClick={() => { if (preview) void inlineBlobUrls(fullDocument(preview.pages, preview.opts, spec.title, preview.cover, preview.back)).then((html) => download(`${slug(spec.title)}.html`, html, "text/html")); }}><Download className="size-4" />HTML maquetado</Button>
            <Button variant="secondary" size="sm" className="gap-2" onClick={() => download(`${slug(spec.title)}.md`, manuscript(), "text/markdown")}><Download className="size-4" />Manuscrito (Markdown)</Button>
            {doc.sheet && <Button variant="outline" size="sm" className="gap-2" onClick={() => download(`ficha-de-publicacion-${slug(spec.title)}.md`, doc.sheet, "text/markdown")}><Download className="size-4" />Ficha de publicación</Button>}
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">PDF: en el diálogo de impresión elige «Guardar como PDF», márgenes «Ninguno», escala 100 % y desactiva «Encabezados y pies de página». Las plataformas como Amazon KDP piden declarar que el contenido está creado con IA al subirlo.</p>
        </Card>
      )}
    </div>
  );
}
