import { buildClaudePack } from "@/lib/claude-pack";
import type { WillyImprovement } from "@/lib/self-build-store";

// Puente manual con los servicios que NO ofrecen API gratuita (ChatGPT, Claude, Gemini, Grok, Perplexity): WILLY
// prepara el paquete, abre el servicio, tú pegas la respuesta y WILLY la aplica con copia, compilación y pruebas.
// Se usa cada servicio tal como está pensado (una persona delante), sin automatizar sus páginas.

export const SITES = [
  { id: "claude", name: "Claude", url: "https://claude.ai/new" },
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app" },
  { id: "grok", name: "Grok", url: "https://grok.com/" },
  { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/" },
] as const;

export async function packFor(item: WillyImprovement, version: string): Promise<string> {
  let code = "";
  try {
    const res = await fetch("/api/self-build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "context", name: item.request, proposal: item.proposal, attachments: (item.attachments ?? []).map((file) => file.name), screenshots: (item.screenshots ?? []).map((shot) => shot.description.slice(0, 600)) }),
    });
    const data = (await res.json()) as { ok?: boolean; context?: string };
    if (data.ok) code = data.context ?? "";
  } catch {
    /* se envía sin el código relacionado */
  }
  return buildClaudePack({
    version,
    request: item.request,
    proposal: item.proposal,
    status: item.status,
    result: item.result ?? "",
    attachments: item.attachments ?? [],
    screenshots: item.screenshots ?? [],
    code,
    forWilly: true,
  });
}

/** Enlace «Build with URL» de Lovable: abre Lovable con tu prompt escrito. Si es demasiado largo para un enlace, devuelve null. */
export function lovableUrl(prompt: string): string | null {
  const url = `https://lovable.dev/?autosubmit=false&prompt=${encodeURIComponent(prompt)}`;
  return url.length <= 6000 ? url : null;
}
