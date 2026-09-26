import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalModels } from "@/lib/use-local-models";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import type { GeneratedFile } from "@/lib/ai-standard";
import {
  Check, Clock, Database, Download, FolderKanban, Gauge, LayoutGrid, LogOut, Pencil, Plus, RotateCcw, Search, Server, Settings, Terminal, Wrench, X, Zap, ArrowRight, FlaskConical, Paperclip, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClarifyButton } from "@/components/clarify-button";
import { DataSourcesCard } from "@/components/data-sources-card";
import { usePersistentState } from "@/lib/persistent-state";
import { formatBytes, readFileAsDataUrl, useProfile } from "@/lib/profile";
import { downloadFile, useSettings } from "@/lib/workspace-store";
import { GitHubView } from "@/components/github-view";
import { LiveResources, LiveStatusCards, LiveTools } from "@/components/home-live";
import { InstallView } from "@/components/install-view";
import { DemoView } from "@/components/demo-view";
import { LicensesView } from "@/components/licenses-view";
import { ReaderView } from "@/components/reader-view";
import { OcrView } from "@/components/ocr-view";
import { TranscribeView } from "@/components/transcribe-view";
import { AvatarView } from "@/components/avatar-view";
import { AvatarCharacterView } from "@/components/avatar-character-view";
import { TranslateView } from "@/components/translate-view";
import { ExtrasView } from "@/components/extras-view";
import { BookView } from "@/components/book-view";
import { SuperIAView } from "@/components/superia-view";
import { ProjectsView } from "@/components/projects-view";
import { SelfBuildView } from "@/components/self-build-view";
import { SettingsView } from "@/components/settings-view";
import { IntelligenceCenter } from "@/components/intelligence-center";
import { SectionHead as Head } from "@/components/section-ui";
import { projectService, useProjects, useVersions } from "@/services/project-service";
import { isExampleProject, type Ping, type Project, type ProjectIcon, type ProjectMode } from "@/types/domain";
import { openView } from "@/lib/background-tasks";
import { QUICK_ACTIONS, briefToPrompt, buildBrief, suggestName, type Attachment, type ProjectBrief } from "@/lib/project-brief";
import { extractAnyText } from "@/lib/pdf-text";
import { DEFAULT_REQUEST, REBUILD_DELIVERABLES, REBUILD_TARGETS, rebuildPrompt, suggestRebuildName, targetFeasibility, type RebuildDeliverable, type RebuildLevel, type RebuildRequest, type RebuildTarget } from "@/lib/product-rebuild";
import { PanelCard as Card } from "@/components/panel-card";

// Desde la revisión 20 ya no existen «Workspace», «Agentes», «Modelos», «Configuración» ni «Estado del sistema» como
// pantallas: lo que tenían de verdad está en «Ajustes» y en el «Centro de Inteligencia» (ver MOVED_VIEWS en section-tabs).
export type View =
  | "chat" | "inicio" | "superia" | "inteligencia" | "autoconstruccion" | "proyectos" | "historial"
  | "herramientas" | "documentacion" | "ajustes" | "cuenta"
  | "github" | "instalacion" | "demo" | "licencias"
  | "lectura" | "ocr" | "avatar" | "personaje" | "traducir" | "extras" | "libros" | "transcribir";

export const VIEW_TITLES: Record<View, string> = {
  chat: "Chats",
  superia: "SUPER WILLY",
  autoconstruccion: "Autoconstrucción",
  inicio: "Inicio",
  proyectos: "Proyectos",
  historial: "Historial",
  inteligencia: "Centro de Inteligencia",
  herramientas: "Herramientas",
  licencias: "Licencias",
  lectura: "Lectura en voz alta",
  ocr: "OCR de documentos",
  transcribir: "Transcribir audio o vídeo",
  avatar: "Mi yo en IA",
  personaje: "Crea tu avatar IA",
  traducir: "Traducir enlace",
  extras: "Nuevas funciones",
  libros: "Libros",
  documentacion: "Documentación",
  ajustes: "Ajustes",
  cuenta: "Cuenta",
  github: "GitHub",
  instalacion: "Acceso directo",
  demo: "Demo para cliente",
};

/** Traduce la clave de icono de cada proyecto a su icono real. */
export const PROJECT_ICONS: Record<ProjectIcon, typeof FolderKanban> = {
  folder: FolderKanban, gauge: Gauge, grid: LayoutGrid, server: Server,
  database: Database, zap: Zap, store: Database, code: Terminal,
};


/** Historial de versiones del proyecto activo: cada generación queda guardada y se puede restaurar. */
function HistoryView({ ping }: { ping: Ping }) {
  const [settings] = useSettings();
  const { projects } = useProjects();
  const active = (settings.projectId ? projects.find((p) => p.id === settings.projectId) : undefined)
    ?? (settings.project ? projects.find((p) => p.name === settings.project) : undefined);
  const versions = useVersions(active?.id);

  return (
    <>
      <Head title="Historial de versiones" desc={active ? `Cada generación de «${active.name}» queda guardada aquí.` : "Crea o abre un proyecto para empezar."} />
      {!active && <p className="text-sm text-muted-foreground">No hay ningún proyecto activo todavía.</p>}
      {active && versions.length === 0 && (
        <p className="text-sm text-muted-foreground">Todavía no hay versiones guardadas. Cuando tu IA genere archivos, WILLY guardará una versión automáticamente.</p>
      )}
      <div className="space-y-2">
        {versions.map((v) => (
          <Card key={v.id} className="flex flex-wrap items-center gap-3">
            <Clock className="size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{v.label}</p>
              <p className="text-xs text-muted-foreground">{new Date(v.at).toLocaleString("es-ES")} · {v.fileCount ?? v.files.length} archivo(s)</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { if (window.confirm(`¿Restaurar «${v.label}»? Se sustituirán los archivos actuales del proyecto.`)) void projectService.restoreVersion(v.id).then((r) => ping(r.ok ? `Versión «${v.label}» restaurada en «${r.data.name}».` : `⚠️ ${r.error}`)); }}>
              <RotateCcw className="size-3.5" />Restaurar
            </Button>
          </Card>
        ))}
      </div>
    </>
  );
}


