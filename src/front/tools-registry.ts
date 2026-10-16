// REGISTRO DE HERRAMIENTAS del Tool Center (diseño de 24/09). Solo describe lo que EXISTE en WILLY y a dónde lleva cada
// cosa; no inventa funciones: lo que no existe se declara «no disponible» (y se enseña así, sin fingir), y lo que está
// en camino, «pendiente». Fuentes: pantallas de «WILLY AI», Mi yo en IA y voces de «AVATAR AI»
// (claude/avatar-ai-capacidades-para-front.md) y las fuentes de datos en tiempo real (lib/data-catalog.ts).
import {
  BookOpen, Bot, Cloud, Code2, Database, FileSearch, FileText, Gauge, Github, Globe, Headphones, Image as ImageIcon, KeyRound, Languages,
  Mic, Palette, PenLine, Presentation, Puzzle, Scale, ScanText, Search, Sparkles, Subtitles, UserRound, Video, Volume2, Wand2, Zap, Clapperboard, AudioLines,
  type LucideIcon,
} from "lucide-react";
import { CATALOG } from "@/lib/data-catalog";

export type ToolCategoryId = "documentos" | "traduccion" | "imagen" | "video" | "audio" | "creacion" | "datos" | "desarrollo" | "automatizacion" | "roles";

export type ToolCategory = { id: ToolCategoryId; name: string; short: string; desc: string; icon: LucideIcon };

export const CATEGORIES: ToolCategory[] = [
  { id: "documentos", name: "Documentos y texto", short: "Documentos", desc: "OCR, PDF, lectura, resumen, análisis", icon: FileText },
  { id: "traduccion", name: "Traducción", short: "Traducción", desc: "Texto, documentos, vídeo y subtítulos", icon: Languages },
  { id: "imagen", name: "Imagen", short: "Imagen", desc: "Análisis de imágenes (generación y edición, todavía no)", icon: ImageIcon },
  { id: "video", name: "Vídeo", short: "Vídeo", desc: "Vídeo con tu cara y tu voz, doblaje y subtítulos de YouTube", icon: Video },
  { id: "audio", name: "Audio y voz", short: "Audio", desc: "Lectura en voz alta, voces naturales, dictado", icon: Headphones },
  { id: "creacion", name: "Creación IA", short: "Creación IA", desc: "Mi yo en IA, escribir como tú, libros", icon: Sparkles },
  { id: "datos", name: "Datos y web", short: "Datos y web", desc: "Tiempo, divisas, criptomonedas, búsqueda en internet…", icon: Database },
  { id: "desarrollo", name: "Desarrollo", short: "Desarrollo", desc: "GitHub, proyectos, réplicas, demos e instaladores", icon: Code2 },
  { id: "automatizacion", name: "Automatización", short: "Automatización", desc: "Tus propias herramientas sin programar", icon: Zap },
  { id: "roles", name: "Roles de equipo", short: "Roles", desc: "Revisar producto, diseño, código, pruebas y versiones con un encargo ya preparado", icon: Puzzle },
];

export type ToolAvailability = "disponible" | "pendiente" | "no-disponible";

/** A dónde lleva la herramienta. Todas las acciones existen ya en WILLY; aquí solo se enlazan. */
export type ToolAction =
  | { kind: "view"; view: string; tab?: string; /** Para pantallas con pestaña guardada en el navegador (Mi yo en IA). */ draftKey?: string }
  | { kind: "chat"; text: string; autoSend?: boolean }
  | { kind: "nuevo-proyecto" }
  | { kind: "fuentes-datos" };

export type Tool = {
  id: string;
  name: string;
  desc: string;
  categories: ToolCategoryId[];
  icon: LucideIcon;
  availability: ToolAvailability;
  /** Por qué no está disponible o qué falta (se enseña tal cual). */
  note?: string;
  action?: ToolAction;
  /** Quién lleva la función (para pedir cambios a la conversación correcta). */
  owner: "WILLY AI" | "AVATAR AI";
};

const dataSourceTools: Tool[] = CATALOG.map((c) => ({
  id: `dato-${c.id}`,
  name: c.name.replace(/\s*\(.*\)$/, ""),
  desc: c.summary,
  categories: ["datos"],
  icon: Globe,
  availability: "disponible",
  action: { kind: "chat", text: c.examples[0] ?? c.name, autoSend: false },
  owner: "WILLY AI",
}));

