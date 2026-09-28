/**
 * avatar-character-view.tsx — «Crea tu avatar IA»
 * Vista unificada: Personaje · Generar imagen · Motores (LivePortrait/MuseTalk/…) · Modelos
 *
 * Reutiliza avatar-engines.ts (FAMILIES, NATURAL_TIPS, CHARACTER_TIPS, ROLES) para mostrar
 * información real sobre los motores disponibles en ComfyUI, sin inventar nada.
 */
import { useState, useRef } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, ExternalLink,
  Image, Info, Play, RefreshCw, User, Video, Wand2, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHead as Head } from "@/components/section-ui";
import { FAMILIES, NATURAL_TIPS, CHARACTER_TIPS } from "@/lib/avatar-engines";

// ═══════════════════════════════════════════════════════════════════
// Tipos
// ═══════════════════════════════════════════════════════════════════

type Tab = "personaje" | "generar" | "motores" | "modelos";

const MODEL_FOLDERS = ["checkpoints", "loras", "vae", "controlnet", "upscale_models", "embeddings", "clip_vision", "ipadapter"] as const;
type ModelFolder = (typeof MODEL_FOLDERS)[number];

type InstallState = {
  status: "idle" | "downloading" | "done" | "error";
  progress: number;
  downloaded: number;
  total: number;
  error?: string;
};

// ═══════════════════════════════════════════════════════════════════
// Catálogo de modelos recomendados (imagen realista + identidad)
// ═══════════════════════════════════════════════════════════════════

type ModelPreset = {
  id: string;
  label: string;
  desc: string;
  folder: ModelFolder;
  filename: string;
  url: string;
  size: string;
  license: string;
  recommended?: boolean;
};

