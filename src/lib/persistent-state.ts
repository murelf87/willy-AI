import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

// Conserva lo que escribes o generas aunque recargues la página (por ejemplo, tras una actualización o una mejora de la
// Autoconstrucción). Se guarda solo en este equipo (localStorage). Nunca se usa para claves, tokens ni contraseñas.

export const DRAFT_PREFIX = "willy:borrador:";
const MAX_CHARS = 200_000;
const DELAY_MS = 400;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const browserStore = (): Store | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

const isEmpty = (value: unknown): boolean => value === "" || value === null || value === undefined || (Array.isArray(value) && value.length === 0);

export function loadDraft<T>(key: string, store: Store | null = browserStore()): T | undefined {
  if (!store) return undefined;
  try {
    const raw = store.getItem(DRAFT_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

/** Guarda el valor; si está vacío lo borra (así, al enviar un mensaje, no reaparece). Devuelve si quedó guardado. */
export function saveDraft(key: string, value: unknown, store: Store | null = browserStore()): boolean {
  if (!store) return false;
  try {
    if (isEmpty(value)) {
      store.removeItem(DRAFT_PREFIX + key);
      return false;
    }
    const json = JSON.stringify(value);
    if (json.length > MAX_CHARS) return false;
    store.setItem(DRAFT_PREFIX + key, json);
    return true;
  } catch {
    return false;
  }
}

export function clearDrafts(store: Store & { length: number; key: (index: number) => string | null } = window.localStorage): number {
  const found: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const name = store.key(index);
    if (name?.startsWith(DRAFT_PREFIX)) found.push(name);
  }
  found.forEach((name) => store.removeItem(name));
  return found.length;
}

/** Como `useState`, pero el valor sobrevive a recargar la página. La lectura se hace tras montar (no rompe el render del servidor). */
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    const stored = loadDraft<T>(key);
    if (stored !== undefined) setValue(stored);
    loaded.current = true;
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    const timer = window.setTimeout(() => saveDraft(key, value), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [key, value]);
  return [value, setValue];
}
