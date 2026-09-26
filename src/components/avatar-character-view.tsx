// Crea tu avatar IA: genera la imagen de un personaje (influencer virtual o doble digital consentido) a partir de una
// descripción por pasos (identidad, cuerpo, estilo/ropa, escenario, pose y cámara) que WILLY compone en un único texto
// para el flujo de ComfyUI. Se guarda un perfil por personaje (como «Mi yo en IA» guarda tu perfil) para reutilizarlo.
//
// Qué es real hoy y qué no (para no prometer de más):
//   - Generar una IMAGEN fija del personaje: real, si hay un flujo de ComfyUI (rol «Personaje») completo e instalado.
//   - Mantener la misma cara entre imágenes: depende de que ESE flujo use IPAdapter/InstantID/PuLID con tu foto.
//   - Vídeo, movimiento, «andar», cámara en directo: NO implementado todavía (Fase 2, sin probar en este equipo:
//     ver «Decisiones pendientes»). Se deja preparado el hueco, pero no se finge que funciona.
// WILLY no trae ni descarga modelos de imagen: los instala el dueño en ComfyUI (ver pestaña «Flujos»).

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera, Clapperboard, Download, Image as ImageIcon, Loader2, Play, Sparkles,
  Square, Trash2, Upload, User, Wand2, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";
import { usePersistentState } from "@/lib/persistent-state";
import type { Role } from "@/lib/avatar-engines";
import { PanelCard as Card } from "@/components/panel-card";

