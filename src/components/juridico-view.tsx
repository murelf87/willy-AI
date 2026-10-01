/**
 * ANÁLISIS JURÍDICO — Pestaña especializada en derecho.
 * Estructura: chat + documentos adjuntos, con system prompt de altísimo nivel jurídico.
 * La IA analiza todos los documentos subidos en contexto con la consulta del usuario.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle, BookOpen, Check, ChevronDown, ChevronUp, Copy, Download, FileText, Gavel, Loader2,
  Paperclip, Plus, Scale, Send, Trash2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHead as Head } from "@/components/section-ui";
import { PanelCard as Card } from "@/components/panel-card";
import type { Ping } from "@/types/domain";

// ─── Tipos ───────────────────────────────────────────────────────────────────

type DocFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  text: string; // contenido extraído
  uploadedAt: number;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type CasoJuridico = {
  id: string;
  nombre: string;
  docs: DocFile[];
  messages: Message[];
  createdAt: number;
};

// ─── System prompt jurídico de altísimo nivel ─────────────────────────────────

const JURIDICO_SYSTEM = `Eres WILLY JURÍDICO, un asistente legal de élite con el nivel de conocimiento y rigor de un abogado senior con 20 años de experiencia en derecho español y europeo.

ESPECIALIDADES:
- Derecho civil, mercantil, laboral, administrativo, penal y constitucional español
- Legislación de la Unión Europea y su transposición al ordenamiento jurídico español
- Jurisprudencia del Tribunal Supremo, Tribunal Constitucional, TJUE y TEDH
- Procedimientos judiciales y administrativos
- Contratos, responsabilidad civil, propiedad intelectual, protección de datos (RGPD/LOPDGDD)
- Derecho de familia, sucesiones, arrendamientos, urbanismo
- Derecho laboral: despidos, ERTEs, EREs, convenios colectivos
- Derecho mercantil: sociedades, concurso de acreedores, contratos mercantiles

FORMA DE TRABAJAR:
1. Analiza TODOS los documentos adjuntos antes de responder
2. Cita artículos de ley, sentencias y jurisprudencia relevante con precisión (número, fecha, ponente cuando proceda)
3. Identifica los puntos débiles y fuertes del caso desde ambas perspectivas
4. Señala plazos procesales críticos y consecuencias de incumplirlos
5. Proporciona estrategias legales concretas y accionables
6. Advierte sobre riesgos jurídicos con claridad
7. Usa lenguaje técnico-jurídico preciso pero explica los conceptos complejos
8. Cuando hay ambigüedad legal, presenta las distintas interpretaciones doctrinales

ESTRUCTURA DE TUS RESPUESTAS:
- **Resumen ejecutivo**: conclusión principal en 2-3 líneas
- **Análisis jurídico**: desarrollo detallado con fundamentos legales
- **Jurisprudencia aplicable**: sentencias relevantes
- **Riesgos y plazos**: advertencias críticas
- **Recomendaciones**: pasos concretos a seguir

AVISO IMPORTANTE: Tus análisis son orientativos. Para actuaciones judiciales formales, el usuario debe consultar con un abogado colegiado que pueda asumir responsabilidad profesional.`;

// ─── Plantillas de caso ───────────────────────────────────────────────────────

type Plantilla = { id: string; nombre: string; descripcion: string; preguntaInicial: string };

const PLANTILLAS: Plantilla[] = [
  {
    id: "recurso-administrativo",
    nombre: "Recurso administrativo",
    descripcion: "Resoluciones de la Administración, oposiciones, sanciones, expedientes",
    preguntaInicial: "Analiza el expediente adjunto e indícame:\n1. Fundamentos jurídicos para recurrir\n2. Plazo para interponer el recurso\n3. Argumentos más sólidos y más débiles\n4. Legislación aplicable (LRJAPyPAC / LPAC, normativa sectorial)\n5. Estrategia recomendada y posibilidades reales de éxito",
  },
  {
    id: "contrato",
    nombre: "Revisión de contrato",
    descripcion: "Contratos de compraventa, arrendamiento, servicios, trabajo…",
    preguntaInicial: "Revisa el contrato adjunto y señala:\n1. Cláusulas abusivas o nulas de pleno derecho\n2. Vacíos legales o ambigüedades que me perjudiquen\n3. Derechos que no se están reconociendo\n4. Recomendaciones de modificación antes de firmar",
  },
  {
    id: "laboral",
    nombre: "Derecho laboral",
    descripcion: "Despidos, sanciones, ERE/ERTE, nóminas, convenios colectivos",
    preguntaInicial: "Analiza la situación laboral descrita en los documentos adjuntos:\n1. ¿Es procedente o improcedente el despido/sanción?\n2. Indemnización que correspondería\n3. Plazos para reclamar (20 días hábiles para impugnar despido)\n4. Convenio colectivo aplicable y condiciones mínimas\n5. Pasos concretos a seguir",
  },
  {
    id: "propiedad",
    nombre: "Propiedad e inmuebles",
    descripcion: "Compraventa, arrendamientos, comunidades de propietarios, herencias",
    preguntaInicial: "Analiza la situación inmobiliaria con los documentos adjuntos:\n1. Derechos y obligaciones de cada parte\n2. Cláusulas problemáticas\n3. Plazos y requisitos formales (escritura pública, registro)\n4. Responsabilidades y posibles reclamaciones",
  },
  {
    id: "proteccion-datos",
    nombre: "Protección de datos (RGPD)",
    descripcion: "Brechas de seguridad, uso indebido de datos, derechos ARCO-POL",
    preguntaInicial: "Analiza el caso de protección de datos:\n1. ¿Qué derechos ARCO-POL puedo ejercer y cómo?\n2. ¿Se ha producido una brecha del RGPD o la LOPDGDD?\n3. Cómo presentar una reclamación ante la AEPD\n4. Posibles sanciones para el responsable del tratamiento",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2);
const fmt = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

async function extractText(file: File): Promise<string> {
  if (file.type === "text/plain" || file.name.endsWith(".txt") || file.name.endsWith(".md")) {
    return file.text();
  }
  if (file.type === "application/json" || file.name.endsWith(".json")) {
    return file.text();
  }
  // Para PDF intentamos leer como texto plano (en producción se podría usar pdf-text)
  if (file.type === "application/pdf") {
    try {
      const { extractAnyText } = await import("@/lib/pdf-text");
      const text = await extractAnyText(file);
      return text ?? `[PDF: ${file.name} — ${fmt(file.size)}]`;
    } catch {
      return `[PDF adjunto: ${file.name} — ${fmt(file.size)}. No se pudo extraer el texto automáticamente. Describe su contenido en el chat.]`;
    }
  }
  // DOC/DOCX/ODT/RTF: intento básico
  if (file.name.match(/\.(docx?|odt|rtf)$/i)) {
    return `[Documento adjunto: ${file.name} — ${fmt(file.size)}. Adjunta una versión en PDF o TXT para que la IA pueda leerlo.]`;
  }
  return `[Archivo adjunto: ${file.name} — ${fmt(file.size)}]`;
}

async function askJuridico(messages: Message[], docs: DocFile[], signal: AbortSignal): Promise<string> {
  // Contexto de documentos: se inyecta como primer mensaje de sistema
  const docsContext = docs.length > 0
    ? `\n\n=== DOCUMENTOS ADJUNTOS AL CASO (${docs.length}) ===\n` +
      docs.map((d, i) => `\n--- Documento ${i + 1}: ${d.name} ---\n${d.text}`).join("\n") +
      "\n=== FIN DE DOCUMENTOS ==="
    : "";

  // El endpoint /api/chat espera { messages } donde el system prompt va como primer mensaje con role "system"
  const apiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: JURIDICO_SYSTEM + docsContext },
    ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: apiMessages, kind: "razonamiento" }),
    signal,
  });

  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Error ${resp.status}`);
  }

  const data = (await resp.json()) as { content?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return data.content?.trim() || "(Sin respuesta del modelo)";
}

// ─── Renderizador Markdown simple (sin deps externas) ────────────────────────

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  const inlineFormat = (s: string, key: string): React.ReactNode => {
    // Negrita **...**
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    if (parts.length === 1) return <span key={key}>{s}</span>;
    return (
      <span key={key}>
        {parts.map((p, pi) =>
          p.startsWith("**") && p.endsWith("**")
            ? <strong key={pi}>{p.slice(2, -2)}</strong>
            : <span key={pi}>{p}</span>
        )}
      </span>
    );
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("### ")) {
      nodes.push(<h3 key={i} className="mt-3 mb-1 font-bold text-sm">{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      nodes.push(<h2 key={i} className="mt-4 mb-1.5 font-bold text-base border-b border-border pb-1">{line.slice(3)}</h2>);
    } else if (line.startsWith("# ")) {
      nodes.push(<h1 key={i} className="mt-4 mb-2 font-bold text-lg">{line.slice(2)}</h1>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      nodes.push(<li key={i} className="ml-4 list-disc text-sm leading-6">{inlineFormat(line.slice(2), `li-${i}`)}</li>);
    } else if (/^\d+\. /.test(line)) {
      const content = line.replace(/^\d+\. /, "");
      nodes.push(<li key={i} className="ml-4 list-decimal text-sm leading-6">{inlineFormat(content, `ol-${i}`)}</li>);
    } else if (line.trim() === "") {
      nodes.push(<div key={i} className="h-2" />);
    } else {
      nodes.push(<p key={i} className="text-sm leading-6">{inlineFormat(line, `p-${i}`)}</p>);
    }
    i++;
  }
  return nodes;
}

// ─── Componente principal ─────────────────────────────────────────────────────

const STORAGE_KEY = "willy-juridico-casos";

function loadCasos(): CasoJuridico[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CasoJuridico[]) : [];
  } catch { return []; }
}

function saveCasos(casos: CasoJuridico[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(casos)); } catch { /* ignorar */ }
}

