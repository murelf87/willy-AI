// Service worker mínimo: permite instalar WILLY AI como aplicación.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // La red manda: no cacheamos nada para no servir código antiguo.
});
