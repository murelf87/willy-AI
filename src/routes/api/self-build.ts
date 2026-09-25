import { createFileRoute } from "@tanstack/react-router";
import { focusContext } from "@/lib/code-focus";
import { engineAction } from "@/lib/engines-server";
import { ownerAction } from "@/lib/owner-brain-server";
import { appendJournal, buildStatePackage, previewStatePackage } from "@/lib/state-pack";
import { collectEvidence, evidenceImage, writeReport } from "@/lib/evidence-server";
import { projectRoot } from "@/lib/project-root";
import { APP_REVISION, APP_VERSION } from "@/lib/version";
import { deployCompiledApp, isInstalled, loadTypeScript, runBuild, scheduleInstalledRestart } from "@/lib/self-build-ops";
import { runTypecheck } from "@/lib/self-build-typecheck";
import { applySelfBuild, recoverInterrupted, revertVersion, selfBuildHealth, selfBuildProgress, selfBuildStatus, type HealthProbes, type ManagerDeps } from "@/lib/self-build-manager";

// Aplica en una sola operación los archivos de una mejora de WILLY AI. El circuito completo (copia verificada, marca de
// operación en curso, compilación, prueba aparte, instalación, versión y recuperación tras un apagón) vive en
// self-build-manager.ts; aquí solo se valida la petición y se le pasan las operaciones reales del equipo.

type IncomingFile = { path?: unknown; content?: unknown };
type IncomingPatch = { path?: unknown; search?: unknown; replace?: unknown };
type IncomingBody = { action?: unknown; name?: unknown; proposal?: unknown; files?: unknown; patches?: unknown; attachments?: unknown; screenshots?: unknown; checks?: unknown; backup?: unknown; client?: unknown; id?: unknown };

const SAFE_PATH = /^[a-zA-Z0-9._/-]{1,200}$/;
const ALLOWED_ROOTS = ["src/", "public/"];
const ALLOWED_ROOT_FILES = new Set(["package.json", "vite.config.ts", "vite.config.local.ts", "tsconfig.json"]);
const BLOCKED_NAMES = new Set([".env", ".env.local", "package-lock.json", "bun.lock", "bun.lockb"]);
/**
 * Caracteres de código que se le dan al modelo. Un modelo local de 8B trabaja con ~16.000 «tokens»
 * de memoria: con 65.000 caracteres el motor recortaba la petición y el modelo ni veía las instrucciones.
 */
const CONTEXT_BUDGET = 30_000;

/**
 * Este endpoint escribe código que después se ejecuta en el equipo. Solo debe
 * aceptar peticiones de la propia interfaz de WILLY, nunca de otra página web
 * abierta en el navegador (CSRF) ni con formatos que evitan las comprobaciones del navegador.
 */
function rejectForeignRequest(request: Request): string | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "Petición bloqueada: procede de otra página web.";
  if (!site) {
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        return "Petición bloqueada: origen no válido.";
      }
      const host = request.headers.get("host") ?? new URL(request.url).host;
      if (originHost !== host) return "Petición bloqueada: procede de otra página web.";
    }
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return "Petición bloqueada: formato no permitido.";
  return null;
}

/** Rutas de src/ cuyo nombre de archivo coincide con los archivos que ha subido el dueño. */
async function pathsByName(root: string, names: string[]): Promise<string[]> {
  const wanted = new Set(names.map((name) => name.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "").filter(Boolean));
  if (!wanted.size) return [];
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const found: string[] = [];
  let visited = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6 || visited > 1500) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      visited += 1;
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") await walk(relative, depth + 1);
      } else if (wanted.has(entry.name.toLowerCase())) {
        found.push(relative);
      }
    }
  };
  await walk("src", 0);
  return found.slice(0, 4);
}

const CONTEXT_GROUPS: Array<{ words: RegExp; paths: string[] }> = [
  { words: /chat|mensaje|micr[oó]fono|hablar|voz|clip|adjunt/i, paths: ["src/routes/app.tsx", "src/lib/voice-input.ts", "src/lib/local-ai.ts"] },
  // «forge»: nombre antiguo del proyecto; se sigue entendiendo si el dueño lo escribe (no se muestra en ningún sitio).
  { words: /modelo|ollama|forge|motor|ia local/i, paths: ["src/lib/local-ai.ts", "src/services/ai-service.ts", "src/services/model-catalog.ts", "src/components/app-sections.tsx"] },
  { words: /autoconstru|mejora|propuesta/i, paths: ["src/lib/self-build-runner.ts", "src/components/self-build-view.tsx", "src/lib/self-build-store.ts", "src/routes/api/self-build.ts", "src/lib/patch-apply.ts", "src/lib/ai-standard.ts"] },
  { words: /licencia|cliente|pago|usuario/i, paths: ["src/services/licensing.ts", "src/components/licenses-view.tsx"] },
  { words: /iphone|m[oó]vil|youtube|traduc/i, paths: ["src/routes/movil.tsx", "src/components/translate-view.tsx", "src/routes/api/youtube.ts"] },
  { words: /portada|inicio|registro|acceso/i, paths: ["src/routes/index.tsx"] },
  { words: /estilo|dise[nñ]o|color|tema|responsive/i, paths: ["src/styles.css", "src/routes/app.tsx"] },
];

