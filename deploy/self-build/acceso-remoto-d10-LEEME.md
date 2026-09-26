# D10 — Acceso con contraseña desde fuera del ordenador: carga lista para `/api/self-build`

Para la conversación **«WILLY AI setup and Docker»** (la que despliega en el PC). Preparada el 25/09/2026 por la
conversación «WILLY AI» (rama `acceso-remoto` en GitHub, commit `8a9de44`; carga v2 sin `routeTree.gen.ts`). **Implementar en local primero**; el VPS
va después con esta misma pieza (el instalador `deploy/vps/instalar-willy-vps.sh` la detecta solo).

## Qué hace (y qué NO cambia)
- **En el propio ordenador (localhost sin proxy) NO cambia nada.** Ni para Antonio, ni para el supervisor
  (`recuperar.mjs` → `/api/local-ai` + `/app`), ni para la autoconstrucción (candidata en otro puerto, `127.0.0.1`).
- Con el acceso **activado** y una petición **desde fuera** (móvil por la Wi-Fi `192.168.x.x`, o el VPS a través de
  Caddy, que añade `X-Forwarded-For`): sin sesión, `/api/*` → **401** y las páginas → **302 `/acceso?volver=…`**.
  Con la contraseña correcta, cookie `willy_acceso` (HttpOnly, SameSite=Lax, 30 días, Secure si HTTPS) y todo sigue.
- Rutas siempre libres: `/acceso`, `/api/acceso`, `/assets/*`, `/fonts/*`, favicon, iconos, manifests, `sw.js`.
- Contraseña: huella scrypt + sal en `datos-privados/acceso.json` (nunca en texto claro; las actualizaciones no lo tocan).
  8 fallos seguidos → 10 min de espera para ese origen. Con `WILLY_ACCESO_PASS` en el entorno (VPS) se crea sola
  la primera vez.
- **Ajustes → General**: tarjeta nueva «Acceso desde fuera (contraseña)»: guardar contraseña (mín. 8), interruptor
  «Pedir contraseña fuera de este ordenador». Solo se puede configurar desde el propio ordenador o con sesión abierta.

## Archivos de la carga (`acceso-remoto-d10.json`)
| Archivo | Tipo | Huella SHA-256 esperada tras aplicar |
|---|---|---|
| `src/lib/acceso-server.ts` | nuevo (`files`) | `484a808b…37a41f` |
| `src/routes/api/acceso.ts` | nuevo (`files`) | `a642e0b5…b1e6ad` |
| `src/routes/acceso.tsx` | nuevo (`files`) | `eb043855…507694` |
| `src/routeTree.gen.ts` | **no va en la carga**: lo regenera el plugin de rutas de TanStack durante la compilación de la candidata (comprobado: `vite build` lo reescribe con `/acceso` y `/api/acceso`). Así no pisa rutas que se hayan añadido en el PC después del 25/09 | (lo genera la compilación) |
| `src/start.ts` | 2 `patches` (import + middleware) | `991298bd…33e73a` |
| `src/components/settings-view.tsx` | 2 `patches` (imports + tarjeta tras `IphoneCard`) | `eb8cd46e…dc4b91` |

Comprobado contra copias del PC del 25/09 ~14:30 UTC (local ~29): cada `search` encaja exactamente **una** vez y la
simulación reproduce byte a byte el resultado esperado. **Desde entonces el PC ha seguido desplegando (locales 30–61+): antes de
enviar, repetir la comprobación de siempre (`content.count(search) == 1`) en `src/start.ts` y `src/components/settings-view.tsx`;
si la tarjeta `IphoneCard` o los imports de `settings-view.tsx` han cambiado, ajustar solo ese `search`.** `checks.mustContain`: «Acceso a WILLY AI», «Acceso desde fuera
(contraseña)», «Guardar contraseña» (textos literales de pantalla). Sin comentarios con «…»; `Button` sin `variant`
nuevo; icono `Lock` (ya usado en `status-screens.tsx`). Nada toca `src/lib/project-work.ts`.

## Verificación ya hecha fuera del PC (Linux, Node 22, mismo código)
tsc: **0 errores nuevos** (los 5 previos de siempre: project-tests, projects-view, capability-registry, project-compile-ts ×2).
Build OK. Pruebas HTTP reales: sin activar todo igual (200 en `/app` y `/api/local-ai` incluso con `X-Forwarded-For`);
activado: localhost 200 en `/app`, `/api/local-ai`, `/api/sistema`; desde fuera 302/401; login correcto → cookie → 200;
cookie manipulada → 302; salir borra la cookie; desactivar vuelve a dejar pasar; 8 fallos → 429 solo para ese origen.

## Cómo probarlo en el PC después de desplegar (sin tocar el uso normal)
1. `GET /api/acceso` → `{"activo":false,"configurado":false,"sesion":false,"local":true}` (nada cambia todavía).
2. Ajustes → General → «Acceso desde fuera (contraseña)»: guardar una contraseña (queda activado).
3. En el navegador del PC, abrir `http://<IP de la Wi-Fi>:3000/app` (la que da Ajustes → Móvil): debe llevar a la
   pantalla «Acceso a WILLY AI»; con la contraseña, entra. `http://localhost:3000/app` sigue abriéndose directo.
4. Health del supervisor y de la autoconstrucción: `curl http://127.0.0.1:3000/api/local-ai` → 200 con acceso activado.
5. Para volver a como estaba: interruptor apagado (o borrar `datos-privados/acceso.json`).

## Después
- Cuando esté en el PC y verificado: subirlo a GitHub `main` (proceso de la sección «GitHub y VPS» de
  `willy-coordinacion-cambios-en-equipo.md`) o fusionar la rama `acceso-remoto`, y ejecutar el instalador del VPS:
  detecta `src/lib/acceso-server.ts` y deja que la contraseña la pida WILLY (`WEB_AUTH=willy`), sin basic auth de Caddy.
- Pendiente (no bloquea): cuando la sesión caduca, las llamadas `/api` devuelven 401 y la pantalla no redirige sola
  hasta recargar; se puede añadir un interceptor de `fetch` en el cliente más adelante.
