// «Design Intelligence»: antes de dibujar la primera pantalla que se le ocurra, WILLY propone varias DIRECCIONES VISUALES, las
// critica, espera a que el dueño elija (o mezcle: «mezcla la 1 y la 4») y solo entonces fija el sistema de diseño del proyecto y
// construye combinando PATRONES (no una plantilla entera repetida).

import type { ProjectBrief } from "@/lib/project-brief";

/** El recorrido completo, en orden. */
export const DESIGN_FLOW = [
  "Idea del proyecto", "Tipo de producto", "Usuario objetivo", "Sector", "Referencias y tendencias", "3-5 direcciones visuales",
  "Crítica de cada una", "Selección (del dueño)", "Sistema de diseño", "Wireframe", "Frontend", "Captura de pantalla",
  "Crítica visual", "Mejora", "Responsive", "Validación",
] as const;

/** Apartados del sistema de diseño de cada proyecto (docs/design-system.md). */
export const DESIGN_SYSTEM_SECTIONS = [
  "Tipografía", "Colores", "Espaciado", "Radios", "Sombras", "Botones", "Campos de formulario", "Tarjetas", "Navegación", "Ventanas (modales)",
  "Tablas", "Estados vacíos", "Estados de carga", "Errores", "Notificaciones", "Reglas responsive",
] as const;

export type Pattern = { id: string; label: string; covers: string };

/** Biblioteca de PATRONES (piezas que se combinan según el proyecto), no de plantillas enteras. */
export const PATTERN_LIBRARY: Pattern[] = [
  { id: "navigation", label: "Navegación", covers: "menú principal, cabecera, migas de pan, pie" },
  { id: "onboarding", label: "Bienvenida", covers: "primeros pasos, recorrido guiado, estados iniciales" },
  { id: "authentication", label: "Acceso", covers: "registro, inicio de sesión, recuperar contraseña" },
  { id: "dashboards", label: "Paneles", covers: "indicadores, resúmenes, actividad reciente" },
  { id: "marketplaces", label: "Catálogos / marketplace", covers: "fichas, filtros, comparar, destacar" },
  { id: "checkout", label: "Compra", covers: "carrito, pago, confirmación, factura" },
  { id: "search", label: "Búsqueda", covers: "buscador, filtros, resultados, sin resultados" },
  { id: "profiles", label: "Perfiles", covers: "ficha de usuario o profesional, reseñas, contacto" },
  { id: "settings", label: "Ajustes", covers: "preferencias, cuenta, privacidad" },
  { id: "data-visualization", label: "Gráficos y datos", covers: "gráficas, tablas, exportar" },
  { id: "mobile-navigation", label: "Navegación en móvil", covers: "barra inferior, menú lateral, gestos" },
  { id: "landing-pages", label: "Páginas de presentación", covers: "portada, propuesta de valor, testimonios, llamada a la acción" },
  { id: "forms", label: "Formularios", covers: "validación, pasos, confirmación, errores" },
  { id: "empty-states", label: "Estados vacíos", covers: "cuando todavía no hay datos: qué hacer ahora" },
];

const PATTERN_RULES: Array<[RegExp, string[]]> = [
  [/\b(tienda|comprar|venta|pedido|carrito|ecommerce|e-commerce)\b/i, ["marketplaces", "search", "checkout"]],
  [/\b(inmobiliari\w*|pisos?|viviendas?|alquiler(es)?|propiedad(es)?|hotel(es)?|reservas?|citas?|cl[ií]nicas?|restaurantes?)\b/i, ["search", "marketplaces", "profiles", "forms"]],
  [/\b(panel|gesti[oó]n|gestionar|administraci[oó]n|control|crm|erp|inventario|estad[ií]sticas|informes?)\b/i, ["dashboards", "data-visualization", "settings"]],
  [/\b(usuarios?|cuentas?|registro|login|acceso|clientes?|socios?)\b/i, ["authentication", "profiles"]],
  [/\b(red social|comunidad|perfil(es)?|seguidores)\b/i, ["profiles", "onboarding"]],
  [/\b(buscar|buscador|filtr)/i, ["search"]],
];

