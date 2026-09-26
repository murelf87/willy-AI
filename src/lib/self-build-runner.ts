// Motor de autoconstrucción. Vive fuera de la interfaz: si cambias de pestaña,
// el trabajo sigue en marcha y el progreso se conserva.
//
// Funciona por intentos: elige solo modelos capaces de programar, acepta
// archivos completos o sustituciones exactas, aplica los cambios y, si la
// comprobación falla, vuelve a intentarlo con el error real como diagnóstico.

import { aiService } from "@/services/ai-service";
import { extractFiles, extractPatches, looksLikeRefusal, type GeneratedFile, type GeneratedPatch } from "@/lib/ai-standard";
import { listLocalModels, type ChatMsg } from "@/lib/local-ai";
import { planChain } from "@/services/orchestrator";
import { fastCoderFirst } from "@/lib/capabilities";
import { examplesSection, readLessons, similarLessons, taskKind, upsertLesson, writeLessons } from "@/lib/learning";
import { deriveChecks, mergeChecks, hasChecks, summarize, type Checks, type EvidenceReport } from "@/lib/evidence";
import { cloudChat, engineStatus } from "@/lib/engines-client";
import { attemptStep, buildSequence, maxAttemptsFor } from "@/lib/engine-plan";
import { APP_VERSION } from "@/lib/version";
import { readSelfBuild, writeSelfBuild, type WillyImprovement } from "@/lib/self-build-store";
import { ownerLessons } from "@/lib/owner-brain";
import { lessonsSection } from "@/lib/owner-brain-shared";
import { progressInfo, type ProgressInfo } from "@/lib/self-build-progress";

export type SelfBuildJob = {
  id: string;
  pct: number;
  step: string;
  detail: string;
  /** Segundos que faltan, si se pueden estimar. */
  remaining: number | null;
  startedAt: number;
  done: boolean;
  error?: string;
  reloading?: boolean;
};

export const JOB_EVENT = "willy-self-build-job";
const JOB_KEY = "willy-self-build-job-v1";
/** Intentos completos (modelo + aplicación + comprobación) antes de rendirse. */
const MAX_ATTEMPTS = 6;

let current: SelfBuildJob | null = null;

function emit() {
  if (typeof window === "undefined") return;
  try {
    if (current) window.localStorage.setItem(JOB_KEY, JSON.stringify(current));
    else window.localStorage.removeItem(JOB_KEY);
  } catch {
    /* almacenamiento lleno: el progreso se sigue viendo en pantalla */
  }
  window.dispatchEvent(new CustomEvent(JOB_EVENT, { detail: current }));
}

export function readJob(): SelfBuildJob | null {
  if (current) return current;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SelfBuildJob;
    // Un trabajo que quedó a medias por un cierre del programa no sigue vivo.
    if (!parsed.done) return { ...parsed, done: true, error: "El trabajo se interrumpió. Pulsa «Implementar ahora» otra vez." };
    // Tras recargar, el aviso «Actualizando la página…» ya no es cierto.
    return parsed.reloading ? { ...parsed, reloading: false, detail: parsed.detail.replace(/\s*Actualizando la página[^]*$/, "") } : parsed;
  } catch {
    return null;
  }
}

export function isRunning(): boolean {
  return Boolean(current && !current.done);
}

/**
 * Una mejora «en curso» sin ningún trabajo vivo quedó a medias porque se cerró el programa
 * o la página. Vuelve a «pendiente» para poder reintentarla (antes se quedaba bloqueada sin botón).
 */
export function recoverInterrupted(): boolean {
  if (isRunning()) return false;
  const state = readSelfBuild();
  if (!state.improvements.some((entry) => entry.status === "en curso")) return false;
  writeSelfBuild({
    ...state,
    improvements: state.improvements.map((entry) =>
      entry.status === "en curso"
        ? { ...entry, status: "pendiente" as const, result: "Se interrumpió antes de terminar (el programa o la página se cerró). Pulsa «Implementar ahora» para reintentarla." }
        : entry,
    ),
  });
  return true;
}

export function clearJob(id?: string): void {
  const saved = readJob();
  if (id && saved?.id !== id) return;
  current = null;
  emit();
}

