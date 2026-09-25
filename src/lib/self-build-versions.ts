// AUTOCONSTRUCCIÓN · VERSIONES (solo servidor). Cada mejora aceptada crea una versión nueva, con su historial, su changelog
// para el dueño, sus pruebas y su copia para volver atrás. Nunca se modifica en silencio una versión ya publicada.
//
// Numeración (compatible con la que ya existe): las versiones OFICIALES siguen siendo «0.0.43 rev 11» (APP_VERSION +
// APP_REVISION, las que usa el actualizador); cada mejora de la Autoconstrucción encima de una oficial es una versión LOCAL
// numerada: «0.0.43 rev 11 · local 1», «· local 2»… Al instalar la siguiente oficial, la numeración local vuelve a empezar.
// Así el actualizador no se confunde y el dueño ve cada cambio con su número.

import { SB_DIR, type Verdict } from "@/lib/self-build-journal";
import { writeFileDurable } from "@/lib/self-build-backup";

export type { Verdict };

export const REGISTRY_FILE = "versiones.json";

export type VersionStatus = "ACTIVA" | "ESTABLE" | "SUSTITUIDA" | "REVERTIDA" | "FALLIDA";
export type Changelog = { nuevo: string[]; mejorado: string[]; corregido: string[]; tecnico: string[] };

export type VersionEntry = {
  id: string;
  kind: "autoconstruccion" | "oficial";
  /** Versión oficial de base, «0.0.43+11». */
  base: string;
  /** 0 = la oficial tal cual; 1, 2… = versiones locales de la Autoconstrucción. */
  local: number;
  label: string;
  at: string;
  objective: string;
  files: string[];
  tests: Record<string, Verdict>;
  status: VersionStatus;
  /** Salud tras arrancar: PASS solo cuando el servidor nuevo ha arrancado de verdad y responde. */
  health: "PASS" | "PENDIENTE" | "FAIL" | "N/A";
  promotedAt?: string;
  /** Carpeta de su copia (dentro de copias-autoconstruccion): lo que había ANTES de esta versión. */
  backup: string | null;
  /** Se puede volver atrás desde aquí (copia verificada de archivos y, si hay programa instalado, del programa). */
  rollback: boolean;
  changelog: Changelog;
  reason?: string;
  /** Versión que estaba activa antes de esta (a la que se vuelve si se revierte). */
  previous?: string | null;
  /** Huella del programa que instaló esta versión (para comprobar, antes de volver atrás, que sigue siendo ese). */
  program?: string;
};

export type Registry = { version: 1; entries: VersionEntry[]; activeId: string | null; lastKnownGood: string | null };

export const emptyRegistry = (): Registry => ({ version: 1, entries: [], activeId: null, lastKnownGood: null });

/** «0.0.43+11» → «0.0.43 rev 11»; con local → «0.0.43 rev 11 · local 2». */
export function labelOf(base: string, local: number): string {
  const [v, rev] = base.split("+");
  return `${v}${rev ? ` rev ${rev}` : ""}${local ? ` · local ${local}` : ""}`;
}

/** Changelog comprensible a partir del objetivo (NUEVO / MEJORADO / CORREGIDO) y de los archivos (TÉCNICO). */
export function changelogFor(objective: string, files: string[]): Changelog {
  const text = objective.trim().replace(/\s+/g, " ").slice(0, 240);
  const log: Changelog = { nuevo: [], mejorado: [], corregido: [], tecnico: [] };
  if (/\b(arregl|corrig|repar|fallo|error|no funciona|roto)/i.test(text)) log.corregido.push(text);
  else if (/\b(añad|anad|nuev|crea|incorpor|permite|capacidad|ahora puede)/i.test(text)) log.nuevo.push(text);
  else if (/\b(reestructur|refactor|interno|limpieza|duplicad|ordena)/i.test(text)) log.tecnico.push(text);
  else log.mejorado.push(text || "Mejora de WILLY AI");
  if (files.length) log.tecnico.push(`Archivos: ${files.slice(0, 8).join(", ")}${files.length > 8 ? ` y ${files.length - 8} más` : ""}.`);
  return log;
}

