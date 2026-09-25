// Limitador de peticiones por minuto (ventana deslizante de 60 s), para que un fallo o un bucle no dispare
// cientos de peticiones seguidas. Antes cada ruta /api tenía su propia copia de esta misma lógica; ahora cada
// una solo pide su propio contador con el límite que le convenga: `createRateLimiter(240)`.
export function createRateLimiter(maxPerMinute: number): () => boolean {
  let recent: number[] = [];
  return () => {
    const now = Date.now();
    recent = recent.filter((time) => now - time < 60_000);
    if (recent.length >= maxPerMinute) return true;
    recent.push(now);
    return false;
  };
}
