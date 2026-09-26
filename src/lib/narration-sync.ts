// Narración sincronizada con un vídeo: lee cada línea traducida cuando el vídeo llega a su momento real.
//
// - Sigue al vídeo DE VERDAD: si lo pausas, la voz se pausa; si adelantas o retrocedes, salta a esa parte.
// - No corta frases: si una línea traducida es más larga que su hueco, se lee un poco más deprisa (hasta
//   1,35×, sin cambiar el tono) para llegar a tiempo a la siguiente. Solo si se va más de 6 s por detrás, salta.
// - Prepara la voz de las 2 líneas siguientes mientras suena la actual, para que cada una empiece a su hora.
//
// La lógica no depende del navegador (se prueba sola); `browserClip` es la pieza que suena de verdad.

export type NarrationLine = { start: number; text: string };

export type AudioClip = {
  /** Duración en segundos a velocidad normal (NaN si no se sabe). */
  readonly duration: number;
  /** Segundos ya sonados del audio. */
  position(): number;
  /** Empieza a sonar; la promesa se resuelve al terminar (o al detenerla). */
  play(rate: number): Promise<void>;
  pause(): void;
  resume(): void;
  setRate(rate: number): void;
  stop(): void;
};

export type NarrationDeps = {
  /** Prepara el audio de una línea (se llama por adelantado). */
  synth: (text: string, signal: AbortSignal) => Promise<Blob>;
  clip: (blob: Blob) => Promise<AudioClip>;
  /** Reloj real en milisegundos (para notar si el vídeo se ha movido a mano). */
  now?: () => number;
  onLine?: (index: number) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

export type NarrationOptions = {
  /** Líneas que se preparan por adelantado. */
  prefetch?: number;
  /** Velocidad máxima para no quedarse atrás. */
  maxRate?: number;
  /** Segundos de retraso a partir de los que se salta a lo que toca. */
  skipAfter?: number;
  /** Adelanto con el que se empieza cada línea (lo que tarda en arrancar el audio). */
  lead?: number;
  /** Diferencia (s) entre el tiempo esperado y el real a partir de la que se considera que has movido el vídeo. */
  seekJump?: number;
};

/** La línea que corresponde al segundo `t` del vídeo (la última que ya ha empezado), o -1. */
export function lineAt(lines: NarrationLine[], t: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.start <= t) idx = i;
  return idx;
}

type Pending = { ctrl: AbortController; blob: Promise<Blob> };
type Current = { index: number; clip: AudioClip | null; started: boolean; paused: boolean };

export class SyncNarrator {
  private next = 0;
  private current: Current | null = null;
  private readonly cache = new Map<number, Pending>();
  private stopped = false;
  private videoPaused = false;
  private lastTime = Number.NaN;
  private lastWall = Number.NaN;
  private lastPlaying = false;
  private rate = 1;
  private ended = false;
  private readonly errors = new Set<string>();

  constructor(private readonly lines: NarrationLine[], private readonly deps: NarrationDeps, private readonly opts: NarrationOptions = {}) {}

  /** Línea que está sonando (o preparándose), o -1. */
  get speaking(): number { return this.current?.index ?? -1; }
  get currentRate(): number { return this.rate; }
  get isStopped(): boolean { return this.stopped; }

  /** Prepara por adelantado el audio de las primeras líneas, SIN reproducir nada: para que cuando arranque
   *  el vídeo, la voz ya esté lista y las dos empiecen exactamente a la vez (si no, el vídeo empieza a sonar
   *  antes de que la síntesis de voz termine, y la narración entra tarde). */
  async warmup(count = 1): Promise<void> {
    const wanted: number[] = [];
    for (let i = 0; i < this.lines.length && wanted.length < count; i++) if (this.lines[i]!.text.trim()) wanted.push(i);
    await Promise.all(wanted.map((i) => (this.cache.get(i) ?? this.request(i)).blob.catch(() => undefined)));
  }

