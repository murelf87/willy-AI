// PRODUCT REBUILD ENGINE — replicación funcional completa + entrega instalable (Constitución del dueño, reglas 138–165).
//
// «Replicar» NO es copiar: es una reimplementación funcional propia y limpia (clean-room) a partir del comportamiento
// observable, la documentación pública, los estándares y lo que aporta el dueño. Nunca código propietario, claves,
// certificados, logotipos, textos ni datos protegidos del original; el producto tiene nombre, identidad y código propios.
//
// Qué hace este módulo (todo comprobable, nada simulado):
//  - Entiende el encargo (referencia, objetivo, nivel, destinos, entregas) y reconoce el software de sistema (VPN,
//    antivirus, firewall…), que no se resuelve con una web.
//  - Dice, por cada destino, si se puede entregar VERIFICADO desde tu equipo con Windows (iOS y macOS necesitan un Mac).
//  - Prepara el mensaje de arranque (auditoría → PRODUCT REBUILD REPORT → matriz → construcción por módulos) y los
//    documentos de trabajo del proyecto (docs/…).
//  - Lleva el estado de la réplica: los MÓDULOS los informa la construcción (docs/replicacion.json), pero un módulo sin
//    prueba de aceptación y sin evidencia NO cuenta como verificado; las COMPROBACIONES FINALES las decide WILLY con
//    revisiones reales, nunca la IA que construye. Hasta superarlas todas: «NO ENTREGABLE TODAVÍA».

import { suggestName, type Attachment, type ProjectBrief } from "@/lib/project-brief";
import { FEATURE_MATRIX_COLUMNS, OWNER_NEEDS, REBUILD_ANNEX_TEXT, REBUILD_PHASES, REBUILD_REPORT_HEADINGS, REPLICATION_LEVELS, SUBSYSTEM_STATES, constitutionSections } from "@/lib/owner-constitution";
import { checkReadme, scanDelivery, SCAN_LABELS, type ScanFile } from "@/lib/delivery-check";
import { techPlanSkeleton } from "@/lib/technical-plan";
import { DESKTOP_FORMAT_PROMPT, desktopFormatDoc, type FactoryCheckId, type FactoryReport } from "@/lib/desktop-format";

// ------------------------------------------------------------------ encargo
export const REBUILD_TARGETS = [
  { id: "windows", label: "Windows" },
  { id: "web", label: "Web" },
  { id: "android", label: "Android" },
  { id: "ios", label: "iOS" },
  { id: "linux", label: "Linux" },
  { id: "macos", label: "macOS" },
] as const;
export type RebuildTarget = (typeof REBUILD_TARGETS)[number]["id"];

export const REBUILD_DELIVERABLES = [
  { id: "codigo", label: "Código fuente" },
  { id: "compilada", label: "Aplicación compilada" },
  { id: "instalador", label: "Instalador" },
  { id: "documentacion", label: "Documentación" },
  { id: "informe", label: "Informe de pruebas" },
] as const;
export type RebuildDeliverable = (typeof REBUILD_DELIVERABLES)[number]["id"];

export type RebuildLevel = "completo" | "mvp";

export type RebuildRequest = {
  /** Lo que se escribió en «Referencia»: dirección web, nombre del programa, ruta… */
  reference: string;
  /** «¿Qué quieres conseguir?» */
  goal: string;
  level: RebuildLevel;
  targets: RebuildTarget[];
  deliverables: RebuildDeliverable[];
  /** ZIP, instalador, capturas o documentación (de los documentos va el texto leído). */
  attachments: Attachment[];
};

export const DEFAULT_REQUEST: Omit<RebuildRequest, "reference" | "goal" | "attachments"> = {
  level: "completo",
  targets: ["windows"],
  deliverables: ["codigo", "compilada", "instalador", "documentacion", "informe"],
};

// ------------------------------------------------------------------ viabilidad por destino (desde tu equipo con Windows)
export type Feasibility = { target: RebuildTarget; label: string; status: "posible" | "con-requisitos" | "bloqueado"; why: string };

