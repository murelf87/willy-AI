// «Brief» de un proyecto nuevo: lo que el dueño quiere conseguir, ordenado para que WILLY lo planifique. Sustituye al antiguo
// «TIPO con MODELO. DESCRIPCIÓN»: el modelo YA NO va dentro de la descripción (lo elige WILLY, o el dueño en «Opciones
// avanzadas»), y el tipo de proyecto se deduce del texto en vez de obligar a elegirlo.

import type { ProjectMode } from "@/types/domain";
import { designPromptBlock, needsVisualDirections } from "@/lib/design-intelligence";
import { techPlanPromptBlock } from "@/lib/technical-plan";

export type QuickAction = { id: string; label: string; hint: string };

/** Atajos opcionales: ayudan a arrancar, pero nunca hace falta elegir uno. */
export const QUICK_ACTIONS: QuickAction[] = [
  { id: "web", label: "Crear web", hint: "Una web completa: páginas, formulario de contacto, textos legales…" },
  { id: "app", label: "Crear aplicación", hint: "Una aplicación con sus pantallas, datos y acciones reales." },
  { id: "api", label: "Crear API", hint: "Un servicio de datos con sus rutas, validaciones y pruebas." },
  { id: "herramienta", label: "Crear herramienta", hint: "Una utilidad concreta que haga una tarea de principio a fin." },
  { id: "automatizacion", label: "Crear automatización", hint: "Algo que haga solo un trabajo repetitivo." },
  { id: "replicar", label: "Replicar una web", hint: "Pega la dirección de la web que quieres tomar como modelo." },
  { id: "imagen", label: "Crear desde imagen", hint: "Adjunta una captura o un boceto de lo que quieres." },
  { id: "importar", label: "Importar proyecto", hint: "Adjunta o describe el proyecto que ya tienes." },
  { id: "reparar", label: "Reparar proyecto", hint: "Cuenta qué falla (y adjunta el error si lo tienes)." },
  { id: "mejorar", label: "Mejorar proyecto", hint: "Cuenta qué quieres mejorar de un proyecto que ya tienes." },
  { id: "investigar", label: "Investigar y construir", hint: "WILLY investiga qué existe antes de construir." },
];

export const TYPE_LABELS: Record<string, string> = {
  web: "web",
  app: "aplicación",
  api: "API / servicio de datos",
  herramienta: "herramienta",
  automatizacion: "automatización",
  replicar: "réplica de una web",
  "replicar-programa": "réplica funcional propia de un programa o aplicación",
  imagen: "creación a partir de una imagen",
  importar: "importar un proyecto existente",
  reparar: "reparar un proyecto",
  mejorar: "mejorar un proyecto",
  investigar: "investigación y construcción",
  chat: "asistente de chat",
  desconocido: "por decidir (WILLY lo deduce al planificar)",
};

export type Attachment = { name: string; kind: "documento" | "imagen" | "otro"; text?: string };

export type ProjectBrief = {
  name: string;
  mode: ProjectMode;
  /** Objetivo en una frase. */
  goal: string;
  /** Lo que escribió el dueño, tal cual. */
  userInput: string;
  /** Direcciones web que aparecen en el texto. */
  references: string[];
  attachments: Attachment[];
  /** Condiciones que el dueño ha puesto («sin internet», «gratis», «para móvil»…). */
  constraints: string[];
  /** Tipo deducido (o el del atajo elegido). */
  inferredType: string;
  quickAction?: string;
  /** Modelo elegido a mano en «Opciones avanzadas» (si no, decide WILLY). */
  preferredModel?: string;
  createdAt: string;
};

const RULES: Array<[string, RegExp]> = [
  ["replicar", /\b(replica|r[eé]plica|clona|copia(r)? (esta|la) web|igual que (esta|la) web|como (esta|la) web)\b/i],
  ["reparar", /\b(repara|arregla|no funciona|falla|error(es)? (al|en)|est[aá] roto)\b/i],
  ["importar", /\b(importa|importar|mi proyecto (actual|existente)|repositorio|\.zip\b)/i],
  ["mejorar", /\b(mejora(r)? (mi|el|la|este)|optimiza)\b/i],
  ["api", /\b(api|endpoint|backend|servicio de datos|microservicio)\b/i],
  ["automatizacion", /\b(automatiza|automatizaci[oó]n|cada (d[ií]a|semana|hora)|de forma autom[aá]tica|bot)\b/i],
  ["chat", /\b(chatbot|asistente de chat|asistente virtual)\b/i],
  ["web", /\b(web|p[aá]gina|landing|tienda online|blog|portfolio)\b/i],
  ["app", /\b(app|aplicaci[oó]n|programa|plataforma|panel|gestor|gestionar|gesti[oó]n)\b/i],
  ["herramienta", /\b(herramienta|utilidad|calculadora|conversor|generador)\b/i],
];

