// PROGRESO REAL DE LOS PROYECTOS (rediseño, fases 7, 8 y 9; puntos 40-77). Cada proyecto tiene un PLAN: hitos con peso según
// su tipo (una web no se mide como una API) y, dentro, tareas con peso (no vale lo mismo «README» que «el servidor»). El
// porcentaje sale SOLO de ese plan: trabajo hecho frente a trabajo planificado. Nada de Math.random, ni «Activo = 50 %».
// - Algunas tareas se comprueban solas con datos reales (la entrevista, la vista previa sin errores, el README, que haya
//   archivos): su estado no lo escribe nadie, se deduce de las evidencias guardadas.
// - Las demás las marca WILLY al entregar archivos (bloque «plan» de su respuesta; solo cuenta como hecha si los archivos se
//   han guardado de verdad), el análisis de un proyecto antiguo o el dueño a mano.
// - El 100 % exige la «Definition of Done»: todo hecho, vista previa sin errores, documentación, archivos y nada pendiente de
//   ti. Si no, como mucho 99 %. Rev28: en los proyectos con páginas, también sus PRUEBAS AUTOMÁTICAS, pasadas con los archivos
//   de ahora y sin fallos.
// - Si crece el alcance (tareas nuevas), el porcentaje baja: es lo correcto.
// - Sin plan (proyectos de antes): «Progreso no calculado», nunca un porcentaje inventado.
// Lógica pura, sin red: la usan la pantalla Proyectos, SUPER WILLY y el servidor, y se prueba aparte.

export type TaskStatus = "pendiente" | "en-curso" | "hecha" | "descartada";
/** Quién dejó la tarea como está. */
export type TaskBy = "entrevista" | "willy" | "dueno" | "analisis" | "sistema";
export type PlanTask = {
  id: string;
  title: string;
  /** 1 (poca cosa) … 5 (mucho trabajo). */
  weight: number;
  status: TaskStatus;
  /** Se comprueba sola: «entrevista» (resumen aprobado), «paso:<id>» (un bloque de la entrevista), «vista-ok», «readme», «archivos» y (rev28) «pruebas». */
  auto?: string;
  by?: TaskBy;
  at?: string;
};
export type PlanMilestone = { id: string; name: string; weight: number; tasks: PlanTask[] };
export type AttentionKind = "decision" | "bloqueo" | "error";
export type Attention = { kind: AttentionKind; reason: string; at: string };
export type PreviewEvidence = "ok" | "roto" | "sin-comprobar" | "no-aplica";
/** Rev28 · La última pasada de las pruebas automáticas del proyecto: cuántas, cuántas bien y de qué archivos (su huella). */
export type TestsEvidence = { total: number; passed: number; failed: number; skipped: number; key: string; at: string };
/** Lo que se sabe de verdad del proyecto (se actualiza al guardar archivos, al comprobar la vista previa y en la entrevista). */
export type PlanEvidence = {
  files: number;
  readme: boolean;
  pages: number;
  preview: PreviewEvidence;
  errors: number;
  discoveryDone: boolean;
  discoverySteps: string[];
  at: string;
  /** Rev28: huella de los archivos de ahora (para saber si las pruebas son de ellos). */
  filesKey?: string;
  /** Rev28: la última pasada de las pruebas automáticas. */
  tests?: TestsEvidence | null;
};
export type PlanSource = "entrevista" | "analisis" | "willy" | "sistema" | "dueno";
export type ProjectPlan = {
  version: 1;
  kind: string;
  source: PlanSource;
  createdAt: string;
  updatedAt: string;
  milestones: PlanMilestone[];
  attention: Attention | null;
  evidence: PlanEvidence;
};

// ------------------------------------------------------------------------------------------------ plantillas por tipo
type TemplateMilestone = { id: string; name: string; weight: number; phase: string };
const M = (id: string, name: string, weight: number, phase: string): TemplateMilestone => ({ id, name, weight, phase });

/** Hitos (con su peso) según el tipo de proyecto (rediseño, punto 54). */
export const TEMPLATES: Record<string, TemplateMilestone[]> = {
  web: [
    M("discovery", "Discovery", 10, "Definiendo requisitos"), M("diseno", "Diseño", 15, "Diseñando"), M("frontend", "Frontend", 30, "Construyendo frontend"),
    M("backend", "Backend", 20, "Construyendo backend"), M("pruebas", "Pruebas", 15, "Probando"), M("entrega", "Entrega", 10, "Preparando la entrega"),
  ],
  landing: [
    M("discovery", "Discovery", 10, "Definiendo requisitos"), M("diseno", "Diseño", 20, "Diseñando"), M("frontend", "Frontend", 40, "Construyendo la página"),
    M("pruebas", "Pruebas", 15, "Probando"), M("entrega", "Entrega", 15, "Preparando la entrega"),
  ],
  api: [
    M("arquitectura", "Arquitectura", 15, "Diseñando la API"), M("endpoints", "Endpoints", 30, "Construyendo endpoints"), M("datos", "Base de datos", 15, "Preparando la base de datos"),
    M("seguridad", "Seguridad", 15, "Asegurando la API"), M("pruebas", "Pruebas", 15, "Validando la API"), M("documentacion", "Documentación", 10, "Documentando"),
  ],
  app: [
    M("discovery", "Discovery", 10, "Definiendo requisitos"), M("ux", "Experiencia (UX)", 15, "Diseñando la experiencia"), M("frontend", "Frontend", 25, "Construyendo frontend"),
    M("backend", "Backend", 20, "Construyendo backend"), M("movil", "Móvil", 10, "Adaptando al móvil"), M("pruebas", "Pruebas", 10, "Probando"), M("paquete", "Paquete", 10, "Preparando el paquete"),
  ],
  escritorio: [
    M("discovery", "Discovery", 10, "Definiendo requisitos"), M("ux", "Experiencia (UX)", 15, "Diseñando la experiencia"), M("interfaz", "Interfaz", 25, "Construyendo la interfaz"),
    M("logica", "Lógica", 20, "Programando la lógica"), M("pruebas", "Pruebas", 15, "Probando"), M("instalador", "Instalador", 15, "Preparando el instalador"),
  ],
  herramienta: [
    M("discovery", "Discovery", 10, "Definiendo requisitos"), M("logica", "Lógica", 40, "Programando la lógica"), M("interfaz", "Interfaz", 20, "Construyendo la interfaz"),
    M("pruebas", "Pruebas", 20, "Probando"), M("entrega", "Entrega", 10, "Preparando la entrega"),
  ],
  sistema: [
    M("arquitectura", "Arquitectura", 12, "Arquitectura"), M("orquestador", "Orquestador", 10, "Orquestador"), M("discovery", "Project Discovery", 10, "Project Discovery"),
    M("vista", "Vista previa", 12, "Vista previa"), M("workspace", "Workspace", 10, "Workspace"), M("herramientas", "Herramientas", 7, "Herramientas"),
    M("ejecucion", "Ejecución", 10, "Ejecución"), M("calidad", "Quality Gate", 10, "Quality Gate"), M("memoria", "Memoria", 7, "Memoria"),
    M("segundo-plano", "Tareas en segundo plano", 5, "Tareas en segundo plano"), M("e2e", "E2E", 7, "Pruebas de punta a punta"),
    M("diseno", "Diseño del dueño", 10, "Diseño del dueño"),
  ],
};

