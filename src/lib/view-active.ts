import { createContext, useContext } from "react";

// Las pestañas que ya has abierto se quedan VIVAS (ocultas) para que no pierdas lo que escribías o generabas en ellas.
// Este contexto le dice a cada una si es la que se está viendo, para que las ocultas no gasten recursos (consultas cada
// pocos segundos, relojes…) ni hablen en voz alta.
export const ViewActiveContext = createContext(true);
export const useViewActive = (): boolean => useContext(ViewActiveContext);
