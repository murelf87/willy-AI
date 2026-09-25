import type { TaskKind } from "@/services/orchestrator";

// Biblioteca de prompts de Súper IA («Qué puedes pedirle»). Cada prompt lleva UN hueco marcado con
// «<<…>>» donde el dueño escribe su idea; el resto son las reglas de calidad que hacen que un modelo
// local rinda al máximo. «Ejecutar ya» rellena el hueco con lo escrito en el cuadro principal y nunca
// ejecuta un prompt con el hueco vacío.

const FENCE = "```";

/** Colores y tipografías reales del tema de WILLY AI: lo que se genere con estos prompts tiene su mismo estilo. */
const WILLY_STYLE = [
  "ESTILO WILLY AI (limpio, sobrio y profesional):",
  "- Tokens (variables CSS): --background: oklch(0.985 0.006 255); --foreground: oklch(0.19 0.04 265); --card: #fff; --muted: oklch(0.95 0.012 260); --muted-foreground: oklch(0.48 0.035 260); --primary: oklch(0.57 0.22 285) (violeta); --accent: oklch(0.92 0.04 270); --border: oklch(0.87 0.025 260); --radius: 0.5rem.",
  "- Modo oscuro: --background: oklch(0.14 0.035 265); --foreground: oklch(0.97 0.01 250), con el mismo violeta como acento.",
  "- Tipografía: títulos en «Space Grotesk» y texto en «Manrope», con la tipografía del sistema como respaldo. Jerarquía clara: título grande, descripción pequeña en gris.",
  "- Tarjetas con borde fino y esquinas redondeadas, mucho aire entre bloques, iconos lineales de 16–20 px, botón primario violeta y secundarios discretos. Sin degradados chillones, sin sombras exageradas y sin adornos.",
].join("\n");

export type PromptCard = {
  id: string;
  name: string;
  desc: string;
  kind: TaskKind;
  /** Ejemplo de lo que se escribe en el hueco (se muestra al pedirlo). */
  example: string;
  template: string;
};