/** Plantilla que toca a cada tipo de proyecto (los que no se conocen se miden como una web). */
export function templateKey(kind: string | null | undefined): keyof typeof TEMPLATES {
  const k = (kind ?? "").toLowerCase();
  if (k === "api" || k === "backend") return "api";
  if (k === "app" || k === "movil") return "app";
  if (k === "escritorio" || k === "replicar-programa") return "escritorio";
  if (k === "herramienta" || k === "automatizacion") return "herramienta";
  if (k === "landing") return "landing";
  if (k === "sistema") return "sistema";
  return "web";
}

// ------------------------------------------------------------------------------------------------ utilidades
const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const nowIso = (): string => new Date().toISOString();
const TASK_STATUSES: readonly TaskStatus[] = ["pendiente", "en-curso", "hecha", "descartada"];
const BYS: readonly TaskBy[] = ["entrevista", "willy", "dueno", "analisis", "sistema"];
const SOURCES: readonly PlanSource[] = ["entrevista", "analisis", "willy", "sistema", "dueno"];
const PREVIEWS: readonly PreviewEvidence[] = ["ok", "roto", "sin-comprobar", "no-aplica"];
const AUTO = /^(?:entrevista|vista-ok|readme|archivos|pruebas|paso:[a-z0-9-]{1,30})$/;
/** Rev28: la tarea de siempre «Funciones principales probadas» se comprueba sola con las pruebas automáticas. */
const TESTED_TASK = "funciones principales probadas";

export const emptyEvidence = (at = nowIso()): PlanEvidence => ({ files: 0, readme: false, pages: 0, preview: "sin-comprobar", errors: 0, discoveryDone: false, discoverySteps: [], at });

/** El siguiente identificador libre de tarea («t1», «t2»…). */
export function nextTaskId(plan: Pick<ProjectPlan, "milestones">): string {
  let max = 0;
  for (const m of plan.milestones) for (const t of m.tasks) { const n = /^t(\d+)$/.exec(t.id); if (n) max = Math.max(max, Number(n[1])); }
  return `t${max + 1}`;
}

/** Un plan leído del disco o recibido de fuera, con cada campo comprobado (null si no sirve). */
export function normalizePlan(raw: unknown): ProjectPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
  const isoOr = (v: unknown, fb: string): string => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : fb);
  const created = isoOr(r["createdAt"], new Date(0).toISOString());
  if (!Array.isArray(r["milestones"])) return null;
  const ids = new Set<string>();
  const milestones: PlanMilestone[] = [];
  for (const rawM of (r["milestones"] as unknown[]).slice(0, 20)) {
    if (!rawM || typeof rawM !== "object") continue;
    const mm = rawM as Record<string, unknown>;
    const name = str(mm["name"], 60).trim();
    if (!name) continue;
    const tasks: PlanTask[] = [];
    for (const rawT of (Array.isArray(mm["tasks"]) ? (mm["tasks"] as unknown[]) : []).slice(0, 80)) {
      if (!rawT || typeof rawT !== "object") continue;
      const tt = rawT as Record<string, unknown>;
      const title = str(tt["title"], 160).trim();
      let id = str(tt["id"], 20).trim();
      if (!title) continue;
      if (!/^[\w-]{1,20}$/.test(id) || ids.has(id)) id = "";
      const task: PlanTask = {
        id,
        title,
        weight: clamp(Math.round(Number(tt["weight"]) || 1), 1, 5),
        status: (TASK_STATUSES as readonly string[]).includes(tt["status"] as string) ? (tt["status"] as TaskStatus) : "pendiente",
      };
      const auto = str(tt["auto"], 40);
      if (AUTO.test(auto)) task.auto = auto;
      else if (norm(title) === TESTED_TASK) task.auto = "pruebas";
      if ((BYS as readonly string[]).includes(tt["by"] as string)) task.by = tt["by"] as TaskBy;
      const at = str(tt["at"], 40);
      if (at && !Number.isNaN(Date.parse(at))) task.at = at;
      if (id) ids.add(id);
      tasks.push(task);
    }
    const mid = str(mm["id"], 30).trim() || norm(name).replace(/ /g, "-").slice(0, 30) || `hito-${milestones.length + 1}`;
    milestones.push({ id: mid, name, weight: clamp(Math.round(Number(mm["weight"]) || 10), 1, 100), tasks });
  }
  // Las tareas sin identificador válido reciben uno nuevo (nunca dos iguales).
  const plan: ProjectPlan = {
    version: 1,
    kind: str(r["kind"], 40) || "web",
    source: (SOURCES as readonly string[]).includes(r["source"] as string) ? (r["source"] as PlanSource) : "willy",
    createdAt: created,
    updatedAt: isoOr(r["updatedAt"], created),
    milestones,
    attention: null,
    evidence: emptyEvidence(created),
  };
  for (const m of plan.milestones) for (const t of m.tasks) if (!t.id) t.id = nextTaskId(plan);
  const att = r["attention"] as Record<string, unknown> | null | undefined;
  if (att && typeof att === "object" && ["decision", "bloqueo", "error"].includes(att["kind"] as string) && str(att["reason"], 300).trim()) {
    plan.attention = { kind: att["kind"] as AttentionKind, reason: str(att["reason"], 300).trim(), at: isoOr(att["at"], plan.updatedAt) };
  }
  const ev = r["evidence"] as Record<string, unknown> | null | undefined;
  if (ev && typeof ev === "object") {
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    plan.evidence = {
      files: num(ev["files"]),
      readme: ev["readme"] === true,
      pages: num(ev["pages"]),
      preview: (PREVIEWS as readonly string[]).includes(ev["preview"] as string) ? (ev["preview"] as PreviewEvidence) : "sin-comprobar",
      errors: num(ev["errors"]),
      discoveryDone: ev["discoveryDone"] === true,
      discoverySteps: Array.isArray(ev["discoverySteps"]) ? (ev["discoverySteps"] as unknown[]).filter((s): s is string => typeof s === "string" && /^[a-z0-9-]{1,30}$/.test(s)).slice(0, 20) : [],
      at: isoOr(ev["at"], plan.updatedAt),
    };
    const fk = str(ev["filesKey"], 80);
    if (fk) plan.evidence.filesKey = fk;
    const te = ev["tests"] as Record<string, unknown> | null | undefined;
    if (te && typeof te === "object") {
      const key = str(te["key"], 80);
      if (key) plan.evidence.tests = { total: num(te["total"]), passed: num(te["passed"]), failed: num(te["failed"]), skipped: num(te["skipped"]), key, at: isoOr(te["at"], plan.updatedAt) };
    }
  }
  return plan;
}

