// ¿ESTÁ DE VERDAD LO QUE LA IA DICE QUE HA HECHO? (25/09/2026)
// En «Mundo jamon» la IA dio por hechas cinco páginas (portada, productos, detalle de producto, contacto y sobre nosotros) y en los
// archivos solo estaba la portada: el progreso decía 47 % y no era verdad. Ahora, cuando la IA da por hecha una PÁGINA (una
// tarea que empieza por «Página», «Pantalla», «Sección» o «Vista»), se busca en los archivos del proyecto: una ruta o un archivo
// de página con su nombre, o una sección con ese id en una web de una sola página. Si no está, la tarea sigue pendiente y se le
// dice al dueño. Solo se comprueban las páginas que se saben buscar; las demás tareas quedan como diga la IA. Lógica pura.

import type { PlanTask, ProjectPlan } from "@/lib/project-progress";

const strip = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const PAGE_TASK = /^\s*(?:pagina|pantalla|seccion|vista)s?\b/;

/** Lo que hay que encontrar para dar por hecha cada página conocida (se mira la primera que encaja: de más a menos concreta). */
const PAGES: ReadonlyArray<{ title: RegExp; words: readonly string[]; home?: boolean }> = [
  { title: /\bdetalle/, words: ["detalle", "detail", "$", ":id", "[id]", "slug"] },
  { title: /\b(?:inicio|portada|home|principal)\b/, words: ["home", "inicio", "portada"], home: true },
  { title: /\bcarrito|\bcesta/, words: ["cart", "carrito", "cesta", "basket"] },
  { title: /\b(?:pago|checkout|caja|finalizar compra)\b/, words: ["checkout", "pago", "payment", "caja"] },
  { title: /\b(?:login|acceso|iniciar sesion|inicio de sesion|registro|autenticacion)\b/, words: ["login", "signin", "sign-in", "auth", "acceso", "registro", "register", "signup"] },
  { title: /\bperfil|\bmi cuenta/, words: ["profile", "perfil", "account", "cuenta"] },
  { title: /\b(?:administracion|admin|backoffice|panel de control|dashboard)\b/, words: ["admin", "dashboard", "backoffice", "panel"] },
  { title: /\bproducto|\bcatalogo|\btienda\b/, words: ["product", "producto", "catalog", "catalogo", "tienda", "shop", "store"] },
  { title: /\btratamientos?\b/, words: ["treatment", "tratamiento", "service", "servicio"] },
  { title: /\bequipo\b|\bprofesionales\b/, words: ["team", "equipo", "staff", "profesional"] },
  { title: /\bcitas?\b|\bpedir cita\b/, words: ["appointment", "cita", "booking", "reserva", "contact", "contacto"] },
  { title: /\bmenu\b|\bcarta\b/, words: ["menu", "carta"] },
  { title: /\btestimonios?\b|\bopiniones\b|\bresenas?\b/, words: ["testimoni", "review", "opinion", "resena"] },
  { title: /\bportfolio\b|\bproyectos\b|\btrabajos\b/, words: ["portfolio", "proyecto", "project", "trabajo", "work"] },
  { title: /\bcursos?\b|\bformacion\b/, words: ["curso", "course", "formacion"] },
  { title: /\beventos?\b|\bagenda\b/, words: ["evento", "event", "agenda", "calendar"] },
  { title: /\bdescargas?\b|\brecursos\b/, words: ["descarga", "download", "recurso", "resource"] },
  { title: /\bcontacto\b/, words: ["contact", "contacto"] },
  { title: /\b(?:nosotros|quienes somos|about)\b/, words: ["about", "nosotros", "quienes"] },
  { title: /\bservicios?\b/, words: ["service", "servicio"] },
  { title: /\b(?:precios?|tarifas?|planes)\b/, words: ["pricing", "precio", "tarifa", "planes", "plans"] },
  { title: /\bgaleria/, words: ["gallery", "galeria"] },
  { title: /\b(?:reservas?|citas?)\b/, words: ["booking", "reserva", "appointment", "cita"] },
  { title: /\b(?:blog|noticias|articulos)\b/, words: ["blog", "noticia", "news", "articulo", "post"] },
  { title: /\b(?:preguntas frecuentes|faq)\b/, words: ["faq", "preguntas"] },
  { title: /\baviso legal\b/, words: ["legal", "aviso"] },
  { title: /\bprivacidad\b/, words: ["privacy", "privacidad"] },
  { title: /\bcookies?\b/, words: ["cookie"] },
  { title: /\b(?:404|no encontrad)/, words: ["404", "notfound", "not-found", "noencontrad"] },
  { title: /\bpedidos?\b/, words: ["order", "pedido"] },
  { title: /\bfavorit/, words: ["favorit", "wishlist"] },
];

