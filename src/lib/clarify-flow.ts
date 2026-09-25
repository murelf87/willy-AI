import {
  ambiguitySignals, buildClarifyMessages, checkFidelity, fallbackInstruction, looksExecuted, parseClarify, repairMissing,
  type Answer, type ChatMessage, type ClarifyContext, type Literal, type Question, type Signal,
} from "@/lib/clarify";

// Flujo de «Que la IA lo entienda exactamente». El modelo se inyecta (`chat`) para poder probarlo entero sin IA real.
// Un modelo flojo no puede dejarte sin resultado ni perder tus datos: se reintenta con otro, y al final hay plantilla.

export type ChatFn = (messages: ChatMessage[], attempt: number) => Promise<{ ok: true; data: string } | { ok: false; error: string }>;

export type ClarifyResult = {
  understood: string;
  instruction: string;
  assumptions: string[];
  /** Dudas que el modelo necesita que contestes (vacío si ya no hacen falta). */
  questions: Question[];
  /** Puntos del texto que podrían malinterpretarse (detectados sin IA). */
  signals: Signal[];
  /** Datos exactos tuyos que están en la versión final, y los que hubo que devolverle. */
  kept: Literal[];
  repaired: Literal[];
  source: "ia" | "plantilla";
  /** Por qué se usó la plantilla (si fue el caso). */
  note?: string;
};

const MAX_ATTEMPTS = 3;

export async function clarify(chat: ChatFn, input: { text: string; context: ClarifyContext; answers?: Answer[] }): Promise<ClarifyResult> {
  const text = input.text.trim();
  const signals = ambiguitySignals(text, input.context);
  const answered = !!input.answers?.length;
  let strict = false;
  let reason = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const reply = await chat(buildClarifyMessages({ text, context: input.context, signals, ...(answered ? { answers: input.answers! } : {}), strict }), attempt);
    if (!reply.ok) {
      reason = reply.error;
      continue;
    }
    const parsed = parseClarify(reply.data);
    const refused = !parsed.tagged && /^(lo siento|no puedo|no es posible|i can't|i cannot|como (?:ia|modelo)|disculpa)/i.test(parsed.instruction);
    if (refused || parsed.instruction.length < 8 || looksExecuted(parsed.instruction, input.context) || (!parsed.tagged && parsed.instruction.length > 4000)) {
      reason = refused ? "el modelo se negó" : parsed.instruction.length < 8 ? "el modelo no devolvió una instrucción" : "el modelo ejecutó la petición en vez de reescribirla";
      strict = true;
      continue;
    }
    const before = checkFidelity(text, parsed.instruction);
    const instruction = repairMissing(parsed.instruction.slice(0, 4000), before.missing);
    return {
      understood: parsed.understood || "",
      instruction,
      assumptions: parsed.assumptions,
      questions: answered ? [] : parsed.questions,
      signals,
      kept: before.kept,
      repaired: before.missing,
      source: "ia",
    };
  }
  const instruction = fallbackInstruction(text, input.context);
  const check = checkFidelity(text, instruction);
  return { understood: "", instruction, assumptions: [], questions: [], signals, kept: check.kept, repaired: check.missing, source: "plantilla", note: reason || "el modelo no respondió" };
}
