// MAPA DE PANTALLAS (rediseño, revisión 26; lo que faltaba en SÚPER IA: «Mapa de pantallas de las aplicaciones de una sola
// página»). Una aplicación de una sola página (una sola index.html) tiene varias PANTALLAS: sus rutas («#/reservas»,
// «#/perfil»…). El mapa las junta todas —las que salen del código (enlaces «#/…», rutas de React Router o TanStack Router,
// navigate(…)), los enlaces que hay de verdad en la página y las que ya has visitado— y, con las páginas HTML del proyecto,
// las enseña de un vistazo: cada una en pequeño, si se ve bien o da error, y «Abrir» para ir a ella en la vista previa.
// La vista previa es un marco aislado («about:srcdoc»): ahí solo se puede ir de una pantalla a otra con rutas «#». Si el
// proyecto usa rutas sin «#» (BrowserRouter, el historial por defecto de TanStack Router…), solo se ve la primera pantalla:
// el mapa lo dice y ofrece pasarlo a rutas con «#». Lógica pura: se prueba aparte.

import type { GeneratedFile } from "@/lib/ai-standard";

export type RoutingKind = "hash" | "historial" | "ninguna";
export type Routing = { kind: RoutingKind; library: string | null; detail: string };
export type ScreenSource = "pagina" | "codigo" | "enlace" | "visitada";
export type Screen = {
  /** La página y la ruta («index.html#/reservas»): así se distinguen. */
  id: string;
  page: string;
  /** La ruta dentro de la página («#/reservas»); null = la página tal como arranca. */
  hash: string | null;
  label: string;
  sources: ScreenSource[];
  /** Dónde sale en el código (el primer sitio), para la IA y el modo avanzado. */
  file?: string;
  line?: number;
};
/** Una ruta encontrada en el código. */
export type CodeScreen = { hash: string; label: string | null; file: string; line: number };
export type ScreenHealth = { status: "cargando" | "bien" | "en-blanco" | "error" | "sin-respuesta"; error?: string };

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/^\.?\//, "");
const CODE = /\.(?:tsx|ts|jsx|js|mjs|html?)$/i;
const MAX_SCREENS = 24;