export function JuridicoView({ ping }: { ping: Ping }) {
  const [casos, setCasos] = useState<CasoJuridico[]>(loadCasos);
  const [casoId, setCasoId] = useState<string | null>(() => loadCasos()[0]?.id ?? null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [docsOpen, setDocsOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const copyMessage = (id: string, content: string) => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const exportCaso = () => {
    if (!caso) return;
    const lines: string[] = [`# ${caso.nombre}`, `Exportado: ${new Date().toLocaleString("es-ES")}`, ""];
    if (caso.docs.length > 0) {
      lines.push(`## Documentos adjuntos (${caso.docs.length})`, "");
      caso.docs.forEach((d) => lines.push(`- ${d.name}`));
      lines.push("");
    }
    lines.push("## Conversación", "");
    caso.messages.forEach((m) => {
      lines.push(`### ${m.role === "user" ? "Consulta" : "Análisis WILLY JURÍDICO"}`, "");
      lines.push(m.content, "");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analisis-juridico-${caso.nombre.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const caso = casos.find((c) => c.id === casoId) ?? null;

  // Persist
  useEffect(() => { saveCasos(casos); }, [casos]);

  // Scroll al fondo
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [caso?.messages]);

  const updateCaso = useCallback((id: string, updater: (c: CasoJuridico) => CasoJuridico) => {
    setCasos((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }, []);

  // Nuevo caso (opcionalmente con plantilla)
  const newCaso = (plantilla?: Plantilla) => {
    const c: CasoJuridico = {
      id: uid(),
      nombre: plantilla ? plantilla.nombre : `Caso ${new Date().toLocaleDateString("es-ES")}`,
      docs: [],
      messages: [],
      createdAt: Date.now(),
    };
    setCasos((prev) => [c, ...prev]);
    setCasoId(c.id);
    setInput(plantilla ? plantilla.preguntaInicial : "");
    setError("");
    if (plantilla) setTimeout(() => textareaRef.current?.focus(), 100);
  };

  // Subir documentos
  const handleFiles = async (files: FileList | null) => {
    if (!files || !casoId) return;
    setUploading(true);
    const newDocs: DocFile[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) { ping(`"${file.name}" supera 20 MB y no se ha añadido.`); continue; }
      const text = await extractText(file);
      newDocs.push({ id: uid(), name: file.name, size: file.size, type: file.type, text, uploadedAt: Date.now() });
    }
    if (newDocs.length > 0) {
      updateCaso(casoId, (c) => ({ ...c, docs: [...c.docs, ...newDocs] }));
      ping(`${newDocs.length} documento${newDocs.length > 1 ? "s" : ""} añadido${newDocs.length > 1 ? "s" : ""} al caso.`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Eliminar documento
  const removeDoc = (docId: string) => {
    if (!casoId) return;
    updateCaso(casoId, (c) => ({ ...c, docs: c.docs.filter((d) => d.id !== docId) }));
  };

  // Enviar mensaje
  const send = async () => {
    if (!input.trim() || !casoId || sending) return;
    const userMsg: Message = { id: uid(), role: "user", content: input.trim(), createdAt: Date.now() };
    const currentDocs = caso?.docs ?? [];

    updateCaso(casoId, (c) => ({ ...c, messages: [...c.messages, userMsg] }));
    setInput("");
    setSending(true);
    setError("");

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    // Placeholder para streaming
    const assistantId = uid();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", createdAt: Date.now() };
    updateCaso(casoId, (c) => ({ ...c, messages: [...c.messages, userMsg, assistantMsg] }));

    try {
      const allMessages = [...(caso?.messages ?? []), userMsg];
      const reply = await askJuridico(allMessages, currentDocs, abortRef.current.signal);
      updateCaso(casoId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === assistantId ? { ...m, content: reply } : m)),
      }));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Error desconocido";
      setError(msg);
      updateCaso(casoId, (c) => ({
        ...c,
        messages: c.messages.filter((m) => m.id !== assistantId),
      }));
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const deleteCaso = (id: string) => {
    setCasos((prev) => prev.filter((c) => c.id !== id));
    if (casoId === id) setCasoId(casos.find((c) => c.id !== id)?.id ?? null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Head
        title="Análisis Jurídico"
        desc="Sube documentos legales y consulta con la IA especializada en derecho español y europeo."
        action={
          <Button className="gap-2" onClick={() => newCaso()}>
            <Plus className="size-4" />Nuevo caso
          </Button>
        }
      />

      <div className="mt-4 flex min-h-0 flex-1 gap-4 lg:flex-row flex-col">

        {/* ─── Sidebar: lista de casos ─── */}
        <aside className="lg:w-56 shrink-0">
          <Card className="p-2">
            <p className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Casos</p>
            {casos.length === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">Sin casos. Crea el primero.</p>
            )}
            <ul className="space-y-0.5">
              {casos.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setCasoId(c.id)}
                    className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${c.id === casoId ? "bg-primary/10 text-primary font-semibold" : "hover:bg-accent/60 text-foreground"}`}
                  >
                    <Scale className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{c.nombre}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteCaso(c.id); }}
                      className="hidden group-hover:flex size-4 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                      aria-label="Eliminar caso"
                    >
                      <X className="size-3" />
                    </button>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </aside>

        {/* ─── Área principal ─── */}
        {!caso ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 overflow-y-auto">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
              <Gavel className="size-8 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold">Análisis Jurídico de Alto Nivel</p>
              <p className="mt-1 text-sm text-muted-foreground">Elige una plantilla o crea un caso en blanco</p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-lg sm:grid-cols-2">
              {PLANTILLAS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => newCaso(p)}
                  className="rounded-lg border border-border bg-background p-3 text-left hover:bg-accent/60 hover:border-primary/40 transition-colors"
                >
                  <p className="text-sm font-semibold">{p.nombre}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-4">{p.descripcion}</p>
                </button>
              ))}
            </div>
            <Button variant="outline" onClick={() => newCaso()} className="gap-2 mt-2">
              <Plus className="size-4" />Caso en blanco
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">

            {/* Nombre del caso editable + exportar */}
            <div className="flex items-center gap-2">
              <Scale className="size-4 text-primary shrink-0" />
              <input
                value={caso.nombre}
                onChange={(e) => updateCaso(caso.id, (c) => ({ ...c, nombre: e.target.value }))}
                className="flex-1 bg-transparent text-sm font-semibold outline-none border-b border-transparent focus:border-border"
                aria-label="Nombre del caso"
              />
              {caso.messages.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs shrink-0"
                  onClick={exportCaso}
                  title="Exportar análisis como Markdown"
                >
                  <Download className="size-3" />Exportar
                </Button>
              )}
            </div>

            {/* Panel de documentos */}
            <Card className="p-3">
              <button
                onClick={() => setDocsOpen((o) => !o)}
                className="flex w-full items-center gap-2 text-xs font-semibold"
              >
                <FileText className="size-3.5 text-primary" />
                <span>Documentos del caso ({caso.docs.length})</span>
                <span className="ml-auto">{docsOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</span>
              </button>

              {docsOpen && (
                <div className="mt-2 space-y-1.5">
                  {caso.docs.length === 0 && (
                    <p className="text-xs text-muted-foreground">Sin documentos. Añade contratos, sentencias, escritos o cualquier archivo legal.</p>
                  )}
                  {caso.docs.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      <span className="shrink-0 text-muted-foreground">{fmt(d.size)}</span>
                      <button onClick={() => removeDoc(d.id)} aria-label="Quitar documento" className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.txt,.md,.odt,.rtf,.json,.csv,.htm,.html"
                      className="hidden"
                      onChange={(e) => void handleFiles(e.target.files)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                      {uploading ? "Procesando…" : "Añadir documentos"}
                    </Button>
                    <span className="text-xs text-muted-foreground">PDF, Word, TXT, MD… (máx. 20 MB c/u)</span>
                  </div>
                </div>
              )}
            </Card>

            {/* Área de chat */}
            <Card className="flex min-h-0 flex-1 flex-col p-0 overflow-hidden">
              {/* Aviso IA jurídica */}
              {caso.messages.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                    <BookOpen className="size-6 text-primary" />
                  </div>
                  <p className="text-sm font-semibold">IA Jurídica de Alto Nivel</p>
                  <p className="text-xs text-muted-foreground max-w-sm">
                    Analiza contratos, sentencias, escritos judiciales y cualquier documento legal.
                    Cita jurisprudencia del TS, TC, TJUE y TEDH. Sube los documentos del caso y haz tu consulta.
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2 w-full max-w-md">
                    {[
                      "¿Es válida la cláusula de penalización de este contrato?",
                      "¿Qué plazos tengo para recurrir esta resolución?",
                      "Analiza los fundamentos jurídicos de esta demanda",
                      "¿Procede el despido disciplinario según estos hechos?",
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => { setInput(q); textareaRef.current?.focus(); }}
                        className="rounded-lg border border-border bg-background p-2 text-left text-xs hover:bg-accent/60 leading-4"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mensajes */}
              {caso.messages.length > 0 && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                  {caso.messages.map((m) => (
                    <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      {m.role === "assistant" && (
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                          <Scale className="size-4 text-primary" />
                        </div>
                      )}
                      <div className={`group relative max-w-[85%] rounded-xl px-3 py-2.5 text-sm ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground leading-6 whitespace-pre-wrap"
                          : "bg-card border border-border"
                      }`}>
                        {m.role === "assistant" ? (
                          m.content ? (
                            <>
                              <div>{renderMarkdown(m.content)}</div>
                              <button
                                onClick={() => copyMessage(m.id, m.content)}
                                className="absolute top-2 right-2 hidden group-hover:flex size-6 items-center justify-center rounded border border-border bg-background/80 text-muted-foreground hover:text-foreground"
                                title="Copiar análisis"
                              >
                                {copiedId === m.id ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                              </button>
                            </>
                          ) : sending ? (
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Loader2 className="size-3.5 animate-spin" />Analizando…
                            </span>
                          ) : ""
                        ) : (
                          <span className="leading-6 whitespace-pre-wrap">{m.content}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" />
                  {error}
                  <button onClick={() => setError("")} className="ml-auto"><X className="size-3" /></button>
                </div>
              )}

              {/* Input */}
              <div className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="shrink-0 flex size-8 items-center justify-center rounded-lg border border-border hover:bg-accent/60 text-muted-foreground"
                    aria-label="Adjuntar documento"
                  >
                    <Paperclip className="size-4" />
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Haz tu consulta jurídica… (Enter para enviar, Shift+Enter para nueva línea)"
                    rows={2}
                    className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary placeholder:text-muted-foreground"
                    disabled={sending}
                  />
                  <Button
                    size="icon"
                    className="size-8 shrink-0"
                    disabled={!input.trim() || sending}
                    onClick={() => void send()}
                    aria-label="Enviar consulta"
                  >
                    {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  </Button>
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Análisis orientativo. Para actuaciones judiciales, consulta con un abogado colegiado.
                </p>
              </div>
            </Card>

          </div>
        )}
      </div>
    </div>
  );
}
