// Localizador de código para la Autoconstrucción. Un modelo local pequeño solo acierta si ve el trozo
// EXACTO que hay que cambiar. Antes se le mandaban ~30.000 caracteres elegidos por palabras sueltas y
// a menudo faltaba justo la línea a modificar. Ahora se busca en todo el código, se dan más peso a las
// palabras raras de la petición (poco repetidas en el programa) y se entregan solo esas zonas.

export type SourceFile = { rel: string; content: string };
export type FocusWindow = { rel: string; from: number; to: number; score: number };
export type FocusResult = { context: string; paths: string[]; windows: FocusWindow[]; terms: string[] };

const norm = (text: string): string => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const STOP = new Set(
  ("quiero quieres quiere cambia cambio cambiar cambialo cambiala pon poner pone ponlo donde aqui alli debajo arriba encima para como esto esta este estos estas sobre desde hasta entre porque cuando tiene tienen " +
    "hacer haz hazme puede pueden puedes todo toda todos todas cada mismo misma sigue siempre nunca ahora ademas tambien pero solo cosa cosas favor quita quitalo quitar anade anadir agrega agregar " +
    "muestra mostrar aparece aparecer vuelve pasa dale nuevo nueva nuevos nuevas mejora mejorar mejores implementado implementar funciona funcionar arregla arreglalo arreglar detecta errores error " +
    "necesito necesita gustaria quisiera debe deberia deben sea sean seria hace hacen algo alguna algun otra otro otros otras esas esos ese esa mas menos muy bien mal ver veo vea vean parte partes " +
    "programa aplicacion willy pantalla texto hazlo mejor peor bueno buena malo mala manera forma modo hacerlo hacerla lograr quedar queda quede pues aunque incluso mientras entonces siguiente ultimo ultima primero primera lado lados " +
    "cambiar cambiado cambiada cambios cambies").split(" "),
);

/** Palabras de relleno que no cuentan como «contenido» dentro de una frase de varias palabras. */
const FILLER = new Set("quiero quieres quiere cambia cambio cambiar cambialo cambiala pon poner pone ponlo donde aqui alli para como esto esta este estos estas sobre desde hasta entre porque cuando pero cada mismo misma sigue ahora ademas tambien favor vuelve pasa dale nuevo nueva hacer haz hazme sea vea vean hazlo mejor peor bueno buena malo mala".split(" "));

