import { bundleCheck, countInTexts, type Checks, type EvidenceItem, type EvidenceReport } from "@/lib/evidence";
import { diffPng } from "@/lib/png-diff";
import { dumpDom, findBrowser, screenshot } from "@/lib/render-check";

// Parte de servidor de las evidencias: cuenta textos en el programa compilado, arranca la versión nueva APARTE
// para probarla mientras la actual sigue funcionando, y (si hay navegador) hace capturas antes/después.
// Regla de oro: solo un fallo CLARO del cambio bloquea (no arranca, la página da error, falta un archivo, el texto
// pedido no está). Un problema del entorno (sin navegador, puerto ocupado, lentitud) se anota, pero no bloquea.

type HttpResult = { status: number; text: string };

async function httpGet(url: string, timeoutMs: number): Promise<HttpResult> {
  const http = await import("node:http");
  return await new Promise<HttpResult>((resolve) => {
    let done = false;
    const finish = (value: HttpResult) => {
      if (!done) {
        done = true;
        resolve(value);
      }
    };
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let text = "";
      res.on("data", (chunk) => { if (text.length < 2_000_000) text += String(chunk); });
      res.on("end", () => finish({ status: res.statusCode ?? 0, text }));
    });
    req.on("timeout", () => { req.destroy(); finish({ status: 0, text: "" }); });
    req.on("error", () => finish({ status: 0, text: "" }));
  });
}

