// Licencias de clientes: controla desde aquí qué entregas están activas.
// Si un cliente deja de pagar, suspendes la licencia y su instalación deja
// de funcionar hasta que se reactive.

import { useEffect, useMemo, useState } from "react";
import { PanelCard as Card } from "@/components/panel-card";
import { BadgeCheck, Ban, CalendarClock, Check, Copy, KeyRound, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_ADMIN, readAdmin, saveAdmin } from "@/services/auth-service";
import { pushNotice } from "@/lib/notifications";
import {
  createLicense, daysLeft, newPassword, guardSnippet, isOverdue, listLicenses, markPaid, removeLicense,
  serverSnippet, suspend, updateLicense,
  type License,
} from "@/services/licensing";

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

export function LicensesView() {
  const [items, setItems] = useState<License[]>([]);
  const [creating, setCreating] = useState(false);
  const [client, setClient] = useState("");
  const [project, setProject] = useState("");
  const [price, setPrice] = useState("");
  const [domain, setDomain] = useState("");
  const [plan, setPlan] = useState<"pago" | "gratis">("pago");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState(newPassword());
  const [admin, setAdmin] = useState(DEFAULT_ADMIN);
  const [adminPass, setAdminPass] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [guardFor, setGuardFor] = useState<string | null>(null);

  const refresh = () => setItems(listLicenses());
  useEffect(() => { refresh(); setAdmin(readAdmin()); }, []);

  const serverCode = useMemo(
    () => (guardFor ? serverSnippet(listLicenses()) : ""),
    [guardFor, items],
  );

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      window.setTimeout(() => setCopied(null), 1500);
      pushNotice("Copiado al portapapeles.", "success");
    } catch {
      pushNotice("⚠️ No se pudo copiar.", "warn");
    }
  };

  const create = () => {
    if (!client.trim() || !project.trim()) {
      pushNotice("⚠️ Indica al menos el cliente y el proyecto.", "warn");
      return;
    }
    const lic = createLicense({
      client,
      project,
      price: plan === "gratis" ? 0 : Number(price) || 0,
      domain,
      plan,
      user,
      pass,
    });
    setCreating(false);
    setClient(""); setProject(""); setPrice(""); setDomain(""); setUser(""); setPass(newPassword()); setPlan("pago");
    setGuardFor(lic.id);
    refresh();
    pushNotice(`Acceso creado para ${lic.client}: ${lic.user} / ${lic.pass}`, "success");
  };

  const activeCount = items.filter((l) => l.state === "activa" && !isOverdue(l)).length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Licencias de clientes</h1>
          <p className="text-sm text-muted-foreground">
            Si pagan, la entrega está activa. Si dejan de pagar, se suspende con un clic.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setCreating((v) => !v)}>
          <Plus className="size-4" />{creating ? "Cerrar" : "Nueva licencia"}
        </Button>
      </div>

      <Card className="space-y-3">
        <p className="text-sm font-semibold">Tu acceso de administrador</p>
        <p className="text-xs text-muted-foreground">Con estos datos entras tú como dueño en la pantalla de inicio de sesión.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            Usuario (correo)
            <input value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Contraseña nueva (opcional)
            <input value={adminPass} onChange={(e) => setAdminPass(e.target.value)} placeholder="Déjalo vacío para no cambiarla"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
          </label>
          <div className="flex items-end gap-2">
            <Button onClick={() => { const next = saveAdmin({ email: admin.email, ...(adminPass.trim() ? { pass: adminPass.trim() } : {}) }); setAdmin(next); setAdminPass(""); pushNotice("Acceso de administrador guardado.", "success"); }}>Guardar</Button>
            <Button variant="secondary" onClick={() => copy(`${admin.email} / ${adminPass.trim() || readAdmin().pass}`, "admin")}>{copied === "admin" ? "Copiado" : "Copiar"}</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Contraseña actual: <b className="text-foreground">{readAdmin().pass}</b></p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><p className="text-2xl font-bold">{items.length}</p><p className="text-xs text-muted-foreground">Licencias totales</p></Card>
        <Card><p className="text-2xl font-bold text-emerald-500">{activeCount}</p><p className="text-xs text-muted-foreground">Activas ahora</p></Card>
        <Card><p className="text-2xl font-bold text-amber-500">{items.filter((l) => l.state === "suspendida" || isOverdue(l)).length}</p><p className="text-xs text-muted-foreground">Suspendidas o vencidas</p></Card>
      </div>

      {creating && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold">Nueva licencia</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Cliente
              <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Moda Belén S.L."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Proyecto entregado
              <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="Tienda online"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Cuota mensual (€)
              <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="49"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Dominio o servidor
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="tiendabelen.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              Tipo
              <select value={plan} onChange={(e) => setPlan(e.target.value as "pago" | "gratis")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary">
                <option value="pago">Cliente de pago</option>
                <option value="gratis">Gratis (familiar)</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Usuario del cliente
              <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="belen@sutienda.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Contraseña
              <div className="flex gap-2">
                <input value={pass} onChange={(e) => setPass(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                <Button variant="secondary" onClick={() => setPass(newPassword())}>Otra</Button>
              </div>
            </label>
          </div>
          <Button onClick={create} className="gap-2"><KeyRound className="size-4" />Crear acceso y licencia</Button>
        </Card>
      )}

      {items.length === 0 && !creating && (
        <Card>
          <p className="text-sm text-muted-foreground">
            Todavía no hay licencias. Crea una cuando entregues un proyecto a un cliente: se genera una clave única y
            el código de control para pegar en su instalación.
          </p>
        </Card>
      )}

      {items.map((l) => {
        const overdue = isOverdue(l);
        const left = daysLeft(l);
        return (
          <Card key={l.id} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <BadgeCheck className={`size-4 ${l.state === "activa" && !overdue ? "text-emerald-500" : "text-amber-500"}`} />
                  {l.client} — {l.project}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Clave <span className="font-mono">{l.key}</span>
                  {l.plan === "gratis" ? " · GRATIS (familiar)" : l.price ? ` · ${l.price} €/mes` : ""}
                  {l.domain ? ` · ${l.domain}` : ""}
                </p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                l.state === "activa" && !overdue ? "border-emerald-500/40 text-emerald-500" : "border-amber-500/40 text-amber-500"
              }`}>
                {l.state === "activa" ? (overdue ? `Vencida · ${Math.abs(left)} día(s)` : `Activa · ${left} día(s)`) : "Suspendida"}
              </span>
            </div>

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" />
              Acceso del cliente: <b className="font-mono text-foreground">{l.user}</b> / <b className="font-mono text-foreground">{l.pass}</b>
              {" · "}{l.plan === "gratis" ? "sin cobro" : `próximo cobro: ${fmtDate(l.nextCharge)}`}
            </p>

            <div className="flex flex-wrap gap-2">
              {l.state === "activa" ? (
                <Button size="sm" variant="outline" className="gap-2" onClick={() => { suspend(l.id); refresh(); pushNotice(`Licencia de ${l.client} suspendida.`, "info"); }}>
                  <Ban className="size-4" />Suspender
                </Button>
              ) : (
                <Button size="sm" className="gap-2" onClick={() => { markPaid(l.id); refresh(); pushNotice(`Licencia de ${l.client} activa de nuevo.`, "success"); }}>
                  <Check className="size-4" />Marcar pagada
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-2" onClick={() => { markPaid(l.id); refresh(); pushNotice(`Pago de ${l.client} registrado: 30 días más.`, "success"); }}>
                <RefreshCcw className="size-4" />Registrar pago
              </Button>
              <Button size="sm" variant="secondary" className="gap-2" onClick={() => void copy(l.key, `key-${l.id}`)}>
                <Copy className="size-4" />{copied === `key-${l.id}` ? "Copiada" : "Copiar clave"}
              </Button>
              <Button size="sm" variant="secondary" className="gap-2" onClick={() => void copy(`Usuario: ${l.user}\nContraseña: ${l.pass}`, `cred-${l.id}`)}>
                <Copy className="size-4" />{copied === `cred-${l.id}` ? "Copiado" : "Copiar acceso"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setGuardFor(guardFor === l.id ? null : l.id)}>
                {guardFor === l.id ? "Ocultar código" : "Código de control"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => { const v = window.prompt(`Nuevo dominio para ${l.client}:`, l.domain); if (v !== null) { updateLicense(l.id, { domain: v }); refresh(); } }}
              >
                Editar
              </Button>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => { if (window.confirm(`¿Eliminar la licencia de ${l.client}?`)) { removeLicense(l.id); refresh(); } }}>
                <Trash2 className="size-4" />
              </Button>
            </div>

            {guardFor === l.id && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Pega este código dentro de la etiqueta head de la entrega. Consulta tu servidor de licencias y, si la
                  clave no está activa, la instalación se bloquea.
                </p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs leading-relaxed">
                  {guardSnippet(l, l.domain)}
                </pre>
                <p className="text-xs font-semibold text-muted-foreground">
                  Y este es tu servidor de licencias (Node + Express). Cámbialo en el panel cuando suspendas o actives.
                </p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs leading-relaxed">
                  {serverCode}
                </pre>
                <Button size="sm" variant="secondary" className="gap-2" onClick={() => void copy(`${guardSnippet(l, l.domain)}\n\n${serverCode}`, `code-${l.id}`)}>
                  <Copy className="size-4" />{copied === `code-${l.id}` ? "Copiado" : "Copiar todo"}
                </Button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
