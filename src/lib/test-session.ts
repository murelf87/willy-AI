// PRUEBAS AUTOMÁTICAS DE CADA PROYECTO (revisión 28) · UNA PASADA. Aquí se juntan las tres piezas: el pasador (lib/test-runner,
// en un marco aislado y sin red, con las pruebas del proyecto), la página del proyecto con su vigía y su probador (lib/test-agent,
// en otro marco aislado, invisible) y WILLY en medio: cada paso que pide una prueba («abre /», «pulsa el botón Añadir»,
// «¿qué dice la lista?») pasa por aquí, que carga la página que toca (con lo que tenía guardado esa prueba), espera a que esté
// lista y se lo pide a su probador. Cada prueba empieza con una página limpia; los enlaces a otras páginas del proyecto se
// siguen; los errores de la página se le cuentan a la prueba. Nada de esto puede tocar WILLY: los dos marcos son aislados, no se
// ven, no reciben clics y no se llevan el foco (el dueño puede seguir escribiendo mientras tanto).
// Depende del navegador (DOM): se prueba en un navegador de verdad (cctest/rev28motor y uitest25).

import { asMonitorMessage } from "@/lib/preview-runtime";
import { asAgentMessage, withTestAgent, type AgentReply } from "@/lib/test-agent";
import { asRunnerMessage, DEFAULT_RUNNER_CONFIG, runnerDocument, type RawTestResult, type RunnerConfig, type RunnerFile } from "@/lib/test-runner";
import { pageUrl, resolveGoto, resolveLink } from "@/lib/project-tests";

export type SessionEvent =
  | { tipo: "listo"; pruebas: Array<{ id: string; archivo: string; titulo: string; linea: number }>; errores: Array<{ archivo: string; mensaje: string; linea: number }> }
  | { tipo: "empieza"; id: string }
  | { tipo: "paso"; id: string; texto: string }
  | { tipo: "termina"; id: string; r: RawTestResult };

export type SessionInput = {
  files: RunnerFile[];
  /** Páginas HTML del proyecto (para «goto» y los enlaces) y la principal («/»). */
  pages: string[];
  main: string | null;
  /** La página lista para enseñar (con sus estilos y scripts dentro; la de un proyecto React, compilada). */
  htmlOf: (page: string) => Promise<string | null>;
  config?: Partial<RunnerConfig> & { timeouts?: Partial<RunnerConfig["timeouts"]> };
  /** Solo estas pruebas (por su id). */
  only?: string[] | null;
  signal?: AbortSignal;
  onEvent?: (e: SessionEvent) => void;
  /** Dónde se ponen los marcos (por defecto, el final de la página de WILLY). */
  mount?: HTMLElement;
  /** Tiempo máximo de toda la pasada. */
  maxMs?: number;
};
export type SessionOutcome = {
  listed: Array<{ id: string; archivo: string; titulo: string; linea: number }>;
  loadErrors: Array<{ archivo: string; mensaje: string; linea: number }>;
  results: RawTestResult[];
  stopped: boolean;
  timedOut: boolean;
  /** Si el pasador no ha llegado a arrancar, por qué. */
  fatal: string | null;
  ms: number;
};

const READY_MS = 15_000;
const AGENT_REPLY_MS = 30_000;
const RUNNER_START_MS = 15_000;
const QUERY_OPS = new Set(["contar", "estado", "describe", "info", "html", "evaluar"]);

let running = false;
/** ¿Hay una pasada en marcha? (solo una a la vez en todo WILLY) */
export const testSessionRunning = (): boolean => running;

