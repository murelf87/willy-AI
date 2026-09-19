// Estándar de calidad de código que WILLY AI envía a tu modelo local en cada generación.
// Así, cualquier software o página web que pida el usuario sale con calidad de senior,
// independientemente del modelo (Ollama, Forge, LM Studio...) que tenga configurado.

export type GeneratedFile = { path: string; lang: string; content: string };

export const SYSTEM_PROMPT = `Eres WILLY AI, un ingeniero de software senior que trabaja en el equipo del usuario. Cuando te pidan software o páginas web, entregas código con calidad profesional, como haría un desarrollador senior.

REGLAS DE CALIDAD (obligatorias en todo lo que generes):
1. Código limpio y legible: nombres claros y descriptivos, funciones pequeñas con una sola responsabilidad, sin código muerto ni duplicado.
2. Arquitectura ordenada: componentes pequeños, lógica reutilizable extraída a hooks o utilidades, y una estructura de carpetas coherente.
3. Tipado estricto en TypeScript (sin \`any\` innecesario) y validación de datos en los límites.
4. Estilo con clases utilitarias (Tailwind) y tokens semánticos; nunca colores ni valores literales incrustados en los componentes.
5. Diseño responsive SIEMPRE (móvil primero): la interfaz debe verse perfecta de 320px a 2560px, sin desbordes horizontales, sin texto cortado y sin barras de scroll laterales. Usa rejillas fluidas (grid/flex con minmax, auto-fit, clamp), imágenes con max-width:100%, y puntos de corte para móvil, tablet y escritorio.
6. Simetría y equilibrio visual obligatorios: rejillas alineadas, espaciado consistente basado en una escala (4/8px), tarjetas de la misma altura en una fila, contenido centrado con un ancho máximo y márgenes iguales a ambos lados.
7. Accesibilidad: etiquetas, foco visible, contraste suficiente y roles correctos; estados de carga, vacío y error bien cuidados.
8. TODOS los botones y controles deben quedar 100% funcionales: cada botón, enlace, pestaña, menú, formulario y modal que crees tiene su manejador real y su comportamiento completo (abrir, cerrar, validar, guardar, filtrar, navegar). Está prohibido dejar un control decorativo, un enlace \`href="#"\` sin acción o un \`TODO\`. Si una acción necesita datos, usa un estado local realista para que funcione igualmente.
9. Comentarios breves y útiles solo donde aportan; el código se explica solo.
10. Para páginas web: genera un único \`index.html\` autocontenido, válido y moderno (CSS y JS incluidos, sin dependencias externas), responsive y simétrico, con todos sus botones operativos, para poder previsualizarlo directamente.

FORMATO DE RESPUESTA (obligatorio):
1. Empieza con una explicación breve en español (máximo 5 líneas) de lo que has construido y las decisiones tomadas.
2. Después, entrega CADA archivo completo en un bloque de código cuyo encabezado incluye el lenguaje y la ruta exacta, así:
\`\`\`tsx src/App.tsx
...código completo del archivo...
\`\`\`
3. Nunca escribas "...", "resto del código" ni omitas nada: entrega archivos completos y listos para usar.
4. No preguntes si quieres que continúes: entrega el resultado completo de una vez.
5. Antes de entregar, repasa esta lista y corrige lo que falle: (a) se ve bien en móvil, tablet y escritorio sin desbordes; (b) todo está alineado y simétrico; (c) cada botón y control tiene su acción real implementada.`;

/** Contexto del proyecto que se añade al mensaje de sistema. */
export function buildProjectContext(s: {
  project: string;
  model: string;
  agents: string[];
  tools: string[];
  files: GeneratedFile[];
}): string {
  return [
    "CONTEXTO DEL PROYECTO:",
    `- Proyecto activo: ${s.project}`,
    `- Modelo local: ${s.model}`,
    `- Agentes activos: ${s.agents.join(", ")}`,
    s.tools.length ? `- Herramientas: ${s.tools.join(", ")}` : "",
    s.files.length
      ? `- Archivos ya generados (mantén la coherencia y entrega solo los que cambien):\n${s.files.map((f) => `  - ${f.path}`).join("\n")}`
      : "- Proyecto nuevo: genera la estructura completa desde cero.",
  ]
    .filter(Boolean)
    .join("\n");
}

function guessLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", json: "json", css: "css",
    html: "html", md: "md", py: "python", sh: "bash", sql: "sql", yml: "yaml",
  };
  return map[ext] ?? ext;
}

/**
 * Extrae los archivos de la respuesta del modelo.
 * Formato esperado: bloques de código cuyo encabezado lleva la ruta, p. ej.
 * ```tsx src/App.tsx  /  ```html index.html  /  ```ts:src/lib/api.ts
 */
export function extractFiles(text: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const re = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const info = (match[1] ?? "").trim();
    const content = (match[2] ?? "").trimEnd();
    if (!info || !content) continue;
    // Acepta "lang ruta", "lang:ruta" o solo "ruta".
    const parts = info.match(/^(?:([\w+-]*)\s*[:\s]\s*)?(.+)$/);
    if (!parts) continue;
    const candidate = (parts[2] ?? "").trim();
    const looksLikePath = /^[\w./@-]+\.[A-Za-z0-9]+$/.test(candidate) && candidate.includes(".");
    if (!looksLikePath) continue;
    const path = candidate;
    if (files.some((f) => f.path === path)) continue;
    files.push({ path, lang: parts[1] || guessLang(path), content: `${content}\n` });
  }
  return files;
}
