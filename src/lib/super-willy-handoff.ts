// CHAT → SUPER WILLY (rediseño, puntos 1-3 y fase 11). El Chat es para conversar (también de programación: explicar,
// ejemplos, errores); cuando lo que pides es CONSTRUIR o CAMBIAR un proyecto («créame una web», «arregla mi app»,
// «desarróllalo»), es una PROJECT ACTION: el Chat ofrece «Abrir en SUPER WILLY» y le pasa SOLO lo necesario (la petición, sus
// adjuntos, sus enlaces y, si dices «desarróllalo», tu mensaje anterior). SUPER WILLY sigue desde la entrevista del proyecto.

import { projectRequest } from "@/lib/project-discovery";
import { openView } from "@/lib/background-tasks";

export type ProjectAction = "nuevo" | "cambio" | "continuar";

const norm = (text: string): string => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

/** Preguntas y explicaciones: se contestan en el Chat aunque hablen de webs o de apps. */
// («¿Me haces una web?» sí es un encargo: lo que cuenta es la palabra con la que se pregunta, no el «¿».)
const QUESTION = /^[¿?]?\s*(?:por favor,? )?(?:explica(?:me)?|que (?:es|son|significa|diferencia|opinas|te parece)|cual(?:es)? (?:es|son)|como (?:se|puedo|podria|hago|creo|funciona|harias|seria|empiezo)|por que|para que (?:sirve|se usa)|ponme un ejemplo|dame un ejemplo|ejemplo de|diferencia entre|recomiendame|que me recomiendas|que arquitectura|que tecnologia|cuanto (?:cuesta|costaria|tarda|tardaria))/;
const PRODUCT = "(?:web|pagina web|sitio web|sitio|landing(?: page)?|app|aplicacion|aplicaciones|programa|software|plataforma|tienda(?: online)?|proyecto|panel|dashboard|crm|erp|intranet|portal|juego|extension|bot|api|backend|frontend)";
const CHANGE = new RegExp(
  `\\b(?:modifica(?:la|lo|r)?|cambia(?:la|lo|r)?|arregla(?:la|lo|r)?|repara(?:la|lo|r)?|mejora(?:la|lo|r)?|actualiza(?:la|lo|r)?|amplia(?:la|lo|r)?|anade(?:le)?|agrega(?:le)?|quita(?:le)?|corrige(?:la|lo)?|redisena(?:la|lo)?|optimiza(?:la|lo)?|termina(?:la|lo)?|continua|sigue con|rehaz(?:la|lo)?)\\b[^.?!\\n]{0,70}?\\b(?:mi|mis|nuestra|nuestro|la|el|esta|este|esa|ese|su|tu)\\s+${PRODUCT}\\b`,
);
/** Encargos dichos con educación: «¿me haces una web…?», «¿podrías crearme una app…?». */
const POLITE = new RegExp(
  `\\b(?:(?:me|nos)\\s+(?:haces|harias|creas|crearias|construyes|construirias|montas|montarias|programas|programarias|desarrollas|desarrollarias|disenas|disenarias)|(?:puedes|podrias|podeis|podriais)\\s+(?:hacer|crear|construir|montar|programar|desarrollar|disenar)(?:me|nos)?)\\s+(?:una?|unos|unas)\\s+(?:[a-z]+\\s+){0,2}?${PRODUCT}\\b`,
);
const CONTINUE = /^(?:vale,? |venga,? |ok,? |pues |ahora |entonces |perfecto,? )?(?:desarr?ollal[oa]|desarr?olla (?:esto|eso|la idea|lo que te he dicho)|construyel[oa]|construye (?:esto|eso|la idea)|programal[oa]|programa (?:esto|eso)|implemental[oa]|implementa (?:esto|eso)|crealo|creala|crea (?:esto|eso)|hazme(?:lo|la) (?:de verdad|ya)|montal[oa]|monta (?:esto|eso))\b/;

/** ¿Es una PROJECT ACTION? «nuevo» = crear algo nuevo; «cambio» = tocar un proyecto que ya existe; «continuar» = «desarróllalo». */
export function projectActionOf(text: string): ProjectAction | null {
  const t = norm(text);
  if (!t || QUESTION.test(t)) return null;
  if (CONTINUE.test(t)) return "continuar";
  if (projectRequest(text) === "nuevo" || POLITE.test(t)) return "nuevo";
  if (CHANGE.test(t)) return "cambio";
  return null;
}

