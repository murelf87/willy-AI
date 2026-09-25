// Diferencias REALES entre dos versiones de un proyecto (rediseño, punto 94): qué archivos se han añadido, cambiado o quitado,
// las líneas exactas de cada uno y un resumen en palabras («Se ha actualizado la navegación y los estilos»). Lógica pura, sin
// pantalla: la usa la pestaña «Cambios» de SUPER WILLY y se prueba aparte (cctest/rev21.ts).

export type DiffOp = { type: "same" | "add" | "del"; text: string; /** Línea en el archivo de antes (1…). */ a?: number; /** Línea en el de ahora (1…). */ b?: number };
export type LineDiff = { ops: DiffOp[]; added: number; removed: number; /** false si el archivo era tan distinto que se da como «sustituido entero». */ exact: boolean };

const splitLines = (text: string): string[] => {
  const clean = text.replace(/\r\n?/g, "\n");
  if (!clean) return [];
  const lines = clean.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

/** Diferencias por líneas (subsecuencia común más larga en la zona que cambia). */
export function diffLines(before: string, after: string, maxCells = 4_000_000): LineDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: "same", text: a[i]!, a: i + 1, b: i + 1 });

  const n = endA - start;
  const m = endB - start;
  let exact = true;
  const middle: DiffOp[] = [];
  if (n === 0) {
    for (let j = 0; j < m; j++) middle.push({ type: "add", text: b[start + j]!, b: start + j + 1 });
  } else if (m === 0) {
    for (let i = 0; i < n; i++) middle.push({ type: "del", text: a[start + i]!, a: start + i + 1 });
  } else if ((n + 1) * (m + 1) <= maxCells) {
    // Tabla de la subsecuencia común más larga, de atrás hacia delante (así se recorre hacia delante al reconstruir).
    const width = m + 1;
    const big = n > 65_000 || m > 65_000;
    const table: Uint16Array | Uint32Array = big ? new Uint32Array((n + 1) * width) : new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      const ai = a[start + i];
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = ai === b[start + j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) { middle.push({ type: "same", text: a[start + i]!, a: start + i + 1, b: start + j + 1 }); i++; j++; }
      else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) { middle.push({ type: "del", text: a[start + i]!, a: start + i + 1 }); i++; }
      else { middle.push({ type: "add", text: b[start + j]!, b: start + j + 1 }); j++; }
    }
    for (; i < n; i++) middle.push({ type: "del", text: a[start + i]!, a: start + i + 1 });
    for (; j < m; j++) middle.push({ type: "add", text: b[start + j]!, b: start + j + 1 });
  } else {
    // Demasiado distinto para compararlo línea a línea sin bloquear la pantalla: se da como sustituido.
    exact = false;
    for (let i = 0; i < n; i++) middle.push({ type: "del", text: a[start + i]!, a: start + i + 1 });
    for (let j = 0; j < m; j++) middle.push({ type: "add", text: b[start + j]!, b: start + j + 1 });
  }
  ops.push(...middle);
  for (let k = 0; k < a.length - endA; k++) ops.push({ type: "same", text: a[endA + k]!, a: endA + k + 1, b: endB + k + 1 });
  return {
    ops,
    added: ops.filter((o) => o.type === "add").length,
    removed: ops.filter((o) => o.type === "del").length,
    exact,
  };
}

export type Hunk = { aStart: number; bStart: number; lines: DiffOp[] };