export function targetFeasibility(target: RebuildTarget): Feasibility {
  const label = REBUILD_TARGETS.find((t) => t.id === target)!.label;
  switch (target) {
    case "windows": return { target, label, status: "posible", why: "Se compila, se instala y se prueba en este mismo equipo." };
    case "web": return { target, label, status: "posible", why: "Se prueba en tu navegador; para publicarla hará falta un alojamiento (lo dice el plan técnico)." };
    case "android": return { target, label, status: "con-requisitos", why: "Hace falta el SDK de Android (Android Studio) en tu equipo y un móvil Android o un emulador para probarla de verdad." };
    case "linux": return { target, label, status: "con-requisitos", why: "Se puede preparar desde Windows, pero para probarla de verdad hace falta Linux (por ejemplo, WSL o un equipo con Linux)." };
    case "ios": return { target, label, status: "bloqueado", why: "Apple solo permite compilar, firmar y probar apps de iPhone en un Mac con Xcode y una cuenta de desarrollador de Apple: desde un equipo con Windows no se puede entregar verificada." };
    case "macos": return { target, label, status: "bloqueado", why: "Para compilar, firmar y probar una app de Mac hace falta un Mac: desde un equipo con Windows no se puede entregar verificada." };
  }
}

// ------------------------------------------------------------------ qué clase de producto es
const SYSTEM_SOFTWARE: Array<[RegExp, string]> = [
  [/\bvpn\b|wireguard|openvpn/i, "VPN"],
  [/antivirus|anti-?malware/i, "ANTIVIRUS"],
  [/firewall|cortafuegos/i, "FIREWALL"],
  [/\bbackup\b|programa de copias|copias de seguridad autom/i, "BACKUP"],
  [/sincroniza(?:ci[oó]n|dor|r)\b/i, "SINCRONIZACIÓN"],
  [/\bdriver\b|controlador de dispositivo/i, "DRIVER"],
  [/servicio de windows|windows service/i, "SERVICIO WINDOWS"],
  [/\bdaemon\b|demonio del sistema/i, "DAEMON"],
  [/\bproxy\b/i, "PROXY"],
  [/\bdns\b/i, "DNS"],
  [/virtualiza|m[aá]quina virtual/i, "VIRTUALIZACIÓN"],
  [/sistema de archivos|file ?system/i, "SISTEMA DE ARCHIVOS"],
];

/** Software de sistema que aparece en el encargo (regla 145). */
export function systemSoftwareKinds(text: string): string[] {
  return SYSTEM_SOFTWARE.filter(([re]) => re.test(text)).map(([, kind]) => kind);
}

export type ProductCategory = "sistema" | "escritorio" | "movil" | "saas" | "web";

export function productCategory(req: Pick<RebuildRequest, "reference" | "goal" | "targets">): ProductCategory {
  const text = `${req.reference} ${req.goal}`;
  if (systemSoftwareKinds(text).length) return "sistema";
  const desktop = req.targets.some((t) => t === "windows" || t === "linux" || t === "macos");
  const mobile = req.targets.some((t) => t === "android" || t === "ios");
  if (desktop) return "escritorio";
  if (mobile) return "movil";
  return /\b(saas|suscripci[oó]n|usuarios|clientes|panel|multiusuario)\b/i.test(text) ? "saas" : "web";
}

// ------------------------------------------------------------------ módulos (lo que la construcción va completando)
export type ModuleStatus = "pendiente" | "en-curso" | "implementado" | "verificado" | "bloqueado";
export type RebuildModule = { id: string; name: string; status: ModuleStatus; test?: string; evidence?: string; note?: string };

const slug = (text: string): string => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const makeModule = (name: string): RebuildModule => ({ id: slug(name), name, status: "pendiente" });

/** Primer reparto en módulos; la auditoría lo completa en docs/replicacion.json. */
export function initialModules(req: RebuildRequest): RebuildModule[] {
  const text = `${req.reference} ${req.goal}`;
  const kinds = systemSoftwareKinds(text);
  const names = ["Análisis y matriz de funcionalidades", "Arquitectura y plan técnico", "Interfaz propia (diseño)"];
  if (/\b(login|usuarios?|cuentas?|registro|inicio de sesi[oó]n|contraseñas?)\b/i.test(text)) names.push("Acceso (login)");
  if (kinds.length) names.push("Servicio en segundo plano", "Comunicación interfaz ↔ servicio (IPC)");
  if (kinds.includes("VPN")) names.push("Motor de túnel (WireGuard u OpenVPN)", "Kill switch", "Protección de fugas DNS", "Reconexión automática", "Pruebas de red");
  if (kinds.includes("ANTIVIRUS")) names.push("Motor de análisis (firmas y reglas)", "Cuarentena y restauración", "Monitor en tiempo real", "Actualización de firmas", "Pruebas con muestras seguras (EICAR)");
  names.push("Motor principal", "Persistencia de datos", "Configuración");
  if (req.level === "completo" && req.deliverables.includes("instalador")) names.push("Actualizaciones");
  if (req.deliverables.includes("instalador")) names.push("Instalador", "Desinstalador");
  names.push("Pruebas funcionales", "Documentación", "Validación final");
  return [...new Set(names)].map(makeModule);
}

