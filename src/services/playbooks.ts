// Guías de producto: qué lleva como mínimo cada tipo de encargo para poder
// entregarlo a un cliente. La IA las usa para no dejarse nada y para preguntar
// solo por lo opcional.

export type Playbook = {
  id: string;
  name: string;
  match: RegExp;
  /** Imprescindible: sin esto no se entrega. */
  must: string[];
  /** Opcional: se le pregunta al dueño si lo quiere. */
  ask: string[];
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "tienda",
    name: "Tienda online",
    match: /\b(tienda|ecommerce|e-commerce|comercio|vender|shop|carrito)\b/i,
    must: [
      "Catálogo de productos con fichas (foto, nombre, precio, descripción, stock)",
      "Buscador y filtros por categoría y precio",
      "Carrito de la compra persistente",
      "Proceso de compra paso a paso (datos, envío, pago, confirmación)",
      "Cálculo de gastos de envío e impuestos",
      "Confirmación de pedido y correo al cliente",
      "Zona de cliente: pedidos, direcciones, datos",
      "Panel de administración: productos, pedidos, stock",
      "Páginas legales: aviso legal, privacidad, cookies, devoluciones",
      "Diseño responsive y accesible en móvil, tablet y escritorio",
      "Estados de carga, vacío y error en todas las pantallas",
    ],
    ask: [
      "Pasarela de pago real (Stripe, Redsys, PayPal) o pago simulado",
      "Cupones y descuentos",
      "Lista de deseos y valoraciones de clientes",
      "Multi-idioma y multi-moneda",
      "Facturación automática en PDF",
      "Integración con transportista y seguimiento de envíos",
      "Boletín de correo y recuperación de carrito abandonado",
    ],
  },
  {
    id: "reservas",
    name: "Sistema de reservas",
    match: /\b(reserva|cita|agenda|booking|turno)\b/i,
    must: [
      "Calendario con disponibilidad real",
      "Formulario de reserva con validación",
      "Confirmación por pantalla y por correo",
      "Gestión de servicios, duración y precios",
      "Panel del negocio: ver, mover y cancelar reservas",
      "Recordatorios y política de cancelación",
      "Diseño responsive y estados de carga y error",
    ],
    ask: ["Pago o señal por adelantado", "Varios profesionales o salas", "Sincronización con Google Calendar", "Recordatorio por WhatsApp o SMS"],
  },
  {
    id: "saas",
    name: "Aplicación SaaS",
    match: /\b(saas|panel|dashboard|crm|gestión|gestion|plataforma)\b/i,
    must: [
      "Registro, inicio de sesión y recuperación de contraseña",
      "Roles y permisos (administrador y usuario)",
      "Panel principal con métricas reales",
      "CRUD completo de la entidad principal",
      "Búsqueda, filtros, orden y paginación",
      "Perfil y ajustes de cuenta",
      "Estados de carga, vacío y error, y pantallas 404/403",
      "Diseño responsive y accesible",
    ],
    ask: ["Planes y suscripción de pago", "Equipos e invitaciones", "Exportar a CSV o PDF", "Registro de actividad y auditoría", "Notificaciones por correo"],
  },
  {
    id: "web",
    name: "Web corporativa o landing",
    match: /\b(web|página|pagina|landing|sitio|corporativa|portfolio)\b/i,
    must: [
      "Portada con propuesta de valor clara",
      "Secciones de servicios, sobre nosotros y contacto",
      "Formulario de contacto funcional con validación",
      "Navegación y pie de página completos",
      "SEO básico: títulos, descripciones y textos alternativos",
      "Diseño responsive y accesible, sin aspecto de plantilla genérica",
      "Páginas legales: aviso legal, privacidad y cookies",
    ],
    ask: ["Blog o sección de noticias", "Multi-idioma", "Chat o WhatsApp de contacto", "Analítica de visitas", "Zona privada para clientes"],
  },
  {
    id: "app",
    name: "Aplicación móvil o web app",
    match: /\b(app|aplicación|aplicacion|móvil|movil|android|ios)\b/i,
    must: [
      "Navegación principal y estructura de pantallas",
      "Acceso de usuario y perfil",
      "Funcionalidad principal completa y funcionando",
      "Guardado de datos y persistencia",
      "Estados de carga, vacío, error y sin conexión",
      "Diseño adaptado a pantalla táctil y responsive",
    ],
    ask: ["Notificaciones push", "Modo sin conexión", "Instalable como app (PWA)", "Compartir contenido", "Acceso con Google o Apple"],
  },
  {
    id: "libro",
    name: "Libro profesional",
    match: /\b(libro|novela|ebook|e-book|manual|guía escrita|memorias|relato)\b/i,
    must: [
      "Portada con título, subtítulo y autor",
      "Página de créditos y aviso de derechos",
      "Dedicatoria, agradecimientos e índice",
      "Prólogo o introducción",
      "Todos los capítulos escritos por completo, sin resúmenes ni marcadores",
      "Epílogo o conclusión y página «Sobre el autor»",
      "Texto de contraportada y ficha de publicación con precio sugerido",
    ],
    ask: [
      "Versión en otro idioma",
      "Ilustraciones de capítulo",
      "Ejercicios o cuaderno de trabajo",
      "Audiolibro con voz natural",
      "Bibliografía y notas al pie",
    ],
  },
];

export function detectPlaybook(prompt: string): Playbook | null {
  return PLAYBOOKS.find((p) => p.match.test(prompt)) ?? null;
}

/** Instrucciones que se añaden a la petición para que no falte nada. */
export function playbookBrief(pb: Playbook, extras: string[] = [], excluded: string[] = []): string {
  return [
    `Encargo profesional: ${pb.name}. Debe quedar listo para entregar a un cliente.`,
    "Incluye SIEMPRE, sin excepción, todo lo siguiente y deja cada punto funcionando de verdad:",
    ...pb.must.map((m) => `- ${m}`),
    extras.length ? `Además, el propietario ha pedido incluir:\n${extras.map((e) => `- ${e}`).join("\n")}` : "",
    excluded.length ? `No incluyas (descartado por el propietario):\n${excluded.map((e) => `- ${e}`).join("\n")}` : "",
    "Entrega para servirse: instrucciones de subida a un servidor propio u online (paso a paso), variables de entorno documentadas en .env.example, y proyecto preparado para desplegarse tal cual.",
    "Si el motor local no puede ejecutar el proyecto completo, entrega igualmente el código fuente completo, las instrucciones y una demo HTML funcional que muestre el resultado.",
    "Al final de tu respuesta añade una sección «PENDIENTE» con lo que haga falta decidir o conectar, en forma de preguntas de sí o no, y una sección «TIEMPO» indicando de forma realista cuánto trabajo queda para tenerlo 100% terminado.",
  ].filter(Boolean).join("\n");
}