function Labeled({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs ${className}`}>
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-4 text-muted-foreground">{hint}</span>}
    </label>
  );
}
const field = "h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";
const box = "space-y-3 rounded-xl border border-border bg-card p-4";

function Chip({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${ok === null ? "border-border text-muted-foreground" : ok ? "border-emerald-500/40 text-emerald-600" : "border-destructive/40 text-destructive"}`}>
      {children}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ perfil del personaje
type Character = {
  nombre: string;
  original: boolean; // true = personaje sintético; false = doble digital (necesita tu foto + consentimiento)
  identidad: string; // edad aparente, género/estilo, tono de presencia
  rostro: string; // rasgos de cara: ojos, piel, pelo, maquillaje, realismo
  cuerpo: string; // tipo de cuerpo, altura, proporciones, postura
  estilo: string; // ropa, accesorios, look (playa, editorial, business…)
  escenario: string; // lugar, iluminación, estilo visual
  pose: string; // pose, expresión, mirada, ángulo de cámara
  extra: string; // cualquier detalle adicional en tus palabras
  photo: string; // foto de referencia (solo si !original, o para IPAdapter/InstantID)
};
const CKEY = "willy-personaje";
const CEMPTY: Character = { nombre: "", original: true, identidad: "", rostro: "", cuerpo: "", estilo: "", escenario: "", pose: "", extra: "", photo: "" };

function readCharacter(): Character {
  try {
    const raw = window.localStorage.getItem(CKEY);
    return raw ? { ...CEMPTY, ...(JSON.parse(raw) as Partial<Character>) } : CEMPTY;
  } catch {
    return CEMPTY;
  }
}

/** Compone las respuestas por pasos en el texto que se manda al flujo de ComfyUI. */
function buildPrompt(c: Character): string {
  const parts = [
    c.nombre && `Personaje: ${c.nombre}.`,
    c.identidad && `Identidad: ${c.identidad}.`,
    c.rostro && `Rostro: ${c.rostro}.`,
    c.cuerpo && `Cuerpo: ${c.cuerpo}.`,
    c.estilo && `Ropa y estilo: ${c.estilo}.`,
    c.escenario && `Escenario: ${c.escenario}.`,
    c.pose && `Pose y cámara: ${c.pose}.`,
    c.extra,
  ].filter(Boolean);
  return parts.join(" ");
}

async function shrinkImage(file: File, max = 1024, quality = 0.9): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

// ------------------------------------------------------------------------------------------------ API
async function call(body: Record<string, unknown>): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/avatar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `El servidor respondió ${res.status}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo hablar con WILLY." };
  }
}

type Flow = { id: string; name: string; role: Role; needs: { image: boolean; audio: boolean; video: boolean }; missing: string[]; warnings: string[]; hints: string[]; hasVideoOutput: boolean; hasImageOutput: boolean; checked: boolean; pausedMin: number };
type Status = {
  comfy: { running: boolean; version: string; gpu: string; vramGb: number; freeGb: number; error: string; url: string; nodes: number };
  flows: Flow[];
  personaje: { ready: string[]; skipped: Array<{ flow: string; reason: string }>; tips: string[] };
  modelInstall?: ModelJobView | null;
};
type JobView = { id: string; status: "generando" | "listo" | "error" | "cancelado"; steps: string[]; error: string; file: { name: string; mime: string; size: number } | null; seconds: number };
type ModelJobView = { id: string; status: "activo" | "listo" | "error" | "cancelado"; pct: number; text: string; error: string; bytesDone: number; bytesTotal: number; file: string };
const MODEL_FOLDERS = ["checkpoints", "loras", "vae", "clip_vision", "ipadapter", "controlnet", "upscale_models"] as const;

const TABS = [
  { id: "perfil", label: "Personaje", icon: User },
  { id: "generar", label: "Generar", icon: Wand2 },
  { id: "flujos", label: "Flujos (ComfyUI)", icon: Sparkles },
  { id: "movimiento", label: "Movimiento / Directo", icon: Clapperboard },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function AvatarCharacterView() {
  const [character, setCharacter] = useState<Character>(CEMPTY);
  const [tab, setTab] = usePersistentState<Tab>("personaje:pestana", "perfil");
  const [status, setStatus] = useState<Status | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [consent, setConsent] = usePersistentState("personaje:consiento", false);
  const [flowId, setFlowId] = usePersistentState("personaje:flujo", "");
  const [job, setJob] = useState<JobView | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [flowName, setFlowName] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);
  // Sugerencia por defecto (26/09, elegida por Antonio: «SDXL Turbo/Lightning»): SDXL-Lightning de ByteDance, porque
  // se descarga sin iniciar sesión (Apache 2.0). Queda editable por si prefiere pegar otro enlace (p. ej. SDXL Turbo
  // de Stability AI, que a veces exige aceptar la licencia logueado en el navegador antes de que el enlace directo
  // funcione).
  const [modelUrl, setModelUrl] = useState("https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step_unet.safetensors");
  const [modelFolder, setModelFolder] = useState<(typeof MODEL_FOLDERS)[number]>("checkpoints");
  const [modelFilename, setModelFilename] = useState("sdxl_lightning_4step.safetensors");
  const [modelJob, setModelJob] = useState<ModelJobView | null>(null);

  useEffect(() => { setCharacter(readCharacter()); }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const refresh = async () => {
    setLoadingStatus(true);
    const res = await call({ action: "status", fresh: true });
    setLoadingStatus(false);
    if (res.ok) {
      const s = res.data as Status;
      setStatus(s);
      if (s.modelInstall) setModelJob(s.modelInstall);
    }
  };
  useEffect(() => { if (tab === "generar" || tab === "flujos") void refresh(); }, [tab]);

  useEffect(() => {
    if (!modelJob || modelJob.status !== "activo") return;
    const timer = window.setInterval(async () => {
      const res = await call({ action: "model-install-status" });
      if (res.ok && res.data.job) setModelJob(res.data.job as ModelJobView);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [modelJob?.id, modelJob?.status]);

  const startModelInstall = async () => {
    if (!modelUrl.trim() || !modelFilename.trim()) return pushNotice("Pega la dirección y ponle un nombre de archivo.", "warn");
    const res = await call({ action: "model-install", url: modelUrl.trim(), folder: modelFolder, filename: modelFilename.trim() });
    if (!res.ok) return pushNotice(`⚠️ ${res.error}`, "warn");
    setModelJob(res.data.job as ModelJobView);
    pushNotice("Descargando el modelo en segundo plano (con la conexión de este equipo)…", "info");
  };

  useEffect(() => {
    if (!job || job.status !== "generando") return;
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
      if (!res.ok) return pushNotice("No pude recoger la imagen terminada.", "warn");
      const blob = await res.blob();
      setResult({ url: URL.createObjectURL(blob), name: job.file?.name ?? "personaje-IA.png" });
      pushNotice("Imagen del personaje lista.", "success");
    })();
  }, [job?.status, job?.id]);

  const save = (next: Character) => {
    setCharacter(next);
    try { window.localStorage.setItem(CKEY, JSON.stringify(next)); } catch { pushNotice("No se ha podido guardar: el almacenamiento del navegador está lleno.", "warn"); }
  };

  const pickPhoto = async (file: File) => {
    try { save({ ...character, photo: await shrinkImage(file) }); pushNotice("Foto de referencia guardada.", "success"); }
    catch { pushNotice("No he podido leer esa imagen. Prueba con una foto JPG, PNG o WEBP.", "warn"); }
  };

  const prompt = buildPrompt(character);
  const personajeFlows = status?.flows.filter((f) => f.role === "personaje") ?? [];
  const readyFlows = personajeFlows.filter((f) => status?.personaje.ready.includes(f.id));
  const canGenerate = !!prompt.trim() && consent && readyFlows.length > 0 && (!job || job.status !== "generando");

  const generate = async () => {
    if (!canGenerate) return;
    setResult(null);
    const chosen = readyFlows.find((f) => f.id === flowId) ?? readyFlows[0]!;
    const res = await call({ action: "personaje-generar", consent: true, prompt, flowId: chosen.id, ...(character.photo ? { photo: character.photo } : {}) });
    if (!res.ok) return pushNotice(`⚠️ ${res.error}`, "warn");
    setJob(res.data.job as JobView);
    pushNotice("Generando la imagen del personaje…", "info");
  };

  const flowAction = async (body: Record<string, unknown>) => { const res = await call(body); if (!res.ok) pushNotice(`⚠️ ${res.error}`, "warn"); void refresh(); };
  const addFlow = async (file: File) => {
    const res = await call({ action: "flow-add", name: flowName || file.name.replace(/\.json$/i, ""), role: "personaje", json: await file.text() });
    if (!res.ok) return pushNotice(`⚠️ ${res.error}`, "warn");
    setFlowName("");
    pushNotice("Flujo de personaje añadido.", "success");
    void refresh();
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><Wand2 className="size-4 text-primary" />Crea tu avatar IA</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Un personaje (influencer sintético o tu doble digital, con tu permiso) descrito por pasos, listo para generar su imagen con ComfyUI.
            Todo se hace y se guarda en este equipo.
          </p>
        </div>
        <div role="tablist" aria-label="Apartados de Crea tu avatar IA" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TABS.map((t) => {
            const active = tab === t.id;
            const Icon = t.icon as LucideIcon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${active ? "border-primary bg-accent/60 text-foreground" : "border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground"}`}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate font-semibold">{t.label}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* =============================================================== PERSONAJE */}
      <div hidden={tab !== "perfil"} className="space-y-4">
        <Card className="space-y-4">
          <div>
            <p className="text-sm font-semibold">1 · Quién es tu personaje</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Rellena lo que te importe (nada es obligatorio salvo, si es tu doble, la foto). WILLY lo combina en una sola descripción para generar la imagen.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => save({ ...character, original: true })} className={`flex-1 rounded-lg border px-3 py-2 text-left text-xs transition ${character.original ? "border-primary bg-accent/60" : "border-border text-muted-foreground hover:bg-accent/40"}`}>
              <span className="block font-semibold text-foreground">Personaje original</span>Sintético, inventado por ti.
            </button>
            <button type="button" onClick={() => save({ ...character, original: false })} className={`flex-1 rounded-lg border px-3 py-2 text-left text-xs transition ${!character.original ? "border-primary bg-accent/60" : "border-border text-muted-foreground hover:bg-accent/40"}`}>
              <span className="block font-semibold text-foreground">Mi doble digital</span>Tu cara, con tu permiso.
            </button>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex flex-col items-center gap-2 sm:w-36">
              <div className="flex size-32 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary">
                {character.photo ? <img src={character.photo} alt="Referencia" className="size-full object-cover" /> : <ImageIcon className="size-8 text-muted-foreground" />}
              </div>
              <div className="flex gap-1">
                <Button variant="secondary" size="sm" className="gap-1" onClick={() => photoRef.current?.click()}><Upload className="size-3.5" />{character.photo ? "Cambiar" : "Subir foto"}</Button>
                {character.photo && <Button variant="ghost" size="sm" aria-label="Quitar la foto" onClick={() => save({ ...character, photo: "" })}><Trash2 className="size-3.5" /></Button>}
              </div>
              <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pickPhoto(f); }} />
              <p className="text-center text-[11px] leading-4 text-muted-foreground">{character.original ? "Opcional: ayuda a mantener la misma cara entre imágenes (si el flujo lo admite)." : "Obligatoria: de frente, nítida, con luz suave."}</p>
            </div>
            <div className="grid flex-1 content-start gap-3 sm:grid-cols-2">
              <Labeled label="Nombre del personaje" className="sm:col-span-2"><input value={character.nombre} onChange={(e) => save({ ...character, nombre: e.target.value })} placeholder="Ej.: Aitana, Marco…" className={field} /></Labeled>
              <Labeled label="Identidad" hint="Edad aparente, género/estilo, tono de presencia"><input value={character.identidad} onChange={(e) => save({ ...character, identidad: e.target.value })} placeholder="mujer de unos 28 años, elegante y cercana" className={field} /></Labeled>
              <Labeled label="Rostro" hint="Ojos, piel, pelo, maquillaje…"><input value={character.rostro} onChange={(e) => save({ ...character, rostro: e.target.value })} placeholder="ojos verdes, pelo castaño largo, piel morena" className={field} /></Labeled>
              <Labeled label="Cuerpo" hint="Tipo de cuerpo, altura, postura"><input value={character.cuerpo} onChange={(e) => save({ ...character, cuerpo: e.target.value })} placeholder="complexión atlética, altura media, postura erguida" className={field} /></Labeled>
              <Labeled label="Ropa y estilo" hint="Prendas, accesorios, look"><input value={character.estilo} onChange={(e) => save({ ...character, estilo: e.target.value })} placeholder="vestido de lino blanco, look editorial" className={field} /></Labeled>
              <Labeled label="Escenario" hint="Lugar e iluminación"><input value={character.escenario} onChange={(e) => save({ ...character, escenario: e.target.value })} placeholder="terraza de un ático al atardecer, luz cálida" className={field} /></Labeled>
              <Labeled label="Pose y cámara" hint="Postura, expresión, plano"><input value={character.pose} onChange={(e) => save({ ...character, pose: e.target.value })} placeholder="de pie, mirando a cámara, plano medio" className={field} /></Labeled>
            </div>
          </div>
          <Labeled label="Cualquier otro detalle, en tus palabras"><textarea value={character.extra} onChange={(e) => save({ ...character, extra: e.target.value })} className={`h-20 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary`} placeholder="fotografía realista, 85mm, profundidad de campo…" /></Labeled>
          <div className="rounded-lg border border-border bg-background p-3 text-xs leading-5 text-muted-foreground"><b className="text-foreground">Vista previa del texto que se manda a ComfyUI: </b>{prompt || "— rellena algún campo de arriba —"}</div>
          <div className="flex justify-end"><Button size="sm" className="gap-1.5" onClick={() => setTab("generar")}>Siguiente: generar<Wand2 className="size-3.5" /></Button></div>
        </Card>
      </div>

      {/* =============================================================== GENERAR */}
      <div hidden={tab !== "generar"} className="space-y-4">
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">2 · Generar la imagen</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Usa el primer flujo de personaje que esté listo (o el que elijas abajo).</p>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void refresh()} disabled={loadingStatus}>{loadingStatus ? <Loader2 className="size-3.5 animate-spin" /> : null}Comprobar</Button>
          </div>

          {!status?.comfy.running && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs leading-5">ComfyUI no está en marcha{status?.comfy.error ? `: ${status.comfy.error}` : "."} Arráncalo (en tu equipo: <code>C:\WILLY_AVATAR\ARRANCAR_WILLY_AVATAR.bat</code>) y pulsa «Comprobar».</p>
          )}
          {status?.comfy.running && personajeFlows.length === 0 && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs leading-5">Todavía no tienes ningún flujo de tipo «Personaje». Ve a la pestaña «Flujos (ComfyUI)» y añade uno.</p>
          )}
          {status?.comfy.running && personajeFlows.length > 0 && readyFlows.length === 0 && (
            <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs leading-5">
              <p className="font-semibold">Ninguno de tus flujos de personaje está listo:</p>
              {status.personaje.skipped.map((s, i) => <p key={i}>· «{s.flow}»: {s.reason}</p>)}
            </div>
          )}
          {readyFlows.length > 0 && (
            <Labeled label="Flujo a usar">
              <select className={field} value={flowId || readyFlows[0]!.id} onChange={(e) => setFlowId(e.target.value)}>
                {readyFlows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Labeled>
          )}

          <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-xs leading-5">
            <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            Confirmo que la cara usada (si la hay) es la mía, de alguien que me ha dado permiso, o de un personaje inventado.
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {job?.status === "generando" ? (
              <Button variant="outline" className="gap-2" onClick={() => void call({ action: "cancel", id: job.id })}><Square className="size-4" />Cancelar</Button>
            ) : (
              <Button className="gap-2" onClick={() => void generate()} disabled={!canGenerate}><Play className="size-4" />Generar imagen</Button>
            )}
            {job?.status === "generando" && <Loader2 className="size-5 animate-spin text-primary" />}
          </div>
          {job && job.steps.length > 0 && <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-md border border-border bg-background p-2 text-[11px] leading-4 text-muted-foreground">{job.steps.slice(-12).map((s, i) => <p key={i}>{s}</p>)}</div>}
          {job?.status === "error" && <p className="text-xs text-destructive">⚠️ {job.error}</p>}
        </Card>

        {result && (
          <Card className="space-y-3">
            <p className="text-sm font-semibold">Resultado</p>
            <img src={result.url} alt={character.nombre || "Tu personaje"} className="max-h-[520px] w-full rounded-lg border border-border object-contain" />
            <div className="flex flex-wrap gap-2">
              <Button className="gap-2" onClick={() => { const a = document.createElement("a"); a.href = result.url; a.download = result.name; a.click(); }}><Download className="size-4" />Descargar</Button>
              <Button variant="outline" className="gap-2" onClick={() => void generate()} disabled={!canGenerate}><Wand2 className="size-4" />Generar otra variante</Button>
            </div>
          </Card>
        )}

        {(status?.personaje.tips.length ?? 0) > 0 && (
          <Card className="space-y-2">
            <p className="text-sm font-semibold">Cómo conseguir el mejor resultado</p>
            <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">{status!.personaje.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </Card>
        )}
      </div>

      {/* =============================================================== FLUJOS */}
      <div hidden={tab !== "flujos"} className="space-y-4">
        <Card className="space-y-3">
          <div>
            <p className="text-sm font-semibold">Flujos de personaje (ComfyUI)</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Un flujo aquí es un .json de ComfyUI en formato API que termina en un nodo <b>Save Image</b>. Necesita un checkpoint de
              generación de imagen instalado (por ejemplo FLUX o SDXL) — WILLY no lo trae ni lo descarga. Para mantener la misma cara,
              añade IPAdapter, InstantID o PuLID con tu foto de referencia. Si tu flujo tiene varios nodos de texto o de imagen, pon al
              tuyo el título <code>AVATAR_PROMPT</code> o <code>AVATAR_IMAGEN</code>.
            </p>
          </div>
          {personajeFlows.length === 0 && <p className="text-xs text-muted-foreground">Aún no hay ninguno.</p>}
          <ul className="space-y-2">
            {personajeFlows.map((flow, i) => (
              <li key={flow.id} className="rounded-md border border-border bg-background p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{flow.name}</span>
                  {flow.checked ? <Chip ok={flow.missing.length === 0 && flow.hasImageOutput}>{flow.missing.length ? `faltan ${flow.missing.length} nodo(s)` : flow.hasImageOutput ? "listo" : "sin Save Image"}</Chip> : <Chip ok={null}>sin comprobar (ComfyUI apagado)</Chip>}
                  {flow.pausedMin > 0 && <Chip ok={false}>en pausa {flow.pausedMin} min</Chip>}
                  <span className="ml-auto"><Button type="button" size="icon" variant="ghost" className="size-6" onClick={() => void flowAction({ action: "flow-remove", id: flow.id })} aria-label="Quitar"><Trash2 className="size-4" /></Button></span>
                </div>
                {flow.hints.map((h) => <p key={h} className="mt-1 leading-5 text-destructive">{h}</p>)}
                {flow.warnings.map((w) => <p key={w} className="mt-1 leading-5 text-muted-foreground">⚠ {w}</p>)}
                {!flow.hasImageOutput && flow.missing.length === 0 && <p className="mt-1 text-destructive">No tiene un nodo que guarde imagen (Save Image).</p>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-2.5">
            <Labeled label="Nombre" className="w-40"><input className={field} value={flowName} onChange={(e) => setFlowName(e.target.value)} placeholder="Mi flujo FLUX" /></Labeled>
            <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold hover:border-primary"><Upload className="size-3.5" />Añadir flujo (.json API)<input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addFlow(f); }} /></label>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">Los demás flujos (movimiento, labios, todo en uno) se gestionan en <b>Mi yo en IA → Ajustes</b>; aquí solo se listan los de rol «Personaje».</p>
        </Card>

        <Card className="space-y-3">
          <div>
            <p className="text-sm font-semibold">Descargar un modelo (checkpoint, LoRA, IPAdapter…)</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Pega aquí el enlace directo de descarga de un archivo (por ejemplo, desde Hugging Face: entra en la ficha del
              modelo en tu navegador, comprueba la licencia y copia el enlace del botón de descarga del archivo
              <code> .safetensors</code>). WILLY no trae ningún modelo grabado de antemano —esos archivos pesan varios GB y sus
              direcciones cambian con frecuencia—; lo único que hace es guardarlo en el sitio correcto de ComfyUI. La descarga la
              hace este equipo con tu propia conexión, en segundo plano.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Enlace de descarga (https://)" className="sm:col-span-2"><input className={field} value={modelUrl} onChange={(e) => setModelUrl(e.target.value)} placeholder="https://huggingface.co/…/resolve/main/modelo.safetensors" /></Labeled>
            <Labeled label="Carpeta de destino">
              <select className={field} value={modelFolder} onChange={(e) => setModelFolder(e.target.value as (typeof MODEL_FOLDERS)[number])}>
                {MODEL_FOLDERS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Labeled>
            <Labeled label="Nombre de archivo"><input className={field} value={modelFilename} onChange={(e) => setModelFilename(e.target.value)} placeholder="mi-modelo.safetensors" /></Labeled>
          </div>
          <p className="rounded-md border border-border bg-secondary/40 p-2.5 text-[11px] leading-4 text-muted-foreground">
            Ya está rellenado con <b>SDXL-Lightning (ByteDance, Apache 2.0, ~6,9 GB)</b>: no pide iniciar sesión, así que pulsando
            «Descargar» debería funcionar tal cual. Si prefieres SDXL Turbo de Stability AI (mejor fama, pero a veces exige aceptar
            la licencia logueado en tu navegador antes), cambia el enlace por
            <code> https://huggingface.co/stabilityai/sdxl-turbo/resolve/main/sd_xl_turbo_1.0_fp16.safetensors</code>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {modelJob?.status === "activo" ? (
              <Button variant="outline" className="gap-2" onClick={() => void call({ action: "model-install-cancel" }).then(() => void refresh())}><Square className="size-4" />Cancelar descarga</Button>
            ) : (
              <Button className="gap-2" onClick={() => void startModelInstall()}><Download className="size-4" />Descargar</Button>
            )}
            {modelJob?.status === "activo" && <Loader2 className="size-4 animate-spin text-primary" />}
          </div>
          {modelJob && modelJob.status === "activo" && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${modelJob.pct}%` }} /></div>
              <p className="text-xs text-muted-foreground">{modelJob.text}</p>
            </div>
          )}
          {modelJob?.status === "listo" && <p className="text-xs text-emerald-600">✓ {modelJob.text || `Guardado: ${modelJob.file}`}</p>}
          {modelJob?.status === "error" && <p className="text-xs text-destructive">⚠️ {modelJob.error}</p>}
          <p className="text-[11px] leading-4 text-muted-foreground">
            Alternativa más sencilla: dentro de ComfyUI-Manager (botón «Arrancar ComfyUI» de «Mi yo en IA → Crear vídeo» lo instala)
            hay un «Model Manager» que ya conoce las direcciones correctas y vigentes de los modelos más usados.
          </p>
        </Card>
      </div>

      {/* =============================================================== MOVIMIENTO / DIRECTO (Fase 2, sin implementar) */}
      <div hidden={tab !== "movimiento"} className="space-y-4">
        <Card className="space-y-3">
          <div className="flex items-center gap-2"><Clapperboard className="size-4 text-muted-foreground" /><p className="text-sm font-semibold">Andar, moverse y modo en directo</p></div>
          <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs leading-5">
            Esto todavía <b>no está implementado</b> en este equipo, y prefiero decirlo claro en vez de simularlo: colocar al personaje
            andando por una escena, con vídeo, sin que se note que es IA, necesita generación de vídeo con control de movimiento
            (no solo la imagen fija de arriba). Es la «Fase 2» del proyecto: no hay ningún modelo de ese tipo instalado, y en la
            gráfica de este equipo (6 GB) está sin probar si cabría. El modo «en directo / cámara en tiempo real» tiene el mismo problema,
            multiplicado (hay que hacerlo en tiempo real).
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            Lo que sí es real hoy, y ya puedes usar: la imagen fija del personaje (pestaña «Generar») y, en <b>Mi yo en IA → Crear vídeo</b>,
            un vídeo hablando con movimiento de cabeza y labios (no caminando) a partir de tu propia foto y un vídeo tuyo de referencia.
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Camera className="size-3.5" />Cuando decidas seguir con la Fase 2, esto se retoma desde «Decisiones pendientes» (D3).</p>
        </Card>
      </div>
    </div>
  );
}
