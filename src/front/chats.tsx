// CHATS (diseño de las maquetas de 24/09): cabecera con la mascota y «Nuevo chat», lista de conversaciones a la izquierda
// (búsqueda, Todos / Recientes / Favoritos, etiqueta y acciones) y la conversación a la derecha. La conversación en sí es
// el ChatPanel de siempre (motor del chat de «WILLY AI»): aquí solo se le pone la pantalla alrededor.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Lightbulb, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Star, Tag, Trash2, Briefcase, X } from "lucide-react";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { CHAT_EVENT, deleteThread, listThreads, renameThread, type ChatThread } from "@/lib/chat-history";
import { usePersistentState } from "@/lib/persistent-state";
import { relativeTime } from "@/lib/project-progress";
import type { Ping } from "@/types/domain";
import { CHAT_TAGS, updateChatMeta, useChatMeta, type ChatTag } from "@/front/chat-meta";
import { WillyMascot } from "@/front/mascot";
import { aiPolicyOf, useAiPick } from "@/front/status";
import { useExternalAi } from "@/components/chat-engine-chip";

type Filter = "todos" | "recientes" | "favoritos";
const FILTERS: Array<[Filter, string]> = [["todos", "Todos"], ["recientes", "Recientes"], ["favoritos", "Favoritos"]];
const TAG_STYLE: Record<ChatTag, string> = {
  Ideas: "bg-warning/25 text-amber-800 dark:text-amber-200",
  General: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Trabajo: "bg-warning/25 text-amber-800 dark:text-amber-200",
};
const TAG_ICON: Record<ChatTag, typeof Lightbulb> = { Ideas: Lightbulb, General: MessageSquare, Trabajo: Briefcase };

function useThreads(): ChatThread[] {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  useEffect(() => {
    const refresh = () => setThreads(listThreads());
    refresh();
    window.addEventListener(CHAT_EVENT, refresh);
    return () => window.removeEventListener(CHAT_EVENT, refresh);
  }, []);
  return threads;
}

const snippetOf = (t: ChatThread): string => {
  const last = t.messages[t.messages.length - 1];
  const text = (last?.text ?? "").replace(/\s+/g, " ").trim();
  return text.length > 70 ? `${text.slice(0, 70)}…` : text || "Sin mensajes todavía";
};

