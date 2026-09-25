import { createFileRoute } from "@tanstack/react-router";

/**
 * Genera el instalador de iPhone (perfil de configuración de Apple).
 * Al abrirlo en el iPhone, crea el icono de WILLY AI en la pantalla de inicio
 * apuntando al WILLY AI que corre en el ordenador del dueño.
 */

function uuid(seed: string): string {
  // UUID estable a partir del host: el iPhone reemplaza el perfil en vez de duplicarlo.
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hex = h.toString(16).padStart(8, "0");
  return `${hex}-W1LL-4A17-B0B0-${hex}00AA`.toUpperCase();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const Route = createFileRoute("/api/iphone")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const host = url.searchParams.get("host") || request.headers.get("host") || "localhost:3000";
        const target = `http://${host}/movil`;
        const id = uuid(host);

        const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key><true/>
      <key>Icon</key><data></data>
      <key>IsRemovable</key><true/>
      <key>Label</key><string>WILLY AI</string>
      <key>PayloadDescription</key><string>Icono de WILLY AI en la pantalla de inicio</string>
      <key>PayloadDisplayName</key><string>WILLY AI</string>
      <key>PayloadIdentifier</key><string>ai.willy.webclip</string>
      <key>PayloadType</key><string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key><string>${id}</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>Precomposed</key><true/>
      <key>URL</key><string>${esc(target)}</string>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>WILLY AI Móvil</string>
  <key>PayloadDescription</key><string>Instala WILLY AI en la pantalla de inicio de tu iPhone.</string>
  <key>PayloadIdentifier</key><string>ai.willy.movil</string>
  <key>PayloadOrganization</key><string>WILLY AI</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${id}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;

        return new Response(plist, {
          headers: {
            "Content-Type": "application/x-apple-aspen-config",
            "Content-Disposition": 'attachment; filename="WILLY-AI-iPhone.mobileconfig"',
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
