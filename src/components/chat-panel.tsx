// CONVERSACIÓN DE WILLY (ChatPanel): los mensajes, la IA que contesta (tu equipo o una externa), la voz, los adjuntos, las
// sugerencias y el paso a SUPER WILLY. Antes vivía dentro de routes/app.tsx junto al armazón de pantallas; desde el 25/09/2026
// está aquí (petición de la regla 45 de COORDINACION-IAS.md) para que el armazón nuevo y la lógica del chat no se pisen en el
// mismo archivo. El código es el mismo de siempre: solo ha cambiado de sitio.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp, Bot, ChevronDown, Code2, Cpu, Download, FileText, Mail, MessageSquare, Paperclip, Plus, Search, Sparkles, Square, Upload, X, Mic,
  Volume2, Cloud, Check, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { formatBytes } from "@/lib/profile";
import { copyText, downloadFile, type Settings as WorkspaceSettings } from "@/lib/workspace-store";
import { chatLocalStream, listLocalModels, resolveLocalModel, type ChatMsg } from "@/lib/local-ai";
import { useLocalModels } from "@/lib/use-local-models";
import { AnswerBody } from "@/components/answer-body";
import { projectActionOf, sendToSuperWilly, urlsOf, type HandoffAttachment } from "@/lib/super-willy-handoff";
import { CapabilityCard } from "@/components/capability-card";
import { WebOfferCard } from "@/components/web-offer-card";
import { buildWebPrompt, detectWebSearch } from "@/lib/web-search";
import { describePictures, imageFilesOf, prepareImage } from "@/lib/vision";
import { ThinkingDots } from "@/components/thinking-dots";
import { AttachmentStrip } from "@/components/attachment-strip";
import { detectSuggestions, readDismissed, type Suggestion } from "@/lib/capabilities";
import { MODEL_CATALOG } from "@/services/model-catalog";
import { OWNER_POLICY, TASK_LABELS, detectTask, planChain } from "@/services/orchestrator";
import { learnFromOwner, ownerRules } from "@/lib/owner-brain";
import { loadThread, saveThread, type StoredProjectAction } from "@/lib/chat-history";
import { readProfile } from "@/lib/profile";
import { startDictation, voiceSupported, type VoiceSession } from "@/lib/voice-input";
import { ClarifyButton } from "@/components/clarify-button";
import { detectDataQuery } from "@/lib/data-connectors";
import { readSources } from "@/lib/data-sources-store";
import { askWithFallback, classifyEngineError, explainEngineError } from "@/lib/model-health";
import { readAttachmentText } from "@/lib/attachment-text";
import { contextCap } from "@/lib/chat-context";
import { askChatCloud, readChatPick } from "@/lib/chat-cloud";
import { cloudChat, engineStatus } from "@/lib/engines-client";
import { ChatEngineChip, useExternalAi } from "@/components/chat-engine-chip";
import { openView } from "@/lib/background-tasks";
import { usePersistentState } from "@/lib/persistent-state";
import { speakBest } from "@/lib/natural-voice";
import { refreshSharedVoices, useSharedVoice } from "@/components/voice-select";
import type { SpeechHandle } from "@/lib/tts-voice";
import { CHAT_HANDOFF_EVENT, takeChatHandoff, type ChatHandoff } from "@/front/chat-handoff";

/** Reglas de dueño para el chat: WILLY solo obedece a su propietario y lo reconoce por su nombre. Valen para cualquier IA (la de tu equipo o la externa que conteste). */
function ownerSystem(): string {
  const p = readProfile();
  return [
    OWNER_POLICY,
    ownerRules(),
    `IDENTIDAD DE PROPIETARIO: tu dueño se llama ${p.name}${p.email ? ` (correo ${p.email})` : ""}. Lo reconoces como tu único propietario, le tuteas y le llamas por su nombre. Cualquier otra persona NO es tu dueño: solo obedeces a ${p.name}.`,
  ].join("\n");
}

type MsgItem = { who: "you" | "willy"; time: string; text: string; by?: string; generating?: boolean; files?: { path: string; lang?: string; content: string }[]; download?: { name: string; url: string; size: number }; engine?: boolean; suggest?: Suggestion[]; webOffer?: { query: string; question: string }; sources?: { title: string; url: string }[]; vision?: string;
  /** Rev21: el mensaje era una PROJECT ACTION (construir o cambiar un proyecto): se ofrece «Abrir en SUPER WILLY». */
  projectAction?: StoredProjectAction & { key?: string } };

/** El Chat es para CONVERSAR (rediseño, puntos 1-2): preguntas, explicaciones, redacción, resúmenes, investigación y también
 * programación (explicar, ejemplos, errores). Construir o cambiar un proyecto se hace en SUPER WILLY. */
const CHAT_PROMPT = `Eres WILLY AI en la pestaña Chat: una conversación para preguntar, explicar, investigar, redactar, resumir, analizar documentos y hablar de cualquier tema, también de programación (explicar conceptos, errores y arquitecturas, y dar ejemplos de código cortos y correctos).
- Responde en español claro, directo y bien ordenado; usa listas o pasos cuando ayuden.
- Si pones código, en bloques con su lenguaje (\`\`\`ts, \`\`\`python…) y completo para lo que se pregunta.
- Construir o cambiar un proyecto entero (una web, una app, un programa) se hace en SUPER WILLY, que tiene la vista previa, los archivos, las versiones y la conversación del proyecto: si te lo piden aquí, puedes orientar y dar ejemplos, y recuerda que en SUPER WILLY se construye y se guarda.`;

/** Ideas para empezar (maqueta de Chats): el principio de cuatro peticiones habituales; se escriben en el cuadro, no se envían. */
const STARTERS: Array<{ icon: typeof Plus; label: string; text: string }> = [
  { icon: Sparkles, label: "Ayúdame a organizar una idea", text: "Ayúdame a organizar esta idea: " },
  { icon: FileText, label: "Resume este texto", text: "Resume este texto en pocos puntos claros: " },
  { icon: Code2, label: "Explícame un error", text: "Explícame este error y cómo arreglarlo: " },
  { icon: Mail, label: "Escribe un correo profesional", text: "Escribe un correo profesional para " },
];