// ------------------------------------------------------------------------------------------------ crear el plan
const TIER_WEIGHT: Record<string, number> = { imprescindible: 3, recomendada: 2, opcional: 1 };
const LOGIN = /\b(login|acceso|cuenta|cuentas|usuario|usuarios|registro|contrasena|clientes? registrad)/;

/** Lo que hace falta de la entrevista para planificar (así este archivo no depende de ella). */
export type DiscoveryInput = {
  kind: string;
  /** Bloques de la entrevista (sin el resumen), con su título. */
  steps: Array<{ id: string; title: string }>;
  /** Funciones encendidas (las «futuras» no entran en el plan de ahora). */
  features: Array<{ label: string; tier: string }>;
  needsServer: boolean;
  /** ¿Ya se ha aprobado el resumen («esto es lo que vamos a construir»)? */
  done: boolean;
  /** Bloques ya contestados. */
  completedSteps: string[];
  /** (25/09/2026) Páginas que el dueño enumeró en su idea («inicio, tratamientos, equipo…»): cada una es una tarea comprobable. */
  pages?: string[];
};

/**
 * El plan de un proyecto a partir de su entrevista (rediseño, puntos 51-54 y 77): los bloques de la entrevista son el hito
 * Discovery (se comprueban solos) y las funciones elegidas, las tareas de construcción, con su peso según lo importantes que son.
 */
export function planFromDiscovery(d: DiscoveryInput, at = nowIso()): ProjectPlan {
  const key = templateKey(d.kind);
  const plan: ProjectPlan = {
    version: 1, kind: d.kind, source: "entrevista", createdAt: at, updatedAt: at, milestones: [], attention: null,
    evidence: { ...emptyEvidence(at), discoveryDone: d.done, discoverySteps: [...new Set(d.completedSteps)] },
  };
  const add = (m: PlanMilestone, title: string, weight: number, extra: Partial<PlanTask> = {}) => {
    m.tasks.push({ id: nextTaskId(plan), title, weight, status: "pendiente", by: "entrevista", ...extra });
  };
  const features = d.features.filter((f) => f.tier !== "futura");
  const login = features.some((f) => LOGIN.test(norm(f.label)));
  for (const t of TEMPLATES[key]!) {
    const m: PlanMilestone = { id: t.id, name: t.name, weight: t.weight, tasks: [] };
    plan.milestones.push(m);
    switch (t.id) {
      case "discovery":
        for (const s of d.steps) add(m, `Entrevista: ${s.title}`, 1, { auto: `paso:${s.id}` });
        add(m, "Resumen aprobado («esto es lo que vamos a construir»)", 1, { auto: "entrevista" });
        break;
      case "arquitectura":
        for (const s of d.steps) add(m, `Entrevista: ${s.title}`, 1, { auto: `paso:${s.id}` });
        add(m, "Diseño de la API aprobado (rutas y datos)", 2, { auto: "entrevista" });
        break;
      case "diseno":
      case "ux":
        add(m, "Estilo visual y colores decididos", 1, d.steps.some((s) => s.id === "diseno") ? { auto: "paso:diseno" } : {});
        add(m, "Diseño aplicado a todas las pantallas", 2);
        add(m, "Se ve bien en el móvil", 1);
        break;
      case "frontend":
        add(m, key === "landing" ? "Estructura y secciones de la página" : "Estructura y navegación entre pantallas", 2);
        for (const p of d.pages ?? []) add(m, `Página de ${p}`, 2);
        for (const f of features) add(m, f.label, TIER_WEIGHT[f.tier] ?? 1);
        break;
      case "endpoints":
      case "logica":
        for (const f of features) add(m, f.label, TIER_WEIGHT[f.tier] ?? 1);
        break;
      case "interfaz":
        add(m, key === "herramienta" ? "Interfaz sencilla para usarla" : "Estructura y navegación entre pantallas", 2);
        break;
      case "backend":
        if (!d.needsServer) break;
        add(m, "Servidor (API) con sus rutas", 3);
        add(m, "Base de datos", 3);
        if (login) add(m, "Cuentas y seguridad", 2);
        add(m, "Pantallas conectadas con el servidor", 2);
        break;
      case "datos":
        add(m, "Base de datos", 3);
        break;
      case "seguridad":
        add(m, login ? "Cuentas, permisos y validación de datos" : "Validación de los datos que llegan", 2);
        break;
      case "movil":
        add(m, "Pantallas adaptadas al móvil", 2);
        break;
      case "pruebas":
        if (key !== "api") add(m, "Vista previa sin errores", 2, { auto: "vista-ok" });
        add(m, key === "api" ? "Pruebas de cada ruta" : "Funciones principales probadas", 2, key === "api" ? {} : { auto: "pruebas" });
        add(m, "Revisión del dueño", 1);
        break;
      case "entrega":
      case "paquete":
      case "instalador":
      case "documentacion":
        add(m, "README: cómo instalarlo y usarlo", 1, { auto: "readme" });
        if (t.id === "documentacion") add(m, "Ejemplos de uso de cada ruta", 1);
        else add(m, t.id === "instalador" ? "Instalador para Windows" : t.id === "paquete" ? "Paquete listo para instalar" : "Proyecto exportable (todos sus archivos)", 1, t.id === "entrega" ? { auto: "archivos" } : {});
        break;
      default:
        break;
    }
  }
  return plan;
}

