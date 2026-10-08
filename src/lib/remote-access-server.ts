import { ensureRemoteServerRunning, REMOTE_PORT } from "@/lib/remote-server";
import {
  decideWillyAgentApproval,
  listWillyAgentApprovals,
  startWillyAgent,
  stopWillyAgent,
  testWillyAgentReadOnly,
  willyAgentStatus,
  type WillyAgentApproval,
} from "@/lib/willy-remote-agent-server";

export type RemoteAccessStatus = {
  willyAgent: Awaited<ReturnType<typeof willyAgentStatus>>;
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
  } catch {
    return false;
  }
}

async function desktopStatus(): Promise<RemoteAccessStatus["desktopCommander"]> {
  if (process.platform !== "win32") {
    return { installed: false, running: false, pids: [], detail: "Desktop Commander Remote está preparado para Windows." };
  }
  const found = await ps('$c=Get-Command desktop-commander -ErrorAction SilentlyContinue; if($c){$c.Source}');
  const pidsText = await ps('Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "(?i)desktop-commander(?:\\.cmd|\\.exe)?\\s+remote" } | Select-Object -ExpandProperty ProcessId');
  const pids = pidsText.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return {
    installed: Boolean(found),
    running: pids.length > 0,
    pids,
    detail: pids.length
      ? "Desktop Commander Remote está activo como respaldo."
      : found
        ? "Desktop Commander está instalado, pero detenido."
        : "Desktop Commander no está instalado. WILLY Remote Agent no depende de él.",
  };
}

export async function remoteAccessStatus(): Promise<RemoteAccessStatus> {
  const [willyAgent, desktopCommander, willyRunning] = await Promise.all([
    willyAgentStatus(),
    desktopStatus(),
    portOpen(REMOTE_PORT),
  ]);
  return {
    willyAgent,
    desktopCommander,
    willyRemote: {
      running: willyRunning,
      port: REMOTE_PORT,
      detail: willyRunning
        ? "Servidor móvil heredado de WILLY activo en el puerto " + REMOTE_PORT + "."
        : "Servidor móvil heredado de WILLY detenido.",
    },
  };
}

export async function startDesktopCommanderRemote(): Promise<{ ok: boolean; error?: string }> {
  const before = await desktopStatus();
  if (before.running) return { ok: true };
  if (!before.installed) return { ok: false, error: "Desktop Commander no está instalado o no está en PATH." };
  try {
    const { spawn } = await import("node:child_process");
    const child = spawn("cmd.exe", ["/d", "/s", "/c", "desktop-commander remote"], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();
    for (let i = 0; i < 12; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if ((await desktopStatus()).running) return { ok: true };
    }
    return { ok: false, error: "Desktop Commander Remote no confirmó el arranque." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
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
  return { ok: false, error: "El servidor remoto heredado de WILLY no confirmó el arranque." };
}

export async function stopWillyRemote(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "win32") return { ok: false, error: "Solo disponible en Windows." };
  const result = await ps('$ps=Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "(?i)willy-remote-server\\.mjs" }; foreach($p in $ps){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; "OK"');
  return result.includes("OK") ? { ok: true } : { ok: false, error: "No se pudo detener el servidor remoto heredado de WILLY." };
}

export async function startOwnRemoteAgent() {
  return startWillyAgent();
}

export async function stopOwnRemoteAgent() {
  return stopWillyAgent();
}

export async function ownRemoteApprovals(): Promise<WillyAgentApproval[]> {
  return listWillyAgentApprovals();
}

export async function decideOwnRemoteApproval(id: string, allow: boolean) {
  return decideWillyAgentApproval(id, allow);
}

export async function testOwnRemoteAgent() {
  return testWillyAgentReadOnly();
}
