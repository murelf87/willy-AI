#!/usr/bin/env node
/**
 * Servidor WebSocket para "Conectar Remotamente" de WILLY AI.
 * Puerto 4040. Ejecutar con: node willy-remote-server.mjs
 *
 * Protocolo:
 *  1. Cliente conecta → servidor envía { type: "PAIR_CODE", code: "123456" }
 *  2. Usuario ve el código en su PC y lo introduce en el móvil.
 *  3. Cliente → { type: "AUTH_REQUEST", code: "123456" }
 *  4. Si el código es correcto → { type: "AUTH_OK" }
 *  5. Si no → { type: "AUTH_FAILED" } + cierre del socket.
 *  6. Para solicitar una acción, el CLIENTE envía:
 *     { type: "ACTION_REQUEST", action: { type, description, payload } }
 *  7. La acción llega a la UI del PC → usuario pulsa Permitir/Denegar.
 *  8. Servidor → { type: "ACTION_ALLOW" | "ACTION_DENY", id: "..." }
 *
 * Seguridad básica:
 *  - Código de 6 dígitos aleatorio por sesión.
 *  - El código caduca a los 5 minutos si no se autentica.
 *  - Solo 1 cliente autenticado a la vez (desktop → acepta, móvil → rechaza).
 *  - No almacena nada en disco.
 */

import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { randomInt } from "node:crypto";

const PORT = Number(process.env.REMOTE_PORT ?? 4040);

// --- Código de emparejamiento ---
let pairCode = generateCode();
let pairExpiry = Date.now() + 5 * 60 * 1000; // 5 min
let authenticatedSocket = null; // socket del cliente remoto (móvil)
let pcSocket = null;            // socket del PC (UI de WILLY, localhost)
const pendingActions = new Map(); // id → { resolve }

function generateCode() {
  return String(randomInt(100000, 999999));
}

function refreshCode() {
  pairCode = generateCode();
  pairExpiry = Date.now() + 5 * 60 * 1000;
  console.log(`[remote] Nuevo código de emparejamiento: ${pairCode} (válido 5 min)`);
  // Notificar al PC del nuevo código
  if (pcSocket) send(pcSocket, { type: "PAIR_CODE", code: pairCode, expiresIn: 300 });
  return pairCode;
}

// Refrescar el código cada 5 minutos si no hay sesión activa
setInterval(() => {
  if (!authenticatedSocket) refreshCode();
}, 5 * 60 * 1000);