/**
 * La entrevista ha cambiado (funciones que se encienden o se apagan, bloques contestados) o empieza la construcción: el plan
 * se vuelve a sacar de ella SIN perder el trabajo hecho. Las tareas con el mismo nombre conservan su id y su estado; las que
 * añadieron WILLY o el dueño se quedan; las de funciones que ya no se van a hacer, se quitan. Lo que se sabe (archivos, vista
 * previa…) y lo pendiente de ti se conservan.
 */
export function mergeDiscoveryPlan(old: ProjectPlan, fresh: ProjectPlan, at = nowIso()): ProjectPlan {
  const byTitle = new Map<string, PlanTask>();
  for (const m of old.milestones) for (const t of m.tasks) byTitle.set(norm(t.title), t);
  const used = new Set<string>();
  const merged: ProjectPlan = {
    ...fresh,
    createdAt: old.createdAt,
    updatedAt: at,
    attention: old.attention,
    evidence: { ...old.evidence, discoveryDone: fresh.evidence.discoveryDone, discoverySteps: fresh.evidence.discoverySteps, at },
    milestones: fresh.milestones.map((m) => ({ ...m, tasks: [] as PlanTask[] })),
  };
  // Primero las tareas que ya existían (conservan su id), luego las nuevas (id libre).
  const pendingNew: Array<[PlanMilestone, PlanTask]> = [];
  fresh.milestones.forEach((m, i) => {
    for (const t of m.tasks) {
      const prev = byTitle.get(norm(t.title));
      if (prev && !used.has(prev.id)) {
        used.add(prev.id);
        merged.milestones[i]!.tasks.push({ ...t, id: prev.id, status: t.auto ? t.status : prev.status, ...(prev.by && !t.auto ? { by: prev.by } : {}), ...(prev.at ? { at: prev.at } : {}) });
      } else pendingNew.push([merged.milestones[i]!, t]);
    }
  });
  // Lo que añadieron WILLY o el dueño (alcance nuevo) se queda en su hito.
  for (const m of old.milestones) {
    for (const t of m.tasks) {
      if (used.has(t.id) || t.by === "entrevista" || t.auto) continue;
      const target = merged.milestones.find((x) => x.id === m.id) ?? mainMilestone(merged);
      if (target) { target.tasks.push(t); used.add(t.id); }
    }
  }
  // Los ids nuevos nunca reutilizan uno que ya existió (la conversación con la IA puede nombrarlo).
  let n = Math.max(Number(nextTaskId(old).slice(1)), Number(nextTaskId(merged).slice(1))) - 1;
  for (const [m, t] of pendingNew) m.tasks.push({ ...t, id: `t${++n}` });
  return merged;
}

// ------------------------------------------------------------------------------------------------ calcular el progreso
export type MilestoneProgress = { id: string; name: string; weight: number; percent: number | null; done: number; total: number; state: "hecho" | "en-curso" | "pendiente" | "vacio" };
export type PendingItem = { milestone: string; task: PlanTask };
export type ProgressInfo = {
  /** ¿Se puede calcular? (hay un plan con tareas). Si no: «Progreso no calculado». */
  known: boolean;
  percent: number | null;
  remaining: number | null;
  milestones: MilestoneProgress[];
  /** Fase actual en palabras («Construyendo frontend», «Esperando tu decisión: …»). */
  phase: string;
  /** Lo que falta para terminar, en orden (rediseño, punto 67). */
  pending: PendingItem[];
  /** «Definition of Done» (rediseño, punto 59): sin esto no hay 100 %. */
  dod: { met: boolean; missing: string[] };
  /** Todas las tareas hechas, pero falta la validación final. */
  validating: boolean;
  discoveryDone: boolean;
};

/** Estado de una tarea contando con lo que se sabe de verdad (las automáticas no las escribe nadie). */
export function effectiveStatus(task: PlanTask, ev: PlanEvidence): TaskStatus {
  if (task.status === "descartada") return "descartada";
  if (!task.auto) return task.status;
  if (task.auto === "entrevista") return ev.discoveryDone ? "hecha" : "pendiente";
  if (task.auto.startsWith("paso:")) return ev.discoveryDone || ev.discoverySteps.includes(task.auto.slice(5)) ? "hecha" : "pendiente";
  if (task.auto === "vista-ok") return ev.preview === "ok" || ev.preview === "no-aplica" ? "hecha" : "pendiente";
  if (task.auto === "readme") return ev.readme ? "hecha" : "pendiente";
  if (task.auto === "archivos") return ev.files > 0 ? "hecha" : "pendiente";
  if (task.auto === "pruebas") {
    // Sin páginas que probar (una herramienta sin pantalla…), esa tarea la marcan WILLY o el dueño, como antes.
    const st = testsState(ev);
    if (st === "no-aplica") return task.status;
    return st === "bien" ? "hecha" : "pendiente";
  }
  return task.status;
}

