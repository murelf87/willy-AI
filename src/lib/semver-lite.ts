// VERSIONES DE LAS LIBRERÍAS (rediseño, revisión 27). Lo mínimo de «semver» (el sistema de versiones de npm) para instalar
// librerías sin npm: leer una versión («13.4.2», «2.0.0-beta.1»), compararlas y saber si una versión vale para lo que pide un
// proyecto en su package.json («^13.0.0», «~1.2», «>=1 <3», «1.x || 2.x», «1.2.3 - 2.0.0»…), con las mismas reglas que npm:
// las versiones de prueba («-beta») solo valen si se piden expresamente. Lógica pura: se prueba aparte (también contra el
// «semver» de npm, con miles de casos).

export type Version = { major: number; minor: number; patch: number; prerelease: Array<string | number>; raw: string };

const NUM = "0|[1-9]\\d*";
const PRE_ID = "(?:0|[1-9]\\d*|\\d*[a-zA-Z-][a-zA-Z0-9-]*)";
const PRE = `(?:-(${PRE_ID}(?:\\.${PRE_ID})*))`;
const BUILD = "(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))";
const FULL = new RegExp(`^v?=?\\s*(${NUM})\\.(${NUM})\\.(${NUM})${PRE}?${BUILD}?$`);
const XR = `(?:${NUM}|[xX*])`;
/** Una versión incompleta de un rango: «1», «1.2», «1.x», «*», «1.2.3-beta» (como en npm, puede llevar delante «v» o «=»). */
const PARTIAL = new RegExp(`^[v=\\s]*(${XR})(?:\\.(${XR})(?:\\.(${XR})${PRE}?${BUILD}?)?)?$`);