/** ¿Viene de localhost? (el canal del PC). */
function isLocalhost(req) {
  const addr = req.socket?.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

// --- Servidor HTTP mínimo para health-check + código de emparejamiento ---
const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: authenticatedSocket ? 1 : 0, pcConnected: !!pcSocket }));
    return;
  }
  // Devuelve el código de emparejamiento actual (solo desde localhost)
  if (req.url === "/code" && isLocalhost(req)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      code: pairCode,
      expiresIn: Math.max(0, Math.round((pairExpiry - Date.now()) / 1000)),
      mobileConnected: !!authenticatedSocket,
    }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server: httpServer, path: "/remote" });

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?";
  const local = isLocalhost(req);
  console.log(`[remote] Nueva conexión desde ${ip} (${local ? "PC/local" : "remoto"})`);

  // Generar un nuevo código si el anterior caducó
  if (Date.now() > pairExpiry) refreshCode();

  // --- Canal del PC (localhost): auto-autenticado, recibe ACTION_REQUESTs y envía ALLOW/DENY ---
  if (local) {
    if (pcSocket) {
      // Solo un canal PC a la vez
      pcSocket.close(1008, "Nueva conexión de PC recibida.");
    }
    pcSocket = ws;
    send(ws, { type: "PC_READY", code: pairCode, expiresIn: Math.max(0, Math.round((pairExpiry - Date.now()) / 1000)), mobileConnected: !!authenticatedSocket });
    console.log(`[remote] Canal de PC registrado (${ip})`);

    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      // El PC puede aprobar o denegar acciones enviadas por el móvil
      if ((msg.type === "ACTION_ALLOW" || msg.type === "ACTION_DENY") && msg.id) {
        const pending = pendingActions.get(msg.id);
        if (pending) {
          pendingActions.delete(msg.id);
          if (authenticatedSocket) {
            send(authenticatedSocket, { type: msg.type, id: msg.id });
          }
          console.log(`[remote] PC ${msg.type === "ACTION_ALLOW" ? "aprobó" : "denegó"} acción ${msg.id}`);
        }
      }
    });

    ws.on("close", (code) => {
      console.log(`[remote] Canal de PC cerrado (${code})`);
      if (pcSocket === ws) pcSocket = null;
    });

    ws.on("error", (err) => {
      console.error(`[remote] Error en canal PC: ${err.message}`);
    });
    return;
  }

  // --- Canal remoto (móvil): requiere código de emparejamiento ---
  let authenticated = false;

  // Enviar el código de emparejamiento al cliente (para que lo vea en la UI del móvil si fuera necesario)
  send(ws, { type: "PAIR_CODE", code: pairCode });

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === "AUTH_REQUEST") {
      if (authenticatedSocket && authenticatedSocket !== ws) {
        send(ws, { type: "AUTH_FAILED", reason: "Ya hay un dispositivo conectado." });
        ws.close(1008);
        return;
      }
      if (String(msg.code) === pairCode && Date.now() <= pairExpiry) {
        authenticated = true;
        authenticatedSocket = ws;
        refreshCode(); // Invalidar el código usado (genera uno nuevo para el PC)
        send(ws, { type: "AUTH_OK" });
        // Notificar al PC que el móvil se conectó
        if (pcSocket) send(pcSocket, { type: "MOBILE_CONNECTED" });
        console.log(`[remote] Dispositivo remoto autenticado desde ${ip}`);
      } else {
        send(ws, { type: "AUTH_FAILED", reason: "Código incorrecto o caducado." });
        ws.close(1008);
      }
      return;
    }

    if (!authenticated) {
      send(ws, { type: "AUTH_FAILED", reason: "No autenticado." });
      return;
    }

    if (msg.type === "ACTION_REQUEST" && msg.action) {
      const id = `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const action = { ...msg.action, id, requestedAt: Date.now() };
      console.log(`[remote] Acción solicitada por ${ip}: ${action.description}`);

      if (pcSocket) {
        // Reenviar al PC para que el usuario apruebe o deniegue
        pendingActions.set(id, { ws, action });
        send(pcSocket, { type: "ACTION_REQUEST", action });
        // Timeout de 60 s: si el PC no responde, denegar
        setTimeout(() => {
          if (pendingActions.has(id)) {
            pendingActions.delete(id);
            send(ws, { type: "ACTION_DENY", id, reason: "Tiempo de espera agotado." });
            console.log(`[remote] Acción ${id} denegada por timeout.`);
          }
        }, 60_000);
      } else {
        // Sin canal de PC, denegar directamente (seguridad)
        send(ws, { type: "ACTION_DENY", id, reason: "El PC no está conectado para aprobar la acción." });
        console.log(`[remote] Acción denegada (PC no conectado): ${action.description}`);
      }
      return;
    }
  });

  ws.on("close", (code) => {
    console.log(`[remote] Conexión remota cerrada (${code}) desde ${ip}`);
    if (authenticatedSocket === ws) {
      authenticatedSocket = null;
      // Notificar al PC
      if (pcSocket) send(pcSocket, { type: "MOBILE_DISCONNECTED" });
    }
  });

  ws.on("error", (err) => {
    console.error(`[remote] Error en socket remoto: ${err.message}`);
  });
});

function send(ws, data) {
  try { ws.send(JSON.stringify(data)); } catch { /* ignore */ }
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[remote] Servidor WebSocket WILLY escuchando en :${PORT}/remote`);
  console.log(`[remote] Código de emparejamiento inicial: ${pairCode}`);
  console.log(`[remote] Health check: http://localhost:${PORT}/health`);
});

process.on("SIGTERM", () => { httpServer.close(); process.exit(0); });
process.on("SIGINT", () => { httpServer.close(); process.exit(0); });
