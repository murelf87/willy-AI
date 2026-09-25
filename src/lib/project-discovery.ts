// SUPER WILLY · ENTREVISTA DEL PROYECTO («Project Discovery»). Antes de programar un proyecto importante, WILLY conversa con
// el dueño por BLOQUES de pocas preguntas: cada una con opciones (A, B, C…), una explicación corta y la recomendación de WILLY
// con su motivo. El dueño elige, escribe «1C, 2B» o dice «haz lo que recomiendas». WILLY no pregunta lo que el dueño ya dijo
// en su idea, propone funciones que no se le habían ocurrido (imprescindibles, recomendadas, opcionales y futuras), mantiene un
// brief vivo y, antes de escribir código, enseña «esto es lo que vamos a construir».
// Todo es lógica pura, sin IA ni red: funciona igual en cualquier equipo, al instante, y se puede probar.

import { suggestName } from "@/lib/project-brief";
import { designPromptBlock } from "@/lib/design-intelligence";
import { DESIGN_STYLES } from "@/services/design-themes";
import { PLAYBOOKS } from "@/services/playbooks";

// ------------------------------------------------------------------------------------------------ tipos
export type OptionId = "A" | "B" | "C" | "D" | "E" | "F";
export type StepId = "producto" | "plataforma" | "funciones" | "diseno" | "negocio" | "entrega" | "resumen";
export type Stage = "entrevista" | "construyendo" | "construido";
export type DecisionMode = "guiado" | "auto";
export type ProjectKind = "saas" | "tienda" | "web" | "app" | "escritorio" | "api" | "herramienta";
export type FeatureTier = "imprescindible" | "recomendada" | "opcional" | "futura";

export type DiscoveryOption = { id: OptionId; label: string };
export type DiscoveryQuestion = {
  id: string;
  step: StepId;
  /** Apartado del brief al que pertenece (USUARIOS, PLATAFORMAS…). */
  topic: string;
  text: string;
  options: DiscoveryOption[];
  recommended: OptionId;
  /** «Mi recomendación: … porque …». */
  reason: string;
  /** Lo que el dueño ya dijo en su idea (no se le vuelve a preguntar, pero puede cambiarlo). */
  known: { option: OptionId; because: string } | null;
};

export type Feature = { id: string; label: string; tier: FeatureTier; source: "willy" | "dueño" | "ia"; on: boolean };
export type CustomFeature = { id: string; label: string; tier: FeatureTier; source: "dueño" | "ia" };

export type DiscoveryState = {
  version: 1;
  idea: string;
  name: string;
  kind: ProjectKind;
  domain: string | null;
  mode: DecisionMode;
  stage: Stage;
  step: StepId;
  /** Respuestas elegidas por el dueño (o aplicadas desde la recomendación). */
  answers: Record<string, OptionId>;
  /** Funciones: «¿qué incluimos?» (A solo imprescindibles, B + recomendadas, C todas, D una por una). */
  featureChoice: OptionId | null;
  /** Encendidas o apagadas a mano (manda sobre lo que toca por defecto). */
  toggles: Record<string, boolean>;
  custom: CustomFeature[];
  /** Notas y requisitos sueltos del dueño («el cliente también quiere…»). */
  notes: string[];
  startedAt: number;
  updatedAt: number;
};

