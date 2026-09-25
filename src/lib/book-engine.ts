// Motor del libro: elige la mejor IA disponible, escribe el libro por partes (esquema → capítulos → prólogo, epílogo, contraportada,
// ficha de venta) con continuidad entre capítulos, en relevo entre motores, y se puede reanudar o reescribir un capítulo.
// «Mejor» no se puede medir desde aquí: es un orden razonado (ver BOOK_CLOUD_ORDER) y cada capítulo dice con qué motor se escribió.

import type { PublicStatus } from "@/lib/engines-server";
import type { BookSpec } from "@/services/book-template";

export type Step = { kind: "cloud"; id: string; label: string; key: string } | { kind: "local"; model: string; label: string; key: string };

/** Prosa larga en español: Gemini (contexto enorme y salida larga), Mistral y Cohere (fuertes en español), los grandes de NVIDIA y de OpenRouter y, por último, Groq (rapidísimo pero de salida más corta). */
export const BOOK_CLOUD_ORDER = ["gemini", "mistral", "cohere", "nvidia", "openrouter", "groq"];
/** En tu equipo, de más a menos apto para escribir en español (los pequeños, al final). */
export const BOOK_LOCAL_ORDER = ["gemma2:9b", "llama3.1:8b", "qwen2.5:14b", "llama3.2:3b", "phi4-mini"];
const NOT_WRITER = /(embed|vision|llava|moondream|coder|-vl\b|qwen2\.?5vl|r1)/i;

export function bookSteps(status: PublicStatus | null, localModels: string[], pick: string): { steps: Step[]; notes: string[] } {
  const notes: string[] = [];
  const local: Step[] = [...localModels]
    .filter((m) => !NOT_WRITER.test(m))
    .sort((a, b) => { const ia = BOOK_LOCAL_ORDER.findIndex((x) => a.startsWith(x)), ib = BOOK_LOCAL_ORDER.findIndex((x) => b.startsWith(x)); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); })
    .map((model) => ({ kind: "local" as const, model, label: model, key: `local:${model}` }));
  if (pick === "local") return { steps: local, notes: local.length ? [] : ["No hay ningún modelo local apto para escribir."] };
  let cloud: Step[] = [];
  if (!status) notes.push("No he podido consultar los motores externos: solo tu IA local.");
  else if (!status.master) {
    if (status.engines.some((e) => e.hasKey)) notes.push("Los motores externos están desactivados (interruptor general en Autoconstrucción → Motores en la nube): escribo con tu IA local.");
    else notes.push("No hay ningún motor externo con clave: escribo con tu IA local.");
  } else {
    const usable = status.engines.filter((e) => e.hasKey && e.enabled && e.available);
    cloud = usable.sort((a, b) => BOOK_CLOUD_ORDER.indexOf(a.id) - BOOK_CLOUD_ORDER.indexOf(b.id)).map((e) => ({ kind: "cloud" as const, id: e.id, label: `${e.name}${e.model ? ` · ${e.model}` : ""}`, key: `cloud:${e.id}` }));
    if (pick !== "auto") {
      const chosen = cloud.filter((s) => s.kind === "cloud" && s.id === pick);
      if (!chosen.length) notes.push("El motor elegido no está disponible ahora (sin clave, apagado o sin cuota): uso el resto.");
      else cloud = chosen;
    }
    if (!cloud.length) notes.push("Ningún motor externo está disponible ahora: escribo con tu IA local.");
  }
  return { steps: [...cloud, ...local], notes };
}

// ------------------------------------------------------------------------------------------------ relevo
export type Msg = { role: "system" | "user" | "assistant"; content: string };
export type CloudResult = { ok: true; data: string; model: string; engine: string } | { ok: false; error: string; kind?: string };
export type RelayDeps = {
  cloud: (id: string, messages: Msg[], opts: { maxTokens: number; temperature: number }) => Promise<CloudResult>;
  local: (model: string, messages: Msg[], opts: { maxTokens: number; temperature: number; onDelta?: (d: string) => void }) => Promise<string>;
};
export type Written = { ok: true; text: string; label: string } | { ok: false; error: string };

