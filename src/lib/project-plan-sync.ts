// SUPER WILLY MANTIENE AL DÍA EL PLAN DE CADA PROYECTO (rev23; rediseño, puntos 65, 77 y 78). Nada se simula: el plan cambia
// cuando pasa algo de verdad en el proyecto:
//  - la entrevista avanza (bloques contestados, funciones elegidas) o empieza la construcción;
//  - WILLY entrega archivos y dice en su bloque «plan» qué ha terminado (solo cuenta si se han guardado de verdad);
//  - la vista previa se comprueba (sin errores, con errores, en blanco);
//  - hay algo que necesita al dueño (una decisión, un bloqueo) o deja de haberlo;
//  - (rev28) se pasan las pruebas automáticas del proyecto, o cambian sus archivos (y las pruebas pasadas se quedan viejas).
// Cada cambio se guarda en el proyecto (datos-privados/proyectos/<id>/plan.json), de uno en uno por proyecto.

import {
  applyPlanUpdate, filesEvidence, mergeDiscoveryPlan, parsePlanBlock, parsePlanJson, planFromDiscovery, setAttention, withEvidence,
  type Attention, type DiscoveryInput, type PreviewEvidence, type ProjectPlan, type TestsEvidence,
} from "@/lib/project-progress";
import { filesKeyOf } from "@/lib/project-tests";
import { STEP_TITLES, featuresOf, needsServer, requestedPages, stepComplete, stepsOf, type DiscoveryState } from "@/lib/project-discovery";
import { fetchProjectPlan, saveProjectPlan } from "@/services/disk-project-service";
import { projectService } from "@/services/project-service";
import { checkDoneClaims } from "@/lib/plan-evidence";
import { pushNotice } from "@/lib/notifications";

const chains = new Map<string, Promise<unknown>>();
/** De uno en uno por proyecto: dos cambios del plan nunca se pisan. */
function queue<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(projectId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chains.set(projectId, run.then(() => undefined, () => undefined));
  return run;
}

