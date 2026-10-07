import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";

async function paths() {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const home = os.homedir();
  const local = process.env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local");
  return {
    fs,
    exe: path.join(local, "Programs", "Open CoDesign", "Open CoDesign.exe"),
    config: path.join(home, ".config", "open-codesign", "config.toml"),
  };
}

async function ollamaStatus() {
  try {
    const r = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { online: false, models: [] as string[] };
    const data = (await r.json()) as { models?: Array<{ name?: string }> };
    return {
      online: true,
      models: (data.models ?? []).map((m) => m.name ?? "").filter(Boolean),
    };
  } catch {
    return { online: false, models: [] as string[] };
  }
}

export const Route = createFileRoute("/api/open-codesign")({
  server: {
    handlers: {
      GET: async () => {
        const { fs, exe, config } = await paths();
        const ollama = await ollamaStatus();
        return Response.json({
          installed: process.platform === "win32" && fs.existsSync(exe),
          exe,
          configured: fs.existsSync(config),
          config,
          ollama,
        }, { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        const { fs, exe } = await paths();
        if (process.platform !== "win32" || !fs.existsSync(exe)) {
          return Response.json({ ok: false, error: "Open CoDesign no está instalado en este equipo." }, { status: 404 });
        }
        try {
          const { spawn } = await import("node:child_process");
          const child = spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: false });
          child.unref();
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json({
            ok: false,
            error: error instanceof Error ? error.message : "No se pudo abrir Open CoDesign.",
          }, { status: 500 });
        }
      },
    },
  },
});
