import { useEffect, useState } from "react";

const KEY = "willy-theme";

/**
 * Tema oscuro/claro de la interfaz, guardado en este equipo (oscuro por defecto la primera vez que se abre).
 * Aplica la clase al <html> al cargar. Antes de vivir aquí, la pantalla de entrada y la principal tenían cada
 * una su propia copia de esta misma comprobación inicial.
 */
export function useDarkTheme(): [boolean, (value: boolean) => void] {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    const nextDark = saved ? saved === "dark" : true;
    setDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
  }, []);

  return [dark, setDark];
}
