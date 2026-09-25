import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Download, KeyRound, Loader2, Mic, Play, Plus, Search, Sparkles, Square, Upload, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";
import { speakBest, voiceCall } from "@/lib/natural-voice";
import type { SpeechHandle } from "@/lib/tts-voice";

type NamedVoice = { id: string; gender: string; tone: string; top?: boolean };
/** Lo que /api/voces (status) cuenta de las voces más humanas (Gemini, Kokoro, ElevenLabs, Google Chirp 3 HD y Chatterbox). */
export type ExtraView = {
  active: string;
  /** Solo voces naturales: las básicas de Piper se borraron y no se vuelven a instalar solas. */
  onlyNatural?: boolean;
  gemini: { hasKey: boolean; last4: string; model: string; voices: NamedVoice[]; styles: Array<{ id: string; label: string }>; added: string[]; library: Array<{ id: string; label: string }>; style: string; custom: string; pace: "pausado" | "normal" | "agil" };
  kokoro: { ready: boolean; canInstall: boolean; mb: number; voices: Array<{ id: string; label: string }>; speed: number; sentencePause: number; gpu?: boolean; gpuNote?: string };
  eleven?: { hasKey: boolean; last4: string; models: Array<{ id: string; label: string }>; model: string; stability: number; similarity: number; style: number; speed: number; voices: Array<{ id: string; label: string }> };
  chirp?: { hasKey: boolean; last4: string; added: string[]; rate: number };
  chatterbox?: CbView;
};
type CbCfg = { exaggeration: number; cfgWeight: number; temperature: number };
type CbView = CbCfg & { ready: boolean; canInstall: boolean; needsKokoro: boolean; gb: number; downloadGb?: number; vramGb?: number; device: string; gpu: string; note: string; gpuError?: string; canRetryGpu?: boolean; hasOwn: boolean };
type LibVoice = { id: string; label: string; gender: string; accent: string; description: string };
type ElevenVoice = { id: string; name: string; category: string; accent: string; gender: string; spanish: boolean; spain: boolean };

const SAMPLE = "Hola, soy WILLY. Así sueno cuando te leo un texto: con calma, con pausas naturales y sin prisas. ¿Qué te parece?";
const select = "h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary";
const panel = "space-y-3 rounded-md border border-border bg-background p-3";
// Ajustes de lectura de Chatterbox (los consejos de sus autores: por defecto 0,5 / 0,5; para expresivo, menos «ritmo» y más emoción).
const CB_PRESETS: Array<{ id: string; label: string; cfg: CbCfg }> = [
  { id: "natural", label: "Natural (recomendado)", cfg: { exaggeration: 0.5, cfgWeight: 0.5, temperature: 0.8 } },
  { id: "tranquila", label: "Tranquila, de narrador", cfg: { exaggeration: 0.35, cfgWeight: 0.4, temperature: 0.7 } },
  { id: "expresiva", label: "Expresiva", cfg: { exaggeration: 0.8, cfgWeight: 0.3, temperature: 0.85 } },
];
const sameCb = (a: CbCfg, b: CbCfg) => Math.abs(a.exaggeration - b.exaggeration) < 0.001 && Math.abs(a.cfgWeight - b.cfgWeight) < 0.001 && Math.abs(a.temperature - b.temperature) < 0.001;
const decimal = (n: number) => String(n).replace(".", ",");
const READ_ALOUD = "Hola, soy yo. Estoy grabando mi voz para que WILLY pueda leer con ella. Esta mañana he ido a trabajar, a mediodía he comido con unos amigos y por la tarde he dado un paseo tranquilo. ¿Y tú qué tal? Espero que muy bien.";
const MAX_REC_S = 30;

function Slider({ id, label, min, max, step, value, onChange, show }: { id: string; label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; show: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="w-32 shrink-0 text-xs text-muted-foreground" htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-40 accent-primary" />
      <span className="text-xs text-muted-foreground">{show}</span>
    </div>
  );
}

/** Campo para pegar una clave: se envía solo a WILLY (este equipo) y nunca se vuelve a mostrar entera. */
function KeyBox({ provider, hasKey, last4, placeholder, hint, refresh }: { provider: "elevenlabs" | "google"; hasKey: boolean; last4: string; placeholder: string; hint: ReactNode; refresh: () => Promise<void> }) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(!hasKey);
  const [saving, setSaving] = useState(false);
  const save = async (key: string) => {
    setSaving(true);
    const res = await voiceCall({ action: "extra-key", provider, key });
    setSaving(false);
    if (!res.ok) { pushNotice(`⚠️ ${res.error}`, "warn"); return; }
    setValue("");
    setEditing(!key);
    pushNotice(key ? "Clave guardada en tu equipo." : "Clave borrada.", "success");
    await refresh();
  };
  if (hasKey && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <KeyRound className="size-3.5 text-primary" />
        <span className="text-muted-foreground">Clave guardada en tu equipo (…{last4}).</span>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(true)}>Cambiar</Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={saving} onClick={() => void save("")}>Borrar</Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <input type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="h-8 min-w-48 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary" />
        <Button type="button" size="sm" className="h-8 text-xs" disabled={!value.trim() || saving} onClick={() => void save(value.trim())}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : null}Guardar</Button>
        {hasKey && <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing(false)}>Cancelar</Button>}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Junta lo grabado, quita el silencio del principio y del final, iguala el volumen y lo guarda como WAV de 16 bits (mono). */
