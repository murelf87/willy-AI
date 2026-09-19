// Tipos de dominio de WILLY AI. Son el contrato que compartirán la interfaz
// actual (adaptadores locales) y el backend cuando se conecte.

import { z } from "zod";

export type GeneratedFile = { path: string; lang: string; content: string };

export const PROJECT_STATES = ["Activo", "Pausado", "Listo", "Borrador", "Archivado"] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

/** Clave del icono; la interfaz la traduce a un icono real. */
export type ProjectIcon =
  | "folder" | "gauge" | "grid" | "server" | "database" | "zap" | "store" | "code";

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
});

export type Project = z.infer<typeof projectSchema> & { icon: ProjectIcon; files: GeneratedFile[] };

export type ProjectVersion = {
  id: string;
  projectId: string;
  label: string;
  at: string;
  files: GeneratedFile[];
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