const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "realistic-vision-v6",
    label: "Realistic Vision v6 B1",
    desc: "El mejor checkpoint SD1.5 para retratos fotorrealistas. Caras muy naturales, sin artifacts. El más usado para avatares.",
    folder: "checkpoints",
    filename: "realisticVisionV60B1_v51VAE.safetensors",
    url: "https://huggingface.co/SG161222/Realistic_Vision_V6.0_B1_noVAE/resolve/main/Realistic_Vision_V6.0_B1_noVAE.safetensors",
    size: "~2 GB",
    license: "OpenRAIL-M",
    recommended: true,
  },
  {
    id: "juggernaut-xl",
    label: "JuggernautXL v9",
    desc: "Fotorrealismo extremo con SDXL. Requiere más VRAM (8 GB recomendado), pero el resultado es impresionante.",
    folder: "checkpoints",
    filename: "juggernautXL_v9RDPhoto2Lightning.safetensors",
    url: "https://huggingface.co/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL-v9-RDPhoto2-Lightning_4Step-VAE_Incorporated.safetensors",
    size: "~6.5 GB",
    license: "OpenRAIL++",
  },
  {
    id: "dreamshaper-xl",
    label: "DreamShaper XL Turbo",
    desc: "Versátil: realista y artístico. 4-8 pasos, rápido en 6 GB VRAM. Buena opción intermedia.",
    folder: "checkpoints",
    filename: "dreamshaperXL_turboDpmppSDE.safetensors",
    url: "https://huggingface.co/Lykon/dreamshaper-xl-turbo/resolve/main/DreamShaperXL_Turbo_dpmppSDE.safetensors",
    size: "~6.5 GB",
    license: "OpenRAIL++",
  },
  {
    id: "sdxl-lightning",
    label: "SDXL-Lightning (ByteDance)",
    desc: "Ultra rápido: 4 pasos. Calidad aceptable para pruebas. Ya configurado por defecto en WILLY.",
    folder: "checkpoints",
    filename: "sdxl_lightning_4step_unet.safetensors",
    url: "https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step_unet.safetensors",
    size: "~6.9 GB",
    license: "Apache 2.0",
  },
  {
    id: "ip-adapter-sdxl",
    label: "IPAdapter SDXL (identidad)",
    desc: "Mantiene la misma cara entre imágenes usando tu foto de referencia. Imprescindible para un avatar consistente con SDXL.",
    folder: "ipadapter",
    filename: "ip-adapter_sdxl.safetensors",
    url: "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter_sdxl.safetensors",
    size: "~700 MB",
    license: "Apache 2.0",
  },
  {
    id: "ip-adapter-sd15",
    label: "IPAdapter SD1.5 (identidad)",
    desc: "Versión SD1.5 de IPAdapter. Para usar con Realistic Vision y mantener tu cara consistente.",
    folder: "ipadapter",
    filename: "ip-adapter_sd15.safetensors",
    url: "https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter_sd15.safetensors",
    size: "~300 MB",
    license: "Apache 2.0",
  },
];

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ═══════════════════════════════════════════════════════════════════
// TabBar
// ═══════════════════════════════════════════════════════════════════

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: typeof User }[] = [
    { id: "personaje", label: "Personaje", icon: User },
    { id: "generar", label: "Generar imagen", icon: Image },
    { id: "motores", label: "Motores IA", icon: Play },
    { id: "modelos", label: "Descargar modelos", icon: Download },
  ];
  return (
    <div className="flex flex-wrap gap-1 border-b border-border pb-1 mb-4">
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

// ═══════════════════════════════════════════════════════════════════
// Tab Personaje
// ═══════════════════════════════════════════════════════════════════

function PersonajeTab() {
  const [name, setName] = useState("Mi Avatar");
  const [style, setStyle] = useState("realista");
  const [gender, setGender] = useState("neutro");
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-5 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Define la identidad visual de tu avatar. Estos datos guían la generación de imágenes y el pipeline de vídeo.
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

      {/* Consejos de calidad */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium bg-muted/30 hover:bg-muted/50 transition-colors"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="flex items-center gap-2"><Info className="w-4 h-4 text-primary" /> Consejos para el resultado más natural</span>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {open && (
          <ul className="px-4 py-3 space-y-2">
            {NATURAL_TIPS.map((tip, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary mt-0.5">·</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab Generar imagen
// ═══════════════════════════════════════════════════════════════════

function GenerarTab() {
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("blurry, bad anatomy, ugly, watermark, deformed, low quality");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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
      const data = await res.json() as { ok?: boolean; imageUrl?: string; promptId?: string; message?: string; error?: string };
      if (data.ok && data.imageUrl) {
        setResult(data.imageUrl);
      } else if (data.ok && data.message) {
        setError(data.message + (data.promptId ? ` (ID: ${data.promptId})` : ""));
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
      {/* Aviso realista */}
      <div className="border border-amber-500/40 bg-amber-500/10 rounded-lg px-4 py-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
        {CHARACTER_TIPS.slice(0, 2).map((tip, i) => (
          <p key={i}>{tip}</p>
        ))}
      </div>

      <label className="block text-sm font-medium">
        Prompt (descripción de la imagen)
        <textarea
          rows={3}
          className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          placeholder="A professional portrait of a 35-year-old man, studio lighting, 8k, sharp focus, photorealistic..."
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
        {loading
          ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Generando en ComfyUI...</>
          : <><Wand2 className="w-4 h-4 mr-1" /> Generar imagen</>}
      </Button>

      {error && (
        <div className="flex gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {result && (
        <div className="mt-2">
          <img src={result} alt="Avatar generado" className="rounded max-w-full border border-border shadow" />
        </div>
      )}

      {/* Consejos para mejor calidad */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium bg-muted/30 hover:bg-muted/50"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="flex items-center gap-2"><Info className="w-4 h-4 text-primary" /> ¿Por qué sale «cara de IA»?</span>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {open && (
          <ul className="px-4 py-3 space-y-2">
            {CHARACTER_TIPS.slice(2).map((tip, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary mt-0.5">·</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab Motores IA (LivePortrait, MuseTalk, LatentSync, etc.)
// ═══════════════════════════════════════════════════════════════════

function MotoresTab() {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Motores con video output (los más importantes para el usuario)
  const videoFamilies = FAMILIES.filter((f) =>
    ["liveportrait", "musetalk", "latentsync", "wav2lip", "sadtalker", "hallo", "vhs"].includes(f.id)
  );
  const identityFamilies = FAMILIES.filter((f) =>
    ["ipadapter", "instantid", "pulid", "reactor"].includes(f.id)
  );

  const FamilyCard = ({ family, highlight = false }: { family: typeof FAMILIES[0]; highlight?: boolean }) => (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${highlight ? "border-primary/40" : "border-border"}`}
    >
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(expanded === family.id ? null : family.id)}
      >
        <span className="flex items-center gap-2 font-medium">
          {highlight && <Zap className="w-3.5 h-3.5 text-primary" />}
          {family.label}
        </span>
        {expanded === family.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {expanded === family.id && (
        <div className="px-4 pb-4 space-y-3 bg-muted/10">
          <p className="text-xs text-muted-foreground">{family.note}</p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">{family.repo}</code>
            <a
              href={`https://github.com/${family.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0"
            >
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                <ExternalLink className="w-3 h-3" /> GitHub
              </Button>
            </a>
          </div>
          <p className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-2">
            Instala desde <strong>ComfyUI-Manager → Custom Nodes Manager</strong>, busca el nombre del repo y reinicia ComfyUI.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Estos son los motores que WILLY detecta en tu ComfyUI para dar vida al avatar. No se instalan solos — usa <strong>ComfyUI-Manager</strong> para cada uno.
      </p>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
          <Video className="w-3.5 h-3.5" /> Animación y lip-sync (vídeo)
        </p>
        <div className="space-y-2">
          {videoFamilies.map((f) => (
            <FamilyCard key={f.id} family={f} highlight={["liveportrait", "musetalk", "latentsync"].includes(f.id)} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
          <User className="w-3.5 h-3.5" /> Identidad consistente (misma cara)
        </p>
        <div className="space-y-2">
          {identityFamilies.map((f) => (
            <FamilyCard key={f.id} family={f} />
          ))}
        </div>
      </div>

      <div className="border border-primary/30 bg-primary/5 rounded-lg p-4 text-xs space-y-1.5">
        <p className="font-semibold text-foreground">¿Por qué el vídeo sale poco realista?</p>
        <p className="text-muted-foreground">El resultado depende del motor instalado en ComfyUI, del flujo que uses y del modelo de imagen base. Con <strong>LivePortrait + MuseTalk</strong> y un buen checkpoint realista (Realistic Vision v6) el resultado mejora enormemente. Sin esos motores, WILLY solo puede generar imágenes estáticas.</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab Descargar modelos
// ═══════════════════════════════════════════════════════════════════

function ModelosTab() {
  const [selected, setSelected] = useState<ModelPreset>(MODEL_PRESETS[0]!);
  const [customUrl, setCustomUrl] = useState("");
  const [customFolder, setCustomFolder] = useState<ModelFolder>("checkpoints");
  const [customFilename, setCustomFilename] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [install, setInstall] = useState<InstallState>({ status: "idle", progress: 0, downloaded: 0, total: 0 });
  const [jobId, setJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const activeUrl = useCustom ? customUrl : selected.url;
  const activeFolder = useCustom ? customFolder : selected.folder;
  const activeFilename = useCustom ? customFilename : selected.filename;

  const startDownload = async () => {
    if (!activeUrl.trim() || !activeFilename.trim()) return;
    setInstall({ status: "downloading", progress: 0, downloaded: 0, total: 0 });
    try {
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "model-install", url: activeUrl, folder: activeFolder, filename: activeFilename }),
      });
      const data = await res.json() as { ok?: boolean; jobId?: string; error?: string };
      if (!data.ok) { setInstall((s) => ({ ...s, status: "error", error: data.error ?? "Error iniciando descarga" })); return; }
      setJobId(data.jobId ?? null);
      pollRef.current = setInterval(async () => {
        try {
          const r2 = await fetch("/api/avatar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "model-install-status", jobId: data.jobId }),
          });
          const d2 = await r2.json() as { status: string; progress?: number; downloaded?: number; total?: number; error?: string };
          setInstall({ status: d2.status as InstallState["status"], progress: d2.progress ?? 0, downloaded: d2.downloaded ?? 0, total: d2.total ?? 0, error: d2.error ?? "" });
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
      await fetch("/api/avatar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "model-install-cancel", jobId }) }).catch(() => {});
    }
    setInstall({ status: "idle", progress: 0, downloaded: 0, total: 0 });
    setJobId(null);
  };

  const isRunning = install.status === "downloading";
  const isDone = install.status === "done";
  const isError = install.status === "error";

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Descarga modelos directamente en tu ComfyUI. Elige uno del catálogo o pega tu propia URL.
      </p>

      {/* Selector de preset */}
      {!useCustom && (
        <div className="grid gap-2 sm:grid-cols-2">
          {MODEL_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setSelected(preset)}
              className={`text-left border rounded-lg p-3 transition-colors space-y-1 ${
                selected.id === preset.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"
              }`}
              disabled={isRunning}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  {preset.recommended && <Zap className="w-3.5 h-3.5 text-primary" />}
                  {preset.label}
                </span>
                <span className="text-xs text-muted-foreground">{preset.size}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{preset.desc}</p>
              <span className="text-xs text-muted-foreground opacity-60">{preset.license}</span>
            </button>
          ))}
        </div>
      )}

      {/* Toggle URL personalizada */}
      <button
        className="text-xs text-primary hover:underline"
        onClick={() => setUseCustom((v) => !v)}
        disabled={isRunning}
      >
        {useCustom ? "← Volver al catálogo" : "Usar una URL personalizada →"}
      </button>

      {useCustom && (
        <div className="space-y-3 border border-border rounded-lg p-4">
          <label className="block text-sm font-medium">
            URL de descarga directa
            <input
              className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono text-xs"
              placeholder="https://huggingface.co/.../resolve/main/modelo.safetensors"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              disabled={isRunning}
            />
          </label>
          <div className="flex gap-3">
            <label className="block text-sm font-medium flex-1">
              Carpeta (models/)
              <select
                className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                value={customFolder}
                onChange={(e) => setCustomFolder(e.target.value as ModelFolder)}
                disabled={isRunning}
              >
                {MODEL_FOLDERS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium flex-1">
              Nombre de archivo
              <input
                className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                placeholder="modelo.safetensors"
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
                disabled={isRunning}
              />
            </label>
          </div>
        </div>
      )}

      {/* Panel de descarga */}
      <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/20">
        {!useCustom && (
          <div className="text-sm space-y-0.5">
            <p className="font-medium">{selected.label}</p>
            <p className="text-xs text-muted-foreground">→ models/{selected.folder}/{selected.filename}</p>
          </div>
        )}

        {/* Barra de progreso */}
        {(isRunning || isDone) && (
          <div className="space-y-1">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${install.progress < 0 ? 50 : install.progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {install.progress < 0
                ? `Descargando… ${fmtBytes(install.downloaded)}`
                : `${install.progress}% — ${fmtBytes(install.downloaded)}${install.total > 0 ? ` / ${fmtBytes(install.total)}` : ""}`}
            </p>
          </div>
        )}

        {isDone && (
          <p className="text-sm text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Modelo descargado. Reinicia ComfyUI para que lo detecte.
          </p>
        )}
        {isError && (
          <div className="flex gap-2 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{install.error}</span>
          </div>
        )}

        <div className="flex gap-2">
          {!isRunning ? (
            <Button onClick={startDownload} size="sm" disabled={!activeUrl.trim() || !activeFilename.trim()}>
              <Download className="w-4 h-4 mr-1" /> Descargar
            </Button>
          ) : (
            <Button onClick={cancelDownload} size="sm" variant="outline">
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">
        Los archivos se guardan en <code>models/{activeFolder}/</code> dentro de la ruta de ComfyUI configurada en Ajustes.
        Tras descargar, reinicia ComfyUI para que detecte el nuevo modelo.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════════

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
        {tab === "motores" && <MotoresTab />}
        {tab === "modelos" && <ModelosTab />}
      </div>
    </div>
  );
}