function trimmedWav(chunks: Float32Array[], rate: number): { bytes: Uint8Array; secs: number } | null {
  const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  let peak = 0;
  for (let i = 0; i < all.length; i++) peak = Math.max(peak, Math.abs(all[i] ?? 0));
  if (peak < 0.02) return null;
  const quiet = peak * 0.08;
  let first = 0;
  while (first < all.length && Math.abs(all[first] ?? 0) < quiet) first++;
  let last = all.length - 1;
  while (last > first && Math.abs(all[last] ?? 0) < quiet) last--;
  const margin = Math.round(rate * 0.25);
  const part = all.subarray(Math.max(0, first - margin), Math.min(all.length, last + margin));
  const gain = Math.min(4, 0.9 / peak);
  const bytes = new Uint8Array(44 + part.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (o: number, t: string) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
  tag(0, "RIFF"); view.setUint32(4, 36 + part.length * 2, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, part.length * 2, true);
  for (let i = 0; i < part.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, (part[i] ?? 0) * gain)) * 32767), true);
  return { bytes, secs: part.length / rate };
}

type Recording = { stream: MediaStream; ctx: AudioContext; src: MediaStreamAudioSourceNode; node: ScriptProcessorNode; chunks: Float32Array[]; tick: number };

/** Tu propia voz para Chatterbox: se graba aquí mismo (queda como WAV) o se sube un audio. Solo se guarda en tu equipo. */
function OwnVoice({ hasOwn, refresh }: { hasOwn: boolean; refresh: () => Promise<void> }) {
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string; secs: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const rec = useRef<Recording | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const release = (): Recording | null => {
    const r = rec.current;
    rec.current = null;
    if (!r) return null;
    window.clearInterval(r.tick);
    r.node.onaudioprocess = null;
    try { r.src.disconnect(); r.node.disconnect(); } catch { /* ya estaba desconectado */ }
    for (const t of r.stream.getTracks()) t.stop();
    void r.ctx.close().catch(() => undefined);
    return r;
  };
  useEffect(() => () => { release(); }, []);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);

  const stop = () => {
    const r = release();
    setRecording(false);
    if (!r) return;
    const wav = trimmedWav(r.chunks, r.ctx.sampleRate);
    if (!wav) { pushNotice("⚠️ No se ha oído nada. Revisa el micrófono y vuelve a grabar.", "warn"); return; }
    if (wav.secs < 6) pushNotice("⚠️ Es muy corta: para que se parezca a ti, graba al menos 10 segundos.", "warn");
    const blob = new Blob([wav.bytes as BlobPart], { type: "audio/wav" });
    setClip({ blob, url: URL.createObjectURL(blob), secs: wav.secs });
  };
  const start = async () => {
    setClip(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = (ev) => { chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0))); };
      src.connect(node);
      node.connect(ctx.destination);
      const t0 = Date.now();
      const tick = window.setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); setSecs(s); if (s >= MAX_REC_S) stop(); }, 250);
      rec.current = { stream, ctx, src, node, chunks, tick };
      setSecs(0);
      setRecording(true);
    } catch {
      pushNotice("⚠️ No pude usar el micrófono. Revisa que el navegador tenga permiso y que no lo esté usando otra aplicación.", "warn");
    }
  };
  const send = async (blob: Blob) => {
    if (!consent) { pushNotice("⚠️ Marca antes la casilla de permiso.", "warn"); return; }
    if (blob.size > 12 * 2 ** 20) { pushNotice("⚠️ El audio es demasiado grande (máximo 12 MB; bastan 10–20 segundos).", "warn"); return; }
    setSaving(true);
    const audio = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
    const res = audio ? await voiceCall({ action: "cb-own", consent: true, audio }) : { ok: false, data: {}, error: "No pude leer ese audio." };
    setSaving(false);
    if (!res.ok) { pushNotice(`⚠️ ${res.error}`, "warn"); return; }
    setClip(null);
    pushNotice("Tu voz está guardada en tu equipo. Ya puedes usar «Mi voz».", "success");
    await refresh();
  };

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <p className="text-xs font-semibold">{hasOwn ? "Cambiar «Mi voz»" : "Añadir mi voz (opcional)"}</p>
      <p className="text-xs leading-5 text-muted-foreground">Chatterbox imita la voz de una grabación de 10–20 segundos. En un sitio sin ruido, pulsa «Grabar» y lee con naturalidad, como si hablaras con alguien: «{READ_ALOUD}»</p>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5 accent-primary" checked={consent} onChange={(ev) => setConsent(ev.target.checked)} />
        <span>Es mi voz, o la de una persona que me ha dado permiso para usarla.</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {recording
          ? <Button type="button" size="sm" variant="outline" className="h-8 gap-1 border-destructive text-xs text-destructive" onClick={stop}><Square className="size-3.5" />Parar ({secs} s de {MAX_REC_S})</Button>
          : <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={!consent || saving} onClick={() => void start()}><Mic className="size-3.5" />Grabar</Button>}
        <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs" disabled={!consent || saving || recording} onClick={() => picker.current?.click()}><Upload className="size-3.5" />Subir un audio (WAV, FLAC, MP3 u OGG)</Button>
        <input ref={picker} type="file" accept=".wav,.flac,.mp3,.ogg,audio/wav,audio/x-wav,audio/flac,audio/mpeg,audio/ogg" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) void send(f); }} />
      </div>
      {clip && (
        <div className="flex flex-wrap items-center gap-2">
          <audio controls src={clip.url} className="h-8 max-w-full" />
          <span className="text-xs text-muted-foreground">{Math.round(clip.secs)} s</span>
          <Button type="button" size="sm" className="h-8 gap-1 text-xs" disabled={saving || !consent} onClick={() => void send(clip.blob)}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Usar esta grabación</Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={saving} onClick={() => setClip(null)}>Descartar</Button>
        </div>
      )}
    </div>
  );
}

