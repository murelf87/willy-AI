// /api/sistema: la puerta del servidor para Ajustes y el Centro de Inteligencia. Solo obedece a la propia interfaz de WILLY
// (nunca a otra página web abierta en el navegador) y las acciones que cierran o reinician WILLY solo se aceptan desde el
// propio ordenador, no desde el móvil. La lógica está en maintenance-server.ts; aquí solo se valida la petición.

import { blockForeignSite } from "@/lib/same-origin";
import {
  cachePreview, cleanCache, cleanOldBackups, dependencyCheck, diagnose, ollamaReport, readLogs, restartOllama, restartServer,
  stopServer, storageReport, systemInfo, type MaintenanceDeps,
} from "@/lib/maintenance-server";

const reply = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** Puerto en el que responde WILLY: el de la dirección con la que se ha abierto (3000 en el programa instalado). */
export function portOf(request: Request): number {
  try {
    const url = new URL(request.url);
    return Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  } catch {
    return 3000;
  }
}

/** ¿La petición llega desde el propio ordenador (localhost) y no desde el móvil u otro equipo de la red? */
export function fromThisComputer(request: Request): boolean {
  try {
    const host = new URL(request.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export async function sistemaGet(request: Request, deps: MaintenanceDeps = {}): Promise<Response> {
  const foreign = blockForeignSite(request);
  if (foreign) return foreign;
  const query = new URL(request.url).searchParams;
  try {
    if (query.has("almacenamiento")) return reply(await storageReport(deps));
    if (query.has("cache")) return reply(await cachePreview(deps));
    if (query.has("ollama")) return reply(await ollamaReport(deps));
    if (query.has("registros")) return reply(await readLogs(query.get("completos") === "1", deps));
    if (query.has("dependencias")) return reply(await dependencyCheck(deps));
    return reply(await systemInfo(portOf(request), deps));
  } catch (error) {
    return reply({ ok: false, error: `No se pudo leer el estado del equipo: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }
}

const ACTIONS = new Set(["diagnostico", "limpiar-cache", "limpiar-copias", "limpiar-navegador", "reiniciar", "detener", "reiniciar-ollama"]);
const LOCAL_ONLY = new Set(["reiniciar", "detener"]);

export async function sistemaPost(request: Request, deps: MaintenanceDeps = {}): Promise<Response> {
  const foreign = blockForeignSite(request);
  if (foreign) return foreign;
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return reply({ ok: false, error: "Petición bloqueada: formato no permitido." }, 415);
  }
  let action = "";
  try {
    const body = (await request.json()) as { action?: unknown };
    action = typeof body.action === "string" ? body.action : "";
  } catch {
    return reply({ ok: false, error: "Petición no válida." }, 400);
  }
  if (!ACTIONS.has(action)) return reply({ ok: false, error: "Acción no reconocida." }, 400);
  if (LOCAL_ONLY.has(action) && !fromThisComputer(request)) {
    return reply({ ok: false, error: "Por seguridad, reiniciar o detener WILLY solo se puede hacer desde el propio ordenador, no desde el móvil." }, 403);
  }
  try {
    switch (action) {
      case "diagnostico":
        return reply({ ok: true, report: await diagnose(portOf(request), deps) });
      case "limpiar-cache":
        return reply(await cleanCache(deps));
      case "limpiar-copias":
        return reply(await cleanOldBackups(deps));
      case "limpiar-navegador":
        // El navegador borra su caché de WILLY (archivos guardados de páginas anteriores) al recibir esta cabecera.
        // No toca tus ajustes ni tus conversaciones: solo la caché.
        return reply({ ok: true, message: "Caché del navegador vaciada para WILLY AI. La página se recarga ahora." }, 200, { "Clear-Site-Data": "\"cache\"" });
      case "reiniciar":
        return reply(await restartServer(deps));
      case "detener":
        return reply(await stopServer(deps));
      case "reiniciar-ollama":
        return reply(await restartOllama(deps));
      default:
        return reply({ ok: false, error: "Acción no reconocida." }, 400);
    }
  } catch (error) {
    return reply({ ok: false, error: `No se pudo completar: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }
}
