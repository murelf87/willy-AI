// WILLY AI Móvil (iPhone/Android): versión reducida para el teléfono.
// Solo chat con los modelos locales, subida de archivos, herramientas de Súper IA
// y traducción simultánea de YouTube. Sin creación de software ni autoconstrucción.

import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUp, Check, ChevronDown, Cpu, Loader2, MessageSquare, Paperclip, Plus,
  Smartphone, Sparkles, Square, Trash2, Youtube, Volume2, Cloud,
} from "lucide-react";
import { speakBest } from "@/lib/natural-voice";
import { refreshSharedVoices, useSharedVoice } from "@/components/voice-select";
import type { SpeechHandle } from "@/lib/tts-voice";
import { askChatCloud, readChatPick } from "@/lib/chat-cloud";
import { cloudChat, engineStatus } from "@/lib/engines-client";
import { ChatEngineChip, ExternalAiPanel, refreshExternalStatus, useExternalAi } from "@/components/chat-engine-chip";
import { BackgroundTray } from "@/components/background-tray";
import { OPEN_VIEW_EVENT, useBackgroundReport } from "@/lib/background-tasks";
import { ViewActiveContext } from "@/lib/view-active";
import { Button } from "@/components/ui/button";
import { SuperIAView } from "@/components/superia-view";
import { TranslateView } from "@/components/translate-view";
import { useSettings } from "@/lib/workspace-store";
import { chatLocalStream, resolveLocalModel, type ChatMsg } from "@/lib/local-ai";
import { describePictures, imageFilesOf } from "@/lib/vision";
import { useImages } from "@/lib/use-images";
import { ImageChips } from "@/components/image-chips";
import { ClarifyButton } from "@/components/clarify-button";
import { usePersistentState } from "@/lib/persistent-state";
import { useLocalModels } from "@/lib/use-local-models";
import { OWNER_POLICY } from "@/services/orchestrator";
import { readProfile } from "@/lib/profile";
import { learnFromOwner, loadOwnerBrain, ownerRules } from "@/lib/owner-brain";
import {
  CHAT_EVENT, deleteThread, listThreads, loadThread, newThreadId, saveThread,
  type ChatThread, type StoredMsg,
} from "@/lib/chat-history";
import { APP_VERSION } from "@/lib/version";

