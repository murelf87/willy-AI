// Rediseño completo sin límite: estilos visuales que se pueden aplicar a
// cualquier proyecto ya generado, tantas veces como se quiera.

export type DesignStyle = {
  id: string;
  name: string;
  desc: string;
  /** Instrucciones concretas para la IA. */
  brief: string;
};

export const DESIGN_STYLES: DesignStyle[] = [
  {
    id: "minimal",
    name: "Minimalista claro",
    desc: "Mucho aire, tipografía grande, apenas color.",
    brief:
      "Fondo claro casi blanco, un único color de acento sobrio, tipografía sans grande con mucho interlineado, bordes finos, sin sombras fuertes, gran espacio en blanco y composición asimétrica elegante.",
  },
  {
    id: "oscuro",
    name: "Oscuro técnico",
    desc: "Panel profesional oscuro con acentos luminosos.",
    brief:
      "Fondo oscuro profundo, superficies con contraste sutil, acento luminoso frío, tipografía compacta, tablas y tarjetas densas, microdetalles de interfaz de producto técnico.",
  },
  {
    id: "editorial",
    name: "Editorial",
    desc: "Revista: serif, rejilla y fotografía protagonista.",
    brief:
      "Titulares en serif de gran tamaño, rejilla editorial de varias columnas, fotografía a sangre, numeración de secciones, colores tierra y mucho contraste tipográfico.",
  },
  {
    id: "brutalista",
    name: "Brutalista",
    desc: "Bloques rotundos, bordes duros y color plano.",
    brief:
      "Bordes gruesos negros, bloques de color plano saturado, tipografía condensada en mayúsculas, sin degradados ni sombras suaves, rejilla visible y desplazamientos deliberados.",
  },
  {
    id: "lujo",
    name: "Lujo / premium",
    desc: "Negro, dorado y detalle cuidado.",
    brief:
      "Paleta negro y crema con acento dorado, tipografía con mucho espaciado entre letras, imágenes a pantalla completa, transiciones lentas y detalles finos tipo marca de lujo.",
  },
  {
    id: "friendly",
    name: "Cercano y colorido",
    desc: "Formas redondeadas, ilustraciones y color alegre.",
    brief:
      "Esquinas muy redondeadas, paleta alegre de dos o tres colores, ilustraciones o formas orgánicas de fondo, tipografía redonda amable y microinteracciones divertidas.",
  },
  {
    id: "corporativo",
    name: "Corporativo confiable",
    desc: "Azul sobrio, estructura clara, aire institucional.",
    brief:
      "Paleta azul corporativa con grises neutros, retícula muy ordenada, tarjetas con sombra suave, iconografía lineal coherente y jerarquía clásica de sección-título-texto.",
  },
  {
    id: "retro",
    name: "Retro digital",
    desc: "Años 90 actualizado: píxel, neón y rejilla.",
    brief:
      "Colores neón sobre fondo oscuro, rejilla de fondo, tipografía monoespaciada para detalles, bordes con brillo y estética retro-futurista contenida, siempre legible.",
  },
];

/** Instrucciones para rehacer el diseño por completo sin tocar la funcionalidad. */
export function redesignBrief(style: DesignStyle | null, notes: string, target: string): string {
  return [
    `REDISEÑO COMPLETO de: ${target || "el último proyecto generado"}.`,
    "Rehaz la interfaz entera desde cero: paleta, tipografías, espaciados, composición, componentes, iconografía, imágenes y animaciones.",
    style ? `Dirección visual obligatoria — ${style.name}: ${style.brief}` : "Propón una dirección visual nueva y distinta a la anterior, con personalidad propia.",
    notes.trim() ? `Indicaciones del propietario: ${notes.trim()}` : "",
    "Reglas: no cambies ninguna funcionalidad ni ningún texto de negocio; todos los botones y flujos siguen funcionando igual.",
    "Prohibido el aspecto de plantilla genérica (portada + tres tarjetas + pie). Busca una composición original.",
    "Debe quedar responsive y simétrico de móvil a escritorio, con estados hover, foco visible y buen contraste.",
    "Entrega el código completo y final, no fragmentos.",
  ].filter(Boolean).join("\n");
}
