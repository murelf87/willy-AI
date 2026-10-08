#!/usr/bin/env node
/**
 * WILLY Remote Agent v1
 *
 * Local-first remote-control agent for WILLY AI.
 * Zero third-party runtime dependencies: Node.js built-ins only.
 *
 * Security model:
 * - Binds to 127.0.0.1 by default.
 * - Random bearer token stored locally.
 * - Read-only actions can run immediately.
 * - Commands, writes, deletes, screenshots and process termination require
 *   explicit approval from a localhost client (WILLY UI) unless the local
 *   config is deliberately changed.
 * - File access is constrained to configured roots.
 * - Every request and result is written to an append-only audit log.
 *
 * Environment:
 *   WILLY_REMOTE_AGENT_PORT=4050
 *   WILLY_REMOTE_AGENT_BIND=127.0.0.1
 *   WILLY_REMOTE_HOME=<directory for token/config/audit>
 */

import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { spawn, execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.WILLY_REMOTE_AGENT_PORT || 4050);
const BIND = String(process.env.WILLY_REMOTE_AGENT_BIND || "127.0.0.1");
const USER_HOME = os.homedir();
const APP_HOME = process.env.WILLY_REMOTE_HOME
  ? path.resolve(process.env.WILLY_REMOTE_HOME)
  : path.join(process.env.LOCALAPPDATA || path.join(USER_HOME, "AppData", "Local"), "WillyAI-GitHub", "remote-agent");
const TOKEN_FILE = path.join(APP_HOME, "token.txt");
const CONFIG_FILE = path.join(APP_HOME, "config.json");
const AUDIT_FILE = path.join(APP_HOME, "audit.ndjson");
const MAX_BODY = 2 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_OUTPUT = 4 * 1024 * 1024;
const APPROVAL_TTL_MS = 2 * 60 * 1000;
const RELAY_URL = String(process.env.WILLY_REMOTE_RELAY_URL || "").replace(/\/$/, "");
const RELAY_SECRET = String(process.env.WILLY_REMOTE_RELAY_SECRET || "");
const RELAY_ALLOW_HTTP = process.env.WILLY_REMOTE_RELAY_ALLOW_HTTP === "1";

const startedAt = Date.now();
const approvals = new Map();

const DEFAULT_CONFIG = {
  approvalMode: "sensitive",
  allowReadOnlyWithoutApproval: true,
  fullAccess: false,
  allowedRoots: [USER_HOME],
  commandTimeoutMs: 45000,
  maxReadBytes: MAX_TEXT,
};

async function ensureHome() {
  await fs.mkdir(APP_HOME, { recursive: true });
}

async function ensureToken() {
  await ensureHome();
  try {
    const current = (await fs.readFile(TOKEN_FILE, "utf8")).trim();
    if (current.length >= 32) return current;
  } catch {}
  const token = randomBytes(32).toString("hex");
  await fs.writeFile(TOKEN_FILE, token + "\n", { encoding: "utf8", mode: 0o600 });
  return token;
}

async function loadConfig() {
  await ensureHome();
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      allowedRoots: Array.isArray(raw.allowedRoots) && raw.allowedRoots.length
        ? raw.allowedRoots.map((x) => path.resolve(String(x)))
        : DEFAULT_CONFIG.allowedRoots,
    };
  } catch {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), { encoding: "utf8", mode: 0o600 });
    return { ...DEFAULT_CONFIG };
  }
}

let token = await ensureToken();
let config = await loadConfig();

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function isLocal(req) {
  const addr = req.socket?.remoteAddress || "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function authenticated(req) {
  const auth = String(req.headers.authorization || "");
  return auth === `Bearer ${token}`;
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

async function audit(event, data = {}) {
  try {
    await ensureHome();
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...data }) + "\n";
    await fs.appendFile(AUDIT_FILE, line, { encoding: "utf8", mode: 0o600 });
  } catch {}
}

function normalizeRoots() {
  return (config.allowedRoots || []).map((r) => path.resolve(String(r)));
}

function pathInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertAllowedPath(inputPath) {
  const target = path.resolve(String(inputPath || ""));
  if (config.fullAccess) return target;
  const roots = normalizeRoots();
  if (!roots.some((root) => pathInside(root, target))) {
    throw new Error("Ruta fuera de las carpetas autorizadas.");
  }
  return target;
}

