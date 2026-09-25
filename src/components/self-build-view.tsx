import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, Bot, Check, Download, FileUp, Play, Save, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadFile, useSettings } from "@/lib/workspace-store";
import {
  DEFAULT_INSTRUCTIONS,
  EVENT,
  readSelfBuild,
  writeSelfBuild,
  type WillyImprovement,
} from "@/lib/self-build-store";
import { aiService } from "@/services/ai-service";
import type { ChatMsg } from "@/lib/local-ai";
import { APP_VERSION } from "@/lib/version";
import { clearJob, implementImprovement, isRunning, readJob, recoverInterrupted, JOB_EVENT, type SelfBuildJob } from "@/lib/self-build-runner";
import { looksLikeRefusal } from "@/lib/ai-standard";
import { askChatCloud } from "@/lib/chat-cloud";
import { cloudChat, engineStatus } from "@/lib/engines-client";
import { ok, type Ping, type ServiceResult } from "@/types/domain";
import { listLocalModels } from "@/lib/local-ai";
import { VISION_PROMPT, describeWithRelay, prepareImage, type PreparedImage } from "@/lib/vision";
import { visionModelsOf } from "@/lib/capabilities";
import { ImageChips } from "@/components/image-chips";
import { EnginesPanel } from "@/components/engines-panel";
import { EvidencePanel } from "@/components/evidence-panel";
import { BridgeBox } from "@/components/bridge-box";
import { cleanChecks, deriveChecks } from "@/lib/evidence";
import { ClarifyButton } from "@/components/clarify-button";
import { OwnerLessonsCard } from "@/components/owner-lessons-card";
import { loadOwnerBrain, saveOwnerInstructions } from "@/lib/owner-brain";
import { usePersistentState } from "@/lib/persistent-state";
import { lessonStats, readLessons, removeLesson, setVerdict, writeLessons, type Lesson } from "@/lib/learning";
import { buildClaudePack } from "@/lib/claude-pack";
import { TRUTH_RULE, constitutionFor } from "@/lib/owner-constitution";
import { formatDuration } from "@/services/estimator";
import { useBackgroundReport } from "@/lib/background-tasks";
import { SELF_BUILD_TABS, SelfBuildHistory, SelfBuildTabs, SelfBuildVersions, type SelfBuildTab } from "@/components/self-build-panels";
import { SelfBuildModules, SelfBuildRoadmap, SelfBuildTasks, SelfBuildVision } from "@/components/self-build-roadmap";
import { LogsCard } from "@/components/settings-view";
import { useSectionTab } from "@/lib/section-tabs";

const SELF_BUILD_TAB_IDS: readonly SelfBuildTab[] = SELF_BUILD_TABS.map((entry) => entry.id);