const DOCS: { t: string; d: string; body: string[] }[] = [
  {
    t: "Primeros pasos",
    d: "Qué se hace en cada sitio de WILLY AI.",
    body: [
      "1. Para construir algo (una web, una aplicación, un programa), ve a SUPER WILLY y cuéntale qué quieres: te hará unas preguntas y lo guardará como proyecto.",
      "2. Para preguntar, redactar, resumir o investigar (también dudas de programación), usa el Chat. Si en el Chat pides construir o cambiar un proyecto, te ofrece «Abrir en SUPER WILLY» y le pasa solo lo necesario.",
      "3. En el Centro de Inteligencia eliges con qué IA trabaja WILLY: la de tu equipo (Ollama, gratis y sin internet) o una IA externa gratuita con tu clave (más rápida).",
      "4. Todo lo que construyes aparece en Proyectos, con sus versiones. Al abrir un proyecto se abre en SUPER WILLY: a la izquierda su chat y a la derecha la vista previa, el código, los archivos, los cambios y las versiones.",
    ],
  },
  {
    t: "Chats",
    d: "Tus conversaciones: buscar, favoritas, etiquetas e ideas para empezar.",
    body: [
      "A la izquierda están tus conversaciones, con un buscador y los filtros Todos, Recientes (las que se han usado en las últimas 48 horas) y Favoritos; a la derecha, la conversación abierta.",
      "En el menú de cada conversación puedes marcarla como favorita, renombrarla, ponerle una etiqueta (Ideas, General o Trabajo) o borrarla. La estrella de arriba de la conversación también la marca como favorita.",
      "Con el cuadro de mensaje vacío aparecen ideas para empezar (organizar una idea, resumir un texto, explicar un error, escribir un correo profesional): escriben el principio de la petición y tú la terminas; no envían nada.",
      "Abrir una conversación no le cambia la fecha: solo sube en Recientes cuando escribes en ella.",
    ],
  },
  {
    t: "El progreso de tus proyectos",
    d: "De dónde sale el porcentaje y qué significa cada estado.",
    body: [
      "Cada proyecto tiene un PLAN: hitos (Discovery, Diseño, Frontend, Backend, Pruebas, Entrega… según sea una web, una API o una aplicación) y, dentro, tareas con su peso. El porcentaje es el trabajo hecho frente al planificado: nunca se inventa.",
      "El plan sale de la entrevista del proyecto (las funciones que eliges son sus tareas). WILLY dice qué tareas termina cada vez que entrega archivos (solo cuentan si se han guardado), y algunas se comprueban solas: la entrevista, que la vista previa se vea sin errores, el README y que haya archivos.",
      "El 100 % solo llega con todo hecho, la vista previa sin errores, la documentación y nada pendiente de ti. Si añades algo nuevo al proyecto, el porcentaje baja: es lo correcto.",
      "Los proyectos de antes salen como «Progreso no calculado»: pulsa «Analizar proyecto» y WILLY revisa sus archivos (sin cambiar nada) y hace su plan. Al pulsar la barra de progreso ves cada hito y «qué falta», y puedes marcar tareas o añadir las que falten.",
      "SÚPER IA aparece arriba como proyecto del sistema: su progreso es lo que ya está hecho en esta versión de WILLY frente a todo lo previsto, con sus versiones y sus pruebas.",
    ],
  },
  {
    t: "Cambiar algo tocándolo en la vista previa",
    d: "Seleccionar elemento, revisar el diseño y comparar antes y después.",
    body: [
      "En SUPER WILLY, con un proyecto abierto, pulsa «Seleccionar» en la barra de la vista previa y toca lo que quieras cambiar (un botón, una imagen, un texto, el menú, una tarjeta…). Mientras eliges, la página no reacciona a los clics. WILLY te pregunta «¿Qué quieres cambiar?»: escríbelo o pulsa un cambio rápido («Hazlo más pequeño», «Cambia el color», «Elimínalo»…).",
      "WILLY sabe exactamente qué has tocado (y en qué archivo y línea está), así que cambia solo eso. Si abres «Detalles técnicos (avanzado)» ves esos datos; si no, no hace falta. Tras el cambio, el elemento sigue elegido por si quieres retocarlo otra vez.",
      "«Revisar diseño» mira la pantalla que estás viendo en ordenador, tableta y móvil: lo que se sale de la pantalla, el texto que se corta, lo que se tapa, el poco contraste, la letra o los botones demasiado pequeños, las imágenes que no cargan o se deforman, el título principal y el espaciado. Si en tu equipo hay Edge o Chrome, hace además capturas de verdad; y si tienes una IA con visión, puede mirarlas y opinar.",
      "Tú eliges qué arreglar: WILLY lo arregla sin cambiar tu diseño. Si hiciera falta un cambio grande (otra distribución, otros colores de marca…), te lo explica y te pregunta antes. «Ver» te señala en la vista previa dónde está cada problema.",
      "«Comparar» enseña ANTES y DESPUÉS lado a lado (por defecto, cómo estaba antes del último cambio y cómo está ahora), al mismo tamaño y moviéndose a la vez. Puedes elegir dos versiones cualesquiera.",
      "«Pantallas» abre el MAPA DE PANTALLAS: todas las pantallas del proyecto de un vistazo (las rutas «#/…» de una aplicación de una sola página y sus páginas), cada una en pequeño y diciendo si se ve bien, se queda en blanco o da error. «Abrir» te lleva a esa pantalla en la vista previa y «Reparar» le pide a WILLY que arregle la que falla. Si el proyecto usa rutas sin «#», solo se ve la primera pantalla: el mapa te ofrece pasarlo a rutas con «#».",
    ],
  },
  {
    t: "La IA de tu equipo",
    d: "Ollama: arrancarla, ver si usa la tarjeta gráfica y descargar modelos.",
    body: [
      "WILLY usa Ollama, que se instala y se arranca solo con WILLY. Su estado está en Centro de Inteligencia → Tu equipo (Ollama).",
      "Allí ves si responde, su versión, cuántos modelos tiene y si calcula con la tarjeta gráfica o solo con el procesador (y por qué).",
      "Si no responde, pulsa «Arrancar la IA de mi equipo»; si va rara, «Reiniciar».",
      "Los modelos gratuitos se descargan en Centro de Inteligencia → Modelos, donde también ves la carpeta en la que se guardan.",
    ],
  },
  {
    t: "Centro de Inteligencia",
    d: "Con qué IA trabaja WILLY, cómo la elige y cuánto usa cada una.",
    body: [
      "Tiene 6 pestañas: Resumen, Modelos, Proveedores, Agentes, Routing y Uso y costes. Todo lo que enseña es real: tus modelos instalados, tus claves y lo que se ha usado de verdad.",
      "Resumen: de un vistazo, el modo de SUPER WILLY, los proveedores activos, los modelos de tu equipo, la salud (con «Ejecutar diagnóstico» y «Ver logs»), el enrutado, las preferencias globales, las capacidades por tarea, los agentes y los modelos que han respondido últimamente en el Chat y en SUPER WILLY.",
      "Modelos: la IA de tu equipo (Ollama) junto al catálogo de modelos gratuitos para descargar o quitar. Proveedores: las IA externas gratuitas con tu clave; «Probar» hace una petición real, que cuenta para el tope diario.",
      "Routing: qué IA contesta en el Chat, en el modo automático, en SUPER WILLY y en la Autoconstrucción, y una tabla por tipo de tarea con su relevo en tu equipo. Si una IA externa falla, entra la siguiente y, al final, la de tu equipo. En el automático, lo sensible (DNI, IBAN, claves…) y los adjuntos se quedan en tu equipo.",
      "Uso y costes: las peticiones de hoy de cada proveedor frente al tope diario de seguridad. El coste es siempre 0 €: WILLY solo usa niveles gratuitos y nunca gasta dinero por su cuenta.",
    ],
  },
  {
    t: "Agentes",
    d: "Qué son Analista, Programador, Revisor, Depurador y Diseñador UI.",
    body: [
      "Son papeles que SUPER WILLY tiene en cuenta cuando construye o cambia un proyecto: se le indican en cada petición del proyecto.",
      "No son programas aparte ni usan un modelo distinto: contesta la IA de SUPER WILLY.",
      "Puedes activar o desactivar cada uno en Centro de Inteligencia → Agentes.",
    ],
  },
  {
    t: "Vista previa en vivo",
    d: "Cómo se ve tu proyecto en SUPER WILLY mientras se construye.",
    body: [
      "Con un proyecto abierto en SUPER WILLY, la vista previa enseña el proyecto de verdad (sus archivos guardados) en un marco aislado; mientras WILLY escribe, se va actualizando con lo que lleva escrito.",
      "Los botones Ordenador, Tableta y Móvil cambian de verdad el ancho de la pantalla (390 px en el móvil); «Ampliar» la pone casi a pantalla completa y «Volver a SUPER WILLY» la cierra.",
      "Dice siempre su estado (cargando, lista, actualizando, error…). Si la página falla, lo dice con el error y un botón para que WILLY lo arregle.",
      "Los proyectos de React (Vite) se COMPILAN en tu equipo al guardarlos, con las piezas que ya trae WILLY (sin npm ni internet), y la vista previa enseña su código de verdad. Si además tienen «vista-previa.html», en el selector de páginas eliges ver una u otro («… compilado en tu equipo»). Si no compila, dice por qué (el archivo y la línea, o la librería que falta) con «Reparar». Si le falta una librería conocida que el proyecto pide en su package.json (framer-motion, react-router-dom, chart.js…), WILLY LA INSTALA SOLO desde npm —sin npm, comprobando su huella y sin ejecutar nada de ella— y vuelve a compilar; las demás, con el botón «Instalar». Las instaladas se ven (y se quitan) en «Librerías instaladas».",
      "Puedes arrastrar la separación entre el chat y la vista previa, o elegir «Foco en la vista previa», «Equilibrado» o «Foco en el chat»: se recuerda.",
    ],
  },
  {
    t: "Pruebas automáticas",
    d: "WILLY prueba tu aplicación él solo, como lo haría una persona.",
    body: [
      "Cada proyecto puede tener sus PRUEBAS AUTOMÁTICAS (en «pruebas/»): como un usuario de prueba, WILLY abre tu aplicación sin que la veas, escribe, pulsa, elige y comprueba que todo responde bien. Van con el formato de Playwright, el de los programadores: si algún día el proyecto va a uno, las entiende.",
      "El botón «Pruebas» del taller dice cómo van («5/5» en verde, «1 falla» en rojo). En su panel: cada prueba con lo que ha fallado explicado en palabras (y el detalle técnico), «Repetir», «Pasar las pruebas», «Arreglar lo que falla» y «Escribir las pruebas» (si el proyecto aún no tiene, WILLY las prepara).",
      "Después de cada cambio de WILLY se pasan solas (se puede apagar en el panel). Si un cambio rompe alguna que iba bien, WILLY lo arregla solo (como mucho 2 intentos; si no, te lo explica y puedes volver a la versión que funcionaba).",
      "Mientras se pasan puedes seguir usando WILLY y escribiendo: no se ven, no te quitan el teclado y no salen a internet. Y el 100 % de un proyecto exige que pasen todas.",
    ],
  },
  {
    t: "Transcribir audio o vídeo",
    d: "Texto y subtítulos de lo que se dice en un audio o un vídeo, en tu equipo.",
    body: [
      "En Más → Transcribir (o Herramientas → Transcribir audio o vídeo) eliges o sueltas un audio o un vídeo (MP3, WAV, M4A, OGG, MP4, MOV o WEBM, hasta 2 GB) y su idioma, y WILLY lo pasa a texto con Whisper, sin sacarlo de tu ordenador.",
      "La primera vez hay que pulsar «Preparar la transcripción»: se descarga el modelo una sola vez (1,6 GB). Usa el mismo motor de IA que la voz Chatterbox, así que antes tiene que estar instalada (Lectura → Voces más humanas).",
      "Con la tarjeta gráfica va rápido; si no cabe (por ejemplo, porque ComfyUI está haciendo un vídeo), lo hace con el procesador, más despacio.",
      "Al terminar puedes corregir el texto, copiarlo, descargarlo y bajar los subtítulos (.srt) para cualquier editor de vídeo.",
    ],
  },
  {
    t: "Exportar proyectos",
    d: "Descarga el código completo en un archivo comprimido.",
    body: [
      "En SUPER WILLY, con el proyecto abierto, «Exportar» (o «Publicar») descarga el proyecto en un ZIP.",
      "El ZIP lleva todos los archivos del proyecto y un README con la fecha.",
      "En Cuenta puedes descargar una copia de tu perfil y tus ajustes.",
    ],
  },
  {
    t: "Autoconstrucción",
    d: "Cómo WILLY se mejora a sí mismo sin romper lo que funciona.",
    body: [
      "Pestañas: Visión (dónde está WILLY, su progreso y su salud), Roadmap (qué llegó en cada revisión y qué viene), Módulos, Tareas, Cambios (qué hizo en cada mejora, paso a paso), Versión (versiones y volver atrás) y Logs. «Nueva mejora» es para escribir qué quieres cambiar.",
      "Cada mejora se prepara aparte, en una versión candidata: se compila, se comprueban los tipos (TypeScript) y el programa se arranca aparte. Solo si todo va bien se guarda una copia comprobada de lo que había, se instala y WILLY se reinicia.",
      "Si algo falla por el camino, no se toca nada. Y si después de reiniciar el programa nuevo no responde, WILLY vuelve solo a la versión anterior.",
      "En Versión puedes deshacer una mejora concreta: antes se guarda (y se comprueba) una copia de cómo está todo en ese momento.",
    ],
  },
  {
    t: "Ajustes y diagnóstico",
    d: "Reiniciar WILLY, vaciar la caché, ver el espacio y encontrar problemas.",
    body: [
      "Ajustes → Sistema: estado de WILLY, versión, reiniciar y detener (solo desde el ordenador), actualizaciones y vaciar la caché.",
      "Ajustes → Almacenamiento: dónde están tus datos, cuánto ocupa cada cosa y borrar copias antiguas sin riesgo.",
      "Ajustes → Diagnóstico: «Ejecutar diagnóstico» lo revisa todo y te dice qué hacer si algo falla. Los registros nunca enseñan claves.",
      "Si WILLY no llega ni a abrirse, usa «Recuperar WILLY AI» desde el menú Inicio de Windows.",
    ],
  },
  {
    t: "Tus datos y tu privacidad",
    d: "Qué se queda en tu equipo y qué sale.",
    body: [
      "Tus proyectos se guardan en tu equipo, en la carpeta de datos de WILLY (Ajustes → Almacenamiento te dice dónde y cuánto ocupan).",
      "Tu perfil, tus ajustes y las conversaciones del Chat se guardan en el navegador de este equipo.",
      "Con la IA de tu equipo (Ollama), lo que escribes no sale de tu ordenador. Si usas una IA externa, lo que le mandas va a ese servicio; puedes apagarlas en el Centro de Inteligencia.",
      "Las claves de las IA externas se guardan solo en tu equipo: nunca se enseñan enteras ni aparecen en los registros.",
    ],
  },
];