/** Tipo de proyecto deducido del texto (el atajo elegido manda si lo hay). */
export function inferProjectType(text: string, quickAction?: string): string {
  if (quickAction && TYPE_LABELS[quickAction]) return quickAction;
  for (const [type, re] of RULES) if (re.test(text)) return type;
  return "desconocido";
}

export function extractUrls(text: string): string[] {
  const found = text.match(/\bhttps?:\/\/[^\s<>"'«»]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:)\]]+$/, "")))];
}

const CONSTRAINT = /\b(sin |no (quiero|debe|puede|usar|necesit)|solo |s[oó]lo |gratis|gratuit|sin coste|offline|sin internet|local|privad|en espa[ñn]ol|para m[oó]vil|responsive|accesible|r[aá]pid|seguro|rgpd|antes del|para el d[ií]a|m[aá]ximo|m[ií]nimo)/i;

/** Frases del texto que son condiciones o límites. */
export function extractConstraints(text: string): string[] {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?;])\s+|\s*\n\s*/).map((s) => s.trim()).filter(Boolean);
  return sentences.filter((s) => CONSTRAINT.test(s)).map((s) => s.replace(/[.;]+$/, "")).slice(0, 8);
}

const FILLER = /^(hola|oye|por favor|porfa|quiero|quisiera|necesito|me gustar[ií]a|crea(me)?|cr[eé]ame|haz(me)?|hacer|construye(me)?|desarrolla(me)?|genera(me)?|dise[ñn]a(me)?|monta(me)?|tener|que|una?|el|la|los|las|nueva?|mi|programa|aplicaci[oó]n|app|web|p[aá]gina|proyecto|herramienta|sistema|para|de|del)$/i;