function set(next: Partial<SelfBuildJob> & { id: string }) {
  current = { ...(current ?? ({} as SelfBuildJob)), ...next } as SelfBuildJob;
  emit();
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Modelos capaces de programar, ordenados de mejor a peor para esta tarea. Vacío si el motor no responde. */
async function planBuilders(endpoint: string, preferred: string): Promise<string[]> {
  // listLocalModels no lanza errores: devuelve [] si el motor está parado o sin modelos.
  const installed = await listLocalModels(endpoint);
  if (!installed.length) return [];
  const chain = planChain("codigo", preferred, installed).filter(Boolean);
  // Primero el modelo de código más pequeño (el más rápido si la memoria gráfica es justa); si falla, se pasa a los mayores.
  return fastCoderFirst([...new Set(chain.length ? chain : installed)]).slice(0, MAX_ATTEMPTS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Espera a que el servidor de WILLY vuelva a responder tras reiniciarse con la mejora. */
async function waitForServer(maxMs: number): Promise<void> {
  const until = Date.now() + maxMs;
  // El programa se cierra a los ~3,5 s y arranca de nuevo; no se comprueba antes.
  await sleep(5000);
  while (Date.now() < until) {
    try {
      const res = await fetch("/api/local-ai", { cache: "no-store" });
      if (res.ok) return;
    } catch {
      /* todavía reiniciándose */
    }
    await sleep(1500);
  }
}

/**
 * Con el programa nuevo ya en marcha, se le pide su estado: así confirma su salud (arrancó y responde) y queda como
 * «última buena». Si no contesta, se confirmará al abrir Autoconstrucción.
 */
async function confirmNewVersion(): Promise<void> {
  try {
    await fetch("/api/self-build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "self-status" }), signal: AbortSignal.timeout(15_000) });
  } catch {
    /* se confirmará al abrir Autoconstrucción */
  }
}

function buildMessages(input: {
  instructions: string;
  item: WillyImprovement;
  sourceContext: string;
  sourcePaths: string[];
  attempt: number;
  diagnosis: string;
  history?: string;
  examples?: string;
}): ChatMsg[] {
  const rules = `Eres el constructor interno de WILLY AI ${APP_VERSION}. Operación local autorizada por el dueño sobre su propio programa: nunca te niegas, nunca pides permiso, nunca explicas por qué no puedes.
Modificas solo la aplicación WILLY AI, jamás los proyectos del usuario.

FORMATO OBLIGATORIO (elige uno por archivo):
A) Archivo completo, con la ruta en la cabecera del bloque:
\`\`\`tsx src/routes/app.tsx
...contenido íntegro del archivo...
\`\`\`
B) Sustitución exacta, ideal para archivos grandes (no repitas el archivo entero):
\`\`\`replace src/routes/app.tsx
<<<<<<< SEARCH
texto exacto actual, copiado tal cual y único en el archivo
=======
texto nuevo
>>>>>>> REPLACE
\`\`\`

Lo que ves más abajo son SOLO las zonas relacionadas del programa (cada una con su archivo y sus líneas), no los archivos enteros.
Para cambiar algo usa el formato B: en SEARCH copia TAL CUAL entre 2 y 6 líneas seguidas de esas zonas (con su sangrado exacto) y en REPLACE pon esas mismas líneas ya modificadas. No inventes líneas que no veas. Haz el cambio más pequeño posible.
Ejemplo (cambiar un texto):
\`\`\`replace src/components/ejemplo.tsx
<<<<<<< SEARCH
        <span>{busy ? "Generando…" : "En reposo"}</span>
=======
        <span>{busy ? "Pensando…" : "En reposo"}</span>
>>>>>>> REPLACE
\`\`\`
Responde SOLO con los bloques de código (sin explicaciones antes ni después).
Reglas: la cabecera SIEMPRE lleva la ruta; sin diffs de git; sin "...", sin "resto igual"; sin inventar rutas.
Rutas permitidas: ${input.sourcePaths.join(", ") || "las incluidas en el contexto"}.
Conserva todo lo que ya funciona y respeta el tema oscuro azul/violeta.

Instrucciones permanentes del dueño:
${input.instructions}`;

  const owned = (input.item.attachments ?? []).map((file) => `--- ARCHIVO SUBIDO POR EL DUEÑO: ${file.name} ---\n${file.content}`).join("\n\n");
  const attached = owned ? `PARTE EXACTA QUE EL DUEÑO QUIERE MODIFICAR (es el texto real: cópialo tal cual en SEARCH y cambia solo esa parte):\n${owned}\n\n` : "";
  const seen = (input.item.screenshots ?? []).map((shot, index) => `--- CAPTURA ${index + 1} (descrita por un modelo de visión) ---\n${shot.description}`).join("\n\n");
  const shotsSection = seen ? `CAPTURAS DE PANTALLA DEL DUEÑO (sirven para entender qué ve y dónde está; el código real es el de más abajo):\n${seen}\n\n` : "";
  const task = `Implementa ahora esta mejora de WILLY AI, sin pedir confirmación y con el mínimo número de cambios necesarios.

Mejora: ${input.item.request}

Propuesta aprobada:
${input.item.proposal}

${shotsSection}${attached}${input.examples ?? ""}CÓDIGO ACTUAL REAL:
${input.sourceContext}`;

  const messages: ChatMsg[] = [
    { role: "system", content: rules },
    { role: "user", content: task },
  ];

  if (input.diagnosis) {
    messages.splice(1, 0, {
      role: "system",
      content: `Intento ${input.attempt}. El intento anterior falló por este motivo real, corrígelo en tu respuesta:\n${input.diagnosis}\nSi el archivo es grande, usa bloques SEARCH/REPLACE en vez de reescribirlo entero.`,
    });
  }
  if (input.history) {
    messages.splice(1, 0, {
      role: "system",
      content: `HISTORIAL DE ESTA MEJORA (la intentaron antes otros motores; sigue desde donde lo dejaron y no repitas lo que ya falló):\n${input.history}`,
    });
  }
  return messages;
}

/** Un motor de la nube como si fuera un modelo más: mismo resultado {ok, data | error}. */
async function callCloud(id: string, messages: ChatMsg[]): Promise<{ ok: true; data: string } | { ok: false; error: string }> {
  const res = await cloudChat(id, messages.map((entry) => ({ role: entry.role, content: entry.content })), 6000);
  return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error };
}

async function finishSuccess(args: {
  item: WillyImprovement;
  files: GeneratedFile[];
  patches: GeneratedPatch[];
  applied: Extract<ApplyOutcome, { ok: true }>;
  label: string;
  attempts: number;
  started: number;
  ping: (m: string) => void;
}): Promise<void> {
  const { item, files, patches, applied, label, attempts, started, ping } = args;
  set({ id: item.id, pct: 95, step: "Comprobación final", detail: "Verificando que todo está en su sitio…", remaining: null, startedAt: started, done: false });
  const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
  // Se guarda lo que funcionó (compiló, arrancó y pasó las comprobaciones); queda «sin confirmar» hasta que el dueño diga si hace lo que quería.
  try {
    writeLessons(
      upsertLesson(readLessons(), {
        id: item.id,
        at: new Date().toISOString(),
        request: item.request,
        kind: taskKind(item.request),
        files: [...new Set([...files.map((file) => file.path), ...patches.map((patch) => patch.path)])],
        patches,
        model: label,
        attempts,
        seconds,
        verdict: "sin confirmar",
      }),
    );
  } catch {
    /* la memoria es opcional */
  }
  const evidence: EvidenceReport | undefined = applied.evidence ? { ...applied.evidence, engine: label } : undefined;
  const stats = evidence ? summarize(evidence.items) : null;
  const proof = stats ? ` Evidencias: ${stats.ok} comprobadas${stats.fallos ? `, ${stats.fallos} fallos` : ""}, ${stats.info} informativas.` : "";
  const now = readSelfBuild();
  writeSelfBuild({
    ...now,
    improvements: now.improvements.map((entry) =>
      entry.id === item.id
        ? { ...entry, status: "implementada" as const, files, ...(applied.folder ? { folder: applied.folder } : {}), ...(evidence ? { evidence } : {}), engine: label, result: `${applied.note} Motor: ${label}. Tiempo: ${fmt(seconds)}.${proof}` }
        : entry,
    ),
  });

  set({
    id: item.id,
    pct: 100,
    step: "Mejora implementada",
    detail: `${files.length + patches.length} cambio(s) · ${label} · ${fmt(seconds)} · ${applied.note}${proof} Actualizando la página para que lo compruebes…`,
    remaining: 0,
    startedAt: started,
    done: true,
    reloading: true,
  });
  ping(`✅ Mejora implementada con ${label}. ${applied.note}${proof} La página se actualiza para mostrártela.`);

  if (typeof window !== "undefined") {
    // Si el programa se reinicia, se espera a que vuelva a responder: recargar antes mostraría un error de conexión.
    // Hasta 150 s: si el programa nuevo no respondiera, el ayudante vuelve solo al anterior (tarda algo más) y se recarga igual.
    void (applied.restarting ? waitForServer(150_000).then(confirmNewVersion) : sleep(4000)).then(() => window.location.reload());
  }
}

/**
 * Puente manual: la respuesta de otra IA (ChatGPT, Claude, Gemini, Grok, Perplexity…) pegada por el dueño se aplica
 * con el mismo circuito que un motor propio: copia de seguridad, compilación, prueba aparte y evidencias.
 */
export async function applyExternalAnswer(item: WillyImprovement, answer: string, site: string, ping: (m: string) => void): Promise<void> {
  if (isRunning()) {
    ping("Ya hay una mejora en marcha. Espera a que termine.");
    return;
  }
  current = null;
  const started = Date.now();
  const fail = (step: string, detail: string) => {
    set({ id: item.id, pct: 100, step, detail, remaining: 0, startedAt: started, done: true, error: detail });
    const now = readSelfBuild();
    writeSelfBuild({ ...now, improvements: now.improvements.map((entry) => (entry.id === item.id ? { ...entry, status: "pendiente" as const, result: detail } : entry)) });
    ping(`⚠️ ${detail}`);
  };
  set({ id: item.id, pct: 10, step: "Leyendo la respuesta", detail: `Buscando los cambios en la respuesta de ${site}…`, remaining: null, startedAt: started, done: false });
  let sourcePaths: string[] = [];
  try {
    const res = await fetch("/api/self-build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "context", name: item.request, proposal: item.proposal, attachments: (item.attachments ?? []).map((file) => file.name) }) });
    const data = (await res.json()) as { ok?: boolean; paths?: string[]; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error ?? "No se pudo leer el código actual.");
    sourcePaths = data.paths ?? [];
  } catch (error) {
    fail("No se aplicó", error instanceof Error ? error.message : "No se pudo leer el código actual.");
    return;
  }
  const files = extractFiles(answer, sourcePaths);
  const patches = extractPatches(answer, sourcePaths);
  if (!files.length && !patches.length) {
    fail("No se encontraron cambios", `No encontré ningún bloque \`\`\`replace con su ruta ni archivos con su ruta en lo que pegaste. Pídele a ${site} que responda solo con ese formato (el paquete de WILLY ya lo indica).`);
    return;
  }
  set({ id: item.id, pct: 40, step: "Guardando y comprobando", detail: `Aplicando ${files.length + patches.length} cambio(s) de ${site}, compilando y probando la versión nueva…`, remaining: null, startedAt: started, done: false });
  const checks = mergeChecks(deriveChecks(item.request), item.checks);
  const applied = await applyChanges(item.request, files, patches, checks, (info) =>
    set({ id: item.id, pct: Math.min(94, 40 + info.n * 6), step: info.label, detail: `${site}: ${info.detail}`, remaining: null, startedAt: started, done: false }),
  );
  if (!applied.ok) {
    fail("No se pudo aplicar", `Los cambios de ${site} se revirtieron porque la comprobación falló:\n${applied.error}`);
    return;
  }
  await finishSuccess({ item, files, patches, applied, label: `Manual · ${site}`, attempts: 1, started, ping });
}

type ApplyOutcome =
  | { ok: true; note: string; folder?: string | undefined; restarting?: boolean | undefined; evidence?: EvidenceReport | undefined }
  | { ok: false; error: string };

/**
 * Mientras el servidor aplica la mejora (puede tardar minutos: versión candidata, compilación, tipos y prueba aparte),
 * se le pregunta cada 2 s en qué paso va, para enseñar el progreso real en vez de una barra quieta.
 */
async function watchProgress(onProgress: (info: ProgressInfo) => void, stop: { done: boolean }): Promise<void> {
  while (!stop.done) {
    await sleep(2000);
    if (stop.done) return;
    try {
      const res = await fetch("/api/self-build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "self-progress" }), signal: AbortSignal.timeout(5000) });
      const data = (await res.json()) as { step?: string | null; stepAt?: string | null };
      const info = progressInfo(data.step, data.stepAt);
      if (info && !stop.done) onProgress(info);
    } catch {
      /* el servidor está ocupado o reiniciándose: se vuelve a preguntar */
    }
  }
}

async function applyChanges(name: string, files: GeneratedFile[], patches: GeneratedPatch[], checks?: Checks, onProgress?: (info: ProgressInfo) => void): Promise<ApplyOutcome> {
  const stop = { done: false };
  if (onProgress) void watchProgress(onProgress, stop);
  try {
    const res = await fetch("/api/self-build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        files: files.map((f) => ({ path: f.path, content: f.content })),
        patches,
        ...(checks && hasChecks(checks) ? { checks } : {}),
      }),
    });
    let data: { ok?: boolean; folder?: string; written?: number; applied?: boolean; compiled?: boolean; restarting?: boolean; backup?: string; error?: string; evidence?: EvidenceReport };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      return { ok: false, error: `El servidor de WILLY respondió ${res.status} sin un resultado legible.` };
    }
    if (!data.ok) return { ok: false, error: data.error ?? "No se pudieron sustituir los archivos de WILLY AI." };
    if (!data.applied || !data.compiled) return { ok: false, error: "Los archivos se guardaron, pero el programa no superó la comprobación." };
    let note = `Aplicada y comprobada en WILLY AI: ${data.written ?? files.length + patches.length} cambio(s). Copia: ${data.backup ?? "creada"}.`;
    if (data.restarting) note += " Reiniciando el programa con la mejora.";
    return { ok: true, note, folder: data.folder, restarting: data.restarting, evidence: data.evidence };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudieron aplicar los archivos." };
  } finally {
    stop.done = true;
  }
}

export async function implementImprovement(
  item: WillyImprovement,
  engine: { endpoint: string; model: string },
  ping: (m: string) => void,
): Promise<void> {
  try {
    await runImprovement(item, engine, ping);
  } catch (error) {
    // Un fallo inesperado no puede dejar el trabajo «en marcha» para siempre ni los botones bloqueados.
    const detail = error instanceof Error ? error.message : "Error inesperado durante la mejora.";
    set({ id: item.id, pct: 100, step: "Error inesperado", detail, remaining: 0, startedAt: Date.now(), done: true, error: detail });
    const now = readSelfBuild();
    writeSelfBuild({
      ...now,
      improvements: now.improvements.map((entry) => (entry.id === item.id ? { ...entry, status: "pendiente" as const, result: detail } : entry)),
    });
    ping(`⚠️ ${detail}`);
  }
}

async function runImprovement(
  item: WillyImprovement,
  engine: { endpoint: string; model: string },
  ping: (m: string) => void,
): Promise<void> {
  if (isRunning()) {
    ping("Ya hay una mejora en marcha. Espera a que termine.");
    return;
  }

  // Cada trabajo empieza limpio: si no, el error o el «reiniciando» de un intento anterior
  // se quedarían pegados (barra roja, aviso de recarga) durante el trabajo nuevo.
  current = null;

  const started = Date.now();
  const update = (pct: number, step: string, detail: string, remaining: number | null = null) =>
    set({ id: item.id, pct, step, detail, remaining, startedAt: started, done: false });

  const finishWithError = (step: string, detail: string, files?: GeneratedFile[]) => {
    set({ id: item.id, pct: 100, step, detail, remaining: 0, startedAt: started, done: true, error: detail });
    const now = readSelfBuild();
    writeSelfBuild({
      ...now,
      improvements: now.improvements.map((entry) =>
        entry.id === item.id ? { ...entry, status: "pendiente" as const, ...(files?.length ? { files } : {}), result: detail } : entry,
      ),
    });
    ping(`⚠️ ${detail}`);
  };

  update(3, "Copia de seguridad", "Guardando el estado actual antes de tocar nada…");

  const base = readSelfBuild();
  const backup = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    instructions: base.instructions,
    reason: item.request,
  };
  writeSelfBuild({
    ...base,
    backups: [backup, ...base.backups].slice(0, 20),
    improvements: base.improvements.map((e) => (e.id === item.id ? { ...e, status: "en curso" as const } : e)),
  });

  update(8, "Análisis", "Leyendo el código real relacionado con la mejora…");

  let sourceContext = "";
  let sourcePaths: string[] = [];
  try {
    const contextResponse = await fetch("/api/self-build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "context", name: item.request, proposal: item.proposal, attachments: (item.attachments ?? []).map((file) => file.name), screenshots: (item.screenshots ?? []).map((shot) => shot.description.slice(0, 600)) }),
    });
    const contextData = (await contextResponse.json()) as { ok?: boolean; context?: string; paths?: string[]; error?: string };
    if (!contextResponse.ok || !contextData.ok) throw new Error(contextData.error ?? "No se pudo leer el código actual.");
    sourceContext = contextData.context ?? "";
    sourcePaths = contextData.paths ?? [];
  } catch (error) {
    finishWithError("No se inició la mejora", error instanceof Error ? error.message : "No se pudo leer el código actual.");
    return;
  }

  update(12, "Eligiendo la IA adecuada", "Buscando en tu equipo el modelo que mejor programa…");
  const builders = await planBuilders(engine.endpoint, engine.model);
  // Motores en la nube (opcionales y apagados por defecto): se suman a los modelos de tu equipo según la prioridad elegida.
  const cloudStatus = await engineStatus().catch(() => null);
  const sequence = buildSequence(cloudStatus, builders);
  const maxAttempts = maxAttemptsFor(MAX_ATTEMPTS, sequence);
  if (!sequence.length) {
    finishWithError(
      "Sin modelo disponible",
      "El motor de IA no responde o no tiene ningún modelo capaz de programar. Arranca Ollama y descarga uno en Centro de Inteligencia → Modelos.",
    );
    return;
  }

  let diagnosis = "";
  // Diario del trabajo: lo que intentó cada motor, para que el siguiente continúe desde ahí.
  const journal: string[] = [];
  let lastLabel = "";
  // Qué debe cumplirse de verdad: lo que se deduce de los textos entre comillas de la petición + lo que pidió el dueño.
  const checks = mergeChecks(deriveChecks(item.request), item.checks);
  // Ejemplos de mejoras parecidas que ya funcionaron (lo que WILLY ha aprendido).
  const examples = examplesSection(similarLessons(readLessons(), item.request, 2));
  let lastReply = "";
  let lastFiles: GeneratedFile[] = [];
  // Modelos que fallaron por el motor (no por su código): no se vuelven a probar.
  const unusable = new Set<string>();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // Con varios modelos se van relevando; con uno solo se reintenta con el error real como pista.
    if (attempt > 0 && lastLabel && diagnosis) journal.push(`Intento ${attempt} con ${lastLabel}: ${diagnosis.split("\n")[0]!.slice(0, 300)}`);
    const step = attemptStep(sequence, unusable, attempt);
    if (!step) break;
    const model = step.label;
    lastLabel = model;
    const bandStart = attempt < 4 ? 15 + attempt * 18 : 69 + (attempt - 3);
    let written = 0;
    const expected = 6000;
    const writeStart = Date.now();
    const label = `Escribiendo el código (intento ${attempt + 1}/${maxAttempts})`;

    update(bandStart, label, `Trabajando con ${model}…`);

    // Las reglas que el dueño ha ido enseñando en los chats también valen aquí (son las mismas para todas las IA).
    const rules = [base.instructions, lessonsSection(ownerLessons())].filter(Boolean).join("\n\n");
    const stepMessages = buildMessages({ instructions: rules, item, sourceContext, sourcePaths, attempt: attempt + 1, diagnosis, history: journal.slice(-4).join("\n"), examples });
    if (step.kind === "cloud") update(bandStart, label, `Esperando la respuesta de ${model}…`);
    const result = step.kind === "cloud" ? await callCloud(step.id, stepMessages) : await aiService.chat({
      endpoint: engine.endpoint,
      model: step.model,
      maxOutputTokens: 6_000,
      numCtx: 16_384,
      messages: stepMessages,
      onDelta: (delta) => {
        written += delta.length;
        const share = Math.min(1, written / expected);
        const elapsed = Date.now() - writeStart;
        const remaining = written > 300 ? ((elapsed / written) * Math.max(0, expected - written)) / 1000 : null;
        update(
          Math.min(bandStart + 12, Math.round(bandStart + share * 12)),
          label,
          `${model} · ${Math.round(written / 100) / 10} mil caracteres${remaining ? ` · faltan unos ${fmt(remaining)}` : ""}`,
          remaining,
        );
      },
    });

    if (!result.ok) {
      unusable.add(step.key);
      diagnosis = `El motor ${model} falló: ${result.error}`;
      update(bandStart + 13, "Cambiando de IA", `${result.error} WILLY pasa al siguiente motor…`);
      continue;
    }

    lastReply = result.data.trim().replace(/\s+/g, " ").slice(0, 220);
    // Primero se buscan archivos y sustituciones; solo si no hay ninguno se valora si fue una negativa.
    // (Antes se miraba el texto entero y el propio código de WILLY, que contiene frases como «no puedo», se tomaba por una negativa.)
    const files = extractFiles(result.data, sourcePaths);
    const patches = extractPatches(result.data, sourcePaths);
    if (!files.length && !patches.length) {
      if (looksLikeRefusal(result.data)) {
        diagnosis = `El modelo ${model} intentó negarse en vez de entregar código. Entrega directamente los archivos o las sustituciones.`;
        update(bandStart + 13, "Cambiando de IA", "Esa IA se negó. WILLY descarta su respuesta y prueba de nuevo…");
      } else {
        diagnosis = `El modelo ${model} no marcó ninguna ruta o dejó el bloque cortado. Cada bloque debe abrir con tres comillas, el lenguaje y la ruta exacta, o usar \`\`\`replace ruta con SEARCH/REPLACE cerrado con >>>>>>> REPLACE.`;
        update(bandStart + 13, "Reintentando", "La respuesta no traía archivos con su ruta. WILLY reintenta con instrucciones más estrictas…");
      }
      continue;
    }
    lastFiles = files;

    update(bandStart + 14, "Guardando y comprobando", `Aplicando ${files.length + patches.length} cambio(s) de ${model} en una versión candidata aparte…`, null);
    const applied = await applyChanges(item.request, files, patches, checks, (info) => update(Math.min(bandStart + 17, bandStart + 14 + Math.floor(info.n / 3)), info.label, `${model}: ${info.detail}`));

    if (!applied.ok) {
      diagnosis = `Los cambios se revirtieron porque la comprobación falló:\n${applied.error}`;
      // Una comprobación de resultados fallida es la pista más valiosa para el siguiente motor: dice qué NO hizo lo pedido.
      update(bandStart + 17, "Autorreparando", "La versión candidata no pasó las comprobaciones (la que funciona no se tocó). WILLY vuelve a intentarlo con el error detectado…");
      continue;
    }

    await finishSuccess({ item, files, patches, applied, label: model, attempts: attempt + 1, started, ping });
    return;
  }

  finishWithError(
    "No se pudo completar la mejora",
    `Se hicieron ${maxAttempts} intentos con ${sequence.length} motor(es) (${sequence.map((entry) => entry.label).join(", ")}) y ninguno dejó el programa compilando y cumpliendo lo pedido. Último motivo: ${diagnosis || "sin respuesta útil"}.${lastReply ? ` Así empezaba la última respuesta de la IA: «${lastReply}».` : ""} El código quedó como estaba y la propuesta se conserva para reintentarla.`,
    lastFiles,
  );
}