/** Lee una versión («v1.2.3», «1.2.3-beta.1+abc»); null si no lo es. */
export function parseVersion(text: string): Version | null {
  if (typeof text !== "string" || text.length > 256) return null;
  const m = FULL.exec(text.trim());
  if (!m) return null;
  const nums = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (nums.some((n) => !Number.isSafeInteger(n))) return null;
  const prerelease = m[4] ? m[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return { major: nums[0]!, minor: nums[1]!, patch: nums[2]!, prerelease, raw: text.trim() };
}

function comparePre(a: Array<string | number>, b: Array<string | number>): number {
  if (a.length && !b.length) return -1;
  if (!a.length && b.length) return 1;
  for (let i = 0; ; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = typeof x === "number";
    const yn = typeof y === "number";
    if (xn && !yn) return -1;
    if (!xn && yn) return 1;
    return x < y ? -1 : 1;
  }
}

/** -1, 0 o 1 (la «build» no cuenta, como en npm). */
export function compareVersions(a: Version, b: Version): number {
  return a.major !== b.major ? (a.major < b.major ? -1 : 1)
    : a.minor !== b.minor ? (a.minor < b.minor ? -1 : 1)
      : a.patch !== b.patch ? (a.patch < b.patch ? -1 : 1)
        : comparePre(a.prerelease, b.prerelease);
}

type Op = "" | "=" | "<" | ">" | "<=" | ">=";
type Comparator = { op: Op; v: Version } | { op: "any" };
type ComparatorSet = Comparator[];

const isX = (s: string | undefined): boolean => s === undefined || s === "" || s === "x" || s === "X" || s === "*";
const ver = (major: number, minor: number, patch: number, pre = ""): Version => parseVersion(`${major}.${minor}.${patch}${pre}`)!;

/** «^1.2.3» → [>=1.2.3, <2.0.0-0] (las mismas equivalencias que npm). null si no se entiende. */
function desugar(part: string): Comparator[] | null {
  if (part === "" || part === "*" || part === "x" || part === "X") return [{ op: "any" }];
  let m = /^(~>?|\^)(.*)$/.exec(part);
  if (m) {
    const kind = m[1]!.startsWith("~") ? "~" : "^";
    const p = PARTIAL.exec(m[2]!.trim());
    if (!p) return null;
    const [M, mi, pa, pre] = [p[1], p[2], p[3], p[4]];
    if (isX(M)) return [{ op: "any" }];
    const nM = Number(M);
    if (isX(mi)) return [{ op: ">=", v: ver(nM, 0, 0) }, { op: "<", v: ver(nM + 1, 0, 0, "-0") }];
    const nm = Number(mi);
    if (isX(pa)) {
      if (kind === "~" || nM !== 0) return kind === "~" ? [{ op: ">=", v: ver(nM, nm, 0) }, { op: "<", v: ver(nM, nm + 1, 0, "-0") }] : [{ op: ">=", v: ver(nM, nm, 0) }, { op: "<", v: ver(nM + 1, 0, 0, "-0") }];
      return [{ op: ">=", v: ver(nM, nm, 0) }, { op: "<", v: ver(nM, nm + 1, 0, "-0") }];
    }
    const np = Number(pa);
    const low = ver(nM, nm, np, pre ? `-${pre}` : "");
    if (kind === "~") return [{ op: ">=", v: low }, { op: "<", v: ver(nM, nm + 1, 0, "-0") }];
    if (nM !== 0) return [{ op: ">=", v: low }, { op: "<", v: ver(nM + 1, 0, 0, "-0") }];
    if (nm !== 0) return [{ op: ">=", v: low }, { op: "<", v: ver(nM, nm + 1, 0, "-0") }];
    return [{ op: ">=", v: low }, { op: "<", v: ver(nM, nm, np + 1, "-0") }];
  }
  m = /^(<=|>=|<|>|=)?(.*)$/.exec(part);
  if (!m) return null;
  let op = (m[1] ?? "") as Op;
  const rest = m[2]!.trim();
  const p = PARTIAL.exec(rest);
  if (!p) return null;
  const [M, mi, pa, pre] = [p[1], p[2], p[3], p[4]];
  const anyX = isX(M) || isX(mi) || isX(pa);
  // Una versión completa detrás de un operador solo puede llevar una «v» delante (npm no acepta «==1.2.3» ni «<==1.2.3»).
  if (!anyX && !/^v?\d/.test(rest)) return null;
  if (op === "=" && anyX) op = "";
  if (isX(M)) return op === ">" || op === "<" ? [{ op: "<", v: ver(0, 0, 0, "-0") }] : [{ op: "any" }];
  let nM = Number(M);
  let nm = isX(mi) ? 0 : Number(mi);
  let np = isX(pa) ? 0 : Number(pa);
  if (op && anyX) {
    // Como npm: con alguna «x», lo que va detrás no cuenta («<1.x.3» = «<1.0.0-0»).
    np = 0;
    let suffix = "";
    if (op === ">") {
      op = ">=";
      if (isX(mi)) { nM += 1; nm = 0; np = 0; } else { nm += 1; np = 0; }
    } else if (op === "<=") {
      op = "<";
      if (isX(mi)) nM += 1; else nm += 1;
      suffix = "-0";
    } else if (op === "<") {
      suffix = "-0";
    }
    return [{ op, v: ver(nM, nm, np, suffix) }];
  }
  if (isX(mi)) return [{ op: ">=", v: ver(nM, 0, 0) }, { op: "<", v: ver(nM + 1, 0, 0, "-0") }];
  if (isX(pa)) return [{ op: ">=", v: ver(nM, nm, 0) }, { op: "<", v: ver(nM, nm + 1, 0, "-0") }];
  const v = parseVersion(`${nM}.${nm}.${np}${pre ? `-${pre}` : ""}`);
  if (!v) return null;
  return [{ op, v }];
}

/** «1.2.3 - 2.3» → [>=1.2.3, <2.4.0-0]. */
function hyphen(from: string, to: string): Comparator[] | null {
  const f = PARTIAL.exec(from);
  const t = PARTIAL.exec(to);
  if (!f || !t) return null;
  const out: Comparator[] = [];
  if (!isX(f[1])) {
    const low = isX(f[2]) ? ver(Number(f[1]), 0, 0) : isX(f[3]) ? ver(Number(f[1]), Number(f[2]), 0) : parseVersion(`${f[1]}.${f[2]}.${f[3]}${f[4] ? `-${f[4]}` : ""}`);
    if (!low) return null;
    out.push({ op: ">=", v: low });
  }
  if (!isX(t[1])) {
    if (isX(t[2])) out.push({ op: "<", v: ver(Number(t[1]) + 1, 0, 0, "-0") });
    else if (isX(t[3])) out.push({ op: "<", v: ver(Number(t[1]), Number(t[2]) + 1, 0, "-0") });
    else {
      const high = parseVersion(`${t[1]}.${t[2]}.${t[3]}${t[4] ? `-${t[4]}` : ""}`);
      if (!high) return null;
      out.push({ op: "<=", v: high });
    }
  }
  return out.length ? out : [{ op: "any" }];
}

const rangeCache = new Map<string, ComparatorSet[] | null>();

/** Entiende un rango de versiones; null si no es un rango válido. */
function parseRange(range: string): ComparatorSet[] | null {
  if (typeof range !== "string" || range.length > 1024) return null;
  const hit = rangeCache.get(range);
  if (hit !== undefined) return hit;
  const sets: ComparatorSet[] = [];
  let bad = false;
  for (const raw of range.split("||")) {
    // Como npm: sin espacios entre el operador y la versión («>= 1.2» = «>=1.2»; «~ 1.2» = «~1.2»).
    const text = raw.trim().replace(/(<=|>=|<|>|=|~>?|\^)\s+/g, "$1");
    const h = /^(\S+)\s+-\s+(\S+)$/.exec(text);
    let set: Comparator[] | null;
    if (h) set = hyphen(h[1]!, h[2]!);
    else {
      set = [];
      for (const part of text.split(/\s+/)) {
        const c = desugar(part);
        if (!c) { set = null; break; }
        set.push(...c);
      }
    }
    if (!set) { bad = true; break; }
    const real = set.filter((c) => c.op !== "any");
    sets.push(real.length ? real : [{ op: "any" }]);
  }
  // Como npm: si alguna parte es «cualquiera» («*»), el rango entero es «*» (y entonces las versiones de prueba no valen).
  const any = sets.find((set) => set.length === 1 && set[0]!.op === "any");
  const out = bad || !sets.length ? null : any ? [any] : sets;
  if (rangeCache.size > 2000) rangeCache.clear();
  rangeCache.set(range, out);
  return out;
}

/** ¿Es un rango de versiones que se entiende? («^1.2.3», «latest» no: eso es una etiqueta). */
export function validRange(range: string): boolean {
  return parseRange(range) !== null;
}

function test(c: Comparator, v: Version): boolean {
  if (c.op === "any") return true;
  const r = compareVersions(v, c.v);
  switch (c.op) {
    case "": case "=": return r === 0;
    case "<": return r < 0;
    case ">": return r > 0;
    case "<=": return r <= 0;
    case ">=": return r >= 0;
  }
}

function testSet(set: ComparatorSet, v: Version): boolean {
  for (const c of set) if (!test(c, v)) return false;
  if (v.prerelease.length) {
    // Una versión de prueba solo vale si el rango habla de versiones de prueba de ESA misma versión (como npm).
    for (const c of set) {
      if (c.op === "any" || !c.v.prerelease.length) continue;
      if (c.v.major === v.major && c.v.minor === v.minor && c.v.patch === v.patch) return true;
    }
    return false;
  }
  return true;
}

/** ¿Vale esta versión para este rango? */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  const sets = parseRange(range);
  if (!v || !sets) return false;
  return sets.some((s) => testSet(s, v));
}

/** La versión más alta de la lista que vale para el rango (null si ninguna). */
export function maxSatisfying(versions: string[], range: string): string | null {
  let best: Version | null = null;
  let bestRaw: string | null = null;
  for (const raw of versions) {
    const v = parseVersion(raw);
    if (!v || !satisfies(raw, range)) continue;
    if (!best || compareVersions(v, best) > 0) { best = v; bestRaw = raw; }
  }
  return bestRaw;
}

/** Ordena versiones de menor a mayor (las que no son versiones, fuera). */
export function sortVersions(versions: string[]): string[] {
  return versions.map((raw) => ({ raw, v: parseVersion(raw) })).filter((x): x is { raw: string; v: Version } => x.v !== null).sort((a, b) => compareVersions(a.v, b.v)).map((x) => x.raw);
}