/** Lee todos los archivos de código (src) para que el localizador pueda buscar en ellos. */
async function readSourceFiles(root: string): Promise<Array<{ rel: string; content: string }>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const out: Array<{ rel: string; content: string }> = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || out.length > 900) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "ui") await walk(relative, depth + 1);
      } else if (/\.(?:tsx?|css)$/.test(entry.name) && !/routeTree\.gen/.test(entry.name)) {
        try {
          const content = await fs.readFile(path.join(root, relative), "utf8");
          if (content.length <= 400_000) out.push({ rel: relative, content });
        } catch {
          /* archivo que desaparece mientras se lee */
        }
      }
    }
  };
  await walk("src", 0);
  return out;
}

/**
 * Código que se le da al modelo: SOLO las zonas relacionadas con la petición, localizadas buscando en todo el
 * programa (no ~30.000 caracteres elegidos por palabras sueltas, que a menudo no incluían la línea a cambiar).
 * Si el localizador no encuentra pistas claras, se usa el método anterior.
 */
async function readContext(root: string, request: string, proposal: string, attachmentNames: string[] = [], screenshotTexts: string[] = []): Promise<{ context: string; paths: string[] }> {
  try {
    const files = await readSourceFiles(root);
    const known = new Set(files.map((file) => file.rel));
    const mentioned = (proposal.match(/(?:src|public)\/[A-Za-z0-9_@()./\-]+\.[A-Za-z0-9]+/g) ?? []).filter((entry) => known.has(entry));
    const named = await pathsByName(root, attachmentNames);
    const focused = focusContext({ files, request, extra: screenshotTexts.join("\n"), boostPaths: [...new Set([...named, ...mentioned])] });
    if (focused.context) return { context: focused.context, paths: focused.paths };
  } catch {
    /* si el localizador falla, se usa el método anterior */
  }
  return readContextLegacy(root, request, proposal, attachmentNames, screenshotTexts);
}

async function readContextLegacy(root: string, request: string, proposal: string, attachmentNames: string[] = [], screenshotTexts: string[] = []): Promise<{ context: string; paths: string[] }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const mentioned = proposal.match(/(?:src|public)\/[A-Za-z0-9_@()./\-]+\.[A-Za-z0-9]+/g) ?? [];
  const description = `${request}\n${screenshotTexts.join("\n")}\n${proposal}`;
  const inferred = CONTEXT_GROUPS.filter((group) => group.words.test(description)).flatMap((group) => group.paths);
  const fallback = inferred.length ? [] : ["src/routes/app.tsx", "src/components/app-sections.tsx"];
  const named = await pathsByName(root, attachmentNames);
  const paths = [...new Set([...named, ...mentioned, ...inferred, ...fallback])].filter((entry) => safeRelativePath(entry)).slice(0, 10);
  const terms = description.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9_-]{5,}/g) ?? [];
  const usefulTerms = [...new Set([...terms, "error", "onerror", "catch"])].slice(0, 18);
  const chunks: string[] = [];
  let total = 0;
  const loaded: Array<{ relative: string; content: string }> = [];
  for (const relative of paths) {
    try {
      const content = await fs.readFile(path.join(root, relative), "utf8");
      loaded.push({ relative, content });
    } catch {
      /* Una ruta propuesta puede ser un archivo nuevo. */
    }
  }
  loaded.sort((a, b) => a.content.length - b.content.length);
  for (const { relative, content } of loaded) {
    try {
      const room = CONTEXT_BUDGET - total;
      if (room <= 0) break;
      let included = content;
      if (content.length > 12_000) {
        const lines = content.split("\n");
        const selected = new Set<number>();
        for (let index = 0; index < Math.min(lines.length, 90); index += 1) selected.add(index);
        for (let index = 0; index < lines.length; index += 1) {
          const normalized = (lines[index] ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (!usefulTerms.some((term) => normalized.includes(term))) continue;
          for (let nearby = Math.max(0, index - 45); nearby <= Math.min(lines.length - 1, index + 70); nearby += 1) selected.add(nearby);
        }
        included = [...selected].sort((a, b) => a - b).map((index) => `${index + 1}: ${lines[index] ?? ""}`).join("\n");
        included = `ARCHIVO GRANDE: se muestran imports y zonas relacionadas. Modifícalo con bloques SEARCH/REPLACE usando texto exacto sin los números de línea.\n${included}`;
      }
      if (included.length > room) included = `${included.slice(0, room)}\n/* CONTEXTO RECORTADO */`;
      total += included.length;
      chunks.push(`--- ${relative} ---\n${included}`);
    } catch {
      /* El resto del contexto sigue siendo utilizable. */
    }
  }
  return { context: chunks.join("\n\n"), paths };
}

