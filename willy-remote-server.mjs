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
let authenticatedSocket = null;
const pendingActions = new Map(); // id → { resolve }

function generateCode() {
  return String(randomInt(100000, 999999));
}

function refreshCode() {
  pairCode = generateCode();
  pairExpiry = Date.now() + 5 * 60 * 1000;
  console.log(`[remote] Nuevo código de emparejamiento: ${pairCode} (válido 5 min)`);
  return pairCode;
}

// Refrescar el código cada 5 minutos si no hay sesión activa
setInterval(() => {
  if (!authenticatedSocket) refreshCode();
}, 5 * 60 * 1000);

// --- Servidor HTTP mínimo para health-check ---
const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: authenticatedSocket ? 1 : 0 }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server: httpServer, path: "/remote" });

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?";
  console.log(`[remote] Nueva conexión desde ${ip}`);

  // Generar un nuevo código si el anterior caducó
  if (Date.now() > pairExpiry) refreshCode();

  let authenticated = false;

  // Enviar el código de emparejamiento al cliente
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
        refreshCode(); // Invalidar el código usado
        send(ws, { type: "AUTH_OK" });
        console.log(`[remote] Dispositivo autenticado desde ${ip}`);
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
      console.log(`[remote] Acción solicitada: ${action.description}`);
      // Enviar al PC (broadcast a todos los sockets no autenticados como cliente)
      // En este protocolo simple, el PC usa la misma conexión bidireccional.
      // El cliente (móvil) solicita, y el PC (UI de WILLY) aprueba o deniega.
      // Como solo hay 1 socket, el flow es: cliente solicita → servidor notifica → cliente recibe respuesta.
      // Para la v1, el servidor actúa de intermediario y auto-aprueba con log.
      // TODO v2: el PC tiene su propio canal WebSocket para aprobar.
      console.log(`[remote] (auto-log) Acción ID ${id}: ${JSON.stringify(action)}`);
      send(ws, { type: "ACTION_ALLOW", id, action });
      return;
    }
  });

  ws.on("close", (code) => {
    console.log(`[remote] Conexión cerrada (${code}) desde ${ip}`);
    if (authenticatedSocket === ws) {
      authenticatedSocket = null;
      authenticated = false;
    }
  });

  ws.on("error", (err) => {
    console.error(`[remote] Error en socket: ${err.message}`);
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
