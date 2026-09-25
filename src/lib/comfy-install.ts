// Instalación automática de ComfyUI + los nodos de avatar (movimiento y labios), con git clone y pip
// install reales, en segundo plano y con progreso. Nada de instrucciones manuales: se pulsa un botón
// y WILLY hace el trabajo él solo en este equipo. Los pesos de los modelos (varios GB cada uno) siguen
// necesitando ComfyUI-Manager o una descarga aparte: eso se dice claro al terminar, no se inventa una
// dirección de descarga fija para varios gigas de datos que cambian de sitio con frecuencia.

export type ComfyInstallJob = { id: string; status: "activo" | "listo" | "error"; pct: number; step: string; text: string; error: string; log: string[] };

const CUSTOM_NODES: { name: string; repo: string }[] = [
  { name: "ComfyUI-VideoHelperSuite", repo: "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git" },
  { name: "ComfyUI-LivePortraitKJ", repo: "https://github.com/kijai/ComfyUI-LivePortraitKJ.git" },
  { name: "ComfyUI-LatentSync-Node", repo: "https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper.git" },
];
const OFFICIAL_COMFY_REPO = "https://github.com/comfyanonymous/ComfyUI.git";

export type ComfyInstallDeps = {
  spawnImpl?: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    on: (event: string, cb: (...a: unknown[]) => void) => void;
    stdout?: { on: (event: string, cb: (d: Buffer) => void) => void };
    stderr?: { on: (event: string, cb: (d: Buffer) => void) => void };
  };
  existsCheck?: (path: string) => Promise<boolean>;
};

async function mods() {
  return { fs: await import("node:fs/promises"), path: await import("node:path") };
}

async function exists(p: string): Promise<boolean> {
  const { fs } = await mods();
  try { await fs.stat(p); return true; } catch { return false; }
}

/** Ejecuta un comando y va anotando lo que dice; nunca se queda colgado (límite de tiempo real). */
async function run(cmd: string, args: string[], cwd: string, job: ComfyInstallJob, deps: ComfyInstallDeps, timeoutMs = 20 * 60_000): Promise<void> {
  const { spawn } = await import("node:child_process");
  const spawnImpl = deps.spawnImpl ?? spawn;
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (err: Error | null) => { if (done) return; done = true; err ? reject(err) : resolve(); };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(cmd, args, { cwd, windowsHide: true, shell: false }) as ReturnType<typeof spawn>;
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const timer = setTimeout(() => { child.kill(); finish(new Error(`«${cmd} ${args[0] ?? ""}» tardó demasiado y se detuvo.`)); }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => { const line = d.toString("utf8").trim().split("\n").pop(); if (line) job.text = line.slice(0, 160); });
    child.stderr?.on("data", (d: Buffer) => { const line = d.toString("utf8").trim().split("\n").pop(); if (line) job.log.push(line.slice(0, 200)); });
    child.on("error", (err: unknown) => { clearTimeout(timer); finish(new Error(`No encuentro «${cmd}» instalado en este equipo. ${err instanceof Error ? err.message : ""}`.trim())); });
    child.on("close", (code: number | null) => { clearTimeout(timer); code === 0 ? finish(null) : finish(new Error(`«${cmd} ${args.join(" ")}» terminó con el error ${code}.`)); });
  });
}

async function cloneOrPull(repo: string, dest: string, job: ComfyInstallJob, deps: ComfyInstallDeps): Promise<void> {
  if (await exists(dest)) {
    job.text = `Actualizando ${dest.split(/[/\\]/).pop()}…`;
    await run("git", ["-C", dest, "pull", "--ff-only"], dest, job, deps).catch(() => {
      // Si falla el pull (cambios locales, red...) seguimos con lo que ya haya: no rompemos una instalación existente.
      job.log.push(`No se pudo actualizar ${dest}, se sigue con la copia que ya había.`);
    });
    return;
  }
  job.text = `Descargando ${repo.split("/").pop()}…`;
  const parent = dest.split(/[/\\]/).slice(0, -1).join("/");
  const { fs } = await mods();
  await fs.mkdir(parent, { recursive: true });
  await run("git", ["clone", "--depth", "1", repo, dest], parent, job, deps, 30 * 60_000);
}

async function pipInstall(python: string, requirements: string, cwd: string, job: ComfyInstallJob, deps: ComfyInstallDeps): Promise<void> {
  if (!(await exists(requirements))) return;
  job.text = `Instalando dependencias de ${cwd.split(/[/\\]/).pop()}…`;
  await run(python, ["-m", "pip", "install", "-r", requirements], cwd, job, deps, 25 * 60_000);
}

/**
 * Instala ComfyUI + los 3 nodos de avatar en `dir/avatar/ComfyUI`, con git y pip reales del equipo.
 * No descarga los pesos de los modelos (varios GB, cambian de sitio): eso queda para ComfyUI-Manager,
 * que se abre solo dentro de ComfyUI la primera vez que se arranca. Se dice así de claro, sin prometer
 * lo que no se puede garantizar sin inventar una dirección de descarga que luego falle.
 */
export async function installComfy(dir: string, job: ComfyInstallJob, deps: ComfyInstallDeps = {}, python = "python"): Promise<{ comfyDir: string; installedNodes: string[] }> {
  const { path } = await mods();
  const comfyDir = path.join(dir, "avatar", "ComfyUI");

  job.step = "ComfyUI";
  job.pct = 5;
  await cloneOrPull(OFFICIAL_COMFY_REPO, comfyDir, job, deps);
  job.pct = 35;
  await pipInstall(python, path.join(comfyDir, "requirements.txt"), comfyDir, job, deps);
  job.pct = 45;

  const nodesDir = path.join(comfyDir, "custom_nodes");
  const installedNodes: string[] = [];
  let i = 0;
  for (const node of CUSTOM_NODES) {
    job.step = node.name;
    const dest = path.join(nodesDir, node.name);
    await cloneOrPull(node.repo, dest, job, deps);
    await pipInstall(python, path.join(dest, "requirements.txt"), dest, job, deps);
    installedNodes.push(node.name);
    i += 1;
    job.pct = 45 + Math.round((i / CUSTOM_NODES.length) * 45);
  }

  job.step = "Comprobando ComfyUI-Manager";
  const hasManager = await exists(path.join(nodesDir, "ComfyUI-Manager"));
  if (!hasManager) {
    await cloneOrPull("https://github.com/ltdrdata/ComfyUI-Manager.git", path.join(nodesDir, "ComfyUI-Manager"), job, deps).catch((e) => {
      job.log.push(`No se pudo instalar ComfyUI-Manager solo: ${e instanceof Error ? e.message : e}. Se puede añadir a mano más tarde.`);
    });
  }

  job.pct = 95;
  job.step = "Listo";
  job.text = "ComfyUI y los nodos de avatar están instalados. Ábrelo una vez con «run_nvidia_gpu.bat» (o «python main.py») para que descargue los pesos que falten con ComfyUI-Manager: esos archivos pesan varios GB y no se pueden meter en esta actualización.";
  return { comfyDir, installedNodes };
}
