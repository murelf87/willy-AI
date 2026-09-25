// CAPTURAS DE VERDAD de la página de un proyecto (rediseño, revisión 24 · punto 19: «renderizar → capturar screenshot →
// analizar visualmente»). Solo servidor. Usa el navegador que ya hay en el equipo (Edge o Chrome, sin ventana), el mismo que usa
// la Autoconstrucción para sus capturas. Si no hay navegador, se dice y la revisión automática del diseño sigue igual.
//
// Detalle importante: Edge/Chrome sin ventana no bajan de unos 500 px de ancho; una captura «de móvil» a 390 px saldría como una
// página de 500 px recortada (y no se aplicarían sus estilos de móvil). Por eso la página se pinta DENTRO de un marco del tamaño
// exacto (390, 768 o 1280 px): así su pantalla mide de verdad eso y la captura es la de un móvil de verdad.

import { getProject } from "@/lib/project-store-server";
import { previewOf } from "@/lib/live-files";
import { compileTarget } from "@/lib/project-compile";
import { compileProject, type CompileOptions } from "@/lib/project-compile-server";
import { withMonitor } from "@/lib/preview-runtime";
import { findBrowser, screenshot } from "@/lib/render-check";
import { REVIEW_DEVICES, REVIEW_SIZES, type CaptureResult, type ReviewDevice, type Shot } from "@/lib/design-review";
import { fail, ok, type ServiceResult } from "@/types/domain";

export const NO_BROWSER = "No se ha encontrado Edge ni Chrome en tu equipo: sin capturas (la revisión automática del diseño sí se hace).";
const MAX_SHOT_BYTES = 5_000_000;

const escapeAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** La página, pintada dentro de un marco del tamaño exacto de la pantalla que se quiere capturar. */
export function captureWrapper(html: string, width: number, height: number): string {
  const w = Math.max(200, Math.min(4000, Math.round(width)));
  const h = Math.max(200, Math.min(4000, Math.round(height)));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Captura</title><style>html,body{margin:0;padding:0;overflow:hidden;background:#fff}iframe{border:0;display:block;width:${w}px;height:${h}px}</style></head><body><iframe title="Página" srcdoc="${escapeAttr(html)}"></iframe></body></html>`;
}

const pickDevices = (raw: unknown): ReviewDevice[] => {
  if (!Array.isArray(raw)) return [...REVIEW_DEVICES];
  const wanted = REVIEW_DEVICES.filter((d) => raw.includes(d));
  return wanted.length ? wanted : [...REVIEW_DEVICES];
};

/** En Linux como administrador (el banco de pruebas), Chromium necesita «--no-sandbox»; en Windows no hace falta nada. */
function defaultExtraArgs(): string[] {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  return process.platform === "linux" && uid === 0 ? ["--no-sandbox"] : [];
}

// Una captura detrás de otra (pulsar dos veces no lanza diez navegadores a la vez).
let chain: Promise<unknown> = Promise.resolve();

/**
 * Captura la página que se está viendo (`page`, con su ruta `hash`) en los tamaños pedidos. Devuelve las imágenes (PNG, como
 * data URL) y los tamaños que no se pudieron capturar. Falla (con un motivo claro) si no hay proyecto, página o navegador.
 */
export function captureProject(
  base: string,
  id: string,
  opts: { page?: unknown; hash?: unknown; devices?: unknown; browserPath?: string | null; extraArgs?: string[]; timeoutMs?: number; compile?: CompileOptions } = {},
): Promise<ServiceResult<CaptureResult>> {
  const run = chain.then(() => doCapture(base, id, opts), () => doCapture(base, id, opts));
  chain = run.catch(() => undefined);
  return run;
}

async function doCapture(
  base: string,
  id: string,
  opts: { page?: unknown; hash?: unknown; devices?: unknown; browserPath?: string | null; extraArgs?: string[]; timeoutMs?: number; compile?: CompileOptions },
): Promise<ServiceResult<CaptureResult>> {
  const project = await getProject(base, id);
  if (!project) return fail("Ese proyecto ya no existe.");
  const wantedPage = typeof opts.page === "string" ? opts.page.slice(0, 300) : null;
  let info = previewOf(project.files, wantedPage);
  // Rev25: un proyecto React/Vite (o su entrada elegida en el selector de páginas) se compila y se captura compilado.
  const target = compileTarget(project.files);
  if (target && (info.kind === "sin-vista" || wantedPage === target.entry)) {
    const built = await compileProject(base, id, opts.compile ?? {});
    if (built.ok && built.data.ok) info = { kind: "pagina", html: built.data.html, page: target.entry, pages: [target.entry] };
    else return fail(`No se puede capturar: el proyecto no compila${built.ok && !built.data.ok && built.data.errors[0] ? ` (${built.data.errors[0].text})` : ""}.`);
  }
  if (info.kind !== "pagina" || !info.html || !info.page) return fail("Este proyecto no tiene una página que se pueda capturar.");
  const exe = opts.browserPath !== undefined ? opts.browserPath : await findBrowser();
  if (!exe) return fail(NO_BROWSER);
  const hash = typeof opts.hash === "string" ? opts.hash.slice(0, 200) : null;
  // Con el vigía (almacenamiento en memoria, ruta de la página): se ve igual que en la vista previa de WILLY.
  const page = withMonitor(info.html, { hash });
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "willy-captura-"));
  const shots: Shot[] = [];
  const errors: string[] = [];
  try {
    for (const device of pickDevices(opts.devices)) {
      const size = REVIEW_SIZES[device];
      const file = path.join(dir, `${device}.html`);
      const out = path.join(dir, `${device}.png`);
      await fs.writeFile(file, captureWrapper(page, size.width, size.height), "utf8");
      const r = await screenshot(exe, pathToFileURL(file).href, out, { width: size.width, height: size.height, budgetMs: 5000, timeoutMs: opts.timeoutMs ?? 40_000, extraArgs: opts.extraArgs ?? defaultExtraArgs() });
      if (!r.ok) { errors.push(`${size.label}: ${r.error ?? "no se pudo capturar"}`); continue; }
      const bytes = await fs.readFile(out);
      if (bytes.length > MAX_SHOT_BYTES) { errors.push(`${size.label}: la captura es demasiado grande`); continue; }
      shots.push({ device, width: size.width, height: size.height, image: `data:image/png;base64,${bytes.toString("base64")}`, bytes: bytes.length });
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  if (!shots.length) return fail(`No se pudieron hacer las capturas: ${errors[0] ?? "error desconocido"}.`);
  return ok({ page: info.page, browser: path.basename(exe), shots, errors });
}
