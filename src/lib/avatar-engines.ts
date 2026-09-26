// Avatar «natural» 100 % local: motores de animación (ComfyUI + LivePortrait / MuseTalk / LatentSync / Wav2Lip…), voz (Piper) y
// respaldo opcional (Hugging Face). Aquí vive lo que no depende de la red: qué es cada motor, cómo se reconoce que está instalado y en
// qué orden se prueban (si uno falla, se pasa al siguiente). Nada de esto inventa nombres de nodos: se comprueba con lo que ComfyUI
// dice que tiene instalado.

export type Role = "movimiento" | "labios" | "todo" | "personaje";

export const ROLES: Record<Role, { label: string; desc: string }> = {
  movimiento: { label: "Movimiento", desc: "Da vida a la foto: cabeza, parpadeo y expresiones a partir de un vídeo tuyo (p. ej. LivePortrait). Entra foto + vídeo; sale vídeo sin voz." },
  labios: { label: "Labios", desc: "Sincroniza la boca con el audio sobre un vídeo o una foto (p. ej. MuseTalk, LatentSync, Wav2Lip). Entra vídeo o foto + audio; sale vídeo hablando." },
  todo: { label: "Todo en uno", desc: "Un solo flujo que convierte foto + audio en un vídeo hablando (p. ej. SadTalker, Hallo, EchoMimic, Sonic)." },
  personaje: { label: "Personaje (imagen)", desc: "Genera una imagen fija de tu personaje a partir de una descripción de escena (y, si el flujo lo admite, tu foto de referencia). Necesita un flujo de generación de imagen (p. ej. FLUX o SDXL con IPAdapter/InstantID/PuLID para mantener la misma cara). WILLY no trae ni descarga ese modelo: lo instalas tú en ComfyUI." },
};

export type Family = { id: string; label: string; match: RegExp; repo: string; note: string };

/** Familias de nodos conocidas: se reconocen por el NOMBRE de sus nodos en tu ComfyUI, no por versiones. */
export const FAMILIES: Family[] = [
  { id: "f5tts", label: "F5-TTS voz clonada", match: /F5[ _-]?TTS/i, repo: "niknah/ComfyUI-F5-TTS", note: "Clona localmente una voz a partir de audio de referencia; usa solo tu voz o una voz con permiso." },
  { id: "liveportrait", label: "LivePortrait", match: /^LivePortrait/i, repo: "kijai/ComfyUI-LivePortraitKJ", note: "Licencia: con el detector InsightFace es SOLO no comercial; para uso comercial elige el recortador MediaPipe (MIT/Apache)." },
  { id: "musetalk", label: "MuseTalk", match: /muse[ _-]?talk/i, repo: "AIFSH/ComfyUI-MuseTalk_FSH", note: "Pide mmcv/mmpose (instalación delicada en Windows) y ffmpeg." },
  { id: "latentsync", label: "LatentSync", match: /latent[ _-]?sync/i, repo: "iVideoGameBoss/ComfyUI-LatentSync-Node", note: "Sincronización de labios de alta resolución (ByteDance); pide bastante memoria gráfica." },
  { id: "wav2lip", label: "Wav2Lip", match: /wav2lip/i, repo: "ShmuelRonen/ComfyUI_wav2lip", note: "El más ligero; los labios salen algo más borrosos." },
  { id: "sadtalker", label: "SadTalker", match: /sad[ _-]?talker/i, repo: "búscalo en ComfyUI-Manager («SadTalker»)", note: "Foto + audio → vídeo (todo en uno)." },
  { id: "hallo", label: "Hallo / EchoMimic / Sonic", match: /^(hallo|echomimic|sonic)/i, repo: "búscalo en ComfyUI-Manager", note: "Modelos pesados: con 6 GB de memoria gráfica pueden no caber." },
  { id: "vhs", label: "Video Helper Suite", match: /^VHS_/, repo: "Kosinkadink/ComfyUI-VideoHelperSuite", note: "Carga y guarda vídeos (casi todos los flujos la usan)." },
  { id: "ipadapter", label: "IPAdapter (identidad)", match: /IPAdapter/i, repo: "cubiq/ComfyUI_IPAdapter_plus", note: "Mantiene la misma cara entre imágenes a partir de una foto de referencia." },
  { id: "instantid", label: "InstantID (identidad)", match: /InstantID/i, repo: "cubiq/ComfyUI_InstantID", note: "Clona la identidad de una cara de referencia sin entrenar nada; necesita un checkpoint SDXL." },
  { id: "pulid", label: "PuLID (identidad)", match: /PuLID/i, repo: "cubiq/PuLID_ComfyUI", note: "Otra forma de mantener la cara, pensada para FLUX y SDXL." },
  { id: "reactor", label: "ReActor (cambio de cara)", match: /ReActor/i, repo: "Gourieff/ComfyUI-ReActor", note: "Cambia la cara de una imagen ya generada por la de tu foto; solo con tu cara o con permiso." },
];

