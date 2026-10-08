import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

export type HcvArtifactKind = "aportado" | "original-hcv" | "informe-hcv" | "metadatos-hcv" | "eni-hcv";

export type HcvCsvCandidate = {
  value: string;
  confidence: "alta" | "media";
  reason: string;
};

export type HcvForensicFinding = {
  level: "positive" | "info" | "warning" | "critical";
  code: string;
  title: string;
  detail: string;
  evidence: string[];
};

export type HcvForensicArtifact = {
  id: string;
  kind: HcvArtifactKind;
  name: string;
  size: number;
  mimeDeclared: string;
  sha256Stored: string;
  sha256Recalculated: string;
  sha256Verified: boolean;
  uploadedAt: string;
  extension: string;
  detectedType: string;
  extensionMatches: boolean | null;
  magicHex: string;
  extractedTextChars: number;
  csvCandidates: HcvCsvCandidate[];
  verificationUrls: string[];
  hcvSignal: "positive" | "negative" | "unknown";
  pdf?: {
    version: string;
    producer: string;
    creator: string;
    author: string;
    title: string;
    creationDate: string;
    modificationDate: string;
    encrypted: boolean;
    eofMarkers: number;
    startXrefMarkers: number;
    pageMarkers: number;
  };
};

export type HcvForensicReport = {
  id: string;
  generatedAt: string;
  caseId: string;
  csv: string;
  officialResult: string;
  officialResultSource: string | null;
  conclusion: {
    classification: string;
    confidence: "alta" | "media" | "baja";
    summary: string;
  };
  comparison: Record<string, unknown> | null;
  artifacts: HcvForensicArtifact[];
  findings: HcvForensicFinding[];
  limitations: string[];
  methodology: string[];
  reproducibility: {
    hashAlgorithm: "SHA-256";
    tool: "WILLY AI · Verificador CSV / Informe forense";
    generatedBy: "análisis determinista local";
  };
};

export type HcvArtifact = {
  id: string;
  kind: HcvArtifactKind;
  name: string;
  size: number;
  mime: string;
  sha256: string;
  uploadedAt: string;
  csvCandidates: HcvCsvCandidate[];
  verificationUrls: string[];
  hcvSignal: "positive" | "negative" | "unknown";
};

const HCV_PORTAL = "https://ws050.juntadeandalucia.es/verificarFirma/";
const HCV_INFO = "https://www.juntadeandalucia.es/servicios/tramites/servicios-digitales/verificacion-documentos.html";
const HCV_DEV = "https://desarrollo.juntadeandalucia.es/recursos/activo/hcv";

function rootDir(): string {
  return path.join(process.env["WILLY_ROOT"] ?? process.cwd(), "datos-privados", "juridico", "hcv");
}

function safeCaseId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error("Identificador de expediente no válido.");
  return id;
}

function safeName(value: string): string {
  const base = path.basename(value || "documento.bin").replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_").trim();
  return (base || "documento.bin").slice(0, 180);
}

function artifactDir(caseId: string): string {
  return path.join(rootDir(), safeCaseId(caseId));
}

function indexFile(caseId: string): string {
  return path.join(artifactDir(caseId), "index.json");
}

type StoredArtifact = HcvArtifact & { diskName: string; textName?: string };

async function readIndex(caseId: string): Promise<StoredArtifact[]> {
  try {
    const raw = await fs.readFile(indexFile(caseId), "utf8");
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? data as StoredArtifact[] : [];
  } catch {
    return [];
  }
}

async function writeIndex(caseId: string, items: StoredArtifact[]): Promise<void> {
  const dir = artifactDir(caseId);
  await fs.mkdir(dir, { recursive: true });
  const file = indexFile(caseId);
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
}

