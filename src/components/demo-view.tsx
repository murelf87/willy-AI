// Pantalla «Demo para cliente»: con un solo clic genera el informe de avance
// (HTML autónomo) a partir del trabajo real registrado en el panel.

import { useMemo, useState } from "react";
import { CalendarRange, Download, ExternalLink, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/workspace-store";
import { buildDemoHtml, buildReport, type DemoReport } from "@/services/demo-service";
import { useProjects } from "@/services/project-service";

type Ping = (m: string) => void;

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}</div>;
}

function Head({ title, desc, action }: { title: string; desc: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-lg font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      {action}
    </div>
  );
}

export function DemoView({ ping }: { ping: Ping }) {
  const { projects } = useProjects();
  const [report, setReport] = useState<DemoReport | null>(null);

  const preview = useMemo(() => buildReport(projects), [projects]);

  const generate = () => {
    const r = buildReport(projects);
    setReport(r);
    ping(
      `Demo generada: ${r.totals.projects} proyectos, ${r.totals.versions} versiones y ${r.totals.files} archivos. Ya puedes abrirla o descargarla.`,
    );
  };

  const open = () => {
    if (!report) return;
    const html = buildDemoHtml(report);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 20000);
  };

  const save = () => {
    if (!report) return;
    const d = new Date(report.generatedAt);
    const name = `willy-ai-demo-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.html`;
    downloadFile(name, buildDemoHtml(report), "text/html;charset=utf-8");
    ping("Demo descargada. Ábrela en cualquier navegador o envíala por correo.");
  };

  const t = preview.totals;

  return (
    <>
      <Head
        title="Demo para cliente"
        desc="Un botón que resume todo lo construido, con el avance diario y mensual, lista para enseñar o vender."
        action={
          <Button className="gap-2" onClick={generate}>
            <Presentation className="size-4" />Generar demo
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Proyectos", t.projects],
          ["Versiones guardadas", t.versions],
          ["Archivos generados", t.files],
          ["Líneas de código", t.lines],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <p className="font-display text-2xl font-bold text-primary">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{label}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-3">
        <p className="text-sm font-semibold">Qué incluye la demo</p>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>· Resumen con proyectos, versiones, archivos y líneas de código.</li>
          <li>· Gráfico del avance diario y tabla del avance mensual, con el trabajo real.</li>
          <li>· Lista de proyectos con su estado y de las pantallas ya entregadas.</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" className="gap-2" onClick={open} disabled={!report}>
            <ExternalLink className="size-4" />Abrir demo
          </Button>
          <Button size="sm" variant="secondary" className="gap-2" onClick={save} disabled={!report}>
            <Download className="size-4" />Descargar HTML
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={!report}
            onClick={() => {
              if (!report) return;
              open();
              ping("Consejo: en la demo, imprime o «Guardar como PDF» para enviársela al cliente.");
            }}
          >
            <CalendarRange className="size-4" />Guardar como PDF
          </Button>
        </div>
        {!report && (
          <p className="mt-3 text-xs text-muted-foreground">
            Pulsa «Generar demo» para crear el informe con los datos de hoy.
          </p>
        )}
      </Card>

      <Card className="mt-3">
        <p className="text-sm font-semibold">Pantallas incluidas en el informe</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {preview.screens.map((s) => (
            <div key={s.name} className="rounded-lg border border-border bg-background/60 px-3 py-2">
              <p className="text-sm font-semibold">{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