export const Route = createFileRoute("/movil")({
  head: () => ({
    meta: [
      { title: "WILLY AI Móvil — Tu IA local en el teléfono" },
      {
        name: "description",
        content:
          "Chat con tu IA local, cambio de modelo, subida de archivos, herramientas de Súper IA y traducción simultánea de vídeos de YouTube al español.",
      },
      { property: "og:title", content: "WILLY AI Móvil" },
      { property: "og:description", content: "Tu IA local en el teléfono: chat, archivos, Súper IA y YouTube en español." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "WILLY AI" },
      { name: "theme-color", content: "#0b0d14" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
    links: [
      { rel: "manifest", href: "/movil.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
  }),
  component: MobileApp,
});

type Tab = "chat" | "superia" | "youtube" | "ajustes";

const TABS: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "superia", label: "SUPER WILLY", icon: Sparkles },
  { id: "youtube", label: "YouTube", icon: Youtube },
  { id: "ajustes", label: "Ajustes", icon: Smartphone },
];

/** Las mismas reglas del dueño que en el PC (instrucciones permanentes + lo aprendido), para cualquier IA que conteste. */
function ownerSystem(): string {
  const p = readProfile();
  return [
    OWNER_POLICY,
    ownerRules(),
    `IDENTIDAD DE PROPIETARIO: tu dueño se llama ${p.name}${p.email ? ` (correo ${p.email})` : ""}. Solo le obedeces a él y le llamas por su nombre.`,
    "Estás en la versión móvil: en la conversación normal responde claro y breve, en español de España. Si el dueño te pide una web o código, lo entregas completo igual que en el PC (archivos enteros): él lo abrirá en su ordenador.",
  ].join("\n");
}

const now = () => new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

// --------------------------------------------------------------------- chat

function ChatTab() {
  const [settings, setSettings] = useSettings();
  const [threadId, setThreadId] = useState<string>("");
  const [msgs, setMsgs] = useState<StoredMsg[]>([]);
  const [text, setText] = usePersistentState("movil:mensaje", "");
  const [busy, setBusy] = useState(false);
  const { models, refresh: loadModels } = useLocalModels(settings.endpoint);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [attached, setAttached] = useState<{ name: string; content: string }[]>([]);
  const [imageInfo, setImageInfo] = useState("");
  const pictures = useImages((message) => setImageInfo(message));
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Si cambias de pestaña mientras la IA escribe, sigue en segundo plano y te avisa arriba cuando termina.
  useBackgroundReport({ id: "movil-chat", title: "Chat con tu IA", view: "chat", running: busy, detail: "Escribiendo la respuesta…" });
  // Con qué IA hablas: el botón de arriba enseña la IA externa con su nombre cuando está en uso (y esconde los modelos locales).
  const ai = useExternalAi();

  // Leer las respuestas en voz alta con una voz natural en español (misma voz que en el resto de la app).
  const { voice: narrator, setVoice: setNarrator, voices } = useSharedVoice();
  const [autoVoice, setAutoVoiceState] = useState(false);
  const setAutoVoice = (on: boolean) => { setAutoVoiceState(on); window.localStorage.setItem("willy-chat-voz-auto", on ? "si" : "no"); };
  useEffect(() => { setAutoVoiceState(window.localStorage.getItem("willy-chat-voz-auto") === "si"); }, []);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const activeSpeech = useRef<SpeechHandle | null>(null);
  const autoSpoken = useRef<Set<number>>(new Set());
  useEffect(() => () => activeSpeech.current?.stop(), []);

  const speakMsg = (idx: number, msgText: string) => {
    activeSpeech.current?.stop();
    setSpeakingIdx(idx);
    activeSpeech.current = speakBest(msgText, {
      ...(narrator ? { naturalVoice: narrator } : {}),
      onEnd: () => setSpeakingIdx(null),
      onError: () => setSpeakingIdx(null),
    });
  };
  const stopSpeak = () => { activeSpeech.current?.stop(); activeSpeech.current = null; setSpeakingIdx(null); };

  useEffect(() => {
    if (!autoVoice || !msgs.length || busy) return;
    const idx = msgs.length - 1;
    const last = msgs[idx];
    if (last && last.who === "willy" && last.text.trim() && !autoSpoken.current.has(idx)) {
      autoSpoken.current.add(idx);
      speakMsg(idx, last.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, busy, autoVoice]);

  useEffect(() => {
    setThreadId(newThreadId());
    setThreads(listThreads());
    // En el móvil no está la caja de Autoconstrucción: las instrucciones y lo aprendido se traen del equipo (las mismas que en el PC).
    void loadOwnerBrain();
    const refresh = () => setThreads(listThreads());
    window.addEventListener(CHAT_EVENT, refresh);
    return () => window.removeEventListener(CHAT_EVENT, refresh);
  }, []);


  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  useEffect(() => {
    if (!threadId || !msgs.length) return;
    const t = window.setTimeout(() => saveThread(threadId, msgs), 400);
    return () => window.clearTimeout(t);
  }, [threadId, msgs]);

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    // Las fotos y capturas las lee un modelo con visión; el resto de archivos se leen como texto.
    const photos = imageFilesOf(files);
    if (photos.length) void pictures.add(photos);
    const added: { name: string; content: string }[] = [];
    for (const f of Array.from(files).filter((entry) => !entry.type.startsWith("image/")).slice(0, 5)) {
      const content = await f.text().catch(() => "");
      added.push({ name: f.name, content: content.slice(0, 20000) });
    }
    setAttached((prev) => [...prev, ...added]);
  };

  const send = async () => {
    const question = text.trim();
    if (!question || busy) return;
    const shots = pictures.images;
    setImageInfo("");
    const attachedNote = attached.length
      ? `\n\nARCHIVOS ADJUNTOS:\n${attached.map((a) => `--- ${a.name} ---\n${a.content}`).join("\n\n")}`
      : "";
    const mine: StoredMsg = {
      who: "you",
      time: now(),
      text: [question, attached.length ? `📎 ${attached.map((a) => a.name).join(", ")}` : "", shots.length ? `🖼️ ${shots.length} imagen(es)` : ""].filter(Boolean).join("\n\n"),
    };
    const history = msgs.map<ChatMsg>((m) => ({ role: m.who === "you" ? "user" : "assistant", content: m.text }));
    setMsgs((m) => [...m, mine, { who: "willy", time: now(), text: "" }]);
    setText("");
    setAttached([]);
    pictures.clear();
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;

    try {
      let imageNote = "";
      if (shots.length) {
        const showStage = (stage: string) => setMsgs((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last) copy[copy.length - 1] = { ...last, text: stage };
          return copy;
        });
        const seen = await describePictures({ endpoint: settings.endpoint, currentModel: settings.model, pictures: shots, signal: controller.signal, onStage: showStage });
        if (!seen.ok) {
          showStage(controller.signal.aborted ? "⏹️ Detenido." : `⚠️ ${seen.error}`);
          return;
        }
        imageNote = seen.text;
        showStage("");
      }
      // Si lo que dices es una regla («a partir de ahora…», «recuerda que…», «nunca…»), se aprende para todas las IA y todos los chats.
      const learned = learnFromOwner(question, "chat del móvil");
      const aiMessages: ChatMsg[] = [
        { role: "system", content: ownerSystem() },
        ...history,
        { role: "user", content: question + attachedNote + (imageNote ? `\n\n${imageNote}` : "") },
      ];
      // Lo que va pasando con la IA (a cuál se envía, si responde…) se enseña en la etiqueta del mensaje, no dentro de la respuesta.
      const setBy = (by: string) => setMsgs((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last) copy[copy.length - 1] = { ...last, by };
        return copy;
      });
      const showNote = (t: string) => setBy(t.replace(/\s*\(el mensaje sale de tu equipo\)/, ""));
      let cloudBy = "";
      // IA externa (Gemini, Groq…): SOLO si la eliges con el icono de la nube (arriba) y el interruptor general de
      // motores externos está activo. Si ninguna responde, sigue con tu IA local, como siempre.
      const cloudFull = await askChatCloud({
        pick: readChatPick(),
        messages: aiMessages,
        status: engineStatus,
        ask: (id, msgsIn, maxTokens) => cloudChat(id, msgsIn, maxTokens),
        notify: showNote,
        onText: (t) => setMsgs((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last) copy[copy.length - 1] = { ...last, text: t };
          return copy;
        }),
        onAnswered: (engine, m) => { cloudBy = `${engine} · ${m}`; },
        signal: controller.signal,
        maxTokens: 12000,
      });
      if (cloudFull !== null) setBy(cloudBy || "IA externa");
      if (cloudFull === null) {
        const model = await resolveLocalModel(settings.endpoint, settings.model);
        if (model !== settings.model) setSettings({ model });
        setBy(`Tu equipo · ${model}${readChatPick() !== "local" ? " (la IA externa no respondió)" : ""}`);
        await chatLocalStream({
          endpoint: settings.endpoint,
          model,
          signal: controller.signal,
          messages: aiMessages,
          onDelta: (d) =>
            setMsgs((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last) copy[copy.length - 1] = { ...last, text: last.text + d };
              return copy;
            }),
        });
      }
      // Al terminar, la etiqueta del mensaje también dice qué regla se ha aprendido (vale ya para todas las IA).
      if (learned) setMsgs((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        const short = learned.length > 60 ? `${learned.slice(0, 59)}…` : learned;
        if (last) copy[copy.length - 1] = { ...last, by: `${last.by ? `${last.by} · ` : ""}📌 Aprendido: «${short}»` };
        return copy;
      });
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      setMsgs((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        const message = aborted
          ? "⏹️ Generación detenida."
          : "El motor de IA de tu ordenador no está en marcha. Enciéndelo en el PC (WILLY AI abierto) y vuelve a preguntarme.";
        if (last) copy[copy.length - 1] = { ...last, text: last.text || message };
        return copy;
      });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const openThread = (id: string) => {
    const t = loadThread(id);
    if (!t) return;
    setThreadId(t.id);
    setMsgs(t.messages);
    setHistoryOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border p-3">
        <button
          type="button"
          onClick={() => {
            void loadModels();
            void refreshExternalStatus(5_000);
            setPickerOpen((v) => !v);
          }}
          aria-label={ai.external ? `IA externa en uso: ${ai.summary}` : `Modelo de tu equipo: ${settings.model}`}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm ${ai.external ? "border-amber-500/50" : "border-border"}`}
        >
          {ai.external ? <Cloud className="size-4 shrink-0 text-amber-600" /> : <Cpu className="size-4 shrink-0 text-primary" />}
          <span className={`truncate ${ai.external ? "font-semibold text-amber-600" : ""}`}>{ai.external ? `IA externa: ${ai.summary}` : settings.model}</span>
          <ChevronDown className="ml-auto size-4 shrink-0 opacity-60" />
        </button>
        <Button
          size="icon"
          variant={autoVoice || voicePickerOpen ? "secondary" : "outline"}
          aria-label="Voz que lee las respuestas"
          className={autoVoice ? "text-primary" : ""}
          onClick={() => setVoicePickerOpen((v) => !v)}
        >
          <Volume2 className="size-4" />
        </Button>
        <Button size="icon" variant="outline" aria-label="Conversaciones" onClick={() => setHistoryOpen((v) => !v)}>
          <MessageSquare className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label="Nueva conversación"
          onClick={() => {
            setThreadId(newThreadId());
            setMsgs([]);
          }}
        >
          <Plus className="size-4" />
        </Button>
      </header>
      <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-1.5">
        <ChatEngineChip up={false} />
      </div>

      {voicePickerOpen ? (
        <div className="border-b border-border bg-card p-2">
          <button
            type="button"
            onClick={() => setAutoVoice(!autoVoice)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
          >
            {autoVoice ? <Check className="size-4 text-primary" /> : <span className="size-4" />}
            <span className="truncate">Leer las respuestas automáticamente</span>
          </button>
          <p className="px-2 pb-1 pt-1 text-xs text-muted-foreground">Voces en español de España</p>
          {voices?.installed.length ? (
            voices.installed.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => { setNarrator(v.id); setVoicePickerOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              >
                {narrator === v.id ? <Check className="size-4 text-primary" /> : <span className="size-4" />}
                <span className="truncate">{v.label}</span>
              </button>
            ))
          ) : (
            <button
              type="button"
              onClick={() => { refreshSharedVoices(); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <Volume2 className="size-4" /><span className="truncate">Preparar voces naturales</span>
            </button>
          )}
        </div>
      ) : null}

      {pickerOpen ? (
        <div className="max-h-[65vh] overflow-y-auto border-b border-border bg-card p-2">
          {ai.external ? (
            <>
              {/* Con la IA externa en uso, los modelos locales desaparecen: solo queda la opción de volver a tu equipo. */}
              <ExternalAiPanel ai={ai} compact />
              <button
                type="button"
                onClick={() => { ai.choose("local"); setPickerOpen(false); }}
                className="mt-2 flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <Cpu className="size-4 shrink-0 text-primary" /><span className="truncate">Usar solo tu equipo ({settings.model})</span>
              </button>
            </>
          ) : (
            <>
              <p className="px-2 pb-1 text-xs text-muted-foreground">
                {models.length ? "Modelos instalados en tu ordenador" : "No hay modelos disponibles ahora mismo."}
              </p>
              {models.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setSettings({ model: m });
                    setPickerOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {m === settings.model ? <Check className="size-4 text-primary" /> : <span className="size-4" />}
                  <span className="truncate">{m}</span>
                </button>
              ))}
              <div className="my-2 h-px bg-border" />
              <ExternalAiPanel ai={ai} compact />
            </>
          )}
        </div>
      ) : null}

      {historyOpen ? (
        <div className="max-h-52 overflow-y-auto border-b border-border bg-card p-2">
          {threads.length ? (
            threads.map((t) => (
              <div key={t.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openThread(t.id)}
                  className="min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {t.title}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Borrar ${t.title}`}
                  onClick={() => {
                    deleteThread(t.id);
                    setThreads(listThreads());
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          ) : (
            <p className="p-2 text-xs text-muted-foreground">Todavía no hay conversaciones guardadas.</p>
          )}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!msgs.length ? (
          <div className="mt-16 text-center text-sm text-muted-foreground">
            <Sparkles className="mx-auto mb-2 size-6 text-primary" />
            Escribe lo que quieras y tu IA te responde.
          </div>
        ) : null}
        {msgs.map((m, i) => (
          <div key={`${m.time}-${i}`} className={m.who === "you" ? "ml-auto max-w-[88%]" : "max-w-[88%]"}>
            {m.who === "willy" && m.by ? (
              <p className={`mb-0.5 flex items-center gap-1 truncate text-[10px] ${m.by.startsWith("Tu equipo") ? "text-muted-foreground" : "text-amber-600"}`} title={m.by}>
                {m.by.startsWith("Tu equipo") ? <Cpu className="size-3 shrink-0" /> : <Cloud className="size-3 shrink-0" />}
                <span className="truncate">{m.by}</span>
              </p>
            ) : null}
            <div
              className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                m.who === "you" ? "bg-primary text-primary-foreground" : "border border-border bg-card"
              }`}
            >
              {m.text || (busy && i === msgs.length - 1 ? <Loader2 className="size-4 animate-spin" /> : "")}
            </div>
            {m.who === "willy" && m.text.trim() && !(busy && i === msgs.length - 1) ? (
              <button
                type="button"
                onClick={() => (speakingIdx === i ? stopSpeak() : speakMsg(i, m.text))}
                className={`mt-1 inline-flex items-center gap-1 text-[10px] ${speakingIdx === i ? "text-primary" : "text-muted-foreground"}`}
                aria-label={speakingIdx === i ? "Detener lectura en voz alta" : "Leer en voz alta"}
              >
                {speakingIdx === i ? <Square className="size-3" /> : <Volume2 className="size-3" />}
                {speakingIdx === i ? "Detener" : "Escuchar"}
              </button>
            ) : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {attached.length ? (
        <div className="flex flex-wrap gap-2 border-t border-border p-2">
          {attached.map((a, i) => (
            <button
              key={a.name + i}
              type="button"
              onClick={() => setAttached((prev) => prev.filter((_, j) => j !== i))}
              className="rounded-full border border-border px-3 py-1 text-xs"
            >
              📎 {a.name} ✕
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void attach(e.target.files)}
          aria-label="Subir archivos"
        />
        <Button size="icon" variant="outline" aria-label="Adjuntar archivo" onClick={() => fileRef.current?.click()}>
          <Paperclip className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label="Detener"
          disabled={!busy}
          onClick={() => abort.current?.abort()}
        >
          <Square className="size-4" />
        </Button>
        <ClarifyButton context="chat" iconOnly variant="outline" value={text} onApply={setText} />
        <div className="min-w-0 flex-1 rounded-xl border border-border bg-background focus-within:border-primary">
          {(pictures.images.length > 0 || imageInfo) && (
            <div className="space-y-1 px-3 pt-3">
              <ImageChips images={pictures.images} onRemove={pictures.remove} />
              {imageInfo && <p className="text-xs text-muted-foreground">{imageInfo}</p>}
            </div>
          )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e: { clipboardData: DataTransfer; preventDefault: () => void }) => {
            const found = imageFilesOf(e.clipboardData.files);
            if (!found.length) return;
            e.preventDefault();
            void pictures.add(found);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Escribe aquí…"
          className="max-h-32 w-full resize-none rounded-xl bg-transparent px-3 py-2 text-base outline-none"
          aria-label="Mensaje"
        />
        </div>
        <Button size="icon" aria-label="Enviar" disabled={!text.trim() || busy} onClick={() => void send()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ajustes

function SettingsTab() {
  const [settings, setSettings] = useSettings();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <div className="space-y-3 p-4 text-sm">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 font-semibold">Tu ordenador</p>
        <label className="mb-1 block text-xs text-muted-foreground" htmlFor="endpoint">
          Dirección de tu IA local
        </label>
        <input
          id="endpoint"
          value={settings.endpoint}
          onChange={(e) => setSettings({ endpoint: e.target.value })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <p className="mt-2 text-xs text-muted-foreground">Conectado a: {origin || "…"}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 font-semibold">Instalar en la pantalla de inicio</p>
        <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>En el iPhone, abre esta página con Safari.</li>
          <li>Pulsa el botón Compartir (el cuadrado con la flecha hacia arriba).</li>
          <li>Elige «Añadir a pantalla de inicio» y pulsa Añadir.</li>
          <li>Ya tienes el icono de WILLY AI como una app más.</li>
        </ol>
        <a
          href="/api/iphone"
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
        >
          Descargar el instalador para iPhone
        </a>
      </div>

      <p className="text-center text-xs text-muted-foreground">WILLY AI Móvil v{APP_VERSION}</p>
    </div>
  );
}

// -------------------------------------------------------------------- shell

function MobileApp() {
  const [tab, setTab] = useState<Tab>("chat");
  // Las pestañas que ya has abierto se quedan VIVAS (ocultas, no desmontadas): así, si le pides algo a la IA en una
  // pestaña y pasas a otra («minimizarla»), sigue trabajando en segundo plano y la respuesta te espera al volver.
  const [visited, setVisited] = useState<Tab[]>(["chat"]);
  useEffect(() => { setVisited((v) => (v.includes(tab) ? v : [...v, tab])); }, [tab]);
  // La bandeja de trabajos en segundo plano pide abrir la pestaña de un trabajo al pulsarlo (mismos nombres que el escritorio).
  useEffect(() => {
    const map: Record<string, Tab> = { chat: "chat", superia: "superia", traducir: "youtube", youtube: "youtube", ajustes: "ajustes" };
    const onOpen = (event: Event) => {
      const wanted = map[String((event as CustomEvent<string>).detail)];
      if (wanted) setTab(wanted);
    };
    window.addEventListener(OPEN_VIEW_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_VIEW_EVENT, onOpen);
  }, []);

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-hidden">
        {visited.map((t) => (
          <div key={t} className={t === tab ? "flex h-full min-h-0 flex-col" : "hidden"}>
            <ViewActiveContext.Provider value={t === tab}>
              {t === "chat" && <ChatTab />}
              {t === "superia" && <div className="h-full overflow-y-auto p-3"><SuperIAView /></div>}
              {t === "youtube" && <div className="h-full overflow-y-auto p-3"><TranslateView /></div>}
              {t === "ajustes" && <div className="h-full overflow-y-auto"><SettingsTab /></div>}
            </ViewActiveContext.Provider>
          </div>
        ))}
      </div>
      <BackgroundTray placement="top" offset={112} />
      <nav className="grid grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex flex-col items-center gap-1 py-2 text-[11px] ${
              tab === t.id ? "text-primary" : "text-muted-foreground"
            }`}
            aria-current={tab === t.id ? "page" : undefined}
          >
            <t.icon className="size-5" />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
