import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Lock, LogIn } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Pantalla de acceso: se enseña cuando WILLY AI se usa desde fuera del propio ordenador (móvil, servidor) y el dueño
// ha activado la contraseña en Ajustes → General → Acceso desde fuera. Pide la contraseña, la comprueba en el servidor
// (/api/acceso) y, si es correcta, vuelve a la página que se quería abrir.

export const Route = createFileRoute("/acceso")({
  head: () => ({
    meta: [
      { title: "Acceso a WILLY AI" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccesoPage,
});

type Estado = { activo: boolean; configurado: boolean; sesion: boolean; local: boolean };

/** Solo se vuelve a rutas de la propia WILLY (nunca a otra web). */
function destinoSeguro(valor: string | null): string {
  if (!valor || !valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/acceso")) return "/app";
  return valor;
}

function AccesoPage() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [volver, setVolver] = useState("/app");

  useEffect(() => {
    setVolver(destinoSeguro(new URLSearchParams(window.location.search).get("volver")));
    void (async () => {
      try {
        const res = await fetch("/api/acceso", { cache: "no-store" });
        const data = (await res.json()) as Estado;
        setEstado(data);
        if (data.sesion || !data.activo || data.local) window.location.replace(destinoSeguro(new URLSearchParams(window.location.search).get("volver")));
      } catch {
        setEstado({ activo: true, configurado: true, sesion: false, local: false });
      }
    })();
  }, []);

  const entrar = async (event: FormEvent) => {
    event.preventDefault();
    if (!contrasena || enviando) return;
    setEnviando(true);
    setError("");
    try {
      const res = await fetch("/api/acceso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "entrar", contrasena }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        window.location.replace(volver);
        return;
      }
      setError(data.error || "No se ha podido entrar.");
    } catch {
      setError("No hay conexión con WILLY AI.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-border bg-card">
          <Lock className="size-6 text-primary" />
        </div>
        <p className="mt-4 text-center text-xs font-bold uppercase tracking-wide text-muted-foreground">Acceso restringido</p>
        <h1 className="mt-2 text-center font-display text-xl font-bold">Acceso a WILLY AI</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">Estás entrando desde fuera del ordenador del dueño. Escribe la contraseña de acceso.</p>

        <form onSubmit={(event) => void entrar(event)} className="mt-6 space-y-3 rounded-xl border border-border bg-card p-4">
          <label className="block text-xs font-semibold text-muted-foreground" htmlFor="acceso-contrasena">Contraseña</label>
          <Input
            id="acceso-contrasena"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={contrasena}
            onChange={(event) => setContrasena(event.target.value)}
            placeholder="Tu contraseña de acceso"
            disabled={enviando}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full gap-2" disabled={enviando || !contrasena}>
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}Entrar
          </Button>
          {estado && !estado.activo && (
            <p className="text-xs text-muted-foreground">El acceso con contraseña no está activado en este WILLY AI.</p>
          )}
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">La contraseña se cambia en el ordenador del dueño: Ajustes → General → Acceso desde fuera.</p>
      </section>
    </main>
  );
}