// ------------------------------------------------------------------------------------------------ utilidades
/** minúsculas y sin tildes («Peluquería» → «peluqueria»): así las reglas no dependen de cómo se escriba. */
export function norm(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function slug(text: string): string {
  return norm(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "funcion";
}

const cap = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

// ------------------------------------------------------------------------------------------------ ¿es un proyecto?
const STRONG = "crear|crea|creame|creanos|construir|construye|construyeme|desarrollar|desarrolla|desarrollame|programar|programa|programame|montar|monta|montame|disenar|disena|disename|lanzar";
const WEAK = "quiero|quisiera|necesito|necesitamos|queremos|me gustaria|nos gustaria|hazme|haznos|haz|hacer|hacerme|tener|tengo que hacer|vamos a hacer";
const ADJ = "nueva|nuevo|nuevas|nuevos|pequena|pequeno|sencilla|sencillo|completa|completo|profesional|propia|propio|buena|buen|gran|moderna|moderno|potente|especie de|tipo";
const PRODUCT = "app|apps|aplicacion|aplicaciones|webapp|web|webs|pagina|paginas|sitio|landing|tienda|ecommerce|e-commerce|saas|plataforma|programa|software|sistema|panel|crm|erp|intranet|portal|marketplace|api|backend|herramienta|juego|videojuego|chatbot|dashboard|gestor";
const STRONG_RE = new RegExp(`\\b(?:${STRONG})\\b(?:\\s+(?:me|nos|te|para mi|para nosotros))?(?:\\s+(?:una?|unos|unas|el|la|mi|mis|nuestra?|nuestros|su))?(?:\\s+(?:${ADJ}))*\\s+(?:${PRODUCT})\\b`);
const WEAK_RE = new RegExp(`\\b(?:${WEAK})\\b(?:\\s+(?:crear|hacer|montar|construir|desarrollar|programar|disenar|lanzar|tener))?(?:\\s+(?:me|nos))?\\s+(?:una?|unos|unas)(?:\\s+(?:${ADJ}))*\\s+(?:${PRODUCT})\\b`);
const MANAGE_RE = /\b(?:crear|hacer|montar|construir|desarrollar|programar)\b.{0,40}\b(?:para gestionar|que gestione|para controlar|para llevar el control|para vender|para reservar)\b/;
const NEW_RE = /\b(?:nuevo proyecto|otro proyecto|proyecto nuevo|otra app|otra aplicacion|otra web|otro programa)\b/;
/** Peticiones que empiezan analizando, resumiendo, traduciendo… no son «crear un proyecto» aunque nombren una web. */
const NOT_BUILD = /^\s*(?:analiza|analizar|resume|resumir|resumeme|traduce|traducir|traduceme|explica|explicame|explicar|corrige|corregir|revisa|revisar|busca|buscar|investiga|investigar|compara|comparar|redacta|redactar|escribe|escribir|escribeme|lee|leer|dime|que es|como se|por que|arregla|arreglar|repara|reparar|mejora|mejorar|cambia|cambiar)\b/;

/**
 * ¿Pide crear un proyecto? «nuevo» = seguro que es un proyecto nuevo (una app, una web, otro proyecto…); «posible» = verbo de
 * crear con «el/la/mi» (puede ser una parte del proyecto en curso); null = no es un encargo de proyecto.
 */
export function projectRequest(text: string): "nuevo" | "posible" | null {
  const t = norm(text).replace(/\s+/g, " ").slice(0, 500);
  if (!t.trim() || NOT_BUILD.test(t)) return null;
  if (NEW_RE.test(t) && new RegExp(`\\b(?:${PRODUCT}|proyecto)\\b`).test(t)) return "nuevo";
  if (WEAK_RE.test(t)) return "nuevo";
  const strong = STRONG_RE.exec(t);
  if (strong) return /\b(?:una?|unos|unas)\b/.test(strong[0]) || !/\b(?:el|la|mi|mis|nuestra?|nuestros|su)\b/.test(strong[0]) ? "nuevo" : "posible";
  if (MANAGE_RE.test(t)) return "nuevo";
  return null;
}

// ------------------------------------------------------------------------------------------------ tipo de proyecto y sector
const KIND_RULES: Array<[ProjectKind, RegExp]> = [
  ["escritorio", /\b(programa (?:de|para) (?:ordenador|windows|pc|escritorio)|aplicacion de escritorio|software de escritorio|programa de escritorio|para windows|en windows|\.exe|instalable en (?:el |mi )?(?:pc|ordenador))\b/],
  ["saas", /\b(saas|multiempresa|multi-empresa|varias empresas|muchas empresas|venderlo a (?:otras )?(?:empresas|negocios)|para vender a (?:otras )?(?:empresas|negocios))\b/],
  ["tienda", /\b(tienda|ecommerce|e-commerce|comercio electronico|vender (?:mis )?productos|venta online|carrito de (?:la )?compra)\b/],
  ["herramienta", /\b(herramienta|utilidad|calculadora|conversor|generador de|script)\b/],
  ["app", /\b(app|apps|aplicacion|aplicaciones|webapp|plataforma|panel|gestor|gestionar|gestion|sistema|software|crm|erp|intranet|portal|marketplace|dashboard|programa)\b/],
  ["api", /\b(api|backend|microservicio|servicio de datos|endpoint)\b/],
  ["web", /\b(web|webs|pagina|paginas|sitio|landing|blog|portfolio|portafolio)\b/],
];

export function kindOf(idea: string): ProjectKind {
  const t = norm(idea);
  for (const [kind, re] of KIND_RULES) if (re.test(t)) return kind;
  return "app";
}

export const KIND_LABELS: Record<ProjectKind, string> = {
  saas: "SaaS (para vender a otras empresas)",
  tienda: "Tienda online",
  web: "Web",
  app: "Aplicación",
  escritorio: "Programa de escritorio para Windows",
  api: "API (servicio de datos)",
  herramienta: "Herramienta",
};

type Catalog = { imprescindible: string[]; recomendada: string[]; opcional: string[]; futura: string[] };
type Domain = {
  id: string;
  label: string;
  match: RegExp;
  /** Sus clientes piden cita o reservan (peluquería, clínica…). */
  bookings: boolean;
  /** Tiene clientes que usarían la aplicación. */
  customerFacing: boolean;
  /** Maneja datos especialmente protegidos (salud…). */
  sensitive: boolean;
  payments: "senal" | "completo" | "suscripcion" | null;
  features: Catalog;
};

/** Sectores frecuentes con lo que suele necesitar cada uno (lo que el dueño a veces no sabe que necesita). */
export const DOMAINS: Domain[] = [
  {
    id: "salud", label: "clínica o consulta", match: /\b(clinica|clinicas|medic\w*|dentist\w*|dental|fisioterap\w*|fisio|psicolog\w*|veterinari\w*|pacientes|consulta medica|nutricionist\w*|podolog\w*|logoped\w*|optica)\b/,
    bookings: true, customerFacing: true, sensitive: true, payments: "senal",
    features: {
      imprescindible: ["Pacientes con ficha e historial", "Agenda de cada profesional", "Citas con disponibilidad real", "Permisos por rol (recepción, profesional y administración)", "Registro de quién consulta los datos de salud"],
      recomendada: ["Recordatorios automáticos de cita", "Documentos y consentimientos firmados", "Panel con indicadores del día", "Búsqueda avanzada de pacientes"],
      opcional: ["Videoconsulta", "Área privada del paciente", "IA para resumir documentos"],
      futura: ["Facturación a aseguradoras", "App móvil para pacientes"],
    },
  },
  {
    id: "belleza", label: "peluquería o centro de estética", match: /\b(peluquer\w*|barber\w*|estetica|unas|manicura|spa|masaj\w*|belleza|tatuaj\w*|maquillaj\w*|depilaci\w*)\b/,
    bookings: true, customerFacing: true, sensitive: false, payments: "senal",
    features: {
      imprescindible: ["Servicios con duración y precio", "Profesionales y sus horarios", "Reservas de cita con disponibilidad real", "Ficha de clientes", "Panel del negocio con la agenda del día"],
      recomendada: ["Recordatorios automáticos de cita", "Cancelar o cambiar la cita desde un enlace", "Estadísticas de citas y facturación", "Reseñas de clientes"],
      opcional: ["Bonos y programa de fidelización", "Venta de productos", "Chat con el cliente", "IA que recomienda servicios"],
      futura: ["App nativa Android e iOS", "Varios locales"],
    },
  },
  {
    id: "restaurante", label: "restaurante o bar", match: /\b(restaurante\w*|bar|bares|cafeteria\w*|pizzeria|hamburgueseria|comida para llevar|carta digital|menu del dia|pedidos a domicilio|delivery)\b/,
    bookings: true, customerFacing: true, sensitive: false, payments: "completo",
    features: {
      imprescindible: ["Carta digital con precios y alérgenos", "Reservas de mesa", "Panel del restaurante"],
      recomendada: ["Pedidos para recoger o a domicilio", "Recordatorio de la reserva", "Horarios y cierres especiales"],
      opcional: ["Pago online de los pedidos", "Programa de fidelización", "Reseñas"],
      futura: ["Conexión con plataformas de reparto", "Pantalla para la cocina"],
    },
  },
  {
    id: "gimnasio", label: "gimnasio o centro deportivo", match: /\b(gimnasio\w*|gym|crossfit|yoga|pilates|entrenador\w*|entrenamiento\w*|clases dirigidas|centro deportivo|box de)\b/,
    bookings: true, customerFacing: true, sensitive: false, payments: "suscripcion",
    features: {
      imprescindible: ["Socios y sus cuotas", "Clases con horario y aforo", "Reserva de plaza en clases", "Panel del centro"],
      recomendada: ["Cobro automático de cuotas", "Control de asistencia", "Avisos de cambios de horario"],
      opcional: ["Planes de entrenamiento", "Tienda de productos", "Acceso con código QR"],
      futura: ["Varios centros", "Conexión con tornos de acceso"],
    },
  },
  {
    id: "academia", label: "academia o formación", match: /\b(academia\w*|cursos?|formacion|alumnos?|profesores?|escuela\w*|clases (?:online|particulares)|e-?learning|colegio\w*)\b/,
    bookings: false, customerFacing: true, sensitive: false, payments: "suscripcion",
    features: {
      imprescindible: ["Cursos y grupos", "Alumnos y matrículas", "Calendario de clases", "Panel de la academia"],
      recomendada: ["Pago de matrículas y cuotas", "Asistencia y notas", "Avisos a los alumnos"],
      opcional: ["Aula virtual con vídeos", "Certificados en PDF", "Foro o chat de la clase"],
      futura: ["App móvil", "Exámenes online con corrección automática"],
    },
  },
  {
    id: "inmobiliaria", label: "inmobiliaria", match: /\b(inmobiliari\w*|pisos?|viviendas?|alquileres|propiedades|inmuebles?)\b/,
    bookings: false, customerFacing: true, sensitive: false, payments: null,
    features: {
      imprescindible: ["Fichas de inmuebles con fotos", "Buscador con filtros (zona, precio, habitaciones)", "Formulario de contacto en cada inmueble", "Panel para publicar inmuebles"],
      recomendada: ["Mapa de inmuebles", "Favoritos y alertas de nuevos inmuebles", "Gestión de contactos interesados"],
      opcional: ["Visitas virtuales 360°", "Valoración orientativa de una vivienda", "Varios idiomas"],
      futura: ["Portal para varias agencias", "Publicación automática en portales inmobiliarios"],
    },
  },
  {
    id: "eventos", label: "eventos y entradas", match: /\b(eventos?|bodas?|entradas|tickets?|conciertos?|congresos?|festival\w*)\b/,
    bookings: false, customerFacing: true, sensitive: false, payments: "completo",
    features: {
      imprescindible: ["Eventos con fecha, lugar y aforo", "Venta o reserva de entradas", "Entradas con código QR", "Panel del organizador"],
      recomendada: ["Control de acceso leyendo el QR", "Emails de confirmación", "Estadísticas de ventas"],
      opcional: ["Códigos de descuento", "Lista de espera", "Asientos numerados"],
      futura: ["App para el organizador", "Reventa oficial"],
    },
  },
  {
    id: "alojamiento", label: "alojamiento", match: /\b(hotel\w*|hostal\w*|casa rural|casas rurales|apartamentos turisticos|alojamiento\w*|camping)\b/,
    bookings: true, customerFacing: true, sensitive: false, payments: "senal",
    features: {
      imprescindible: ["Habitaciones o alojamientos con fotos y precios", "Calendario de disponibilidad", "Reservas por fechas", "Panel del alojamiento"],
      recomendada: ["Pago de señal al reservar", "Emails de confirmación", "Precios por temporada"],
      opcional: ["Reseñas", "Varios idiomas", "Servicios extra (desayuno, parking…)"],
      futura: ["Sincronización con Booking y Airbnb", "Varios alojamientos"],
    },
  },
  {
    id: "servicios", label: "taller o servicios técnicos", match: /\b(taller\w*|mecanic\w*|reparacion\w*|fontaner\w*|electricist\w*|limpieza|reformas|mantenimiento de)\b/,
    bookings: true, customerFacing: true, sensitive: false, payments: null,
    features: {
      imprescindible: ["Clientes y sus vehículos o equipos", "Citas o solicitudes de servicio", "Presupuestos", "Órdenes de trabajo con su estado"],
      recomendada: ["Avisos de estado al cliente", "Facturas en PDF", "Historial de cada cliente"],
      opcional: ["Pago online", "Firma del cliente en pantalla", "Inventario de piezas"],
      futura: ["App para los técnicos", "Varios talleres"],
    },
  },
  {
    id: "gestion", label: "gestión interna", match: /\b(inventario|almacen\w*|stock|facturacion|facturas|contabilidad|crm|erp|fichaje|control horario|nominas|proveedores|pedidos a proveedores|gastos)\b/,
    bookings: false, customerFacing: false, sensitive: false, payments: null,
    features: {
      imprescindible: ["Alta, edición y baja de la información principal", "Búsqueda y filtros", "Informes", "Usuarios y permisos"],
      recomendada: ["Exportar a Excel y PDF", "Historial de cambios (quién hizo qué)", "Copias de seguridad automáticas"],
      opcional: ["Importar datos desde Excel", "Avisos por email", "Panel con gráficas"],
      futura: ["App móvil", "Conexión con otros programas"],
    },
  },
  {
    id: "reservas", label: "reservas y citas", match: /\b(reservas?|citas?|agenda|turnos?|booking)\b/,
    bookings: true, customerFacing: true, sensitive: false, payments: "senal",
    features: {
      imprescindible: ["Servicios con duración y precio", "Calendario con disponibilidad real", "Reservas con confirmación", "Panel para ver, mover y cancelar reservas"],
      recomendada: ["Recordatorios automáticos", "Política de cancelación", "Estadísticas de reservas"],
      opcional: ["Varios profesionales o salas", "Sincronización con Google Calendar", "Pago por adelantado"],
      futura: ["App nativa", "Varios locales"],
    },
  },
];

export function domainOf(idea: string): Domain | null {
  const t = norm(idea);
  return DOMAINS.find((d) => d.match.test(t)) ?? null;
}

const domainById = (id: string | null) => DOMAINS.find((d) => d.id === id) ?? null;

// ------------------------------------------------------------------------------------------------ preguntas
type Ctx = {
  /** Idea en minúsculas y sin tildes. */
  t: string;
  kind: ProjectKind;
  domain: Domain | null;
  /** Respuesta efectiva: la del dueño, la que ya dijo en su idea o, si todavía no hay, la recomendada. */
  eff: (id: string) => OptionId | null;
};

type QuestionDef = {
  id: string;
  step: Exclude<StepId, "funciones" | "resumen">;
  topic: string;
  applies: (c: Ctx) => boolean;
  text: (c: Ctx) => string;
  options: (c: Ctx) => DiscoveryOption[];
  recommend: (c: Ctx) => { option: OptionId; reason: string };
  known?: (c: Ctx) => { option: OptionId; because: string } | null;
};

const opts = (...labels: Array<[OptionId, string]>): DiscoveryOption[] => labels.map(([id, label]) => ({ id, label }));
const saidBy = (c: Ctx, re: RegExp, option: OptionId): { option: OptionId; because: string } | null => {
  const m = re.exec(c.t);
  return m ? { option, because: `lo dijiste en tu idea («${m[0].trim()}»)` } : null;
};
const isStaticWeb = (c: Ctx) =>
  c.kind === "web" && c.eff("objetivo") !== "C" && c.eff("reservas") !== "B" && c.eff("acceso") === "A" && !["B", "C", "D"].includes(c.eff("pagos") ?? "A");

export const QUESTIONS: QuestionDef[] = [
  // ------------------------------------------------------------------ 1. EL PRODUCTO
  {
    id: "objetivo", step: "producto", topic: "OBJETIVO",
    applies: (c) => c.kind === "web",
    text: () => "¿Qué tiene que conseguir la web?",
    options: () => opts(["A", "Presentar tu negocio y que te contacten"], ["B", "Captar clientes (llamar, WhatsApp y formulario en cada página)"], ["C", "Vender online (tienda)"], ["D", "Publicar contenido (blog o noticias)"]),
    recommend: () => ({ option: "B", reason: "una web que capta clientes (botones de llamar, WhatsApp y formulario siempre a mano) trae mucho más trabajo que una que solo informa." }),
    known: (c) => saidBy(c, /\b(tienda|vender online|venta online)\b/, "C") ?? saidBy(c, /\b(blog|noticias|revista)\b/, "D") ?? saidBy(c, /\b(captar clientes|conseguir clientes|captacion)\b/, "B") ?? saidBy(c, /\b(portfolio|portafolio|presentar (?:mi|el) negocio|web corporativa|pagina corporativa)\b/, "A"),
  },
  {
    id: "reservas", step: "producto", topic: "RESERVAS",
    applies: (c) => c.kind === "web" && Boolean(c.domain?.bookings) && c.eff("objetivo") !== "C",
    text: () => "¿Quieres que tus clientes reserven desde la web?",
    options: () => opts(["A", "No: un botón para llamar o escribir por WhatsApp"], ["B", "Sí: reservas online con la disponibilidad real"], ["C", "Sí, enlazando con la app de reservas que ya uso"]),
    recommend: () => ({ option: "B", reason: "la mayoría de clientes prefiere reservar a cualquier hora sin llamar, y a ti te ahorra teléfono y huecos vacíos." }),
    known: (c) => saidBy(c, /\b(reservas? online|reservar online|reserva de citas|pedir cita online|con reservas)\b/, "B"),
  },
  {
    id: "usuarios", step: "producto", topic: "USUARIOS",
    applies: (c) => c.kind !== "web" && c.kind !== "api" && c.kind !== "herramienta",
    text: () => "¿Quién va a utilizarlo?",
    options: (c) => c.kind === "escritorio"
      ? opts(["A", "Solo tú, en tu ordenador"], ["B", "Tu equipo, en varios ordenadores"], ["C", "Lo venderás a otros (con licencias)"])
      : opts(["A", "Solo tú o tu equipo (uso interno)"], ["B", "Tu equipo y también tus clientes"], ["C", "Muchas empresas: un SaaS para venderlo"]),
    recommend: (c) => {
      if (c.kind === "saas") return { option: "C", reason: "si lo vas a vender a otros negocios, prepararlo desde el principio para varias empresas evita rehacerlo después." };
      if (c.kind === "escritorio") return { option: "A", reason: "un programa para un ordenador es lo más sencillo: sin servidor y con los datos en tu PC." };
      if (c.kind === "tienda" || c.domain?.customerFacing) return { option: "B", reason: "tu negocio atiende a clientes: que ellos también puedan usarlo (reservar, comprar, consultar) es lo que más valor da." };
      return { option: "A", reason: "es una herramienta de trabajo: basta con tu equipo y queda más sencilla y barata." };
    },
    known: (c) => saidBy(c, /\b(saas|multiempresa|varias empresas|muchas empresas|venderlo a (?:otras )?(?:empresas|negocios))\b/, "C")
      ?? saidBy(c, /\b(mis clientes|los clientes|para clientes|que los clientes|pacientes|socios|alumnos)\b/, "B")
      ?? saidBy(c, /\b(uso interno|para mis empleados|para mi equipo|solo para mi|uso personal|para mi uso)\b/, "A"),
  },
  {
    id: "proposito", step: "producto", topic: "PARA QUIÉN",
    applies: (c) => c.kind !== "api",
    text: () => "¿Para quién es el proyecto?",
    options: () => opts(["A", "Para tu propio negocio o uso"], ["B", "Para un cliente tuyo (se lo entregarás)"], ["C", "Para venderlo como producto"]),
    recommend: (c) => c.eff("usuarios") === "C" || c.kind === "saas"
      ? { option: "C", reason: "lo preparo para venderlo: marca propia, planes y manual para tus clientes." }
      : { option: "A", reason: "así queda listo para usarlo desde el primer día, sin pasos de entrega." },
    known: (c) => saidBy(c, /\b(para un cliente|para una clienta|mi cliente quiere|encargo de un cliente)\b/, "B")
      ?? saidBy(c, /\b(para vender(?:lo)?|venderlo|comercializar(?:lo)?)\b/, "C")
      ?? saidBy(c, /\b(mi negocio|mi empresa|mi tienda|mi peluqueria|mi clinica|mi consulta|mi restaurante|mi bar|mi gimnasio|mi academia|mi taller|mi inmobiliaria|mi hotel)\b/, "A"),
  },
  {
    id: "nivel", step: "producto", topic: "ALCANCE",
    applies: () => true,
    text: () => "¿Con qué nivel empezamos?",
    options: () => opts(["A", "MVP: lo mínimo para probar la idea"], ["B", "Profesional: listo para usar con clientes reales"], ["C", "Completo y preparado para crecer desde el principio"]),
    recommend: () => ({ option: "B", reason: "tendrás algo usable desde el primer día sin pagar el coste de construirlo todo a la vez; lo que falte se añade después sin rehacer nada." }),
    known: (c) => saidBy(c, /\b(mvp|prototipo|demo|maqueta|probar la idea|version minima|version basica)\b/, "A") ?? saidBy(c, /\b(completo|completa|escalable|a lo grande|todo incluido)\b/, "C"),
  },
  // ------------------------------------------------------------------ 2. DÓNDE FUNCIONA Y QUIÉN ENTRA
  {
    id: "plataforma", step: "plataforma", topic: "PLATAFORMAS",
    applies: (c) => c.kind !== "api",
    text: () => "¿Dónde quieres que funcione?",
    options: () => opts(["A", "Web: en el navegador del ordenador y del móvil"], ["B", "Web + instalable en el móvil como una app (PWA)"], ["C", "Web + apps nativas para Android e iOS"], ["D", "Programa de escritorio para Windows"]),
    recommend: (c) => {
      if (c.kind === "escritorio") return { option: "D", reason: "lo quieres para usar en el ordenador: WILLY lo empaqueta con su propio instalador de Windows." };
      if (c.kind === "web" || c.kind === "tienda" || c.kind === "herramienta") return { option: "A", reason: "una web funciona en cualquier ordenador y móvil sin instalar nada." };
      return { option: "B", reason: "se usa en el móvil como una app, sin pasar por las tiendas de apps ni pagar sus cuotas; si un día hace falta la nativa, se hace sobre la misma base." };
    },
    known: (c) => saidBy(c, /\b(android|iphone|ios|app store|google play|app nativa|aplicacion nativa)\b/, "C")
      ?? saidBy(c, /\b(windows|escritorio|programa (?:de|para el) (?:pc|ordenador)|instalable en (?:el |mi )?(?:pc|ordenador))\b/, "D")
      ?? saidBy(c, /\bpwa\b/, "B")
      ?? (c.kind === "web" ? { option: "A" as const, because: "es una web" } : null),
  },
  {
    id: "acceso", step: "plataforma", topic: "ACCESO",
    applies: (c) => c.kind !== "api" && c.kind !== "herramienta",
    text: (c) => (c.kind === "web" ? "¿Necesita una zona privada con cuentas?" : "¿Cómo entrarán los usuarios?"),
    options: (c) => {
      if (c.kind === "escritorio") return opts(["A", "Sin cuentas: se abre y se usa"], ["B", "Con usuario y contraseña"]);
      if (c.kind === "web") return opts(["A", "No: la web es pública"], ["B", "Sí: zona privada con email y contraseña"], ["C", "Sí: zona privada con email o con Google"]);
      return opts(["A", "Sin cuentas"], ["B", "Email y contraseña"], ["C", "Email y contraseña, o con Google"]);
    },
    recommend: (c) => {
      if (c.kind === "escritorio") return c.eff("usuarios") === "A"
        ? { option: "A", reason: "un programa para ti solo no necesita usuario ni contraseña; los datos se quedan en tu PC." }
        : { option: "B", reason: "si lo usan varias personas, cada una entra con lo suyo y queda registrado quién hizo qué." };
      if (c.kind === "web") return c.eff("reservas") === "B"
        ? { option: "C", reason: "para reservar conviene que el cliente tenga cuenta (ve y cambia sus citas); con Google entra en un clic." }
        : { option: "A", reason: "una web de presentación no necesita cuentas: los clientes te contactan sin registrarse." };
      if (c.eff("usuarios") === "A") return { option: "B", reason: "para un equipo interno basta email y contraseña, con recuperación de contraseña incluida." };
      return { option: "C", reason: "entrar con Google ahorra a tus clientes crear otra contraseña (menos abandonos); quien prefiera, usa email y contraseña." };
    },
    known: (c) => saidBy(c, /\b(sin registro|sin login|sin cuentas|sin usuarios)\b/, "A")
      ?? (c.kind !== "escritorio" ? saidBy(c, /\b(google)\b/, "C") : null)
      ?? saidBy(c, /\b(login|registro de usuarios|con usuarios|usuario y contrasena|iniciar sesion|zona privada|area privada|area de clientes)\b/, "B"),
  },
  {
    id: "roles", step: "plataforma", topic: "ROLES",
    applies: (c) => c.kind !== "api" && c.kind !== "herramienta" && c.eff("acceso") !== "A" && c.eff("acceso") !== null,
    text: () => "¿Hacen falta distintos tipos de usuario?",
    options: () => opts(["A", "No: todos pueden hacer lo mismo"], ["B", "Administrador y usuarios"], ["C", "Varios roles (por ejemplo: administrador, empleado y cliente)"]),
    recommend: (c) => ["B", "C"].includes(c.eff("usuarios") ?? "") || c.kind === "web" || c.kind === "tienda"
      ? { option: "C", reason: "cada persona ve y hace solo lo suyo: el cliente no ve la gestión del negocio ni los datos de otros." }
      : { option: "B", reason: "el administrador controla la configuración y los usuarios; el resto trabaja sin poder romper nada." },
    known: (c) => saidBy(c, /\b(roles|empleados y clientes|permisos distintos)\b/, "C"),
  },
  {
    id: "estructura", step: "plataforma", topic: "ESTRUCTURA",
    applies: () => true,
    text: () => "¿Cómo quieres el proyecto por dentro?",
    options: () => opts(["A", "Un único archivo (ideal para demos y utilidades pequeñas)"], ["B", "Sencillo, con pocos archivos"], ["C", "Profesional y modular (recomendado para producción)"], ["D", "Que decida WILLY"]),
    recommend: (c) => {
      if (c.kind === "herramienta" && c.eff("nivel") === "A") return { option: "A", reason: "para una utilidad pequeña, un solo archivo se abre con doble clic y se lleva a cualquier sitio." };
      if (isStaticWeb(c)) return { option: "B", reason: "una web sencilla no necesita más: es fácil de subir a cualquier alojamiento y de mantener." };
      return { option: "C", reason: "se mantiene mejor, se amplía sin rehacerlo y cada parte se prueba por separado." };
    },
    known: (c) => saidBy(c, /\b(un (?:solo|unico) archivo|archivo unico|un (?:unico|solo) html|single file)\b/, "A") ?? saidBy(c, /\b(modular|arquitectura profesional)\b/, "C"),
  },
  // ------------------------------------------------------------------ 4. EL DISEÑO
  {
    id: "marca", step: "diseno", topic: "MARCA",
    applies: (c) => c.kind !== "api",
    text: () => "¿Tienes ya marca (logo y colores)?",
    options: () => opts(["A", "Sí: usaré mi logo y mis colores"], ["B", "No: que WILLY me proponga una"], ["C", "Tengo logo, pero los colores que los proponga WILLY"]),
    recommend: () => ({ option: "B", reason: "WILLY propone colores y tipografía coherentes con tu sector; siempre podrás cambiarlos." }),
    known: (c) => saidBy(c, /\b(mi logo|nuestro logo|mis colores|colores corporativos|colores de (?:mi|la) marca|tengo logo)\b/, "A"),
  },
  {
    id: "estilo", step: "diseno", topic: "DISEÑO",
    applies: (c) => c.kind !== "api",
    text: () => "¿Qué estilo visual prefieres?",
    options: () => opts(["A", "Minimalista premium: mucho aire y detalles cuidados"], ["B", "SaaS moderno: panel limpio, tarjetas y un color de marca vivo"], ["C", "Editorial profesional: tipografía elegante y fotos grandes"], ["D", "Futurista: oscuro, degradados y acentos luminosos"], ["E", "Enséñame varias propuestas y elijo (o las mezclo)"]),
    recommend: () => ({ option: "E", reason: "verás varias direcciones realmente distintas antes de construir las pantallas definitivas, y podrás quedarte con una o mezclarlas («la estructura de la 1 con los colores de la 3»)." }),
    known: (c) => saidBy(c, /\b(minimalista|minimal)\b/, "A") ?? saidBy(c, /\b(estilo saas|tipo saas)\b/, "B") ?? saidBy(c, /\b(editorial|tipo revista)\b/, "C") ?? saidBy(c, /\b(futurista|neon|modo oscuro)\b/, "D"),
  },
  // ------------------------------------------------------------------ 5. NEGOCIO Y DATOS
  {
    id: "pagos", step: "negocio", topic: "PAGOS",
    applies: (c) => c.kind === "tienda" || c.kind === "saas" || c.eff("objetivo") === "C" || c.eff("usuarios") === "C" || c.eff("reservas") === "B"
      || (Boolean(c.domain?.payments) && c.kind !== "web" && c.kind !== "herramienta" && c.kind !== "api")
      || /\b(pago|pagos|pagar|cobrar|cobro|cobros|precio|precios|suscripcion\w*|tarjeta|stripe|paypal|bizum)\b/.test(c.t),
    text: () => "¿Se cobrará a través de la aplicación?",
    options: (c) => {
      if (c.kind === "tienda" || c.eff("objetivo") === "C") return opts(["A", "No: se paga fuera (transferencia, en tienda…)"], ["C", "Sí: pago completo del pedido con tarjeta"]);
      if (c.kind === "saas" || c.eff("usuarios") === "C") return opts(["A", "No, de momento sin cobros"], ["D", "Suscripciones mensuales por empresa"], ["C", "Pago único por licencia o servicio"]);
      return opts(["A", "No, sin pagos online"], ["B", "Solo una señal al reservar"], ["C", "Pago completo online"], ["D", "Cuotas mensuales"]);
    },
    recommend: (c) => {
      if (c.kind === "tienda" || c.eff("objetivo") === "C") return { option: "C", reason: "una tienda tiene que cobrar el pedido al momento; los datos de la tarjeta los gestiona el proveedor de pagos, no tu web." };
      if (c.kind === "saas" || c.eff("usuarios") === "C") return { option: "D", reason: "un SaaS cobra una suscripción mensual a cada empresa: ingresos recurrentes y sin perseguir a nadie." };
      if (c.domain?.payments === "suscripcion") return { option: "D", reason: "las cuotas mensuales se cobran solas y no tienes que perseguir a nadie." };
      if (c.domain?.bookings) return { option: "B", reason: "una pequeña señal al reservar reduce mucho las citas a las que la gente no se presenta, sin complicar el cobro." };
      if (c.domain?.payments === "completo") return { option: "C", reason: "tus clientes esperan poder pagar online." };
      return { option: "A", reason: "sin pagos es más sencillo y barato; se puede añadir después." };
    },
    known: (c) => saidBy(c, /\b(sin pagos|sin cobros)\b/, "A") ?? saidBy(c, /\b(suscripcion\w*|cuota mensual|mensualidad\w*)\b/, "D") ?? saidBy(c, /\b(senal|deposito)\b/, "B") ?? saidBy(c, /\b(pago online|pagos online|pagar online|cobrar online|pasarela de pago|stripe|paypal|bizum)\b/, "C"),
  },
  {
    id: "avisos", step: "negocio", topic: "AVISOS",
    applies: (c) => c.kind !== "api" && c.kind !== "herramienta" && (c.kind === "web" || c.kind === "tienda" || c.eff("usuarios") === "B" || c.eff("usuarios") === "C" || Boolean(c.domain?.customerFacing)),
    text: () => "¿Qué avisos automáticos quieres?",
    options: (c) => opts(["A", "Ninguno"], ["B", c.kind === "web" ? "Emails (te llega cada formulario y el cliente recibe confirmación)" : "Emails (confirmaciones y recordatorios)"], ["C", "Emails y también WhatsApp o SMS"]),
    recommend: () => ({ option: "B", reason: "el email es gratis o casi gratis; WhatsApp y SMS suelen cobrar por mensaje, mejor dejarlos para cuando hagan falta." }),
    known: (c) => saidBy(c, /\b(whatsapp|sms)\b/, "C") ?? saidBy(c, /\b(recordatorios?|emails? automaticos?|correos? automaticos?)\b/, "B"),
  },
  {
    id: "datos", step: "negocio", topic: "DATOS",
    applies: (c) => c.kind !== "herramienta",
    text: () => "¿Guardará datos personales?",
    options: () => opts(["A", "No, nada personal"], ["B", "Sí, datos normales (nombre, email, teléfono)"], ["C", "Sí, datos sensibles (salud, DNI, menores, datos bancarios)"]),
    recommend: (c) => {
      if (c.domain?.sensitive) return { option: "C", reason: "hay que cifrarlos, limitar quién los ve, registrar los accesos y cumplir el RGPD: lo dejo preparado desde el principio." };
      if (c.eff("acceso") === "B" || c.eff("acceso") === "C" || ["B", "C"].includes(c.eff("usuarios") ?? "") || c.kind === "tienda" || c.kind === "web" || c.eff("avisos") === "B" || c.eff("avisos") === "C")
        return { option: "B", reason: "aunque sean datos normales, aplica el RGPD: aviso de privacidad, consentimiento y poder borrarlos." };
      return { option: "A", reason: "sin datos personales todo es más sencillo." };
    },
    known: (c) => saidBy(c, /\b(pacientes|historial medico|historia clinica|datos de salud|salud mental|dni|menores|ninos|datos bancarios)\b/, "C"),
  },
  {
    id: "idiomas", step: "negocio", topic: "IDIOMAS",
    applies: (c) => c.kind !== "api",
    text: () => "¿En qué idiomas?",
    options: () => opts(["A", "Solo español"], ["B", "Español e inglés"], ["C", "Varios idiomas"]),
    recommend: (c) => /\b(turist\w*|internacional\w*|extranjer\w*|ingles|english|guiris)\b/.test(c.t)
      ? { option: "B", reason: "tendrás clientes que no hablan español." }
      : { option: "A", reason: "empezar en un idioma es más rápido; se deja preparado para añadir otros sin rehacer nada." },
    known: (c) => saidBy(c, /\b(multi-?idioma|varios idiomas)\b/, "C") ?? saidBy(c, /\b(ingles y (?:en )?espanol|espanol e ingles|bilingue)\b/, "B") ?? saidBy(c, /\b(solo en espanol|solo espanol)\b/, "A"),
  },
  // ------------------------------------------------------------------ 6. TAMAÑO, COSTE Y ENTREGA
  {
    id: "escala", step: "entrega", topic: "ESCALA",
    applies: (c) => c.kind !== "escritorio" && c.kind !== "herramienta" && !isStaticWeb(c),
    text: () => "¿Para cuántos usuarios lo preparamos al principio?",
    options: () => opts(["A", "Uso personal"], ["B", "Menos de 100"], ["C", "Entre 100 y 1.000"], ["D", "Entre 1.000 y 10.000"], ["E", "Más de 10.000"], ["F", "No lo sé: decide WILLY"]),
    recommend: (c) => {
      const u = c.eff("usuarios");
      if (u === "C" || c.kind === "saas") return { option: "D", reason: "un SaaS suma usuarios de muchas empresas: se prepara para varios miles sin pagar todavía por ellos." };
      if (u === "A") return { option: "B", reason: "para un equipo interno sobra con un servidor pequeño; el código queda listo para crecer." };
      return { option: "C", reason: "se prepara para ese tamaño sin pagar desde el principio servidores que no hacen falta; el código queda listo para crecer." };
    },
    known: (c) => saidBy(c, /\b(uso personal|solo para mi)\b/, "A"),
  },
  {
    id: "presupuesto", step: "entrega", topic: "COSTES",
    applies: (c) => c.kind !== "herramienta" && c.kind !== "escritorio",
    text: () => "¿Qué priorizamos en costes?",
    options: () => opts(["A", "Mínimo coste"], ["B", "Equilibrio entre coste y rendimiento"], ["C", "Máximo rendimiento"]),
    recommend: (c) => (c.eff("usuarios") === "A" || c.eff("escala") === "A" || c.eff("escala") === "B" || isStaticWeb(c))
      ? { option: "A", reason: "con pocos usuarios no merece la pena pagar más: un servidor pequeño (o un alojamiento gratuito) va sobrado." }
      : { option: "B", reason: "empezar pequeño y crecer cuando los números lo pidan, sin quedarse corto el primer día." },
    known: (c) => saidBy(c, /\b(barato|minimo coste|sin gastar|coste cero|low cost|lo mas economico)\b/, "A") ?? saidBy(c, /\b(maximo rendimiento|sin limite de presupuesto)\b/, "C"),
  },
  {
    id: "entrega", step: "entrega", topic: "ENTREGA",
    applies: () => true,
    text: () => "¿Cómo quieres recibirlo?",
    options: (c) => {
      if (c.kind === "escritorio" || c.eff("plataforma") === "D") return opts(["C", "Programa con instalador para Windows"], ["A", "El código fuente completo"]);
      if (isStaticWeb(c)) return opts(["E", "Web lista para subir a cualquier alojamiento"], ["A", "El código fuente completo"], ["B", "Lista para mi servidor, con instrucciones paso a paso"]);
      return opts(["B", "Listo para subir a un servidor, con instrucciones paso a paso"], ["A", "El código fuente completo"], ["D", "Todo: código, instrucciones de servidor y Docker"]);
    },
    recommend: (c) => {
      if (c.kind === "escritorio" || c.eff("plataforma") === "D") return { option: "C", reason: "te llega un instalador normal de Windows: doble clic y listo." };
      if (isStaticWeb(c)) return { option: "E", reason: "se sube tal cual a cualquier alojamiento de webs (los hay gratuitos)." };
      return { option: "B", reason: "recibes el proyecto completo y cómo publicarlo paso a paso, sin depender de nadie." };
    },
    known: (c) => saidBy(c, /\b(instalador|\.exe)\b/, "C") ?? saidBy(c, /\bdocker\b/, "D") ?? saidBy(c, /\b(solo el codigo|codigo fuente)\b/, "A"),
  },
];

const QUESTION_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

// ------------------------------------------------------------------------------------------------ estado y respuestas
function ctxOf(state: Pick<DiscoveryState, "idea" | "kind" | "domain" | "answers">): Ctx {
  const t = norm(state.idea);
  const domain = domainById(state.domain);
  const memo = new Map<string, OptionId | null>();
  const visiting = new Set<string>();
  const ctx: Ctx = {
    t,
    kind: state.kind,
    domain,
    eff: (id) => {
      if (memo.has(id)) return memo.get(id)!;
      const def = QUESTION_BY_ID.get(id);
      if (!def || visiting.has(id)) return null;
      visiting.add(id);
      let value: OptionId | null = null;
      if (def.applies(ctx)) {
        const valid = def.options(ctx).map((o) => o.id);
        const own = state.answers[id];
        const known = def.known?.(ctx) ?? null;
        const rec = def.recommend(ctx).option;
        value = own && valid.includes(own) ? own : known && valid.includes(known.option) ? known.option : valid.includes(rec) ? rec : valid[0] ?? null;
      }
      visiting.delete(id);
      memo.set(id, value);
      return value;
    },
  };
  return ctx;
}

/** Las preguntas de un paso que tienen sentido para ESTE proyecto (con su recomendación y lo que ya dijo el dueño). */
export function questionsFor(state: DiscoveryState, step: StepId): DiscoveryQuestion[] {
  const c = ctxOf(state);
  return QUESTIONS.filter((q) => q.step === step && q.applies(c)).map((q) => {
    const options = q.options(c);
    const valid = options.map((o) => o.id);
    const rec = q.recommend(c);
    const known = q.known?.(c) ?? null;
    return {
      id: q.id,
      step: q.step,
      topic: q.topic,
      text: q.text(c),
      options,
      recommended: valid.includes(rec.option) ? rec.option : valid[0]!,
      reason: rec.reason,
      known: known && valid.includes(known.option) ? known : null,
    };
  });
}

const LETTERS = "ABCDEF";

/**
 * La letra que VE el dueño para una opción. Por dentro cada opción tiene un id fijo (C = instalador, D = suscripciones…), pero
 * como cada proyecto enseña solo las opciones que le sirven, en pantalla van siempre seguidas: A, B, C…
 */
export function letterOf(q: DiscoveryQuestion, id: OptionId | null): string {
  if (!id) return "?";
  const at = q.options.findIndex((o) => o.id === id);
  return at >= 0 ? LETTERS[at]! : "?";
}

/** De la letra que escribe o pulsa el dueño a la opción de verdad (null si esa letra no existe en esta pregunta). */
export function optionOfLetter(q: DiscoveryQuestion, letter: string): OptionId | null {
  const at = LETTERS.indexOf(letter.toUpperCase());
  return at >= 0 ? q.options[at]?.id ?? null : null;
}

/** La respuesta que vale ahora para una pregunta: la elegida o la que ya dijo el dueño en su idea (null = sin responder). */
export function answerOf(state: DiscoveryState, q: DiscoveryQuestion): OptionId | null {
  const own = state.answers[q.id];
  if (own && q.options.some((o) => o.id === own)) return own;
  return q.known?.option ?? null;
}

/** Respuesta efectiva de cualquier pregunta (la del dueño, la de su idea o, si no la hay, la recomendada). */
export function effectiveAnswer(state: DiscoveryState, id: string): OptionId | null {
  return ctxOf(state).eff(id);
}

const labelOf = (state: DiscoveryState, id: string): string | null => {
  const q = questionsFor(state, QUESTION_BY_ID.get(id)?.step ?? "producto").find((x) => x.id === id);
  if (!q) return null;
  const a = answerOf(state, q) ?? (state.stage !== "entrevista" || state.mode === "auto" ? q.recommended : null);
  if (!a) return null;
  if (id === "estructura" && a === "D") return `Decide WILLY: ${q.options.find((o) => o.id === q.recommended)?.label ?? ""}`;
  if (id === "escala" && a === "F") return `Decide WILLY: ${q.options.find((o) => o.id === q.recommended && o.id !== "F")?.label ?? "entre 100 y 1.000"}`;
  return q.options.find((o) => o.id === a)?.label ?? null;
};

const QUESTION_STEPS: StepId[] = ["producto", "plataforma", "diseno", "negocio", "entrega"];

export function stepHasContent(state: DiscoveryState, step: StepId): boolean {
  if (step === "funciones" || step === "resumen") return true;
  return questionsFor(state, step).length > 0;
}

/** Los pasos que tiene ESTA entrevista (los que se quedan sin preguntas, no salen). */
export function stepsOf(state: DiscoveryState): StepId[] {
  const order: StepId[] = ["producto", "plataforma", "funciones", "diseno", "negocio", "entrega", "resumen"];
  return order.filter((s) => stepHasContent(state, s));
}

export function stepComplete(state: DiscoveryState, step: StepId): boolean {
  if (step === "resumen") return true;
  if (step === "funciones") return state.featureChoice !== null;
  return questionsFor(state, step).every((q) => answerOf(state, q) !== null);
}

export function startDiscovery(idea: string, mode: DecisionMode = "guiado", now = Date.now()): DiscoveryState {
  const clean = idea.trim();
  const domain = domainOf(clean);
  const base: DiscoveryState = {
    version: 1,
    idea: clean,
    name: projectNameOf(clean),
    kind: kindOf(clean),
    domain: domain?.id ?? null,
    mode,
    stage: "entrevista",
    step: "producto",
    answers: {},
    featureChoice: null,
    toggles: {},
    custom: [],
    notes: [],
    startedAt: now,
    updatedAt: now,
  };
  const first = stepsOf(base)[0] ?? "funciones";
  const started = { ...base, step: first };
  return mode === "auto" ? applyAllRecommendations(started) : started;
}

const touch = (state: DiscoveryState): DiscoveryState => ({ ...state, updatedAt: Date.now() });

export function choose(state: DiscoveryState, questionId: string, option: OptionId): DiscoveryState {
  return touch({ ...state, answers: { ...state.answers, [questionId]: option } });
}

/** Aplica la recomendación de WILLY a las preguntas SIN responder de un paso. */
export function applyRecommendations(state: DiscoveryState, step: StepId): DiscoveryState {
  if (step === "funciones") return touch({ ...state, featureChoice: state.featureChoice ?? "B" });
  let next = state;
  // Una a una y en orden: la recomendación de una puede depender de lo elegido en la anterior.
  for (;;) {
    const pending = questionsFor(next, step).find((q) => answerOf(next, q) === null);
    if (!pending) break;
    next = { ...next, answers: { ...next.answers, [pending.id]: pending.recommended } };
  }
  return touch(next);
}

/** «Usar todas las recomendaciones de WILLY»: responde lo pendiente con lo recomendado y va al resumen (sin construir nada). */
export function applyAllRecommendations(state: DiscoveryState): DiscoveryState {
  let next = state;
  for (const step of [...QUESTION_STEPS, "funciones" as StepId]) next = applyRecommendations(next, step);
  return touch({ ...next, step: "resumen" });
}

/** El primer paso que tiene alguna pregunta sin responder (p. ej. una que aparece al cambiar una respuesta anterior). */
export function firstIncomplete(state: DiscoveryState): StepId | null {
  return stepsOf(state).find((s) => s !== "resumen" && !stepComplete(state, s)) ?? null;
}

/** Siguiente paso con contenido; si el actual no está completo, se queda donde está. Antes del resumen, vuelve a lo que falte. */
export function advance(state: DiscoveryState): DiscoveryState {
  if (!stepComplete(state, state.step)) return state;
  const steps = stepsOf(state);
  const at = steps.indexOf(state.step);
  let next: StepId = steps[at + 1] ?? "resumen";
  if (next === "resumen") next = firstIncomplete(state) ?? "resumen";
  return touch({ ...state, step: next });
}

export function goTo(state: DiscoveryState, step: StepId): DiscoveryState {
  return touch({ ...state, step, stage: "entrevista" });
}

export function setMode(state: DiscoveryState, mode: DecisionMode): DiscoveryState {
  const next = touch({ ...state, mode });
  return mode === "auto" && state.stage === "entrevista" ? applyAllRecommendations(next) : next;
}

/** Posición del paso actual para la barra de avance («Paso 2 de 6»). */
export function progressOf(state: DiscoveryState): { index: number; total: number; title: string } {
  const steps = stepsOf(state);
  const at = Math.max(0, steps.indexOf(state.step));
  return { index: at + 1, total: steps.length, title: STEP_TITLES[state.step] };
}

export const STEP_TITLES: Record<StepId, string> = {
  producto: "El producto",
  plataforma: "Dónde funciona y quién entra",
  funciones: "Funciones",
  diseno: "El diseño",
  negocio: "Negocio y datos",
  entrega: "Tamaño, coste y entrega",
  resumen: "Esto es lo que vamos a construir",
};

// ------------------------------------------------------------------------------------------------ respuestas escritas
const REC_PHRASE = /\b(?:haz lo que recomiendas|lo que recomiendes|lo que recomiendas|lo recomendado|las recomendadas|tus recomendaciones|usa (?:tus|las) recomendaciones|como recomiendas|lo que digas|decide tu|como veas|recomendado|recomendadas|de acuerdo con todo|vale a todo|si a todo|todo bien)\b/;

export type ParsedAnswers = { answers: Record<string, OptionId>; useRecommended: boolean; invalid: string[]; rest: string };

/**
 * Lee lo que escribe el dueño para las preguntas de un bloque: «1C, 2B, 3B», «1-c 2:b», «C B B», «haz lo que recomiendas».
 * Devuelve también lo que sobra (por si añade algo: «B, pero añade fidelización»).
 */
export function parseAnswers(text: string, questions: DiscoveryQuestion[]): ParsedAnswers {
  const t = norm(text);
  const answers: Record<string, OptionId> = {};
  const invalid: string[] = [];
  let rest = t;
  const useRecommended = REC_PHRASE.test(t);
  if (useRecommended) rest = rest.replace(REC_PHRASE, " ");
  const pairRe = /\b(\d{1,2})\s*[-:.)=]?\s*([a-f])\b/g;
  let found = false;
  const take = (q: DiscoveryQuestion | undefined, n: number, letter: string) => {
    const option = q ? optionOfLetter(q, letter) : null;
    if (q && option) answers[q.id] = option;
    else invalid.push(`${n}${letter.toUpperCase()}`);
  };
  for (const m of t.matchAll(pairRe)) {
    found = true;
    take(questions[Number(m[1]) - 1], Number(m[1]), m[2]!);
    rest = rest.replace(m[0], " ");
  }
  if (!found) {
    // Solo letras («C B B», «cbb», «b»): en orden.
    const lettersOnly = t.replace(/[\s,;.·/-]+/g, " ").trim();
    if (/^(?:[a-f](?:\s+|$))+$/.test(`${lettersOnly} `) || /^[a-f]{2,6}$/.test(lettersOnly.replace(/\s/g, ""))) {
      const letters = lettersOnly.replace(/\s/g, "").split("");
      if (letters.length <= questions.length) {
        letters.forEach((letter, i) => take(questions[i], i + 1, letter));
        rest = "";
      }
    } else {
      // Una sola letra al principio («B, pero añade fidelización») cuando hay una sola pregunta. Tiene que ir sola («b,»,
      // «b.», «b pero…»): «a mí me gustaría…» NO es la opción A.
      const lead = /^\s*([a-f])(?:\s*[,.;:)]+\s*|\s+(?=(?:pero|y|mas|con|sin)\b)|\s*$)/.exec(t);
      if (lead && questions.length === 1) {
        take(questions[0], 1, lead[1]!);
        rest = t.slice(lead[0].length);
      }
    }
  }
  return { answers, useRecommended, invalid, rest: rest.replace(/\s+/g, " ").trim() };
}

