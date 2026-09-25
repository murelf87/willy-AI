// Medidor de páginas para el navegador: monta una página invisible del tamaño real del libro y comprueba si el texto cabe.
// El paginador (book-layout.ts) solo pregunta «¿cabe?»; así la vista previa y el PDF usan exactamente la misma medida.

import { bookCss, type LayoutOptions } from "@/lib/book-layout";

export function makeDomFits(opts: LayoutOptions): { fits: (html: string) => boolean; dispose: () => void } {
  const style = document.createElement("style");
  style.textContent = bookCss(opts);
  const page = document.createElement("div");
  page.className = "bk-page recto";
  page.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  const inner = document.createElement("div");
  inner.className = "bk-inner";
  inner.lang = "es";
  page.appendChild(inner);
  document.head.appendChild(style);
  document.body.appendChild(page);
  return {
    fits: (html: string) => {
      inner.innerHTML = html;
      return inner.scrollHeight <= inner.clientHeight + 1;
    },
    dispose: () => { page.remove(); style.remove(); },
  };
}