function cleanCsvCandidate(raw: string): string {
  return raw.trim().replace(/^[\s"'([{<]+|[\s"',;.)\]}>]+$/g, "");
}

export function detectHcvCsv(text: string): HcvCsvCandidate[] {
  const normalized = text.replace(/\r/g, "\n");
  const found = new Map<string, HcvCsvCandidate>();
  const labeled = [
    /(?:C[oó]digo\s+Seguro\s+de\s+Verificaci[oó]n|C[oó]digo\s+de\s+Verificaci[oó]n|CSV|VERIFICACI[ÓO]N)\s*[:#\-]?\s*([A-Za-z0-9._~+\/-]{16,120})/giu,
    /(?:verificarFirma\/[^\s]*?)([A-Za-z0-9._~+\/-]{20,100})/giu,
  ];
  for (const rx of labeled) {
    for (const match of normalized.matchAll(rx)) {
      const value = cleanCsvCandidate(match[1] ?? "");
      if (!value || /^https?:/i.test(value) || value.length > 120) continue;
      found.set(value, { value, confidence: "alta", reason: "Aparece junto a una etiqueta CSV/verificación del documento." });
    }
  }

  const hasHcv = /ws050\.juntadeandalucia\.es\/verificarFirma|Herramienta\s+Centralizada\s+de\s+Verificaci[oó]n|Junta\s+de\s+Andaluc[ií]a/iu.test(normalized);
  if (hasHcv) {
    const generic = normalized.match(/\b[A-Za-z0-9][A-Za-z0-9._~-]{23,63}\b/g) ?? [];
    for (const raw of generic) {
      const value = cleanCsvCandidate(raw);
      if (/^[a-f0-9]{40,64}$/i.test(value)) continue;
      if (/^BOE-|^ECLI/i.test(value)) continue;
      if (!found.has(value)) found.set(value, { value, confidence: "media", reason: "Código compatible encontrado en un documento que referencia HCV/Junta de Andalucía." });
    }
  }
  return [...found.values()].slice(0, 12);
}

export function detectHcvUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const urls = new Set<string>();
  for (const raw of matches) {
    const clean = raw.replace(/[.,;:]+$/g, "");
    try {
      const url = new URL(clean);
      if (/juntadeandalucia\.es$/i.test(url.hostname) || /\.juntadeandalucia\.es$/i.test(url.hostname)) {
        if (/verificarfirma|verificacion|csv/i.test(url.pathname + url.search)) urls.add(url.toString());
      }
    } catch { /* URL no válida */ }
  }
  return [...urls].slice(0, 10);
}

function detectHcvSignal(text: string): "positive" | "negative" | "unknown" {
  const n = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/validacion\s+(positiva|correcta)|resultado\s+(positivo|correcto)|documento\s+(valido|autentico)|firma\s+valida/.test(n)) return "positive";
  if (/validacion\s+(negativa|incorrecta)|resultado\s+(negativo|incorrecto)|documento\s+(no\s+valido|no\s+autentico)|firma\s+no\s+valida/.test(n)) return "negative";
  return "unknown";
}

export async function storeHcvArtifact(args: {
  caseId: string;
  kind: HcvArtifactKind;
  name: string;
  mime: string;
  bytes: Uint8Array;
  extractedText?: string;
}): Promise<HcvArtifact> {
  if (args.bytes.byteLength === 0) throw new Error("El archivo está vacío.");
  if (args.bytes.byteLength > 30 * 1024 * 1024) throw new Error("El archivo supera 30 MB.");
  const caseId = safeCaseId(args.caseId);
  const id = crypto.randomUUID();
  const name = safeName(args.name);
  const ext = path.extname(name).slice(0, 12);
  const diskName = id + (ext || ".bin");
  const dir = artifactDir(caseId);
  await fs.mkdir(dir, { recursive: true });
  const diskPath = path.join(dir, diskName);
  await fs.writeFile(diskPath, args.bytes, { mode: 0o600 });
  // La huella probatoria se calcula SIEMPRE sobre los bytes ya persistidos, no sobre el buffer de entrada.
  // Así la huella guardada representa exactamente el archivo que WILLY conserva y descargará después.
  const persistedBytes = await fs.readFile(diskPath);
  const persistedSha256 = crypto.createHash("sha256").update(persistedBytes).digest("hex");
  const text = String(args.extractedText ?? "").slice(0, 500_000);
  const textName = text ? id + ".extracted.txt" : undefined;
  if (textName) await fs.writeFile(path.join(dir, textName), text, { encoding: "utf8", mode: 0o600 });
  const item: StoredArtifact = {
    id,
    kind: args.kind,
    name,
    size: persistedBytes.byteLength,
    mime: args.mime || "application/octet-stream",
    sha256: persistedSha256,
    uploadedAt: new Date().toISOString(),
    csvCandidates: detectHcvCsv(text),
    verificationUrls: detectHcvUrls(text),
    hcvSignal: args.kind === "informe-hcv" ? detectHcvSignal(text) : "unknown",
    diskName,
    ...(textName ? { textName } : {}),
  };
  const current = await readIndex(caseId);
  await writeIndex(caseId, [...current.filter((x) => x.id !== id), item]);
  const { diskName: _disk, textName: _text, ...publicItem } = item;
  return publicItem;
}

async function findArtifact(caseId: string, artifactId: string): Promise<StoredArtifact> {
  const item = (await readIndex(caseId)).find((x) => x.id === artifactId);
  if (!item) throw new Error("Archivo HCV no encontrado.");
  return item;
}

async function artifactText(caseId: string, item: StoredArtifact): Promise<string> {
  if (!item.textName) return "";
  try { return await fs.readFile(path.join(artifactDir(caseId), item.textName), "utf8"); } catch { return ""; }
}

function tokenSet(text: string): Set<string> {
  const tokens = text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .split(/\s+/).filter((x) => x.length > 2);
  return new Set(tokens.slice(0, 50_000));
}

function jaccard(a: string, b: string): number | null {
  const aa = tokenSet(a), bb = tokenSet(b);
  if (!aa.size || !bb.size) return null;
  let common = 0;
  for (const t of aa) if (bb.has(t)) common += 1;
  return Math.round((common / (aa.size + bb.size - common)) * 1000) / 10;
}

export async function compareHcvArtifacts(caseId: string, sourceId: string, officialId: string) {
  const source = await findArtifact(caseId, sourceId);
  const official = await findArtifact(caseId, officialId);
  const [sourceText, officialText] = await Promise.all([artifactText(caseId, source), artifactText(caseId, official)]);
  return {
    exactHash: source.sha256 === official.sha256,
    sourceSha256: source.sha256,
    officialSha256: official.sha256,
    textSimilarity: jaccard(sourceText, officialText),
    sourceName: source.name,
    officialName: official.name,
  };
}


function forensicEsc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m] ?? m));
}

