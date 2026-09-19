import { useState } from "react";
import { Download, FileCheck2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_VERSION } from "@/lib/version";
import { downloadFile } from "@/lib/workspace-store";
import { readSelfBuild } from "@/lib/self-build-store";

type Ping = (message: string) => void;

export function UpdateView({ ping }: { ping: Ping }) {
  const [installer, setInstaller] = useState<File | null>(null);

  const choose = (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".exe")) {
      setInstaller(null);
      ping("Selecciona un instalador de WILLY con extensión .exe.");
      return;
    }
    setInstaller(file);
    ping(`Actualización preparada: ${file.name}.`);
  };

  const prepare = () => {
    if (!installer) return ping("Selecciona primero el nuevo instalador .exe.");
    const backup = {
      currentVersion: APP_VERSION,
      createdAt: new Date().toISOString(),
      settings: window.localStorage.getItem("willy-settings"),
      profile: window.localStorage.getItem("willy-profile"),
      selfBuild: readSelfBuild(),
    };
    downloadFile(
      `willy-ai-${APP_VERSION}-antes-de-actualizar.json`,
      JSON.stringify(backup, null, 2),
      "application/json;charset=utf-8",
    );
    const url = URL.createObjectURL(installer);
    const link = document.createElement("a");
    link.href = url;
    link.download = installer.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    ping("Copia creada. Abre el instalador descargado para completar la actualización.");
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><RefreshCw className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Actualizar WILLY AI</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Instala una versión nueva desde un único archivo .exe. Antes se descarga una copia de tus ajustes.</p>
        </div>
        <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs font-semibold">v{APP_VERSION}</span>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-background p-3 text-sm hover:border-primary">
        <FileCheck2 className="size-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">{installer?.name ?? "Seleccionar actualización .exe"}</span>
        <input type="file" accept=".exe,application/vnd.microsoft.portable-executable" className="sr-only" onChange={(event) => choose(event.target.files?.[0])} />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" className="gap-2" disabled={!installer} onClick={prepare}><Download className="size-4" />Preparar actualización</Button>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" />Copia previa automática</span>
      </div>
    </section>
  );
}