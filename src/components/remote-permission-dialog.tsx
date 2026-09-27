import { useState } from "react";
import { Shield, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface RemoteAction {
  id: string;
  description: string;
  detail?: string;
}

interface Props {
  action: RemoteAction | null;
  onAllow: (id: string) => void;
  onDeny: (id: string) => void;
}

/**
 * Diálogo modal que solicita permiso para CADA acción remota individual.
 * WILLY no ejecuta nada hasta que el usuario pulse «Permitir».
 */
export function RemotePermissionDialog({ action, onAllow, onDeny }: Props) {
  if (!action) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Acción remota pendiente de autorización"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <ShieldAlert className="size-6 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-bold">Solicitud de acción remota</p>
            <p className="text-xs text-muted-foreground">WILLY está intentando ejecutar una acción en tu equipo.</p>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-50/10 p-4 dark:bg-amber-900/10">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">{action.description}</p>
          {action.detail && (
            <p className="mt-1 font-mono text-xs text-muted-foreground break-all">{action.detail}</p>
          )}
        </div>

        <div className="flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => onDeny(action.id)}
          >
            Denegar
          </Button>
          <Button
            className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => onAllow(action.id)}
          >
            <Shield className="size-4" />
            Permitir
          </Button>
        </div>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          Si no reconoces esta acción, pulsa <strong>Denegar</strong>.
        </p>
      </div>
    </div>
  );
}