/** Nombre corto a partir de la idea («Quiero una aplicación para gestionar una clínica» → «Gestionar una clínica»). */
export function suggestName(text: string): string {
  const firstLine = text.replace(/https?:\/\/\S+/g, " ").split(/[.!?\n]/).find((s) => s.trim()) ?? "";
  const words = firstLine.replace(/[«»"“”¿¡,:;()]/g, " ").split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < words.length - 1 && FILLER.test(words[start]!)) start++;
  const picked = words.slice(start, start + 5).join(" ").trim();
  if (!picked) return "Proyecto sin título";
  const name = picked.charAt(0).toUpperCase() + picked.slice(1);
  return name.length > 48 ? `${name.slice(0, 47).trimEnd()}…` : name;
}

/** Objetivo en una frase: la primera frase con contenido, recortada. */
function goalOf(text: string): string {
  const first = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).find((s) => s.trim().length > 3) ?? text.trim();
  return first.length > 220 ? `${first.slice(0, 219).trimEnd()}…` : first.trim();
}

export function buildBrief(input: { text: string; name?: string; mode: ProjectMode; quickAction?: string; attachments?: Attachment[]; preferredModel?: string; now?: Date }): ProjectBrief {
  const text = input.text.trim();
  return {
    name: input.name?.trim() || suggestName(text),
    mode: input.mode,
    goal: goalOf(text),
    userInput: text,
    references: extractUrls(text),
    attachments: input.attachments ?? [],
    constraints: extractConstraints(text),
    inferredType: input.mode === "innovation" ? "investigar" : input.mode === "rebuild" ? "replicar-programa" : inferProjectType(text, input.quickAction),
    ...(input.quickAction ? { quickAction: input.quickAction } : {}),
    ...(input.preferredModel ? { preferredModel: input.preferredModel } : {}),
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

function attachmentLines(brief: ProjectBrief): string[] {
  if (!brief.attachments.length) return [];
  const lines = ["MATERIAL ADJUNTO:"];
  for (const a of brief.attachments) {
    if (a.kind === "documento" && a.text) lines.push(`--- ${a.name} ---\n${a.text.slice(0, 6000)}`);
    else lines.push(`- ${a.name} (${a.kind}${a.kind === "imagen" ? ": tenlo en cuenta como referencia visual" : ""})`);
  }
  return lines;
}

/** Mensaje con el que arranca la construcción en el chat. El modelo NO va aquí: lo decide WILLY (o el dueño aparte). */
export function briefToPrompt(brief: ProjectBrief): string {
  const common = [
    `LO QUE HA PEDIDO EL DUEÑO (tal cual):\n${brief.userInput || "(sin texto)"}`,
    ...(brief.references.length ? [`REFERENCIAS: ${brief.references.join(" · ")}`] : []),
    ...(brief.constraints.length ? [`CONDICIONES QUE HA PUESTO: ${brief.constraints.join(" · ")}`] : []),
    ...attachmentLines(brief),
  ];
  if (brief.mode === "innovation") {
    return [
      `PROYECTO INNOVADOR · I+D: «${brief.name}».`,
      ...common,
      "ANTES DE PROGRAMAR NADA, sigue este orden y enséñame cada paso:",
      "1. ENTENDER: qué se quiere conseguir, para quién, qué problema resuelve, sus restricciones, qué sería un resultado excelente y qué afirmaciones son solo hipótesis.",
      "2. QUÉ EXISTE: productos, software, proyectos de código abierto y tecnologías relacionadas. Clasifícalos en: ya existe · existe parcialmente · existe pero resuelve otra cosa · existe con limitaciones · no encontrado en las búsquedas realizadas. Nunca digas «esto no existe» porque no lo hayas encontrado: di «no he encontrado una solución equivalente tras las búsquedas realizadas en estas fuentes y con estos criterios».",
      "3. HUECOS Y OPORTUNIDADES: funciones ausentes, costes, complejidad, dependencia de la nube, privacidad, lentitud, falta de automatización, oportunidades local-first y de IA.",
      "4. TRES PROPUESTAS realmente distintas (A, B y C), no variaciones cosméticas.",
      "5. ABOGADO DEL DIABLO: intenta demostrar por qué podría fracasar cada una (¿aporta algo?, ¿ya existe?, ¿es demasiado compleja?, ¿hay una forma más sencilla?, ¿qué supuesto puede ser falso?, ¿qué pasa con 10 y con 100.000 usuarios?).",
      "6. ELECCIÓN EXPLICADA con criterios explícitos (valor, diferenciación, viabilidad, coste, privacidad, mantenimiento, tiempo) y la evidencia de cada uno. Sin puntuaciones inventadas.",
      "7. Solo entonces: arquitectura (con su PLAN TÉCNICO en docs/plan-tecnico.md, empezando en pequeño: un VPS con reverse proxy, frontend, API, worker, PostgreSQL y almacenamiento; nada de Kubernetes, microservicios, Redis, Kafka ni balanceadores hasta que una señal medible lo justifique, pero con el código preparado para crecer; y si usa IA pesada, siempre por una cola y un AI worker para que una generación larga no bloquee la aplicación) y un PRIMER PROTOTIPO REAL (nada de maquetas ni datos falsos), con criterios de éxito medibles definidos antes de mejorarlo.",
      "REGLAS: distingue siempre HECHO (con su fuente y fecha) de INFERENCIA y de PROPUESTA. No inventes competidores, repositorios ni artículos: si no has podido buscarlo, dilo y márcalo como hipótesis. Esto es análisis técnico, no un dictamen sobre patentes. Guarda todo en el archivo docs/innovacion.md del proyecto (dossier de innovación: problema, objetivo, hipótesis, fuentes, lo encontrado, huecos, alternativas descartadas y motivos, arquitectura, pruebas y próximos pasos).",
    ].join("\n\n");
  }
  const visual = needsVisualDirections(brief.inferredType);
  return [
    `Crea el proyecto «${brief.name}».`,
    `OBJETIVO: ${brief.goal || "el que describe el dueño abajo"}`,
    `TIPO (deducido): ${TYPE_LABELS[brief.inferredType] ?? brief.inferredType}`,
    ...common,
    designPromptBlock(brief),
    techPlanPromptBlock(brief),
    visual
      ? "Cuando el dueño haya elegido la dirección visual: planifica (estructura, pantallas, datos y reglas), constrúyelo completo, ábrelo en la vista previa, pruébalo y corrige lo que falle antes de darlo por terminado."
      : "Planifica primero (estructura, pantallas, datos y reglas), después constrúyelo completo, ábrelo en la vista previa, pruébalo y corrige lo que falle antes de darlo por terminado.",
  ].join("\n\n");
}

// ---------------------------------------------------------------- guardado del brief (aparte del proyecto, para no cargarlo)
const BRIEF_PREFIX = "willy-brief:";

export function saveBrief(projectId: string, brief: ProjectBrief): void {
  try {
    window.localStorage.setItem(BRIEF_PREFIX + projectId, JSON.stringify(brief));
  } catch {
    /* sin almacenamiento: el brief sigue en el primer mensaje del chat */
  }
}

export function loadBrief(projectId: string): ProjectBrief | null {
  try {
    const raw = window.localStorage.getItem(BRIEF_PREFIX + projectId);
    return raw ? (JSON.parse(raw) as ProjectBrief) : null;
  } catch {
    return null;
  }
}
