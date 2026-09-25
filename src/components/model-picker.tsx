import { ChevronDown, Cloud, Cpu, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { ExternalAiPanel, refreshExternalStatus, useExternalAi } from "@/components/chat-engine-chip";
import { capabilityLabels } from "@/lib/capability-registry";

/**
 * El selector de arriba: con qué IA hablas. Si la IA externa está en uso, el botón la enseña con su nombre
 * («IA externa: Groq +3») y los modelos locales desaparecen de la lista (solo queda «Usar solo tu equipo»).
 * Con «Este equipo», enseña el modelo local de siempre («Olama - llama3.2:3b») y la lista de modelos locales,
 * más el apartado «IA externa» para activarla y elegir cuáles.
 */
export function ModelPicker({ model, models, onPickModel, onManage, ping }: {
  model: string;
  models: string[];
  onPickModel: (name: string) => void;
  onManage: () => void;
  ping: (message: string) => void;
}) {
  const ai = useExternalAi();
  const shortModel = model.split(":")[0] ?? model;
  return (
    <Menu
      wide
      label="Con qué IA hablas"
      trigger={({ open, toggle }) => (
        <Button
          variant="secondary"
          size="sm"
          className="h-9 gap-2 rounded-lg"
          onClick={() => { if (!open) void refreshExternalStatus(5_000); toggle(); }}
          aria-label={ai.external ? `IA externa en uso: ${ai.summary}` : `Modelo de tu equipo: ${model}`}
          title={ai.external ? "La IA externa contesta en los chats (pulsa para ver cuáles y cambiar)" : "Contesta la IA de tu equipo (pulsa para cambiar de modelo o usar IA externa)"}
        >
          {ai.external ? <Cloud className="size-4 shrink-0 text-amber-600" /> : <span className="size-2 shrink-0 rounded-full bg-emerald-500" />}
          <span className={`hidden max-w-56 truncate md:inline ${ai.external ? "font-semibold text-amber-600" : ""}`}>{ai.external ? `IA externa: ${ai.summary}` : `Olama - ${model}`}</span>
          <span className={`max-w-28 truncate md:hidden ${ai.external ? "font-semibold text-amber-600" : ""}`}>{ai.external ? "IA externa" : shortModel}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </Button>
      )}
    >
      {(close) => (
        <>
          {ai.external ? (
            <>
              <div className="p-1.5"><ExternalAiPanel ai={ai} compact /></div>
              <div className="my-1 h-px bg-border" />
              <MenuLabel>Tu equipo</MenuLabel>
              <MenuItem onClick={() => { close(); ai.choose("local"); ping(`Ahora contesta tu equipo (${model}): nada sale de tu ordenador.`); }}>
                <Cpu className="size-4 shrink-0 text-primary" /><span className="truncate">Usar solo tu equipo (sin IA externa)</span>
              </MenuItem>
            </>
          ) : (
            <>
              <MenuLabel>Modelos locales</MenuLabel>
              {models.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Todavía no hay modelos en tu equipo (o su IA está parada).</p>}
              {models.map((name) => (
                <MenuItem key={name} active={name === model} onClick={() => { close(); onPickModel(name); }}>
                  <Cpu className="size-4 shrink-0 text-primary" /><span className="truncate font-mono text-xs">{name}</span>
                  {/* Qué sabe hacer, según el registro de capacidades (así se elige sin saber de modelos). */}
                  {capabilityLabels(name).map((label) => (
                    <span key={label} className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{label}</span>
                  ))}
                </MenuItem>
              ))}
              <div className="my-1 h-px bg-border" />
              <div className="p-1.5"><ExternalAiPanel ai={ai} compact /></div>
            </>
          )}
          <div className="my-1 h-px bg-border" />
          <MenuItem onClick={() => { close(); onManage(); }}><Settings className="size-4" />Gestionar modelos</MenuItem>
        </>
      )}
    </Menu>
  );
}