export function SectionView({ view, ping, onNewProject, onOpenProject, onLogout, files }: {
  view: View; ping: Ping; onNewProject: () => void; onOpenProject: (p: Project) => void; onLogout: () => void; files?: GeneratedFile[];
}) {
  const [settings] = useSettings();
  const { projects } = useProjects();
  const [query, setQuery] = useState("");
  const [doc, setDoc] = useState<(typeof DOCS)[number] | null>(null);

  // Los proyectos de ejemplo de antes no cuentan como tuyos (la pantalla Proyectos, rev23, está en projects-view.tsx).
  const mine = useMemo(() => projects.filter((p) => !isExampleProject(p)), [projects]);
  const docs = useMemo(
    () => DOCS.filter((d) => (d.t + d.d).toLowerCase().includes(query.trim().toLowerCase())),
    [query],
  );

  // SUPER WILLY ocupa toda la altura (rev21): con un proyecto abierto, su chat y su taller (vista previa grande) van lado a lado.
  if (view === "superia") {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-background" aria-label={VIEW_TITLES[view]}>
        <SuperIAView />
      </section>
    );
  }

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6" aria-label={VIEW_TITLES[view]}>
      <div className="mx-auto w-full max-w-5xl">
        {view === "inicio" && (
          <>
            <Head
              title="Hola, Antonio José"
              desc="Tu estudio de desarrollo con IA, en tu equipo."
              action={<Button className="gap-2" onClick={onNewProject}><Plus className="size-4" />Nuevo proyecto</Button>}
            />
            <LiveStatusCards model={settings.model} projects={mine.length} />
            <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
              <Card>
                <p className="mb-3 text-sm font-semibold">Continúa donde lo dejaste</p>
                <div className="space-y-2">
                  {mine.length === 0 && <p className="text-xs text-muted-foreground">Todavía no tienes proyectos: cuéntale a SUPER WILLY qué quieres crear.</p>}
                  {mine.slice(0, 3).map((p) => {
                    const Icon = PROJECT_ICONS[p.icon] ?? FolderKanban;
                    return (
                      <button key={p.id} onClick={() => onOpenProject(p)} className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-accent/60">
                        <Icon className="size-4 text-primary" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.desc}</span></span>
                        <span className="text-xs text-muted-foreground">{p.state}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
              <LiveResources />
            </div>
            <LiveTools ping={ping} />
          </>
        )}

        {/* Rev23: Proyectos como centro de control (progreso real, fase, qué falta, filtros, SÚPER IA como proyecto del sistema). */}
        {view === "proyectos" && <ProjectsView ping={ping} onNewProject={onNewProject} onOpenProject={onOpenProject} />}

        {view === "historial" && <HistoryView ping={ping} />}


        {view === "herramientas" && (
          <>
            <Head title="Herramientas" desc="Fuentes de datos que tu IA puede consultar cuando le preguntas en el Chat." />
            <DataSourcesCard ping={ping} />
          </>
        )}

        {view === "documentacion" && (
          <>
            <Head title="Documentación" desc="Guías para sacar partido a WILLY AI en local." />
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card px-3">
              <Search className="size-4 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en la documentación..." className="h-10 w-full bg-transparent text-sm outline-none" aria-label="Buscar en la documentación" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {docs.map((d) => (
                <button key={d.t} onClick={() => setDoc(d)} className="rounded-xl border border-border bg-card p-4 text-left hover:bg-accent/40">
                  <p className="text-sm font-semibold">{d.t}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{d.d}</p>
                </button>
              ))}
              {docs.length === 0 && <p className="text-sm text-muted-foreground">Sin resultados.</p>}
            </div>
            {doc && <DocModal doc={doc} onClose={() => setDoc(null)} />}
          </>
        )}


        {view === "github" && <GitHubView project={projects.find((p) => p.id === settings.projectId)?.name ?? (settings.project || "proyecto")} files={files ?? []} ping={ping} />}

        {view === "instalacion" && <InstallView endpoint={settings.endpoint} model={settings.model} ping={ping} />}

        {view === "ajustes" && <SettingsView ping={ping} />}
        {view === "inteligencia" && <IntelligenceCenter ping={ping} />}

        {view === "autoconstruccion" && <SelfBuildView ping={ping} />}
        {view === "licencias" && <LicensesView />}
        {view === "lectura" && <ReaderView />}
        {view === "ocr" && <OcrView />}
        {view === "transcribir" && <TranscribeView />}
        {view === "avatar" && <AvatarView />}
        {view === "personaje" && <AvatarCharacterView />}
        {view === "traducir" && <TranslateView />}
        {view === "extras" && <ExtrasView />}
        {view === "libros" && <BookView />}
        {view === "demo" && <DemoView ping={ping} />}

        {view === "cuenta" && <AccountView ping={ping} onLogout={onLogout} agentCount={settings.agents.length} />}

      </div>
    </section>
  );
}

function DocModal({ doc, onClose }: { doc: { t: string; d: string; body: string[] }; onClose: () => void }) {
  useEscapeToClose(onClose);

  return (
    <div className="safe-modal fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={doc.t} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold">{doc.t}</h2>
            <p className="text-sm text-muted-foreground">{doc.d}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar guía"><X className="size-5" /></Button>
        </div>
        <div className="space-y-2.5">
          {doc.body.map((p, i) => <p key={i} className="text-sm leading-6 text-muted-foreground">{p}</p>)}
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>Entendido</Button>
        </div>
      </div>
    </div>
  );
}

function AccountView({ ping, onLogout, agentCount }: { ping: Ping; onLogout: () => void; agentCount: number }) {
  const [profile, updateProfile] = useProfile();
  const [settings] = useSettings();
  const { models: localModels } = useLocalModels(settings.endpoint);
  const modelCount = localModels.length;
  const { projects } = useProjects();
  const projectCount = projects.filter((p) => !isExampleProject(p)).length;
  const [nameDraft, setNameDraft] = useState(profile.name);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setNameDraft(profile.name); }, [profile.name]);

  return (
    <>
      <Head title="Cuenta" desc="Tu perfil dentro de este equipo. Todo se guarda en tu dispositivo." />
      <Card className="flex flex-wrap items-center gap-4">
        <span className="relative">
          {profile.avatar
            ? <img src={profile.avatar} alt={profile.name} className="size-14 rounded-full object-cover" />
            : <span className="flex size-14 items-center justify-center rounded-full bg-primary text-lg font-bold">{(profile.name.trim()[0] ?? "A").toUpperCase()}</span>}
          <button
            onClick={() => photoRef.current?.click()}
            title="Cambiar foto de perfil"
            aria-label="Cambiar foto de perfil"
            className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md hover:border-primary/60 hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
        </span>
        <div className="min-w-0 flex-1">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => nameDraft.trim() && nameDraft !== profile.name && updateProfile({ name: nameDraft.trim() })}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            aria-label="Tu nombre"
            className="w-full max-w-56 rounded-md border border-transparent bg-transparent text-base font-semibold outline-none hover:border-border focus:border-primary"
          />
          <p className="text-xs text-muted-foreground">{profile.email} · Online</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try { updateProfile({ avatar: await readFileAsDataUrl(file) }); ping(`Foto actualizada (${formatBytes(file.size)}).`); }
              catch { ping("No se pudo cargar la imagen. Prueba con otra más pequeña."); }
            }}
            aria-hidden="true"
          />
          <Button variant="secondary" onClick={() => photoRef.current?.click()}>Cambiar foto</Button>
          {profile.avatar && <Button variant="outline" onClick={() => { updateProfile({ avatar: null }); ping("Foto de perfil eliminada."); }}>Quitar foto</Button>}
        </div>
      </Card>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[["Proyectos", String(projectCount)], ["Modelos en tu equipo", String(modelCount)], ["Agentes activos", String(agentCount)]].map(([t, v]) => (
          <Card key={t}><p className="text-xs text-muted-foreground">{t}</p><p className="mt-1 text-lg font-bold">{v}</p></Card>
        ))}
      </div>
      <p className="mt-3 px-1 text-xs text-muted-foreground">Tu foto y tu nombre se guardan solo en este navegador de este equipo.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => { updateProfile({ name: nameDraft.trim() || profile.name }); ping("Perfil actualizado."); }}>Guardar perfil</Button>
        <Button
          variant="secondary"
          className="gap-2"
          onClick={() => {
            downloadFile(
              "willy-ai-copia-de-seguridad.json",
              JSON.stringify({ perfil: profile, ajustes: JSON.parse(window.localStorage.getItem("willy-settings") ?? "{}"), fecha: new Date().toISOString() }, null, 2),
              "application/json",
            );
            ping("Copia de seguridad descargada en tu equipo.");
          }}
        >
          <Download className="size-4" />Copia de seguridad
        </Button>
        <Button variant="outline" className="gap-2" onClick={onLogout}><LogOut className="size-4" />Cerrar sesión</Button>
      </div>
    </>
  );
}

