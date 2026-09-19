// Mi yo en IA: tu foto, tu vídeo, tu voz y tu forma de escribir, para que la IA
// genere contenido como si lo hicieras tú.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Download, Image as ImageIcon, Loader2, Play, Square, Trash2, Upload, User, Video, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushNotice } from "@/lib/notifications";
import { useSettings } from "@/lib/workspace-store";
import { aiService } from "@/services/ai-service";
import { runTask } from "@/services/orchestrator";
import { SPANISH_VOICES, speakText, type SpeechHandle } from "@/lib/tts-voice";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}</div>;
}

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

/** Reduce la foto para que quepa en el equipo sin ocupar de más. */
async function shrinkImage(file: File, max = 512): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

const FORMATS = [
  { id: "post", label: "Publicación para redes", brief: "Escribe una publicación para redes sociales, con gancho inicial, cuerpo breve y llamada a la acción." },
  { id: "guion", label: "Guion para vídeo", brief: "Escribe un guion para un vídeo de 60 segundos, marcando lo que se dice y lo que se ve en cada plano." },
  { id: "correo", label: "Correo", brief: "Escribe un correo profesional listo para enviar, con asunto y despedida." },
  { id: "articulo", label: "Artículo", brief: "Escribe un artículo con titular, entradilla, subtítulos y cierre." },
  { id: "respuesta", label: "Respuesta a un cliente", brief: "Escribe una respuesta a un cliente, resolutiva y amable." },
];

export function AvatarView() {
  const [settings] = useSettings();
  const [persona, setPersona] = useState<Persona>(EMPTY);
  const [video, setVideo] = useState<{ url: string; name: string } | null>(null);
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState(FORMATS[0]!.id);
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [available, setAvailable] = useState<string[]>([]);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const speech = useRef<SpeechHandle | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setPersona(readPersona());
    void aiService.models(settings.endpoint).then((r) => { if (r.ok) setAvailable(r.data.map((m) => m.name)); });
    return () => speech.current?.stop();
  }, [settings.endpoint]);

  const save = (next: Persona) => {
    setPersona(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      pushNotice("La foto era muy grande y no se ha podido guardar.", "warn");
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
    speech.current = speakText(result, {
      voice: persona.voice,
      onEnd: () => setSpeaking(false),
      onError: (m) => { setSpeaking(false); pushNotice(`⚠️ ${m}`, "warn"); },
    });
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <p className="text-sm font-semibold"><User className="mr-2 inline size-4 text-primary" />Tu identidad</p>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex flex-col items-center gap-2">
            <div className="flex size-28 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary">
              {persona.photo
                ? <img src={persona.photo} alt="Tu foto" className="size-full object-cover" />
                : <ImageIcon className="size-8 text-muted-foreground" />}
            </div>
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" className="gap-1" onClick={() => photoRef.current?.click()}>
                <Upload className="size-3.5" />Foto
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
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) save({ ...persona, photo: await shrinkImage(file) });
              }}
            />
          </div>

          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <input
              value={persona.name}
              onChange={(e) => save({ ...persona, name: e.target.value })}
              placeholder="Tu nombre"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <input
              value={persona.role}
              onChange={(e) => save({ ...persona, role: e.target.value })}
              placeholder="A qué te dedicas"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <input
              value={persona.tone}
              onChange={(e) => save({ ...persona, tone: e.target.value })}
              placeholder="Tu tono: cercano, técnico, con humor…"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <select
              value={persona.voice}
              onChange={(e) => save({ ...persona, voice: e.target.value })}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              aria-label="Tu voz"
            >
              {SPANISH_VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.name} · {v.gender} · {v.desc}</option>
              ))}
            </select>
            <input
              value={persona.topics}
              onChange={(e) => save({ ...persona, topics: e.target.value })}
              placeholder="Temas de los que hablas"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary sm:col-span-2"
            />
          </div>
        </div>

        <textarea
          value={persona.sample}
          onChange={(e) => save({ ...persona, sample: e.target.value })}
          placeholder="Pega aquí un texto tuyo (un correo, un post, una nota). Cuanto más auténtico, más se parecerá a ti."
          className="h-28 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
        />

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Vídeo de referencia (opcional)</p>
          {video ? (
            <div className="space-y-2">
              <video src={video.url} controls className="max-h-56 w-full rounded-lg border border-border" />
              <div className="flex items-center gap-2">
                <span className="truncate text-xs text-muted-foreground">{video.name}</span>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => { URL.revokeObjectURL(video.url); setVideo(null); }}>
                  <Trash2 className="size-3.5" />Quitar
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="gap-2" onClick={() => videoRef.current?.click()}>
              <Video className="size-4" />Subir vídeo
            </Button>
          )}
          <input
            ref={videoRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setVideo({ url: URL.createObjectURL(file), name: file.name });
            }}
          />
          <p className="text-xs text-muted-foreground">
            El vídeo se queda en tu equipo y sirve de referencia de tu forma de hablar y de tu imagen.
          </p>
        </div>
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-semibold">Generar contenido con tu voz</p>
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
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="¿Sobre qué quieres que hable? Ej.: por qué automatizar el soporte ahorra dinero"
          className="h-24 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
        />
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button variant="outline" className="gap-2" onClick={() => { abort.current?.abort(); setRunning(false); }}>
              <Square className="size-4" />Detener
            </Button>
          ) : (
            <Button className="gap-2" onClick={() => void generate()} disabled={!topic.trim()}>
              <Play className="size-4" />Generar
            </Button>
          )}
          {running && <Loader2 className="size-5 animate-spin self-center text-primary" />}
        </div>
      </Card>

      {result && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold">Resultado</p>
          <div className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm leading-relaxed">{result}</div>
          <div className="flex flex-wrap gap-2">
            <Button variant={speaking ? "outline" : "secondary"} className="gap-2" onClick={toggleSpeech}>
              {speaking ? <Square className="size-4" /> : <Volume2 className="size-4" />}
              {speaking ? "Parar" : "Escucharlo con tu voz"}
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
  );
}
