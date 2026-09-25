/** Guiones de arranque 100% locales: Docker, motor de IA, backend y WILLY AI en tu propio ordenador. */

import { MODEL_CATALOG } from "@/services/model-catalog";

export type LauncherId = "windows" | "macos" | "linux";

/** Todos los modelos gratuitos del catálogo, que se descargan solos en el primer arranque. */
export const ALL_MODELS: string[] = MODEL_CATALOG.map((m) => m.name);

export type LocalPorts = {
  /** Puerto donde se sirve WILLY AI en tu ordenador. */
  app: number;
  /** Puerto del backend (Fastify). */
  api: number;
};

export const DEFAULT_PORTS: LocalPorts = { app: 3000, api: 4000 };

/** URL local de la aplicación (nunca apunta a internet). */
export function localAppUrl(ports: LocalPorts = DEFAULT_PORTS): string {
  return `http://localhost:${ports.app}/app`;
}

export function launcherScript(
  id: LauncherId,
  endpoint: string,
  model: string,
  ports: LocalPorts = DEFAULT_PORTS,
): string {
  const host = endpoint.replace(/^https?:\/\//, "");
  const appUrl = localAppUrl(ports);

  if (id === "windows") {
    return [
      "@echo off",
      "title WILLY AI - arranque local",
      "setlocal",
      `set "APP_PORT=${ports.app}"`,
      `set "API_PORT=${ports.api}"`,
      "set \"OLLAMA_ORIGINS=*\"",
      `set "OLLAMA_HOST=${host}"`,
      "cd /d \"%~dp0\"",
      "",
      "where node >nul 2>&1 || (",
      "  echo Falta Node.js. Se abre la descarga; instálalo y vuelve a ejecutar este archivo.",
      "  start \"\" https://nodejs.org/es/download",
      "  pause",
      "  exit /b 1",
      ")",
      "",
      "echo [1/5] Comprobando Docker Desktop...",
      "docker info >nul 2>&1",
      "if errorlevel 1 (",
      "  echo   Abriendo Docker Desktop...",
      "  start \"\" \"%ProgramFiles%\\Docker\\Docker\\Docker Desktop.exe\"",
      "  for /l %%i in (1,1,60) do (",
      "    docker info >nul 2>&1 && goto dockerok",
      "    timeout /t 2 >nul",
      "  )",
      ")",
      ":dockerok",
      "",
      "echo [2/5] Servicios en contenedores...",
      "if exist \"backend\\docker-compose.yml\" docker compose -f backend\\docker-compose.yml up -d",
      "if exist \"docker-compose.yml\" docker compose up -d",
      "",
      "echo [3/5] Motor de IA local...",
      "where ollama >nul 2>&1 || (",
      "  echo   Instalando el motor de IA (Ollama). Puede tardar unos minutos...",
      "  winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent",
      "  set \"PATH=%PATH%;%LOCALAPPDATA%\\Programs\\Ollama\"",
      ")",
      "start \"\" /b ollama serve",
      "timeout /t 5 >nul",
      "if not exist \"modelos-listos.txt\" (",
      "  echo   Descargando todos los modelos gratuitos. Solo ocurre la primera vez.",
      ...ALL_MODELS.map((m) => `  echo     - ${m} & ollama pull ${m}`),
      "  echo listo> modelos-listos.txt",
      ")",
      `start "" /b ollama run ${model} --keepalive 30m`,
      "",
      "echo [4/5] Backend en el puerto %API_PORT%...",
      "if exist \"backend\\package.json\" start \"WILLY backend\" /min cmd /c \"cd backend && pnpm run dev\"",
      "",
      "echo [5/5] WILLY AI en el puerto %APP_PORT%...",
      "set \"PORT=%APP_PORT%\"",
      "start \"WILLY AI\" /min cmd /c \"node .output\\server\\index.mjs\"",
      "for /l %%i in (1,1,40) do (",
      "  powershell -NoProfile -Command \"try{(Invoke-WebRequest -UseBasicParsing http://localhost:%APP_PORT%/ -TimeoutSec 2)|Out-Null;exit 0}catch{exit 1}\" >nul 2>&1 && goto listo",
      "  timeout /t 1 >nul",
      ")",
      ":listo",
      `start "" ${appUrl}`,
      "exit",
      "",
    ].join("\r\n");
  }

  const open = id === "macos" ? "open" : "xdg-open";
  const dockerApp = id === "macos"
    ? "open -a Docker"
    : "systemctl --user start docker-desktop 2>/dev/null || sudo systemctl start docker";
  return [
    "#!/bin/bash",
    "# Arranque local completo de WILLY AI: Docker, motor de IA, backend y aplicación.",
    "cd \"$(dirname \"$0\")\"",
    `export APP_PORT=${ports.app}`,
    `export API_PORT=${ports.api}`,
    "export OLLAMA_ORIGINS='*'",
    `export OLLAMA_HOST='${host}'`,
    "",
    "echo '[1/5] Comprobando Docker...'",
    `docker info >/dev/null 2>&1 || { ${dockerApp}; for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done; }`,
    "",
    "echo '[2/5] Servicios en contenedores...'",
    "[ -f backend/docker-compose.yml ] && docker compose -f backend/docker-compose.yml up -d",
    "[ -f docker-compose.yml ] && docker compose up -d",
    "",
    "echo '[3/5] Motor de IA local...'",
    "command -v ollama >/dev/null 2>&1 || curl -fsSL https://ollama.com/install.sh | sh",
    "ollama serve >/dev/null 2>&1 &",
    "sleep 5",
    "if [ ! -f modelos-listos.txt ]; then",
    "  echo '  Descargando todos los modelos gratuitos (solo la primera vez)...'",
    ...ALL_MODELS.map((m) => `  echo '    - ${m}'; ollama pull ${m}`),
    "  echo listo > modelos-listos.txt",
    "fi",
    `ollama run ${model} --keepalive 30m >/dev/null 2>&1 &`,
    "",
    "echo '[4/5] Backend...'",
    "[ -f backend/package.json ] && (cd backend && pnpm run dev >/dev/null 2>&1 &)",
    "",
    "echo '[5/5] WILLY AI...'",
    "PORT=$APP_PORT node .output/server/index.mjs >/dev/null 2>&1 &",
    "for i in $(seq 1 40); do curl -sf -o /dev/null \"http://localhost:$APP_PORT/\" && break; sleep 1; done",
    `${open} "${appUrl}"`,
    "",
  ].join("\n");
}

export const LAUNCHERS: { id: LauncherId; name: string; file: string; how: string }[] = [
  {
    id: "windows",
    name: "Windows 11",
    file: "willy-ai.bat",
    how: "Déjalo dentro de la carpeta de WILLY AI y haz doble clic. Abre Docker, el motor de IA, el backend y la aplicación en localhost:3000.",
  },
  {
    id: "macos",
    name: "macOS",
    file: "willy-ai.command",
    how: "Guárdalo en la carpeta de WILLY AI, dale permiso con «chmod +x willy-ai.command» y haz doble clic.",
  },
  {
    id: "linux",
    name: "Linux",
    file: "willy-ai.sh",
    how: "Guárdalo en la carpeta de WILLY AI, dale permiso con «chmod +x willy-ai.sh» y ejecútalo.",
  },
];
