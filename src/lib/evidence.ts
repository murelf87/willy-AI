// Evidencias de la Autoconstrucción. Un cambio que «compila» no demuestra que haga lo pedido (una IA local pequeña
// puede entender lo contrario). Aquí se convierte lo que pides en comprobaciones OBJETIVAS y se cuenta, antes y
// después, cuántas veces aparece cada texto en el código y en el programa compilado. Solo un «fallo» claro bloquea
// un cambio; lo que no se puede comprobar se dice como «no concluyente», nunca como «correcto».

export type Checks = { mustContain: string[]; mustNotContain: string[] };

export type EvidenceItem = {
  kind: "cambio" | "origen" | "compilado" | "arranque" | "pantalla" | "aviso" | "motor";
  status: "ok" | "fallo" | "info";
  title: string;
  detail: string;
};

export type EvidenceReport = {
  at: string;
  items: EvidenceItem[];
  /** Capturas antes/después guardadas en la copia de seguridad (se piden aparte por su tamaño). */
  screenshots?: { backup: string; changedPct: number };
  engine?: string;
};

export type ChangedFile = { path: string; before: string | null; after: string };

const norm = (text: string): string => text.normalize("NFC");

/** Variantes equivalentes de un texto (los puntos suspensivos se escriben de dos formas). */
export function needleVariants(needle: string): string[] {
  const out = new Set<string>([needle]);
  if (needle.includes("...")) out.add(needle.replace(/\.\.\./g, "…"));
  if (needle.includes("…")) out.add(needle.replace(/…/g, "..."));
  return [...out];
}

export function countOccurrences(text: string, needle: string): number {
  let total = 0;
  for (const variant of needleVariants(needle)) {
    if (!variant) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(variant, from);
      if (at < 0) break;
      total += 1;
      from = at + variant.length;
    }
  }
  return total;
}

/** Deja solo la parte fija de un texto (sin «{modelo}» ni «${…}») y descarta lo demasiado corto o genérico. */
export function cleanNeedle(raw: string): string | null {
  let text = norm(raw).replace(/\s+/g, " ").trim();
  const cut = text.search(/\$?\{/);
  if (cut >= 0) text = text.slice(0, cut).trim();
  text = text.replace(/[\s:,;]+$/g, "");
  if (text.length < 4 || text.length > 120) return null;
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3}/.test(text)) return null;
  return text;
}

export function cleanChecks(value: unknown): Checks {
  const pick = (list: unknown): string[] => {
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const entry of list) {
      if (typeof entry !== "string") continue;
      const needle = cleanNeedle(entry);
      if (needle && !out.includes(needle)) out.push(needle);
      if (out.length >= 8) break;
    }
    return out;
  };
  const source = (value ?? {}) as Partial<Checks>;
  const mustContain = pick(source.mustContain);
  // Si el texto nuevo CONTIENE al viejo («Guardar todo» contiene «Guardar»), exigir que el viejo desaparezca sería un
  // falso fallo: no se comprueba.
  const mustNotContain = pick(source.mustNotContain).filter((needle) => !mustContain.some((wanted) => wanted.includes(needle)));
  return { mustContain, mustNotContain };
}

export function mergeChecks(...all: Array<Checks | undefined>): Checks {
  return cleanChecks({ mustContain: all.flatMap((c) => c?.mustContain ?? []), mustNotContain: all.flatMap((c) => c?.mustNotContain ?? []) });
}

export function hasChecks(checks: Checks | undefined): boolean {
  return !!checks && (checks.mustContain.length > 0 || checks.mustNotContain.length > 0);
}

/**
 * Comprobaciones que se deducen de la petición: solo de los textos que el dueño escribe ENTRE COMILLAS y con
 * verbos claros («cambia “A” por “B”», «quita “A”», «que diga “B”», «añade “B”»). Sin comillas no se inventa nada.
 */
