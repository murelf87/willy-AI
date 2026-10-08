import path from "node:path";
import fs from "node:fs";
import { ensureRemoteServerRunning, REMOTE_PORT } from "@/lib/remote-server";

export const WILLY_AGENT_PORT = 4050;

export type WillyAgentPending = {
  id: string;
  name: string;
  summary: string;
  args?: unknown;
  createdAt: number;
};

export type RemoteAccessStatus = {
  willyAgent: {
    installed: boolean;
    running: boolean;
    port: number;
    mcpUrl: string;
    detail: string;
    approvalMode: string;
    pending: WillyAgentPending[];
  };
  desktopCommander: { installed: boolean; running: boolean; pids: number[]; detail: string };
  willyRemote: { running: boolean; port: number; detail: string };
};

async function ps(script: string, timeout = 8000): Promise<string> {
  const { execFile } = await import("node:child_process");
  return await new Promise<string>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout, maxBuffer: 512 * 1024 },
      (_error, stdout) => resolve(String(stdout ?? "").trim()),
    );
  });
}

async function portOpen(port: number): Promise<boolean> {
  try {
    const net = await import("node:net");
    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
      socket.setTimeout(800);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
    });
  } catch { return false; }
}

async function localJson<T>(pathname: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch("http://127.0.0.1:" + WILLY_AGENT_PORT + pathname, {
      ...init,
      signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch { return null; }
}

function findAgentScript(): string | null {
  const candidates = [
    path.join(process.cwd(), "willy-agent-server.mjs"),
    path.join(process.cwd(), "source", "willy-agent-server.mjs"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function agentStatus(): Promise<RemoteAccessStatus["willyAgent"]> {
  const script = findAgentScript();
  const health = await localJson<{ ok?: boolean; name?: string; version?: string; pending?: number }>("/health");
  const admin = health?.ok
    ? await localJson<{ ok?: boolean; pending?: WillyAgentPending[] }>("/admin/status")
    : null;
  const running = Boolean(health?.ok);
  const pending = Array.isArray(admin?.pending) ? admin!.pending! : [];
  return {
    installed: Boolean(script),
    running,
    port: WILLY_AGENT_PORT,
    mcpUrl: "http://127.0.0.1:" + WILLY_AGENT_PORT + "/mcp",
    approvalMode: "Preguntar siempre",
    pending,
    detail: running
      ? "WILLY Remote Agent " + (health?.version ?? "") + " activo · " + pending.length + " aprobación(es) pendiente(s)."
      : script
        ? "WILLY Remote Agent está instalado pero detenido."
        : "No se encontró willy-agent-server.mjs.",
  };
}

async function desktopStatus(): Promise<RemoteAccessStatus["desktopCommander"]> {
  if (process.platform !== "win32") return { installed: false, running: false, pids: [], detail: "Desktop Commander Remote está preparado para Windows." };
  const found = await ps('$c=Get-Command desktop-commander -ErrorAction SilentlyContinue; if($c){$c.Source}');
  const pidsText = await ps('Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "(?i)desktop-commander(?:\\.cmd|\\.exe)?\\s+remote" } | Select-Object -ExpandProperty ProcessId');
  const pids = pidsText.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return {
    installed: Boolean(found),
    running: pids.length > 0,
    pids,
    detail: pids.length ? "Desktop Commander Remote está activo como compatibilidad opcional."
      : found ? "Desktop Commander está instalado, pero ya no es necesario para WILLY Remote Agent."
      : "Desktop Commander no está instalado; WILLY puede usar su agente propio.",
  };
}

export async function remoteAccessStatus(): Promise<RemoteAccessStatus> {
  const [willyAgent, desktopCommander, willyRunning] = await Promise.all([
    agentStatus(), desktopStatus(), portOpen(REMOTE_PORT),
  ]);
  return {
    willyAgent,
    desktopCommander,
    willyRemote: {
      running: willyRunning,
      port: REMOTE_PORT,
      detail: willyRunning
        ? "Servidor remoto móvil de WILLY activo en el puerto " + REMOTE_PORT + "."
        : "El servidor remoto móvil de WILLY está detenido.",
    },
  };
}

export async function startWillyAgent(): Promise<{ ok: boolean; error?: string }> {
  const before = await agentStatus();
  if (before.running) return { ok: true };
  const script = findAgentScript();
  if (!script) return { ok: false, error: "willy-agent-server.mjs no está instalado." };
  try {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [script], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        WILLY_AGENT_PORT: String(WILLY_AGENT_PORT),
        WILLY_AGENT_BIND: "127.0.0.1",
        WILLY_ROOT: process.env["WILLY_ROOT"] ?? process.cwd(),
      },
    });
    child.unref();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if ((await agentStatus()).running) return { ok: true };
    }
    return { ok: false, error: "WILLY Remote Agent no confirmó el arranque." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function stopWillyAgent(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform === "win32") {
    const result = await ps('$ps=Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "(?i)willy-agent-server\\.mjs" }; foreach($p in $ps){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; "OK"');
    return result.includes("OK") ? { ok: true } : { ok: false, error: "No se pudo detener WILLY Remote Agent." };
  }
  try {
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve) => execFile("pkill", ["-f", "willy-agent-server.mjs"], () => resolve()));
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function approveWillyAgent(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await localJson<{ ok?: boolean; error?: string }>("/admin/approve", { method: "POST", body: JSON.stringify({ id }) });
  return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? "No se pudo aprobar la acción." };
}

export async function denyWillyAgent(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await localJson<{ ok?: boolean; error?: string }>("/admin/deny", { method: "POST", body: JSON.stringify({ id }) });
  return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? "No se pudo denegar la acción." };
}

export async function startDesktopCommanderRemote(): Promise<{ ok: boolean; error?: string }> {
  const before = await desktopStatus();
  if (before.running) return { ok: true };
  if (!before.installed) return { ok: false, error: "Desktop Commander no está instalado o no está en PATH." };
  try {
    const { spawn } = await import("node:child_process");
    const child = spawn("cmd.exe", ["/d", "/s", "/c", "desktop-commander remote"], { detached: true, windowsHide: true, stdio: "ignore" });
    child.unref();
    for (let i = 0; i < 12; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if ((await desktopStatus()).running) return { ok: true };
    }
    return { ok: false, error: "Desktop Commander Remote no confirmó el arranque." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function stopDesktopCommanderRemote(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "win32") return { ok: false, error: "Solo disponible en Windows." };
  const result = await ps('$ps=Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "(?i)desktop-commander(?:\\.cmd|\\.exe)?\\s+remote" }; foreach($p in $ps){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; "OK"');
  return result.includes("OK") ? { ok: true } : { ok: false, error: "No se pudo detener Desktop Commander Remote." };
}

export async function startWillyRemote(): Promise<{ ok: boolean; error?: string }> {
  const result = await ensureRemoteServerRunning();
  if (result.error) return { ok: false, error: result.error };
  for (let i = 0; i < 10; i += 1) {
    if (await portOpen(REMOTE_PORT)) return { ok: true };
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { ok: false, error: "El servidor remoto de WILLY no confirmó el arranque." };
}

export async function stopWillyRemote(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "win32") return { ok: false, error: "Solo disponible en Windows." };
  const result = await ps('$ps=Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "(?i)willy-remote-server\\.mjs" }; foreach($p in $ps){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; "OK"');
  return result.includes("OK") ? { ok: true } : { ok: false, error: "No se pudo detener el servidor remoto de WILLY." };
}