/** ¿Se puede marcar esta tarea a mano (o WILLY en su bloque «plan»)? Las automáticas no; «pruebas», solo si no hay qué probar. */
const markable = (t: PlanTask, ev: PlanEvidence): boolean => !t.auto || (t.auto === "pruebas" && testsState(ev) === "no-aplica");

/**
 * Rev28 · Cómo están las pruebas automáticas del proyecto: «no-aplica» (sin páginas: una API…), «faltan» (no tiene), «fallan»,
 * «viejas» (se pasaron con otros archivos: el proyecto ha cambiado desde entonces) o «bien».
 */
export function testsState(ev: PlanEvidence): "no-aplica" | "faltan" | "fallan" | "viejas" | "bien" {
  if (ev.preview === "no-aplica" || ev.pages <= 0) return "no-aplica";
  const t = ev.tests;
  if (!t || t.total <= 0) return "faltan";
  if (ev.filesKey && t.key !== ev.filesKey) return "viejas";
  return t.failed > 0 ? "fallan" : "bien";
}

const phaseOfMilestone = (plan: ProjectPlan, id: string, name: string): string =>
  TEMPLATES[templateKey(plan.kind)]!.find((t) => t.id === id)?.phase ?? name;

export function computeProgress(plan: ProjectPlan | null | undefined): ProgressInfo {
  const unknown: ProgressInfo = { known: false, percent: null, remaining: null, milestones: [], phase: "Progreso no calculado", pending: [], dod: { met: false, missing: [] }, validating: false, discoveryDone: false };
  if (!plan) return unknown;
  const ev = plan.evidence;
  const milestones: MilestoneProgress[] = [];
  const pending: PendingItem[] = [];
  let doneWeight = 0;
  let totalWeight = 0;
  let firstOpen: PlanMilestone | null = null;
  for (const m of plan.milestones) {
    const tasks = m.tasks.filter((t) => effectiveStatus(t, ev) !== "descartada");
    const total = tasks.reduce((n, t) => n + t.weight, 0);
    const done = tasks.filter((t) => effectiveStatus(t, ev) === "hecha").reduce((n, t) => n + t.weight, 0);
    const doing = tasks.some((t) => effectiveStatus(t, ev) === "en-curso");
    for (const t of tasks) if (effectiveStatus(t, ev) !== "hecha") pending.push({ milestone: m.name, task: t });
    if (!total) {
      milestones.push({ id: m.id, name: m.name, weight: m.weight, percent: null, done: 0, total: 0, state: "vacio" });
      continue;
    }
    const fraction = done / total;
    doneWeight += m.weight * fraction;
    totalWeight += m.weight;
    const percent = Math.floor(fraction * 100);
    milestones.push({ id: m.id, name: m.name, weight: m.weight, percent, done: tasks.filter((t) => effectiveStatus(t, ev) === "hecha").length, total: tasks.length, state: percent >= 100 ? "hecho" : done > 0 || doing ? "en-curso" : "pendiente" });
    if (percent < 100 && !firstOpen) firstOpen = m;
  }
  if (!totalWeight) return { ...unknown, milestones };
  const raw = (doneWeight / totalWeight) * 100;
  const discovery = plan.milestones.find((m) => m.id === "discovery" || m.id === "arquitectura");
  const discoveryDone = ev.discoveryDone || !discovery || discovery.tasks.every((t) => effectiveStatus(t, ev) !== "pendiente" || !t.auto);
  const missing: string[] = [];
  if (pending.length) missing.push(`${pending.length} tarea(s) sin terminar`);
  if (ev.files <= 0) missing.push("el proyecto todavía no tiene archivos");
  if (ev.preview === "roto") missing.push("la vista previa tiene errores");
  else if (ev.preview === "sin-comprobar") missing.push("falta comprobar la vista previa");
  if (!ev.readme) missing.push("falta la documentación (README)");
  const tests = testsState(ev);
  if (tests === "faltan") missing.push("faltan las pruebas automáticas");
  else if (tests === "fallan") missing.push(`${ev.tests?.failed ?? 0} prueba(s) automática(s) fallan`);
  else if (tests === "viejas") missing.push("hay que volver a pasar las pruebas (el proyecto ha cambiado)");
  if (plan.attention) missing.push(plan.attention.kind === "decision" ? "hay una decisión pendiente" : plan.attention.kind === "bloqueo" ? "hay un bloqueo sin resolver" : "hay un error sin resolver");
  const met = missing.length === 0;
  let percent = Math.floor(raw);
  if (percent >= 100 && !met) percent = 99;
  if (met) percent = 100;
  const validating = !pending.length && !met;
  let phase: string;
  if (plan.attention?.kind === "decision") phase = `Esperando tu decisión: ${plan.attention.reason}`;
  else if (plan.attention?.kind === "bloqueo") phase = `Bloqueado: ${plan.attention.reason}`;
  else if (plan.attention?.kind === "error") phase = `Error: ${plan.attention.reason}`;
  else if (met) phase = "Completado";
  else if (validating) phase = "Validando";
  else if (firstOpen) phase = phaseOfMilestone(plan, firstOpen.id, firstOpen.name);
  else phase = "Validando";
  return { known: true, percent, remaining: 100 - percent, milestones, phase, pending, dod: { met, missing }, validating, discoveryDone };
}

// ------------------------------------------------------------------------------------------------ estado y acción principal
export type ProjectStatusId = "planificando" | "desarrollo" | "trabajando" | "decision" | "pausado" | "bloqueado" | "validando" | "listo" | "completado" | "error" | "archivado";
export const STATUS_LABEL: Record<ProjectStatusId, string> = {
  planificando: "Planificando", desarrollo: "En desarrollo", trabajando: "WILLY trabajando", decision: "Esperando tu decisión", pausado: "Pausado",
  bloqueado: "Bloqueado", validando: "Validando", listo: "Listo", completado: "Completado", error: "Error", archivado: "Archivado",
};

