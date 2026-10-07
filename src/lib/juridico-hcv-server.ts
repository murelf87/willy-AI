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
