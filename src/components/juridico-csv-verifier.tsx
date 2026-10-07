import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, CheckCircle2, Clipboard, Download, ExternalLink, FileCheck2, FileDown, FileSearch,
  Loader2, PackageCheck, RefreshCw, ShieldCheck, Upload, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard as Card } from "@/components/panel-card";
import type { Ping } from "@/types/domain";

export type HcvArtifactRef = {
  id: string;
  kind: "aportado" | "original-hcv" | "informe-hcv" | "metadatos-hcv" | "eni-hcv";
  name: string;
  size: number;
  mime: string;
  sha256: string;
  uploadedAt: string;
  csvCandidates: Array<{ value: string; confidence: "alta" | "media"; reason: string }>;
  verificationUrls: string[];
  hcvSignal: "positive" | "negative" | "unknown";
};

export type HcvComparison = {
  exactHash: boolean;
  sourceSha256: string;
  officialSha256: string;
  textSimilarity: number | null;
  sourceName: string;
  officialName: string;
};

export type HcvCheck = {
  id: string;
  createdAt: number;
  csv: string;
  source: HcvArtifactRef;
  officialOriginal?: HcvArtifactRef;
  signatureReport?: HcvArtifactRef;
  metadata?: HcvArtifactRef;
  eni?: HcvArtifactRef;
  officialResult: "pending" | "positive" | "negative" | "exists" | "not-found" | "unknown";
  officialResultSource?: "informe-hcv" | "enidocws";
  comparison?: HcvComparison;
};

type HcvStatus = {
  portal: string;
  info: string;
  developer: string;
  enidoc: {
    configured: boolean;
    baseUrl: string;
    profile?: string;
    publicHcvApi?: boolean;
    mode?: string;
    requiresRepositoryEndpoint?: boolean;
    protocol: string;
  };
};

type Props = {
  caseId: string;
  checks: HcvCheck[];
  onChange: (checks: HcvCheck[]) => void;
  ping: Ping;
};

const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

function fmt(n: number): string {
  return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
}

async function extract(file: File): Promise<string> {
  try {
    const lower = file.name.toLowerCase();
    if (
      file.type.startsWith("text/") ||
      file.type.includes("json") ||
      file.type.includes("xml") ||
      /\.(txt|xml|json|html?|csv|md)$/i.test(lower)
    ) {
      return (await file.text()).trim();
    }
    const { extractAnyText } = await import("@/lib/pdf-text");
    return (await extractAnyText(file))?.trim() || "";
  } catch {
    return "";
  }
}

async function jsonPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/juridico-hcv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error || "Error del verificador HCV.");
  return data;
}

async function uploadFile(caseId: string, kind: HcvArtifactRef["kind"], file: File): Promise<HcvArtifactRef> {
  const text = await extract(file);
  const form = new FormData();
  form.set("action", "upload");
  form.set("caseId", caseId);
  form.set("kind", kind);
  form.set("text", text.slice(0, 500_000));
  form.set("file", file, file.name);
  const res = await fetch("/api/juridico-hcv", { method: "POST", body: form });
  const data = await res.json() as { ok?: boolean; artifact?: HcvArtifactRef; error?: string };
  if (!res.ok || !data.ok || !data.artifact) throw new Error(data.error || "No se pudo guardar el documento.");
  return data.artifact;
}

