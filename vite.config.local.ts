// Config de empaquetado LOCAL: genera .output/ listo para correr con Node en el
// ordenador del usuario (instalador .exe). No afecta al despliegue normal.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: { preset: "node-server" },
  vite: {
    build: {
      // En la build local se detectó una eliminación incorrecta del cuerpo de SuperIAView:
      // el bundle conservaba los hooks pero descartaba el JSX y la pantalla quedaba vacía.
      // Priorizamos integridad funcional sobre el ahorro de tamaño del tree-shaking.
      rolldownOptions: { treeshake: false },
    },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