function forensicMeta(raw: string, key: string): string {
  const rx = new RegExp("\\/" + key + "\\s*\\(([^)]{0,500})\\)", "i");
  return (raw.match(rx)?.[1] ?? "").trim();
}

async function inspectForensicArtifact(caseId: string, item: StoredArtifact): Promise<HcvForensicArtifact> {
  const dir = artifactDir(caseId);
  const bytes = await fs.readFile(path.join(dir, item.diskName));
  const text = await artifactText(caseId, item);
  const head = bytes.subarray(0, 32);
  const magicHex = Array.from(head).map((b) => b.toString(16).padStart(2, "0")).join(" ").toUpperCase();
  const asciiHead = bytes.subarray(0, 512).toString("latin1");
  let detectedType = "application/octet-stream";
  if (asciiHead.startsWith("%PDF-")) detectedType = "application/pdf";
  else if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b) detectedType = "application/zip";
  else if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) detectedType = "image/png";
  else if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) detectedType = "image/jpeg";
  else {
    const trimmed = asciiHead.trimStart().toLowerCase();
    if (trimmed.startsWith("<?xml") || /^<[^>]+>/.test(trimmed)) detectedType = "application/xml";
    else if (/^[\x09\x0a\x0d\x20-\x7e\xa0-\xff]*$/.test(asciiHead)) detectedType = "text/plain";
  }

  const extension = path.extname(item.name).toLowerCase();
  const expected = extension === ".pdf" ? "application/pdf"
    : [".zip",".docx",".xlsx",".pptx"].includes(extension) ? "application/zip"
    : [".xml",".xades"].includes(extension) ? "application/xml"
    : [".txt",".csv",".md",".html",".htm",".json"].includes(extension) ? "text/plain"
    : extension === ".png" ? "image/png"
    : [".jpg",".jpeg"].includes(extension) ? "image/jpeg"
    : "";
  const extensionMatches = expected ? (detectedType === expected || (expected === "text/plain" && ["text/plain","application/xml"].includes(detectedType))) : null;
  const recalculated = crypto.createHash("sha256").update(bytes).digest("hex");

  let pdf: HcvForensicArtifact["pdf"];
  if (detectedType === "application/pdf") {
    const raw = bytes.subarray(0, Math.min(bytes.length, 8 * 1024 * 1024)).toString("latin1");
    pdf = {
      version: raw.match(/^%PDF-([0-9.]+)/)?.[1] ?? "",
      producer: forensicMeta(raw, "Producer"),
      creator: forensicMeta(raw, "Creator"),
      author: forensicMeta(raw, "Author"),
      title: forensicMeta(raw, "Title"),
      creationDate: forensicMeta(raw, "CreationDate"),
      modificationDate: forensicMeta(raw, "ModDate"),
      encrypted: /\/Encrypt\b/.test(raw),
      eofMarkers: (raw.match(/%%EOF/g) ?? []).length,
      startXrefMarkers: (raw.match(/startxref/g) ?? []).length,
      pageMarkers: (raw.match(/\/Type\s*\/Page\b/g) ?? []).length,
    };
  }

  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    size: bytes.length,
    mimeDeclared: item.mime,
    sha256Stored: item.sha256,
    sha256Recalculated: recalculated,
    sha256Verified: recalculated === item.sha256,
    uploadedAt: item.uploadedAt,
    extension,
    detectedType,
    extensionMatches,
    magicHex,
    extractedTextChars: text.length,
    csvCandidates: item.csvCandidates,
    verificationUrls: item.verificationUrls,
    hcvSignal: item.hcvSignal,
    ...(pdf ? { pdf } : {}),
  };
}

