// SUPER WILLY (antes «Súper IA»): la mesa de operaciones desde la que pedir cualquier cosa. Para un PROYECTO importante no
// empieza a programar con una línea: primero hace la ENTREVISTA DEL PROYECTO (bloques de preguntas con su recomendación),
// propone funciones, enseña el resumen y solo entonces construye. Trabaja con su PROPIA IA (por defecto la mejor externa
// gratuita para cada tarea), aparte de la pestaña Chat, y recuerda la conversación de cada proyecto.
// Desde la revisión 21 (rediseño, fases 1, 5 y 11) es el PROJECT COMMAND CENTER: con un proyecto abierto, a la izquierda el
// chat del proyecto y a la derecha el taller (vista previa grande, código, archivos, cambios y versiones); abre CUALQUIER
// proyecto y recibe los encargos que le pasa el Chat («Abrir en SUPER WILLY»). Esta pantalla solo compone: la lógica vive en
// lib/ y services/ (proyectos, diferencias, contexto de archivos, encargos).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PanelCard as Card } from "@/components/panel-card";
import {
  BookOpen, Brain, Check, ChevronDown, Columns2, Copy, Download, FileText, FolderKanban, FolderPlus, Hammer, Loader2, Mail, MessageSquare, Mic, Monitor, Phone,
  Play, RotateCcw, Send, Sparkles, Square, Trash2, User, Volume2, Wand2,
  Bug, FileSearch, LayoutDashboard, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/workspace-store";
import { pushNotice } from "@/lib/notifications";
import { aiService } from "@/services/ai-service";
import {
  OWNER_POLICY, TASK_LABELS, detectTask, learningStats, planChain, rememberNote, resetLearning, runTask, selfRepair,
  type RunStep, type TaskKind,
} from "@/services/orchestrator";
import { askChatCloud } from "@/lib/chat-cloud";
import { looksSensitive } from "@/lib/auto-engine";
import { learnFromOwner, ownerRules } from "@/lib/owner-brain";
import { cloudChat, engineStatus } from "@/lib/engines-client";
import { SuperModeChip } from "@/components/super-mode-chip";
import { ProjectDiscoveryPanel } from "@/components/project-discovery-panel";
import { ProjectWorkshop, describeVisual, type AskOptions, type VisualContext, type WorkshopTab } from "@/components/project-workshop";
import { compileTarget, reactProjectRules } from "@/lib/project-compile";
import { SCREEN_RULES } from "@/lib/screen-map";
import { AnswerBody } from "@/components/answer-body";
import { detectPlaybook, playbookBrief } from "@/services/playbooks";
import { DESIGN_STYLES, redesignBrief } from "@/services/design-themes";
import { estimateChars, estimateSeconds, formatDuration, progressOf, recordSpeed } from "@/services/estimator";
import { startDictation, voiceSupported, type VoiceSession } from "@/lib/voice-input";
import { speakBest } from "@/lib/natural-voice";
import { openView, useBackgroundReport } from "@/lib/background-tasks";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import type { SpeechHandle } from "@/lib/tts-voice";
import { describePictures, imageFilesOf } from "@/lib/vision";
import { PROMPT_CARDS, hasUnfilled, runPlan } from "@/services/prompt-library";
import { ThinkingDots } from "@/components/thinking-dots";
import { useImages } from "@/lib/use-images";
import { ImageChips } from "@/components/image-chips";
import { lovableUrl } from "@/lib/bridge";
import { ClarifyButton } from "@/components/clarify-button";
import { usePersistentState } from "@/lib/persistent-state";
import {
  emptySession, historyOf, lastSession, listSessions, removeSession, saveSession, coveredItems, extractPending, addTurn,
  type HistoryMsg, type WorkSession,
} from "@/services/worklog";
import {
  OPEN_PROJECT_EVENT, ensureProject, loadProjectSession, previousVersionOf, saveAnswerFiles, syncSessionToProject, takePendingProject,
} from "@/lib/super-willy-projects";
import { HANDOFF_EVENT, handoffContext, handoffNotes, mentionedProject, takeHandoff, type Handoff } from "@/lib/super-willy-handoff";
import { PROJECT_WORK_RULES, agentsLine, filesContext, isPrivateFile } from "@/lib/project-work";
import {
  autoRepairRequest, brokenReason, isBrokenPreview, repairNote, repairStep, watchAfterSave, type RepairWatch,
} from "@/lib/preview-runtime";
import { STATUS_LABEL, needsAttention, normalizePlan, planJsonRequest, planPromptBlock, projectStatus } from "@/lib/project-progress";
import { previewEvidenceOf, recordAnswer, recordAttention, recordPreview, recordTests, syncDiscoveryPlan } from "@/lib/project-plan-sync";
import { missingRequestedPages, requestFileHints } from "@/lib/plan-evidence";
import { fitNote, preferFitting, readFitInfo } from "@/lib/local-fit";
import {
  TESTS_RULES, testsEvidenceOf, testsNote, testsRepairRequest, testsStep, testsSummary, testsWatchAfterSave, type TestRun, type TestsWatch,
} from "@/lib/project-tests";
import { fetchProjectLibraries, fetchProjectPlan } from "@/services/disk-project-service";
import { SYSTEM_PROMPT, type GeneratedFile } from "@/lib/ai-standard";
import { mustChangeFiles, requiredTexts, unusableAnswer } from "@/lib/answer-check";
import { projectService, useProjects, useVersions } from "@/services/project-service";
import { TYPE_LABELS } from "@/lib/project-brief";
import { isExampleProject, type ProjectVersion } from "@/types/domain";
import { VoiceSelect } from "@/components/voice-select";
import {
  addFeature, advance, applyOwnerText, briefOf, buildPromptOf, contextOf, featuresOf, kindOf, moreIdeas, parseFeatureSuggestions,
  projectNameOf, projectRequest, rename as renameDiscovery, requirementsCount, startDiscovery, stepComplete, suggestionPrompt, KIND_LABELS,
  type DiscoveryState,
} from "@/lib/project-discovery";
import {
  SUPER_MODE_EVENT, SUPER_MODES, localWarning, readDecisionMode, readSuperMode, superModelFor, superRoute, writeDecisionMode,
  writeSuperMode, type SuperMode,
} from "@/lib/super-willy";

// --------------------------------------------------------------- capacidades

const CARD_ICONS: Record<string, typeof Sparkles> = {
  investigar: BookOpen, web: Wand2, app: LayoutDashboard, traducir: FileText, correos: Mail, llamadas: Phone,
  avatar: User, integrar: Brain, arreglar: Bug, mejoras: Wrench, resumir: FileSearch,
};

/** Tarjetas de «Qué puedes pedirle». Los prompts completos están en services/prompt-library. */
const CAPABILITIES = PROMPT_CARDS.map((card) => ({ ...card, icon: CARD_ICONS[card.id] ?? Sparkles }));

type ExecOptions = {
  /** Lo que se guarda como mensaje del dueño en la conversación (si el encargo real es muy largo). */
  ownerText?: string;
  /** No añadir la guía de entrega (playbook): el encargo ya lleva todo lo decidido. */
  noPlaybook?: boolean;
  /** Construcción a partir de la entrevista: al terminar, el proyecto queda «construido». */
  discoveryBuild?: boolean;
  /** El mensaje del dueño ya está en la conversación (se guardó al crear el proyecto): no se repite. */
  ownerAlreadySaved?: boolean;
  /** Material traído del Chat (adjuntos y enlaces) que acompaña a esta petición. */
  material?: string;
  /** Usar las imágenes adjuntas aunque la petición no sea lo escrito en el cuadro (encargos del Chat). */
  withPictures?: boolean;
  /** Modelo de tu equipo elegido a mano al crear el proyecto (si no, el de SUPER WILLY). */
  preferredModel?: string;
  /** Rev22: intento de reparación automática de la vista previa (1..2) que es esta petición. */
  repairAttempt?: number;
  /** Rev28: intento de reparación automática de las pruebas que ha roto un cambio (1..2) que es esta petición. */
  testsAttempt?: number;
  /** Rev23: «Analizar proyecto»: la IA revisa los archivos y entrega el plan; no se guarda ningún archivo. */
  analysis?: boolean;
  /** (25/09/2026) Petición automática de las páginas que pidió el dueño y no están en los archivos (una vez por cambio). */
  completeAttempt?: number;
  /** «Construir ya sin preguntas»: es un proyecto nuevo aunque la frase no lo deje claro («crea la web de mi…»). */
  newProject?: boolean;
  /** (25/09/2026) Continuación de una entrega que se cortó o que dejó archivos por entregar («FALTAN: …»); 1..3. */
  continueAttempt?: number;
};

/** Qué tipo de tarea es construir cada tipo de proyecto (para elegir la IA adecuada). */
const BUILD_TASK = (d: DiscoveryState): TaskKind => (["escritorio", "api", "herramienta"].includes(d.kind) ? "codigo" : "web");
/** (25/09/2026) Pedido un texto de botón, Gemini añadió una página de reservas entera (y se cortó): el alcance se dice explícito. */
const CHANGE_SCOPE_RULE = "ALCANCE: haz SOLO lo que pide este mensaje. Un cambio pequeño (un texto, un color, un botón, un campo) se entrega tocando el mínimo de archivos; no añadas páginas, rutas, componentes ni funciones que no se hayan pedido, ni reescribas archivos que no cambian. Si crees que hace falta algo más, dilo en una línea al final y espera a que el dueño lo pida.";

/** «Vuelve a la versión anterior», «deshaz el último cambio», «déjalo como estaba» (rediseño, punto 92). */
const UNDO = /^(?:por favor,? )?(?:vuelve|volver|vuelva|regresa|deshaz|deshacer|desház|quita el ultimo cambio|quita el último cambio|d[eé]jalo como estaba)\b.{0,40}?(?:anterior|como estaba|ultimo cambio|último cambio|antes)?\s*[.!]?$/i;

/** Dentro de un proyecto, «crea una página de contacto» es parte de ESTE proyecto: solo se empieza otro si se dice así. */
const OTHER_PROJECT = /\b(?:nuevo proyecto|otro proyecto|proyecto nuevo|otra app|otra aplicaci[oó]n|otra web|otro programa|otra tienda)\b/i;

/** Quita de la conversación que se envía a la nube los pares que llevaban datos privados (DNI, IBAN, tarjetas, claves…). */
function withoutSensitive(history: HistoryMsg[]): HistoryMsg[] {
  const out: HistoryMsg[] = [];
  for (let i = 0; i + 1 < history.length; i += 2) {
    const u = history[i]!;
    const a = history[i + 1]!;
    if (!looksSensitive(u.content) && !looksSensitive(a.content)) out.push(u, a);
  }
  return out;
}

// Reparto de la pantalla con un proyecto abierto: cuánto ocupa el chat (el resto es para la vista previa).
const LAYOUT_KEY = "willy-superwilly-ancho-chat";
const LAYOUTS = [
  { id: "vista", label: "Foco en la vista previa", pct: 28, icon: Monitor },
  { id: "equilibrado", label: "Equilibrado", pct: 45, icon: Columns2 },
  { id: "chat", label: "Foco en el chat", pct: 64, icon: MessageSquare },
] as const;
const DEFAULT_CHAT_PCT = 33;
const clampPct = (n: number): number => Math.min(75, Math.max(20, Math.round(n)));
function readChatPct(): number {
  try {
    const n = Number(window.localStorage.getItem(LAYOUT_KEY));
    return Number.isFinite(n) && n >= 20 && n <= 75 ? n : DEFAULT_CHAT_PCT;
  } catch {
    return DEFAULT_CHAT_PCT;
  }
}
function saveChatPct(n: number): void {
  try { window.localStorage.setItem(LAYOUT_KEY, String(n)); } catch { /* sin almacenamiento: vale para esta sesión */ }
}

/** ¿Pantalla ancha (ordenador)? En el móvil el chat y el taller se ven de uno en uno. */
function useWide(): boolean {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return wide;
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

// ------------------------------------------------------------------ pantalla

export function SuperIAView() {
  const [settings, updateSettings] = useSettings();
  const [prompt, setPrompt] = usePersistentState("superia:prompt", "");
  // Capturas pegadas (Win+Shift+S y Ctrl+V), arrastradas o subidas a la petición.
  const pictures = useImages((message) => pushNotice(message));
  const picturesRef = useRef(pictures.images);
  picturesRef.current = pictures.images;
  const [kind, setKind] = useState<TaskKind | "auto">("auto");
  const [answer, setAnswer] = useState("");
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [running, setRunning] = useState(false);
  const [solvedBy, setSolvedBy] = useState<string | null>(null);
  const [available, setAvailable] = useState<string[]>([]);
  const [persona, setPersona] = useState("");
  const abort = useRef<AbortController | null>(null);
  const voice = useRef<VoiceSession | null>(null);
  const [dictating, setDictating] = useState(false);
  const [, setPartial] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [written, setWritten] = useState(0);
  const [totalEst, setTotalEst] = useState(0);
  const [notes, setNotes] = usePersistentState("superia:indicaciones", "");
  const [session, setSession] = useState<WorkSession | null>(null);
  const [restore, setRestore] = useState<WorkSession | null>(null);
  const [proposal, setProposal] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [superMode, setSuperMode] = useState<SuperMode>(() => readSuperMode());
  const [understood, setUnderstood] = useState("");
  const [recommending, setRecommending] = useState(false);
  // Rev21: el taller del proyecto.
  const { projects } = useProjects();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const [savingFiles, setSavingFiles] = useState(false);
  const [lastSaved, setLastSaved] = useState<{ saved: number; rejected: string[] } | null>(null);
  const [liveNote, setLiveNote] = useState<null | "error" | "detenido">(null);
  const [focus, setFocus] = useState<{ tab: WorkshopTab; path?: string; nonce: number } | null>(null);
  const [choice, setChoice] = useState<Handoff | null>(null);
  const [chatPct, setChatPct] = useState<number>(() => (typeof window === "undefined" ? DEFAULT_CHAT_PCT : readChatPct()));
  const chatPctRef = useRef(chatPct);
  chatPctRef.current = chatPct;
  const [mobilePane, setMobilePane] = useState<"chat" | "taller">("chat");
  const [previewStatus, setPreviewStatus] = useState<VisualContext["state"] | null>(null);
  const [previewErrors, setPreviewErrors] = useState(0);
  const discoveryTimer = useRef<number | null>(null);
  // Rev22 (rediseño, punto 99): si un cambio de WILLY rompe la vista previa, se repara solo (como mucho 2 intentos) o se dice.
  const [autoRepair, setAutoRepair] = usePersistentState<boolean>("superwilly:reparar-solo", true);
  const repairWatch = useRef<RepairWatch | null>(null);
  const [repairTick, setRepairTick] = useState(0);
  // (25/09/2026) Tras un cambio de WILLY, cuando la vista previa vuelve a verse bien se comprueba que estén las páginas que pidió
  // el dueño; las que falten se le piden a WILLY UNA vez (en «Sonrisa Clara» se saltó «equipo» y nadie lo dijo).
  const completeAfter = useRef<{ projectId: string; attempt: number } | null>(null);
  // Y las imágenes que no existen en el proyecto (la página se ve, pero con huecos): se arreglan solas una vez por proyecto.
  const resourcesFixedFor = useRef<string | null>(null);
  // La última versión que se veía bien (la de antes del último cambio que la rompió): para volver a ella de una vez.
  const lastGood = useRef<{ projectId: string; version: ProjectVersion } | null>(null);
  // Rev28: las pruebas automáticas. Tras cada cambio de WILLY se vigila la pasada siguiente (si rompe alguna que iba bien, se
  // repara sola: 2 intentos o bloqueo); la última pasada de cada proyecto, y lo que se enseña bajo la respuesta.
  const testsWatch = useRef<TestsWatch | null>(null);
  const lastTests = useRef(new Map<string, TestRun>());
  const [testsLine, setTestsLine] = useState<{ projectId: string; text: string; ok: boolean; at: number } | null>(null);
  const projectVersions = useVersions(session?.projectId);
  const wide = useWide();
  const visualRef = useRef<VisualContext | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const speech = useRef<SpeechHandle | null>(null);
  // Lo que se hace después de esperar a la IA tiene que partir de la sesión de AHORA, no de la de cuando se pulsó el botón.
  const sessionRef = useRef<WorkSession | null>(session);
  sessionRef.current = session;
  const runningRef = useRef(false);
  runningRef.current = running;
  /** Guarda el trabajo en este navegador y, si ya es un proyecto, también en tu equipo (dentro del proyecto). */
  const persist = (s: WorkSession): WorkSession => {
    const saved = saveSession(s);
    syncSessionToProject(saved);
    return saved;
  };
  // Puedes irte a otra pestaña mientras trabaja: sigue en segundo plano y te avisa cuando termina (bandeja de arriba a la derecha).
  useBackgroundReport({ id: "superia", title: "SUPER WILLY", view: "superia", running: running || savingFiles, detail: savingFiles ? "Guardando los archivos en el proyecto…" : solvedBy ? `Trabajando con ${solvedBy}…` : "Trabajando en tu petición…", ...(session?.projectId ? { projectId: session.projectId } : {}) });
  // Modelo de TU EQUIPO de SUPER WILLY (el de respaldo): el elegido a mano o, en automático, el mejor para cada tarea
  // (nunca queda atado al modelo de la pestaña Chat).
  const superModel = useMemo(() => superModelFor(settings.superIaModel, available), [settings.superIaModel, available]);
  const discovery = session?.discovery ?? null;
  const interviewing = discovery?.stage === "entrevista";
  const projectActive = Boolean(discovery) || Boolean(session?.turns?.length);
  // Con un proyecto abierto (y fuera de la entrevista, que necesita toda la pantalla): chat del proyecto + taller.
  const projectMode = Boolean(session?.projectId) && !interviewing;
  const projectRecord = session?.projectId ? projects.find((p) => p.id === session.projectId) : undefined;
  const projectName = projectRecord?.name ?? discovery?.name ?? session?.title ?? "Proyecto";

  useEffect(() => {
    const sync = () => setSuperMode(readSuperMode());
    window.addEventListener(SUPER_MODE_EVENT, sync);
    return () => window.removeEventListener(SUPER_MODE_EVENT, sync);
  }, []);

  // El proyecto abierto aquí es el «proyecto actual» de WILLY (el de la barra de arriba, Historial y GitHub): una sola fuente.
  useEffect(() => {
    const id = session?.projectId;
    if (!id || !projectRecord) return;
    if (settings.projectId !== id || settings.project !== projectRecord.name) updateSettings({ projectId: id, project: projectRecord.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.projectId, projectRecord?.name]);

  const toggleSpeak = () => {
    if (speaking) { speech.current?.stop(); setSpeaking(false); return; }
    const naturalVoice = window.localStorage.getItem("willy-voz-natural") ?? "";
    setSpeaking(true);
    speech.current = speakBest(answer, {
      ...(naturalVoice ? { naturalVoice } : {}),
      onEnd: () => setSpeaking(false),
      onError: (m) => { setSpeaking(false); pushNotice(`⚠️ ${m}`, "warn"); },
    });
  };

  useEffect(() => () => speech.current?.stop(), []);

  useEffect(() => {
    setPersona(window.localStorage.getItem("willy-persona") ?? "");
    void aiService.models(settings.endpoint).then((r) => {
      if (r.ok) setAvailable(r.data.map((m) => m.name));
    });
    const last = lastSession();
    if (last) setRestore(last);
  }, [settings.endpoint]);

  // La guía de entrega (playbook) es de las peticiones sueltas: un proyecto con entrevista ya tiene su plan de funciones.
  const pb = useMemo(() => (discovery ? null : detectPlaybook(prompt || session?.prompt || "")), [prompt, session?.prompt, discovery]);
  const doneCount = pb ? pb.must.filter((m) => session?.done.includes(m)).length : 0;

  const stats = useMemo(() => learningStats().slice(0, 6), [answer]);

  const savePersona = (value: string) => {
    setPersona(value);
    window.localStorage.setItem("willy-persona", value);
  };

  const chooseMode = (mode: SuperMode) => {
    setSuperMode(mode);
    writeSuperMode(mode);
    pushNotice(`SUPER WILLY: ${SUPER_MODES.find((m) => m.id === mode)?.label ?? mode}.`, "info");
  };

  /** Guarda la entrevista (y, si hace falta, turnos nuevos) en el trabajo actual. */
  const saveDiscovery = (next: DiscoveryState, base: WorkSession | null = sessionRef.current) => {
    const cur = base ?? emptySession();
    const saved = persist({ ...cur, discovery: next, prompt: next.idea });
    sessionRef.current = saved;
    setSession(saved);
    // Rev23: el plan del proyecto sigue a la entrevista (bloques contestados, funciones elegidas), sin guardar en cada clic.
    const projectId = saved.projectId;
    if (projectId) {
      if (discoveryTimer.current !== null) window.clearTimeout(discoveryTimer.current);
      discoveryTimer.current = window.setTimeout(() => { discoveryTimer.current = null; void syncDiscoveryPlan(projectId, next); }, 400);
    }
    return saved;
  };

  /**
   * Crea el proyecto de este trabajo en Proyectos (guardado en tu equipo) y lo enlaza. Si mientras tanto el trabajo ha
   * seguido (más respuestas), se enlaza el de AHORA; si ya estás en otro, se enlaza el guardado.
   */
  const linkProject = async (base: WorkSession, name: string, idea: string, projectKind?: string): Promise<string | null> => {
    const r = await ensureProject(base, { name, idea, ...(projectKind ? { kind: projectKind } : {}) });
    if (!r.project) return base.projectId ?? null;
    const current = sessionRef.current;
    const target = current && current.id === base.id ? current : listSessions().find((s) => s.id === base.id) ?? null;
    if (target) {
      let linked: WorkSession = { ...target, projectId: r.project.id };
      if (linked.discovery && linked.discovery.name !== r.project.name) linked = { ...linked, discovery: renameDiscovery(linked.discovery, r.project.name) };
      // Rev23: desde el primer momento, el proyecto tiene su plan (su «Discovery» avanza con la entrevista).
      if (linked.discovery) void syncDiscoveryPlan(r.project.id, linked.discovery);
      const saved = persist(linked);
      if (current && current.id === base.id) {
        sessionRef.current = saved;
        setSession(saved);
      }
    }
    pushNotice(`«${r.project.name}» ya está en Proyectos, guardado en tu equipo.`, "info");
    return r.project.id;
  };

  /** Empieza la entrevista de un proyecto nuevo (el anterior queda guardado para continuarlo). */
  const startInterview = (text: string, extraNotes: string[] = []) => {
    const started0 = startDiscovery(text, readDecisionMode());
    // El material que trae un encargo del Chat (adjuntos, enlaces) queda como notas del dueño: llega a la construcción.
    const d = extraNotes.length ? { ...started0, notes: [...started0.notes, ...extraNotes] } : started0;
    const fresh = addTurn({ ...emptySession(), prompt: text }, "owner", text, null, "entrevista");
    const started = saveDiscovery(d, fresh);
    // Desde el primer momento es un proyecto: aparece en Proyectos y se guarda en tu equipo.
    void linkProject(started, d.name, text, d.kind);
    setPrompt("");
    setAnswer("");
    setSolvedBy(null);
    setSteps([]);
    setProposal(false);
    setUnderstood("");
    setRestore(null);
    setLiveNote(null);
    setLastSaved(null);
    pushNotice(d.mode === "auto"
      ? `Proyecto «${d.name}»: WILLY ha tomado las decisiones técnicas recomendadas. Revisa el resumen antes de construir.`
      : `Proyecto «${d.name}»: antes de construir, unas preguntas por bloques (con mi recomendación en cada una).`, "info");
  };

  /** Empieza de cero (el trabajo actual queda guardado: «Continuar donde lo dejaste»). */
  const newProject = () => {
    if (running) return;
    const current = sessionRef.current;
    setSession(null);
    sessionRef.current = null;
    setAnswer("");
    setSolvedBy(null);
    setSteps([]);
    setProposal(false);
    setUnderstood("");
    setLiveNote(null);
    setLastSaved(null);
    setRestore(current ?? lastSession());
  };

  /** Decide un punto opcional o una pregunta de la IA: sí se incluye, no se descarta. */
  const decide = (item: string, want: boolean) => {
    const cur = session ?? emptySession();
    const next = persist({
      ...cur,
      playbookId: pb?.id ?? cur.playbookId,
      accepted: want ? [...new Set([...cur.accepted, item])] : cur.accepted,
      rejected: want ? cur.rejected : [...new Set([...cur.rejected, item])],
      pending: cur.pending.filter((p) => p !== item),
    });
    setSession(next);
  };

  const toggleDone = (item: string) => {
    const cur = session ?? emptySession();
    const next = persist({
      ...cur,
      playbookId: pb?.id ?? cur.playbookId,
      done: cur.done.includes(item) ? cur.done.filter((d) => d !== item) : [...cur.done, item],
    });
    setSession(next);
  };

  const resume = (saved: WorkSession) => {
    // Si se cerró WILLY a mitad de la construcción, se vuelve al resumen para relanzarla (no se queda «construyendo» para siempre).
    const s = saved.discovery?.stage === "construyendo" ? { ...saved, discovery: { ...saved.discovery, stage: "entrevista" as const, step: "resumen" as const } } : saved;
    setSession(s);
    sessionRef.current = s;
    // En plena entrevista, el cuadro de arriba queda libre para contestar.
    setPrompt(s.discovery?.stage === "entrevista" ? "" : s.discovery ? "" : s.projectId ? "" : s.prompt);
    setAnswer(s.answer);
    setSolvedBy(s.model);
    setRestore(null);
    setUnderstood("");
    setLiveNote(null);
    setLastSaved(null);
    setMobilePane("chat");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /**
   * Abre CUALQUIER proyecto (rev21): con su conversación de SUPER WILLY si la tiene (de este navegador o de tu equipo); si no
   * la tiene (creado con «Nuevo proyecto», importado o de antes), empieza una aquí mismo. Devuelve si quedó abierto.
   */
  const openProject = async (projectId: string): Promise<boolean> => {
    if (runningRef.current) {
      pushNotice("SUPER WILLY está trabajando: cuando termine, vuelve a abrir el proyecto desde Proyectos.", "warn");
      return false;
    }
    if (sessionRef.current?.projectId === projectId) {
      if (sessionRef.current.discovery?.stage === "construyendo") resume(sessionRef.current);
      return true;
    }
    const loaded = await loadProjectSession(projectId);
    if (loaded) { resume(loaded); return true; }
    const project = await projectService.get(projectId);
    if (!project) {
      pushNotice("No encuentro ese proyecto en tu equipo (o WILLY no ha podido leerlo).", "warn");
      return false;
    }
    resume(persist({ ...emptySession(), title: project.name, projectId }));
    return true;
  };

  /** «Ejecutar ya»: usa lo escrito arriba como contenido del prompt; con el cuadro vacío carga el prompt para rellenarlo. */
  const runCard = (card: (typeof CAPABILITIES)[number]) => {
    const plan = runPlan(card, prompt);
    if (plan.action === "run") {
      void execute(plan.prompt, card.kind, card.name);
      return;
    }
    setPrompt(plan.load);
    setKind(card.kind);
    window.scrollTo({ top: 0, behavior: "smooth" });
    pushNotice(plan.message, "warn");
  };

  /**
   * Botón principal. En plena entrevista, lo escrito son respuestas («1C, 2B», «haz lo que recomiendas») o cosas que añadir.
   * Si no, un encargo de PROYECTO empieza la entrevista; cualquier otra petición se ejecuta como siempre. Con un proyecto
   * abierto, lo que pidas es para ESE proyecto (salvo que digas «otro proyecto»).
   */
  const onMain = () => {
    const text = prompt.trim();
    if (!text || running) return;
    if (hasUnfilled(prompt)) { pushNotice("Falta rellenar el hueco marcado con «<<…>>» en el cuadro de arriba.", "warn"); return; }
    if (discovery && interviewing) {
      const before = discovery.step;
      const r = applyOwnerText(discovery, text);
      let next = r.state;
      // Contestado el bloque entero por escrito: como en una conversación, WILLY pasa solo al siguiente.
      if (before !== "resumen" && next.step === before && stepComplete(next, before) && (before !== "funciones" || next.featureChoice)) next = advance(next);
      const withTurn = addTurn(sessionRef.current ?? emptySession(), "owner", text, null, "entrevista");
      saveDiscovery(next, withTurn);
      setUnderstood(r.understood);
      setPrompt("");
      return;
    }
    if (projectMode && session?.projectId && UNDO.test(text) && /funcionaba/i.test(text) && lastGood.current?.projectId === session.projectId) { void undoLastChange(session.projectId, text, lastGood.current.version); return; }
    if (projectMode && session?.projectId && UNDO.test(text) && /anterior|como estaba|cambio|antes|deshaz|deshacer|funcionaba/i.test(text)) { void undoLastChange(session.projectId, text); return; }
    const request = projectRequest(text);
    const isProject = projectMode
      ? OTHER_PROJECT.test(text) && request === "nuevo"
      : request === "nuevo" || (request === "posible" && !projectActive);
    if (isProject && kindOf(text) !== "herramienta" && !pictures.images.length) { startInterview(text); return; }
    // En el chat de un proyecto, lo enviado sale del cuadro (como en cualquier chat); en la mesa de operaciones se queda, por si se repite.
    if (projectMode) setPrompt("");
    void execute(text);
  };

  /** SUPER WILLY con su propia IA: la nube y/o tu equipo según el modo; devuelve el texto o null (sin tocar el resultado). */
  const askQuick = async (text: string, task: TaskKind, signal: AbortSignal): Promise<string | null> => {
    const route = superRoute(superMode, task, text, TASK_LABELS[task]);
    for (const where of route.order) {
      if (signal.aborted) return null;
      if (where === "nube") {
        const out = await askChatCloud({
          pick: "smart",
          smart: { text, kind: task, labelOf: (k) => TASK_LABELS[k as TaskKind] ?? k, hasAttachments: false, installed: available, localPlan: (k) => planChain(k as TaskKind, superModel || undefined, available) },
          messages: [{ role: "system", content: [OWNER_POLICY, ownerRules()].join("\n\n") }, { role: "user", content: text }],
          maxTokens: 2000,
          status: async () => { const s = await engineStatus(); return s ? { ...s, mode: "calidad" as const } : s; },
          ask: (id, msgs, maxTokens) => cloudChat(id, msgs, maxTokens),
          notify: () => undefined,
          onText: () => undefined,
          signal,
        });
        if (out) return out;
      } else {
        const local = await runTask({ endpoint: settings.endpoint, prompt: text, ...(superModel ? { preferred: superModel } : {}), available, kind: task, signal });
        if (local.ok) return local.data.text;
      }
    }
    return null;
  };

  /** «Recomendarme más»: ideas de funciones de la IA de SUPER WILLY; sin IA, las de WILLY (sin repetir). */
  const recommendMore = async () => {
    const d = sessionRef.current?.discovery;
    if (!d || recommending) return;
    setRecommending(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 120_000);
    let ideas: Array<{ label: string; tier: "recomendada" | "opcional" | "futura" | "imprescindible" }> = [];
    try {
      const text = await askQuick(suggestionPrompt(d), "razonamiento", controller.signal);
      ideas = text ? parseFeatureSuggestions(text) : [];
    } catch { /* se usan las ideas de WILLY */ }
    window.clearTimeout(timer);
    const latestD = sessionRef.current?.discovery ?? d;
    let next = latestD;
    const before = featuresOf(latestD).length;
    if (ideas.length) for (const idea of ideas) next = addFeature(next, idea.label, "ia", idea.tier);
    if (featuresOf(next).length === before) for (const label of moreIdeas(latestD)) next = addFeature(next, label, "ia", "opcional");
    const added = featuresOf(next).length - before;
    saveDiscovery(next);
    setRecommending(false);
    pushNotice(added ? `${added} idea(s) nueva(s) sin marcar: marca las que quieras.` : "No se me ocurren más funciones que no estén ya en la lista.", added ? "success" : "info");
  };

  /** «Construir el proyecto»: con TODO lo decidido en la entrevista (y el resumen ya visto). */
  const buildProject = () => {
    const cur = sessionRef.current;
    const d = cur?.discovery;
    if (!cur || !d || running) return;
    const n = requirementsCount(d);
    const defined = addTurn(cur, "ia", `Proyecto definido: «${d.name}» (${KIND_LABELS[d.kind]}) · ${n} requisitos. Comienzo la construcción.`, null, "entrevista");
    const building: DiscoveryState = { ...d, stage: "construyendo", updatedAt: Date.now() };
    const saved = saveDiscovery(building, defined);
    const go = () => void latest.current.execute(buildPromptOf(d), BUILD_TASK(d), "Construcción del proyecto", {
      ownerText: `Construye «${d.name}» con lo acordado en la entrevista (${n} requisitos).`,
      noPlaybook: true,
      discoveryBuild: true,
    });
    // Rev23: el plan con TODO lo decidido (las funciones son sus tareas) queda guardado antes de construir; así WILLY dice
    // qué tareas termina con cada entrega.
    if (saved.projectId) void syncDiscoveryPlan(saved.projectId, building).finally(go);
    else go();
  };

  const execute = async (text: string, forced?: TaskKind, label = "Tarea", opts: ExecOptions = {}) => {
    if (!text.trim() || running) return;
    // ¿Funcionaba la vista previa antes de este cambio? (Si ya estaba rota, no la ha roto este cambio.)
    const brokenBefore = isBrokenPreview(visualRef.current?.state);
    setRunning(true);
    setProposal(false);
    setAnswer("");
    setSteps([]);
    setSolvedBy(null);
    setWritten(0);
    setLiveNote(null);
    setLastSaved(null);
    const began = Date.now();
    setStartedAt(began);
    let sess = sessionRef.current;
    // «Construir ya sin preguntas» (o cualquier encargo de proyecto): si WILLY lo va a construir, ES UN PROYECTO. Se crea
    // antes de empezar, para que lo que genere quede guardado en él.
    // (25/09/2026) «Crea la web del restaurante…» es «posible» (no «nuevo») para projectRequest: con «Construir ya» no se creaba
    // el proyecto y los archivos que generaba la IA se perdían (solo se veían como texto). Ahora el botón lo dice explícitamente.
    const request = projectRequest(text);
    const wantsProject = opts.newProject || request === "nuevo" || (request === "posible" && !projectActive);
    if (!sess?.projectId && !opts.discoveryBuild && wantsProject && kindOf(text) !== "herramienta") {
      const base = persist(addTurn(sess ?? { ...emptySession(), prompt: text }, "owner", opts.ownerText ?? text));
      sessionRef.current = base;
      setSession(base);
      await linkProject(base, projectNameOf(text), text, kindOf(text));
      sess = sessionRef.current;
      opts = { ...opts, ownerAlreadySaved: true };
    }
    setTotalEst(estimateChars(pb, sess?.accepted.length ?? 0, text));
    const controller = new AbortController();
    abort.current = controller;

    // Imágenes pegadas (o traídas del Chat): un modelo con visión las describe y la descripción acompaña a la petición.
    let imageNote = "";
    const images = picturesRef.current;
    if (images.length && (text === prompt || opts.withPictures || opts.discoveryBuild)) {
      const seen = await describePictures({ endpoint: settings.endpoint, currentModel: settings.model, pictures: images, signal: controller.signal, onStage: (stage) => setAnswer(stage) });
      if (!seen.ok) {
        if (abort.current === controller) {
          setRunning(false);
          setStartedAt(null);
          abort.current = null;
        }
        setAnswer(controller.signal.aborted ? "" : `⚠️ ${seen.error}`);
        if (!controller.signal.aborted) setLiveNote("error");
        return;
      }
      imageNote = seen.text;
      setAnswer("");
      pictures.clear();
    }

    // Trabajar SOBRE un proyecto (rev21): la IA ve sus archivos de verdad (lo privado nunca sale a la nube) y sabe cómo
    // devolver los cambios; también sabe qué está viendo el dueño en la vista previa.
    const projectId = sess?.projectId ?? null;
    let projectFiles: GeneratedFile[] = [];
    if (projectId) projectFiles = (await projectService.get(projectId))?.files ?? [];
    const working = Boolean(projectId) || Boolean(opts.discoveryBuild);
    // (25/09/2026) Al continuar una entrega cortada, la IA no necesita releer lo que acaba de escribir: con la lista de archivos
    // y los pequeños (tipos, datos, router) basta. Con 24.800 tokens Gemini contestaba 503 «high demand» en sus 3 modelos; con
    // unos 12.000 responde. El resto de peticiones sigue viendo hasta 32.000 caracteres.
    // «En la portada…» → la IA tiene que ver HomePage.tsx: los nombres de archivo de las páginas nombradas se suman a la petición
    // al elegir qué archivos enseñar (antes «portada» no encontraba «HomePage.tsx» y la IA cambiaba otra cosa).
    const focus = projectFiles.length ? `${text}\n${requestFileHints(text, projectFiles)}`.trim() : text;
    const filesCloud = projectFiles.length ? filesContext(projectFiles, focus, opts.continueAttempt ? 9_000 : 32_000, { exclude: isPrivateFile }) : null;
    const filesCompact = projectFiles.length && !opts.continueAttempt ? filesContext(projectFiles, focus, 9_000, { exclude: isPrivateFile }) : null;
    const filesLocal = projectFiles.length ? filesContext(projectFiles, focus, 10_000) : null;
    // Rev23: el PLAN del proyecto (tareas con su id) para que WILLY diga qué termina; si aún no tiene, que lo entregue.
    const planKind = projectsRef.current.find((p) => p.id === projectId)?.kind ?? sess?.discovery?.kind ?? "web";
    const plan = projectId ? await fetchProjectPlan(projectId) : null;
    const planRules = !working || opts.analysis ? "" : plan ? planPromptBlock(plan) : planJsonRequest(planKind, "construir");
    // Rev25: si es un proyecto React/Vite, se compila en el equipo del dueño: la IA sabe con qué librerías (y cómo) compila.
    // Rev27: también las que ya están instaladas en el equipo y cómo pedir otra (declarándola en package.json: se instala sola).
    const isReact = Boolean(working && projectFiles.length && compileTarget(projectFiles));
    const installedLibs = isReact ? await fetchProjectLibraries().then((r) => (r.ok ? r.data.libraries.map((l) => l.name) : []), () => []) : [];
    const reactRules = isReact ? reactProjectRules(installedLibs) : "";
    // Rev26: con varias pantallas, rutas con «#» (así la vista previa y el mapa de pantallas pueden abrir cada una).
    const screenRules = working && !opts.analysis ? `PANTALLAS:\n${SCREEN_RULES}` : "";
    // Rev28: las pruebas automáticas (formato Playwright) que WILLY pasa solo después de cada cambio.
    const testsRules = working && !opts.analysis && !/^(?:api|backend|automatizacion)$/i.test(planKind) ? TESTS_RULES : "";
    const scopeRule = projectFiles.length && !opts.analysis && !opts.discoveryBuild && !opts.continueAttempt && !opts.completeAttempt ? CHANGE_SCOPE_RULE : "";
    const workRules = working ? [SYSTEM_PROMPT, agentsLine(settings.agents), projectFiles.length && !opts.analysis ? PROJECT_WORK_RULES : "", scopeRule, reactRules, screenRules, testsRules, projectId ? describeVisual(visualRef.current) : "", planRules].filter(Boolean).join("\n\n") : "";

    const brief = pb && !opts.noPlaybook ? playbookBrief(pb, sess?.accepted ?? [], sess?.rejected ?? []) : "";
    const fullPrompt = [text, imageNote, brief, opts.material ?? ""].filter(Boolean).join("\n\n");
    // (25/09/2026) Sobre un proyecto, una petición sin palabra clave («arréglalo», «continúa», una reparación automática) es
    // trabajo de web o de código, no «General»: así va a las IA que mejor programan (antes «General» mandaba a otras).
    const detected = detectTask(text);
    const taskKind: TaskKind = forced ?? (kind !== "auto" ? kind : detected !== "general" || !working ? detected : /^(?:api|escritorio|herramienta|automatizacion)$/i.test(planKind) ? "codigo" : "web");
    // Si lo que pides es una regla («a partir de ahora…», «recuerda que…»), se aprende para todas las IA y todos los chats.
    if (text === prompt) {
      const learned = learnFromOwner(text, "SUPER WILLY");
      if (learned) setSteps((prev) => [...prev, { model: "Aprendido", state: "ok", detail: `📌 Para todas las IA: «${learned.slice(0, 120)}»` }]);
    }

    // Contexto del proyecto en curso (lo decidido en la entrevista) y la conversación anterior: así la IA recuerda el hilo
    // («cambia el color del botón», «el cliente también quiere…») sin empezar de cero. Si ya ve los archivos, las respuestas
    // anteriores van más resumidas (el código de verdad es el de los archivos).
    const projectContext = sess?.discovery && !opts.discoveryBuild ? contextOf(sess.discovery) : "";
    const history = opts.discoveryBuild ? [] : historyOf(sess, filesCloud ? { last: 6_000, other: 2_000 } : {});
    const personaText = persona.trim() ? `Perfil de estilo del propietario:\n${persona.trim()}` : "";
    const system = [OWNER_POLICY, ownerRules(), `Tarea detectada: ${TASK_LABELS[taskKind]}.`, personaText, projectContext, workRules].filter(Boolean).join("\n\n");
    const route = superRoute(superMode, taskKind, fullPrompt, TASK_LABELS[taskKind]);
    // 25/09/2026 · En el trabajo sobre un proyecto, una respuesta que es su razonamiento en vez de la respuesta, con archivos rotos
    // o con una página que no se ejecuta no vale, y el relevo pasa sola a la siguiente IA (lib/answer-check.ts). Lo que TIENE que
    // cambiar archivos (un «Reparar», una reparación automática, arreglar lo elegido) tampoco vale si no cambia ninguno. Construir
    // no se exige: su primera respuesta puede ser proponer las direcciones visuales y esperar a que elijas.
    const mustChange = working && !opts.analysis && mustChangeFiles({ label, text, ...(opts.repairAttempt ? { repairAttempt: opts.repairAttempt } : {}), ...(opts.testsAttempt ? { testsAttempt: opts.testsAttempt } : {}) });
    // Lo que el dueño pide entre comillas («pon «Reserva tu clase gratis»») tiene que aparecer en los archivos: si no, la respuesta
    // no vale y pasa a la siguiente IA (solo en lo que escribe el dueño, no en las peticiones automáticas de WILLY).
    const mustContain = working && !opts.analysis && !opts.discoveryBuild && !opts.repairAttempt && !opts.testsAttempt && !opts.continueAttempt && !opts.completeAttempt && !opts.newProject && text === (opts.ownerText ?? text) ? requiredTexts(text) : [];
    const accept = working && !opts.analysis ? (answerText: string) => unusableAnswer(answerText, projectFiles, { requireFiles: mustChange || mustContain.length > 0, mustContain }) : undefined;
    const warning = localWarning(superMode, taskKind, available, TASK_LABELS[taskKind]);
    setSteps((prev) => [...prev, { model: SUPER_MODES.find((m) => m.id === superMode)?.label ?? "SUPER WILLY", state: "ok", detail: route.why }, ...(warning ? [{ model: "Aviso", state: "relevo" as const, detail: warning }] : [])]);
    if (warning) pushNotice(warning, "warn");
    if (history.length) setSteps((prev) => [...prev, { model: `Recuerda ${history.length / 2} turno(s)`, state: "ok", detail: "Lleva la conversación anterior del proyecto." }]);
    if (filesCloud) setSteps((prev) => [...prev, { model: `Ve ${filesCloud.included.length} de ${projectFiles.length} archivo(s)`, state: "ok", detail: filesCloud.included.join(", ") || "Ninguno completo (son muy grandes)" }]);
    const preferred = opts.preferredModel || superModel;

    let cloudEngine = "";
    let cloudText: string | null = null;
    let local: Awaited<ReturnType<typeof runTask>> | null = null;
    for (const where of route.order) {
      if (controller.signal.aborted) break;
      if (where === "nube") {
        // Lo que no debe salir de tu equipo (DNI, IBAN, tarjetas, claves…) nunca va a la nube: ni lo que pides ahora ni turnos anteriores.
        const cloudHistory = withoutSensitive(history);
        if (cloudHistory.length < history.length) setSteps((prev) => [...prev, { model: "Privado", state: "ok", detail: "Algún mensaje anterior llevaba datos privados: no se envía a la nube." }]);
        cloudText = await askChatCloud({
          pick: "smart",
          smart: { text: [fullPrompt, projectContext].filter(Boolean).join("\n"), kind: taskKind, labelOf: (k) => TASK_LABELS[k as TaskKind] ?? k, hasAttachments: false, installed: available, localPlan: (k) => planChain(k as TaskKind, superModel || undefined, available) },
          messages: [{ role: "system", content: [system, filesCloud?.block ?? ""].filter(Boolean).join("\n\n") }, ...cloudHistory, { role: "user", content: fullPrompt }],
          maxTokens: 16000,
          // La misma petición con menos archivos y menos historial, por si el motor rechaza la grande por saturación.
          ...(filesCompact ? { compact: [{ role: "system" as const, content: [system, filesCompact.block].filter(Boolean).join("\n\n") }, ...(opts.discoveryBuild ? [] : withoutSensitive(historyOf(sess, { last: 2_000, other: 600, turns: 4 }))), { role: "user" as const, content: fullPrompt }] } : {}),
          // SUPER WILLY decide aquí la prioridad con su propio modo (no el «ahorro» del Plug and play de la pestaña Chat).
          status: async () => { const s = await engineStatus(); return s ? { ...s, mode: "calidad" as const } : s; },
          ask: (id, msgs, maxTokens, compact) => cloudChat(id, msgs, maxTokens, undefined, compact),
          notify: (m) => {
            const state: RunStep["state"] = m.startsWith("Respuesta de") ? "ok" : /Ninguna IA externa|no han podido|contesta tu equipo|se queda en tu equipo|uso tu equipo|ninguna IA externa|no sirve\.|Paso sola a/i.test(m) ? "relevo" : "probando";
            setSteps((prev) => [...prev.filter((p) => !(p.model === "IA externa" && p.state === "probando")), { model: "IA externa", state, detail: m }]);
          },
          onText: (t) => { setAnswer(t); setWritten(t.length); },
          onAnswered: (engine, model) => { cloudEngine = `${engine} · ${model}`; },
          // La respuesta descartada queda en la conversación (sin reenviarse a la IA): así se ve qué contestó y por qué no valió.
          onRefused: (engine, model, reason, answerText) => {
            const cur = sessionRef.current;
            if (!cur) return;
            const shown = answerText.replace(/\s+/g, " ").trim();
            const next = persist(addTurn(cur, "ia", `🚫 Descartada la respuesta de ${engine} · ${model}: ${reason}. Empezaba así: «${shown.slice(0, 500)}${shown.length > 500 ? "…" : ""}»`, "WILLY", "descartada"));
            sessionRef.current = next;
            setSession(next);
          },
          ...(accept ? { accept } : {}),
          signal: controller.signal,
        });
        if (cloudText !== null) break;
      } else {
        const localContext = [personaText, projectContext, workRules, filesLocal?.block ?? ""].filter(Boolean).join("\n\n");
        // (25/09/2026) Sin modelo elegido a mano, primero el mejor de los que CABEN ENTEROS en la gráfica (lib/local-fit.ts): en un
        // PC de 6 GB, qwen2.5-coder:7b va a medias con el procesador y un cambio de un texto tardó más de 20 minutos.
        const fit = preferred ? null : await readFitInfo();
        const chainNow = preferred ? [] : preferFitting(planChain(taskKind, undefined, available), fit);
        const localPick = preferred || chainNow[0] || "";
        if (localPick && !preferred && fit) setSteps((prev) => [...prev, { model: "Tu equipo", state: "ok", detail: `Primero ${fitNote(localPick, fit)}${chainNow[1] ? `; después ${fitNote(chainNow[1], fit)}` : ""}.` }]);
        local = await runTask({
          endpoint: settings.endpoint,
          prompt: fullPrompt,
          ...(localPick ? { preferred: localPick } : {}),
          available,
          ...(forced ?? (kind !== "auto" ? kind : undefined) ? { kind: forced ?? (kind as TaskKind) } : {}),
          ...(localContext ? { context: localContext } : {}),
          ...(history.length ? { history } : {}),
          signal: controller.signal,
          onDelta: (d) => {
            setAnswer((a) => a + d);
            setWritten((w) => w + d.length);
          },
          onStep: (s) => setSteps((prev) => [...prev.filter((p) => p.model !== s.model || p.state !== "probando"), s]),
        });
        if (local.ok) break;
      }
    }
    const result: Awaited<ReturnType<typeof runTask>> = cloudText !== null
      ? { ok: true, data: { kind: taskKind, model: cloudEngine || "IA externa", text: cloudText, relays: 0 } }
      : local ?? { ok: false, error: controller.signal.aborted ? "Cancelado." : "Ninguna IA externa ha podido responder y el modo elegido no usa tu equipo." };

    if (result.ok) recordSpeed(result.data.text.length, Date.now() - began);
    // Si el usuario ya lanzó otra tarea tras pulsar «Detener», esta no debe tocar el estado de la nueva.
    const current = abort.current === controller;
    if (current) {
      setRunning(false);
      setStartedAt(null);
      abort.current = null;
    }
    if (!result.ok) {
      // Si falla la construcción del proyecto, vuelve al resumen para reintentarlo (nada se pierde).
      const failed = sessionRef.current;
      if (opts.discoveryBuild && failed?.discovery) saveDiscovery({ ...failed.discovery, stage: "entrevista", step: "resumen", updatedAt: Date.now() }, failed);
      // «Detener» conserva lo escrito hasta ese momento, igual que en el chat.
      if (controller.signal.aborted) {
        if (current) { pushNotice("Generación detenida. Se conserva lo escrito hasta ahora.", "warn"); setLiveNote("detenido"); }
        return;
      }
      setAnswer(`⚠️ ${result.error}`);
      setLiveNote("error");
      pushNotice(`⚠️ ${result.error}`, "warn");
      return;
    }
    setAnswer(result.data.text);
    setSolvedBy(result.data.model);
    rememberNote(result.data.kind, (opts.ownerText ?? text).slice(0, 120));

    // Conversación del proyecto: se guarda lo que pediste y lo que respondió la IA (para verla, retomarla y que la IA la recuerde).
    const now = sessionRef.current;
    const usePlaybook = pb && !opts.noPlaybook && !now?.discovery;
    if (opts.discoveryBuild || now?.discovery || now?.turns?.length || now?.projectId || usePlaybook) {
      const cur = now ?? emptySession();
      const withOwner = opts.ownerAlreadySaved ? cur : addTurn(cur, "owner", opts.ownerText ?? text);
      let next: WorkSession = { ...addTurn(withOwner, "ia", result.data.text, result.data.model), answer: result.data.text, model: result.data.model };
      if (next.discovery && opts.discoveryBuild) next = { ...next, discovery: { ...next.discovery, stage: "construido", updatedAt: Date.now() } };
      if (usePlaybook && pb) {
        const cov = coveredItems(result.data.text, pb.must);
        const pend = extractPending(result.data.text);
        next = {
          ...next,
          prompt: text,
          playbookId: pb.id,
          done: [...new Set([...cur.done, ...cov])],
          accepted: cur.accepted.filter((a) => pb.ask.includes(a)),
          rejected: cur.rejected.filter((a) => pb.ask.includes(a)),
          pending: pend.filter((p) => !cur.accepted.includes(p) && !cur.rejected.includes(p)),
        };
      }
      const saved = persist(next);
      sessionRef.current = saved;
      setSession(saved);
      if (usePlaybook) setProposal(true);
      // Los archivos que trae la respuesta van al proyecto, como versión nueva (se unen con los que ya tenía). Lo que venga
      // cortado o roto NO sustituye a lo bueno (se dice).
      if (saved.projectId && opts.analysis) {
        // Rev23: «Analizar proyecto» no cambia archivos: solo deja su plan (y con él, su progreso).
        const analysed = await recordAnswer(saved.projectId, result.data.text, { saved: 0, kind: planKind, analysis: true });
        pushNotice(analysed ? "Proyecto analizado: ya tiene su plan y su progreso real." : "⚠️ El análisis no ha devuelto un plan que se pueda usar. Prueba otra vez.", analysed ? "success" : "warn");
      } else if (saved.projectId) {
        setSavingFiles(true);
        let savedCount = 0;
        try {
          const files = await saveAnswerFiles(saved.projectId, result.data.text, `${opts.discoveryBuild ? "Construcción" : label} · SUPER WILLY (${result.data.model})`);
          savedCount = files?.saved ?? 0;
          if (files?.saved) pushNotice(`${files.saved} archivo(s) guardados en el proyecto «${saved.discovery?.name ?? projectsRef.current.find((p) => p.id === saved.projectId)?.name ?? saved.title}» (${files.total} en total).`, "success");
          if (files?.rejected.length) pushNotice(`⚠️ No he guardado ${files.rejected.length} archivo(s) porque venían incompletos o rotos (${files.rejected.slice(0, 3).map((r) => r.path).join(", ")}): se conservan los que tenías. Pide a WILLY que los entregue completos.`, "warn");
          if (files) setLastSaved({ saved: files.saved, rejected: files.rejected.map((r) => r.path) });
          // (25/09/2026) La entrega se ha cortado (límite de la IA) o la IA dice lo que no le ha cabido: WILLY le pide que siga,
          // como mucho 3 veces, sin que el dueño tenga que hacer nada. Antes se quedaba a medias y decía «hecho».
          if (files && (files.cut || files.pending.length) && (opts.continueAttempt ?? 0) < 3 && !opts.analysis) {
            const attempt = (opts.continueAttempt ?? 0) + 1;
            const have = [...files.changed, ...files.added];
            const want = [...new Set([...(files.cut ? [files.cut] : []), ...files.pending])];
            const note = `✂️ La entrega se ha cortado por el tamaño máximo de una respuesta${files.cut ? ` (a mitad de «${files.cut}», que no se guarda a medias)` : ""}${files.pending.length ? `; quedan por entregar ${files.pending.map((p) => `«${p}»`).join(", ")}` : ""}. Le pido que siga (${attempt} de 3).`;
            const cur2 = sessionRef.current;
            if (cur2) { const next2 = persist(addTurn(cur2, "ia", note, "WILLY")); sessionRef.current = next2; setSession(next2); }
            const ask = [
              `Tu entrega anterior se cortó por el tamaño máximo de una respuesta${files.cut ? ` (a mitad de «${files.cut}», que NO se ha guardado)` : ""}.`,
              have.length ? `Ya están guardados en el proyecto (no los repitas): ${have.join(", ")}.` : "",
              `Entrega ahora, COMPLETOS: ${want.length ? want.join(", ") : "los archivos que faltan"} y todo lo que falte para que el proyecto arranque y tenga lo pedido (empieza por lo que hace arrancar el proyecto si aún no está: src/main.tsx, el router, los estilos).`,
              "Si vuelve a no caber, termina otra vez con una línea «FALTAN: …».",
            ].filter(Boolean).join("\n");
            window.setTimeout(() => void latest.current.execute(ask, undefined, "Continuar la entrega", { ownerAlreadySaved: true, noPlaybook: true, continueAttempt: attempt }), 400);
          }
          // Tras guardar, se vigila la vista previa: si este cambio la rompe, se repara sola (o se avisa).
          if (files?.saved) {
            const projectId = saved.projectId;
            repairWatch.current = watchAfterSave({ projectId, brokenBefore, ...(opts.repairAttempt ? { attempt: opts.repairAttempt } : {}) });
            completeAfter.current = opts.repairAttempt || opts.testsAttempt ? completeAfter.current : { projectId, attempt: opts.completeAttempt ?? 0 };
            // Rev28: y sus pruebas (las que ya fallaban antes de este cambio no las ha roto él).
            testsWatch.current = testsWatchAfterSave({ projectId, before: lastTests.current.get(projectId) ?? null, ...(opts.testsAttempt ? { attempt: opts.testsAttempt } : {}) });
            // Antes de este cambio la vista previa se veía bien: esa versión es «la que funcionaba».
            if (!opts.repairAttempt && !brokenBefore) void previousVersionOf(projectId).then((v) => { lastGood.current = v ? { projectId, version: v } : null; });
          } else if (opts.repairAttempt) {
            // El intento no ha traído nada que guardar: la vista previa sigue como estaba (se decide ya: otro intento o el bloqueo).
            repairWatch.current = { projectId: saved.projectId, attempt: opts.repairAttempt, seenLoad: true, at: Date.now() };
            setRepairTick((t) => t + 1);
          } else if (opts.testsAttempt) {
            // Rev28: igual con las pruebas: siguen como estaban (otro intento o el bloqueo, con la última pasada).
            testsWatch.current = { projectId: saved.projectId, attempt: opts.testsAttempt, before: null, at: 0 };
            const last = lastTests.current.get(saved.projectId);
            if (last) window.setTimeout(() => latestTests.current(last, saved.projectId!), 0);
          }
        } finally {
          setSavingFiles(false);
        }
        // Rev23: el plan del proyecto con lo que dice WILLY (bloque «plan») y lo que hay ahora en sus archivos.
        void recordAnswer(saved.projectId, result.data.text, { saved: savedCount, kind: planKind });
      }
    }
    pushNotice(
      // Sin género en la frase: la etiqueta puede ser «Cambio», «Tarea», «Reparación automática» o el nombre de una tarjeta.
      result.data.relays > 0
        ? `Hecho: ${label} (con ${result.data.model}, tras ${result.data.relays} relevo(s)).`
        : `Hecho: ${label} (con ${result.data.model}).`,
      "success",
    );
  };

  /**
   * «Vuelve a la versión anterior»: se restaura la versión de antes del último cambio (sin IA) y queda en la conversación.
   * Rev22: «vuelve a la versión que funcionaba» (tras un bloqueo de la reparación automática) vuelve a la última que se veía bien.
   */
  const undoLastChange = async (projectId: string, text: string, target?: ProjectVersion | null) => {
    setPrompt("");
    const version = target ?? await previousVersionOf(projectId);
    const base = addTurn(sessionRef.current ?? emptySession(), "owner", text);
    if (!version) {
      const saved = persist(addTurn(base, "ia", "No hay una versión anterior distinta de la de ahora: no he cambiado nada.", "WILLY"));
      sessionRef.current = saved;
      setSession(saved);
      return;
    }
    const when = new Date(version.at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    if (!window.confirm(`¿Volver a «${version.label}» (${when})? Lo de ahora sigue guardado en su propia versión.`)) return;
    const r = await projectService.restoreVersion(version.id);
    const saved = persist(addTurn(base, "ia", r.ok ? `Hecho: he vuelto a «${version.label}» (${when}). Lo de antes sigue en Versiones por si lo quieres recuperar.` : `⚠️ No he podido volver a esa versión: ${r.error}`, "WILLY"));
    sessionRef.current = saved;
    setSession(saved);
    pushNotice(r.ok ? `Proyecto de vuelta a «${version.label}».` : `⚠️ ${r.error}`, r.ok ? "success" : "warn");
  };

  /**
   * Lo que se pide desde el taller (arreglar un error, añadir la vista previa…): se ejecuta en el chat del proyecto. Rev24: los
   * cambios de la edición visual («¿Qué quieres cambiar?» de un elemento, «Arreglar lo elegido» de la revisión del diseño) llevan
   * lo que ve el dueño en el chat (`ownerText`) y, como son cambios concretos, van sin la guía de entrega.
   */
  const askInProject = (text: string, opts?: AskOptions) => {
    if (runningRef.current) { pushNotice("SUPER WILLY está trabajando: espera a que termine.", "warn"); return; }
    setMobilePane("chat");
    void execute(text, undefined, opts?.label ?? "Cambio", opts ? { ...(opts.ownerText ? { ownerText: opts.ownerText } : {}), noPlaybook: true } : {});
  };

  // Rev22 (rediseño, punto 99): después de un cambio de WILLY, si la vista previa se rompe → diagnóstico (lo que ve la consola)
  // → la versión de antes queda guardada → reparación → se vuelve a cargar y comprobar. No se da por terminado hasta que se
  // RECUPERA la vista previa o se DECLARA EL BLOQUEO (como mucho 2 intentos). Con la reparación automática apagada, se avisa.
  useEffect(() => {
    if (!previewStatus || runningRef.current) return;
    const { step, watch } = repairStep(repairWatch.current, { projectId: sessionRef.current?.projectId ?? null, state: previewStatus, auto: autoRepair, now: Date.now() });
    repairWatch.current = watch;
    if ((step.kind === "nada" || step.kind === "recuperada") && previewStatus === "lista") void completeRequested();
    if (step.kind === "nada") return;
    const seen = visualRef.current;
    const good = lastGood.current?.projectId === sessionRef.current?.projectId ? lastGood.current?.version : null;
    const goodText = good ? `«${good.label}» (${new Date(good.at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})` : null;
    const note = repairNote(step, brokenReason(seen?.state, seen?.error), goodText);
    const cur = sessionRef.current;
    if (note && cur) {
      const next = persist(addTurn(cur, "ia", note, "WILLY"));
      sessionRef.current = next;
      setSession(next);
    }
    if (step.kind === "reparar") {
      setMobilePane("chat");
      void latest.current.execute(autoRepairRequest(seen?.repair ?? null, step.attempt), undefined, "Reparación automática", { ownerAlreadySaved: true, noPlaybook: true, repairAttempt: step.attempt });
    }
    const pid = sessionRef.current?.projectId;
    if (step.kind === "recuperada") {
      pushNotice("Vista previa recuperada: se ve bien otra vez.", "success");
      if (pid) void recordAttention(pid, null, (a) => a?.kind === "bloqueo" && a.reason.startsWith("La vista previa"));
    }
    if (step.kind === "bloqueo") {
      pushNotice("La vista previa sigue sin verse bien después de 2 intentos: WILLY te lo explica en el chat del proyecto.", "warn");
      // Rev23: en Proyectos sale como «Bloqueado» (con «Resolver»), no como si todo fuera bien.
      if (pid) void recordAttention(pid, { kind: "bloqueo", reason: `La vista previa no se ve bien después de ${step.attempts} intentos de reparación (${brokenReason(seen?.state, seen?.error)}).` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewStatus, repairTick]);

  /** Las páginas que pidió el dueño y no están en los archivos: se piden a WILLY una vez; si siguen faltando, se dice. */
  const completeRequested = async () => {
    const pending = completeAfter.current;
    completeAfter.current = null;
    const pid = sessionRef.current?.projectId;
    if (!pending || !pid || pending.projectId !== pid || runningRef.current) return;
    const [plan, project] = await Promise.all([fetchProjectPlan(pid), projectService.get(pid)]);
    const missing = missingRequestedPages(plan, project?.files ?? []);
    if (runningRef.current || sessionRef.current?.projectId !== pid) return;
    const cur = sessionRef.current;
    if (!missing.length) {
      // Sin páginas que falten: si hay imágenes u otros recursos que no existen, se arreglan (una vez por proyecto). Las imágenes
      // fallan poco después de que la página se dé por cargada: se espera un momento antes de mirar.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 3000));
      if (runningRef.current || sessionRef.current?.projectId !== pid) return;
      const broken = visualRef.current?.resources ?? [];
      if (!broken.length || resourcesFixedFor.current === pid) return;
      resourcesFixedFor.current = pid;
      if (cur) { const next = persist(addTurn(cur, "ia", `🖼️ La página se ve, pero ${broken.length === 1 ? "un recurso no existe" : `${broken.length} recursos no existen`} en el proyecto (${broken.slice(0, 3).map((r) => `«${r.replace(/^No se ha podido cargar:\s*/, "")}»`).join(", ")}${broken.length > 3 ? "…" : ""}). Lo arreglo yo solo.`, "WILLY")); sessionRef.current = next; setSession(next); }
      setMobilePane("chat");
      void latest.current.execute(
        `Estos recursos de la página no existen en el proyecto y fallan al cargar:\n${broken.map((r) => `- ${r}`).join("\n")}\nSustituye cada imagen que no existe por un SVG hecho por ti dentro del proyecto (o un degradado o un icono de lucide-react) con el mismo tamaño y sitio; nunca servicios de imágenes de internet ni rutas a archivos que no entregas. Cambia solo eso y entrega los archivos que cambies COMPLETOS.`,
        undefined,
        "Arreglo de recursos",
        { ownerAlreadySaved: true, noPlaybook: true, completeAttempt: Math.max(1, pending.attempt) },
      );
      return;
    }
    const list = missing.map((t) => `«${t}»`).join(", ");
    if (pending.attempt >= 1) {
      if (cur) { const next = persist(addTurn(cur, "ia", `⚠️ Sigue(n) faltando ${list}: lo pediste y no está en los archivos. Pídemelo otra vez con más detalle (qué tiene que llevar) o dime si ya no hace falta.`, "WILLY")); sessionRef.current = next; setSession(next); }
      pushNotice(`Falta lo que pediste: ${list}.`, "warn");
      return;
    }
    if (cur) { const next = persist(addTurn(cur, "ia", `🔎 He comprobado los archivos: falta(n) ${list}, que pediste. Lo completo yo solo.`, "WILLY")); sessionRef.current = next; setSession(next); }
    setMobilePane("chat");
    void latest.current.execute(
      `Faltan estas páginas que pidió el dueño y NO están en los archivos del proyecto: ${list}. Créalas ahora con contenido real (no de relleno), con el mismo diseño y componentes que el resto, enlazadas en el menú y en las rutas, y entrega los archivos que cambies COMPLETOS. No toques lo que ya funciona.`,
      undefined,
      "Completar lo pedido",
      { ownerAlreadySaved: true, noPlaybook: true, completeAttempt: pending.attempt + 1 },
    );
  };

  /**
   * Rev28: una pasada de las pruebas automáticas de un proyecto: queda en su plan (de ahí salen «Funciones principales probadas»
   * y el 100 %) y, si se estaba vigilando un cambio de WILLY que ha roto alguna, se repara sola (o se avisa, o bloqueo).
   */
  const onTestsRun = (run: TestRun, pid: string) => {
    lastTests.current.set(pid, run);
    const ev = testsEvidenceOf(run);
    if (ev) void recordTests(pid, ev);
    if (pid !== sessionRef.current?.projectId) return;
    if (run.status !== "no-arranca" && run.status !== "parado" && run.total > 0) setTestsLine({ projectId: pid, text: testsSummary(run), ok: run.failed === 0, at: Date.now() });
    if (runningRef.current) return;
    const { step, watch } = testsStep(testsWatch.current, { projectId: pid, run, auto: autoRepair, now: Date.now() });
    testsWatch.current = watch;
    if (step.kind === "nada") return;
    const good = lastGood.current?.projectId === pid ? lastGood.current?.version : null;
    const goodText = good ? `«${good.label}» (${new Date(good.at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})` : null;
    const note = testsNote(step, goodText);
    const cur = sessionRef.current;
    if (note && cur) {
      const next = persist(addTurn(cur, "ia", note, "WILLY"));
      sessionRef.current = next;
      setSession(next);
    }
    if (step.kind === "reparar") {
      setMobilePane("chat");
      void latest.current.execute(testsRepairRequest(step.failing, { attempt: step.attempt }).text, undefined, "Reparación automática", { ownerAlreadySaved: true, noPlaybook: true, testsAttempt: step.attempt });
    }
    if (step.kind === "recuperadas") {
      pushNotice("Pruebas en verde otra vez: pasan todas.", "success");
      void recordAttention(pid, null, (a) => a?.kind === "bloqueo" && a.reason.startsWith("Pruebas automáticas"));
    }
    if (step.kind === "bloqueo") {
      pushNotice("Siguen fallando pruebas después de 2 intentos: WILLY te lo explica en el chat del proyecto.", "warn");
      void recordAttention(pid, { kind: "bloqueo", reason: `Pruebas automáticas que siguen fallando después de ${step.attempts} intentos de reparación: ${step.failing.slice(0, 3).map((r) => `«${r.title}»`).join(", ")}.` });
    }
    if (step.kind === "avisar") pushNotice(`Después de este cambio fallan ${step.failing.length} prueba(s) automática(s).`, "warn");
  };
  const latestTests = useRef(onTestsRun);
  latestTests.current = onTestsRun;

  // Rev23: lo que se ve en la vista previa (sin errores, con errores, en blanco) queda en el plan del proyecto: de ahí salen
  // la tarea «Vista previa sin errores» y el 100 % (Definition of Done). Se espera un momento (no en cada cambio de estado).
  const previewTimer = useRef<number | null>(null);
  useEffect(() => {
    const pid = session?.projectId;
    if (!pid || !previewStatus) return;
    const evidence = previewEvidenceOf(previewStatus, previewErrors, projectRecord?.kind);
    if (!evidence) return;
    previewTimer.current = window.setTimeout(() => { previewTimer.current = null; void recordPreview(pid, evidence, previewErrors); }, 1500);
    return () => { if (previewTimer.current !== null) { window.clearTimeout(previewTimer.current); previewTimer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewStatus, previewErrors, session?.projectId]);

  /**
   * Un encargo que llega del Chat («Abrir en SUPER WILLY») o de «Nuevo proyecto». Un proyecto nuevo sigue por la ENTREVISTA
   * (Project Discovery) con su material; un cambio va al proyecto que nombras (y si no se sabe cuál, se pregunta).
   */
  const processHandoff = async (h: Handoff) => {
    if (runningRef.current) {
      setPrompt(h.text);
      pushNotice("SUPER WILLY está terminando otra tarea: tu encargo queda escrito en el cuadro para cuando acabe.", "warn");
      return;
    }
    setChoice(null);
    if (h.images.length) await pictures.add(h.images);
    const material = handoffContext(h);
    const withPictures = h.images.length > 0;
    if (h.projectId) {
      if (!(await openProject(h.projectId))) return;
      await wait(60);
      if (h.autoRun && h.analysis) void latest.current.execute(h.text, undefined, "Análisis del proyecto", { ownerText: "Analiza el proyecto (sus archivos reales) y calcula cuánto lleva y cuánto le falta, sin cambiar nada.", noPlaybook: true, analysis: true });
      else if (h.autoRun) void latest.current.execute(h.text, undefined, "Construcción del proyecto", { ...(material ? { material } : {}), withPictures, ...(h.model ? { preferredModel: h.model } : {}) });
      else setPrompt(h.text);
      return;
    }
    if (h.action === "nuevo" && kindOf(h.text) !== "herramienta") {
      if (sessionRef.current) newProject();
      await wait(30);
      latest.current.startInterview(h.text, handoffNotes(h));
      pushNotice("Encargo traído del Chat: empieza la entrevista del proyecto.", "info");
      return;
    }
    if (h.action === "nuevo") {
      await wait(30);
      void latest.current.execute(h.text, undefined, "Tarea", { ...(material ? { material } : {}), withPictures });
      return;
    }
    const target = mentionedProject(h.text, projectsRef.current.filter((p) => !isExampleProject(p)));
    if (target) {
      if (!(await openProject(target.id))) return;
      await wait(60);
      void latest.current.execute(h.text, undefined, "Cambio", { ...(material ? { material } : {}), withPictures });
      return;
    }
    setChoice(h);
  };

  /** Respuesta a «¿En qué proyecto lo hago?». */
  const resolveChoice = async (where: string) => {
    const h = choice;
    if (!h) return;
    setChoice(null);
    const material = handoffContext(h);
    const withPictures = picturesRef.current.length > 0;
    if (where === "nuevo") { if (sessionRef.current) newProject(); await wait(30); latest.current.startInterview(h.text, handoffNotes(h)); return; }
    if (where === "suelto") { if (sessionRef.current?.projectId) newProject(); await wait(30); void latest.current.execute(h.text, undefined, "Tarea", { ...(material ? { material } : {}), withPictures }); return; }
    if (!(await openProject(where))) return;
    await wait(60);
    void latest.current.execute(h.text, undefined, "Cambio", { ...(material ? { material } : {}), withPictures });
  };

  // Los avisos de fuera (Proyectos, el Chat, «Nuevo proyecto») llegan a escuchadores que se ponen una sola vez: siempre
  // llaman a la versión de AHORA de cada función (con los ajustes y el estado actuales).
  const latest = useRef({ openProject, processHandoff, execute, startInterview });
  latest.current = { openProject, processHandoff, execute, startInterview };

  // Proyectos pide abrir un proyecto: se carga su conversación (de este navegador o de tu equipo) o se empieza una.
  useEffect(() => {
    const first = takePendingProject();
    if (first) void latest.current.openProject(first);
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id !== "string" || !id) return;
      takePendingProject();
      void latest.current.openProject(id);
    };
    window.addEventListener(OPEN_PROJECT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PROJECT_EVENT, onOpen);
  }, []);

  // Encargos del Chat y de «Nuevo proyecto» (aunque esta pestaña se abra después: se recogen al abrirse).
  useEffect(() => {
    const first = takeHandoff();
    if (first) void latest.current.processHandoff(first);
    const onHandoff = () => {
      const h = takeHandoff();
      if (h) void latest.current.processHandoff(h);
    };
    window.addEventListener(HANDOFF_EVENT, onHandoff);
    return () => window.removeEventListener(HANDOFF_EVENT, onHandoff);
  }, []);

  const repair = async () => {
    if (running) return;
    const previousAnswer = answer;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setSteps([]);
    const result = await selfRepair({
      endpoint: settings.endpoint,
      ...(superModel ? { preferred: superModel } : {}),
      available,
      subject: "Última respuesta de la IA",
      problem: previousAnswer || prompt || "La respuesta anterior estaba incompleta o no funcionaba.",
      signal: controller.signal,
      onStep: (s) => setSteps((prev) => [...prev, s]),
    });
    const current = abort.current === controller;
    if (current) {
      setRunning(false);
      abort.current = null;
    }
    // La respuesta anterior solo se sustituye si la reparación sale bien: un fallo ya no la borra.
    if (!result.ok) {
      if (controller.signal.aborted) return;
      return pushNotice(`⚠️ ${result.error}`, "warn");
    }
    setAnswer(result.data.text);
    setSolvedBy(result.data.model);
    pushNotice("Autorreparación completada.", "success");
  };

  const toggleVoice = () => {
    if (dictating) {
      voice.current?.stop();
      voice.current = null;
      setDictating(false);
      setPartial("");
      return;
    }
    const s = startDictation({
      onText: (t) => setPrompt((p) => (p ? `${p} ${t}` : t)),
      onPartial: setPartial,
      onError: (m) => {
        pushNotice(`⚠️ ${m}`, "warn");
        voice.current?.stop();
        voice.current = null;
        setDictating(false);
        setPartial("");
      },
      onEnd: () => {
        setDictating(false);
        setPartial("");
      },
    });
    if (!s) {
      pushNotice("⚠️ Este navegador no soporta dictado. Prueba con Chrome o Edge.", "warn");
      return;
    }
    voice.current = s;
    setDictating(true);
  };

  const redesign = (styleId: string | null) => {
    if (running) return;
    const style = DESIGN_STYLES.find((s) => s.id === styleId) ?? null;
    const target = session?.prompt || prompt || "el último proyecto generado";
    void execute(redesignBrief(style, notes, target), "web", "Rediseño completo");
  };

  const download = () => {
    const blob = new Blob([answer], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `willy-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const textIsProject = !interviewing && !projectMode && !pictures.images.length && Boolean(prompt.trim()) && kindOf(prompt) !== "herramienta"
    && (projectRequest(prompt) === "nuevo" || (projectRequest(prompt) === "posible" && !projectActive));
  const visibleTurns = session?.turns ?? [];

  // ------------------------------------------------------------------ piezas comunes

  const onPasteImages = (e: { clipboardData: DataTransfer; preventDefault: () => void }) => {
    const found = imageFilesOf(e.clipboardData.files);
    if (!found.length) return;
    e.preventDefault();
    void pictures.add(found);
  };
  const onDropImages = (e: { dataTransfer: DataTransfer; preventDefault: () => void }) => {
    const found = imageFilesOf(e.dataTransfer.files);
    if (!found.length) return;
    e.preventDefault();
    void pictures.add(found);
  };

  const stepChips = steps.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {steps.map((s, i) => (
        <span
          key={`${s.model}-${i}`}
          title={s.detail ?? ""}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
            s.state === "ok"
              ? "border-emerald-500/40 text-emerald-500"
              : s.state === "relevo"
                ? "border-amber-500/40 text-amber-500"
                : "border-border text-muted-foreground"
          }`}
        >
          {s.state === "probando" && <Loader2 className="size-3 animate-spin" />}
          {s.state === "ok" && <Check className="size-3" />}
          {s.model}
          {s.state === "relevo" ? " · relevo" : ""}
        </span>
      ))}
    </div>
  );

  const progress = running && totalEst > 0 ? progressOf(written, totalEst, startedAt ? Date.now() - startedAt : 0) : null;
  const progressBar = progress && (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span><ThinkingDots label="Pensando" /></span>
        <span>{progress.pct}%{progress.remaining !== null && ` · quedan ~${formatDuration(progress.remaining ?? 0)}`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.pct}%` }} />
      </div>
    </div>
  );

  const choiceCard = choice && (
    <div role="region" aria-label="Encargo traído del Chat">
    <Card className="space-y-3 border-primary/40">
      <p className="text-sm"><span className="font-semibold">Traído del Chat:</span> «{cut(choice.text, 260)}»</p>
      {(choice.attachments.length > 0 || choice.urls.length > 0 || choice.images.length > 0) && (
        <p className="text-xs text-muted-foreground">Con {[choice.attachments.length ? `${choice.attachments.length} adjunto(s)` : "", choice.images.length ? `${choice.images.length} imagen(es)` : "", choice.urls.length ? `${choice.urls.length} enlace(s)` : ""].filter(Boolean).join(", ")}.</p>
      )}
      <p className="text-sm font-semibold">¿En qué proyecto lo hago?</p>
      <div className="flex flex-wrap gap-2">
        {[...projects].filter((p) => !isExampleProject(p)).sort((a, b) => (a.id === session?.projectId ? -1 : b.id === session?.projectId ? 1 : b.updatedAt.localeCompare(a.updatedAt))).slice(0, 5).map((p) => (
          <Button key={p.id} size="sm" variant="secondary" onClick={() => void resolveChoice(p.id)}>En «{cut(p.name, 40)}»</Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => void resolveChoice("nuevo")}><Sparkles className="size-3.5" />Es un proyecto nuevo</Button>
        <Button size="sm" variant="ghost" onClick={() => void resolveChoice("suelto")}>Hacerlo sin proyecto</Button>
        <Button size="sm" variant="ghost" onClick={() => { setPrompt(choice.text); setChoice(null); }}>Solo copiarlo al cuadro</Button>
      </div>
    </Card>
    </div>
  );

  const playbookCard = pb && (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="size-4 text-primary" />Guía de entrega: {pb.name}
        </p>
        <span className="text-xs text-muted-foreground">
          {doneCount}/{pb.must.length} imprescindibles · listo para entregar a un cliente
        </span>
      </div>
      <ul className="space-y-1">
        {pb.must.map((m) => {
          const done = session?.done.includes(m) ?? false;
          return (
            <li key={m}>
              <button type="button" onClick={() => toggleDone(m)} className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent/40">
                <Check className={`mt-0.5 size-4 shrink-0 ${done ? "text-emerald-500" : "text-muted-foreground/40"}`} />
                <span className={done ? "text-muted-foreground line-through" : ""}>{m}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {pb.ask.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">Opcional: decide qué incluir y la IA lo tendrá en cuenta</p>
          {pb.ask.map((a) => {
            const yes = session?.accepted.includes(a);
            const no = session?.rejected.includes(a);
            return (
              <div key={a} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
                <span className="min-w-0 text-sm">{a}</span>
                {yes ? (
                  <span className="text-xs font-semibold text-emerald-500">Incluido</span>
                ) : no ? (
                  <span className="text-xs text-muted-foreground">Descartado</span>
                ) : (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => decide(a, true)}>Sí</Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => decide(a, false)}>No</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );

  // Decisiones pendientes (las preguntas «PENDIENTE» de la IA): se ven sin interrumpir (rediseño, punto 91).
  const pendingCard = session?.pending.length ? (
    <Card className="space-y-1.5">
      <p className="text-xs font-semibold text-amber-500">{session.pending.length} decisión(es) pendiente(s) · Preguntas de la IA:</p>
      {session.pending.map((p) => (
        <div key={p} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 px-2 py-1.5">
          <span className="min-w-0 text-sm">{p}</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => decide(p, true)}>Sí</Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => decide(p, false)}>No</Button>
          </div>
        </div>
      ))}
    </Card>
  ) : null;

  const proposalCard = pb && proposal && !running && (
    <Card className="space-y-3 border-primary/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold"><Wand2 className="mr-2 inline size-4 text-primary" />La IA propone: ¿cambio de diseño completo?</p>
        <Button size="sm" variant="ghost" onClick={() => setProposal(false)}>Ahora no</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        El proyecto «{session?.prompt.slice(0, 60) || prompt.slice(0, 60)}…» ya está terminado. Si quieres, la IA
        rehace su interfaz entera con otro estilo, sin tocar la funcionalidad.
      </p>
      <div className="flex gap-2">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Indicaciones opcionales: colores de marca, marca, referencias…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <ClarifyButton context="prompt" iconOnly variant="outline" value={notes} onApply={setNotes} />
      </div>
      <div className={`grid gap-2 ${projectMode ? "sm:grid-cols-2" : "sm:grid-cols-2 md:grid-cols-4"}`}>
        {DESIGN_STYLES.map((s) => (
          <button key={s.id} type="button" disabled={running} onClick={() => redesign(s.id)} className="rounded-lg border border-border p-3 text-left transition hover:border-primary/60 hover:bg-accent/40 disabled:opacity-50">
            <p className="text-sm font-semibold">{s.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{s.desc}</p>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        También puedes ignorar la propuesta y pedir un rediseño más tarde con texto libre: «hazme otro diseño
        completamente distinto para la tienda».
      </p>
    </Card>
  );

  // ------------------------------------------------------------------ CON UN PROYECTO ABIERTO: chat del proyecto + taller

  // El chat del proyecto baja solo al último mensaje (y sigue lo que escribe la IA si estás abajo del todo).
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [projectMode, session?.id, visibleTurns.length, liveNote]);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [answer]);

  if (projectMode && session?.projectId) {
    const projectId = session.projectId;
    const layoutNow = LAYOUTS.find((l) => Math.abs(l.pct - chatPct) <= 1)?.id ?? null;
    const setLayout = (pct: number) => { const n = clampPct(pct); setChatPct(n); saveChatPct(n); };
    const onDividerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onDividerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !splitRef.current) return;
      const r = splitRef.current.getBoundingClientRect();
      if (r.width > 0) setChatPct(clampPct(((e.clientX - r.left) / r.width) * 100));
    };
    const onDividerUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      saveChatPct(chatPctRef.current);
    };
    const onDividerKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); setLayout(chatPct - 2); }
      if (e.key === "ArrowRight") { e.preventDefault(); setLayout(chatPct + 2); }
    };
    // Lo que está haciendo, en una palabra (rediseño, punto 90): analizando, construyendo, respondiendo, guardando…
    const activity = savingFiles ? "guardando…" : running ? (!answer ? "analizando…" : /```/.test(answer) ? "construyendo…" : "respondiendo…") : null;
    // Sin nada en marcha, el mismo estado que en Proyectos («En desarrollo», «Esperando tu decisión»…), como en la maqueta.
    const statusId = projectRecord ? projectStatus({ state: projectRecord.state, working: running, plan: normalizePlan(projectRecord.plan ?? null) }) : null;
    const stage = activity ?? (discovery?.stage === "construyendo" ? "construyendo…" : statusId ? STATUS_LABEL[statusId] : discovery ? "construido" : "abierto");
    const stageTone = running || savingFiles ? "border-primary/40 text-primary" : statusId && needsAttention(statusId) ? "border-amber-500/50 text-amber-700 dark:text-amber-300" : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    const kindKey = discovery?.kind ?? projectRecord?.kind ?? "";
    const kindLabel = kindKey ? ((KIND_LABELS as Record<string, string>)[kindKey] ?? TYPE_LABELS[kindKey] ?? kindKey) : null;
    const PREVIEW_WORDS: Record<VisualContext["state"], string> = { vacio: "sin archivos", "sin-pagina": "sin página", "sin-vista": "falta vista-previa.html", cargando: "cargando", lista: "lista", actualizando: "actualizando", error: "con error", "en-blanco": "en blanco", compilando: "compilando", "no-compila": "no compila" };
    const conversation = visibleTurns.filter((t) => t.kind !== "entrevista" || t.role === "ia");
    const openFile = (path: string) => { setFocus({ tab: "codigo", path, nonce: Date.now() }); setMobilePane("taller"); };

    return (
      <div className="flex min-h-0 flex-1 flex-col" data-superwilly="proyecto">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-card px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-primary" />
            <span className="shrink-0 text-sm font-bold">SUPER WILLY</span>
            <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
              <span className="shrink-0">· Proyecto:</span>
              {/* Selector de proyecto de la maqueta (Súper IA): abre otro proyecto con el mismo «openProject» de siempre. */}
              <Menu label="Cambiar de proyecto" trigger={({ toggle }) => (
                <button type="button" onClick={toggle} disabled={running} title="Cambiar de proyecto" aria-label={`Proyecto «${projectName}»: cambiar de proyecto`}
                  className="flex min-w-0 max-w-[16rem] items-center gap-1 rounded-md px-1 font-semibold text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60">
                  <span className="truncate">«{projectName}»</span><ChevronDown className="size-3.5 shrink-0" />
                </button>
              )}>
                {(close) => (
                  <>
                    <MenuLabel>Cambiar de proyecto</MenuLabel>
                    {[...projects].filter((p) => !isExampleProject(p) && p.state !== "Archivado").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12).map((p) => (
                      <MenuItem key={p.id} active={p.id === session?.projectId} onClick={() => { close(); if (p.id !== session?.projectId) void openProject(p.id); }}>
                        {p.id === session?.projectId ? <Check className="size-4 shrink-0" /> : <FolderKanban className="size-4 shrink-0" />}<span className="truncate">{p.name}</span>
                      </MenuItem>
                    ))}
                    <div className="my-1 h-px bg-border" />
                    <MenuItem onClick={() => { close(); openView("proyectos"); }}>Ver todos en Proyectos</MenuItem>
                  </>
                )}
              </Menu>
            </span>
          </span>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stageTone}`} title="Estado del proyecto (el mismo que en Proyectos)">{stage}</span>
          {kindLabel && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline" title="Tipo de proyecto">{kindLabel}</span>}
          {discovery && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{requirementsCount(discovery)} requisitos</span>}
          {projectVersions.length > 0 && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline" title={`Última versión guardada: ${projectVersions[0]!.label}`}>v{projectVersions.length}</span>}
          {previewStatus && <span className={`hidden shrink-0 text-xs md:inline ${isBrokenPreview(previewStatus) ? "font-semibold text-destructive" : "text-muted-foreground"}`}>Vista previa: {PREVIEW_WORDS[previewStatus]}</span>}
          <SuperModeChip mode={superMode} onMode={chooseMode} available={available} localModel={settings.superIaModel} onLocalModel={(name) => updateSettings({ superIaModel: name })} />
          <div className="flex-1" />
          <div className="hidden items-center gap-0.5 rounded-md border border-border p-0.5 lg:flex" role="group" aria-label="Reparto de la pantalla">
            {LAYOUTS.map((l) => (
              <button key={l.id} type="button" onClick={() => setLayout(l.pct)} aria-pressed={layoutNow === l.id} aria-label={l.label} title={l.label}
                className={`flex size-7 items-center justify-center rounded ${layoutNow === l.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <l.icon className="size-3.5" />
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2 text-xs sm:px-3" onClick={newProject} disabled={running} aria-label="Nuevo proyecto" title="Este proyecto queda guardado: lo retomas desde Proyectos o con «Continuar donde lo dejaste»">
            <FolderPlus className="size-3.5" /><span className="hidden sm:inline">Nuevo proyecto</span>
          </Button>
        </div>

        {!wide && (
          <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card p-1.5" role="tablist" aria-label="Qué ver">
            {([["chat", "Chat del proyecto"], ["taller", "Vista previa y archivos"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={mobilePane === id} onClick={() => setMobilePane(id)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold ${mobilePane === id ? "bg-accent text-foreground" : "text-muted-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        <div ref={splitRef} className="flex min-h-0 flex-1">
          <section
            aria-label="Chat del proyecto"
            className={`${wide || mobilePane === "chat" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col bg-background ${wide ? "shrink-0 border-r border-border" : "flex-1"}`}
            style={wide ? { width: `${chatPct}%` } : undefined}
          >
            <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {choiceCard}
              <p className="text-xs text-muted-foreground">
                Proyecto en curso: <span className="font-semibold text-foreground">«{projectName}»</span> · Guardado en Proyectos, en tu equipo. Lo que pidas aquí cambia este proyecto: WILLY recuerda la conversación y ve sus archivos.
              </p>
              {discovery && (
                <details className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-semibold text-primary">Ver el brief del proyecto ({requirementsCount(discovery)} requisitos)</summary>
                  <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[8rem_1fr]">
                    {briefOf(discovery).map((line) => (
                      <div key={line.label} className="contents">
                        <dt className="font-semibold text-muted-foreground">{line.label}</dt>
                        <dd>{line.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
              {pb && <details className="rounded-lg border border-border px-3 py-2 text-xs"><summary className="cursor-pointer font-semibold">Guía de entrega: {pb.name} ({doneCount}/{pb.must.length})</summary><div className="mt-2">{playbookCard}</div></details>}
              {pendingCard}

              <p className="text-sm font-semibold">Conversación de este proyecto{conversation.length ? ` (${conversation.length} mensaje(s))` : ""}</p>
              {conversation.length === 0 && !running && (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Cuéntale a SUPER WILLY qué quieres hacer en este proyecto: «cambia el color del botón», «añade una página de contacto», «hazlo más elegante en el móvil»…
                </p>
              )}
              {conversation.map((t, i) => (
                <article key={`${t.at}-${i}`} className={`rounded-lg border px-3 py-2 ${t.role === "owner" ? "border-border bg-card" : "border-primary/30 bg-primary/5"} ${t.kind === "entrevista" ? "opacity-80" : ""}`}>
                  <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
                    {t.role === "owner" ? "Tú" : t.model ? `SUPER WILLY · ${t.model}` : "SUPER WILLY"}{t.kind === "entrevista" ? " · entrevista" : ""}
                  </p>
                  {t.role === "owner"
                    ? <p className="whitespace-pre-wrap break-words text-sm">{cut(t.text, 600)}</p>
                    : <AnswerBody text={t.text} onOpenFile={openFile} />}
                </article>
              ))}
              {(running || liveNote) && (
                <article className={`rounded-lg border px-3 py-2 ${liveNote === "error" ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}`} aria-live="polite">
                  <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
                    SUPER WILLY{solvedBy ? ` · ${solvedBy}` : ""} · {running ? "trabajando…" : liveNote === "detenido" ? "detenido" : "no ha podido"}
                  </p>
                  {answer ? <AnswerBody text={answer} onOpenFile={openFile} streaming={running} /> : running ? <ThinkingDots label="Pensando" /> : null}
                  {progressBar}
                </article>
              )}
              {lastSaved && !running && (
                <p className="flex flex-wrap items-center gap-2 text-xs" role="status">
                  {lastSaved.saved > 0 && <span className="font-semibold text-emerald-600 dark:text-emerald-400">✅ {lastSaved.saved} archivo(s) guardados en el proyecto.</span>}
                  {testsLine && testsLine.projectId === projectId && <span className={`font-semibold ${testsLine.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`} data-linea-pruebas>🧪 Pruebas: {testsLine.text}.</span>}
                  {lastSaved.rejected.length > 0 && <span className="text-amber-600 dark:text-amber-400">⚠️ No guardados (venían incompletos): {lastSaved.rejected.join(", ")}.</span>}
                  <button type="button" className="font-semibold text-primary" onClick={() => { setFocus({ tab: "vista", nonce: Date.now() }); setMobilePane("taller"); }}>Ver la vista previa</button>
                  <button type="button" className="font-semibold text-primary" onClick={() => { setFocus({ tab: "cambios", nonce: Date.now() }); setMobilePane("taller"); }}>Ver los cambios</button>
                </p>
              )}
              {proposalCard}
            </div>

            <div className="shrink-0 space-y-2 border-t border-border bg-card p-2.5">
              {stepChips}
              <div className="rounded-lg border border-border bg-background focus-within:border-primary">
                {pictures.images.length > 0 && <div className="p-2 pb-0"><ImageChips images={pictures.images} onRemove={pictures.remove} /></div>}
                <textarea
                  value={prompt}
                  onChange={(e: { target: { value: string } }) => setPrompt(e.target.value)}
                  onKeyDown={(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; preventDefault: () => void }) => { if (e.key === "Enter" && (!e.shiftKey || e.ctrlKey || e.metaKey)) { e.preventDefault(); onMain(); } }}
                  onPaste={onPasteImages}
                  onDragOver={(e: { preventDefault: () => void }) => e.preventDefault()}
                  onDrop={onDropImages}
                  rows={3}
                  aria-label="Qué quieres que haga SUPER WILLY en este proyecto"
                  placeholder="Pide un cambio, pregunta o pega una captura… (Intro envía; Mayúsculas+Intro, salto de línea)"
                  className="block w-full resize-none rounded-lg bg-transparent p-2.5 text-sm outline-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {running ? (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { abort.current?.abort(); setRunning(false); }}><Square className="size-3.5" />Detener</Button>
                ) : (
                  <Button size="sm" className="gap-1.5" onClick={onMain} disabled={!prompt.trim()}><Send className="size-3.5" />Enviar</Button>
                )}
                <ClarifyButton context="prompt" variant="outline" label="Aclarar con IA" value={prompt} onApply={setPrompt} />
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => askInProject("La última respuesta estaba incompleta o no funcionaba. Revísala con los archivos actuales del proyecto y entrega la versión corregida y COMPLETA de lo que haga falta.")} disabled={running} title="Si la última respuesta estaba incompleta o no funcionaba, WILLY la revisa con los archivos del proyecto y guarda lo corregido"><RotateCcw className="size-3.5" />Autorreparar</Button>
                {voiceSupported() && (
                  <Button variant={dictating ? "primary" : "ghost"} size="icon" className="ml-auto size-8 shrink-0" onClick={toggleVoice} title={dictating ? "Parar el dictado" : "Dictar por voz"} aria-label={dictating ? "Parar el dictado" : "Dictar por voz"}>
                    <Mic className={`size-4 ${dictating ? "animate-pulse" : ""}`} />
                  </Button>
                )}
              </div>
            </div>
          </section>

          {wide && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Cambiar el ancho del chat y de la vista previa"
              aria-valuemin={20}
              aria-valuemax={75}
              aria-valuenow={chatPct}
              tabIndex={0}
              onPointerDown={onDividerDown}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
              onPointerCancel={onDividerUp}
              onKeyDown={onDividerKey}
              className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
            />
          )}

          <div className={`${wide || mobilePane === "taller" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1`}>
            <ProjectWorkshop
              projectId={projectId}
              running={running || savingFiles}
              liveText={running || savingFiles ? answer : ""}
              onAsk={askInProject}
              focus={focus}
              onVisualContext={(c) => { visualRef.current = c; setPreviewStatus(c.state); setPreviewErrors(c.errors); }}
              autoRepair={autoRepair}
              onAutoRepair={setAutoRepair}
              vision={{ endpoint: settings.endpoint, model: settings.model }}
              onTestsRun={(run, pid) => latestTests.current(run, pid)}
              testsKnown={projectRecord?.plan?.evidence.tests ?? null}
            />
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ SIN PROYECTO ABIERTO (o en plena entrevista)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
    <div className="mx-auto w-full max-w-5xl space-y-5">
      {restore && !session && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/40">
          <p className="min-w-0 text-sm">
            <span className="font-semibold">Continuar donde lo dejaste:</span>{" "}
            <span className="text-muted-foreground">{restore.title}</span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => resume(restore)}>Continuar</Button>
            <Button size="sm" variant="outline" onClick={() => { removeSession(restore.id); setRestore(null); }}>
              Descartar
            </Button>
          </div>
        </Card>
      )}

      {choiceCard}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">SUPER WILLY</h1>
          <p className="text-sm text-muted-foreground">
            Tu mesa de operaciones: pide lo que quieras o dime qué proyecto quieres crear. Antes de construir un proyecto te pregunto, te aconsejo y te enseño el resumen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SuperModeChip mode={superMode} onMode={chooseMode} available={available} localModel={settings.superIaModel} onLocalModel={(name) => updateSettings({ superIaModel: name })} />
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            {available.length ? `${available.length} ${available.length === 1 ? "modelo" : "modelos"} en tu equipo` : "Sin motor local detectado"}
          </span>
        </div>
      </div>

      {/* ------------------------------------------------ petición universal */}
      <Card className="space-y-3">
        {projectActive && session && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            <span className="min-w-0">
              {interviewing
                ? <>Entrevista de <span className="font-semibold">«{discovery?.name}»</span>: lo que escribas aquí son tus respuestas (por ejemplo «1C, 2B») o cosas que añadir.</>
                : <>Proyecto en curso: <span className="font-semibold">«{session.discovery?.name ?? session.title}»</span>{visibleTurns.length ? ` (${visibleTurns.filter((t) => t.kind !== "entrevista").length} mensaje(s))` : ""}. Lo que pidas sigue este proyecto: WILLY recuerda la conversación.</>}
              {session.projectId && <span className="ml-1 text-muted-foreground">Guardado en Proyectos, en tu equipo.</span>}
            </span>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={newProject} disabled={running}><FolderPlus className="size-3.5" />Nuevo proyecto</Button>
          </div>
        )}
        <div className="rounded-lg border border-border bg-background focus-within:border-primary">
          {pictures.images.length > 0 && <div className="p-3 pb-0"><ImageChips images={pictures.images} onRemove={pictures.remove} /></div>}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e: { key: string; ctrlKey: boolean; metaKey: boolean; preventDefault: () => void }) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onMain(); } }}
          onPaste={onPasteImages}
          onDragOver={(e: { preventDefault: () => void }) => e.preventDefault()}
          onDrop={onDropImages}
          rows={interviewing ? 2 : 5}
          aria-label={interviewing ? "Tu respuesta" : "Qué quieres que haga SUPER WILLY"}
          placeholder={interviewing
            ? "Responde aquí (por ejemplo «1C, 2B» o «haz lo que recomiendas») o pulsa las opciones de abajo. También: «el cliente también quiere…»."
            : "Ejemplo: quiero crear una app para mi peluquería con reservas. O cualquier otra cosa: investiga, traduce, redacta…"}
          className="w-full resize-y rounded-lg bg-transparent p-3 text-sm outline-none"
        />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!interviewing && (
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TaskKind | "auto")}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              aria-label="Tipo de tarea"
            >
              <option value="auto">Detectar solo ({TASK_LABELS[detectTask(prompt || "hola")]})</option>
              {(Object.keys(TASK_LABELS) as TaskKind[]).map((k) => (
                <option key={k} value={k}>{TASK_LABELS[k]}</option>
              ))}
            </select>
          )}

          {running ? (
            <Button variant="outline" className="gap-2" onClick={() => { abort.current?.abort(); setRunning(false); }}>
              <Square className="size-4" />Detener
            </Button>
          ) : (
            <Button className="gap-2" onClick={onMain} disabled={!prompt.trim()}>
              {interviewing ? <><Check className="size-4" />Responder</> : textIsProject ? <><Sparkles className="size-4" />Empezar el proyecto</> : <><Play className="size-4" />Ejecutar</>}
            </Button>
          )}

          {textIsProject && !running && (
            <Button variant="ghost" className="gap-2" title="Sin entrevista: WILLY construye directamente con lo que has escrito" onClick={() => void execute(prompt, undefined, "Construcción del proyecto", { newProject: true, noPlaybook: true })}>
              <Hammer className="size-4" />Construir ya sin preguntas
            </Button>
          )}

          {!interviewing && (
            <Button variant="outline" className="gap-2" disabled={!prompt.trim()} title="Copia este prompt y abre Lovable. No usa API (Lovable no tiene una gratuita): allí solo hay que pegarlo si no aparece y pulsar enviar." onClick={() => { if (hasUnfilled(prompt)) { pushNotice("Falta rellenar el hueco marcado con «<<…>>» en el cuadro de arriba.", "warn"); return; } void navigator.clipboard?.writeText(prompt).catch(() => undefined); window.open(lovableUrl(prompt) ?? "https://lovable.dev/", "_blank", "noopener,noreferrer"); pushNotice("Prompt copiado. Se abre Lovable: si no aparece escrito, pégalo y pulsa enviar.", "warn"); }}>
              Abrir en Lovable
            </Button>
          )}

          <ClarifyButton context="prompt" variant="outline" label="Aclarar con IA" value={prompt} onApply={setPrompt} />

          {!interviewing && (
            <Button variant="secondary" className="gap-2" onClick={() => void repair()} disabled={running}>
              <RotateCcw className="size-4" />Autorreparar
            </Button>
          )}
          {voiceSupported() && (
            <Button
              variant={dictating ? "primary" : "outline"}
              size="icon"
              className="ml-auto shrink-0"
              onClick={toggleVoice}
              title={dictating ? "Parar el dictado" : "Dictar por voz"}
              aria-label={dictating ? "Parar el dictado" : "Dictar por voz"}
            >
              <Mic className={`size-4 ${dictating ? "animate-pulse" : ""}`} />
            </Button>
          )}
        </div>

        {progressBar ?? (!running && !interviewing && (prompt.trim() || pb) ? (
          <p className="text-xs text-muted-foreground">
            {textIsProject
              ? "Es un proyecto: antes de construir te haré unas preguntas por bloques, con mi recomendación en cada una (o pulsa «Construir ya sin preguntas»)."
              : <>Duración estimada de esta tarea: ~{formatDuration(estimateSeconds(pb, session?.accepted.length ?? 0, prompt))}. Se ajusta con cada ejecución a la velocidad real de tu equipo.</>}
          </p>
        ) : null)}

        {stepChips}
      </Card>

      {/* ------------------------------------------ entrevista del proyecto */}
      {discovery && interviewing && (
        <ProjectDiscoveryPanel
          state={discovery}
          onChange={(next) => { if (next.mode !== discovery.mode) writeDecisionMode(next.mode); saveDiscovery(next); setUnderstood(""); }}
          onBuild={buildProject}
          onExit={newProject}
          onRecommendMore={() => void recommendMore()}
          recommending={recommending}
          busy={running}
          understood={understood}
        />
      )}
      {discovery && !interviewing && (
        <Card className="space-y-2 border-primary/30 text-sm">
          <p className="min-w-0">
            <Hammer className="mr-1.5 inline size-4 text-primary" />
            <span className="font-semibold">«{discovery.name}»</span> · {requirementsCount(discovery)} requisitos · {discovery.stage === "construyendo" ? "construyendo…" : "construido: sigue pidiendo cambios arriba (WILLY recuerda todo el proyecto)."}
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-primary">Ver el brief del proyecto</summary>
            <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[9rem_1fr]">
              {briefOf(discovery).map((line) => (
                <div key={line.label} className="contents">
                  <dt className="font-semibold text-muted-foreground">{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Card>
      )}

      {/* ---------------------------------------------- guía de entrega (playbook) */}
      {playbookCard}
      {pendingCard}

      {/* ------------------------------------------- conversación del proyecto */}
      {visibleTurns.length > 0 && (
        <Card className="space-y-2">
          <p className="text-sm font-semibold">Conversación de este proyecto ({visibleTurns.length} mensaje(s))</p>
          <div className="max-h-72 space-y-2 overflow-auto">
            {visibleTurns.map((t, i) => (
              <div key={i} className={`rounded-lg border px-3 py-2 text-xs ${t.role === "owner" ? "border-border bg-background" : "border-primary/30 bg-primary/5"} ${t.kind === "entrevista" ? "opacity-80" : ""}`}>
                <p className="mb-1 font-semibold text-muted-foreground">
                  {t.role === "owner" ? "Tú" : t.model ? `SUPER WILLY · ${t.model}` : "SUPER WILLY"}{t.kind === "entrevista" ? " · entrevista" : ""}
                </p>
                <p className="whitespace-pre-wrap break-words">{t.text.length > 400 ? `${t.text.slice(0, 400)}…` : t.text}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ------------------- propuesta de rediseño: solo al terminar un proyecto */}
      {proposalCard}

      {/* ------------------------------------------------------- resultado */}
      {(answer || running) && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              Resultado{solvedBy ? ` · resuelto por ${solvedBy}` : running ? " · trabajando…" : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" className="gap-2" onClick={() => { void navigator.clipboard.writeText(answer); pushNotice("Copiado al portapapeles.", "success"); }}>
                <Copy className="size-4" />Copiar
              </Button>
              <Button size="sm" variant="secondary" className="gap-2" onClick={download}>
                <Download className="size-4" />Descargar
              </Button>
              <Button size="sm" variant={speaking ? "outline" : "secondary"} className="gap-2" onClick={toggleSpeak}>
                {speaking ? <Square className="size-4" /> : <Volume2 className="size-4" />}
                {speaking ? "Parar" : "Leer en voz alta"}
              </Button>
              <VoiceSelect className="self-center" />
            </div>
          </div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-sm leading-relaxed">
            {answer || "…"}
          </pre>
        </Card>
      )}

      {/* ----------------------------------------------------- capacidades */}
      <div>
        <h2 className="text-lg font-bold">Qué puedes pedirle</h2>
        <p className="mb-2 text-xs text-muted-foreground">«Usar prompt» lo carga arriba para que lo edites; «Ejecutar ya» lo ejecuta con lo que hayas escrito en el cuadro de arriba.</p>
        <div className="grid gap-2 md:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <Card key={c.id} className="flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <c.icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.desc}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setPrompt(c.template); setKind(c.kind); window.scrollTo({ top: 0, behavior: "smooth" }); pushNotice("Prompt cargado. Escribe tu idea en el hueco «<<…>>» y pulsa Ejecutar.", "warn"); }}>
                  Usar prompt
                </Button>
                <Button size="sm" variant="outline" title="Ejecuta este prompt con lo que hayas escrito en el cuadro de arriba" onClick={() => runCard(c)} disabled={running || interviewing}>
                  Ejecutar ya
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* --------------------------------------------------------- mi yo IA */}
      <Card className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Mic className="size-4 text-primary" />Mi yo en IA</p>
        <p className="text-xs text-muted-foreground">
          Describe cómo hablas y escribes. Se añade a todas las peticiones para que el contenido suene a ti.
        </p>
        <textarea
          value={persona}
          onChange={(e) => savePersona(e.target.value)}
          rows={3}
          placeholder="Ejemplo: hablo directo y cercano, frases cortas, sin tecnicismos, con ejemplos reales y un toque de humor."
          className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
        />
        <div><ClarifyButton context="funcion" compact variant="secondary" label="Que la IA lo entienda exactamente" value={persona} onApply={savePersona} /></div>
      </Card>

      {/* ------------------------------------------------------ aprendizaje */}
      <Card className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold"><Brain className="size-4 text-primary" />Lo que la IA ha aprendido</p>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => { resetLearning(); pushNotice("Aprendizaje reiniciado.", "info"); }}>
            <Trash2 className="size-4" />Reiniciar
          </Button>
        </div>
        {stats.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía sin datos. Con cada tarea resuelta, el modelo que acierta sube en la cadena de relevo.</p>
        ) : (
          <div className="space-y-1.5">
            {stats.map((s) => (
              <div key={`${s.kind}-${s.model}`} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{TASK_LABELS[s.kind]}</span>
                <span className="font-mono">{s.model}</span>
                <span className="font-semibold text-primary">{s.wins} acierto(s)</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
    </div>
  );
}