const ADD_RE = /(?:^|[\s,.;])(?:(?:pero|y|tambien|ademas)\s+)*(?:anade|anadir|anademe|anadele|agrega|agregar|agregale|incluye|incluir|incluyele|mete|metele|pon|ponle|quiero tambien|tambien quiero|el cliente (?:tambien )?quiere|la clienta (?:tambien )?quiere|el cliente (?:tambien )?pide|necesito(?: tambien)?|que (?:tambien )?tenga|quiero que tenga|quiero)\s+(.+)$/;

/** Recupera las tildes de un trozo sacado del texto normalizado («fidelizacion» → «fidelización»). */
function withAccents(piece: string, original: string): string {
  const n = norm(original);
  const at = n.indexOf(piece);
  return at >= 0 && n.length === original.length ? original.slice(at, at + piece.length) : piece;
}

/**
 * Funciones o requisitos que el dueño añade escribiendo («pero añade fidelización y códigos descuento»). `original` es el
 * texto tal cual lo escribió (para devolver las palabras con sus tildes aunque `text` ya venga normalizado).
 */
export function extractAdditions(text: string, original: string = text): string[] {
  const t = norm(text).trim();
  const m = ADD_RE.exec(t);
  if (!m) return [];
  return m[1]!
    .split(/\s*(?:,|;|\by\b|\be\b|\bademas de\b|\+)\s*/)
    .map((s) => s.replace(/^(?:(?:un|una|unos|unas|el|la|los|las|de|del|tambien|que)\s+)+/g, "").replace(/[.!?¡¿]+$/g, "").trim())
    .filter((s) => s.length >= 3 && s.length <= 80 && !/^(?:nada|todo|eso|esto|mas)$/.test(s))
    .map((s) => cap(withAccents(s, original.trim())))
    .slice(0, 8);
}

