import { createFileRoute } from "@tanstack/react-router";

// Arranque y reparación del motor de IA del propio equipo (Ollama).
// Solo funciona en el programa instalado, donde WILLY AI corre sobre Node en Windows.

const OLLAMA_URL = "http://127.0.0.1:11434";
const FAST_MODEL = "llama3.2:3b";

async function engineAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function installedModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name?: string }[] };
    return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

/** Ejecuta un comando de Windows sin ventana. Devuelve false si el entorno no lo permite. */
async function run(command: string, wait: boolean): Promise<boolean> {
  try {
    const { spawn } = await import("node:child_process");
    const child = spawn("cmd.exe", ["/d", "/s", "/c", command], {
      windowsHide: true,
      detached: !wait,
      stdio: "ignore",
    });
    if (!wait) {
      child.unref();
      return true;
    }
    return await new Promise<boolean>((resolve) => {
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });
  } catch {
    return false;
  }
}

async function waitAlive(seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    if (await engineAlive()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export const Route = createFileRoute("/api/engine")({
  server: {
    handlers: {
      GET: async () => {
        const alive = await engineAlive();
        const models = alive ? await installedModels() : [];
        return Response.json({ alive, models, ready: alive && models.length > 0 });
      },
      POST: async () => {
        // 1. ¿Ya responde? Entonces solo falta un modelo.
        let alive = await engineAlive();

        // 2. Arrancar el motor si está instalado pero parado.
        if (!alive) {
          await run(`set "PATH=%PATH%;%LOCALAPPDATA%\\Programs\\Ollama" && ollama serve`, false);
          alive = await waitAlive(8);
        }

        // 3. Instalarlo si no está en el equipo.
        if (!alive) {
          const installed =
            (await run(
              'winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent',
              true,
            )) ||
            (await run(
              'powershell -NoProfile -WindowStyle Hidden -Command "Invoke-WebRequest -UseBasicParsing https://ollama.com/download/OllamaSetup.exe -OutFile \\"$env:TEMP\\OllamaSetup.exe\\"; Start-Process -Wait \\"$env:TEMP\\OllamaSetup.exe\\" -ArgumentList \'/VERYSILENT\',\'/NORESTART\'"',
              true,
            ));
          if (!installed) {
            return Response.json(
              {
                ok: false,
                error:
                  "No he podido instalar el motor de IA automáticamente. Abre WILLY AI desde su acceso directo del escritorio (el programa instalado) para que pueda hacerlo.",
              },
              { status: 503 },
            );
          }
          await run(`set "PATH=%PATH%;%LOCALAPPDATA%\\Programs\\Ollama" && ollama serve`, false);
          alive = await waitAlive(20);
        }

        if (!alive) {
          return Response.json(
            { ok: false, error: "El motor de IA no ha arrancado. Reinicia el equipo y vuelve a abrir WILLY AI." },
            { status: 503 },
          );
        }

        // 4. Asegurar al menos un modelo pequeño para que el chat responda.
        let models = await installedModels();
        let pulling = false;
        if (!models.length) {
          pulling = true;
          await run(`set "PATH=%PATH%;%LOCALAPPDATA%\\Programs\\Ollama" && ollama pull ${FAST_MODEL}`, false);
          for (let i = 0; i < 20 && !models.length; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            models = await installedModels();
          }
        }

        return Response.json({ ok: true, alive: true, models, pulling: pulling && !models.length, model: models[0] ?? FAST_MODEL });
      },
    },
  },
});
