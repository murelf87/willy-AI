import assert from "node:assert/strict";
import test from "node:test";

const { auditLegalAnswer, extractConcreteLegalReferences } = await import("../src/lib/juridico-verification.ts");
const { buildLegalProtocol, recommendedLegalSourceIds } = await import("../src/lib/juridico-quality.ts");

test("detecta ECLI, ROJ y citas de sentencias concretas", () => {
  const refs = extractConcreteLegalReferences("STS 123/2024, ECLI:ES:TS:2024:123 y ROJ STS 456/2024.");
  assert.ok(refs.some((x) => /STS 123\/2024/i.test(x)));
  assert.ok(refs.some((x) => /ECLI:ES:TS:2024:123/i.test(x)));
  assert.ok(refs.some((x) => /ROJ STS 456\/2024/i.test(x)));
});

test("bloquea una sentencia concreta que no existe en el corpus verificado", () => {
  const audit = auditLegalAnswer("La STS 999/2026 confirma nuestra tesis.", "Texto oficial BOE sin esa sentencia.");
  assert.equal(audit.ok, false);
  assert.ok(audit.unverified.length > 0);
});

test("permite una referencia concreta solo cuando aparece en corpus verificado", () => {
  const corpus = "TEXTO OFICIAL RECUPERADO\nECLI:ES:TS:2024:123\nContenido...";
  const audit = auditLegalAnswer("Puede citarse ECLI:ES:TS:2024:123.", corpus);
  assert.equal(audit.ok, true);
});

test("bloquea atribuciones jurisprudenciales genéricas sin respaldo concreto", () => {
  const audit = auditLegalAnswer("El Tribunal Supremo ha establecido de forma reiterada que procede la indemnización.", "");
  assert.equal(audit.ok, false);
  assert.ok(audit.unverifiedAttributions.length > 0);
});

test("permite marcar expresamente una atribución como pendiente de verificación", () => {
  const audit = auditLegalAnswer("PENDIENTE DE VERIFICACIÓN: el Tribunal Supremo ha establecido este criterio.", "");
  assert.equal(audit.ok, true);
});

test("protocolo jurídico exige verificación, tesis contraria y plazos", () => {
  const protocol = buildLegalProtocol({ area: "Fiscal/Tributario", jurisdiccion: "España", deadline: "2026-10-20" });
  assert.match(protocol, /No inventes sentencias/i);
  assert.match(protocol, /mejor autoridad contraria/i);
  assert.match(protocol, /dies a quo/i);
  assert.match(protocol, /TEAC|dgt/i);
});

test("recomendación de fuentes se adapta por materia", () => {
  const fiscal = recommendedLegalSourceIds("Fiscal/Tributario", "España");
  assert.ok(fiscal.includes("teac"));
  assert.ok(fiscal.includes("dgt"));
  const datos = recommendedLegalSourceIds("Protección de datos", "Unión Europea");
  assert.ok(datos.includes("aepd"));
  assert.ok(datos.includes("edpb"));
});