// ------------------------------------------------------------------------------------------------ nombre del proyecto
const REQUEST_HEAD = new RegExp(`^.*?\\b(?:${PRODUCT})\\b`);
const LEAD_WORDS = /^(?:(?:para|de|del|con|sobre|que|a|al|una?|unos|unas|el|la|los|las|mi|mis|nuestra?|nuestros|su|sus|gestionar|gestione|controlar|controle|llevar|lleve|organizar|organice|vender|venda|reservar|el control de)\s+)+/;
const KIND_SHORT: Record<ProjectKind, string> = { saas: "SaaS", tienda: "Tienda online", web: "Web", app: "App", escritorio: "Programa", api: "API", herramienta: "Herramienta" };

const PLATFORM_WORDS = /^(?:(?:online|web|movil|moviles|android|ios|iphone|windows|pc|ordenador|escritorio|para windows|para el movil|para movil|para android)\s+)+/;
const MANAGE_TAIL = /\b(?:para gestionar|que gestione|para controlar|que controle|para llevar el control de|para organizar)\s+(.+)$/;

/** Quita del principio lo que no es nombre («para mi», «online de», «que gestione el»…), de forma repetida. */
function stripLead(original: string): string {
  let text = original.trim();
  for (let i = 0; i < 4; i++) {
    const n = norm(text);
    const m = LEAD_WORDS.exec(n) ?? PLATFORM_WORDS.exec(n);
    if (!m || n.length !== text.length) break;
    text = text.slice(m[0].length).trim();
  }
  return text;
}