const BASE_TOOLS: Tool[] = [
  // ── Documentos y texto
  { id: "juridico", name: "Análisis Jurídico", desc: "Analiza expedientes, contratos y leyes; redacta escritos y recursos con legislación española y europea", categories: ["documentos"], icon: Scale, availability: "disponible", action: { kind: "view", view: "juridico" }, owner: "WILLY AI" },
  { id: "ocr", name: "OCR", desc: "Extrae texto de imágenes, escaneos y PDFs escaneados, en tu equipo", categories: ["documentos"], icon: ScanText, availability: "disponible", action: { kind: "view", view: "ocr" }, owner: "WILLY AI" },
  { id: "lectura", name: "Lectura", desc: "Lee y resume documentos (PDF, Word, LibreOffice, PowerPoint, Excel) en voz alta", categories: ["documentos", "audio"], icon: BookOpen, availability: "disponible", action: { kind: "view", view: "lectura" }, owner: "WILLY AI" },
  { id: "resumir", name: "Resumir un texto", desc: "Pega un texto o adjunta un documento en el Chat y WILLY lo resume", categories: ["documentos"], icon: FileSearch, availability: "disponible", action: { kind: "chat", text: "Resume este texto en pocos puntos claros:\n\n" }, owner: "WILLY AI" },
  { id: "analizar-documento", name: "Analizar un documento", desc: "Adjunta el documento en el Chat y pregúntale lo que quieras", categories: ["documentos"], icon: FileText, availability: "disponible", action: { kind: "chat", text: "Analiza el documento adjunto y dime lo más importante." }, owner: "WILLY AI" },
  // ── Traducción
  { id: "traducir", name: "Traducir", desc: "Textos y documentos largos, por partes, sin cortes", categories: ["traduccion"], icon: Languages, availability: "disponible", action: { kind: "view", view: "traducir" }, owner: "WILLY AI" },
  { id: "traducir-video", name: "Traducir un vídeo de YouTube", desc: "Subtítulos reales traducidos y narrados en sincronía con el vídeo", categories: ["traduccion", "video"], icon: Subtitles, availability: "disponible", action: { kind: "view", view: "traducir" }, owner: "WILLY AI" },
  // ── Imagen
  { id: "analizar-imagen", name: "Analizar una imagen", desc: "Adjunta fotos o capturas en el Chat: un modelo con visión las describe", categories: ["imagen"], icon: ImageIcon, availability: "disponible", action: { kind: "chat", text: "Describe esta imagen con detalle y dime qué ves." }, owner: "WILLY AI" },
  { id: "generar-imagen", name: "Generar imágenes", desc: "Imágenes a partir de texto (FLUX/SDXL)", categories: ["imagen", "creacion"], icon: Wand2, availability: "no-disponible", note: "La pantalla ya existe en «Crea tu avatar IA», pero sigue sin funcionar aquí: no hay ningún modelo de imagen (FLUX/SDXL) ni flujo de ComfyUI instalado todavía.", owner: "AVATAR AI" },
  { id: "editar-imagen", name: "Editar y mejorar imágenes", desc: "Edición, mejora de resolución", categories: ["imagen"], icon: ImageIcon, availability: "no-disponible", note: "Todavía no existe.", owner: "AVATAR AI" },
  // ── Vídeo
  { id: "video-avatar", name: "Vídeo con tu cara y tu voz", desc: "Tu foto habla con tu voz: movimiento y labios en tu equipo (Mi yo en IA)", categories: ["video", "creacion"], icon: Clapperboard, availability: "disponible", action: { kind: "view", view: "avatar", tab: "video", draftKey: "avatar:pestana" }, owner: "AVATAR AI" },
  { id: "generar-video", name: "Generar vídeo", desc: "Vídeo a partir de texto", categories: ["video"], icon: Video, availability: "no-disponible", note: "Todavía no existe y no cabe en 6 GB de memoria gráfica (AVATAR AI, 24/09).", owner: "AVATAR AI" },
  { id: "doblaje", name: "Doblar vídeos", desc: "Sube un vídeo, transcríbelo, tradúcelo y genera una versión doblada con tu voz o la voz de WILLY", categories: ["video", "audio"], icon: AudioLines, availability: "disponible", action: { kind: "view", view: "doblaje" }, owner: "AVATAR AI" },
  // ── Audio y voz
  { id: "leer-voz-alta", name: "Leer en voz alta", desc: "Cualquier texto con voces naturales de España (nunca la voz de Windows)", categories: ["audio"], icon: Volume2, availability: "disponible", action: { kind: "view", view: "lectura" }, owner: "AVATAR AI" },
  { id: "voces", name: "Voces", desc: "Elige y prueba voces naturales: Gemini, Chatterbox (en tu equipo), ElevenLabs y Google Chirp 3 HD", categories: ["audio"], icon: Headphones, availability: "disponible", action: { kind: "view", view: "lectura" }, owner: "AVATAR AI" },
  { id: "dictado", name: "Dictado por voz", desc: "Habla en vez de escribir, en el Chat y en Inicio", categories: ["audio"], icon: Mic, availability: "disponible", action: { kind: "view", view: "chat" }, owner: "WILLY AI" },
  { id: "transcribir", name: "Transcribir audio o vídeo", desc: "Texto y subtítulos (.srt) de un audio o un vídeo, en tu equipo (Whisper)", categories: ["audio", "video"], icon: AudioLines, availability: "disponible", action: { kind: "view", view: "transcribir" }, owner: "AVATAR AI" },
  { id: "mi-voz", name: "Mi voz", desc: "Graba 10–20 segundos y WILLY lee con tu propia voz (Chatterbox, en tu equipo)", categories: ["audio", "creacion"], icon: UserRound, availability: "disponible", action: { kind: "view", view: "lectura" }, owner: "AVATAR AI" },
  // ── Creación IA
  { id: "mi-yo-ia", name: "Mi yo en IA", desc: "Tu perfil, escribir como tú y vídeos con tu cara y tu voz", categories: ["creacion"], icon: Bot, availability: "disponible", action: { kind: "view", view: "avatar", tab: "perfil", draftKey: "avatar:pestana" }, owner: "AVATAR AI" },
  { id: "crea-tu-avatar-ia", name: "Crea tu avatar IA", desc: "Genera la imagen de tu personaje a partir de una descripción de escena (necesita un flujo de imagen en ComfyUI: no viene instalado)", categories: ["creacion", "imagen"], icon: Wand2, availability: "disponible", action: { kind: "view", view: "personaje" }, owner: "AVATAR AI" },
  { id: "escribir-como-tu", name: "Escribir como tú", desc: "Textos con tu estilo, a partir de tu perfil", categories: ["creacion"], icon: PenLine, availability: "disponible", action: { kind: "view", view: "avatar", tab: "escribir", draftKey: "avatar:pestana" }, owner: "AVATAR AI" },
  { id: "libros", name: "Escribir un libro", desc: "Esquema, capítulos, portada y maquetación lista para publicar", categories: ["creacion", "documentos"], icon: BookOpen, availability: "disponible", action: { kind: "view", view: "libros" }, owner: "WILLY AI" },
  { id: "influencer", name: "IA Influencer", desc: "Guion, voz, vídeo con tu cara y montaje final: flujo completo de 4 pasos", categories: ["creacion", "video"], icon: UserRound, availability: "disponible", action: { kind: "view", view: "influencer" }, owner: "AVATAR AI" },
  { id: "creative-studio", name: "Creative Studio", desc: "Campañas y contenido para redes", categories: ["creacion"], icon: Sparkles, availability: "no-disponible", note: "Todavía no existe. Pendiente de definir con el dueño.", owner: "AVATAR AI" },
  // ── Datos y web
  { id: "fuentes-datos", name: "Fuentes de datos en tiempo real", desc: `${CATALOG.length} fuentes gratuitas y sin clave que tu IA consulta desde el Chat`, categories: ["datos"], icon: Database, availability: "disponible", action: { kind: "fuentes-datos" }, owner: "WILLY AI" },
  { id: "buscar-internet", name: "Buscar en internet", desc: "WILLY busca, lee las mejores páginas y responde citando las fuentes", categories: ["datos"], icon: Search, availability: "disponible", action: { kind: "chat", text: "Busca en internet: " }, owner: "WILLY AI" },
  { id: "test-velocidad", name: "Test de velocidad Pro", desc: "Velocímetro profesional: descarga, subida, ping, jitter, pérdida, estabilidad e historial", categories: ["datos"], icon: Gauge, availability: "disponible", action: { kind: "view", view: "velocidad" }, owner: "WILLY AI" },
  ...dataSourceTools,
  // ── Desarrollo
  { id: "open-codesign", name: "Diseño IA · Open CoDesign", desc: "Chat de diseño con vista previa en vivo, edición tocando elementos y Ollama local gratis", categories: ["desarrollo", "creacion"], icon: Palette, availability: "disponible", action: { kind: "view", view: "diseno" }, owner: "WILLY AI" },
  { id: "nuevo-proyecto", name: "Nuevo proyecto", desc: "Crea una web, app o programa con Súper IA (entrevista, plan y construcción)", categories: ["desarrollo"], icon: Sparkles, availability: "disponible", action: { kind: "nuevo-proyecto" }, owner: "WILLY AI" },
  { id: "replicar", name: "Replicar aplicación o programa", desc: "Versión propia de una aplicación existente, con instalador de Windows", categories: ["desarrollo"], icon: Wand2, availability: "disponible", action: { kind: "nuevo-proyecto" }, owner: "WILLY AI" },
  { id: "github", name: "GitHub", desc: "Sube y sincroniza tus proyectos con tu cuenta", categories: ["desarrollo"], icon: Github, availability: "disponible", action: { kind: "view", view: "github" }, owner: "WILLY AI" },
  { id: "demo", name: "Demo para cliente", desc: "Un único archivo con lo construido y su avance", categories: ["desarrollo"], icon: Presentation, availability: "disponible", action: { kind: "view", view: "demo" }, owner: "WILLY AI" },
  { id: "instaladores", name: "Acceso directo e instaladores", desc: "WILLY en el escritorio, en el móvil y en el iPhone", categories: ["desarrollo"], icon: Zap, availability: "disponible", action: { kind: "view", view: "instalacion" }, owner: "WILLY AI" },
  { id: "licencias", name: "Licencias", desc: "Clientes, cuotas y panel del propietario", categories: ["desarrollo"], icon: KeyRound, availability: "disponible", action: { kind: "view", view: "licencias" }, owner: "WILLY AI" },
  // ── Automatización
  { id: "nuevas-funciones", name: "Tus propias herramientas", desc: "Añade funciones nuevas sin programar: quedan guardadas con su nombre", categories: ["automatizacion"], icon: Puzzle, availability: "disponible", action: { kind: "view", view: "extras" }, owner: "WILLY AI" },
  { id: "ia-externa", name: "IA externa gratuita", desc: "Claves y estado de Gemini, Groq, OpenRouter, Mistral, Cohere y NVIDIA", categories: ["automatizacion"], icon: Cloud, availability: "disponible", action: { kind: "view", view: "inteligencia", tab: "externas" }, owner: "WILLY AI" },
];