/** Rutas, archivos y componentes de página e ids de secciones del proyecto (en minúsculas y sin tildes): lo que se busca. */
export function pageEvidence(files: ReadonlyArray<{ path: string; content: string }>): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const p = strip(f.path.replace(/\\/g, "/"));
    if (/(?:^|\/)(?:routes|pages|views|screens|paginas|vistas|pantallas)\//.test(p) || /\.html?$/.test(p)) out.add(`archivo:${p}`);
    // Un componente que es una página o una sección entera (ContactPage.tsx, ContactoSection.tsx) también cuenta.
    else if (/(?:page|pagina|section|seccion|view|vista|screen|pantalla)\.(?:tsx?|jsx?|vue|svelte)$/.test(p)) out.add(`archivo:${p}`);
    if (!/\.(?:tsx?|jsx?|mjs|vue|svelte|html?)$/i.test(f.path)) continue;
    const c = f.content;
    for (const m of c.matchAll(/\bpath\s*[:=]\s*["'`]([^"'`\n]{0,80})["'`]/g)) out.add(`ruta:${strip(m[1] ?? "")}`);
    for (const m of c.matchAll(/create(?:Lazy)?FileRoute\(\s*["'`]([^"'`\n]{0,80})["'`]/g)) out.add(`ruta:${strip(m[1] ?? "")}`);
    for (const m of c.matchAll(/<Route\b[^>]*\bpath=\{?["'`]([^"'`\n]{0,80})["'`]/g)) out.add(`ruta:${strip(m[1] ?? "")}`);
    for (const m of c.matchAll(/(?:case|===|==|startsWith\()\s*["'`]#?(\/[\w/$:-]{0,60})["'`]/g)) out.add(`ruta:${strip(m[1] ?? "")}`);
    for (const m of c.matchAll(/\b(?:function|const|class)\s+([A-Z][A-Za-z0-9]*(?:Page|Pagina|Section|Seccion|View|Vista|Screen|Pantalla))\b/g)) out.add(`componente:${strip(m[1] ?? "")}`);
    for (const m of c.matchAll(/\bid=["']([A-Za-z][\w-]{2,40})["']/g)) out.add(`id:${strip(m[1] ?? "")}`);
    // Encabezados («Nuestro equipo», «Tratamientos»): con ellos se comprueban páginas que no están en la lista. Los enlaces del menú
    // NO valen: en «Mundo jamon» el menú enlazaba a páginas que no existían.
    for (const m of c.matchAll(/<h[1-3]\b[^>]*>\s*([^<{}\n]{2,60}?)\s*</g)) out.add(`titulo:${strip(m[1] ?? "").replace(/\s+/g, " ")}`);
  }
  return [...out];
}

/** ¿Hay en los archivos una página (o sección) para esta tarea? null si no es una página que se sepa buscar. */
export function pageExists(title: string, evidence: readonly string[]): boolean | null {
  const t = strip(title);
  if (!PAGE_TASK.test(t)) return null;
  const page = PAGES.find((p) => p.title.test(t));
  if (!page) return genericPageExists(t, evidence);
  if (page.home && evidence.some((e) => e === "ruta:/" || e === "ruta:" || /(?:^|\/)(?:index|home|inicio)(?:\.lazy)?\.(?:tsx?|jsx?|html?)$/.test(e))) return true;
  return evidence.some((e) => page.words.some((w) => e.includes(w)));
}

const STOP = new Set(["pagina", "paginas", "pantalla", "seccion", "vista", "de", "del", "la", "el", "los", "las", "con", "para", "y", "e", "un", "una", "sobre", "pedir", "ver", "nuestro", "nuestra", "nuestros", "mi", "mis", "su", "sus"]);
/** Raíz corta de una palabra («tratamientos» → «tratamient»), para que valga en singular, plural y en un nombre de archivo. */
const stem = (w: string): string => w.replace(/(?:es|s)$/, "").replace(/(?:cion|ciones)$/, "ci").slice(0, 9);

/** Una página que no está en la lista («Página de horarios de autobús»): sus palabras clave tienen que aparecer en rutas, archivos, títulos o enlaces. null si no hay nada con que comprobar. */
function genericPageExists(t: string, evidence: readonly string[]): boolean | null {
  const words = t.replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length >= 4 && !STOP.has(w)).map(stem);
  if (!words.length) return null;
  if (!evidence.some((e) => /^(?:ruta|archivo|titulo):/.test(e))) return null;
  return words.some((w) => evidence.some((e) => e.includes(w)));
}

/** Las páginas que pidió el dueño (tareas «Página de…» de la entrevista) que NO están en los archivos: lo primero que falta por hacer. */
export function missingRequestedPages(plan: ProjectPlan | null, files: ReadonlyArray<{ path: string; content: string }>): string[] {
  if (!plan || !files.length) return [];
  const evidence = pageEvidence(files);
  return plan.milestones.flatMap((m) => m.tasks).filter((t) => t.by === "entrevista" && !t.auto && t.status !== "descartada" && pageExists(t.title, evidence) === false).map((t) => t.title);
}

const key = (title: string): string => strip(title).replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Las páginas que la IA da por hechas AHORA (no lo estaban antes) y que no están en los archivos vuelven a pendientes (o «en
 * curso», si ya se habían empezado). Lo marcado por el dueño, por el sistema o lo que ya estaba hecho no se toca.
 */
export function checkDoneClaims(next: ProjectPlan, before: ProjectPlan | null, files: ReadonlyArray<{ path: string; content: string }>): { plan: ProjectPlan; unproven: string[] } {
  const earlier = new Map((before?.milestones ?? []).flatMap((m) => m.tasks).map((t) => [key(t.title), t.status] as const));
  const evidence = pageEvidence(files);
  const unproven: string[] = [];
  const check = (t: PlanTask): PlanTask => {
    if (t.status !== "hecha" || t.auto || (t.by !== "willy" && t.by !== "analisis")) return t;
    const was = earlier.get(key(t.title));
    if (was === "hecha") return t;
    if (pageExists(t.title, evidence) !== false) return t;
    unproven.push(t.title);
    return { ...t, status: was === "en-curso" ? "en-curso" : "pendiente" };
  };
  const plan: ProjectPlan = { ...next, milestones: next.milestones.map((m) => ({ ...m, tasks: m.tasks.map(check) })) };
  return { plan, unproven };
}

/**
 * (25/09/2026) Pistas para que la IA vea los archivos de la página de la que habla el dueño: «en la portada, cambia el botón…»
 * → «HomePage.tsx». Devuelve los nombres de archivo del proyecto que corresponden a las páginas nombradas en la petición (se
 * añaden a la petición al elegir qué archivos enseñar; sin esto, «portada» no encontraba «HomePage.tsx» y la IA no lo veía).
 */
export function requestFileHints(text: string, files: ReadonlyArray<{ path: string }>): string {
  // Lo que va entre comillas es contenido («Reserva tu clase gratis»), no el nombre de una página: no cuenta.
  const t = strip(text.replace(/[«“"][^»”"\n]{1,160}[»”"]/g, " "));
  const names = new Set<string>();
  for (const page of PAGES) {
    if (!page.title.test(t)) continue;
    for (const f of files) {
      const p = strip(f.path.replace(/\\/g, "/"));
      const base = p.split("/").pop() ?? p;
      const hit = page.home ? /^(?:index|home|homepage|inicio|portada)(?:\.lazy)?\.(?:tsx?|jsx?|vue|svelte|html?)$/.test(base) : page.words.some((w) => base.includes(w));
      if (hit && /\.(?:tsx?|jsx?|vue|svelte|html?)$/.test(base)) names.add(f.path.split("/").pop() ?? f.path);
    }
  }
  return [...names].join(" ");
}
