export type JurisStanceTarget = "favor" | "contra" | "ambas" | "neutral";
export type JurisFreshness = "cualquiera" | "1y" | "3y" | "5y" | "10y";

export type JurisSearchFilters = {
  text: string;
  exactPhrase?: string;
  excludeTerms?: string;
  dateFrom?: string;
  dateTo?: string;
  court?: string;
  seat?: string;
  section?: string;
  resolutionType?: string;
  jurisdiction?: string;
  ecli?: string;
  roj?: string;
  caseNumber?: string;
  citedLaw?: string;
  citedArticle?: string;
  subject?: string;
  judge?: string;
  rapporteur?: string;
  courtClerk?: string;
  lawyer?: string;
  procurator?: string;
  stance?: JurisStanceTarget;
  freshness?: JurisFreshness;
};

export type OfficialSearchLauncher = {
  id: "cendoj" | "tc" | "hudoc" | "curia" | "teac";
  name: string;
  url: string;
  automatic: boolean;
  filters: string[];
  note: string;
};

const iso = (value?: string) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value! : "";

function clean(value?: string, max = 220): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizeJurisFilters(input: Partial<JurisSearchFilters>, now = new Date()): JurisSearchFilters {
  const freshness = input.freshness ?? "cualquiera";
  let dateFrom = iso(input.dateFrom);
  const dateTo = iso(input.dateTo);
  if (!dateFrom && freshness !== "cualquiera") {
    const years = Number(freshness.replace("y", ""));
    const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
    dateFrom = d.toISOString().slice(0, 10);
  }
  return {
    text: clean(input.text, 500),
    exactPhrase: clean(input.exactPhrase, 300),
    excludeTerms: clean(input.excludeTerms, 300),
    dateFrom,
    dateTo,
    court: clean(input.court, 120),
    seat: clean(input.seat, 120),
    section: clean(input.section, 80),
    resolutionType: clean(input.resolutionType, 80),
    jurisdiction: clean(input.jurisdiction, 120),
    ecli: clean(input.ecli, 120),
    roj: clean(input.roj, 120),
    caseNumber: clean(input.caseNumber, 120),
    citedLaw: clean(input.citedLaw, 220),
    citedArticle: clean(input.citedArticle, 120),
    subject: clean(input.subject, 160),
    judge: clean(input.judge, 160),
    rapporteur: clean(input.rapporteur, 160),
    courtClerk: clean(input.courtClerk, 160),
    lawyer: clean(input.lawyer, 160),
    procurator: clean(input.procurator, 160),
    stance: input.stance ?? "ambas",
    freshness,
  };
}

function summary(filters: JurisSearchFilters): string[] {
  return [
    filters.text && `Texto: ${filters.text}`,
    filters.exactPhrase && `Frase exacta: “${filters.exactPhrase}”`,
    filters.excludeTerms && `Excluir: ${filters.excludeTerms}`,
    filters.dateFrom && `Desde: ${filters.dateFrom}`,
    filters.dateTo && `Hasta: ${filters.dateTo}`,
    filters.court && `Órgano: ${filters.court}`,
    filters.seat && `Sede: ${filters.seat}`,
    filters.section && `Sección: ${filters.section}`,
    filters.resolutionType && `Tipo: ${filters.resolutionType}`,
    filters.jurisdiction && `Jurisdicción: ${filters.jurisdiction}`,
    filters.ecli && `ECLI: ${filters.ecli}`,
    filters.roj && `ROJ: ${filters.roj}`,
    filters.caseNumber && `Nº recurso/procedimiento: ${filters.caseNumber}`,
    filters.citedLaw && `Norma citada: ${filters.citedLaw}`,
    filters.citedArticle && `Precepto: ${filters.citedArticle}`,
    filters.subject && `Materia: ${filters.subject}`,
    filters.judge && `Juez/magistrado: ${filters.judge}`,
    filters.rapporteur && `Ponente: ${filters.rapporteur}`,
    filters.courtClerk && `Letrado/a AJ: ${filters.courtClerk}`,
    filters.lawyer && `Letrado/abogado: ${filters.lawyer}`,
    filters.procurator && `Procurador: ${filters.procurator}`,
    filters.stance && `Orientación buscada: ${filters.stance}`,
  ].filter(Boolean) as string[];
}