// Roles de equipo: cada uno deja escrito en el Chat un encargo listo para completar (no se envía solo).
// Texto propio de WILLY, escrito para este proyecto: no es una copia de otra herramienta.
const roleTool = (id: string, name: string, desc: string, icon: LucideIcon, text: string): Tool => ({
  id, name, desc, categories: ["roles"], icon, availability: "disponible", action: { kind: "chat", text, autoSend: false }, owner: "WILLY AI",
});

const ROLE_TOOLS: Tool[] = [
  roleTool("rol-producto", "Revisar un producto", "Qué problema resuelve, para quién, qué dejar fuera y cómo saber si funciona.", Gauge,
    "Actúa como responsable de producto. Antes de construir nada, responde:\n1. ¿Qué problema concreto resuelve y para quién?\n2. ¿Qué pasa si no lo hacemos?\n3. ¿Qué dejamos fuera en esta versión?\n4. ¿Cómo sabremos que funciona? Indica una métrica observable.\nDescribe la idea aquí:\n\n"),
  roleTool("rol-diseno", "Revisar un diseño", "Recorridos, estados vacíos y de error, accesibilidad y uso en móvil.", Palette,
    "Actúa como revisor de diseño. Revisa esta pantalla o flujo y dime:\n1. Si el recorrido se entiende sin explicación.\n2. Qué estados faltan (vacío, cargando, error, sin permisos).\n3. Problemas de accesibilidad (contraste, teclado, lectores de pantalla).\n4. Cómo se ve y se usa en un móvil de 360 px.\nDescribe o pega la pantalla:\n\n"),
  roleTool("rol-tecnico", "Revisar el código", "Fallos posibles, seguridad, rendimiento y pruebas que faltan.", Code2,
    "Actúa como revisor técnico. Revisa el cambio siguiente y busca:\n1. Errores de lógica y casos límite.\n2. Problemas de seguridad (datos de entrada, secretos, permisos).\n3. Costes de rendimiento evitables.\n4. Pruebas que faltan.\nIndica archivo y línea cuando puedas. Separa lo que has comprobado de lo que solo sospechas.\nCódigo o cambio a revisar:\n\n"),
  roleTool("rol-qa", "Plan de pruebas", "Casos normales, errores y comprobación en distintos dispositivos.", Puzzle,
    "Actúa como responsable de QA. Escribe un plan de pruebas para la función siguiente con: pasos, resultado esperado, caso de error y dispositivo. Cubre teclado, móvil y escritorio. No des por probado nada que no hayas ejecutado.\nFunción a probar:\n\n"),
  roleTool("rol-version", "Preparar una versión", "Lista de comprobaciones antes de publicar y plan para deshacer.", Zap,
    "Actúa como responsable de publicar versiones. Prepara la lista de comprobaciones antes de publicar esta versión: pruebas que deben pasar, cambios que requieren aviso al usuario, migraciones de datos y cómo volver atrás si falla. Versión y cambios:\n\n"),
  roleTool("rol-fallo", "Investigar un fallo", "Reproducirlo, aislar la causa, probar una hipótesis y verificar la corrección.", Search,
    "Investiga este fallo en orden: 1) pasos para reproducirlo, 2) qué cambió desde la última vez que funcionaba, 3) hipótesis ordenadas por probabilidad, 4) prueba que confirma o descarta cada una, 5) corrección y comprobación. Fallo, mensaje de error y entorno:\n\n"),
  roleTool("rol-retro", "Retrospectiva", "Qué salió bien, qué no, y tres acciones concretas para la siguiente vez.", Sparkles,
    "Haz una retrospectiva del trabajo siguiente: qué salió bien, qué salió mal, qué lo causó y tres acciones concretas con responsable y plazo. Trabajo realizado:\n\n"),
];

