import { createFileRoute } from "@tanstack/react-router";
import { projectRoot } from "@/lib/project-root";
import { runTypeCheck, checkFile } from "@/lib/self-audit";
import {
  loadSchedule, saveSchedule, loadLog, runAuditNow, startScheduler, getSchedulerState, nextRunAt,
  type AuditSchedule,
  type Weekday,
} from "@/lib/audit-scheduler";

// El scheduler arranca la primera vez que alguien llama a este endpoint.
// Usa un closure para que solo se inicie una vez aunque haya muchas peticiones.
let schedulerStarted = false;
function ensureScheduler(root: string): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  startScheduler(root, root);
}

// Endpoint de autoauditoría: la IA local puede detectar errores TypeScript
// sin intervención humana desde la pestaña Autoconstrucción.
// También gestiona el scheduler de auditorías programadas por el dueño.

function rejectForeignRequest(request: Request): string | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "Petición bloqueada: procede de otra página web.";
  if (!site) {
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost = "";
      try { originHost = new URL(origin).host; } catch { return "Petición bloqueada: origen no válido."; }
      const host = request.headers.get("host") ?? new URL(request.url).host;
      if (originHost !== host) return "Petición bloqueada: procede de otra página web.";
    }
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return "Petición bloqueada: formato no permitido.";
  return null;
}

type IncomingBody = {
  action?: unknown;
  file?: unknown;
  schedule?: unknown;
};

/** Valida y limpia una configuración de horario enviada por el dueño. */
function parseSchedule(raw: unknown): AuditSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const days = Array.isArray(s["days"])
    ? (s["days"] as number[]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) as Weekday[]
    : [];
  const hour = Number(s["hour"]);
  const minute = Number(s["minute"]);
  const everyWeeks = Number(s["everyWeeks"]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(everyWeeks) || everyWeeks < 1 || everyWeeks > 52) return null;
  return {
    enabled: s["enabled"] === true,
    days,
    hour,
    minute,
    everyWeeks,
  };
}

export const Route = createFileRoute("/api/self-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const foreign = rejectForeignRequest(request);
        if (foreign) return Response.json({ ok: false, error: foreign }, { status: 403 });

        let body: IncomingBody;
        try {
          body = (await request.json()) as IncomingBody;
        } catch {
          return Response.json({ ok: false, error: "Petición no válida." }, { status: 400 });
        }

        const root = await projectRoot();
        if (!root) return Response.json({ ok: false, error: "No se encontró la instalación editable de WILLY AI." }, { status: 503 });

        // Arrancar el scheduler si aún no está corriendo
        ensureScheduler(root);

        // ── Comprobación TypeScript completa del proyecto ──────────────────
        if (body.action === "type-check") {
          try {
            const result = await runTypeCheck(root);
            return Response.json({ ok: true, audit: result });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "Error al ejecutar la comprobación de tipos." }, { status: 500 });
          }
        }

        // ── Comprobación de un archivo concreto ────────────────────────────
        if (body.action === "check-file") {
          const filePath = typeof body.file === "string" ? body.file.trim() : "";
          if (!filePath) return Response.json({ ok: false, error: "Indica el archivo a comprobar." }, { status: 400 });
          try {
            const result = await checkFile(root, filePath);
            return Response.json({ ok: true, audit: result });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "Error al comprobar el archivo." }, { status: 500 });
          }
        }

        // ── Leer configuración y estado del scheduler ──────────────────────
        if (body.action === "schedule-get") {
          const schedule = await loadSchedule(root);
          const state = getSchedulerState(schedule);
          const next = nextRunAt(schedule);
          const log = await loadLog(root);
          return Response.json({ ok: true, schedule, state, nextRunAt: next?.getTime() ?? null, log: log.slice(-10) });
        }

        // ── Guardar nueva configuración del scheduler ──────────────────────
        if (body.action === "schedule-set") {
          const schedule = parseSchedule(body.schedule);
          if (!schedule) return Response.json({ ok: false, error: "Configuración de horario no válida." }, { status: 400 });
          await saveSchedule(root, schedule);
          const next = nextRunAt(schedule);
          return Response.json({ ok: true, schedule, nextRunAt: next?.getTime() ?? null });
        }

        // ── Ejecutar auditoría ahora mismo (manual) ────────────────────────
        if (body.action === "run-now") {
          try {
            const entry = await runAuditNow(root, root);
            return Response.json({ ok: true, entry });
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : "Error al ejecutar la auditoría." }, { status: 500 });
          }
        }

        // ── Historial de auditorías ────────────────────────────────────────
        if (body.action === "log") {
          const log = await loadLog(root);
          return Response.json({ ok: true, log });
        }

        return Response.json({ ok: false, error: `Acción desconocida: ${String(body.action)}` }, { status: 400 });
      },
    },
  },
});
