// Voz natural COMPARTIDA por todas las pestañas: la que eliges en una (Chat, Móvil, Lectura, Traducir, Súper IA,
// OCR, Libros…) vale para todas, y cambia al momento incluso en las pestañas que ya estaban abiertas.
// Antes cada pestaña leía la voz solo al abrirse, y Traducir guardaba la suya aparte.

import { useEffect, useState } from "react";
import { voiceStatus, type VoiceStatus } from "@/lib/natural-voice";

export const VOICE_KEY = "willy-voz-natural";
const CHANGE_EVENT = "willy-voz-natural-cambio";

function readStored(): string {
  try {
    return window.localStorage.getItem(VOICE_KEY) ?? "";
  } catch {
    return "";
  }
}

let statusPromise: Promise<VoiceStatus | null> | null = null;
let lastRefresh = 0;
/** Estado de las voces instaladas, pedido una sola vez para todas las pestañas (o de nuevo si `refresh`,
 *  pero como mucho una vez por segundo aunque lo pidan varias pestañas a la vez). */
export function sharedVoiceStatus(refresh = false): Promise<VoiceStatus | null> {
  const forced = refresh && Date.now() - lastRefresh > 1000;
  if (forced || !statusPromise) {
    lastRefresh = Date.now();
    statusPromise = voiceStatus().then((status) => {
      if (!status) statusPromise = null;
      return status;
    });
  }
  return statusPromise;
}

/** Elige la voz para todas las pestañas. */
export function setSharedVoice(id: string): void {
  try {
    window.localStorage.setItem(VOICE_KEY, id);
  } catch {
    /* sin almacenamiento: vale solo mientras la página esté abierta */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: id }));
}

/** Vuelve a mirar qué voces hay instaladas (por ejemplo, tras descargar una nueva) en todas las pestañas. */
export function refreshSharedVoices(): void {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** La voz de una lista: la guardada si sigue instalada; si no, la activa del equipo o la primera. */
export function effectiveVoice(stored: string, status: VoiceStatus | null): string {
  const installed = status?.installed ?? [];
  if (!installed.length) return stored;
  if (installed.some((v) => v.id === stored)) return stored;
  return installed.find((v) => v.active)?.id ?? installed[0]!.id;
}

export function useSharedVoice(): { voice: string; setVoice: (id: string) => void; voices: VoiceStatus | null } {
  const [stored, setStored] = useState(readStored);
  const [voices, setVoices] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = (force: boolean) => {
      void sharedVoiceStatus(force).then((status) => {
        if (!alive) return;
        setVoices(status);
        const current = readStored();
        const fixed = effectiveVoice(current, status);
        if (fixed && fixed !== current) setSharedVoice(fixed);
      });
    };
    const onChange = () => { setStored(readStored()); refresh(true); };
    const onStorage = (event: StorageEvent) => { if (event.key === VOICE_KEY) setStored(readStored()); };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    refresh(false);
    return () => {
      alive = false;
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return { voice: effectiveVoice(stored, voices), setVoice: setSharedVoice, voices };
}

/** Selector compacto de voz natural (el mismo en todas las pestañas). No aparece si todavía no hay voces instaladas. */
export function VoiceSelect({ className = "" }: { className?: string }) {
  const { voice, setVoice, voices } = useSharedVoice();
  if (!voices?.installed.length) return null;
  return (
    <select
      value={voice}
      onChange={(event) => setVoice(event.target.value)}
      aria-label="Voz natural"
      title="Voz natural (vale para todas las pestañas)"
      className={`h-8 max-w-44 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary ${className}`}
    >
      {voices.installed.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
    </select>
  );
}