const HUMAN = (name: string): string => name.replace(/[_-]+/g, " ");

/** Qué familias hay instaladas, según los nombres de nodo de ComfyUI. */
export function familiesIn(classes: string[]): Array<{ id: string; label: string; count: number }> {
  return FAMILIES.map((family) => ({ id: family.id, label: family.label, count: classes.filter((name) => family.match.test(name)).length })).filter((entry) => entry.count > 0);
}

/** Cómo conseguir un nodo que falta. */
export function hintForMissing(className: string): string {
  const family = FAMILIES.find((entry) => entry.match.test(className));
  if (family) return `Falta el nodo «${className}» (${family.label}). Instálalo desde ComfyUI-Manager → Custom Nodes Manager (${family.repo}) y reinicia ComfyUI.`;
  return `Falta el nodo «${HUMAN(className)}» en tu ComfyUI. Prueba ComfyUI-Manager → «Install Missing Custom Nodes» con este flujo abierto.`;
}

export type FlowInfo = {
  id: string;
  name: string;
  role: Role;
  /** Entradas que el flujo tiene (nodos de cargar imagen / audio / vídeo). */
  needs: { image: boolean; audio: boolean; video: boolean };
  /** Nodos que faltan en ComfyUI (vacío = listo). */
  missing: string[];
  /** Avisos que no impiden usarlo (p. ej. dos nodos de imagen). */
  warnings: string[];
  hasVideoOutput: boolean;
  /** Tiene un nodo que guarda una imagen fija (Save Image): lo que necesita el rol «personaje». */
  hasImageOutput: boolean;
};

export type PipelineStage = { flowId: string };
export type Pipeline = { id: string; label: string; stages: PipelineStage[] };
export type Skipped = { flow: string; reason: string };

export const BREAK_MS = 30 * 60 * 1000;

/**
 * Orden de prueba: 1) movimiento → labios (lo más natural), 2) «todo en uno», 3) solo labios sobre la foto. Un flujo al que le falta un
 * nodo, sin vídeo de salida o que falló hace poco se salta (con el motivo). Se respeta el orden en que están en la lista.
 */
export function planPipelines(flows: FlowInfo[], broken: Record<string, number> = {}, now = Date.now()): { pipelines: Pipeline[]; skipped: Skipped[] } {
  const skipped: Skipped[] = [];
  const usable = (flow: FlowInfo): boolean => {
    if (flow.missing.length) { skipped.push({ flow: flow.name, reason: `faltan nodos: ${flow.missing.slice(0, 3).join(", ")}${flow.missing.length > 3 ? "…" : ""}` }); return false; }
    if (!flow.hasVideoOutput) { skipped.push({ flow: flow.name, reason: "no tiene un nodo que guarde vídeo (Video Combine / Save Video)" }); return false; }
    if ((broken[flow.id] ?? 0) > now) { skipped.push({ flow: flow.name, reason: `falló hace poco; se reintenta en ${Math.max(1, Math.ceil(((broken[flow.id] ?? 0) - now) / 60000))} min` }); return false; }
    return true;
  };
  const ok = flows.filter(usable);
  const moves = ok.filter((flow) => flow.role === "movimiento");
  const lips = ok.filter((flow) => flow.role === "labios");
  const all = ok.filter((flow) => flow.role === "todo");
  const pipelines: Pipeline[] = [];
  for (const move of moves) {
    if (!move.needs.image) { skipped.push({ flow: move.name, reason: "no tiene nodo de imagen (Load Image): no sé dónde poner la foto" }); continue; }
    for (const lip of lips) {
      if (!lip.needs.audio) { skipped.push({ flow: lip.name, reason: "no tiene nodo de audio (Load Audio)" }); continue; }
      if (!lip.needs.video) { skipped.push({ flow: `${move.name} → ${lip.name}`, reason: "el flujo de labios no tiene entrada de vídeo para encadenarlo" }); continue; }
      pipelines.push({ id: `${move.id}>${lip.id}`, label: `${move.name} → ${lip.name}`, stages: [{ flowId: move.id }, { flowId: lip.id }] });
    }
  }
  for (const flow of all) {
    if (!flow.needs.audio || !flow.needs.image) { skipped.push({ flow: flow.name, reason: "necesita un nodo de imagen y otro de audio (Load Image / Load Audio)" }); continue; }
    pipelines.push({ id: flow.id, label: flow.name, stages: [{ flowId: flow.id }] });
  }
  for (const flow of lips) {
    if (!flow.needs.audio) continue;
    if (!flow.needs.image && !flow.needs.video) { skipped.push({ flow: flow.name, reason: "no tiene entrada de imagen ni de vídeo" }); continue; }
    pipelines.push({ id: `solo:${flow.id}`, label: `${flow.name} (${flow.needs.image ? "sobre la foto" : "sobre tu vídeo"})`, stages: [{ flowId: flow.id }] });
  }
  return { pipelines, skipped };
}

