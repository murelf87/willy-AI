// Demo para el cliente: resume en un único archivo HTML lo que hay construido,
// con el avance por día y por mes. Se genera de un solo clic y se puede abrir,
// descargar o enviar por correo sin instalar nada.

import { readList } from "./storage";
import type { Project, ProjectVersion } from "@/types/domain";

const VERSIONS_KEY = "willy-versions";

export type DayPoint = { key: string; label: string; versions: number; files: number };
export type MonthPoint = { key: string; label: string; versions: number; files: number; projects: number };

export type DemoReport = {
  generatedAt: string;
  projects: Project[];
  totals: { projects: number; activos: number; listos: number; versions: number; files: number; lines: number };
  days: DayPoint[];
  months: MonthPoint[];
  screens: { name: string; desc: string }[];
};

/** Pantallas ya construidas en el producto. Se muestran al cliente como alcance entregado. */
const SCREENS: { name: string; desc: string }[] = [
  { name: "Portada pública", desc: "Presentación, precios, acceso anticipado y registro." },
  { name: "Panel de trabajo", desc: "Chat con la IA local, vista previa en vivo y editor de código." },
  { name: "Proyectos", desc: "Crear, abrir, renombrar, duplicar, archivar y papelera." },
  { name: "Historial de versiones", desc: "Cada generación queda guardada y se puede restaurar." },
  { name: "Workspace", desc: "Servidor local, dependencias, caché y registro de actividad." },
  { name: "Agentes y Herramientas", desc: "Capacidades activables para la IA local." },
  { name: "Modelos", desc: "Modelos disponibles comprobados contra el motor local." },
  { name: "Documentación", desc: "Guías de uso dentro del propio producto." },
  { name: "Configuración", desc: "Motor local, modelos, modo sin conexión y notificaciones." },
  { name: "GitHub", desc: "Conectar cuenta, crear repositorio y subir el código generado." },
  { name: "Acceso directo", desc: "Instalación como aplicación en Windows, iOS y Android." },
  { name: "Panel del propietario", desc: "Área privada con métricas, funciones y diagnóstico." },
];

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function fmtDay(key: string) {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fmtMonth(key: string) {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

function countLines(text: string) {
  return text ? text.split("\n").length : 0;
}

/** Calcula el avance real a partir de los proyectos y de sus versiones guardadas. */
export function buildReport(projects: Project[]): DemoReport {
  const versions = readList<ProjectVersion>(VERSIONS_KEY, []);
  const live = projects.filter((p) => !p.deletedAt);

  const days = new Map<string, DayPoint>();
  const months = new Map<string, MonthPoint>();

  const touch = (iso: string, versionsAdd: number, filesAdd: number, projectsAdd: number) => {
    const dk = dayKey(iso);
    const mk = dk.slice(0, 7);
    const day = days.get(dk) ?? { key: dk, label: fmtDay(dk), versions: 0, files: 0 };
    day.versions += versionsAdd;
    day.files += filesAdd;
    days.set(dk, day);
    const month = months.get(mk) ?? { key: mk, label: fmtMonth(mk), versions: 0, files: 0, projects: 0 };
    month.versions += versionsAdd;
    month.files += filesAdd;
    month.projects += projectsAdd;
    months.set(mk, month);
  };

  for (const p of live) touch(p.createdAt, 0, 0, 1);
  for (const v of versions) touch(v.at, 1, v.files.length, 0);

  const files = live.reduce((n, p) => n + p.files.length, 0);
  const lines = live.reduce((n, p) => n + p.files.reduce((k, f) => k + countLines(f.content), 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    projects: live,
    totals: {
      projects: live.length,
      activos: live.filter((p) => p.state === "Activo").length,
      listos: live.filter((p) => p.state === "Listo").length,
      versions: versions.length,
      files,
      lines,
    },
    days: [...days.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-14),
    months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
    screens: SCREENS,
  };
}

function esc(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bars(points: { label: string; versions: number }[]) {
  const max = Math.max(1, ...points.map((p) => p.versions));
  if (!points.length) return `<p class="empty">Todavía no hay actividad registrada.</p>`;
  return `<div class="bars">${points
    .map(
      (p) =>
        `<div class="bar"><span class="fill" style="height:${Math.max(6, Math.round((p.versions / max) * 100))}%"></span><span class="n">${p.versions}</span><span class="l">${esc(p.label)}</span></div>`,
    )
    .join("")}</div>`;
}

/** Documento HTML autónomo: se abre en cualquier navegador, sin conexión ni dependencias. */
export function buildDemoHtml(report: DemoReport, title = "WILLY AI"): string {
  const d = new Date(report.generatedAt);
  const fecha = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const t = report.totals;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Demo de avance</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b0d14;color:#e8ecf7}
.wrap{max-width:1040px;margin:0 auto;padding:32px 20px 64px}
header{text-align:center;padding:40px 0 28px;border-bottom:1px solid #1e2436}
.logo{display:inline-flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.02em}
.dot{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#4f7cff,#9a5cff)}
h1{font-size:clamp(24px,4vw,36px);margin-top:16px}
.sub{color:#93a0bd;margin-top:8px;font-size:15px}
h2{font-size:18px;margin:36px 0 14px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
.card{background:#121728;border:1px solid #1e2436;border-radius:14px;padding:16px}
.kpi{font-size:28px;font-weight:700;color:#8fb0ff}
.kpi small{display:block;font-size:12px;font-weight:500;color:#93a0bd;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #1e2436}
th{color:#93a0bd;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.tag{display:inline-block;padding:2px 9px;border-radius:999px;background:#1b2540;color:#8fb0ff;font-size:12px}
.bars{display:flex;align-items:flex-end;gap:10px;height:190px;overflow-x:auto;padding-top:10px}
.bar{flex:1 0 46px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.fill{width:100%;max-width:38px;border-radius:8px 8px 0 0;background:linear-gradient(180deg,#6f8dff,#9a5cff)}
.n{font-size:12px;color:#e8ecf7;margin-top:6px}
.l{font-size:11px;color:#93a0bd;white-space:nowrap}
.empty{color:#93a0bd;font-size:14px}
footer{margin-top:48px;padding-top:20px;border-top:1px solid #1e2436;color:#93a0bd;font-size:13px;text-align:center}
@media print{body{background:#fff;color:#111}.card,table{border-color:#ddd}.fill{background:#5a76ff}}
</style></head><body><div class="wrap">
<header>
  <div class="logo"><span class="dot"></span>${esc(title)}</div>
  <h1>Demo de avance del proyecto</h1>
  <p class="sub">Informe generado automáticamente el ${fecha} a partir del trabajo real registrado.</p>
</header>

<h2>Resumen</h2>
<div class="grid">
  <div class="card"><div class="kpi">${t.projects}<small>proyectos activos</small></div></div>
  <div class="card"><div class="kpi">${t.versions}<small>versiones guardadas</small></div></div>
  <div class="card"><div class="kpi">${t.files}<small>archivos generados</small></div></div>
  <div class="card"><div class="kpi">${t.lines}<small>líneas de código</small></div></div>
</div>

<h2>Avance diario (últimos días con trabajo)</h2>
<div class="card">${bars(report.days)}</div>

<h2>Avance mensual</h2>
<div class="card">${
    report.months.length
      ? `<table><thead><tr><th>Mes</th><th>Proyectos nuevos</th><th>Versiones</th><th>Archivos</th></tr></thead><tbody>${report.months
          .map((m) => `<tr><td>${esc(m.label)}</td><td>${m.projects}</td><td>${m.versions}</td><td>${m.files}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="empty">Todavía no hay meses con actividad.</p>`
  }</div>

<h2>Proyectos</h2>
<div class="card"><table><thead><tr><th>Proyecto</th><th>Descripción</th><th>Estado</th><th>Archivos</th></tr></thead><tbody>${
    report.projects.length
      ? report.projects
          .map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.desc || "—")}</td><td><span class="tag">${esc(p.state)}</span></td><td>${p.files.length}</td></tr>`)
          .join("")
      : `<tr><td colspan="4" class="empty">Sin proyectos todavía.</td></tr>`
  }</tbody></table></div>

<h2>Funcionalidad entregada</h2>
<div class="grid">${report.screens
    .map((s) => `<div class="card"><strong>${esc(s.name)}</strong><p class="sub" style="margin-top:6px">${esc(s.desc)}</p></div>`)
    .join("")}</div>

<footer>${esc(title)} · Informe de avance para el cliente. Todo el trabajo se ejecuta en local, sin enviar datos a internet.</footer>
</div></body></html>`;
}
