import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteAction } from "@/components/remote-permission-dialog";

export type RemoteStatus = "idle" | "connecting" | "connected" | "error" | "disconnected";

export interface UseRemoteConnectionReturn {
  status: RemoteStatus;
  pendingAction: RemoteAction | null;
  pairCode: string | null;
  mobileConnected: boolean;
  log: string[];
  connect: () => Promise<void>;
  disconnect: () => void;
  allowAction: (id: string) => void;
  denyAction: (id: string) => void;
}

/**
 * Hook que gestiona el canal WebSocket del PC para la conexión remota.
 *
 * Protocolo v2:
 *  - El PC (este hook, localhost) se conecta al servidor en :4040/remote.
 *  - El servidor lo reconoce como canal del PC (localhost) y lo auto-autentica.
 *  - El servidor envía PC_READY con el código de emparejamiento.
 *  - El usuario introduce el código en el dispositivo remoto (móvil).
 *  - El móvil envía ACTION_REQUESTs → el servidor los reenvía al PC.
 *  - El PC aprueba (allowAction) o deniega (denyAction) cada acción.
 *
 * SEGURIDAD:
 *  - Toda comunicación va por WSS en producción (TLS obligatorio).
 *  - Cada acción requiere aprobación explícita del usuario antes de ejecutarse.
 *  - Las acciones pendientes se deniegan automáticamente al desconectar.
 *  - Sin canal de PC conectado, el servidor deniega todas las acciones del móvil.
 */
export function useRemoteConnection(): UseRemoteConnectionReturn {
  const [status, setStatus] = useState<RemoteStatus>("idle");
  const [pendingAction, setPendingAction] = useState<RemoteAction | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [mobileConnected, setMobileConnected] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  // id → { resolve } para la promesa de permiso actual
  const resolverRef = useRef<((granted: boolean) => void) | null>(null);
  const pendingActionRef = useRef<RemoteAction | null>(null);

  // Sincronizar ref con state (necesario para callbacks estables)
  useEffect(() => { pendingActionRef.current = pendingAction; }, [pendingAction]);

  const addLog = useCallback((msg: string) =>
    setLog((prev) => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]), []);

  const connect = useCallback(async () => {
    if (wsRef.current) return;

    // Guardia de localhost: el canal del PC solo funciona desde la propia máquina.
    // Si WILLY se abre desde otra IP, el servidor lo trataría como canal remoto (móvil)
    // y enviaría PAIR_CODE en vez de PC_READY, quedando el hook bloqueado indefinidamente.
    const hostname = window.location.hostname;
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    if (!isLocal) {
      addLog(`⚠️ La conexión remota solo está disponible desde tu propio equipo (acceso actual: ${hostname}). Abre WILLY en localhost para usar esta función.`);
      setStatus("error");
      return;
    }

    setStatus("connecting");
    setPairCode(null);
    setMobileConnected(false);
    addLog("Iniciando servidor remoto...");

    // Arrancar el servidor remoto si no está corriendo
    try {
      const res = await fetch("/api/remote-status", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message?: string };
      addLog(data.message ?? (data.ok ? "Servidor remoto activo." : "No se pudo arrancar el servidor remoto."));
    } catch {
      addLog("No se pudo verificar el servidor remoto. Intentando conectar...");
    }

    // Conectar como canal de PC (localhost → auto-autenticado por el servidor)
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
      // No enviamos AUTH_REQUEST: el servidor nos reconoce como PC por la IP localhost.
      // Esperamos el mensaje PC_READY con el código de emparejamiento.
      addLog("Conexión establecida. Esperando código de emparejamiento...");
    };

    ws.onmessage = async (event: MessageEvent) => {
      let msg: {
        type: string;
        code?: string;
        expiresIn?: number;
        mobileConnected?: boolean;
        action?: RemoteAction;
        id?: string;
        reason?: string;
      };
      try {
        msg = JSON.parse(event.data as string) as typeof msg;
      } catch {
        addLog("Mensaje no reconocido del servidor.");
        return;
      }

      // PC_READY: el servidor confirma que somos el canal del PC y nos da el código
      if (msg.type === "PC_READY") {
        setStatus("connected");
        if (msg.code) {
          setPairCode(msg.code);
          addLog(`Código de emparejamiento: ${msg.code} (introduce este código en tu dispositivo remoto)`);
        }
        if (msg.mobileConnected) {
          setMobileConnected(true);
          addLog("Dispositivo remoto ya conectado.");
        }
        return;
      }

      // PAIR_CODE: nuevo código (el servidor lo actualiza al autenticar el móvil)
      if (msg.type === "PAIR_CODE" && msg.code) {
        setPairCode(msg.code);
        addLog(`Nuevo código de emparejamiento: ${msg.code}`);
        return;
      }

      // MOBILE_CONNECTED / MOBILE_DISCONNECTED
      if (msg.type === "MOBILE_CONNECTED") {
        setMobileConnected(true);
        addLog("✅ Dispositivo remoto conectado.");
        return;
      }
      if (msg.type === "MOBILE_DISCONNECTED") {
        setMobileConnected(false);
        addLog("Dispositivo remoto desconectado.");
        return;
      }

      // ACTION_REQUEST: el móvil solicita ejecutar una acción → pedir permiso al usuario
      if (msg.type === "ACTION_REQUEST" && msg.action) {
        addLog(`Solicitud de acción: ${msg.action.description}`);
        setPendingAction(msg.action);

        // Esperar la decisión del usuario (Promise resuelta por allowAction/denyAction)
        const granted = await new Promise<boolean>((resolve) => {
          resolverRef.current = resolve;
        });

        const response = granted ? "ACTION_ALLOW" : "ACTION_DENY";
        ws.send(JSON.stringify({ type: response, id: msg.action.id }));

        addLog(granted
          ? `✅ Permitido: ${msg.action.description}`
          : `🚫 Denegado: ${msg.action.description}`);
        setPendingAction(null);
        resolverRef.current = null;
        return;
      }

      // AUTH_FAILED inesperado (no debería ocurrir desde localhost, pero por si acaso)
      if (msg.type === "AUTH_FAILED") {
        addLog(`Error de autenticación: ${msg.reason ?? "desconocido"}`);
        ws.close(1000);
        setStatus("error");
        return;
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
      setPairCode(null);
      setMobileConnected(false);
      if (status !== "idle") {
        setStatus("disconnected");
        addLog(`Conexión cerrada (código ${ev.code}).`);
      }
    };
  }, [addLog, status]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close(1000, "Usuario desconectó");
      wsRef.current = null;
    }
    setStatus("idle");
    setPairCode(null);
    setMobileConnected(false);
    addLog("Desconectado por el usuario.");
  }, [addLog]);

  const allowAction = useCallback((id: string) => {
    if (resolverRef.current && pendingActionRef.current?.id === id) {
      resolverRef.current(true);
    }
  }, []);

  const denyAction = useCallback((id: string) => {
    if (resolverRef.current && pendingActionRef.current?.id === id) {
      resolverRef.current(false);
    }
  }, []);

  return { status, pendingAction, pairCode, mobileConnected, log, connect, disconnect, allowAction, denyAction };
}
