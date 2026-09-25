import { useSyncExternalStore } from "react";
import { useViewActive } from "@/lib/view-active";
import type { SystemSnapshot } from "@/lib/system-info";

// Lectura en directo del equipo para la pestaña Inicio. Una sola consulta compartida por todos los
// componentes que la muestran: cada 2 segundos mientras haya alguno en pantalla y la pestaña esté visible.
// La lectura ampliada (procesos, plan de energía, copias) se pide cada 8 lecturas porque es más lenta.

export type SystemState = {
  snapshot: SystemSnapshot | null;
  error: string;
  cpuHistory: number[];
  memoryHistory: number[];
  updatedAt: number;
};

const EMPTY: SystemState = { snapshot: null, error: "", cpuHistory: [], memoryHistory: [], updatedAt: 0 };
const HISTORY = 30;
const listeners = new Set<() => void>();
let state: SystemState = EMPTY;
let timer: number | undefined;
let busy = false;
let tick = 0;

const emit = () => listeners.forEach((listener) => listener());
const push = (list: number[], value: number | null) => (value === null ? list : [...list, value].slice(-HISTORY));

async function poll(): Promise<void> {
  if (busy || (typeof document !== "undefined" && document.hidden)) return;
  busy = true;
  const more = tick % 8 === 0;
  try {
    const res = await fetch(`/api/engine?stats=1${more ? "&more=1" : ""}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}.`);
    const basic = (await res.json()) as SystemSnapshot;
    const previous = state.snapshot;
    // La lectura básica no trae lo pesado: se conserva lo último que se leyó.
    const snapshot: SystemSnapshot = {
      ...basic,
      ...(basic.processes ?? previous?.processes ? { processes: basic.processes ?? previous?.processes ?? [] } : {}),
      ...(basic.power !== undefined ? { power: basic.power } : previous?.power !== undefined ? { power: previous.power } : {}),
      ...(basic.backups ?? previous?.backups ? { backups: basic.backups ?? previous?.backups } : {}),
    } as SystemSnapshot;
    state = { snapshot, error: "", cpuHistory: push(state.cpuHistory, basic.cpu.percent), memoryHistory: push(state.memoryHistory, basic.memory.percent), updatedAt: Date.now() };
  } catch (error) {
    state = { ...state, error: error instanceof Error ? error.message : "No se pudo leer el equipo." };
  } finally {
    busy = false;
    tick += 1;
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    tick = 0;
    void poll();
    timer = window.setInterval(() => void poll(), 2000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Datos del equipo en directo. `refreshNow()` fuerza una lectura ampliada (por ejemplo, tras una acción). */
const idle = () => () => undefined;

export function useSystem(): SystemState {
  // Si la pestaña está oculta (pero viva) no se suscribe: no consulta al equipo cada 2 segundos para nada.
  const active = useViewActive();
  return useSyncExternalStore(active ? subscribe : idle, () => state, () => EMPTY);
}

export function refreshNow(): void {
  tick = 0;
  void poll();
}
