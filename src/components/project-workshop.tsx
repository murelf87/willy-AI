// SUPER WILLY · TALLER DEL PROYECTO (rediseño, fase 5). Al lado del chat del proyecto: la VISTA PREVIA grande (el proyecto de
// verdad, con sus archivos guardados; mientras WILLY escribe, lo que lleva escrito), y en pestañas el Código, los Archivos, los
// Cambios (diferencias reales entre versiones), la Consola del proyecto, las Versiones (restaurar y comparar) y, en las
// réplicas, la Replicación. Todo sale de los archivos del proyecto guardados en tu equipo (ProjectService): nada inventado.
// (El taller que tenía el Chat se ha MOVIDO aquí: el Chat ya no tiene vista previa ni archivos de proyecto.)
// Revisión 22 (fase 6): se puede ir de una página del proyecto a otra (y se recuerda dónde estabas), la CONSOLA cuenta lo que
// pasa dentro de la página (errores, avisos, recursos que no cargan), antes de decir «Lista» se comprueba que se ve algo de
// verdad, y si no se puede mostrar bien se dice por qué, con «Reparar».
// Revisión 24 (fase 10, edición visual): «Seleccionar elemento» (tocas algo de la vista previa y dices qué cambiar), «Revisar
// diseño» (en ordenador, tableta y móvil, con capturas de verdad) y «Comparar» (ANTES | DESPUÉS). Ver components/visual-tools.
// Revisión 25: los proyectos React/Vite se COMPILAN en tu equipo (con las piezas de WILLY) y la vista previa enseña su código de
// verdad; si no compila, se dice por qué (archivo y línea, librerías que faltan) con «Reparar».
// Revisión 26: MAPA DE PANTALLAS (components/screen-map): todas las pantallas del proyecto (rutas «#/…» y páginas) de un
// vistazo, con si se ven bien, «Abrir» y «Reparar».
// Revisión 28: PRUEBAS AUTOMÁTICAS (components/project-tests): las pruebas del proyecto (pruebas/*.spec.js, formato Playwright)
// que WILLY pasa solo, sin que se vea, después de cada cambio; con «Pasar las pruebas», «Arreglar lo que falla» y «Escribir».

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowLeftRight, ArrowRight, ChevronDown, Clock, Code2, Columns2, Copy, Download, FileCode2, FlaskConical, Folder, FolderKanban,
  LayoutGrid, Loader2, Maximize2, Monitor, MoreHorizontal, MousePointerClick, RotateCcw, RotateCw, Rocket, ScanEye, Share2, ShieldCheck, Smartphone,
  Tablet, Terminal, Trash2, Wand2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { RebuildPanel } from "@/components/rebuild-panel";
import { ScreenMapPanel } from "@/components/screen-map";
import { InstalledLibrariesDialog, MissingLibrariesPanel, useProjectLibraries, type ProjectLibraries } from "@/components/project-libraries";
import { TestsPanel, useProjectTests, type PageSource } from "@/components/project-tests";
import {
  CompareStage, DesignReviewPanel, ElementPanel, PreviewStage, ReviewFrames, type ReviewRun, type VisionConfig,
} from "@/components/visual-tools";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { extractFiles } from "@/lib/ai-standard";
import { openView } from "@/lib/background-tasks";
import { changeSummary, compareFiles, diffLines, hunksOf, type FileChange } from "@/lib/line-diff";
import { htmlPages, previewOf, resolveRef } from "@/lib/live-files";
import { pushNotice } from "@/lib/notifications";
import { usePersistentState } from "@/lib/persistent-state";
import {
  asMonitorMessage, consoleEntryOf, consoleSummary, pageToken, qualityOf, repairRequest, sendOrder, withMonitor, type ConsoleEntry, type PreviewOrder,
  type PreviewStatus, type RawIssue,
} from "@/lib/preview-runtime";
import { designFixRequest, LEVEL_LABEL, mergeReview, REVIEW_DEVICES, reviewConsoleLine, staticChecks, type ReviewDevice, type ReviewIssue } from "@/lib/design-review";
import { elementContext, locateElement, pickedLabel, pickedOf, visualEditRequest, type PickedElement } from "@/lib/visual-edit";
import { mergeFiles } from "@/lib/super-willy-projects";
import { buildScreenMap, hashRoutingRequest, routingOf, screenRepairRequest, screensForAi, screensFromCode, type Screen, type ScreenHealth } from "@/lib/screen-map";
import { copyText, downloadFile } from "@/lib/workspace-store";
import { captureProjectPage, compileProjectPreview, fetchVersion } from "@/services/disk-project-service";
import { compileKey, compileRepairRequest, compileTarget, issueText, missingText, type CompileOutcome } from "@/lib/project-compile";
import { installSummary } from "@/lib/project-libraries";
import { testsBadge, testsBadgeOfEvidence, testsConsoleLines, testsForAi, testsRepairRequest, testsWriteRequest, type TestRun, type TestsEvidence } from "@/lib/project-tests";
import { recordFilesKey } from "@/lib/project-plan-sync";
import { fileService, type CheckIssue } from "@/services/file-service";
import { projectService, useProject, useVersions } from "@/services/project-service";
import { projectModeOf, type GeneratedFile, type ProjectVersion } from "@/types/domain";

export type WorkshopTab = "vista" | "codigo" | "archivos" | "cambios" | "consola" | "versiones" | "replicacion";
export type Device = "ordenador" | "tablet" | "movil";
export type PreviewState = PreviewStatus;
/** Lo que el dueño está viendo (para que «esto», «en el móvil» o «el botón de arriba» se entiendan en el chat del proyecto). */
export type VisualContext = {
  device: Device; width: number | null; page: string | null; state: PreviewState; error: string | null; tab: WorkshopTab;
  /** Ruta de la página que está viendo («#/reservas»), si la página tiene rutas. */
  route: string | null;
  /** Lo que hay en pantalla (título, encabezados, botones y enlaces), según el vigía de la página. */
  outline: string | null;
  /** Versiones guardadas del proyecto y la última (lo último que cambió). */
  versions: number;
  lastVersion: string | null;
  /** Errores que hay ahora en la consola del proyecto. */
  errors: number;
  /** Lo que se le pediría a WILLY para reparar la vista previa (null si no hay nada que reparar). */
  repair: string | null;
  /** Rev24: el elemento que ha elegido en la vista previa, con sus detalles para la IA (null si no hay ninguno elegido). */
  selected?: string | null;
  /** Rev26: las pantallas de la aplicación (del mapa de pantallas), en una frase. */
  screens?: string | null;
  /** Rev28: cómo van sus pruebas automáticas (la última pasada con los archivos de ahora), en una frase. */
  tests?: string | null;
  /** (25/09/2026) Recursos de la página que no cargan (imágenes que no existen en el proyecto…), aunque la página se vea. */
  resources?: string[];
};

const DEVICES: Record<Device, { label: string; width: number | null; icon: typeof Monitor }> = {
  ordenador: { label: "Ordenador", width: null, icon: Monitor },
  tablet: { label: "Tableta", width: 768, icon: Tablet },
  movil: { label: "Móvil", width: 390, icon: Smartphone },
};

const STATE_LABEL: Record<PreviewState, string> = {
  vacio: "Sin archivos todavía",
  "sin-pagina": "Sin página que ver",
  "sin-vista": "Falta vista-previa.html",
  cargando: "Cargando…",
  lista: "Lista",
  actualizando: "Actualizando con lo que escribe WILLY…",
  error: "Error en la página",
  "en-blanco": "Se queda en blanco",
  compilando: "Compilando en tu equipo…",
  "no-compila": "No compila",
};

const TAB_NAMES: Record<WorkshopTab, string> = { vista: "Vista previa", codigo: "Código", archivos: "Archivos", cambios: "Cambios", consola: "Consola", versiones: "Versiones", replicacion: "Replicación" };

/** Una frase para la IA con lo que el dueño está viendo en el taller (rediseño, punto 16: «contexto visual»). */
export function describeVisual(v: VisualContext | null): string {
  if (!v) return "";
  const size = v.width ? `${DEVICES[v.device].label.toLowerCase()} (${v.width} px de ancho)` : "tamaño ordenador";
  const seen0 = `LO QUE EL DUEÑO ESTÁ VIENDO AHORA: la pestaña «${TAB_NAMES[v.tab]}» del taller del proyecto${v.page ? `; la vista previa enseña «${v.page}»${v.route ? ` en la ruta «${v.route}»` : ""} en ${size}` : ""}; estado de la vista previa: ${STATE_LABEL[v.state].toLowerCase()}${v.error ? ` (error de la página: «${v.error}»)` : ""}${v.errors ? `; la consola del proyecto tiene ${v.errors} error(es)` : ""}${v.outline ? `; en pantalla hay: ${v.outline}` : ""}.${v.versions ? ` El proyecto va por la versión ${v.versions}${v.lastVersion ? ` (la última guardada: «${v.lastVersion}»)` : ""}.` : ""} Si dice «esto», «aquí», «este botón» o «en el móvil», se refiere a lo que está viendo.`;
  const seen = `${v.screens ? `${seen0} ${v.screens}` : seen0}${v.tests ? ` ${v.tests}` : ""}`;
  return v.selected ? `${seen}\n\n${v.selected}` : seen;
}

/** Lo que se pide a WILLY cuando el proyecto no tiene una página que se pueda ver aquí. */
export const PREVIEW_REQUEST = "Añade al proyecto «vista-previa.html»: la aplicación completa en un único archivo autocontenido (HTML, CSS y JavaScript dentro, sin dependencias externas), responsive y con todos sus botones funcionando, para verla en la vista previa de WILLY. No cambies nada más.";

