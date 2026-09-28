/**
 * avatar-character-view.tsx — Sección «Crea tu avatar IA»
 * 4 pestañas: Personaje | Generar | Flujos ComfyUI | Movimiento
 * Incluye descargador de modelos con SDXL-Lightning pre-configurado.
 */
import { useState, useRef } from "react";
import { Download, Folder, Image, Play, RefreshCw, User, Video, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHead as Head } from "@/components/section-ui";

// ——— Tipos ———

type Tab = "personaje" | "generar" | "flujos" | "movimiento";

const MODEL_FOLDERS = ["checkpoints", "loras", "vae", "controlnet", "upscale_models", "embeddings"] as const;
type ModelFolder = (typeof MODEL_FOLDERS)[number];

type InstallState = {
  status: "idle" | "downloading" | "done" | "error";
  progress: number;
  downloaded: number;
  total: number;
  error?: string;
};

// ——— Helpers ———

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ——— Sub-componentes ———

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: typeof User }[] = [
    { id: "personaje", label: "Personaje", icon: User },
    { id: "generar", label: "Generar imagen", icon: Image },
    { id: "flujos", label: "Flujos ComfyUI", icon: Play },
    { id: "movimiento", label: "Movimiento", icon: Video },
  ];
  return (
    <div className="flex gap-1 border-b border-border pb-1 mb-4">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-sm transition-colors ${
            active === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Icon className="w-4 h-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ——— Tab Personaje (configurar identidad del avatar) ———

function PersonajeTab() {
  const [name, setName] = useState("Mi Avatar");
  const [style, setStyle] = useState("realista");
  const [gender, setGender] = useState("neutro");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Define la identidad visual de tu avatar IA. Estos datos se usarán al generar imágenes y vídeos.
      </p>

      <div className="space-y-3">
        <label className="block text-sm font-medium">
          Nombre del avatar
          <input
            className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="block text-sm font-medium">
          Estilo visual
          <select
            className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          >
            <option value="realista">Realista / fotográfico</option>
            <option value="anime">Anime / ilustración</option>
            <option value="cartoon">Cartoon / 3D stylized</option>
            <option value="pixel">Pixel art</option>
          </select>
        </label>

        <label className="block text-sm font-medium">
          Género visual
          <select
            className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
          >
            <option value="neutro">Neutro</option>
            <option value="masculino">Masculino</option>
            <option value="femenino">Femenino</option>
          </select>
        </label>
      </div>

      <Button onClick={handleSave} size="sm">
        {saved ? "✓ Guardado" : "Guardar identidad"}
      </Button>
    </div>
  );
}

// ——— Tab Generar (texto → imagen con ComfyUI) ———

function GenerarTab() {
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("blurry, bad anatomy, ugly, watermark");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "personaje-generar", prompt, negative }),
      });
      const data = await res.json();
      if (data.ok && data.imageUrl) {
        setResult(data.imageUrl);
      } else {
        setError(data.error ?? "Error desconocido al generar imagen.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Genera una imagen de tu avatar con ComfyUI usando el modelo instalado. Necesitas ComfyUI corriendo y un modelo de imagen.
      </p>

      <label className="block text-sm font-medium">
        Prompt (descripción)
        <textarea
          rows={3}
          className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          placeholder="A professional portrait of a person, studio lighting, 8k..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>

      <label className="block text-sm font-medium">
        Prompt negativo
        <input
          className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
        />
      </label>

      <Button onClick={handleGenerate} disabled={loading || !prompt.trim()} size="sm">
        {loading ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Generando...</> : <><Wand2 className="w-4 h-4 mr-1" /> Generar imagen</>}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <div className="mt-2">
          <img src={result} alt="Avatar generado" className="rounded max-w-full border border-border" />
        </div>
      )}
    </div>
  );
}

// ——— Tab Flujos ComfyUI (descargador de modelos) ———

