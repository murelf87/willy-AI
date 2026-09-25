import { useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Oferta de buscar en internet. La búsqueda solo se envía si se pulsa el botón:
 * el texto sale de tu equipo hacia el buscador (DuckDuckGo o, si no responde, Wikipedia).
 */
export function WebOfferCard({ query, onSearch }: { query: string; onSearch: () => void }) {
  const [state, setState] = useState<"idle" | "used" | "hidden">("idle");
  if (state === "hidden") return null;
  return (
    <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
      <p className="font-semibold text-foreground">¿Quieres que lo busque en internet?</p>
      <p className="mt-1 text-muted-foreground">
        Para datos actuales mi memoria puede estar desactualizada. Si pulsas el botón, se enviará esta búsqueda a DuckDuckGo (o a Wikipedia): «{query}». No se envía nada más ni se hace nada sin que lo pulses.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {state === "idle" ? (
          <>
            <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { setState("used"); onSearch(); }}>
              <Search className="size-3.5" />Buscar en internet
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => setState("hidden")}>
              <X className="size-3.5" />Ahora no
            </Button>
          </>
        ) : (
          <span className="font-semibold text-emerald-500">🔎 Buscando… mira el mensaje que aparece debajo.</span>
        )}
      </div>
    </div>
  );
}