/** Fallos que no se arreglan reintentando en este trabajo: el motor sale de la rueda hasta el final. */
const PERMANENT = new Set(["auth", "payment", "model", "quota-day", "unavailable"]);

export async function writeWithRelay(steps: Step[], messages: Msg[], o: { maxTokens: number; temperature: number; onDelta?: (d: string) => void; onStep?: (label: string) => void; signal?: AbortSignal }, deps: RelayDeps, skipped: Set<string>): Promise<Written> {
  const errors: string[] = [];
  for (const step of steps) {
    if (skipped.has(step.key)) continue;
    if (o.signal?.aborted) return { ok: false, error: "Parado." };
    o.onStep?.(step.label);
    try {
      if (step.kind === "cloud") {
        const res = await deps.cloud(step.id, messages, { maxTokens: o.maxTokens, temperature: o.temperature });
        if (res.ok && res.data.trim()) { o.onDelta?.(res.data); return { ok: true, text: res.data, label: `${res.engine} · ${res.model}` }; }
        const why = res.ok ? "respondió vacío" : res.error;
        errors.push(`${step.label}: ${why}`);
        if (!res.ok && res.kind && PERMANENT.has(res.kind)) skipped.add(step.key);
      } else {
        const text = await deps.local(step.model, messages, { maxTokens: o.maxTokens, temperature: o.temperature, ...(o.onDelta ? { onDelta: o.onDelta } : {}) });
        if (text.trim()) return { ok: true, text, label: step.model };
        errors.push(`${step.label}: respondió vacío`);
      }
    } catch (error) {
      if (o.signal?.aborted) return { ok: false, error: "Parado." };
      errors.push(`${step.label}: ${error instanceof Error ? error.message : String(error)}`);
      if (step.kind === "local") skipped.add(step.key);
    }
  }
  return { ok: false, error: errors.length ? `Ningún motor pudo escribirlo. ${errors.join(" · ")}` : "No hay ningún motor disponible para escribir." };
}

// ------------------------------------------------------------------------------------------------ el libro
export type Chapter = { n: number; title: string; summary: string; text: string; engine: string; words: number };
export type BookDoc = { outline: Array<{ title: string; summary: string }>; chapters: Chapter[]; prologue: string; epilogue: string; blurb: string; sheet: string; engines: string[] };
export const emptyDoc = (): BookDoc => ({ outline: [], chapters: [], prologue: "", epilogue: "", blurb: "", sheet: "", engines: [] });
export const wordsOf = (text: string): number => (text.match(/\S+/g) ?? []).length;

const brief = (s: BookSpec) => `Título: ${s.title || "(sin título)"}${s.subtitle ? `\nSubtítulo: ${s.subtitle}` : ""}\nAutor: ${s.author || "(sin nombre)"}\nGénero: ${s.genre}\nPúblico: ${s.audience}\nTono: ${s.tone}\nIdioma: ${s.language || "español de España"}\nIdea: ${s.idea || s.title}`;

export function outlinePrompt(s: BookSpec): Msg[] {
  return [
    { role: "system", content: "Eres un editor y escritor profesional con mucha experiencia en libros publicados. Respondes solo con lo que se te pide." },
    { role: "user", content: `Diseña el esquema de este libro.\n\n${brief(s)}\n\nDame EXACTAMENTE ${s.chapters} capítulos que se sigan con lógica y sin repetirse. Responde SOLO con JSON válido, sin explicaciones ni comillas de código, con esta forma:\n{"chapters":[{"title":"Título del capítulo","summary":"Qué se cuenta o se explica en 2-3 frases"}]}` },
  ];
}

