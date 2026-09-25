import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { decidir } from "./lib/acceso-server";
import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Acceso con contraseña desde fuera del ordenador (Ajustes → General → Acceso desde fuera). Con el acceso desactivado,
// o desde el propio ordenador, no hace nada. Sin sesión: las rutas /api responden 401 y las páginas van a /acceso.
const accesoMiddleware = createMiddleware().server(async ({ next, request, pathname }) => {
  if ((await decidir(request)) === "pasa") return next();
  if (pathname.startsWith("/api/")) {
    return Response.json({ ok: false, error: "Hace falta entrar con la contraseña de acceso." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const volver = pathname && pathname !== "/" ? `?volver=${encodeURIComponent(pathname)}` : "";
  return new Response(null, { status: 302, headers: { Location: `/acceso${volver}`, "Cache-Control": "no-store" } });
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, accesoMiddleware, csrfMiddleware],
}));
