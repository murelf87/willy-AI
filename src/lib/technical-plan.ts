// «Plan técnico del proyecto»: antes de construir algo que se vaya a publicar, WILLY explica en 33 puntos y en lenguaje sencillo
// cómo se construye, dónde se aloja, cuánto cuesta y cómo crecerá (docs/plan-tecnico.md).
//
// PRINCIPIO: EMPEZAR BARATO Y CRECER DESPUÉS. El día 1 basta con UN servidor (VPS 1: reverse proxy, frontend, API, worker,
// PostgreSQL y almacenamiento). Kubernetes, microservicios, Redis, Kafka, balanceadores o varios servidores NO se montan «por si
// acaso»: cada uno entra solo cuando aparece la señal medible que lo justifica. Pero el CÓDIGO se escribe desde el primer día
// preparado para ese crecimiento (API sin estado, almacenamiento y cola detrás de su propia pieza…), para no tener que rehacerlo.
// Y si el proyecto usa IA pesada, la IA va siempre por una cola y un «AI worker»: una generación larga no bloquea la aplicación.

import type { ProjectBrief } from "@/lib/project-brief";

export const TECH_PLAN_SECTIONS = [
  "Objetivo", "Arquitectura", "Frontend", "Backend", "Base de datos", "Almacenamiento", "Autenticación", "APIs externas",
  "Procesamiento en segundo plano", "IA / GPU", "Servidor inicial recomendado", "CPU", "RAM", "Disco", "Sistema operativo",
  "Base de datos recomendada", "Dominio", "SSL", "Email", "CDN", "Backups", "Monitorización", "Seguridad", "CI/CD", "Entornos",
  "Coste inicial", "Coste al crecer", "Cuellos de botella", "Plan de escalado", "Qué alojar en el mismo servidor al principio",
  "Qué separar al crecer", "Qué servicios son opcionales", "Qué servicios son imprescindibles",
] as const;

/** Día 1: todo en un solo servidor. */
export const STARTER_LAYOUT = ["VPS 1", "├── reverse proxy", "├── frontend", "├── API", "├── worker", "├── PostgreSQL", "└── almacenamiento"].join("\n");

/** Hacia dónde puede crecer (solo cuando haga falta), sin reescribir el código. */
export const GROWTH_LAYOUT = [
  "            CDN",
  "             │",
  "        LOAD BALANCER",
  "             │",
  "   ┌─────────┴─────────┐",
  "   │                   │",
  "API 1               API 2",
  "   │                   │",
  "   └─────────┬─────────┘",
  "             │",
  "         PostgreSQL",
  "             │",
  "       Redis / Queue",
  "             │",
  "      ┌──────┴──────┐",
  "      │             │",
  "   Worker 1      Worker 2",
  "      │",
  " Object Storage",
].join("\n");

/** Si el proyecto usa IA pesada: la IA nunca va dentro de la petición del usuario. */
export const AI_LAYOUT = ["WEB / APP", "   │", "API PRINCIPAL", "   │", "QUEUE", "   │", "AI WORKER", "   │", "GPU SERVER / OLLAMA / COMFYUI"].join("\n");

/** Reglas para que el código del día 1 pueda pasar al esquema de crecimiento sin rehacerlo. */
export const READY_TO_GROW = [
  "La API no guarda nada en su memoria entre peticiones (sesiones en la base de datos o en cookies firmadas): así mañana puede haber API 1 y API 2 detrás del balanceador.",
  "Los archivos se guardan a través de una sola pieza de almacenamiento: hoy una carpeta del VPS, mañana Object Storage (compatible con S3), sin tocar el resto del código.",
  "Las tareas largas van siempre a una cola y las hace el worker, nunca dentro de la petición del usuario: hoy la cola puede ser una tabla de PostgreSQL, mañana Redis u otra cola.",
  "Cada tarea guarda su estado (pendiente, en curso, hecha, fallida) y se puede repetir sin estropear nada: así pueden trabajar Worker 1 y Worker 2 a la vez.",
  "Toda la configuración (direcciones, claves, puertos) va en variables de entorno, nunca escrita en el código.",
  "Los cambios de la base de datos se hacen con migraciones numeradas.",
  "Una ruta de salud (/health) y registros por la salida estándar, para el balanceador y la monitorización.",
  "Los archivos del frontend salen con nombre versionado, listos para servirse desde una CDN.",
  "La caché va detrás de su propia pieza: hoy ninguna o una sencilla, mañana Redis, sin reescribir.",
] as const;