/** Palabras que ayudan a localizar (raras en el código) y frases literales entre comillas. */
export function termsOf(text: string): { words: string[]; phrases: string[] } {
  const phrases = [...text.matchAll(/["“”«»'‘’`]([^"“”«»'‘’`\n]{3,70})["“”«»'‘’`]/g)].map((m) => norm(m[1] ?? "").trim()).filter((p) => p.length >= 3);
  const words = [...new Set(norm(text).match(/[a-z0-9]{4,}/g) ?? [])].filter((word) => !STOP.has(word));
  // Secuencias de 2 y 3 palabras seguidas («crear e implementar»): si aparecen tal cual en el código, casi seguro son un rótulo.
  const tokens = norm(text).match(/[a-z0-9]+/g) ?? [];
  const grams: string[] = [];
  for (const size of [3, 2]) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      const slice = tokens.slice(index, index + size);
      // Solo cuentan frases con al menos DOS palabras de contenido («crear e implementar»); «en el chat» no es un rótulo.
      if (slice.filter((token) => token.length >= 4 && !FILLER.has(token)).length >= 2) grams.push(slice.join(" "));
    }
  }
  return { words, phrases: [...new Set([...phrases, ...grams.filter((gram) => gram.length >= 8)])] };
}

const UI_INTENT = /(boton|botones|pantalla|texto|color|icono|menu|pestana|tarjeta|indicador|titulo|chat|inicio|barra|panel|cuadro|miniatura|puntos|animad|etiqueta|rotulo|mensaje|lista|formulario)/;

const priorOf = (rel: string, ui: boolean): number => (/^src\/(?:lib|services|types|hooks)\//.test(rel) ? (ui ? 0.45 : 0.7) : ui && /\.tsx$/.test(rel) ? 1.25 : 1);

export function focusContext(input: {
  files: SourceFile[];
  request: string;
  /** Textos que describen lo que se ve (capturas): aportan rótulos literales, con menos peso que la petición. */
  extra?: string;
  /** Archivos nombrados por el dueño (los que ha subido) y rutas que ya se sabe que importan. */
  boostPaths?: string[];
  budget?: number;
  radius?: number;
}): FocusResult {
  const budget = input.budget ?? 12000;
  const radius = input.radius ?? 10;
  // El propio localizador contiene listas de palabras en español que ensuciarían cualquier búsqueda.
  const searchable = input.files.filter((file) => file.rel !== "src/lib/code-focus.ts");
  const lines = searchable.map((file) => ({ rel: file.rel, raw: file.content.split("\n"), n: file.content.split("\n").map(norm) }));

  // Archivo nombrado por el dueño (adjuntado o citado por su ruta) y de tamaño razonable: se entrega ENTERO
  // en vez de fragmentos elegidos por palabras clave, para que el modelo vea siempre el texto exacto a copiar.
  const FULL_FILE_LIMIT = 30_000;
  const fullFiles = (input.boostPaths ?? [])
    .map((rel) => searchable.find((file) => file.rel === rel))
    .filter((file): file is SourceFile => !!file && file.content.length <= FULL_FILE_LIMIT)
    .slice(0, 2);
  if (fullFiles.length) {
    const blocks = fullFiles.map((file) => `--- ${file.rel} (archivo completo) ---\n${file.content}`);
    const rest = searchable.filter((file) => !fullFiles.some((full) => full.rel === file.rel));
    const restResult = rest.length
      ? focusContext({ ...input, files: rest, boostPaths: (input.boostPaths ?? []).filter((rel) => !fullFiles.some((full) => full.rel === rel)) })
      : { context: "", paths: [], windows: [], terms: [] };
    return {
      context: [...blocks, restResult.context].filter(Boolean).join("\n\n"),
      paths: [...new Set([...fullFiles.map((file) => file.rel), ...restResult.paths])],
      windows: restResult.windows,
      terms: restResult.terms,
    };
  }

  const primary = termsOf(input.request);
  const replacement = /(?:cambi\w*|sustituy\w*|reemplaz\w*|pon\w*)\s+(?:[\wáéíóúñ]+\s+){0,4}?por\s+([^.,;\n]{2,60})/i.exec(input.request)?.[1];
  const replacementWords = new Set(termsOf(replacement ?? "").words);
  const secondary = termsOf(input.extra ?? "");
  const weighted = new Map<string, { weight: number; phrase: boolean }>();
  for (const word of primary.words) weighted.set(word, { weight: replacementWords.has(word) ? 0.15 : 1, phrase: false });
  for (const word of secondary.words) if (!weighted.has(word)) weighted.set(word, { weight: 0.5, phrase: false });
  const quoted = new Set(termsOf(input.request).phrases);
  for (const phrase of primary.phrases) weighted.set(phrase, { weight: phrase.split(" ").length >= 3 ? 3 : 2, phrase: true });
  for (const phrase of secondary.phrases) if (!weighted.has(phrase)) weighted.set(phrase, { weight: 1.5, phrase: true });

  // Cuántas líneas del programa contienen cada término: cuanto más raro, más útil.
  const frequency = new Map<string, number>();
  for (const [term] of weighted) {
    let count = 0;
    for (const file of lines) for (const line of file.n) if (line.includes(term)) count += 1;
    frequency.set(term, count);
  }
  const usable = [...weighted].filter(([term]) => {
    const count = frequency.get(term) ?? 0;
    return count > 0 && count <= 80;
  });
  // Hace falta al menos una pista realmente rara (en pocas líneas); si no, es mejor no adivinar.
  if (!usable.some(([term]) => (frequency.get(term) ?? 0) <= 25)) {
    // Sin pistas raras: si el dueño ha subido archivos, se le da el principio de cada uno; si no, es mejor no adivinar.
    const named = (input.boostPaths ?? []).slice(0, 3).map((rel) => searchable.find((file) => file.rel === rel)).filter((file): file is SourceFile => !!file);
    if (!named.length) return { context: "", paths: [], windows: [], terms: [] };
    const blocks = named.map((file) => `--- ${file.rel} (principio del archivo) ---\n${file.content.slice(0, 5000)}`);
    return { context: blocks.join("\n\n"), paths: named.map((file) => file.rel), windows: [], terms: [] };
  }
  void quoted;
  const ui = UI_INTENT.test(norm(`${input.request} ${input.extra ?? ""}`));

  const boosted = new Set(input.boostPaths ?? []);
  const hits: Array<{ rel: string; line: number; score: number }> = [];
  for (const file of lines) {
    const prior = priorOf(file.rel, ui) * (boosted.has(file.rel) ? 1.6 : 1);
    file.n.forEach((line, index) => {
      let score = 0;
      for (const [term, info] of usable) if (line.includes(term)) score += (info.weight / (frequency.get(term) ?? 1));
      if (score > 0) hits.push({ rel: file.rel, line: index, score: score * prior });
    });
  }
  hits.sort((a, b) => b.score - a.score);

  const windows: FocusWindow[] = [];
  for (const hit of hits.slice(0, 60)) {
    const from = Math.max(0, hit.line - radius);
    const to = hit.line + radius;
    // Cada zona se mantiene pequeña (como mucho ~34 líneas): una zona enorme se llevaría todo el espacio.
    const near = windows.find((w) => w.rel === hit.rel && !(to < w.from - 3 || from > w.to + 3) && Math.max(w.to, to) - Math.min(w.from, from) <= 30);
    if (near) {
      near.from = Math.min(near.from, from);
      near.to = Math.max(near.to, to);
      near.score += hit.score;
    } else if (windows.length < 16) {
      windows.push({ rel: hit.rel, from, to, score: hit.score });
    }
  }
  // Una zona vale más cuantas más pistas DISTINTAS reúne, no cuántas veces repite la misma.
  for (const window of windows) {
    const file = lines.find((entry) => entry.rel === window.rel)!;
    const present = new Set<string>();
    for (let index = window.from; index <= Math.min(window.to, file.n.length - 1); index += 1) {
      for (const [term] of usable) if (file.n[index]!.includes(term)) present.add(term);
    }
    let sum = 0;
    for (const term of present) sum += (weighted.get(term)!.weight / (frequency.get(term) ?? 1));
    window.score = sum * priorOf(window.rel, ui) * (boosted.has(window.rel) ? 1.6 : 1) * (1 + 0.35 * Math.max(0, present.size - 1));
  }
  windows.sort((a, b) => b.score - a.score);

  const chosen: FocusWindow[] = [];
  const blocks: string[] = [];
  let total = 0;
  const perFile = new Map<string, number>();
  for (const window of windows) {
    if (chosen.length >= 8 || (perFile.get(window.rel) ?? 0) >= 3) continue;
    const file = lines.find((entry) => entry.rel === window.rel)!;
    const to = Math.min(file.raw.length - 1, window.to);
    const block = `--- ${window.rel} (líneas ${window.from + 1}-${to + 1}) ---\n${file.raw.slice(window.from, to + 1).join("\n")}`;
    if (total + block.length > budget) continue;
    chosen.push({ ...window, to });
    blocks.push(block);
    total += block.length;
    perFile.set(window.rel, (perFile.get(window.rel) ?? 0) + 1);
  }
  if (!chosen.length) return { context: "", paths: [], windows: [], terms: usable.map(([term]) => term) };

  // Las primeras líneas (importaciones) del archivo principal, por si el cambio necesita importar algo.
  const top = chosen[0]!;
  const head = lines.find((entry) => entry.rel === top.rel)!.raw.slice(0, 30).filter((line) => /^\s*(?:import|export \{)|from ["']/.test(line));
  if (head.length && top.from > 30 && total + 1200 < budget * 1.15) {
    blocks.push(`--- ${top.rel} (importaciones al principio del archivo) ---\n${head.join("\n").slice(0, 1200)}`);
  }
  const paths = [...new Set([...chosen.map((w) => w.rel), ...(input.boostPaths ?? [])])];
  return { context: blocks.join("\n\n"), paths, windows: chosen, terms: usable.map(([term]) => term) };
}