/** Los enlaces que hay en un texto (sin repetir). */
export function urlsOf(text: string): string[] {
  const found = text.match(/\bhttps?:\/\/[^\s<>"'«»)]+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"'«»)]*/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?]+$/, "")))];
}

export type HandoffAttachment = { name: string; text: string };
export type Handoff = {
  id: string;
  /** Lo que hay que hacer (tu petición; con «desarróllalo», tu mensaje anterior). */
  text: string;
  /** Tipo de encargo: los del Chat (PROJECT ACTION) o un proyecto recién creado con «Nuevo proyecto». */
  action: ProjectAction | "crear";
  attachments: HandoffAttachment[];
  /** Imágenes (capturas, fotos): SUPER WILLY las describe con un modelo con visión al usarlas. */
  images: File[];
  urls: string[];
  from: "chat" | "nuevo-proyecto" | "proyectos";
  /** Proyecto que ya existe y hay que abrir (el de «Nuevo proyecto»). */
  projectId?: string;
  /** Empezar a trabajar en cuanto se abra (un proyecto recién creado con su encargo completo). */
  autoRun?: boolean;
  /** Modelo de tu equipo elegido a mano al crear el proyecto (si no, SUPER WILLY elige). */
  model?: string;
  /** Rev23: «Analizar proyecto» (Proyectos): WILLY revisa sus archivos y hace su plan, SIN cambiar nada. */
  analysis?: boolean;
  at: number;
};

/** SUPER WILLY recibe un encargo (desde el Chat o desde «Nuevo proyecto»). */
export const HANDOFF_EVENT = "willy:encargo-super-willy";
let pending: Handoff | null = null;

/** Pasa un encargo a SUPER WILLY y la abre (aunque aún no se haya abierto nunca: lo recoge al abrirse). */
export function sendToSuperWilly(input: Omit<Handoff, "id" | "at">): Handoff {
  const handoff: Handoff = { ...input, id: `enc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now() };
  pending = handoff;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<Handoff>(HANDOFF_EVENT, { detail: handoff }));
    openView("superia");
  }
  return handoff;
}

/** El encargo que aún no se ha recogido (se consume al leerlo). */
export function takeHandoff(): Handoff | null {
  const h = pending;
  pending = null;
  return h;
}

/**
 * El proyecto que nombra un texto («cambia el menú de la Web de la peluquería»). Si nombra a dos a la vez, ninguno: mejor
 * preguntar que tocar el que no era.
 */
export function mentionedProject<T extends { id: string; name: string }>(text: string, projects: T[]): T | null {
  const t = ` ${norm(text).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const hits = projects
    .map((p) => ({ p, name: norm(p.name).replace(/[^\p{L}\p{N}]+/gu, " ").trim() }))
    .filter(({ name }) => name.length >= 4 && t.includes(` ${name} `))
    .sort((x, y) => y.name.length - x.name.length);
  if (!hits.length) return null;
  const best = hits[0]!;
  // Otro distinto que también aparece y NO está dentro del nombre elegido → ambiguo.
  if (hits.some((h) => h.p.id !== best.p.id && !best.name.includes(h.name))) return null;
  return best.p;
}

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Notas para la entrevista con el material que acompaña al encargo (adjuntos y enlaces). */
export function handoffNotes(h: Pick<Handoff, "attachments" | "urls">): string[] {
  return [
    ...h.attachments.map((a) => (a.text.trim() ? `Adjunto «${a.name}»: ${cut(a.text.trim().replace(/\s+/g, " "), 3000)}` : `Adjunto «${a.name}» (sin texto que leer)`)),
    ...(h.urls.length ? [`Enlaces aportados: ${h.urls.join(" · ")}`] : []),
  ];
}

/** El material del encargo como contexto para ejecutar la petición (cambios en un proyecto, peticiones sueltas). */
export function handoffContext(h: Pick<Handoff, "attachments" | "urls">): string {
  const notes = handoffNotes(h);
  return notes.length ? `MATERIAL QUE HA TRAÍDO EL DUEÑO DESDE EL CHAT:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
}
