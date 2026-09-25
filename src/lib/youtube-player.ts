// Reproductor de YouTube controlable desde WILLY (la API oficial del propio YouTube): permite saber en qué
// segundo va el vídeo, si está en pausa, darle al play y bajar su volumen. Así la voz que traduce sigue al
// vídeo de verdad. Si no se puede cargar (sin internet, o el dueño del vídeo no deja incrustarlo), WILLY
// lo dice y la voz sigue por su cuenta con un reloj.

export type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  getVolume(): number;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
};

type PlayerOptions = {
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: YTPlayer }) => void;
    onStateChange?: (event: { data: number; target: YTPlayer }) => void;
    onError?: (event: { data: number; target: YTPlayer }) => void;
  };
};

export type YTNamespace = {
  Player: new (element: HTMLElement, options: PlayerOptions) => YTPlayer;
  PlayerState: { UNSTARTED: number; ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
};

type YTWindow = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };

export const PLAYER_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

let loading: Promise<YTNamespace | null> | null = null;
export const resetYouTubeApi = (): void => { loading = null; };

/** Carga (una sola vez) la API oficial del reproductor de YouTube. Devuelve null si no se puede. */
export function loadYouTubeApi(timeoutMs = 12_000): Promise<YTNamespace | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const w = window as YTWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  loading ??= new Promise<YTNamespace | null>((resolve) => {
    let done = false;
    const finish = (value: YTNamespace | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!value) loading = null;
      resolve(value);
    };
    const timer = setTimeout(() => finish(w.YT?.Player ? w.YT : null), timeoutMs);
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      finish(w.YT?.Player ? w.YT : null);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => finish(null);
    document.head.appendChild(script);
  });
  return loading;
}

/** Qué significa cada código de error del reproductor, en palabras claras. */
export function playerErrorText(code: number): string {
  if (code === 101 || code === 150 || code === 152) return "El dueño de este vídeo no deja verlo dentro de otras páginas.";
  if (code === 100) return "YouTube dice que este vídeo no existe o es privado.";
  if (code === 153) return "YouTube no ha aceptado la configuración del reproductor.";
  if (code === 2) return "El enlace del vídeo no es válido.";
  if (code === 5) return "El navegador no ha podido reproducir este vídeo.";
  return `El reproductor de YouTube dio el error ${code}.`;
}

/** Crea el reproductor dentro de `host`. Resuelve cuando está listo, o con el motivo si no se pudo. */
export async function createYouTubePlayer(
  host: HTMLElement,
  videoId: string,
  on: { onState?: (state: number) => void; onError?: (message: string, code: number) => void } = {},
  timeoutMs = 15_000,
): Promise<{ player: YTPlayer } | { error: string }> {
  const YT = await loadYouTubeApi();
  if (!YT) return { error: "No se ha podido cargar el reproductor de YouTube (¿sin internet?)." };
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: { player: YTPlayer } | { error: string }) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => settle({ error: "El reproductor de YouTube no ha arrancado a tiempo." }), timeoutMs);
    const mount = document.createElement("div");
    host.replaceChildren(mount);
    try {
      // eslint-disable-next-line no-new
      new YT.Player(mount, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1, origin: window.location.origin },
        events: {
          onReady: (event) => settle({ player: event.target }),
          onStateChange: (event) => on.onState?.(event.data),
          onError: (event) => {
            const message = playerErrorText(event.data);
            on.onError?.(message, event.data);
            settle({ error: message });
          },
        },
      });
    } catch (error) {
      settle({ error: error instanceof Error ? error.message : "No se ha podido crear el reproductor de YouTube." });
    }
  });
}
