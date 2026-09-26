// SÚPER IA COMO PROYECTO DEL SISTEMA (rediseño, fase 8; puntos 41-43). SUPER WILLY también es un proyecto: aparece en Proyectos,
// fijado arriba en «Sistema WILLY», con su progreso, sus hitos, sus tareas, su fase, sus versiones (revisiones), sus pruebas y
// lo que falta. Su plan NO es un porcentaje puesto a mano: es la lista de lo que hace falta para que SUPER WILLY sea la mesa de
// operaciones del rediseño, con lo que ya está HECHO en esta versión de WILLY (y en qué revisión llegó) y lo que falta. El
// porcentaje sale de ahí con el mismo motor que el de cualquier proyecto. No se puede borrar ni renombrar.
// 25/09/2026: hito «Diseño del dueño» con lo que piden sus maquetas (24/09): lo que ya llegó (con su fecha, porque llegó como
// mejora de la Autoconstrucción encima de la revisión 28) y lo que falta de verdad (agentes, mascota, IA Influencer y Vídeo IA).

import type { PlanMilestone, PlanTask, ProjectPlan } from "@/lib/project-progress";
import { TEMPLATES } from "@/lib/project-progress";

export const SYSTEM_PROJECT_ID = "sistema-super-willy";
export const SYSTEM_PROJECT_NAME = "SÚPER IA";
export const SYSTEM_PROJECT_DESC = "Mesa principal de operaciones de WILLY: tus proyectos, su vista previa, su progreso y su reparación.";
/** Revisión de WILLY que trae este plan (la misma que `APP_REVISION`) y cuándo se preparó. */
export const SYSTEM_REVISION = 28;
export const SYSTEM_REVISION_DATE = "2026-09-24T18:00:00.000Z";

type Item = [title: string, weight: number, rev: number | string | null];
/**
 * Lo que hace falta en cada hito; `rev` es la revisión del rediseño en la que llegó (19 en adelante), 0 si ya estaba antes del
 * rediseño, la fecha (AAAA-MM-DD) si llegó como mejora de la Autoconstrucción encima de una revisión, y null si todavía falta.
 */
const PLAN: Record<string, Item[]> = {
  arquitectura: [
    ["Proyectos guardados en tu equipo: una sola fuente de verdad", 3, 19],
    ["Menú nuevo: Centro de Inteligencia y Ajustes", 2, 20],
    ["Chat para conversar y SUPER WILLY para proyectos («Abrir en SUPER WILLY»)", 3, 21],
    ["SÚPER IA como proyecto del sistema, con progreso real", 2, 23],
  ],
  orquestador: [
    ["IA propia de SUPER WILLY, aparte de la del Chat", 2, 0],
    ["Externa primero (gratis) y tu equipo de respaldo; lo privado no sale", 3, 0],
    ["Relevos: si una IA falla, sigue otra", 2, 0],
    ["Papeles de los agentes al trabajar en un proyecto", 1, 21],
  ],
  discovery: [
    ["Entrevista por bloques con opciones y recomendación", 3, 0],
    ["Funciones que no se te habían ocurrido", 2, 0],
    ["Resumen «esto es lo que vamos a construir» antes de programar", 2, 0],
    ["Proyecto creado y guardado desde el primer momento", 2, 19],
    ["Plan con hitos y tareas a partir de la entrevista", 2, 23],
  ],
  vista: [
    ["Vista previa real e interactiva del proyecto", 3, 21],
    ["Ordenador, tableta y móvil de verdad (no un zoom)", 2, 21],
    ["Pantalla completa", 1, 21],
    ["Varias páginas del proyecto y ruta recordada", 2, 22],
    ["Comprobación antes de «Lista» y aviso con «Reparar»", 2, 22],
    ["Edición visual: tocar un elemento de la vista previa y cambiarlo", 3, 24],
    ["Revisión del diseño en ordenador, tableta y móvil, con capturas de verdad", 2, 24],
    ["Comparar ANTES y DESPUÉS de un cambio (o dos versiones)", 1, 24],
    ["Proyectos React/Vite: se compilan en tu equipo y se ven en la vista previa", 3, 25],
  ],
  workspace: [
    ["Taller por proyecto: Código, Archivos, Cambios y Versiones", 3, 21],
    ["Consola del proyecto (aparte de los registros de WILLY)", 2, 22],
    ["Selector de las páginas del proyecto", 1, 22],
    ["Mapa de pantallas de las aplicaciones de una sola página", 2, 26],
  ],
  herramientas: [
    ["Exportar en ZIP, publicar y compartir el proyecto", 2, 21],
    ["Revisar el código del proyecto", 1, 21],
    ["Subir el proyecto a GitHub", 1, 0],
  ],
  ejecucion: [
    ["Construir y cambiar proyectos con archivos completos comprobados", 3, 21],
    ["Deshacer: «vuelve a la versión anterior»", 1, 21],
    ["Seguir trabajando aunque cambies de pestaña", 1, 0],
    ["Compilar los proyectos en tu equipo (con las piezas de WILLY, sin npm)", 2, 25],
    ["Instalar librerías nuevas para los proyectos (en tu equipo no hay npm)", 2, 27],
  ],
  calidad: [
    ["Un archivo cortado nunca sustituye al bueno", 2, 21],
    ["Reparación automática si un cambio rompe la vista previa (2 intentos o bloqueo)", 3, 22],
    ["El 100 % solo con la «Definition of Done»", 2, 23],
    ["Pruebas automáticas de cada proyecto (tests)", 3, 28],
  ],
  memoria: [
    ["Conversación de cada proyecto recordada", 2, 0],
    ["Instrucciones permanentes del dueño (Constitución)", 2, 0],
    ["Lo que estás viendo va con cada petición (contexto visual)", 2, 21],
  ],
  "segundo-plano": [
    ["Aviso cuando termina si estás en otra pestaña", 2, 0],
    ["Proyectos dice qué está haciendo WILLY ahora", 1, 23],
  ],
  e2e: [
    ["Pruebas automáticas de interfaz de cada revisión antes de entregarla", 3, 0],
    ["Regresión completa de todo el rediseño (fase 12)", 3, 25],
  ],
  diseno: [
    ["Armazón nuevo, Inicio y Chats con el diseño de FRONT", 3, "2026-09-24"],
    ["Herramientas (centro de herramientas) y logotipo de la maqueta", 2, "2026-09-24"],
    ["Centro de Inteligencia con sus 6 pestañas, Routing incluido", 3, "2026-09-25"],
    ["Chats: favoritos y etiquetas guardados en cada conversación", 1, "2026-09-25"],
    ["Autoconstrucción: Visión, Roadmap, Módulos, Tareas, Cambios, Versión y Logs", 2, "2026-09-25"],
    ["Súper IA: selector de proyecto y estado del proyecto en la cabecera", 1, "2026-09-25"],
    ["Centro de Inteligencia → Resumen con datos reales (enrutado, salud, proveedores, modelos en uso)", 1, "2026-09-25"],
    ["Chats: ideas para empezar y «Copiar respuesta» en cada respuesta", 1, "2026-09-25"],
    ["Los 6 agentes de la maqueta: Arquitecto, Programador, Diseñador UI, Analista, Revisor y Orquestador", 2, null],
    ["La mascota de WILLY con el dibujo original de la maqueta", 1, null],
    ["IA Influencer y Vídeo IA funcionando desde Herramientas", 3, null],
  ],
};