/** Lee el esquema aunque el modelo no obedezca del todo: JSON, o una lista numerada. Siempre devuelve exactamente n capítulos. */
export function parseOutline(text: string, n: number): Array<{ title: string; summary: string }> {
  let items: Array<{ title: string; summary: string }> = [];
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { chapters?: Array<{ title?: unknown; summary?: unknown }> };
      items = (parsed.chapters ?? []).map((c) => ({ title: String(c.title ?? "").trim(), summary: String(c.summary ?? "").trim() })).filter((c) => c.title);
    } catch { /* se prueba la lista */ }
  }
  if (!items.length) {
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:#{1,4}\s*)?(?:\d+[.)]|[-*•]|cap[ií]tulo\s+\d+\s*[:.\-–—]?)\s*(.+?)\s*(?:[—–:]\s+(.+))?$/i.exec(line);
      if (m && m[1] && m[1].length < 140) items.push({ title: m[1].replace(/\*\*/g, "").trim(), summary: (m[2] ?? "").trim() });
    }
  }
  items = items.slice(0, n);
  while (items.length < n) items.push({ title: `Capítulo ${items.length + 1}`, summary: "" });
  return items;
}

export const tail = (text: string, max = 900): string => (text.length <= max ? text : `…${text.slice(text.length - max).replace(/^\S*\s/, "")}`);

export function chapterPrompt(s: BookSpec, doc: BookDoc, index: number): Msg[] {
  const n = index + 1;
  const ch = doc.outline[index]!;
  const prev = doc.chapters.find((c) => c.n === n - 1);
  const list = doc.outline.map((c, i) => `${i + 1}. ${c.title}${c.summary ? ` — ${c.summary}` : ""}`).join("\n");
  return [
    { role: "system", content: `Eres un escritor profesional de ${s.genre}. Escribes en ${s.language || "español de España"} con estilo propio, voz coherente, ritmo y detalle real. Nunca resumes ni haces esquemas: escribes el texto definitivo del libro. No hablas de ti, no saludas, no explicas lo que haces.` },
    { role: "user", content: `${brief(s)}\n\nESQUEMA COMPLETO DEL LIBRO:\n${list}\n\nAhora escribe el CAPÍTULO ${n}: «${ch.title}»${ch.summary ? ` (${ch.summary})` : ""}.\n${prev ? `\nEl capítulo anterior terminaba así (continúa con naturalidad, sin repetirlo):\n«${tail(prev.text)}»\n` : ""}\nReglas: unas ${s.wordsPerChapter} palabras (no menos del 90 %); empieza DIRECTAMENTE con el texto, sin título ni número de capítulo (se añaden después); párrafos bien desarrollados; si necesitas subtítulos usa ### ; sin listas de esquema salvo que el género lo pida; no adelantes lo que corresponde a capítulos posteriores; no cierres el libro entero.` },
  ];
}

export function continuePrompt(base: Msg[], written: string, missingWords: number): Msg[] {
  return [...base, { role: "assistant", content: written }, { role: "user", content: `Continúa EXACTAMENTE donde lo dejaste, sin repetir nada ni concluir todavía, y añade unas ${missingWords} palabras más de texto definitivo del mismo capítulo.` }];
}