// ------------------------------------------------------------------ el encargo, guardado aparte (solo WILLY lo escribe)
const REQUEST_PREFIX = "willy-rebuild:";
/** Copia del encargo dentro del proyecto (la escribe WILLY al crearlo), por si este navegador no lo tiene guardado. */
export const REQUEST_PATH = "docs/encargo-replicacion.json";

/** Deja un encargo leído de fuera (almacenamiento o archivo) con solo valores válidos: nada inventado ni fuera de lista. */
function sanitizeRequest(raw: unknown): RebuildRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const targets = (Array.isArray(r["targets"]) ? r["targets"] : []).filter((t): t is RebuildTarget => REBUILD_TARGETS.some((x) => x.id === t));
  const deliverables = (Array.isArray(r["deliverables"]) ? r["deliverables"] : []).filter((d): d is RebuildDeliverable => REBUILD_DELIVERABLES.some((x) => x.id === d));
  const attachments: Attachment[] = (Array.isArray(r["attachments"]) ? r["attachments"] : [])
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof (a as Record<string, unknown>)["name"] === "string")
    .slice(0, 20)
    .map((a) => ({ name: String(a["name"]).slice(0, 200), kind: a["kind"] === "documento" || a["kind"] === "imagen" ? a["kind"] : "otro" }));
  const reference = String(r["reference"] ?? "").slice(0, 2000);
  const goal = String(r["goal"] ?? "").slice(0, 6000);
  if (!reference.trim() && !goal.trim()) return null;
  return { reference, goal, level: r["level"] === "mvp" ? "mvp" : "completo", targets: [...new Set(targets)], deliverables: [...new Set(deliverables)], attachments };
}

export function saveRebuildRequest(projectId: string, req: RebuildRequest): void {
  try { window.localStorage.setItem(REQUEST_PREFIX + projectId, JSON.stringify({ ...req, attachments: req.attachments.map((a) => ({ name: a.name, kind: a.kind })) })); } catch { /* sin almacenamiento: queda en docs/encargo-replicacion.json */ }
}

