// Control de entregas a clientes: cada proyecto entregado lleva una licencia.
// Si el cliente paga, la licencia está activa; si deja de pagar, se suspende y
// el proyecto entregado deja de funcionar hasta que se vuelva a activar.

export type LicenseState = "activa" | "suspendida" | "caducada";

/** "pago" = cliente que abona cuota. "gratis" = familiar o cortesía, sin cobro. */
export type LicensePlan = "pago" | "gratis";

export type License = {
  id: string;
  key: string;
  client: string;
  project: string;
  /** Precio mensual acordado (solo informativo). */
  price: number;
  state: LicenseState;
  /** Fecha del próximo cobro (timestamp). */
  nextCharge: number;
  /** Dominio o servidor donde está instalada la entrega. */
  domain: string;
  notes: string;
  /** Tipo de licencia: de pago o gratuita (familiares). */
  plan: LicensePlan;
  /** Usuario de acceso que se entrega al cliente. */
  user: string;
  /** Contraseña de acceso que se entrega al cliente. */
  pass: string;
  createdAt: number;
  updatedAt: number;
};

const KEY = "willy-licencias";
const EVENT = "willy-licencias-change";
const DAY = 86_400_000;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function licenseKey(): string {
  const block = () => Math.random().toString(36).slice(2, 7).toUpperCase();
  return `WILLY-${block()}-${block()}-${block()}`;
}

/** Contraseña sencilla de leer y de dictar por teléfono. */
export function newPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function listLicenses(): License[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as License[];
    return Array.isArray(raw) ? raw.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

function write(all: License[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(all));
  emit();
}

export function createLicense(input: {
  client: string;
  project: string;
  price?: number;
  domain?: string;
  notes?: string;
  plan?: LicensePlan;
  user?: string;
  pass?: string;
}): License {
  const now = Date.now();
  const license: License = {
    id: `lic-${now}`,
    key: licenseKey(),
    client: input.client.trim(),
    project: input.project.trim(),
    price: input.price ?? 0,
    state: "activa",
    nextCharge: now + 30 * DAY,
    domain: input.domain?.trim() ?? "",
    notes: input.notes?.trim() ?? "",
    plan: input.plan ?? "pago",
    user: (input.user?.trim() || input.client.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".")).replace(/^\.|\.$/g, ""),
    pass: input.pass?.trim() || newPassword(),
    createdAt: now,
    updatedAt: now,
  };
  write([license, ...listLicenses()]);
  return license;
}

export function updateLicense(id: string, patch: Partial<License>): License | null {
  const all = listLicenses();
  const found = all.find((l) => l.id === id);
  if (!found) return null;
  const next = { ...found, ...patch, id: found.id, updatedAt: Date.now() };
  write(all.map((l) => (l.id === id ? next : l)));
  return next;
}

export function removeLicense(id: string) {
  write(listLicenses().filter((l) => l.id !== id));
}

/** Marca el pago del mes: reactiva y mueve el próximo cobro 30 días. */
export function markPaid(id: string): License | null {
  return updateLicense(id, { state: "activa", nextCharge: Date.now() + 30 * DAY });
}

export function suspend(id: string): License | null {
  return updateLicense(id, { state: "suspendida" });
}

/** ¿Puede entrar este acceso ahora mismo? Las gratuitas nunca caducan por cobro. */
export function licenseAllowed(license: License): boolean {
  if (license.state !== "activa") return false;
  if (license.plan === "gratis") return true;
  return license.nextCharge >= Date.now() - 3 * DAY;
}

/** Busca un acceso de cliente por usuario (o correo) y contraseña. */
export function findLogin(user: string, pass: string): License | null {
  const u = user.trim().toLowerCase();
  return listLicenses().find((l) => l.user.toLowerCase() === u && l.pass === pass) ?? null;
}

export function daysLeft(license: License): number {
  return Math.ceil((license.nextCharge - Date.now()) / DAY);
}

export function isOverdue(license: License): boolean {
  return license.state === "activa" && license.nextCharge < Date.now();
}

/** Endpoint que el proyecto entregado consulta para saber si sigue activo. */
export function licenseCheckUrl(base: string, key: string): string {
  const clean = base.replace(/\/+$/, "");
  return `${clean}/api/licencia?clave=${encodeURIComponent(key)}`;
}

/**
 * Guardia que se incrusta en el proyecto entregado. Si la licencia no está
 * activa, bloquea la aplicación con un aviso en lugar de mostrarla.
 */
export function guardSnippet(license: License, serverBase: string): string {
  const url = licenseCheckUrl(serverBase || "https://tu-servidor.com", license.key);
  return `<!-- Control de licencia WILLY AI · cliente: ${license.client || "sin nombre"} -->
<script>
(async function () {
  var CLAVE = ${JSON.stringify(license.key)};
  var URL_LICENCIA = ${JSON.stringify(url)};
  function bloquear(mensaje) {
    document.documentElement.innerHTML =
      '<div style="font-family:system-ui;display:flex;min-height:100vh;align-items:center;' +
      'justify-content:center;padding:24px;text-align:center;background:#0b0d14;color:#e8eaf2">' +
      '<div><h1 style="font-size:20px;margin:0 0 8px">Servicio no disponible</h1>' +
      '<p style="opacity:.7;margin:0">' + mensaje + '</p></div></div>';
  }
  try {
    var r = await fetch(URL_LICENCIA, { cache: 'no-store' });
    var d = await r.json();
    if (!d || d.estado !== 'activa') {
      bloquear('Esta instalación está suspendida. Contacta con el proveedor para reactivarla.');
    }
  } catch (e) {
    /* Sin conexión con el servidor de licencias: se permite el uso durante 7 días. */
    var ultimo = Number(localStorage.getItem('willy-licencia-ok') || 0);
    if (ultimo && Date.now() - ultimo > 7 * 86400000) bloquear('No se ha podido verificar la licencia.');
    return;
  }
  localStorage.setItem('willy-licencia-ok', String(Date.now()));
})();
</script>`;
}

/** Endpoint mínimo en Node/Express para responder a la comprobación. */
export function serverSnippet(licenses: License[]): string {
  const table = licenses.map((l) => `  ${JSON.stringify(l.key)}: ${JSON.stringify(l.state)},`).join("\n");
  return `// Servidor de licencias WILLY AI (Node + Express)
// Arranque:  npm i express cors && node licencias.js
const express = require('express');
const cors = require('cors');
const app = express();

const LICENCIAS = {
${table || '  // "WILLY-XXXXX-XXXXX-XXXXX": "activa",'}
};

app.use(cors());
app.get('/api/licencia', (req, res) => {
  const estado = LICENCIAS[String(req.query.clave || '')] || 'caducada';
  res.json({ estado });
});

app.listen(4100, () => console.log('Licencias en http://localhost:4100'));`;
}
