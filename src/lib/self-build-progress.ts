// Progreso REAL de una mejora mientras el servidor la aplica: el paso en que va la versión candidata (lo dice su marca
// de operación en curso), en palabras del dueño. No se inventa un porcentaje: se dice el paso («3 de 8») y cuánto lleva.
// Sin dependencias de servidor: lo usan la pantalla y las pruebas.

export type ProgressInfo = { n: number; total: number; label: string; detail: string };

export const PROGRESS_TOTAL = 8;

const STEPS: Record<string, { n: number; label: string; detail: string }> = {
  STARTED: { n: 1, label: "Preparando la versión candidata", detail: "Comprobando el cambio antes de tocar nada." },
  CANDIDATE_CREATED: { n: 2, label: "Versión candidata creada", detail: "Copia aparte del código lista. Comprobando los tipos de la versión actual (la primera vez tarda unos minutos; después, segundos)." },
  CANDIDATE_EDITED: { n: 2, label: "Cambio escrito en la candidata", detail: "La versión que funciona no se toca hasta el final." },
  BUILD_STARTED: { n: 3, label: "Compilando la candidata", detail: "Compilando el programa nuevo aparte." },
  BUILD_SUCCESS: { n: 3, label: "Candidata compilada", detail: "El programa nuevo compila." },
  TYPECHECK_STARTED: { n: 4, label: "Comprobando tipos (TypeScript)", detail: "Buscando errores nuevos que la compilación no ve." },
  TYPECHECK_SUCCESS: { n: 4, label: "Tipos comprobados", detail: "Sin errores nuevos." },
  TEST_STARTED: { n: 5, label: "Probando la candidata aparte", detail: "Arrancando el programa nuevo en otro puerto y comprobando que responde." },
  TEST_SUCCESS: { n: 5, label: "Candidata probada", detail: "El programa nuevo arranca aparte." },
  READY: { n: 6, label: "Candidata lista", detail: "Lo ha superado todo: se instala." },
  PROMOTION_STARTED: { n: 7, label: "Copia de seguridad", detail: "Guardando y verificando la versión actual antes de sustituirla." },
  BACKUP_VERIFIED: { n: 7, label: "Copia verificada", detail: "Instalando los archivos de la mejora." },
  FILES_MODIFIED: { n: 7, label: "Instalando el programa nuevo", detail: "Sustituyendo el programa por intercambio (el anterior no se borra hasta el final)." },
  PROMOTED: { n: 8, label: "Mejora instalada", detail: "Anotando la versión nueva." },
  COMPLETED: { n: 8, label: "Mejora instalada", detail: "Versión nueva anotada." },
};

function elapsed(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Qué decir para el paso actual (null si no hay operación en marcha o el paso no es de una mejora). */
export function progressInfo(step: string | null | undefined, stepAt?: string | null, nowMs = Date.now()): ProgressInfo | null {
  if (!step) return null;
  const info = STEPS[step];
  if (!info) return null;
  const since = stepAt ? (nowMs - new Date(stepAt).getTime()) / 1000 : 0;
  const lasting = Number.isFinite(since) && since >= 10 ? ` · lleva ${elapsed(since)}` : "";
  return { n: info.n, total: PROGRESS_TOTAL, label: `${info.label} (paso ${info.n} de ${PROGRESS_TOTAL})`, detail: `${info.detail}${lasting}` };
}
