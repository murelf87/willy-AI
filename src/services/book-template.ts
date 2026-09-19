// Plantilla mínima de un libro profesional listo para publicar y vender.
// La IA recibe estas instrucciones para que no falte ninguna parte del libro.

export type BookSpec = {
  title: string;
  subtitle: string;
  author: string;
  genre: string;
  audience: string;
  tone: string;
  language: string;
  chapters: number;
  wordsPerChapter: number;
  idea: string;
};

export const BOOK_GENRES = [
  "Novela",
  "No ficción / divulgación",
  "Manual práctico",
  "Autoayuda y desarrollo personal",
  "Negocios y emprendimiento",
  "Infantil e ilustrado",
  "Biografía y memorias",
  "Técnico y formación",
];

export const BOOK_TONES = ["Cercano y claro", "Profesional y riguroso", "Narrativo y emotivo", "Divertido y ágil", "Inspirador"];

/** Lo mínimo que lleva un libro para poder publicarse y cobrarse. */
export const BOOK_MUST = [
  "Portada con título, subtítulo y autor",
  "Página de créditos (copyright, año, autor, aviso de derechos)",
  "Dedicatoria y agradecimientos",
  "Índice con todos los capítulos",
  "Prólogo o introducción",
  "Capítulos completos, con desarrollo real (nada de esquemas ni resúmenes)",
  "Cierre o epílogo con conclusión",
  "Página «Sobre el autor»",
  "Texto de contraportada (sinopsis de venta)",
  "Ficha de publicación: título, categorías, palabras clave, descripción y precio sugerido",
];

export const BOOK_ASK = [
  "Versión en inglés u otro idioma",
  "Ilustraciones o imágenes de capítulo",
  "Ejercicios o cuaderno de trabajo al final de cada capítulo",
  "Audiolibro leído con voz natural",
  "Bibliografía y notas al pie",
  "Segunda parte o serie de libros",
];

export function emptyBook(): BookSpec {
  return {
    title: "",
    subtitle: "",
    author: "",
    genre: BOOK_GENRES[0]!,
    audience: "Público general adulto",
    tone: BOOK_TONES[0]!,
    language: "Español (España)",
    chapters: 10,
    wordsPerChapter: 1800,
    idea: "",
  };
}

/** Petición completa que se envía a la IA. */
export function bookBrief(spec: BookSpec): string {
  return [
    `Escribe un LIBRO COMPLETO y profesional, listo para publicar y vender. Idioma: ${spec.language}.`,
    `Título propuesto: ${spec.title || "(elige tú el mejor título comercial)"}.`,
    spec.subtitle ? `Subtítulo: ${spec.subtitle}.` : "",
    `Autor: ${spec.author || "(déjalo indicado como [Nombre del autor])"}.`,
    `Género: ${spec.genre}. Público: ${spec.audience}. Tono: ${spec.tone}.`,
    `Extensión: ${spec.chapters} capítulos de unas ${spec.wordsPerChapter} palabras cada uno.`,
    `Idea o tema del libro: ${spec.idea}`,
    "",
    "El libro debe incluir OBLIGATORIAMENTE, en este orden y con el contenido escrito de verdad:",
    ...BOOK_MUST.map((m) => `- ${m}`),
    "",
    "Reglas de calidad:",
    "- Escribe el contenido real de cada capítulo, completo. Nunca pongas «aquí iría…», resúmenes ni marcadores.",
    "- Cada capítulo empieza con un título en formato «## Capítulo N. Título».",
    "- Estilo cuidado, sin repeticiones, sin relleno y sin frases hechas de inteligencia artificial.",
    "- Formato Markdown limpio, listo para maquetar o subir a Amazon KDP.",
    "- Añade al final una sección «PUBLICACIÓN» con: descripción de venta, 7 palabras clave, 2 categorías, precio sugerido en euros y en dólares, y los pasos exactos para publicarlo y cobrar.",
    "- Añade una sección «PENDIENTE» con preguntas de sí o no sobre lo opcional que no hayas incluido.",
    "- Añade una sección «TIEMPO» con lo que falta para tenerlo 100% terminado.",
    "",
    "Si el libro es muy largo, escribe igualmente todos los capítulos sin cortar; continúa hasta terminar.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** HTML imprimible (sirve para guardar como PDF desde el navegador). */
export function bookHtml(spec: BookSpec, body: string): string {
  const html = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/^## (.+)$/gm, "</section><section><h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>")
    .split(/\n{2,}/)
    .map((p) => (p.trim().startsWith("<") ? p : `<p>${p.trim().replace(/\n/g, "<br>")}</p>`))
    .join("\n");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${spec.title || "Libro"}</title>
<style>
  @page { size: A5; margin: 18mm 16mm; }
  body { font-family: Georgia, "Times New Roman", serif; color:#111; line-height:1.65; font-size:12pt; }
  h1 { font-size:26pt; text-align:center; margin:0 0 6pt; }
  .cover { text-align:center; padding:60pt 0; page-break-after:always; }
  .cover .sub { font-size:14pt; font-style:italic; color:#444; }
  .cover .aut { margin-top:40pt; font-size:13pt; letter-spacing:.12em; text-transform:uppercase; }
  section { page-break-before: always; }
  h2 { font-size:17pt; margin:0 0 12pt; }
  h3 { font-size:13pt; }
  p { text-align: justify; margin:0 0 10pt; text-indent:1.2em; }
  li { margin-bottom:4pt; }
</style></head><body>
<div class="cover"><h1>${spec.title || "Libro"}</h1>
<div class="sub">${spec.subtitle || ""}</div>
<div class="aut">${spec.author || ""}</div></div>
<section>${html}</section>
</body></html>`;
}
