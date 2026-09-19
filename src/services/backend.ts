// Conexión con el backend de WILLY AI (Fastify, http://localhost:4000).
// Contrato documentado en INTEGRACION.md: sesión por cookie HttpOnly, CORS con
// credenciales y cabecera opcional X-Organization-Id.

import { useEffect, useState } from "react";
import { fail, ok, type ServiceResult } from "@/types/domain";
import { notify, readJson, write } from "./storage";

export const BACKEND_KEY = "willy-backend";

export type BackendConfig = {
  /** Dirección base del backend, sin barra final. */
  url: string;
  /** Si está desactivado, la interfaz sigue funcionando con datos en el equipo. */
  enabled: boolean;
  /** Organización activa (cabecera X-Organization-Id). */
  organizationId: string;
};

export const DEFAULT_BACKEND: BackendConfig = {
  url: "http://localhost:4000",
  enabled: false,
  organizationId: "",
};

export function readBackend(): BackendConfig {
  const cfg = readJson<BackendConfig>(BACKEND_KEY, DEFAULT_BACKEND);
  return { ...cfg, url: cfg.url.replace(/\/+$/, "") };
}

export function saveBackend(patch: Partial<BackendConfig>): BackendConfig {
  const next = { ...readBackend(), ...patch };
  next.url = next.url.trim().replace(/\/+$/, "");
  write(BACKEND_KEY, next);
  return next;
}

/** ¿Hay que usar el backend en lugar de los datos del equipo? */
export function backendOn(): boolean {
  const cfg = readBackend();
  return cfg.enabled && !!cfg.url;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type ApiInit = Omit<RequestInit, "body"> & { body?: unknown; timeoutMs?: number };

/** Llamada al backend con cookie de sesión incluida. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const cfg = readBackend();
  if (!cfg.url) throw new ApiError("No hay dirección de backend configurada.", 0);

  const { body, timeoutMs = 20000, headers, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const allHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(cfg.organizationId ? { "X-Organization-Id": cfg.organizationId } : {}),
    ...((headers as Record<string, string>) ?? {}),
  };

  try {
    const res = await fetch(`${cfg.url}${path}`, {
      ...rest,
      headers: allHeaders,
      credentials: "include",
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const message =
        (data as { message?: string; error?: string } | undefined)?.message ??
        (data as { error?: string } | undefined)?.error ??
        `El servidor respondió ${res.status}.`;
      throw new ApiError(message, res.status);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError("El servidor ha tardado demasiado en responder.", 0);
    }
    throw new ApiError("No se pudo contactar con el servidor.", 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Traduce cualquier fallo de red en un resultado que la interfaz sabe mostrar. */
export async function attempt<T>(fn: () => Promise<T>): Promise<ServiceResult<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail<T>(e instanceof Error ? e.message : "Error inesperado del servidor.");
  }
}

/** Comprueba de verdad que el backend está en marcha. */
export async function health(url?: string): Promise<ServiceResult<true>> {
  const base = (url ?? readBackend().url).trim().replace(/\/+$/, "");
  if (!base) return fail<true>("Escribe la dirección del servidor.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${base}/health`, { credentials: "include", signal: controller.signal });
    if (!res.ok) return fail<true>(`El servidor respondió ${res.status}.`);
    const data = (await res.json()) as { status?: string };
    return data.status === "ok" ? ok(true as const) : fail<true>("El servidor respondió, pero no está listo.");
  } catch {
    return fail<true>("No hay respuesta en esa dirección.");
  } finally {
    clearTimeout(timer);
  }
}

export type Organization = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isPersonal: boolean;
  role: string;
};

export async function listOrganizations(): Promise<ServiceResult<Organization[]>> {
  return attempt(async () => (await api<{ organizations: Organization[] }>("/api/organizations")).organizations);
}

/** Avisa a las listas de la interfaz de que los datos del servidor han cambiado. */
export function refreshData() {
  notify("willy-projects");
}

export function useBackend(): [BackendConfig, (patch: Partial<BackendConfig>) => void] {
  const [cfg, setCfg] = useState<BackendConfig>(DEFAULT_BACKEND);
  useEffect(() => {
    setCfg(readBackend());
    const onChange = () => setCfg(readBackend());
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, []);
  const update = (patch: Partial<BackendConfig>) => setCfg(saveBackend(patch));
  return [cfg, update];
}