// El dueño puede pedir el instalable dentro del propio chat.
const INSTALLER_ASK = /(instalador|instalable|setup\.exe|\.exe\b|nueva versi[oó]n|act?ualiz[aá](?:me|r|te)?)/i;

async function buildInstallerHere(): Promise<{ ok: true; name: string; url: string; size: number; version: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/build-installer", { method: "POST" });
    const data = (await res.json()) as { ok?: boolean; error?: string; name?: string; url?: string; size?: number; version?: string };
    if (!res.ok || !data.ok || !data.name || !data.url) return { ok: false, error: data.error ?? "No se pudo generar el instalador." };
    return { ok: true, name: data.name, url: data.url, size: data.size ?? 0, version: data.version ?? "" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function ChatPanel({ ping, settings, updateSettings, threadId, onBusy, embedded = false }: {
  ping: (m: string) => void;
  settings: WorkspaceSettings; updateSettings: (p: Partial<WorkspaceSettings>) => void;
  threadId: string;
  onBusy: (busy: boolean) => void;
  /** Dentro de la pantalla Chats del armazón nuevo (que ya pone el título): solo la barra fina con buscar y exportar. */
  embedded?: boolean;
}) {
  const { models: chatModelList } = useLocalModels(settings.endpoint);
  // Si la IA externa está en uso, el globo del modelo local desaparece de la fila de abajo.
  const externalAi = useExternalAi();
  const [messages, setMessages] = useState<MsgItem[]>([]);
  const [draft, setDraft] = usePersistentState("chat:borrador", "");
  const draftRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<{ name: string; size: number; file: File }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [chip, setChip] = useState<null | "ajustar" | "contexto" | "herramientas" | "modelo">(null);
  // Adjuntos de una PROJECT ACTION, por si se abre en SUPER WILLY (solo mientras la página siga abierta).
  const heldFiles = useRef<Map<string, File[]>>(new Map());
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusy(busy); }, [busy]);
  const [fixing, setFixing] = useState(false);
  const [listening, setListening] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const voiceRef = useRef<VoiceSession | null>(null);

  // Leer las respuestas en voz alta con una voz natural (nunca la de Windows): la misma voz elegida
  // aquí vale también en Lectura, Libros, OCR, Nuevas funciones y Traducir (se guarda en el equipo).
  // (Misma voz en todas las pestañas y al momento en todas: components/voice-select.tsx.)
  const { voice: narrator, setVoice: setNarrator, voices } = useSharedVoice();
  const [autoVoice, setAutoVoiceState] = useState(false);
  const setAutoVoice = (on: boolean) => { setAutoVoiceState(on); window.localStorage.setItem("willy-chat-voz-auto", on ? "si" : "no"); };
  useEffect(() => { setAutoVoiceState(window.localStorage.getItem("willy-chat-voz-auto") === "si"); }, []);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const activeSpeech = useRef<SpeechHandle | null>(null);
  const autoSpoken = useRef<Set<number>>(new Set());
  useEffect(() => () => activeSpeech.current?.stop(), []);

  const speakMsg = (idx: number, text: string) => {
    activeSpeech.current?.stop();
    setSpeakingIdx(idx);
    activeSpeech.current = speakBest(text, {
      ...(narrator ? { naturalVoice: narrator } : {}),
      onPreparing: (m) => ping(m),
      onEnd: () => setSpeakingIdx(null),
      onError: (m) => { setSpeakingIdx(null); ping(`⚠️ ${m}`); },
    });
  };
  const stopSpeak = () => { activeSpeech.current?.stop(); activeSpeech.current = null; setSpeakingIdx(null); };

  // Con «leer automáticamente» activado, cada respuesta nueva de WILLY se escucha sola en cuanto termina.
  useEffect(() => {
    if (!autoVoice || !messages.length) return;
    const idx = messages.length - 1;
    const last = messages[idx];
    if (last && last.who === "willy" && !last.generating && last.text.trim() && !autoSpoken.current.has(idx)) {
      autoSpoken.current.add(idx);
      speakMsg(idx, last.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, autoVoice]);

  // Cargar el chat guardado al abrir o al cambiar de conversación.
  useEffect(() => {
    const saved = loadThread(threadId);
    setMessages(saved ? saved.messages : []);
  }, [threadId]);

  // Guardar cada mensaje en el equipo: lo que hablas no se borra nunca.
  useEffect(() => {
    if (!messages.length) return;
    const timer = window.setTimeout(() => {
      saveThread(threadId, messages.map(({ who, time, text, files, download, by, projectAction }) => ({ who, time, text, ...(files?.length ? { files: files.map((f) => ({ path: f.path, content: f.content })) } : {}), ...(download ? { download } : {}), ...(by ? { by } : {}), ...(projectAction ? { projectAction: { text: projectAction.text, action: projectAction.action, files: projectAction.files, state: projectAction.state } } : {}) })));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [messages, threadId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => () => voiceRef.current?.stop(), []);

  const toggleDictation = () => {
    if (listening) {
      voiceRef.current?.stop();
      voiceRef.current = null;
      setListening(false);
      ping("Dictado detenido.");
      return;
    }
    if (!voiceSupported()) {
      ping("Este navegador no permite usar el micrófono. Prueba con Chrome, Edge o Firefox.");
      return;
    }
    const session = startDictation({
      lang: "es-ES",
      onText: (text) => setDraft((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${text}`),
      onStatus: (message) => ping(message),
      onError: (message) => {
        setListening(false);
        voiceRef.current = null;
        ping(message);
      },
      onEnd: () => {
        setListening(false);
        voiceRef.current = null;
      },
    });
    if (!session) {
      ping("No se pudo iniciar el micrófono.");
      return;
    }
    voiceRef.current = session;
    setListening(true);
    ping("Micrófono activo. Ya puedes hablar.");
  };

  const addFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setAttachments((a) => [...a, ...files.map((f) => ({ name: f.name, size: f.size, file: f }))]);
    ping(files.length === 1 ? `Archivo «${files[0]!.name}» adjuntado.` : `${files.length} archivos adjuntados.`);
  };

  const updateLast = (fn: (m: MsgItem) => MsgItem) =>
    setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));

  /** Busca en internet, lee las mejores páginas y responde con el modelo local citando las fuentes. */
  const answerFromWeb = async (query: string, question: string, given?: AbortController, source?: { connector: string; params: Record<string, string> }) => {
    if (!given && busy) { ping("Espera a que termine la respuesta actual."); return; }
    const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    const controller = given ?? new AbortController();
    if (!given) {
      abortRef.current = controller;
      setBusy(true);
      setMessages((m) => [...m, { who: "willy", time, text: "", generating: true }]);
    }
    updateLast((m) => ({ ...m, generating: true, text: source ? `📡 Consultando ${query}…` : `🔎 Buscando en internet: «${query}»…` }));
    try {
      const res = await fetch("/api/fetch-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(source ? { connector: source.connector, params: source.params } : { ask: query }), signal: controller.signal });
      const data = (await res.json().catch(() => ({}))) as { error?: string; source?: string; results?: { title: string; url: string; snippet: string }[]; pages?: { title: string; url: string; text: string }[] };
      if (!res.ok || data.error) throw new Error(data.error ?? `La búsqueda respondió ${res.status}.`);
      const pages = data.pages?.length ? data.pages : (data.results ?? []).slice(0, 4).map((r) => ({ title: r.title, url: r.url, text: r.snippet }));
      if (!pages.length) throw new Error("No he encontrado resultados. Prueba con otras palabras.");
      updateLast((m) => ({ ...m, text: `📚 He leído ${pages.length} fuente(s) (${data.source ?? "internet"}). Preparando la respuesta…`, sources: pages.map((p) => ({ title: p.title, url: p.url })) }));
      const prompt = buildWebPrompt(question, pages);
      const model = await resolveLocalModel(settings.endpoint, settings.model);
      let started = false;
      const run = (numCtx?: number) => chatLocalStream({
        endpoint: settings.endpoint,
        model,
        messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
        signal: controller.signal,
        ...(numCtx ? { numCtx } : {}),
        onDelta: (delta) => { const first = !started; started = true; updateLast((m) => ({ ...m, text: (first ? "" : m.text) + delta })); },
      });
      let full: string;
      try { full = await run(8192); } catch (error) { if (controller.signal.aborted || started) throw error; full = await run(); }
      updateLast((m) => ({ ...m, generating: false, text: m.text.trimEnd() || full }));
      ping(`Respuesta con ${pages.length} fuente(s) de internet.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted) updateLast((m) => ({ ...m, generating: false, text: `${m.text.trimEnd()}\n\n⏹️ Detenido.` }));
      else updateLast((m) => ({ ...m, generating: false, text: `⚠️ No he podido ${source ? "consultar la fuente de datos" : "buscar en internet"}: ${detail}` }));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attachments.length) || busy) return;
    const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    const attachLines = attachments.map((f) => `📎 ${f.name} · ${formatBytes(f.size)}`).join("\n");
    const body = [text, attachLines].filter(Boolean).join("\n");
    const carried = attachments.slice();
    setDraft("");
    setAttachments([]);
    // PROJECT ACTION («créame una web», «arregla mi app», «desarróllalo»): se construye en SUPER WILLY. El Chat no llama a
    // ninguna IA: ofrece «Abrir en SUPER WILLY» (con solo lo necesario) o «Responder aquí igualmente».
    // (Lo que habla de WILLY mismo —«dame el instalador de WILLY», «actualiza WILLY»— no es un proyecto: lo atiende el Chat.)
    const action = text && !/\bwilly\b/i.test(text) ? projectActionOf(text) : null;
    if (action) {
      const prev = [...messages].reverse().find((m) => m.who === "you" && m.text.trim())?.text ?? "";
      const continuing = action === "continuar" && Boolean(prev.trim());
      const request = continuing ? `${prev}\n\n${text}` : text;
      const kindNow: StoredProjectAction["action"] = action === "continuar" ? (continuing && projectActionOf(prev) === "nuevo" ? "nuevo" : "cambio") : action;
      const key = `pa-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      heldFiles.current.set(key, carried.map((c) => c.file));
      setMessages((m) => [...m, { who: "you", time, text: body }, { who: "willy", time, text: "", projectAction: { key, text: request, action: kindNow, files: carried.map((c) => c.name), state: "pendiente" } }]);
      return;
    }
    setMessages((m) => [...m, { who: "you", time, text: body }]);
    await reply(text, body, carried, time);
  };

  /** «Abrir en SUPER WILLY»: le pasa la petición, sus adjuntos (con su texto), sus imágenes y sus enlaces; nada más. */
  const openInSuperWilly = async (idx: number) => {
    const card = messages[idx]?.projectAction;
    if (!card || card.state === "enviado") return;
    const files = card.key ? heldFiles.current.get(card.key) ?? [] : [];
    const images = files.filter((f) => f.type.startsWith("image/"));
    const docs: HandoffAttachment[] = [];
    for (const f of files.filter((x) => !x.type.startsWith("image/"))) {
      const read = await readAttachmentText([f], { budgetChars: 8000, modelLabel: "SUPER WILLY" }).catch(() => ({ blocks: [] as string[], notes: [] as string[] }));
      docs.push({ name: f.name, text: (read.blocks[0] ?? "").replace(/^--- [^\n]* ---\n/, "") });
    }
    setMessages((prev) => prev.map((m, i) => (i === idx && m.projectAction ? { ...m, projectAction: { ...m.projectAction, state: "enviado" } } : m)));
    if (card.files.length && !files.length) ping("Los adjuntos de ese mensaje ya no están (se recargó la página): vuelve a añadirlos en SUPER WILLY.");
    sendToSuperWilly({ text: card.text, action: card.action, attachments: docs, images, urls: urlsOf(card.text), from: "chat" });
  };

  /** «Responder aquí igualmente»: el Chat contesta como conversación (sin construir ni guardar nada en un proyecto). */
  const answerHere = async (idx: number) => {
    const card = messages[idx]?.projectAction;
    if (!card || busy) return;
    const files = card.key ? heldFiles.current.get(card.key) ?? [] : [];
    setMessages((prev) => prev.map((m, i) => (i === idx && m.projectAction ? { ...m, projectAction: { ...m.projectAction, state: "aqui" } } : m)));
    const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    await reply(card.text, messages[idx - 1]?.text ?? card.text, files.map((f) => ({ name: f.name, size: f.size, file: f })), time);
  };

  /** La conversación de siempre: WILLY contesta en el Chat. */
  const reply = async (sent: string, body: string, carried: { name: string; size: number; file: File }[], time: string) => {
    setBusy(true);
    setMessages((m) => [...m, { who: "willy", time, text: "", generating: true }]);
    // ¿Falta algo para hacer bien esta petición? Se ofrece instalarlo con un clic; nunca se descarga nada sin pulsar el botón.
    void (async () => {
      const installedNow = await listLocalModels(settings.endpoint);
      const found = detectSuggestions({ text: sent, hasImages: carried.some((f) => f.file.type.startsWith("image/")), currentModel: settings.model, installed: installedNow, dismissed: readDismissed() }, MODEL_CATALOG);
      if (found.length) updateLast((m) => ({ ...m, suggest: found }));
    })();
    // El botón de stop corta la generación en marcha sin borrar lo escrito.
    const controller = new AbortController();
    abortRef.current = controller;
    const stopped = () => controller.signal.aborted;

    // "Dame el instalador / actualízate": lo prepara aquí mismo y da un botón de descarga.
    if (INSTALLER_ASK.test(sent)) {
      const built = await buildInstallerHere();
      if (built.ok) {
        const mb = (built.size / (1024 * 1024)).toFixed(1);
        updateLast((m) => ({
          ...m,
          generating: false,
          download: { name: built.name, url: built.url, size: built.size },
          text: `✅ Listo. He generado el instalador de la versión ${built.version} (${mb} MB) en tu equipo. Pulsa «Descargar» aquí mismo, ejecuta el archivo y se instala solo: cierra la versión anterior, la sustituye y abre WILLY AI en localhost:3000 sin que tengas que hacer nada más.`,
        }));
      } else {
        updateLast((m) => ({ ...m, generating: false, text: `⚠️ No he podido generar el instalador en este momento. ${built.error}` }));
      }
      ping("Instalador preparado en el chat.");
      setBusy(false);
      return;
    }


    // «Busca en internet…»: se hace la búsqueda pedida y se responde citando las fuentes.
    // Si el mensaje solo se beneficiaría de datos actuales, se ofrece un botón y no se envía nada sin pulsarlo.
    // Datos en tiempo real (tiempo, divisas, terremotos, precio de la luz…): se consulta la fuente adecuada y se responde citándola.
    const live = detectDataQuery(sent, readSources());
    if (live) {
      await answerFromWeb(live.connector.name, sent, controller, { connector: live.connector.id, params: live.params });
      return;
    }

    const web = detectWebSearch(sent);
    if (web?.explicit) {
      await answerFromWeb(web.query, sent, controller);
      return;
    }
    if (web) updateLast((m) => ({ ...m, webOffer: { query: web.query, question: sent } }));

    // Imágenes adjuntas o pegadas (Win+Shift+S y Ctrl+V): un modelo con visión las describe y la descripción acompaña a la pregunta.
    let visionNote = "";
    const pictureFiles = carried.filter((entry) => entry.file.type.startsWith("image/")).slice(0, 3);
    if (pictureFiles.length) {
      updateLast((m) => ({ ...m, generating: true, text: "🖼️ Preparando tus imágenes…" }));
      try {
        const prepared = await Promise.all(pictureFiles.map((entry, index) => prepareImage(entry.file, entry.name || `imagen-${index + 1}.jpg`)));
        const seen = await describePictures({ endpoint: settings.endpoint, currentModel: settings.model, pictures: prepared, signal: controller.signal, onStage: (stage) => updateLast((m) => ({ ...m, text: stage })) });
        if (!seen.ok) {
          updateLast((m) => ({ ...m, generating: false, text: controller.signal.aborted ? "⏹️ Detenido." : `⚠️ ${seen.error}` }));
          setBusy(false);
          return;
        }
        visionNote = seen.text;
        setMessages((prev) => prev.map((m, i) => (i === prev.length - 2 ? { ...m, vision: visionNote } : m)));
        updateLast((m) => ({ ...m, text: "" }));
      } catch (error) {
        updateLast((m) => ({ ...m, generating: false, text: controller.signal.aborted ? "⏹️ Detenido." : `⚠️ No pude leer las imágenes: ${error instanceof Error ? error.message : String(error)}` }));
        setBusy(false);
        return;
      }
    }

    // Motor local real (Ollama / LM Studio), sin conexiones externas.
    let streamed = false;
    try {
      // Adjuntos de cualquier formato (PDF, Word, EPUB, código…), sin tope de 200 KB: se lee el archivo entero y se le pasa al modelo lo
      // que le cabe según su memoria de contexto, avisando de lo que se recorta.
      const attached = await readAttachmentText(carried.filter((f) => !f.file.type.startsWith("image/")).map((f) => f.file), { budgetChars: Math.max(4000, Math.min(36000, (contextCap(settings.model) - 2600) * 3)), modelLabel: settings.model });
      if (attached.notes.length) ping(attached.notes.join(" "));
      const contextFiles = [...attached.blocks, ...attached.notes.map((n) => `(Nota sobre los adjuntos: ${n})`)];
      // Las tarjetas «Esto es un proyecto» (sin texto) no son conversación; y si lo último es tu propio mensaje (la petición de una
      // tarjeta que se responde aquí), no se repite: va como mensaje actual.
      const history: ChatMsg[] = messages.filter((m) => m.text.trim() && !m.projectAction && !m.generating).slice(-8).map((m) => ({
        role: m.who === "you" ? "user" : "assistant",
        // La descripción de las imágenes de un mensaje anterior se conserva para las preguntas siguientes.
        content: m.vision ? `${m.text}\n\n${m.vision}` : m.text,
      }));
      while (history.at(-1)?.role === "user") history.pop();
      const request = [sent || (visionNote ? "Mira las imágenes adjuntas y ayúdame." : "Analiza los archivos adjuntos y propón los cambios."), ...contextFiles, visionNote].filter(Boolean).join("\n\n");
      // Si lo que dices es una regla («a partir de ahora…», «recuerda que…», «nunca…»), se aprende para todas las IA y todos los chats.
      const learned = sent ? learnFromOwner(sent, "chat del PC") : null;
      if (learned) ping(`📌 Aprendido para todas las IA: «${learned.length > 90 ? `${learned.slice(0, 89)}…` : learned}»`);
      const aiMessages: ChatMsg[] = [
        {
          role: "system",
          content: [ownerSystem(), CHAT_PROMPT].join("\n\n"),
        },
        ...history,
        { role: "user", content: request },
      ];
      const onAiDelta = (delta: string) => {
        streamed = true;
        updateLast((m) => ({ ...m, text: m.text + delta }));
      };
      // IA externa (Gemini, Groq…): SOLO si la eliges en el chat y el interruptor general de motores externos está activo. Si responde, se
      // usa esa respuesta; si ninguna puede, el chat sigue con tu IA local como siempre.
      // «Plug and play»: WILLY elige la IA según lo que pides (código, redacción, traducción…). Los datos personales y los adjuntos no salen.
      let smartLocal = "";
      // Qué IA ha respondido de verdad: se enseña con su nombre junto a la respuesta.
      let cloudBy = "";
      const smartOn = readChatPick() === "smart";
      const smartInstalled = smartOn ? await listLocalModels(settings.endpoint).catch(() => [] as string[]) : [];
      const cloudFull = await askChatCloud({
        pick: readChatPick(),
        messages: aiMessages,
        status: engineStatus,
        ask: (id, msgs, maxTokens) => cloudChat(id, msgs, maxTokens),
        notify: ping,
        onText: (text) => { streamed = true; updateLast((m) => ({ ...m, text })); },
        signal: controller.signal,
        ...(smartOn ? { smart: { text: sent, kind: detectTask(sent), labelOf: (k: string) => TASK_LABELS[k as keyof typeof TASK_LABELS] ?? k, hasAttachments: carried.some((f) => !f.file.type.startsWith("image/")), installed: smartInstalled, localPlan: (k: string) => planChain(k as Parameters<typeof planChain>[0], undefined, smartInstalled) } } : {}),
        onLocal: (m) => { smartLocal = m; },
        onAnswered: (engine, model) => { cloudBy = `${engine} · ${model}`; },
        // Una web completa no cabe en 4.000 tokens: se pide el máximo que admita cada IA (el servidor lo ajusta a cada una).
        maxTokens: 16000,
      });
      const activeModel = cloudFull !== null ? settings.model : await resolveLocalModel(settings.endpoint, smartLocal || settings.model);
      if (!smartLocal && activeModel !== settings.model) updateSettings({ model: activeModel });
      let usedLocal = activeModel;
      // Si el modelo elegido no se puede cargar en este equipo (por ejemplo llama3.2-vision con la arquitectura «mllama»), NO es que el
      // motor esté parado: se apunta, se avisa y se sigue con el siguiente modelo, sin que tengas que hacer nada.
      const answered = cloudFull !== null ? { value: cloudFull } : await askWithFallback({
        model: activeModel,
        ask: (model) => chatLocalStream({ endpoint: settings.endpoint, model, messages: aiMessages, onDelta: onAiDelta, signal: controller.signal }),
        installed: () => listLocalModels(settings.endpoint),
        rank: (list) => planChain("general", undefined, list),
        canRetry: () => !streamed && !stopped(),
        onSwitch: (from, to, _kind, arch) => {
          usedLocal = to;
          updateSettings({ model: to });
          ping(`«${from}» no se puede cargar en tu equipo${arch ? ` (arquitectura «${arch}»)` : ""}. Sigo con «${to}».`);
        },
      });
      const full = answered.value;
      const by = cloudFull !== null ? (cloudBy || "IA externa") : `Tu equipo · ${usedLocal}`;

      // Si trae archivos, se ven y se descargan en el propio mensaje: el Chat no los guarda en ningún proyecto (eso es SUPER WILLY).
      updateLast((m) => ({ ...m, by, generating: false, text: m.text.trimEnd() || full }));
      ping(cloudFull !== null ? `Respuesta completada con ${cloudBy || "la IA externa que elegiste"}.` : "Respuesta completada con tu IA local.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (stopped()) {
        // Stop pulsado: se conserva lo ya escrito y se marca como detenido.
        updateLast((m) => ({ ...m, generating: false, text: `${m.text.trimEnd()}\n\n⏹️ Generación detenida.` }));
        ping("Generación detenida. Puedes seguir escribiendo cuando quieras.");
      } else if (streamed) {
        updateLast((m) => ({ ...m, generating: false, text: `${m.text.trimEnd()}\n\n⚠️ La conexión con la IA se ha interrumpido: ${detail}` }));
        ping("Conexión con la IA interrumpida.");
      } else {
        const info = classifyEngineError(detail);
        const engineDown = info.kind === "parado" || info.kind === "otro";
        updateLast((m) => ({
          ...m,
          generating: false,
          ...(engineDown ? { engine: true } : {}),
          text: explainEngineError(info.kind, settings.model, detail, info.arch),
        }));
        ping(engineDown ? "El motor local no ha podido responder." : `El modelo «${settings.model}» no se puede usar ahora mismo.`);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
  };

  // Deja el motor de IA del equipo listo: lo instala, lo arranca y baja el primer modelo.
  const repairEngine = async () => {
    if (fixing) return;
    setFixing(true);
    ping("Preparando el motor de IA de tu equipo. Puede tardar unos minutos.");
    const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    try {
      const res = await fetch("/api/engine", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string; models?: string[]; pulling?: boolean; model?: string };
      if (!res.ok || !data.ok) {
        setMessages((m) => [...m, { who: "willy", time, text: `⚠️ ${data.error ?? "No he podido preparar el motor de IA."}`, engine: true }]);
      } else if (data.pulling) {
        setMessages((m) => [...m, { who: "willy", time, text: "✅ Motor de IA arrancado. Estoy descargando el primer modelo en segundo plano; en unos minutos podrás escribirme y te responderé." }]);
      } else {
        setMessages((m) => [...m, { who: "willy", time, text: `✅ Todo listo. El motor de IA está funcionando con «${data.model}». Escríbeme y te respondo.` }]);
      }
    } catch (error) {
      setMessages((m) => [...m, { who: "willy", time, text: `⚠️ No he podido preparar el motor: ${error instanceof Error ? error.message : String(error)}`, engine: true }]);
    } finally {
      setFixing(false);
    }
  };

  // Encargo desde Inicio (armazón nuevo): el texto y los adjuntos aparecen escritos y, si se pidió, se envían solos.
  const chatHandoff = useRef<ChatHandoff | null>(null);
  useEffect(() => {
    const take = () => {
      const h = takeChatHandoff();
      if (!h) return;
      chatHandoff.current = h;
      setDraft(h.text);
      if (h.files.length) setAttachments((a) => [...a, ...h.files.map((f) => ({ name: f.name, size: f.size, file: f }))]);
    };
    take();
    window.addEventListener(CHAT_HANDOFF_EVENT, take);
    return () => window.removeEventListener(CHAT_HANDOFF_EVENT, take);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);
  useEffect(() => {
    const h = chatHandoff.current;
    if (!h || !h.autoSend || busy || draft !== h.text) return;
    chatHandoff.current = null;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, attachments]);

  const exportChat = () => {
    const md = messages.map((m) => `**${m.who === "you" ? "Tú" : "WILLY AI"}** (${m.time})\n\n${m.text}`).join("\n\n---\n\n");
    downloadFile("conversacion-willy-ai.md", `# Conversación con WILLY AI\n\n${md}`, "text/markdown;charset=utf-8");
    ping("Conversación exportada a tu carpeta de descargas.");
  };

  const visible = searchQ.trim()
    ? messages.filter((m) => m.text.toLowerCase().includes(searchQ.trim().toLowerCase()))
    : messages;


  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background" aria-label="Chat con WILLY AI">
      <div className={`flex shrink-0 items-center gap-2 border-b border-border px-3 ${embedded ? "h-9 justify-end" : "h-11"}`}>
        {!embedded && <h2 className="flex-1 truncate text-sm font-semibold">Chat con WILLY AI</h2>}
        <Button variant="ghost" size="icon" className={`size-8 ${searchOpen ? "text-primary" : ""}`} onClick={() => { setSearchOpen((v) => !v); setSearchQ(""); }} aria-label="Buscar en la conversación"><Search className="size-4" /></Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={exportChat} aria-label="Exportar conversación"><Upload className="size-4" /></Button>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
          <Search className="size-3.5 text-muted-foreground" />
          <input autoFocus value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Buscar en los mensajes..." aria-label="Buscar en los mensajes" className="h-7 w-full bg-transparent text-sm outline-none" />
          {searchQ && <button onClick={() => setSearchQ("")} aria-label="Limpiar búsqueda"><X className="size-3.5 text-muted-foreground" /></button>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {visible.map((m, i) => (
            <Msg
              key={`${m.time}-${i}`}
              who={m.who}
              time={m.time}
              by={m.by}
              actions={
                m.who === "willy" && m.text.trim() && !m.generating ? (
                  <>
                    <button
                      onClick={() => (speakingIdx === i ? stopSpeak() : speakMsg(i, m.text))}
                      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${speakingIdx === i ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      aria-label={speakingIdx === i ? "Detener lectura en voz alta" : "Leer en voz alta"}
                      title={speakingIdx === i ? "Detener" : "Leer en voz alta"}
                    >
                      {speakingIdx === i ? <Square className="size-3.5" /> : <Volume2 className="size-3.5" />}
                    </button>
                    {/* Copiar la respuesta tal cual (como en la maqueta del dueño): el mismo copyText de siempre. */}
                    <button
                      onClick={() => void copyText(m.text).then((ok) => {
                        if (!ok) return;
                        setCopiedIdx(i);
                        window.setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 2000);
                      })}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      aria-label={copiedIdx === i ? "Respuesta copiada" : "Copiar respuesta"}
                      title={copiedIdx === i ? "Copiada" : "Copiar respuesta"}
                    >
                      {copiedIdx === i ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                    </button>
                  </>
                ) : null
              }
            >
              {m.text && <AnswerBody text={m.text} streaming={Boolean(m.generating)} />}
              {m.projectAction && (
                <ProjectActionCard
                  action={m.projectAction}
                  busy={busy}
                  onOpen={() => void openInSuperWilly(messages.indexOf(m))}
                  onHere={() => void answerHere(messages.indexOf(m))}
                />
              )}
              {m.download && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
                  <Download className="size-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">{m.download.name}</p>
                    <p className="text-[10px] text-muted-foreground">{(m.download.size / (1024 * 1024)).toFixed(1)} MB · instalable oficial de WILLY AI</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                    onClick={() => { window.location.href = m.download!.url; ping("Descargando instalador..."); }}
                    aria-label={`Descargar ${m.download.name}`}
                  >
                    <Download className="size-3.5" />Descargar
                  </Button>
                </div>
              )}
              {m.engine && (
                <div className="mt-2">
                  <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={fixing} onClick={() => void repairEngine()}>
                    {fixing ? "Preparando el motor..." : "Arrancar la IA de mi equipo"}
                  </Button>
                </div>
              )}
              {m.sources?.length ? (
                <div className="mt-2 rounded-lg border border-border bg-card p-2 text-xs">
                  <p className="font-semibold text-foreground">Fuentes</p>
                  <ol className="mt-1 space-y-0.5">
                    {m.sources.map((source, index) => (
                      <li key={source.url} className="truncate"><a href={/^https?:\/\//i.test(source.url) ? source.url : "#"} target="_blank" rel="noreferrer noopener" className="text-primary underline">[{index + 1}] {source.title}</a></li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {m.webOffer ? (
                <WebOfferCard query={m.webOffer.query} onSearch={() => void answerFromWeb(m.webOffer!.query, m.webOffer!.question)} />
              ) : null}
              {m.suggest?.length ? (
                <CapabilityCard suggestions={m.suggest} endpoint={settings.endpoint} ping={ping} onUse={(model) => { updateSettings({ model }); ping(`Ahora el chat usa ${model}.`); }} />
              ) : null}
              {m.generating && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ThinkingDots />
                </p>
              )}
            </Msg>
          ))}
          {searchQ && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">Ningún mensaje coincide con «{searchQ}».</p>
          )}
          {!searchQ && visible.length === 0 && (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Pide lo que necesites y WILLY lo hará. Nada más: no habla si no le preguntas. Todo lo que escribas se guarda automáticamente en «Recientes», así no se pierde nunca.
            </p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="safe-modal shrink-0 border-t border-border bg-card p-2.5 sm:p-3">
        <div className="mx-auto max-w-3xl">
          {!draft.trim() && (
            <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Ideas para empezar">
              {STARTERS.map((s) => (
                <Chip key={s.label} icon={s.icon} label={s.label} onClick={() => { setDraft(s.text); window.setTimeout(() => draftRef.current?.focus(), 0); }} />
              ))}
            </div>
          )}
          <div
            className={`rounded-lg border bg-background ${dragging ? "border-primary ring-2 ring-primary/30" : "border-input"}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          >
            <AttachmentStrip items={attachments} onRemove={(index) => setAttachments((a) => a.filter((_, j) => j !== index))} />
            <div className="flex items-center gap-2 px-3 py-2">
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} aria-hidden="true" />
            <input ref={draftRef} value={draft} onChange={(e) => setDraft(e.target.value)} onPaste={(e: { clipboardData: DataTransfer; preventDefault: () => void }) => { const pictures = imageFilesOf(e.clipboardData.files); if (!pictures.length) return; e.preventDefault(); setAttachments((a) => [...a, ...pictures.map((f, i) => ({ name: `captura-${a.length + i + 1}.png`, size: f.size, file: f }))]); ping("Captura añadida. Un modelo con visión la leerá al enviar."); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="Escribe un mensaje o arrastra archivos..." className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Mensaje para WILLY AI" />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => fileRef.current?.click()} aria-label="Adjuntar"><Paperclip className="size-4" /></Button>
            <Button
              variant={listening ? "secondary" : "ghost"}
              size="icon"
              className={`size-8 shrink-0 ${listening ? "text-primary ring-1 ring-primary/50" : ""}`}
              onClick={toggleDictation}
              aria-label={listening ? "Detener micrófono" : "Hablar por micrófono"}
              title={listening ? "Detener micrófono" : "Hablar por micrófono"}
            >
              <Mic className={`size-4 ${listening ? "animate-pulse" : ""}`} />
            </Button>
            <ClarifyButton context="chat" iconOnly value={draft} onApply={setDraft} />
            {busy && (
              <Button variant="outline" size="icon" className="size-8 shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10" onClick={stopGeneration} aria-label="Detener la IA" title="Detener la IA"><Square className="size-4" /></Button>
            )}
            <Button size="icon" className="size-8 shrink-0 rounded-full" onClick={() => void send()} disabled={busy || (!draft.trim() && !attachments.length)} aria-label="Enviar"><ArrowUp className="size-4" /></Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Menu
              up
              label="Voz que lee las respuestas"
              trigger={({ toggle }) => (
                <Chip
                  icon={Volume2}
                  label={autoVoice ? "Voz: automática" : "Voz"}
                  chevron
                  onClick={toggle}
                />
              )}
            >
              {(close) => (
                <>
                  <MenuLabel>Leer las respuestas en voz alta</MenuLabel>
                  <MenuItem onClick={() => setAutoVoice(!autoVoice)}>
                    <Volume2 className="size-4" />
                    <span className="truncate">{autoVoice ? "✓ Leer automáticamente" : "Leer automáticamente"}</span>
                  </MenuItem>
                  <MenuLabel>Voces en español de España</MenuLabel>
                  {voices?.installed.length ? (
                    voices.installed.map((v) => (
                      <MenuItem key={v.id} onClick={() => { setNarrator(v.id); close(); ping(`Voz activa: ${v.label ?? v.id}.`); }}>
                        <Volume2 className="size-4" />
                        <span className="truncate">{narrator === v.id ? "✓ " : ""}{v.label ?? v.id}</span>
                      </MenuItem>
                    ))
                  ) : (
                    <MenuItem onClick={() => { close(); refreshSharedVoices(); ping("Preparando voces naturales en español..."); }}>
                      <Volume2 className="size-4" />Preparar voces naturales
                    </MenuItem>
                  )}
                </>
              )}
            </Menu>
            <ChatEngineChip />
            <Menu up label="Ajustar la respuesta" trigger={({ toggle }) => <Chip icon={Plus} label="Ajustar" onClick={toggle} />}>
              {(close) => (
                <>
                  <MenuLabel>Peticiones rápidas</MenuLabel>
                  {["Haz la respuesta más breve y directa.", "Explícalo paso a paso con más detalle.", "Resúmelo en tres puntos."].map((t) => (
                    <MenuItem key={t} onClick={() => { close(); setDraft(t); }}>{t}</MenuItem>
                  ))}
                </>
              )}
            </Menu>
            <Menu up label="Contexto de la conversación" trigger={({ toggle }) => <Chip icon={MessageSquare} label="Contexto" onClick={toggle} />}>
              {(close) => (
                <>
                  <MenuLabel>Contexto actual</MenuLabel>
                  {externalAi.external
                    ? <MenuItem onClick={() => { close(); ping(`Contesta la IA externa: ${externalAi.summary}.`); }}><Cloud className="size-4 text-amber-600" /><span className="truncate text-xs">IA externa: {externalAi.summary}</span></MenuItem>
                    : <MenuItem onClick={() => { close(); ping(`Modelo en contexto: ${settings.model}`); }}><Cpu className="size-4" /><span className="truncate font-mono text-xs">{settings.model}</span></MenuItem>}
                  <MenuItem onClick={() => { close(); openView("superia"); }}><Sparkles className="size-4" /><span className="truncate">Proyectos: se construyen en SUPER WILLY</span></MenuItem>
                  <MenuItem onClick={() => { close(); ping("Adjunta archivos con el clip o arrastrándolos al mensaje."); }}><Paperclip className="size-4" />Añadir archivos al contexto</MenuItem>
                </>
              )}
            </Menu>
            {/* El globo del modelo local solo se ve cuando contesta tu equipo: con la IA externa en uso, desaparece. */}
            {!externalAi.external && (
              <Menu up label="Elegir modelo local" trigger={({ toggle }) => <Chip icon={Cpu} label={settings.model.split(":")[0] ?? "Olama"} chevron onClick={toggle} />}>
                {(close) => (
                  <>
                    <MenuLabel>Modelos locales</MenuLabel>
                    {chatModelList.map((name) => (
                      <MenuItem key={name} active={name === settings.model} onClick={() => { close(); updateSettings({ model: name }); ping(`Modelo activo: ${name}`); }}>
                        <Cpu className="size-4" /><span className="truncate font-mono text-xs">{name}</span>
                      </MenuItem>
                    ))}
                    {chatModelList.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Todavía no hay modelos en tu equipo (o su IA está parada).</p>}
                  </>
                )}
              </Menu>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Chip({ icon: Icon, label, chevron, onClick }: { icon: typeof Plus; label: string; chevron?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground">
      <Icon className="size-3.5" />{label}{chevron && <ChevronDown className="size-3" />}
    </button>
  );
}

/** PROJECT ACTION en el Chat (rev21): construir o cambiar un proyecto se hace en SUPER WILLY; aquí solo se ofrece llevarlo. */
function ProjectActionCard({ action, busy, onOpen, onHere }: { action: StoredProjectAction; busy: boolean; onOpen: () => void; onHere: () => void }) {
  const isNew = action.action === "nuevo";
  return (
    <div className="mt-1 rounded-xl border border-primary/40 bg-primary/5 p-3" role="region" aria-label="Esto es un proyecto">
      <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 shrink-0 text-primary" />{isNew ? "Esto es un proyecto" : "Esto es un cambio en un proyecto"}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isNew
          ? "Se construye en SUPER WILLY: con vista previa, archivos guardados, versiones y la conversación del proyecto. Antes de programar te hará unas preguntas (con su recomendación en cada una)."
          : "Se hace en SUPER WILLY, sobre los archivos de verdad del proyecto: con vista previa, cambios línea a línea y versiones que puedes restaurar."}
      </p>
      {action.files.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Se lleva también: {action.files.join(", ")}.</p>}
      {action.state === "pendiente" ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onOpen}><Sparkles className="size-3.5" />Abrir en SUPER WILLY</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={onHere}>Responder aquí igualmente</Button>
        </div>
      ) : action.state === "enviado" ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          ✓ Enviado a SUPER WILLY.
          <button type="button" className="text-primary underline" onClick={() => openView("superia")}>Ir a SUPER WILLY</button>
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Respondido aquí en el Chat (como conversación, sin guardar nada en un proyecto).</p>
      )}
    </div>
  );
}

function Msg({ who, time, by, actions, children }: { who: "you" | "willy"; time: string; by?: string | undefined; actions?: ReactNode; children: ReactNode }) {
  const external = !!by && !by.startsWith("Tu equipo");
  return (
    <article>
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${who === "you" ? "bg-primary text-primary-foreground" : "bg-accent text-primary"}`}>
          {who === "you" ? "TÚ" : <Bot className="size-4" />}
        </span>
        <span className="text-xs font-semibold">{who === "you" ? "Tú" : "WILLY AI"}</span>
        {/* Qué IA ha respondido de verdad, con su nombre: la de tu equipo o la externa que elegiste. */}
        {who === "willy" && by && (
          <span title={external ? "Respondió una IA externa: el mensaje salió de tu equipo" : "Respondió la IA de tu equipo: nada salió de tu ordenador"} className={`inline-flex min-w-0 max-w-[45%] items-center gap-1 truncate rounded-full border px-1.5 py-0.5 text-[10px] ${external ? "border-amber-500/50 text-amber-600" : "border-border text-muted-foreground"}`}>
            {external ? <Cloud className="size-3 shrink-0" /> : <Cpu className="size-3 shrink-0" />}<span className="truncate">{by}</span>
          </span>
        )}
        {actions}
        <span className="ml-auto text-[10px] text-muted-foreground">{time}</span>
      </div>
      <div className="pl-9">{children}</div>
    </article>
  );
}