function safeRelativePath(value: unknown): string | null {
  const clean = String(value ?? "").replace(/^[./\\]+/, "").replace(/\\/g, "/");
  if (!clean || clean.includes("..") || !SAFE_PATH.test(clean)) return null;
  if (!ALLOWED_ROOTS.some((prefix) => clean.startsWith(prefix)) && !ALLOWED_ROOT_FILES.has(clean)) return null;
  if (BLOCKED_NAMES.has(clean.split("/").at(-1) ?? "")) return null;
  return clean;
}

/** Las operaciones reales de este equipo que usa el gestor de la Autoconstrucción. */
function managerDeps(): ManagerDeps {
  return {
    appVersion: `${APP_VERSION}+${APP_REVISION}`,
    loadTypeScript,
    build: runBuild,
    typecheck: (root, cwd) => runTypecheck(root, cwd),
    collectEvidence,
    isInstalled,
    deploy: deployCompiledApp,
    restart: scheduleInstalledRestart,
    writeReport,
    appendJournal,
    // La copia de prueba del programa nuevo (otro puerto) nunca aplica, recupera ni confirma nada.
    isStage: process.env["WILLY_STAGE"] === "1",
  };
}

async function getJson(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`responde ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Comprobaciones de salud con lo que hay en este equipo (cada una con su límite de tiempo). */
function healthProbes(root: string): HealthProbes {
  return {
    ollama: async () => {
      try {
        const [version, tags] = await Promise.all([getJson("http://127.0.0.1:11434/api/version", 2500), getJson("http://127.0.0.1:11434/api/tags", 2500)]);
        return { ok: true, version: String(version["version"] ?? "?"), models: Array.isArray(tags["models"]) ? tags["models"].length : 0 };
      } catch (error) {
        return { ok: false, error: error instanceof Error && error.name !== "TimeoutError" ? `no arrancado (${error.message})` : "no arrancado en este equipo" };
      }
    },
    engines: async () => {
      const nodePath = await import("node:path");
      const result = await engineAction(nodePath.join(root, "datos-privados"), { action: "engines-status" });
      const status = result["status"] as { master?: boolean; engines?: Array<{ hasKey?: boolean; enabled?: boolean }> } | undefined;
      if (!status || !Array.isArray(status.engines)) return null;
      return { configured: status.engines.filter((e) => e.hasKey).length, active: status.engines.filter((e) => e.hasKey && e.enabled).length, master: Boolean(status.master) };
    },
    backend: async () => {
      try {
        const res = await fetch("http://127.0.0.1:4000/health", { signal: AbortSignal.timeout(1500), cache: "no-store" });
        return res.ok ? { ok: true, detail: "Responde." } : { ok: false, detail: `Responde con el código ${res.status}.` };
      } catch {
        return { ok: false, detail: "No arrancado (solo hace falta para proyectos con servidor propio)." };
      }
    },
    diskFree: async (dir) => {
      const fs = await import("node:fs/promises");
      if (typeof fs.statfs !== "function") return null;
      const stats = await fs.statfs(dir);
      return Number(stats.bavail) * Number(stats.bsize);
    },
  };
}

export const Route = createFileRoute("/api/self-build")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const foreign = rejectForeignRequest(request);
        if (foreign) return Response.json({ ok: false, error: foreign }, { status: 403 });

        let body: IncomingBody;
        try {
          body = (await request.json()) as IncomingBody;
        } catch {
          return Response.json({ ok: false, error: "Petición no válida." }, { status: 400 });
        }

        const root = await projectRoot();
        if (!root) return Response.json({ ok: false, error: "No se encontró la instalación editable de WILLY AI." }, { status: 503 });

        if (body.action === "context") {
          try {
            const result = await readContext(root, String(body.name ?? ""), String(body.proposal ?? ""), Array.isArray(body.attachments) ? body.attachments.map((entry) => String(entry)).slice(0, 6) : [], Array.isArray(body.screenshots) ? body.screenshots.map((entry) => String(entry).slice(0, 600)).slice(0, 3) : []);
            if (!result.context) return Response.json({ ok: false, error: "No se pudo leer el código actual de WILLY AI." }, { status: 409 });
            return Response.json({ ok: true, ...result });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo leer el código actual." }, { status: 500 });
          }
        }

        // Motores de IA en la nube: claves y estado viven en este equipo (carpeta datos-privados), nunca en la pantalla.
        if (typeof body.action === "string" && (body.action.startsWith("engines-") || body.action === "cloud-chat")) {
          try {
            const nodePath = await import("node:path");
            return Response.json(await engineAction(nodePath.join(root, "datos-privados"), body as unknown as Record<string, unknown>));
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo completar la acción de motores." }, { status: 500 });
          }
        }

        // Lo que el dueño ha enseñado a WILLY (instrucciones permanentes y lecciones): vive en este equipo y vale para
        // todos los chats y todas las IA (escritorio, móvil, Súper IA y Autoconstrucción).
        if (typeof body.action === "string" && body.action.startsWith("owner-")) {
          try {
            const nodePath = await import("node:path");
            return Response.json(await ownerAction(nodePath.join(root, "datos-privados"), body as unknown as Record<string, unknown>));
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo guardar lo aprendido del dueño." }, { status: 500 });
          }
        }

        // «Continuar el desarrollo»: un único .zip con el código instalado, qué ha cambiado desde la versión oficial, las mejoras hechas
        // con la web y el estado del equipo. Nunca incluye conversaciones, proyectos, claves ni contraseñas.
        if (body.action === "state-preview") {
          try {
            return Response.json({ ok: true, preview: await previewStatePackage(root) });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo leer el estado." }, { status: 500 });
          }
        }
        if (body.action === "state-pack") {
          try {
            const built = await buildStatePackage(root, body.client);
            return new Response(new Uint8Array(built.zip), { status: 200, headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${built.name}"`, "X-Willy-Filename": built.name, "Cache-Control": "no-store" } });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo preparar el paquete." }, { status: 500 });
          }
        }

        // Capturas antes/después guardadas como evidencia (solo las dos que genera WILLY dentro de la carpeta de copias).
        if (body.action === "evidence-image") {
          const dataUrl = await evidenceImage(root, String(body.backup ?? ""), String(body.name ?? ""));
          return dataUrl ? Response.json({ ok: true, dataUrl }) : Response.json({ ok: false, error: "Captura no disponible." }, { status: 404 });
        }

        // Autoconstrucción: estado (versiones, historial, copias y recuperación de lo que se quedó a medias), salud,
        // recuperación manual y vuelta atrás de la versión actual.
        const deps = managerDeps();
        // Progreso real de la mejora en marcha (paso y estado de la versión candidata): solo lee, nunca cambia nada.
        if (body.action === "self-progress") {
          try {
            return Response.json(await selfBuildProgress(root));
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo leer el progreso." }, { status: 500 });
          }
        }
        if (body.action === "self-status") {
          try {
            return Response.json(await selfBuildStatus(root, deps));
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo leer el estado de la Autoconstrucción." }, { status: 500 });
          }
        }
        if (body.action === "self-health") {
          try {
            return Response.json({ ok: true, report: await selfBuildHealth(root, deps, healthProbes(root)) });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo comprobar la salud." }, { status: 500 });
          }
        }
        if (body.action === "self-recover") {
          try {
            return Response.json({ ok: true, recovery: await recoverInterrupted(root, deps) });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo recuperar la operación." }, { status: 500 });
          }
        }
        if (body.action === "self-revert") {
          const id = String(body.id ?? "");
          if (!/^[A-Za-z0-9._+-]{1,120}$/.test(id)) return Response.json({ ok: false, error: "Versión no válida." }, { status: 400 });
          try {
            const outcome = await revertVersion(root, id, deps);
            return Response.json(outcome.body, { status: outcome.status });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo volver atrás." }, { status: 500 });
          }
        }

        const incoming = Array.isArray(body.files) ? (body.files as IncomingFile[]) : [];
        const files = incoming
          .map((file) => ({ path: safeRelativePath(file.path), content: String(file.content ?? "") }))
          .filter((file): file is { path: string; content: string } => Boolean(file.path && file.content.trim()));
        const incomingPatches = Array.isArray(body.patches) ? (body.patches as IncomingPatch[]) : [];
        const patches = incomingPatches
          .map((patch) => ({ path: safeRelativePath(patch.path), search: String(patch.search ?? ""), replace: String(patch.replace ?? "") }))
          .filter((patch): patch is { path: string; search: string; replace: string } => Boolean(patch.path && patch.search.trim()));

        try {
          const outcome = await applySelfBuild({ root, name: String(body.name ?? ""), files, patches, checks: body.checks, liveUrl: new URL(request.url).origin }, deps);
          return Response.json(outcome.body, { status: outcome.status });
        } catch (error) {
          return Response.json({ ok: false, error: `No se aplicó la mejora: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
        }
      },
    },
  },
});