/**
 * Voces más humanas: Gemini (Google, gratis con cupo, se puede «dirigir» con un estilo de lectura), Kokoro (local, sin internet),
 * ElevenLabs (calidad muy alta, tu clave) y Google Chirp 3 HD (voces HD de España, tu clave de Google Cloud). Lo que se elige
 * aquí vale para toda la aplicación, igual que las voces de Piper.
 */
export function MasVoces({ extra, voice, onVoice, busy, refresh }: { extra: ExtraView; voice: string; onVoice: (id: string) => void; busy: boolean; refresh: () => Promise<void> }) {
  const [allGemini, setAllGemini] = useState(false);
  const [allChirp, setAllChirp] = useState(false);
  const [library, setLibrary] = useState<LibVoice[] | null>(null);
  const [libraryNote, setLibraryNote] = useState("");
  const [searching, setSearching] = useState(false);
  const [testing, setTesting] = useState("");
  const [gem, setGem] = useState({ style: extra.gemini.style, custom: extra.gemini.custom, pace: extra.gemini.pace });
  const [kok, setKok] = useState({ speed: extra.kokoro.speed, sentencePause: extra.kokoro.sentencePause });
  const e = extra.eleven;
  const c = extra.chirp;
  const [ele, setEle] = useState({ model: e?.model ?? "eleven_multilingual_v2", stability: e?.stability ?? 0.45, similarity: e?.similarity ?? 0.8, style: e?.style ?? 0.25, speed: e?.speed ?? 1 });
  const [elevenList, setElevenList] = useState<ElevenVoice[] | null>(null);
  const [elevenBusy, setElevenBusy] = useState(false);
  const [credits, setCredits] = useState("");
  const [chirpRate, setChirpRate] = useState(c?.rate ?? 1);
  const [chirpNote, setChirpNote] = useState("");
  const cb = extra.chatterbox;
  // Con «solo voces naturales» Kokoro se borró: su panel solo reaparece si Chatterbox la necesita para instalarse.
  const showKokoro = !extra.onlyNatural || extra.kokoro.ready || !!cb?.needsKokoro;
  const [cbc, setCbc] = useState<CbCfg>({ exaggeration: cb?.exaggeration ?? 0.5, cfgWeight: cb?.cfgWeight ?? 0.5, temperature: cb?.temperature ?? 0.8 });
  const [cbRemoving, setCbRemoving] = useState(false);
  const sample = useRef<SpeechHandle | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { sample.current?.stop(); if (timer.current) window.clearTimeout(timer.current); }, []);

  const act = async (body: Record<string, unknown>) => {
    const res = await voiceCall(body);
    if (!res.ok) pushNotice(`⚠️ ${res.error}`, "warn");
    await refresh();
    return res;
  };
  const test = (id: string) => {
    sample.current?.stop();
    if (testing === id) { setTesting(""); return; }
    setTesting(id);
    sample.current = speakBest(SAMPLE, { naturalVoice: id, onEnd: () => setTesting(""), onError: (m) => { setTesting(""); pushNotice(`⚠️ ${m}`, "warn"); } });
  };
  const use = (id: string) => { onVoice(id); void act({ action: "set-voice", id }); };
  // Se guarda medio segundo después del último cambio, para no disparar una petición por cada tecla o píxel.
  const saveLater = (body: Record<string, unknown>) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void voiceCall(body).then((r) => { if (!r.ok) pushNotice(`⚠️ ${r.error}`, "warn"); }); }, 500);
  };
  const saveCfg = (cfg: Record<string, unknown>) => saveLater({ action: "extra-config", cfg });
  const searchLibrary = async () => {
    setSearching(true);
    setLibraryNote("");
    const res = await voiceCall({ action: "gemini-library" });
    setSearching(false);
    if (!res.ok) { setLibrary([]); setLibraryNote(res.error ?? "No se pudo consultar la biblioteca."); return; }
    const voices = (res.data?.voices ?? []) as LibVoice[];
    setLibrary(voices);
    if (!voices.length) setLibraryNote("Google no ofrece a tu clave voces de España en su biblioteca. Las 30 voces de arriba sí funcionan y hablan en español de España.");
  };
  const loadEleven = async () => {
    setElevenBusy(true);
    const res = await voiceCall({ action: "eleven-voices" });
    setElevenBusy(false);
    if (!res.ok) { pushNotice(`⚠️ ${res.error}`, "warn"); return; }
    setElevenList((res.data?.voices ?? []) as ElevenVoice[]);
  };
  const loadCredits = async () => {
    const res = await voiceCall({ action: "eleven-credits" });
    if (!res.ok) { pushNotice(`⚠️ ${res.error}`, "warn"); return; }
    const d = res.data as { used: number; limit: number; resetAt: number };
    setCredits(`Llevas ${d.used.toLocaleString("es-ES")} de ${d.limit.toLocaleString("es-ES")} créditos este mes${d.resetAt ? ` (se renuevan el ${new Date(d.resetAt).toLocaleDateString("es-ES")})` : ""}.`);
  };
  const checkChirp = async () => {
    setChirpNote("Comprobando…");
    const res = await voiceCall({ action: "chirp-check" });
    if (!res.ok) { setChirpNote(`⚠️ ${res.error ?? "No se pudo comprobar."}`); return; }
    const d = res.data as { total: number; chirp: number };
    setChirpNote(d.chirp ? `Clave correcta: Google te ofrece ${d.total} voces de España, ${d.chirp} de ellas Chirp 3 HD.` : `La clave funciona (${d.total} voces de España), pero Google no te muestra las Chirp 3 HD todavía.`);
  };

  const playButton = (id: string, disabled = false) => (
    <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={testing === id ? "Parar" : "Probar"} title={testing === id ? "Parar" : "Probar esta voz"} disabled={disabled} onClick={() => test(id)}>
      {testing === id ? <Square className="size-4" /> : <Play className="size-4" />}
    </Button>
  );
  const useButton = (id: string) => {
    const chosen = voice === id;
    return <Button type="button" size="sm" variant={chosen ? "secondary" : "outline"} className="h-8 gap-1 text-xs" onClick={() => use(id)}>{chosen ? <Check className="size-3.5" /> : null}{chosen ? "Elegida" : "Usar"}</Button>;
  };
  const removeButton = (body: Record<string, unknown>) => <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Quitar de mis voces" title="Quitar de mis voces" onClick={() => void act(body)}><X className="size-4" /></Button>;
  const addButton = (body: Record<string, unknown>, disabled = false) => <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={disabled} onClick={() => void act(body)}><Plus className="size-3.5" />Añadir</Button>;
  const row = (key: string, id: string, title: string, sub: string, actions: ReactNode) => (
    <div key={key} className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 ${voice === id ? "border-primary bg-accent/40" : "border-border"}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{sub}{voice === id ? " · en uso" : ""}</p>
      </div>
      <div className="flex shrink-0 gap-1">{actions}</div>
    </div>
  );
  // Rejilla de las 30 voces de Google (las mismas para Gemini y para Chirp 3 HD).
  const voiceGrid = (prefix: "gemini" | "chirp", added: string[], all: boolean, enabled: boolean) => (
    <div className="grid gap-2 md:grid-cols-2">
      {extra.gemini.voices.filter((v) => all || v.top || added.includes(v.id)).map((v) => {
        const id = `${prefix}:${v.id}`;
        return row(`${prefix}-${v.id}`, id, v.id, `${v.gender} · ${v.tone}`, (
          <>
            {playButton(id, !enabled)}
            {added.includes(v.id) ? <>{useButton(id)}{removeButton({ action: `${prefix}-remove`, id: v.id })}</> : addButton({ action: `${prefix}-add`, id: v.id }, !enabled)}
          </>
        ));
      })}
    </div>
  );

  const g = extra.gemini;
  return (
    <div className="space-y-4 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold"><Sparkles className="mr-2 inline size-4 text-primary" />Voces más humanas (recomendadas)</p>
        <p className="text-xs text-muted-foreground">Leen como una persona, no como un robot. Pulsa ▶ para escucharlas antes de elegir. Gemini, ElevenLabs y Google usan internet (gratis con límites); {showKokoro ? "Kokoro y Chatterbox funcionan" : "Chatterbox funciona"} sin internet. Antes de leer, WILLY quita los asteriscos, almohadillas, enlaces y demás símbolos para que no se lean en voz alta.</p>
      </div>

      {/* ---------------------------------------------------------------- Gemini */}
      <div className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Gemini (Google) · muy humana y se deja dirigir</p>
          <span className="text-xs text-muted-foreground">gratis con cupo diario · internet</span>
        </div>
        {g.hasKey
          ? <p className="text-xs text-muted-foreground">Usa tu clave de Gemini de Motores (…{g.last4}). El texto que lee se envía a Google. El cupo gratuito es pequeño y Google no publica la cifra: ideal para respuestas, textos cortos y vídeos; para documentos largos, mejor {showKokoro ? "Kokoro" : "Chatterbox"}.</p>
          : <p className="text-xs text-destructive">Falta tu clave de Gemini. Ponla en Motores (es la misma que WILLY usa para pensar) y estas voces aparecerán listas para usar.</p>}
        <div className="grid gap-2 md:grid-cols-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Cómo lee (estilo)</span>
            <select className={select} value={gem.style} onChange={(ev) => { const next = { ...gem, style: ev.target.value }; setGem(next); saveCfg({ gemini: next }); }}>
              {g.styles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              <option value="personal">Personalizado (lo escribo yo)</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Ritmo</span>
            <select className={select} value={gem.pace} onChange={(ev) => { const next = { ...gem, pace: ev.target.value as typeof gem.pace }; setGem(next); saveCfg({ gemini: next }); }}>
              <option value="pausado">Pausado, sin prisa</option>
              <option value="normal">Natural</option>
              <option value="agil">Ágil</option>
            </select>
          </label>
        </div>
        {gem.style === "personal" && (
          <textarea
            className="min-h-16 w-full rounded-md border border-border bg-background p-2 text-xs outline-none focus:border-primary"
            maxLength={400}
            value={gem.custom}
            placeholder="Ejemplo: Lee como un abuelo que cuenta un cuento a su nieto, con cariño, voz baja y muchas pausas."
            onChange={(ev) => { const next = { ...gem, custom: ev.target.value }; setGem(next); saveCfg({ gemini: next }); }}
          />
        )}
        {voiceGrid("gemini", g.added, allGemini, g.hasKey)}
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setAllGemini((v) => !v)}>
          {allGemini ? "Ver solo las recomendadas" : `Ver las ${g.voices.length} voces de Gemini`}
        </button>
        {!!g.library.length && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Tus voces de la biblioteca de Google</p>
            <div className="grid gap-2 md:grid-cols-2">
              {g.library.map((v) => row(`lib-${v.id}`, `gemini:lib:${v.id}`, v.label, "biblioteca · España", <>{playButton(`gemini:lib:${v.id}`)}{useButton(`gemini:lib:${v.id}`)}{removeButton({ action: "gemini-remove", id: `lib:${v.id}` })}</>))}
            </div>
          </div>
        )}
        <div className="space-y-2 border-t border-border pt-2">
          <Button type="button" size="sm" variant="outline" className="gap-2 text-xs" disabled={!g.hasKey || searching} onClick={() => void searchLibrary()}>
            {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}Buscar voces con acento de España en la biblioteca de Google
          </Button>
          {libraryNote && <p className="text-xs text-muted-foreground">{libraryNote}</p>}
          {!!library?.length && (
            <div className="grid gap-2 md:grid-cols-2">
              {library.filter((v) => !g.library.some((x) => x.id === v.id)).map((v) => row(`found-${v.id}`, `gemini:lib:${v.id}`, v.label, [v.gender, v.accent, v.description].filter(Boolean).join(" · "), (
                <>{playButton(`gemini:lib:${v.id}`)}{addButton({ action: "gemini-add", id: `lib:${v.id}`, label: v.label })}</>
              )))}
            </div>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- ElevenLabs */}
      {e && (
        <div className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">ElevenLabs · calidad muy alta</p>
            <span className="text-xs text-muted-foreground">gratis ≈ 10 min al mes · internet</span>
          </div>
          <KeyBox provider="elevenlabs" hasKey={e.hasKey} last4={e.last4} refresh={refresh} placeholder="Pega aquí tu clave de ElevenLabs (suele empezar por sk_)" hint={<>Créala gratis en elevenlabs.io → tu perfil → «API Keys» (con permiso de «Text to Speech» y «Voices»). Se guarda solo en tu equipo.</>} />
          {e.hasKey && (
            <>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span>Modelo</span>
                  <select className={select} value={ele.model} onChange={(ev) => { const next = { ...ele, model: ev.target.value }; setEle(next); saveLater({ action: "eleven-config", cfg: next }); }}>
                    {e.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                <div className="flex items-end gap-2 text-xs text-muted-foreground">
                  <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => void loadCredits()}>Ver mis créditos</Button>
                  {credits && <span>{credits}</span>}
                </div>
              </div>
              <Slider id="el-estabilidad" label="Estabilidad" min={0} max={1} step={0.05} value={ele.stability} onChange={(v) => { const next = { ...ele, stability: v }; setEle(next); saveLater({ action: "eleven-config", cfg: next }); }} show={ele.stability < 0.35 ? "más expresiva y variable" : ele.stability > 0.7 ? "muy estable (más plana)" : "equilibrada"} />
              <Slider id="el-parecido" label="Parecido a la voz" min={0} max={1} step={0.05} value={ele.similarity} onChange={(v) => { const next = { ...ele, similarity: v }; setEle(next); saveLater({ action: "eleven-config", cfg: next }); }} show={ele.similarity.toFixed(2)} />
              <Slider id="el-estilo" label="Estilo / emoción" min={0} max={1} step={0.05} value={ele.style} onChange={(v) => { const next = { ...ele, style: v }; setEle(next); saveLater({ action: "eleven-config", cfg: next }); }} show={ele.style < 0.15 ? "neutra" : ele.style > 0.6 ? "muy marcada" : "natural"} />
              <Slider id="el-velocidad" label="Velocidad" min={0.7} max={1.2} step={0.05} value={ele.speed} onChange={(v) => { const next = { ...ele, speed: v }; setEle(next); saveLater({ action: "eleven-config", cfg: next }); }} show={ele.speed < 0.9 ? "más lenta" : ele.speed > 1.1 ? "más rápida" : "natural"} />
              {!!e.voices.length && (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Tus voces de ElevenLabs en WILLY</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {e.voices.map((v) => row(`el-${v.id}`, `eleven:${v.id}`, v.label, "ElevenLabs", <>{playButton(`eleven:${v.id}`)}{useButton(`eleven:${v.id}`)}{removeButton({ action: "eleven-remove", id: v.id })}</>))}
                  </div>
                </div>
              )}
              <div className="space-y-2 border-t border-border pt-2">
                <Button type="button" size="sm" variant="outline" className="gap-2 text-xs" disabled={elevenBusy} onClick={() => void loadEleven()}>
                  {elevenBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}Cargar las voces de mi cuenta
                </Button>
                {elevenList && !elevenList.length && <p className="text-xs text-muted-foreground">Tu cuenta no tiene voces que se puedan usar desde WILLY.</p>}
                {!!elevenList?.length && (
                  <div className="grid gap-2 md:grid-cols-2">
                    {elevenList.filter((v) => !e.voices.some((x) => x.id === v.id)).map((v) => row(`elf-${v.id}`, `eleven:${v.id}`, v.name, [v.spain ? "España" : v.spanish ? "español" : "", v.accent, v.gender, v.category].filter(Boolean).join(" · "), (
                      <>{playButton(`eleven:${v.id}`)}{addButton({ action: "eleven-add", id: v.id, label: v.name })}</>
                    )))}
                  </div>
                )}
                <p className="text-xs leading-5 text-muted-foreground">Plan gratis: uso no comercial (si publicas el audio, cita a ElevenLabs) y las voces de su biblioteca no funcionan desde otras aplicaciones. Para acento de España, crea tu voz en elevenlabs.io → «Voice Design» (el plan gratis deja 3) y pulsa «Cargar las voces de mi cuenta».</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- Google Chirp 3 HD */}
      {c && (
        <div className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Google Chirp 3 HD · voces HD de España</p>
            <span className="text-xs text-muted-foreground">1 millón de caracteres gratis al mes · internet · pide facturación</span>
          </div>
          <KeyBox provider="google" hasKey={c.hasKey} last4={c.last4} refresh={refresh} placeholder="Pega aquí tu clave de Google Cloud (empieza por AIza)" hint={<>Es una clave de Google Cloud, distinta de la de Gemini. Se guarda solo en tu equipo.</>} />
          <details className="text-xs leading-5 text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">Cómo conseguir la clave (unos 5 minutos)</summary>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Entra en console.cloud.google.com y crea un proyecto (por ejemplo «willy-voz»).</li>
              <li>Activa la facturación del proyecto (menú Facturación → vincular una cuenta). Google la exige aunque no pases del millón de caracteres gratis al mes; si lo pasas, cobra unos 30 $ por cada millón más.</li>
              <li>Busca «Cloud Text-to-Speech API» y pulsa «Habilitar».</li>
              <li>Credenciales → Crear credenciales → Clave de API. Edítala y, en «Restricciones de API», deja solo «Cloud Text-to-Speech API».</li>
              <li>Pégala arriba, pulsa Guardar y después «Comprobar la clave».</li>
            </ol>
          </details>
          {c.hasKey && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => void checkChirp()}>Comprobar la clave</Button>
                {chirpNote && <span className="text-xs text-muted-foreground">{chirpNote}</span>}
              </div>
              <Slider id="chirp-velocidad" label="Velocidad" min={0.8} max={1.2} step={0.05} value={chirpRate} onChange={(v) => { setChirpRate(v); saveLater({ action: "chirp-config", cfg: { rate: v } }); }} show={chirpRate < 0.93 ? "más lenta" : chirpRate > 1.07 ? "más rápida" : "natural"} />
            </>
          )}
          {voiceGrid("chirp", c.added, allChirp, c.hasKey)}
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setAllChirp((v) => !v)}>
            {allChirp ? "Ver solo las recomendadas" : `Ver las ${g.voices.length} voces de Chirp 3 HD`}
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------------- Kokoro */}
      {showKokoro && <div className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Kokoro · local, sin internet</p>
          <span className="text-xs text-muted-foreground">gratis · ≈ {extra.kokoro.mb} MB</span>
        </div>
        {!extra.kokoro.ready ? (
          <div className="space-y-2 text-xs leading-5">
            <p>Todavía no está instalada. WILLY la instala sola en su propia carpeta (con un Python aparte: no toca el de tu equipo ni el de ComfyUI) y después funciona sin internet.</p>
            {extra.kokoro.canInstall
              ? <Button type="button" size="sm" className="gap-2" disabled={busy} onClick={() => void act({ action: "install-kokoro" })}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Instalar Kokoro</Button>
              : <p className="text-muted-foreground">La instalación automática es para Windows.</p>}
          </div>
        ) : (
          <>
            <div className="grid gap-2 md:grid-cols-2">
              {extra.kokoro.voices.map((v) => row(v.id, `kokoro:${v.id}`, v.label.replace(/^Kokoro · /, ""), "Kokoro · español de España", <>{playButton(`kokoro:${v.id}`)}{useButton(`kokoro:${v.id}`)}</>))}
            </div>
            <Slider id="kokoro-velocidad" label="Velocidad" min={0.8} max={1.2} step={0.05} value={kok.speed} onChange={(v) => { const next = { ...kok, speed: v }; setKok(next); saveCfg({ kokoro: next }); }} show={kok.speed <= 0.9 ? "más lenta" : kok.speed >= 1.1 ? "más rápida" : "natural"} />
            <Slider id="kokoro-pausas" label="Pausa entre frases" min={0.1} max={1} step={0.05} value={kok.sentencePause} onChange={(v) => { const next = { ...kok, sentencePause: v }; setKok(next); saveCfg({ kokoro: next }); }} show={`${kok.sentencePause.toFixed(2)} s`} />
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
              {extra.kokoro.gpu
                ? <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={busy} onClick={() => void act({ action: "kokoro-gpu", on: false })}>Volver al procesador</Button>
                : <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={busy} onClick={() => void act({ action: "kokoro-gpu", on: true })}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}Acelerar con la tarjeta gráfica</Button>}
              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} title="Vuelve a dejar Kokoro con el procesador y comprueba que habla" onClick={() => void act({ action: "kokoro-repair" })}>Reparar Kokoro</Button>
              <span className="text-xs text-muted-foreground">{extra.kokoro.gpuNote || "Mide si tu tarjeta gráfica hace que Kokoro empiece a leer antes. Si no mejora, se queda como está."}</span>
            </div>
          </>
        )}
      </div>}

      {/* ---------------------------------------------------------------- Chatterbox */}
      {cb && (
        <div className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Chatterbox · local y muy expresiva, sin internet</p>
            <span className="text-xs text-muted-foreground">gratis · ≈ {decimal(cb.gb)} GB · mejor con tarjeta NVIDIA</span>
          </div>
          {!cb.ready ? (
            <div className="space-y-2 text-xs leading-5">
              <p>Imita la voz y la entonación de una grabación: WILLY le da una voz de España (leída por Kokoro) o tu propia voz, y lee con más vida que Kokoro. Pesa mucho: descarga ≈ {decimal(cb.downloadGb ?? 6)} GB (PyTorch y el modelo) y la instalación tarda un buen rato. Con tu tarjeta NVIDIA va a buen ritmo (mientras habla usa ≈ {decimal(cb.vramGb ?? 4.5)} GB de ella); solo con el procesador, muy lento.</p>
              {cb.needsKokoro && <p className="text-destructive">Primero instala Kokoro (aquí arriba): Chatterbox usa su instalador y su voz de España.</p>}
              {cb.canInstall
                ? <Button type="button" size="sm" className="gap-2" disabled={busy || cb.needsKokoro} onClick={() => void act({ action: "cb-install" })}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Instalar Chatterbox</Button>
                : <p className="text-muted-foreground">La instalación automática es para Windows.</p>}
            </div>
          ) : (
            <>
              {cb.note && <p className="text-xs text-muted-foreground">{cb.note}</p>}
              {cb.device === "cpu" && cb.gpuError && <p className="text-xs text-destructive">La tarjeta gráfica no pudo con Chatterbox: {cb.gpuError}</p>}
              {cb.canRetryGpu && (
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={busy} onClick={() => void act({ action: "cb-gpu" })}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}Probar otra vez con la tarjeta gráfica</Button>
              )}
              <div className="grid gap-2 md:grid-cols-2">
                {row("cb-dora", "chatterbox:dora", "Mujer (España)", "Chatterbox · imita la voz de Dora", <>{playButton("chatterbox:dora")}{useButton("chatterbox:dora")}</>)}
                {row("cb-alex", "chatterbox:alex", "Hombre (España)", "Chatterbox · imita la voz de Alex", <>{playButton("chatterbox:alex")}{useButton("chatterbox:alex")}</>)}
                {cb.hasOwn && row("cb-propia", "chatterbox:propia", "Mi voz", "Chatterbox · tu grabación", <>{playButton("chatterbox:propia")}{useButton("chatterbox:propia")}{removeButton({ action: "cb-own-remove" })}</>)}
              </div>
              <p className="text-xs text-muted-foreground">{cb.device === "cuda"
                ? `La primera vez que habla tarda más: carga el modelo en la tarjeta gráfica, que necesita ≈ ${decimal(cb.vramGb ?? 4.5)} GB libres. Si no los hay, WILLY pide a ComfyUI que suelte los suyos y saca de la gráfica el modelo de Ollama (vuelve a cargarse solo cuando WILLY piensa). Tras 5 minutos sin hablar, Chatterbox se cierra y deja la gráfica libre.`
                : "La primera vez que habla tarda más: carga el modelo. Tras 5 minutos sin hablar se cierra solo para devolver la memoria."}</p>
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-xs text-muted-foreground">Cómo lee:</span>
                {CB_PRESETS.map((pr) => (
                  <Button key={pr.id} type="button" size="sm" variant={sameCb(cbc, pr.cfg) ? "secondary" : "outline"} className="h-7 text-xs" onClick={() => { setCbc(pr.cfg); saveLater({ action: "cb-config", cfg: pr.cfg }); }}>{pr.label}</Button>
                ))}
              </div>
              <Slider id="cb-emocion" label="Emoción" min={0.25} max={1.5} step={0.05} value={cbc.exaggeration} onChange={(v) => { const next = { ...cbc, exaggeration: v }; setCbc(next); saveLater({ action: "cb-config", cfg: next }); }} show={cbc.exaggeration < 0.4 ? "tranquila" : cbc.exaggeration > 0.8 ? "muy expresiva" : "natural"} />
              <Slider id="cb-ritmo" label="Ritmo" min={0.2} max={0.9} step={0.05} value={cbc.cfgWeight} onChange={(v) => { const next = { ...cbc, cfgWeight: v }; setCbc(next); saveLater({ action: "cb-config", cfg: next }); }} show={cbc.cfgWeight < 0.4 ? "más pausado" : cbc.cfgWeight > 0.65 ? "más ágil" : "natural"} />
              <Slider id="cb-variacion" label="Variación" min={0.5} max={1.2} step={0.05} value={cbc.temperature} onChange={(v) => { const next = { ...cbc, temperature: v }; setCbc(next); saveLater({ action: "cb-config", cfg: next }); }} show={cbc.temperature < 0.7 ? "más regular" : cbc.temperature > 0.95 ? "más variada" : "natural"} />
              <OwnVoice hasOwn={cb.hasOwn} refresh={refresh} />
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                <Button type="button" size="sm" variant="ghost" className={`h-8 text-xs ${cbRemoving ? "text-destructive" : ""}`} disabled={busy} onClick={() => {
                  if (!cbRemoving) { setCbRemoving(true); window.setTimeout(() => setCbRemoving(false), 6000); return; }
                  setCbRemoving(false);
                  void act({ action: "cb-remove" });
                }}>{cbRemoving ? "Pulsa otra vez para desinstalarlo" : `Desinstalar Chatterbox (libera ≈ ${decimal(cb.gb)} GB)`}</Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