function forensicConclusion(officialResult: string, comparison: Record<string, unknown> | null): HcvForensicReport["conclusion"] {
  const exact = comparison?.["exactHash"] === true;
  if (officialResult === "positive" && exact) return { classification:"validación HCV positiva e identidad binaria", confidence:"alta", summary:"Consta validación HCV positiva y el documento aportado coincide byte a byte con el original oficial incorporado." };
  if (officialResult === "positive") return { classification:"validación HCV positiva", confidence:"alta", summary:"Consta validación HCV positiva asociada al CSV, aunque no se ha acreditado identidad binaria con un original oficial incorporado." };
  if (officialResult === "negative") return { classification:"validación HCV negativa", confidence:"alta", summary:"El material incorporado registra una validación HCV negativa asociada al CSV analizado." };
  if (officialResult === "not-found") return { classification:"CSV no encontrado en repositorio configurado", confidence:"media", summary:"El repositorio ENIDOCWS configurado no encontró el CSV. El alcance queda limitado al repositorio concreto consultado." };
  if (officialResult === "exists") return { classification:"CSV existente; firma/integridad pendiente", confidence:"media", summary:"El repositorio ENIDOCWS confirma existencia del CSV, pero falta validación HCV de firma/integridad." };
  if (exact) return { classification:"identidad binaria con original incorporado; HCV pendiente", confidence:"media", summary:"El aportado y el original incorporado son idénticos byte a byte, pero falta una validación HCV positiva." };
  return { classification:"verificación oficial pendiente", confidence:"baja", summary:"Existe análisis técnico del archivo, pero todavía no hay evidencia suficiente para afirmar validación oficial positiva del CSV." };
}

