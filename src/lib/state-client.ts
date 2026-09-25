import { LAST_REPORT_KEY } from "@/lib/engine-check";
import { summarize } from "@/lib/evidence";
import { readLessons } from "@/lib/learning";
import { SOURCES_REPORT_KEY, readSources } from "@/lib/data-sources-store";
import { listBroken } from "@/lib/model-health";
import { readSelfBuild } from "@/lib/self-build-store";
import type { Preview } from "@/lib/state-pack";
import { APP_REVISION, APP_VERSION } from "@/lib/version";

// Lo que sabe el navegador y el servidor no: las mejoras hechas con la web, el motor elegido, los modelos que no cargan y
// lo que quieres hacer después. Solo texto necesario: nunca claves, contenidos de adjuntos, conversaciones ni proyectos.

export type ClientSettings = { endpoint: string; model: string; agents: string[]; tools: string[]; project: string };

export function collectClientState(notes: string, settings: ClientSettings): Record<string, unknown> {
  const build = readSelfBuild();
  let lessons: ReturnType<typeof readLessons> = [];
  try {
    lessons = readLessons();
  } catch {
    /* sin memoria de mejoras */
  }
  let engineReport = "";
  try {
    engineReport = window.localStorage.getItem(LAST_REPORT_KEY) ?? "";
  } catch {
    /* sin almacenamiento */
  }
  let dataSourcesReport = "";
  try {
    dataSourcesReport = window.localStorage.getItem(SOURCES_REPORT_KEY) ?? "";
  } catch {
    /* sin almacenamiento */
  }
  const sources = readSources();
  return {
    dataSources: { enabled: sources.enabled, off: sources.off },
    dataSourcesReport,
    version: APP_VERSION,
    revision: APP_REVISION,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    notes,
    instructions: build.instructions,
    improvements: build.improvements.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      request: item.request,
      proposal: item.proposal,
      status: item.status,
      result: item.result ?? "",
      engine: item.engine ?? "",
      files: (item.files ?? []).map((file) => file.path),
      checks: item.checks ?? null,
      evidence: item.evidence ? { summary: (() => { const s = summarize(item.evidence.items); return `${s.ok} comprobadas · ${s.fallos} fallos · ${s.info} informativas`; })(), items: item.evidence.items } : null,
      attachments: (item.attachments ?? []).map((file) => file.name),
      screenshots: (item.screenshots ?? []).map((shot) => shot.description),
    })),
    lessons: lessons.slice(-40).map((lesson) => ({ request: lesson.request, kind: lesson.kind, files: lesson.files, model: lesson.model, verdict: lesson.verdict, attempts: lesson.attempts })),
    settings: { endpoint: settings.endpoint, model: settings.model, agents: settings.agents, tools: settings.tools, project: settings.project },
    brokenModels: listBroken(),
    engineReport,
  };
}

async function post(body: Record<string, unknown>): Promise<Response> {
  return fetch("/api/self-build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function fetchPreview(): Promise<Preview | null> {
  try {
    const data = (await (await post({ action: "state-preview" })).json()) as { ok?: boolean; preview?: Preview };
    return data.ok && data.preview ? data.preview : null;
  } catch {
    return null;
  }
}

export async function downloadStatePack(client: Record<string, unknown>): Promise<{ ok: true; name: string; size: number } | { ok: false; error: string }> {
  try {
    const res = await post({ action: "state-pack", client });
    if (!res.ok || (res.headers.get("content-type") ?? "").includes("json")) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? `El servidor respondió ${res.status}.` };
    }
    const blob = await res.blob();
    const name = res.headers.get("X-Willy-Filename") ?? "WillyAI-estado.zip";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return { ok: true, name, size: blob.size };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo preparar el paquete." };
  }
}

/** El mensaje que acompaña al paquete cuando se lo pasas a Claude. */
export function claudeMessage(preview: Preview | null, notes: string): string {
  const facts = preview
    ? `El código instalado es la versión ${preview.sourceVersion || "desconocida"}${preview.hasRelease ? `; frente a la oficial hay ${preview.modified} archivo(s) modificado(s), ${preview.added} añadido(s) y ${preview.removed} que faltan` : ""}.`
    : "";
  return [
    "Te adjunto el paquete de continuación de WILLY AI (un .zip). Empieza por LEEME_PARA_CONTINUAR.md y ESTADO.md.",
    "Parte del código que va dentro de «codigo/», no de una versión anterior: puede tener cambios hechos por la propia Autoconstrucción que no están en ninguna versión oficial.",
    facts,
    notes.trim() ? `Lo que quiero ahora:\n${notes.trim()}` : "Lo que quiero ahora te lo digo a continuación.",
  ].filter(Boolean).join("\n\n");
}
