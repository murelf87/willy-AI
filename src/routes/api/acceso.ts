import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import {
  activar, anotarFallo, bloqueoRestante, comprobarContrasena, cookieBorrada, cookieDeSesion, crearToken, desdeEsteOrdenador,
  esHttps, establecerContrasena, estado, leerCookie, olvidarFallos, tokenValido,
} from "@/lib/acceso-server";

// Acceso con contraseña (Ajustes → General → Acceso desde fuera). GET: estado (sin secretos). POST: entrar, salir y
// configurar. Configurar solo desde el propio ordenador o con una sesión ya abierta; entrar se frena tras 8 fallos.
// La lógica está en lib/acceso-server.ts; aquí solo se valida la petición.

const reply = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });

type Cuerpo = { action?: unknown; contrasena?: unknown; activo?: unknown };

export const Route = createFileRoute("/api/acceso")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => reply(await estado(request)),
      POST: async ({ request }: { request: Request }) => {
        const foreign = blockForeignSite(request);
        if (foreign) return foreign;
        let body: Cuerpo;
        try {
          body = (await request.json()) as Cuerpo;
        } catch {
          return reply({ ok: false, error: "Petición no válida." }, 400);
        }
        const action = String(body.action ?? "");
        const secure = esHttps(request);

        if (action === "entrar") {
          const actual = await estado(request);
          if (!actual.activo) return reply({ ok: false, error: "El acceso con contraseña no está activado." }, 400);
          const espera = bloqueoRestante(request);
          if (espera > 0) return reply({ ok: false, error: `Demasiados intentos. Espera ${Math.ceil(espera / 60000)} min.` }, 429);
          const contrasena = typeof body.contrasena === "string" ? body.contrasena : "";
          if (!(await comprobarContrasena(contrasena))) {
            anotarFallo(request);
            return reply({ ok: false, error: "Contraseña incorrecta." }, 401);
          }
          olvidarFallos(request);
          return reply({ ok: true }, 200, { "Set-Cookie": cookieDeSesion(await crearToken(), secure) });
        }

        if (action === "salir") {
          return reply({ ok: true }, 200, { "Set-Cookie": cookieBorrada(secure) });
        }

        if (action === "configurar") {
          const permitido = desdeEsteOrdenador(request) || (await tokenValido(leerCookie(request)));
          if (!permitido) return reply({ ok: false, error: "Solo el dueño puede cambiar el acceso: hazlo desde el ordenador o tras entrar con la contraseña." }, 403);
          const activo = body.activo === true;
          const contrasena = typeof body.contrasena === "string" ? body.contrasena : "";
          try {
            if (contrasena) await establecerContrasena(contrasena, activo);
            else await activar(activo);
          } catch (error) {
            return reply({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
          }
          return reply({ ok: true, ...(await estado(request)) });
        }

        return reply({ ok: false, error: "Operación no permitida." }, 400);
      },
    },
  },
});