/** Patrones que tienen sentido para este proyecto (siempre se incluyen formularios, estados vacíos y navegación en móvil). */
export function choosePatterns(brief: Pick<ProjectBrief, "inferredType" | "userInput">): string[] {
  const picked = new Set<string>(["navigation"]);
  if (brief.inferredType === "web" || brief.inferredType === "replicar") picked.add("landing-pages");
  if (brief.inferredType === "app" || brief.inferredType === "herramienta") { picked.add("dashboards"); picked.add("settings"); }
  for (const [re, ids] of PATTERN_RULES) if (re.test(brief.userInput)) ids.forEach((id) => picked.add(id));
  ["forms", "empty-states", "mobile-navigation"].forEach((id) => picked.add(id));
  return PATTERN_LIBRARY.map((p) => p.id).filter((id) => picked.has(id));
}

/** ¿Tiene sentido proponer direcciones visuales? (Reparar o mejorar conserva el diseño; una API o una automatización no tienen pantallas.) */
export function needsVisualDirections(inferredType: string): boolean {
  return !["api", "automatizacion", "reparar", "mejorar", "importar"].includes(inferredType);
}

/** Instrucciones de diseño para el primer mensaje del proyecto. */
export function designPromptBlock(brief: Pick<ProjectBrief, "inferredType" | "userInput">): string {
  if (!needsVisualDirections(brief.inferredType)) {
    return "DISEÑO: conserva el diseño que ya tenga el proyecto salvo que el dueño pida cambiarlo.";
  }
  const patterns = choosePatterns(brief).map((id) => PATTERN_LIBRARY.find((p) => p.id === id)!).map((p) => `${p.id}/ (${p.covers})`).join(" · ");
  return [
    "DISEÑO, ANTES DE PROGRAMAR — PRIMER PASO OBLIGATORIO:",
    "1. Piensa en el tipo de producto, el usuario objetivo, el sector y referencias o tendencias actuales del sector.",
    "2. Propón entre 3 y 5 DIRECCIONES VISUALES realmente distintas, numeradas (01, 02…), cada una con un nombre y 3 rasgos concretos (fotografía, tipografía, colores, navegación, sensación). Ejemplo de formato: «01 — Editorial Premium: fotografías grandes · tipografía elegante · navegación mínima».",
    "3. Critica brevemente cada una (para quién funciona mejor y su punto débil).",
    "4. PARA Y ESPERA a que el dueño elija una o pida mezclar (por ejemplo «mezcla la 1 y la 4»). No construyas nada hasta entonces.",
    `5. Con la elegida, escribe el SISTEMA DE DISEÑO del proyecto en docs/design-system.md: ${DESIGN_SYSTEM_SECTIONS.join(", ")}.`,
    `6. Construye combinando PATRONES de la biblioteca (no una plantilla entera): ${patterns}.`,
    "7. Después: captura de la pantalla, crítica visual, mejora, comprobación responsive (móvil, tableta, escritorio) y validación.",
  ].join("\n");
}

/** Primer docs/design-system.md: los apartados, pendientes hasta que el dueño elija la dirección visual. */
export function designSystemSkeleton(brief: Pick<ProjectBrief, "name" | "inferredType" | "userInput">): string {
  const patterns = choosePatterns(brief);
  return [
    `# Sistema de diseño — ${brief.name}`,
    "> Se completa cuando elijas una de las direcciones visuales que te propone WILLY (o una mezcla).",
    "## Dirección visual elegida", "_Pendiente de tu elección._",
    ...DESIGN_SYSTEM_SECTIONS.flatMap((s) => [`## ${s}`, "_Pendiente._"]),
    "## Patrones que se combinan", patterns.map((id) => `- ${id}/ — ${PATTERN_LIBRARY.find((p) => p.id === id)!.covers}`).join("\n"),
  ].join("\n\n") + "\n";
}
