// FORMATO DE PROGRAMA DE ESCRITORIO (Windows) que empaqueta la fábrica de instaladores. Funciones puras: las usan la pantalla
// (para saber si la última prueba corresponde al código actual) y el servidor (para montar el paquete).
//
// Un programa de escritorio de WILLY no necesita compilar nada: su pantalla es HTML/CSS/JS que el motor de escritorio sirve en
// el propio equipo, su lógica (opcional) es un módulo de Node con solo módulos integrados, y sus pruebas de aceptación usan
// node:test. Así la fábrica puede instalarlo, arrancarlo y probarlo DE VERDAD sin herramientas de terceros.

export type ProjectFile = { path: string; content: string };

export type ProgramInfo = {
  id: string;
  nombre: string;
  version: string;
  descripcion: string;
  entrada: string;
  ventana: { ancho: number; alto: number } | null;
};

export type PackagePlan = {
  ok: boolean;
  errores: string[];
  avisos: string[];
  programa: ProgramInfo;
  /** Archivos del paquete con su ruta final (app/…, servidor/…, pruebas/…, LEEME.md, LICENCIA.txt). */
  archivos: ProjectFile[];
  /** Pruebas de aceptación encontradas (rutas del paquete). */
  pruebas: string[];
  tieneLogica: boolean;
};

export const FORMAT_LIMITS = { fileBytes: 5 * 1024 * 1024, totalBytes: 50 * 1024 * 1024, files: 3000 } as const;

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const NODE_BUILTINS = new Set([
  "assert", "assert/strict", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram",
  "diagnostics_channel", "dns", "dns/promises", "events", "fs", "fs/promises", "http", "http2", "https", "module", "net", "os",
  "path", "path/posix", "path/win32", "perf_hooks", "process", "querystring", "readline", "readline/promises", "sqlite", "stream",
  "stream/promises", "stream/web", "string_decoder", "test", "timers", "timers/promises", "tls", "tty", "url", "util", "util/types",
  "v8", "vm", "worker_threads", "zlib",
]);

/** Identificador del programa: minúsculas sin acentos, números y guiones (sirve para carpetas, registro y nombre del motor). */
export function programId(nombre: string): string {
  const base = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return base.length >= 2 ? base : `programa-${base || "propio"}`.slice(0, 40);
}

/** Nombre válido para archivos y accesos directos de Windows (conserva acentos y espacios). */
export function windowsName(nombre: string): string {
  let limpio = nombre.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 60).trim();
  if (!limpio) limpio = "Programa";
  return RESERVED_WINDOWS.test(limpio) ? `${limpio} (programa)` : limpio;
}

/** Nombre para ARCHIVOS del programa (lanzador, accesos directos e instalador): como windowsName, sin los signos que la
 *  consola de Windows interpreta (% ! ^), para poder instalarlo y probarlo en silencio con cualquier nombre. */
export function fileSafeName(nombre: string): string {
  return windowsName(windowsName(nombre).replace(/[%!^]/g, " "));
}

/** Nombre del motor de cada programa (Node con otro nombre): así cerrar un programa nunca cierra otro, ni WILLY. */
export const motorExeName = (id: string): string => `${id}-motor.exe`;

function normalizePath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  if (!p || p.length > 240 || /[\u0000-\u001f:*?"<>|]/.test(p)) return null;
  const parts = p.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "" || RESERVED_WINDOWS.test(part.replace(/\..*$/, "")))) return null;
  return p;
}

const EXCLUDED = /^(docs|node_modules|dist|build|\.git|\.vscode|\.idea)\//i;
const BINARY_EXT = /\.(exe|msi|dll|so|dylib|bat|cmd|ps1|vbs|scr|com|lnk|zip|7z|rar)$/i;

function parseProgramJson(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const raw = JSON.parse(text) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Módulos que importa un archivo JS (import … from "x", import("x"), export … from "x"). */
export function importedModules(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?:^|[\s;}])(?:import|export)\s[^'";]*?from\s*["']([^"']+)["']|(?:^|[\s;}])import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec) out.add(spec);
  }
  return [...out];
}