export function loadRebuildRequest(projectId: string): RebuildRequest | null {
  try {
    const raw = window.localStorage.getItem(REQUEST_PREFIX + projectId);
    return raw ? sanitizeRequest(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** El encargo guardado en un archivo del proyecto (docs/encargo-replicacion.json o el estado inicial): se limpia igual. */
export function requestFromStateFile(text: string | undefined): RebuildRequest | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as unknown;
    return raw && typeof raw === "object" ? sanitizeRequest((raw as Record<string, unknown>)["encargo"]) : null;
  } catch {
    return null;
  }
}

const COMMON_WORDS = new Set(["http", "https", "www", "com", "net", "org", "html", "app", "apps", "para", "como", "igual", "otra", "otro", "programa", "aplicacion", "aplicación", "quiero", "tengo", "mismo", "misma"]);
const OWN_NAME: Record<string, string> = {
  VPN: "VPN propia", ANTIVIRUS: "Antivirus propio", FIREWALL: "Cortafuegos propio", BACKUP: "Copias de seguridad propias",
  "SINCRONIZACIÓN": "Sincronizador propio", DRIVER: "Controlador propio", "SERVICIO WINDOWS": "Servicio propio", DAEMON: "Servicio propio",
  PROXY: "Proxy propio", DNS: "DNS propio", "VIRTUALIZACIÓN": "Virtualización propia", "SISTEMA DE ARCHIVOS": "Sistema de archivos propio",
};

/**
 * Nombre del proyecto: PROPIO, nunca el del producto de referencia (regla 11: identidad propia, sin presentarse como el
 * original). Se deduce del objetivo; si el objetivo repite el nombre de la referencia, se usa uno genérico.
 */
export function suggestRebuildName(req: Pick<RebuildRequest, "reference" | "goal">): string {
  const brand = (req.reference.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !COMMON_WORDS.has(w));
  const base = req.goal.trim() ? suggestName(req.goal) : "";
  if (base && base !== "Proyecto sin título" && !brand.some((w) => base.toLowerCase().includes(w))) return base;
  const kind = systemSoftwareKinds(`${req.reference} ${req.goal}`)[0];
  return (kind && OWN_NAME[kind]) || "Producto propio";
}

// ------------------------------------------------------------------ estado guardado en el proyecto (docs/replicacion.json)
export const STATE_PATH = "docs/replicacion.json";
export type RebuildState = { version: 1; encargo: RebuildRequest; modulos: RebuildModule[] };

const STATUSES: ModuleStatus[] = ["pendiente", "en-curso", "implementado", "verificado", "bloqueado"];

export function initialState(req: RebuildRequest): RebuildState {
  return { version: 1, encargo: { ...req, attachments: req.attachments.map((a) => ({ name: a.name, kind: a.kind })) }, modulos: initialModules(req) };
}

/**
 * Lee docs/replicacion.json tal como lo haya dejado la construcción y lo deja HONESTO: un módulo «verificado» sin prueba de
 * aceptación o sin evidencia baja a «implementado» (y lo dice). Si el archivo no se entiende, se usa el estado inicial.
 */
export function readState(text: string | undefined, fallback: RebuildState): { state: RebuildState; notes: string[] } {
  const notes: string[] = [];
  if (!text) return { state: fallback, notes };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { state: fallback, notes: ["docs/replicacion.json no es un JSON válido: se muestra el estado inicial."] }; }
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(obj["modulos"]) ? (obj["modulos"] as unknown[]) : [];
  const modulos: RebuildModule[] = [];
  for (const item of list.slice(0, 80)) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const name = String(m["nombre"] ?? m["name"] ?? "").trim().slice(0, 80);
    if (!name) continue;
    let status = STATUSES.includes(m["estado"] as ModuleStatus) ? (m["estado"] as ModuleStatus) : STATUSES.includes(m["status"] as ModuleStatus) ? (m["status"] as ModuleStatus) : "pendiente";
    const test = String(m["prueba"] ?? m["test"] ?? "").trim().slice(0, 300);
    const evidence = String(m["evidencia"] ?? m["evidence"] ?? "").trim().slice(0, 300);
    let note = String(m["nota"] ?? m["note"] ?? "").trim().slice(0, 300);
    if (status === "verificado" && (!test || !evidence)) {
      status = "implementado";
      note = `Sin ${!test ? "prueba de aceptación" : "evidencia"}: no cuenta como verificado.${note ? ` ${note}` : ""}`;
      notes.push(`«${name}» decía «verificado» sin ${!test ? "prueba" : "evidencia"}: se cuenta como implementado.`);
    }
    modulos.push({ id: String(m["id"] ?? slug(name)).slice(0, 40), name, status, ...(test ? { test } : {}), ...(evidence ? { evidence } : {}), ...(note ? { note } : {}) });
  }
  // El encargo es de WILLY (lo guardó al crear el proyecto): la construcción no puede cambiarlo desde este archivo.
  return { state: { version: 1, encargo: fallback.encargo, modulos: modulos.length ? modulos : fallback.modulos }, notes };
}

/** Avance de la construcción: verificado cuenta entero; implementado o en curso, la mitad. Lo bloqueado cuenta como pendiente. */
export function progress(modules: RebuildModule[]): { percent: number; verified: number; total: number } {
  const total = modules.length;
  if (!total) return { percent: 0, verified: 0, total: 0 };
  const verified = modules.filter((m) => m.status === "verificado").length;
  const half = modules.filter((m) => m.status === "implementado" || m.status === "en-curso").length;
  return { percent: Math.floor(((verified + half / 2) / total) * 100), verified, total };
}

// ------------------------------------------------------------------ comprobaciones finales (las decide WILLY, no la IA que construye)
export type GateId = "codigo" | "build" | "funcionalidad" | "comparacion" | "seguridad" | "instalacion-limpia" | "primer-arranque" | "instalador" | "desinstalacion" | "documentacion";
export type GateStatus = "superada" | "parcial" | "fallida" | "pendiente" | "no-aplica";
export type Gate = { id: GateId; label: string; status: GateStatus; detail: string };

/** Programas de Windows: lo comprueba la fábrica de instaladores (pestaña Replicación). */
const PRESS_FACTORY = "Pulsa «Crear instalador y probarlo» en esta pestaña cuando el programa esté listo (fábrica de instaladores).";
const NOT_YET_DESKTOP: Partial<Record<GateId, string>> = {
  build: `${PRESS_FACTORY} Monta el programa con su motor y compila su instalador.`,
  funcionalidad: `${PRESS_FACTORY} Ejecuta de verdad sus pruebas de aceptación (pruebas/*.test.mjs) en el programa instalado.`,
  "instalacion-limpia": `${PRESS_FACTORY} Lo instala en silencio en una carpeta vacía y comprueba archivos, accesos y registro.`,
  "primer-arranque": `${PRESS_FACTORY} Arranca el programa instalado y comprueba que su pantalla carga.`,
  instalador: `${PRESS_FACTORY} Compila el instalador de Windows (por usuario, sin permisos de administrador).`,
  desinstalacion: `${PRESS_FACTORY} Lo desinstala y comprueba que no queda nada.`,
};