export const TOOLS: Tool[] = [...BASE_TOOLS, ...ROLE_TOOLS];

export const toolById =(id: string): Tool | undefined => TOOLS.find((t) => t.id === id);

export function toolsOf(category: ToolCategoryId): Tool[] {
  return TOOLS.filter((t) => t.categories.includes(category));
}

export function availableCount(category: ToolCategoryId): { available: number; pending: number; missing: number } {
  const list = toolsOf(category);
  return {
    available: list.filter((t) => t.availability === "disponible").length,
    pending: list.filter((t) => t.availability === "pendiente").length,
    missing: list.filter((t) => t.availability === "no-disponible").length,
  };
}

// ── Favoritas y recientes (uso real desde esta pantalla e Inicio), guardados en este equipo.
const FAV_KEY = "willy-front-tools-fav";
const RECENT_KEY = "willy-front-tools-recent";
export const TOOLS_EVENT = "willy:front-tools";

const store = () => (typeof window === "undefined" ? null : window.localStorage);
function readJson<T>(key: string, fallback: T): T {
  try { const raw = store()?.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function writeJson(key: string, value: unknown): void {
  try { store()?.setItem(key, JSON.stringify(value)); } catch { /* sin guardado */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TOOLS_EVENT));
}

export function readFavorites(): string[] { return readJson<string[]>(FAV_KEY, []); }
export function toggleFavorite(id: string): string[] {
  const list = readFavorites();
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  writeJson(FAV_KEY, next);
  return next;
}

export type RecentUse = { id: string; at: number };
export function readRecent(): RecentUse[] { return readJson<RecentUse[]>(RECENT_KEY, []); }
export function recordToolUse(id: string, now = Date.now()): void {
  const list = readRecent().filter((r) => r.id !== id);
  writeJson(RECENT_KEY, [{ id, at: now }, ...list].slice(0, 12));
}
