// Cuándo se muestra solo el panel de código (y a qué tamaño) en el espacio de trabajo del chat.
// Pura lógica, sin React: así se prueba sin dibujar nada.

export type CodePanelInput = {
  /** Hay un diseño generándose ahora mismo: mientras dura, el panel tiene sentido mostrarlo. */
  running: boolean;
  /** El dueño pulsó el botón «Código» a propósito en esta tanda de trabajo. */
  userOpened: boolean;
  /** El dueño cerró el panel a propósito (con la X o volviendo a pulsar «Código») en esta tanda. */
  userClosed: boolean;
};

/**
 * Se abre solo mientras se está generando código (para no interrumpir cuando no hay nada que ver), y se queda
 * abierto si el dueño lo abrió a propósito. Si el dueño lo cerró a propósito, no vuelve a abrirse solo en la
 * MISMA tanda de trabajo (para no pelearse con su clic); en la siguiente tanda (nueva generación) se reevalúa.
 */
export function shouldShowCodePanel(i: CodePanelInput): boolean {
  if (i.userClosed) return false;
  if (i.userOpened) return true;
  return i.running;
}

export type CodePanelSizeInput = {
  running: boolean;
  /** El dueño ya tocó el botón de ampliar/reducir en esta tanda: su elección manda. */
  userResized: boolean;
  /** Si tocó ese botón, qué tamaño dejó. */
  userTall: boolean;
};

/**
 * Mientras se genera código de verdad, el panel ocupa la parte en blanco de la vista previa (más alto: `true`)
 * para que se vea bien lo que se está escribiendo, en vez de un cajón pequeño de siempre. Si el dueño ya decidió
 * el tamaño a mano, se respeta su elección y deja de cambiar solo.
 */
export function shouldCodePanelBeTall(i: CodePanelSizeInput): boolean {
  if (i.userResized) return i.userTall;
  return i.running;
}
