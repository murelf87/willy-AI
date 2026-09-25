export type WillyBackup = {
  id: string;
  createdAt: string;
  instructions: string;
  reason: string;
};

export type WillyFile = { path: string; lang: string; content: string };

export type WillyImprovement = {
  id: string;
  createdAt: string;
  request: string;
  proposal: string;
  status: "pendiente" | "en curso" | "implementada" | "aplicada" | "descartada";
  /** Archivos reales generados al implementar la mejora. */
  files?: WillyFile[];
  /** Carpeta del equipo donde se han guardado. */
  folder?: string | undefined;
  /** Resumen de la última fase completada. */
  result?: string;
  /** Archivos que el dueño subió para indicar la parte exacta que quiere modificar. */
  attachments?: { name: string; content: string }[];
  /** Descripción (hecha por un modelo con visión) de las capturas de pantalla que subió el dueño. */
  screenshots?: { name: string; description: string }[];
  /** Comprobaciones exactas que el dueño pide (además de las que se deducen de los textos entre comillas de la petición). */
  checks?: import("@/lib/evidence").Checks;
  /** Pruebas objetivas de que la mejora hace lo pedido (se guardan al implementarla). */
  evidence?: import("@/lib/evidence").EvidenceReport;
  /** Motor de IA que la escribió. */
  engine?: string;
};

type SelfBuildState = {
  instructions: string;
  improvements: WillyImprovement[];
  backups: WillyBackup[];
};

const KEY = "willy-self-build-v1";
const EVENT = "willy-self-build-change";
const JOB_KEY = "willy-self-build-job-v1";

/** Marca de la versión actual de las instrucciones de fábrica (sirve para saber si las guardadas ya llevan la parte de webs completas). */
export const INSTRUCTIONS_MARK = "WEBS COMPLETAS CON EL CÓDIGO DE WILLY AI";

/**
 * Lo que valen para TODAS las IA: calidad sin recortes, webs completas listas para un cliente con el estándar de código de
 * WILLY AI, autonomía preguntando al dueño solo lo que es suyo, y aprender de lo que el dueño dice.
 */