async function collectFiles(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  if (depth > 6 || out.length > 600) return out;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectFiles(full, depth + 1, out);
    else if (/\.(?:m?js|css|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Cuántas veces aparece cada texto en el programa compilado de una carpeta. */
export async function countInDir(dir: string, needles: string[]): Promise<Record<string, number>> {
  const fs = await import("node:fs/promises");
  const texts: string[] = [];
  for (const file of await collectFiles(dir)) {
    try {
      const stat = await fs.stat(file);
      if (stat.size <= 6_000_000) texts.push(await fs.readFile(file, "utf8"));
    } catch {
      /* archivo que desaparece */
    }
  }
  return countInTexts(texts, needles);
}

export type Stage = { ok: boolean; gating: boolean; detail: string; url: string; close: () => Promise<void> };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Arranca el programa compilado (`opts.output`, por defecto `root/.output`; con la Autoconstrucción, el de la versión
 * candidata) en otro puerto y comprueba que responde, que su página carga y que sus archivos existen. Se arranca desde la
 * carpeta de la instalación (`root`) para que use los mismos datos que la versión que funciona.
 */
export async function startStage(root: string, opts: { port: number; waitMs?: number; output?: string }): Promise<Stage> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { spawn } = await import("node:child_process");
  const entry = path.join(opts.output ?? path.join(root, ".output"), "server", "index.mjs");
  const none = async () => undefined;
  try {
    await fs.access(entry);
  } catch {
    return { ok: false, gating: false, detail: "La compilación no dejó un servidor que probar aparte.", url: "", close: none };
  }
  // Si el puerto ya está ocupado se prueba el siguiente: un puerto ocupado no es culpa del cambio.
  let port = opts.port;
  for (let i = 0; i < 10; i += 1) {
    const busy = (await httpGet(`http://127.0.0.1:${port}/`, 800)).status > 0;
    if (!busy) break;
    port += 1;
  }
  // WILLY_STAGE: esta copia de prueba nunca aplica mejoras, ni recupera operaciones, ni confirma la salud de la versión instalada.
  const env = { ...process.env, PORT: String(port), NITRO_PORT: String(port), APP_PORT: String(port), HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", NODE_ENV: "production", WILLY_STAGE: "1" } as NodeJS.ProcessEnv;
  let output = "";
  let exited: number | null = null;
  const child = spawn(process.execPath, [entry], { cwd: root, env, windowsHide: true });
  child.stdout?.on("data", (chunk) => { output += String(chunk); });
  child.stderr?.on("data", (chunk) => { output += String(chunk); });
  child.on("close", (code) => { exited = code ?? -1; });
  child.on("error", (error) => { output += error.message; exited = -1; });
  const url = `http://127.0.0.1:${port}`;
  const close = async () => {
    try { child.kill(); } catch { /* ya cerrado */ }
    await wait(300);
  };
  const tail = () => output.trim().slice(-600);
  const until = Date.now() + (opts.waitMs ?? 60_000);
  let last = "no responde";
  while (Date.now() < until) {
    if (exited !== null) return { ok: false, gating: true, detail: `El programa nuevo se cierra nada más arrancar (código ${exited}). ${tail()}`.trim(), url, close };
    const api = await httpGet(`${url}/api/local-ai`, 4000);
    if (api.status === 200) {
      const page = await httpGet(`${url}/app`, 20_000);
      if (page.status >= 500) return { ok: false, gating: true, detail: `La página principal del programa nuevo da un error del servidor (${page.status}).`, url, close };
      if (page.status > 0) {
        const refs = [...new Set([...page.text.matchAll(/(?:src|href)="(\/[^"#?]+\.(?:js|css))(?:\?[^"]*)?"/g)].map((m) => m[1]!))].slice(0, 4);
        for (const ref of refs) {
          const res = await httpGet(`${url}${ref}`, 20_000);
          if (res.status === 404) return { ok: false, gating: true, detail: `A la página del programa nuevo le falta un archivo (${ref}).`, url, close };
        }
        return { ok: true, gating: false, detail: "El programa nuevo arranca, su página responde y sus archivos existen.", url, close };
      }
      last = "la página principal no responde";
    } else {
      last = api.status ? `el servidor responde ${api.status}` : "el servidor no responde";
    }
    await wait(1500);
  }
  return { ok: false, gating: false, detail: `No se pudo comprobar el arranque a tiempo (${last}). No se bloquea por esto.`, url, close };
}

const ERROR_MARKERS = /(Unexpected Application Error|Application error|Something went wrong|Cannot read properties of|ReferenceError|is not a function|Minified React error)/i;

export type CollectInput = {
  root: string;
  checks: Checks;
  newOutput: string;
  liveOutput: string | null;
  liveUrl: string | null;
  backupDir: string;
  stagePort: number;
  browserPath?: string | null;
  skipStage?: boolean;
  stageWaitMs?: number;
};

export type Collected = { items: EvidenceItem[]; gating: boolean; screenshots?: { backup: string; changedPct: number } };

export async function collectEvidence(input: CollectInput): Promise<Collected> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const items: EvidenceItem[] = [];
  let screenshots: Collected["screenshots"];
  const needles = [...input.checks.mustContain, ...input.checks.mustNotContain];

  // 1) Textos en el programa compilado: antes y después.
  if (needles.length) {
    try {
      const after = await countInDir(input.newOutput, needles);
      const before = input.liveOutput ? await countInDir(input.liveOutput, needles) : null;
      items.push(...bundleCheck(before, after, input.checks));
    } catch (error) {
      items.push({ kind: "compilado", status: "info", title: "Textos en el programa compilado", detail: `No se pudieron contar: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  // 2) La versión nueva, aparte y probada.
  if (!input.skipStage) {
    const stage = await startStage(input.root, { port: input.stagePort, output: input.newOutput, ...(input.stageWaitMs ? { waitMs: input.stageWaitMs } : {}) });
    try {
      items.push({ kind: "arranque", status: stage.ok ? "ok" : stage.gating ? "fallo" : "info", title: stage.ok ? "La versión nueva arranca aparte" : "Prueba de arranque", detail: stage.detail });
      if (stage.ok) {
        // 3) La pantalla de verdad (opcional).
        const browser = input.browserPath !== undefined ? input.browserPath : await findBrowser();
        if (!browser) {
          items.push({ kind: "pantalla", status: "info", title: "Sin capturas", detail: "No se encontró Edge ni Chrome para dibujar la pantalla: la comprobación de la pantalla no se hizo." });
        } else {
          const dumped = await dumpDom(browser, `${stage.url}/app`);
          if (!dumped.ok) {
            items.push({ kind: "pantalla", status: "info", title: "Pantalla inicial", detail: `No se pudo dibujar la pantalla: ${dumped.error ?? "error desconocido"}. No se bloquea por esto.` });
          } else if (ERROR_MARKERS.test(dumped.dom)) {
            const marker = ERROR_MARKERS.exec(dumped.dom)?.[1] ?? "error";
            items.push({ kind: "pantalla", status: "fallo", title: "La pantalla inicial muestra un error", detail: `Al dibujar la pantalla de la versión nueva aparece «${marker}».` });
          } else if (dumped.dom.length < 500) {
            items.push({ kind: "pantalla", status: "info", title: "Pantalla inicial", detail: "El navegador devolvió muy poco contenido: no concluyente." });
          } else {
            items.push({ kind: "pantalla", status: "ok", title: "La pantalla inicial se dibuja sin errores", detail: `El navegador la dibujó (${Math.round(dumped.dom.length / 1000)} mil caracteres de página).` });
            for (const needle of input.checks.mustContain) if (dumped.dom.includes(needle)) items.push({ kind: "pantalla", status: "ok", title: `«${needle}» se ve en la pantalla inicial`, detail: "Aparece en la pantalla ya dibujada." });
            for (const needle of input.checks.mustNotContain) if (dumped.dom.includes(needle)) items.push({ kind: "pantalla", status: "info", title: `«${needle}» aún se ve en la pantalla inicial`, detail: "Puede ser otro sitio distinto del cambiado: revísalo con la captura." });
            if (input.liveUrl) {
              const dir = path.join(input.backupDir, "evidencia");
              const after = await screenshot(browser, `${stage.url}/app`, path.join(dir, "despues.png"));
              const before = after.ok ? await screenshot(browser, `${input.liveUrl}/app`, path.join(dir, "antes.png")) : { ok: false };
              if (after.ok && before.ok) {
                const diff = await diffPng(await fs.readFile(path.join(dir, "antes.png")), await fs.readFile(path.join(dir, "despues.png")));
                if (diff) {
                  screenshots = { backup: input.backupDir, changedPct: diff.changedPct };
                  items.push({ kind: "pantalla", status: "info", title: `Antes / después de la pantalla inicial: cambió el ${diff.changedPct} %`, detail: diff.box ? `La zona que cambia mide ${diff.box.w}×${diff.box.h} px (en ${diff.box.x},${diff.box.y}). Puedes verlas una junto a otra en la mejora.` : "No hay diferencias visibles en la pantalla inicial (el cambio puede estar en otra pantalla o en un estado que no se ve al abrir)." });
                }
              }
            }
          }
        }
      }
    } finally {
      await stage.close();
    }
  }
  return { items, gating: items.some((item) => item.status === "fallo"), ...(screenshots ? { screenshots } : {}) };
}

export async function writeReport(backupDir: string, report: EvidenceReport, markdown: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(backupDir, "evidencia");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "informe.json"), JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "informe.md"), markdown, "utf8");
}

/** Una captura guardada como imagen incrustable (solo las dos que genera WILLY, dentro de la carpeta de copias). */
export async function evidenceImage(root: string, backup: string, name: string): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  if (name !== "antes.png" && name !== "despues.png") return null;
  const base = path.resolve(root, "copias-autoconstruccion");
  const dir = path.resolve(backup);
  if (!dir.startsWith(`${base}${path.sep}`)) return null;
  try {
    const bytes = await fs.readFile(path.join(dir, "evidencia", name));
    if (bytes.length > 4_000_000) return null;
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
