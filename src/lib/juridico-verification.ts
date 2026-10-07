export type LegalReferenceAudit = {
  ok: boolean;
  references: string[];
  unverified: string[];
  unverifiedAttributions: string[];
};

function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, " ")
    .toUpperCase()
    .trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const key = norm(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/**
 * Detecta referencias jurídicas concretas con alto riesgo de alucinación.
 * No intenta "adivinar" si una sentencia existe: exige que la referencia aparezca
 * también en el corpus oficial/verificado que acompaña al expediente.
 */
export function extractConcreteLegalReferences(text: string): string[] {
  const patterns: RegExp[] = [
    /\bECLI:[A-Z]{2}:[A-Z0-9.:-]{5,80}\b/gi,
    /\bROJ\s*[:.-]?\s*[A-Z]{1,8}\s*\d{1,7}\s*\/\s*\d{4}\b/gi,
    /\b(?:STS|ATS|STC|ATC|SAN|AN|STSJ|TSJ|SAP|AAP|SJCA|SJS|SJM)\s*(?:DE\s+[A-ZÁÉÍÓÚÜÑ ]+\s*)?(?:N[ÚU]M\.?\s*)?\d{1,5}\s*\/\s*\d{2,4}\b/giu,
    /\b(?:SENTENCIA|AUTO)\s+(?:DEL?|DE LA)\s+(?:TRIBUNAL SUPREMO|TRIBUNAL CONSTITUCIONAL|AUDIENCIA NACIONAL|TRIBUNAL SUPERIOR DE JUSTICIA|AUDIENCIA PROVINCIAL)[^\n.;]{0,100}?\b\d{1,5}\s*\/\s*\d{2,4}\b/giu,
    /\b(?:RECURSO|RCUD|CASACI[ÓO]N|AMPARO)\s*(?:N[ÚU]M(?:ERO)?\.?\s*)?\d{1,7}\s*\/\s*\d{2,4}\b/giu,
    /\bCELEX\s*[:.-]?\s*[0-9A-Z()_-]{5,40}\b/gi,
    /\bBOE-[A-Z]-\d{4}-\d+\b/gi,
  ];
  const refs: string[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) refs.push(match[0]);
  }
  return unique(refs);
}

function extractJudicialAttributions(text: string): string[] {
  const court = /\b(?:TRIBUNAL SUPREMO|TRIBUNAL CONSTITUCIONAL|TJUE|TRIBUNAL DE JUSTICIA|TEDH|TRIBUNAL EUROPEO DE DERECHOS HUMANOS|AUDIENCIA NACIONAL|TRIBUNAL SUPERIOR DE JUSTICIA|AUDIENCIA PROVINCIAL)\b/i;
  const attribution = /\b(?:HA\s+(?:DECLARADO|ESTABLECIDO|SEÑALADO|AFIRMADO|CONSIDERADO|RESUELTO)|VIENE\s+(?:DECLARANDO|SOSTENIENDO)|DOCTRINA|JURISPRUDENCIA|CRITERIO\s+(?:CONSOLIDADO|REITERADO))\b/i;
  return unique(
    text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && court.test(line) && attribution.test(line) && !/PENDIENTE DE VERIFICACI[ÓO]N/i.test(line)),
  );
}

export function auditLegalAnswer(answer: string, verifiedCorpus: string): LegalReferenceAudit {
  const references = extractConcreteLegalReferences(answer);
  const trusted = norm(verifiedCorpus);
  const unverified = references.filter((reference) => !trusted.includes(norm(reference)));
  const attributionLines = extractJudicialAttributions(answer);
  const unverifiedAttributions = attributionLines.filter((line) => {
    const refs = extractConcreteLegalReferences(line);
    return refs.length === 0 || refs.some((ref) => !trusted.includes(norm(ref)));
  });
  return {
    ok: unverified.length === 0 && unverifiedAttributions.length === 0,
    references,
    unverified,
    unverifiedAttributions,
  };
}

export function legalCorrectionPrompt(unverified: string[], verifiedCorpus: string, unverifiedAttributions: string[] = []): string {
  const allowed = extractConcreteLegalReferences(verifiedCorpus);
  return [
    "CONTROL DE CALIDAD JURÍDICO: tu borrador anterior ha sido RECHAZADO porque contenía referencias concretas no verificadas.",
    "Referencias prohibidas/no verificadas:",
    ...(unverified.length ? unverified.map((ref) => "- " + ref) : ["- Ninguna referencia identificada"]),
    "",
    "Atribuciones jurisprudenciales no verificadas:",
    ...(unverifiedAttributions.length ? unverifiedAttributions.map((line) => "- " + line.slice(0, 300)) : ["- Ninguna"]),
    "",
    "Reescribe la respuesta completa.",
    "No repitas ninguna de las referencias anteriores.",
    "Solo puedes dar como concreta una sentencia/ECLI/ROJ/CELEX/BOE si aparece en la lista verificada de abajo.",
    "Si necesitas jurisprudencia que no esté verificada, describe la línea jurídica de forma genérica y escribe literalmente PENDIENTE DE VERIFICACIÓN, sin inventar número, ECLI, ROJ, fecha, recurso ni ponente.",
    "No inventes tampoco una cita textual de una resolución que no esté en el corpus.",
    "",
    "IDENTIFICADORES CONCRETOS PERMITIDOS:",
    ...(allowed.length ? allowed.map((ref) => "- " + ref) : ["- Ninguno"]),
  ].join("\n");
}