/** El plan de SÚPER IA en esta versión de WILLY (su progreso sale de aquí, con el motor de siempre). */
export function systemPlan(): ProjectPlan {
  let n = 0;
  const milestones: PlanMilestone[] = TEMPLATES["sistema"]!.map((t) => ({
    id: t.id,
    name: t.name,
    weight: t.weight,
    tasks: (PLAN[t.id] ?? []).map(([title, weight, rev]): PlanTask => ({
      id: `s${++n}`,
      title: rev === null ? title : `${title} (${typeof rev === "string" ? `${rev.slice(8, 10)}/${rev.slice(5, 7)}` : rev ? `revisión ${rev}` : "antes del rediseño"})`,
      weight,
      status: rev === null ? "pendiente" : "hecha",
      by: "sistema",
      ...(rev === null ? {} : { at: typeof rev === "string" ? `${rev}T12:00:00.000Z` : SYSTEM_REVISION_DATE }),
    })),
  }));
  return {
    version: 1,
    kind: "sistema",
    source: "sistema",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: SYSTEM_REVISION_DATE,
    milestones,
    attention: null,
    // Es WILLY mismo: tiene sus archivos, su documentación y su vista previa (la propia pantalla) funcionando. Rev28: sus pruebas
    // automáticas son las de cada revisión (las comprobaciones de la última que las tiene contadas, todas sin fallos).
    evidence: {
      files: 1, readme: true, pages: 1, preview: "ok", errors: 0, discoveryDone: true, discoverySteps: [], at: SYSTEM_REVISION_DATE, filesKey: "sistema",
      tests: { total: lastChecks(), passed: lastChecks(), failed: 0, skipped: 0, key: "sistema", at: SYSTEM_REVISION_DATE },
    },
  };
}

/** Las comprobaciones automáticas de la última revisión que las tiene contadas. */
const lastChecks = (): number => SYSTEM_HISTORY.find((h) => h.checks)?.checks ?? 0;

/** Versiones de SÚPER IA: las revisiones del rediseño, con lo que trajo cada una y sus comprobaciones automáticas. */
export const SYSTEM_HISTORY: ReadonlyArray<{ rev: number; title: string; checks: number | null }> = [
  { rev: 28, title: "Pruebas automáticas de cada proyecto: WILLY las pasa solo (como una persona, en tu equipo) y repara lo que rompe un cambio", checks: 2488 },
  { rev: 27, title: "Librerías nuevas para los proyectos: WILLY las instala solo desde npm (sin npm), comprobando su huella", checks: 2306 },
  { rev: 26, title: "Mapa de pantallas: todas las pantallas del proyecto de un vistazo, con las que fallan, «Abrir» y «Reparar»", checks: 2117 },
  { rev: 25, title: "Regresión completa del rediseño; los proyectos React/Vite se compilan en tu equipo y se ven en la vista previa", checks: 2032 },
  { rev: 24, title: "Edición visual: tocar un elemento y cambiarlo, revisar el diseño (con capturas de verdad) y comparar antes/después", checks: 1826 },
  { rev: 23, title: "Proyectos nuevo: progreso real, fase, qué falta, filtros; SÚPER IA como proyecto del sistema", checks: 1671 },
  { rev: 22, title: "Vista previa completa: páginas, ruta recordada, consola, comprobación y reparación automática", checks: 1532 },
  { rev: 21, title: "SUPER WILLY como taller de tus proyectos; el Chat vuelve a ser para conversar", checks: 1365 },
  { rev: 20, title: "Menú nuevo: Centro de Inteligencia y Ajustes con botones que funcionan de verdad", checks: null },
  { rev: 19, title: "Proyectos guardados en tu equipo; fuera los datos inventados", checks: null },
];