function forensicHtml(report: HcvForensicReport): string {
  const rows = (pairs: Array<[string, unknown]>) => pairs.map(([k,v]) => "<tr><th>" + forensicEsc(k) + "</th><td>" + forensicEsc(v) + "</td></tr>").join("");
  const artifacts = report.artifacts.map((a, index) => {
    const pdf = a.pdf ? "<h4>Metadatos PDF</h4><table>" + rows([
      ["Versión PDF",a.pdf.version || "No determinada"],["Productor",a.pdf.producer || "No consta"],["Creador",a.pdf.creator || "No consta"],
      ["Autor",a.pdf.author || "No consta"],["Título",a.pdf.title || "No consta"],["Fecha creación",a.pdf.creationDate || "No consta"],
      ["Fecha modificación",a.pdf.modificationDate || "No consta"],["Cifrado",a.pdf.encrypted ? "Sí" : "No detectado"],
      ["Marcadores %%EOF",a.pdf.eofMarkers],["Marcadores startxref",a.pdf.startXrefMarkers],["Marcadores /Page",a.pdf.pageMarkers],
    ]) + "</table>" : "";
    return "<section><h3>" + (index + 1) + ". " + forensicEsc(a.name) + "</h3><table>" + rows([
      ["Clase de evidencia",a.kind],["Tamaño",a.size + " bytes"],["MIME declarado",a.mimeDeclared || "No consta"],["Tipo detectado",a.detectedType],
      ["Extensión",a.extension || "Sin extensión"],["Extensión/firma coherentes",a.extensionMatches == null ? "No evaluable" : a.extensionMatches ? "Sí" : "No"],
      ["SHA-256 almacenado",a.sha256Stored],["SHA-256 recalculado",a.sha256Recalculated],["Huella verificada",a.sha256Verified ? "Sí" : "NO"],
      ["Incorporado",a.uploadedAt],["Texto extraído",a.extractedTextChars + " caracteres"],["Magic bytes",a.magicHex],
    ]) + "</table><p><b>CSV candidatos:</b> " + forensicEsc(a.csvCandidates.map((x) => x.value + " (" + x.confidence + ")").join(", ") || "ninguno") + "</p>" + pdf + "</section>";
  }).join("");

  const findings = report.findings.map((f) => "<li class=\"" + forensicEsc(f.level) + "\"><b>" + forensicEsc(f.title) + "</b><br>" + forensicEsc(f.detail) + (f.evidence.length ? "<br><small>Evidencia: " + f.evidence.map(forensicEsc).join(" · ") + "</small>" : "") + "</li>").join("");
  return "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>Informe forense CSV</title><style>" +
    "body{font-family:Arial,Helvetica,sans-serif;color:#111827;padding:32px;line-height:1.45}main{max-width:980px;margin:auto}h1{font-size:26px;margin-bottom:6px}h2{margin-top:30px;border-bottom:1px solid #d1d5db;padding-bottom:6px}h3{margin-top:24px}table{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0 16px}th,td{border:1px solid #e5e7eb;padding:7px;text-align:left;vertical-align:top;word-break:break-word}th{width:230px;background:#f9fafb}.box{border:1px solid #9ca3af;border-radius:10px;padding:14px}.positive{color:#166534}.warning{color:#92400e}.critical{color:#991b1b}.info{color:#1e3a8a}.note{font-size:12px;color:#4b5563}.warn{margin-top:28px;border:1px solid #f59e0b;background:#fffbeb;padding:14px;border-radius:8px;font-size:12px}@media print{body{padding:0}}</style></head><body><main>" +
    "<h1>Informe técnico informático forense automatizado</h1><p class=\"note\">WILLY AI · Verificador CSV Junta de Andalucía · ID " + forensicEsc(report.id) + "</p>" +
    "<div class=\"box\"><b>Conclusión técnica:</b> " + forensicEsc(report.conclusion.classification) + "<br><b>Confianza:</b> " + forensicEsc(report.conclusion.confidence) + "<br>" + forensicEsc(report.conclusion.summary) + "</div>" +
    "<h2>1. Identificación y alcance</h2><table>" + rows([["Expediente",report.caseId],["Generado",report.generatedAt],["CSV",report.csv || "No consta"],["Resultado oficial registrado",report.officialResult],["Origen",report.officialResultSource || "No consta"],["Huella","SHA-256"]]) + "</table>" +
    "<p>El análisis documenta de forma reproducible los indicadores técnicos detectados en los archivos incorporados, su preservación criptográfica, estructura, metadatos disponibles, CSV/URLs encontrados y, cuando existe, la comparación con material oficial HCV/ENIDOCWS.</p>" +
    "<h2>2. Evidencias y cadena de custodia digital</h2>" + artifacts +
    "<h2>3. Comparación con original oficial</h2><pre>" + forensicEsc(report.comparison ? JSON.stringify(report.comparison,null,2) : "No existe comparación disponible.") + "</pre>" +
    "<h2>4. Hallazgos técnicos</h2><ol>" + (findings || "<li>No se registraron hallazgos adicionales.</li>") + "</ol>" +
    "<h2>5. Metodología</h2><ul>" + report.methodology.map((x) => "<li>" + forensicEsc(x) + "</li>").join("") + "</ul>" +
    "<h2>6. Limitaciones</h2><ul>" + report.limitations.map((x) => "<li>" + forensicEsc(x) + "</li>").join("") + "</ul>" +
    "<h2>7. Conclusión</h2><p>" + forensicEsc(report.conclusion.summary) + "</p>" +
    "<div class=\"warn\"><b>Alcance pericial:</b> este informe es un análisis técnico automatizado y reproducible. No sustituye una pericial firmada y ratificable cuando el procedimiento exija identificación profesional, examen de dispositivos originales o cadena de custodia formal. La verificación CSV/HCV se refiere a autenticidad/integridad en el alcance del sistema oficial consultado y no determina por sí sola la legalidad material del contenido.</div>" +
    "</main></body></html>";
}

