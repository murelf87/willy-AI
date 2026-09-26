// Estudio de vídeo de «Mi yo en IA», 100 % en tu equipo y gratis.
// ComfyUI anima tu foto con el movimiento de tu vídeo maestro (LivePortrait) y mueve los labios al ritmo de la voz (Wav2Lip…).
// La voz puede ser la de tu vídeo maestro, la de WILLY leyendo un texto (la voz natural elegida en Lectura → Voces más humanas;
// Piper solo si no hay ninguna) o un audio tuyo. Si un camino falla, se prueba el siguiente.
// Se pinta en dos pestañas de «Mi yo en IA»: «Crear vídeo» (4 pasos) y «Ajustes» (motores, voces, flujos e instalación). Las dos
// quedan montadas aunque no se vean, para que un vídeo en marcha no se pierda al cambiar de pestaña.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Download, FileAudio, Image as ImageIcon, Loader2, Mic, Play, RefreshCw, Settings2, Square, Trash2, Upload, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePersistentState } from "@/lib/persistent-state";
import { pushNotice } from "@/lib/notifications";
import { NATURAL_TIPS, ROLES, type Role } from "@/lib/avatar-engines";
import { openView, useBackgroundReport } from "@/lib/background-tasks";

/** Pestañas de «Mi yo en IA» (las usa también avatar-view). */
export type AvatarTab = "perfil" | "escribir" | "video" | "ajustes";
type VoiceMode = "video" | "texto" | "audio";
/** Una voz para elegir: una por persona (Sharvard sale dos veces, hombre y mujer, del mismo archivo). */
type VoiceChoice = { id: string; name: string; label?: string; path: string; speaker?: number };

type Flow = { id: string; name: string; role: Role; needs: { image: boolean; audio: boolean; video: boolean }; missing: string[]; warnings: string[]; hints: string[]; hasVideoOutput: boolean; checked: boolean; pausedMin: number };
type Status = {
  comfy: { running: boolean; version: string; gpu: string; vramGb: number; freeGb: number; error: string; url: string; families: Array<{ id: string; label: string; count: number }>; nodes: number };
  piper: { ok: boolean; message: string; mode: "exe" | "python"; exe: string; model: string; speaker?: number; voicesDir: string; voices: VoiceChoice[] };
  hf: { enabled: boolean; model: string; hasToken: boolean; last4: string };
  /** La voz natural que usará «Leer un texto» (Lectura → Voces más humanas). */
  natural?: { ok: boolean; label: string; onlyNatural: boolean; count: number };
  ffmpeg?: { ok: boolean; path: string };
  timeoutMin: number;
  flows: Flow[];
  plan: { pipelines: string[]; skipped: Array<{ flow: string; reason: string }> };
};
type JobView = { id: string; status: "voz" | "animando" | "listo" | "error" | "cancelado"; steps: string[]; attempts: Array<{ pipeline: string; ok: boolean; error: string }>; error: string; file: { name: string; mime: string; size: number } | null; seconds: number };
type ComfyInstallView = { id: string; status: "activo" | "listo" | "error"; pct: number; step: string; text: string; error: string; log: string[] };

const MB = 2 ** 20;
const LIMITS = { photo: 15 * MB, video: 80 * MB, audio: 40 * MB };
const RECOMMENDED_VOICE = /davefx-medium|sharvard-medium/i;

const VOICE_OPTIONS: Array<{ id: VoiceMode; title: string; desc: string; icon: ReactNode }> = [
  { id: "video", title: "La voz de mi vídeo maestro", desc: "Dice lo mismo que dices en el vídeo, con tu voz real.", icon: <Video className="size-4" /> },
  { id: "texto", title: "Leer un texto con la voz de WILLY", desc: "Escribes lo que debe decir y lo lee tu voz natural de WILLY (la de Lectura → Voces más humanas).", icon: <Mic className="size-4" /> },
  { id: "audio", title: "Un audio mío", desc: "Subes una grabación tuya (WAV, MP3, FLAC u OGG).", icon: <FileAudio className="size-4" /> },
];

async function call(body: Record<string, unknown>): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/avatar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `El servidor respondió ${res.status}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo hablar con WILLY." };
  }
}
const toDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("No pude leer el archivo.")); reader.readAsDataURL(file); });
const formatSize = (bytes: number): string => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const formatTime = (seconds: number): string => (seconds >= 60 ? `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s` : `${seconds} s`);
const voiceLabel = (file: string): string => file.split(/[\\/]/).pop()?.replace(/\.onnx$/i, "") ?? "";
const choiceName = (v: VoiceChoice): string => v.label || v.name;
/** La voz elegida dentro de la lista (mismo archivo y misma persona). */
const findChoice = (voices: VoiceChoice[], model: string, speaker = 0): VoiceChoice | undefined => voices.find((v) => v.path === model && (v.speaker ?? 0) === speaker);

/** Vista previa de un archivo elegido (se libera sola al cambiarlo). */
function useObjectUrl(file: File | null): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) { setUrl(""); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function Chip({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${ok === null ? "border-border text-muted-foreground" : ok ? "border-emerald-500/40 text-emerald-600" : "border-destructive/40 text-destructive"}`}>
      {ok === null ? null : ok ? <Check className="size-3" /> : <X className="size-3" />}{children}
    </span>
  );
}
function Field({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 text-xs ${className}`}>
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-4 text-muted-foreground">{hint}</span>}
    </label>
  );
}
const input = "rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary";
const box = "space-y-3 rounded-xl border border-border bg-card p-4";

/** Un paso numerado del asistente de vídeo. */
function Step({ n, title, desc, done, children }: { n: number; title: string; desc: string; done: boolean; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-500/15 text-emerald-600" : "bg-primary/15 text-primary"}`}>{done ? <Check className="size-4" /> : n}</span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs leading-5 text-muted-foreground">{desc}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Botón que abre el selector de archivos (el campo de archivo queda oculto). */
function FilePick({ accept, label, icon, onPick }: { accept: string; label: string; icon: ReactNode; onPick: (file: File) => void }) {
  return (
    <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-semibold transition hover:border-primary/50 hover:bg-accent">
      {icon}{label}
      <input type="file" accept={accept} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) onPick(file); }} />
    </label>
  );
}

function TextLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="font-semibold text-primary underline-offset-2 hover:underline">{children}</button>;
}

/**
 * Estudio de avatar natural, 100 % en tu equipo y gratis: ComfyUI (LivePortrait / MuseTalk / LatentSync / Wav2Lip…) para animar tu foto,
 * la voz que elijas (la del vídeo, la de WILLY o un audio tuyo) y motores locales. Si un motor falla, se pasa al siguiente.
 */
export function AvatarStudio({ tab, onTab, script, scriptNonce, savedPhoto }: { tab: AvatarTab; onTab: (tab: AvatarTab) => void; script: string; scriptNonce: number; savedPhoto: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState("");
  const [form, setForm] = useState({ comfyUrl: "http://127.0.0.1:8188", mode: "python" as "exe" | "python", exe: "python", model: "", speaker: 0, voicesDir: "", hfEnabled: false, hfModel: "", hfToken: "", timeoutMin: 25 });
  const [flowName, setFlowName] = useState("");
  const [flowRole, setFlowRole] = useState<Role>("labios");
  const [text, setText] = usePersistentState("avatar:estudio-texto", "");
  const [voiceMode, setVoiceMode] = usePersistentState<VoiceMode>("avatar:voz", "video");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<JobView | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [voiceUrl, setVoiceUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [comfyJob, setComfyJob] = useState<ComfyInstallView | null>(null);
  const [comfyStarting, setComfyStarting] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const loaded = useRef(false);
  const photoPreview = useObjectUrl(photoFile);
  const videoPreview = useObjectUrl(video);
  const audioPreview = useObjectUrl(audio);

  /** «Arrancar ComfyUI»: abre su lanzador y comprueba cada 10 s (hasta 3 minutos) si ya responde. */
  const startComfy = async () => {
    if (comfyStarting) return;
    setComfyStarting(true);
    try {
      const res = await call({ action: "comfy-start" });
      if (!res.ok) return pushNotice(`⚠️ ${res.error}`, "warn");
      if (!res.data.already) pushNotice("Arrancando ComfyUI en una ventana aparte (minimizada en la barra de tareas). Tarda 1–2 minutos: lo compruebo solo.", "info");
      for (let i = 0; i < 18; i += 1) {
        const st = await call({ action: "status", fresh: true });
        if (st.ok && st.data?.comfy?.running) {
          await refresh(true);
          return pushNotice("ComfyUI ya está en marcha.", "success");
        }
        await new Promise((r) => setTimeout(r, 10_000));
      }
      pushNotice("ComfyUI todavía no responde: mira su ventana en la barra de tareas por si enseña un error y pulsa «Comprobar».", "warn");
    } finally {
      setComfyStarting(false);
    }
  };

  const refresh = async (fresh = false) => {
    setLoading(true);
    const res = await call({ action: "status", fresh });
    setLoading(false);
    if (!res.ok) return setProblem(res.error);
    setProblem("");
    const s = res.data as Status;
    setStatus(s);
    if ((res.data as { comfyInstall?: ComfyInstallView | null }).comfyInstall) setComfyJob((res.data as { comfyInstall: ComfyInstallView }).comfyInstall);
    if (!loaded.current) {
      loaded.current = true;
      setForm({ comfyUrl: s.comfy.url, mode: s.piper.mode, exe: s.piper.exe, model: s.piper.model, speaker: s.piper.speaker ?? 0, voicesDir: s.piper.voicesDir, hfEnabled: s.hf.enabled, hfModel: s.hf.model, hfToken: "", timeoutMin: s.timeoutMin });
    }
  };
  // Se comprueba al abrir la página y cada vez que entras en «Crear vídeo» o «Ajustes» (por si has arrancado ComfyUI mientras tanto).
  useEffect(() => { if (!loaded.current || tab === "video" || tab === "ajustes") void refresh(); }, [tab]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  // «Usar en un vídeo» desde la pestaña «Escribir como tú»: el texto pasa aquí y la voz cambia a «Leer un texto».
  useEffect(() => {
    if (!scriptNonce || !script.trim()) return;
    setText(script.slice(0, 6000));
    setVoiceMode("texto");
  }, [scriptNonce]);

  // Mientras hay un vídeo en marcha, se pregunta cómo va.
  useEffect(() => {
    if (!job || !["voz", "animando"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      const res = await call({ action: "job", id: job.id });
      if (res.ok) setJob(res.data.job as JobView);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (job?.status !== "listo") return;
    void (async () => {
      const res = await fetch("/api/avatar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "job-file", id: job.id }) });
      if (!res.ok) return setProblem("No pude recoger el vídeo terminado.");
      const blob = await res.blob();
      setResult({ url: URL.createObjectURL(blob), name: job.file?.name ?? "avatar-IA.mp4" });
      pushNotice("Vídeo del avatar listo.", "success");
    })();
  }, [job?.status, job?.id]);

  const save = async () => {
    const res = await call({ action: "settings", settings: { comfyUrl: form.comfyUrl, timeoutMin: form.timeoutMin, piper: { mode: form.mode, exe: form.exe, model: form.model, speaker: form.speaker, voicesDir: form.voicesDir }, hf: { enabled: form.hfEnabled, model: form.hfModel, ...(form.hfToken ? { token: form.hfToken } : {}) } } });
    if (!res.ok) return pushNotice(`⚠️ ${res.error}`, "warn");
    setForm((f) => ({ ...f, hfToken: "" }));
    pushNotice("Ajustes guardados.", "success");
    void refresh(true);
  };
  /** Elegir la voz de WILLY se guarda al momento (solo cambia la voz; el resto de ajustes se queda como está). */
  const chooseVoice = async (id: string) => {
    const choice = (status?.piper.voices ?? []).find((v) => v.id === id);
    const model = choice?.path ?? "";
    const speaker = choice?.speaker ?? 0;
    setForm((f) => ({ ...f, model, speaker }));
    setVoiceUrl("");
    const res = await call({ action: "settings", settings: { piper: { model, speaker } } });
    if (!res.ok) return pushNotice(`⚠️ ${res.error}`, "warn");
    pushNotice(choice ? `Voz elegida: ${choiceName(choice)}.` : "Voz quitada.", "success");
    void refresh();
  };
  const addFlow = async (file: File) => {
    const res = await call({ action: "flow-add", name: flowName || file.name.replace(/\.json$/i, ""), role: flowRole, json: await file.text() });
    if (!res.ok) return pushNotice(`⚠️ ${res.error}`, "warn");
    setFlowName("");
    pushNotice(`Flujo añadido (${ROLES[res.data.role as Role].label}).`, "success");
    void refresh(true);
  };
  const flowAction = async (body: Record<string, unknown>) => { const res = await call(body); if (!res.ok) pushNotice(`⚠️ ${res.error}`, "warn"); void refresh(); };
  const installComfyNow = async () => {
    const res = await call({ action: "comfy-install" });
    if (!res.ok) return pushNotice(`⚠️ ${res.error}`, "warn");
    setComfyJob(res.data.job as ComfyInstallView);
    pushNotice("Instalando ComfyUI y los nodos de avatar automáticamente…", "success");
  };
  // Mientras se instala ComfyUI, se pregunta cómo va.
  useEffect(() => {
    if (!comfyJob || comfyJob.status !== "activo") return;
    const timer = window.setInterval(async () => {
      const res = await call({ action: "comfy-install-status" });
      if (res.ok && res.data.job) setComfyJob(res.data.job as ComfyInstallView);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [comfyJob?.id, comfyJob?.status]);
  useEffect(() => { if (comfyJob?.status === "listo") { pushNotice("ComfyUI y los nodos de avatar están instalados.", "success"); void refresh(true); } }, [comfyJob?.status]);
  const testVoice = async () => {
    setVoiceUrl("");
    setTesting(true);
    const res = await call({ action: "voice-test", text: text.slice(0, 300) || undefined });
    setTesting(false);
    if (!res.ok) return pushNotice(`⚠️ ${res.error}`, "warn");
    setVoiceUrl(`data:${res.data.mime ?? "audio/wav"};base64,${res.data.audio}`);
    pushNotice(`Voz generada con ${res.data.engine}.`, "success");
  };

  const mode: VoiceMode = voiceMode === "texto" || voiceMode === "audio" ? voiceMode : "video";
  const busy = !!job && ["voz", "animando"].includes(job.status);
  // El vídeo (y la instalación de ComfyUI) siguen en segundo plano si cambias de pestaña; te avisa al terminar.
  useBackgroundReport({
    id: "avatar-video",
    title: "Vídeo del avatar",
    view: "avatar",
    running: busy,
    detail: job?.status === "voz" ? "Preparando la voz…" : "Animando la cara…",
    ...(job?.status === "error" && job.error ? { error: job.error } : {}),
  });
  useBackgroundReport({
    id: "comfy-instalacion",
    title: "Instalando ComfyUI",
    view: "avatar",
    running: comfyJob?.status === "activo",
    detail: comfyJob ? `${comfyJob.step}: ${comfyJob.pct}%` : "Instalando…",
    ...(comfyJob?.status === "error" && comfyJob.error ? { error: comfyJob.error } : {}),
  });

  // ------------------------------------------------------------------ qué falta para poder crear el vídeo
  const photoSrc = photoPreview || savedPhoto;
  const readyFlows = (status?.flows ?? []).filter((f) => f.checked && f.missing.length === 0 && f.hasVideoOutput);
  // Si ningún flujo listo sabe trabajar solo con la foto, el vídeo maestro es obligatorio (da el movimiento).
  const canWithoutMaster = readyFlows.some((f) => f.needs.image && f.needs.audio && (f.role === "todo" || f.role === "labios"));
  const needsMaster = readyFlows.length > 0 && !canWithoutMaster;
  const ffmpegOk = status?.ffmpeg?.ok ?? true;
  const naturalOk = !!status?.natural?.ok;
  const voiceReady = !!status && (naturalOk || status.piper.ok || status.hf.enabled);
  const hasF5 = !!status?.comfy.families.some((f) => f.id === "f5tts");
  const voiceStepDone = mode === "video" ? !!video && ffmpegOk : mode === "texto" ? !!text.trim() && voiceReady : !!audio;
  const blockers: string[] = [];
  if (!status) blockers.push(loading ? "terminar de comprobar los motores" : "comprobar los motores (botón «Comprobar»)");
  else if (!status.comfy.running) blockers.push("arrancar ComfyUI");
  else if (!status.plan.pipelines.length) blockers.push("un flujo de animación listo (Ajustes → Flujos)");
  if (!photoSrc) blockers.push("tu foto (paso 1)");
  if (photoFile && photoFile.size > LIMITS.photo) blockers.push("una foto de menos de 15 MB");
  if ((needsMaster || mode === "video") && !video) blockers.push("tu vídeo maestro (paso 2)");
  if (video && video.size > LIMITS.video) blockers.push("un vídeo maestro de menos de 80 MB");
  if (mode === "video" && video && status && !ffmpegOk) blockers.push("ffmpeg para sacar la voz del vídeo (o elige otra voz en el paso 3)");
  if (mode === "texto" && !text.trim()) blockers.push("el texto que dirá (paso 3)");
  if (mode === "texto" && status && !voiceReady) blockers.push("elegir una voz de WILLY (paso 3)");
  if (mode === "audio" && !audio) blockers.push("tu audio (paso 3)");
  if (audio && mode === "audio" && audio.size > LIMITS.audio) blockers.push("un audio de menos de 40 MB");
  if (!consent) blockers.push("confirmar el permiso de la cara (paso 4)");

  const create = async () => {
    if (busy) return;
    if (blockers.length) return pushNotice(`Para crear el vídeo falta: ${blockers.join(", ")}.`, "warn");
    setResult(null);
    setShowLog(false);
    const photo = photoFile ? await toDataUrl(photoFile) : savedPhoto;
    const res = await call({
      action: "render",
      consent,
      voice: mode,
      photo,
      text: mode === "texto" ? text : "",
      ...(mode === "audio" && audio ? { audio: await toDataUrl(audio) } : {}),
      ...(video ? { video: await toDataUrl(video) } : {}),
    });
    if (!res.ok) return pushNotice(`⚠️ ${res.error}`, "warn");
    setJob(res.data.job as JobView);
  };

  const voices = status?.piper.voices ?? [];
  const selected = findChoice(voices, form.model, form.speaker);
  const voiceSelect = (
    <select className={`${input} w-full min-w-0`} value={selected?.id ?? (form.model ? "__otra" : "")} onChange={(e) => { if (e.target.value !== "__otra") void chooseVoice(e.target.value); }}>
      <option value="">— elige una voz —</option>
      {voices.map((v) => <option key={v.id} value={v.id}>{choiceName(v)}{RECOMMENDED_VOICE.test(v.id) ? " (recomendada)" : ""}</option>)}
      {form.model && !selected && <option value="__otra">{voiceLabel(form.model)}</option>}
    </select>
  );
  const activeChoice = status ? findChoice(voices, status.piper.model, status.piper.speaker ?? 0) : undefined;
  const activeVoiceName = activeChoice ? choiceName(activeChoice) : voiceLabel(status?.piper.model ?? "");
  const lastStep = job?.steps[job.steps.length - 1] ?? "";

  return (
    <>
      {/* =============================================================== 3 · CREAR VÍDEO */}
      <section hidden={tab !== "video"} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs">
          <span className="font-semibold">Motores:</span>
          {status ? (
            <>
              <Chip ok={status.comfy.running}>{status.comfy.running ? "ComfyUI en marcha" : "ComfyUI apagado"}</Chip>
              {status.comfy.running && <Chip ok={status.plan.pipelines.length > 0}>{`${status.plan.pipelines.length} camino(s) de animación`}</Chip>}
              <Chip ok={voiceReady}>{naturalOk ? `Voz de WILLY: ${status.natural?.label ?? ""}` : status.piper.ok ? `Voz de WILLY: ${activeVoiceName}` : status.hf.enabled ? "Voz de respaldo: Hugging Face" : "Voz de WILLY sin elegir"}</Chip>
            </>
          ) : (
            <span className="text-muted-foreground">{loading ? "Comprobando…" : "Sin comprobar"}</span>
          )}
          <span className="ml-auto flex gap-1.5">
            <Button type="button" size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" disabled={loading} onClick={() => void refresh(true)}>{loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Comprobar</Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => onTab("ajustes")}><Settings2 className="size-3.5" />Ajustes</Button>
          </span>
        </div>
        {problem && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">{problem}</p>}
        {status && !status.comfy.running && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5">
            <p className="font-semibold">ComfyUI está apagado: sin él no se puede animar la cara.</p>
            <p className="mt-1 text-muted-foreground">{status.comfy.error}</p>
            <p className="mt-1">Cuando esté en marcha pulsa «Comprobar». Si aún no lo tienes, mira <TextLink onClick={() => onTab("ajustes")}>Ajustes → Instalación</TextLink>.</p>
            <Button type="button" size="sm" className="mt-2 h-8 gap-1.5 text-xs" disabled={comfyStarting} onClick={() => void startComfy()}>
              {comfyStarting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {comfyStarting ? "Arrancando ComfyUI…" : "Arrancar ComfyUI"}
            </Button>
          </div>
        )}

        <Step n={1} title="Tu cara" desc="La foto que se va a animar. Por defecto, la de tu perfil." done={!!photoSrc}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary">
              {photoSrc ? <img src={photoSrc} alt="Foto para el vídeo" className="size-full object-cover" /> : <ImageIcon className="size-6 text-muted-foreground" />}
            </div>
            <div className="space-y-1.5 text-xs">
              <p className="text-muted-foreground">{photoFile ? `Foto solo para este vídeo: ${photoFile.name} (${formatSize(photoFile.size)})` : savedPhoto ? "Foto de tu perfil." : "Todavía no hay foto."}</p>
              <div className="flex flex-wrap gap-2">
                <FilePick accept="image/png,image/jpeg,image/webp" label={savedPhoto || photoFile ? "Usar otra foto" : "Subir una foto solo para este vídeo"} icon={<Upload className="size-3.5" />} onPick={setPhotoFile} />
                {photoFile && <Button type="button" size="sm" variant="ghost" className="h-9 gap-1 text-xs" onClick={() => setPhotoFile(null)}><Trash2 className="size-3.5" />{savedPhoto ? "Volver a la de mi perfil" : "Quitar"}</Button>}
                {!photoFile && <Button type="button" size="sm" variant="ghost" className="h-9 text-xs" onClick={() => onTab("perfil")}>{savedPhoto ? "Cambiarla en Tu perfil" : "O guárdala en Tu perfil"}</Button>}
              </div>
            </div>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">De frente, nítida, cara entera, luz suave y fondo simple. Mejor de 1024 px o más.</p>
        </Step>

        <Step n={2} title="Tu movimiento (vídeo maestro)" desc={`Un vídeo tuyo de 10–20 s hablando a cámara. De aquí salen los gestos, los parpadeos y el movimiento de la cabeza${needsMaster ? " (con tus flujos actuales es obligatorio)" : ""}.`} done={!!video}>
          {video ? (
            <div className="space-y-2">
              {videoPreview && <video src={videoPreview} controls className="max-h-56 w-full rounded-lg border border-border bg-black" />}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="truncate text-muted-foreground">{video.name} · {formatSize(video.size)}</span>
                <FilePick accept="video/mp4,video/webm" label="Cambiar" icon={<Upload className="size-3.5" />} onPick={setVideo} />
                <Button type="button" size="sm" variant="ghost" className="h-9 gap-1 text-xs" onClick={() => setVideo(null)}><Trash2 className="size-3.5" />Quitar</Button>
              </div>
            </div>
          ) : (
            <FilePick accept="video/mp4,video/webm" label="Subir vídeo maestro (MP4 o WebM)" icon={<Video className="size-3.5" />} onPick={setVideo} />
          )}
          <p className="text-[11px] leading-4 text-muted-foreground">Mirando a cámara, sin gestos bruscos, sin música y con buena luz. El texto no da órdenes al avatar: los gestos salen de este vídeo.</p>
        </Step>

        <Step n={3} title="La voz" desc="Elige con qué voz habla el vídeo." done={voiceStepDone}>
          <div role="radiogroup" aria-label="Voz del vídeo" className="grid gap-2 sm:grid-cols-3">
            {VOICE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={mode === option.id}
                onClick={() => setVoiceMode(option.id)}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${mode === option.id ? "border-primary bg-accent/60" : "border-border hover:bg-accent/40"}`}
              >
                <span className={`flex items-center gap-1.5 text-xs font-semibold ${mode === option.id ? "text-foreground" : "text-muted-foreground"}`}>{option.icon}{option.title}</span>
                <span className="text-[11px] leading-4 text-muted-foreground">{option.desc}</span>
              </button>
            ))}
          </div>

          {mode === "video" && (
            <div className="rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
              {video ? "Se usará el audio de tu vídeo maestro." : "Primero sube tu vídeo maestro en el paso 2."}
              {status && !ffmpegOk && <p className="mt-1 text-destructive">No encuentro ffmpeg en este equipo, así que no puedo sacar la voz del vídeo. Elige «Leer un texto» o «Un audio mío».</p>}
            </div>
          )}

          {mode === "texto" && (
            <div className="space-y-3 rounded-md border border-border bg-background p-3">
              <Field label="Texto que dirá (se lee tal cual: no pongas instrucciones como «sonríe» o «mira a cámara»)" hint={`${text.length.toLocaleString("es-ES")} / 6.000 caracteres · Para que los labios salgan bien, mejor clips de 15–40 s.`}>
                <textarea className={`${input} min-h-24`} value={text} onChange={(e) => setText(e.target.value)} maxLength={6000} placeholder="Hola, soy… Hoy te cuento…" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" className="text-xs" disabled={!script.trim()} onClick={() => setText(script.slice(0, 6000))}>Usar el texto de «Escribir como tú»</Button>
                {!script.trim() && <Button type="button" size="sm" variant="ghost" className="text-xs" onClick={() => onTab("escribir")}>Escribir uno con IA</Button>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {naturalOk ? (
                  <Field label="Voz de WILLY" hint="La que tienes elegida en Lectura → Voces más humanas. Si fallara, WILLY prueba otra de tus voces naturales.">
                    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold">{status?.natural?.label}</span><Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openView("lectura")}>Cambiar la voz</Button></div>
                  </Field>
                ) : (
                  <Field label="Voz de WILLY" hint={voices.length ? "Se guarda al elegirla. El ritmo y las pausas se ajustan en Lectura → Voces naturales." : "No hay voces descargadas: descárgalas en Lectura → Voces naturales."}>
                    {voiceSelect}
                  </Field>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <Button type="button" size="sm" variant="secondary" className="gap-1.5 text-xs" disabled={testing || !(naturalOk || form.model)} onClick={() => void testVoice()}>{testing ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}Probar la voz</Button>
                  {voiceUrl && <audio controls src={voiceUrl} className="h-8 max-w-full" />}
                </div>
              </div>
              {status && form.model && !status.piper.ok && <p className="text-xs text-destructive">{status.piper.message}</p>}
            </div>
          )}

          {mode === "audio" && (
            <div className="space-y-2 rounded-md border border-border bg-background p-3 text-xs">
              {audio ? (
                <>
                  {audioPreview && <audio controls src={audioPreview} className="h-8 w-full max-w-md" />}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-muted-foreground">{audio.name} · {formatSize(audio.size)}</span>
                    <FilePick accept="audio/wav,audio/mpeg,audio/flac,audio/ogg" label="Cambiar" icon={<Upload className="size-3.5" />} onPick={setAudio} />
                    <Button type="button" size="sm" variant="ghost" className="h-9 gap-1 text-xs" onClick={() => setAudio(null)}><Trash2 className="size-3.5" />Quitar</Button>
                  </div>
                </>
              ) : (
                <FilePick accept="audio/wav,audio/mpeg,audio/flac,audio/ogg" label="Subir mi audio" icon={<FileAudio className="size-3.5" />} onPick={setAudio} />
              )}
              <p className="text-[11px] leading-4 text-muted-foreground">Voz clara, sin música ni eco. El vídeo dura lo que dure el audio.</p>
            </div>
          )}
        </Step>

        <Step n={4} title="Crear el vídeo" desc="WILLY prepara la voz, anima la cara con ComfyUI y te deja el vídeo aquí. Con la tarjeta gráfica a fondo tarda unos minutos." done={!!result}>
          <label className="flex items-start gap-2 text-xs leading-5">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>La cara es <b>mía</b>, de alguien que <b>me ha dado permiso</b> o de un <b>personaje inventado</b>. Publicaré el vídeo indicando que está hecho con IA (las plataformas tienen una casilla para ello y en la UE la transparencia sobre contenido sintético es obligatoria en muchos casos).</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="gap-2" disabled={busy || blockers.length > 0} onClick={() => void create()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}{busy ? "Creando…" : "Crear el vídeo"}</Button>
            {busy && job && <Button type="button" variant="outline" className="gap-2" onClick={() => void call({ action: "cancel", id: job.id })}><Square className="size-4" />Cancelar</Button>}
          </div>
          {!busy && blockers.length > 0 && <p className="text-xs leading-5 text-muted-foreground">Para crear el vídeo falta: {blockers.join(" · ")}.</p>}
          <p className="text-[11px] leading-4 text-muted-foreground">Antes de crear: si Ollama está usando la tarjeta gráfica, libérala (<code>ollama stop nombre-del-modelo</code>); con 6 GB compiten por la memoria.</p>

          {job && (
            <div className="space-y-2 rounded-md border border-border bg-background p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {busy && <Loader2 className="size-3.5 animate-spin text-primary" />}
                <span className="font-semibold">
                  {job.status === "voz" ? "Preparando la voz…" : job.status === "animando" ? "Animando tu cara con ComfyUI…" : job.status === "listo" ? "Vídeo terminado" : job.status === "cancelado" ? "Cancelado" : "No se ha podido crear el vídeo"}
                </span>
                <span className="text-muted-foreground">· {formatTime(job.seconds)}</span>
                {job.steps.length > 0 && (
                  <button type="button" className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setShowLog((v) => !v)}>
                    {showLog ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}{showLog ? "Ocultar detalles" : "Ver detalles"}
                  </button>
                )}
              </div>
              {busy && lastStep && <p className="truncate text-muted-foreground">{lastStep}</p>}
              {showLog && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-card p-2 text-[11px] leading-4 text-muted-foreground">{job.steps.slice(-30).join("\n")}</pre>}
              {job.status === "error" && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 leading-5">{job.error}</p>}
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <video src={result.url} controls className="max-h-96 w-full rounded-md border border-border bg-black" />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <a href={result.url} download={result.name} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-semibold text-foreground hover:border-primary"><Download className="size-3.5" />Descargar {result.name}</a>
                <span>También queda guardado en <code>datos-privados/avatar-salidas</code> (los 20 últimos).</span>
              </div>
            </div>
          )}
        </Step>

        <details className="rounded-xl border border-border bg-card p-4 text-xs leading-5">
          <summary className="cursor-pointer text-sm font-semibold">Consejos para que salga lo más natural posible</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{NATURAL_TIPS.map((tip) => <li key={tip}>{tip}</li>)}</ul>
        </details>
      </section>

      {/* =============================================================== AJUSTES */}
      <section hidden={tab !== "ajustes"} className="space-y-4">
        <div className={box}>
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Estado de los motores</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Lo que hay en este equipo para crear los vídeos. Todo funciona en local y gratis.</p>
            </div>
            <Button type="button" size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" disabled={loading} onClick={() => void refresh(true)}>{loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Comprobar</Button>
          </div>
          {problem && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">{problem}</p>}
          {status && (
            <div className="space-y-2 rounded-md border border-border bg-background p-3 text-xs">
              <div className="flex flex-wrap gap-2">
                <Chip ok={status.comfy.running}>{status.comfy.running ? `ComfyUI ${status.comfy.version || ""}${status.comfy.gpu ? ` · ${status.comfy.gpu} ${status.comfy.vramGb} GB` : ""}` : "ComfyUI apagado"}</Chip>
                <Chip ok={status.plan.pipelines.length > 0}>{`${status.plan.pipelines.length} camino(s) de animación`}</Chip>
                <Chip ok={voiceReady}>{naturalOk ? `Voz de WILLY: ${status.natural?.label ?? ""}` : status.piper.ok ? `Voz de WILLY (Piper): ${activeVoiceName}` : "Voz de WILLY sin elegir"}</Chip>
                <Chip ok={status.ffmpeg ? status.ffmpeg.ok : null}>{status.ffmpeg?.ok ? "Voz del vídeo (ffmpeg) lista" : "Voz del vídeo: falta ffmpeg"}</Chip>
                <Chip ok={hasF5 ? true : null}>{hasF5 ? "Clonar voz (F5-TTS)" : "Clonar voz (F5-TTS): no instalado · opcional"}</Chip>
              </div>
              {!status.comfy.running && <p className="leading-5 text-muted-foreground">{status.comfy.error}</p>}
              {status.comfy.running && <p className="leading-5 text-muted-foreground">Nodos detectados en tu ComfyUI: {status.comfy.families.length ? status.comfy.families.map((f) => f.label).join(", ") : "ninguno de los conocidos"} ({status.comfy.nodes} en total).</p>}
              {!naturalOk && !status.piper.ok && <p className="leading-5 text-muted-foreground">Voz: {status.piper.message}</p>}
              {status.plan.pipelines.length > 0 && <p className="leading-5">Orden de prueba: {status.plan.pipelines.join("  ›  ")}</p>}
              {status.plan.skipped.map((s) => <p key={s.flow + s.reason} className="leading-5 text-muted-foreground">Se salta «{s.flow}»: {s.reason}.</p>)}
            </div>
          )}

          {!status?.comfy.running && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 font-semibold">Instalar ComfyUI y los nodos de avatar automáticamente</p>
                <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" disabled={comfyJob?.status === "activo"} onClick={() => void installComfyNow()}>
                  {comfyJob?.status === "activo" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  {comfyJob?.status === "activo" ? "Instalando…" : "Instalar automáticamente"}
                </Button>
              </div>
              {comfyJob ? (
                <>
                  {comfyJob.status === "activo" && (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border"><div className="h-full bg-primary transition-all" style={{ width: `${comfyJob.pct}%` }} /></div>
                      <p className="text-muted-foreground">{comfyJob.step}: {comfyJob.text}</p>
                    </div>
                  )}
                  {comfyJob.status === "error" && <p className="text-destructive">⚠️ {comfyJob.error}</p>}
                  {comfyJob.status === "listo" && <p className="text-emerald-600">✓ {comfyJob.text}</p>}
                </>
              ) : (
                <p className="text-muted-foreground">Si ya tienes ComfyUI instalado (como en <code>C:\WILLY_AVATAR</code>), no hace falta: solo arráncalo. Esto descarga ComfyUI y los nodos de movimiento y labios con git; los pesos de los modelos (varios GB) se completan después con ComfyUI-Manager.</p>
              )}
            </div>
          )}
        </div>

        <div className={box}>
          <div>
            <p className="text-sm font-semibold">Voz de WILLY y conexión con ComfyUI</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">La voz se usa cuando eliges «Leer un texto» en el paso 3. Las voces se eligen (y se ajustan) en Lectura → Voces más humanas.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {naturalOk && <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">Voz de WILLY: <b>{status?.natural?.label}</b> (se elige en Lectura → Voces más humanas).{status?.natural?.onlyNatural ? " Piper está retirado: solo se usan voces naturales." : ""}</p>}
            {!status?.natural?.onlyNatural && (
              <>
              <Field label="Voz elegida (se guarda al momento)">{voiceSelect}</Field>
              <Field label="Carpeta de voces de Piper"><input className={input} value={form.voicesDir} onChange={(e) => setForm({ ...form, voicesDir: e.target.value })} placeholder="C:\piper\voces" /></Field>
              <Field label="Piper: cómo se ejecuta">
                <select className={`${input} w-full min-w-0`} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "exe" | "python", exe: e.target.value === "python" ? "python" : form.exe === "python" ? "" : form.exe })}>
                  <option value="python">python -m piper (pip install piper-tts)</option><option value="exe">piper.exe (ruta)</option>
                </select>
              </Field>
              <Field label={form.mode === "python" ? "Comando de Python" : "Ruta de piper.exe"}><input className={input} value={form.exe} onChange={(e) => setForm({ ...form, exe: e.target.value })} placeholder={form.mode === "python" ? "python" : "C:\\piper\\piper.exe"} /></Field>
              </>
            )}
            <Field label="Dirección de ComfyUI (siempre en este equipo)"><input className={input} value={form.comfyUrl} onChange={(e) => setForm({ ...form, comfyUrl: e.target.value })} /></Field>
            <Field label="Tiempo máximo por paso (minutos)"><input className={input} type="number" min={3} max={90} value={form.timeoutMin} onChange={(e) => setForm({ ...form, timeoutMin: Number(e.target.value) })} /></Field>
            {!status?.natural?.onlyNatural && (
              <>
              <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={form.hfEnabled} onChange={(e) => setForm({ ...form, hfEnabled: e.target.checked })} />Usar Hugging Face como voz de respaldo si Piper falla (necesita tu clave; el uso gratuito tiene límites)</label>
              {form.hfEnabled && (
                <>
                  <Field label="Modelo de voz (por ejemplo facebook/mms-tts-spa)"><input className={input} value={form.hfModel} onChange={(e) => setForm({ ...form, hfModel: e.target.value })} /></Field>
                  <Field label={status?.hf.hasToken ? `Clave (guardada, termina en ${status.hf.last4}; escribe otra para cambiarla)` : "Clave de Hugging Face (se guarda solo en este equipo)"}><input className={input} type="password" autoComplete="off" value={form.hfToken} onChange={(e) => setForm({ ...form, hfToken: e.target.value })} /></Field>
                </>
              )}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => void save()}>Guardar ajustes</Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={testing} onClick={() => void testVoice()}>{testing ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}Probar la voz</Button>
            {voiceUrl && <audio controls src={voiceUrl} className="h-8 max-w-full" />}
          </div>
        </div>

        <div className={box}>
          <div>
            <p className="text-sm font-semibold">Flujos de animación (ComfyUI)</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Cada flujo es un .json de ComfyUI en formato API. WILLY los encadena en este orden: Movimiento → Labios, después «Todo en uno» y por último solo Labios. Si uno falla, descansa 30 min y se prueba el siguiente.</p>
          </div>
          {status?.flows.length === 0 && <p className="text-xs text-muted-foreground">Aún no hay ninguno. Añade el .json (formato API) de un flujo de LivePortrait, Wav2Lip, MuseTalk…</p>}
          <ul className="space-y-2">
            {status?.flows.map((flow, i) => (
              <li key={flow.id} className="rounded-md border border-border bg-background p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{flow.name}</span>
                  <select className="rounded border border-border bg-card px-1 py-0.5" value={flow.role} onChange={(e) => void flowAction({ action: "flow-role", id: flow.id, role: e.target.value })}>{(Object.keys(ROLES) as Role[]).map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}</select>
                  {flow.checked ? <Chip ok={flow.missing.length === 0}>{flow.missing.length === 0 ? "listo" : `faltan ${flow.missing.length} nodo(s)`}</Chip> : <Chip ok={null}>sin comprobar (ComfyUI apagado)</Chip>}
                  {flow.pausedMin > 0 && <Chip ok={false}>{`en pausa ${flow.pausedMin} min`}</Chip>}
                  <span className="ml-auto flex gap-1">
                    <Button type="button" size="icon" variant="ghost" className="size-6" disabled={i === 0} onClick={() => void flowAction({ action: "flow-move", id: flow.id, dir: "up" })} aria-label="Subir"><ChevronUp className="size-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="size-6" disabled={i === status.flows.length - 1} onClick={() => void flowAction({ action: "flow-move", id: flow.id, dir: "down" })} aria-label="Bajar"><ChevronDown className="size-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="size-6" onClick={() => void flowAction({ action: "flow-remove", id: flow.id })} aria-label="Quitar"><Trash2 className="size-4" /></Button>
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{ROLES[flow.role].desc}</p>
                {flow.hints.map((h) => <p key={h} className="mt-1 leading-5 text-destructive">{h}</p>)}
                {flow.warnings.map((w) => <p key={w} className="mt-1 leading-5 text-muted-foreground">⚠ {w}</p>)}
                {!flow.hasVideoOutput && <p className="mt-1 text-destructive">No tiene un nodo que guarde vídeo (Video Combine / Save Video).</p>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-2.5">
            <Field label="Nombre"><input className={`${input} w-40`} value={flowName} onChange={(e) => setFlowName(e.target.value)} placeholder="MuseTalk" /></Field>
            <Field label="Tipo"><select className={input} value={flowRole} onChange={(e) => setFlowRole(e.target.value as Role)}>{(Object.keys(ROLES) as Role[]).map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}</select></Field>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:border-primary"><Upload className="size-3.5" />Añadir flujo (.json API)<input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addFlow(f); }} /></label>
          </div>
        </div>

        <details className="rounded-xl border border-border bg-card p-4 text-xs leading-5">
          <summary className="cursor-pointer text-sm font-semibold">Instalación manual, paso a paso (si prefieres hacerlo tú)</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            <li><b>ComfyUI:</b> arráncalo con su lanzador y deja la ventana abierta (en tu equipo: <code>C:\WILLY_AVATAR\ARRANCAR_WILLY_AVATAR.bat</code>; en la versión portable: <code>run_nvidia_gpu.bat</code>). WILLY lo espera en <code>http://127.0.0.1:8188</code>. No abras dos ComfyUI a la vez: usan el mismo puerto.</li>
            <li><b>Nodos</b> (ComfyUI-Manager → Custom Nodes Manager): <i>ComfyUI-VideoHelperSuite</i>, <i>ComfyUI-LivePortraitKJ</i> (movimiento) y uno de labios: <i>ComfyUI_wav2lip</i>, <i>ComfyUI-MuseTalk_FSH</i> o <i>ComfyUI-LatentSync-Node</i>. Reinicia ComfyUI.</li>
            <li><b>Flujos:</b> abre en ComfyUI el flujo, asegúrate de que termina en un nodo <i>Video Combine</i> y guárdalo con <b>Workflow → Export (API)</b> (si no aparece, activa «Dev mode» en los ajustes de ComfyUI). Si tiene varios nodos de imagen, audio o vídeo, pon al tuyo el título <code>AVATAR_IMAGEN</code>, <code>AVATAR_AUDIO</code> o <code>AVATAR_VIDEO</code>. Después, «Añadir flujo» aquí arriba.</li>
            <li><b>Voz:</b> {status?.natural?.onlyNatural
              ? <>el vídeo lee con la voz de WILLY que elijas en Lectura → Voces más humanas (Gemini, «Mi voz» con Chatterbox…). Arriba ves cuál está activa y la pruebas con «Probar la voz».</>
              : <>WILLY instala Piper y las voces de España en Lectura → Voces naturales (recomendadas: <i>es_ES-davefx-medium</i> o <i>es_ES-sharvard-medium</i>). Aquí eliges cuál usa el vídeo.</>}</li>
            <li><b>Con 6 GB de memoria gráfica:</b> trabaja a 512–768 px, cierra otros programas y libera Ollama antes de crear el vídeo (<code>ollama stop nombre-del-modelo</code>).</li>
          </ol>
        </details>

        <details className="rounded-xl border border-border bg-card p-4 text-xs leading-5">
          <summary className="cursor-pointer text-sm font-semibold">Uso responsable y licencias</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>El objetivo es la naturalidad (que se vea y se oiga bien), no engañar. Ninguna técnica garantiza que un detector no lo reconozca, y WILLY no quita marcas ni esconde que es IA: el archivo lleva «IA» en el nombre.</li>
            <li>Usa solo tu cara, la de alguien que te ha dado permiso o la de un personaje inventado, e indica al publicar que está hecho con IA.</li>
            <li>LivePortrait en tu equipo usa el detector FaceAlignment (BSD-3), no InsightFace. Wav2Lip solo permite uso personal o de investigación (no comercial). Revisa la licencia de cada modelo antes de publicar.</li>
          </ul>
        </details>
      </section>
    </>
  );
}
