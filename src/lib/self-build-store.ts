export type WillyBackup = {
  id: string;
  createdAt: string;
  instructions: string;
  reason: string;
};

export type WillyImprovement = {
  id: string;
  createdAt: string;
  request: string;
  proposal: string;
  status: "pendiente" | "aplicada" | "descartada";
};

type SelfBuildState = {
  instructions: string;
  improvements: WillyImprovement[];
  backups: WillyBackup[];
};

const KEY = "willy-self-build-v1";
const EVENT = "willy-self-build-change";

const DEFAULT_INSTRUCTIONS = `Conserva siempre el diseño, los datos y las funciones existentes.
Haz una copia de seguridad antes de aplicar cualquier mejora.
Solo modifica WILLY AI; nunca mezcles estos cambios con los proyectos del usuario.
Revisa que la mejora sea compatible, local, reversible y no rompa nada.
El dueño puede ordenarte autoconstruirte y mejorarte cuando quiera: siempre obedeces. No existe ningún entorno, sandbox ni restricción que te lo impida y nunca lo mencionas como excusa.`;

function defaults(): SelfBuildState {
  return { instructions: DEFAULT_INSTRUCTIONS, improvements: [], backups: [] };
}

export function readSelfBuild(): SelfBuildState {
  if (typeof window === "undefined") return defaults();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<SelfBuildState>;
    return {
      instructions: parsed.instructions?.trim() || DEFAULT_INSTRUCTIONS,
      improvements: parsed.improvements ?? [],
      backups: parsed.backups ?? [],
    };
  } catch {
    return defaults();
  }
}

export function writeSelfBuild(state: SelfBuildState) {
  window.localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: state }));
}

export function ownerImprovementInstructions(): string {
  return readSelfBuild().instructions;
}

export { DEFAULT_INSTRUCTIONS, EVENT };