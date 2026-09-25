import { useEffect, useRef, useState } from "react";
import { Check, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listLocalModels } from "@/lib/local-ai";
import { dismissNeed, type Suggestion } from "@/lib/capabilities";
import { pullModel } from "@/services/model-catalog";

type Phase = "idle" | "working" | "done" | "error" | "hidden";

function Row({ s, endpoint, ping, onUse }: { s: Suggestion; endpoint: string; ping: (m: string) => void; onUse: (model: string) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [used, setUsed] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Si el modelo ya se instaló (por ejemplo, en una conversación anterior), no se vuelve a ofrecer.
  useEffect(() => {
    if (s.action !== "install") return;
    let alive = true;
    void listLocalModels(endpoint).then((names) => {
      if (alive && names.includes(s.model)) setPhase("done");
    });
    return () => {
      alive = false;
    };
  }, [s.model]);

  const install = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setPhase("working");
    setPercent(null);
    setStatus("preparando");
    setError("");
    const result = await pullModel(endpoint, s.model, (p) => { setStatus(p.status); setPercent(p.percent); }, controller.signal);
    abort.current = null;
    if (result.ok) {
      setPhase("done");
      ping(`✅ ${s.label} instalado en tu equipo.`);
    } else if (controller.signal.aborted) {
      setPhase("idle");
    } else {
      setPhase("error");
      setError(result.error);
    }
  };

  const later = () => {
    dismissNeed(s.need);
    setPhase("hidden");
  };

  const use = () => {
    onUse(s.model);
    setUsed(true);
  };

  if (phase === "hidden") return null;

  return (
    <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
      <p className="font-semibold text-foreground">
        {s.action === "install" ? `Te falta un modelo: ${s.label}` : `Esto sale mejor con ${s.model}`}
      </p>
      <p className="mt-1 text-muted-foreground">{s.why}</p>
      {s.action === "install" && (
        <p className="mt-1 text-muted-foreground">
          Se descarga de internet (aprox. {s.size}; recomendado {s.ram} de memoria). Es gratis y no se instala nada más.
        </p>
      )}

      {phase === "working" && (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent ?? 5}%` }} />
          </div>
          <p className="mt-1 text-muted-foreground">
            {percent === null ? status : `${status} · ${percent}%`} — puedes seguir usando WILLY mientras tanto.
          </p>
        </div>
      )}
      {phase === "error" && <p className="mt-2 font-semibold text-destructive">⚠️ {error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {s.action === "install" && phase !== "working" && phase !== "done" && (
          <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void install()}>
            <Download className="size-3.5" />{phase === "error" ? "Reintentar" : "Instalar ahora"}
          </Button>
        )}
        {s.action === "install" && phase === "working" && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => abort.current?.abort()}>Cancelar</Button>
        )}
        {(s.action === "use" || phase === "done") && !used && (
          <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={use}>
            <Check className="size-3.5" />{phase === "done" ? "Ya está instalado: usarlo" : "Usarlo"}
          </Button>
        )}
        {used && <span className="font-semibold text-emerald-500">✅ Ahora el chat usa {s.model}.</span>}
        {phase !== "working" && !used && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={later}><X className="size-3.5" />Ahora no</Button>
        )}
      </div>
    </div>
  );
}

export function CapabilityCard({ suggestions, endpoint, ping, onUse }: { suggestions: Suggestion[]; endpoint: string; ping: (m: string) => void; onUse: (model: string) => void }) {
  return (
    <>
      {suggestions.map((s) => (
        <Row key={`${s.need}-${s.model}`} s={s} endpoint={endpoint} ping={ping} onUse={onUse} />
      ))}
    </>
  );
}
