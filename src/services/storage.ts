// Almacenamiento local con avisos de cambio. Es el único punto del proyecto que
// habla con localStorage: cuando exista backend se sustituye aquí.

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readList<T>(key: string, fallback: T[]): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento lleno o bloqueado */
  }
  notify(key);
}

export function remove(key: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
  notify(key);
}

export function notify(key: string): void {
  listeners.get(key)?.forEach((fn) => fn());
}

export function subscribe(key: string, fn: Listener): () => void {
  const set = listeners.get(key) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(key, set);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) fn();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    set.delete(fn);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