/** Agrupa los cambios en bloques con unas líneas de contexto alrededor (como un «diff» normal). */
export function hunksOf(ops: DiffOp[], context = 3): Hunk[] {
  const changed = ops.map((o, i) => (o.type === "same" ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return [];
  const ranges: Array<[number, number]> = [];
  for (const i of changed) {
    const from = Math.max(0, i - context);
    const to = Math.min(ops.length - 1, i + context);
    const last = ranges.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  return ranges.map(([from, to]) => {
    const lines = ops.slice(from, to + 1);
    const firstA = lines.find((o) => o.a !== undefined)?.a ?? 0;
    const firstB = lines.find((o) => o.b !== undefined)?.b ?? 0;
    return { aStart: firstA, bStart: firstB, lines };
  });
}

type FileLike = { path: string; content: string };
export type FileChange = { path: string; status: "añadido" | "eliminado" | "modificado"; added: number; removed: number; exact: boolean };

const keyOf = (path: string): string => path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();

/** Qué ha cambiado entre dos juegos de archivos (los que siguen igual no salen). Mismo criterio de nombres que Windows. */
export function compareFiles(before: FileLike[], after: FileLike[]): FileChange[] {
  const old = new Map(before.map((f) => [keyOf(f.path), f]));
  const now = new Map(after.map((f) => [keyOf(f.path), f]));
  const out: FileChange[] = [];
  for (const [key, file] of now) {
    const prev = old.get(key);
    if (!prev) {
      out.push({ path: file.path, status: "añadido", added: splitLines(file.content).length, removed: 0, exact: true });
      continue;
    }
    if (prev.content === file.content) continue;
    const d = diffLines(prev.content, file.content);
    if (!d.added && !d.removed) continue; // solo cambian los saltos de línea
    out.push({ path: file.path, status: "modificado", added: d.added, removed: d.removed, exact: d.exact });
  }
  for (const [key, file] of old) {
    if (!now.has(key)) out.push({ path: file.path, status: "eliminado", added: 0, removed: splitLines(file.content).length, exact: true });
  }
  const order = { modificado: 0, añadido: 1, eliminado: 2 } as const;
  return out.sort((x, y) => order[x.status] - order[y.status] || x.path.localeCompare(y.path));
}

// Qué parte del proyecto es cada archivo, en palabras de cualquiera (para el resumen).
const AREAS: Array<[RegExp, string]> = [
  [/(?:^|\/)vista-previa\.html?$/i, "la vista previa"],
  [/(?:nav|menu|navbar|sidebar|header|cabecera|topbar)/i, "la navegación"],
  [/(?:dashboard|panel|admin)/i, "el panel"],
  [/(?:login|auth|registro|signup|signin|sesion|session)/i, "el acceso"],
  [/(?:footer|pie)/i, "el pie de página"],
  [/(?:form|formulario|contact|contacto|reserva|booking|checkout|carrito|cart)/i, "los formularios"],
  [/(?:\.css$|\.scss$|style|estilo|theme|tema|tailwind|design-system)/i, "los estilos"],
  [/(?:^|\/)(?:api|server|servidor|backend)(?:\/|\.|$)|routes\/api/i, "el servidor"],
  [/(?:\bdb\b|database|schema|prisma|\.sql$|migrat|models?\/)/i, "los datos"],
  [/(?:\.test\.|\.spec\.|__tests__|(?:^|\/)tests?\/)/i, "las pruebas"],
  [/(?:readme|(?:^|\/)docs\/|manual|\.md$)/i, "la documentación"],
  [/(?:^|\/)package\.json$/i, "las dependencias"],
  [/(?:responsive|mobile|movil)/i, "la versión móvil"],
];

const joinEs = (items: string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`);

/** Resumen humano: «Se ha actualizado la navegación y los estilos (2 archivos cambiados, 1 nuevo)». */
export function changeSummary(changes: FileChange[]): string {
  if (!changes.length) return "No hay cambios: los archivos son iguales.";
  const areas: string[] = [];
  for (const c of changes) {
    const hit = AREAS.find(([re]) => re.test(c.path))?.[1];
    if (hit && !areas.includes(hit)) areas.push(hit);
  }
  const counts = [
    ["modificado", "cambiado", "cambiados"],
    ["añadido", "nuevo", "nuevos"],
    ["eliminado", "quitado", "quitados"],
  ] as const;
  const parts = counts
    .map(([status, one, many]) => {
      const n = changes.filter((c) => c.status === status).length;
      return n ? `${n} ${n === 1 ? `archivo ${one}` : `archivos ${many}`}` : "";
    })
    .filter(Boolean);
  // Solo el primero lleva «archivo(s)»: «2 archivos cambiados, 1 nuevo».
  const tally = parts.map((p, i) => (i === 0 ? p : p.replace(/ archivos? /, " "))).join(", ");
  if (!areas.length) {
    const names = changes.slice(0, 3).map((c) => c.path.split("/").pop() ?? c.path);
    return `${tally[0]!.toUpperCase()}${tally.slice(1)}: ${joinEs(names)}${changes.length > 3 ? "…" : ""}.`;
  }
  return `Se ha actualizado ${joinEs(areas.slice(0, 4))}${areas.length > 4 ? " y más" : ""} (${tally}).`;
}