/** Módulos de Node que solo existen con el prefijo «node:» (import "test" sería un paquete de npm, no el de Node). */
const PREFIX_ONLY = new Set(["test", "sqlite"]);

function isAllowedImport(spec: string): boolean {
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) return true;
  if (spec.startsWith("node:")) return NODE_BUILTINS.has(spec.slice(5));
  return NODE_BUILTINS.has(spec) && !PREFIX_ONLY.has(spec);
}

/** En la pantalla (navegador) solo valen archivos propios: «./x.js», «../x.js» o «/x.js». */
function isAllowedBrowserImport(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/");
}

/**
 * Prepara el paquete de un programa de escritorio a partir de los archivos del proyecto. No inventa nada: si falta algo
 * imprescindible lo dice en `errores` (y `ok` es falso); lo que conviene revisar va en `avisos`.
 */
export function planDesktopPackage(files: ProjectFile[], meta: { name: string; description?: string }): PackagePlan {
  const errores: string[] = [];
  const avisos: string[] = [];
  const byPath = new Map<string, string>();
  for (const f of files) {
    const p = normalizePath(String(f.path ?? ""));
    if (!p) {
      errores.push(`Ruta no válida en el proyecto: «${String(f.path)}».`);
      continue;
    }
    if (EXCLUDED.test(`${p}/`) || EXCLUDED.test(p) || /^\.env/i.test(p.split("/").pop() ?? "")) continue;
    byPath.set(p, String(f.content ?? ""));
  }

  const hasAppDir = [...byPath.keys()].some((p) => p.startsWith("app/"));
  const out = new Map<string, string>();
  let origen = "";
  for (const [p, content] of byPath) {
    const lower = p.toLowerCase();
    if (lower === "programa.json" || lower === "vista-previa.html") continue;
    if (/^(readme|leeme)(\.md|\.txt)?$/i.test(p)) {
      out.set("LEEME.md", content);
      continue;
    }
    if (/^(license|licence|licencia)(\.md|\.txt)?$/i.test(p)) {
      out.set("LICENCIA.txt", content);
      continue;
    }
    if (p.startsWith("runtime/") || p.startsWith("motor/")) {
      errores.push(`«${p}»: las carpetas runtime/ y motor/ las pone la fábrica; usa app/, servidor/ o pruebas/.`);
      continue;
    }
    if (BINARY_EXT.test(p)) {
      avisos.push(`«${p}» no se incluye: los programas no llevan ejecutables ni scripts de sistema.`);
      continue;
    }
    if (p.startsWith("app/") || p.startsWith("servidor/") || p.startsWith("pruebas/")) {
      out.set(p, content);
    } else if (!hasAppDir && !p.includes("/") && /\.(html?|css|m?js|json|svg|png|jpe?g|gif|webp|ico|txt|webmanifest)$/i.test(p)) {
      out.set(`app/${p}`, content); // proyecto web sin carpeta app/: sus archivos sueltos son la pantalla
    } else if (!hasAppDir && /^(css|js|img|imagenes|assets|recursos|fonts|fuentes|estilos|scripts)\//i.test(p)) {
      out.set(`app/${p}`, content);
    }
  }

  if (out.has("app/index.html")) {
    origen = "app/index.html";
  } else if (byPath.has("vista-previa.html")) {
    out.set("app/index.html", byPath.get("vista-previa.html")!);
    origen = "vista-previa.html";
    avisos.push("No hay app/index.html: se empaqueta la vista previa autocontenida (vista-previa.html) como pantalla del programa.");
  } else {
    errores.push("Falta la pantalla principal: app/index.html (o, al menos, la vista previa autocontenida vista-previa.html).");
  }

  const pj = parseProgramJson(byPath.get("programa.json"));
  const nombre = String(pj["nombre"] ?? "").trim() || meta.name.trim() || "Programa";
  const versionRaw = String(pj["version"] ?? "1.0.0").trim();
  const version = /^\d+\.\d+\.\d+$/.test(versionRaw) ? versionRaw : "1.0.0";
  if (versionRaw !== version) avisos.push(`La versión «${versionRaw}» de programa.json no es del tipo 1.0.0: se usa 1.0.0.`);
  const ventanaRaw = pj["ventana"] && typeof pj["ventana"] === "object" ? (pj["ventana"] as Record<string, unknown>) : null;
  const ancho = Number(ventanaRaw?.["ancho"]);
  const alto = Number(ventanaRaw?.["alto"]);
  const programa: ProgramInfo = {
    id: programId(nombre),
    nombre: windowsName(nombre),
    version,
    descripcion: String(pj["descripcion"] ?? meta.description ?? "").trim().slice(0, 300),
    entrada: "app/index.html",
    ventana: Number.isInteger(ancho) && Number.isInteger(alto) && ancho >= 320 && alto >= 240 && ancho <= 4000 && alto <= 3000 ? { ancho, alto } : null,
  };

  let total = 0;
  for (const [p, content] of out) {
    const bytes = new TextEncoder().encode(content).length;
    total += bytes;
    if (bytes > FORMAT_LIMITS.fileBytes) errores.push(`«${p}» es demasiado grande (${Math.round(bytes / 1024 / 1024)} MB; máximo 5 MB por archivo).`);
    if (/\.(m?js)$/i.test(p) && (p.startsWith("servidor/") || p.startsWith("pruebas/"))) {
      for (const spec of importedModules(content)) {
        if (!isAllowedImport(spec)) errores.push(`«${p}» usa «${spec}», que no viene con el programa: usa solo módulos de Node (node:…) y archivos propios.`);
      }
    }
    if (/\.(m?js)$/i.test(p) && p.startsWith("app/")) {
      for (const spec of importedModules(content)) {
        if (!isAllowedBrowserImport(spec)) errores.push(`«${p}» importa «${spec}», que no está dentro del programa: en la pantalla solo valen archivos propios de app/ (./archivo.js).`);
      }
    }
    if (/\.html?$/i.test(p)) {
      const externos = [...content.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["'](https?:)?\/\/([^/"']+)/gi)].map((m) => m[2]);
      if (externos.length) avisos.push(`«${p}» carga recursos de internet (${[...new Set(externos)].slice(0, 3).join(", ")}): sin conexión no funcionará igual. Mejor incluirlos en app/.`);
    }
  }
  if (out.size > FORMAT_LIMITS.files) errores.push(`Demasiados archivos (${out.size}; máximo ${FORMAT_LIMITS.files}).`);
  if (total > FORMAT_LIMITS.totalBytes) errores.push(`El programa ocupa demasiado (${Math.round(total / 1024 / 1024)} MB; máximo 50 MB sin contar el motor).`);
  const tieneLogica = out.has("servidor/api.mjs");
  if (!tieneLogica && [...out.keys()].some((p) => p.startsWith("servidor/"))) avisos.push("Hay archivos en servidor/ pero no servidor/api.mjs: el programa no tendrá lógica en el servidor.");
  const pruebas = [...out.keys()].filter((p) => /^pruebas\/.+\.test\.mjs$/i.test(p)).sort();
  if (!pruebas.length) avisos.push("No hay pruebas de aceptación (pruebas/*.test.mjs): la comprobación de funcionalidad quedará pendiente.");
  if (!out.has("LEEME.md")) avisos.push("No hay README.md: el instalador no llevará instrucciones para el usuario.");
  if (origen === "vista-previa.html" && tieneLogica) avisos.push("La pantalla es la vista previa: comprueba que llama a la lógica (/api/…) como el programa real.");

  const archivos = [...out].map(([path, content]) => ({ path, content })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ok: errores.length === 0, errores, avisos, programa, archivos, pruebas, tieneLogica };
}

/** Texto canónico del paquete: su huella (SHA-256) identifica qué código se probó. */
export function packageFingerprintText(plan: Pick<PackagePlan, "programa" | "archivos">): string {
  return JSON.stringify({ programa: plan.programa, archivos: plan.archivos.map((f) => [f.path, f.content]) });
}

// ------------------------------------------------------------------------------------------------ informe de la fábrica

export type FactoryCheckId = "formato" | "paquete" | "instalador" | "instalacion-limpia" | "primer-arranque" | "funcionalidad" | "desinstalacion";
export type FactoryCheckStatus = "superada" | "fallida" | "pendiente" | "no-aplica";
export type FactoryCheck = { id: FactoryCheckId; estado: FactoryCheckStatus; detalle: string };

export const FACTORY_CHECK_LABELS: Record<FactoryCheckId, string> = {
  formato: "Formato del programa",
  paquete: "Montaje y compilación",
  instalador: "Instalador",
  "instalacion-limpia": "Instalación limpia",
  "primer-arranque": "Primer arranque",
  funcionalidad: "Pruebas de aceptación",
  desinstalacion: "Desinstalación",
};

export type FactoryReport = {
  version: 1;
  projectId: string;
  programa: ProgramInfo;
  /** SHA-256 de packageFingerprintText(): si el código cambia, el informe deja de valer. */
  huella: string;
  creado: string;
  duracionMs: number;
  plataforma: string;
  nsis: string;
  instalador: { archivo: string; bytes: number; sha256: string } | null;
  comprobaciones: FactoryCheck[];
  avisos: string[];
  registro: string[];
};

export const FACTORY_STEPS = [
  "Comprobar el formato", "Montar el programa", "Compilar el lanzador", "Compilar el instalador", "Instalar en una carpeta vacía",
  "Primer arranque", "Pruebas de aceptación", "Desinstalar", "Informe",
] as const;
export type FactoryStep = (typeof FACTORY_STEPS)[number];

/** Una prueba de la fábrica solo cuenta si todas sus comprobaciones aplicables están superadas. */
export function factoryPassed(report: Pick<FactoryReport, "comprobaciones">): boolean {
  return report.comprobaciones.length > 0 && report.comprobaciones.every((c) => c.estado === "superada" || c.estado === "no-aplica");
}

// ------------------------------------------------------------------------------------------------ instrucciones del formato

/** Lo que se le dice a la IA que construye un programa para Windows (va en el mensaje de arranque de la réplica). */
export const DESKTOP_FORMAT_PROMPT = [
  "FORMATO DE PROGRAMA DE WINDOWS (la fábrica de instaladores de WILLY lo monta, lo instala y lo prueba DE VERDAD; no uses otro formato):",
  "- app/index.html es la pantalla principal; el resto de pantallas, estilos, scripts e imágenes van dentro de app/. Se permiten módulos ES (<script type=\"module\">). Nada de internet: ni CDN ni fuentes externas, todo dentro de app/.",
  "- servidor/api.mjs (si el programa necesita lógica, archivos o datos): export default { \"GET /api/salud\": async () => ({ ok: true }), \"POST /api/notas\": async ({ cuerpo, datos }) => { … } }. Cada ruta recibe { metodo, ruta, params, consulta, cuerpo, datos, carpetaDatos, registro } y devuelve un objeto (se envía como JSON) o { estado, json }. Para un error claro: throw Object.assign(new Error(\"mensaje\"), { estado: 400 }). Datos del usuario: await datos.guardar(\"nombre\", valor) y await datos.leer(\"nombre\", porDefecto). Solo módulos de Node (node:fs, node:path, node:crypto…): nada de npm.",
  "- La pantalla usa su lógica con fetch(\"/api/…\"). Incluye la ruta GET /api/salud.",
  "- pruebas/*.test.mjs: pruebas de aceptación con node:test (al menos una por función de la matriz). Pueden importar app/*.js y arrancar el programa: import { iniciar } from \"../runtime/servidor.mjs\"; const app = await iniciar({ puerto: 0, datos: process.env.APP_DATOS }); … fetch(new URL(\"/api/…\", app.url)) … await app.cerrar(). Solo pueden escribir en process.env.APP_DATOS.",
  "- programa.json: { \"nombre\": \"<nombre propio>\", \"version\": \"1.0.0\", \"descripcion\": \"…\", \"ventana\": { \"ancho\": 1100, \"alto\": 760 } }. README.md para el cliente: qué es, cómo instalarlo, cómo usarlo y cómo desinstalarlo.",
  "- runtime/ y motor/ las pone la fábrica: no las crees. Si el programa necesita un servicio del sistema o un controlador (VPN, antivirus, cortafuegos…), esa parte NO la empaqueta la fábrica: márcala como PENDIENTE en el informe con lo que haría falta.",
  "Cuando esté listo, el dueño pulsa «Crear instalador y probarlo» en la pestaña Replicación: WILLY compila el instalador, lo instala en una carpeta vacía, arranca el programa, ejecuta tus pruebas aisladas y lo desinstala. Corrige lo que diga su informe.",
].join("\n");

/** docs/formato-escritorio.md: la referencia completa del formato, guardada en el proyecto. */
export function desktopFormatDoc(name: string): string {
  return [
    `# Formato de programa de Windows — ${name}`,
    "> Lo que necesita la fábrica de instaladores de WILLY para montar este programa, instalarlo y probarlo de verdad. Sin compilar nada y sin herramientas de terceros.",
    "## Estructura",
    [
      "```",
      "programa.json            nombre, versión (1.0.0), descripción y tamaño de ventana",
      "README.md                para el cliente: qué es, instalar, usar y desinstalar",
      "app/index.html           pantalla principal (+ más pantallas, CSS, JS e imágenes en app/)",
      "servidor/api.mjs         (opcional) lógica en Node: rutas \"MÉTODO /api/…\"",
      "pruebas/*.test.mjs       pruebas de aceptación con node:test",
      "```",
    ].join("\n"),
    "## Lógica (servidor/api.mjs)",
    [
      "```js",
      "export default {",
      "  \"GET /api/salud\": async () => ({ ok: true }),",
      "  \"GET /api/notas\": async ({ datos }) => datos.leer(\"notas\", []),",
      "  \"POST /api/notas\": async ({ cuerpo, datos }) => {",
      "    if (!cuerpo?.texto) throw Object.assign(new Error(\"La nota está vacía.\"), { estado: 400 });",
      "    const notas = await datos.leer(\"notas\", []);",
      "    const nota = { id: crypto.randomUUID(), texto: cuerpo.texto };",
      "    await datos.guardar(\"notas\", [...notas, nota]);",
      "    return { estado: 201, json: nota };",
      "  },",
      "  \"DELETE /api/notas/:id\": async ({ params, datos }) => { … },",
      "};",
      "```",
      "Cada ruta recibe `{ metodo, ruta, params, consulta, cuerpo, datos, carpetaDatos, registro }`. Los datos del usuario se guardan en su carpeta de datos (nunca junto al programa) y sobreviven a las actualizaciones. Solo módulos de Node (`node:…`).",
    ].join("\n"),
    "## Pruebas de aceptación (pruebas/*.test.mjs)",
    [
      "```js",
      "import { test } from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "import { iniciar } from \"../runtime/servidor.mjs\";",
      "",
      "test(\"guardar y listar notas\", async () => {",
      "  const app = await iniciar({ puerto: 0, datos: process.env.APP_DATOS });",
      "  try {",
      "    const r = await fetch(new URL(\"/api/notas\", app.url), { method: \"POST\", headers: { \"Content-Type\": \"application/json\" }, body: JSON.stringify({ texto: \"Hola\" }) });",
      "    assert.equal(r.status, 201);",
      "  } finally {",
      "    await app.cerrar();",
      "  }",
      "});",
      "```",
      "WILLY las ejecuta en el programa YA INSTALADO y aisladas: solo pueden leer el programa y escribir en `process.env.APP_DATOS`.",
    ].join("\n"),
    "## Qué comprueba la fábrica",
    "Formato → montaje (con su propio motor y su icono) → lanzador e instalador (NSIS, por usuario, sin permisos de administrador) → instalación en silencio en una carpeta vacía (archivos idénticos, accesos directos, «Aplicaciones instaladas») → primer arranque (pantalla y recursos cargan, scripts correctos, /api/salud responde) → pruebas de aceptación aisladas → desinstalación (no queda nada). El informe queda en la pestaña Replicación; si el código cambia, hay que volver a probar.",
    "## Límites honestos",
    "- Sin firma digital: al descargarlo de internet, Windows (SmartScreen) avisará hasta firmarlo con un certificado de firma de código.",
    "- Servicios del sistema, controladores o piezas de núcleo (VPN, antivirus, cortafuegos) no se empaquetan con este formato: se marcan como PENDIENTE.",
  ].join("\n\n") + "\n";
}
