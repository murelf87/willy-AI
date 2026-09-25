// Paquete «Enviar a Claude»: cuando el modelo local no consigue una mejora, este texto se pega tal cual
// en una conversación con Claude con todo lo necesario para que devuelva el cambio ya hecho.

export type ClaudePackInput = {
  version: string;
  request: string;
  proposal?: string;
  status?: string;
  result?: string;
  attachments?: Array<{ name: string; content: string }>;
  screenshots?: Array<{ name: string; description: string }>;
  /** Zonas de código relacionadas, tal como las localiza la Autoconstrucción. */
  code?: string;
  /** La respuesta la va a aplicar WILLY solo: se pide en el formato exacto de sustituciones. */
  forWilly?: boolean;
};

const FENCE = "```";

const WILLY_FORMAT = [
  "## Formato EXACTO de la respuesta (WILLY la aplicará solo)",
  "Responde SOLO con bloques como este, uno por cada cambio, copiando en SEARCH entre 2 y 6 líneas seguidas TAL CUAL están en el código de arriba (con su sangrado):",
  `${FENCE}replace src/ruta/del/archivo.tsx`,
  "<<<<<<< SEARCH",
  "líneas actuales, idénticas",
  "=======",
  "las mismas líneas ya modificadas",
  ">>>>>>> REPLACE",
  FENCE,
  "Si hay que crear un archivo nuevo, entrégalo completo en un bloque con su ruta en la primera línea (por ejemplo " + FENCE + "tsx src/components/nuevo.tsx). Sin explicaciones dentro de los bloques.",
].join("\n");

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}\n[…recortado…]` : text);

export function buildClaudePack(input: ClaudePackInput): string {
  const parts: string[] = [
    `Hola Claude. Soy el dueño de WILLY AI (versión ${input.version}), mi IA local para Windows. Necesito que hagas este cambio en mi programa y me devuelvas el archivo de actualización, como en otras ocasiones.`,
    `## Lo que quiero\n${cut(input.request.trim(), 2000)}`,
  ];
  if (input.result?.trim()) parts.push(`## Lo que pasó al intentarlo con la IA local (${input.status ?? "sin estado"})\n${cut(input.result.trim(), 2000)}`);
  if (input.proposal?.trim()) parts.push(`## Propuesta que hizo la IA local (puede tener errores)\n${cut(input.proposal.trim(), 1500)}`);
  if (input.screenshots?.length) {
    parts.push(`## Capturas de pantalla (descritas por un modelo de visión; pueden tener errores)\n${input.screenshots.map((shot, index) => `Captura ${index + 1} (${shot.name}):\n${cut(shot.description, 1500)}`).join("\n\n")}`);
  }
  if (input.attachments?.length) {
    parts.push(`## Archivos que aporté\n${input.attachments.map((file) => `--- ${file.name} ---\n${cut(file.content, 6000)}`).join("\n\n")}`);
  }
  if (input.code?.trim()) parts.push(`## Código relacionado de mi instalación (zonas localizadas automáticamente)\n${cut(input.code.trim(), 14000)}`);
  if (input.forWilly) {
    parts.push(WILLY_FORMAT);
    return parts.join("\n\n");
  }
  parts.push(
    [
      "## Cómo quiero la respuesta",
      "- Los cambios como sustituciones exactas sobre mis archivos (no reescribas archivos enteros).",
      "- Prueba la lógica antes de entregarla y dime con claridad qué NO has podido probar.",
      "- Un único archivo .bat de actualización, con copia de seguridad y vuelta atrás automática.",
      "- Si algo de mi petición es ambiguo, dime tu suposición en una línea y sigue adelante.",
    ].join("\n"),
  );
  return parts.join("\n\n");
}
