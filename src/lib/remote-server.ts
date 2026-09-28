/**
 * Servidor WebSocket para "Conectar Remotamente" (puerto 4040).
 * Permite que el móvil u otro dispositivo en la misma red controle WILLY
 * de forma segura: cada acción requiere aprobación explícita del usuario en el PC.
 *
 * Protocolo:
 *   Cliente → { type: "AUTH_REQUEST" }
 *   Servidor → { type: "AUTH_OK" } | { type: "AUTH_FAILED" }
 *   Servidor → { type: "ACTION_REQUEST", action: RemoteAction }
 *   Cliente → { type: "ACTION_ALLOW" | "ACTION_DENY", id: string }
 *
 * Seguridad:
 * - En producción (https) solo acepta WSS (TLS).
 * - Token de sesión derivado de un secreto aleatorio en memoria.
 * - Sin secreto compartido previo: el primer cliente que se conecta obtiene
 *   un código de emparejamiento de 6 dígitos que el PC muestra en la UI.
 *
 * Este módulo solo describe la lógica; el servidor real se levanta desde
 * willy-remote-server.mjs (script independiente, puerto 4040).
 */

export const REMOTE_PORT = 4040;
export const REMOTE_PATH = "/remote";

export interface RemoteAction {
  id: string;
  type: "navigate" | "message" | "file" | "command";
  description: string;
  payload: unknown;
  requestedAt: number;
}

export interface RemoteServerStatus {
  running: boolean;
  port: number;
  clients: number;
  uptime: number;
  startedAt: number | null;
}

/** Estado en memoria del servidor remoto (actualizado por el proceso hijo). */
let _status: RemoteServerStatus = {
  running: false,
  port: REMOTE_PORT,
  clients: 0,
  uptime: 0,
  startedAt: null,
};

export function getRemoteServerStatus(): RemoteServerStatus {
  return { ..._status };
}

export function setRemoteServerStatus(patch: Partial<RemoteServerStatus>): void {
  _status = { ..._status, ...patch };
}

/**
 * Intenta arrancar el servidor WebSocket remoto como proceso hijo.
 * Si ya está corriendo (puerto 4040 en uso) no hace nada.
 * Devuelve true si se arrancó, false si ya estaba corriendo o no se pudo.
 */
export async function ensureRemoteServerRunning(): Promise<{ started: boolean; error?: string }> {
  // Comprobar si ya hay algo en el puerto 4040
  try {
    const { createServer } = await import("node:net");
    const probe = await new Promise<boolean>((resolve) => {
      const s = createServer();
      s.once("error", () => resolve(false));
      s.once("listening", () => { s.close(); resolve(true); });
      s.listen(REMOTE_PORT, "127.0.0.1");
    });
    if (!probe) {
      // Puerto ocupado → ya está corriendo
      setRemoteServerStatus({ running: true });
      return { started: false };
    }
  } catch {
    // ignore
  }

  // Buscar el script del servidor
  const { default: path } = await import("node:path");
  const { default: fs } = await import("node:fs");

  // El script está en la misma carpeta que este módulo
  const scriptCandidates = [
    path.join(process.cwd(), "willy-remote-server.mjs"),
    path.join(process.cwd(), "src", "lib", "willy-remote-server.mjs"),
  ];

  const scriptPath = scriptCandidates.find((p) => fs.existsSync(p));
  if (!scriptPath) {
    return { started: false, error: "Script willy-remote-server.mjs no encontrado." };
  }

  try {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [scriptPath], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, REMOTE_PORT: String(REMOTE_PORT) },
    });
    child.unref();
    setRemoteServerStatus({ running: true, startedAt: Date.now() });
    return { started: true };
  } catch (err) {
    return { started: false, error: err instanceof Error ? err.message : String(err) };
  }
}