/**
 * Flujos de «personaje» listos para usar: solo necesitan estar completos (sin nodos que falten) y guardar una imagen
 * (Save Image). A diferencia del vídeo, aquí no se encadenan: se usa el que el dueño elija (o el primero listo).
 */
export function planCharacterFlows(flows: FlowInfo[], broken: Record<string, number> = {}, now = Date.now()): { ready: FlowInfo[]; skipped: Skipped[] } {
  const skipped: Skipped[] = [];
  const ready = flows.filter((flow) => {
    if (flow.role !== "personaje") return false;
    if (flow.missing.length) { skipped.push({ flow: flow.name, reason: `faltan nodos: ${flow.missing.slice(0, 3).join(", ")}${flow.missing.length > 3 ? "…" : ""}` }); return false; }
    if (!flow.hasImageOutput) { skipped.push({ flow: flow.name, reason: "no tiene un nodo que guarde imagen (Save Image)" }); return false; }
    if ((broken[flow.id] ?? 0) > now) { skipped.push({ flow: flow.name, reason: `falló hace poco; se reintenta en ${Math.max(1, Math.ceil(((broken[flow.id] ?? 0) - now) / 60000))} min` }); return false; }
    return true;
  });
  return { ready, skipped };
}

/**
 * Lo que de verdad hace hoy «Crea tu avatar IA», dicho sin adornos: una imagen fija de tu personaje, no un vídeo
 * caminando por un sitio. Colocar al personaje moviéndose por una escena concreta (Fase 2) necesita generación de
 * vídeo con control de escena, algo que no viene instalado y que en una gráfica de 6 GB está por probar.
 */
export const CHARACTER_TIPS: string[] = [
  "Hoy genera una IMAGEN fija de tu personaje a partir de tu descripción (y tu foto, si el flujo la admite). No genera vídeo ni coloca al personaje caminando por un sitio: eso es una fase futura, todavía sin probar en este equipo.",
  "Hace falta un flujo de ComfyUI (formato API) con un checkpoint de generación de imagen instalado (por ejemplo FLUX o SDXL) y un nodo Save Image. WILLY no incluye ni descarga ese modelo: se instala desde ComfyUI-Manager o copiando el checkpoint en la carpeta models/checkpoints de ComfyUI.",
  "Para que salga siempre la misma cara, el flujo debería usar IPAdapter, InstantID o PuLID con tu foto de referencia (identidad consistente). Sin uno de esos nodos, cada imagen generada será una cara distinta.",
  "«Que no parezca IA» depende del modelo y del flujo, no de WILLY: con más pasos, un buen checkpoint y restauración facial se nota menos, pero ninguna herramienta local lo garantiza al 100 %.",
  "Con 6 GB de memoria gráfica, genera a 768–1024 px, cierra otros programas y libera Ollama antes de crear la imagen.",
];

/** Consejos para el resultado más natural (calidad real; no promete engañar a ningún detector). */
export const NATURAL_TIPS: string[] = [
  "Foto: de frente, cara entera y nítida, luz suave y uniforme, fondo simple, sin gafas de sol ni pelo tapando la cara. Mejor 1024 px o más.",
  "Movimiento: un vídeo tuyo de 10–20 s hablando con naturalidad (mirando a cámara, sin gestos bruscos) es lo que da los parpadeos y micro-expresiones que hacen que no parezca «de plástico». Los gestos salen de ese vídeo: el texto no da órdenes al avatar.",
  "Voz: la de tu vídeo maestro dice lo mismo que dices en el vídeo; con «Leer un texto», WILLY lee tu texto tal cual con una voz natural de España. Evita música, eco y otras voces.",
  "Duración: clips de 15–40 s y luego los unes: las secuencias largas acumulan errores en los labios.",
  "Rostro: si la boca sale borrosa, añade un nodo de restauración facial (CodeFormer / GFPGAN) al final de tu flujo; para fluidez, interpolación de fotogramas (RIFE).",
  "Con 6 GB de memoria gráfica: trabaja a 512–768 px, cierra otros programas y libera Ollama (`ollama stop nombre-del-modelo`) antes de crear el vídeo.",
];
