import { useEffect } from "react";

/** Cierra (un modal, una ventana…) al pulsar Escape. Antes cada ventana modal tenía su propia copia de este mismo efecto. */
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
