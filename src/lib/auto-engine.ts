// IA «plug and play»: eliges la opción una vez y, para cada petición, WILLY decide qué IA la responde (tu equipo o una externa) según lo
// que pides. Sin configurar nada: si no hay IA externa, elige el mejor modelo de los que tienes instalados para ese tipo de petición.
// El orden por tipo es una regla razonada (no una medición): cada respuesta dice qué IA la dio y por qué se eligió.

import type { PublicStatus } from "@/lib/engines-server";
import { KIND_CLOUD_ORDER } from "@/lib/routing-table";

/** Orden de las IA externas por tipo de petición (vive en la tabla única routing-table.ts, con los mismos valores de siempre). */
export { KIND_CLOUD_ORDER };

// ------------------------------------------------------------------------------------------------ datos que no deben salir
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
function validDni(text: string): boolean {
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/i.exec(text.replace(/[\s-]/g, ""));
  if (!m) return false;
  const n = Number(`${m[1] ? "XYZ".indexOf(m[1].toUpperCase()) : ""}${m[2]}`);
  return DNI_LETTERS[n % 23] === m[3]!.toUpperCase();
}
function validIban(text: string): boolean {
  const s = text.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of r) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}
function validCard(text: string): boolean {
  const d = text.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(d)) return false;
  let sum = 0;
  [...d].reverse().forEach((ch, i) => { let n = Number(ch); if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; });
  return sum % 10 === 0;
}

/** ¿Lleva algo que no debe salir de tu equipo? (DNI/NIE, IBAN, tarjeta, claves de API, contraseñas). Devuelve qué es, o null. */
export function looksSensitive(text: string): string | null {
  for (const m of text.matchAll(/\b[XYZ]?\d{7,8}[- ]?[A-Z]\b/gi)) if (validDni(m[0])) return "un DNI/NIE";
  // IBAN: se prueba con los grupos tal como se escribieron y quitando los de detrás (así «…1332 para el pago» no estropea la comprobación).
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){3,8}\b/gi)) {
    const groups = m[0].split(/\s+/);
    for (let n = groups.length; n >= 1; n--) if (validIban(groups.slice(0, n).join(""))) return "un IBAN";
  }
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) if (validCard(m[0])) return "un número de tarjeta";
  if (/(?:AIza[0-9A-Za-z_-]{30,}|\bsk-[A-Za-z0-9_-]{20,}|\bhf_[A-Za-z0-9]{20,}|\bgsk_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text)) return "una clave de API o una clave privada";
  if (/\b(?:contraseña|password|passwd|clave de acceso)\s*(?:es|:|=)\s*\S{4,}/i.test(text)) return "una contraseña";
  return null;
}

// ------------------------------------------------------------------------------------------------ el plan
export type SmartPlan = { kind: string; label: string; cloudIds: string[]; localModel: string; why: string };

export function smartPlan(i: {
  text: string;
  kind: string;
  labelOf: (kind: string) => string;
  hasAttachments: boolean;
  status: PublicStatus | null;
  installed: string[];
  localPlan: (kind: string) => string[];
}): SmartPlan {
  const label = i.labelOf(i.kind);
  const lower = i.installed.map((m) => m.toLowerCase());
  const localModel = i.localPlan(i.kind).find((m) => lower.some((x) => x === m.toLowerCase() || x.startsWith(`${m.toLowerCase()}:`))) ?? i.installed[0] ?? "";
  const local = (why: string): SmartPlan => ({ kind: i.kind, label, cloudIds: [], localModel, why });
  const sensitive = looksSensitive(i.text);
  if (sensitive) return local(`Tu mensaje lleva ${sensitive}: se queda en tu equipo${localModel ? ` (${localModel})` : ""}.`);
  if (i.hasAttachments) return local(`Lleva archivos adjuntos: se queda en tu equipo${localModel ? ` (${localModel})` : ""}. Elige una IA externa concreta si quieres enviarlos.`);
  if (!i.status || !i.status.master) return local(`Petición de ${label}: uso tu equipo${localModel ? ` (${localModel})` : ""} (las IA externas están desactivadas).`);
  if (i.status.mode === "ahorro") return local(`Petición de ${label}: modo ahorro, primero tu equipo${localModel ? ` (${localModel})` : ""}.`);
  const usable = new Set(i.status.engines.filter((e) => e.hasKey && e.enabled && e.available).map((e) => e.id));
  const ids = (KIND_CLOUD_ORDER[i.kind] ?? KIND_CLOUD_ORDER["general"]!).filter((id) => usable.has(id));
  if (!ids.length) return local(`Petición de ${label}: ninguna IA externa disponible ahora; uso tu equipo${localModel ? ` (${localModel})` : ""}.`);
  const name = i.status.engines.find((e) => e.id === ids[0])?.name ?? ids[0]!;
  return { kind: i.kind, label, cloudIds: ids, localModel, why: `Petición de ${label}: la mejor ahora es ${name}${ids.length > 1 ? `, con ${ids.length - 1} más de respaldo` : ""}.` };
}