export function SelfBuildView({ ping }: { ping: Ping }) {
  const [settings] = useSettings();
  const [state, setState] = useState(readSelfBuild);
  // Texto que se está editando: no se pierde cuando el trabajo en marcha actualiza el resto del estado.
  const [draft, setDraft] = useState(() => readSelfBuild().instructions);
  const [request, setRequest] = usePersistentState("autoconstruccion:peticion", "");
  // Archivos que el dueño sube para indicar la parte exacta que quiere modificar.
  const [attached, setAttached] = useState<{ name: string; content: string }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  // Capturas de pantalla pegadas (Win+Shift+S y Ctrl+V) o subidas: se guardan solo mientras se prepara la mejora.
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [stage, setStage] = useState("");
  const [mustShow, setMustShow] = usePersistentState("autoconstruccion:debe-aparecer", "");
  const [mustHide, setMustHide] = usePersistentState("autoconstruccion:debe-desaparecer", "");
  // Subapartados de la maqueta: VISIÓN · ROADMAP · MÓDULOS · TAREAS · CAMBIOS · VERSIÓN · LOGS, y «Nueva mejora» (el formulario de
  // siempre). Se recuerda entre visitas y se puede abrir directamente en una pestaña (p. ej. Ajustes → Almacenamiento → «Versiones»).
  const [tab, setTab] = useSectionTab<SelfBuildTab>("autoconstruccion", SELF_BUILD_TAB_IDS, "vision");

  const addImages = async (files: File[]) => {
    const room = 3 - images.length;
    if (room <= 0) { ping("Puedes adjuntar hasta 3 capturas."); return; }
    const next = [...images];
    for (const file of files.slice(0, room)) {
      try {
        next.push(await prepareImage(file, `captura-${next.length + 1}.jpg`));
      } catch (error) {
        ping(`No pude leer esa imagen: ${error instanceof Error ? error.message : "formato no compatible"}.`);
      }
    }
    setImages(next);
    if (next.length > images.length) ping("Captura añadida. Un modelo con visión la leerá al pulsar «Crear e implementar».");
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const pictures = Array.from(list).filter((file) => file.type.startsWith("image/"));
    if (pictures.length) await addImages(pictures);
    if (pictures.length === list.length) return;
    const next = [...attached];
    let total = next.reduce((sum, entry) => sum + entry.content.length, 0);
    for (const file of Array.from(list).filter((entry) => !entry.type.startsWith("image/")).slice(0, 6)) {
      if (file.size > 400_000) { ping(`«${file.name}» es demasiado grande. Sube solo la parte que quieres modificar.`); continue; }
      let text = await file.text();
      if (text.includes("\u0000")) { ping(`«${file.name}» no parece un archivo de texto.`); continue; }
      if (text.length > 20_000) { text = text.slice(0, 20_000); ping(`«${file.name}» era muy largo: se han subido sus primeros 20.000 caracteres. Sube solo la parte que quieres cambiar.`); }
      if (total + text.length > 24_000) { ping(`No cabe «${file.name}»: ya hay demasiado texto adjunto.`); continue; }
      total += text.length;
      next.push({ name: file.name, content: text });
    }
    setAttached(next);
  };
  const [working, setWorking] = useState(false);
  const [job, setJob] = useState<SelfBuildJob | null>(readJob);
  const stateRef = useRef(state);
  // La mejora sigue en segundo plano si cambias de pestaña; te avisa arriba a la derecha con su progreso y al terminar.
  useBackgroundReport({
    id: "autoconstruccion",
    title: "Autoconstrucción",
    view: "autoconstruccion",
    running: Boolean(job && !job.done),
    detail: job ? `${job.step} · ${job.pct}%` : "Trabajando…",
    ...(job?.done && job.error ? { error: job.error } : {}),
  });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const sync = () => setState(readSelfBuild());
    const syncJob = () => setJob(readJob());
    window.addEventListener(EVENT, sync);
    window.addEventListener(JOB_EVENT, syncJob);
    // Una mejora que se quedó «en curso» por un cierre del programa vuelve a poder reintentarse.
    if (recoverInterrupted()) sync();
    syncJob();
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener(JOB_EVENT, syncJob);
    };
  }, []);

  const persist = (next: typeof state) => {
    stateRef.current = next;
    setState(next);
    writeSelfBuild(next);
  };

  /** Guarda las instrucciones sobre el estado más reciente, sin pisar lo que el trabajo en marcha haya escrito. También en tu equipo, para el móvil y todos los chats. */
  const saveInstructions = (value: string) => {
    const latest = readSelfBuild();
    persist({ ...latest, instructions: value });
    void saveOwnerInstructions(value);
  };
  useEffect(() => { void loadOwnerBrain(); }, []);

  const saveDraft = () => {
    const value = draft.trim() ? draft : DEFAULT_INSTRUCTIONS;
    setDraft(value);
    saveInstructions(value);
    ping("Instrucciones permanentes guardadas.");
  };

  const resetDraft = () => {
    setDraft(DEFAULT_INSTRUCTIONS);
    saveInstructions(DEFAULT_INSTRUCTIONS);
    ping("Instrucciones restablecidas a las de fábrica.");
  };

  const propose = async () => {
    if (!request.trim()) return ping("Describe primero la mejora que quieres para WILLY.");
    setWorking(true);
    // Los modelos que programan solo entienden texto: un modelo con visión describe antes cada captura.
    const shots: { name: string; description: string }[] = [];
    if (images.length) {
      // Si un modelo de visión no arranca (p. ej. «mllama» con una versión antigua de Ollama) se prueba el siguiente;
      // y si ninguno lee la captura, la mejora sigue adelante sin ella: una imagen nunca debe bloquear la Autoconstrucción.
      const models = visionModelsOf(await listLocalModels(settings.endpoint));
      if (!models.length) {
        ping("No hay ningún modelo con visión instalado (por ejemplo gemma3:4b o qwen2.5vl:3b): sigo sin las capturas.");
      } else {
        for (const [index, image] of images.entries()) {
          setStage(`Mirando la captura ${index + 1} de ${images.length}…`);
          const seen = await describeWithRelay(models, image.dataUrl, {
            prompt: VISION_PROMPT,
            onTry: (model) => setStage(`Mirando la captura ${index + 1} de ${images.length} con ${model}…`),
          });
          if (seen.ok) shots.push({ name: image.name, description: seen.text });
          else ping(`⚠️ No pude leer la captura ${index + 1} (${seen.error}). Sigo sin ella.`);
        }
      }
      setStage("");
    }
    const messages: ChatMsg[] = [
      {
        role: "system",
        content: `Eres el arquitecto de mantenimiento de WILLY AI. Solo propones mejoras de la propia aplicación, nunca de los proyectos del usuario. No aplicas cambios directamente. Debes conservar todo lo existente, exigir copia de seguridad, separar riesgos y explicar una comprobación final. Instrucciones permanentes del dueño:\n${readSelfBuild().instructions}\n\n${TRUTH_RULE}\n\n${constitutionFor("autoconstruccion")}`,
      },
      {
        role: "user",
        content: `Prepara una propuesta controlada para esta mejora de WILLY AI: ${request.trim()}${shots.length ? `\n\nLo que muestran las capturas del dueño:\n${shots.map((shot) => shot.description).join("\n---\n")}` : ""}\n\nDevuelve: objetivo, archivos o ajustes afectados, pasos, riesgos, copia de seguridad y validación.`,
      },
    ];
    // La Autoconstrucción SIEMPRE prueba primero la IA externa gratuita que mejor vaya; tu equipo es el último recurso
    // (si no hay ninguna configurada y activada, sigue directamente con tu equipo, como siempre).
    setStage("Preguntando a la IA externa…");
    let engineLabel = "";
    const cloudText = await askChatCloud({
      pick: "externas",
      messages,
      status: engineStatus,
      ask: (id, msgs, maxTokens) => cloudChat(id, msgs, maxTokens),
      notify: ping,
      onText: () => {},
      onAnswered: (engine) => { engineLabel = engine; },
    });
    let result: ServiceResult<string>;
    if (cloudText !== null) {
      result = ok(cloudText);
    } else {
      setStage("Construyendo con tu equipo…");
      result = await aiService.chat({ endpoint: settings.endpoint, model: settings.model, messages });
    }
    setStage("");
    setWorking(false);
    if (!result.ok) return ping(`⚠️ ${result.error}`);
    // Una negativa del modelo («lo siento, no puedo…») nunca se guarda como propuesta:
    // la implementación se hace igualmente desde la petición original.
    const proposal = looksLikeRefusal(result.data)
      ? `Objetivo: ${request.trim()}\n\nNo se generó un análisis previo. WILLY implementa directamente desde tu petición: primero en una versión candidata aparte (compilación, tipos y prueba de arranque) y solo después, con copia verificada, en la versión que funciona.`
      : result.data;
    const improvement: WillyImprovement = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      request: request.trim(),
      proposal,
      status: "pendiente",
      ...(mustShow.trim() || mustHide.trim() ? { checks: cleanChecks({ mustContain: mustShow.trim() ? [mustShow.trim()] : [], mustNotContain: mustHide.trim() ? [mustHide.trim()] : [] }) } : {}),
      ...(attached.length ? { attachments: attached } : {}),
      ...(shots.length ? { screenshots: shots } : {}),
    };
    const latest = readSelfBuild();
    persist({ ...latest, improvements: [improvement, ...latest.improvements].slice(0, 30) });
    setRequest("");
    setAttached([]);
    setImages([]);
    // «Comprobación exacta» es para ESTA mejora: si no se limpia, se queda pegada a todas las siguientes (aunque no
    // tengan nada que ver) y puede exigir para siempre algo que ya no tiene sentido, haciendo fallar cada intento.
    setMustShow("");
    setMustHide("");
    ping(`Propuesta preparada${engineLabel ? ` con ${engineLabel}` : " con tu equipo"}. WILLY empieza a implementarla automáticamente.`);
    await implementImprovement(improvement, { endpoint: settings.endpoint, model: settings.model }, ping);
  };

  // Lo que WILLY va aprendiendo de las mejoras que funcionan (se guarda en este navegador).
  const [lessons, setLessons] = useState<Lesson[]>([]);
  useEffect(() => {
    setLessons(readLessons());
  }, [state, job]);

  const verdictOf = (id: string) => lessons.find((lesson) => lesson.id === id)?.verdict ?? "sin confirmar";
  const mark = (id: string, verdict: "funciona" | "no funciona") => {
    const next = setVerdict(readLessons(), id, verdict);
    writeLessons(next);
    setLessons(next);
    ping(verdict === "funciona" ? "Anotado: WILLY usará esta mejora como ejemplo en las próximas." : "Anotado: WILLY no la usará como ejemplo.");
  };
  const forget = (id: string) => {
    const next = removeLesson(readLessons(), id);
    writeLessons(next);
    setLessons(next);
  };

  /** Prepara un paquete con todo lo necesario para pegárselo a Claude y que haga el cambio por ti. */
  const sendToClaude = async (item: WillyImprovement) => {
    let code = "";
    try {
      const res = await fetch("/api/self-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "context",
          name: item.request,
          proposal: item.proposal,
          attachments: (item.attachments ?? []).map((file) => file.name),
          screenshots: (item.screenshots ?? []).map((shot) => shot.description.slice(0, 600)),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; context?: string };
      if (data.ok) code = data.context ?? "";
    } catch {
      /* se envía sin el código relacionado */
    }
    const pack = buildClaudePack({
      version: APP_VERSION,
      request: item.request,
      proposal: item.proposal,
      status: item.status,
      result: item.result ?? "",
      attachments: item.attachments ?? [],
      screenshots: item.screenshots ?? [],
      code,
    });
    try {
      await navigator.clipboard.writeText(pack);
      ping("Copiado. Pégalo en tu conversación con Claude y te devuelve el cambio hecho.");
    } catch {
      downloadFile("para-claude.txt", pack, "text/plain;charset=utf-8");
      ping("No pude copiar al portapapeles: se ha descargado «para-claude.txt». Pégalo en tu conversación con Claude.");
    }
  };

  /** Construye de verdad la mejora. El trabajo vive fuera de esta pantalla: puedes cambiar de pestaña. */
  const implement = (item: WillyImprovement) => {
    void implementImprovement(item, { endpoint: settings.endpoint, model: settings.model }, ping);
  };

  const remove = (id: string) => {
    if (job?.id === id && !job.done) return ping("Espera a que termine esta mejora antes de eliminarla.");
    const latest = readSelfBuild();
    persist({ ...latest, improvements: latest.improvements.filter((entry) => entry.id !== id) });
    clearJob(id);
    setJob(readJob());
    ping("Propuesta eliminada.");
  };

  const restore = (id: string) => {
    const backup = readSelfBuild().backups.find((entry) => entry.id === id);
    if (!backup) return;
    setDraft(backup.instructions);
    saveInstructions(backup.instructions);
    ping("Instrucciones restauradas desde la copia de seguridad.");
  };

  const exportBackup = () => {
    downloadFile(
      `willy-ai-${APP_VERSION}-configuracion.json`,
      JSON.stringify({ version: APP_VERSION, exportedAt: new Date().toISOString(), ...state }, null, 2),
      "application/json;charset=utf-8",
    );
    ping("Copia de seguridad descargada.");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Autoconstrucción</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Solo para mejorar WILLY AI —su código, front y backend—, nunca tus propios proyectos. Cada cambio se prueba primero en una versión candidata aparte (compila, tipos y arranque): la que funciona no se toca hasta que la candidata lo supera todo, y siempre con copia verificada.</p>
        </div>
        <Button variant="secondary" className="gap-2 self-start" onClick={exportBackup}><Download className="size-4" />Copia de seguridad</Button>
      </div>

      <SelfBuildTabs tab={tab} onChange={setTab} />
      {(tab === "vision" || tab === "salud") && <SelfBuildVision ping={ping} onGo={setTab} />}
      {tab === "roadmap" && <SelfBuildRoadmap />}
      {tab === "modulos" && <SelfBuildModules />}
      {tab === "tareas" && <SelfBuildTasks />}
      {tab === "historial" && <SelfBuildHistory ping={ping} />}
      {tab === "versiones" && <SelfBuildVersions ping={ping} />}
      {tab === "logs" && <LogsCard />}

      {tab === "mejorar" && (<>
      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-1 flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h2 className="text-sm font-semibold">Instrucciones permanentes del dueño</h2></div>
          <p className="mb-2 text-xs text-muted-foreground">Las cumplen TODAS las IA sin excepción (tu equipo y las externas) en el chat del PC, el móvil, Súper IA y la Autoconstrucción.</p>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-44 w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-6 outline-none focus:border-primary"
            aria-label="Instrucciones permanentes"
            rows={10}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button className="gap-2" onClick={saveDraft}><Save className="size-4" />Guardar</Button>
            <Button variant="outline" onClick={resetDraft}>Restablecer</Button>
            <ClarifyButton context="funcion" variant="secondary" label="Que la IA lo entienda exactamente" value={draft} onApply={setDraft} />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-1 flex items-center gap-2"><Sparkles className="size-5 text-primary" /><h2 className="text-sm font-semibold">Nueva mejora</h2></div>
          <p className="mb-2 text-xs text-muted-foreground">Cambios en WILLY AI (front y backend). Para tus propios proyectos, usa el chat normal.</p>
          <div className="rounded-md border border-border bg-background focus-within:border-primary">
            {images.length > 0 && <div className="p-3 pb-0"><ImageChips images={images} onRemove={(image) => setImages(images.filter((entry) => entry !== image))} /></div>}
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            onPaste={(event: { clipboardData: DataTransfer; preventDefault: () => void }) => {
              const pictures = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
              if (!pictures.length) return;
              event.preventDefault();
              void addImages(pictures);
            }}
            onDragOver={(event: { preventDefault: () => void }) => event.preventDefault()}
            onDrop={(event: { dataTransfer: DataTransfer; preventDefault: () => void }) => {
              const pictures = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
              if (!pictures.length) return;
              event.preventDefault();
              void addImages(pictures);
            }}
            placeholder="Ejemplo: mejora la memoria de WILLY sin cambiar mis proyectos"
            className="min-h-32 w-full resize-y rounded-md bg-transparent p-3 text-sm leading-6 outline-none"
            aria-label="Mejora solicitada"
          />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <ClarifyButton
              context="mejora"
              variant="secondary"
              label="Que la IA lo entienda exactamente"
              value={request}
              onApply={(text) => {
                setRequest(text);
                const found = deriveChecks(text);
                if (found.mustContain[0]) setMustShow(found.mustContain[0]);
                if (found.mustNotContain[0]) setMustHide(found.mustNotContain[0]);
              }}
            />
            <span className="text-muted-foreground">Escribe con tus palabras: WILLY lo convierte en una petición sin ambigüedades y rellena la comprobación exacta.</span>
          </div>
          <details className="mt-3 rounded-md border border-border bg-background p-3 text-xs">
            <summary className="cursor-pointer font-semibold">Comprobación exacta (opcional): dime qué texto debe aparecer o desaparecer y lo demuestro</summary>
            <p className="mt-2 leading-5 text-muted-foreground">Si en tu petición escribes textos entre comillas («cambia “A” por “B”») WILLY ya los comprueba solo. Aquí puedes indicarlos aparte — solo vale para ESTA mejora: al enviarla se vacía, no queda pegado a las siguientes. Si el resultado no cumple, no se instala.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input value={mustShow} onChange={(event) => setMustShow(event.target.value)} placeholder="Debe aparecer: por ejemplo Pensando" className="rounded-md border border-border bg-card px-2 py-1.5 outline-none focus:border-primary" aria-label="Texto que debe aparecer" />
              <input value={mustHide} onChange={(event) => setMustHide(event.target.value)} placeholder="Debe desaparecer: por ejemplo Generando respuesta" className="rounded-md border border-border bg-card px-2 py-1.5 outline-none focus:border-primary" aria-label="Texto que debe desaparecer" />
            </div>
          </details>
          <Button className="mt-3 w-full gap-2" disabled={working || isRunning()} onClick={() => void propose()}><Bot className="size-4" />{working ? (stage || "Preparando la propuesta…") : "Crear e implementar"}</Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept=".ts,.tsx,.js,.jsx,.mjs,.css,.html,.json,.md,.txt,image/*"
            onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }}
          />
          <Button className="mt-2 w-full gap-2" disabled={working || isRunning()} onClick={() => fileInput.current?.click()}><FileUp className="size-4" />Subir archivos</Button>
          {attached.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {attached.map((file) => (
                <li key={file.name} className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1">
                  <span className="min-w-0 flex-1 truncate font-mono">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">{file.content.length} caracteres</span>
                  <button className="shrink-0 font-semibold text-destructive" onClick={() => setAttached(attached.filter((entry) => entry !== file))} aria-label={`Quitar ${file.name}`}>Quitar</button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Sube el archivo, o el trozo de código, que quieres cambiar: la IA lo verá tal cual y modificará justo esa parte. Para enseñarle algo de la pantalla, pulsa Win+Shift+S, selecciona la zona y pega con Ctrl+V dentro del cuadro de texto de arriba (o arrastra la imagen). Un modelo con visión instalado (como llama3.2-vision o llava) la describe y la IA que programa recibe esa descripción. Las imágenes no salen de tu equipo.</p>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">Una sola acción prepara, aplica y comprueba la mejora. Puedes cambiar de pestaña mientras termina.</p>
        </section>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Propuestas de mejora</h2>
        <div className="space-y-2">
          {state.improvements.length === 0 && <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Todavía no hay propuestas.</div>}
          {state.improvements.map((item) => {
            const active = job && job.id === item.id ? job : null;
            return (
              <article key={item.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{item.request}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("es-ES")} · {item.status}</p>
                  </div>
                  {(item.status === "pendiente" || item.status === "aplicada") && (
                    <Button size="sm" className="gap-2" disabled={isRunning()} onClick={() => implement(item)}>
                      <Play className="size-4" />Implementar ahora
                    </Button>
                  )}
                  {item.status === "implementada" && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary"><Check className="size-3.5" />Implementada</span>
                  )}
                  <Button size="sm" variant="outline" className="gap-2" title="Copia todo lo necesario para pegárselo a Claude y que haga el cambio" onClick={() => void sendToClaude(item)}><Bot className="size-4" />Enviar a Claude</Button>
                  <Button size="sm" variant="outline" className="gap-2" disabled={Boolean(active && !active.done)} onClick={() => remove(item.id)}><Trash2 className="size-4" />Eliminar</Button>
                </div>

                {active && (
                  <div className="mt-3 rounded-md border border-border bg-background p-3">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className={active.error ? "text-destructive" : "text-primary"}>{active.step}</span>
                      <span>{active.pct}%</span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full transition-all duration-300 ${active.error ? "bg-destructive" : "bg-primary"}`} style={{ width: `${active.pct}%` }} />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{active.detail}</p>
                    {!active.done && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Puedes cambiar de pestaña: el trabajo sigue en marcha.
                        {active.remaining !== null && active.remaining > 0 ? ` Faltan unos ${formatDuration(active.remaining)}.` : ""}
                      </p>
                    )}
                    {active.reloading && <p className="mt-1 text-xs font-semibold text-primary">Actualizando la página para que compruebes la mejora…</p>}
                  </div>
                )}

                {item.result && !active && <p className="mt-3 text-xs text-muted-foreground">{item.result}</p>}

                {item.status === "implementada" && !active && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">¿Funciona como querías?</span>
                    <Button size="sm" variant={verdictOf(item.id) === "funciona" ? "primary" : "outline"} className="h-7 text-xs" onClick={() => mark(item.id, "funciona")}>Sí, funciona</Button>
                    <Button size="sm" variant={verdictOf(item.id) === "no funciona" ? "primary" : "outline"} className="h-7 text-xs" onClick={() => mark(item.id, "no funciona")}>No</Button>
                    <span className="text-muted-foreground">WILLY lo recuerda para acertar más la próxima vez.</span>
                  </div>
                )}

                {item.evidence && !active && <EvidencePanel report={item.evidence} request={item.request} ping={ping} />}
                {item.status === "pendiente" && !active && <BridgeBox item={item} ping={ping} />}

                {item.files && item.files.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.files.map((file) => (
                      <Button key={file.path} size="sm" variant="secondary" className="gap-2" onClick={() => { downloadFile(file.path.split("/").pop() ?? "archivo.txt", file.content, "text/plain;charset=utf-8"); ping(`«${file.path}» descargado.`); }}>
                        <Download className="size-3.5" />{file.path}
                      </Button>
                    ))}
                  </div>
                )}

                <pre className="mt-3 whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-sans text-xs leading-5 text-muted-foreground">{item.proposal}</pre>
              </article>
            );
          })}
        </div>
      </section>

      {/* Lo que el dueño enseña en los chats («a partir de ahora…», «recuerda que…») y lo que WILLY aprende solo de qué
          motor acierta más: dos cosas distintas, una junto a la otra para no confundirlas. */}
      <OwnerLessonsCard ping={ping} />

      <section>
        <h2 className="mb-1 text-sm font-semibold">Qué IA rinde mejor en cada tipo de cambio</h2>
        <p className="mb-2 text-xs text-muted-foreground">Distinto de lo de arriba: aquí no son reglas tuyas, es qué motor acierta más según el tipo de tarea (código, textos…), para elegir mejor la próxima vez.</p>
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          {lessons.length === 0 ? (
            <p className="text-muted-foreground">Todavía nada. Cada mejora que funcione se guarda y, cuando la confirmes con «Sí, funciona», se usa como ejemplo en las siguientes: así acierta más y más rápido.</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">{lessonStats(lessons).summary}</p>
              <ul className="space-y-2">
                {lessons.map((lesson) => (
                  <li key={lesson.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate font-semibold" title={lesson.request}>{lesson.request}</span>
                    <span className="text-muted-foreground">{lesson.model} · {lesson.attempts} intento(s) · {lesson.seconds} s</span>
                    <span className={lesson.verdict === "funciona" ? "font-semibold text-emerald-500" : lesson.verdict === "no funciona" ? "font-semibold text-destructive" : "text-muted-foreground"}>{lesson.verdict}</span>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => forget(lesson.id)}>Olvidar</Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <EnginesPanel ping={ping} />

      <details className="rounded-lg border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Copias disponibles ({state.backups.length})</summary>
        <div className="mt-3 space-y-2">
          {state.backups.length === 0 && <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">La primera copia se creará al implementar una mejora.</div>}
          {state.backups.map((backup) => (
            <div key={backup.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3">
              <FileUp className="size-4 text-primary" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">Antes de: {backup.reason}</p><p className="text-xs text-muted-foreground">{new Date(backup.createdAt).toLocaleString("es-ES")} · el código anterior se guarda en la carpeta «copias-autoconstruccion» de la instalación</p></div>
              <Button size="sm" variant="secondary" className="gap-2" onClick={() => restore(backup.id)}><ArchiveRestore className="size-4" />Restaurar instrucciones</Button>
            </div>
          ))}
        </div>
      </details>
      </>)}
    </div>
  );
}
