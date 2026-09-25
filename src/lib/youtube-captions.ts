// Subtítulos reales de un vídeo de YouTube, para traducirlos y leerlos sincronizados con el vídeo.
// Todo ocurre en el equipo del dueño: solo se habla con youtube.com.
//
// Por qué hay varias vías: desde 2025 YouTube exige un «token de origen» para descargar los subtítulos que
// ofrece la página web normal; sin él devuelve el archivo VACÍO aunque el vídeo tenga subtítulos. Los de la
// app de Android (y otras apps) no lo exigen. Por eso se prueba primero como la app de Android, luego como
// otras apps y, al final, con la página web. Y no basta con que una vía «liste» subtítulos: se descarga el
// contenido y, si llega vacío, se pasa a la siguiente vía en vez de rendirse.

export type Segment = { start: number; dur: number; text: string };
export type Track = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text?: string }[] };
  vssId?: string;
};
type Playability = { status?: string; reason?: string; messages?: string[] };

export type CaptionsFailure = "red" | "no-existe" | "robot" | "edad" | "directo" | "sin-subtitulos" | "vacio";
export type CaptionsResult =
  | { ok: true; videoId: string; title: string; lang: string; segments: Segment[]; via: string }
  | { ok: false; videoId: string; title: string; code: CaptionsFailure; error: string };

/** Último recurso opcional (por ejemplo, yt-dlp). Devuelve null si tampoco lo consigue. */
export type CaptionsFallback = (videoId: string) => Promise<{ segments: Segment[]; lang: string; title?: string } | null>;