export function ChatsScreen({ threadId, onOpenThread, onNewChat, ping, children }: {
  threadId: string; onOpenThread: (id: string) => void; onNewChat: () => void; ping: Ping; children: ReactNode;
}) {
  const threads = useThreads();
  const meta = useChatMeta();
  const ai = useExternalAi();
  const policy = aiPolicyOf(useAiPick(), ai.status);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = usePersistentState<Filter>("front:chats:filtro", "todos");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => threads
    .filter((t) => !q || `${t.title} ${snippetOf(t)}`.toLowerCase().includes(q))
    .filter((t) => filter === "todos" || (filter === "favoritos" ? Boolean(meta[t.id]?.favorite) : now - t.updatedAt < 48 * 3_600_000))
    .sort((a, b) => b.updatedAt - a.updatedAt), [threads, q, filter, meta, now]);
  const current = threads.find((t) => t.id === threadId) ?? null;
  const currentMeta = meta[threadId] ?? {};

  const rename = (t: ChatThread) => {
    const title = window.prompt("Nuevo nombre de la conversación:", t.title);
    if (!title || title.trim() === t.title) return;
    renameThread(t.id, title.trim());
    ping("Conversación renombrada.");
  };
  const remove = (t: ChatThread) => {
    if (!window.confirm(`¿Borrar la conversación «${t.title}»? No se puede deshacer.`)) return;
    deleteThread(t.id);
    if (t.id === threadId) onNewChat();
    ping("Conversación borrada.");
  };
  const toggleFavorite = (id: string) => updateChatMeta(id, { favorite: !meta[id]?.favorite });
  const setTag = (id: string, tag: ChatTag | undefined) => updateChatMeta(id, { tag });

  const menuFor = (t: ChatThread, close: () => void) => (
    <>
      <MenuLabel>{t.title}</MenuLabel>
      <MenuItem onClick={() => { close(); toggleFavorite(t.id); }}><Star className={`size-4 ${meta[t.id]?.favorite ? "fill-current text-warning" : ""}`} />{meta[t.id]?.favorite ? "Quitar de favoritos" : "Marcar como favorito"}</MenuItem>
      <MenuItem onClick={() => { close(); rename(t); }}><Pencil className="size-4" />Renombrar</MenuItem>
      <MenuLabel>Etiqueta</MenuLabel>
      {CHAT_TAGS.map((tag) => (
        <MenuItem key={tag} active={meta[t.id]?.tag === tag} onClick={() => { close(); setTag(t.id, meta[t.id]?.tag === tag ? undefined : tag); }}><Tag className="size-4" />{tag}</MenuItem>
      ))}
      <div className="my-1 h-px bg-border" />
      <MenuItem danger onClick={() => { close(); remove(t); }}><Trash2 className="size-4" />Borrar conversación</MenuItem>
    </>
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background" aria-label="Chats">
      <div className="mx-auto flex w-full max-w-[1400px] min-h-0 flex-1 flex-col px-4 pt-4 sm:px-5">
        {/* Cabecera */}
        <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-primary"><MessageSquare className="size-6" /></span>
            <div className="min-w-0">
              <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tight">Chats</h1>
              <p className="truncate text-sm text-muted-foreground">Habla con WILLY sobre cualquier tema, idea o duda.</p>
            </div>
          </div>
          <div className="hidden items-center gap-3 xl:flex">
            <WillyMascot className="h-20 w-auto" />
            <p className="max-w-[190px] font-display text-[13px] font-semibold leading-snug text-primary">“Aquí estoy para escuchar tus ideas, resolver tus dudas y ayudarte a pensar.”</p>
          </div>
          <button type="button" onClick={onNewChat} className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-glow hover:bg-primary/90"><Plus className="size-4" />Nuevo chat</button>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 pb-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          {/* Lista de conversaciones */}
          <aside className="flex min-h-0 flex-col rounded-2xl border border-border bg-card p-3 shadow-card" aria-label="Conversaciones">
            <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3">
              <Search className="size-4 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar conversación..." aria-label="Buscar conversación" className="h-10 w-full bg-transparent text-sm outline-none" />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X className="size-3.5 text-muted-foreground" /></button>}
            </label>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="Filtro de conversaciones">
              {FILTERS.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={`rounded-lg px-2 py-1.5 text-xs font-bold ${filter === id ? "bg-accent text-primary shadow-card" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
              ))}
            </div>
            <div className="scroll-thin mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
              {visible.length === 0 && (
                <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  {threads.length === 0 ? "Tus conversaciones se guardarán aquí." : filter === "favoritos" ? "Todavía no has marcado ninguna conversación como favorita." : "Ninguna conversación coincide."}
                </p>
              )}
              {visible.map((t) => {
                const m = meta[t.id] ?? {};
                const active = t.id === threadId;
                const Icon = m.tag ? TAG_ICON[m.tag] : MessageSquare;
                return (
                  <div key={t.id} role="button" tabIndex={0} onClick={() => onOpenThread(t.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpenThread(t.id); }}
                    aria-current={active ? "true" : undefined}
                    className={`group flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${active ? "border-primary/50 bg-accent/60" : "border-border hover:border-primary/30 hover:bg-accent/30"}`}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary"><Icon className="size-[18px]" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-bold">{t.title}</span><span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(new Date(t.updatedAt).toISOString(), now).toLowerCase()}</span></span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{snippetOf(t)}</span>
                      <span className="mt-1.5 flex items-center gap-1.5">
                        {m.favorite && <Star className="size-3.5 fill-current text-warning" aria-label="Favorita" />}
                        {m.tag && <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${TAG_STYLE[m.tag]}`}>{m.tag}</span>}
                        <span className="flex-1" />
                        <Menu label={`Acciones de ${t.title}`} align="end" trigger={({ toggle }) => (
                          <button type="button" onClick={(e) => { e.stopPropagation(); toggle(); }} aria-label={`Acciones de ${t.title}`} className="grid size-7 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"><MoreHorizontal className="size-4" /></button>
                        )}>
                          {(close) => menuFor(t, close)}
                        </Menu>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Conversación */}
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
              {(() => { const HeaderIcon = currentMeta.tag ? TAG_ICON[currentMeta.tag] : Lightbulb; return (
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warning/25 text-amber-700 dark:text-amber-300"><HeaderIcon className="size-5" /></span>
              ); })()}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-bold">{current?.title ?? "Nueva conversación"}</h2>
                <p className="truncate text-xs text-muted-foreground">Conversación general · IA {policy.label}{currentMeta.tag ? ` · ${currentMeta.tag}` : ""}</p>
              </div>
              <button type="button" onClick={() => current && toggleFavorite(current.id)} disabled={!current} aria-label={currentMeta.favorite ? "Quitar de favoritos" : "Marcar como favorito"} title={currentMeta.favorite ? "Quitar de favoritos" : "Marcar como favorito"} className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-40">
                <Star className={`size-4 ${currentMeta.favorite ? "fill-current text-warning" : ""}`} />
              </button>
              <Menu label="Acciones de la conversación" align="end" trigger={({ toggle }) => (
                <button type="button" onClick={toggle} disabled={!current} aria-label="Más acciones" className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"><MoreHorizontal className="size-4" /></button>
              )}>
                {(close) => current ? menuFor(current, close) : null}
              </Menu>
            </div>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