type NewProjectExtra = {
  mode: ProjectMode;
  brief: ProjectBrief;
  model?: string;
  /** true si el nombre lo puso WILLY (no el dueño). */
  autoName?: boolean;
  /** Replicar aplicación/programa: el encargo tal cual (referencia, objetivo, nivel, destinos y entregas). */
  rebuild?: RebuildRequest;
};

/** Programas y archivos comprimidos: se adjuntan solo por su nombre (WILLY no ejecuta ni descompila programas ajenos). */
const BINARY_FILE = /\.(zip|7z|rar|exe|msi|msix|dmg|pkg|apk|aab|ipa|appimage|deb|rpm|iso|dll|bin)$/i;

const PROJECT_MODE_TABS = [
  ["standard", "Crear desde cero", Plus],
  ["innovation", "Proyecto innovador · I+D", FlaskConical],
  ["rebuild", "Replicar aplicación/programa", Copy],
] as const;

/**
 * Nuevo proyecto: el dueño cuenta QUÉ quiere conseguir y WILLY decide cómo. Tres modos:
 *  - «Crear desde cero»: idea → plan → construcción → pruebas.
 *  - «Proyecto innovador · I+D»: problema → investigar qué existe → huecos → propuestas → abogado del diablo → prototipo.
 *  - «Replicar aplicación/programa» (Product Rebuild): referencia → auditoría → informe y matriz → construcción por
 *    módulos → comprobaciones de WILLY → entrega instalable solo cuando está FINAL_VERIFIED.
 * Ya no hay que elegir modelo (lo decide WILLY; se puede forzar en «Opciones avanzadas») ni tipo de proyecto (se deduce).
 */