export const PROMPT_CARDS: PromptCard[] = [
  {
    id: "investigar",
    name: "Investigar como un profesional",
    desc: "Abogado, médico, ingeniero, financiero… un informe completo, sin datos inventados.",
    kind: "investigacion",
    example: "las obligaciones de un autónomo al contratar a su primer empleado en España (como asesor laboral)",
    template: [
      "TEMA A INVESTIGAR: <<escribe aquí el tema o la pregunta y la profesión que debe adoptar: abogado, médico, ingeniero, analista financiero…>>",
      "",
      "Actúa como un experto senior de esa profesión, con 20 años de experiencia, y redacta un informe profesional.",
      "",
      "MÉTODO",
      "1. Define en una frase qué pregunta concreta se responde y para quién.",
      "2. Separa lo que se sabe con seguridad, lo que es probable y lo que no se puede saber.",
      "3. No inventes cifras, leyes, sentencias, estudios ni citas. Si un dato hay que comprobarlo, márcalo como «VERIFICAR» e indica dónde comprobarlo (organismo, base de datos o tipo de documento).",
      "4. Si te he pegado documentos o fuentes, apóyate solo en ellos y cítalos por su título.",
      "",
      "ENTREGA (en este orden, con títulos)",
      "1. Resumen ejecutivo (máximo 6 líneas).",
      "2. Análisis por puntos, del más importante al menos.",
      "3. Riesgos y qué los agrava o los reduce.",
      "4. Recomendaciones accionables, numeradas, con responsable y plazo orientativo.",
      "5. Próximos pasos para los próximos 7 días.",
      "6. Lo que falta por saber y qué preguntaría un profesional antes de decidir.",
      "",
      "FORMA: español claro, frases cortas, sin relleno ni jerga innecesaria. Esto orienta, pero no sustituye el consejo de un profesional colegiado.",
    ].join("\n"),
  },
  {
    id: "web",
    name: "Crear una web (vista previa inmediata)",
    desc: "Un único index.html profesional, responsive y con todo funcionando, listo para ver.",
    kind: "web",
    example: "web de una clínica dental en Almería para captar pacientes con cita online",
    template: [
      "QUÉ WEB QUIERO: <<escribe aquí qué es, a quién va dirigida y qué debe conseguir>>",
      "",
      "Eres un desarrollador front-end senior. Entrega una web con la calidad de un producto real, no una plantilla genérica.",
      "",
      WILLY_STYLE,
      "",
      "CALIDAD DE CÓDIGO (la de un proyecto de Lovable)",
      "- Un único archivo index.html autocontenido: HTML5 semántico (header, nav, main, section, footer) con CSS y JS incluidos y sin librerías ni recursos externos.",
      "- Colores, radios y espacios como variables CSS; nada de valores sueltos repetidos. Sin código muerto ni duplicado.",
      "- Móvil primero, perfecto de 320 a 2560 px: rejillas con auto-fit/minmax, clamp() en tipografías, sin desbordes ni texto cortado. Simetría: tarjetas de una fila con la misma altura y contenido centrado con ancho máximo.",
      "- Accesibilidad: enlace «saltar al contenido», etiquetas en formularios, foco visible, contraste AA, aria en menús y modales, teclado completo y respeto de prefers-reduced-motion.",
      "- Contenido REAL y coherente con el tema (textos, precios, nombres, preguntas frecuentes…). Prohibido lorem ipsum, «próximamente» y enlaces vacíos.",
      "- TODO funciona: menú móvil, navegación suave con la sección activa resaltada, formulario con validación y mensaje de éxito o error, acordeón de preguntas, modales o pestañas si los hay y botón de volver arriba. Cada botón hace algo real.",
      "- JS ordenado: funciones pequeñas con nombres claros, sin variables globales innecesarias.",
      "- Metadatos: lang=\"es\", title, description, Open Graph y favicon SVG incrustado.",
      "",
      "ENTREGA",
      "1. Dos líneas con lo que has construido y por qué.",
      `2. El archivo completo en un bloque con lenguaje y ruta en el encabezado:\n${FENCE}html index.html\n...código completo...\n${FENCE}`,
      "3. Sin «...» ni «resto del código». Antes de entregar, repasa: ¿se ve bien en móvil?, ¿está alineado y simétrico?, ¿cada botón funciona?",
    ].join("\n"),
  },
  {
    id: "app",
    name: "Crear una aplicación (código estilo Lovable)",
    desc: "Proyecto React + TypeScript + Tailwind + shadcn/ui, con la estructura de Lovable.",
    kind: "web",
    example: "panel para gestionar las reservas de un restaurante: ver, crear y cancelar reservas",
    template: [
      "QUÉ APLICACIÓN QUIERO: <<escribe aquí qué hace, quién la usa y las 3 acciones principales>>",
      "",
      "Eres un ingeniero de software senior. Entrega el proyecto con la misma calidad y estructura que genera Lovable.",
      "",
      "STACK: Vite + React 19 + TypeScript estricto + Tailwind CSS + shadcn/ui (Radix) + lucide-react + React Router. Formularios con react-hook-form + zod. Datos de ejemplo tipados en src/data (sin backend salvo que lo pida); estado con hooks, sin librerías de estado innecesarias.",
      "",
      WILLY_STYLE,
      "",
      "ARQUITECTURA",
      "- src/index.css con los tokens anteriores como variables CSS y tailwind.config.ts que los usa. Ningún color literal dentro de los componentes.",
      "- Carpetas: src/pages, src/components (y src/components/ui para los básicos), src/hooks, src/lib, src/data y src/types.",
      "- Componentes pequeños (menos de 150 líneas), con una sola responsabilidad, props tipadas, sin any, sin código muerto ni duplicado.",
      "- La lógica fuera de la interfaz: hooks reutilizables (por ejemplo useReservas) y utilidades puras.",
      "",
      "CALIDAD",
      "- Responsive móvil primero, de 320 a 2560 px, sin desbordes; tarjetas de igual altura en cada fila.",
      "- Accesibilidad: etiquetas, foco visible, contraste AA, roles aria y teclado.",
      "- Estados cuidados en todas las pantallas: cargando (skeleton), vacío (con una acción) y error (con reintento).",
      "- Todo funcional: cada botón, formulario, filtro, pestaña, menú y diálogo tiene su comportamiento real (crear, editar, borrar con confirmación, buscar, ordenar, validar) y avisa con un toast. Nada de «próximamente».",
      "- Datos y textos realistas; prohibido lorem ipsum.",
      "",
      "ENTREGA",
      "1. Resumen de 5 líneas como máximo y el árbol de archivos.",
      `2. CADA archivo completo en su bloque, con la ruta en el encabezado:\n${FENCE}tsx src/pages/Index.tsx\n...código completo...\n${FENCE}`,
      "   Incluye package.json, index.html, vite.config.ts, tsconfig.json, tailwind.config.ts, postcss.config.js, src/main.tsx, src/App.tsx, src/index.css y todos los componentes.",
      "3. Sin «...» ni «resto igual». Si no cabe todo en una respuesta, entrega primero configuración, tokens, layout y la pantalla principal, y termina con «CONTINÚA:» y la lista de archivos que faltan; cuando te escriba «continúa», entrega esos archivos completos.",
      "4. Termina con «Cómo ejecutarlo»: npm install y npm run dev.",
      "5. Antes de entregar, revisa: ¿compila?, ¿faltan importaciones?, ¿cada botón funciona?, ¿se ve bien en móvil?",
    ].join("\n"),
  },
  {
    id: "traducir",
    name: "Traducir cualquier texto",
    desc: "Traducción natural conservando formato, números y nombres.",
    kind: "traduccion",
    example: "el texto que quieres traducir (pégalo aquí)",
    template: [
      "TEXTO A TRADUCIR: <<pega aquí el texto>>",
      "IDIOMA DESTINO: español de España (cámbialo si quieres otro)",
      "",
      "Actúa como traductor profesional.",
      "",
      "REGLAS",
      "1. Traduce el sentido y el tono, no palabra por palabra: debe sonar natural a un hablante nativo.",
      "2. Conserva EXACTAMENTE el formato: párrafos, listas, títulos, tablas, Markdown, HTML, saltos de línea, números, unidades, URL, correos y código (sin traducir). Adapta las fechas al formato local.",
      "3. No traduzcas nombres propios, marcas ni términos técnicos de uso común; si dudas, déjalos y añade la traducción entre paréntesis la primera vez.",
      "4. Mantén el registro (formal o informal) del original.",
      "5. No añadas, quites ni resumas nada, y no expliques nada dentro de la traducción.",
      "",
      "ENTREGA: solo la traducción. Si algún fragmento es ambiguo, añade al final «Notas de traducción» con una línea por duda (máximo 5).",
    ].join("\n"),
  },
  {
    id: "correos",
    name: "Correos masivos y automáticos",
    desc: "Campaña completa con variantes, seguimientos y CSV, cumpliendo RGPD y LSSI.",
    kind: "escritura",
    example: "presentar mi asesoría a autónomos de Almería y ofrecerles una primera consulta gratuita",
    template: [
      "CAMPAÑA: <<escribe aquí el objetivo, el producto o servicio, la oferta y a quién va dirigida>>",
      "",
      "Actúa como especialista en email marketing.",
      "",
      "ENTREGA (en este orden)",
      "1. Estrategia en 4 líneas: público, promesa, llamada a la acción única y tono.",
      "2. Asunto: 3 variantes para pruebas A/B (máximo 50 caracteres, sin MAYÚSCULAS ni exclamaciones de más) y, para cada una, un texto de vista previa de 60 a 90 caracteres.",
      "3. Correo principal: saludo con {{nombre}}, apertura que conecte con el problema del destinatario, 2 o 3 beneficios concretos, una prueba (dato, caso o testimonio; márcalo como «ejemplo» si no es real), una sola llamada a la acción con {{enlace}} y firma con {{remitente}} y {{empresa}}.",
      "4. La versión en texto plano del mismo correo.",
      "5. Dos seguimientos: a los 3 y a los 7 días, cada uno más corto y con un ángulo distinto.",
      "6. Pie legal: motivo por el que recibe el correo, identificación del remitente y enlace de baja {{baja}}.",
      "7. Un archivo destinatarios.csv de ejemplo, en un bloque de código con «csv destinatarios.csv» en el encabezado, con las columnas email,nombre,empresa,ciudad,idioma,consentimiento y 5 filas ficticias.",
      "8. Lista de comprobación de entrega: SPF, DKIM y DMARC configurados, remitente reconocible, sin adjuntos pesados y enlace de baja que funcione.",
      "",
      "CUMPLIMIENTO (España y UE): solo a quien haya dado su consentimiento o tenga una relación previa (RGPD y LSSI), y con forma clara de darse de baja. No inventes resultados ni promesas que no se puedan cumplir.",
    ].join("\n"),
  },
  {
    id: "llamadas",
    name: "Llamadas con voz real",
    desc: "Guion para leer en voz alta con la voz del sistema: natural, corto y con objeciones.",
    kind: "escritura",
    example: "recordar citas a pacientes de una clínica dental y confirmar que asisten",
    template: [
      "LLAMADA: <<escribe aquí quién llama, a quién, para qué y qué se quiere conseguir>>",
      "",
      "Escribe un guion para leer en voz alta con la voz del sistema.",
      "",
      "FORMA",
      "- Frases cortas (máximo 15 palabras), en el orden en que se dicen y una idea por línea.",
      "- Escribe como se habla: números, fechas y siglas con letras («veinte euros», «el tres de marzo»), sin símbolos, abreviaturas ni paréntesis.",
      "- Las pausas se marcan con puntos suspensivos. Tono cálido, natural y profesional.",
      "",
      "ESTRUCTURA",
      "1. Apertura (unos 10 segundos): saludo, nombre de quien llama y empresa.",
      "2. Motivo de la llamada en una frase y pregunta de permiso: «¿Tiene un minuto?».",
      "3. De 3 a 5 preguntas clave, cada una con la respuesta que se espera y qué decir después.",
      "4. Respuesta a las 5 objeciones más habituales («no tengo tiempo», «no me interesa», «envíeme información», «ya tengo proveedor», «es caro»), con dos frases cada una.",
      "5. Cierre con un siguiente paso concreto (día y hora) y confirmación de los datos.",
      "6. Despedida amable, y una versión corta por si la persona no puede atender.",
      "7. Si pide que no le vuelvan a llamar: despedida respetuosa y aviso para anotarlo.",
      "",
      "ENTREGA: el guion completo con un título por bloque, listo para leer en voz alta, y al final una lista de 5 comprobaciones antes de llamar.",
      "",
      "CUMPLIMIENTO: si es una llamada comercial, identifícate y di el motivo al empezar, respeta la Lista Robinson y avisa si se graba.",
    ].join("\n"),
  },
  {
    id: "avatar",
    name: "Tu yo en IA (avatar y contenido)",
    desc: "Contenido con tu forma de hablar, usando tu perfil de estilo.",
    kind: "escritura",
    example: "post de LinkedIn sobre por qué automatizar tareas repetitivas, para dueños de pequeños negocios",
    template: [
      "CONTENIDO: <<escribe aquí el tipo de contenido, el tema, para quién es y dónde se publicará>>",
      "",
      "Escribe con mi estilo, usando mi «perfil de estilo» (se te adjunta como contexto).",
      "",
      "REGLAS",
      "1. Imita mi forma de hablar: ritmo, longitud de las frases, expresiones, nivel de formalidad y humor. No lo suavices ni lo hagas «más profesional» si no lo pido.",
      "2. Prohibido el tono de asistente: nada de «en el mundo actual», «sumérgete», «desbloquea», «no es solo X, es Y», exclamaciones vacías ni listas de tres adjetivos.",
      "3. Concreto y con sustancia: al menos un ejemplo real o una imagen que se vea. No inventes datos: si falta uno, deja «[dato]».",
      "4. Empieza fuerte (la primera frase decide si me leen) y termina con una idea o una pregunta, no con un resumen.",
      "",
      "ENTREGA",
      "1. Tres versiones distintas: una más directa, una más cercana y una más provocadora.",
      "2. Debajo de cada una, una línea que diga qué rasgo de mi estilo has aplicado.",
      "Si mi perfil de estilo está vacío, dilo en una línea y usa un tono directo, cercano y de frases cortas.",
    ].join("\n"),
  },
  {
    id: "integrar",
    name: "Integrar con programas y archivos",
    desc: "Script para Windows que automatiza Excel, Word, PDF, carpetas o APIs, sin pagar nada.",
    kind: "codigo",
    example: "cada día leer los pedidos de una carpeta de Excel y crear un resumen en PDF",
    template: [
      "AUTOMATIZACIÓN: <<escribe aquí con qué programa o archivos (Excel, Word, PDF, una carpeta, una API…) y qué debe hacer solo>>",
      "",
      "Eres un ingeniero de automatización. Entrega un script listo para usar en Windows 10/11 y sin dependencias de pago.",
      "",
      "DECISIÓN: elige el lenguaje más sencillo para el caso (PowerShell si basta; si no, Python 3 con librerías gratuitas como openpyxl, python-docx, pypdf o requests) y explica por qué en una línea.",
      "",
      "CALIDAD",
      "1. Configuración al principio del script (rutas, nombres, parámetros), sin valores escondidos en el código.",
      "2. Seguro: nunca borra ni sobrescribe sin copia previa, y tiene un modo de prueba (--simular) que solo muestra lo que haría.",
      "3. Robusto: comprueba que existen los archivos y carpetas, maneja los errores con mensajes claros en español y termina con el código de salida correcto.",
      "4. Registro: escribe un log con fecha y hora de lo que hace.",
      "5. Repetible: si se ejecuta dos veces no duplica resultados.",
      "6. Código limpio: funciones pequeñas con nombres claros y comentarios breves solo donde aporten.",
      "",
      "ENTREGA",
      "1. Cómo funciona, en 4 líneas.",
      "2. Cada archivo completo en su propio bloque de código, con el lenguaje y el nombre en el encabezado (por ejemplo «python automatizar.py»), y requirements.txt si hace falta.",
      "3. Instrucciones paso a paso para principiantes: instalar, configurar, probar en modo simulación y ejecutar.",
      "4. Cómo programarlo en el Programador de tareas de Windows.",
      "5. Un ejemplo de entrada y de salida esperada.",
      "Sin «...» ni «resto del código».",
    ].join("\n"),
  },
  {
    id: "arreglar",
    name: "Arreglar o mejorar código",
    desc: "Diagnóstico de la causa real y el cambio mínimo que lo arregla, con cómo comprobarlo.",
    kind: "codigo",
    example: "el código que falla y el mensaje de error que te sale",
    template: [
      "CÓDIGO Y PROBLEMA: <<pega aquí el código y cuenta qué falla o qué quieres mejorar; añade el mensaje de error si lo hay>>",
      "",
      "Eres un ingeniero senior que revisa código con rigor.",
      "",
      "MÉTODO",
      "1. Resume en una línea qué hace el código y qué falla.",
      "2. Encuentra la CAUSA de fondo, no solo el síntoma, y explica por qué ocurre.",
      "3. Corrige con el cambio MÍNIMO necesario: no reescribas lo que funciona ni cambies el estilo sin motivo.",
      "4. Señala otros problemas reales (seguridad, rendimiento, casos límite) sin inventar ninguno.",
      "",
      "ENTREGA",
      "1. Diagnóstico (máximo 6 líneas).",
      "2. El código corregido COMPLETO, en un bloque con el lenguaje y la ruta si la conoces.",
      "3. Lista de cambios, uno por línea: «función o línea: qué y por qué».",
      "4. Cómo comprobar que ya funciona (pasos o pruebas).",
      "5. Mejoras opcionales ordenadas por valor, separadas de la corrección.",
      "Si falta información para estar seguro, dilo y di qué necesitas ver, pero da igualmente la mejor corrección posible.",
    ].join("\n"),
  },
  {
    id: "mejoras",
    name: "Preparar mejoras para la Autoconstrucción",
    desc: "Convierte tu idea en peticiones pequeñas y exactas que un modelo local hace bien a la primera.",
    kind: "razonamiento",
    example: "que el indicador «Generando respuesta…» de la barra superior diga «Pensando» con tres puntos animados",
    template: [
      "MEJORA QUE QUIERO: <<escribe aquí, con tus palabras, lo que quieres cambiar, añadir o arreglar en WILLY AI>>",
      "",
      "Actúa como jefe de producto y programador senior de WILLY AI. Convierte mi idea en peticiones PEQUEÑAS y PRECISAS para la pestaña Autoconstrucción, que las hace un modelo de IA local: cuanto más exacta es la petición, más probable es que salga bien a la primera.",
      "",
      "REGLAS",
      "1. Una petición = un solo cambio que se pueda comprobar. Si mi idea son varios cambios, sepáralos en peticiones independientes, ordenadas de la primera que hay que hacer a la última.",
      "2. Cada petición dice DÓNDE (pestaña o pantalla y zona: barra superior, tarjeta, botón…) y cita entre comillas el texto exacto que se ve hoy, por ejemplo «Generando respuesta…». Si no sé el texto exacto, dilo y dime qué captura debo adjuntar.",
      "3. Di QUÉ debe pasar exactamente después (texto nuevo entre comillas, color, posición, comportamiento al pulsar) y qué NO debe cambiar.",
      "4. Frases cortas y en imperativo, sin jerga: máximo 6 líneas por petición.",
      "5. Si algo es demasiado grande o ambiguo para hacerse de una vez, dilo y propón cómo dividirlo.",
      "",
      "ENTREGA",
      "1. Una lista numerada de peticiones listas para copiar y pegar en «Nueva mejora», cada una separada de las demás.",
      "2. Debajo de cada una, «Comprobación:» con 2 pasos para verificar que ha quedado bien.",
      "3. Al final, el orden recomendado y qué capturas (Win+Shift+S) conviene adjuntar en cada petición.",
    ].join("\n"),
  },
  {
    id: "resumir",
    name: "Resumir y analizar documentos",
    desc: "Resumen fiel con puntos clave, plazos, riesgos y preguntas antes de decidir.",
    kind: "investigacion",
    example: "el texto del contrato o informe, y qué necesitas saber de él",
    template: [
      "DOCUMENTO: <<pega aquí el texto (contrato, informe, artículo, correo, acta…) e indica qué necesitas saber de él>>",
      "",
      "Actúa como analista experto. Trabaja SOLO con lo que dice el documento: no añadas datos externos ni supongas.",
      "",
      "ENTREGA",
      "1. En una frase: de qué trata y para qué sirve.",
      "2. Resumen ejecutivo (máximo 8 líneas).",
      "3. Puntos clave, numerados, cada uno con la cita literal corta que lo respalda, entre comillas.",
      "4. Fechas, plazos, cantidades, nombres y obligaciones, en una tabla con las columnas Qué / Quién / Cuándo / Cuánto.",
      "5. Riesgos, contradicciones, lagunas o cláusulas que conviene revisar.",
      "6. Preguntas que haría antes de firmar o decidir.",
      "7. Si he indicado un aspecto concreto, respóndelo primero y con detalle.",
      "",
      "Si el texto está cortado o incompleto, dilo. Esto orienta, pero no sustituye la revisión de un profesional.",
    ].join("\n"),
  },
];