/** Estado del proyecto para cualquiera (rediseño, punto 60), a partir de datos reales. */
export function projectStatus(input: { state: string; working: boolean; plan: ProjectPlan | null | undefined; progress?: ProgressInfo }): ProjectStatusId {
  const progress = input.progress ?? computeProgress(input.plan);
  if (input.state === "Archivado") return "archivado";
  if (input.working) return "trabajando";
  if (input.state === "Pausado") return "pausado";
  const att = input.plan?.attention;
  if (att?.kind === "bloqueo") return "bloqueado";
  if (att?.kind === "decision") return "decision";
  if (att?.kind === "error") return "error";
  if (!progress.known) return input.state === "Listo" ? "listo" : input.state === "Borrador" ? "planificando" : "desarrollo";
  if (progress.percent === 100) return "completado";
  if (progress.validating) return "validando";
  if (!progress.discoveryDone) return "planificando";
  return "desarrollo";
}

export const needsAttention = (s: ProjectStatusId): boolean => s === "bloqueado" || s === "decision" || s === "error";

/** Botón principal según el estado (rediseño, punto 68): no siempre «Abrir». */
export function primaryAction(status: ProjectStatusId): "Continuar" | "Abrir" | "Resolver" | "Reanudar" {
  if (needsAttention(status)) return "Resolver";
  if (status === "pausado" || status === "archivado") return "Reanudar";
  if (status === "completado" || status === "listo") return "Abrir";
  return "Continuar";
}

// ------------------------------------------------------------------------------------------------ filtros y orden
export type ProjectFilter = "todos" | "desarrollo" | "atencion" | "pausados" | "completados" | "sistema";
export const FILTER_LABEL: Record<ProjectFilter, string> = { todos: "Todos", desarrollo: "En desarrollo", atencion: "Necesita atención", pausados: "Pausados", completados: "Completados", sistema: "Sistema" };
export function matchesFilter(status: ProjectStatusId, system: boolean, filter: ProjectFilter): boolean {
  if (filter === "sistema") return system;
  if (filter === "todos") return true;
  if (system) return false;
  if (filter === "atencion") return needsAttention(status);
  if (filter === "pausados") return status === "pausado";
  if (filter === "completados") return status === "completado" || status === "listo";
  return status === "planificando" || status === "desarrollo" || status === "trabajando" || status === "validando";
}

export type ProjectSort = "actividad" | "nombre" | "progreso" | "cerca" | "restante" | "fecha";
export const SORT_LABEL: Record<ProjectSort, string> = { actividad: "Actividad reciente", nombre: "Nombre", progreso: "Progreso", cerca: "Más cerca de terminar", restante: "Más trabajo restante", fecha: "Fecha de creación" };
export type SortItem = { name: string; updatedAt: string; createdAt: string; percent: number | null };
/** Ordena sin inventar: lo que no tiene progreso calculado va siempre al final en los órdenes por progreso. */
export function sortProjects<T extends SortItem>(items: T[], sort: ProjectSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  const unknownLast = (a: T, b: T, cmp: (x: number, y: number) => number) =>
    a.percent === null && b.percent === null ? byName(a, b) : a.percent === null ? 1 : b.percent === null ? -1 : cmp(a.percent, b.percent) || byName(a, b);
  const copy = [...items];
  switch (sort) {
    case "nombre": return copy.sort(byName);
    case "fecha": return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b));
    case "progreso": return copy.sort((a, b) => unknownLast(a, b, (x, y) => y - x));
    case "cerca": return copy.sort((a, b) => {
      // Lo ya terminado no está «cerca de terminar»: va detrás de lo que está en marcha.
      const fa = a.percent === 100 ? 1 : 0;
      const fb = b.percent === 100 ? 1 : 0;
      return fa - fb || unknownLast(a, b, (x, y) => y - x);
    });
    case "restante": return copy.sort((a, b) => unknownLast(a, b, (x, y) => x - y));
    default: return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byName(a, b));
  }
}

// ------------------------------------------------------------------------------------------------ última actividad
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** «Ahora», «Hace 10 min», «Hace 3 h», «Ayer», «22 sep» (rediseño, punto 76), de un dato real. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t <= 0) return "—";
  const diff = now - t;
  if (diff < 60_000) return "Ahora";
  if (diff < 3_600_000) return `Hace ${Math.floor(diff / 60_000)} min`;
  const d = new Date(t);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return `Hace ${Math.floor(diff / 3_600_000)} h`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return "Ayer";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== n.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}

// ------------------------------------------------------------------------------------------------ cambios en el plan
/** Marca a mano una tarea (el dueño, desde «Progreso del proyecto»). Las automáticas no se tocan. */
export function setTaskStatus(plan: ProjectPlan, taskId: string, status: TaskStatus, by: TaskBy = "dueno", at = nowIso()): ProjectPlan {
  return {
    ...plan,
    updatedAt: at,
    milestones: plan.milestones.map((m) => ({ ...m, tasks: m.tasks.map((t) => (t.id === taskId && markable(t, plan.evidence) ? { ...t, status, by, at } : t)) })),
  };
}

/** Añade una tarea (crece el alcance: el porcentaje puede bajar, y es lo correcto). */
export function addTask(plan: ProjectPlan, milestone: string, title: string, weight = 2, by: TaskBy = "dueno", at = nowIso()): ProjectPlan {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 160);
  if (!clean) return plan;
  const target = findMilestone(plan, milestone) ?? mainMilestone(plan);
  if (!target) return plan;
  const id = nextTaskId(plan);
  return {
    ...plan,
    updatedAt: at,
    milestones: plan.milestones.map((m) => (m.id === target.id ? { ...m, tasks: [...m.tasks, { id, title: clean, weight: clamp(Math.round(weight), 1, 5), status: "pendiente", by, at }] } : m)),
  };
}

function findMilestone(plan: ProjectPlan, name: string): PlanMilestone | null {
  const n = norm(name);
  if (!n) return null;
  return plan.milestones.find((m) => m.id === n.replace(/ /g, "-") || norm(m.name) === n) ?? plan.milestones.find((m) => norm(m.name).includes(n) || n.includes(norm(m.name))) ?? null;
}

