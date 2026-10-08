import { promises as fs } from "node:fs";
import path from "node:path";

export const WILLY_AGENT_PORT = 4050;
const AGENT_BIND = "127.0.0.1";

function appHome(): string {
  const home = process.env["USERPROFILE"] || process.env["HOME"] || process.cwd();
  const local = process.env["LOCALAPPDATA"] || path.join(home, "AppData", "Local");
  return process.env["WILLY_REMOTE_HOME"] || path.join(local, "WillyAI-GitHub", "remote-agent");
}

function tokenFile(): string {
  return path.join(appHome(), "token.txt");
}

async function readToken(): Promise<string> {
  return (await fs.readFile(tokenFile(), "utf8")).trim();
}

function scriptPath(): string {
  return path.join(process.cwd(), "willy-remote-agent.mjs");
}

async function agentFetch<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const token = await readToken();
  const response = await fetch(`http://${AGENT_BIND}:${WILLY_AGENT_PORT}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(6000),
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `WILLY Remote Agent respondió ${response.status}.`);
  return data;
}

export type WillyAgentHealth = {
  ok: boolean;
  name: string;
  version: string;
  pid: number;
  bind: string;
  port: number;
  uptime: number;
  approvalMode: string;
  pending: number;
};

export type WillyAgentCapabilities = {
  ok: boolean;
  actions: Array<{ name: string; sensitive: boolean }>;
  allowedRoots: string[];
  fullAccess: boolean;
  approvalMode: string;
};

export type WillyAgentApproval = {
  id: string;
  kind: string;
  args: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  status: string;
  requester: string;
};

async function health(): Promise<WillyAgentHealth | null> {
  try {
    const response = await fetch(`http://${AGENT_BIND}:${WILLY_AGENT_PORT}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) return null;
    return await response.json() as WillyAgentHealth;
  } catch {
    return null;
  }
}

export async function willyAgentStatus(): Promise<{
  installed: boolean;
  running: boolean;
  detail: string;
  health: WillyAgentHealth | null;
  capabilities: WillyAgentCapabilities | null;
}> {
  const installed = await fs.stat(scriptPath()).then(() => true).catch(() => false);
  const current = await health();
  let capabilities: WillyAgentCapabilities | null = null;
  if (current) {
    try { capabilities = await agentFetch<WillyAgentCapabilities>("/v1/capabilities"); } catch { /* token may not exist yet */ }
  }
  return {
    installed,
    running: Boolean(current?.ok),
    health: current,
    capabilities,
    detail: !installed
      ? "El archivo willy-remote-agent.mjs no está instalado."
      : current?.ok
        ? `WILLY Remote Agent v${current.version} activo · ${capabilities?.actions.length ?? 0} herramientas · ${current.pending} pendiente(s) de aprobación.`
        : "WILLY Remote Agent instalado, pero detenido.",
  };
}

export async function startWillyAgent(): Promise<{ ok: boolean; error?: string }> {
  const before = await health();
  if (before?.ok) return { ok: true };
  const script = scriptPath();
  const exists = await fs.stat(script).then(() => true).catch(() => false);
  if (!exists) return { ok: false, error: "No se encontró willy-remote-agent.mjs." };

  try {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [script], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      cwd: process.cwd(),
      env: {
        ...process.env,
        WILLY_REMOTE_AGENT_PORT: String(WILLY_AGENT_PORT),
        WILLY_REMOTE_AGENT_BIND: AGENT_BIND,
      },
    });
    child.unref();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if ((await health())?.ok) return { ok: true };
    }
    return { ok: false, error: "El agente no confirmó el arranque." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function stopWillyAgent(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "win32") {
    const current = await health();
    if (!current?.pid) return { ok: true };
    try { process.kill(current.pid, "SIGTERM"); return { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  const current = await health();
  if (!current?.pid) return { ok: true };
  try {
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => {
      execFile("taskkill.exe", ["/PID", String(current.pid), "/T", "/F"], { windowsHide: true }, (error) => error ? reject(error) : resolve());
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listWillyAgentApprovals(): Promise<WillyAgentApproval[]> {
  const data = await agentFetch<{ ok: true; approvals: WillyAgentApproval[] }>("/v1/approvals");
  return data.approvals;
}

export async function decideWillyAgentApproval(id: string, allow: boolean): Promise<unknown> {
  const safe = id.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe) throw new Error("ID de aprobación no válido.");
  return agentFetch(`/v1/approvals/${safe}/${allow ? "approve" : "deny"}`, {
    method: "POST",
    body: "{}",
  });
}

export async function testWillyAgentReadOnly(): Promise<unknown> {
  return agentFetch("/v1/action", {
    method: "POST",
    body: JSON.stringify({ kind: "system.info", args: {}, requester: "WILLY UI" }),
  });
}