/** Cuándo podrá WILLY comprobarlo por sí mismo (fases del plan): hasta entonces, «pendiente» con el motivo. */
const NOT_YET: Partial<Record<GateId, string>> = {
  build: "WILLY todavía no compila proyectos en tu equipo: llega en la fase R3.",
  funcionalidad: "Las pruebas de aceptación se ejecutarán de verdad cuando WILLY pueda arrancar el proyecto (fase R3).",
  "instalacion-limpia": "La fábrica de instaladores y la prueba en una carpeta vacía llegan en la fase R2.",
  "primer-arranque": "El primer arranque se comprobará al instalar de verdad (fase R2).",
  instalador: "La fábrica de instaladores para Windows llega en la fase R2.",
  desinstalacion: "La prueba de desinstalación llega con la fábrica de instaladores (fase R2).",
};

export const GATE_LABELS: Record<GateId, string> = {
  codigo: "Código", build: "Build", funcionalidad: "Funcionalidad", comparacion: "Comparación", seguridad: "Seguridad",
  "instalacion-limpia": "Instalación limpia", "primer-arranque": "Primer arranque", instalador: "Instalador", desinstalacion: "Desinstalación", documentacion: "Documentación",
};

/** Último informe de la fábrica de instaladores y si corresponde al código de ahora (si el código cambia, no cuenta). */
export type FactoryInput = { report: FactoryReport; fresh: boolean } | null;