export function deriveChecks(request: string): Checks {
  const quoted: string[] = [];
  const tokenized = norm(request).replace(/[«“"‘'`]([^»”"’'`\n]{2,140})[»”"’'`]/g, (_all, inner: string) => {
    quoted.push(inner);
    return ` Q${quoted.length - 1} `;
  });
  const at = (token: string): string | null => {
    const index = Number(token.slice(1));
    return quoted[index] ? cleanNeedle(quoted[index]!) : null;
  };
  const contain: string[] = [];
  const notContain: string[] = [];
  const put = (list: string[], value: string | null) => {
    if (value && !list.includes(value)) list.push(value);
  };
  const used = new Set<string>();
  const take = (token: string) => used.add(token);

  // «pon B en vez de A»
  for (const m of tokenized.matchAll(/\b(?:pon\w*|escrib\w*|usa\w*)\s+(?:[^Q]{0,30}?)(Q\d+)\s+(?:en vez de|en lugar de|y no)\s+(?:[^Q]{0,20}?)(Q\d+)/gi)) {
    put(contain, at(m[1]!));
    put(notContain, at(m[2]!));
    take(m[1]!);
    take(m[2]!);
  }
  // «cambia A por B», «sustituye A por B», «de A a B»
  for (const m of tokenized.matchAll(/\b(?:cambi\w*|sustituy\w*|reemplaz\w*|renombr\w*|modific\w*|convert\w*)\s+(?:[^Q]{0,40}?)(Q\d+)\s+(?:[^Q]{0,30}?\s+)?(?:por|a|con)\s+(?:[^Q]{0,20}?)(Q\d+)/gi)) {
    if (used.has(m[1]!) || used.has(m[2]!)) continue;
    put(notContain, at(m[1]!));
    put(contain, at(m[2]!));
    take(m[1]!);
    take(m[2]!);
  }
  // «quita A», «elimina A»: A debe desaparecer DEL TEXTO COMPILADO. «Oculta A» NO entra aquí: ocultar un elemento
  // (mostrarlo u ocultarlo según una condición) no borra su texto del código, así que exigir que desaparezca sería
  // una condición que ningún cambio correcto podría cumplir jamás.
  for (const m of tokenized.matchAll(/\b(?:quit\w*|elimin\w*|borr\w*|suprim\w*)\s+(?:[^Q]{0,40}?)(Q\d+)/gi)) {
    if (used.has(m[1]!)) continue;
    put(notContain, at(m[1]!));
    take(m[1]!);
  }
  // «que diga B», «añade B», «pon B»
  for (const m of tokenized.matchAll(/\b(?:que\s+(?:[^Q]{0,30}?)(?:diga|ponga|muestre|aparezca|salga)|a[ñn]ad\w*|agreg\w*|inclu\w*|pon\w*|escrib\w*|muestr\w*)\s+(?:[^Q]{0,40}?)(Q\d+)/gi)) {
    if (used.has(m[1]!)) continue;
    put(contain, at(m[1]!));
    take(m[1]!);
  }
  return cleanChecks({ mustContain: contain, mustNotContain: notContain });
}

/** Apariciones de `needle` que NO forman parte de un texto más largo que se quiere quitar («Pensando» dentro de «Pensando con»). */
function effectiveCount(count: (needle: string) => number, needle: string, longer: string[]): number {
  let total = count(needle);
  for (const other of longer) {
    if (other !== needle && other.includes(needle)) total -= count(other) * countOccurrences(other, needle);
  }
  return Math.max(0, total);
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

function where(files: ChangedFile[], needle: string, limit = 3): string {
  const spots: string[] = [];
  for (const file of files) {
    for (const variant of needleVariants(needle)) {
      let from = 0;
      for (;;) {
        const at = file.after.indexOf(variant, from);
        if (at < 0) break;
        spots.push(`${file.path}:${lineOf(file.after, at)}`);
        from = at + variant.length;
        if (spots.length >= limit) return spots.join(", ");
      }
    }
  }
  return spots.join(", ");
}

const times = (n: number): string => (n === 1 ? "1 vez" : `${n} veces`);

/** Comprobación rápida sobre los archivos modificados, ANTES de guardar nada ni compilar. */
export function sourceCheck(files: ChangedFile[], checks: Checks): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const total = (pick: (file: ChangedFile) => string, needle: string) => files.reduce((sum, file) => sum + countOccurrences(pick(file), needle), 0);
  for (const needle of checks.mustNotContain) {
    const before = total((file) => file.before ?? "", needle);
    const after = total((file) => file.after, needle);
    if (before === 0) {
      items.push({ kind: "origen", status: "info", title: `«${needle}»`, detail: "No estaba en los archivos que se modifican: no se puede comprobar aquí (se mira en el programa compilado)." });
    } else if (after >= before) {
      items.push({ kind: "origen", status: "fallo", title: `«${needle}» sigue en el código`, detail: `Aparecía ${times(before)} y aparece ${times(after)} en los archivos modificados (${where(files, needle)}). El cambio no ha quitado lo que se pedía quitar.` });
    } else {
      items.push({ kind: "origen", status: "ok", title: `«${needle}» quitado del código`, detail: `Antes ${times(before)}, ahora ${times(after)} en los archivos modificados${after > 0 ? ` (queda en ${where(files, needle)}; si esos sitios no debían cambiar, está bien)` : ""}.` });
    }
  }
  for (const needle of checks.mustContain) {
    const before = effectiveCount((n) => total((file) => file.before ?? "", n), needle, checks.mustNotContain);
    const after = effectiveCount((n) => total((file) => file.after, n), needle, checks.mustNotContain);
    if (after > before) items.push({ kind: "origen", status: "ok", title: `«${needle}» añadido al código`, detail: `Ahora aparece en ${where(files, needle) || "los archivos modificados"} (antes ${times(before)}).` });
    else if (after === before && after > 0) items.push({ kind: "origen", status: "info", title: `«${needle}»`, detail: "Ya estaba en esos archivos antes del cambio: no concluyente." });
    else items.push({ kind: "origen", status: "info", title: `«${needle}»`, detail: "No aparece en los archivos modificados; se comprobará en el programa compilado." });
  }
  return items;
}

export function countInTexts(texts: string[], needles: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const needle of needles) out[needle] = texts.reduce((sum, text) => sum + countOccurrences(text, needle), 0);
  return out;
}

/** Comprobación sobre el programa COMPILADO: cuántas veces aparece cada texto antes y después. */
export function bundleCheck(before: Record<string, number> | null, after: Record<string, number>, checks: Checks): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const needle of checks.mustNotContain) {
    const a = after[needle] ?? 0;
    const b = before?.[needle];
    if (b === undefined) items.push({ kind: "compilado", status: a === 0 ? "ok" : "info", title: `«${needle}» en el programa compilado`, detail: `Aparece ${times(a)} (no hay versión anterior con la que comparar).` });
    else if (b === 0) items.push({ kind: "compilado", status: "info", title: `«${needle}» en el programa compilado`, detail: "No estaba en el programa anterior: no concluyente." });
    else if (a >= b) items.push({ kind: "compilado", status: "fallo", title: `«${needle}» sigue en el programa compilado`, detail: `Antes ${times(b)}, ahora ${times(a)}. El cambio no ha quitado lo que se pedía quitar.` });
    else items.push({ kind: "compilado", status: "ok", title: `«${needle}» ya no está tanto en el programa`, detail: `Antes ${times(b)}, ahora ${times(a)} en el programa compilado.` });
  }
  for (const needle of checks.mustContain) {
    const a = effectiveCount((n) => after[n] ?? 0, needle, checks.mustNotContain);
    const b = before ? effectiveCount((n) => before[n] ?? 0, needle, checks.mustNotContain) : 0;
    if (a > b) items.push({ kind: "compilado", status: "ok", title: `«${needle}» está en el programa compilado`, detail: `Antes ${times(b)}, ahora ${times(a)}.` });
    else if (a === 0) items.push({ kind: "compilado", status: "fallo", title: `«${needle}» no aparece en el programa compilado`, detail: "El texto que se pedía añadir no está en el resultado." });
    else items.push({ kind: "compilado", status: "info", title: `«${needle}»`, detail: "Ya estaba en el programa anterior: no concluyente." });
  }
  return items;
}

/** Líneas distintas entre dos versiones de un archivo (comparación por multiconjunto: rápida y suficiente como evidencia). */
export function diffStats(before: string | null, after: string): { added: number; removed: number } {
  const bag = new Map<string, number>();
  for (const line of (before ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) bag.set(line, (bag.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const left = bag.get(line) ?? 0;
    if (left > 0) bag.set(line, left - 1);
    else added += 1;
  }
  let removed = 0;
  for (const left of bag.values()) removed += left;
  return { added, removed };
}

const exportedNames = (text: string): string[] => [...text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]!);

/** Qué archivos se tocan y cuánto: y avisos si un cambio pequeño se lleva por delante mucho código. */
export function changeItems(files: ChangedFile[]): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const file of files) {
    const { added, removed } = diffStats(file.before, file.after);
    items.push({ kind: "cambio", status: "info", title: file.path, detail: file.before === null ? `Archivo nuevo (+${added} líneas).` : `+${added} / −${removed} líneas.` });
    if (file.before !== null) {
      const lines = file.before.split("\n").filter((l) => l.trim()).length;
      if (lines >= 25 && removed / lines > 0.5) items.push({ kind: "aviso", status: "info", title: `${file.path}: se elimina más de la mitad`, detail: `Se quitan ${removed} de ${lines} líneas. Revísalo: una mejora pequeña no suele borrar tanto.` });
      const lost = exportedNames(file.before).filter((name) => !exportedNames(file.after).includes(name));
      if (lost.length) items.push({ kind: "aviso", status: "info", title: `${file.path}: desaparece lo exportado`, detail: `Ya no se exporta: ${lost.slice(0, 5).join(", ")}. Si otro archivo lo usa, fallará la compilación.` });
    }
  }
  return items;
}

export const failures = (items: EvidenceItem[]): EvidenceItem[] => items.filter((item) => item.status === "fallo");

export function summarize(items: EvidenceItem[]): { ok: number; fallos: number; info: number } {
  return { ok: items.filter((i) => i.status === "ok").length, fallos: failures(items).length, info: items.filter((i) => i.status === "info").length };
}

/** Los fallos, como pista concreta para el siguiente intento del modelo. */
export function describeFailures(items: EvidenceItem[]): string {
  const bad = failures(items);
  return bad.map((item) => `- ${item.title}: ${item.detail}`).join("\n");
}

const MARK = { ok: "✔", fallo: "✘", info: "•" } as const;

export function evidenceMarkdown(report: EvidenceReport, request = ""): string {
  const lines = [`# Evidencias de la mejora`, "", request ? `**Petición:** ${request}` : "", `**Fecha:** ${report.at}`, report.engine ? `**Motor:** ${report.engine}` : "", ""].filter((l, i, all) => l !== "" || all[i - 1] !== "");
  const s = summarize(report.items);
  lines.push(`**Resumen:** ${s.ok} comprobadas · ${s.fallos} fallos · ${s.info} informativas`, "");
  for (const item of report.items) lines.push(`- ${MARK[item.status]} **${item.title}** — ${item.detail}`);
  if (report.screenshots) lines.push("", `Capturas antes/después: cambió el ${report.screenshots.changedPct} % de la pantalla inicial.`);
  return lines.join("\n");
}