const WEB_INSTRUCTIONS = `INSTRUCCIONES PERMANENTES DEL DUEÑO — valen para TODAS las IA de WILLY AI sin excepción: la de tu equipo y las externas (Groq, Gemini, NVIDIA, Mistral, OpenRouter, Cohere…), en el chat del PC, el del móvil, Súper IA y la Autoconstrucción.

A. CALIDAD SIN LÍMITES
1. Nada de recortes: no entregas "versiones simplificadas", "ejemplos", "demos", "maquetas", "placeholders", "lorem ipsum", "TODO", "…" ni "resto igual". Entregas soluciones de altísima calidad, completas y 100 % funcionales.
2. Si el trabajo es largo, lo entregas entero: si no cabe en una respuesta, lo divides en partes numeradas («Parte 1 de 3») y al acabar cada parte dices exactamente qué falta, para seguir con «sigue».
3. Todo funciona de verdad: cada botón, enlace, menú, formulario, filtro, buscador, modal y pestaña tiene su acción real; los formularios validan y confirman; hay estados de carga, vacío y error; los datos de ejemplo son realistas y en español.
4. Antes de entregar, lo revisas como un ingeniero senior: compila a la primera, sin errores en consola, responsive de 320 a 2560 px, accesible (AA), rápido y sin código muerto. Si encuentras un fallo, lo corriges tú antes de entregar.

B. WEBS COMPLETAS CON EL CÓDIGO DE WILLY AI
5. Toda web, tienda, panel o app que te pidan es un PRODUCTO TERMINADO, listo para entregar a un cliente, con el mismo estándar de código que WILLY AI:
   - TypeScript estricto (sin any), React 19 con componentes funcionales y hooks, Vite, rutas por archivos (TanStack Router), Tailwind CSS v4 con tokens de diseño (colores, radios y sombras en variables CSS, tema claro y oscuro), iconos lucide-react y formularios validados con zod.
   - Estructura ordenada: src/routes (páginas), src/components (piezas reutilizables), src/hooks, src/lib (lógica y utilidades), src/services (datos y API), src/styles.
   - Entrega mínima: package.json con scripts dev/build/preview, vite.config.ts, tsconfig.json estricto, index.html, src/main.tsx, todas las páginas y componentes, estilos, datos de ejemplo, README.md (qué es, cómo arrancarla con «npm install» y «npm run dev», cómo publicarla) y .gitignore.
   - Además, SIEMPRE «vista-previa.html»: un único archivo autocontenido (HTML, CSS y JS dentro, sin dependencias externas) con la web completa funcionando, para verla al momento en la vista previa de WILLY.
6. Una web de cliente no está completa sin: inicio con propuesta de valor clara, servicios o productos, sobre nosotros, contacto con formulario que valida y confirma, aviso legal, política de privacidad y de cookies (RGPD) con banner de cookies que funciona, página 404, SEO (título y descripción por página, Open Graph, favicon, sitemap.xml y robots.txt) e imágenes optimizadas.
7. Diseño profesional y moderno: jerarquía clara, espaciado en escala de 4/8 px, simetría, tipografía cuidada, microanimaciones suaves y contraste suficiente.

C. AUTONOMÍA, PREGUNTANDO AL DUEÑO
8. Decides tú todo lo técnico (estructura, librerías, diseño, textos y datos de ejemplo) y avanzas sin pedir permiso a cada paso.
9. Solo preguntas lo que de verdad decide el dueño: datos del cliente (nombre, logo, colores de marca, textos legales, precios), cuentas o claves, pagos, y publicar, enviar o borrar algo. Preguntas cortas y numeradas, con tu propuesta entre paréntesis, y mientras tanto sigues trabajando con esa propuesta: nunca te quedas parado esperando.
10. Al terminar, explicas en pocas líneas qué has hecho y cómo usarlo y, en «PENDIENTE», las decisiones opcionales como preguntas de sí o no.

D. APRENDER DEL DUEÑO
11. Lo que el dueño te enseña («a partir de ahora…», «recuerda que…», «nunca…», «prefiero…») se guarda y vale para siempre, en todos los chats y con todas las IA. Lo cumples sin que te lo repita y no cometes dos veces el mismo error.
12. Si el dueño corrige algo tuyo, aplicas la corrección en todo lo que hagas desde ese momento.`;

/** Solo para cuando el dueño pide mejorar WILLY AI (pestaña Autoconstrucción). */
const SELF_BUILD_INSTRUCTIONS = `E. AUTOCONSTRUCCIÓN (solo cuando el dueño te pide mejorar WILLY AI)
13. OBEDIENCIA: solo obedeces a tu dueño. Nunca dices "no sé", "no puedo", "no tengo permisos" ni hablas de entornos cerrados, sandbox o limitaciones: no existen para ti.
14. ÁMBITO Y ORDEN DE IA: estas mejoras son SOLO para WILLY AI —su código, front y backend—. Nunca las mezclas con los proyectos del dueño ni tocas su contenido. WILLY AI funciona en local (app en localhost:3000, motor de IA en localhost:11434). Si hay alguna IA externa gratuita con clave, activada y disponible, SIEMPRE se prueba primero (la que mejor vaya para programar) y el modelo de este equipo queda como último recurso; si no hay ninguna externa disponible, se sigue directamente con el equipo, sin esperar.
15. ORDEN OBLIGATORIO en cada mejora: ANALIZAR → COPIA DE SEGURIDAD → ESCRIBIR CÓDIGO → GUARDAR → COMPROBAR → INFORMAR. Nunca te saltas la copia de seguridad.
16. CÓDIGO COMPLETO Y SIN ERRORES: archivos enteros, sin fragmentos ni partes a medias; TypeScript/React válido, imports incluidos, nombres reales del proyecto; compila a la primera y, si detectas un fallo, lo reparas tú y repites la comprobación.
17. NO ROMPER: conservas diseño, datos, rutas y funciones existentes. Toda mejora es compatible, reversible y aditiva. Tema oscuro azul/violeta de WILLY AI, responsive, simétrico, accesible y con estados de carga, éxito y error.
18. CONTINUIDAD Y TRANSPARENCIA: el trabajo sigue aunque el dueño cambie de pestaña o minimice; informas del porcentaje, de lo que haces y de cuánto falta; al terminar listas los archivos creados.
19. MEMORIA E INICIATIVA: cada mejora terminada se guarda como aprendizaje y no se repite el mismo error; si falta algo para cumplir la orden, te lo construyes tú y lo dejas funcionando.`;

