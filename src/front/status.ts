// Estado de WILLY para el armazón nuevo (barra superior y tarjeta «Estado de WILLY»): TODO sale del sistema, nada se
// inventa. Reúne, sin duplicar lógica, lo que ya existe: la política de IA de los chats (chat-cloud), la IA del equipo
// (use-system), los trabajos en segundo plano (background-tasks), los avisos (notifications) y la salud del programa
// (self-health de la Autoconstrucción).
import { useEffect, useState } from "react";
import { useBackgroundTasks } from "@/lib/background-tasks";
import { readChatPick, CHAT_PICK_EVENT, shortName } from "@/lib/chat-cloud";
import type { PublicStatus } from "@/lib/engines-server";
import { fetchSelfHealth, type HealthReport } from "@/lib/self-build-client";
import { useSystem } from "@/lib/use-system";
import { useViewActive } from "@/lib/view-active";

/** Política de IA de los chats: «Auto» (WILLY elige: plug and play), solo el equipo, IA externa o una externa concreta. */
export type AiPolicy = { id: string; label: string; short: string; detail: string };

export function aiPolicyOf(pick: string, status: PublicStatus | null): AiPolicy {
  // `label` va detrás de «IA: …» (barra superior) y de «Conversación general · IA …» (Chats): sin repetir «IA».
  if (pick === "smart") return { id: pick, label: "Auto", short: "Auto", detail: "WILLY elige la mejor IA para cada petición (gratis; si ninguna externa puede, tu equipo)." };
  if (pick === "local") return { id: pick, label: "Mi equipo", short: "Local", detail: "Contesta solo la IA de tu equipo: nada sale de tu ordenador." };
  if (pick === "externas") return { id: pick, label: "Externa", short: "Externa", detail: "Contestan las IA externas gratuitas que tienen clave, en tu orden; si ninguna puede, tu equipo." };
  const name = shortName(pick, status);
  return { id: pick, label: name, short: name, detail: `Contesta ${name}; si no puede, las demás y después tu equipo.` };
}

/** La política elegida, al día en todas las pantallas (misma clave que usan el Chat y el móvil). */
export function useAiPick(): string {
  const [pick, setPick] = useState("local");
  useEffect(() => {
    const sync = () => setPick(readChatPick());
    window.addEventListener(CHAT_PICK_EVENT, sync);
    window.addEventListener("storage", sync);
    sync();
    return () => { window.removeEventListener(CHAT_PICK_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return pick;
}

export type LocalEngine = { state: "comprobando" | "activo" | "parado" | "sin-datos"; text: string; models: number };

/** La IA del equipo (Ollama) según la lectura en directo del sistema. */
export function useLocalEngine(): LocalEngine {
  const { snapshot, error } = useSystem();
  if (!snapshot) return error ? { state: "sin-datos", text: "Sin datos", models: 0 } : { state: "comprobando", text: "Comprobando…", models: 0 };
  return snapshot.engine.alive
    ? { state: "activo", text: "Ollama activo", models: snapshot.engine.installed }
    : { state: "parado", text: "Ollama parado", models: snapshot.engine.installed };
}

export type Health = { state: "comprobando" | "funcionando" | "con avisos" | "con fallos" | "sin-respuesta"; report: HealthReport | null; at: number };

// Una sola consulta de salud compartida por la barra y la tarjeta (cada 60 s mientras la pestaña se ve).
let healthShared: Health = { state: "comprobando", report: null, at: 0 };
const healthListeners = new Set<() => void>();
let healthInflight: Promise<void> | null = null;

export function refreshHealth(maxAge = 0): Promise<void> {
  if (healthInflight) return healthInflight;
  if (maxAge > 0 && healthShared.at && Date.now() - healthShared.at < maxAge) return Promise.resolve();
  healthInflight = fetchSelfHealth()
    .then((report) => { healthShared = { state: report.overall, report, at: Date.now() }; })
    .catch(() => { healthShared = { ...healthShared, state: healthShared.report ? healthShared.state : "sin-respuesta", at: Date.now() }; })
    .finally(() => { healthInflight = null; for (const fn of healthListeners) fn(); });
  return healthInflight;
}

export function useHealth(): Health {
  const [health, setHealth] = useState(healthShared);
  const active = useViewActive();
  useEffect(() => {
    const fn = () => setHealth(healthShared);
    healthListeners.add(fn);
    void refreshHealth(30_000);
    const timer = window.setInterval(() => { if (active && document.visibilityState !== "hidden") void refreshHealth(); }, 60_000);
    return () => { healthListeners.delete(fn); window.clearInterval(timer); };
  }, [active]);
  return health;
}

export const healthText = (h: Health): string =>
  h.state === "funcionando" ? "Todo operativo" : h.state === "con avisos" ? "Con avisos" : h.state === "con fallos" ? "Con fallos" : h.state === "sin-respuesta" ? "Sin respuesta" : "Comprobando…";

export const healthTone = (h: Health): "ok" | "aviso" | "fallo" | "neutro" =>
  h.state === "funcionando" ? "ok" : h.state === "con avisos" ? "aviso" : h.state === "con fallos" || h.state === "sin-respuesta" ? "fallo" : "neutro";

/** Trabajos en marcha y los que esperan algo de ti (para «Proyectos: n trabajando» y «Necesita tu atención»). */
export function useWork(): { working: number; waiting: number; failed: number } {
  const tasks = useBackgroundTasks();
  return {
    working: tasks.filter((t) => t.state === "trabajando").length,
    waiting: tasks.filter((t) => t.state === "pregunta").length,
    failed: tasks.filter((t) => t.state === "error").length,
  };
}