function FlujosComiUITab() {
  // Sugerencia por defecto (26/09, elegida por Antonio: «SDXL Turbo/Lightning»): SDXL-Lightning de ByteDance
  const [modelUrl, setModelUrl] = useState("https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step_unet.safetensors");
  const [modelFolder, setModelFolder] = useState<ModelFolder>("checkpoints");
  const [modelFilename, setModelFilename] = useState("sdxl_lightning_4step.safetensors");
  const [jobId, setJobId] = useState<string | null>(null);
  const [install, setInstall] = useState<InstallState>({ status: "idle", progress: 0, downloaded: 0, total: 0 });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startDownload = async () => {
    if (!modelUrl.trim() || !modelFilename.trim()) return;
    setInstall({ status: "downloading", progress: 0, downloaded: 0, total: 0 });

    try {
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "model-install", url: modelUrl, folder: modelFolder, filename: modelFilename }),
      });
      const data = await res.json();
      if (!data.ok) {
        setInstall((s) => ({ ...s, status: "error", error: data.error ?? "Error iniciando descarga" }));
        return;
      }
      setJobId(data.jobId);
      // Polling cada segundo
      pollRef.current = setInterval(async () => {
        try {
          const r2 = await fetch("/api/avatar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "model-install-status", jobId: data.jobId }),
          });
          const d2 = await r2.json();
          setInstall({
            status: d2.status,
            progress: d2.progress ?? 0,
            downloaded: d2.downloaded ?? 0,
            total: d2.total ?? 0,
            error: d2.error,
          });
          if (d2.status === "done" || d2.status === "error") stopPoll();
        } catch {}
      }, 1000);
    } catch (e: unknown) {
      setInstall({ status: "error", progress: 0, downloaded: 0, total: 0, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const cancelDownload = async () => {
    stopPoll();
    if (jobId) {
      await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "model-install-cancel", jobId }),
      }).catch(() => {});
    }
    setInstall({ status: "idle", progress: 0, downloaded: 0, total: 0 });
    setJobId(null);
  };

  const isRunning = install.status === "downloading";
  const isDone = install.status === "done";
  const isError = install.status === "error";

  return (
    <div className="space-y-4 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Descarga un modelo de imagen directamente en la carpeta de ComfyUI. El modelo por defecto es{" "}
        <strong>SDXL-Lightning</strong> (ByteDance, Apache 2.0, ~6,9 GB) — rápido, sin login y listo para usar.<br />
        También puedes usar <em>dreamshaper_8.safetensors</em> (Stability AI) o cualquier otro checkpoint .safetensors.
      </p>

      <div className="space-y-3 border border-border rounded-lg p-4 bg-muted/30">
        <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" /> Descargar un modelo
        </p>

        <label className="block text-sm font-medium">
          URL de descarga directa
          <input
            className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono text-xs"
            value={modelUrl}
            onChange={(e) => setModelUrl(e.target.value)}
            disabled={isRunning}
          />
        </label>

        <div className="flex gap-3">
          <label className="block text-sm font-medium flex-1">
            Carpeta en models/
            <select
              className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
              value={modelFolder}
              onChange={(e) => setModelFolder(e.target.value as ModelFolder)}
              disabled={isRunning}
            >
              {MODEL_FOLDERS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium flex-1">
            Nombre de archivo
            <input
              className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
              value={modelFilename}
              onChange={(e) => setModelFilename(e.target.value)}
              disabled={isRunning}
            />
          </label>
        </div>

        {/* Barra de progreso */}
        {(isRunning || isDone) && (
          <div className="space-y-1">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${install.progress < 0 ? 50 : install.progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {install.progress < 0
                ? `Descargando… ${fmtBytes(install.downloaded)}`
                : `${install.progress}% — ${fmtBytes(install.downloaded)}${install.total > 0 ? ` / ${fmtBytes(install.total)}` : ""}`}
            </p>
          </div>
        )}

        {isDone && (
          <p className="text-sm text-green-600 font-medium">✓ Modelo descargado correctamente.</p>
        )}
        {isError && (
          <p className="text-sm text-destructive">Error: {install.error}</p>
        )}

        <div className="flex gap-2">
          {!isRunning ? (
            <Button onClick={startDownload} size="sm" disabled={!modelUrl.trim() || !modelFilename.trim()}>
              <Download className="w-4 h-4 mr-1" /> Descargar
            </Button>
          ) : (
            <Button onClick={cancelDownload} size="sm" variant="outline">
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground border border-border rounded-lg p-3 bg-muted/20 space-y-1">
        <p className="font-medium">¿Dónde instala ComfyUI?</p>
        <p>Los archivos se descargan en la carpeta <code>models/{modelFolder}/</code> dentro del directorio de ComfyUI configurado en Ajustes.</p>
        <p>Si ComfyUI está corriendo, reinícialo para que detecte el nuevo modelo.</p>
      </div>
    </div>
  );
}

// ——— Tab Movimiento (próximamente) ———

function MovimientoTab() {
  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Anima tu avatar generado: lip-sync con audio, movimiento facial en tiempo real y generación de vídeo.
        Esta fase estará disponible una vez tengas un modelo de imagen instalado y probado.
      </p>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
        <Video className="w-8 h-8 mx-auto mb-2 opacity-40" />
        Próximamente — Fase 2
        <p className="mt-1 text-xs">Requiere: modelo de imagen instalado + pipeline de vídeo (AnimateDiff / SadTalker)</p>
      </div>
    </div>
  );
}

// ——— Componente principal ———

export function AvatarCharacterView() {
  const [tab, setTab] = useState<Tab>("personaje");

  return (
    <div className="flex flex-col h-full overflow-auto">
      <Head
        title="Crea tu avatar IA"
        desc="Diseña, genera y anima tu identidad visual con IA local"
      />

      <div className="flex-1 p-4">
        <TabBar active={tab} onChange={setTab} />

        {tab === "personaje" && <PersonajeTab />}
        {tab === "generar" && <GenerarTab />}
        {tab === "flujos" && <FlujosComiUITab />}
        {tab === "movimiento" && <MovimientoTab />}
      </div>
    </div>
  );
}