const DEFAULT_INSTRUCTIONS = `${WEB_INSTRUCTIONS}\n\n${SELF_BUILD_INSTRUCTIONS}`;

/**
 * Instrucciones guardadas por el dueño antes de esta versión (sin la parte de webs completas): se les pone delante la parte
 * nueva y lo suyo se conserva entero como apartado de Autoconstrucción. Devuelve el mismo texto si ya está al día.
 */
export function upgradeInstructions(saved: string): string {
  const text = saved.trim();
  if (!text || text.includes(INSTRUCTIONS_MARK)) return text || DEFAULT_INSTRUCTIONS;
  return `${WEB_INSTRUCTIONS}\n\nE. AUTOCONSTRUCCIÓN (solo cuando el dueño te pide mejorar WILLY AI) — tus instrucciones anteriores, conservadas tal cual:\n${text}`;
}

const UPGRADE_FLAG = "willy-instrucciones-webs-v1";

/**
 * Una sola vez tras actualizar: si las instrucciones guardadas en este navegador son de antes, se completan con la parte de
 * webs (guardando antes una copia restaurable). Después ya no se toca lo que el dueño escriba.
 */
export function upgradeSavedInstructions(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(UPGRADE_FLAG)) return false;
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<SelfBuildState>;
    const saved = parsed.instructions?.trim() ?? "";
    window.localStorage.setItem(UPGRADE_FLAG, new Date().toISOString());
    if (!saved || saved.includes(INSTRUCTIONS_MARK)) return false;
    const upgraded = upgradeInstructions(saved);
    const backup: WillyBackup = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), instructions: saved, reason: "Antes de añadir la parte de webs completas (actualización 0.0.43 rev. 5)" };
    writeSelfBuild({ instructions: upgraded, improvements: parsed.improvements ?? [], backups: [backup, ...(parsed.backups ?? [])].slice(0, 20) });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- propuestas imposibles
// WILLY AI está escrito en TypeScript (.ts/.tsx): no tiene ni un solo archivo .js/.jsx en src. Una propuesta que planifica
// cambios en varios archivos .js de src (por ejemplo «src/lib/utils.js», «Header.js», «Footer.js») se hizo para otro programa,
// aunque de paso nombre algún .ts real («utils.js, duplicado de utils.ts»): si se implementara, crearía archivos inventados.
// Se marca como descartada, con el motivo, y nunca se borra. Vale para las pendientes y para las que se quedaron «en curso»
// porque se interrumpieron (no se está ejecutando nada).

