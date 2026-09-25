/**
 * Las rutas /api de WILLY arrancan programas, descargan modelos y leen páginas.
 * Solo deben obedecer a la propia interfaz de WILLY, nunca a otra página web que
 * tengas abierta en el navegador. Devuelve una respuesta 403 si la petición viene
 * de otro sitio, o null si se puede continuar.
 *
 * Los navegadores actuales indican el origen de cada petición (Sec-Fetch-Site) y,
 * si no, envían siempre la cabecera Origin en las peticiones POST y DELETE.
 * Las herramientas sin navegador (como curl) no envían ninguna de las dos.
 */
export function blockForeignSite(request: Request): Response | null {
  const refuse = (): Response =>
    Response.json({ ok: false, error: "Petición bloqueada: procede de otra página web, no de WILLY AI." }, { status: 403 });

  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none" ? null : refuse();

  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === host ? null : refuse();
  } catch {
    return refuse();
  }
}