const lineCount = (text: string): number => text.split("\n").length;
const fmtDate = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const fmtTime = (at: number): string => new Date(at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Dónde estabas dentro de la vista previa de cada proyecto (página y ruta «#/…»): al volver o recargar, se vuelve ahí.
type Route = { page: string | null; hash: string | null };
const routeKey = (projectId: string): string => `willy-vista-ruta:${projectId}`;
function readRoute(projectId: string): Route {
  try {
    const raw = JSON.parse(window.localStorage.getItem(routeKey(projectId)) ?? "null") as Partial<Route> | null;
    return { page: typeof raw?.page === "string" ? raw.page : null, hash: typeof raw?.hash === "string" ? raw.hash : null };
  } catch {
    return { page: null, hash: null };
  }
}
function saveRoute(projectId: string, route: Route): void {
  try { window.localStorage.setItem(routeKey(projectId), JSON.stringify(route)); } catch { /* sin almacenamiento: solo esta sesión */ }
}

/** Mientras WILLY escribe: los archivos del proyecto con lo que lleva escrito encima (se recalcula cada poco, no en cada letra). */
function useLiveFiles(base: GeneratedFile[], text: string, every = 700): GeneratedFile[] | null {
  const [files, setFiles] = useState<GeneratedFile[] | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const baseRef = useRef(base);
  baseRef.current = base;
  const active = Boolean(text);
  useEffect(() => {
    if (!active) { setFiles(null); return; }
    const tick = () => {
      const found = extractFiles(textRef.current, baseRef.current.map((f) => f.path));
      setFiles(found.length ? mergeFiles(baseRef.current, found) : null);
    };
    tick();
    const timer = window.setInterval(tick, every);
    return () => window.clearInterval(timer);
  }, [active, every]);
  return files;
}

/** Rev25 · La compilación de un proyecto React/Vite: se pide al servidor (en tu equipo) cada vez que cambian sus archivos
 * guardados. Mientras WILLY escribe no se compila lo que está a medias: se espera a que lo guarde. Rev27: `nonce` sube cuando se
 * instalan librerías para el proyecto (hay que volver a compilar aunque los archivos sean los mismos). */
type Compiled = { key: string | null; status: "idle" | "compilando" | "ok" | "error"; outcome?: CompileOutcome; error?: string };
function useCompiled(projectId: string, files: GeneratedFile[] | null, running: boolean, nonce = 0): Compiled {
  const key = files ? `${compileKey(files)}#${nonce}` : null;
  const [state, setState] = useState<Compiled>({ key: null, status: "idle" });
  useEffect(() => {
    if (!key || running) return;
    if (state.key === key && state.status !== "idle") return;
    let alive = true;
    setState({ key, status: "compilando" });
    void compileProjectPreview(projectId).then((r) => {
      if (!alive) return;
      if (!r.ok) setState({ key, status: "error", error: r.error });
      else setState({ key, status: r.data.ok ? "ok" : "error", outcome: r.data });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, running, projectId]);
  return state;
}

/** Líneas que se guardan en la consola (las más antiguas se van). */
const MAX_ENTRIES = 400;
/** Si el vigía no dice nada (la página no deja ejecutar scripts…), se da por cargada a los 5 s. */
const QUALITY_TIMEOUT_MS = 5000;

/** Cómo se pide algo a SUPER WILLY desde el taller: lo que ve el dueño en el chat (`ownerText`) y el nombre de la tarea. */
export type AskOptions = { ownerText?: string; label?: string };

export function ProjectWorkshop({ projectId, running, liveText, onAsk, focus, onVisualContext, autoRepair, onAutoRepair, vision, onTestsRun, testsKnown }: {
  projectId: string;
  /** SUPER WILLY está trabajando en este proyecto. */
  running: boolean;
  /** Lo que lleva escrito la IA (mientras trabaja): la vista previa y el código lo enseñan en directo. */
  liveText: string;
  /** Pedir algo a SUPER WILLY en este proyecto (se ejecuta al momento en el chat del proyecto). */
  onAsk: (text: string, opts?: AskOptions) => void;
  /** Abrir una pestaña (y un archivo) desde fuera: las tarjetas de archivo del chat. */
  focus?: { tab: WorkshopTab; path?: string; nonce: number } | null;
  onVisualContext?: (context: VisualContext) => void;
  /** «Reparar solo si un cambio lo rompe» (lo hace SUPER WILLY; aquí solo se enseña y se cambia). */
  autoRepair?: boolean;
  onAutoRepair?: (on: boolean) => void;
  /** Rev24: el motor local, para que una IA con visión mire las capturas de «Revisar diseño». */
  vision?: VisionConfig;
  /** Rev28: cada pasada de las pruebas automáticas (para el plan del proyecto y la reparación automática). */
  onTestsRun?: (run: TestRun, projectId: string) => void;
  /** Rev28: la última pasada de las pruebas apuntada en el plan (con la huella de sus archivos). */
  testsKnown?: TestsEvidence | null;
}) {
  const { project, loading } = useProject(projectId);
  const saved = useMemo(() => project?.files ?? [], [project]);
  const versions = useVersions(projectId);
  const live = useLiveFiles(saved, liveText);
  const shown = live ?? saved;
  // Mientras WILLY escribe, la página está a medias: lo que cuente su vigía no va a la consola (serían errores de algo sin terminar).
  const liveRef = useRef(false);
  liveRef.current = Boolean(running && live);
  const rebuild = project ? projectModeOf(project) === "rebuild" : false;
  const [tab, setTab] = usePersistentState<WorkshopTab>("superwilly:taller-pestana", "vista");
  const current: WorkshopTab = tab === "replicacion" && !rebuild ? "vista" : tab;
  const [device, setDevice] = usePersistentState<Device>("superwilly:dispositivo", "ordenador");
  const [codePath, setCodePath] = useState<string | null>(null);
  const [compareTo, setCompareTo] = useState<string>("auto");
  const [review, setReview] = useState<CheckIssue[] | null>(null);
  const [deploy, setDeploy] = useState(false);
  const [shared, setShared] = useState(false);
  const name = project?.name ?? "proyecto";

  useEffect(() => {
    if (!focus) return;
    setTab(focus.tab);
    if (focus.path) setCodePath(focus.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // ----------------------------------------------------------------------------------------------- página y ruta
  const [route, setRoute] = useState<Route>(() => (typeof window === "undefined" ? { page: null, hash: null } : readRoute(projectId)));
  // La ruta «#/…» con la que ARRANCA la página (cambia al ir a otra página o al recargar, no con cada clic dentro).
  const [bootHash, setBootHash] = useState<string | null>(route.hash);
  const hashRef = useRef<string | null>(route.hash);
  const [hash, setHash] = useState<string | null>(route.hash);
  const [pageHistory, setPageHistory] = useState<{ stack: string[]; pos: number }>({ stack: [], pos: -1 });
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  // Lo que llega a la consola se junta y se pinta de golpe cada poco (una página muy habladora no puede atascar WILLY).
  const pendingRef = useRef<ConsoleEntry[]>([]);
  const flushRef = useRef<number | null>(null);
  const addEntries = (list: ConsoleEntry[]) => {
    pendingRef.current.push(...list);
    if (flushRef.current !== null) return;
    flushRef.current = window.setTimeout(() => {
      flushRef.current = null;
      const batch = pendingRef.current;
      pendingRef.current = [];
      if (batch.length) setEntries((prev) => [...prev, ...batch].slice(-MAX_ENTRIES));
    }, 120);
  };
  /** Pinta ya lo pendiente (cuando se decide el estado de la vista previa, la consola tiene que estar al día). */
  const flushNow = () => {
    if (flushRef.current !== null) { window.clearTimeout(flushRef.current); flushRef.current = null; }
    const batch = pendingRef.current;
    pendingRef.current = [];
    if (batch.length) setEntries((prev) => [...prev, ...batch].slice(-MAX_ENTRIES));
  };
  const clearEntries = () => {
    pendingRef.current = [];
    setEntries([]);
  };
  useEffect(() => () => { if (flushRef.current !== null) window.clearTimeout(flushRef.current); }, []);
  const lastUpdated = useRef<{ id: string; at: string } | null>(null);
  useEffect(() => {
    const r = readRoute(projectId);
    setRoute(r);
    setBootHash(r.hash);
    setHash(r.hash);
    hashRef.current = r.hash;
    setPageHistory({ stack: [], pos: -1 });
    clearEntries();
    setVisited([]);
    setPageLinks([]);
    setMapOpen(false);
    setTestsOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const baseInfo = useMemo(() => previewOf(shown, route.page), [shown, route.page]);
  // Rev25: un proyecto React/Vite se compila. Si no tiene otra página que enseñar (o eliges su entrada en el selector de
  // páginas), la vista previa es el proyecto COMPILADO en tu equipo.
  const target = useMemo(() => compileTarget(saved), [saved]);
  // 25/09/2026: por defecto se enseña el proyecto COMPILADO aunque también tenga «vista-previa.html» (esa copia suelta daba
  // errores que la IA no sabía arreglar, como en «Mundo jamon»); la otra página se ve solo si la eliges en el selector.
  const wantCompiled = Boolean(target) && (baseInfo.kind === "sin-vista" || route.page === null || route.page === target?.entry);
  // Rev27: después de instalar librerías se vuelve a compilar (y, si faltan, se instalan solas las que se puede).
  const [libsNonce, setLibsNonce] = useState(0);
  const [autoLibs, setAutoLibs] = usePersistentState<boolean>("superwilly:instalar-librerias", true);
  const [libsOpen, setLibsOpen] = useState(false);
  const compiled = useCompiled(projectId, wantCompiled ? saved : null, running, libsNonce);
  // Si el problema es del equipo (no hay compilador, el servidor no contesta…), no del código: se enseña como antes (con la
  // opción de pedir «vista-previa.html») y no se «repara» el código por eso.
  const envFailure = compiled.status === "error" && (compiled.outcome ? !compiled.outcome.ok && Boolean(compiled.outcome.env) : true);
  const envReason = envFailure ? (compiled.outcome && !compiled.outcome.ok ? compiled.outcome.errors[0]?.text : compiled.error) ?? null : null;
  const info = useMemo((): { kind: "vacio" | "sin-pagina" | "sin-vista" | "pagina" | "compilando" | "no-compila"; html: string | null; page: string | null; pages: string[] } => {
    if (!target) return baseInfo;
    const pages = baseInfo.pages.includes(target.entry) ? baseInfo.pages : [...baseInfo.pages, target.entry];
    if (!wantCompiled) return { ...baseInfo, pages };
    if (compiled.status === "ok" && compiled.outcome?.ok) return { kind: "pagina", html: compiled.outcome.html, page: target.entry, pages };
    if (envFailure) return baseInfo.kind === "pagina" ? { ...baseInfo, pages } : { ...baseInfo, kind: "sin-vista", pages };
    return { kind: compiled.status === "error" ? "no-compila" : "compilando", html: null, page: target.entry, pages };
  }, [baseInfo, target, wantCompiled, compiled, envFailure]);
  const compileFailure = compiled.status === "error" && wantCompiled && !envFailure ? compiled : null;
  const libs = useProjectLibraries(projectId, compileFailure?.outcome && !compileFailure.outcome.ok ? compileFailure.outcome.missing : [], compileFailure?.key ?? null, {
    auto: autoLibs && !running,
    onInstalled: () => setLibsNonce((n) => n + 1),
    onResult: (r) => {
      const at = Date.now();
      addEntries([
        { level: r.items.some((i) => i.status === "no-instalada") ? "warn" : "info", text: `Librerías: ${installSummary(r)}`, at, source: "willy" },
        ...r.warnings.slice(0, 6).map((w) => ({ level: "warn" as const, text: `Librerías: ${w}`, at, source: "willy" as const })),
      ]);
    },
  });
  // Lo que cuenta el vigía de la página se atiende con la página y las páginas de AHORA.
  const pagesRef = useRef(info.pages);
  pagesRef.current = info.pages;
  const pageRef = useRef(info.page);
  pageRef.current = info.page;
  // La ruta guardada es de su página: si se enseña otra (se ha borrado o se ha renombrado), se arranca sin ruta.
  const hashForPage = !route.page || info.page === route.page ? bootHash : null;
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  // Cada carga lleva su marca (recargar, ampliar u otro contenido = otra carga): lo que llegue de una anterior no cuenta.
  const token = useMemo(() => pageToken(info.html ?? "", `${reloadKey}.${expanded ? 1 : 0}`), [info.html, reloadKey, expanded]);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const doc = useMemo(() => (info.html ? withMonitor(info.html, { hash: hashForPage, token }) : null), [info.html, hashForPage, token]);
  const [frameState, setFrameState] = useState<"cargando" | "lista" | "error" | "en-blanco">("cargando");
  const [pageError, setPageError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [outline, setOutline] = useState<string | null>(null);
  const checkedRef = useRef(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const width = DEVICES[device].width;

  // ------------------------------------------------------------------------------------ rev24: edición visual (fase 10)
  // «Seleccionar elemento»: el modo de elegir (la página no reacciona a los clics) y el elemento elegido, con DÓNDE está en el
  // código. «Revisar diseño»: la revisión en marcha o hecha. «Comparar»: ANTES | DESPUÉS.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PickedElement | null>(null);
  const pickedRef = useRef<PickedElement | null>(null);
  pickedRef.current = picked;
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const hits = useMemo(() => (picked ? locateElement(shown, picked.page, picked) : []), [picked, shown]);
  const [reviewRun, setReviewRun] = useState<ReviewRun | null>(null);
  const [comparing, setComparing] = useState(false);
  // Rev26: el mapa de pantallas (abierto o no, cada comprobación con su número) y lo que cuenta el vigía de las pantallas:
  // las rutas por las que has pasado y los enlaces «#/…» que hay en la página.
  const [mapOpen, setMapOpen] = useState(false);
  // Rev28: el panel de las pruebas automáticas y si se pasan solas después de cada cambio.
  const [testsOpen, setTestsOpen] = useState(false);
  const [autoTests, setAutoTests] = usePersistentState<boolean>("superwilly:pasar-pruebas", true);
  const [mapRun, setMapRun] = useState(0);
  const [visited, setVisited] = useState<Array<{ page: string; hash: string }>>([]);
  const [pageLinks, setPageLinks] = useState<Array<{ page: string; hash: string; text: string }>>([]);
  /** Lo que hay que marcar en cuanto la vista previa acabe de cargar (un problema de la revisión en otra página). */
  const pendingMark = useRef<PreviewOrder | null>(null);
  const order = (o: PreviewOrder) => sendOrder(frameRef.current?.contentWindow, tokenRef.current, o);

  const goToPage = (page: string, push = true, hashTo: string | null = null) => {
    const from = pageRef.current;
    const r = { page, hash: hashTo };
    setRoute(r);
    setBootHash(hashTo);
    setHash(hashTo);
    hashRef.current = hashTo;
    saveRoute(projectId, r);
    if (push) {
      setPageHistory((h) => {
        const base = h.pos < 0 ? (from && from !== page ? [from] : []) : h.stack.slice(0, h.pos + 1);
        const stack = [...base, page];
        return { stack, pos: stack.length - 1 };
      });
    }
  };
  const stepHistory = (delta: number) => {
    const pos = pageHistory.pos + delta;
    const page = pageHistory.stack[pos];
    if (!page) return;
    setPageHistory((h) => ({ ...h, pos }));
    goToPage(page, false);
  };
  const reload = () => {
    setBootHash(hashRef.current);
    setReloadKey((k) => k + 1);
  };

  // Cuando WILLY termina de escribir, la vista previa se carga de nuevo con lo guardado (y esta vez se comprueba de verdad).
  const wasLive = useRef(false);
  useEffect(() => {
    const isLive = Boolean(running && live);
    if (wasLive.current && !isLive) setReloadKey((k) => k + 1);
    wasLive.current = isLive;
  }, [running, live]);

  // Cada carga (otra página, lo guardado de nuevo, «Recargar», ampliar): «Cargando…» hasta que el vigía dice que se ve algo. La
  // consola empieza de nuevo con esta carga (como la de un navegador), pero se queda lo que WILLY ha hecho en el proyecto.
  useEffect(() => {
    if (!doc) return;
    setFrameState("cargando");
    setPageError(null);
    setWarnings([]);
    setOutline(null);
    checkedRef.current = false;
    setPicking(false);
    if (pickedRef.current && pickedRef.current.page !== info.page) setPicked(null);
    if (!liveRef.current) {
      pendingRef.current = pendingRef.current.filter((e) => e.source === "willy" && e.level === "info");
      const start: ConsoleEntry = { level: "info", text: `— Vista previa: ${info.page ?? "página"}${width ? ` (${DEVICES[device].label.toLowerCase()}, ${width} px)` : ""} —`, at: Date.now(), source: "willy" };
      setEntries((prev) => [...prev.filter((e) => e.source === "willy" && e.level === "info" && !e.text.startsWith("— Vista previa")).slice(-20), start]);
    }
    const timer = window.setTimeout(() => { if (!checkedRef.current) setFrameState((s) => (s === "cargando" ? "lista" : s)); }, QUALITY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // Lo que cuenta el vigía de la página (solo se atiende al marco de ESTA vista previa).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const m = asMonitorMessage(event.data, tokenRef.current);
      if (!m) return;
      if (m.tipo === "navegar") {
        const target = resolveRef(pageRef.current ?? "", m.ruta).toLowerCase();
        const pages = pagesRef.current;
        const found = pages.find((p) => p.toLowerCase() === target) ?? pages.find((p) => p.toLowerCase() === `${target ? `${target}/` : ""}index.html`);
        if (found) goToPage(found);
        else addEntries([{ level: "warn", text: `El enlace «${m.ruta}» no lleva a ninguna página del proyecto.`, at: Date.now(), source: "willy" }]);
        return;
      }
      if (liveRef.current) return;
      // Rev24: el elemento elegido (al tocarlo, o al volver a marcarlo tras recargar), o que ya no está.
      if (m.tipo === "elemento") {
        const next = pickedOf(m, { page: pageRef.current, route: hashRef.current, device: deviceRef.current });
        if (m.origen === "clic") {
          setPicking(false);
          setPicked(next);
          addEntries([{ level: "info", text: `Elemento elegido en la vista previa: ${pickedLabel(next)}.`, at: Date.now(), source: "willy" }]);
        } else if (pickedRef.current) {
          setPicked(next);
        }
        return;
      }
      if (m.tipo === "perdido") {
        if (pickedRef.current) {
          setPicked(null);
          addEntries([{ level: "info", text: "El elemento elegido ya no está en la página: se ha quitado la selección.", at: Date.now(), source: "willy" }]);
        }
        return;
      }
      if (m.tipo === "elegir") { setPicking(m.activo); return; }
      const entry = consoleEntryOf(m);
      if (entry) addEntries([entry]);
      if (m.tipo === "error" && !checkedRef.current) { flushNow(); setPageError(m.mensaje); setFrameState("error"); }
      if (m.tipo === "error" && checkedRef.current) setPageError((e) => e ?? m.mensaje);
      if (m.tipo === "calidad") {
        const q = qualityOf({ text: m.texto, elements: m.elementos, media: m.medios, overflow: m.desborde, width: m.ancho, height: m.alto });
        const first = !checkedRef.current;
        checkedRef.current = true;
        flushNow();
        setWarnings(q.warnings);
        setOutline(m.resumen || null);
        const links = m.enlaces ?? [];
        const onPage = pageRef.current;
        if (links.length && onPage) setPageLinks((cur) => {
          const next = [...cur];
          for (const l of links) if (!next.some((x) => x.page === onPage && x.hash === l.hash) && next.length < 60) next.push({ page: onPage, hash: l.hash, text: l.texto });
          return next.length === cur.length ? cur : next;
        });
        if (first && q.warnings.length) addEntries(q.warnings.map((w) => ({ level: "warn" as const, text: w, at: Date.now(), source: "willy" as const })));
        setFrameState((s) => (s === "error" ? s : q.blank ? "en-blanco" : "lista"));
        // Rev24: la página ya está pintada: se vuelve a marcar lo elegido (sigue ahí tras el cambio) y lo pendiente de la revisión.
        const sel = pickedRef.current;
        if (first && sel && sel.page === pageRef.current) sendOrder(frameRef.current?.contentWindow, tokenRef.current, { orden: "marcar", selector: sel.selector });
        if (pendingMark.current) { sendOrder(frameRef.current?.contentWindow, tokenRef.current, pendingMark.current); pendingMark.current = null; }
      }
      if (m.tipo === "ruta") {
        hashRef.current = m.hash || null;
        setHash(m.hash || null);
        const onPage = pageRef.current;
        if (onPage && m.hash && m.hash !== "#" && m.hash !== "#/") setVisited((cur) => (cur.some((v) => v.page === onPage && v.hash === m.hash) || cur.length >= 40 ? cur : [...cur, { page: onPage, hash: m.hash }]));
        saveRoute(projectId, { page: pageRef.current, hash: m.hash || null });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Rev25: lo que cuenta la compilación va a la consola del proyecto (una vez por compilación).
  const loggedCompile = useRef<string | null>(null);
  useEffect(() => {
    if (!wantCompiled || (compiled.status !== "ok" && compiled.status !== "error") || !compiled.key || loggedCompile.current === compiled.key) return;
    loggedCompile.current = compiled.key;
    const o = compiled.outcome;
    const at = Date.now();
    if (o?.ok) {
      addEntries([
        { level: "info", text: `Compilado en tu equipo: ${o.entry} en ${(o.ms / 1000).toFixed(1).replace(".", ",")} s (${Math.max(1, Math.round(o.bytes / 1024))} KB)${o.engine === "typescript" ? ", con el TypeScript de WILLY" : o.engine === "esbuild" ? ", con esbuild" : ""}.`, at, source: "willy" },
        ...(o.tailwind === "sin-compilar" ? [{ level: "warn" as const, text: "Tailwind no se ha podido aplicar: la vista previa se ve sin sus clases.", at, source: "willy" as const }] : []),
        ...o.warnings.slice(0, 5).map((w) => ({ level: "warn" as const, text: `Compilación: ${issueText(w)}`, at, source: "willy" as const })),
      ]);
    } else if (o && !o.ok) {
      addEntries([
        ...o.errors.slice(0, 10).map((e) => ({ level: "error" as const, text: `No compila: ${issueText(e)}`, at, source: "willy" as const })),
        ...(o.missing.length ? [{ level: "error" as const, text: missingText(o.missing), at, source: "willy" as const }] : []),
      ]);
    } else if (compiled.error) {
      addEntries([{ level: "error", text: `No se pudo compilar: ${compiled.error}`, at, source: "willy" }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiled, wantCompiled]);

  // Lo que se guarda en el proyecto también va a su consola: así se ve qué cambió justo antes de un fallo.
  useEffect(() => {
    if (!project) return;
    const prev = lastUpdated.current;
    if (prev && prev.id === project.id && prev.at !== project.updatedAt) addEntries([{ level: "info", text: `Proyecto guardado: ${project.files.length} archivo(s). La vista previa se carga de nuevo.`, at: Date.now(), source: "willy" }]);
    lastUpdated.current = { id: project.id, at: project.updatedAt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const summary = consoleSummary(entries.filter((e) => e.source !== "willy" || e.level !== "info"));
  const rawState: PreviewState = running && live && (info.kind === "pagina" || info.kind === "compilando") ? "actualizando" : info.kind !== "pagina" ? info.kind : frameState;
  // Rev27: faltan librerías y WILLY está mirando qué son o instalándolas: todavía no «no compila» (se vuelve a compilar al acabar).
  const previewState: PreviewState = rawState === "no-compila" && libs.busy ? "compilando" : rawState;
  const broken = previewState === "error" || previewState === "en-blanco" || previewState === "no-compila";
  const compileOutcome = compileFailure?.outcome && !compileFailure.outcome.ok ? compileFailure.outcome : null;
  const repair = info.kind === "pagina"
    ? repairRequest({ page: info.page, entries: entries.slice(-80), blank: frameState === "en-blanco", warnings })
    : compileOutcome ? compileRepairRequest(compileOutcome) : null;
  const shownError = compileOutcome ? issueText(compileOutcome.errors[0] ?? { file: "", line: 0, column: 0, text: missingText(compileOutcome.missing) }) : compileFailure?.error ?? pageError;
  // Imágenes y otros recursos que no existen: la página se ve, pero es un fallo (SUPER WILLY los arregla solo una vez por proyecto).
  const resourceErrors = info.kind === "pagina" ? [...new Set(entries.slice(-80).filter((e) => e.source === "recurso" && e.level === "error").map((e) => e.text))].slice(0, 12) : [];
  const resourcesKey = resourceErrors.join("|");

  // Rev26: el mapa de pantallas (del código, de los enlaces de la página y de las rutas por las que ya has pasado).
  const routing = useMemo(() => routingOf(saved), [saved]);
  const codeScreens = useMemo(() => screensFromCode(saved), [saved]);
  // Las rutas del código son de la página de la aplicación: la principal (o el proyecto compilado, si no hay otra).
  const screens = useMemo(() => buildScreenMap({ pages: info.pages, appPage: info.pages[0] ?? null, routing, code: codeScreens, links: pageLinks, visited }), [info.pages, routing, codeScreens, pageLinks, visited]);
  const screensText = useMemo(() => screensForAi(screens, routing), [screens, routing]);
  const currentScreenId = info.page ? `${info.page}${hash && hash !== "#" && hash !== "#/" && hash !== "#!/" ? hash : ""}` : null;
  // Cada pantalla se pinta con su página: la que se ve (también la compilada) o, si es otra página HTML, esa página.
  const htmlOf = useMemo(() => (sc: Screen): string | null => (sc.page === info.page ? info.html : info.pages.includes(sc.page) && sc.page !== target?.entry ? previewOf(saved, sc.page).html : null), [info.page, info.html, info.pages, target, saved]);
  useEffect(() => { if (running) setMapOpen(false); }, [running]);

  // Rev28: las pruebas automáticas. «/» es la página de la aplicación (la compilada, en un proyecto React); las demás páginas
  // del proyecto se abren como en la vista previa.
  const testPages = useMemo(() => {
    const pages = htmlPages(saved);
    return target && !pages.some((p) => p.toLowerCase() === target.page.toLowerCase()) ? [target.page, ...pages] : pages;
  }, [saved, target]);
  const testMain = useMemo(() => target?.page ?? testPages.find((p) => /(?:^|\/)index\.html?$/i.test(p)) ?? testPages[0] ?? null, [target, testPages]);
  const compiledRef = useRef(compiled);
  compiledRef.current = compiled;
  const testSource = useMemo((): PageSource => ({
    pages: testPages,
    main: testMain,
    htmlOf: async (page: string) => {
      if (target && page.toLowerCase() === target.page.toLowerCase()) {
        const c = compiledRef.current;
        if (c.status === "ok" && c.outcome?.ok && c.key?.startsWith(`${compileKey(saved)}#`)) return c.outcome.html;
        const r = await compileProjectPreview(projectId);
        return r.ok && r.data.ok ? r.data.html : null;
      }
      return previewOf(saved, page).html;
    },
  }), [testPages, testMain, target, saved, projectId]);
  const tests = useProjectTests({
    projectId, files: saved, running, ready: previewState === "lista", auto: autoTests, known: testsKnown ?? null, source: testSource,
    onRun: (r, pid) => {
      // A la consola del proyecto (como avisos: una prueba que falla no es un error de la página).
      if (pid === projectId) addEntries(testsConsoleLines(r).map((l) => ({ level: l.level === "error" ? "warn" as const : l.level, text: l.text, at: Date.now(), source: "willy" as const })));
      onTestsRun?.(r, pid);
    },
  });
  const testsBadgeNow = tests.stale ? { text: "", tone: "nada" as const } : tests.run ? testsBadge(tests.run) : testsBadgeOfEvidence(tests.known);
  // Si cambian los archivos (también sin WILLY: una versión restaurada…), el plan lo sabe: las pruebas pasadas se quedan viejas.
  useEffect(() => { if (project && saved.length) void recordFilesKey(projectId, tests.key); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tests.key]);
  const testsLine = tests.run && !tests.stale ? testsForAi(tests.run) : null;

  const selected = picked ? elementContext(picked, hits) : null;
  useEffect(() => {
    onVisualContext?.({ device, width, page: info.page, state: previewState, error: shownError, tab: current, route: hash, outline: info.kind === "pagina" ? outline : null, versions: versions.length, lastVersion: versions[0]?.label ?? null, errors: summary.errors, repair: broken ? repair : null, selected, screens: screensText || null, tests: testsLine, resources: resourceErrors });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, width, info.page, previewState, shownError, current, hash, outline, versions, summary.errors, repair, selected, screensText, testsLine, resourcesKey]);

  // ------------------------------------------------------------------------------------ rev24: acciones de edición visual
  // El modo «elegir» va con la página que se ve; se apaga con Escape, al recargar o cuando WILLY se pone a trabajar.
  useEffect(() => { order({ orden: "elegir", activo: picking }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [picking]);
  useEffect(() => { if (running) setPicking(false); }, [running]);
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPicking(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);
  const clearPick = () => { setPicked(null); setPicking(false); order({ orden: "soltar" }); };
  const askAboutPicked = (wish: string) => {
    const p = pickedRef.current;
    if (!p) return;
    const r = visualEditRequest(p, wish);
    onAsk(r.text, { ownerText: r.ownerText, label: "Cambio visual" });
  };

  const startReview = () => {
    if (info.kind !== "pagina" || !info.html || !info.page) { pushNotice("No hay una página que revisar.", "warn"); return; }
    const id = Date.now();
    const page = info.page;
    const routeNow = hashRef.current;
    setReviewRun({ id, page, hash: routeNow, html: info.html, byDevice: {}, staticIssues: staticChecks(info.html), shots: { status: "cargando" } });
    setTab("vista");
    void captureProjectPage(projectId, page, routeNow).then((r) => {
      setReviewRun((cur) => (cur && cur.id === id ? { ...cur, shots: r.ok ? { status: "ok", data: r.data } : { status: "error", error: r.error } } : cur));
    });
  };
  const reviewResult = (id: number, device: ReviewDevice, problems: RawIssue[] | null) => {
    setReviewRun((cur) => (cur && cur.id === id && !(device in cur.byDevice) ? { ...cur, byDevice: { ...cur.byDevice, [device]: problems } } : cur));
  };
  // Cuando están los tres tamaños, el resultado va también a la consola del proyecto.
  const loggedReview = useRef<number | null>(null);
  useEffect(() => {
    if (!reviewRun || loggedReview.current === reviewRun.id || REVIEW_DEVICES.some((d) => !(d in reviewRun.byDevice))) return;
    loggedReview.current = reviewRun.id;
    const checkedSizes = REVIEW_DEVICES.filter((d) => Array.isArray(reviewRun.byDevice[d]));
    const issues = mergeReview(reviewRun.byDevice, reviewRun.staticIssues);
    addEntries([{ level: issues.some((i) => i.level === "error") ? "warn" : "info", text: reviewConsoleLine(issues, checkedSizes), at: Date.now(), source: "willy" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewRun]);
  const seeIssue = (issue: ReviewIssue) => {
    if (!issue.selector || !reviewRun) return;
    const o: PreviewOrder = { orden: "marcar", selector: issue.selector, como: "problema", etiqueta: LEVEL_LABEL[issue.level] };
    setComparing(false);
    setTab("vista");
    if (!issue.devices.includes(device)) setDevice(issue.devices[0]!);
    if (reviewRun.page !== pageRef.current) { pendingMark.current = o; goToPage(reviewRun.page); return; }
    window.setTimeout(() => order(o), 350);
  };
  const fixDesign = (issues: ReviewIssue[], visionNotes: string[]) => {
    if (!reviewRun) return;
    const r = designFixRequest({ page: reviewRun.page, route: reviewRun.hash, issues, visionNotes });
    onAsk(r.text, { ownerText: r.ownerText, label: "Arreglo de diseño" });
  };
  const reviewPending = reviewRun ? REVIEW_DEVICES.some((d) => !(d in reviewRun.byDevice)) : false;

  // ------------------------------------------------------------------------------------ rev26: mapa de pantallas
  const openScreen = (sc: Screen) => {
    setComparing(false);
    setTab("vista");
    if (sc.page !== pageRef.current) { goToPage(sc.page, true, sc.hash); return; }
    order({ orden: "ir", hash: sc.hash });
  };
  const repairScreen = (sc: Screen, h: ScreenHealth) => {
    const r = screenRepairRequest(sc, h);
    onAsk(r.text, { ownerText: r.ownerText, label: "Reparar una pantalla" });
  };
  const fixRouting = () => {
    const r = hashRoutingRequest(routing);
    onAsk(r.text, { ownerText: r.ownerText, label: "Rutas con #" });
  };
  const mapChecked = (text: string, bad: Array<{ screen: Screen; health: ScreenHealth }>) => {
    const at = Date.now();
    addEntries([
      { level: bad.length ? "warn" : "info", text: `Mapa de pantallas: ${text}.`, at, source: "willy" },
      ...bad.slice(0, 5).map(({ screen, health }) => ({ level: "warn" as const, text: `Pantalla «${screen.label}» (${screen.hash ?? screen.page}): ${health.status === "en-blanco" ? "se queda en blanco" : `da un error: ${health.error ?? "error"}`}.`, at, source: "willy" as const })),
    ]);
  };

  // ----------------------------------------------------------------------------------------------- acciones
  const exportZip = () => {
    void fileService.exportZip(name, saved).then((r) => pushNotice(r.ok ? `«${name}» descargado en un ZIP (${r.data} archivos).` : `⚠️ ${r.error}`, r.ok ? "success" : "warn"));
  };
  const share = () => {
    const link = `${window.location.origin}/app?proyecto=${encodeURIComponent(projectId)}`;
    void copyText(link).then((ok) => {
      pushNotice(ok ? "Enlace copiado: abre este proyecto en WILLY (en este equipo o desde el móvil de tu misma red)." : `Copia este enlace: ${link}`, "info");
      if (ok) { setShared(true); window.setTimeout(() => setShared(false), 2500); }
    });
  };
  const check = () => {
    if (!saved.length) { pushNotice("Todavía no hay archivos que revisar.", "warn"); return; }
    const issues = fileService.check(saved);
    setReview(issues);
    const errs = issues.filter((i) => i.level === "error").length;
    addEntries([{ level: errs ? "error" : issues.length ? "warn" : "info", text: issues.length ? `Revisión del código: ${errs} error(es) y ${issues.length - errs} aviso(s).` : `Revisión del código: ${saved.length} archivo(s) sin problemas.`, at: Date.now(), source: "willy" }]);
  };
  const archive = () => {
    if (!window.confirm(`¿Archivar «${name}»? No se borra nada: queda en Proyectos como archivado y puedes volver a activarlo.`)) return;
    void projectService.setState(projectId, "Archivado").then((r) => pushNotice(r.ok ? `«${name}» archivado.` : `⚠️ ${r.error}`, r.ok ? "success" : "warn"));
  };

  const tabs: Array<[WorkshopTab, string, typeof Monitor]> = [
    ["vista", "Vista previa", Monitor],
    ["codigo", "Código", Code2],
    ["archivos", `Archivos${saved.length ? ` (${saved.length})` : ""}`, FolderKanban],
    ["cambios", "Cambios", ArrowLeftRight],
    ["consola", `Consola${summary.errors ? ` (${summary.errors})` : ""}`, Terminal],
    ["versiones", `Versiones${versions.length ? ` (${versions.length})` : ""}`, Clock],
    ...(rebuild ? [["replicacion", "Replicación", Copy] as [WorkshopTab, string, typeof Monitor]] : []),
  ];

  const frame = doc ? (
    <iframe
      ref={frameRef}
      key={reloadKey}
      title={`Vista previa de ${name}`}
      srcDoc={doc}
      sandbox="allow-scripts allow-forms allow-modals"
      className="block border-0 bg-white"
      style={{ width: "100%", height: "100%" }}
    />
  ) : null;

  if (!loading && !project) {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel" aria-label="Taller del proyecto">
        <Empty text="Este proyecto ya no está en tu equipo (se ha borrado o está en la papelera). Ábrelo desde Proyectos → Papelera para recuperarlo." />
      </section>
    );
  }

  const canBack = pageHistory.pos > 0;
  const canForward = pageHistory.pos >= 0 && pageHistory.pos < pageHistory.stack.length - 1;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel" aria-label="Taller del proyecto">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-card px-2">
        <div role="tablist" aria-label="Taller del proyecto" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={current === id} onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${current === id ? "bg-accent text-foreground" : id === "consola" && summary.errors ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="size-3.5" />{label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={exportZip} disabled={!saved.length} title="Descargar el proyecto en un ZIP" aria-label="Exportar"><Download className="size-3.5" /><span className="hidden 2xl:inline">Exportar</span></Button>
        <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={() => setDeploy(true)} title="Publicar: te prepara el ZIP para tu hosting" aria-label="Publicar"><Rocket className="size-3.5" /><span className="hidden 2xl:inline">Publicar</span></Button>
        <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={share} title="Copiar el enlace de este proyecto" aria-label="Compartir"><Share2 className="size-3.5" />{shared ? <span className="text-emerald-600 dark:text-emerald-400">Enlace copiado</span> : <span className="hidden 2xl:inline">Compartir</span>}</Button>
        <Menu label="Más opciones del proyecto" align="end" trigger={({ toggle }) => (
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={toggle} aria-label="Más opciones del proyecto"><MoreHorizontal className="size-4" /></Button>
        )}>
          {(close) => (
            <>
              <MenuLabel>{name}</MenuLabel>
              <MenuItem onClick={() => { close(); check(); }}><ShieldCheck className="size-4" />Revisar el código</MenuItem>
              <MenuItem onClick={() => { close(); openView("proyectos"); }}><FolderKanban className="size-4" />Ver en Proyectos</MenuItem>
              <div className="my-1 h-px bg-border" />
              <MenuItem danger onClick={() => { close(); archive(); }}><Trash2 className="size-4" />Archivar proyecto</MenuItem>
            </>
          )}
        </Menu>
      </div>

      {review && (
        <div className="shrink-0 border-b border-border bg-card px-3 py-2 text-xs" role="status" aria-label="Revisión del código">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className={`size-4 shrink-0 ${review.some((i) => i.level === "error") ? "text-destructive" : review.length ? "text-amber-500" : "text-emerald-500"}`} />
            <span className="min-w-0 flex-1 font-semibold">
              {review.length ? `Revisión: ${review.filter((i) => i.level === "error").length} error(es) y ${review.filter((i) => i.level === "aviso").length} aviso(s) en ${saved.length} archivo(s).` : `Revisión: ${saved.length} archivo(s) sin problemas.`}
            </span>
            {review.length > 0 && (
              <Button size="sm" variant="secondary" className="h-7 gap-1.5 px-2 text-xs" disabled={running} onClick={() => { onAsk(`Revisa y arregla estos problemas del proyecto:\n${review.slice(0, 20).map((i) => `- ${i.path}: ${i.message}`).join("\n")}`); setReview(null); }}>
                <Wand2 className="size-3.5" />Pedir a WILLY que lo arregle
              </Button>
            )}
            <button type="button" onClick={() => setReview(null)} aria-label="Cerrar la revisión" className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
          </div>
          {review.length > 0 && (
            <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-auto pl-6">
              {review.slice(0, 30).map((i, n) => <li key={n} className={i.level === "error" ? "text-destructive" : "text-muted-foreground"}><span className="font-mono">{i.path}</span>: {i.message}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {/* La vista previa sigue viva (oculta) mientras miras otra pestaña: al volver está como la dejaste, sin recargarse. */}
        <div className={current === "vista" ? "flex min-h-0 flex-1 flex-col" : "hidden"} data-panel-vista>
            <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card/60 px-2 text-xs">
              <span className={`flex min-w-0 shrink items-center gap-1.5 truncate rounded-full border px-2 py-0.5 font-semibold ${broken ? "border-destructive/50 text-destructive" : previewState === "lista" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-border text-muted-foreground"}`} data-estado-vista={previewState}>
                {(previewState === "cargando" || previewState === "actualizando") && <Loader2 className="size-3 shrink-0 animate-spin" />}
                <span className="truncate">{STATE_LABEL[previewState]}</span>
              </span>
              {previewState === "lista" && summary.errors > 0 && (
                <button type="button" onClick={() => setTab("consola")} className="shrink-0 rounded-full border border-destructive/40 px-2 py-0.5 font-semibold text-destructive" title="Ver la consola del proyecto" data-errores-vista={summary.errors}>{summary.text}</button>
              )}
              {warnings.length > 0 && !broken && previewState !== "actualizando" && (
                <span className="shrink-0 rounded-full border border-amber-500/40 px-2 py-0.5 font-semibold text-amber-600 dark:text-amber-400" title={warnings.join(" ")} data-aviso-vista>Se sale de la pantalla</span>
              )}
              {info.pages.length > 1 ? (
                <>
                  <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => stepHistory(-1)} disabled={!canBack} aria-label="Página anterior" title="Página anterior"><ArrowLeft className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => stepHistory(1)} disabled={!canForward} aria-label="Página siguiente" title="Página siguiente"><ArrowRight className="size-4" /></Button>
                  <select value={info.page ?? ""} onChange={(e: { target: { value: string } }) => goToPage(e.target.value)} aria-label="Página del proyecto" title="Página del proyecto que se ve" className="h-7 min-w-0 max-w-48 shrink rounded-md border border-border bg-background px-1.5 font-mono text-[11px]">
                    {info.pages.map((p) => <option key={p} value={p}>{p === target?.entry ? `${p} (compilado en tu equipo)` : p}</option>)}
                  </select>
                </>
              ) : (
                info.page && <span className="hidden truncate font-mono text-[11px] text-muted-foreground md:inline">{info.page}</span>
              )}
              {hash && <span className="hidden max-w-32 shrink truncate font-mono text-[11px] text-muted-foreground lg:inline" title="Ruta dentro de la página (se recuerda al recargar)" data-ruta-vista>{hash}</span>}
              <div className="flex-1" />
              <Button variant={picking ? "primary" : "ghost"} size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={() => setPicking((p) => !p)} disabled={!doc || running || comparing} aria-pressed={picking} aria-label="Seleccionar elemento" title="Seleccionar elemento: toca algo de la vista previa y di qué quieres cambiar">
                <MousePointerClick className="size-4" /><span className="hidden 2xl:inline">{picking ? "Toca un elemento…" : "Seleccionar"}</span>
              </Button>
              <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={startReview} disabled={!doc || running || reviewPending} aria-label="Revisar diseño" title="Revisar el diseño en ordenador, tableta y móvil (con capturas de verdad)">
                {reviewPending ? <Loader2 className="size-4 animate-spin" /> : <ScanEye className="size-4" />}<span className="hidden 2xl:inline">Revisar diseño</span>
              </Button>
              <Button variant={mapOpen ? "primary" : "ghost"} size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={() => { setPicking(false); setMapOpen((o) => !o); setMapRun((n) => n + 1); }} disabled={!doc || running} aria-pressed={mapOpen} aria-label="Mapa de pantallas" title="Mapa de pantallas: todas las pantallas del proyecto de un vistazo (y las que fallan)">
                <LayoutGrid className="size-4" /><span className="hidden 2xl:inline">Pantallas{screens.length > 1 ? ` (${screens.length})` : ""}</span>
              </Button>
              <Button variant={testsOpen ? "primary" : "ghost"} size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={() => { setPicking(false); setTestsOpen((o) => !o); }} disabled={!saved.length} aria-pressed={testsOpen} aria-label="Pruebas" title="Pruebas automáticas: WILLY prueba tu aplicación como lo haría una persona, él solo (también después de cada cambio)" data-pruebas-estado={tests.busy ? "probando" : testsBadgeNow.tone}>
                {tests.busy ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}<span className="hidden 2xl:inline">Pruebas</span>
                {testsBadgeNow.text && <span className={`rounded-full px-1.5 text-[10px] font-semibold ${testsBadgeNow.tone === "fallo" ? "bg-destructive text-white" : "bg-emerald-600 text-white"}`} data-pruebas-insignia>{testsBadgeNow.text}</span>}
              </Button>
              <Button variant={comparing ? "primary" : "ghost"} size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={() => { setPicking(false); setMapOpen(false); setComparing((c) => !c); }} disabled={!doc || versions.length < 2} aria-pressed={comparing} aria-label="Comparar versiones" title={versions.length < 2 ? "Comparar ANTES y DESPUÉS: hace falta al menos un cambio guardado" : "Comparar ANTES y DESPUÉS (o dos versiones cualesquiera)"}>
                <Columns2 className="size-4" /><span className="hidden 2xl:inline">Comparar</span>
              </Button>
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={reload} disabled={!doc} aria-label="Recargar la vista previa" title="Recargar (vuelve a la misma ruta)"><RotateCw className="size-4" /></Button>
              <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5" role="group" aria-label="Tamaño de la pantalla">
                {(Object.keys(DEVICES) as Device[]).map((d) => {
                  const Icon = DEVICES[d].icon;
                  return (
                    <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d} aria-label={`Ver como ${DEVICES[d].label}${DEVICES[d].width ? ` (${DEVICES[d].width} px)` : ""}`} title={`${DEVICES[d].label}${DEVICES[d].width ? ` · ${DEVICES[d].width} px de ancho` : ""}`}
                      className={`flex size-7 items-center justify-center rounded ${device === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                      <Icon className="size-3.5" />
                    </button>
                  );
                })}
              </div>
              <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" onClick={() => setExpanded(true)} disabled={!doc} aria-label="Ampliar la vista previa"><Maximize2 className="size-4" /><span className="hidden lg:inline">Ampliar</span></Button>
            </div>
            {broken && !running && previewState !== "no-compila" && (
              <BrokenPanel
                state={previewState}
                page={info.page}
                entries={entries}
                pageError={pageError}
                repair={repair}
                autoRepair={autoRepair}
                onAutoRepair={onAutoRepair}
                onRepair={() => { if (repair) onAsk(repair); }}
                onConsole={() => setTab("consola")}
              />
            )}
            {picking && !expanded && <PickHint onCancel={() => setPicking(false)} />}
            {picked && !expanded && <ElementPanel picked={picked} hits={hits} running={running} onAsk={askAboutPicked} onRepick={() => setPicking(true)} onClose={clearPick} />}
            {reviewRun && (
              <DesignReviewPanel
                run={reviewRun}
                stale={info.html !== reviewRun.html}
                running={running}
                vision={vision}
                onSee={seeIssue}
                onFix={fixDesign}
                onRerun={startReview}
                onClose={() => setReviewRun(null)}
              />
            )}
            {mapOpen && !expanded && (
              <ScreenMapPanel
                key={`${mapRun}.${project?.updatedAt ?? ""}.${device}`}
                screens={screens}
                routing={routing}
                htmlOf={htmlOf}
                currentId={currentScreenId}
                device={device}
                running={running}
                onOpen={openScreen}
                onRepair={repairScreen}
                onFixRouting={fixRouting}
                onChecked={mapChecked}
                onRecheck={() => setMapRun((n) => n + 1)}
                onClose={() => setMapOpen(false)}
              />
            )}
            {testsOpen && !expanded && (
              <TestsPanel
                tests={tests}
                running={running}
                auto={autoTests}
                onAuto={setAutoTests}
                onRepair={(failing) => { const r = testsRepairRequest(failing); onAsk(r.text, { ownerText: r.ownerText, label: "Arreglar pruebas" }); }}
                onWrite={(existing) => { const r = testsWriteRequest({ existing, functions: [], screens: screensText || null }); onAsk(r.text, { ownerText: r.ownerText, label: "Escribir pruebas" }); }}
                onClose={() => setTestsOpen(false)}
              />
            )}
            {info.kind === "pagina" && doc ? (
              expanded ? (
                <div className="flex min-h-0 flex-1 items-center justify-center bg-accent/30 p-4 text-sm text-muted-foreground">La vista previa está ampliada.</div>
              ) : (
                <>
                  {/* Al comparar, la vista previa de siempre sigue viva (oculta): al cerrar la comparación está como la dejaste. */}
                  <div className={comparing ? "hidden" : "flex min-h-0 flex-1 flex-col"}><PreviewStage width={width}>{frame}</PreviewStage></div>
                  {comparing && <CompareStage projectId={projectId} files={saved} versions={versions} page={info.page} hash={hashRef.current} width={width ?? 1280} onClose={() => setComparing(false)} />}
                </>
              )
            ) : info.kind === "compilando" || info.kind === "no-compila" ? (
              <CompileState
                kind={info.kind}
                entry={target?.entry ?? ""}
                libs={libs}
                autoLibs={autoLibs}
                onAutoLibs={setAutoLibs}
                onShowLibraries={() => setLibsOpen(true)}
                outcome={compileOutcome}
                error={compileFailure?.error ?? null}
                running={running}
                autoRepair={autoRepair}
                onAutoRepair={onAutoRepair}
                onRepair={() => { if (repair) onAsk(repair, { label: "Reparación de la compilación", ownerText: "Arregla lo que impide compilar el proyecto." }); }}
                onConsole={() => setTab("consola")}
              />
            ) : (
              <EmptyPreview
                note={envReason}
                kind={info.kind === "pagina" ? "vacio" : info.kind}
                loading={loading && !project}
                running={running}
                // Sin pantallas (una API, una automatización) no se inventa una: se enseña su documentación (rediseño, punto 81).
                canAsk={!/^(?:api|automatizacion|backend)$/i.test(project?.kind ?? "")}
                doc={shown.find((f: GeneratedFile) => /(?:^|\/)readme\.md$/i.test(f.path)) ?? shown.find((f: GeneratedFile) => /\.md$/i.test(f.path)) ?? null}
                onAsk={() => onAsk(PREVIEW_REQUEST)}
              />
            )}
        </div>

        {current === "codigo" && <CodeTab files={shown} path={codePath} onPath={setCodePath} running={running && Boolean(live)} />}
        {current === "archivos" && <FilesTab files={saved} name={name} onOpen={(path) => { setCodePath(path); setTab("codigo"); }} onZip={exportZip} />}
        {current === "cambios" && <ChangesTab files={saved} versions={versions} compareTo={compareTo} onCompareTo={setCompareTo} onOpenFile={(path) => { setCodePath(path); setTab("codigo"); }} />}
        {current === "consola" && (
          <ConsoleTab
            entries={entries}
            running={running}
            repair={repair}
            autoRepair={autoRepair}
            onAutoRepair={onAutoRepair}
            onClear={clearEntries}
            onRepair={() => { if (repair) { onAsk(repair); setTab("vista"); } }}
          />
        )}
        {current === "versiones" && <VersionsTab versions={versions} onCompare={(id) => { setCompareTo(id); setTab("cambios"); }} />}
        {current === "replicacion" && project && (
          <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
            <RebuildPanel projectId={projectId} projectName={name} files={saved} onDownloadCode={(files) => { void fileService.exportZip(name, files).then((r) => pushNotice(r.ok ? `Código fuente descargado (${r.data} archivos).` : `⚠️ ${r.error}`)); }} />
          </div>
        )}
      </div>

      {expanded && doc && (
        <div className="safe-modal fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-label="Vista previa ampliada">
          <ExpandedBar name={name} device={device} onDevice={setDevice} onReload={reload} onClose={() => setExpanded(false)} state={previewState} picking={picking} canPick={!running} onPick={() => setPicking((p) => !p)} />
          {picking && <PickHint onCancel={() => setPicking(false)} />}
          {picked && <ElementPanel picked={picked} hits={hits} running={running} onAsk={askAboutPicked} onRepick={() => setPicking(true)} onClose={clearPick} />}
          <PreviewStage width={width}>{frame}</PreviewStage>
        </div>
      )}
      {/* Rev24: los marcos ocultos de «Revisar diseño» (la página a 1280, 768 y 390 px), solo mientras se revisa. */}
      {reviewRun && reviewPending && (
        <ReviewFrames key={reviewRun.id} runId={reviewRun.id} html={reviewRun.html} hash={reviewRun.hash} onResult={(d, problems) => reviewResult(reviewRun.id, d, problems)} />
      )}
      {deploy && <DeployModal project={name} files={saved} onClose={() => setDeploy(false)} />}
      {libsOpen && <InstalledLibrariesDialog onClose={() => setLibsOpen(false)} onChanged={() => setLibsNonce((n) => n + 1)} />}
    </section>
  );
}

/**
 * Rev25 · Un proyecto React/Vite mientras se compila en tu equipo y, si no compila, por qué (con su archivo y línea, y las
 * librerías que faltan) y «Reparar» (rediseño, punto 98: «WILLY está comprobando: Build, Dependencias…»).
 */
function CompileState({ kind, entry, libs, autoLibs, onAutoLibs, onShowLibraries, outcome, error, running, autoRepair, onAutoRepair, onRepair, onConsole }: {
  kind: "compilando" | "no-compila"; entry: string; outcome: Extract<CompileOutcome, { ok: false }> | null; error: string | null; running: boolean;
  /** Rev27: las librerías que faltan (qué son, si se están instalando solas…). */
  libs: ProjectLibraries; autoLibs: boolean; onAutoLibs: (on: boolean) => void; onShowLibraries: () => void;
  autoRepair?: boolean | undefined; onAutoRepair?: ((on: boolean) => void) | undefined; onRepair: () => void; onConsole: () => void;
}) {
  if (kind === "compilando") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-accent/30 p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 text-center" data-compilando>
          <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
          <p className="text-sm font-semibold">Compilando el proyecto en tu equipo…</p>
          <p className="mt-1 text-sm text-muted-foreground">Es un proyecto React/Vite ({entry}): WILLY lo compila con sus propias piezas (sin npm ni internet) para enseñarte su código de verdad.</p>
        </div>
      </div>
    );
  }
  const errors = outcome?.errors ?? [];
  const missing = outcome?.missing ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-accent/30 p-3 sm:p-4">
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-destructive/40 bg-card p-4 text-sm" role="alert" aria-label="El proyecto no compila" data-no-compila>
        <p className="flex items-center gap-2 font-bold uppercase text-destructive"><AlertTriangle className="size-4 shrink-0" />No se puede mostrar la vista previa: el proyecto no compila</p>
        <p className="mt-1 text-muted-foreground">WILLY ha compilado <span className="font-mono">{entry}</span> en tu equipo y ha encontrado esto:</p>
        {missing.length > 0 && <MissingLibrariesPanel lib={libs} running={running} auto={autoLibs} onAuto={onAutoLibs} onShowInstalled={onShowLibraries} />}
        {errors.length > 0 && (
          <ul className="mt-2 space-y-1 font-mono text-xs" aria-label="Errores de compilación">
            {errors.slice(0, 8).map((e, i) => <li key={i} className="break-words text-destructive">{issueText(e)}</li>)}
          </ul>
        )}
        {!errors.length && error && <p className="mt-2 text-destructive">{error}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-8 gap-1.5 px-3 text-xs" disabled={running || !outcome || libs.busy} onClick={onRepair}><Wand2 className="size-3.5" />Reparar</Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onConsole}>Ver la consola</Button>
          {onAutoRepair && (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={Boolean(autoRepair)} onChange={(e: { target: { checked: boolean } }) => onAutoRepair(e.target.checked)} />
              Reparar solo si un cambio lo rompe (2 intentos)
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * «No se puede mostrar la vista previa» (rediseño, punto 98): nunca una pantalla en blanco sin explicación. Dice qué ha
 * comprobado WILLY (la página, su código, sus recursos, si se ve algo) y ofrece «Reparar».
 */
function BrokenPanel({ state, page, entries, pageError, repair, autoRepair, onAutoRepair, onRepair, onConsole }: {
  state: PreviewState; page: string | null; entries: ConsoleEntry[]; pageError: string | null; repair: string | null;
  autoRepair?: boolean | undefined; onAutoRepair?: ((on: boolean) => void) | undefined; onRepair: () => void; onConsole: () => void;
}) {
  const recent = entries.slice(-80);
  const scriptErrors = recent.filter((e) => e.level === "error" && e.source === "pagina");
  const resources = recent.filter((e) => e.source === "recurso");
  const lastError = scriptErrors.length ? scriptErrors[scriptErrors.length - 1]!.text : null;
  const rows: Array<[string, boolean, string]> = [
    ["Página", Boolean(page), page ? `«${page}» encontrada` : "no hay página"],
    ["Código de la página", !scriptErrors.length && !pageError, lastError ? `${scriptErrors.length} error(es): ${lastError}` : pageError ?? "sin errores"],
    ["Recursos (imágenes, estilos…)", !resources.length, resources.length ? `${resources.length} no cargan: ${resources.slice(-2).map((r) => r.text.replace(/^No se ha podido cargar: /, "")).join(", ")}` : "todos cargan"],
    ["Se ve algo", state !== "en-blanco", state === "en-blanco" ? "no: la página se queda en blanco" : "sí"],
  ];
  const title = state === "en-blanco" ? "No se puede mostrar la vista previa" : "La vista previa tiene errores";
  return (
    <div className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs" role="alert" aria-label={title}>
      <p className="flex items-center gap-2 font-bold uppercase text-destructive"><AlertTriangle className="size-4 shrink-0" />{title}</p>
      <p className="mt-1 text-muted-foreground">WILLY ha comprobado:</p>
      <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
        {rows.map(([label, ok, detail]) => (
          <li key={label} className="min-w-0 truncate" title={detail}><span className={ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>{ok ? "✓" : "✗"}</span> <span className="font-semibold">{label}:</span> {detail}</li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={!repair} onClick={onRepair}><Wand2 className="size-3.5" />Reparar</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onConsole}>Ver la consola</Button>
        {onAutoRepair && (
          <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" checked={Boolean(autoRepair)} onChange={(e: { target: { checked: boolean } }) => onAutoRepair(e.target.checked)} />
            Reparar solo si un cambio lo rompe (2 intentos)
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * CONSOLA DEL PROYECTO (rediseño, puntos 30 y 97): lo que pasa dentro de la página del proyecto (su consola, sus errores, lo que
 * no carga) y lo que WILLY hace en él. Es aparte de los registros de WILLY (Ajustes → Diagnóstico). Por defecto, el resumen y
 * lo importante; «Todo» enseña el registro completo.
 */
function ConsoleTab({ entries, running, repair, autoRepair, onAutoRepair, onClear, onRepair }: {
  entries: ConsoleEntry[]; running: boolean; repair: string | null; autoRepair?: boolean | undefined; onAutoRepair?: ((on: boolean) => void) | undefined;
  onClear: () => void; onRepair: () => void;
}) {
  const [all, setAll] = usePersistentState<boolean>("superwilly:consola-todo", false);
  const summary = consoleSummary(entries.filter((e) => e.source !== "willy" || e.level !== "info"));
  const shownEntries = all ? entries : entries.filter((e) => e.level === "error" || e.level === "warn");
  const copyAll = () => void copyText(entries.map((e) => `[${fmtTime(e.at)}] ${e.level.toUpperCase()} ${e.text}`).join("\n")).then((ok) => pushNotice(ok ? "Consola copiada." : "No se pudo copiar.", ok ? "success" : "warn"));
  const color = (e: ConsoleEntry) => (e.level === "error" ? "text-destructive" : e.level === "warn" ? "text-amber-600 dark:text-amber-400" : e.source === "willy" ? "text-primary" : "text-foreground/85");
  return (
    <div className="flex min-h-0 flex-1 flex-col" role="region" aria-label="Consola del proyecto">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card/60 px-3 py-2 text-xs">
        <span className={`rounded-full border px-2 py-0.5 font-semibold ${summary.errors ? "border-destructive/40 text-destructive" : summary.warnings ? "border-amber-500/40 text-amber-600 dark:text-amber-400" : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"}`} data-resumen-consola>{summary.text}</span>
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5" role="group" aria-label="Qué enseñar">
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)} className={`rounded px-2 py-0.5 ${!all ? "bg-accent font-semibold text-foreground" : "text-muted-foreground"}`}>Lo importante</button>
          <button type="button" aria-pressed={all} onClick={() => setAll(true)} className={`rounded px-2 py-0.5 ${all ? "bg-accent font-semibold text-foreground" : "text-muted-foreground"}`}>Todo (avanzado)</button>
        </div>
        <div className="flex-1" />
        {repair && <Button size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={running} onClick={onRepair}><Wand2 className="size-3.5" />Pedir a WILLY que lo arregle</Button>}
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={copyAll} disabled={!entries.length}>Copiar</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClear} disabled={!entries.length}>Limpiar</Button>
      </div>
      {onAutoRepair && (
        <label className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={Boolean(autoRepair)} onChange={(e: { target: { checked: boolean } }) => onAutoRepair(e.target.checked)} />
          Si un cambio de WILLY rompe la vista previa, que lo repare solo (como mucho 2 intentos; si no puede, lo dice)
        </label>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-[oklch(0.17_0.02_265)] p-2 font-mono text-[11px] leading-5">
        {shownEntries.length === 0 ? (
          <p className="p-2 text-foreground/60">{entries.length ? "Nada importante: sin errores ni avisos. Pulsa «Todo (avanzado)» para ver el registro completo." : "Todavía no hay nada: aquí aparece lo que pasa dentro de la página del proyecto (errores, avisos, lo que no carga) y lo que WILLY hace en él. Los registros de WILLY están en Ajustes → Diagnóstico."}</p>
        ) : (
          <ul aria-label="Registro de la consola">
            {shownEntries.map((e, i) => (
              <li key={`${e.at}-${i}`} className={`flex gap-2 whitespace-pre-wrap break-words px-1 ${color(e)}`}>
                <span className="shrink-0 text-foreground/40">{fmtTime(e.at)}</span>
                <span className="w-12 shrink-0 font-semibold uppercase">{e.level === "error" ? "error" : e.level === "warn" ? "aviso" : e.source === "willy" ? "willy" : "info"}</span>
                <span className="min-w-0">{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Rev24: mientras se elige, qué hacer (y cómo cancelar). */
function PickHint({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-primary/30 bg-primary/10 px-3 py-1.5 text-xs" role="status" data-eligiendo>
      <MousePointerClick className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">Toca en la vista previa lo que quieras cambiar: un botón, una imagen, un texto, el menú… (Escape para cancelar)</span>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCancel}>Cancelar</Button>
    </div>
  );
}

function ExpandedBar({ name, device, onDevice, onReload, onClose, state, picking, canPick, onPick }: {
  name: string; device: Device; onDevice: (d: Device) => void; onReload: () => void; onClose: () => void; state: PreviewState;
  picking: boolean; canPick: boolean; onPick: () => void;
}) {
  // Escape cancela primero la selección (si se está eligiendo) y, si no, cierra la vista ampliada.
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  useEscapeToClose(() => { if (!pickingRef.current) onClose(); });
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      <Button size="sm" className="h-9 gap-1.5" onClick={onClose}><X className="size-4" />Volver a SUPER WILLY</Button>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name} <span className="font-normal text-muted-foreground">· {STATE_LABEL[state]}</span></span>
      <Button variant={picking ? "primary" : "ghost"} size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={onPick} disabled={!canPick} aria-pressed={picking} aria-label="Seleccionar elemento" title="Seleccionar elemento: toca algo y di qué quieres cambiar">
        <MousePointerClick className="size-4" /><span className="hidden sm:inline">{picking ? "Toca un elemento…" : "Seleccionar"}</span>
      </Button>
      <Button variant="ghost" size="icon" className="size-8" onClick={onReload} aria-label="Recargar la vista previa"><RotateCw className="size-4" /></Button>
      <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5" role="group" aria-label="Tamaño de la pantalla">
        {(Object.keys(DEVICES) as Device[]).map((d) => {
          const Icon = DEVICES[d].icon;
          return (
            <button key={d} type="button" onClick={() => onDevice(d)} aria-pressed={device === d} aria-label={`Ver como ${DEVICES[d].label}`} className={`flex size-7 items-center justify-center rounded ${device === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="size-3.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmptyPreview({ kind, loading, running, canAsk, doc, onAsk, note }: { kind: "vacio" | "sin-pagina" | "sin-vista"; loading: boolean; running: boolean; canAsk: boolean; doc: GeneratedFile | null; onAsk: () => void; note?: string | null }) {
  // Un proyecto sin página (una API, un programa, documentos): se enseña su documento principal, tal cual.
  if (!loading && kind === "sin-pagina" && doc) {
    return (
      <div className="min-h-0 flex-1 overflow-auto bg-accent/30 p-3 sm:p-4">
        <div className="mx-auto w-full max-w-3xl rounded-2xl border border-border bg-card p-4" data-vista-vacia="documento">
          <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <FileCode2 className="size-3.5 text-primary" /><span className="font-mono text-foreground">{doc.path}</span>
            <span>· Este proyecto no tiene una página que ver: esto es su documento principal.</span>
          </p>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{doc.content}</pre>
          {canAsk && (
            <Button size="sm" variant="secondary" className="mt-3 gap-1.5" disabled={running} onClick={onAsk}><Wand2 className="size-4" />Pedir a WILLY una vista previa</Button>
          )}
        </div>
      </div>
    );
  }
  const text = loading
    ? "Leyendo el proyecto…"
    : kind === "vacio"
      ? running ? "WILLY está trabajando: en cuanto escriba la primera página, aparecerá aquí." : "Todavía no hay nada que ver: cuéntale a SUPER WILLY en el chat lo que quieres construir."
      : kind === "sin-vista"
        ? note
          ? `Es un proyecto React/Vite, pero WILLY no ha podido compilarlo en tu equipo (${note.replace(/\.$/, "")}). Para verlo aquí, WILLY puede añadir «vista-previa.html» (la aplicación completa en un solo archivo).`
          : "Es un proyecto React/Vite, pero falta su punto de entrada (el archivo que carga su index.html, como «src/main.tsx»), así que no se puede compilar. WILLY puede añadirlo, o añadir «vista-previa.html» (la aplicación completa en un solo archivo)."
        : "Este proyecto tiene archivos, pero ninguna página que se pueda ver aquí.";
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-accent/30 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 text-center" data-vista-vacia={kind}>
        <Monitor className="mx-auto mb-2 size-6 text-primary" />
        <p className="text-sm font-semibold">Vista previa</p>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        {!loading && kind !== "vacio" && canAsk && (
          <Button size="sm" className="mt-3 gap-1.5" disabled={running} onClick={onAsk}><Wand2 className="size-4" />Pedir a WILLY la vista previa</Button>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------------------------- Código
function CodeTab({ files, path, onPath, running }: { files: GeneratedFile[]; path: string | null; onPath: (p: string) => void; running: boolean }) {
  const preferred = files.find((f) => /(?:^|\/)vista-previa\.html?$/i.test(f.path)) ?? files.find((f) => /(?:^|\/)index\.html?$/i.test(f.path)) ?? files[0];
  const file = files.find((f) => f.path === path) ?? (running ? files.at(-1) : preferred);
  const [copied, setCopied] = useState(false);
  if (!files.length) return <Empty text="Todavía no hay código: cuéntale a SUPER WILLY en el chat lo que quieres construir." />;
  const lines = (file?.content ?? "").replace(/\n$/, "").split("\n");
  const MAX = 4000;
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[13rem_minmax(0,1fr)] sm:grid-rows-1">
      <div className="border-b border-border bg-card p-2 sm:hidden">
        <select value={file?.path ?? ""} onChange={(e: { target: { value: string } }) => onPath(e.target.value)} aria-label="Archivo" className="h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-xs">
          {files.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
        </select>
      </div>
      <ul className="hidden min-h-0 overflow-auto border-r border-border bg-card p-1.5 sm:block" aria-label="Archivos del proyecto">
        {files.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => onPath(f.path)} aria-current={f.path === file?.path ? "true" : undefined} title={f.path}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-mono text-[11px] ${f.path === file?.path ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
              <FileCode2 className="size-3.5 shrink-0 text-primary" /><span className="truncate">{f.path}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex min-h-0 min-w-0 flex-col bg-[oklch(0.17_0.02_265)]">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate font-mono text-foreground">{file?.path}</span>
          <span className="shrink-0">{lines.length} líneas{running && file === files.at(-1) ? " · escribiendo…" : ""}</span>
          <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-foreground" onClick={() => file && void copyText(file.content).then((ok) => { setCopied(ok); window.setTimeout(() => setCopied(false), 1500); })} aria-label="Copiar el archivo">
            <Copy className="size-3.5" />{copied ? "Copiado" : "Copiar"}
          </button>
          <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-foreground" onClick={() => file && downloadFile(file.path.split("/").pop() ?? file.path, file.content)} aria-label="Descargar el archivo">
            <Download className="size-3.5" />Descargar
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto py-2 font-mono text-[11px] leading-5 text-foreground/90" aria-label={`Código de ${file?.path ?? ""}`}>
          <code>
            {lines.slice(0, MAX).map((line, i) => (
              <span key={i} className="block whitespace-pre pr-3"><span className="mr-3 inline-block w-10 select-none text-right text-foreground/35">{i + 1}</span>{line || " "}</span>
            ))}
          </code>
          {lines.length > MAX && <span className="block px-3 pt-2 text-foreground/60">… se muestran las {MAX} primeras líneas de {lines.length}. Descárgalo para verlo entero.</span>}
        </pre>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------------------------- Archivos
type TreeNode = { name: string; path: string; dirs: Map<string, TreeNode>; files: GeneratedFile[] };

function treeOf(files: GeneratedFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part);
      if (!next) { next = { name: part, path: node.path ? `${node.path}/${part}` : part, dirs: new Map(), files: [] }; node.dirs.set(part, next); }
      node = next;
    }
    node.files.push(file);
  }
  return root;
}

const countFiles = (node: TreeNode): number => node.files.length + [...node.dirs.values()].reduce((n, d) => n + countFiles(d), 0);

function FilesTab({ files, name, onOpen, onZip }: { files: GeneratedFile[]; name: string; onOpen: (path: string) => void; onZip: () => void }) {
  const tree = useMemo(() => treeOf(files), [files]);
  if (!files.length) return <Empty text="Todavía no hay archivos en este proyecto." />;
  const total = files.reduce((n, f) => n + lineCount(f.content), 0);
  const render = (node: TreeNode, depth: number): ReactNode => (
    <>
      {[...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map((dir) => (
        <li key={dir.path}>
          <details open className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold hover:bg-accent/50" style={{ paddingLeft: 8 + depth * 14 }}>
              <ChevronDown className="size-3.5 shrink-0 -rotate-90 transition-transform [details[open]>summary>&]:rotate-0" /><Folder className="size-3.5 shrink-0 text-primary" />{dir.name}
              <span className="font-normal text-muted-foreground">· {countFiles(dir)}</span>
            </summary>
            <ul>{render(dir, depth + 1)}</ul>
          </details>
        </li>
      ))}
      {[...node.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => (
        <li key={f.path}>
          <button type="button" onClick={() => onOpen(f.path)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent/50" style={{ paddingLeft: 8 + depth * 14 + 18 }}>
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs"><FileCode2 className="size-3.5 shrink-0 text-primary" /><span className="truncate">{f.path.split("/").pop()}</span></span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{lineCount(f.content)} líneas</span>
          </button>
        </li>
      ))}
    </>
  );
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold">Archivos de «{name}» <span className="font-normal text-muted-foreground">({files.length} · {total} líneas)</span></p>
        <Button size="sm" variant="secondary" className="gap-1.5" onClick={onZip}><Download className="size-3.5" />Descargar ZIP</Button>
      </div>
      <ul className="rounded-lg border border-border bg-card p-1" aria-label="Árbol de archivos">{render(tree, 0)}</ul>
    </div>
  );
}

// --------------------------------------------------------------------------------------------------------- Cambios
type Base = { label: string; at: string | null; files: GeneratedFile[] };

function ChangesTab({ files, versions, compareTo, onCompareTo, onOpenFile }: { files: GeneratedFile[]; versions: ProjectVersion[]; compareTo: string; onCompareTo: (id: string) => void; onOpenFile: (path: string) => void }) {
  const [base, setBase] = useState<Base | null | "cargando" | "error">("cargando");
  const filesKey = files.map((f) => `${f.path}:${f.content.length}`).join("|");
  const versionsKey = versions.map((v) => v.id).join(",");
  useEffect(() => {
    let alive = true;
    void (async () => {
      setBase("cargando");
      if (compareTo !== "auto") {
        const v = await fetchVersion(compareTo);
        if (alive) setBase(v ? { label: v.label, at: v.at, files: v.files } : "error");
        return;
      }
      // Automático: la versión guardada más reciente que NO es igual a lo que hay ahora (lo último que cambió).
      for (const entry of versions.slice(0, 4)) {
        const v = await fetchVersion(entry.id);
        if (!alive) return;
        if (v && compareFiles(v.files, files).length) { setBase({ label: v.label, at: v.at, files: v.files }); return; }
      }
      // Sin una versión anterior distinta: si solo hay una, es la primera (todo es nuevo); si no, no ha cambiado nada.
      const oldest = versions[Math.min(3, versions.length - 1)];
      if (alive) setBase(versions.length > 1 && oldest ? { label: oldest.label, at: oldest.at, files } : null);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareTo, filesKey, versionsKey]);
  const changes = useMemo<FileChange[]>(() => (base === null ? compareFiles([], files) : typeof base === "object" ? compareFiles(base.files, files) : []), [base, files]);
  if (!files.length && !versions.length) return <Empty text="Todavía no hay cambios: cuando WILLY guarde archivos en el proyecto, aquí verás qué ha cambiado, línea a línea." />;
  const baseFiles = base && typeof base === "object" ? base.files : [];
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">Comparar lo de ahora con:</span>
        <select value={compareTo} onChange={(e: { target: { value: string } }) => onCompareTo(e.target.value)} aria-label="Versión con la que comparar" className="h-8 max-w-full rounded-md border border-border bg-background px-2 text-xs">
          <option value="auto">Lo último que cambió (automático)</option>
          {versions.map((v) => <option key={v.id} value={v.id}>{fmtDate(v.at)} · {v.label.slice(0, 60)}</option>)}
        </select>
      </div>
      {base === "cargando" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Comparando…</p>
      ) : base === "error" ? (
        <p className="text-sm text-destructive">No se ha podido leer esa versión.</p>
      ) : (
        <>
          <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm" data-resumen-cambios>
            {base === null ? `Primera versión: ${changeSummary(changes)}` : changeSummary(changes)}
            {base && <span className="block text-xs text-muted-foreground">Respecto a «{base.label}»{base.at ? ` (${fmtDate(base.at)})` : ""}.</span>}
          </p>
          <ul className="mt-3 space-y-2" aria-label="Archivos cambiados">
            {changes.map((c) => (
              <li key={c.path}>
                <details className="group rounded-lg border border-border bg-card">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
                    <ChevronDown className="size-3.5 shrink-0 -rotate-90 transition-transform [details[open]>summary>&]:rotate-0" />
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${c.status === "añadido" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : c.status === "eliminado" ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>{c.status}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{c.path}</span>
                    <span className="shrink-0 font-mono text-[11px]"><span className="text-emerald-600 dark:text-emerald-400">+{c.added}</span> <span className="text-destructive">−{c.removed}</span></span>
                  </summary>
                  <FileDiff before={baseFiles.find((f) => f.path.toLowerCase() === c.path.toLowerCase())?.content ?? ""} after={files.find((f) => f.path.toLowerCase() === c.path.toLowerCase())?.content ?? ""} />
                  {c.status !== "eliminado" && <div className="border-t border-border px-3 py-1.5"><button type="button" className="text-xs font-semibold text-primary" onClick={() => onOpenFile(c.path)}>Ver el archivo entero</button></div>}
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Las líneas que cambian de un archivo (con 3 de contexto), como un «diff» de toda la vida pero en claro. */
function FileDiff({ before, after }: { before: string; after: string }) {
  const hunks = useMemo(() => hunksOf(diffLines(before, after).ops, 3), [before, after]);
  const MAX = 400;
  let shown = 0;
  return (
    <div className="max-h-96 overflow-auto border-t border-border bg-background font-mono text-[11px] leading-5">
      {hunks.map((h, i) => {
        if (shown >= MAX) return null;
        const lines = h.lines.slice(0, MAX - shown);
        shown += lines.length;
        return (
          <div key={i} className="border-b border-border/60 last:border-b-0">
            <div className="bg-accent/40 px-3 py-0.5 text-muted-foreground">línea {h.bStart || h.aStart}</div>
            {lines.map((o, j) => (
              <div key={j} className={`flex whitespace-pre ${o.type === "add" ? "bg-emerald-500/10" : o.type === "del" ? "bg-destructive/10" : ""}`}>
                <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground/60">{o.a ?? ""}</span>
                <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground/60">{o.b ?? ""}</span>
                <span className={`w-4 shrink-0 select-none ${o.type === "add" ? "text-emerald-600 dark:text-emerald-400" : o.type === "del" ? "text-destructive" : "text-muted-foreground/50"}`}>{o.type === "add" ? "+" : o.type === "del" ? "−" : " "}</span>
                <span className="pr-3">{o.text || " "}</span>
              </div>
            ))}
          </div>
        );
      })}
      {shown >= MAX && <p className="px-3 py-1.5 text-muted-foreground">… hay más diferencias: se ven las {MAX} primeras líneas.</p>}
    </div>
  );
}

// --------------------------------------------------------------------------------------------------------- Versiones
function VersionsTab({ versions, onCompare }: { versions: ProjectVersion[]; onCompare: (id: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!versions.length) return <Empty text="Todavía no hay versiones: cada vez que WILLY guarda archivos en el proyecto, queda una versión que puedes restaurar." />;
  const restore = (v: ProjectVersion) => {
    if (!window.confirm(`¿Restaurar «${v.label}» (${fmtDate(v.at)})? Los archivos actuales del proyecto se sustituyen por los de esa versión (lo de ahora sigue en su propia versión).`)) return;
    setBusy(v.id);
    void projectService.restoreVersion(v.id).then((r) => {
      setBusy(null);
      pushNotice(r.ok ? `Versión «${v.label}» restaurada.` : `⚠️ ${r.error}`, r.ok ? "success" : "warn");
    });
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
      <p className="mb-3 text-xs text-muted-foreground">Cada vez que WILLY guarda archivos del proyecto queda una versión (se conservan las 40 últimas). Puedes compararla con lo de ahora o volver a ella.</p>
      <ul className="space-y-2" aria-label="Versiones del proyecto">
        {versions.map((v, i) => (
          <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Clock className="size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{v.label}{i === 0 && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">Última guardada</span>}</p>
              <p className="text-xs text-muted-foreground">{fmtDate(v.at)} · {v.fileCount ?? v.files.length} archivo(s)</p>
            </div>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2 text-xs" onClick={() => onCompare(v.id)}><ArrowLeftRight className="size-3.5" />Comparar con lo de ahora</Button>
            <Button size="sm" variant="secondary" className="h-8 gap-1.5 px-2 text-xs" disabled={busy !== null} onClick={() => restore(v)}>{busy === v.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}Restaurar</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">{text}</div>;
}

/** Publicar: WILLY prepara un ZIP con todos los archivos para subirlo a tu hosting (sin «destinos» que no hacen nada). */
export function DeployModal({ project, files, onClose }: { project: string; files: GeneratedFile[]; onClose: () => void }) {
  const [step, setStep] = useState<"form" | "building" | "done">("form");
  useEscapeToClose(onClose);
  const download = async () => {
    if (!files.length) { pushNotice("Todavía no hay archivos que publicar: pide algo a SUPER WILLY.", "warn"); return; }
    setStep("building");
    const result = await fileService.exportZip(project, files);
    if (!result.ok) { setStep("form"); pushNotice(`⚠️ ${result.error}`, "warn"); return; }
    setStep("done");
    pushNotice(`«${project}» preparado: ZIP con ${result.data} archivo(s) en tu carpeta de descargas.`, "success");
  };
  return (
    <div className="safe-modal fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onMouseDown={(e: { target: EventTarget; currentTarget: EventTarget }) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="Publicar proyecto" className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold">Publicar «{project}»</h2>
            <p className="text-sm text-muted-foreground">WILLY te prepara un ZIP con todos los archivos del proyecto para que lo subas a tu hosting o a tu servidor.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></Button>
        </div>
        {step !== "done" ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button className="gap-2" onClick={() => void download()} disabled={step === "building"}><Download className="size-4" />{step === "building" ? "Preparando..." : "Descargar ZIP"}</Button>
          </div>
        ) : (
          <>
            <p className="rounded-lg border border-border bg-background p-3 font-mono text-xs text-emerald-500">✓ ZIP con {files.length} archivo(s) descargado. Súbelo a tu hosting para publicarlo.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStep("form")}>Descargar de nuevo</Button>
              <Button onClick={onClose}>Cerrar</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