  /** Llamar a menudo (cada ~200 ms) con el segundo del vídeo y si se está reproduciendo. */
  tick(time: number, playing: boolean): void {
    if (this.stopped || !Number.isFinite(time)) return;
    const wall = (this.deps.now ?? Date.now)();
    if (!Number.isFinite(this.lastTime)) this.resync(time);
    else {
      const expected = this.lastTime + (this.lastPlaying ? (wall - this.lastWall) / 1000 : 0);
      if (Math.abs(time - expected) > (this.opts.seekJump ?? 2.5)) this.resync(time);
    }
    this.lastTime = time;
    this.lastWall = wall;
    this.lastPlaying = playing;

    if (!playing) { this.pauseAudio(); return; }
    this.resumeAudio();
    this.prefetch();

    const maxRate = this.opts.maxRate ?? 1.35;
    const skipAfter = this.opts.skipAfter ?? 6;
    if (this.current) {
      const nextStart = this.lines[this.current.index + 1]?.start ?? Number.POSITIVE_INFINITY;
      if (time - nextStart > skipAfter) {
        // Demasiado retraso: se deja esta línea y se pasa a la que toca ahora.
        this.stopCurrent();
        this.next = Math.max(this.next, lineAt(this.lines, time));
      } else if (this.current.clip && this.current.started) {
        const clip = this.current.clip;
        const remaining = Number.isFinite(clip.duration) ? Math.max(0, clip.duration - clip.position()) : Number.NaN;
        const available = nextStart - time;
        let rate = 1;
        if (available <= 0.05) rate = maxRate;
        else if (Number.isFinite(remaining) && remaining > available) rate = Math.min(maxRate, remaining / available);
        this.setRate(rate);
      }
    }
    if (!this.current) {
      while (this.next < this.lines.length && !this.lines[this.next]!.text.trim()) this.next++;
      const line = this.lines[this.next];
      if (!line) {
        if (!this.ended) { this.ended = true; this.deps.onEnd?.(); }
        return;
      }
      if (line.start <= time + (this.opts.lead ?? 0.15)) {
        const due = lineAt(this.lines, time);
        if (time - line.start > skipAfter && due > this.next) this.next = due;
        this.startLine(this.next);
        this.next += 1;
      }
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopCurrent();
    for (const p of this.cache.values()) p.ctrl.abort();
    this.cache.clear();
  }

  private resync(time: number): void {
    this.stopCurrent();
    this.ended = false;
    const idx = lineAt(this.lines, time);
    if (idx < 0) this.next = 0;
    else {
      const line = this.lines[idx]!;
      const slot = (this.lines[idx + 1]?.start ?? line.start + 8) - line.start;
      // Si has caído al principio de una línea, se lee; si ya va muy avanzada, se espera a la siguiente.
      this.next = time - line.start <= slot * 0.4 ? idx : idx + 1;
    }
    for (const [i, p] of this.cache) if (i < this.next - 1 || i > this.next + (this.opts.prefetch ?? 2) + 1) { p.ctrl.abort(); this.cache.delete(i); }
  }

  private request(i: number): Pending {
    const ctrl = new AbortController();
    const blob = this.deps.synth(this.lines[i]!.text, ctrl.signal);
    blob.catch(() => undefined);
    const pending = { ctrl, blob };
    this.cache.set(i, pending);
    return pending;
  }

  private prefetch(): void {
    const from = this.current ? this.current.index + 1 : this.next;
    let wanted = this.opts.prefetch ?? 2;
    for (let i = from; i < this.lines.length && wanted > 0; i++) {
      if (!this.lines[i]!.text.trim()) continue;
      if (!this.cache.has(i)) this.request(i);
      wanted--;
    }
    const keepFrom = (this.current?.index ?? this.next) - 1;
    for (const [i, p] of this.cache) if (i < keepFrom) { p.ctrl.abort(); this.cache.delete(i); }
  }

  private startLine(i: number): void {
    const cur: Current = { index: i, clip: null, started: false, paused: false };
    this.current = cur;
    this.rate = 1;
    this.deps.onLine?.(i);
    const pending = this.cache.get(i) ?? this.request(i);
    void pending.blob
      .then((blob) => this.deps.clip(blob))
      .then((clip) => {
        if (this.stopped || this.current !== cur) { clip.stop(); return; }
        cur.clip = clip;
        if (!this.videoPaused) this.begin(cur);
      })
      .catch((error: unknown) => {
        if (this.current === cur) this.current = null;
        if (this.stopped || pending.ctrl.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (!this.errors.has(message)) { this.errors.add(message); this.deps.onError?.(message); }
      });
  }

  private begin(cur: Current): void {
    if (!cur.clip || cur.started) return;
    cur.started = true;
    void cur.clip.play(this.rate).then(() => {
      if (this.current === cur) { this.current = null; this.rate = 1; }
    });
  }

  private pauseAudio(): void {
    this.videoPaused = true;
    const cur = this.current;
    if (cur?.clip && cur.started && !cur.paused) { cur.clip.pause(); cur.paused = true; }
  }

  private resumeAudio(): void {
    this.videoPaused = false;
    const cur = this.current;
    if (!cur?.clip) return;
    if (!cur.started) this.begin(cur);
    else if (cur.paused) { cur.clip.resume(); cur.paused = false; }
  }

  private setRate(rate: number): void {
    if (Math.abs(rate - this.rate) < 0.02) return;
    this.rate = rate;
    this.current?.clip?.setRate(rate);
  }

  private stopCurrent(): void {
    const cur = this.current;
    this.current = null;
    this.rate = 1;
    cur?.clip?.stop();
  }
}

// ------------------------------------------------------------------------------------------------ navegador

/** Duración de un .wav leyendo su cabecera (sin reproducirlo). */
export async function wavDuration(blob: Blob): Promise<number> {
  try {
    const head = new DataView(await blob.slice(0, 44).arrayBuffer());
    if (head.byteLength < 44 || head.getUint32(0, false) !== 0x52494646) return Number.NaN;
    const byteRate = head.getUint32(28, true);
    return byteRate > 0 ? Math.max(0, blob.size - 44) / byteRate : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/** Clip de audio real del navegador (mantiene el tono aunque suene más deprisa). */
export async function browserClip(blob: Blob): Promise<AudioClip> {
  const duration = await wavDuration(blob);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  let finished = false;
  let resolveEnd: () => void = () => undefined;
  const ended = new Promise<void>((resolve) => { resolveEnd = resolve; });
  const finish = () => {
    if (finished) return;
    finished = true;
    URL.revokeObjectURL(url);
    resolveEnd();
  };
  audio.onended = finish;
  audio.onerror = finish;
  return {
    duration,
    position: () => audio.currentTime,
    play: (rate) => {
      audio.playbackRate = rate;
      audio.play().catch(() => finish());
      return ended;
    },
    pause: () => audio.pause(),
    resume: () => { audio.play().catch(() => finish()); },
    setRate: (rate) => { audio.playbackRate = rate; },
    stop: () => { audio.pause(); finish(); },
  };
}