export async function createHcvForensicReport(args: {
  caseId: string;
  artifactIds: string[];
  csv: string;
  officialResult: string;
  officialResultSource?: string | null;
  comparison?: Record<string, unknown> | null;
}) {
  const safeCase = safeCaseId(args.caseId);
  const stored = await readIndex(safeCase);
  const wanted = stored.filter((x) => args.artifactIds.includes(x.id));
  if (!wanted.length) throw new Error("No hay evidencias para generar el informe forense.");
  const artifacts: HcvForensicArtifact[] = [];
  for (const item of wanted) artifacts.push(await inspectForensicArtifact(safeCase, item));

  const findings: HcvForensicFinding[] = [];
  for (const a of artifacts) {
    findings.push(a.sha256Verified
      ? { level:"positive", code:"HASH_OK", title:"Huella de evidencia reproducible", detail:"El SHA-256 recalculado coincide con la huella registrada al incorporar el archivo.", evidence:[a.name,a.sha256Recalculated] }
      : { level:"critical", code:"HASH_MISMATCH", title:"Inconsistencia de huella", detail:"El SHA-256 recalculado no coincide con la huella registrada.", evidence:[a.name,a.sha256Stored,a.sha256Recalculated] });
    if (a.extensionMatches === false) findings.push({ level:"warning", code:"EXTENSION_SIGNATURE_MISMATCH", title:"Extensión y firma binaria no coinciden", detail:"El tipo detectado por firma binaria no corresponde a la extensión del archivo.", evidence:[a.name,a.extension,a.detectedType,a.magicHex] });
    if (a.pdf && a.pdf.eofMarkers > 1) findings.push({ level:"info", code:"PDF_INCREMENTAL_UPDATES", title:"PDF con múltiples cierres/revisiones internas", detail:"Hay varios marcadores %%EOF. Puede ser normal en PDFs firmados o actualizados incrementalmente y no demuestra manipulación por sí solo.", evidence:["%%EOF=" + a.pdf.eofMarkers,"startxref=" + a.pdf.startXrefMarkers] });
  }
  const comparison = args.comparison ?? null;
  if (comparison?.["exactHash"] === true) findings.push({ level:"positive", code:"OFFICIAL_BINARY_IDENTITY", title:"Identidad binaria con original incorporado", detail:"El aportado y el original oficial incorporado tienen la misma huella SHA-256.", evidence:[String(comparison["sourceSha256"] ?? ""),String(comparison["officialSha256"] ?? "")] });
  if (comparison && comparison["exactHash"] === false) findings.push({ level:"warning", code:"OFFICIAL_HASH_DIFFERENCE", title:"Aportado y original no son idénticos byte a byte", detail:"Una diferencia de huella puede deberse a conversión, copia, firma o modificación. Debe valorarse junto con HCV y metadatos.", evidence:[String(comparison["sourceSha256"] ?? ""),String(comparison["officialSha256"] ?? "")] });
  if (args.officialResult === "positive") findings.push({ level:"positive", code:"HCV_POSITIVE", title:"Resultado HCV positivo incorporado", detail:"El expediente registra validación HCV positiva asociada al CSV.", evidence:[args.csv,args.officialResultSource ?? "origen no especificado"] });
  if (args.officialResult === "negative") findings.push({ level:"critical", code:"HCV_NEGATIVE", title:"Resultado HCV negativo incorporado", detail:"El expediente registra validación HCV negativa asociada al CSV.", evidence:[args.csv,args.officialResultSource ?? "origen no especificado"] });
  if (args.officialResult === "not-found") findings.push({ level:"warning", code:"ENIDOC_NOT_FOUND", title:"CSV no encontrado en repositorio configurado", detail:"El resultado debe interpretarse dentro del repositorio ENIDOCWS concreto consultado.", evidence:[args.csv] });
  if (!args.csv) findings.push({ level:"warning", code:"CSV_MISSING", title:"No consta CSV seleccionado", detail:"No puede completarse una comprobación CSV sin un código identificado de forma fiable.", evidence:[] });

  const report: HcvForensicReport = {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    caseId: safeCase,
    csv: args.csv.trim(),
    officialResult: args.officialResult,
    officialResultSource: args.officialResultSource ?? null,
    conclusion: forensicConclusion(args.officialResult, comparison),
    comparison,
    artifacts,
    findings,
    limitations: [
      "El análisis se limita a los archivos incorporados a WILLY y a los resultados oficiales que consten en el expediente.",
      "La ausencia de CSV detectado por extracción de texto no demuestra que el documento carezca de él; un escaneo puede requerir examen adicional.",
      "Los metadatos internos de un PDF pueden ser editables y no acreditan por sí solos autoría o fecha cierta.",
      "Múltiples revisiones internas de un PDF pueden ser legítimas por firmas o actualizaciones incrementales.",
      "El informe no evalúa la legalidad material del contenido y no sustituye una pericial firmada cuando sea procesalmente necesaria.",
    ],
    methodology: [
      "Preservación local del archivo incorporado.",
      "Recalculo SHA-256 sobre los bytes preservados y contraste con la huella registrada.",
      "Identificación de tipo mediante firma binaria y contraste con extensión.",
      "Extracción de indicadores CSV y URLs oficiales desde el texto disponible.",
      "Extracción determinista de metadatos PDF básicos.",
      "Comparación SHA-256 y similitud textual con original HCV cuando existe.",
      "Separación estricta entre resultado oficial HCV/ENIDOCWS y conclusiones técnicas locales.",
    ],
    reproducibility: { hashAlgorithm:"SHA-256", tool:"WILLY AI · Verificador CSV / Informe forense", generatedBy:"análisis determinista local" },
  };

  const reports = path.join(artifactDir(safeCase), "reports");
  await fs.mkdir(reports, { recursive: true });
  await fs.writeFile(path.join(reports, report.id + ".json"), JSON.stringify(report, null, 2), { encoding:"utf8", mode:0o600 });
  await fs.writeFile(path.join(reports, report.id + ".html"), forensicHtml(report), { encoding:"utf8", mode:0o600 });
  return { reportId: report.id, report };
}

