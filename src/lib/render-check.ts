// Navegador sin ventana (Edge o Chrome, que ya están en Windows) para ver LA PANTALLA de verdad: volcar lo que se
// dibuja y hacer capturas. Todo es opcional: si no hay navegador o falla, la Autoconstrucción sigue sin capturas.

export async function findBrowser(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const candidates = [
    env["WILLY_BROWSER"],
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    env["LOCALAPPDATA"] ? `${env["LOCALAPPDATA"]}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

type Ran = { code: number; stdout: string; stderr: string; timedOut: boolean };

async function runBrowser(exe: string, args: string[], timeoutMs: number): Promise<Ran> {
  const { spawn } = await import("node:child_process");
  return await new Promise<Ran>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, { windowsHide: true });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: error instanceof Error ? error.message : String(error), timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* ya cerrado */ }
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { if (stdout.length < 8_000_000) stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { if (stderr.length < 20_000) stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr, timedOut }); });
  });
}

/** Cada ejecución usa un perfil temporal propio: si no, Edge lo «entrega» al que ya tienes abierto y no hace nada. */
async function withProfile<T>(fn: (profile: string) => Promise<T>): Promise<T> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "willy-browser-"));
  try {
    return await fn(profile);
  } finally {
    await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

const COMMON = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--hide-scrollbars"];

export async function dumpDom(exe: string, url: string, opts: { budgetMs?: number; timeoutMs?: number } = {}): Promise<{ ok: boolean; dom: string; error?: string }> {
  return await withProfile(async (profile) => {
    const ran = await runBrowser(exe, [...COMMON, `--user-data-dir=${profile}`, `--virtual-time-budget=${opts.budgetMs ?? 8000}`, "--dump-dom", url], opts.timeoutMs ?? 45_000);
    if (ran.timedOut) return { ok: false, dom: "", error: "El navegador tardó demasiado." };
    if (ran.code !== 0 || ran.stdout.trim().length < 50) return { ok: false, dom: "", error: `El navegador no devolvió la pantalla (código ${ran.code}). ${ran.stderr.slice(0, 200)}`.trim() };
    return { ok: true, dom: ran.stdout };
  });
}

/** `extraArgs` (rev24): opciones de más para el navegador (por ejemplo, en Linux como administrador, «--no-sandbox»). */
export async function screenshot(exe: string, url: string, outFile: string, opts: { width?: number; height?: number; budgetMs?: number; timeoutMs?: number; extraArgs?: string[] } = {}): Promise<{ ok: boolean; error?: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  return await withProfile(async (profile) => {
    const ran = await runBrowser(exe, [...COMMON, ...(opts.extraArgs ?? []), `--user-data-dir=${profile}`, `--virtual-time-budget=${opts.budgetMs ?? 8000}`, `--window-size=${opts.width ?? 1366},${opts.height ?? 900}`, `--screenshot=${outFile}`, url], opts.timeoutMs ?? 45_000);
    if (ran.timedOut) return { ok: false, error: "El navegador tardó demasiado." };
    try {
      const stat = await fs.stat(outFile);
      if (stat.size < 80) return { ok: false, error: "La captura salió vacía." };
    } catch {
      return { ok: false, error: `El navegador no guardó la captura (código ${ran.code}).` };
    }
    return { ok: true };
  });
}
