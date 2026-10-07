import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL("../src/" + specifier.slice(2) + ".ts", import.meta.url).href, context);
  return next(specifier, context);
}});

const { buildOfficialJurisprudenceSearches, normalizeJurisFilters, jurisprudenceResearchPrompt } = await import("../src/lib/jurisprudencia-search.ts");
const { prognosisBasis, auditPrognosisAnswer } = await import("../src/lib/juridico-prognosis.ts");
const { parseCendojResults, getCendojDocumentText } = await import("../src/lib/jurisprudencia-cendoj.ts");

test("filtros avanzados conservan juez, ponente, letrado, abogado y procurador", () => {
  const filters = normalizeJurisFilters({
    text: "despido",
    court: "TSJ Andalucía",
    seat: "Granada",
    judge: "Juez Uno",
    rapporteur: "Ponente Dos",
    courtClerk: "LAJ Tres",
    lawyer: "Abogada Cuatro",
    procurator: "Procurador Cinco",
    freshness: "5y",
  }, new Date("2026-10-07T00:00:00Z"));
  assert.equal(filters.seat, "Granada");
  assert.equal(filters.rapporteur, "Ponente Dos");
  assert.equal(filters.lawyer, "Abogada Cuatro");
  assert.equal(filters.dateFrom, "2021-10-07");
});

test("CENDOJ launcher incorpora filtros personales y sede Granada", () => {
  const [cendoj] = buildOfficialJurisprudenceSearches({
    text: "garantía de indemnidad",
    court: "Tribunal Superior de Justicia de Andalucía",
    seat: "Granada",
    judge: "Magistrada Ejemplo",
    lawyer: "Letrado Ejemplo",
  });
  assert.equal(cendoj.id, "cendoj");
  assert.ok(cendoj.filters.some((x) => x.includes("Granada")));
  assert.ok(cendoj.filters.some((x) => x.includes("Juez/magistrado")));
  assert.ok(cendoj.filters.some((x) => x.includes("Letrado/abogado")));
});

test("prompt de investigación prioriza TSJ Andalucía sede Granada sin inferir sesgo por persona", () => {
  const prompt = jurisprudenceResearchPrompt({ text: "urbanismo", court: "TSJ Andalucía", seat: "Granada" }, "Caso");
  assert.match(prompt, /TSJ de Andalucía con sede en Granada/i);
  assert.match(prompt, /No infieras una tendencia por el nombre/i);
});

function corpus(count) {
  return Array.from({ length: count }, (_, i) =>
    "[FUENTE VERIFICADA][TEXTO OFICIAL RECUPERADO] Sentencia " + (i + 1) +
    "\nECLI:ES:TSJAND:202" + (i % 6) + ":" + (100 + i) +
    "\nTexto oficial distinto " + i
  ).join("\n\n");
}

test("pronóstico bloquea porcentaje con menos de cinco sentencias oficiales distintas", () => {
  const basis = prognosisBasis(corpus(4));
  assert.equal(basis.canShowPercentage, false);
  const audit = auditPrognosisAnswer("Probabilidad estimada 70 %.", corpus(4));
  assert.equal(audit.ok, false);
});

test("pronóstico permite porcentaje desde cinco sentencias oficiales distintas", () => {
  const basis = prognosisBasis(corpus(5));
  assert.equal(basis.canShowPercentage, true);
  const audit = auditPrognosisAnswer("Rango orientativo 55–65 %.", corpus(5));
  assert.equal(audit.ok, true);
});


test("parser CENDOJ extrae ROJ, ECLI, ponente, recurso, fecha y órgano", () => {
  const html = `
  <div class="title">
    <a data-reference="11861741" data-roj="STS 3706/2026" href="/search/documento/AN/11861741/contratacion/20260924">
      ROJ: <strong>STS 3706/2026</strong> - <strong>ECLI:ES:TS:2026:3706</strong>
    </a>
  </div>
  <div class="metadatos"><ul>
    <li>Tipo Órgano: <b>Tribunal Supremo. Sala de lo Civil</b></li>
    <li>Municipio: <b>Madrid</b></li>
    <li>Ponente: <b>RAFAEL SARAZA JIMENA</b></li>
    <li>Nº Recurso: <b>6484/2023</b></li>
    <li>Fecha: <b>16/09/2026</b></li>
    <li>Tipo Resolución: <b>Sentencia</b></li>
  </ul></div>
  <div class="summary" id="jur-summary-0">Resumen: <b>La sala estima el recurso.</b></div>
  `;
  const [item] = parseCendojResults(html);
  assert.equal(item.roj, "STS 3706/2026");
  assert.equal(item.ecli, "ECLI:ES:TS:2026:3706");
  assert.equal(item.ponente, "RAFAEL SARAZA JIMENA");
  assert.equal(item.resourceNumber, "6484/2023");
  assert.equal(item.date, "16/09/2026");
  assert.match(item.organ, /Tribunal Supremo/);
  assert.match(item.url, /poderjudicial\.es\/search\/documento/);
});

test("lector CENDOJ rechaza URLs externas antes de acceder a red", async () => {
  await assert.rejects(() => getCendojDocumentText("https://example.com/search/documento/AN/1/x/1"), /Solo se permiten documentos oficiales CENDOJ/);
});
