import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";

// Genera, en el propio ordenador del dueño, un instalador .exe nuevo con la
// versión siguiente. No usa nada externo: usa los archivos ya instalados y el
// compilador de instaladores que viene incluido en la carpeta "tools/nsis".

type Fs = typeof import("node:fs");
type Path = typeof import("node:path");

async function node() {
  const fs = (await import("node:fs")) as Fs;
  const path = (await import("node:path")) as Path;
  return { fs, fsp: fs.promises, path };
}

async function findRoot(): Promise<string | null> {
  const { fs, path } = await node();
  const candidates: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    candidates.push(dir);
    dir = path.dirname(dir);
  }
  for (const base of candidates) {
    if (fs.existsSync(path.join(base, "willy.nsi")) && fs.existsSync(path.join(base, "app"))) return base;
  }
  return null;
}

function bump(version: string): string {
  const parts = version.trim().split(".").map((n) => Number.parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.slice(0, 3).join(".");
}

async function readVersion(root: string): Promise<string> {
  const { fsp, path } = await node();
  try {
    const raw = await fsp.readFile(path.join(root, "version.txt"), "utf8");
    const match = raw.match(/\d+\.\d+\.\d+/);
    return match ? match[0] : "0.0.6";
  } catch {
    return "0.0.6";
  }
}

async function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    child.stdout?.on("data", (d) => { out += String(d); });
    child.stderr?.on("data", (d) => { out += String(d); });
    child.on("error", (e) => resolve({ code: -1, out: `${out}\n${e.message}` }));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

export const Route = createFileRoute("/api/build-installer")({
  server: {
    handlers: {
      // Estado + descarga del instalador ya generado.
      GET: async ({ request }) => {
        const { fs, fsp, path } = await node();
        const root = await findRoot();
        if (!root) return Response.json({ ready: false, reason: "Esta función solo está disponible en el programa instalado en tu ordenador." }, { status: 200 });
        const file = new URL(request.url).searchParams.get("file");
        const updates = path.join(root, "updates");
        if (file) {
          const safe = path.basename(file);
          const full = path.join(updates, safe);
          if (!fs.existsSync(full)) return Response.json({ error: "El instalador aún no está generado." }, { status: 404 });
          const data = await fsp.readFile(full);
          return new Response(new Uint8Array(data), {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename="${safe}"`,
              "Cache-Control": "no-store",
            },
          });
        }
        const version = await readVersion(root);
        const hasCompiler = fs.existsSync(path.join(root, "tools", "nsis", "makensis.exe"));
        const built = fs.existsSync(updates) ? (await fsp.readdir(updates)).filter((f) => f.endsWith(".exe")) : [];
        return Response.json({ ready: hasCompiler, version, nextVersion: bump(version), built });
      },

      // Construye el instalador de la versión siguiente.
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        const { fs, fsp, path } = await node();
        const root = await findRoot();
        if (!root) {
          return Response.json({ ok: false, error: "Esta función solo funciona en WILLY AI instalado en tu ordenador (localhost:3000)." }, { status: 400 });
        }
        const compiler = path.join(root, "tools", "nsis", "makensis.exe");
        if (!fs.existsSync(compiler)) {
          return Response.json({ ok: false, error: "Falta el generador de instaladores. Instala la última versión de WILLY AI y vuelve a pedírmelo." }, { status: 400 });
        }
        const current = await readVersion(root);
        const next = bump(current);
        const updates = path.join(root, "updates");
        await fsp.mkdir(updates, { recursive: true });
        await fsp.writeFile(path.join(updates, "version.txt"), next, "utf8");
        const outName = `WillyAI-Setup-${next}.exe`;

        const result = await run(
          compiler,
          [
            `/DVERSION=${next}`,
            `/DOUTFILE=updates\\${outName}`,
            "/DVERSIONFILE=updates\\version.txt",
            "willy.nsi",
          ],
          root,
        );
        const outFile = path.join(updates, outName);
        if (result.code !== 0 || !fs.existsSync(outFile)) {
          return Response.json({ ok: false, error: `No se pudo generar el instalador. Detalle: ${result.out.slice(-400)}` }, { status: 500 });
        }
        const stat = await fsp.stat(outFile);
        return Response.json({
          ok: true,
          version: next,
          name: outName,
          size: stat.size,
          url: `/api/build-installer?file=${encodeURIComponent(outName)}`,
        });
      },
    },
  },
});
