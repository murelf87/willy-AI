import { performance } from "node:perf_hooks";
import net from "node:net";

const SPEED_HOST = "https://speed.cloudflare.com";
const UA = "WILLY-AI-SpeedTest/1.0";

export type NetworkInfo = {
  ip: string;
  country: string;
  edge: string;
  adapter?: { name: string; description: string; linkSpeed: string };
};

export type LatencyResult = {
  latencyMs: number;
  jitterMs: number;
  p95Ms: number;
  lossPct: number | null;
  samples: number[];
  lossMethod: string;
};

export type ThroughputResult = {
  mbps: number;
  bytes: number;
  durationMs: number;
  streams: number;
  provider: string;
};

const round = (n: number, digits = 1) => {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

async function fetchTimed(url: string, init: RequestInit = {}, timeout = 15000): Promise<{ response: Response; ms: number }> {
  const started = performance.now();
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "User-Agent": UA, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeout),
  });
  return { response, ms: performance.now() - started };
}

export async function networkInfo(): Promise<NetworkInfo> {
  let ip = ""; let country = ""; let edge = "";
  try {
    const { response } = await fetchTimed(`${SPEED_HOST}/cdn-cgi/trace?ts=${Date.now()}`, {}, 8000);
    if (response.ok) {
      const text = await response.text();
      const values = Object.fromEntries(text.split(/\r?\n/).map((line) => line.split("=", 2)).filter((x) => x.length === 2));
      ip = String(values["ip"] ?? "");
      country = String(values["loc"] ?? "");
      edge = String(values["colo"] ?? "");
    }
  } catch { /* información opcional */ }

  let adapter: NetworkInfo["adapter"];
  if (process.platform === "win32") {
    try {
      const { execFile } = await import("node:child_process");
      const stdout = await new Promise<string>((resolve) => {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
          "$a=Get-NetAdapter -Physical | Where-Object {$_.Status -eq \"Up\"} | Sort-Object LinkSpeed -Descending | Select-Object -First 1 Name,InterfaceDescription,LinkSpeed; if($a){$a|ConvertTo-Json -Compress}",
        ], { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 }, (_err, out) => resolve(String(out ?? "").trim()));
      });
      if (stdout) {
        const a = JSON.parse(stdout) as { Name?: unknown; InterfaceDescription?: unknown; LinkSpeed?: unknown };
        adapter = { name: String(a.Name ?? ""), description: String(a.InterfaceDescription ?? ""), linkSpeed: String(a.LinkSpeed ?? "") };
      }
    } catch { /* opcional */ }
  }
  return { ip, country, edge, ...(adapter ? { adapter } : {}) };
}

async function tcpProbe(host = "1.1.1.1", port = 443, timeout = 1500): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (ok: boolean) => { if (done) return; done = true; socket.destroy(); resolve(ok); };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function measureLatency(samples = 10): Promise<LatencyResult> {
  const count = Math.max(6, Math.min(20, samples));
  try {
    const warm = await fetchTimed(`${SPEED_HOST}/__down?bytes=1&warm=${Date.now()}`, {}, 6000);
    await warm.response.arrayBuffer();
  } catch { /* el muestreo siguiente dará el error útil */ }

  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const { response, ms } = await fetchTimed(`${SPEED_HOST}/__down?bytes=1&r=${Date.now()}-${i}`, {}, 6000);
    if (!response.ok) throw new Error(`El servidor de medición respondió ${response.status}.`);
    await response.arrayBuffer();
    values.push(ms);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? median;
  const diffs = values.slice(1).map((v, i) => Math.abs(v - values[i]!));
  const jitter = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;

  const probes = await Promise.all(Array.from({ length: 10 }, () => tcpProbe()));
  const failures = probes.filter((ok) => !ok).length;
  return {
    latencyMs: round(median, 1),
    jitterMs: round(jitter, 1),
    p95Ms: round(p95, 1),
    lossPct: round((failures / probes.length) * 100, 1),
    samples: values.map((v) => round(v, 1)),
    lossMethod: "10 conexiones TCP a 1.1.1.1:443",
  };
}