export async function hcvForensicDownload(caseId: string, reportId: string, format: "html" | "json") {
  const safeCase = safeCaseId(caseId);
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) throw new Error("Informe forense no válido.");
  const ext = format === "json" ? "json" : "html";
  const bytes = await fs.readFile(path.join(artifactDir(safeCase), "reports", reportId + "." + ext));
  return {
    bytes,
    name: "informe-forense-csv-" + safeCase + "." + ext,
    mime: format === "json" ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
  };
}


function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

async function runPowershell(command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 }, (error) => error ? reject(error) : resolve());
  });
}

export async function createHcvPackage(caseId: string, artifactIds: string[], manifest: Record<string, unknown>) {
  const safeCase = safeCaseId(caseId);
  const dir = artifactDir(safeCase);
  const items = await readIndex(safeCase);
  const wanted = items.filter((x) => artifactIds.includes(x.id));
  if (!wanted.length) throw new Error("No hay archivos para empaquetar.");
  const packageId = crypto.randomUUID();
  const stage = path.join(dir, "package-" + packageId);
  const packages = path.join(dir, "packages");
  await fs.mkdir(stage, { recursive: true });
  await fs.mkdir(packages, { recursive: true });
  const used = new Set<string>();
  for (const item of wanted) {
    let name = safeName(item.kind + "__" + item.name);
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const ext = path.extname(name);
      const stem = name.slice(0, -ext.length);
      name = stem + "_" + n + ext;
      n += 1;
    }
    used.add(name.toLowerCase());
    await fs.copyFile(path.join(dir, item.diskName), path.join(stage, name));
  }
  const fullManifest = {
    generatedAt: new Date().toISOString(),
    source: "WILLY AI · Verificador CSV Junta de Andalucía",
    officialPortal: HCV_PORTAL,
    note: "El paquete conserva huellas SHA-256. La autenticidad oficial depende del resultado emitido por HCV.",
    artifacts: wanted.map(({ diskName: _d, textName: _t, ...x }) => x),
    ...manifest,
  };
  await fs.writeFile(path.join(stage, "manifest-verificacion.json"), JSON.stringify(fullManifest, null, 2), "utf8");
  const zip = path.join(packages, packageId + ".zip");
  await runPowershell(`Compress-Archive -Path ${psQuote(path.join(stage, "*"))} -DestinationPath ${psQuote(zip)} -Force`);
  await fs.rm(stage, { recursive: true, force: true });
  const stat = await fs.stat(zip);
  return { packageId, size: stat.size, name: "verificacion-csv-" + safeCase + ".zip" };
}

