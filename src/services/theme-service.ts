// Apariencia, contenido y marca editables por el propietario sin tocar código.
// Trabaja sobre los tokens del sistema de diseño ya existente: cambiar un color
// aquí lo cambia en toda la aplicación.

import { useEffect, useState } from "react";
import { newId } from "@/types/domain";
import { readJson, readList, subscribe, write } from "./storage";

export type Appearance = {
  primary: string;      // HSL "222 90% 60%"
  accent: string;
  radius: string;       // "0.75rem"
  fontScale: number;    // 1 = normal
  density: "compacta" | "normal" | "amplia";
};

export type Branding = {
  appName: string;
  tagline: string;
  logo: string | null;    // imagen en base64
  favicon: string | null;
};

export type Content = {
  heroTitle: string;
  heroSubtitle: string;
  ctaPrimary: string;
  ctaSecondary: string;
};

export type SiteConfig = { appearance: Appearance; branding: Branding; content: Content };

export const DEFAULT_CONFIG: SiteConfig = {
  appearance: { primary: "233 89% 64%", accent: "268 84% 66%", radius: "0.75rem", fontScale: 1, density: "normal" },
  branding: { appName: "WILLY AI", tagline: "Tu estudio de software con IA local", logo: null, favicon: null },
  content: {
    heroTitle: "Crea software real con tu propia IA",
    heroSubtitle: "Describe lo que necesitas y WILLY AI lo construye en tu equipo, sin enviar nada fuera.",
    ctaPrimary: "Comenzar",
    ctaSecondary: "Ver demostración",
  },
};

const DRAFT_KEY = "willy-site-draft";
const LIVE_KEY = "willy-site-live";
const HISTORY_KEY = "willy-site-history";

export type SiteVersion = { id: string; at: string; label: string; config: SiteConfig };

function merge(stored: Partial<SiteConfig>): SiteConfig {
  return {
    appearance: { ...DEFAULT_CONFIG.appearance, ...stored.appearance },
    branding: { ...DEFAULT_CONFIG.branding, ...stored.branding },
    content: { ...DEFAULT_CONFIG.content, ...stored.content },
  };
}

export function readDraft(): SiteConfig {
  return merge(readJson<Partial<SiteConfig>>(DRAFT_KEY, {}));
}

export function readLive(): SiteConfig {
  return merge(readJson<Partial<SiteConfig>>(LIVE_KEY, {}));
}

/** Aplica la apariencia a los tokens del documento. Efecto inmediato. */
export function applyConfig(config: SiteConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--primary", config.appearance.primary);
  root.style.setProperty("--accent", config.appearance.accent);
  root.style.setProperty("--radius", config.appearance.radius);
  root.style.fontSize = `${Math.round(16 * config.appearance.fontScale)}px`;
  if (config.branding.favicon) {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = config.branding.favicon;
  }
}

/** Guarda el borrador y lo muestra al instante. */
export function saveDraft(config: SiteConfig) {
  write(DRAFT_KEY, config);
  applyConfig(config);
}

/** Publica el borrador: pasa a ser lo que ven los usuarios y crea una versión. */
export function publishDraft(label = "Publicación"): SiteVersion {
  const config = readDraft();
  write(LIVE_KEY, config);
  const version: SiteVersion = { id: newId("site"), at: new Date().toISOString(), label, config };
  write(HISTORY_KEY, [version, ...readList<SiteVersion>(HISTORY_KEY, [])].slice(0, 40));
  applyConfig(config);
  return version;
}

export function readHistory(): SiteVersion[] {
  return readList<SiteVersion>(HISTORY_KEY, []);
}

export function restoreVersion(id: string): SiteConfig | null {
  const version = readHistory().find((v) => v.id === id);
  if (!version) return null;
  saveDraft(version.config);
  return version.config;
}

export function resetDraft(): SiteConfig {
  saveDraft(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

/** Borrador editable con deshacer y rehacer. */
export function useSiteDraft() {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_CONFIG);
  const [past, setPast] = useState<SiteConfig[]>([]);
  const [future, setFuture] = useState<SiteConfig[]>([]);

  useEffect(() => {
    const current = readDraft();
    setConfig(current);
    applyConfig(current);
  }, []);

  const commit = (next: SiteConfig) => {
    setPast((p) => [...p, config].slice(-30));
    setFuture([]);
    setConfig(next);
    saveDraft(next);
  };

  const update = <K extends keyof SiteConfig>(section: K, patch: Partial<SiteConfig[K]>) => {
    commit({ ...config, [section]: { ...config[section], ...patch } });
  };

  const undo = () => {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [config, ...f]);
    setConfig(previous);
    saveDraft(previous);
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, config]);
    setConfig(next);
    saveDraft(next);
  };

  return { config, update, commit, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

export function useLiveConfig(): SiteConfig {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_CONFIG);
  useEffect(() => {
    const load = () => setConfig(readLive());
    load();
    return subscribe(LIVE_KEY, load);
  }, []);
  return config;
}