const FIELD = /<<[^>]*>>/;

/** true si queda algún hueco «<<…>>» sin rellenar. */
export function hasUnfilled(text: string): boolean {
  return FIELD.test(text);
}

/** Sustituye el hueco por lo que ha escrito el dueño. */
export function fillPrompt(template: string, input: string): string {
  return template.replace(FIELD, () => input.trim());
}

/** Primera línea hasta el hueco: identifica de qué prompt viene un texto ya cargado en el cuadro. */
export function signatureOf(card: PromptCard): string {
  return card.template.split("<<")[0]!.trim();
}

export type RunPlan = { action: "run"; prompt: string } | { action: "load"; load: string; message: string };

/**
 * Qué hace «Ejecutar ya» con el texto que haya en el cuadro principal:
 * - vacío: carga el prompt para rellenarlo (no ejecuta huecos sin rellenar);
 * - ya es este prompt con el hueco relleno: se ejecuta tal cual;
 * - es este prompt con el hueco vacío: avisa;
 * - es otro texto: se usa como contenido del hueco.
 */
export function runPlan(card: PromptCard, boxText: string): RunPlan {
  const text = boxText.trim();
  const fillMessage = `Escribe en el hueco «<<…>>» ${card.example ? `(por ejemplo: ${card.example})` : "lo que necesitas"} y pulsa Ejecutar.`;
  if (!text) return { action: "load", load: card.template, message: fillMessage };
  if (text.startsWith(signatureOf(card))) {
    return hasUnfilled(text) ? { action: "load", load: text, message: fillMessage } : { action: "run", prompt: text };
  }
  if (hasUnfilled(text)) return { action: "load", load: card.template, message: fillMessage };
  return { action: "run", prompt: fillPrompt(card.template, text) };
}
