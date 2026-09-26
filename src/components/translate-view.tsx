// Traductor: pega un enlace (página web o vídeo de YouTube), un documento o un texto, pulsa «Traducir» y se traduce, fragmento a fragmento,
// mientras lo ves aparecer. Cada fragmento se comprueba y se reintenta si el modelo lo deja sin traducir.
// Si el origen es un vídeo de YouTube, debajo aparece el vídeo con la traducción leída en voz natural, sincronizada con el
// vídeo DE VERDAD (si lo pausas, la voz se pausa; si lo adelantas, salta), con la voz que elijas.

import { useEffect, useRef, useState } from "react";
import { Copy, Download, ExternalLink, FileText, Languages, Link2, Loader2, Pause as PauseIcon, Play, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadDraft, saveDraft, usePersistentState } from "@/lib/persistent-state";
import { pushNotice } from "@/lib/notifications";
import { useSettings } from "@/lib/workspace-store";
import { aiService } from "@/services/ai-service";
import { isChatModel } from "@/lib/local-ai";
import { runTask } from "@/services/orchestrator";
import { cloudChat, engineStatus } from "@/lib/engines-client";
import { looksSensitive } from "@/lib/auto-engine";
import { KIND_CLOUD_ORDER, usableInOrder } from "@/lib/routing-table";
import { extractAnyText } from "@/lib/pdf-text";
import { ensureNaturalVoice, speakBest, synthesizeSpeech } from "@/lib/natural-voice";
import type { SpeechHandle } from "@/lib/tts-voice";
import { useBackgroundReport } from "@/lib/background-tasks";
import { LANG_NAMES, cleanWebText, detectLanguage, splitForTranslation, translateChunks } from "@/lib/translate-flow";
import { PanelCard as Card } from "@/components/panel-card";
import { VOICE_KEY, VoiceSelect, setSharedVoice, useSharedVoice } from "@/components/voice-select";
import { SyncNarrator, browserClip } from "@/lib/narration-sync";
import { PLAYER_STATE, createYouTubePlayer, type YTPlayer } from "@/lib/youtube-player";
import { groupSegments, parseCaptions, videoIdOf } from "@/lib/youtube-captions";

const LANGS = [["Español de España", "es"], ["Inglés", "en"], ["Francés", "fr"], ["Alemán", "de"], ["Italiano", "it"], ["Portugués", "pt"], ["Catalán", "ca"], ["Gallego", "gl"], ["Euskera", "eu"], ["Chino", "zh"], ["Árabe", "ar"]] as const;
const isYouTube = (u: string) => /(?:youtube\.com|youtu\.be)\//i.test(u);
const SUBS_HINT = " Si tienes los subtítulos en un archivo .srt o .vtt, deja el enlace del vídeo arriba y súbelo con «O un documento»: se leerán sincronizados con el vídeo.";

type Segment = { start: number; text: string };
type Given = { text: string; title: string; videoId?: string; segments?: Segment[] };

