import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Cloud, Cpu, Loader2, Plus, Sparkles, X } from "lucide-react";
import { engineStatus } from "@/lib/engines-client";
import type { PublicStatus } from "@/lib/engines-server";
import {
  CHAT_ENGINE_KEY, CHAT_EXTERNAS_KEY, CHAT_PICK_EVENT, CHAT_STATUS_EVENT, engineState, externalOrder, externalSummary,
  readChatPick, readChosenExternal, writeChatPick, writeChosenExternal,
} from "@/lib/chat-cloud";

const TONE: Record<"ok" | "wait" | "off" | "bad", string> = {
  ok: "border-emerald-500/40 text-emerald-600",
  wait: "border-amber-500/50 text-amber-600",
  off: "border-border text-muted-foreground",
  bad: "border-destructive/50 text-destructive",
};

// ── Estado de las IA externas, COMPARTIDO por todos los botones (barra de arriba, chat, móvil, Súper IA) ──
// Una sola consulta al servidor de tu equipo y todos al día: si a Groq se le acaba lo gratis, arriba y abajo lo ven a la vez.
type Shared = { status: PublicStatus | null; loading: boolean; at: number };
let shared: Shared = { status: null, loading: false, at: 0 };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const fn of listeners) fn(); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => shared;

/** Vuelve a consultar si cada IA externa está lista o sin cuota. Con `maxAge`, no repite si se consultó hace menos de eso (ms). */
export function refreshExternalStatus(maxAge = 0): Promise<void> {
  if (inflight) return inflight;
  if (maxAge > 0 && shared.status && Date.now() - shared.at < maxAge) return Promise.resolve();
  shared = { ...shared, loading: true };
  emit();
  inflight = engineStatus()
    .then((s) => { shared = s ? { status: s, loading: false, at: Date.now() } : { ...shared, loading: false }; })
    .catch(() => { shared = { ...shared, loading: false }; })
    .finally(() => { inflight = null; emit(); });
  return inflight;
}

function putStatus(status: PublicStatus): void {
  shared = { status, loading: false, at: Date.now() };
  emit();
}

/**
 * Con qué IA se habla, compartido por toda la app: «Este equipo» (tu IA local) o «IA externa» (las que tienen clave,
 * en tu orden). Al cambiarlo en un sitio (arriba, abajo, móvil, Súper IA) cambia en todos al momento.
 */
