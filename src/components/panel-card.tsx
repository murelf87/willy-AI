// Tarjeta sencilla (borde + fondo, sin las cabeceras/pies de components/ui/card.tsx) que varias pantallas de
// contenido (OCR, Lectura en voz alta, Demo, GitHub…) repetían cada una por su cuenta, letra por letra. Admite
// los manejadores de arrastrar-y-soltar para cuando la tarjeta hace de zona donde soltar un archivo.
import type { ReactNode } from "react";

type PanelCardProps = {
  children: ReactNode;
  className?: string;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
};

export function PanelCard({ children, className = "", ...drag }: PanelCardProps) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 ${className}`} {...drag}>
      {children}
    </div>
  );
}
