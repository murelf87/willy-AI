import { useEffect, useState } from "react";

export type Profile = { name: string; email: string; avatar: string | null };

const KEY = "willy-profile";
const EVT = "willy-profile-change";

export const DEFAULT_PROFILE: Profile = {
  name: "Antonio José",
  email: "antonio@willy.ai",
  avatar: null,
};

export function readProfile(): Profile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(next: Profile) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* almacenamiento lleno: se mantiene solo en memoria */
  }
  window.dispatchEvent(new CustomEvent<Profile>(EVT, { detail: next }));
}

/** Perfil local del equipo. Se guarda en este dispositivo, sin servicios externos. */
export function useProfile(): [Profile, (next: Partial<Profile>) => void] {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);

  useEffect(() => {
    setProfile(readProfile());
    const onChange = (e: Event) => setProfile((e as CustomEvent<Profile>).detail);
    window.addEventListener(EVT, onChange);
    return () => window.removeEventListener(EVT, onChange);
  }, []);

  const update = (patch: Partial<Profile>) => {
    const next = { ...readProfile(), ...patch };
    setProfile(next);
    saveProfile(next);
  };

  return [profile, update];
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
