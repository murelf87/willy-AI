// Config de empaquetado LOCAL: genera .output/ listo para correr con Node en el
// ordenador del usuario (instalador .exe). No afecta al despliegue normal.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: { preset: "node-server" },
  tanstackStart: {
    server: { entry: "server" },
  },
});
