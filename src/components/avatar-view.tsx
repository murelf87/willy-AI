// Mi yo en IA: tu doble digital. Con tu perfil (foto, datos y un texto tuyo) WILLY escribe como tú y crea vídeos con tu cara,
// tu movimiento y la voz que elijas. La página va en pestañas, en el orden en que se usa:
//   1) Tu perfil · 2) Escribir como tú · 3) Crear vídeo · Ajustes (motores, voces y flujos).
// Todo se hace y se guarda en este equipo.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Copy, Download, Image as ImageIcon, Loader2, PenLine, Play, Settings2, Square, Trash2, Upload, User, Video, Volume2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClarifyButton } from "@/components/clarify-button";
import { usePersistentState } from "@/lib/persistent-state";
import { pushNotice } from "@/lib/notifications";
import { useSettings } from "@/lib/workspace-store";
import { aiService } from "@/services/ai-service";
import { runTask } from "@/services/orchestrator";
import { speakBest } from "@/lib/natural-voice";
import { useBackgroundReport } from "@/lib/background-tasks";
import type { SpeechHandle } from "@/lib/tts-voice";
import { AvatarStudio, type AvatarTab } from "@/components/avatar-studio";
import { PanelCard as Card } from "@/components/panel-card";

function Labeled({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs ${className}`}>
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
const field = "h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";
const area = "w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary";

type Persona = {
  name: string;
  role: string;
  tone: string;
  topics: string;
  sample: string;
  voice: string;
  photo: string;
};

const KEY = "willy-yo";

const EMPTY: Persona = { name: "", role: "", tone: "cercano y directo", topics: "", sample: "", voice: "Kore", photo: "" };

function readPersona(): Persona {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Persona>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Reduce la foto para que quepa en el equipo y siga sirviendo para el vídeo (hasta 1024 px). */
async function shrinkImage(file: File, max = 1024, quality = 0.88): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

/** Tamaño real de la foto guardada, para avisar si es pequeña (las fotos antiguas se guardaban a 512 px). */
function usePhotoSize(src: string): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!src) { setSize(null); return; }
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);
  return size;
}

const FORMATS = [
  { id: "post", label: "Publicación para redes", brief: "Escribe una publicación para redes sociales, con gancho inicial, cuerpo breve y llamada a la acción." },
  { id: "guion", label: "Guion para vídeo", brief: "Escribe un guion para un vídeo de 60 segundos, marcando lo que se dice y lo que se ve en cada plano." },
  { id: "correo", label: "Correo", brief: "Escribe un correo profesional listo para enviar, con asunto y despedida." },
  { id: "articulo", label: "Artículo", brief: "Escribe un artículo con titular, entradilla, subtítulos y cierre." },
  { id: "respuesta", label: "Respuesta a un cliente", brief: "Escribe una respuesta a un cliente, resolutiva y amable." },
];

const TABS: Array<{ id: AvatarTab; n: string; label: string; short: string; icon: LucideIcon }> = [
  { id: "perfil", n: "1", label: "Tu perfil", short: "Perfil", icon: User },
  { id: "escribir", n: "2", label: "Escribir como tú", short: "Escribir", icon: PenLine },
  { id: "video", n: "3", label: "Crear vídeo", short: "Vídeo", icon: Video },
  { id: "ajustes", n: "", label: "Ajustes", short: "Ajustes", icon: Settings2 },
];

export function AvatarView() {
  const [settings] = useSettings();
  const [persona, setPersona] = useState<Persona>(EMPTY);
  const [tab, setTab] = usePersistentState<AvatarTab>("avatar:pestana", "perfil");
  const [topic, setTopic] = usePersistentState("avatar:tema", "");
  const [format, setFormat] = useState(FORMATS[0]!.id);
  const [result, setResult] = usePersistentState("avatar:resultado", "");
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [available, setAvailable] = useState<string[]>([]);
  const [scriptNonce, setScriptNonce] = useState(0);
  const photoRef = useRef<HTMLInputElement>(null);
  const speech = useRef<SpeechHandle | null>(null);
  const abort = useRef<AbortController | null>(null);
  const photoSize = usePhotoSize(persona.photo);
  useBackgroundReport({ id: "avatar-texto", title: "Mi yo en IA", view: "avatar", running, detail: "Escribiendo con tu estilo…" });

  useEffect(() => {
    setPersona(readPersona());
    void aiService.models(settings.endpoint).then((r) => { if (r.ok) setAvailable(r.data.map((m) => m.name)); });
    return () => speech.current?.stop();
  }, [settings.endpoint]);

  const current: AvatarTab = TABS.some((t) => t.id === tab) ? tab : "perfil";
  const profileDone = !!persona.photo && !!(persona.name.trim() || persona.sample.trim());
  const profileHasStyle = !!(persona.name.trim() || persona.role.trim() || persona.sample.trim());
  const script = result.startsWith("⚠️") ? "" : result;

  /** Guarda el perfil en este equipo. Devuelve si se pudo guardar (el almacenamiento del navegador tiene límite). */
  const persist = (next: Persona): boolean => {
    setPersona(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  };
  const save = (next: Persona) => {
    if (!persist(next)) pushNotice("No se ha podido guardar en este equipo: el almacenamiento del navegador está lleno.", "warn");
  };
  const pickPhoto = async (file: File) => {
    try {
      if (persist({ ...persona, photo: await shrinkImage(file, 1024, 0.88) })) return pushNotice("Foto guardada.", "success");
      if (persist({ ...persona, photo: await shrinkImage(file, 640, 0.85) })) return pushNotice("Foto guardada algo más pequeña para que quepa en este equipo.", "info");
      pushNotice("La foto era muy grande y no se ha podido guardar.", "warn");
    } catch {
      pushNotice("No he podido leer esa imagen. Prueba con una foto JPG o PNG.", "warn");
    }
  };

  const personaBrief = () =>
    [
      persona.name ? `Me llamo ${persona.name}.` : "",
      persona.role ? `Me dedico a: ${persona.role}.` : "",
      persona.tone ? `Mi tono es ${persona.tone}.` : "",
      persona.topics ? `Mis temas habituales: ${persona.topics}.` : "",
      persona.sample ? `Así escribo yo (imita este estilo, no lo copies literalmente):\n"""${persona.sample}"""` : "",
    ].filter(Boolean).join("\n");

  const generate = async () => {
    if (!topic.trim() || running) return;
    setRunning(true);
    setResult("");
    const controller = new AbortController();
    abort.current = controller;
    const fmt = FORMATS.find((f) => f.id === format)!;
    const res = await runTask({
      endpoint: settings.endpoint,
      kind: "escritura",
      preferred: settings.model,
      available,
      signal: controller.signal,
      context: `Perfil del propietario (escribe SIEMPRE en primera persona, como si fuera él):\n${personaBrief()}`,
      prompt: `${fmt.brief}\n\nTema: ${topic}\n\nEscribe en español de España, en primera persona y con mi voz. Nada de frases genéricas de plantilla.`,
      onDelta: (d) => setResult((r) => r + d),
    });
    setRunning(false);
    abort.current = null;
    if (!res.ok) {
      setResult(`⚠️ ${res.error}`);
      pushNotice(`⚠️ ${res.error}`, "warn");
      return;
    }
    setResult(res.data.text);
    pushNotice("Contenido generado con tu estilo.", "success");
  };

  const toggleSpeech = () => {
    if (speaking) {
      speech.current?.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    const naturalVoice = window.localStorage.getItem("willy-voz-natural") ?? "";
    speech.current = speakBest(result, {
      ...(naturalVoice ? { naturalVoice } : {}),
      onEnd: () => setSpeaking(false),
      onError: (m) => { setSpeaking(false); pushNotice(`⚠️ ${m}`, "warn"); },
    });
  };

  /** «Usar en un vídeo»: el texto pasa al paso 3 de «Crear vídeo» (voz de WILLY leyendo el texto). */
  const sendToVideo = () => {
    setScriptNonce((n) => n + 1);
    setTab("video");
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><User className="size-4 text-primary" />Tu doble digital</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Rellena tu perfil una vez. Después WILLY escribe textos como si fueras tú y crea vídeos con tu cara, tu movimiento y la voz que elijas. Todo se hace y se guarda en este equipo.</p>
        </div>
        <div role="tablist" aria-label="Apartados de Mi yo en IA" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TABS.map((t) => {
            const active = current === t.id;
            const done = t.id === "perfil" ? profileDone : t.id === "escribir" ? !!script.trim() && !running : false;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${active ? "border-primary bg-accent/60 text-foreground" : "border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground"}`}
              >
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-emerald-500/15 text-emerald-600" : active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                  {done ? <Check className="size-3.5" /> : t.n ? t.n : <Icon className="size-3.5" />}
                </span>
                <span className="truncate font-semibold"><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* =============================================================== 1 · TU PERFIL */}
      <div hidden={current !== "perfil"} className="space-y-4">
        <Card className="space-y-4">
          <div>
            <p className="text-sm font-semibold">1 · Tu perfil</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Tu foto es la cara del vídeo (pestaña 3) y el resto sirve para escribir con tu estilo (pestaña 2). Se guarda sola, solo en este navegador.</p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex flex-col items-center gap-2 sm:w-36">
              <div className="flex size-32 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary">
                {persona.photo
                  ? <img src={persona.photo} alt="Tu foto" className="size-full object-cover" />
                  : <ImageIcon className="size-8 text-muted-foreground" />}
              </div>
              <div className="flex gap-1">
                <Button variant="secondary" size="sm" className="gap-1" onClick={() => photoRef.current?.click()}>
                  <Upload className="size-3.5" />{persona.photo ? "Cambiar" : "Subir foto"}
                </Button>
                {persona.photo && (
                  <Button variant="ghost" size="sm" aria-label="Quitar la foto" onClick={() => save({ ...persona, photo: "" })}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
              <input
                ref={photoRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void pickPhoto(file);
                }}
              />
              <p className="text-center text-[11px] leading-4 text-muted-foreground">De frente, nítida y con luz suave.</p>
              {photoSize && Math.max(photoSize.w, photoSize.h) < 900 && (
                <p className="text-center text-[11px] leading-4 text-amber-600">Es pequeña ({photoSize.w}×{photoSize.h} px): súbela otra vez para que el vídeo salga más nítido.</p>
              )}
            </div>

            <div className="grid flex-1 content-start gap-3 sm:grid-cols-2">
              <Labeled label="Cómo te llamas">
                <input value={persona.name} onChange={(e) => save({ ...persona, name: e.target.value })} placeholder="Tu nombre" className={field} />
              </Labeled>
              <Labeled label="A qué te dedicas">
                <input value={persona.role} onChange={(e) => save({ ...persona, role: e.target.value })} placeholder="Ej.: abogado, profesora, diseñador…" className={field} />
              </Labeled>
              <Labeled label="Tu tono">
                <input value={persona.tone} onChange={(e) => save({ ...persona, tone: e.target.value })} placeholder="Cercano, técnico, con humor…" className={field} />
              </Labeled>
              <Labeled label="Temas de los que hablas">
                <input value={persona.topics} onChange={(e) => save({ ...persona, topics: e.target.value })} placeholder="Ej.: derecho laboral, viajes, cocina…" className={field} />
              </Labeled>
            </div>
          </div>

          <Labeled label="Un texto tuyo (así WILLY aprende tu forma de escribir)">
            <textarea
              value={persona.sample}
              onChange={(e) => save({ ...persona, sample: e.target.value })}
              placeholder="Pega un correo, un post o una nota tuya. Cuanto más auténtico, más se parecerá a ti."
              className={`h-28 ${area}`}
            />
          </Labeled>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="size-3.5 text-emerald-600" />Se guarda solo, en este equipo.</p>
            <Button size="sm" className="gap-1.5" onClick={() => setTab("escribir")}>Siguiente: escribir como tú<ArrowRight className="size-3.5" /></Button>
          </div>
        </Card>
      </div>

      {/* =============================================================== 2 · ESCRIBIR COMO TÚ */}
      <div hidden={current !== "escribir"} className="space-y-4">
        <Card className="space-y-4">
          <div>
            <p className="text-sm font-semibold">2 · Escribir como tú</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Elige qué quieres y di sobre qué. WILLY lo escribe en primera persona, con tu tono y tu estilo, usando tu perfil y tu motor de IA.</p>
          </div>
          {!profileHasStyle && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs leading-5">
              Tu perfil está casi vacío: rellénalo (sobre todo «Un texto tuyo») para que suene de verdad a ti.{" "}
              <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setTab("perfil")}>Ir a Tu perfil</button>
            </p>
          )}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">¿Qué quieres escribir?</p>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormat(f.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    format === f.id ? "border-primary bg-accent/60 text-foreground" : "border-border text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <Labeled label="¿Sobre qué? Cuéntaselo con tus palabras">
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ej.: anuncia que en octubre abro plazas para asesorías y que la primera consulta es gratis."
              className={`h-24 ${area}`}
            />
          </Labeled>
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button variant="outline" className="gap-2" onClick={() => { abort.current?.abort(); setRunning(false); }}>
                <Square className="size-4" />Detener
              </Button>
            ) : (
              <Button className="gap-2" onClick={() => void generate()} disabled={!topic.trim()}>
                <Play className="size-4" />Generar
              </Button>
            )}
            <ClarifyButton context="prompt" compact variant="secondary" label="Que la IA lo entienda exactamente" value={topic} onApply={setTopic} />
            {running && <Loader2 className="size-5 animate-spin text-primary" />}
          </div>
        </Card>

        {result && (
          <Card className="space-y-3">
            <p className="text-sm font-semibold">Resultado</p>
            <div className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm leading-relaxed">{result}</div>
            <div className="flex flex-wrap gap-2">
              <Button className="gap-2" disabled={running || !script.trim()} onClick={sendToVideo}>
                <Video className="size-4" />Usar en un vídeo
              </Button>
              <Button variant={speaking ? "outline" : "secondary"} className="gap-2" onClick={toggleSpeech}>
                {speaking ? <Square className="size-4" /> : <Volume2 className="size-4" />}
                {speaking ? "Parar" : "Escuchar"}
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => { void navigator.clipboard.writeText(result); pushNotice("Copiado.", "success"); }}
              >
                <Copy className="size-4" />Copiar
              </Button>
              <Button
                variant="ghost"
                className="gap-2"
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([result], { type: "text/plain;charset=utf-8" }));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "contenido.txt";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="size-4" />Descargar
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* =============================================================== 3 · CREAR VÍDEO y AJUSTES */}
      <AvatarStudio tab={current} onTab={setTab} script={script} scriptNonce={scriptNonce} savedPhoto={persona.photo} />
    </div>
  );
}