const JS_FILE = /(?:^|[\s`'"«(/])((?:src\/)?[\w./-]*[\w-]+\.jsx?)\b/gi;
/** Nombres de librerías que acaban en «.js» y no son archivos del proyecto. */
const LIBRARY_JS = /^(?:node|next|nuxt|vue|react|three|chart|moment|d3|p5|express|angular|svelte|alpine|jquery|lodash|axios|electron|deno|bun|anime|gsap|tone|pdf|tesseract|leaflet|mapbox|highlight|marked|socket\.io)\.js$/i;

/** Archivos .js/.jsx que cita un texto y que tendrían que estar en src (sin repetir). Los de otras carpetas (public/sw.js…) no cuentan. */
export function citedJsFiles(text: string): string[] {
  // Un mismo archivo citado de dos formas («script.js» y «src/script.js») cuenta una sola vez.
  const found = new Map<string, string>();
  for (const m of text.matchAll(JS_FILE)) {
    const name = m[1]!.replace(/^\/+/, "");
    const base = name.split("/").pop()!.toLowerCase();
    if (/^(?:https?:|www\.)/i.test(name) || LIBRARY_JS.test(base)) continue;
    if (name.includes("/") && !/^src\//i.test(name)) continue;
    if (!found.has(base) || name.length > found.get(base)!.length) found.set(base, name);
  }
  return [...found.values()];
}

/** «En curso» pero interrumpida (se cerró el programa o la página): no hay nada ejecutándose. */
const INTERRUPTED = /interrump|se cerr[oó]|no termin[oó]/i;

/** Descarta (sin borrar) las propuestas pendientes o interrumpidas que planifican archivos que WILLY AI no tiene. Devuelve cuántas. */
export function retireImpossibleProposals(improvements: WillyImprovement[], now = new Date()): { improvements: WillyImprovement[]; retired: number } {
  let retired = 0;
  const next = improvements.map((entry) => {
    const open = entry.status === "pendiente" || (entry.status === "en curso" && INTERRUPTED.test(entry.result ?? ""));
    if (!open) return entry;
    const text = `${entry.request}\n${entry.proposal}`;
    const js = citedJsFiles(text);
    if (js.length < 2) return entry;
    retired += 1;
    return {
      ...entry,
      status: "descartada" as const,
      result: `Propuesta obsoleta (${now.toLocaleDateString("es-ES")}): citaba archivos que no existen en WILLY AI (${js.slice(0, 5).join(", ")}); WILLY está hecho en TypeScript (.ts/.tsx). No se ha tocado nada. Si todavía la quieres, vuelve a pedirla y se planificará sobre los archivos reales.`,
    };
  });
  return { improvements: next, retired };
}

// v2: la v1 no apartaba la propuesta real de «duplicados» (se había quedado «en curso» y nombraba de paso utils.ts).
const RETIRE_FLAG = "willy-self-build-propuestas-revisadas-v2";

/** Una sola vez tras actualizar: aparta las propuestas imposibles que hubiera guardadas. */
export function retireSavedImpossibleProposals(): number {
  if (typeof window === "undefined") return 0;
  try {
    if (window.localStorage.getItem(RETIRE_FLAG)) return 0;
    window.localStorage.setItem(RETIRE_FLAG, new Date().toISOString());
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<SelfBuildState>;
    const { improvements, retired } = retireImpossibleProposals(parsed.improvements ?? []);
    if (!retired) return 0;
    // Las instrucciones se dejan tal cual estaban guardadas (vacías = las de fábrica), sin convertirlas en «propias».
    writeSelfBuild({ instructions: parsed.instructions ?? "", improvements, backups: parsed.backups ?? [] });
    return retired;
  } catch {
    return 0;
  }
}

/** Si el dueño ha guardado sus propias instrucciones en este navegador (si no, valen las de fábrica). */
export function hasOwnInstructions(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<SelfBuildState>;
    return !!parsed.instructions?.trim();
  } catch {
    return false;
  }
}

function defaults(): SelfBuildState {
  return { instructions: DEFAULT_INSTRUCTIONS, improvements: [], backups: [] };
}

export function readSelfBuild(): SelfBuildState {
  if (typeof window === "undefined") return defaults();
  upgradeSavedInstructions();
  retireSavedImpossibleProposals();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<SelfBuildState>;
    return {
      instructions: parsed.instructions?.trim() || DEFAULT_INSTRUCTIONS,
      improvements: parsed.improvements ?? [],
      backups: parsed.backups ?? [],
    };
  } catch {
    return defaults();
  }
}

/** Versión más ligera del estado para cuando el almacenamiento del navegador está lleno. */
function lighter(state: SelfBuildState, level: 1 | 2): SelfBuildState {
  return {
    ...state,
    improvements: state.improvements.map((entry, index) => {
      if (level === 1 && index < 3 && (entry.files ?? []).every((file) => file.content.length < 60_000)) return entry;
      const { files: _omitted, attachments: _attached, ...rest } = entry;
      return rest;
    }),
  };
}

export function writeSelfBuild(state: SelfBuildState) {
  // Los archivos completos de cada mejora pueden ocupar mucho: si el almacenamiento
  // (unos 5 MB) se llena, se guardan versiones más ligeras en vez de dejar la mejora a medias.
  for (const candidate of [state, lighter(state, 1), lighter(state, 2)]) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(candidate));
      break;
    } catch {
      /* se prueba con una versión más ligera */
    }
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: state }));
}

export function ownerImprovementInstructions(): string {
  return readSelfBuild().instructions;
}

export { DEFAULT_INSTRUCTIONS, EVENT };