async function fileInfo(p) {
  const target = assertAllowedPath(p);
  const stat = await fs.stat(target);
  return {
    path: target,
    name: path.basename(target),
    type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
  };
}

async function listDir(p) {
  const target = assertAllowedPath(p || USER_HOME);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const out = [];
  for (const entry of entries.slice(0, 2000)) {
    const child = path.join(target, entry.name);
    let stat;
    try { stat = await fs.stat(child); } catch { continue; }
    out.push({
      name: entry.name,
      path: child,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }
  return out;
}

async function readTextFile(p, encoding = "utf8") {
  const target = assertAllowedPath(p);
  const stat = await fs.stat(target);
  const limit = Math.min(Number(config.maxReadBytes || MAX_TEXT), MAX_TEXT);
  if (stat.size > limit) throw new Error(`Archivo demasiado grande para lectura de texto (${stat.size} bytes).`);
  const data = await fs.readFile(target);
  return {
    path: target,
    encoding,
    content: data.toString(encoding),
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
  };
}

async function writeTextFile(args) {
  const target = assertAllowedPath(args.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const mode = args.mode === "append" ? "appendFile" : "writeFile";
  const content = String(args.content ?? "");
  if (Buffer.byteLength(content) > MAX_TEXT) throw new Error("Contenido demasiado grande.");
  if (mode === "appendFile") await fs.appendFile(target, content, "utf8");
  else await fs.writeFile(target, content, "utf8");
  return fileInfo(target);
}

function runProcess(command, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || USER_HOME,
      windowsHide: true,
      shell: false,
      env: process.env,
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error("Tiempo de ejecución agotado."));
    }, Math.min(Number(opts.timeoutMs || config.commandTimeoutMs || 45000), 120000));

    const collect = (arr) => (chunk) => {
      bytes += chunk.length;
      if (bytes <= MAX_OUTPUT) arr.push(Buffer.from(chunk));
    };
    child.stdout?.on("data", collect(stdout));
    child.stderr?.on("data", collect(stderr));
    child.once("error", (err) => { clearTimeout(timer); reject(err); });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        truncated: bytes > MAX_OUTPUT,
      });
    });
  });
}

async function shellExec(args) {
  const cwd = assertAllowedPath(args.cwd || USER_HOME);
  const shell = String(args.shell || "powershell").toLowerCase();
  const command = String(args.command || "");
  if (!command.trim()) throw new Error("Comando vacío.");
  if (shell === "powershell") {
    return runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd, timeoutMs: args.timeoutMs });
  }
  if (shell === "cmd") {
    return runProcess("cmd.exe", ["/d", "/s", "/c", command], { cwd, timeoutMs: args.timeoutMs });
  }
  if (shell === "direct") {
    const exe = String(args.executable || "");
    const argv = Array.isArray(args.args) ? args.args.map(String) : [];
    if (!exe) throw new Error("Falta executable.");
    return runProcess(exe, argv, { cwd, timeoutMs: args.timeoutMs });
  }
  throw new Error("Shell no soportada.");
}