export async function hcvDownload(caseId: string, artifactId?: string, packageId?: string) {
  const safeCase = safeCaseId(caseId);
  const dir = artifactDir(safeCase);
  if (packageId) {
    if (!/^[0-9a-f-]{36}$/i.test(packageId)) throw new Error("Paquete no válido.");
    const file = path.join(dir, "packages", packageId + ".zip");
    const bytes = await fs.readFile(file);
    return { bytes, name: "verificacion-csv-" + safeCase + ".zip", mime: "application/zip" };
  }
  if (!artifactId) throw new Error("Falta el archivo a descargar.");
  const item = await findArtifact(safeCase, artifactId);
  const bytes = await fs.readFile(path.join(dir, item.diskName));
  return { bytes, name: item.name, mime: item.mime || "application/octet-stream" };
}

export function hcvStatus() {
  const baseUrl = String(process.env["HCV_ENIDOC_BASE_URL"] ?? "").trim();
  const username = String(process.env["HCV_ENIDOC_USERNAME"] ?? "").trim();
  const password = String(process.env["HCV_ENIDOC_PASSWORD"] ?? "").trim();
  const profile = String(process.env["HCV_ENIDOC_PROFILE"] ?? "").trim();
  return {
    portal: HCV_PORTAL,
    info: HCV_INFO,
    developer: HCV_DEV,
    enidoc: {
      configured: Boolean(baseUrl && username && password && /^[1-4]$/.test(profile)),
      baseUrl: baseUrl ? new URL(baseUrl).origin : "",
      profile,
      publicHcvApi: false,
      mode: "repository-client",
      requiresRepositoryEndpoint: true,
      protocol: "ENIDOCWS 2.0",
    },
  };
}

export async function checkEnidocCsv(csv: string) {
  const status = hcvStatus();
  if (!status.enidoc.configured) {
    return { ok: false, configured: false, exists: null, error: "No hay un repositorio ENIDOCWS autorizado configurado. HCV no publica este endpoint como API ciudadana; usa el portal HCV con certificado/Cl@ve." };
  }
  const base = String(process.env["HCV_ENIDOC_BASE_URL"]).replace(/\/+$/, "");
  const user = String(process.env["HCV_ENIDOC_USERNAME"]);
  const pass = String(process.env["HCV_ENIDOC_PASSWORD"]);
  const profile = String(process.env["HCV_ENIDOC_PROFILE"]);
  const rep = String(process.env["HCV_ENIDOC_REP"] ?? "").trim();
  const url = new URL(base + "/rest/eni/v2/enidoc/" + encodeURIComponent(csv.trim()));
  url.searchParams.set("perfil", profile);
  url.searchParams.set("motivo", "Consulta de existencia de documento desde WILLY AI");
  if (profile === "4") {
    url.searchParams.set("idSist", "WILLY-AI");
    url.searchParams.set("descSist", "WILLY AI · Análisis Jurídico");
  }
  if (rep) url.searchParams.set("rep", rep);
  const response = await fetch(url, {
    method: "HEAD",
    headers: { Authorization: "Basic " + Buffer.from(user + ":" + pass).toString("base64"), "User-Agent": "WILLY-AI-HCV/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 200) return { ok: true, configured: true, exists: true, status: 200 };
  if (response.status === 404) return { ok: true, configured: true, exists: false, status: 404 };
  if (response.status === 401 || response.status === 403) return { ok: false, configured: true, exists: null, status: response.status, error: "HCV/ENIDOCWS rechazó las credenciales o permisos configurados." };
  return { ok: false, configured: true, exists: null, status: response.status, error: "ENIDOCWS respondió " + response.status + "." };
}