/** Reglas de la IA pesada (imágenes, vídeo, voz, modelos grandes). */
export const HEAVY_AI_RULES = [
  "La API no ejecuta la IA: crea un trabajo en la cola y responde al momento con su número.",
  "El AI WORKER lo hace en la GPU (Ollama, ComfyUI…) y la pantalla enseña el progreso y el resultado cuando termina.",
  "Límites claros: tantos trabajos a la vez como quepan en la memoria de la GPU, tiempo máximo, reintentos y botón de cancelar.",
  "Al principio el AI WORKER puede estar en tu propio ordenador con su GPU, o en el VPS 1 si la IA es ligera; al crecer, un servidor con GPU aparte.",
] as const;

/** Lo que NO se monta al principio. */
export const NOT_AT_START = ["Kubernetes", "microservicios", "Redis", "Kafka", "balanceador de carga", "varios servidores"] as const;

export type ScaleTrigger = { component: string; signal: string };

/** Cada pieza «grande» y la señal MEDIBLE que justificaría añadirla (si no se da la señal, no se añade). */
export const SCALE_TRIGGERS: ScaleTrigger[] = [
  { component: "Varios servidores + balanceador de carga", signal: "el servidor va al límite de CPU o memoria de forma sostenida en horas punta (por ejemplo, por encima del 70 %) incluso después de optimizar, o el negocio no puede permitirse ni un minuto sin servicio" },
  { component: "Redis (caché o colas)", signal: "hay consultas lentas que se repiten muchísimo (medido, no supuesto) o las tareas en segundo plano ya no caben en la propia base de datos" },
  { component: "Kafka (flujo de eventos)", signal: "varios sistemas distintos necesitan recibir los mismos eventos en tiempo real y a gran volumen (miles por segundo)" },
  { component: "Microservicios", signal: "varios equipos trabajan a la vez y se estorban, o una parte concreta necesita crecer de forma muy distinta al resto" },
  { component: "Kubernetes", signal: "hay muchos servicios y servidores que desplegar y vigilar a la vez, y alguien con tiempo para mantenerlo" },
  { component: "Base de datos en su propio servidor", signal: "la base de datos compite con la aplicación por memoria o CPU, o hacen falta réplicas y copias gestionadas" },
  { component: "CDN", signal: "hay muchas imágenes o vídeos, o visitantes lejos del servidor que notan lentitud" },
  { component: "Servidor con GPU propio", signal: "la IA se usa de forma constante y alquilarla por uso ya sale más cara que tenerla" },
];

export type StarterProfile = {
  id: "keep" | "own-computer" | "static" | "single-server" | "installed";
  summary: string;
  /** Esquema del día 1. */
  layout?: string;
  server?: string;
  database?: string;
};

// «local» a secas no cuenta: «un local», «comercio local»… no significan «solo en mi ordenador».
// (Límites de palabra a mano: «\b» no funciona con letras acentuadas como la «í» de «mí».)
const LOCAL_ONLY = /(?:^|[^a-zñáéíóúü])(sin internet|offline|solo para m[ií]|uso personal|en mi (?:ordenador|equipo|pc)|solo en local)(?![a-zñáéíóúü])/i;
const NEEDS_BACKEND = /\b(usuarios?|registro|login|acceso|cuentas?|pagos?|pedidos?|reservas?|citas?|tienda|carrito|panel|gesti[oó]n|gestionar|base de datos|inmobiliari\w*|clientes?|socios?|chat)\b/i;
// IA «pesada»: generar imágenes, vídeo, voz o música, avatares, modelos locales grandes, transcribir… (un chat con una IA externa no lo es).
const HEAVY_AI = /(?:^|[^a-zñáéíóúü])(genera[a-zñáéíóúü]* (?:de )?(?:im[aá]genes|v[ií]deos?|voz|voces|audio|m[uú]sica|avatares?)|(?:im[aá]genes|fotos|v[ií]deos?|voz|voces|m[uú]sica|avatares?) (?:con|por|mediante) (?:ia|inteligencia artificial)|avatar(?:es)?|comfyui|ollama|stable diffusion|flux|modelos? (?:locales?|grandes?|de ia propios?)|gpu|transcrib\w*|transcripci[oó]n|whisper|clonar (?:la )?voz)(?![a-zñáéíóúü])/i;