/** El hito de construcción principal (donde van las tareas nuevas si no se dice otro). */
function mainMilestone(plan: ProjectPlan): PlanMilestone | null {
  const order = ["frontend", "endpoints", "logica", "interfaz"];
  for (const id of order) { const m = plan.milestones.find((x) => x.id === id); if (m) return m; }
  return plan.milestones.reduce<PlanMilestone | null>((best, m) => (!best || m.weight > best.weight ? m : best), null);
}

export function setAttention(plan: ProjectPlan, attention: { kind: AttentionKind; reason: string } | null, at = nowIso()): ProjectPlan {
  return { ...plan, updatedAt: at, attention: attention ? { kind: attention.kind, reason: attention.reason.replace(/\s+/g, " ").trim().slice(0, 300), at } : null };
}

export function withEvidence(plan: ProjectPlan, patch: Partial<Omit<PlanEvidence, "at">>, at = nowIso()): ProjectPlan {
  return { ...plan, updatedAt: at, evidence: { ...plan.evidence, ...patch, at } };
}

/** Lo que dicen los archivos del proyecto (cuántos, si tiene README de verdad, cuántas páginas). Rev28: su huella va aparte (filesKey). */
export function filesEvidence(files: ReadonlyArray<{ path: string; content: string }>): Pick<PlanEvidence, "files" | "readme" | "pages"> {
  const readme = files.find((f) => /(?:^|\/)readme(?:\.md|\.txt)?$/i.test(f.path));
  return {
    files: files.length,
    readme: Boolean(readme && readme.content.replace(/\s+/g, " ").trim().length >= 80),
    pages: files.filter((f) => /\.html?$/i.test(f.path)).length,
  };
}

// ------------------------------------------------------------------------------------------------ lo que dice WILLY (bloque «plan»)
export type PlanUpdate = { done: string[]; doing: string[]; added: Array<{ milestone: string; title: string; weight: number }>; decision: string | null; block: string | null };
const PLAN_FENCE = /```plan[ \t]*\n([\s\S]*?)(?:```|$)/i;

/** El bloque «plan» de una respuesta de WILLY (o null si no lo trae). */
export function parsePlanBlock(text: string): PlanUpdate | null {
  const m = PLAN_FENCE.exec(text);
  if (!m) return null;
  const out: PlanUpdate = { done: [], doing: [], added: [], decision: null, block: null };
  const ids = (s: string) => (s.match(/\bt\d{1,4}\b/g) ?? []).slice(0, 60);
  for (const raw of (m[1] ?? "").split("\n")) {
    const line = raw.trim().replace(/^[-*•]\s*/, "");
    const kv = /^([^:]{2,20}):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = norm(kv[1]!);
    const value = (kv[2] ?? "").trim();
    if (!value || /^(?:-|ninguna?|nada|no)$/i.test(value)) continue;
    if (key === "hecho" || key === "hechas" || key === "hecha" || key === "terminado" || key === "terminadas") out.done.push(...ids(value));
    else if (key === "en curso" || key === "empezado" || key === "empezadas") out.doing.push(...ids(value));
    else if (key === "nuevo" || key === "nueva" || key === "nuevas") {
      const parts = value.split("|").map((p) => p.trim());
      if (parts.length >= 2 && parts[1]) out.added.push({ milestone: parts[0] ?? "", title: parts[1].slice(0, 160), weight: clamp(Math.round(Number(parts[2]) || 2), 1, 3) });
      else if (parts[0]) out.added.push({ milestone: "", title: parts[0].slice(0, 160), weight: 2 });
    } else if (key === "decision") out.decision = value.slice(0, 300);
    else if (key === "bloqueo") out.block = value.slice(0, 300);
  }
  out.added = out.added.slice(0, 8);
  return out;
}