async function processList() {
  if (process.platform === "win32") {
    const result = await runProcess("powershell.exe", [
      "-NoProfile", "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Depth 3 -Compress"
    ], { cwd: USER_HOME, timeoutMs: 15000 });
    if (result.exitCode !== 0) throw new Error(result.stderr || "No se pudieron listar procesos.");
    const parsed = JSON.parse(result.stdout || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  const result = await runProcess("ps", ["-eo", "pid,ppid,comm,args"], { cwd: USER_HOME, timeoutMs: 15000 });
  return { raw: result.stdout };
}

async function killProcess(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) throw new Error("PID no válido.");
  if (n === process.pid) throw new Error("El agente no puede terminarse a sí mismo mediante esta acción.");
  if (process.platform === "win32") {
    const result = await runProcess("taskkill.exe", ["/PID", String(n), "/T", "/F"], { cwd: USER_HOME, timeoutMs: 15000 });
    return result;
  }
  process.kill(n, "SIGTERM");
  return { ok: true };
}

async function screenshot() {
  if (process.platform !== "win32") throw new Error("Captura de pantalla v1 disponible solo en Windows.");
  const tmp = path.join(os.tmpdir(), `willy-screen-${randomUUID()}.png`);
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height",
    "$g=[System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)",
    `$bmp.Save('${tmp.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png)`,
    "$g.Dispose();$bmp.Dispose()"
  ].join(";");
  const result = await runProcess("powershell.exe", ["-NoProfile", "-Command", script], { cwd: USER_HOME, timeoutMs: 20000 });
  if (result.exitCode !== 0) throw new Error(result.stderr || "No se pudo capturar la pantalla.");
  try {
    const bytes = await fs.readFile(tmp);
    if (bytes.length > 12 * 1024 * 1024) throw new Error("Captura demasiado grande.");
    return { mime: "image/png", base64: bytes.toString("base64"), bytes: bytes.length };
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

const ACTIONS = {
  "system.info": { sensitive: false, run: async () => ({
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    username: os.userInfo().username,
    home: USER_HOME,
    cpus: os.cpus().length,
    memoryTotal: os.totalmem(),
    memoryFree: os.freemem(),
    uptime: os.uptime(),
    node: process.version,
    agentPid: process.pid,
    agentUptime: Math.round((Date.now() - startedAt) / 1000),
  }) },
  "fs.list": { sensitive: false, run: (args) => listDir(args.path) },
  "fs.stat": { sensitive: false, run: (args) => fileInfo(args.path) },
  "fs.read": { sensitive: false, run: (args) => readTextFile(args.path, args.encoding || "utf8") },
  "fs.write": { sensitive: true, run: (args) => writeTextFile(args) },
  "fs.mkdir": { sensitive: true, run: async (args) => {
    const target = assertAllowedPath(args.path);
    await fs.mkdir(target, { recursive: true });
    return fileInfo(target);
  } },
  "fs.delete": { sensitive: true, run: async (args) => {
    const target = assertAllowedPath(args.path);
    await fs.rm(target, { recursive: Boolean(args.recursive), force: Boolean(args.force) });
    return { deleted: target };
  } },
  "fs.move": { sensitive: true, run: async (args) => {
    const from = assertAllowedPath(args.from);
    const to = assertAllowedPath(args.to);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    return { from, to };
  } },
  "fs.copy": { sensitive: true, run: async (args) => {
    const from = assertAllowedPath(args.from);
    const to = assertAllowedPath(args.to);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.cp(from, to, { recursive: Boolean(args.recursive), force: Boolean(args.force) });
    return { from, to };
  } },
  "shell.exec": { sensitive: true, run: (args) => shellExec(args) },
  "process.list": { sensitive: false, run: () => processList() },
  "process.kill": { sensitive: true, run: (args) => killProcess(args.pid) },
  "screenshot.capture": { sensitive: true, run: () => screenshot() },
};

function actionCatalog() {
  return Object.entries(ACTIONS).map(([name, def]) => ({ name, sensitive: def.sensitive }));
}

function needsApproval(def) {
  if (config.approvalMode === "always") return true;
  if (config.approvalMode === "none") return false;
  return def.sensitive || !config.allowReadOnlyWithoutApproval;
}

async function executeAction(kind, args, meta = {}) {
  const def = ACTIONS[kind];
  if (!def) throw new Error("Acción no soportada.");
  const started = Date.now();
  await audit("action.start", { kind, meta });
  try {
    const result = await def.run(args || {});
    await audit("action.ok", { kind, elapsedMs: Date.now() - started, meta });
    return result;
  } catch (error) {
    await audit("action.error", { kind, elapsedMs: Date.now() - started, error: error instanceof Error ? error.message : String(error), meta });
    throw error;
  }
}

function createApproval(kind, args, meta) {
  const id = randomUUID();
  const entry = {
    id,
    kind,
    args,
    meta,
    createdAt: Date.now(),
    expiresAt: Date.now() + APPROVAL_TTL_MS,
    status: "pending",
  };
  approvals.set(id, entry);
  setTimeout(() => {
    const current = approvals.get(id);
    if (current?.status === "pending") {
      current.status = "expired";
      audit("approval.expired", { id, kind }).catch(() => {});
    }
  }, APPROVAL_TTL_MS + 250);
  return entry;
}

function publicApproval(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    args: entry.args,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    status: entry.status,
    requester: entry.meta?.requester || "remote",
  };
}

async function handleAction(req, res, payload) {
  const kind = String(payload.kind || "");
  const args = payload.args && typeof payload.args === "object" ? payload.args : {};
  const def = ACTIONS[kind];
  if (!def) return json(res, 400, { ok: false, error: "Acción no soportada." });

  const meta = {
    requester: String(payload.requester || req.headers["x-willy-requester"] || "remote"),
    ip: req.socket?.remoteAddress || "",
  };

  if (needsApproval(def)) {
    const entry = createApproval(kind, args, meta);
    await audit("approval.requested", { id: entry.id, kind, meta });
    return json(res, 202, { ok: true, pending: true, approval: publicApproval(entry) });
  }

  try {
    const result = await executeAction(kind, args, meta);
    return json(res, 200, { ok: true, pending: false, result });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function approve(id, allow) {
  const entry = approvals.get(id);
  if (!entry) throw new Error("Solicitud no encontrada.");
  if (entry.status !== "pending") throw new Error("La solicitud ya no está pendiente.");
  if (Date.now() > entry.expiresAt) {
    entry.status = "expired";
    throw new Error("La solicitud ha caducado.");
  }
  if (!allow) {
    entry.status = "denied";
    await audit("approval.denied", { id, kind: entry.kind });
    return { denied: true };
  }
  entry.status = "approved";
  await audit("approval.approved", { id, kind: entry.kind });
  const result = await executeAction(entry.kind, entry.args, entry.meta);
  entry.status = "completed";
  entry.result = result;
  return { approved: true, result };
}

async function waitForApprovalResult(id, timeoutMs = APPROVAL_TTL_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const entry = approvals.get(id);
    if (!entry) throw new Error("Solicitud de aprobación no encontrada.");
    if (entry.status === "completed") return { approved: true, result: entry.result };
    if (entry.status === "denied") return { approved: false, denied: true };
    if (entry.status === "expired") return { approved: false, expired: true };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { approved: false, expired: true };
}

async function handleMcp(req, res, payload) {
  const id = payload.id ?? null;
  const method = String(payload.method || "");
  const reply = (result) => json(res, 200, { jsonrpc: "2.0", id, result });
  const fail = (code, message) => json(res, 200, { jsonrpc: "2.0", id, error: { code, message } });

  if (method === "initialize") {
    return reply({
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "willy-remote-agent", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized") return json(res, 202, {});
  if (method === "tools/list") {
    const tools = actionCatalog().map((x) => ({
      name: x.name,
      description: x.sensitive
        ? `${x.name} — requiere aprobación local explícita por defecto.`
        : `${x.name} — acción de solo lectura.`,
      inputSchema: { type: "object", additionalProperties: true },
    }));
    return reply({ tools });
  }
  if (method === "tools/call") {
    const name = String(payload.params?.name || "");
    const args = payload.params?.arguments || {};
    const def = ACTIONS[name];
    if (!def) return fail(-32602, "Herramienta no soportada.");
    if (needsApproval(def)) {
      const entry = createApproval(name, args, { requester: "mcp", ip: req.socket?.remoteAddress || "" });
      await audit("approval.requested", { id: entry.id, kind: name, meta: entry.meta });
      const decision = await waitForApprovalResult(entry.id);
      if (decision.approved) {
        return reply({ content: [{ type: "text", text: JSON.stringify(decision.result) }], isError: false });
      }
      const reason = decision.denied ? "Acción denegada por el usuario." : "La aprobación caducó.";
      return reply({ content: [{ type: "text", text: reason }], isError: true });
    }
    try {
      const result = await executeAction(name, args, { requester: "mcp", ip: req.socket?.remoteAddress || "" });
      return reply({ content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
    } catch (error) {
      return reply({ content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
    }
  }
  return fail(-32601, "Método MCP no soportado.");
}

async function relayLoop() {
  if (!RELAY_URL || !RELAY_SECRET) return;
  let relay;
  try {
    relay = new URL(RELAY_URL);
  } catch {
    await audit("relay.config_error", { error: "URL de relay no válida." });
    return;
  }
  if (relay.protocol !== "https:" && !(RELAY_ALLOW_HTTP && relay.protocol === "http:")) {
    await audit("relay.config_error", { error: "El relay debe usar HTTPS." });
    return;
  }
  await audit("relay.enabled", { url: relay.origin });

  while (true) {
    try {
      const poll = await fetch(RELAY_URL + "/agent/poll", {
        method: "POST",
        headers: { Authorization: `Bearer ${RELAY_SECRET}`, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(30000),
      });
      if (!poll.ok) throw new Error("Relay poll " + poll.status);
      const data = await poll.json();
      if (!data?.job) continue;

      const job = data.job;
      let result = null;
      let error = "";
      try {
        const local = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(job.payload),
          signal: AbortSignal.timeout(APPROVAL_TTL_MS + 10000),
        });
        result = await local.json();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      const sent = await fetch(RELAY_URL + "/agent/result", {
        method: "POST",
        headers: { Authorization: `Bearer ${RELAY_SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id, result, error: error || undefined }),
        signal: AbortSignal.timeout(10000),
      });
      if (!sent.ok) throw new Error("Relay result " + sent.status);
      await audit("relay.job_completed", { id: job.id, error: error || undefined });
    } catch (error) {
      await audit("relay.error", { error: error instanceof Error ? error.message : String(error) });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, {
        ok: true,
        name: "WILLY Remote Agent",
        version: "1.0.0",
        pid: process.pid,
        bind: BIND,
        port: PORT,
        uptime: Math.round((Date.now() - startedAt) / 1000),
        approvalMode: config.approvalMode,
        pending: [...approvals.values()].filter((x) => x.status === "pending").length,
      });
    }

    if (!authenticated(req)) {
      await audit("auth.denied", { path: pathname, ip: req.socket?.remoteAddress || "" });
      return json(res, 401, { ok: false, error: "No autorizado." });
    }

    if (req.method === "GET" && pathname === "/v1/capabilities") {
      return json(res, 200, { ok: true, actions: actionCatalog(), allowedRoots: normalizeRoots(), fullAccess: Boolean(config.fullAccess), approvalMode: config.approvalMode });
    }

    if (req.method === "GET" && pathname === "/v1/approvals") {
      if (!isLocal(req)) return json(res, 403, { ok: false, error: "Las aprobaciones solo se administran desde el PC local." });
      return json(res, 200, { ok: true, approvals: [...approvals.values()].map(publicApproval).sort((a, b) => b.createdAt - a.createdAt) });
    }

    if (req.method === "POST" && pathname === "/v1/action") {
      const payload = await bodyJson(req);
      return handleAction(req, res, payload);
    }

    const approvalMatch = /^\/v1\/approvals\/([^/]+)\/(approve|deny)$/.exec(pathname);
    if (req.method === "POST" && approvalMatch) {
      if (!isLocal(req)) return json(res, 403, { ok: false, error: "La aprobación debe realizarse desde el PC local." });
      try {
        const result = await approve(approvalMatch[1], approvalMatch[2] === "approve");
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (req.method === "POST" && pathname === "/v1/config/reload") {
      if (!isLocal(req)) return json(res, 403, { ok: false, error: "Solo disponible desde localhost." });
      config = await loadConfig();
      token = await ensureToken();
      return json(res, 200, { ok: true, config: { ...config, token: undefined } });
    }

    if (req.method === "POST" && pathname === "/mcp") {
      const payload = await bodyJson(req);
      return handleMcp(req, res, payload);
    }

    return json(res, 404, { ok: false, error: "Ruta no encontrada." });
  } catch (error) {
    await audit("server.error", { error: error instanceof Error ? error.message : String(error) });
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, BIND, async () => {
  await audit("agent.started", { pid: process.pid, bind: BIND, port: PORT });
  console.log(`[willy-remote-agent] activo en http://${BIND}:${PORT}`);
  console.log(`[willy-remote-agent] token: ${TOKEN_FILE}`);
  console.log(`[willy-remote-agent] config: ${CONFIG_FILE}`);
  if (RELAY_URL && RELAY_SECRET) {
    console.log(`[willy-remote-agent] relay propio: ${RELAY_URL}`);
    void relayLoop();
  }
});

async function shutdown(signal) {
  await audit("agent.stopping", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
