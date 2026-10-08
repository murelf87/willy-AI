#!/usr/bin/env node
/**
 * WILLY Remote Relay v1
 *
 * Self-hostable HTTP relay for WILLY Remote Agent.
 * Put it behind HTTPS (Caddy/Nginx) on a server you control.
 *
 * Environment:
 *   WILLY_RELAY_PORT=4060
 *   WILLY_RELAY_BIND=127.0.0.1
 *   WILLY_RELAY_AGENT_SECRET=<secret shared only with the PC agent>
 *   WILLY_RELAY_CLIENT_TOKEN=<bearer token used by the MCP client>
 */

import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.WILLY_RELAY_PORT || 4060);
const BIND = String(process.env.WILLY_RELAY_BIND || "127.0.0.1");
const AGENT_SECRET = String(process.env.WILLY_RELAY_AGENT_SECRET || "");
const CLIENT_TOKEN = String(process.env.WILLY_RELAY_CLIENT_TOKEN || "");
const MAX_BODY = 2 * 1024 * 1024;
const JOB_TIMEOUT_MS = 135000;
const POLL_TIMEOUT_MS = 25000;

if (AGENT_SECRET.length < 24 || CLIENT_TOKEN.length < 24) {
  console.error("[willy-relay] Faltan secretos seguros. Define WILLY_RELAY_AGENT_SECRET y WILLY_RELAY_CLIENT_TOKEN (mínimo 24 caracteres).");
  process.exit(2);
}

const queue = [];
const jobs = new Map();
const pollWaiters = [];
let lastAgentSeenAt = 0;

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function constantEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function bearer(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function agentAuth(req) {
  return constantEqual(bearer(req), AGENT_SECRET);
}

function clientAuth(req) {
  return constantEqual(bearer(req), CLIENT_TOKEN);
}

async function bodyJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) throw new Error("Petición demasiado grande.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function wakeAgent() {
  while (pollWaiters.length && queue.length) {
    const waiter = pollWaiters.shift();
    if (!waiter || waiter.closed) continue;
    const job = queue.shift();
    waiter.closed = true;
    clearTimeout(waiter.timer);
    lastAgentSeenAt = Date.now();
    json(waiter.res, 200, { ok: true, job });
  }
}

function nextJob(res) {
  lastAgentSeenAt = Date.now();
  if (queue.length) {
    const job = queue.shift();
    json(res, 200, { ok: true, job });
    return;
  }
  const waiter = { res, closed: false, timer: null };
  waiter.timer = setTimeout(() => {
    if (waiter.closed) return;
    waiter.closed = true;
    const index = pollWaiters.indexOf(waiter);
    if (index >= 0) pollWaiters.splice(index, 1);
    json(res, 200, { ok: true, job: null });
  }, POLL_TIMEOUT_MS);
  pollWaiters.push(waiter);
}

function enqueue(payload) {
  const id = randomUUID();
  const job = { id, payload, createdAt: Date.now() };
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const timer = setTimeout(() => {
    const state = jobs.get(id);
    if (!state) return;
    jobs.delete(id);
    const qIndex = queue.findIndex((x) => x.id === id);
    if (qIndex >= 0) queue.splice(qIndex, 1);
    reject(new Error("Tiempo de espera agotado esperando al agente remoto."));
  }, JOB_TIMEOUT_MS);
  jobs.set(id, { resolve, reject, timer, createdAt: Date.now() });
  queue.push(job);
  wakeAgent();
  return { id, promise };
}

function finishJob(id, result, error) {
  const state = jobs.get(id);
  if (!state) return false;
  jobs.delete(id);
  clearTimeout(state.timer);
  if (error) state.reject(new Error(String(error)));
  else state.resolve(result);
  return true;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, {
        ok: true,
        name: "WILLY Remote Relay",
        version: "1.0.0",
        agentConnected: Date.now() - lastAgentSeenAt < POLL_TIMEOUT_MS * 2,
        lastAgentSeenAt: lastAgentSeenAt || null,
        queued: queue.length,
        activeJobs: jobs.size,
      });
    }

    if (req.method === "POST" && pathname === "/agent/poll") {
      if (!agentAuth(req)) return json(res, 401, { ok: false, error: "Agente no autorizado." });
      return nextJob(res);
    }

    if (req.method === "POST" && pathname === "/agent/result") {
      if (!agentAuth(req)) return json(res, 401, { ok: false, error: "Agente no autorizado." });
      const body = await bodyJson(req);
      const id = String(body.id || "");
      if (!id) return json(res, 400, { ok: false, error: "Falta id." });
      const accepted = finishJob(id, body.result, body.error);
      lastAgentSeenAt = Date.now();
      return json(res, accepted ? 200 : 404, { ok: accepted });
    }

    if (req.method === "POST" && pathname === "/mcp") {
      if (!clientAuth(req)) return json(res, 401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "No autorizado." } });
      const payload = await bodyJson(req);
      const { promise } = enqueue(payload);
      try {
        const result = await promise;
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(result));
      } catch (error) {
        json(res, 504, {
          jsonrpc: "2.0",
          id: payload?.id ?? null,
          error: { code: -32002, message: error instanceof Error ? error.message : String(error) },
        });
      }
      return;
    }

    return json(res, 404, { ok: false, error: "Ruta no encontrada." });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, BIND, () => {
  console.log(`[willy-relay] activo en http://${BIND}:${PORT}`);
  console.log("[willy-relay] publica /mcp detrás de HTTPS para el conector de IA.");
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
