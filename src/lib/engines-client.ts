import type { CallResult, ChatMessage, PublicStatus } from "@/lib/engines-server";

// Cliente de los motores en la nube. Las claves NO pasan por aquí: se guardan y se usan en el servidor de tu equipo.

async function post<T>(body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch("/api/self-build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function engineStatus(): Promise<PublicStatus | null> {
  const data = await post<{ ok?: boolean; status?: PublicStatus }>({ action: "engines-status" });
  return data?.ok && data.status ? data.status : null;
}

export type EngineCommandResult = { ok: boolean; error?: string; status?: PublicStatus; model?: string; count?: number };

export async function engineCommand(action: "engines-master" | "engines-mode" | "engines-save-key" | "engines-remove-key" | "engines-enable" | "engines-test", payload: Record<string, unknown> = {}): Promise<EngineCommandResult> {
  const data = await post<EngineCommandResult>({ action, ...payload });
  return data ?? { ok: false, error: "No se pudo hablar con el servidor de WILLY." };
}

export async function cloudChat(id: string, messages: ChatMessage[], maxTokens = 6000, temperature?: number): Promise<CallResult> {
  const data = await post<CallResult>({ action: "cloud-chat", id, messages, maxTokens, ...(temperature !== undefined ? { temperature } : {}) });
  return data ?? { ok: false, kind: "transient", error: "No se pudo hablar con el servidor de WILLY." };
}

export async function evidenceImageOf(backup: string, name: "antes.png" | "despues.png"): Promise<string | null> {
  const data = await post<{ ok?: boolean; dataUrl?: string }>({ action: "evidence-image", backup, name });
  return data?.ok && data.dataUrl ? data.dataUrl : null;
}
