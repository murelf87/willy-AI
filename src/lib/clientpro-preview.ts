// Aplicación "ClientPro" generada por WILLY AI — se renderiza en un iframe real.
// Todo el documento es autónomo (HTML + CSS + JS inline) para que la vista previa funcione de verdad.

const rows = [
  { i: "MG", c: "#a855f7", n: "María García", e: "maria@empresa.com", co: "Empresa S.L.", p: "Pro", s: "Activo", sc: "#16a34a", f: "12/06/2025" },
  { i: "CL", c: "#3b82f6", n: "Carlos López", e: "carlos@startup.com", co: "Startup Inc.", p: "Business", s: "Activo", sc: "#16a34a", f: "10/06/2025" },
  { i: "AM", c: "#f43f5e", n: "Ana Martín", e: "ana@consultora.com", co: "Consultora", p: "Starter", s: "En prueba", sc: "#f59e0b", f: "10/06/2025" },
  { i: "JR", c: "#06b6d4", n: "Javier Ruiz", e: "javier@tech.com", co: "Tech Solutions", p: "Pro", s: "Activo", sc: "#16a34a", f: "09/06/2025" },
];

export const clientProHtml = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ClientPro</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#0f172a;font-size:14px}
.app{display:flex;min-height:100vh}
.side{width:220px;border-right:1px solid #e2e8f0;background:#fafbfd;padding:14px 10px;display:flex;flex-direction:column;gap:2px}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;padding:4px 8px 14px}
.brand .dot{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#7c5cfc,#4f8cff);display:grid;place-items:center;color:#fff;font-size:13px;font-weight:800}
.nav{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;color:#475569;font-weight:500;cursor:pointer}
.nav svg{width:16px;height:16px;stroke:#64748b;fill:none;stroke-width:1.8}
.nav:hover{background:#f1f5f9}
.nav.on{background:#eef0ff;color:#4f46e5;font-weight:600}
.nav.on svg{stroke:#4f46e5}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.top{display:flex;align-items:center;gap:14px;padding:12px 22px;border-bottom:1px solid #e2e8f0}
.search{flex:1;max-width:420px;display:flex;align-items:center;gap:8px;background:#f1f5f9;border-radius:8px;padding:8px 12px;color:#94a3b8;font-size:13px}
.spacer{flex:1}
.avatar{width:32px;height:32px;border-radius:50%;background:#4f46e5;color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px}
.user{display:flex;align-items:center;gap:8px}
.user small{display:block;color:#94a3b8;font-size:11px}
.user b{font-size:13px}
.content{padding:20px 22px;overflow:auto}
h1{font-size:22px;font-weight:800}
.sub{color:#64748b;font-size:13px;margin-top:3px}
.sel{border:1px solid #e2e8f0;border-radius:8px;padding:7px 12px;font-size:13px;color:#334155;background:#fff}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:18px}
.card{border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;display:flex;justify-content:space-between;gap:8px}
.card b{font-size:20px;display:block;margin-top:6px}
.card .up{font-size:12px;color:#16a34a;font-weight:600;margin-top:2px}
.card .lbl{font-size:12px;color:#64748b}
.ic{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;flex:none}
.ic svg{width:16px;height:16px;stroke-width:1.8;fill:none}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.panel{border:1px solid #e2e8f0;border-radius:12px;padding:16px}
.panel h3{font-size:14px;font-weight:700}
.legend{display:flex;flex-direction:column;gap:8px;font-size:12.5px;color:#475569;margin-top:8px}
.legend span{display:flex;align-items:center;gap:8px}
.legend i{width:9px;height:9px;border-radius:3px;display:inline-block}
.donutwrap{display:flex;align-items:center;gap:18px;justify-content:center;margin-top:8px}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
th{color:#64748b;font-weight:600;text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0}
td{padding:10px;border-bottom:1px solid #f1f5f9}
.pill{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;display:inline-block}
.pill.ok{background:#dcfce7;color:#15803d}.pill.test{background:#fef3c7;color:#b45309}
.tag{padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600;display:inline-block}
.tag.p{background:#eef0ff;color:#4f46e5}.tag.b{background:#e0f2fe;color:#0369a1}.tag.s{background:#fae8ff;color:#a21caf}
.who{display:flex;align-items:center;gap:9px}
.who i{width:26px;height:26px;border-radius:50%;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700;font-style:normal}
@media(max-width:480px){.cards{grid-template-columns:repeat(2,1fr)}.charts{grid-template-columns:1fr}.side{display:none}}
</style></head>
<body><div class="app">
<aside class="side">
  <div class="brand"><span class="dot">C</span>ClientPro</div>
  <div class="nav on"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>Dashboard</div>
  <div class="nav"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 15c2.5 0 4.5 1.2 5.5 4"/></svg>Clientes</div>
  <div class="nav"><svg viewBox="0 0 24 24"><path d="M4 4h16v5a3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1-3 3 3 3 0 0 1-3-3z" transform="translate(1) scale(.85)"/><path d="M5 13v7h14v-7"/></svg>Facturación</div>
  <div class="nav"><svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg>Productos</div>
  <div class="nav"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>Informes</div>
  <div class="nav"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>Calendario</div>
  <div class="nav"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></svg>Configuración</div>
</aside>
<div class="main">
  <div class="top">
    <div class="search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>Buscar clientes, facturas, productos...</div>
    <div class="spacer"></div>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
    <div class="user"><div class="avatar">A</div><div><b>Antonio José</b><small>Administrador</small></div></div>
  </div>
  <div class="content">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div><h1>Dashboard</h1><p class="sub">Resumen general de tu negocio</p></div>
      <div class="sel">Últimos 6 meses ▾</div>
    </div>
    <div class="cards">
      <div class="card"><div><span class="lbl">Clientes</span><b>1.248</b><span class="up">↑ +12%</span></div><div class="ic" style="background:#eef0ff"><svg viewBox="0 0 24 24" stroke="#4f46e5"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/></svg></div></div>
      <div class="card"><div><span class="lbl">Ingresos (mes)</span><b>24.580 €</b><span class="up">↑ +18%</span></div><div class="ic" style="background:#dcfce7"><svg viewBox="0 0 24 24" stroke="#16a34a"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg></div></div>
      <div class="card"><div><span class="lbl">Facturas</span><b>86</b><span class="up">↑ +24%</span></div><div class="ic" style="background:#fef3c7"><svg viewBox="0 0 24 24" stroke="#d97706"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/></svg></div></div>
      <div class="card"><div><span class="lbl">Conversión</span><b>12,4%</b><span class="up">↑ +3.2%</span></div><div class="ic" style="background:#fae8ff"><svg viewBox="0 0 24 24" stroke="#a21caf"><path d="M4 16l6-6 4 4 6-8"/></svg></div></div>
    </div>
    <div class="charts">
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center"><h3>Ingresos</h3><span class="sel" style="font-size:12px">Últimos 6 meses ▾</span></div>
        <svg viewBox="0 0 320 150" style="width:100%;margin-top:10px">
          <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c5cfc" stop-opacity=".35"/><stop offset="1" stop-color="#7c5cfc" stop-opacity="0"/></linearGradient></defs>
          ${[0,1,2,3].map(i=>'<line x1="24" x2="316" y1="'+(14+i*32)+'" y2="'+(14+i*32)+'" stroke="#f1f5f9"/>').join("")}
          <path d="M24 118 C 60 112, 84 96, 110 96 S 160 66, 186 60 S 236 44, 262 40 S 300 34, 316 30 L316 136 L24 136 Z" fill="url(#g)"/>
          <path d="M24 118 C 60 112, 84 96, 110 96 S 160 66, 186 60 S 236 44, 262 40 S 300 34, 316 30" fill="none" stroke="#7c5cfc" stroke-width="2.5"/>
          <circle cx="262" cy="40" r="4" fill="#7c5cfc" stroke="#fff" stroke-width="2"/>
          <g><rect x="212" y="6" width="66" height="24" rx="5" fill="#0f172a"/><text x="245" y="16" fill="#fff" font-size="9" text-anchor="middle">Abr: 26.420 €</text><text x="245" y="26" fill="#94a3b8" font-size="8" text-anchor="middle">Ingresos del mes</text></g>
          <text x="24" y="148" fill="#94a3b8" font-size="9">Ene</text><text x="110" y="148" fill="#94a3b8" font-size="9">Feb</text><text x="186" y="148" fill="#94a3b8" font-size="9">Mar</text><text x="262" y="148" fill="#94a3b8" font-size="9">Abr</text>
        </svg>
      </div>
      <div class="panel">
        <h3>Clientes por plan</h3>
        <div class="donutwrap">
          <svg width="150" height="150" viewBox="0 0 42 42">
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="#f1f5f9" stroke-width="6"/>
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="#7c5cfc" stroke-width="6" stroke-dasharray="45 55" stroke-dashoffset="25" stroke-linecap="round"/>
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="#4f8cff" stroke-width="6" stroke-dasharray="32 68" stroke-dashoffset="-20" stroke-linecap="round"/>
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="#c084fc" stroke-width="6" stroke-dasharray="18 82" stroke-dashoffset="-52" stroke-linecap="round"/>
            <circle cx="21" cy="21" r="15.9" fill="none" stroke="#34d399" stroke-width="6" stroke-dasharray="5 95" stroke-dashoffset="-70" stroke-linecap="round"/>
            <text x="21" y="20" text-anchor="middle" font-size="5" font-weight="800" fill="#0f172a">1.248</text>
            <text x="21" y="25" text-anchor="middle" font-size="2.6" fill="#94a3b8">Clientes</text>
          </svg>
          <div class="legend">
            <span><i style="background:#7c5cfc"></i>Pro&nbsp;<b style="margin-left:auto">45%</b></span>
            <span><i style="background:#4f8cff"></i>Business&nbsp;<b style="margin-left:auto">32%</b></span>
            <span><i style="background:#c084fc"></i>Starter&nbsp;<b style="margin-left:auto">18%</b></span>
            <span><i style="background:#34d399"></i>Enterprise&nbsp;<b style="margin-left:auto">5%</b></span>
          </div>
        </div>
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center"><h3>Clientes recientes</h3><span style="color:#4f46e5;font-weight:600;font-size:13px">Ver todos</span></div>
      <table>
        <thead><tr><th>Nombre</th><th>Email</th><th>Empresa</th><th>Plan</th><th>Estado</th><th>Fecha</th></tr></thead>
        <tbody>
        ${rows.map(r=>'<tr><td><span class="who"><i style="background:'+r.c+'">'+r.i+'</i>'+r.n+'</span></td><td style="color:#64748b">'+r.e+'</td><td>'+r.co+'</td><td><span class="tag '+((r.p[0]??"").toLowerCase())+'">'+r.p+'</span></td><td><span class="pill '+(r.s==="Activo"?"ok":"test")+'">'+r.s+'</span></td><td style="color:#64748b">'+r.f+'</td></tr>').join("")}
        </tbody>
      </table>
    </div>
  </div>
</div>
</div></body></html>`;