export function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, prompt: string, extra?: NewProjectExtra) => void }) {
  const [mode, setMode] = usePersistentState<ProjectMode>("proyecto-nuevo:modo", "standard");
  const [name, setName] = usePersistentState("proyecto-nuevo:nombre", "");
  const [prompt, setPrompt] = usePersistentState("proyecto-nuevo:idea", "");
  const [quick, setQuick] = useState("");
  const [model, setModel] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { models: installedModels } = useLocalModels();
  const innovation = mode === "innovation";
  const rebuild = mode === "rebuild";
  // Replicar: referencia, nivel, destinos y entregas (lo que pidió el dueño en su maqueta).
  const [reference, setReference] = usePersistentState("proyecto-nuevo:referencia", "");
  const [level, setLevel] = useState<RebuildLevel>(DEFAULT_REQUEST.level);
  const [targets, setTargets] = useState<RebuildTarget[]>([...DEFAULT_REQUEST.targets]);
  const [deliverables, setDeliverables] = useState<RebuildDeliverable[]>([...DEFAULT_REQUEST.deliverables]);
  const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const suggested = rebuild
    ? (prompt.trim() || reference.trim() ? suggestRebuildName({ reference, goal: prompt }) : "")
    : prompt.trim() ? suggestName(prompt) : "";
  const canSubmit = rebuild
    ? Boolean((prompt.trim() || reference.trim() || attachments.length) && targets.length && deliverables.length)
    : Boolean(prompt.trim() || attachments.length);
  const quickHint = QUICK_ACTIONS.find((a) => a.id === quick)?.hint;

  useEscapeToClose(onClose);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    const added: Attachment[] = [];
    for (const file of Array.from(list).slice(0, 6)) {
      if (file.type.startsWith("image/")) { added.push({ name: file.name, kind: "imagen" }); continue; }
      if (BINARY_FILE.test(file.name)) { added.push({ name: file.name, kind: "otro" }); continue; }
      try {
        const text = (await extractAnyText(file)).replace(/--- Página \d+ ---/g, "").trim();
        added.push(text ? { name: file.name, kind: "documento", text: text.slice(0, 6000) } : { name: file.name, kind: "otro" });
      } catch {
        added.push({ name: file.name, kind: "otro" });
      }
    }
    setAttachments((current) => [...current, ...added].slice(0, 8));
    setReading(false);
  };

  const submit = () => {
    const text = prompt.trim();
    if (!canSubmit) return;
    if (rebuild) {
      const req: RebuildRequest = { reference: reference.trim(), goal: text, level, targets, deliverables, attachments };
      const projectName = name.trim() || suggestRebuildName(req);
      const summary = [
        text,
        reference.trim() ? `Referencia: ${reference.trim()}` : "",
        `Destinos: ${targets.map((t) => REBUILD_TARGETS.find((x) => x.id === t)!.label).join(", ")}`,
      ].filter(Boolean).join("\n");
      const brief = buildBrief({ text: summary, name: projectName, mode: "rebuild", attachments, ...(model ? { preferredModel: model } : {}) });
      onCreate(brief.name, rebuildPrompt(brief.name, req), { mode: "rebuild", brief, rebuild: req, autoName: !name.trim(), ...(model ? { model } : {}) });
      setPrompt("");
      setName("");
      setReference("");
      return;
    }
    const brief = buildBrief({ text, name, mode, ...(quick && !innovation ? { quickAction: quick } : {}), attachments, ...(model ? { preferredModel: model } : {}) });
    onCreate(brief.name, briefToPrompt(brief), { mode, brief, autoName: !name.trim(), ...(model ? { model } : {}) });
    setPrompt("");
    setName("");
  };

  return (
    <div className="safe-modal fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-bold">Nuevo proyecto</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-4" /></button>
        </div>

        <div role="tablist" aria-label="Tipo de proyecto" className="mb-5 grid grid-cols-1 gap-1 rounded-xl border border-border bg-background p-1 sm:grid-cols-3">
          {PROJECT_MODE_TABS.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => setMode(id)}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${mode === id ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
            >
              <Icon className="size-4" />{label}
            </button>
          ))}
        </div>

        <div className="mb-3 text-center">
          <p className="font-display text-xl font-bold">{innovation ? "¿Qué problema quieres resolver?" : rebuild ? "¿Qué aplicación o programa quieres replicar?" : "¿Qué quieres crear?"}</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
            {innovation
              ? "Investiga lo que ya existe, encuentra oportunidades reales y mejora la idea antes y durante su construcción. Basta con contar el problema: no hace falta traer la solución."
              : rebuild
                ? "WILLY analiza la referencia y construye una versión PROPIA que funcione igual o mejor: con su propio nombre, diseño y código (nunca copia código, logotipos ni textos protegidos). No se entrega hasta superar todas sus comprobaciones."
                : "Describe tu idea, pega una URL, adjunta una imagen o documento, importa un proyecto existente o simplemente cuéntale a WILLY qué quieres conseguir."}
          </p>
        </div>

        {rebuild && (
          <div className="mb-3">
            <label className="block text-xs font-semibold text-muted-foreground" htmlFor="np-reference">Referencia</label>
            <input
              id="np-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Dirección web o nombre del programa · o adjunta abajo ZIP, instalador, capturas o documentación"
              className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
        )}

        <label className={rebuild ? "mb-1.5 block text-xs font-semibold text-muted-foreground" : "sr-only"} htmlFor="np-prompt">{innovation ? "Problema o idea" : rebuild ? "¿Qué quieres conseguir?" : "Qué quieres crear"}</label>
        <textarea
          id="np-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={rebuild ? 3 : 5}
          autoFocus
          placeholder={innovation ? "Describe la idea o incluso solo el problema…" : rebuild ? "Por ejemplo: «Una VPN propia para mi empresa, con kill switch y que no filtre DNS»" : quickHint ?? "Describe tu idea… (por ejemplo: «Quiero una aplicación para gestionar las citas de una clínica»)"}
          className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-6 outline-none focus:border-primary"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={reading}><Paperclip className="size-4" />{reading ? "Leyendo…" : "Adjuntar"}</Button>
          <ClarifyButton context="proyecto" compact variant="secondary" label="Que la IA lo entienda exactamente" value={prompt} onApply={setPrompt} />
          <input ref={fileRef} type="file" multiple accept={`image/*,.pdf,.txt,.md,.csv,.json,.docx,.odt,.pptx,.xlsx,.html,.htm,.rtf,.zip${rebuild ? ",.7z,.rar,.exe,.msi,.msix,.dmg,.pkg,.apk,.aab,.appimage,.deb,.rpm" : ""}`} className="hidden" onChange={(e) => { const files = e.target.files; void addFiles(files).then(() => { e.target.value = ""; }); }} />
        </div>
        {attachments.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2 text-xs" aria-label="Adjuntos">
            {attachments.map((a, i) => (
              <li key={`${a.name}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1">
                {a.name}{a.kind === "documento" ? " · texto leído" : a.kind === "imagen" ? " · imagen" : BINARY_FILE.test(a.name) ? " · solo el nombre" : ""}
                <button type="button" aria-label={`Quitar ${a.name}`} onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><X className="size-3" /></button>
              </li>
            ))}
          </ul>
        )}

        {rebuild ? (
          <div className="mt-4 grid gap-3 text-sm">
            <fieldset>
              <legend className="text-xs font-semibold text-muted-foreground">Nivel</legend>
              <div className="mt-1.5 flex flex-wrap gap-4">
                {([["completo", "Producto completo"], ["mvp", "MVP"]] as const).map(([id, label]) => (
                  <label key={id} className="flex items-center gap-2">
                    <input type="radio" name="np-level" value={id} checked={level === id} onChange={() => setLevel(id)} />{label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-xs font-semibold text-muted-foreground">Destino</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {REBUILD_TARGETS.map((t) => (
                  <label key={t.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={targets.includes(t.id)} onChange={() => setTargets((list) => toggle(list, t.id))} />{t.label}
                  </label>
                ))}
              </div>
              {targets.map(targetFeasibility).filter((f) => f.status !== "posible").map((f) => (
                <p key={f.target} className={`mt-1 text-xs ${f.status === "bloqueado" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`} data-feasibility={f.status}>{f.label}: {f.why}</p>
              ))}
              {!targets.length && <p className="mt-1 text-xs text-destructive">Elige al menos un destino.</p>}
            </fieldset>
            <fieldset>
              <legend className="text-xs font-semibold text-muted-foreground">Entrega</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {REBUILD_DELIVERABLES.map((d) => (
                  <label key={d.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={deliverables.includes(d.id)} onChange={() => setDeliverables((list) => toggle(list, d.id))} />{d.label}
                  </label>
                ))}
              </div>
              {!deliverables.length && <p className="mt-1 text-xs text-destructive">Elige al menos una entrega.</p>}
            </fieldset>
          </div>
        ) : innovation ? (
          <ul className="mt-4 grid gap-1.5 text-sm sm:grid-cols-2" aria-label="Qué hará WILLY">
            {["Investigar qué existe", "Buscar oportunidades", "Cuestionar la idea", "Mejorarla antes de construir"].map((item) => (
              <li key={item} className="flex items-center gap-2 text-muted-foreground"><Check className="size-4 text-primary" />{item}</li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <p className="text-xs font-semibold text-muted-foreground">Atajos (opcionales)</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={quick === a.id}
                  title={a.hint}
                  onClick={() => setQuick((current) => (current === a.id ? "" : a.id))}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${quick === a.id ? "border-primary bg-accent/60 text-foreground" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground" htmlFor="np-name">Nombre (opcional)</label>
            <input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested ? `Se llamará «${suggested}»` : "Se pone solo a partir de tu idea"} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
          </div>
          <details className="rounded-lg border border-border bg-background px-3 py-2 text-xs sm:max-w-60">
            <summary className="cursor-pointer font-semibold text-muted-foreground">Opciones avanzadas</summary>
            <label className="mt-2 block font-semibold text-muted-foreground" htmlFor="np-model">Modelo</label>
            <select id="np-model" value={model} onChange={(e) => setModel(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary">
              <option value="">Automático (WILLY elige)</option>
              {installedModels.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </details>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="gap-2" disabled={!canSubmit}>
            {innovation ? "Investigar y crear" : rebuild ? "Analizar y construir" : "Crear"}<ArrowRight className="size-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}

export const SECTION_ICONS = { Settings, Wrench };