/** ¿El proyecto usa IA pesada? */
export const usesHeavyAI = (brief: Pick<ProjectBrief, "userInput" | "constraints">): boolean => HEAVY_AI.test(`${brief.userInput} ${brief.constraints.join(" ")}`);

/** Punto de partida más sencillo (y barato) que sirve para este proyecto. */
export function starterProfile(brief: Pick<ProjectBrief, "inferredType" | "userInput" | "constraints">): StarterProfile {
  if (["reparar", "mejorar", "importar"].includes(brief.inferredType)) {
    return { id: "keep", summary: "Se conserva la infraestructura que ya tenga el proyecto; solo se propone cambiarla si el problema lo exige." };
  }
  const text = `${brief.userInput} ${brief.constraints.join(" ")}`;
  // Réplica de un PROGRAMA que se instala (Windows, Linux, macOS o móvil): el día 1 no es un servidor.
  if (brief.inferredType === "replicar-programa" && /\b(windows|linux|macos|android|ios)\b/i.test(text)) {
    return {
      id: "installed",
      summary: "Programa que se instala en el equipo de cada usuario (con su instalador): el día 1 NO necesita servidor ni coste mensual. Si más adelante necesita cuentas, licencias, sincronización o actualizaciones automáticas, se añade un servidor pequeño aparte (VPS 1) solo para eso.",
      layout: ["EQUIPO DEL USUARIO (programa instalado)", "├── interfaz (ventana)", "├── servicio local en segundo plano (si hace falta)", "├── base de datos local (SQLite)", "└── carpeta de datos del usuario", "", "SOLO SI HACE FALTA MÁS ADELANTE: VPS 1 (API + PostgreSQL) para cuentas, licencias, sincronización o actualizaciones"].join("\n"),
    };
  }
  if (LOCAL_ONLY.test(text)) {
    return {
      id: "own-computer",
      summary: "En tu propio ordenador: sin servidor y sin coste, con las mismas piezas que tendría el VPS 1. Si más adelante quieres publicarlo, se pasa tal cual a un VPS pequeño.",
      layout: ["TU ORDENADOR", "├── frontend", "├── API", "├── worker", "├── base de datos (SQLite o PostgreSQL)", "└── almacenamiento (una carpeta)"].join("\n"),
    };
  }
  if (["web", "replicar", "replicar-programa", "imagen"].includes(brief.inferredType) && !NEEDS_BACKEND.test(text) && !usesHeavyAI(brief)) {
    return {
      id: "static",
      summary: "Web estática: alojamiento de webs estáticas (los hay gratuitos), dominio y SSL automático. Sin servidor ni base de datos propios hasta que hagan falta; si un día los necesita, se pasa al VPS 1.",
      layout: ["ALOJAMIENTO ESTÁTICO", "├── frontend (HTML, CSS, JS)", "├── dominio", "└── SSL automático"].join("\n"),
    };
  }
  return {
    id: "single-server",
    summary: "UN servidor pequeño (VPS 1) con todo dentro, más copias de seguridad diarias guardadas fuera del servidor.",
    layout: STARTER_LAYOUT,
    server: "2 vCPU · 4 GB de RAM · 40-80 GB SSD · Ubuntu Server LTS",
    database: "PostgreSQL en el mismo servidor (o SQLite si serán pocos usuarios)",
  };
}

const serverLine = (s: StarterProfile) => [s.server ? `Servidor: ${s.server}.` : "", s.database ? `Base de datos: ${s.database}.` : ""].filter(Boolean).join(" ");
const numbered = (items: readonly string[]) => items.map((r, i) => `${i + 1}. ${r}`).join("\n");

