export type PrecedentStance = "favor" | "contra" | "mixta" | "neutral" | "pendiente";

export type AssessedPrecedent = {
  stance: PrecedentStance;
  relevance: number;
  organ: string;
  date: string;
  verification: "metadatos-oficiales" | "texto-oficial";
};

export type JurisprudenceForecast = {
  ok: boolean;
  percent: number | null;
  range: [number, number] | null;
  confidence: "alta" | "media" | "baja" | "insuficiente";
  sample: number;
  favorableWeight: number;
  contraryWeight: number;
  mixedWeight: number;
  explanation: string;
};

function yearOf(date: string): number {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (iso) return Number(iso[1]);
  const es = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  return es ? Number(es[3]) : 0;
}

function hierarchyWeight(organ: string): number {
  const value = organ.toLowerCase();
  if (value.includes("tribunal supremo")) return 1.55;
  if (value.includes("tribunal constitucional")) return 1.55;
  if (value.includes("tribunal de justicia") || value.includes("tjue")) return 1.5;
  if (value.includes("tribunal superior de justicia")) return 1.3;
  if (value.includes("audiencia nacional")) return 1.25;
  if (value.includes("audiencia provincial")) return 1.08;
  return 0.9;
}

function recencyWeight(date: string, currentYear: number): number {
  const year = yearOf(date);
  if (!year) return 0.9;
  const age = Math.max(0, currentYear - year);
  if (age <= 2) return 1.22;
  if (age <= 5) return 1.1;
  if (age <= 10) return 1;
  return 0.85;
}

export function precedentWeight(item: AssessedPrecedent, currentYear = new Date().getFullYear()): number {
  const relevance = Math.max(0, Math.min(100, Number(item.relevance) || 0));
  const relevanceWeight = 0.45 + relevance / 100;
  const verificationWeight = item.verification === "texto-oficial" ? 1.15 : 0.85;
  return hierarchyWeight(item.organ) * recencyWeight(item.date, currentYear) * relevanceWeight * verificationWeight;
}

export function forecastFromPrecedents(items: AssessedPrecedent[], currentYear = new Date().getFullYear()): JurisprudenceForecast {
  const comparable = items.filter((item) =>
    item.relevance >= 55 &&
    (item.stance === "favor" || item.stance === "contra" || item.stance === "mixta"),
  );

  let favorableWeight = 0;
  let contraryWeight = 0;
  let mixedWeight = 0;
  let verifiedTexts = 0;
  let highCourt = 0;

  for (const item of comparable) {
    const weight = precedentWeight(item, currentYear);
    if (item.stance === "favor") favorableWeight += weight;
    if (item.stance === "contra") contraryWeight += weight;
    if (item.stance === "mixta") mixedWeight += weight;
    if (item.verification === "texto-oficial") verifiedTexts += 1;
    if (/tribunal supremo|tribunal constitucional|tribunal superior de justicia|audiencia nacional|tribunal de justicia|tjue/i.test(item.organ)) highCourt += 1;
  }

  const sample = comparable.length;
  if (sample < 5) {
    return {
      ok: false,
      percent: null,
      range: null,
      confidence: "insuficiente",
      sample,
      favorableWeight,
      contraryWeight,
      mixedWeight,
      explanation: "Muestra insuficiente: se requieren al menos 5 precedentes comparables con relevancia mínima del 55 %. Willy no fabrica un porcentaje cuando la base jurisprudencial es pobre.",
    };
  }

  const positive = favorableWeight + mixedWeight * 0.5;
  const negative = contraryWeight + mixedWeight * 0.5;
  const total = positive + negative;
  if (total <= 0) {
    return {
      ok: false,
      percent: null,
      range: null,
      confidence: "insuficiente",
      sample,
      favorableWeight,
      contraryWeight,
      mixedWeight,
      explanation: "No hay peso jurisprudencial suficiente para estimar una tendencia.",
    };
  }

  const raw = Math.round((positive / total) * 100);
  const percent = Math.max(5, Math.min(95, raw));
  let confidence: "alta" | "media" | "baja" = "baja";
  if (sample >= 12 && verifiedTexts >= 4 && highCourt >= 4) confidence = "alta";
  else if (sample >= 7 && (verifiedTexts >= 2 || highCourt >= 3)) confidence = "media";

  const margin = confidence === "alta" ? 8 : confidence === "media" ? 12 : 18;
  const range: [number, number] = [Math.max(0, percent - margin), Math.min(100, percent + margin)];

  return {
    ok: true,
    percent,
    range,
    confidence,
    sample,
    favorableWeight,
    contraryWeight,
    mixedWeight,
    explanation: "Estimación jurisprudencial orientativa, no garantía de resultado: pondera similitud declarada, jerarquía del órgano, actualidad y si Willy pudo leer texto oficial o solo metadatos.",
  };
}
