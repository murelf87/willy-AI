# Formato de programa de Windows — Marina Workout

> Lo que necesita la fábrica de instaladores de WILLY para montar este programa, instalarlo y probarlo de verdad. Sin compilar nada y sin herramientas de terceros.

## Estructura

```
programa.json            nombre, versión (1.0.0), descripción y tamaño de ventana
README.md                para el cliente: qué es, instalar, usar y desinstalar
app/index.html           pantalla principal (+ más pantallas, CSS, JS e imágenes en app/)
servidor/api.mjs         (opcional) lógica en Node: rutas "MÉTODO /api/…"
pruebas/*.test.mjs       pruebas de aceptación con node:test
```

## Lógica (servidor/api.mjs)

```js
export default {
  "GET /api/salud": async () => ({ ok: true }),
  "GET /api/notas": async ({ datos }) => datos.leer("notas", []),
  "POST /api/notas": async ({ cuerpo, datos }) => {
    if (!cuerpo?.texto) throw Object.assign(new Error("La nota está vacía."), { estado: 400 });
    const notas = await datos.leer("notas", []);
    const nota = { id: crypto.randomUUID(), texto: cuerpo.texto };
    await datos.guardar("notas", [...notas, nota]);
    return { estado: 201, json: nota };
  },
  "DELETE /api/notas/:id": async ({ params, datos }) => { … },
};
```
Cada ruta recibe `{ metodo, ruta, params, consulta, cuerpo, datos, carpetaDatos, registro }`. Los datos del usuario se guardan en su carpeta de datos (nunca junto al programa) y sobreviven a las actualizaciones. Solo módulos de Node (`node:…`).

## Pruebas de aceptación (pruebas/*.test.mjs)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { iniciar } from "../runtime/servidor.mjs";

test("guardar y listar notas", async () => {
  const app = await iniciar({ puerto: 0, datos: process.env.APP_DATOS });
  try {
    const r = await fetch(new URL("/api/notas", app.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: "Hola" }) });
    assert.equal(r.status, 201);
  } finally {
    await app.cerrar();
  }
});
```
WILLY las ejecuta en el programa YA INSTALADO y aisladas: solo pueden leer el programa y escribir en `process.env.APP_DATOS`.

## Qué comprueba la fábrica

Formato → montaje (con su propio motor y su icono) → lanzador e instalador (NSIS, por usuario, sin permisos de administrador) → instalación en silencio en una carpeta vacía (archivos idénticos, accesos directos, «Aplicaciones instaladas») → primer arranque (pantalla y recursos cargan, scripts correctos, /api/salud responde) → pruebas de aceptación aisladas → desinstalación (no queda nada). El informe queda en la pestaña Replicación; si el código cambia, hay que volver a probar.

## Límites honestos

- Sin firma digital: al descargarlo de internet, Windows (SmartScreen) avisará hasta firmarlo con un certificado de firma de código.

- Servicios del sistema, controladores o piezas de núcleo (VPN, antivirus, cortafuegos) no se empaquetan con este formato: se marcan como PENDIENTE.