/** Lo que el plan necesita de la entrevista. */
export function discoveryInput(d: DiscoveryState): DiscoveryInput {
  const steps = stepsOf(d).filter((s) => s !== "resumen").map((id) => ({ id, title: STEP_TITLES[id] }));
  return {
    kind: d.kind,
    steps,
    features: featuresOf(d).filter((f) => f.on).map((f) => ({ label: f.label, tier: f.tier })),
    needsServer: needsServer(d),
    done: d.stage !== "entrevista",
    completedSteps: steps.filter((s) => stepComplete(d, s.id)).map((s) => s.id),
    pages: requestedPages(d.idea),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * La entrevista ha cambiado: se crea el plan del proyecto (si aún no lo tiene) o se pone al día (bloques contestados,
 * funciones elegidas), sin perder lo que ya esté hecho.
 */
export function syncDiscoveryPlan(projectId: string, d: DiscoveryState): Promise<ProjectPlan | null> {
  return queue(projectId, async () => {
    const current = await fetchProjectPlan(projectId);
    const fresh = planFromDiscovery(discoveryInput(d));
    // Un plan que no viene de la entrevista (un análisis, uno hecho por WILLY) no se sustituye: solo se apunta la entrevista.
    const next = !current ? fresh : current.source === "entrevista" ? mergeDiscoveryPlan(current, fresh) : withEvidence(current, { discoveryDone: fresh.evidence.discoveryDone, discoverySteps: fresh.evidence.discoverySteps });
    if (current && same({ ...current, updatedAt: "", evidence: { ...current.evidence, at: "" } }, { ...next, updatedAt: "", evidence: { ...next.evidence, at: "" } })) return current;
    const r = await saveProjectPlan(projectId, next, { touch: true });
    return r.ok ? r.data : null;
  });
}

/**
 * WILLY ha contestado en el proyecto: lo que dice su bloque «plan» (lo «hecho» solo si esta vez se han guardado archivos), lo
 * que se sabe ahora de los archivos del proyecto y, si el proyecto aún no tenía plan, el que ha entregado («plan-json»).
 */
/**
 * (25/09/2026) Lo que la IA da por hecho se busca en los archivos: una página que dice haber terminado y no está sigue pendiente,
 * y se avisa al dueño. Así el progreso no sube con trabajo que no existe (en «Mundo jamon» decía 47 % con solo la portada).
 */
function verifyClaims(next: ProjectPlan, before: ProjectPlan | null, files: ReadonlyArray<{ path: string; content: string }> | undefined): ProjectPlan {
  if (!files) return next;
  const { plan, unproven } = checkDoneClaims(next, before, files);
  if (unproven.length) {
    const list = unproven.slice(0, 3).map((t) => `«${t}»`).join(", ");
    const one = unproven.length === 1;
    pushNotice(`La IA ha dado por ${one ? "hecha una página que no está" : `hechas ${unproven.length} páginas que no están`} en los archivos del proyecto (${list}${unproven.length > 3 ? "…" : ""}): ${one ? "sigue pendiente" : "siguen pendientes"} en el plan.`, "warn");
  }
  return plan;
}

export function recordAnswer(projectId: string, text: string, info: { saved: number; kind: string; analysis?: boolean }): Promise<ProjectPlan | null> {
  return queue(projectId, async () => {
    const project = await projectService.get(projectId);
    const evidence = project ? { ...filesEvidence(project.files), filesKey: filesKeyOf(project.files) } : null;
    const current = await fetchProjectPlan(projectId);
    let next: ProjectPlan | null = null;
    if (!current || info.analysis) {
      next = parsePlanJson(text, info.kind, { source: info.analysis ? "analisis" : "willy", ...(evidence ? { evidence: { ...evidence, ...(current ? { preview: current.evidence.preview, errors: current.evidence.errors } : {}) } } : {}) });
      if (!next) return current;
      next = verifyClaims(next, current, project?.files);
    } else {
      // Lo que estaba pendiente de ti se da por contestado al seguir trabajando (si sigue haciendo falta, WILLY lo vuelve a decir).
      const base = current.attention && current.attention.kind !== "error" ? setAttention(current, null) : current;
      const update = parsePlanBlock(text);
      next = update ? applyPlanUpdate(base, update, { saved: info.saved > 0 }) : base;
      if (evidence) next = withEvidence(next, evidence);
      next = verifyClaims(next, current, project?.files);
      if (same(next.milestones, current.milestones) && same(next.attention, current.attention) && same({ ...next.evidence, at: "" }, { ...current.evidence, at: "" })) return current;
    }
    const r = await saveProjectPlan(projectId, next, { touch: true });
    return r.ok ? r.data : current;
  });
}

/** La vista previa se ha comprobado: se apunta en el plan (sin contar como actividad). */
export function recordPreview(projectId: string, preview: PreviewEvidence, errors: number): Promise<void> {
  return queue(projectId, async () => {
    const current = await fetchProjectPlan(projectId);
    if (!current || (current.evidence.preview === preview && current.evidence.errors === errors)) return;
    await saveProjectPlan(projectId, withEvidence(current, { preview, errors }), { touch: false });
  });
}

/** Rev28 · Una pasada de las pruebas automáticas: queda en el plan (sin contar como actividad). */
export function recordTests(projectId: string, tests: TestsEvidence): Promise<void> {
  return queue(projectId, async () => {
    const current = await fetchProjectPlan(projectId);
    if (!current) return;
    const old = current.evidence.tests;
    if (old && old.key === tests.key && old.total === tests.total && old.passed === tests.passed && old.failed === tests.failed && old.skipped === tests.skipped && current.evidence.filesKey === tests.key) return;
    // Lo que se ha probado son los archivos de ahora: su huella queda apuntada también.
    await saveProjectPlan(projectId, withEvidence(current, { tests, filesKey: tests.key }), { touch: false });
  });
}

/** Rev28 · Han cambiado los archivos del proyecto (una versión restaurada, un cambio a mano…): las pruebas pasadas se quedan viejas. */
export function recordFilesKey(projectId: string, filesKey: string): Promise<void> {
  return queue(projectId, async () => {
    const current = await fetchProjectPlan(projectId);
    if (!current || current.evidence.filesKey === filesKey) return;
    await saveProjectPlan(projectId, withEvidence(current, { filesKey }), { touch: false });
  });
}

/**
 * Algo que necesita al dueño (un bloqueo, una decisión) o que ya no lo necesita. `onlyIf` evita quitar lo que no es de esto
 * (p. ej. al recuperar la vista previa no se quita una decisión pendiente sobre pagos).
 */
export function recordAttention(projectId: string, attention: Pick<Attention, "kind" | "reason"> | null, onlyIf?: (current: Attention | null) => boolean): Promise<void> {
  return queue(projectId, async () => {
    const current = await fetchProjectPlan(projectId);
    if (!current) return;
    if (onlyIf && !onlyIf(current.attention)) return;
    if (same(current.attention && { kind: current.attention.kind, reason: current.attention.reason }, attention && { kind: attention.kind, reason: attention.reason.replace(/\s+/g, " ").trim().slice(0, 300) })) return;
    await saveProjectPlan(projectId, setAttention(current, attention), { touch: true });
  });
}

/** Evidencia de la vista previa según lo que enseña el taller. `null` = todavía no hay nada decidido (cargando…). */
export function previewEvidenceOf(state: string, errors: number, kind: string | undefined): PreviewEvidence | null {
  if (state === "lista") return errors > 0 ? "roto" : "ok";
  // Rev25: un proyecto React/Vite que no compila tampoco se ve (y mientras compila, todavía no se sabe).
  if (state === "error" || state === "en-blanco" || state === "no-compila") return "roto";
  if (state === "sin-pagina") return /^(?:api|backend|automatizacion)$/i.test(kind ?? "") ? "no-aplica" : "sin-comprobar";
  if (state === "sin-vista" || state === "vacio") return "sin-comprobar";
  return null;
}
