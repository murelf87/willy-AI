import { extractConcreteLegalReferences } from "@/lib/juridico-verification";

export type PrognosisBasis = {
  verifiedReferences: number;
  canShowPercentage: boolean;
  confidence: "baja" | "media" | "alta";
  reason: string;
};

export function prognosisBasis(verifiedCorpus: string): PrognosisBasis {
  const refs = extractConcreteLegalReferences(verifiedCorpus);
  const unique = new Set(refs.map((x)=>x.toUpperCase())).size;
  if (unique >= 10) return { verifiedReferences: unique, canShowPercentage: true, confidence: "alta", reason: "10 o más resoluciones/identificadores concretos verificados." };
  if (unique >= 5) return { verifiedReferences: unique, canShowPercentage: true, confidence: "media", reason: "5 o más resoluciones/identificadores concretos verificados." };
  return { verifiedReferences: unique, canShowPercentage: false, confidence: "baja", reason: "Menos de 5 resoluciones concretas verificadas; un porcentaje sería falsa precisión." };
}

export function prognosisPrompt(caseContext: string, jurisprudencePrompt: string, verifiedCorpus: string): string {
  const basis = prognosisBasis(verifiedCorpus);
  return [
    "PRONÓSTICO JURÍDICO DEL CASO.",
    "Lee la demanda/escrito principal y todo el expediente antes de pronosticar.",
    "Usa SOLO jurisprudencia y autoridades verificadas del corpus. No conviertas enlaces o metadatos en sentencias leídas.",
    "Separa: fortaleza jurídica, fortaleza probatoria, riesgos procesales, tendencia jurisprudencial, precedentes favorables, precedentes contrarios y hechos distinguibles.",
    "Da especial peso, cuando la materia/territorio lo hagan pertinente, al Tribunal Supremo y al TSJ de Andalucía con sede en Granada; añade Audiencia Provincial de Granada cuando corresponda, sin desplazar fuentes de mayor jerarquía.",
    "No uses el nombre de juez, magistrado, ponente o letrado para inferir sesgo o resultado. Solo puede servir para localizar/ordenar resoluciones.",
    "Base verificada detectada: " + basis.verifiedReferences + " referencia(s) concreta(s). Confianza máxima permitida: " + basis.confidence + ".",
    basis.canShowPercentage
      ? "Puedes dar una estimación porcentual orientativa, preferentemente como rango (ej. 55–65 %) y un punto central, explicando la metodología y sensibilidad. No la presentes como certeza."
      : "PROHIBIDO dar un porcentaje numérico de éxito. Debes escribir: BASE INSUFICIENTE PARA PORCENTAJE FIABLE, y ofrecer solo tendencia cualitativa y qué jurisprudencia falta.",
    "",
    "FORMATO:",
    "1. Resultado estimado",
    "2. Base jurisprudencial verificada",
    "3. Precedentes a favor",
    "4. Precedentes en contra",
    "5. Similitudes y diferencias fácticas",
    "6. Riesgos procesales y probatorios",
    "7. Factores que subirían o bajarían la estimación",
    "8. Confianza del pronóstico",
    "",
    jurisprudencePrompt,
    "",
    "CONTEXTO DEL CASO:",
    caseContext,
  ].join("\n");
}

export function auditPrognosisAnswer(answer: string, verifiedCorpus: string): { ok: boolean; error: string } {
  const basis = prognosisBasis(verifiedCorpus);
  const hasPercentage = /\b\d{1,3}(?:[.,]\d+)?\s*%/.test(answer);
  if (hasPercentage && !basis.canShowPercentage) {
    return { ok: false, error: "La respuesta intentó dar porcentaje con solo " + basis.verifiedReferences + " referencias verificadas." };
  }
  return { ok: true, error: "" };
}