export type CaptionDeps = {
  fetchImpl?: typeof fetch;
  /** Tiempo máximo de cada petición a YouTube. */
  timeoutMs?: number;
  /** Tiempo máximo total para todas las vías integradas (sin contar el último recurso). */
  budgetMs?: number;
  fallback?: CaptionsFallback;
  now?: () => number;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Sin esta cookie, YouTube redirige a una pantalla de consentimiento (muy frecuente desde IPs de la Unión
// Europea, incluida España) y la página llega sin datos del vídeo.
const CONSENT_COOKIE = "CONSENT=YES+cb; SOCS=CAI";

// Clave pública de la web de YouTube (la misma que usa su propia página). Si la página trae otra, se usa esa.
const PUBLIC_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

/** Las «apps» con las que se piden los datos del vídeo, en orden: las primeras no exigen el token de origen. */
export const INNERTUBE_CLIENTS: ReadonlyArray<{ label: string; client: Record<string, unknown>; extra?: Record<string, unknown> }> = [
  { label: "app de Android", client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, osName: "Android", osVersion: "11" } },
  { label: "app de realidad virtual", client: { clientName: "ANDROID_VR", clientVersion: "1.62.27", androidSdkVersion: 32, deviceMake: "Oculus", deviceModel: "Quest 3", osName: "Android", osVersion: "12L" } },
  { label: "app de iPhone", client: { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" } },
  { label: "reproductor de TV", client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0" }, extra: { thirdParty: { embedUrl: "https://www.youtube.com/" } } },
  { label: "web del móvil", client: { clientName: "MWEB", clientVersion: "2.20250311.03.00" } },
  { label: "web", client: { clientName: "WEB", clientVersion: "2.20250312.04.00" } },
];

export function videoIdOf(url: string): string | null {
  const clean = url.trim();
  if (/^[\w-]{11}$/.test(clean)) return clean;
  const patterns = [/[?&]v=([\w-]{11})/, /youtu\.be\/([\w-]{11})/, /\/shorts\/([\w-]{11})/, /\/embed\/([\w-]{11})/, /\/live\/([\w-]{11})/, /\/v\/([\w-]{11})/];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export const isShortUrl = (url: string): boolean => /\/shorts\//i.test(url);

// ------------------------------------------------------------------------------------------------ elegir pista

const isAuto = (t: Track) => t.kind === "asr";
/** Las pistas de subtítulos, de mejor a peor: español hecho a mano, español automático, inglés a mano, inglés
 *  automático y el resto (a mano antes que automáticas). Las que exigen el token de origen van al final. */
export function rankTracks(tracks: Track[]): Track[] {
  const score = (t: Track): number => {
    const lang = (t.languageCode ?? "").toLowerCase().split("-")[0];
    const base = lang === "es" ? 0 : lang === "en" ? 2 : 4;
    const needsToken = /[?&]exp=xpe/.test(t.baseUrl ?? "") ? 10 : 0;
    return base + (isAuto(t) ? 1 : 0) + needsToken;
  };
  return tracks.filter((t) => t.baseUrl).map((t, i) => ({ t, i, s: score(t) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.t);
}

export function pickTrack(tracks: Track[]): Track | null {
  return rankTracks(tracks)[0] ?? null;
}

/** Dirección de descarga de una pista en el formato pedido ("json3" o el XML clásico si fmt = ""). */
export function captionUrl(baseUrl: string, fmt: "json3" | ""): string {
  const url = baseUrl.replace(/\\u0026/g, "&").replace(/([?&])fmt=[^&]*(&|$)/, (_m, a: string, b: string) => (b ? a : "")).replace(/[?&]$/, "");
  if (!fmt) return url;
  return `${url}${url.includes("?") ? "&" : "?"}fmt=${fmt}`;
}

// ------------------------------------------------------------------------------------------------ leer el archivo

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// YouTube escapa dos veces el texto del XML («&amp;#39;» → «&#39;» → «'»): por eso se decodifica dos veces.
const clean = (s: string) => decodeEntities(decodeEntities(s.replace(/<[^>]+>/g, ""))).replace(/\s+/g, " ").trim();

function vttTime(s: string): number {
  const parts = s.trim().replace(",", ".").split(":").map(Number);
  return parts.reduce((acc, n) => acc * 60 + (Number.isFinite(n) ? n : 0), 0);
}

/** Entiende los formatos en que YouTube (o yt-dlp, o un archivo .vtt/.srt) entrega los subtítulos. */
export function parseCaptions(body: string): Segment[] {
  const text = body.replace(/^﻿/, "").trim();
  if (!text) return [];
  // json3
  if (text.startsWith("{")) {
    try {
      const data = JSON.parse(text) as { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] };
      return (data.events ?? [])
        .map((e) => ({ start: (e.tStartMs ?? 0) / 1000, dur: (e.dDurationMs ?? 0) / 1000, text: (e.segs ?? []).map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim() }))
        .filter((s) => s.text);
    } catch {
      return [];
    }
  }
  const out: Segment[] = [];
  // XML clásico (srv1): <text start="1.2" dur="3.4">…</text>
  if (/<text\b/.test(text)) {
    const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const attrs = m[1] ?? "";
      const start = Number(/\bstart="([\d.]+)"/.exec(attrs)?.[1] ?? NaN);
      const dur = Number(/\bdur="([\d.]+)"/.exec(attrs)?.[1] ?? 0);
      const body2 = clean(m[2] ?? "");
      if (body2 && Number.isFinite(start)) out.push({ start, dur, text: body2 });
    }
    return out;
  }
  // XML nuevo (srv3): <p t="1200" d="3400"><s>…</s></p> (tiempos en milisegundos)
  if (/<p\b[^>]*\bt="\d+"/.test(text)) {
    const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const attrs = m[1] ?? "";
      const t = Number(/\bt="(\d+)"/.exec(attrs)?.[1] ?? NaN);
      const d = Number(/\bd="(\d+)"/.exec(attrs)?.[1] ?? 0);
      const body2 = clean(m[2] ?? "");
      if (body2 && Number.isFinite(t)) out.push({ start: t / 1000, dur: d / 1000, text: body2 });
    }
    return out;
  }
  // WebVTT / SRT: «00:00:01.000 --> 00:00:04.000» seguido del texto.
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at]!.split("-->");
    const start = vttTime((a ?? "").trim());
    const end = vttTime((b ?? "").trim().split(/\s+/)[0] ?? "");
    const words = clean(lines.slice(at + 1).join(" "));
    if (words && Number.isFinite(start)) out.push({ start, dur: Math.max(0, end - start), text: words });
  }
  // Los subtítulos automáticos en .vtt repiten la línea anterior en cada bloque: se quitan las repeticiones.
  const dedup: Segment[] = [];
  for (const s of out) {
    const prev = dedup[dedup.length - 1];
    if (prev && (s.text === prev.text || prev.text.endsWith(s.text))) continue;
    if (prev && s.text.startsWith(prev.text)) { s.text = s.text.slice(prev.text.length).trim(); if (!s.text) continue; }
    dedup.push(s);
  }
  return dedup;
}

/** Agrupa los subtítulos en frases de varios segundos: se traducen mucho mejor y la voz suena natural. */
export function groupSegments(segments: Segment[], seconds = 8): Segment[] {
  const out: Segment[] = [];
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start - last.start < seconds) {
      last.text = `${last.text} ${s.text}`.trim();
      last.dur = Math.max(last.dur, s.start + s.dur - last.start);
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ hablar con YouTube

/** Lee el valor JSON (objeto o lista) que empieza en `start`, contando llaves y corchetes y respetando las cadenas. */
export function jsonValueAt(text: string, start: number): unknown {
  const open = text[start];
  if (open !== "{" && open !== "[") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** El primer valor JSON válido que aparece justo después de `marker` (se prueban todas sus apariciones). */
export function jsonAfter(text: string, marker: RegExp): unknown {
  const re = new RegExp(marker.source, marker.flags.includes("g") ? marker.flags : `${marker.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length;
    while (i < text.length && /\s/.test(text[i]!)) i++;
    const value = jsonValueAt(text, i);
    if (value !== null) return value;
    if (m[0].length === 0) re.lastIndex++;
  }
  return null;
}

type PlayerData = {
  playabilityStatus?: Playability;
  videoDetails?: { title?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
};

const tracksOf = (d: PlayerData | null | undefined): Track[] => d?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

/** Qué le pasa al vídeo, en palabras claras (o null si se puede ver). */
export function playabilityProblem(p: Playability | undefined): { code: CaptionsFailure; error: string } | null {
  if (!p?.status || p.status === "OK") return null;
  const reason = [p.reason, ...(p.messages ?? [])].filter(Boolean).join(" ").trim();
  const low = reason.toLowerCase();
  if (/bot|robot/.test(low)) return { code: "robot", error: "YouTube ha pedido comprobar que no eres un robot y no deja leer los subtítulos ahora mismo. Suele pasarse solo: vuelve a intentarlo en un rato." };
  if (/age|edad|inappropriate|inapropiado/.test(low)) return { code: "edad", error: "Este vídeo tiene restricción de edad: YouTube no deja leer sus subtítulos sin iniciar sesión." };
  if (p.status === "LIVE_STREAM_OFFLINE" || /live|directo|premiere|estreno|will begin|comenzará/.test(low)) return { code: "directo", error: "Es un directo o un estreno que todavía no ha empezado (o ya no está disponible): aún no tiene subtítulos que leer." };
  if (p.status === "ERROR" || p.status === "UNPLAYABLE" || p.status === "LOGIN_REQUIRED") {
    return { code: "no-existe", error: `No se puede abrir ese vídeo${reason ? ` («${reason}»)` : ""}: puede ser privado, haberse borrado o estar bloqueado en tu país.` };
  }
  return { code: "no-existe", error: `YouTube no deja abrir ese vídeo${reason ? ` («${reason}»)` : ""}.` };
}

export async function fetchCaptions(videoId: string, deps: CaptionDeps = {}, opts: { isShort?: boolean } = {}): Promise<CaptionsResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.budgetMs ?? 60_000);
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const outOfTime = () => now() > deadline;

  let title = "";
  let reachedYouTube = false;
  let sawTracks = false;
  let problem: { code: CaptionsFailure; error: string } | null = null;
  let apiKey = PUBLIC_KEY;

  const get = async (url: string, init: RequestInit = {}): Promise<Response | null> => {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      reachedYouTube = true;
      return res;
    } catch {
      return null;
    }
  };

  /** Descarga el contenido de las mejores pistas; devuelve los trozos o null si todas llegan vacías. */
  const download = async (tracks: Track[]): Promise<{ segments: Segment[]; lang: string } | null> => {
    for (const track of rankTracks(tracks).slice(0, 3)) {
      for (const fmt of ["json3", ""] as const) {
        if (outOfTime()) return null;
        const res = await get(captionUrl(track.baseUrl!, fmt), { headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9,en;q=0.5", Cookie: CONSENT_COOKIE } });
        if (!res?.ok) continue;
        const segments = parseCaptions(await res.text().catch(() => ""));
        if (segments.length) return { segments, lang: track.languageCode ?? "" };
      }
    }
    return null;
  };

  // 1) La página del vídeo: da el título, la clave de la web y una primera lista de subtítulos (que solo se
  //    usará al final, porque es la que más a menudo exige el token de origen).
  let pageTracks: Track[] = [];
  const page = await get(`https://www.youtube.com/watch?v=${videoId}&hl=es&persist_hl=1&gl=ES&bpctr=9999999999&has_verified=1`, {
    headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9,en;q=0.5", Cookie: CONSENT_COOKIE },
  });
  if (page?.ok) {
    const html = await page.text().catch(() => "");
    apiKey = /"INNERTUBE_API_KEY":\s*"([\w-]+)"/.exec(html)?.[1] ?? apiKey;
    const data = jsonAfter(html, /ytInitialPlayerResponse\s*=\s*/) as PlayerData | null;
    title = data?.videoDetails?.title ?? decodeEntities(/<meta name="title" content="([^"]*)"/.exec(html)?.[1] ?? "");
    pageTracks = tracksOf(data);
    if (!pageTracks.length) {
      // Por si la página cambia de forma: la lista suelta de pistas.
      const loose = jsonAfter(html, /"captionTracks":\s*/);
      pageTracks = Array.isArray(loose) ? (loose as Track[]) : [];
    }
    problem = playabilityProblem(data?.playabilityStatus) ?? problem;
  }

  // 2) Como las apps de YouTube (no exigen el token de origen).
  for (const { client, extra } of INNERTUBE_CLIENTS) {
    if (outOfTime()) break;
    const res = await get(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9,en;q=0.5", Cookie: CONSENT_COOKIE },
      body: JSON.stringify({ videoId, context: { client: { ...client, hl: "es", gl: "ES" }, ...(extra ?? {}) }, contentCheckOk: true, racyCheckOk: true }),
    });
    if (!res?.ok) continue;
    const data = (await res.json().catch(() => null)) as PlayerData | null;
    if (!data) continue;
    title = title || data.videoDetails?.title || "";
    const issue = playabilityProblem(data.playabilityStatus);
    const tracks = tracksOf(data);
    if (issue && !tracks.length) { problem = problem ?? issue; continue; }
    if (!tracks.length) continue;
    sawTracks = true;
    const got = await download(tracks);
    if (got) return { ok: true, videoId, title, lang: got.lang, segments: groupSegments(got.segments), via: String(client["clientName"]) };
  }

  // 3) La lista de la página web.
  if (pageTracks.length && !outOfTime()) {
    sawTracks = true;
    const got = await download(pageTracks);
    if (got) return { ok: true, videoId, title, lang: got.lang, segments: groupSegments(got.segments), via: "WEB-PAGINA" };
  }

  // 4) Último recurso (yt-dlp), si WILLY lo tiene.
  if (deps.fallback) {
    const fb = await deps.fallback(videoId).catch(() => null);
    if (fb?.segments.length) return { ok: true, videoId, title: title || fb.title || "", lang: fb.lang, segments: groupSegments(fb.segments), via: "yt-dlp" };
  }

  if (!reachedYouTube) return { ok: false, videoId, title, code: "red", error: "No he podido conectar con YouTube para leer los subtítulos. Revisa tu conexión a internet y vuelve a intentarlo." };
  if (problem && !sawTracks) return { ok: false, videoId, title, ...problem };
  if (sawTracks) return { ok: false, videoId, title, code: "vacio", error: "Este vídeo tiene subtítulos, pero YouTube no ha dejado descargarlos ahora mismo (a veces lo limita durante un rato). Vuelve a intentarlo en unos minutos." };
  if (!title) return { ok: false, videoId, title, code: "no-existe", error: "No encuentro ese vídeo (puede ser privado, haberse borrado o estar bloqueado en tu país)." };
  return {
    ok: false,
    videoId,
    title,
    code: "sin-subtitulos",
    error: opts.isShort
      ? "Este Short no tiene subtítulos (la mayoría de los Shorts no los tienen, ni siquiera automáticos), así que no se puede traducir lo que se dice."
      : "Este vídeo no tiene subtítulos (ni en español, ni en otro idioma, ni automáticos), así que no se puede traducir lo que se dice.",
  };
}