export function useExternalAi() {
  const [pick, setPick] = useState("local");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const { status, loading } = useSyncExternalStore(subscribe, snapshot, snapshot);
  const external = pick !== "local";

  useEffect(() => {
    const sync = () => { setPick(readChatPick()); setChosen(readChosenExternal()); };
    const onStorage = (event: StorageEvent) => { if (event.key === CHAT_ENGINE_KEY || event.key === CHAT_EXTERNAS_KEY) sync(); };
    const onStatus = () => { void refreshExternalStatus(); };
    sync();
    window.addEventListener(CHAT_PICK_EVENT, sync);
    window.addEventListener(CHAT_STATUS_EVENT, onStatus);
    window.addEventListener("storage", onStorage);
    void refreshExternalStatus(15_000);
    return () => {
      window.removeEventListener(CHAT_PICK_EVENT, sync);
      window.removeEventListener(CHAT_STATUS_EVENT, onStatus);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Mientras la IA externa está en uso, su estado (lista / sin cuota gratis / vuelve a las…) se mantiene al día solo.
  useEffect(() => {
    if (!external) return;
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void refreshExternalStatus(45_000); }, 60_000);
    return () => window.clearInterval(timer);
  }, [external]);

  const { order, checked } = externalOrder(status, chosen);
  const marked = order.filter((id) => checked.has(id));
  const choose = (id: string) => { setPick(id); writeChatPick(id); };
  const saveChosen = (next: string[]) => { setChosen(next); writeChosenExternal(next); window.dispatchEvent(new Event(CHAT_PICK_EVENT)); };
  return {
    pick, chosen, status, loading, external, order, checked, marked,
    summary: externalSummary(status, pick, chosen),
    choose, saveChosen, putStatus, refresh: refreshExternalStatus,
  };
}

export type ExternalAi = ReturnType<typeof useExternalAi>;

/**
 * El apartado «IA externa»: marcar las que tienen clave, ordenarlas, ver si están listas o sin cuota gratis y añadir
 * la clave de otra gratis sin salir de donde estás. Se usa en el chat (abajo), en la barra de arriba y en el móvil.
 * Con `keysOnly` (SUPER WILLY, que elige solo la mejor para cada tarea) enseña solo su estado, el interruptor general y
 * el alta de claves: no toca con qué IA habla la pestaña Chat.
 */
export function ExternalAiPanel({ ai, compact = false, onClose, keysOnly = false }: { ai: ExternalAi; compact?: boolean; onClose?: () => void; keysOnly?: boolean }) {
  const { status, loading, order, checked, marked, pick, chosen } = ai;
  // En «solo claves» la lista se ve siempre activa (SUPER WILLY usa las que tienen clave, no las marcadas en el chat).
  const external = keysOnly || ai.external;
  const engines = status?.engines ?? [];
  const [switching, setSwitching] = useState(false);
  const [changingMode, setChangingMode] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [keyNote, setKeyNote] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState("");
  const [showAdd, setShowAdd] = useState(!compact || keysOnly);

  const toggle = (id: string) => ai.saveChosen(checked.has(id) ? marked.filter((x) => x !== id) : [...marked, id].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  const move = (id: string, delta: number) => {
    const list = [...marked];
    const at = list.indexOf(id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to]!, list[at]!];
    ai.saveChosen(list);
  };
  const engineCall = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/self-build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as { ok?: boolean; error?: string; model?: string; status?: PublicStatus };
  };
  const turnOnMaster = async () => {
    setSwitching(true);
    try {
      const data = await engineCall({ action: "engines-master", on: true });
      if (data.ok && data.status) ai.putStatus(data.status);
    } catch { /* se queda como estaba */ }
    setSwitching(false);
  };
  // Prioridad del «Plug and play»: primero la nube o primero tu equipo. (La Autoconstrucción no usa esto: ahí siempre va primero la IA externa.)
  const setMode = async (mode: string) => {
    setChangingMode(true);
    try {
      const data = await engineCall({ action: "engines-mode", mode });
      if (data.ok && data.status) ai.putStatus(data.status);
    } catch { /* se queda como estaba */ }
    setChangingMode(false);
  };
  // Añadir la clave de una IA sin salir del chat: se guarda SOLO en este equipo y se prueba al momento (sin gastar cuota de conversación).
  const saveKey = async (id: string) => {
    const key = (keys[id] ?? "").trim();
    if (!key) return;
    setSavingKey(id);
    setKeyNote((current) => ({ ...current, [id]: "" }));
    try {
      const saved = await engineCall({ action: "engines-save-key", id, key });
      if (!saved.ok) { setKeyNote((current) => ({ ...current, [id]: `⚠️ ${saved.error ?? "No se pudo guardar la clave."}` })); return; }
      const tested = await engineCall({ action: "engines-test", id });
      if (tested.status) ai.putStatus(tested.status);
      setKeys((current) => ({ ...current, [id]: "" }));
      if (chosen && !chosen.includes(id)) ai.saveChosen([...chosen, id]);
      setKeyNote((current) => ({ ...current, [id]: tested.ok ? `✓ Lista${tested.model ? ` (modelo ${tested.model})` : ""}. Ya está en tu lista.` : `Guardada, pero la prueba dijo: ${tested.error ?? "sin respuesta"}` }));
    } catch {
      setKeyNote((current) => ({ ...current, [id]: "⚠️ No se pudo hablar con WILLY. Vuelve a intentarlo." }));
    } finally {
      setSavingKey("");
    }
  };

  const withoutKey = engines.filter((e) => !e.hasKey);

  return (
    <div className="text-xs">
      <div className="mb-2 flex items-start gap-2">
        <Cloud className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{keysOnly ? "IA externas gratuitas" : "IA externa"}</h3>
          <p className="leading-4 text-muted-foreground">
            {keysOnly
              ? "SUPER WILLY usa la mejor de estas para cada tarea. Si a una se le acaba lo gratis, pasa sola a la siguiente; si ninguna puede, contesta tu equipo."
              : compact
                ? "Si a una se le acaba lo gratis, WILLY pasa sola a la siguiente."
                : "Marca las que quieras usar. Si a una se le acaba lo gratis, WILLY pasa sola a la siguiente y vuelve a ella cuando se renueva. Si ninguna puede, contesta tu equipo."}
          </p>
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
      </div>

      {!keysOnly && (
        <label className={`mb-2 flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 ${external ? "border-amber-500/50 bg-amber-500/10" : "border-border bg-background"}`}>
          <input type="checkbox" checked={external} onChange={(event) => ai.choose(event.target.checked ? "externas" : "local")} className="size-4 accent-amber-600" />
          <span className="font-semibold text-foreground">Usar IA externa en los chats</span>
        </label>
      )}

      {!status && (loading ? <p className="flex items-center gap-2 py-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Consultando tus IA externas…</p> : <p className="py-2 text-muted-foreground">No he podido consultar las IA externas ahora mismo.</p>)}

      {status && !status.master && (
        <div className="mb-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 leading-4">
          <p className="mb-1.5">Las IA externas están desactivadas en WILLY.</p>
          <button type="button" disabled={switching} onClick={() => void turnOnMaster()} className="rounded-md border border-amber-500/60 px-2 py-1 font-semibold text-amber-700 hover:bg-amber-500/10">{switching ? "Activando…" : "Activarlas"}</button>
        </div>
      )}

      {status && (
        <>
          <p className="mb-1 font-semibold text-muted-foreground">{keysOnly ? "Con clave" : "Con clave · en este orden"}</p>
          {order.length === 0 && <p className="mb-2 text-muted-foreground">Ninguna IA externa tiene clave todavía. Añade una gratis aquí debajo.</p>}
          <ul className={`mb-2 space-y-1 ${external ? "" : "opacity-70"}`}>
            {order.map((id) => {
              const e = engines.find((x) => x.id === id)!;
              const state = engineState(e);
              const on = keysOnly || checked.has(id);
              const pos = marked.indexOf(id);
              return (
                <li key={id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${on ? "border-primary/30 bg-primary/5" : "border-border"}`}>
                  {!keysOnly && <input type="checkbox" checked={on} onChange={() => toggle(id)} aria-label={`Usar ${e.name}`} className="size-4 shrink-0 accent-primary" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">{on && !keysOnly ? `${pos + 1}. ` : ""}{e.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{e.model || "modelo automático"}{e.cap ? ` · hoy ${e.used}/${e.cap}` : ""}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${TONE[state.tone]}`} title={state.text}>{state.tone === "ok" ? <><Check className="mr-0.5 inline size-3" />lista</> : <span className="inline-block max-w-[7.5rem] truncate align-bottom">{state.text}</span>}</span>
                  {on && !keysOnly && marked.length > 1 && (
                    <span className="flex shrink-0 flex-col">
                      <button type="button" onClick={() => move(id, -1)} disabled={pos === 0} aria-label={`Subir ${e.name}`} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="size-3" /></button>
                      <button type="button" onClick={() => move(id, 1)} disabled={pos === marked.length - 1} aria-label={`Bajar ${e.name}`} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="size-3" /></button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {withoutKey.length > 0 && !showAdd && (
            <button type="button" onClick={() => setShowAdd(true)} className="mb-2 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-left font-semibold text-primary hover:bg-primary/5">
              <Plus className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">Añadir otra IA gratis ({withoutKey.map((e) => e.name).join(", ")})</span>
            </button>
          )}
          {withoutKey.length > 0 && showAdd && (
            <div className="mb-2">
              <p className="mb-1 font-semibold text-muted-foreground">Sin clave todavía · gratis y sin tarjeta</p>
              <ul className="space-y-1">
                {withoutKey.map((e) => (
                  <li key={e.id} className="rounded-lg border border-dashed border-border px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{e.name}</span>
                      {e.keyUrl && <a href={e.keyUrl} target="_blank" rel="noreferrer noopener" className="shrink-0 font-semibold text-primary underline">Conseguir clave gratis</a>}
                    </div>
                    <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{e.dataNote}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <input
                        type="password"
                        autoComplete="off"
                        value={keys[e.id] ?? ""}
                        onChange={(event) => setKeys((current) => ({ ...current, [e.id]: event.target.value }))}
                        placeholder="Pega aquí la clave"
                        aria-label={`Clave de ${e.name}`}
                        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 outline-none focus:border-primary"
                      />
                      <button type="button" disabled={!keys[e.id]?.trim() || savingKey === e.id} onClick={() => void saveKey(e.id)} className="h-7 shrink-0 rounded-md border border-primary/50 px-2 font-semibold text-primary hover:bg-primary/10 disabled:opacity-50">
                        {savingKey === e.id ? "Probando…" : "Guardar"}
                      </button>
                    </div>
                    {keyNote[e.id] && <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{keyNote[e.id]}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {!keysOnly && (
        <button
          type="button"
          onClick={() => ai.choose(pick === "smart" ? "externas" : "smart")}
          className={`mb-2 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left ${pick === "smart" ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          <Sparkles className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">Plug and play: que WILLY elija la mejor para cada petición{pick === "smart" ? " ✓" : ""}</span>
        </button>
      )}

      {!keysOnly && pick === "smart" && status && (
        <label className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
          <span className="font-semibold text-foreground">Prioridad del Plug and play:</span>
          <select
            className="rounded-md border border-border bg-background px-1.5 py-1 disabled:opacity-60"
            value={status.mode}
            disabled={changingMode}
            onChange={(event) => void setMode(event.target.value)}
            aria-label="Prioridad del Plug and play"
          >
            <option value="calidad">Máxima calidad (primero la nube)</option>
            <option value="ahorro">Ahorro (primero tu equipo)</option>
          </select>
        </label>
      )}

      <p className="leading-4 text-muted-foreground">
        {compact
          ? "Con IA externa tu mensaje sale de tu equipo. DNI, IBAN, tarjetas o contraseñas se quedan siempre en tu equipo."
          : "Con IA externa, tu mensaje sale de tu equipo hacia la que responda (cada respuesta dice cuál fue). Si lleva un DNI, IBAN, tarjeta o contraseña, se queda en tu equipo."}
      </p>
    </div>
  );
}

/**
 * Con qué IA hablas en el chat: [Este equipo] o [IA externa]. El apartado «IA externa» deja marcar las que tienen clave
 * (Groq, Gemini, Mistral, OpenRouter…), ordenarlas y ver si están listas o sin cuota gratis. Si a una se le acaba lo gratis,
 * WILLY pasa sola a la siguiente marcada y vuelve a ella cuando se renueva. Con «Este equipo» nada sale de tu ordenador.
 */
export function ChatEngineChip({ up = true }: { up?: boolean } = {}) {
  const ai = useExternalAi();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Mientras el apartado está abierto, el estado de cada IA (lista / sin cuota) se refresca solo.
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => void refreshExternalStatus(), 30_000);
    const onDown = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.clearInterval(timer); window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const openExternal = () => {
    if (!ai.external) ai.choose("externas");
    void refreshExternalStatus();
    setOpen(true);
  };

  return (
    <div ref={box} className="relative inline-flex">
      <div className="inline-flex overflow-hidden rounded-full border border-border text-xs" role="group" aria-label="Con qué IA hablas">
        <button
          type="button"
          onClick={() => { ai.choose("local"); setOpen(false); }}
          aria-pressed={!ai.external}
          title="Contesta la IA de tu ordenador: nada sale de tu equipo"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 ${!ai.external ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Cpu className="size-3.5" />Este equipo
        </button>
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openExternal())}
          aria-pressed={ai.external}
          aria-expanded={open}
          title="Elige las IA externas que tienen clave; si a una se le acaba lo gratis, pasa sola a la siguiente"
          className={`inline-flex max-w-[16rem] items-center gap-1.5 border-l border-border px-2.5 py-1 ${ai.external ? "bg-amber-500/15 font-semibold text-amber-600" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Cloud className="size-3.5 shrink-0" />
          <span className="truncate">IA externa{ai.external ? `: ${ai.summary}` : ""}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </div>

      {open && (
        <section
          role="dialog"
          aria-label="IA externa"
          className={`absolute left-0 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-card p-3 shadow-2xl ${up ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}`}
        >
          <ExternalAiPanel ai={ai} onClose={() => setOpen(false)} />
        </section>
      )}
    </div>
  );
}