function resultLabel(check: HcvCheck): { text: string; tone: string; icon: typeof ShieldCheck } {
  if (check.officialResult === "positive") return { text: "Informe HCV importado · validación positiva", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700", icon: CheckCircle2 };
  if (check.officialResult === "negative") return { text: "Informe HCV importado · validación negativa", tone: "border-red-500/40 bg-red-500/10 text-red-700", icon: XCircle };
  if (check.officialResult === "not-found") return { text: "CSV no encontrado por ENIDOCWS", tone: "border-red-500/40 bg-red-500/10 text-red-700", icon: XCircle };
  if (check.officialResult === "exists") return { text: "CSV existente en ENIDOCWS · firma pendiente", tone: "border-sky-500/40 bg-sky-500/10 text-sky-700", icon: FileCheck2 };
  if (!check.csv) return { text: "No se ha detectado CSV", tone: "border-amber-500/40 bg-amber-500/10 text-amber-700", icon: AlertCircle };
  return { text: "CSV detectado · verificación HCV pendiente", tone: "border-amber-500/40 bg-amber-500/10 text-amber-700", icon: ShieldCheck };
}

export function JuridicoCsvVerifier({ caseId, checks, onChange, ping }: Props) {
  const [status, setStatus] = useState<HcvStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const sourceRef = useRef<HTMLInputElement>(null);
  const originalRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLInputElement>(null);
  const metaRef = useRef<HTMLInputElement>(null);
  const eniRef = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState(checks[0]?.id ?? "");
  const active = checks.find((x) => x.id === activeId) ?? checks[0] ?? null;

  useEffect(() => {
    let alive = true;
    fetch("/api/juridico-hcv", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { status?: HcvStatus }) => { if (alive && d.status) setStatus(d.status); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!checks.length) setActiveId("");
    else if (!checks.some((x) => x.id === activeId)) setActiveId(checks[0]!.id);
  }, [checks, activeId]);

  const patch = (id: string, data: Partial<HcvCheck>) => {
    onChange(checks.map((x) => x.id === id ? { ...x, ...data } : x));
  };

  const allArtifactIds = useMemo(() => {
    if (!active) return [];
    return [active.source, active.officialOriginal, active.signatureReport, active.metadata, active.eni].filter(Boolean).map((x) => x!.id);
  }, [active]);

  const onSource = async (file: File | null) => {
    if (!file) return;
    setBusy("source"); setError("");
    try {
      const artifact = await uploadFile(caseId, "aportado", file);
      const csv = artifact.csvCandidates.find((x) => x.confidence === "alta")?.value ?? artifact.csvCandidates[0]?.value ?? "";
      const check: HcvCheck = {
        id: uid(),
        createdAt: Date.now(),
        csv,
        source: artifact,
        officialResult: "pending",
      };
      onChange([check, ...checks]);
      setActiveId(check.id);
      ping(csv ? "CSV detectado en el documento. Pendiente de comprobación oficial HCV." : "Documento guardado, pero WILLY no ha localizado un CSV de forma fiable.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo analizar el documento.");
    } finally {
      setBusy("");
      if (sourceRef.current) sourceRef.current.value = "";
    }
  };

  const importArtifact = async (kind: HcvArtifactRef["kind"], file: File | null) => {
    if (!active || !file) return;
    setBusy(kind); setError("");
    try {
      const artifact = await uploadFile(caseId, kind, file);
      const update: Partial<HcvCheck> = {};
      if (kind === "original-hcv") update.officialOriginal = artifact;
      if (kind === "informe-hcv") {
        update.signatureReport = artifact;
        const csvMatches = !active.csv || artifact.csvCandidates.some((candidate) => candidate.value === active.csv);
        if (artifact.hcvSignal !== "unknown" && csvMatches) {
          update.officialResult = artifact.hcvSignal === "positive" ? "positive" : "negative";
          update.officialResultSource = "informe-hcv";
        } else if (artifact.hcvSignal !== "unknown" && !csvMatches) {
          setError("El informe importado contiene un resultado de validación, pero no se ha podido vincular al mismo CSV. Se conserva como evidencia sin marcar el CSV actual como validado.");
        }
      }
      if (kind === "metadatos-hcv") update.metadata = artifact;
      if (kind === "eni-hcv") update.eni = artifact;

      let comparison = active.comparison;
      if (kind === "original-hcv") {
        const data = await jsonPost<{ ok: true; result: HcvComparison }>({ action: "compare", caseId, sourceId: active.source.id, officialId: artifact.id });
        comparison = data.result;
        update.comparison = comparison;
      }
      patch(active.id, update);
      ping(kind === "original-hcv"
        ? (comparison?.exactHash ? "Original HCV importado: huella SHA-256 idéntica al documento aportado." : "Original HCV importado y comparado con el documento aportado.")
        : "Archivo HCV incorporado al paquete de verificación.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar el resultado HCV.");
    } finally {
      setBusy("");
      if (originalRef.current) originalRef.current.value = "";
      if (reportRef.current) reportRef.current.value = "";
      if (metaRef.current) metaRef.current.value = "";
      if (eniRef.current) eniRef.current.value = "";
    }
  };

  const copyAndOpen = async () => {
    if (!active?.csv) return;
    try { await navigator.clipboard.writeText(active.csv); } catch { /* el navegador puede bloquear portapapeles */ }
    window.open(status?.portal || "https://ws050.juntadeandalucia.es/verificarFirma/", "_blank", "noopener,noreferrer");
    ping("CSV copiado. Identifícate en HCV con certificado/Cl@ve y pega el código.");
  };

  const automaticCheck = async () => {
    if (!active?.csv) return;
    if (!status?.enidoc.configured) { await copyAndOpen(); return; }
    setBusy("enidoc"); setError("");
    try {
      const data = await jsonPost<{ ok: true; result: { exists: boolean | null } }>({ action: "enidoc-check", csv: active.csv });
      patch(active.id, {
        officialResult: data.result.exists === true ? "exists" : data.result.exists === false ? "not-found" : "unknown",
        officialResultSource: "enidocws",
      });
      ping(data.result.exists ? "El repositorio ENIDOCWS configurado confirma que el CSV existe. Esto no sustituye por sí solo la validación HCV de firma/integridad." : "El repositorio ENIDOCWS configurado no ha encontrado el CSV.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar ENIDOCWS.");
    } finally { setBusy(""); }
  };

  const downloadArtifact = (artifact: HcvArtifactRef) => {
    window.location.href = "/api/juridico-hcv?caseId=" + encodeURIComponent(caseId) + "&artifactId=" + encodeURIComponent(artifact.id);
  };

  const downloadPackage = async () => {
    if (!active || !allArtifactIds.length) return;
    setBusy("package"); setError("");
    try {
      const data = await jsonPost<{ ok: true; result: { packageId: string } }>({
        action: "package",
        caseId,
        artifactIds: allArtifactIds,
        manifest: {
          csv: active.csv,
          officialResult: active.officialResult,
          officialResultSource: active.officialResultSource ?? null,
          comparison: active.comparison ?? null,
          verificationPortal: status?.portal ?? "https://ws050.juntadeandalucia.es/verificarFirma/",
        },
      });
      window.location.href = "/api/juridico-hcv?caseId=" + encodeURIComponent(caseId) + "&packageId=" + encodeURIComponent(data.result.packageId);
      ping("Paquete de verificación preparado con documentos y manifiesto SHA-256.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo preparar el paquete.");
    } finally { setBusy(""); }
  };

  const removeCheck = (id: string) => {
    if (!window.confirm("¿Quitar esta comprobación del expediente? Los archivos almacenados no se borran automáticamente del disco.")) return;
    onChange(checks.filter((x) => x.id !== id));
  };

  const label = active ? resultLabel(active) : null;
  const LabelIcon = label?.icon ?? ShieldCheck;

  return <div className="space-y-4">
    <input ref={sourceRef} type="file" className="hidden" accept=".pdf,.txt,.html,.htm,.xml,.doc,.docx" onChange={(e) => void onSource(e.target.files?.[0] ?? null)} />
    <input ref={originalRef} type="file" className="hidden" accept=".pdf,.xml,.bin" onChange={(e) => void importArtifact("original-hcv", e.target.files?.[0] ?? null)} />
    <input ref={reportRef} type="file" className="hidden" accept=".pdf,.xml,.txt" onChange={(e) => void importArtifact("informe-hcv", e.target.files?.[0] ?? null)} />
    <input ref={metaRef} type="file" className="hidden" accept=".json,.xml,.txt,.pdf" onChange={(e) => void importArtifact("metadatos-hcv", e.target.files?.[0] ?? null)} />
    <input ref={eniRef} type="file" className="hidden" accept=".xml,.bin,.zip" onChange={(e) => void importArtifact("eni-hcv", e.target.files?.[0] ?? null)} />

    <Card className="overflow-hidden p-0">
      <div className="border-b border-border bg-gradient-to-r from-emerald-500/10 via-card to-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
            <ShieldCheck className="size-5 text-emerald-700" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold">Verificador CSV · Junta de Andalucía</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Sube el documento. WILLY detecta el CSV, conserva el archivo original y te lleva a HCV para la comprobación oficial de autenticidad e integridad.</p>
          </div>
          <Button className="w-full gap-2 lg:w-auto" onClick={() => sourceRef.current?.click()} disabled={Boolean(busy)}>
            {busy === "source" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Subir documento
          </Button>
        </div>
      </div>
      <div className="grid gap-3 p-4 text-xs sm:grid-cols-3 sm:p-5">
        <div className="rounded-xl border border-border bg-background p-3"><p className="font-bold">1 · Detección</p><p className="mt-1 leading-5 text-muted-foreground">Extrae CSV, URL HCV y huella SHA-256 del archivo aportado.</p></div>
        <div className="rounded-xl border border-border bg-background p-3"><p className="font-bold">2 · HCV oficial</p><p className="mt-1 leading-5 text-muted-foreground">La verificación oficial requiere certificado/Cl@ve, salvo cliente ENIDOCWS autorizado.</p></div>
        <div className="rounded-xl border border-border bg-background p-3"><p className="font-bold">3 · Paquete probatorio</p><p className="mt-1 leading-5 text-muted-foreground">Guarda original, informe, metadatos y manifiesto de huellas para descargarlo todo.</p></div>
      </div>
    </Card>

    {error && <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span className="flex-1">{error}</span><button onClick={() => setError("")}><XCircle className="size-4" /></button></div>}

    {!!checks.length && <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {checks.map((check) => <button key={check.id} onClick={() => setActiveId(check.id)} className={"shrink-0 rounded-lg border px-3 py-2 text-left text-[11px] transition " + (active?.id === check.id ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted")}>
        <p className="max-w-52 truncate font-semibold">{check.source.name}</p>
        <p className="mt-0.5 text-muted-foreground">{check.csv || "CSV no detectado"}</p>
      </button>)}
    </div>}

    {active && label && <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className={"inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold " + label.tone}><LabelIcon className="size-4" />{label.text}</div>
            <button onClick={() => removeCheck(active.id)} className="ml-auto text-[10px] font-semibold text-muted-foreground hover:text-red-600">Quitar comprobación</button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2"><span className="text-xs font-semibold">CSV detectado / código a comprobar</span><div className="flex flex-col gap-2 sm:flex-row"><input value={active.csv} onChange={(e) => patch(active.id, { csv: e.target.value.trim() })} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none focus:border-primary" placeholder="Introduce o corrige el CSV"/><Button variant="outline" className="gap-2 sm:w-auto" onClick={async()=>{try{await navigator.clipboard.writeText(active.csv);ping("CSV copiado.");}catch{}}} disabled={!active.csv}><Clipboard className="size-4"/>Copiar</Button></div></label>
            <div className="rounded-xl border border-border p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Documento aportado</p><p className="mt-1 truncate text-xs font-semibold">{active.source.name}</p><p className="mt-1 font-mono text-[9px] text-muted-foreground">SHA-256 {active.source.sha256}</p><Button variant="outline" size="sm" className="mt-3 w-full gap-2" onClick={() => downloadArtifact(active.source)}><Download className="size-3.5"/>Descargar aportado</Button></div>
            <div className="rounded-xl border border-border p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Detección</p><p className="mt-1 text-xs font-semibold">{active.source.csvCandidates.length ? active.source.csvCandidates.length + " candidato(s) CSV" : "Sin candidato fiable"}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{active.source.verificationUrls[0] || "No se encontró URL HCV dentro del texto extraído."}</p></div>
          </div>

          {!!active.source.csvCandidates.length && <div className="rounded-xl border border-border bg-muted/30 p-3"><p className="text-xs font-semibold">Códigos encontrados</p><div className="mt-2 flex flex-wrap gap-2">{active.source.csvCandidates.map((candidate)=><button key={candidate.value} onClick={()=>patch(active.id,{csv:candidate.value})} className={"rounded-md border px-2 py-1 font-mono text-[10px] "+(active.csv===candidate.value?"border-primary bg-primary/10 text-primary":"border-border bg-background")} title={candidate.reason}>{candidate.value}</button>)}</div></div>}

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs font-bold">Comprobación oficial HCV</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">WILLY no declara válido un documento solo por el formato del código. La Junta exige identificación para la consulta ciudadana. Abre HCV, autentícate y descarga el original/informe cuando el sistema lo permita.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button className="gap-2" disabled={!active.csv || busy === "enidoc"} onClick={() => void automaticCheck()}>{busy === "enidoc" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{status?.enidoc.configured ? "Comprobar en repositorio ENIDOCWS" : "Abrir HCV y verificar"}</Button>
              <a href={status?.info || "https://www.juntadeandalucia.es/servicios/tramites/servicios-digitales/verificacion-documentos.html"} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted">Información oficial <ExternalLink className="size-3.5"/></a>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">ENIDOCWS 2.0: {status?.enidoc.configured ? "hay un endpoint de repositorio configurado para consulta automática." : "preparado como integración de repositorio. No es una API pública de HCV: requiere el endpoint, perfil y credenciales del repositorio que custodia el documento."}</p>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-bold">Importar resultado de HCV</p><p className="mt-1 text-xs text-muted-foreground">Después de verificar, incorpora aquí lo que HCV te permita descargar. WILLY lo guarda junto al documento inicial.</p></div><span className="rounded-full border border-border bg-muted px-2 py-1 text-[10px] font-semibold">{allArtifactIds.length} archivo(s)</span></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button onClick={()=>originalRef.current?.click()} className="rounded-xl border border-border p-3 text-left hover:border-primary/40 hover:bg-primary/5"><FileDown className="size-4 text-primary"/><p className="mt-2 text-xs font-semibold">Original oficial HCV</p><p className="mt-1 text-[10px] text-muted-foreground">{active.officialOriginal ? active.officialOriginal.name : "Importar el PDF/documento original descargado."}</p></button>
            <button onClick={()=>reportRef.current?.click()} className="rounded-xl border border-border p-3 text-left hover:border-primary/40 hover:bg-primary/5"><FileCheck2 className="size-4 text-primary"/><p className="mt-2 text-xs font-semibold">Informe de firma</p><p className="mt-1 text-[10px] text-muted-foreground">{active.signatureReport ? active.signatureReport.name : "Permite detectar resultado positivo/negativo cuando consta en el informe."}</p></button>
            <button onClick={()=>metaRef.current?.click()} className="rounded-xl border border-border p-3 text-left hover:border-primary/40 hover:bg-primary/5"><FileSearch className="size-4 text-primary"/><p className="mt-2 text-xs font-semibold">Metadatos HCV</p><p className="mt-1 text-[10px] text-muted-foreground">{active.metadata ? active.metadata.name : "JSON, XML, PDF o texto de metadatos."}</p></button>
            <button onClick={()=>eniRef.current?.click()} className="rounded-xl border border-border p-3 text-left hover:border-primary/40 hover:bg-primary/5"><PackageCheck className="size-4 text-primary"/><p className="mt-2 text-xs font-semibold">Documento ENI / firma</p><p className="mt-1 text-[10px] text-muted-foreground">{active.eni ? active.eni.name : "Conserva el contenedor electrónico si HCV lo ofrece."}</p></button>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="p-4">
          <p className="text-sm font-bold">Resultado técnico</p>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">CSV</span><span className={active.csv ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>{active.csv ? "Detectado" : "No detectado"}</span></div>
            <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Validación oficial</span><span className="text-right font-semibold">{active.officialResult === "positive" ? "POSITIVA" : active.officialResult === "negative" ? "NEGATIVA" : active.officialResult === "exists" ? "CSV existente" : active.officialResult === "not-found" ? "No encontrado" : "Pendiente"}</span></div>
            <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Original HCV</span><span className="font-semibold">{active.officialOriginal ? "Incorporado" : "Pendiente"}</span></div>
            <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Informe firma</span><span className="font-semibold">{active.signatureReport ? "Incorporado" : "Pendiente"}</span></div>
          </div>
        </Card>

        {active.comparison && <Card className="p-4">
          <p className="text-sm font-bold">Comparación con original HCV</p>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">SHA-256</span><span className={"font-bold "+(active.comparison.exactHash?"text-emerald-700":"text-amber-700")}>{active.comparison.exactHash ? "IDÉNTICO" : "DISTINTO"}</span></div>
            <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Similitud de texto</span><span className="font-semibold">{active.comparison.textSimilarity == null ? "No calculable" : active.comparison.textSimilarity.toFixed(1) + "%"}</span></div>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-muted-foreground">{active.comparison.exactHash ? "Los bytes del documento aportado y del original HCV son exactamente iguales." : "Una huella distinta no demuestra por sí sola falsedad: puede existir copia, conversión o informe de firma. Revisa el original y los metadatos HCV."}</p>
        </Card>}

        <Card className="p-4">
          <p className="text-sm font-bold">Descargas</p>
          <div className="mt-3 grid gap-2">
            {active.officialOriginal && <Button variant="outline" size="sm" className="justify-start gap-2" onClick={()=>downloadArtifact(active.officialOriginal!)}><Download className="size-3.5"/>Original HCV</Button>}
            {active.signatureReport && <Button variant="outline" size="sm" className="justify-start gap-2" onClick={()=>downloadArtifact(active.signatureReport!)}><Download className="size-3.5"/>Informe de firma</Button>}
            {active.metadata && <Button variant="outline" size="sm" className="justify-start gap-2" onClick={()=>downloadArtifact(active.metadata!)}><Download className="size-3.5"/>Metadatos</Button>}
            {active.eni && <Button variant="outline" size="sm" className="justify-start gap-2" onClick={()=>downloadArtifact(active.eni!)}><Download className="size-3.5"/>Documento ENI</Button>}
            <Button className="justify-start gap-2" disabled={busy === "package" || !allArtifactIds.length} onClick={()=>void downloadPackage()}>{busy === "package" ? <Loader2 className="size-3.5 animate-spin"/> : <PackageCheck className="size-3.5"/>}Descargar TODO (.zip)</Button>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-muted-foreground">El ZIP incluye los archivos disponibles y un manifiesto JSON con CSV, resultado registrado, comparación y huellas SHA-256.</p>
        </Card>
      </div>
    </div>}

    {!checks.length && <Card className="border-dashed p-8 text-center"><ShieldCheck className="mx-auto size-9 text-muted-foreground"/><p className="mt-3 text-sm font-bold">Sube un documento para empezar</p><p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-muted-foreground">WILLY conservará exactamente el archivo aportado y buscará dentro su Código Seguro de Verificación. No marcará el CSV como correcto hasta tener evidencia de la comprobación oficial.</p></Card>}
  </div>;
}