async function node() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return { fs, path };
}

/** Lee el registro. Si la versión oficial instalada no aparece (por ejemplo, tras un .bat de actualización), la añade como ACTIVA. */
export async function readRegistry(root: string, currentBase: string, now = new Date()): Promise<Registry> {
  return (await loadRegistry(root, currentBase, now)).reg;
}

/** Igual que readRegistry, diciendo además si ha cambiado respecto a lo guardado (para guardarlo solo cuando hace falta). */
export async function loadRegistry(root: string, currentBase: string, now = new Date()): Promise<{ reg: Registry; changed: boolean }> {
  const { fs, path } = await node();
  let reg = emptyRegistry();
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, SB_DIR, REGISTRY_FILE), "utf8")) as Partial<Registry>;
    if (Array.isArray(raw.entries)) reg = { version: 1, entries: raw.entries.filter((e) => e && typeof e.id === "string") as VersionEntry[], activeId: raw.activeId ?? null, lastKnownGood: raw.lastKnownGood ?? null };
  } catch {
    /* primera vez (o archivo dañado): registro vacío */
  }
  const adopted = adoptOfficial(reg, currentBase, now);
  return { reg: adopted, changed: adopted !== reg };
}

/** Si ha llegado una versión oficial nueva, pasa a ser la ACTIVA (y la anterior, SUSTITUIDA); la numeración local vuelve a 0. */
export function adoptOfficial(reg: Registry, currentBase: string, now = new Date()): Registry {
  if (!currentBase) return reg;
  const active = reg.entries.find((e) => e.id === reg.activeId);
  if (active && active.base === currentBase) return reg;
  const id = `oficial-${currentBase}`;
  if (reg.entries.some((e) => e.id === id)) return { ...reg, activeId: id };
  const entry: VersionEntry = {
    id, kind: "oficial", base: currentBase, local: 0, label: labelOf(currentBase, 0), at: now.toISOString(),
    objective: "Versión oficial instalada con su actualizador (copia, prueba aparte y vuelta atrás propias).",
    files: [], tests: {}, status: "ACTIVA", health: "PASS", backup: null, rollback: false,
    changelog: { nuevo: [], mejorado: [], corregido: [], tecnico: [] },
  };
  const entries = reg.entries.map((e) => (e.status === "ACTIVA" ? { ...e, status: "SUSTITUIDA" as const } : e));
  return { ...reg, entries: [...entries, entry], activeId: id, lastKnownGood: reg.lastKnownGood ?? id };
}

export function nextLocal(reg: Registry, base: string): number {
  return Math.max(0, ...reg.entries.filter((e) => e.base === base).map((e) => e.local)) + 1;
}

/**
 * Una mejora promovida: pasa a ACTIVA (salud PENDIENTE hasta que el programa nuevo arranque; N/A si no hay programa
 * instalado, como en la vista previa); la anterior ACTIVA queda ESTABLE si estaba sana.
 */
export function recordPromotion(reg: Registry, entry: Omit<VersionEntry, "status" | "health" | "local" | "label">, opts: { installed?: boolean } = {}): Registry {
  const local = nextLocal(reg, entry.base);
  const next: VersionEntry = { ...entry, local, label: labelOf(entry.base, local), status: "ACTIVA", health: opts.installed === false ? "N/A" : "PENDIENTE" };
  const entries = reg.entries.map((e) => (e.status === "ACTIVA" ? { ...e, status: e.health === "PASS" ? ("ESTABLE" as const) : ("SUSTITUIDA" as const) } : e));
  return { ...reg, entries: [...entries, next], activeId: next.id };
}

