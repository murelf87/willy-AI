// FASE 3 · Proyecto innovador (I+D): investigación con búsquedas REALES antes de construir.
// Reutiliza la misma búsqueda de internet que ya usa el chat (/api/fetch-url con «ask»). Lo que se encuentra se guarda con su
// dirección, la consulta y la fecha, y se le da a la IA como las ÚNICAS fuentes que puede presentar como hechos: así no se
// inventan competidores, repositorios ni artículos. Si no se puede buscar, se dice claramente y todo queda como hipótesis.

import type { ProjectBrief } from "@/lib/project-brief";

export type WebHit = { title: string; url: string; snippet: string };
export type ResearchSource = WebHit & { query: string; foundAt: string };
export type Research = {
  searchedAt: string;
  queries: string[];
  sources: ResearchSource[];
  /** Consultas que fallaron (sin conexión, límite de búsquedas…). */
  failed: string[];
  /** true si al menos una búsqueda llegó a hacerse. */
  searched: boolean;
};
export type SearchFn = (query: string) => Promise<WebHit[]>;

const STOP = new Set(("el la los las un una unos unas de del al a y o u e que en con por para sin su sus mi mis tu tus se es son ser lo le les me te nos os muy mas más " +
  "tienen tiene tener hay como cuando donde porque pero quiero quisiera crear hacer programa novedoso novedosa nuevo nueva algo forma manera dificultades " +
  "problema problemas personas gente cosas mucho mucha poder puede pueden este esta estos estas ese esa eso aqui aquí hola buenas gracias favor porfa ayuda ayudame ayúdame").split(/\s+/));