function freeText(filters: JurisSearchFilters): string {
  return [
    filters.text,
    filters.exactPhrase && `"${filters.exactPhrase}"`,
    filters.excludeTerms && filters.excludeTerms.split(/\s+/).map((x)=>`-${x}`).join(" "),
    filters.court,
    filters.seat,
    filters.section,
    filters.ecli,
    filters.roj,
    filters.caseNumber,
    filters.citedLaw,
    filters.citedArticle,
    filters.subject,
    filters.judge,
    filters.rapporteur,
    filters.courtClerk,
    filters.lawyer,
    filters.procurator,
  ].filter(Boolean).join(" ");
}

export function buildOfficialJurisprudenceSearches(input: Partial<JurisSearchFilters>, now = new Date()): OfficialSearchLauncher[] {
  const filters = normalizeJurisFilters(input, now);
  const q = encodeURIComponent(freeText(filters));
  const all = summary(filters);
  return [
    {
      id: "cendoj",
      name: "CENDOJ · Jurisprudencia española",
      url: q ? `https://www.poderjudicial.es/search/sentencias/${q}/1/PUB` : "https://www.poderjudicial.es/search/indexAN.jsp",
      automatic: false,
      filters: all,
      note: "Buscador oficial del CGPJ. Permite localizar por texto y metadatos de las resoluciones; juez/ponente, letrados y representantes se usan como términos documentales cuando constan en la resolución. Abrir y verificar la ficha/texto antes de clasificar a favor o en contra.",
    },
    {
      id: "tc",
      name: "Tribunal Constitucional",
      url: "https://hj.tribunalconstitucional.es/",
      automatic: false,
      filters: all.filter((x)=>!/ROJ|Procurador|Letrado\/abogado/.test(x)),
      note: "Buscador oficial de jurisprudencia constitucional con filtros propios como ECLI, órgano/proceso, magistrado, disposiciones citadas y análisis doctrinal.",
    },
    {
      id: "hudoc",
      name: "HUDOC · TEDH",
      url: "https://hudoc.echr.coe.int/",
      automatic: false,
      filters: all.filter((x)=>!/ROJ|Nº recurso|Procurador/.test(x)),
      note: "Base oficial del TEDH. Sus filtros permiten refinar por fecha, Estado, artículo CEDH, importancia, tipo de documento, juez/órgano y otros metadatos.",
    },
    {
      id: "curia",
      name: "InfoCuria · TJUE/TG",
      url: "https://juris.curia.europa.eu/juris/recherche.jsf?language=es",
      automatic: false,
      filters: all.filter((x)=>!/ROJ|Procurador|Letrado\/a AJ/.test(x)),
      note: "Buscador oficial del TJUE/TG. WILLY usa CELLAR/CELEX automáticamente cuando existe resultado recuperable y deja InfoCuria para filtros y comprobación avanzada.",
    },
    {
      id: "teac",
      name: "TEAC · DYCTEA",
      url: "https://serviciostelematicosext.hacienda.gob.es/TEAC/DYCTEA/",
      automatic: false,
      filters: all.filter((x)=>!/ECLI|ROJ|Procurador|Ponente/.test(x)),
      note: "Doctrina económico-administrativa oficial. Permite búsquedas por norma, precepto, concepto y texto; no debe etiquetarse como jurisprudencia judicial.",
    },
  ];
}

export function jurisprudenceResearchPrompt(filters: JurisSearchFilters, caseContext: string): string {
  const f = normalizeJurisFilters(filters);
  return [
    "Realiza una investigación jurisprudencial avanzada y ACTUALIZADA.",
    "No inventes ninguna resolución ni dato identificador.",
    "Prioriza por jerarquía: Tribunal Supremo / TC / TJUE / TEDH según materia; después TSJ y Audiencias.",
    "Para Andalucía prioriza expresamente TSJ de Andalucía y, si la sede relevante es Granada, TSJ de Andalucía con sede en Granada y Audiencia Provincial de Granada.",
    "Clasifica una resolución como A FAVOR, EN CONTRA, MIXTA o NEUTRA solo después de disponer de texto verificable suficiente. Si solo hay metadatos/enlace, marca PENDIENTE DE LECTURA.",
    "Explica similitud fáctica, norma aplicada, ratio decidendi, diferencias y vigencia/actualidad.",
    "No infieras una tendencia por el nombre de un juez, magistrado, ponente o letrado; esos campos sirven para localizar y agrupar resoluciones, no para sustituir el razonamiento jurídico.",
    "",
    "FILTROS:",
    ...summary(f).map((x)=>"- "+x),
    "",
    "CONTEXTO DEL CASO:",
    caseContext || "Sin contexto adicional.",
  ].join("\n");
}
