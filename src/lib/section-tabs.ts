import { useEffect } from "react";
import { usePersistentState } from "@/lib/persistent-state";

// Abrir una pantalla directamente en una de sus pestañas (por ejemplo «Ajustes → Sistema» desde la barra de arriba o
// «Centro de Inteligencia → Modelos» desde «Gestionar modelos»). Sirve aunque la pantalla ya estuviera abierta (oculta):
// la petición llega como evento y, si todavía no existía, se recoge al montarse.

export const SECTION_TAB_EVENT = "willy:pestana-seccion";

const pending: Record<string, string> = {};

/** Pide que la pantalla `section` se muestre en la pestaña `tab` (la pantalla la aplica si la conoce). */
export function requestSectionTab(section: string, tab: string): void {
  pending[section] = tab;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SECTION_TAB_EVENT, { detail: { section, tab } }));
}

/** Recoge (y olvida) la pestaña pedida para `section` antes de que se montara. */
export function takeSectionTab(section: string): string | null {
  const tab = pending[section] ?? null;
  delete pending[section];
  return tab;
}

/** Pestaña de una pantalla: se recuerda entre visitas y obedece a `requestSectionTab`. */
export function useSectionTab<T extends string>(section: string, tabs: readonly T[], fallback: T): [T, (tab: T) => void] {
  const [tab, setTab] = usePersistentState<T>(`${section}:pestana`, fallback);
  useEffect(() => {
    const wanted = takeSectionTab(section);
    if (wanted && (tabs as readonly string[]).includes(wanted)) setTab(wanted as T);
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: string; tab?: string }>).detail;
      if (detail?.section !== section || !detail.tab || !(tabs as readonly string[]).includes(detail.tab)) return;
      takeSectionTab(section);
      setTab(detail.tab as T);
    };
    window.addEventListener(SECTION_TAB_EVENT, onRequest);
    return () => window.removeEventListener(SECTION_TAB_EVENT, onRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);
  const safe = (tabs as readonly string[]).includes(tab) ? tab : fallback;
  return [safe, setTab];
}

/**
 * Pantallas que ya no existen como tales desde la revisión 20 y dónde están ahora: si algo (una tarea en segundo plano,
 * un enlace antiguo) pide abrir una de ellas, se abre su sitio nuevo en la pestaña que corresponde.
 */
export const MOVED_VIEWS: Readonly<Record<string, { view: string; tab: string }>> = {
  configuracion: { view: "ajustes", tab: "general" },
  estado: { view: "ajustes", tab: "sistema" },
  workspace: { view: "ajustes", tab: "sistema" },
  modelos: { view: "inteligencia", tab: "modelos" },
  agentes: { view: "inteligencia", tab: "agentes" },
};