/** Hasta 5 palabras, cortando en lo que ya son funciones («ropa con pagos» → «ropa»). */
function nounPhrase(text: string): string {
  const words = text.replace(/[,;:«»"“”()]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const cut = words.findIndex((w, i) => i > 0 && /^(?:con|que|y|e|donde|para que|sin)$/i.test(norm(w)));
  return (cut > 0 ? words.slice(0, cut) : words).slice(0, 5).join(" ").replace(/\s+(?:y|e|o|con|de|del|para|que|la|el|los|las|mi)$/i, "");
}

/** Nombre corto y reconocible a partir de la idea («Quiero una app para mi peluquería» → «App de peluquería»). */
export function projectNameOf(idea: string, kind: ProjectKind = kindOf(idea)): string {
  const firstLine = (idea.trim().split(/[\n.!?]/).find((s) => s.trim()) ?? idea).trim();
  const n = norm(firstLine);
  const fit = (name: string) => (name.length > 48 ? `${name.slice(0, 47).trimEnd()}…` : name);
  if (n.length === firstLine.length) {
    const manage = MANAGE_TAIL.exec(n);
    if (manage && !REQUEST_HEAD.test(n.slice(0, manage.index))) {
      const what = nounPhrase(stripLead(firstLine.slice(manage.index + manage[0].length - manage[1]!.length)));
      if (what.length >= 3) return fit(`Gestión de ${what}`);
    }
    const head = REQUEST_HEAD.exec(n);
    if (head) {
      const what = nounPhrase(stripLead(firstLine.slice(head[0].length)));
      if (what.length >= 3) return fit(what.split(" ").length >= 3 ? cap(what) : `${KIND_SHORT[kind]} de ${what}`);
    }
  }
  return suggestName(idea);
}

export function rename(state: DiscoveryState, name: string): DiscoveryState {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  return clean ? touch({ ...state, name: clean }) : state;
}

/** Palabras con peso de una función («Bonos y programa de fidelización» → fidelizacion, programa, bonos). */
const keyWords = (label: string) => norm(label).split(/[^a-z0-9]+/).filter((w) => w.length >= 5).map((w) => w.replace(/(?:es|s)$/, ""));

/** ¿Lo que pide el dueño es una función que ya estaba en la lista con otras palabras? */
function sameFeature(a: string, b: string): boolean {
  const x = keyWords(a);
  const y = new Set(keyWords(b));
  return x.length > 0 && x.every((w) => y.has(w));
}

// ------------------------------------------------------------------------------------------------ funciones del proyecto
const KIND_PLAYBOOK: Partial<Record<ProjectKind, string>> = { tienda: "tienda", saas: "saas", web: "web", app: "app" };
const KIND_CATALOG: Partial<Record<ProjectKind, Catalog>> = {
  escritorio: {
    imprescindible: ["Ventana principal con las funciones clave", "Datos guardados en el propio equipo", "Instalador para Windows", "Ajustes del programa"],
    recomendada: ["Copias de seguridad de los datos", "Exportar e importar datos", "Aviso de nuevas versiones"],
    opcional: ["Modo oscuro", "Varios idiomas"],
    futura: ["Sincronización entre ordenadores", "Versión web"],
  },
  api: {
    imprescindible: ["Rutas documentadas", "Validación de todos los datos de entrada", "Acceso con claves o tokens", "Pruebas automáticas"],
    recomendada: ["Límite de peticiones", "Registro de errores", "Documentación interactiva (OpenAPI)"],
    opcional: ["Avisos a otros sistemas (webhooks)", "Panel de uso"],
    futura: ["Librerías para clientes (SDK)"],
  },
  herramienta: {
    imprescindible: ["La función principal, completa y funcionando", "Pantalla sencilla y clara", "Mensajes de error comprensibles"],
    recomendada: ["Guardar los resultados", "Exportar los resultados"],
    opcional: ["Historial", "Modo oscuro"],
    futura: ["Versión para el móvil"],
  },
};

function catalogOf(state: DiscoveryState, c: Ctx): Catalog {
  const domain = c.domain;
  const webBookings = state.kind === "web" && c.eff("reservas") === "B";
  if (domain && (state.kind !== "web" || webBookings)) return domain.features;
  const own = KIND_CATALOG[state.kind];
  if (own) return own;
  const pb = PLAYBOOKS.find((p) => p.id === (KIND_PLAYBOOK[state.kind] ?? "app"));
  if (!pb) return { imprescindible: [], recomendada: [], opcional: [], futura: [] };
  return { imprescindible: pb.must, recomendada: pb.ask.slice(0, 3), opcional: pb.ask.slice(3), futura: [] };
}

/** Funciones que salen de las decisiones (acceso, pagos, datos…): lo que el dueño puede necesitar aunque no lo sepa. */
function derivedFeatures(state: DiscoveryState, c: Ctx): Array<[FeatureTier, string]> {
  const out: Array<[FeatureTier, string]> = [];
  const a = (id: string) => {
    const q = questionsFor(state, QUESTION_BY_ID.get(id)?.step ?? "producto").find((x) => x.id === id);
    return q ? answerOf(state, q) ?? (state.mode === "auto" || state.stage !== "entrevista" ? q.recommended : null) : null;
  };
  if (state.kind === "web" && a("reservas") !== "B" && c.domain?.bookings) out.push(["imprescindible", a("reservas") === "C" ? "Enlace a tu app de reservas en cada página" : "Botón de pedir cita (llamada o WhatsApp) en cada página"]);
  if (state.kind === "web" && a("objetivo") === "B") out.push(["imprescindible", "Botones de llamar, WhatsApp y formulario siempre a mano"]);
  if (state.kind === "web" && a("objetivo") === "D") out.push(["imprescindible", "Blog o noticias con categorías"]);
  if (state.kind === "web" && a("objetivo") === "C") PLAYBOOKS.find((p) => p.id === "tienda")?.must.slice(0, 5).forEach((m) => out.push(["imprescindible", m]));
  const acceso = a("acceso");
  if (acceso === "B" || acceso === "C") out.push(["imprescindible", "Registro, inicio de sesión y recuperación de contraseña"]);
  if (acceso === "C") out.push(["imprescindible", "Entrar con Google"]);
  const roles = a("roles");
  if (roles === "B") out.push(["imprescindible", "Administrador y usuarios con permisos distintos"]);
  if (roles === "C") out.push(["imprescindible", "Roles y permisos (administrador, empleado, cliente…)"]);
  if (a("usuarios") === "C") {
    out.push(["imprescindible", "Varias empresas, cada una con sus datos separados (multiempresa)"]);
    out.push(["recomendada", "Cada empresa con su logo y sus colores"]);
  }
  const pagos = a("pagos");
  if (pagos === "B") out.push(["imprescindible", "Pago de señal con tarjeta al reservar"]);
  if (pagos === "C") out.push(["imprescindible", "Pagos online con tarjeta (Stripe o similar)"]);
  if (pagos === "D") out.push(["imprescindible", "Planes y suscripciones mensuales"]);
  if (pagos && pagos !== "A") out.push(["recomendada", "Facturas o recibos en PDF"]);
  const avisos = a("avisos");
  if (avisos === "B" || avisos === "C") out.push(["imprescindible", state.kind === "web" ? "Email con cada formulario y confirmación al cliente" : "Emails automáticos (confirmaciones y recordatorios)"]);
  if (avisos === "C") out.push(["imprescindible", "Avisos por WhatsApp o SMS"]);
  const datos = a("datos");
  if (datos === "B" || datos === "C") out.push(["imprescindible", "Privacidad y RGPD (consentimiento, aviso legal y derecho a borrar los datos)"]);
  if (datos === "C") out.push(["imprescindible", "Datos sensibles cifrados y registro de accesos"]);
  const plataforma = a("plataforma");
  if (plataforma === "B") out.push(["imprescindible", "Instalable en el móvil (PWA)"]);
  if (plataforma === "C") out.push(["imprescindible", "Apps para Android e iOS"]);
  if (plataforma === "D" && state.kind !== "escritorio") out.push(["imprescindible", "Instalador para Windows"]);
  const idiomas = a("idiomas");
  if (idiomas === "B" || idiomas === "C") out.push(["imprescindible", idiomas === "B" ? "Español e inglés" : "Varios idiomas"]);
  if (state.kind !== "api" && state.kind !== "escritorio" && state.kind !== "herramienta") out.push(["imprescindible", "Diseño adaptado a móvil, tableta y ordenador"]);
  if (state.kind === "web" || state.kind === "tienda" || a("usuarios") === "B" || a("usuarios") === "C") out.push(["recomendada", "Aviso legal, privacidad y cookies"]);
  if (state.kind !== "web" && state.kind !== "herramienta" && state.kind !== "api") out.push(["recomendada", "Copias de seguridad automáticas"]);
  return out;
}

const DEFAULT_ON: Record<FeatureTier, (choice: OptionId | null) => boolean> = {
  imprescindible: () => true,
  recomendada: (choice) => choice === null || choice === "B" || choice === "C" || choice === "D",
  opcional: (choice) => choice === "C",
  futura: () => false,
};

/** Todas las funciones del proyecto con si van incluidas o no (las futuras nunca se construyen ahora). */
export function featuresOf(state: DiscoveryState): Feature[] {
  const c = ctxOf(state);
  const list: Feature[] = [];
  const seen = new Set<string>();
  const add = (tier: FeatureTier, label: string, source: Feature["source"]) => {
    const id = slug(label);
    if (seen.has(id)) return;
    seen.add(id);
    const byDefault = source === "dueño" ? true : source === "ia" ? false : DEFAULT_ON[tier](state.featureChoice);
    const toggled = state.toggles[id];
    list.push({ id, label, tier, source, on: tier === "futura" ? false : toggled ?? byDefault });
  };
  // Primero lo que añadió el dueño: si coincide con una de WILLY (p. ej. una «futura» que quiere ya), manda la suya.
  for (const f of state.custom) add(f.tier, f.label, f.source);
  const cat = catalogOf(state, c);
  for (const tier of ["imprescindible", "recomendada", "opcional", "futura"] as const) for (const label of cat[tier]) add(tier, label, "willy");
  for (const [tier, label] of derivedFeatures(state, c)) add(tier, label, "willy");
  const order: FeatureTier[] = ["imprescindible", "recomendada", "opcional", "futura"];
  return list.map((f, i) => ({ f, i })).sort((a, b) => order.indexOf(a.f.tier) - order.indexOf(b.f.tier) || a.i - b.i).map(({ f }) => f);
}

export function toggleFeature(state: DiscoveryState, id: string): DiscoveryState {
  const current = featuresOf(state).find((f) => f.id === id);
  if (!current || current.tier === "futura") return state;
  return touch({ ...state, toggles: { ...state.toggles, [id]: !current.on } });
}

/** «A solo imprescindibles · B + recomendadas · C todas · D una por una»: quita lo tocado a mano para que se vea el efecto. */
export function setFeatureChoice(state: DiscoveryState, choice: OptionId): DiscoveryState {
  const own = Object.fromEntries(state.custom.filter((f) => f.source === "dueño").map((f) => [f.id, state.toggles[f.id] ?? true]));
  return touch({ ...state, featureChoice: choice, toggles: choice === "D" ? state.toggles : own });
}

/** Añade una función o requisito del dueño (o del cliente). Si ya existe, simplemente se enciende. */
export function addFeature(state: DiscoveryState, label: string, source: CustomFeature["source"] = "dueño", tier: FeatureTier = "imprescindible"): DiscoveryState {
  const clean = cap(label.replace(/\s+/g, " ").trim().slice(0, 90));
  if (clean.length < 2) return state;
  const id = slug(clean);
  const all = featuresOf(state);
  // «Fidelización» cuando ya estaba «Bonos y programa de fidelización»: se enciende esa en vez de duplicarla.
  const existing = all.find((f) => f.id === id) ?? (source === "dueño" ? all.find((f) => f.source !== "ia" && sameFeature(clean, f.label)) : undefined);
  if (existing && existing.tier === "futura" && source === "dueño") {
    // Una de «para más adelante» que el dueño quiere YA: pasa a imprescindible.
    return touch({ ...state, custom: [...state.custom.filter((f) => f.id !== existing.id), { id: existing.id, label: existing.label, tier: "imprescindible", source }], toggles: { ...state.toggles, [existing.id]: true } });
  }
  if (existing) return source === "dueño" && !existing.on ? touch({ ...state, toggles: { ...state.toggles, [existing.id]: true } }) : state;
  return touch({ ...state, custom: [...state.custom, { id, label: clean, tier, source }] });
}

export const FEATURE_CHOICES: DiscoveryOption[] = [
  { id: "A", label: "Solo las imprescindibles" },
  { id: "B", label: "Imprescindibles + recomendadas" },
  { id: "C", label: "Todas (también las opcionales)" },
  { id: "D", label: "Elegir una por una" },
];

/** Ideas extra cuando no hay IA que las proponga («Recomendarme más»), sin repetir lo que ya está. */
const GENERIC_EXTRAS = [
  "Buscador en toda la aplicación", "Exportar a Excel y PDF", "Estadísticas con gráficas", "Registro de actividad (quién hizo qué)",
  "Importar datos desde Excel", "Modo oscuro", "Ayuda y preguntas frecuentes dentro de la aplicación", "Plantillas de email personalizables",
  "Conexión con Google Calendar", "Accesos directos de teclado", "Encuesta de satisfacción a clientes", "Copias de seguridad descargables",
];

export function moreIdeas(state: DiscoveryState, count = 4): string[] {
  const have = new Set(featuresOf(state).map((f) => f.id));
  return GENERIC_EXTRAS.filter((label) => !have.has(slug(label))).slice(0, count);
}

/** Lee las ideas que devuelve una IA: «- RECOMENDADA | Nombre | motivo» (también acepta viñetas sencillas). */
export function parseFeatureSuggestions(text: string): Array<{ tier: FeatureTier; label: string; why: string }> {
  const out: Array<{ tier: FeatureTier; label: string; why: string }> = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^(?:[\s>*•\-–]+|\d{1,2}[.)]\s*)+/, "").trim();
    // Frases de presentación («Aquí tienes:», «Estas son mis propuestas:») no son funciones.
    if (!line || (/:\s*$/.test(line) && !line.includes("|")) || /^(?:aqui|claro|estas son|te propongo|propuestas|funciones adicionales|por supuesto)\b/.test(norm(line))) continue;
    const parts = line.split(/\s*\|\s*/);
    let tier: FeatureTier = "recomendada";
    let label = "";
    let why = "";
    const head = norm(parts[0] ?? "");
    if (parts.length >= 2 && /^(recomendada|opcional|futura|imprescindible)s?$/.test(head)) {
      tier = head.replace(/s$/, "") as FeatureTier;
      label = parts[1] ?? "";
      why = parts.slice(2).join(" | ");
    } else if (parts.length >= 2) {
      label = parts[0] ?? "";
      why = parts.slice(1).join(" | ");
    } else {
      const m = /^(.{3,80}?)\s*[:—–-]\s+(.+)$/.exec(line);
      label = m ? m[1]! : line;
      why = m ? m[2]! : "";
    }
    label = label.replace(/[*_`"«»]/g, "").replace(/[.:]+$/, "").trim();
    if (label.length < 2 || label.length > 80) continue;
    out.push({ tier: tier === "imprescindible" ? "recomendada" : tier, label: cap(label), why: why.trim().slice(0, 200) });
    if (out.length >= 8) break;
  }
  return out;
}

export function suggestionPrompt(state: DiscoveryState): string {
  const have = featuresOf(state).map((f) => `- ${f.label}`).join("\n");
  return [
    `Proyecto: «${state.name}» (${KIND_LABELS[state.kind]}). Idea del dueño: ${state.idea}`,
    `Funciones que ya tiene previstas:\n${have}`,
    "Propón hasta 6 funciones ADICIONALES que este producto debería tener y que el dueño quizá no ha pensado. Nada que ya esté en la lista.",
    "Responde SOLO con líneas con este formato exacto, sin nada más: `- RECOMENDADA | nombre corto | motivo en una frase` (usa RECOMENDADA, OPCIONAL o FUTURA).",
  ].join("\n\n");
}

// ------------------------------------------------------------------------------------------------ tecnología, arquitectura e infraestructura
export type TechPlan = {
  frontend: string;
  backend: string;
  database: string;
  storage: string;
  access: string;
  extras: string[];
  architecture: string[];
  infrastructure: string[];
  security: string[];
  milestones: string[];
};

/** ¿Hace falta servidor? (Cuentas, reservas, pagos o datos compartidos sí; una web de presentación no.) */
export function needsServer(state: DiscoveryState): boolean {
  if (state.kind === "escritorio" || state.kind === "herramienta") return false;
  const e = (id: string) => effectiveAnswer(state, id);
  if (state.kind === "web") return e("objetivo") === "C" || e("reservas") === "B" || e("acceso") === "B" || e("acceso") === "C" || ["B", "C", "D"].includes(e("pagos") ?? "A");
  return e("estructura") !== "A";
}

export function techOf(state: DiscoveryState): TechPlan {
  const e = (id: string) => effectiveAnswer(state, id);
  const features = featuresOf(state).filter((f) => f.on);
  const has = (re: RegExp) => features.some((f) => re.test(norm(f.label)));
  const server = needsServer(state);
  const single = e("estructura") === "A";
  const extras: string[] = [];
  const scale = e("escala") === "F" ? effectiveAnswerRecommended(state, "escala") : e("escala");
  let frontend = "React + TypeScript (Vite)";
  let backend = "API modular en Node.js + TypeScript";
  let database = ["A", "B"].includes(scale ?? "C") && e("presupuesto") !== "C" ? "SQLite al principio (se pasa a PostgreSQL sin rehacer nada)" : "PostgreSQL";
  let storage = has(/foto|imagen|documento|archivo|video|pdf/) ? "Almacenamiento de archivos compatible con S3 (al principio, una carpeta del servidor)" : "Carpeta del servidor para los archivos que se suban";
  if (state.kind === "escritorio" || e("plataforma") === "D") {
    frontend = "Interfaz local (React + TypeScript) dentro de una ventana del programa";
    backend = "Motor local en Node.js, como el de WILLY";
    database = "SQLite en el propio ordenador";
    storage = "Carpeta de datos del usuario";
    if (e("usuarios") === "B") extras.push("Datos compartidos entre ordenadores: un servidor pequeño (o una carpeta de red) para la base de datos común");
  } else if (single) {
    frontend = "HTML + CSS + JavaScript en un único archivo";
    backend = "Ninguno";
    database = "Los datos se guardan en el propio navegador";
    storage = "—";
  } else if (!server) {
    frontend = "HTML, CSS y JavaScript (o React + Vite si crece)";
    backend = "Ninguno: el formulario usa un servicio de envío de correos";
    database = "Ninguna";
    storage = "Las imágenes van dentro de la web";
  }
  const acceso = e("acceso");
  const access = acceso === "C" ? "Email y contraseña + Google" : acceso === "B" ? "Email y contraseña (con recuperación)" : "Sin cuentas";
  const pagos = e("pagos");
  if (pagos === "B" || pagos === "C") extras.push("Pagos: Stripe o equivalente (comisión por cobro, sin cuota fija); los datos de tarjeta nunca pasan por tu servidor");
  if (pagos === "D") extras.push("Suscripciones: Stripe Billing o equivalente");
  const avisos = e("avisos");
  if (avisos === "B" || avisos === "C") extras.push("Emails: servicio de correo transaccional (los hay con plan gratuito)");
  if (avisos === "C") extras.push("WhatsApp o SMS: proveedor de mensajería (cobra por mensaje)");
  if (e("plataforma") === "B") extras.push("PWA: la misma web, instalable y con funcionamiento básico sin conexión");
  if (e("plataforma") === "C") extras.push("Apps nativas: React Native (Expo) usando la misma API");
  if (e("usuarios") === "C") extras.push("Multiempresa: cada empresa con sus datos separados desde el primer día");
  if (e("idiomas") === "B" || e("idiomas") === "C") extras.push("Textos traducibles (i18n) desde el principio");

  const architecture = state.kind === "escritorio" || e("plataforma") === "D"
    ? ["VENTANA DEL PROGRAMA (interfaz)", "↓", "MOTOR LOCAL (Node.js)", "↓", "BASE DE DATOS LOCAL (SQLite)", "↓", "CARPETA DE DATOS DEL USUARIO"]
    : single || !server
      ? ["NAVEGADOR", "↓", single ? "UN ÚNICO ARCHIVO (HTML + CSS + JS)" : "WEB (HTML, CSS y JavaScript)", ...(server ? [] : ["↓", "FORMULARIO → SERVICIO DE CORREO"])]
      : ["FRONTEND (React)", "↓", "API (Node.js)", "↓", "SERVICIOS (reglas del negocio)", "↓", `BASE DE DATOS (${database.startsWith("SQLite") ? "SQLite → PostgreSQL" : "PostgreSQL"})`, "↓", "ALMACENAMIENTO DE ARCHIVOS", ...(avisos === "B" || avisos === "C" || pagos === "B" || pagos === "C" || pagos === "D" ? ["↓", "TAREAS EN SEGUNDO PLANO (emails, recordatorios, cobros)"] : [])];

  const infrastructure: string[] = [];
  if (state.kind === "escritorio" || e("plataforma") === "D") infrastructure.push("No necesita servidor: se instala en cada ordenador con su instalador.");
  else if (single || !server) infrastructure.push("Alojamiento de webs estáticas (los hay gratuitos), dominio propio y SSL gratuito.");
  else {
    const escala = scale;
    const rich = e("presupuesto") === "C";
    if (escala === "A") infrastructure.push("Tu propio ordenador o el servidor más pequeño: 1 vCPU · 1-2 GB de RAM.");
    else if (escala === "B") infrastructure.push(`Un servidor pequeño (VPS) con todo dentro: ${rich ? "2 vCPU · 4 GB" : "1-2 vCPU · 2-4 GB"} de RAM · 40 GB SSD.`);
    else if (escala === "C") infrastructure.push(`Un servidor (VPS) con todo dentro: 2 vCPU · 4 GB de RAM · 80 GB SSD${rich ? " (o 4 vCPU · 8 GB para ir sobrado)" : ""}.`);
    else if (escala === "D") infrastructure.push("Servidor de 4 vCPU · 8 GB de RAM, la base de datos aparte y almacenamiento de archivos externo.");
    else infrastructure.push("Varios servidores detrás de un balanceador, base de datos gestionada y CDN, cuando las métricas lo pidan (el día 1 basta con un servidor de 4 vCPU · 8 GB).");
    infrastructure.push("Dominio propio y certificado SSL gratuito (Let's Encrypt).");
    infrastructure.push("Copias de seguridad diarias guardadas fuera del servidor.");
  }

  const security: string[] = [];
  if (acceso === "B" || acceso === "C") security.push("Contraseñas cifradas y sesiones seguras");
  if (e("roles") === "B" || e("roles") === "C") security.push("Cada rol ve y hace solo lo suyo (comprobado también en el servidor)");
  security.push("Validación de todos los datos que llegan");
  if (server) security.push("HTTPS en todo", "Copias de seguridad automáticas");
  if (e("datos") === "B" || e("datos") === "C") security.push("RGPD: aviso de privacidad, consentimiento y derecho a borrar");
  if (e("datos") === "C") security.push("Datos sensibles cifrados y registro de quién los consulta");
  if (pagos && pagos !== "A") security.push("Los datos de tarjeta los gestiona el proveedor de pagos, nunca tu servidor");

  const milestones = [
    "Hito 1 · Base: estructura del proyecto, datos y acceso",
    "Hito 2 · Frontend: las pantallas con el diseño elegido",
    ...(server ? ["Hito 3 · Backend: API, reglas del negocio y base de datos"] : []),
    ...(extras.some((x) => /^(Pagos|Suscripciones|Emails|WhatsApp)/.test(x)) ? [`Hito ${server ? 4 : 3} · Integraciones: ${extras.filter((x) => /^(Pagos|Suscripciones|Emails|WhatsApp)/.test(x)).map((x) => x.split(":")[0]!.toLowerCase()).join(", ")}`] : []),
  ];
  milestones.push(`Hito ${milestones.length + 1} · Pruebas: cada función, móvil y seguridad`);
  milestones.push(`Hito ${milestones.length + 1} · Entrega: ${labelOf(state, "entrega") ?? "lo acordado"}`);
  return { frontend, backend, database, storage, access, extras, architecture, infrastructure, security, milestones };
}

function effectiveAnswerRecommended(state: DiscoveryState, id: string): OptionId | null {
  const q = questionsFor(state, QUESTION_BY_ID.get(id)?.step ?? "producto").find((x) => x.id === id);
  return q?.recommended ?? null;
}

// ------------------------------------------------------------------------------------------------ brief vivo y resumen
export type BriefLine = { label: string; value: string };

const STAGE_TEXT = (state: DiscoveryState): string => {
  if (state.stage === "construyendo") return "Construyendo";
  if (state.stage === "construido") return "Construido (puedes seguir pidiendo cambios)";
  if (state.step === "resumen") return "Listo para construir: falta tu visto bueno";
  return `Definiendo: ${STEP_TITLES[state.step].toLowerCase()}`;
};

/** El brief que se actualiza con cada respuesta (lo que falta, «pendiente»). */
export function briefOf(state: DiscoveryState): BriefLine[] {
  const domain = domainById(state.domain);
  const tech = techOf(state);
  const on = featuresOf(state).filter((f) => f.on);
  const val = (id: string) => labelOf(state, id) ?? "pendiente";
  const lines: BriefLine[] = [
    { label: "PROYECTO", value: state.name },
    { label: "TIPO", value: `${KIND_LABELS[state.kind]}${domain ? ` · ${domain.label}` : ""}` },
  ];
  const push = (label: string, id: string) => { if (QUESTION_BY_ID.get(id) && questionsFor(state, QUESTION_BY_ID.get(id)!.step).some((q) => q.id === id)) lines.push({ label, value: val(id) }); };
  push("OBJETIVO", "objetivo");
  push("USUARIOS", "usuarios");
  push("PARA QUIÉN", "proposito");
  push("ALCANCE", "nivel");
  push("PLATAFORMAS", "plataforma");
  push("ACCESO", "acceso");
  push("ROLES", "roles");
  lines.push({ label: "FUNCIONES", value: state.featureChoice === null && state.step !== "resumen" && state.mode !== "auto" ? `${on.length} previstas (pendiente de tu elección)` : `${on.filter((f) => f.tier !== "futura").length} incluidas` });
  push("DISEÑO", "estilo");
  push("MARCA", "marca");
  push("PAGOS", "pagos");
  push("AVISOS", "avisos");
  push("DATOS", "datos");
  push("IDIOMAS", "idiomas");
  lines.push({ label: "TECNOLOGÍA", value: tech.backend === "Ninguno" ? tech.frontend : `${tech.frontend} · ${tech.backend} · ${tech.database}` });
  lines.push({ label: "INFRAESTRUCTURA", value: tech.infrastructure[0] ?? "—" });
  push("ENTREGA", "entrega");
  if (state.notes.length) lines.push({ label: "NOTAS DEL DUEÑO", value: state.notes.join(" · ") });
  lines.push({ label: "ESTADO", value: STAGE_TEXT(state) });
  return lines;
}

export type SummarySection = { title: string; items: string[] };

/** «Esto es lo que vamos a construir»: se enseña ANTES de escribir código. */
export function summaryOf(state: DiscoveryState): SummarySection[] {
  const tech = techOf(state);
  const features = featuresOf(state);
  const on = features.filter((f) => f.on && f.tier !== "futura");
  const future = features.filter((f) => f.tier === "futura");
  const design = labelOf(state, "estilo");
  const sections: SummarySection[] = [
    { title: "OBJETIVO", items: [state.idea, ...(labelOf(state, "objetivo") ? [labelOf(state, "objetivo")!] : [])] },
    { title: "USUARIOS", items: [labelOf(state, "usuarios"), labelOf(state, "acceso") && `Acceso: ${labelOf(state, "acceso")}`, labelOf(state, "roles") && `Roles: ${labelOf(state, "roles")}`].filter((x): x is string => Boolean(x)) },
    { title: "PLATAFORMAS", items: [labelOf(state, "plataforma") ?? KIND_LABELS[state.kind]] },
    { title: `FUNCIONES (${on.length})`, items: on.map((f) => f.label) },
    ...(future.length ? [{ title: "PARA MÁS ADELANTE", items: future.map((f) => f.label) }] : []),
    { title: "ARQUITECTURA", items: [tech.architecture.filter((x) => x !== "↓").join(" → ")] },
    { title: "DISEÑO", items: [design ?? "Varias propuestas para elegir", labelOf(state, "marca") ?? ""].filter(Boolean) },
    { title: "TECNOLOGÍAS", items: [`Pantallas: ${tech.frontend}`, `Servidor: ${tech.backend}`, `Datos: ${tech.database}`, `Acceso: ${tech.access}`] },
    { title: "INTEGRACIONES", items: tech.extras.length ? tech.extras : ["Ninguna por ahora"] },
    { title: "SEGURIDAD", items: tech.security },
    { title: "INFRAESTRUCTURA", items: tech.infrastructure },
    { title: "HITOS", items: tech.milestones },
    { title: "ENTREGA FINAL", items: [labelOf(state, "entrega") ?? "Código fuente completo"] },
  ];
  if (state.notes.length) sections.push({ title: "NOTAS DEL DUEÑO", items: state.notes });
  return sections;
}

/** Cuántos requisitos tiene el proyecto (sin inventar el número: son las funciones incluidas). */
export function requirementsCount(state: DiscoveryState): number {
  return featuresOf(state).filter((f) => f.on && f.tier !== "futura").length;
}

// ------------------------------------------------------------------------------------------------ mensajes del chat
/** El bloque de preguntas en texto (para el hilo de la conversación y para copiarlo). */
export function blockText(state: DiscoveryState, step: StepId = state.step): string {
  const { index, total } = progressOf({ ...state, step });
  if (step === "funciones") {
    const features = featuresOf(state);
    const group = (tier: FeatureTier, title: string) => {
      const items = features.filter((f) => f.tier === tier);
      return items.length ? `${title}\n${items.map((f) => `${f.on ? "✓" : "□"} ${f.label}`).join("\n")}` : "";
    };
    return [
      `Paso ${index} de ${total} · Funciones`,
      "Además de lo que has pedido, creo que este producto debería incluir:",
      group("imprescindible", "IMPRESCINDIBLES"), group("recomendada", "RECOMENDADAS"), group("opcional", "OPCIONALES"), group("futura", "PARA MÁS ADELANTE"),
      `¿Qué incluimos? ${FEATURE_CHOICES.map((o) => `${o.id}) ${o.label}`).join(" · ")}. Mi recomendación: B.`,
    ].filter(Boolean).join("\n\n");
  }
  if (step === "resumen") return summaryOf(state).map((s) => `${s.title}\n${s.items.map((i) => `- ${i}`).join("\n")}`).join("\n\n");
  const qs = questionsFor(state, step);
  return [
    `Paso ${index} de ${total} · ${STEP_TITLES[step]}`,
    ...qs.map((q, i) => [
      `${i + 1}. ${q.text}`,
      ...q.options.map((o) => `   ${letterOf(q, o.id)}) ${o.label}`),
      q.known ? `   Ya me lo dijiste (${q.known.because}): ${q.options.find((o) => o.id === q.known!.option)?.label ?? ""}.` : `   Mi recomendación: ${letterOf(q, q.recommended)} — ${q.reason}`,
    ].join("\n")),
    `Respóndeme por ejemplo: ${qs.map((q, i) => `${i + 1}${letterOf(q, q.known?.option ?? q.recommended)}`).join(", ")}.`,
  ].join("\n\n");
}

/** Lo que el dueño contestó a un bloque, en corto («1C, 2B, 3B»). */
export function answersText(state: DiscoveryState, step: StepId): string {
  if (step === "funciones") return state.featureChoice ? `${state.featureChoice}) ${FEATURE_CHOICES.find((o) => o.id === state.featureChoice)?.label ?? ""}` : "";
  return questionsFor(state, step).map((q, i) => `${i + 1}${letterOf(q, answerOf(state, q))}`).join(", ");
}

// ------------------------------------------------------------------------------------------------ el encargo de construcción
const STYLE_BRIEF: Partial<Record<OptionId, string>> = {
  A: `Minimalista premium. ${DESIGN_STYLES.find((s) => s.id === "minimal")?.brief ?? ""} Detalles premium: microinteracciones suaves y tipografía muy cuidada.`,
  B: "SaaS moderno: navegación lateral clara, tarjetas con métricas, tipografía sans legible, un color de marca vivo sobre neutros, esquinas suaves y microinteracciones discretas.",
  C: `Editorial profesional. ${DESIGN_STYLES.find((s) => s.id === "editorial")?.brief ?? ""}`,
  D: "Futurista: fondo oscuro con degradados sutiles, acentos luminosos controlados, tipografía geométrica, efecto cristal con moderación y animaciones suaves; siempre legible y con buen contraste.",
};

/** El encargo completo para construir el proyecto con TODO lo decidido en la entrevista. */
export function buildPromptOf(state: DiscoveryState): string {
  const tech = techOf(state);
  const features = featuresOf(state);
  const on = features.filter((f) => f.on && f.tier !== "futura");
  const off = features.filter((f) => !f.on && f.tier !== "futura" && f.source !== "ia");
  const future = features.filter((f) => f.tier === "futura");
  const decisions = QUESTION_STEPS.flatMap((step) => questionsFor(state, step).map((q) => ({ q, label: labelOf(state, q.id) })))
    .filter((d) => d.label)
    .map((d) => `- ${d.q.text} → ${d.label}`);
  const estilo = effectiveAnswer(state, "estilo");
  const marca = effectiveAnswer(state, "marca");
  const design = state.kind === "api"
    ? "DISEÑO: no tiene pantallas (API)."
    : estilo && estilo !== "E" && STYLE_BRIEF[estilo]
      ? `DISEÑO ELEGIDO POR EL DUEÑO — ${STYLE_BRIEF[estilo]} Crea un sistema de diseño PROPIO para este proyecto (colores, tipografías, espaciado, radios, sombras, navegación y componentes) y guárdalo en docs/design-system.md. Nada de plantilla genérica.`
      : designPromptBlock({ inferredType: state.kind === "tienda" || state.kind === "saas" ? "app" : state.kind, userInput: state.idea });
  const brand = marca === "A" ? "MARCA: usa el logo y los colores del dueño; pídeselos antes de fijar los colores si no los tienes." : marca === "C" ? "MARCA: el dueño tiene logo; propón tú los colores a juego." : "MARCA: propón tú nombre visual, colores y tipografía coherentes con el sector.";
  return [
    `Crea el proyecto «${state.name}» (${KIND_LABELS[state.kind]}). Lo he definido con el dueño en la entrevista de SUPER WILLY: respeta sus decisiones y, si algo no fuera viable, dilo y propón la alternativa antes de cambiarlo.`,
    `IDEA ORIGINAL DEL DUEÑO (tal cual):\n${state.idea}`,
    `DECISIONES DEL DUEÑO:\n${decisions.join("\n")}`,
    `FUNCIONES ACORDADAS (${on.length}), todas funcionando de verdad, sin partes a medias:\n${on.map((f) => `- ${f.label}${f.source === "dueño" ? " (pedida por el dueño)" : ""}`).join("\n")}`,
    ...(off.length ? [`NO INCLUIR AHORA (el dueño no las ha elegido):\n${off.map((f) => `- ${f.label}`).join("\n")}`] : []),
    ...(future.length ? [`PARA MÁS ADELANTE (no ahora; deja el código preparado para añadirlas):\n${future.map((f) => `- ${f.label}`).join("\n")}`] : []),
    ...(state.notes.length ? [`NOTAS DEL DUEÑO:\n${state.notes.map((n) => `- ${n}`).join("\n")}`] : []),
    `TECNOLOGÍA RECOMENDADA POR WILLY:\n- Pantallas: ${tech.frontend}\n- Servidor: ${tech.backend}\n- Datos: ${tech.database}\n- Archivos: ${tech.storage}\n- Acceso: ${tech.access}${tech.extras.length ? `\n${tech.extras.map((x) => `- ${x}`).join("\n")}` : ""}`,
    `ARQUITECTURA:\n${tech.architecture.join("\n")}`,
    `INFRAESTRUCTURA (empieza pequeño y deja el código preparado para crecer):\n${tech.infrastructure.map((x) => `- ${x}`).join("\n")}`,
    `SEGURIDAD:\n${tech.security.map((x) => `- ${x}`).join("\n")}`,
    `${design}\n${brand}`,
    `ORDEN DE CONSTRUCCIÓN (hitos; al terminar cada uno, compruébalo antes de seguir):\n${tech.milestones.map((m) => `- ${m}`).join("\n")}`,
    `ENTREGA: ${labelOf(state, "entrega") ?? "código fuente completo"}. Incluye instrucciones paso a paso para ponerlo en marcha, variables de entorno documentadas en .env.example y un manual sencillo para el dueño («Cómo usarlo»), sin lenguaje de programador.`,
    "Si no puedes ejecutar el proyecto completo, entrega igualmente todo el código y una demo HTML que funcione. Al final añade una sección «PENDIENTE» con lo que falte decidir o conectar (preguntas de sí o no, una por línea empezando con «- ») y una sección «TIEMPO» con lo que queda para tenerlo terminado al 100 %.",
  ].join("\n\n");
}

/** Resumen corto del proyecto para dar contexto a la IA en los mensajes siguientes (cambios, dudas…). */
export function contextOf(state: DiscoveryState): string {
  const on = featuresOf(state).filter((f) => f.on && f.tier !== "futura").map((f) => f.label);
  const tech = techOf(state);
  return [
    `PROYECTO EN CURSO: «${state.name}» (${KIND_LABELS[state.kind]}). Idea: ${state.idea}`,
    `Decisiones: ${briefOf(state).filter((l) => !["PROYECTO", "TIPO", "ESTADO", "TECNOLOGÍA", "INFRAESTRUCTURA"].includes(l.label)).map((l) => `${l.label.toLowerCase()}: ${l.value}`).join(" · ")}`,
    `Funciones (${on.length}): ${on.join(" · ")}`,
    `Tecnología: ${tech.frontend} · ${tech.backend} · ${tech.database}`,
    "Si el dueño pide un cambio, dile a qué afecta (pantallas, servidor, datos, coste, tiempo), aplícalo sobre lo que ya existe (sin empezar de cero) y di cuántos requisitos tiene ahora el proyecto.",
  ].join("\n");
}

/** Lo que escribe el dueño DURANTE la entrevista: respuestas («1C, 2B»), «haz lo que recomiendas» o cosas que añadir. */
export function applyOwnerText(state: DiscoveryState, text: string): { state: DiscoveryState; understood: string } {
  const clean = text.trim();
  if (!clean) return { state, understood: "" };
  let next = state;
  const said: string[] = [];
  if (state.step === "funciones") {
    const parsed = parseAnswers(clean, [{ id: "__funciones", step: "funciones", topic: "FUNCIONES", text: "", options: FEATURE_CHOICES, recommended: "B", reason: "", known: null }]);
    const choice = parsed.answers["__funciones"] ?? (parsed.useRecommended ? "B" : null);
    if (choice) { next = setFeatureChoice(next, choice); said.push(`funciones: ${FEATURE_CHOICES.find((o) => o.id === choice)?.label.toLowerCase()}`); }
    const added = extractAdditions(parsed.rest || (choice ? "" : clean), clean);
    for (const label of added) next = addFeature(next, label);
    if (added.length) said.push(`añadido: ${added.join(", ")}`);
    if (!choice && !added.length) { next = addFeature(next, clean); said.push(`añadido: ${cap(clean.slice(0, 90))}`); }
    return { state: touch(next), understood: said.join(" · ") };
  }
  if (state.step === "resumen") {
    const added = extractAdditions(clean);
    if (added.length) { for (const label of added) next = addFeature(next, label); return { state: next, understood: `añadido: ${added.join(", ")}` }; }
    return { state: touch({ ...next, notes: [...next.notes, clean.slice(0, 300)] }), understood: "anotado en el brief" };
  }
  const qs = questionsFor(state, state.step);
  const parsed = parseAnswers(clean, qs);
  for (const [id, option] of Object.entries(parsed.answers)) next = choose(next, id, option);
  if (Object.keys(parsed.answers).length) said.push(Object.entries(parsed.answers).map(([id, o]) => { const at = qs.findIndex((q) => q.id === id); return `${at + 1}${letterOf(qs[at]!, o)}`; }).join(", "));
  if (parsed.useRecommended) { next = applyRecommendations(next, state.step); said.push("lo que recomiendo en este bloque"); }
  const added = extractAdditions(parsed.rest, clean);
  for (const label of added) next = addFeature(next, label);
  if (added.length) said.push(`añadido: ${added.join(", ")}`);
  if (!said.length) { next = touch({ ...next, notes: [...next.notes, clean.slice(0, 300)] }); said.push("anotado en el brief"); }
  if (parsed.invalid.length) said.push(`no entendí ${parsed.invalid.join(", ")}`);
  return { state: next, understood: said.join(" · ") };
}
