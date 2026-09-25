// Trabajos de IA en segundo plano: cualquier botón de IA (aclarar texto, Súper IA, traducir, avatar, chat del móvil…)
// puede «minimizarse» o seguir trabajando mientras estás en otra pestaña. Aquí se apuntan esos trabajos para que la
// bandeja flotante (abajo a la derecha) enseñe cuáles siguen en marcha y cuáles han terminado, y te lleve a ellos.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useViewActive } from "@/lib/view-active";

export type BackgroundState = "trabajando" | "listo" | "pregunta" | "error";

export type BackgroundTask = {
  id: string;
  title: string;
  state: BackgroundState;
  detail?: string;
  /** Pestaña a la que llevar al pulsar (id de vista del escritorio: "superia", "traducir"…). */
  view?: string;
  /** Si el trabajo sabe restaurarse solo (una ventana minimizada), se usa esto en vez de cambiar de pestaña. */
  restore?: () => void;
  /** Descartar del todo (cerrar la ventana minimizada). Si falta, la X solo quita el aviso. */
  dismiss?: () => void;
  /** Rev23: el proyecto en el que se trabaja (Proyectos enseña «WILLY trabajando» en su tarjeta). */
  projectId?: string;
};

/** Evento para pedir a la aplicación que abra una pestaña concreta (lo escuchan el escritorio y el móvil). */
export const OPEN_VIEW_EVENT = "willy:abrir-vista";

let tasks: BackgroundTask[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

export function setBackgroundTask(task: BackgroundTask): void {
  const at = tasks.findIndex((t) => t.id === task.id);
  if (at >= 0) {
    const old = tasks[at]!;
    if (old.state === task.state && old.detail === task.detail && old.title === task.title && old.view === task.view && old.projectId === task.projectId) {
      // Mismo aviso: solo se renuevan las funciones, sin cambiar la lista (no hace falta redibujar la bandeja).
      tasks[at] = task;
      return;
    }
    tasks = tasks.map((t, i) => (i === at ? task : t));
  } else {
    tasks = [...tasks, task];
  }
  emit();
}

export function clearBackgroundTask(id: string): void {
  if (!tasks.some((t) => t.id === id)) return;
  tasks = tasks.filter((t) => t.id !== id);
  emit();
}

export function listBackgroundTasks(): BackgroundTask[] {
  return tasks;
}

export function resetBackgroundTasks(): void {
  tasks = [];
  emit();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const EMPTY: BackgroundTask[] = [];

export function useBackgroundTasks(): BackgroundTask[] {
  return useSyncExternalStore(subscribe, () => tasks, () => EMPTY);
}

export function openView(view: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(OPEN_VIEW_EVENT, { detail: view }));
}

/**
 * Para las pantallas con un botón de IA que trabaja «en línea» (Súper IA, Traducir, avatar…): mientras la pestaña está
 * oculta, el trabajo aparece en la bandeja como «trabajando»; si termina mientras no miras, queda como «listo» hasta
 * que vuelvas a la pestaña. Con la pestaña delante no se enseña nada (ya lo estás viendo).
 */
export function useBackgroundReport(o: { id: string; title: string; view: string; running: boolean; detail?: string; error?: string; projectId?: string }): void {
  const active = useViewActive();
  const wasRunning = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    if (active) {
      pending.current = false;
      clearBackgroundTask(o.id);
    } else if (o.running) {
      setBackgroundTask({ id: o.id, title: o.title, state: "trabajando", view: o.view, ...(o.detail ? { detail: o.detail } : {}), ...(o.projectId ? { projectId: o.projectId } : {}) });
    } else if (wasRunning.current || pending.current) {
      pending.current = true;
      setBackgroundTask({ id: o.id, title: o.title, state: o.error ? "error" : "listo", view: o.view, detail: o.error || "Terminado: pulsa para verlo" });
    }
    wasRunning.current = o.running;
  }, [active, o.running, o.detail, o.error, o.id, o.title, o.view, o.projectId]);
  useEffect(() => () => clearBackgroundTask(o.id), [o.id]);
}
