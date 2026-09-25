// Piezas comunes de las fuentes de datos en tiempo real: tipos, lectura de respuestas y formato en español.

export type Page = { title: string; url: string; text: string };
export type Res = { status: number; body: string };
export type Get = (url: string) => Promise<Res>;
export type Ctx = { get: Get; now: Date };
export type Params = Record<string, string>;

export type Group = "Tiempo y clima" | "Dinero" | "Conocimiento" | "España" | "Mundo" | "Ciencia y salud" | "Tecnología" | "Ocio y deporte";
export type Param = { name: string; label: string; placeholder: string; required?: boolean };

export type Connector = {
  id: string;
  name: string;
  group: Group;
  summary: string;
  provides: string;
  examples: string[];
  site: string;
  limits: string;
  /** Direcciones que esta fuente puede llamar (lista cerrada: nada más se abre). */
  hosts: string[];
  params: Param[];
  /** Con qué se prueba (botón «Probar»). */
  sample: Params;
  /** Segundos que se reutiliza una respuesta (por educación con la fuente, que es gratuita). */
  ttl: number;
  /** ¿Este mensaje pide esta fuente? Solo frases claras; en la duda, no (mejor no consultar que consultar sin querer). */
  detect: (text: string) => Params | null;
  run: (params: Params, ctx: Ctx) => Promise<Page>;
};

export const enc = encodeURIComponent;
export const RATE = "La fuente gratuita ha puesto un límite de consultas. Espera un minuto y vuelve a intentarlo.";

/** Comprueba el estado HTTP con mensajes claros. */
export function need(res: Res, what: string, allow: number[] = []): void {
  if (allow.includes(res.status)) return;
  if (res.status === 429) throw new Error(RATE);
  if (res.status >= 500) throw new Error(`${what} no responde ahora mismo (${res.status}).`);
  if (res.status < 200 || res.status >= 300) throw new Error(`${what} respondió ${res.status}.`);
}

export function json<T = any>(res: Res, what: string, allow: number[] = []): T {
  need(res, what, allow);
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error(`${what} devolvió algo que no es JSON.`);
  }
}

export const fmt = (value: number, digits = 1): string => value.toLocaleString("es-ES", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function big(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${fmt(value / 1e12, 2)} billones`;
  if (abs >= 1e9) return `${fmt(value / 1e9, 1)} mil millones`;
  if (abs >= 1e6) return `${fmt(value / 1e6, 1)} millones`;
  return fmt(value, 2);
}

/** «2026-09-21» en hora de Madrid. */
export function madridDay(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(now);
}
export function madridHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }).format(now)) % 24;
}
export function madridStamp(now: Date): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" }).format(now);
}

export function weekday(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

// ---------------------------------------------------------------- XML sencillo (RSS y Atom)
export function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
export const blocks = (xml: string, tag: string): string[] => [...xml.matchAll(new RegExp(`<${tag}[ >][\\s\\S]*?</${tag}>`, "g"))].map((m) => m[0]);
export const inner = (xml: string, tag: string): string => decode(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? "");

// ---------------------------------------------------------------- lugares y textos
const LETTER = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
const CAP = `[A-ZÁÉÍÓÚÑ][${LETTER}'.-]+`;
const PLACE_CAP = new RegExp(`(?:\\ben|\\bde|\\bpara|\\bpor|\\bsobre)\\s+((?:${CAP})(?:\\s+(?:de|del|la|las|los|el|y)?\\s*${CAP}){0,3})`, "g");
const NOT_PLACE = /^(hoy|ma[ñn]ana|ahora|casa|general|este|esta|estos|estas|el|la|los|las|un|una|esto|eso|mi|tu|su)$/i;

/** El lugar que se nombra en la frase: «en Sevilla», «para Buenos Aires». Vacío si no hay. */
export function placeOf(text: string): string {
  const found = [...text.matchAll(PLACE_CAP)].map((m) => m[1]!.trim()).filter((p) => !NOT_PLACE.test(p));
  if (found.length) return found[found.length - 1]!;
  const lower = new RegExp(`\\b(?:en|para|por)\\s+([a-záéíóúñü]{3,}(?:\\s+(?:de|del|la|las|los)?\\s*[a-záéíóúñü]{3,})?)\\s*(?:hoy|ma[ñn]ana|ahora|esta|este|\\?|$|,|\\.)`, "i").exec(text)?.[1]?.trim();
  return lower && !NOT_PLACE.test(lower) ? lower : "";
}

/** Un tema tras una expresión («libros de Cervantes» → «Cervantes»). */
export function after(text: string, pattern: RegExp): string {
  const found = pattern.exec(text)?.[1] ?? "";
  return found.replace(/[¿?¡!.,;:]+$/g, "").replace(/\s+(?:en|de)\s+(?:arxiv|pubmed|crossref)\b.*$/i, "").trim().slice(0, 100);
}

export const number = (raw: string): number => {
  const text = raw.trim();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) return Number(text.replace(/\./g, "").replace(",", "."));
  return Number(text.replace(",", "."));
};

export const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Palabra o frase completa, también si empieza o acaba en una letra con acento (`\b` de JavaScript no la reconoce como letra:
 * «últimas noticias» no casaría). Sin lookbehind, para que funcione en cualquier navegador.
 */
export const W = (source: string, flags = "iu"): RegExp => new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, flags);

/** Decimales fijos a la española (0,1200). */
export const fixed = (value: number, digits: number): string => value.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