/** Instrucciones del plan técnico para el primer mensaje del proyecto. */
export function techPlanPromptBlock(brief: Pick<ProjectBrief, "inferredType" | "userInput" | "constraints">): string {
  const start = starterProfile(brief);
  if (start.id === "keep") return `INFRAESTRUCTURA: ${start.summary} Si propones un cambio, explica por qué.`;
  const heavy = usesHeavyAI(brief);
  return [
    `PLAN TÉCNICO, antes de programar (guárdalo en docs/plan-tecnico.md, en lenguaje sencillo), con estos 33 puntos: ${TECH_PLAN_SECTIONS.map((s, i) => `${i + 1}. ${s}`).join(" · ")}.`,
    `EMPIEZA BARATO Y DEJA EL CÓDIGO PREPARADO PARA CRECER. DÍA 1: ${start.summary}\n${start.layout ?? ""}${serverLine(start) ? `\n${serverLine(start)}` : ""}`,
    `CRECIMIENTO (solo cuando una señal medible lo pida; el código del día 1 debe poder llegar aquí sin rehacerse):\n${GROWTH_LAYOUT}`,
    `CÓDIGO PREPARADO PARA CRECER desde el primer día:\n${numbered(READY_TO_GROW)}`,
    `NO propongas al principio ${NOT_AT_START.join(", ")}. En «Plan de escalado» di, para cada uno, la señal medible que lo justificaría: ${SCALE_TRIGGERS.map((t) => `${t.component} → ${t.signal}`).join("; ")}.`,
    `${heavy ? "ESTE PROYECTO USA IA PESADA: usa obligatoriamente este esquema" : "SI EL PROYECTO USA IA PESADA (imágenes, vídeo, voz o modelos grandes), usa este esquema"} para que una generación pesada no bloquee toda la aplicación:\n${AI_LAYOUT}\n${numbered(HEAVY_AI_RULES)}`,
    "COSTES: con precios actuales buscados en internet (con fuente y fecha); si no has podido buscarlos, di que son estimaciones. Separa lo gratuito de lo de pago. No contrates ni pagues nada: eso lo decide el dueño.",
  ].join("\n\n");
}

const codeBlock = (text: string) => "```\n" + text + "\n```";

/** Primer docs/plan-tecnico.md: día 1, hacia dónde crecer, IA pesada, los 33 apartados pendientes y lo que NO hace falta al principio. */
export function techPlanSkeleton(brief: Pick<ProjectBrief, "name" | "inferredType" | "userInput" | "constraints">): string {
  const start = starterProfile(brief);
  const heavy = usesHeavyAI(brief);
  return [
    `# Plan técnico — ${brief.name}`,
    "> Principio: empezar barato y crecer después, solo cuando una señal medible lo pida, con el código preparado desde el primer día. WILLY completa cada punto al planificar.",
    "## Día 1: punto de partida", [start.summary, start.layout ? codeBlock(start.layout) : "", serverLine(start)].filter(Boolean).join("\n\n"),
    "## Hacia dónde puede crecer (sin rehacer el código)", codeBlock(GROWTH_LAYOUT),
    "## Código preparado para crecer desde el primer día", numbered(READY_TO_GROW),
    "## Si el proyecto usa IA pesada", `${heavy ? "**Detectado en tu idea: sí.**" : "Detectado en tu idea: no (se aplica si más adelante la usa)."}\n\n${codeBlock(AI_LAYOUT)}\n\n${numbered(HEAVY_AI_RULES)}`,
    ...TECH_PLAN_SECTIONS.flatMap((s, i) => [`## ${i + 1}. ${s}`, "_Pendiente._"]),
    "## Lo que NO hace falta al principio (y cuándo sí)",
    SCALE_TRIGGERS.map((t) => `- **${t.component}**: solo cuando ${t.signal}.`).join("\n"),
  ].join("\n\n") + "\n";
}

/** ¿Hace falta un plan técnico nuevo? (Reparar, mejorar o importar conservan la infraestructura que ya hay.) */
export const needsTechPlan = (brief: Pick<ProjectBrief, "inferredType" | "userInput" | "constraints">): boolean => starterProfile(brief).id !== "keep";
