import { createFileRoute } from "@tanstack/react-router";
import { Download, PackageCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import exeAsset from "../../public/downloads/WillyAI-Setup-0.0.21.exe.asset.json";

export const Route = createFileRoute("/descargar")({
  head: () => ({
    meta: [
      { title: "Descargar WILLY AI 0.0.21" },
      { name: "description", content: "Descarga directa del instalador de WILLY AI para Windows 11." },
      { property: "og:title", content: "Descargar WILLY AI 0.0.21" },
      { property: "og:description", content: "Instalador automático de WILLY AI para Windows 11." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DownloadPage,
});

function DownloadPage() {
  const [starting, setStarting] = useState<string | null>(null);

  const download = (asset: { url: string }, name: string) => {
    setStarting(name);
    const link = document.createElement("a");
    link.href = asset.url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => setStarting(null), 1500);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-xl text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-brand-cyan">
          <PackageCheck className="size-8" />
        </div>
        <h1 className="mt-6 font-display text-3xl font-bold sm:text-4xl">WILLY AI 0.0.21</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Instalador automático para Windows 11. Lo instala todo solo, crea el acceso directo en el escritorio y sustituye la versión anterior sin que tengas que hacer nada.
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Novedades: la autoconstrucción ya encuentra los archivos por sí sola, se corrige en una segunda pasada sin que tengas que pulsar nada más y puedes eliminar cualquier propuesta que ya no quieras.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button size="lg" onClick={() => download(exeAsset, "WillyAI-Setup-0.0.21.exe")} disabled={starting !== null}>
            <Download className="size-5" />
            {starting === "WillyAI-Setup-0.0.21.exe" ? "Iniciando descarga…" : "Descargar EXE"}
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">102 MB · Incluye compilador local · Crea el acceso directo en tu escritorio</p>
      </section>
    </main>
  );
}