export function evaluateGates(files: ScanFile[], state: RebuildState, factory: FactoryInput = null): Gate[] {
  const product = files.filter((f) => !/^docs\//i.test(f.path));
  const installer = state.encargo.deliverables.includes("instalador");
  const gate = (id: GateId, status: GateStatus, detail: string): Gate => ({ id, label: GATE_LABELS[id], status, detail });
  // Programas de Windows: las comprobaciones de compilar, instalar, arrancar, probar y desinstalar las hace la fábrica.
  const desktop = state.encargo.targets.includes("windows");
  const fx = desktop && factory ? factory : null;
  const notYet = (id: GateId) => (desktop ? NOT_YET_DESKTOP[id] : undefined) ?? NOT_YET[id]!;
  const factoryCheck = (id: FactoryCheckId) => (fx && fx.fresh ? fx.report.comprobaciones.find((c) => c.id === id) ?? null : null);
  const fromFactory = (id: GateId, check: FactoryCheckId): Gate | null => {
    if (!fx) return null;
    if (!fx.fresh) return gate(id, "pendiente", "El código ha cambiado desde la última prueba de la fábrica: vuelve a pulsar «Crear instalador y probarlo».");
    const c = factoryCheck(check);
    if (!c) return null;
    return gate(id, c.estado === "superada" ? "superada" : c.estado === "fallida" ? "fallida" : c.estado === "no-aplica" ? "no-aplica" : "pendiente", c.detalle);
  };
  const scan = scanDelivery(product);
  const blocking = scan.issues.filter((i) => i.kind !== "depuracion" && i.kind !== "secreto");
  const secrets = scan.issues.filter((i) => i.kind === "secreto");
  const first = (list: typeof scan.issues) => list.slice(0, 3).map((i) => `${i.file}:${i.line} (${SCAN_LABELS[i.kind]})`).join("; ");
  const gates: Gate[] = [];

  gates.push(!product.length
    ? gate("codigo", "pendiente", "Todavía no hay código del producto.")
    : blocking.length
      ? gate("codigo", "fallida", `${blocking.length} problema(s) en ${scan.checked} archivo(s): ${first(blocking)}.`)
      : gate("codigo", "superada", `${scan.checked} archivo(s) revisados: nada a medias, sin rastros de IA ni rutas de tu equipo.`));
  gates.push(fromFactory("build", "paquete") ?? gate("build", "pendiente", notYet("build")));
  gates.push(fromFactory("funcionalidad", "funcionalidad") ?? gate("funcionalidad", "pendiente", notYet("funcionalidad")));

  const needed = state.modulos;
  const pending = needed.filter((m) => m.status !== "verificado");
  gates.push(!needed.length
    ? gate("comparacion", "pendiente", "Falta la matriz de funcionalidades.")
    : pending.length
      ? gate("comparacion", "pendiente", `Faltan por verificar ${pending.length} de ${needed.length} módulo(s): ${pending.slice(0, 4).map((m) => m.name).join(", ")}${pending.length > 4 ? "…" : ""}.`)
      : factoryCheck("funcionalidad")?.estado === "superada"
        ? gate("comparacion", "superada", "Todos los módulos verificados con su prueba, y sus pruebas de aceptación superadas en el programa instalado (fábrica de instaladores).")
        : gate("comparacion", "parcial", desktop
          ? "La construcción da todos los módulos por verificados; WILLY lo confirmará ejecutando sus pruebas de aceptación con la fábrica de instaladores."
          : "La construcción da todos los módulos por verificados con su prueba; WILLY lo confirmará ejecutando esas pruebas (fase R3)."));

  gates.push(!product.length
    ? gate("seguridad", "pendiente", "Todavía no hay código del producto.")
    : secrets.length
      ? gate("seguridad", "fallida", `Hay ${secrets.length} clave(s) o secreto(s) en el código: ${first(secrets)}. Deben ir en variables de entorno.`)
      : factoryCheck("formato")?.estado === "superada" && !(fx?.report.avisos ?? []).some((a) => /recursos de internet/.test(a))
        ? gate("seguridad", "superada", "Ningún secreto en el código; sin paquetes de terceros (solo módulos de Node) ni recursos de internet; pruebas ejecutadas aisladas; el programa solo atiende a este equipo (127.0.0.1) y rechaza peticiones de otras webs.")
        : gate("seguridad", "parcial", desktop
          ? "Revisión básica superada (ningún secreto en el código). La fábrica completa la revisión (paquetes de terceros, recursos de internet y aislamiento) al crear el instalador."
          : "Revisión básica superada (ningún secreto en el código). Falta la auditoría de dependencias y de permisos, que llega en la fase R3."));

  for (const id of ["instalacion-limpia", "primer-arranque", "instalador", "desinstalacion"] as const) {
    const applies = id === "primer-arranque" || installer;
    gates.push(applies ? (fromFactory(id, id) ?? gate(id, "pendiente", notYet(id))) : gate(id, "no-aplica", "No has pedido instalador."));
  }

  const readme = checkReadme(product, { installer });
  gates.push(readme.ok
    ? gate("documentacion", "superada", `${readme.file} explica qué es, cómo instalarlo o arrancarlo y cómo usarlo${installer ? " y desinstalarlo" : ""}.`)
    : gate("documentacion", readme.file ? "fallida" : "pendiente", readme.file ? `A ${readme.file} le falta: ${readme.missing.join(", ")}.` : "Falta el README para el cliente."));
  return gates;
}

/** ¿Se puede entregar? Solo con TODOS los módulos verificados y TODAS las comprobaciones superadas (o que no aplican). */
export function deliveryStatus(state: RebuildState, gates: Gate[]): { final: boolean; label: "FINAL_VERIFIED" | "NO ENTREGABLE TODAVÍA"; missing: string[] } {
  const missing = [
    ...state.modulos.filter((m) => m.status !== "verificado").map((m) => `Módulo: ${m.name}`),
    ...gates.filter((g) => g.status !== "superada" && g.status !== "no-aplica").map((g) => `Comprobación: ${g.label}`),
  ];
  const final = missing.length === 0 && state.modulos.length > 0;
  return { final, label: final ? "FINAL_VERIFIED" : "NO ENTREGABLE TODAVÍA", missing };
}

// ------------------------------------------------------------------ documentos de trabajo del proyecto
export function reportSkeleton(name: string, req: RebuildRequest): string {
  const feas = req.targets.map(targetFeasibility);
  return [
    `# PRODUCT REBUILD REPORT — ${name}`,
    `> Réplica funcional PROPIA de: ${req.reference || "(ver encargo)"}. Se completa con la auditoría previa, ANTES de programar.`,
    "## Encargo",
    [`- Objetivo: ${req.goal || "(pendiente)"}`, `- Nivel: ${req.level === "mvp" ? "MVP" : "Producto completo"}`, `- Entregas: ${req.deliverables.map((d) => REBUILD_DELIVERABLES.find((x) => x.id === d)!.label).join(", ")}`,
      ...feas.map((f) => `- Destino ${f.label}: ${f.status === "posible" ? "posible" : f.status === "con-requisitos" ? "con requisitos" : "BLOQUEADO"} — ${f.why}`)].join("\n"),
    ...REBUILD_REPORT_HEADINGS.flatMap((h) => [`## ${h}`, "_Pendiente._"]),
    "## PARA CREAR ESTO NECESITAS", "_Pendiente._ (" + OWNER_NEEDS.join(", ") + ")",
    "## ESTADO DE LOS SUBSISTEMAS", `_Cada subsistema como ${SUBSYSTEM_STATES.join(" / ")}._`,
  ].join("\n\n") + "\n";
}

export function matrixSkeleton(name: string): string {
  return [
    `# Matriz de funcionalidades — ${name}`,
    "> Antes de programar un producto grande hay que entender toda su superficie funcional (regla 143).",
    `| ${FEATURE_MATRIX_COLUMNS.join(" | ")} |`,
    `|${FEATURE_MATRIX_COLUMNS.map(() => "---").join("|")}|`,
  ].join("\n") + "\n";
}

/** Documentos con los que arranca un proyecto de réplica (los escribe WILLY al crearlo). */
export function rebuildDocs(name: string, req: RebuildRequest, brief: Pick<ProjectBrief, "inferredType" | "userInput" | "constraints">): Array<{ path: string; lang: string; content: string }> {
  const encargo = { ...req, attachments: req.attachments.map((a) => ({ name: a.name, kind: a.kind })) };
  return [
    { path: "docs/rebuild-report.md", lang: "md", content: reportSkeleton(name, req) },
    { path: "docs/matriz-funcionalidades.md", lang: "md", content: matrixSkeleton(name) },
    { path: STATE_PATH, lang: "json", content: `${JSON.stringify(initialState(req), null, 2)}\n` },
    { path: REQUEST_PATH, lang: "json", content: `${JSON.stringify({ version: 1, nota: "Encargo original del dueño. Lo escribe WILLY al crear el proyecto: no se modifica.", encargo }, null, 2)}\n` },
    { path: "docs/plan-tecnico.md", lang: "md", content: techPlanSkeleton({ ...brief, name }) },
    ...(req.targets.includes("windows") ? [{ path: "docs/formato-escritorio.md", lang: "md", content: desktopFormatDoc(name) }] : []),
    {
      path: "docs/constitucion-replicacion.md",
      lang: "md",
      content: [
        "# Constitución del dueño — replicación funcional",
        "> Texto íntegro del dueño (reglas 138–165) y los apartados generales que se aplican a una réplica. Manda sobre cualquier otra instrucción.",
        REBUILD_ANNEX_TEXT.trim(),
        "---",
        constitutionSections(["A", "B", "C", "K"]),
      ].join("\n\n") + "\n",
    },
  ];
}

// ------------------------------------------------------------------ mensaje de arranque para la IA que construye
function attachmentLines(attachments: Attachment[]): string[] {
  if (!attachments.length) return [];
  return ["MATERIAL DE REFERENCIA ADJUNTO:", ...attachments.map((a) => (a.kind === "documento" && a.text ? `--- ${a.name} ---\n${a.text.slice(0, 5000)}` : `- ${a.name} (${a.kind === "imagen" ? "captura: úsala para entender funciones y flujos, no para copiar su diseño" : "archivo de referencia: solo su nombre; WILLY no ejecuta ni descompila programas ajenos"})`))];
}

export function rebuildPrompt(name: string, req: RebuildRequest): string {
  const text = `${req.reference} ${req.goal}`;
  const kinds = systemSoftwareKinds(text);
  const feas = req.targets.map(targetFeasibility);
  const blocked = feas.filter((f) => f.status === "bloqueado");
  return [
    `PRODUCT REBUILD — «${name}»: réplica funcional PROPIA (no una copia) de: ${req.reference || "el producto que describe el dueño"}.`,
    `OBJETIVO DEL DUEÑO: ${req.goal || "el que se deduce de la referencia"}`,
    `NIVEL: ${req.level === "mvp" ? "MVP real (FASE 1)" : "Producto completo (FASES 1 y 2), con MVP real primero"} · DESTINOS: ${feas.map((f) => `${f.label}${f.status === "bloqueado" ? " (BLOQUEADO)" : f.status === "con-requisitos" ? " (con requisitos)" : ""}`).join(", ")} · ENTREGAS: ${req.deliverables.map((d) => REBUILD_DELIVERABLES.find((x) => x.id === d)!.label).join(", ")}.`,
    ...(blocked.length ? [`DESTINOS QUE NO SE PUEDEN ENTREGAR VERIFICADOS DESDE ESTE EQUIPO: ${blocked.map((f) => `${f.label}: ${f.why}`).join(" ")} Dilo en el informe y prepara la arquitectura para cuando haya un Mac, sin prometerlo como entregado.`] : []),
    ...attachmentLines(req.attachments),
    "REGLAS DE LA RÉPLICA (Constitución del dueño, 138–165; texto completo en docs/constitucion-replicacion.md):",
    "- Replicar NO es copiar código: es una REIMPLEMENTACIÓN FUNCIONAL INDEPENDIENTE (clean-room) basada en comportamiento observable, documentación pública, estándares, protocolos abiertos, APIs permitidas, lo que aporta el dueño y open source con licencia compatible.",
    "- NUNCA copies código fuente propietario, claves, secretos, certificados, assets protegidos, logotipos, textos protegidos ni bases de datos privadas. Nombre, identidad, interfaz, código, arquitectura y assets PROPIOS; sin presentarte como el producto original.",
    `- Distingue el nivel pedido: ${REPLICATION_LEVELS.map((l) => `${l.id} (${l.what})`).join("; ")}. Aquí se pide PRODUCT REBUILD${kinds.length ? " / SYSTEM SOFTWARE REBUILD" : ""}.`,
    "- Una copia visual sin funcionalidad real NO es una réplica: si el producto necesita servicio de sistema, daemon, networking, base de datos, servidores, criptografía estándar, workers, almacenamiento o actualización automática, constrúyelos también.",
    ...(kinds.length ? [`- ES SOFTWARE DE SISTEMA (${kinds.join(", ")}): no es una simple web. Decide si hace falta Rust, C++, C, Go, .NET o servicios nativos y separa: INTERFAZ → API/IPC local → SERVICIO PRIVILEGIADO → MOTOR DEL SISTEMA (la interfaz nunca contiene la lógica sensible). Usa protocolos y componentes abiertos y revisados (por ejemplo WireGuard, ClamAV o YARA si procede, comprobando su licencia); nada de criptografía casera; en seguridad defensiva prueba con muestras seguras de prueba, nunca con software malicioso real.`] : []),
    "- Componentes sustituibles por interfaces (motor, almacenamiento, actualizaciones, nube) y empezar pequeño preparado para crecer (docs/plan-tecnico.md).",
    ...(req.targets.includes("windows") ? [`${DESKTOP_FORMAT_PROMPT}\n(Referencia completa en docs/formato-escritorio.md.)`] : []),
    "ORDEN DE TRABAJO:",
    "1. AUDITORÍA PREVIA: todas las funcionalidades; imprescindibles frente a opcionales; componentes técnicos; estándares existentes; tecnologías apropiadas; riesgos; licencias; arquitectura; infraestructura; pruebas; dificultad y recursos.",
    `2. PRODUCT REBUILD REPORT en docs/rebuild-report.md con estos apartados: ${REBUILD_REPORT_HEADINGS.join(", ")}; y «PARA CREAR ESTO NECESITAS…» (${OWNER_NEEDS.join(", ")}).`,
    `3. MATRIZ DE FUNCIONALIDADES en docs/matriz-funcionalidades.md con las columnas: ${FEATURE_MATRIX_COLUMNS.join(" | ")}.`,
    `4. Construye por fases (${REBUILD_PHASES.join(" → ")}), módulo a módulo, con código completo y archivos reales. Tras cada módulo, actualiza ${STATE_PATH} con este formato exacto: {"version":1,"modulos":[{"id":"…","nombre":"…","estado":"pendiente|en-curso|implementado|verificado|bloqueado","prueba":"prueba de aceptación","evidencia":"qué se ejecutó y qué salió","nota":"…"}]}. «verificado» exige prueba y evidencia reales; si no, «implementado».`,
    "5. Documentación para el cliente en README.md: qué es, cómo instalarlo o arrancarlo, cómo usarlo y cómo desinstalarlo.",
    `6. NUNCA des el producto por terminado ni hagas falsas promesas: di qué subsistemas están ${SUBSYSTEM_STATES.join(", ")}. La entrega final (FINAL_VERIFIED) la decide WILLY con sus propias comprobaciones (código, build, funcionalidad, comparación, seguridad, instalación limpia, primer arranque, instalador, desinstalación y documentación).`,
    "Empieza ya por la auditoría y el informe; solo pregunta lo que decide el dueño (marca, cuentas, pagos, publicar).",
  ].join("\n\n");
}