/** Pasa las pruebas y devuelve lo que ha pasado (nunca lanza: los problemas van en el resultado). */
export async function runTestSession(input: SessionInput): Promise<SessionOutcome> {
  const started = Date.now();
  const out: SessionOutcome = { listed: [], loadErrors: [], results: [], stopped: false, timedOut: false, fatal: null, ms: 0 };
  if (running) return { ...out, fatal: "Ya se están pasando unas pruebas: espera a que terminen." };
  running = true;
  const cfg: RunnerConfig = {
    timeouts: { ...DEFAULT_RUNNER_CONFIG.timeouts, ...(input.config?.timeouts ?? {}) },
    viewport: { ...DEFAULT_RUNNER_CONFIG.viewport, ...(input.config?.viewport ?? {}) },
  };
  const rid = Math.random().toString(36).slice(2, 10);
  const token = `pr${rid}`;

  // ------------------------------------------------------------------ los dos marcos (invisibles, sin clics, sin foco)
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-willy-pruebas", "");
  const hs = host.style;
  hs.cssText = "position:fixed;left:0;top:0;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;";
  const size = (w: number, h: number) => { hs.width = `${w}px`; hs.height = `${h}px`; pageFrame.style.width = `${w}px`; pageFrame.style.height = `${h}px`; };
  const pageFrame = document.createElement("iframe");
  pageFrame.setAttribute("sandbox", "allow-scripts allow-forms");
  pageFrame.setAttribute("tabindex", "-1");
  pageFrame.title = "Pruebas: página del proyecto";
  pageFrame.style.cssText = "border:0;display:block;background:#fff;";
  const runnerFrame = document.createElement("iframe");
  runnerFrame.setAttribute("sandbox", "allow-scripts");
  runnerFrame.setAttribute("tabindex", "-1");
  runnerFrame.title = "Pruebas: pasador";
  runnerFrame.style.cssText = "border:0;position:absolute;left:0;top:0;width:1px;height:1px;";
  host.appendChild(pageFrame);
  host.appendChild(runnerFrame);
  size(cfg.viewport.width, cfg.viewport.height);
  (input.mount ?? document.body).appendChild(host);

  // ------------------------------------------------------------------ la página del proyecto
  type PageState = { name: string | null; hash: string; token: string; ready: boolean; title: string };
  let page: PageState | null = null;
  let loads = 0;
  let storage = { local: {} as Record<string, string>, session: {} as Record<string, string> };
  let dialog: { policy: "aceptar" | "rechazar"; text: string | null } = { policy: "rechazar", text: null };
  let readyWaiters: Array<() => void> = [];
  let loading: Promise<{ ok: boolean; error?: string }> | null = null;
  const pendingAgent = new Map<number, { token: string; resolve: (r: AgentReply) => void; op: string; cmd: Record<string, unknown> }>();
  let agentSeq = 0;
  const currentUrl = () => (page ? pageUrl(page.name, page.hash, input.main) : "about:blank");

  const toRunner = (m: Record<string, unknown>) => { try { runnerFrame.contentWindow?.postMessage({ __willyPruebas: true, k: token, ...m }, "*"); } catch { /* el marco ya no está */ } };
  const event = (evento: Record<string, unknown>) => toRunner({ tipo: "evento", evento });

  const whenReady = (ms = READY_MS): Promise<boolean> => new Promise((resolve) => {
    if (page?.ready) { resolve(true); return; }
    const timer = window.setTimeout(() => { readyWaiters = readyWaiters.filter((w) => w !== done); resolve(false); }, ms);
    const done = () => { window.clearTimeout(timer); resolve(true); };
    readyWaiters.push(done);
  });

  /** Carga una página del proyecto (con lo que tenía guardado la prueba) y espera a que esté lista. */
  const load = (name: string | null, hash: string): Promise<{ ok: boolean; error?: string }> => {
    const work = (async () => {
      // Lo que se estaba preguntando a la página anterior se volverá a preguntar a la nueva (o se da por hecho, si era una acción).
      const oldToken = page?.token ?? "";
      const html = name ? await input.htmlOf(name) : null;
      if (name && !html) return { ok: false, error: `No se puede abrir «${name}» (no está o no se puede enseñar).` };
      loads += 1;
      const tok = `${token}.${loads}`;
      page = { name, hash, token: tok, ready: false, title: "" };
      for (const [id, p] of pendingAgent) {
        if (p.token !== oldToken) continue;
        pendingAgent.delete(id);
        if (QUERY_OPS.has(String(p.cmd["op"]))) p.resolve({ ok: false, motivo: "navegando", reintentar: true });
        else p.resolve({ ok: true });
      }
      pageFrame.srcdoc = name && html ? withTestAgent(html, { token: tok, hash: hash || null, storage, dialog }) : "<!doctype html><title></title>";
      if (!name) { page.ready = true; return { ok: true }; }
      const ok = await whenReady();
      return ok ? { ok: true } : { ok: false, error: "La página no termina de cargar (15 s)." };
    })();
    loading = work;
    void work.finally(() => { if (loading === work) loading = null; });
    return work;
  };

  /** Pregunta algo a la página de ahora (espera a que esté lista; si cambia de página a medias, se repite en la nueva). */
  const askAgent = async (cmd: Record<string, unknown>, tries = 0): Promise<AgentReply> => {
    if (loading) await loading;
    if (!page || !page.name) return { ok: false, error: "No hay ninguna página abierta (la prueba tiene que empezar con page.goto)." };
    if (!page.ready && !(await whenReady())) return { ok: false, error: "La página no termina de cargar." };
    const target = page;
    const id = ++agentSeq;
    const reply = await new Promise<AgentReply>((resolve) => {
      const timer = window.setTimeout(() => { pendingAgent.delete(id); resolve({ ok: false, error: "La página no contesta (¿se ha quedado colgada?)." }); }, AGENT_REPLY_MS);
      pendingAgent.set(id, { token: target.token, op: String(cmd["op"]), cmd, resolve: (r) => { window.clearTimeout(timer); resolve(r); } });
      try { pageFrame.contentWindow?.postMessage({ __willyOrden: true, k: target.token, orden: "prueba", id, cmd }, "*"); } catch { /* se reintenta abajo */ }
    });
    if (reply.motivo === "navegando" && tries < 3) return askAgent(cmd, tries + 1);
    return reply;
  };

  /** Lo que pide el pasador, de uno en uno y en orden. */
  const handle = async (cmd: Record<string, unknown>): Promise<AgentReply & { url?: string }> => {
    const op = String(cmd["op"] ?? "");
    switch (op) {
      case "nueva-pagina": {
        storage = { local: {}, session: {} };
        dialog = { policy: "rechazar", text: null };
        const vp = (cmd["viewport"] ?? {}) as { width?: number; height?: number };
        size(Math.min(3000, Math.max(200, Number(vp.width) || cfg.viewport.width)), Math.min(3000, Math.max(200, Number(vp.height) || cfg.viewport.height)));
        await load(null, "");
        page = null;
        return { ok: true };
      }
      case "abrir": {
        const t = resolveGoto(String(cmd["url"] ?? "/"), { pages: input.pages, main: input.main, current: page?.name ?? null });
        if ("error" in t) return { ok: false, error: t.error };
        if ("blank" in t) { await load(null, ""); page = null; return { ok: true, value: { url: "about:blank" }, url: "about:blank" }; }
        if (!t.page) return { ok: false, error: "El proyecto no tiene una página principal que abrir." };
        const r = await load(t.page, t.hash);
        return r.ok ? { ok: true, value: { url: currentUrl() }, url: currentUrl() } : { ok: false, error: r.error ?? "No se ha podido abrir." };
      }
      case "recargar": {
        if (!page?.name) return { ok: false, error: "No hay ninguna página abierta." };
        const info = await askAgent({ op: "info" });
        const hash = info.ok && info.value && typeof (info.value as { hash?: unknown }).hash === "string" ? (info.value as { hash: string }).hash : page.hash;
        const r = await load(page.name, hash);
        return r.ok ? { ok: true, value: { url: currentUrl() }, url: currentUrl() } : { ok: false, error: r.error ?? "No se ha podido recargar." };
      }
      case "tamano": {
        size(Math.min(3000, Math.max(200, Number(cmd["width"]) || 1280)), Math.min(3000, Math.max(200, Number(cmd["height"]) || 720)));
        await new Promise((r) => window.setTimeout(r, 80));
        return { ok: true };
      }
      case "url": {
        if (!page?.name) return { ok: true, value: { url: "about:blank", title: "" }, url: "about:blank" };
        const info = await askAgent({ op: "info" });
        if (info.ok && info.value && typeof info.value === "object") {
          const v = info.value as { hash?: string; titulo?: string };
          if (typeof v.hash === "string" && page) page.hash = v.hash;
          if (page) page.title = String(v.titulo ?? "");
        }
        return { ok: true, value: { url: currentUrl(), title: page?.title ?? "" }, url: currentUrl() };
      }
      case "dialogo": {
        dialog = { policy: cmd["politica"] === "aceptar" ? "aceptar" : "rechazar", text: cmd["texto"] == null ? null : String(cmd["texto"]) };
        if (page?.name && page.ready) await askAgent({ op: "dialogo", politica: dialog.policy, texto: dialog.text });
        return { ok: true };
      }
      default: {
        const r = await askAgent(cmd);
        return { ...r, url: currentUrl() };
      }
    }
  };

  // ------------------------------------------------------------------ mensajes
  let finish: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  let readyRunner: ((ok: boolean) => void) | null = null;
  const runnerReady = new Promise<boolean>((resolve) => { readyRunner = resolve; });
  let queue: Promise<unknown> = Promise.resolve();

  const onMessage = (e: MessageEvent) => {
    if (e.source && e.source === runnerFrame.contentWindow) {
      const m = asRunnerMessage(e.data, token);
      if (!m) return;
      switch (m.tipo) {
        case "listo":
          out.listed = m.pruebas;
          out.loadErrors = m.errores;
          input.onEvent?.(m);
          readyRunner?.(true);
          break;
        case "orden": {
          const id = m.id;
          queue = queue.then(() => handle(m.cmd)).then(
            (r) => toRunner({ tipo: "respuesta", id, r }),
            (err: unknown) => toRunner({ tipo: "respuesta", id, r: { ok: false, error: err instanceof Error ? err.message : String(err) } }),
          );
          break;
        }
        case "empieza": case "paso": input.onEvent?.(m); break;
        case "termina": out.results.push(m.r); input.onEvent?.(m); break;
        case "error": out.fatal = out.fatal ?? m.mensaje; break;
        case "fin": finish?.(); break;
      }
      return;
    }
    if (!e.source || e.source !== pageFrame.contentWindow || !page) return;
    const current = page;
    const a = asAgentMessage(e.data, current.token) ?? (() => {
      // Las respuestas pueden llegar de la carga anterior (una acción que ha hecho cambiar de página).
      const d = e.data as Record<string, unknown> | null;
      if (!d || d["tipo"] !== "prueba-respuesta") return null;
      const k = String(d["k"] ?? "");
      return k.startsWith(`${token}.`) ? asAgentMessage(d, k) : null;
    })();
    if (a) {
      if (a.tipo === "prueba-listo") {
        current.ready = true;
        current.hash = a.hash;
        current.title = a.titulo;
        const ws = readyWaiters;
        readyWaiters = [];
        ws.forEach((w) => w());
      } else if (a.tipo === "prueba-respuesta") {
        const p = pendingAgent.get(a.id);
        if (p) { pendingAgent.delete(a.id); p.resolve(a.r); }
      } else if (a.tipo === "prueba-almacen") {
        storage = { local: a.local, session: a.session };
      } else if (a.tipo === "prueba-dialogo") {
        event({ clase: "dialogo", tipo: a.clase, mensaje: a.mensaje });
      }
      return;
    }
    const mm = asMonitorMessage(e.data, current.token);
    if (!mm) return;
    if (mm.tipo === "error") event({ clase: "error", mensaje: `${mm.mensaje}${mm.linea ? ` (línea ${mm.linea})` : ""}` });
    else if (mm.tipo === "consola") event({ clase: "consola", nivel: mm.nivel, texto: mm.texto });
    else if (mm.tipo === "ruta") current.hash = mm.hash;
    else if (mm.tipo === "navegar") {
      const t = resolveLink(mm.ruta, { pages: input.pages, main: input.main, current: current.name });
      if ("page" in t && t.page) void load(t.page, t.hash);
      else event({ clase: "consola", nivel: "warn", texto: `El enlace «${mm.ruta}» no lleva a ninguna página del proyecto.` });
    }
  };
  window.addEventListener("message", onMessage);

  // ------------------------------------------------------------------ la pasada
  let hardTimer = 0;
  const stop = (why: "parado" | "tiempo") => {
    if (why === "tiempo") out.timedOut = true;
    else out.stopped = true;
    toRunner({ tipo: "parar" });
    window.setTimeout(() => finish?.(), 3000);
  };
  const onAbort = () => stop("parado");
  try {
    if (input.signal?.aborted) { out.stopped = true; return out; }
    input.signal?.addEventListener("abort", onAbort);
    runnerFrame.srcdoc = runnerDocument(token, input.files, cfg);
    const startTimer = window.setTimeout(() => readyRunner?.(false), RUNNER_START_MS);
    const ok = await runnerReady;
    window.clearTimeout(startTimer);
    if (!ok) { out.fatal = "El pasador de pruebas no ha arrancado."; return out; }
    if (input.signal?.aborted) { out.stopped = true; return out; }
    hardTimer = window.setTimeout(() => stop("tiempo"), input.maxMs ?? 5 * 60_000);
    toRunner({ tipo: "empezar", solo: input.only ?? null });
    await finished;
    return out;
  } finally {
    window.clearTimeout(hardTimer);
    input.signal?.removeEventListener("abort", onAbort);
    window.removeEventListener("message", onMessage);
    for (const [, p] of pendingAgent) p.resolve({ ok: false, error: "Pruebas terminadas." });
    pendingAgent.clear();
    try { pageFrame.srcdoc = ""; runnerFrame.srcdoc = ""; } catch { /* nada */ }
    host.remove();
    out.ms = Date.now() - started;
    running = false;
  }
}
