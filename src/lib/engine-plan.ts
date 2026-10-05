import type { FailureKind, PublicStatus } from "@/lib/engines-server";
import { BUILD_ORDER } from "@/lib/routing-table";

// Qué motor se usa en cada intento de la Autoconstrucción: SIEMPRE primero la IA externa gratuita que esté disponible
// (en su orden de calidad, la que mejor vaya primero) y los modelos de tu equipo como último recurso. Esta regla es fija
// y no depende del modo «calidad/ahorro» (ese modo es solo para el «Plug and play» del chat normal, no para la Autoconstrucción).
// Un motor que falla por su cuenta (cuota, clave, pago…) sale de la rueda durante ese trabajo, y el resto sigue desde donde se quedó.

export type Step =
  | { kind: "cloud"; id: string; label: string; key: string }
  | { kind: "local"; model: string; label: string; key: string };

/** Orden de calidad de la Autoconstrucción (vive en la tabla única routing-table.ts). */
export const PROVIDER_ORDER = BUILD_ORDER;

export function buildSequence(status: PublicStatus | null, localModels: string[]): Step[] {
  const local: Step[] = localModels.map((model) => ({ kind: "local", model, label: model, key: `local:${model}` }));
  if (!status || !status.master) return local;
  const cloud: Step[] = status.engines
    .filter((engine) => engine.hasKey && engine.enabled && engine.available)
    .sort((a, b) => PROVIDER_ORDER.indexOf(a.id) - PROVIDER_ORDER.indexOf(b.id))
    .map((engine) => ({ kind: "cloud", id: engine.id, label: `${engine.name}${engine.model ? ` · ${engine.model}` : ""}`, key: `cloud:${engine.id}` }));
  return [...cloud, ...local];
}

/** Con motores en la nube hay más margen: si uno falla por su cuenta no debe gastar un intento «de verdad». */
export function maxAttemptsFor(base: number, steps: Step[]): number {
  const clouds = steps.filter((step) => step.kind === "cloud").length;
  const locals = steps.length - clouds;
  // La misma IA/modelo puede dedicar varios ciclos a reparar su propia candidata antes del relevo.
  // Por eso el presupuesto global debe dejar espacio real para al menos un segundo motor sin convertirse en un bucle infinito.
  return Math.min(24, Math.max(base + clouds * 3 + Math.min(4, locals), 12));
}

/**
 * Mantiene el primer motor disponible durante todas las correcciones del trabajo.
 * Solo cambia cuando el llamador descarta explícitamente el motor, nunca por el número de intento.
 */
export function attemptStep(steps: Step[], skipped: Set<string>): Step | null {
  return steps.find((step) => !skipped.has(step.key)) ?? null;
}

/** Un límite por minuto o un fallo de red no demuestra que la cuota esté agotada. */
export function shouldRelay(kind?: FailureKind | "unavailable"): boolean {
  return kind !== undefined && ["quota-day", "auth", "payment", "model", "too-large"].includes(kind);
}