/** Quita de una respuesta los bloques «plan» y «plan-json» (no son archivos ni texto para el dueño). */
export function stripPlanBlocks(text: string): string {
  return text.replace(/```plan(?:-json)?[ \t]*\n[\s\S]*?(?:```|$)/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Aplica lo que dice WILLY: lo «hecho» cuenta solo si esta respuesta ha GUARDADO archivos (si no, queda «en curso»); las
 * tareas automáticas no se tocan; las nuevas amplían el alcance; una decisión o un bloqueo quedan como «necesita atención».
 */
export function applyPlanUpdate(plan: ProjectPlan, u: PlanUpdate, opts: { saved: boolean; at?: string }): ProjectPlan {
  const at = opts.at ?? nowIso();
  const done = new Set(u.done);
  const doing = new Set(u.doing);
  let next: ProjectPlan = {
    ...plan,
    updatedAt: at,
    milestones: plan.milestones.map((m) => ({
      ...m,
      tasks: m.tasks.map((t) => {
        if (!markable(t, plan.evidence) || t.status === "descartada") return t;
        if (done.has(t.id)) return opts.saved ? { ...t, status: "hecha" as const, by: "willy" as const, at } : t.status === "hecha" ? t : { ...t, status: "en-curso" as const, by: "willy" as const, at };
        if (doing.has(t.id) && t.status !== "hecha") return { ...t, status: "en-curso" as const, by: "willy" as const, at };
        return t;
      }),
    })),
  };
  for (const a of u.added) {
    const exists = next.milestones.some((m) => m.tasks.some((t) => norm(t.title) === norm(a.title)));
    if (!exists) next = addTask(next, a.milestone, a.title, a.weight, "willy", at);
  }
  if (u.block) next = setAttention(next, { kind: "bloqueo", reason: u.block }, at);
  else if (u.decision) next = setAttention(next, { kind: "decision", reason: u.decision }, at);
  return next;
}

/** Lo que se le cuenta a la IA del plan (tareas con su id) y cómo tiene que decir qué ha terminado. */
export function planPromptBlock(plan: ProjectPlan): string {
  const progress = computeProgress(plan);
  const open = progress.pending.filter((p) => markable(p.task, plan.evidence)).slice(0, 40);
  const doneIds = plan.milestones.flatMap((m) => m.tasks).filter((t) => markable(t, plan.evidence) && effectiveStatus(t, plan.evidence) === "hecha").map((t) => t.id);
  return [
    `PLAN DEL PROYECTO (progreso real: ${progress.percent ?? 0} %, fase: ${progress.phase}). Tareas que faltan (id · hito · tarea):`,
    ...(open.length ? open.map((p) => `- ${p.task.id} · ${p.milestone} · ${p.task.title}`) : ["- (ninguna: queda validar y entregar)"]),
    doneIds.length ? `Ya hechas: ${doneIds.join(", ")}.` : "",
    "AL FINAL de tu respuesta, si entregas archivos, añade SIEMPRE este bloque (solo las líneas que correspondan):",
    "```plan",
    "hecho: <ids de las tareas que quedan TERMINADAS de verdad con los archivos que entregas>",
    "en curso: <ids de las que has empezado pero no están terminadas>",
    "nuevo: <hito> | <tarea nueva que ha aparecido> | <peso 1-3>",
    "decisión: <solo si necesitas que el dueño decida algo para seguir>",
    "bloqueo: <solo si no puedes seguir sin algo que falta, como una clave o un dato>",
    "```",
    "No marques como hecha ninguna tarea que no esté terminada en los archivos que entregas.",
  ].filter(Boolean).join("\n");
}

// ------------------------------------------------------------------------------------------------ plan hecho por WILLY (análisis)
/** Lo que se le pide a la IA para hacer el plan de un proyecto (uno antiguo, o uno que se construye sin entrevista). */
export function planJsonRequest(kind: string, context: "analizar" | "construir"): string {
  const names = TEMPLATES[templateKey(kind)]!.map((t) => t.name).join(", ");
  return [
    context === "analizar"
      ? "ANALIZA ESTE PROYECTO (sus archivos reales) para saber cuánto lleva y cuánto le falta. No cambies ningún archivo."
      : "Además, como este proyecto todavía no tiene plan, AL FINAL de tu respuesta entrega su PLAN.",
    `Hitos (usa estos nombres): ${names}.`,
    "En cada hito, las tareas CONCRETAS de este proyecto (máx. 10 por hito), con su peso (1 poca cosa, 3 mucho trabajo) y su estado:",
    "«hecha» SOLO si está terminada en los archivos; si no, «pendiente». No inventes trabajo que no haga falta.",
    "Formato exacto (JSON en un bloque):",
    "```plan-json",
    '{"milestones":[{"name":"Frontend","tasks":[{"title":"Página de reservas","weight":2,"status":"hecha"}]}]}',
    "```",
  ].join("\n");
}

/** El plan que devuelve la IA (bloque «plan-json»), encajado en los hitos del tipo de proyecto. null si no lo trae o no sirve. */
export function parsePlanJson(text: string, kind: string, opts: { source?: PlanSource; at?: string; evidence?: Partial<PlanEvidence> } = {}): ProjectPlan | null {
  const m = /```plan-json[ \t]*\n([\s\S]*?)(?:```|$)/i.exec(text);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse((m[1] ?? "").trim());
  } catch {
    return null;
  }
  const at = opts.at ?? nowIso();
  const list = raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>)["milestones"]) ? ((raw as Record<string, unknown>)["milestones"] as unknown[]) : null;
  if (!list) return null;
  const key = templateKey(kind);
  const plan: ProjectPlan = {
    version: 1, kind, source: opts.source ?? "analisis", createdAt: at, updatedAt: at, attention: null,
    evidence: { ...emptyEvidence(at), discoveryDone: true, ...opts.evidence, at },
    milestones: TEMPLATES[key]!.map((t) => ({ id: t.id, name: t.name, weight: t.weight, tasks: [] })),
  };
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const target = findMilestone(plan, String(it["name"] ?? "")) ?? mainMilestone(plan);
    if (!target) continue;
    for (const rt of (Array.isArray(it["tasks"]) ? (it["tasks"] as unknown[]) : []).slice(0, 12)) {
      if (!rt || typeof rt !== "object") continue;
      const tt = rt as Record<string, unknown>;
      const title = String(tt["title"] ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      if (!title || target.tasks.some((x) => norm(x.title) === norm(title))) continue;
      const done = /^(?:hecha|hecho|terminada|done)$/i.test(String(tt["status"] ?? ""));
      target.tasks.push({ id: nextTaskId(plan), title, weight: clamp(Math.round(Number(tt["weight"]) || 1), 1, 3), status: done ? "hecha" : "pendiente", by: opts.source === "willy" ? "willy" : "analisis", at });
    }
  }
  if (!plan.milestones.some((mm) => mm.tasks.length)) return null;
  // Lo que se comprueba solo, siempre: la vista previa (si tiene páginas), el README y que haya archivos.
  const tests = plan.milestones.find((mm) => mm.id === "pruebas");
  if (tests && key !== "api" && !tests.tasks.some((t) => t.auto === "vista-ok")) tests.tasks.unshift({ id: nextTaskId(plan), title: "Vista previa sin errores", weight: 2, status: "pendiente", auto: "vista-ok", by: "sistema" });
  const docs = plan.milestones.find((mm) => ["entrega", "documentacion", "paquete", "instalador"].includes(mm.id));
  if (docs && !docs.tasks.some((t) => t.auto === "readme")) docs.tasks.push({ id: nextTaskId(plan), title: "README: cómo instalarlo y usarlo", weight: 1, status: "pendiente", auto: "readme", by: "sistema" });
  // Los bloques de la entrevista no existen en un proyecto analizado: su «Discovery» cuenta como hecho si tiene archivos.
  const disc = plan.milestones.find((mm) => mm.id === "discovery");
  if (disc && !disc.tasks.length) disc.tasks.push({ id: nextTaskId(plan), title: "Requisitos definidos (proyecto ya empezado)", weight: 1, status: "pendiente", auto: "archivos", by: "sistema" });
  return plan;
}