async function consumeDownload(bytes: number, id: string): Promise<number> {
  const { response } = await fetchTimed(`${SPEED_HOST}/__down?bytes=${bytes}&r=${Date.now()}-${id}`, {}, 30000);
  if (!response.ok || !response.body) throw new Error(`Descarga de prueba: HTTP ${response.status}.`);
  const reader = response.body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value?.byteLength ?? 0;
  }
  return total;
}

export async function measureDownload(): Promise<ThroughputResult> {
  const warmBytes = 2_000_000;
  const warmStart = performance.now();
  const warmDone = await consumeDownload(warmBytes, "warm");
  const warmSec = Math.max(0.05, (performance.now() - warmStart) / 1000);
  const warmMbps = (warmDone * 8) / warmSec / 1_000_000;
  let streams = 3; let each = 5_000_000;
  if (warmMbps >= 500) { streams = 4; each = 25_000_000; }
  else if (warmMbps >= 200) { streams = 4; each = 15_000_000; }
  else if (warmMbps >= 80) { streams = 4; each = 10_000_000; }
  else if (warmMbps >= 25) { streams = 3; each = 7_000_000; }

  const started = performance.now();
  const totals = await Promise.all(Array.from({ length: streams }, (_, i) => consumeDownload(each, `d${i}`)));
  const durationMs = performance.now() - started;
  const bytes = totals.reduce((a, b) => a + b, 0);
  const mbps = (bytes * 8) / Math.max(0.001, durationMs / 1000) / 1_000_000;
  return { mbps: round(mbps, 1), bytes, durationMs: round(durationMs, 0), streams, provider: "Cloudflare Speed Test" };
}

async function uploadOnce(bytes: number, id: string): Promise<number> {
  const body = Buffer.alloc(bytes, 0x61);
  const { response } = await fetchTimed(`${SPEED_HOST}/__up?r=${Date.now()}-${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  }, 30000);
  if (!response.ok) throw new Error(`Subida de prueba: HTTP ${response.status}.`);
  await response.arrayBuffer();
  return bytes;
}

export async function measureUpload(): Promise<ThroughputResult> {
  const warmBytes = 500_000;
  const warmStart = performance.now();
  await uploadOnce(warmBytes, "warm");
  const warmSec = Math.max(0.05, (performance.now() - warmStart) / 1000);
  const warmMbps = (warmBytes * 8) / warmSec / 1_000_000;
  let streams = 3; let each = 2_000_000;
  if (warmMbps >= 200) { streams = 4; each = 8_000_000; }
  else if (warmMbps >= 80) { streams = 4; each = 5_000_000; }
  else if (warmMbps >= 25) { streams = 3; each = 4_000_000; }

  const started = performance.now();
  const totals = await Promise.all(Array.from({ length: streams }, (_, i) => uploadOnce(each, `u${i}`)));
  const durationMs = performance.now() - started;
  const bytes = totals.reduce((a, b) => a + b, 0);
  const mbps = (bytes * 8) / Math.max(0.001, durationMs / 1000) / 1_000_000;
  return { mbps: round(mbps, 1), bytes, durationMs: round(durationMs, 0), streams, provider: "Cloudflare Speed Test" };
}

export function qualitySummary(input: { download: number; upload: number; latency: number; jitter: number; loss: number | null }) {
  const loss = input.loss ?? 0;
  const stability = Math.max(0, Math.min(100, Math.round(100 - input.jitter * 1.8 - loss * 7 - Math.max(0, input.latency - 25) * 0.22)));
  const uses = {
    browsing: input.download >= 15 && input.latency <= 150,
    streaming4k: input.download >= 50,
    videoCalls: input.upload >= 5 && input.latency <= 100 && input.jitter <= 30 && loss <= 2,
    gaming: input.download >= 20 && input.upload >= 5 && input.latency <= 45 && input.jitter <= 12 && loss <= 1,
  };
  let grade = "Mejorable";
  if (input.download >= 300 && input.upload >= 50 && input.latency <= 25 && input.jitter <= 8 && loss <= 0.5) grade = "Excelente";
  else if (input.download >= 100 && input.upload >= 20 && input.latency <= 50 && input.jitter <= 15 && loss <= 1) grade = "Muy buena";
  else if (input.download >= 30 && input.upload >= 10 && input.latency <= 90 && input.jitter <= 25 && loss <= 2) grade = "Buena";
  return { grade, stability, uses };
}
