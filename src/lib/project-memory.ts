// Memoria DE CADA PROYECTO (separada de la del dueño). Lo que se decide, se investiga, falla o funciona en un proyecto se
// guarda solo para ese proyecto: no contamina a los demás. La memoria general del dueño (lib/owner-brain) sigue siendo la
// única que vale para todo, y una lección de un proyecto solo pasa a ella si el dueño lo dice («a partir de ahora…»).

import type { ProjectBrief } from "@/lib/project-brief";
import { projectModeOf, type ProjectMode } from "@/types/domain";

export type MemoryKind = "decision" | "investigacion" | "error" | "solucion" | "rechazado" | "correccion" | "prueba" | "preferencia";
export type MemoryEntry = { id: string; at: string; kind: MemoryKind; text: string };

const PREFIX = "willy-memoria-proyecto:";
const MAX = 80;
const LABEL: Record<MemoryKind, string> = { decision: "decisión", investigacion: "investigación", error: "error", solucion: "solución que funcionó", rechazado: "descartado", correccion: "corrección del dueño", prueba: "prueba", preferencia: "preferencia" };

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function listProjectMemory(projectId: string): MemoryEntry[] {
  try {
    const raw = storage()?.getItem(PREFIX + projectId);
    const list = raw ? (JSON.parse(raw) as MemoryEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Añade una entrada (sin repetir la misma cosa) y conserva las 80 más recientes. */
export function addProjectMemory(projectId: string, kind: MemoryKind, text: string, now = new Date()): MemoryEntry | null {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 600);
  if (!projectId || !clean) return null;
  const list = listProjectMemory(projectId);
  if (list.some((e) => e.kind === kind && e.text === clean)) return null;
  const entry: MemoryEntry = { id: `mem_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now.toISOString(), kind, text: clean };
  try {
    storage()?.setItem(PREFIX + projectId, JSON.stringify([...list, entry].slice(-MAX)));
  } catch {
    return null;
  }
  return entry;
}

const I_D_REMINDER =
  "Es un PROYECTO INNOVADOR · I+D: antes de construir algo nuevo, investiga y critica; distingue HECHO (con fuente y fecha) de INFERENCIA y de PROPUESTA; nunca digas «no existe» por no haberlo encontrado; mantén al día docs/innovacion.md (dossier) y crea una versión antes de cada mejora importante.";

const REBUILD_REMINDER =
  "Es una RÉPLICA FUNCIONAL (Product Rebuild): reimplementación propia y limpia (clean-room), nunca código, claves, logos ni textos protegidos del original; nombre e identidad propios. Mantén al día docs/rebuild-report.md, docs/matriz-funcionalidades.md y docs/replicacion.json (cada módulo con su estado real y su prueba de aceptación). Un módulo solo está «verificado» con prueba; nunca presentes el producto como terminado: lo decide WILLY con sus comprobaciones (FINAL_VERIFIED).";

/** Bloque para el mensaje de sistema del chat: lo propio de ESTE proyecto (objetivo, condiciones, modo y su memoria). */
export function projectContextBlock(project: { id: string; mode?: ProjectMode | undefined } | undefined, brief: ProjectBrief | null): string {
  if (!project) return "";
  const mode = projectModeOf(project);
  const memory = listProjectMemory(project.id).slice(-20);
  const lines: string[] = [];
  if (brief?.goal) lines.push(`- Objetivo del proyecto: ${brief.goal}`);
  if (brief?.constraints.length) lines.push(`- Condiciones del dueño: ${brief.constraints.join(" · ")}`);
  if (mode === "innovation") lines.push(`- ${I_D_REMINDER}`);
  if (mode === "rebuild") lines.push(`- ${REBUILD_REMINDER}`);
  for (const e of memory) lines.push(`- [${LABEL[e.kind]} · ${e.at.slice(0, 10)}] ${e.text}`);
  if (!lines.length) return "";
  return ["LO PROPIO DE ESTE PROYECTO (vale solo aquí, no para otros proyectos):", ...lines].join("\n");
}
