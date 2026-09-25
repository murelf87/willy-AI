import { useEffect, useState } from "react";
import { Apple, Check, Download, Monitor, Smartphone, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard as Card } from "@/components/panel-card";
import { downloadFile } from "@/lib/workspace-store";
import { DEFAULT_PORTS, LAUNCHERS, launcherScript, localAppUrl } from "@/lib/launchers";
import type { Ping } from "@/types/domain";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Acceso directo: instalar WILLY AI como aplicación y arrancar la IA local de un clic. */
export function InstallView({ endpoint, model, ping }: { endpoint: string; model: string; ping: Ping }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    const onInstalled = () => { setInstalled(true); ping("WILLY AI instalada como aplicación en este dispositivo."); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [ping]);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setPrompt(null);
    ping(choice.outcome === "accepted" ? "Instalando WILLY AI..." : "Instalación cancelada.");
  };

  const appUrl = localAppUrl();

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-start gap-3">
          <Zap className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Instalar WILLY AI como aplicación</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Se abre en su propia ventana, con icono propio y sin barra del navegador, en Windows, Android e iOS.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {installed ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-500"><Check className="size-4" />Ya está instalada en este dispositivo.</span>
              ) : (
                <Button onClick={() => void install()} disabled={!prompt}>
                  <Download className="size-4" />Instalar ahora
                </Button>
              )}
              {!installed && !prompt && !ios && (
                <span className="text-xs text-muted-foreground">
                  Si el botón está apagado, usa el menú del navegador → «Instalar aplicación».
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <p className="flex items-center gap-2 text-sm font-semibold"><Apple className="size-4 text-primary" />iPhone y iPad</p>
          <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>1. Abre esta página en Safari.</li>
            <li>2. Pulsa el botón Compartir.</li>
            <li>3. Elige «Añadir a pantalla de inicio».</li>
          </ol>
        </Card>
        <Card>
          <p className="flex items-center gap-2 text-sm font-semibold"><Smartphone className="size-4 text-primary" />Android</p>
          <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>1. Abre esta página en Chrome.</li>
            <li>2. Pulsa «Instalar ahora» o el menú ⋮.</li>
            <li>3. Elige «Instalar aplicación».</li>
          </ol>
        </Card>
      </div>

      <Card>
        <p className="flex items-center gap-2 text-sm font-semibold"><Monitor className="size-4 text-primary" />Arrancar todo en tu ordenador con un acceso directo</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Un solo archivo abre Docker, el motor de IA en {endpoint} con el modelo {model}, el backend en el puerto {DEFAULT_PORTS.api} y WILLY AI en {appUrl}. No se conecta a internet.
        </p>
        <div className="mt-3 space-y-2">
          {LAUNCHERS.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{l.name}</p>
                <p className="text-[11px] text-muted-foreground">{l.how}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  downloadFile(l.file, launcherScript(l.id, endpoint, model, DEFAULT_PORTS), "text/plain;charset=utf-8");
                  ping(`Lanzador de ${l.name} descargado.`);
                }}
              >
                <Download className="size-4" />{l.file}
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