/** Una mejora que no pasó sus comprobaciones: queda en el historial como FALLIDA (la versión actual sigue igual). */
export function recordFailure(reg: Registry, entry: Omit<VersionEntry, "status" | "health" | "local" | "label" | "rollback">, reason: string): Registry {
  const next: VersionEntry = { ...entry, local: 0, label: `${labelOf(entry.base, 0)} · candidata descartada`, status: "FALLIDA", health: "N/A", rollback: false, reason };
  return { ...reg, entries: [...reg.entries, next] };
}

/**
 * Salud tras el reinicio: si la versión ACTIVA está PENDIENTE y ESTE servidor arrancó después de promoverla, es que la
 * versión nueva arrancó y responde → PASS y pasa a ser la ÚLTIMA BUENA (last known good).
 */
export function confirmHealth(reg: Registry, startedAt: string, liveProgram?: string | null): { reg: Registry; confirmed: VersionEntry | null } {
  const active = reg.entries.find((e) => e.id === reg.activeId);
  if (!active || active.health !== "PENDIENTE" || !active.promotedAt) return { reg, confirmed: null };
  if (new Date(startedAt).getTime() <= new Date(active.promotedAt).getTime()) return { reg, confirmed: null };
  // Si se sabe qué programa instaló esa versión, tiene que ser el que está instalado ahora (no basta con la hora).
  if (active.program && liveProgram !== undefined && liveProgram !== active.program) return { reg, confirmed: null };
  const entries = reg.entries.map((e) => (e.id === active.id ? { ...e, health: "PASS" as const, tests: { ...e.tests, health: "PASS" as const } } : e));
  return { reg: { ...reg, entries, lastKnownGood: active.id }, confirmed: { ...active, health: "PASS" } };
}

/**
 * Marca una versión como REVERTIDA (tras volver atrás) y deja ACTIVA la indicada. Si el programa se reinicia, la que vuelve
 * queda con salud PENDIENTE hasta que arranque; si estaba sana, pasa a ser también la última buena.
 */
export function recordRollback(reg: Registry, revertedId: string, reason: string, backToId: string | null, opts: { at?: string; installed?: boolean } = {}): Registry {
  const backTo = reg.entries.find((e) => e.id === backToId);
  const entries = reg.entries.map((e) => {
    if (e.id === revertedId) return { ...e, status: "REVERTIDA" as const, reason, health: e.health === "PENDIENTE" ? ("N/A" as const) : e.health };
    if (e.id === backToId) {
      const restarted = opts.installed && opts.at ? { health: "PENDIENTE" as const, promotedAt: opts.at } : {};
      return { ...e, status: "ACTIVA" as const, ...restarted };
    }
    return e;
  });
  const lastKnownGood = backTo && backTo.health === "PASS" ? backTo.id : reg.lastKnownGood === revertedId ? null : reg.lastKnownGood;
  return { ...reg, entries, activeId: backToId ?? reg.activeId, lastKnownGood };
}

/** Copias que NUNCA se borran al hacer limpieza: la de la versión activa, la de la última buena y las de las 3 últimas estables. */
export function protectedBackups(reg: Registry): Set<string> {
  const keep = new Set<string>();
  const byId = (id: string | null) => reg.entries.find((e) => e.id === id);
  for (const e of [byId(reg.activeId), byId(reg.lastKnownGood), ...reg.entries.filter((x) => x.status === "ESTABLE").slice(-3)]) {
    if (e?.backup) keep.add(e.backup);
  }
  return keep;
}

export async function writeRegistry(root: string, reg: Registry): Promise<void> {
  const { path } = await node();
  // Límite razonable de historial: se conservan las 200 últimas entradas (las copias tienen su propia limpieza).
  const trimmed = { ...reg, entries: reg.entries.slice(-200) };
  await writeFileDurable(path.join(root, SB_DIR, REGISTRY_FILE), JSON.stringify(trimmed, null, 2));
}
