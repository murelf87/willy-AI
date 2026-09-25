import { useEffect, useState } from "react";

export type Settings = {
  endpoint: string;
  /** Ya no se usa (rev20): la carpeta de modelos real la da el servidor (Centro de Inteligencia → Tu equipo → Detalles). */
  modelsPath: string;
  /** Ya no se usa (rev20): el «Modo sin conexión» no bloqueaba nada y se quitó. Se conserva por compatibilidad. */
  offline: boolean;
  model: string;
  // Modelo local de SUPER WILLY (pestaña Súper IA), aparte del de la pestaña Chat («model»). Vacío = automático: el mejor
  // instalado para cada tarea (ver superModelFor en lib/super-willy). Es el de respaldo: por defecto SUPER WILLY usa
  // primero la mejor IA externa gratuita.
  superIaModel: string;
  // Proyecto abierto en el taller: su identificador (desde la rev19; con el nombre, al renombrarlo se perdía) y su nombre
  // (para enseñarlo). Si el identificador no está, se busca por el nombre, como antes.
  projectId: string;
  project: string;
  agents: string[];
  /** Ya no se usa (rev20): los interruptores de «herramientas» solo cambiaban un texto y prometían cosas que no existen. */
  tools: string[];
  notify: boolean;
  notifySteps: boolean;
  notifySound: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  endpoint: "http://localhost:11434",
  modelsPath: "C:\\Users\\Public\\.ollama\\models",
  offline: true,
  model: "llama3.2:3b",
  superIaModel: "",
  projectId: "",
  project: "",
  agents: ["Analist", "Programmer", "Tester", "Debugger"],
  tools: ["Terminal local", "Sistema de archivos", "Servidor de desarrollo"],
  notify: true,
  notifySteps: true,
  notifySound: false,
};

const KEY = "willy-settings";
const EVENT = "willy-settings-change";

export function readSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(next: Settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* almacenamiento no disponible */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/** Ajustes del espacio de trabajo, guardados en el propio equipo. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(readSettings());
    const onChange = (e: Event) => setSettings((e as CustomEvent<Settings>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...readSettings(), ...patch };
    setSettings(next);
    saveSettings(next);
  };

  return [settings, update];
}

/** Descarga un archivo generado en el navegador, sin servidor. */
export function downloadFile(name: string, content: string, mime = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copia texto al portapapeles con alternativa para navegadores antiguos. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Comprueba si el motor de IA local responde en la dirección indicada. */
export async function pingEndpoint(endpoint: string, timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(endpoint, { mode: "no-cors", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