/** Palabras con significado del problema, en su orden y sin repetir. */
export function keywordsOf(text: string, max = 6): string[] {
  const words = text.toLowerCase().replace(/https?:\/\/\S+/g, " ").match(/[a-záéíóúüñ0-9]+/gi) ?? [];
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 4 || STOP.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** Consultas para saber qué existe ya (productos, apps, proyectos abiertos y alternativas). */
export function researchQueries(problem: string): string[] {
  const kw = keywordsOf(problem);
  if (!kw.length) return [];
  const core = kw.slice(0, 4).join(" ");
  const short = kw.slice(0, 3).join(" ");
  return [...new Set([`${core} software`, `${core} aplicación`, `${short} open source github`, `${short} alternativas`])];
}

/** Hace las búsquedas de verdad. Nunca lanza error: si no se puede buscar, lo deja anotado. */
export async function runResearch(problem: string, search: SearchFn, now: () => Date = () => new Date(), maxSources = 12): Promise<Research> {
  const queries = researchQueries(problem);
  const sources: ResearchSource[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    try {
      const hits = await search(query);
      for (const hit of hits.slice(0, 5)) {
        let key = hit.url;
        try { const u = new URL(hit.url); key = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`; } catch { continue; }
        if (!/^https?:/i.test(hit.url) || seen.has(key)) continue;
        seen.add(key);
        sources.push({ title: hit.title.trim() || hit.url, url: hit.url, snippet: hit.snippet.replace(/\s+/g, " ").trim().slice(0, 300), query, foundAt: now().toISOString() });
      }
    } catch {
      failed.push(query);
    }
  }
  return { searchedAt: now().toISOString(), queries, sources: sources.slice(0, maxSources), failed, searched: queries.length > 0 && failed.length < queries.length };
}

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

/** Bloque que se añade al primer mensaje del proyecto innovador: las fuentes reales encontradas (o que no se pudo buscar). */
export function researchPromptBlock(research: Research): string {
  if (!research.searched || !research.sources.length) {
    return [
      "INVESTIGACIÓN PREVIA: " + (research.searched ? "se buscó en internet pero no salió ningún resultado útil" : "no se ha podido buscar en internet ahora mismo (sin conexión o búsqueda no disponible)") + ".",
      "Por tanto, todo lo que digas sobre qué existe ya es HIPÓTESIS: márcalo así, no des nombres de productos como hechos y propón qué habría que buscar para confirmarlo.",
    ].join("\n");
  }
  const list = research.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}\n   ${s.snippet}`).join("\n");
  return [
    `FUENTES ENCONTRADAS EN UNA BÚSQUEDA REAL (${fecha(research.searchedAt)}; consultas: ${research.queries.map((q) => `«${q}»`).join(", ")}):`,
    list,
    "Usa SOLO estas fuentes como HECHOS y cítalas por su número [1], [2]…; lo que no esté aquí es INFERENCIA o HIPÓTESIS. Que no aparezca algo en estas búsquedas no significa que no exista: dilo así.",
  ].join("\n\n");
}

const PENDIENTE = "_Pendiente: WILLY lo completa durante el análisis y la construcción._";

/** Primer «Dossier de innovación» (docs/innovacion.md): documento vivo con fuentes y fechas. */
export function dossierMarkdown(brief: ProjectBrief, research: Research): string {
  const created = fecha(brief.createdAt || research.searchedAt);
  const investigated = !research.queries.length
    ? "_No había palabras suficientes en el problema para buscar: cuenta un poco más y vuelve a investigar._"
    : research.searched
      ? `Búsquedas reales en internet el ${fecha(research.searchedAt)}: ${research.queries.map((q) => `\`${q}\``).join(", ")}.${research.failed.length ? ` Sin respuesta: ${research.failed.map((q) => `\`${q}\``).join(", ")}.` : ""}`
      : "No se pudo buscar en internet en este momento (sin conexión o búsqueda no disponible). **Todo lo que se diga sobre lo que ya existe es hipótesis** hasta que se busque.";
  const sources = research.sources.length
    ? ["| # | Fuente | Dirección | Consultada | Búsqueda |", "|---|---|---|---|---|", ...research.sources.map((s, i) => `| ${i + 1} | ${s.title.replace(/\|/g, "/")} | ${s.url} | ${fecha(s.foundAt)} | ${s.query} |`)].join("\n")
    : "_Ninguna todavía._";
  const found = research.sources.length
    ? ["| # | Qué es | Clasificación |", "|---|---|---|", ...research.sources.map((s, i) => `| ${i + 1} | ${s.snippet.replace(/\|/g, "/").slice(0, 140) || s.title} | _por clasificar: ya existe · existe parcialmente · resuelve otra cosa · con limitaciones_ |`)].join("\n")
    : "_Nada encontrado todavía. Recuerda: «no encontrado en estas búsquedas» no significa «no existe»._";
  return [
    `# Dossier de innovación — ${brief.name}`,
    `> Documento vivo del **Proyecto innovador · I+D**. Creado el ${created}. WILLY lo va completando en cada fase (investigar → criticar → construir → medir → mejorar).`,
    "## 1. Problema", brief.userInput || PENDIENTE,
    "## 2. Objetivo", brief.goal || PENDIENTE,
    "## 3. Hipótesis", "_Pendiente: WILLY separa aquí lo que todavía son suposiciones de lo comprobado._",
    "## 4. Qué se ha investigado", investigated,
    "## 5. Fuentes", sources,
    "## 6. Productos o proyectos encontrados", found,
    ...["7. Qué hacen", "8. Limitaciones", "9. Huecos identificados", "10. Diferenciación propuesta", "11. Alternativas descartadas", "12. Motivos", "13. Arquitectura elegida", "14. Pruebas realizadas", "15. Resultados", "16. Mejoras introducidas", "17. Problemas todavía abiertos", "18. Próximos experimentos"].flatMap((t) => [`## ${t}`, PENDIENTE]),
    "---",
    "_Aviso: esto es investigación técnica y una búsqueda preliminar de lo que existe. No es un dictamen sobre novedad jurídica ni patentabilidad: para eso hace falta un profesional de la propiedad industrial._",
  ].join("\n\n") + "\n";
}

/** Búsqueda real a través del servidor de WILLY (la misma que usa el chat). */
export async function webSearch(query: string): Promise<WebHit[]> {
  const res = await fetch("/api/fetch-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ask: query }) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; results?: WebHit[] };
  if (!res.ok || data.error) throw new Error(data.error ?? `La búsqueda respondió ${res.status}.`);
  return data.results ?? [];
}
