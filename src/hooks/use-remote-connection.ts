import { useCallback, useRef, useState } from "react";
import type { RemoteAction } from "@/components/remote-permission-dialog";

export type RemoteStatus = "idle" | "connecting" | "connected" | "error" | "disconnected";

export interface UseRemoteConnectionReturn {
  status: RemoteStatus;
  pendingAction: RemoteAction | null;
  log: string[];
  connect: () => Promise<void>;
  disconnect: () => void;
  allowAction: (id: string) => void;
  denyAction: (id: string) => void;
}

/**
 * Hook que gestiona la sesión WebSocket cifrada para la conexión remota.
 *
 * SEGURIDAD:
 * - Toda comunicación va por WSS (TLS obligatorio, nunca ws:// en producción).
 * - Cada acción llega al UI como RemoteAction y NO se ejecuta hasta que
 *   el usuario pulse «Permitir» → allowAction().
 * - Si el usuario pulsa «Denegar» → denyAction() envía DENY al servidor y
 *   la acción queda sin ejecutar.
 * - Al desconectar, el WebSocket se cierra limpiamente (código 1000).
 */
export function useRemoteConnection(): UseRemoteConnectionReturn {
  const [status, setStatus] = useState<RemoteStatus>("idle");
  const [pendingAction, setPendingAction] = useState<RemoteAction | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  // Resolvers para la promesa de permiso actual
  const resolverRef = useRef<((granted: boolean) => void) | null>(null);

  const addLog = (msg: string) =>
    setLog((prev) => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    setStatus("connecting");
    addLog("Iniciando conexión segura...");

    // El servidor local de WILLY escucha en el puerto 4040 por WSS.
    // En desarrollo se permite ws:// solo en localhost; en producción es siempre wss://.
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname;
    const url = `${protocol}://${host}:4040/remote`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      addLog(`Error al crear WebSocket: ${String(err)}`);
      setStatus("error");
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      addLog("Conexión establecida (canal cifrado activo).");
      // Protocolo de autenticación: el servidor enviará un challenge
      ws.send(JSON.stringify({ type: "AUTH_REQUEST" }));
    };

    ws.onmessage = async (event: MessageEvent) => {
      let msg: { type: string; action?: RemoteAction; token?: string };
      try {
        msg = JSON.parse(event.data as string) as typeof msg;
      } catch {
        addLog("Mensaje no reconocido del servidor.");
        return;
      }

      if (msg.type === "AUTH_OK") {
        addLog("Autenticación completada.");
        return;
      }

      if (msg.type === "ACTION_REQUEST" && msg.action) {
        addLog(`Solicitud de acción: ${msg.action.description}`);
        setPendingAction(msg.action);

        // Esperar la decisión del usuario (Promise resuelta por allow/deny)
        const granted = await new Promise<boolean>((resolve) => {
          resolverRef.current = resolve;
        });

        ws.send(JSON.stringify({
          type: granted ? "ACTION_ALLOW" : "ACTION_DENY",
          id: msg.action.id,
        }));

        addLog(granted ? `✅ Permitido: ${msg.action.description}` : `🚫 Denegado: ${msg.action.description}`);
        setPendingAction(null);
        resolverRef.current = null;
      }

      if (msg.type === "AUTH_FAILED") {
        addLog("Autenticación rechazada por el servidor.");
        ws.close(1000);
        setStatus("error");
      }
    };

    ws.onerror = () => {
      addLog("Error en el canal de comunicación.");
      setStatus("error");
    };

    ws.onclose = (ev) => {
      wsRef.current = null;
      // Si había una acción pendiente, denegarla automáticamente
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
      setPendingAction(null);
      setStatus("disconnected");
      addLog(`Conexión cerrada (código ${ev.code}).`);
    };
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close(1000, "Usuario desconectó");
      wsRef.current = null;
    }
    setStatus("idle");
    addLog("Desconectado por el usuario.");
  }, []);

  const allowAction = useCallback((id: string) => {
    if (resolverRef.current && pendingAction?.id === id) {
      resolverRef.current(true);
    }
  }, [pendingAction]);

  const denyAction = useCallback((id: string) => {
    if (resolverRef.current && pendingAction?.id === id) {
      resolverRef.current(false);
    }
  }, [pendingAction]);

  return { status, pendingAction, log, connect, disconnect, allowAction, denyAction };
}