const TANSTACK = /from\s+["']@tanstack\/react-router["']/;
const REACT_ROUTER = /from\s+["']react-router(?:-dom)?["']/;
const WOUTER = /from\s+["']wouter["']/;
const HASH_HINTS = /createHashHistory|HashRouter|createHashRouter|useHashLocation|hashHistory|location\.hash\s*=|["']hashchange["']|href\s*=\s*\{?\s*["'`]#!?\//;

/** ¿Cómo va el proyecto de una pantalla a otra? Rutas con «#» (se pueden abrir en la vista previa), sin «#» o sin rutas. */
export function routingOf(files: GeneratedFile[]): Routing {
  const code = files.filter((f) => CODE.test(f.path));
  const all = code.map((f) => f.content).join("\n");
  const has = (re: RegExp) => re.test(all);
  if (has(TANSTACK) && /\bcreateRouter\s*\(/.test(all)) {
    return /createHashHistory/.test(all)
      ? { kind: "hash", library: "@tanstack/react-router", detail: "Rutas con «#» (TanStack Router con createHashHistory): cada pantalla se puede abrir en la vista previa." }
      : { kind: "historial", library: "@tanstack/react-router", detail: "Rutas sin «#» (TanStack Router con su historial normal): en la vista previa solo se ve la primera pantalla." };
  }
  if (has(REACT_ROUTER)) {
    if (/HashRouter|createHashRouter/.test(all)) return { kind: "hash", library: "react-router", detail: "Rutas con «#» (HashRouter): cada pantalla se puede abrir en la vista previa." };
    if (/BrowserRouter|createBrowserRouter/.test(all)) return { kind: "historial", library: "react-router", detail: "Rutas sin «#» (BrowserRouter): en la vista previa solo se ve la primera pantalla." };
  }
  if (has(WOUTER)) {
    return /useHashLocation/.test(all)
      ? { kind: "hash", library: "wouter", detail: "Rutas con «#» (wouter con useHashLocation): cada pantalla se puede abrir en la vista previa." }
      : { kind: "historial", library: "wouter", detail: "Rutas sin «#» (wouter con su historial normal): en la vista previa solo se ve la primera pantalla." };
  }
  if (HASH_HINTS.test(all)) return { kind: "hash", library: null, detail: "Rutas con «#»: cada pantalla se puede abrir en la vista previa." };
  if (/\bhistory\.pushState\s*\(/.test(all) && /location\.pathname/.test(all)) return { kind: "historial", library: null, detail: "Rutas sin «#» (history.pushState): en la vista previa solo se ve la primera pantalla." };
  return { kind: "ninguna", library: null, detail: "Sin rutas: una sola pantalla (o cambia de pantalla sin ruta)." };
}

/** «/mis-reservas/» → «#/mis-reservas»; null si no es una ruta que se pueda abrir (con parámetros, un archivo, externa…). */
export function hashOfPath(raw: string): string | null {
  let p = raw.trim();
  const prefix = p.startsWith("#!/") ? "#!" : "#";
  if (/^#!?\//.test(p)) p = p.replace(/^#!?/, "");
  else if (p.startsWith("#")) return null; // un ancla de la página («#contacto»), no una pantalla
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(p)) return null;
  p = p.replace(/[?#].*$/, "");
  if (!p.startsWith("/")) p = `/${p}`;
  if (/[:$*{}[\]()<>\s"'`\\]/.test(p) || /\.[a-z0-9]{1,5}$/i.test(p)) return null;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return `${prefix}${p}`;
}

/** El nombre de una pantalla para cualquiera: «#/mis-reservas» → «Mis reservas»; «#/» → «Inicio». */
export function screenLabel(hash: string | null): string {
  if (!hash || hash === "#/" || hash === "#!/" || hash === "#") return "Inicio";
  const last = hash.replace(/^#!?\//, "").split("/").filter(Boolean).pop() ?? "";
  const words = decodeURIComponent(last).replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Inicio";
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split("\n").length;
const cleanLabel = (s: string | undefined): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t && t.length <= 40 && !/[{}<>=;]/.test(t) ? t : null;
};

/**
 * Las pantallas que salen del código: enlaces «#/…», <Link to="/…">, navigate("/…"), rutas de React Router y TanStack Router
 * (path, createFileRoute) y location.hash. Las rutas con parámetros («/reservas/:id») no se pueden abrir sin un dato: fuera.
 */
export function screensFromCode(files: GeneratedFile[]): CodeScreen[] {
  const out = new Map<string, CodeScreen>();
  const add = (raw: string, label: string | null, file: string, text: string, index: number) => {
    const hash = hashOfPath(raw);
    if (!hash) return;
    const key = hash;
    const prev = out.get(key);
    if (prev) {
      if (!prev.label && label) prev.label = label;
      return;
    }
    if (out.size >= 60) return;
    out.set(key, { hash: key, label, file: norm(file), line: lineAt(text, index) });
  };
  for (const f of files) {
    if (!CODE.test(f.path) || f.content.length > 400_000) continue;
    const text = f.content;
    // Enlaces con «#/…» (HTML o JSX), con el texto del enlace si lo tiene.
    for (const m of text.matchAll(/href\s*=\s*\{?\s*["'`](#!?\/[^"'`\s]*)["'`][^>]*>\s*([^<{]{0,60})/g)) add(m[1]!, cleanLabel(m[2]), f.path, text, m.index ?? 0);
    // <Link to="/reservas">Reservas</Link> y navigate("/reservas") / navigate({ to: "/reservas" })
    for (const m of text.matchAll(/\bto\s*=\s*\{?\s*["'`](\/[^"'`\s]*)["'`][^>]*>\s*([^<{]{0,60})/g)) add(m[1]!, cleanLabel(m[2]), f.path, text, m.index ?? 0);
    for (const m of text.matchAll(/\bnavigate\s*\(\s*(?:\{\s*to\s*:\s*)?["'`](\/[^"'`\s]*)["'`]/g)) add(m[1]!, null, f.path, text, m.index ?? 0);
    // location.hash = "#/reservas"
    for (const m of text.matchAll(/location\.hash\s*=\s*["'`](#?!?\/[^"'`\s]*)["'`]/g)) add(m[1]!.startsWith("#") ? m[1]! : `#${m[1]!}`, null, f.path, text, m.index ?? 0);
    // Rutas de TanStack Router por archivos y de código, y de React Router (solo en archivos que definen rutas).
    for (const m of text.matchAll(/createFileRoute\s*\(\s*["'`](\/[^"'`]*)["'`]\s*\)/g)) add(m[1]!, null, f.path, text, m.index ?? 0);
    if (/createRoute\s*\(|<Route\b|createBrowserRouter|createHashRouter|useRoutes\s*\(|RouterProvider/.test(text)) {
      for (const m of text.matchAll(/\bpath\s*[:=]\s*\{?\s*["'`](\/?[a-zA-Z0-9\-_/]*)["'`]/g)) add(m[1] || "/", null, f.path, text, m.index ?? 0);
    }
  }
  return [...out.values()];
}

/**
 * El mapa: las páginas del proyecto y sus pantallas, sin repetir y en un orden que no cambia al moverte por ellas: primero la
 * página de la aplicación (la principal) con sus rutas (las del código van con ella; las de sus enlaces y las visitadas, con
 * la página donde se vieron) y después las demás páginas. Como mucho 24.
 */
export function buildScreenMap(input: { pages: string[]; appPage: string | null; routing: Routing; code: CodeScreen[]; links: Array<{ page: string; hash: string; text: string }>; visited: Array<{ page: string; hash: string }> }): Screen[] {
  const out: Screen[] = [];
  const byId = new Map<string, Screen>();
  const put = (page: string, hash: string | null, label: string, source: ScreenSource, where?: { file: string; line: number }) => {
    const h = hash === "#/" || hash === "#!/" || hash === "#" ? null : hash;
    const id = `${page}${h ?? ""}`;
    const prev = byId.get(id);
    if (prev) {
      if (!prev.sources.includes(source)) prev.sources.push(source);
      if (where && !prev.file) { prev.file = where.file; prev.line = where.line; }
      if (prev.label === screenLabel(prev.hash) && label !== screenLabel(h)) prev.label = label;
      return;
    }
    if (out.length >= MAX_SCREENS) return;
    const s: Screen = { id, page, hash: h, label, sources: [source], ...(where ? { file: where.file, line: where.line } : {}) };
    byId.set(id, s);
    out.push(s);
  };
  const app = input.appPage && input.pages.includes(input.appPage) ? input.appPage : input.pages[0] ?? null;
  const pages = app ? [app, ...input.pages.filter((p) => p !== app)] : input.pages;
  const routes = input.routing.kind !== "historial";
  const runtime = (page: string) => {
    if (!routes) return;
    for (const l of input.links) { if (l.page !== page) continue; const h = hashOfPath(l.hash); if (h) put(page, h, cleanLabel(l.text) ?? screenLabel(h), "enlace"); }
    for (const v of input.visited) { if (v.page !== page) continue; const h = hashOfPath(v.hash); if (h) put(page, h, screenLabel(h), "visitada"); }
  };
  for (const [i, p] of pages.entries()) {
    put(p, null, pages.length > 1 ? pageLabel(p) : "Inicio", "pagina");
    if (i === 0 && routes) for (const c of input.code) put(p, c.hash, c.label ?? screenLabel(c.hash), "codigo", { file: c.file, line: c.line });
    runtime(p);
  }
  return out;
}

/** «index.html» → «Inicio (index.html)»; «contacto.html» → «Contacto (contacto.html)». */
function pageLabel(page: string): string {
  const base = page.split("/").pop() ?? page;
  const name = base.replace(/\.(?:html?|tsx|ts|jsx|js)$/i, "");
  if (/^(?:index|main|app)$/i.test(name)) return `Inicio (${page})`;
  return `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/[-_]+/g, " ")} (${page})`;
}

/** Las pantallas del proyecto en una línea para la IA (para que entienda «la pantalla de reservas»). */
export function screensForAi(screens: Screen[], routing: Routing): string {
  const routes = screens.filter((s) => s.hash);
  if (!routes.length && routing.kind !== "historial") return "";
  const list = screens.slice(0, 12).map((s) => (s.hash ? `${s.label} («${s.hash}»)` : s.label)).join(", ");
  return routing.kind === "historial" ? `La aplicación usa rutas sin «#»: en la vista previa solo se ve su primera pantalla.` : `Pantallas de la aplicación: ${list}.`;
}

/** «6 pantallas: 5 se ven bien y 1 con errores» (y las que se están comprobando). */
export function screenMapSummary(screens: Screen[], health: Record<string, ScreenHealth | undefined>): string {
  const n = screens.length;
  if (!n) return "Sin pantallas que enseñar.";
  const count = (st: ScreenHealth["status"]) => screens.filter((s) => health[s.id]?.status === st).length;
  const ok = count("bien");
  const bad = count("error") + count("en-blanco");
  const waiting = screens.filter((s) => !health[s.id] || health[s.id]!.status === "cargando").length;
  const unknown = count("sin-respuesta");
  const parts = [`${ok} se ve${ok === 1 ? "" : "n"} bien`, bad ? `${bad} con errores` : "", unknown ? `${unknown} sin respuesta` : ""].filter(Boolean);
  const head = `${n} pantalla${n === 1 ? "" : "s"}`;
  if (waiting === n) return `${head}: comprobando…`;
  return `${head}: ${parts.join(", ").replace(/, ([^,]*)$/, " y $1")}${waiting ? ` (${waiting} comprobándose)` : ""}`;
}

/** Lo que se le pide a WILLY para arreglar una pantalla que no se ve bien (y lo que se enseña en el chat). */
export function screenRepairRequest(screen: Screen, health: ScreenHealth): { text: string; ownerText: string } {
  const where = screen.hash ? `la pantalla «${screen.label}» (ruta «${screen.hash}» de «${screen.page}»)` : `la página «${screen.page}»`;
  const what = health.status === "en-blanco" ? "se queda EN BLANCO (no se ve nada)" : `da un error: «${(health.error ?? "error").slice(0, 300)}»`;
  return {
    text: `En el mapa de pantallas, ${where} ${what}. Encuentra la causa y arréglala sin romper las demás pantallas${screen.file ? ` (la ruta sale en ${screen.file}, línea ${screen.line ?? 0})` : ""}. Entrega los archivos que cambies COMPLETOS.`,
    ownerText: `Arregla ${screen.hash ? `la pantalla «${screen.label}»` : `«${screen.page}»`}: ${health.status === "en-blanco" ? "se queda en blanco" : "da un error"}.`,
  };
}

/** Lo que se le pide a WILLY para que TODAS las pantallas se puedan abrir en la vista previa (rutas con «#»). */
export function hashRoutingRequest(routing: Routing): { text: string; ownerText: string } {
  const how = routing.library === "@tanstack/react-router"
    ? "con @tanstack/react-router, crea el router con `history: createHashHistory()` (import { createHashHistory } from \"@tanstack/react-router\")"
    : routing.library === "react-router"
      ? "con react-router, usa HashRouter (o createHashRouter) en vez de BrowserRouter"
      : routing.library === "wouter"
        ? "con wouter, usa <Router hook={useHashLocation}> (import { useHashLocation } from \"wouter/use-hash-location\")"
        : "usa location.hash y enlaces href=\"#/…\" en vez de history.pushState";
  return {
    text: `El proyecto usa rutas sin «#»: en la vista previa de WILLY (un marco aislado) y al abrirlo como archivo solo funciona la primera pantalla. Pásalo a rutas con «#» (#/reservas…): ${how}. Los enlaces entre pantallas deben seguir funcionando. No cambies nada más y entrega los archivos que cambies COMPLETOS.`,
    ownerText: "Pasa las rutas del proyecto a rutas con «#» para poder abrir cada pantalla en la vista previa.",
  };
}

/** Para la IA, siempre que construya una aplicación con varias pantallas. */
export const SCREEN_RULES = "- Si la aplicación tiene varias pantallas, usa rutas con «#» (#/reservas, #/perfil…): con @tanstack/react-router, `history: createHashHistory()`; sin librería, `location.hash` y enlaces `href=\"#/…\"`. Así la vista previa y el mapa de pantallas de WILLY pueden abrir cada una (con rutas sin «#» solo se ve la primera).";
