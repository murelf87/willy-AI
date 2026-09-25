// Vista previa real del proyecto: el backend arranca el servidor de desarrollo
// y devuelve la dirección donde se está sirviendo.

import { type ServiceResult } from "@/types/domain";
import { api, attempt } from "./backend";

export type PreviewStatus = "RUNNING" | "STOPPED" | "STARTING" | "ERROR";

export type PreviewState = {
  status: PreviewStatus;
  url: string | null;
  port: number | null;
  lastError: string | null;
};

const empty: PreviewState = { status: "STOPPED", url: null, port: null, lastError: null };

async function call(path: string, method: "GET" | "POST"): Promise<ServiceResult<PreviewState>> {
  return attempt(async () => {
    const res = await api<{ preview: PreviewState }>(path, { method, timeoutMs: 60000 });
    return res.preview ?? empty;
  });
}

export const previewService = {
  get: (projectId: string) => call(`/api/projects/${projectId}/preview`, "GET"),
  start: (projectId: string) => call(`/api/projects/${projectId}/preview/start`, "POST"),
  stop: (projectId: string) => call(`/api/projects/${projectId}/preview/stop`, "POST"),
  restart: (projectId: string) => call(`/api/projects/${projectId}/preview/restart`, "POST"),
};
