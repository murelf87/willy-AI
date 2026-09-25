// Tipos de dominio de WILLY AI. Son el contrato que compartirán la interfaz
// actual (adaptadores locales) y el backend cuando se conecte.

import { z } from "zod";
import type { ProjectPlan } from "@/lib/project-progress";

export type GeneratedFile = { path: string; lang: string; content: string };

/** Función para avisar con un mensaje corto (una notificación, un registro…). Varias pantallas la redeclaraban cada una por su cuenta. */
export type Ping = (message: string) => void;

export const PROJECT_STATES = ["Activo", "Pausado", "Listo", "Borrador", "Archivado"] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

/** Tipo de proyecto: normal («Crear proyecto»), innovador («Proyecto innovador · I+D», que investiga antes de construir) o
 *  réplica funcional («Replicar aplicación/programa»: reimplementación propia con entrega instalable y comprobaciones).
 *  Los proyectos guardados antes de existir este campo no lo llevan y se tratan como normales (ver `projectModeOf`). */
export const PROJECT_MODES = ["standard", "innovation", "rebuild"] as const;
export type ProjectMode = (typeof PROJECT_MODES)[number];

/** Modo de un proyecto; si no lo tiene (proyectos anteriores) o es desconocido, es «standard». */
export function projectModeOf(project: { mode?: string | null | undefined }): ProjectMode {
  return project.mode === "innovation" || project.mode === "rebuild" ? project.mode : "standard";
}

/** Clave del icono; la interfaz la traduce a un icono real. */
export type ProjectIcon =
  | "folder" | "gauge" | "grid" | "server" | "database" | "zap" | "store" | "code";
export const PROJECT_ICONS: readonly ProjectIcon[] = ["folder", "gauge", "grid", "server", "database", "zap", "store", "code"];

/** De dónde viene un proyecto (desde la rev19): lo creó SUPER WILLY, el botón «Nuevo proyecto», el Chat, es uno de los
 *  ejemplos que WILLY sembraba antes o es del propio sistema. Los proyectos anteriores no lo llevan. */
export const PROJECT_ORIGINS = ["super-willy", "nuevo", "chat", "ejemplo", "sistema"] as const;
export type ProjectOrigin = (typeof PROJECT_ORIGINS)[number];

/** Los 6 proyectos de ejemplo que WILLY creaba solo cuando la lista estaba vacía (hasta la rev18). Ya no se crean: los que
 *  quedan se reconocen (mismo nombre y descripción, sin archivos) y se marcan como ejemplo, sin borrarlos. */
export const EXAMPLE_PROJECTS: ReadonlyArray<{ name: string; desc: string; icon: ProjectIcon; state: "Activo" | "Pausado" | "Listo" | "Borrador" }> = [
  { name: "SaaS Clientes", desc: "Gestión de clientes con métricas", icon: "folder", state: "Activo" },
  { name: "App Fitness", desc: "Rutinas y seguimiento diario", icon: "gauge", state: "Pausado" },
  { name: "Web Corporativa", desc: "Sitio institucional multiidioma", icon: "grid", state: "Listo" },
  { name: "API REST", desc: "Servicio de datos local en Node", icon: "server", state: "Activo" },
  { name: "Tienda Online", desc: "Catálogo y carrito sin pasarela", icon: "database", state: "Borrador" },
  { name: "Landing Page", desc: "Página de captación de leads", icon: "zap", state: "Listo" },
];

/** ¿Es uno de los ejemplos de antes, tal cual (sin trabajo encima)? */
export function isExampleProject(p: { name: string; desc?: string; files?: readonly unknown[]; fileCount?: number | undefined; origin?: string | undefined }): boolean {
  // En cuanto tiene archivos, ya es trabajo tuyo (aunque empezara siendo un ejemplo).
  const count = p.fileCount ?? p.files?.length ?? 0;
  if (count > 0) return false;
  return p.origin === "ejemplo" || EXAMPLE_PROJECTS.some((e) => e.name === p.name && e.desc === (p.desc ?? ""));
}

export const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  desc: z.string().default(""),
  state: z.enum(PROJECT_STATES).default("Borrador"),
  icon: z.string().default("folder"),
  prompt: z.string().default(""),
  files: z
    .array(z.object({ path: z.string(), lang: z.string(), content: z.string() }))
    .default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().default(null),
  // Opcional: los proyectos de antes no lo tienen y se tratan como «standard» (léelo con `projectModeOf`).
  mode: z.enum(PROJECT_MODES).optional(),
});

export type Project = z.infer<typeof projectSchema> & {
  icon: ProjectIcon;
  files: GeneratedFile[];
  /** Cuántos archivos tiene. La lista de proyectos no trae su contenido (se pide con `get`): usa esto para contarlos. */
  fileCount?: number;
  origin?: ProjectOrigin;
  /** Tipo de producto (web, app, api…) cuando se sabe (entrevista de SUPER WILLY o ficha del proyecto). */
  kind?: string;
  /** Conversación de SUPER WILLY que lleva este proyecto. */
  sessionId?: string;
  /** Rev23: su plan (hitos y tareas) y lo que se sabe de verdad de él; de aquí sale su progreso. Sin plan: «no calculado». */
  plan?: ProjectPlan | null;
};

/** Cuántos archivos tiene un proyecto, venga de la lista (sin contenido) o completo. */
export const fileCountOf = (p: { files: readonly unknown[]; fileCount?: number | undefined }): number => p.fileCount ?? p.files.length;

/** Datos al crear un proyecto. */
export type ProjectInput = {
  name: string;
  desc?: string;
  prompt?: string;
  icon?: ProjectIcon;
  mode?: ProjectMode;
  origin?: ProjectOrigin;
  kind?: string;
  sessionId?: string;
  state?: ProjectState;
};

/** Lo que se puede cambiar de un proyecto aparte del nombre, el estado y los archivos (que tienen su propia función). */
export type ProjectPatch = { desc?: string; prompt?: string; icon?: ProjectIcon; origin?: ProjectOrigin; kind?: string; sessionId?: string };

export type ProjectVersion = {
  id: string;
  projectId: string;
  label: string;
  at: string;
  files: GeneratedFile[];
  /** Cuántos archivos guarda. La lista de versiones no trae su contenido: usa esto para contarlos. */
  fileCount?: number;
};

export type Role = "owner" | "member";

export type Session = {
  name: string;
  email: string;
  role: Role;
  at: string;
};

export type ModelInfo = {
  name: string;
  size: string;
  tag: string;
  loaded: boolean;
  origin: "local" | "remoto";
};

/** Estado normalizado de cualquier acción asíncrona de la interfaz. */
export type AsyncState = "idle" | "loading" | "success" | "error";

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: string): ServiceResult<T> {
  return { ok: false, error };
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
