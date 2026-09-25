// Pantallas de estado (403, 500, sin conexión) con el mismo sistema visual
// que el resto del producto. Se usan en rutas protegidas y errores globales.

import { useEffect, useState } from "react";
import { CloudOff, Home, Lock, RefreshCw, ShieldAlert, TriangleAlert, WifiOff } from "lucide-react";

type Kind = "403" | "404" | "500" | "offline";

const COPY: Record<Kind, { icon: typeof Lock; code: string; title: string; desc: string }> = {
  "403": {
    icon: Lock,
    code: "Acceso restringido",
    title: "Esta zona es solo para el propietario",
    desc: "Si crees que deberías entrar, inicia sesión con la cuenta autorizada.",
  },
  "404": {
    icon: TriangleAlert,
    code: "Página no encontrada",
    title: "Esta página no existe o se ha movido",
    desc: "Comprueba la dirección o vuelve al inicio para seguir donde estabas.",
  },
  "500": {
    icon: ShieldAlert,
    code: "Error interno",
    title: "Algo se rompió por nuestro lado",
    desc: "El problema queda registrado. Puedes intentarlo de nuevo o volver al inicio.",
  },
  offline: {
    icon: CloudOff,
    code: "Sin conexión",
    title: "No hay conexión con internet",
    desc: "WILLY sigue funcionando en local; solo se pierden las funciones que la necesitan.",
  },
};

export function StatusScreen({
  kind,
  onRetry,
}: {
  kind: Kind;
  onRetry?: () => void;
}) {
  const { icon: Icon, code, title, desc } = COPY[kind];
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card">
        <Icon className="size-6 text-primary" />
      </div>
      <p className="mt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">{code}</p>
      <h1 className="mt-2 font-display text-xl font-bold text-foreground">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{desc}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="size-4" />Reintentar
          </button>
        )}
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          <Home className="size-4" />Volver al inicio
        </a>
      </div>
    </div>
  );
}

/** Aviso fijo en la parte inferior cuando el navegador pierde internet. */
export function OfflineBanner() {
  const [mounted, setMounted] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setMounted(true);
    setOffline(!navigator.onLine);

    const on = () => setOffline(true);
    const off = () => setOffline(false);
    window.addEventListener("online", off);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", off);
      window.removeEventListener("offline", on);
    };
  }, []);

  if (!mounted || !offline) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 safe-bottom bg-amber-500/90 px-4 py-2 text-sm font-semibold text-black">
      <WifiOff className="size-4" />Sin conexión: WILLY sigue funcionando en local.
    </div>
  );
}
