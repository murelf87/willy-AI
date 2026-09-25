// El historial de versiones de un proyecto SIEMPRE se guarda en este equipo, tanto si el resto de datos del
// proyecto vienen del propio equipo (project-service.ts) como si vienen del backend (api-project-service.ts):
// el servidor no guarda las versiones locales, así que ambos adaptadores leían y escribían aquí, cada uno por
// su cuenta. Ahora comparten estas mismas funciones.
import { readList } from "./storage";
import type { ProjectVersion } from "@/types/domain";

export const VERSIONS_KEY = "willy-versions";

export function versionsOf(projectId: string): ProjectVersion[] {
  return readList<ProjectVersion>(VERSIONS_KEY, []).filter((v) => v.projectId === projectId);
}

export function findVersion(versionId: string): ProjectVersion | undefined {
  return readList<ProjectVersion>(VERSIONS_KEY, []).find((v) => v.id === versionId);
}
