// WILLY AI · ARRANQUE SEGURO (supervisor). Este archivo es el index.mjs que abre el lanzador (willy-ai.exe). Arranca el
// programa de siempre (willy.mjs, en esta misma carpeta). SOLO si ese programa no puede ni cargarse al abrir WILLY desde su
// acceso directo, arranca con la última copia buena, la deja puesta para las próximas veces y deja un informe para que
// WILLY lo anote (y deje el código como corresponde). En las pruebas del actualizador y de la Autoconstrucción
// (WILLY_STAGE / WILLY_SIN_RESPALDO) no hace nada de esto: allí un fallo tiene que verse para deshacer el cambio.
// Lo instala solo el actualizador oficial; la Autoconstrucción no puede modificarlo.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  await import("./willy.mjs");
} catch (error) {
  await rescue(error);
}

async function rescue(error) {
  const reason = error && error.stack ? String(error.stack) : String(error);
  const first = reason.split("\n")[0].slice(0, 300);
  console.error(`[WILLY · arranque seguro] El programa no pudo arrancar: ${reason}`);
  const root = path.resolve(here, "..", "..", "..");
  const liveServer = path.join(root, "app", ".output", "server");
  const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const guarded = process.env.WILLY_STAGE !== "1" && process.env.WILLY_SIN_RESPALDO !== "1" && norm(here) === norm(liveServer);
  if (!guarded) throw error;
  let lib;
  try {
    lib = await import(pathToFileURL(path.join(root, "supervisor", "respaldo.mjs")).href);
  } catch {
    throw error;
  }
  lib.log(root, `El programa instalado no arrancó: ${first}`);
  for (const candidate of lib.fallbacks(root, { exclude: [path.dirname(here)] })) {
    // Una copia verificada tiene que seguir siendo exactamente la que se guardó (si no, se pasa a la siguiente).
    if (candidate.sha) {
      let digest = "";
      try { digest = lib.treeDigest(candidate.dir); } catch { /* ilegible */ }
      if (digest !== candidate.sha) {
        lib.log(root, `La copia ${candidate.dir} no coincide con su huella: no se usa.`);
        continue;
      }
    }
    try {
      await import(pathToFileURL(lib.entryOf(candidate.dir)).href);
    } catch (again) {
      lib.log(root, `La copia ${candidate.dir} tampoco arrancó: ${String(again && again.message ? again.message : again).slice(0, 200)}`);
      continue;
    }
    // Arrancó con la copia (desde su propia carpeta): se deja puesta para las próximas veces y se avisa a WILLY.
    let restored = false;
    try {
      lib.install(root, candidate);
      restored = true;
    } catch (problem) {
      lib.log(root, `No se pudo dejar puesta la copia: ${problem && problem.message ? problem.message : problem}`);
    }
    lib.writeReport(root, {
      detail: `WILLY no arrancaba con su programa instalado (${first}) y arrancó solo con la copia buena anterior${restored ? ", que queda puesta" : ""}.`,
      restored,
      answering: true,
      fallback: candidate.dir,
    });
    lib.log(root, `Arrancado con la copia ${candidate.dir}${restored ? " (queda puesta para las próximas veces)" : ""}.`);
    return;
  }
  lib.log(root, "Ninguna copia buena pudo arrancar.");
  throw error;
}