/** Quita el título o «Capítulo N» que algunos modelos ponen aunque se les pida que no. */
export function stripLeadingHeading(text: string): string {
  return text.replace(/^\s*(?:#{1,4}\s*[^\n]*\n+|\*\*(?:cap[ií]tulo|prólogo|epílogo)[^\n]*\*\*\s*\n+|(?:cap[ií]tulo)\s+\d+[^\n]*\n+)/i, "").replace(/^\s+/, "").trim();
}

export function sidePrompt(kind: "prologue" | "epilogue" | "blurb" | "sheet", s: BookSpec, doc: BookDoc): Msg[] {
  const list = doc.outline.map((c, i) => `${i + 1}. ${c.title}${c.summary ? ` — ${c.summary}` : ""}`).join("\n");
  const ask = {
    prologue: "Escribe el PRÓLOGO (400-700 palabras): engancha al lector, explica por qué este libro y qué se llevará. Sin título ni encabezado.",
    epilogue: "Escribe el EPÍLOGO (400-700 palabras): cierre con conclusión y reflexión final coherente con los capítulos. Sin título ni encabezado.",
    blurb: "Escribe el TEXTO DE CONTRAPORTADA (110-150 palabras): sinopsis de venta que enganche, sin destripar el final, terminando con una frase memorable. Solo el texto.",
    sheet: `Escribe la FICHA DE PUBLICACIÓN en Markdown con: título, subtítulo, autor, 3 categorías de tienda de libros, 7 palabras clave, descripción de venta (150-200 palabras) y precio sugerido razonable en euros (ebook y papel) con una línea que lo justifique.`,
  }[kind];
  return [
    { role: "system", content: "Eres un editor y escritor profesional. Respondes solo con lo que se pide, sin saludos ni explicaciones." },
    { role: "user", content: `${brief(s)}\n\nESQUEMA:\n${list}\n\n${ask}` },
  ];
}

export type Progress = { phase: "esquema" | "capitulo" | "prologo" | "epilogo" | "contraportada" | "ficha" | "fin"; index: number; total: number; label: string };

/**
 * Escribe (o continúa) el libro. Cada parte que ya existe se salta, así que tras una interrupción se reanuda donde se quedó.
 * Se guarda tras cada parte (onDoc) para que un corte no pierda nada.
 */
export async function runBook(o: { spec: BookSpec; doc: BookDoc; steps: Step[]; deps: RelayDeps; onDoc: (doc: BookDoc) => void; onProgress?: (p: Progress) => void; onDelta?: (d: string) => void; onStep?: (label: string) => void; signal?: AbortSignal }): Promise<{ ok: boolean; doc: BookDoc; error?: string }> {
  const doc: BookDoc = JSON.parse(JSON.stringify(o.doc));
  const skipped = new Set<string>();
  const total = o.spec.chapters;
  const use = (label: string) => { if (!doc.engines.includes(label)) doc.engines.push(label); };
  const write = (messages: Msg[], maxTokens: number, temperature: number) => writeWithRelay(o.steps, messages, { maxTokens, temperature, ...(o.onDelta ? { onDelta: o.onDelta } : {}), ...(o.onStep ? { onStep: o.onStep } : {}), ...(o.signal ? { signal: o.signal } : {}) }, o.deps, skipped);
  const fail = (error: string) => ({ ok: false as const, doc, error });

  if (doc.outline.length !== total) {
    o.onProgress?.({ phase: "esquema", index: 0, total, label: "Diseñando el esquema" });
    const r = await write(outlinePrompt(o.spec), 3000, 0.6);
    if (!r.ok) return fail(r.error);
    use(r.label);
    doc.outline = parseOutline(r.text, total);
    doc.chapters = doc.chapters.filter((c) => c.n <= total);
    o.onDoc(doc);
  }
  for (let i = 0; i < total; i++) {
    if (o.signal?.aborted) return fail("Parado.");
    if (doc.chapters.some((c) => c.n === i + 1 && c.text.trim())) continue;
    o.onProgress?.({ phase: "capitulo", index: i + 1, total, label: doc.outline[i]!.title });
    const base = chapterPrompt(o.spec, doc, i);
    const tokens = Math.min(8000, Math.max(1500, Math.round(o.spec.wordsPerChapter * 2.2)));
    let r = await write(base, tokens, 0.8);
    if (!r.ok) return fail(r.error);
    let text = stripLeadingHeading(r.text);
    let label = r.label;
    // Si se quedó corto, una continuación (solo una) para llegar a lo pedido.
    if (wordsOf(text) < o.spec.wordsPerChapter * 0.6) {
      const more = await write(continuePrompt(base, text, o.spec.wordsPerChapter - wordsOf(text)), tokens, 0.8);
      if (more.ok) text = `${text}\n\n${stripLeadingHeading(more.text)}`;
    }
    use(label);
    const chapter: Chapter = { n: i + 1, title: doc.outline[i]!.title, summary: doc.outline[i]!.summary, text, engine: label, words: wordsOf(text) };
    doc.chapters = [...doc.chapters.filter((c) => c.n !== chapter.n), chapter].sort((a, b) => a.n - b.n);
    o.onDoc(doc);
  }
  const side: Array<["prologue" | "epilogue" | "blurb" | "sheet", Progress["phase"], string, number, number]> = [["prologue", "prologo", "Prólogo", 1500, 0.8], ["epilogue", "epilogo", "Epílogo", 1500, 0.8], ["blurb", "contraportada", "Contraportada", 600, 0.7], ["sheet", "ficha", "Ficha de publicación", 1200, 0.5]];
  for (const [kind, phase, label, tokens, temp] of side) {
    if (o.signal?.aborted) return fail("Parado.");
    if (doc[kind].trim()) continue;
    o.onProgress?.({ phase, index: 0, total, label });
    const r = await write(sidePrompt(kind, o.spec, doc), tokens, temp);
    if (!r.ok) return fail(r.error);
    use(r.label);
    doc[kind] = kind === "sheet" || kind === "blurb" ? r.text.trim() : stripLeadingHeading(r.text);
    o.onDoc(doc);
  }
  o.onProgress?.({ phase: "fin", index: total, total, label: "Libro terminado" });
  return { ok: true, doc };
}

/** Reescribe un solo capítulo (con los demás como contexto). */
export async function rewriteChapter(o: { spec: BookSpec; doc: BookDoc; index: number; steps: Step[]; deps: RelayDeps; instruction?: string; onDelta?: (d: string) => void; signal?: AbortSignal }): Promise<{ ok: boolean; doc: BookDoc; error?: string }> {
  const doc: BookDoc = JSON.parse(JSON.stringify(o.doc));
  const ch = doc.outline[o.index];
  if (!ch) return { ok: false, doc, error: "Ese capítulo no existe." };
  const base = chapterPrompt(o.spec, { ...doc, chapters: doc.chapters.filter((c) => c.n < o.index + 1) }, o.index);
  if (o.instruction?.trim()) base[base.length - 1] = { role: "user", content: `${base[base.length - 1]!.content}\n\nInstrucción extra del autor: ${o.instruction.trim()}` };
  const r = await writeWithRelay(o.steps, base, { maxTokens: Math.min(8000, Math.max(1500, Math.round(o.spec.wordsPerChapter * 2.2))), temperature: 0.8, ...(o.onDelta ? { onDelta: o.onDelta } : {}), ...(o.signal ? { signal: o.signal } : {}) }, o.deps, new Set());
  if (!r.ok) return { ok: false, doc, error: r.error };
  const text = stripLeadingHeading(r.text);
  const chapter: Chapter = { n: o.index + 1, title: ch.title, summary: ch.summary, text, engine: r.label, words: wordsOf(text) };
  doc.chapters = [...doc.chapters.filter((c) => c.n !== chapter.n), chapter].sort((a, b) => a.n - b.n);
  if (!doc.engines.includes(r.label)) doc.engines.push(r.label);
  return { ok: true, doc };
}

/** Importa un manuscrito anterior (Markdown con «## Capítulo…») al formato por capítulos. */
export function importManuscript(md: string): Chapter[] {
  const parts = md.split(/^##\s+/m).slice(1);
  return parts.map((part, i) => {
    const [head = "", ...rest] = part.split("\n");
    const text = rest.join("\n").trim();
    return { n: i + 1, title: head.replace(/^cap[ií]tulo\s+\d+\s*[:.\-–—]?\s*/i, "").trim() || `Capítulo ${i + 1}`, summary: "", text, engine: "importado", words: wordsOf(text) };
  }).filter((c) => c.text);
}
