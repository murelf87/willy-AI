import { useEffect, useState } from "react";
import { readSettings } from "./workspace-store";

export type NoticeKind = "info" | "success" | "warn";

export type Notice = {
  id: string;
  text: string;
  kind: NoticeKind;
  time: string;
  at: number;
  read: boolean;
};

const KEY = "willy-notices";
const EVENT = "willy-notices-change";
const MAX = 40;

export function readNotices(): Notice[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Notice[]) : [];
  } catch {
    return [];
  }
}

function write(list: Notice[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* almacenamiento no disponible */
  }
  window.dispatchEvent(new CustomEvent<Notice[]>(EVENT, { detail: list }));
}

/** Deduce la importancia del aviso a partir de su texto. */
export function inferKind(text: string): NoticeKind {
  if (/⚠|error|no responde|no disponible|interrump|detenid/i.test(text)) return "warn";
  if (/✅|generad|creado|completad|guardad|publicad|copiad|exportad|abierto|operativo/i.test(text)) return "success";
  return "info";
}

/** Registra un aviso si el usuario tiene activadas las notificaciones. */
export function pushNotice(text: string, kind: NoticeKind = inferKind(text)) {
  if (typeof window === "undefined") return;
  const settings = readSettings();
  if (!settings.notify) return;
  if (kind === "info" && !settings.notifySteps) return;

  const notice: Notice = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    kind,
    time: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
    at: Date.now(),
    read: false,
  };
  write([notice, ...readNotices()].slice(0, MAX));
  if (settings.notifySound && kind !== "info") beep();
}

/** Pitido corto generado en el propio navegador, sin archivos externos. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio no disponible */
  }
}

export function markAllRead() {
  write(readNotices().map((n) => ({ ...n, read: true })));
}

export function removeNotice(id: string) {
  write(readNotices().filter((n) => n.id !== id));
}

export function clearNotices() {
  write([]);
}

/** Lista de avisos guardada en el propio equipo. */
export function useNotices(): { notices: Notice[]; unread: number } {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    setNotices(readNotices());
    const onChange = (e: Event) => setNotices((e as CustomEvent<Notice[]>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  return { notices, unread: notices.filter((n) => !n.read).length };
}