/** Texto legible a partir de los trozos con tiempo (en párrafos de 8 frases). */
function segmentsText(segments: Segment[]): string {
  const lines = segments.map((s) => s.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const groups: string[] = [];
  for (let i = 0; i < lines.length; i += 8) groups.push(lines.slice(i, i + 8).join(" "));
  return groups.join("\n\n");
}

/** Página web o vídeo de YouTube → texto. Para YouTube también se devuelven los segmentos originales
 *  (con su tiempo real), para poder leer la traducción sincronizada con el vídeo. */
async function readLink(url: string): Promise<{ text: string; title: string; videoId?: string; segments?: Segment[] }> {
  if (isYouTube(url)) {
    const res = await fetch("/api/youtube", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const data = (await res.json().catch(() => ({}))) as { title?: string; videoId?: string; segments?: Segment[]; error?: string; code?: string };
    if (!res.ok || !data.segments?.length) {
      const hint = data.code === "sin-subtitulos" || data.code === "vacio" ? SUBS_HINT : "";
      throw new Error(`${data.error ?? "No he podido leer los subtítulos de ese vídeo."}${hint}`);
    }
    return { text: segmentsText(data.segments), title: data.title || url, ...(data.videoId ? { videoId: data.videoId } : {}), segments: data.segments };
  }
  const res = await fetch("/api/fetch-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  const data = (await res.json().catch(() => ({}))) as { text?: string; title?: string; error?: string };
  if (!res.ok || !data.text) throw new Error(data.error ?? "No he podido abrir esa página.");
  const text = cleanWebText(data.text);
  if (text.length < 200) throw new Error("Esa página casi no tiene texto que leer (puede cargarse con JavaScript o estar protegida). Copia el texto de la página y pégalo abajo.");
  return { text, title: data.title ?? url };
}

export function TranslateView() {
  const [settings] = useSettings();
  const [url, setUrl] = usePersistentState("traducir:direccion", "");
  const [source, setSource] = usePersistentState("traducir:texto", "");
  const [origin, setOrigin] = useState("");
  const [target, setTarget] = useState<string>(LANGS[0][0]);
  const [sourceLang, setSourceLang] = useState("");
  const [model, setModel] = useState("");
  const [out, setOut] = usePersistentState("traducir:traduccion", "");
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [detected, setDetected] = useState("");
  const [failed, setFailed] = useState(0);
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [available, setAvailable] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const speech = useRef<SpeechHandle | null>(null);
  const loadedUrl = useRef("");
  // La voz natural es la misma en todas las pestañas (se elige aquí, en el Chat, en Lectura…).
  const { voice: narrator } = useSharedVoice();
  // Traducir sigue en segundo plano si te vas a otra pestaña; te avisa arriba a la derecha cuando termina.
  useBackgroundReport({
    id: "traducir",
    title: "Traducción",
    view: "traducir",
    running,
    detail: progress.total ? `Traduciendo ${progress.done} de ${progress.total} partes…` : phase || "Traduciendo…",
  });

  // ------------------------------------------------------------ vídeo de YouTube + voz sincronizada
  const [videoId, setVideoId] = useState("");
  const [segLines, setSegLines] = useState<{ start: number; original: string; text: string }[]>([]);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [activeSeg, setActiveSeg] = useState(-1);
  const [videoSound, setVideoSound] = usePersistentState("traducir:sonido-video", "bajo");
  const [playerState, setPlayerState] = useState<"cargando" | "listo" | "sin-control">("cargando");
  const [playerNote, setPlayerNote] = useState("");
  const playerHost = useRef<HTMLDivElement | null>(null);
  const player = useRef<YTPlayer | null>(null);
  const clockMode = useRef(false);
  const clockStart = useRef(0);
  const narratorRef = useRef<SyncNarrator | null>(null);
  const tickTimer = useRef<number | null>(null);
  const savedVolume = useRef<{ volume: number; muted: boolean } | null>(null);
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const narrationToken = useRef(0);

  useEffect(() => {
    // Solo modelos que saben conversar: los de búsqueda (nomic-embed-text y similares) no traducen y darían error.
    void aiService.models(settings.endpoint).then((r) => { if (r.ok) setAvailable(r.data.map((m) => m.name).filter(isChatModel)); });
    return () => { speech.current?.stop(); abort.current?.abort(); stopVideoNarration(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.endpoint]);

  // Antes Traducir guardaba su voz aparte: si había una elegida y todavía no hay voz común, se conserva.
  useEffect(() => {
    const old = loadDraft<string>("traducir:voz");
    if (!old) return;
    try { if (!window.localStorage.getItem(VOICE_KEY)) setSharedVoice(old); } catch { /* sin almacenamiento */ }
    saveDraft("traducir:voz", "");
  }, []);

  // El reproductor de YouTube controlable (con plan B si no se puede controlar).
  useEffect(() => {
    if (!videoId || !playerHost.current) return;
    let cancelled = false;
    setPlayerState("cargando");
    setPlayerNote("");
    clockMode.current = false;
    void createYouTubePlayer(playerHost.current, videoId, {
      onState: (state) => { if (state === PLAYER_STATE.ENDED && narratorRef.current) stopVideoNarration(); },
      onError: (message) => {
        if (cancelled) return;
        clockMode.current = true;
        setPlayerState("sin-control");
        setPlayerNote(`${message} Ábrelo en YouTube con el enlace de abajo y pulsa «Reproducir con voz sincronizada» a la vez que le das al play allí.`);
      },
    }).then((result) => {
      if (cancelled) { if ("player" in result) { try { result.player.destroy(); } catch { /* ya no está */ } } return; }
      if ("player" in result) { player.current = result.player; setPlayerState((s) => (s === "sin-control" ? s : "listo")); }
      else {
        clockMode.current = true;
        setPlayerState("sin-control");
        setPlayerNote((n) => n || `${result.error} La voz seguirá su propio reloj: dale al play del vídeo a la vez que a «Reproducir con voz sincronizada».`);
      }
    });
    return () => {
      cancelled = true;
      stopVideoNarration();
      try { player.current?.destroy(); } catch { /* ya no está */ }
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  function stopVideoNarration() {
    narrationToken.current += 1;
    if (tickTimer.current) window.clearInterval(tickTimer.current);
    tickTimer.current = null;
    narratorRef.current?.stop();
    narratorRef.current = null;
    const p = player.current;
    if (p && savedVolume.current) {
      try {
        p.pauseVideo();
        p.setVolume(savedVolume.current.volume);
        if (savedVolume.current.muted) p.mute(); else p.unMute();
      } catch { /* el reproductor ya no está */ }
    }
    savedVolume.current = null;
    setVideoPlaying(false);
    setActiveSeg(-1);
  }

  /** Lee la traducción del vídeo en voz natural siguiendo el tiempo REAL del vídeo (pausa, adelanta y retrocede con él). */
  const playVideoNarration = async () => {
    if (!segLines.length) return;
    if (videoPlaying) return stopVideoNarration();
    const token = ++narrationToken.current;
    setVideoPlaying(true);
    const ready = await ensureNaturalVoice((m) => setPlayerNote(m));
    if (token !== narrationToken.current) return; // la paraste mientras se preparaba la voz
    if (!ready.ok) {
      setVideoPlaying(false);
      pushNotice(`⚠️ No hay ninguna voz natural disponible: ${ready.error}`, "warn");
      return;
    }
    setPlayerNote((n) => (clockMode.current ? n : ""));
    const lines = segLines.map((l) => ({ start: l.start, text: l.text }));
    const narration = new SyncNarrator(lines, {
      synth: (text, signal) => synthesizeSpeech(text, narrator, signal),
      clip: browserClip,
      onLine: (i) => {
        setActiveSeg(i);
        // Solo se mueve la lista de líneas (nunca la página entera mientras ves el vídeo).
        const el = lineRefs.current[i];
        const box = el?.parentElement;
        if (el && box) box.scrollTo?.({ top: Math.max(0, el.offsetTop - box.offsetTop - box.clientHeight / 3), behavior: "smooth" });
      },
      onError: (m) => pushNotice(`⚠️ La voz natural falló en una línea: ${m}`, "warn"),
      onEnd: () => { if (clockMode.current) stopVideoNarration(); },
    });
    narratorRef.current = narration;
    // 26/09/2026: antes el vídeo arrancaba al instante y la voz tardaba en sintetizarse, así que se oía hablar
    // al del vídeo unos segundos antes de que entrara la traducción (Antonio: «no es simultáneo… empieza a
    // hablar después del chico ya hablando»). Ahora se prepara el audio de la primera línea ANTES de arrancar
    // el vídeo, para que las dos cosas empiecen exactamente a la vez.
    setPlayerNote((n) => (clockMode.current ? n : "Preparando la voz…"));
    await narration.warmup(1);
    if (narration.isStopped || token !== narrationToken.current) return; // la paraste mientras se preparaba
    setPlayerNote((n) => (clockMode.current ? n : ""));
    const p = clockMode.current ? null : player.current;
    if (p) {
      try {
        savedVolume.current = { volume: p.getVolume(), muted: p.isMuted() };
        if (videoSound === "silenciado") p.mute();
        else if (videoSound === "bajo") { p.unMute(); p.setVolume(15); }
        p.playVideo();
      } catch { /* sigue con lo que se pueda */ }
    } else clockStart.current = Date.now();
    tickTimer.current = window.setInterval(() => {
      const n = narratorRef.current;
      if (!n) return;
      const live = clockMode.current ? null : player.current;
      if (!live) { n.tick((Date.now() - clockStart.current) / 1000, true); return; }
      let time = Number.NaN;
      let state: number = PLAYER_STATE.UNSTARTED;
      try { time = live.getCurrentTime(); state = live.getPlayerState(); } catch { /* reproductor no disponible */ }
      n.tick(time, state === PLAYER_STATE.PLAYING);
    }, 200);
  };

  /** Pulsar una línea lleva el vídeo a ese momento (y la voz la sigue). */
  const seekTo = (seconds: number) => {
    const p = clockMode.current ? null : player.current;
    if (!p) return;
    try { p.seekTo(seconds, true); } catch { /* reproductor no disponible */ }
  };

  const changeSound = (value: string) => {
    setVideoSound(value);
    const p = player.current;
    if (!p || !narratorRef.current || clockMode.current) return;
    try {
      if (value === "silenciado") p.mute();
      else { p.unMute(); p.setVolume(value === "bajo" ? 15 : savedVolume.current?.volume ?? 100); }
    } catch { /* reproductor no disponible */ }
  };

  /** Todo en un paso: abre el enlace (si hace falta), detecta el idioma, trocea y traduce mostrando el avance. */
  const run = async (given?: Given) => {
    if (running) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setOut("");
    setFailed(0);
    setProgress({ done: 0, total: 0 });
    stopVideoNarration();
    setVideoId("");
    setSegLines([]);
    setPlayerState("cargando");
    setPlayerNote("");
    try {
      let text = given?.text ?? source;
      let ytSegments: Segment[] | undefined;
      const link = url.trim();
      if (!given && link && (link !== loadedUrl.current || !text.trim())) {
        setPhase(isYouTube(link) ? "Leyendo los subtítulos del vídeo… (si YouTube pone pegas, WILLY prueba otras vías: puede tardar hasta un minuto)" : "Abriendo la página…");
        const page = await readLink(link);
        text = page.text;
        setSource(page.text);
        setOrigin(page.title);
        loadedUrl.current = link;
        if (page.videoId && page.segments?.length) { setVideoId(page.videoId); ytSegments = page.segments; }
      } else if (given) {
        setSource(given.text);
        setOrigin(given.title);
        if (given.videoId && given.segments?.length) { setVideoId(given.videoId); ytSegments = given.segments; }
      }
      if (!text.trim()) throw new Error("Pega un enlace, sube un documento o escribe el texto que quieres traducir.");
      const det = detectLanguage(text);
      setDetected(det.name);
      const targetCode = LANGS.find((l) => l[0] === target)?.[1] ?? "";
      if (!sourceLang && det.code && det.code === targetCode) {
        pushNotice(`El texto ya está en ${det.name}. Si no es así, elige el idioma de origen a mano.`, "info");
        setOut(text);
        // Un vídeo con subtítulos ya en tu idioma también se puede escuchar sincronizado, sin traducir nada.
        if (ytSegments) setSegLines(ytSegments.map((s) => ({ start: s.start, original: s.text, text: s.text })));
        return;
      }
      // Para un vídeo de YouTube, cada segmento con su tiempo real es su propio fragmento a traducir:
      // así la traducción se puede leer luego sincronizada con el vídeo, línea a línea.
      const chunks = ytSegments ? ytSegments.map((s) => s.text) : splitForTranslation(text, 1100);
      setProgress({ done: 0, total: chunks.length });
      // 26/09/2026: la IA externa (Gemini, Mistral…) traduce mejor que tu equipo; el modelo local a veces deja
      // fragmentos sin traducir o incompletos, y eso desincroniza la voz con el vídeo (si lo silencias, esas
      // líneas se quedan mudas). Se usa la IA externa primero si hay alguna encendida y con clave; si todas
      // fallan o están apagadas, sigue traduciendo con tu equipo como siempre, sin que tengas que hacer nada.
      const cloudStatus = await engineStatus();
      const cloudOrder: readonly string[] = KIND_CLOUD_ORDER["traduccion"] ?? [];
      const cloudIds = cloudStatus?.master && cloudStatus.mode !== "ahorro" ? usableInOrder(cloudOrder, cloudStatus.engines) : [];
      const cloudNames = new Map(cloudStatus?.engines.map((e) => [e.id, e.name]) ?? []);
      setPhase(cloudIds.length ? `Traduciendo con ${cloudNames.get(cloudIds[0]!) ?? cloudIds[0]}…` : "Traduciendo…");
      const done: string[] = [];
      const segsDone: { start: number; original: string; text: string }[] = ytSegments ? ytSegments.map((s) => ({ start: s.start, original: s.text, text: "" })) : [];
      const show = (partial: string) => setOut([...done, partial].filter(Boolean).join(ytSegments ? " " : "\n\n"));
      const sourceName = sourceLang || det.name;
      const result = await translateChunks({
        chunks,
        target,
        ...(sourceName ? { source: sourceName } : {}),
        ...(det.code && !sourceLang ? { sourceCode: det.code } : {}),
        signal: controller.signal,
        translate: async (prompt, _index, onDelta) => {
          // Lo que no debe salir de tu equipo (DNI/NIE, IBAN, tarjeta, claves…) se queda en tu equipo aunque haya IA externa.
          if (cloudIds.length && !looksSensitive(prompt)) {
            for (const id of cloudIds) {
              if (controller.signal.aborted) throw new Error("Cancelado.");
              const res = await cloudChat(id, [{ role: "user", content: prompt }], 3000);
              if (res.ok && res.data.trim()) return res.data;
            }
          }
          const res = await runTask({ endpoint: settings.endpoint, kind: "traduccion", ...(model ? { preferred: model } : {}), available, signal: controller.signal, prompt, onDelta });
          if (!res.ok) throw new Error(res.error);
          return res.data.text;
        },
        onProgress: (index, total, partial, finished) => {
          if (finished) {
            done.push(partial);
            if (segsDone[index]) segsDone[index] = { ...segsDone[index]!, text: partial };
            setProgress({ done: index + 1, total });
            show("");
          } else show(partial);
        },
      });
      setFailed(result.failed.length);
      if (ytSegments) setSegLines(segsDone);
      if (controller.signal.aborted) pushNotice("Traducción detenida.", "info");
      else if (result.failed.length) pushNotice(`Traducido, pero ${result.failed.length} fragmento(s) no se pudieron traducir: van marcados con ⚠. Prueba con otro modelo.`, "warn");
      else pushNotice(`Traducción terminada a ${target}.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se ha podido traducir.";
      pushNotice(`⚠️ ${message}`, "warn");
      setPhase(`⚠️ ${message}`);
    } finally {
      setRunning(false);
      abort.current = null;
      setPhase((p) => (p.startsWith("⚠️") ? p : ""));
    }
  };

  const loadFile = async (file: File) => {
    try {
      // Subtítulos (.srt/.vtt) con un enlace de YouTube arriba: se traducen y se leen sincronizados con ese vídeo.
      const linkId = videoIdOf(url.trim());
      if (/\.(srt|vtt)$/i.test(file.name) && linkId && isYouTube(url)) {
        setPhase("Leyendo el archivo de subtítulos…");
        const segments = groupSegments(parseCaptions(await file.text()));
        if (!segments.length) throw new Error("Ese archivo de subtítulos no tiene frases con tiempos.");
        loadedUrl.current = url.trim();
        await run({ text: segmentsText(segments), title: file.name, videoId: linkId, segments });
        return;
      }
      setPhase("Leyendo el documento…");
      const text = (await extractAnyText(file)).replace(/--- Página \d+ ---/g, "").trim();
      if (!text) throw new Error("Ese documento no tiene texto seleccionable. Pásalo por la pestaña OCR.");
      setUrl("");
      loadedUrl.current = "";
      await run({ text, title: file.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se ha podido leer ese archivo.";
      setPhase(`⚠️ ${message}`);
      pushNotice(`⚠️ ${message}`, "warn");
    }
  };

  const toggleSpeech = () => {
    if (speaking) { speech.current?.stop(); setSpeaking(false); return; }
    setSpeaking(true);
    speech.current = speakBest(out, {
      ...(narrator ? { naturalVoice: narrator } : {}),
      onPreparing: (m) => pushNotice(m, "info"),
      onEnd: () => setSpeaking(false),
      onError: (m) => { setSpeaking(false); pushNotice(`⚠️ ${m}`, "warn"); },
    });
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm font-semibold"><Link2 className="mr-2 inline size-4 text-primary" />Pega un enlace (página web o vídeo de YouTube) y pulsa Traducir</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
            placeholder="https://…"
            className="h-11 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
          {running ? (
            <Button variant="outline" className="shrink-0 gap-2" onClick={() => abort.current?.abort()}><Square className="size-4" />Detener</Button>
          ) : (
            <Button className="shrink-0 gap-2" onClick={() => void run()} disabled={!url.trim() && !source.trim()}><Play className="size-4" />Traducir</Button>
          )}
          <Button variant="outline" className="shrink-0 gap-2" onClick={() => fileRef.current?.click()} disabled={running}><FileText className="size-4" />O un documento</Button>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.csv,.json,.docx,.odt,.pptx,.xlsx,.epub,.html,.htm,.rtf,.srt,.vtt" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void loadFile(file); }} />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">De</span>
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 outline-none focus:border-primary" aria-label="Idioma de origen">
            <option value="">detectar solo</option>
            {Object.values(LANG_NAMES).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-muted-foreground">a</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 outline-none focus:border-primary" aria-label="Idioma de destino">
            {LANGS.map((l) => <option key={l[0]} value={l[0]}>{l[0]}</option>)}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="h-9 max-w-44 rounded-md border border-border bg-background px-2 outline-none focus:border-primary" aria-label="Modelo">
            <option value="">modelo: automático (recomendado)</option>
            {available.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {detected && <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground"><Languages className="mr-1 inline size-3" />Detectado: {detected}</span>}
          {origin && <span className="max-w-64 truncate text-muted-foreground">Origen: {origin}</span>}
        </div>
        {(running || phase) && (
          <div className="space-y-1">
            {running && progress.total > 0 && <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>}
            <p className="text-xs text-muted-foreground">{running && progress.total > 0 ? `Fragmento ${Math.min(progress.done + 1, progress.total)} de ${progress.total} (${pct} %)` : phase}{running && !progress.total && <Loader2 className="ml-2 inline size-3 animate-spin" />}</p>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <p className="text-sm font-semibold">Texto original</p>
          <textarea value={source} onChange={(e) => setSource(e.target.value)} placeholder="Aquí aparece el texto de la página, del vídeo o del documento. También puedes pegarlo tú." className="h-72 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary" />
          <p className="text-xs text-muted-foreground">{(source.match(/\S+/g) ?? []).length} palabras</p>
        </Card>
        <Card className="space-y-2">
          <p className="text-sm font-semibold">Traducción</p>
          <div className="h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm leading-relaxed">{out || <span className="text-muted-foreground">La traducción irá apareciendo aquí, fragmento a fragmento.</span>}</div>
          {failed > 0 && <p className="text-xs text-destructive">{failed} fragmento(s) sin traducir (marcados con ⚠). Elige otro modelo arriba y vuelve a pulsar Traducir.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={speaking ? "outline" : "secondary"} className="gap-2" onClick={toggleSpeech} disabled={!out.trim() || running}>{speaking ? <Square className="size-4" /> : <Volume2 className="size-4" />}{speaking ? "Parar" : "Escucharla"}</Button>
            <Button variant="outline" className="gap-2" disabled={!out.trim()} onClick={() => { void navigator.clipboard.writeText(out); pushNotice("Traducción copiada.", "success"); }}><Copy className="size-4" />Copiar</Button>
            <Button variant="ghost" className="gap-2" disabled={!out.trim()} onClick={() => { const u = URL.createObjectURL(new Blob([out], { type: "text/plain;charset=utf-8" })); const a = document.createElement("a"); a.href = u; a.download = "traduccion.txt"; a.click(); URL.revokeObjectURL(u); }}><Download className="size-4" />Descargar</Button>
            <VoiceSelect className="ml-auto" />
          </div>
        </Card>
      </div>

      {videoId && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Vídeo con la traducción leída en voz natural</p>
            <div className="flex flex-wrap items-center gap-2">
              {playerState !== "sin-control" && (
                <select value={videoSound} onChange={(e) => changeSound(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary" aria-label="Sonido original del vídeo">
                  <option value="bajo">Sonido del vídeo: bajo</option>
                  <option value="silenciado">Sonido del vídeo: silenciado</option>
                  <option value="normal">Sonido del vídeo: normal</option>
                </select>
              )}
              <Button size="sm" variant={videoPlaying ? "secondary" : "primary"} className="gap-2" disabled={!segLines.some((l) => l.text)} onClick={() => void playVideoNarration()}>
                {videoPlaying ? <PauseIcon className="size-4" /> : <Volume2 className="size-4" />}{videoPlaying ? "Parar la narración" : "Reproducir con voz sincronizada"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {playerState === "sin-control"
              ? playerNote
              : "Un solo botón pone el vídeo y la voz a la vez. La voz sigue al vídeo: si lo pausas, se pausa; si lo adelantas o retrocedes, salta a esa parte. Pulsa una línea para ir a ese momento."}
          </p>
          {playerNote && playerState !== "sin-control" && <p className="text-xs text-muted-foreground">{playerNote}</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="aspect-video w-full">
              {playerState === "sin-control" ? (
                <iframe
                  title={origin || "Vídeo de YouTube"}
                  src={`https://www.youtube.com/embed/${videoId}`}
                  className="size-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div ref={playerHost} className="size-full" data-testid="reproductor-youtube" />
              )}
            </div>
          </div>
          {playerState === "sin-control" && (
            <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer"><ExternalLink className="size-3" />Abrir el vídeo en YouTube</a>
          )}
          {segLines.length > 0 && (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {segLines.map((l, i) => (
                <p
                  key={`${l.start}-${i}`}
                  ref={(el) => { lineRefs.current[i] = el; }}
                  onClick={() => seekTo(l.start)}
                  title={playerState === "listo" ? "Ir a este momento del vídeo" : undefined}
                  className={`rounded-md px-2 py-1 text-sm ${playerState === "listo" ? "cursor-pointer hover:bg-accent" : ""} ${i === activeSeg ? "bg-primary/10 text-foreground" : "text-muted-foreground"}`}
                >
                  <span className="mr-2 text-xs">{Math.floor(l.start / 60)}:{String(Math.floor(l.start % 60)).padStart(2, "0")}</span>
                  {l.text || <Loader2 className="inline size-3 animate-spin" />}
                </p>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
