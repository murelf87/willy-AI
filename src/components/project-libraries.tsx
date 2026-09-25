// LIBRERÍAS QUE FALTAN EN UN PROYECTO (rediseño, revisión 27). Cuando un proyecto React no compila porque usa una librería que
// WILLY no trae (framer-motion, react-router-dom, chart.js…), WILLY mira qué es (si existe, si es conocida, si el proyecto la
// pide en su package.json) y, si se puede, LA INSTALA SOLA en tu equipo —sin npm, comprobando su huella— y vuelve a compilar.
// Si no se puede instalar sola (poco conocida, no declarada…), se explica y se puede instalar con un botón o pedir a WILLY que
// la sustituya. También la lista de las instaladas, con lo que ocupan y «Quitar».

import { useEffect, useRef, useState } from "react";
import { Loader2, Package, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { missingText } from "@/lib/project-compile";
import { bytesLabel, installSummary, libraryInfoLine, type InstallResult, type LibraryInfo, type LibraryList } from "@/lib/project-libraries";
import { fetchProjectLibraries, inspectProjectLibraries, installProjectLibraries, removeProjectLibrary } from "@/services/disk-project-service";

export type LibraryPhase = "nada" | "consultando" | "instalando" | "hecho" | "error";
export type ProjectLibraries = {
  phase: LibraryPhase;
  /** Las librerías que faltan en la última compilación. */
  missing: string[];
  infos: LibraryInfo[];
  result: InstallResult | null;
  error: string | null;
  /** Consultando o instalando: la vista previa espera (y la reparación automática también). */
  busy: boolean;
  install: (names: string[]) => void;
};

const keyOf = (projectId: string, missing: string[]): string => `${projectId}|${[...missing].sort().join(",")}`;

/**
 * Lo que falta en la última compilación: se consulta al registro de npm y, con `auto`, se instala SOLO lo que se puede instalar
 * sola (declarada en el package.json del proyecto y conocida). Cada conjunto de librerías se intenta una sola vez (si después de
 * instalar sigue faltando algo, no se entra en un bucle): lo demás, con el botón. `onInstalled` vuelve a compilar.
 */
export function useProjectLibraries(projectId: string, missing: string[], failedCompile: string | null, opts: { auto: boolean; onInstalled: () => void; onResult?: (r: InstallResult) => void }): ProjectLibraries {
  const [phase, setPhase] = useState<LibraryPhase>("nada");
  const [infos, setInfos] = useState<LibraryInfo[]>([]);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(new Set<string>());
  const current = useRef("");
  const latest = useRef(opts);
  latest.current = opts;
  // Un intento (instalar solas o volver a compilar) por cada conjunto de librerías que faltan; cada compilación fallida, otra consulta.
  const libsKey = missing.length ? keyOf(projectId, missing) : "";
  const key = libsKey ? `${libsKey}@${failedCompile ?? ""}` : "";

  const install = (names: string[], auto = false) => {
    const k = current.current;
    if (!names.length) return;
    setPhase("instalando");
    setError(null);
    void installProjectLibraries(projectId, names, { auto }).then((r) => {
      if (current.current !== k) return;
      if (!r.ok) { setPhase("error"); setError(r.error); return; }
      setResult(r.data);
      latest.current.onResult?.(r.data);
      // «hecho» = instalada: se espera a la compilación nueva (hasta entonces la vista previa sigue «compilando»).
      const done = r.data.packages > 0 || r.data.items.some((i) => i.status === "instalada" || i.status === "ya-estaba");
      setPhase(done ? "hecho" : "nada");
      if (done) latest.current.onInstalled();
    });
  };

  useEffect(() => {
    current.current = key;
    setResult(null);
    setError(null);
    if (!key) { setPhase("nada"); setInfos([]); return; }
    setPhase("consultando");
    let alive = true;
    void inspectProjectLibraries(projectId, missing).then((r) => {
      if (!alive || current.current !== key) return;
      if (!r.ok) { setInfos([]); setPhase("error"); setError(r.error); return; }
      setInfos(r.data);
      const auto = r.data.filter((i) => i.auto.ok).map((i) => i.name);
      // Ya instaladas (o que trae WILLY) pero la compilación no las vio (por ejemplo, se instalaron en otra pestaña): compilar otra vez.
      const alreadyThere = r.data.length > 0 && r.data.every((i) => i.installed || i.provided);
      if (alreadyThere && !tried.current.has(libsKey)) { tried.current.add(libsKey); setPhase("hecho"); latest.current.onInstalled(); return; }
      if (latest.current.auto && auto.length && !tried.current.has(libsKey)) {
        tried.current.add(libsKey);
        install(auto, true);
        return;
      }
      setPhase("nada");
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // «Ocupado» desde el PRIMER momento en que falta algo nuevo (antes de que el efecto empiece a consultar): así la vista previa
  // nunca dice «No compila» mientras WILLY todavía no ha mirado si se puede instalar sola (y la reparación automática espera).
  const busy = key !== "" && (phase === "consultando" || phase === "instalando" || phase === "hecho" || current.current !== key);
  return { phase, missing, infos, result, error, busy, install: (names) => install(names, false) };
}

/**
 * El aviso de «faltan librerías» dentro de «El proyecto no compila»: qué es cada una, si se está instalando sola, el resultado y
 * los botones para instalar las que no se instalan solas.
 */
export function MissingLibrariesPanel({ lib, running, auto, onAuto, onShowInstalled }: {
  lib: ProjectLibraries; running: boolean; auto: boolean; onAuto: (on: boolean) => void; onShowInstalled: () => void;
}) {
  const installable = lib.infos.filter((i) => i.valid && i.exists === true && !i.provided && !i.installed && i.version);
  return (
    <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5" aria-label="Librerías que faltan">
      <p data-faltan-librerias>{missingText(lib.missing)}</p>
      {lib.phase === "consultando" && <p className="mt-1 flex items-center gap-1.5 text-muted-foreground" data-librerias-estado="consultando"><Loader2 className="size-3.5 animate-spin" />Mirando en npm qué son y si se pueden instalar solas…</p>}
      {lib.phase === "instalando" && <p className="mt-1 flex items-center gap-1.5 font-semibold" data-librerias-estado="instalando"><Loader2 className="size-3.5 animate-spin" />Instalando en tu equipo (sin npm, comprobando cada archivo)…</p>}
      {lib.infos.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs" aria-label="Qué es cada librería">
          {lib.infos.map((i) => <li key={i.name} className="break-words">{libraryInfoLine(i)}{i.auto.ok ? "" : i.provided || i.installed || i.exists === false || !i.valid ? "" : ` No se instala sola: ${i.auto.reason}.`}</li>)}
        </ul>
      )}
      {lib.result && <p className="mt-1 text-xs font-semibold" data-librerias-resultado>{installSummary(lib.result)}</p>}
      {lib.result && lib.result.warnings.length > 0 && (
        <ul className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground" aria-label="Avisos de la instalación">
          {lib.result.warnings.slice(0, 4).map((w, n) => <li key={n}>{w}</li>)}
        </ul>
      )}
      {lib.error && <p className="mt-1 text-xs text-destructive" data-librerias-error>No se ha podido consultar o instalar: {lib.error}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {installable.length > 0 && (
          <Button size="sm" variant="secondary" className="h-7 gap-1.5 px-2 text-xs" disabled={lib.busy || running} onClick={() => lib.install(installable.map((i) => i.name))}>
            <Package className="size-3.5" />{installable.length === 1 ? `Instalar «${installable[0]!.name}»` : `Instalar las ${installable.length}`}
          </Button>
        )}
        <button type="button" className="text-xs underline underline-offset-2" onClick={onShowInstalled}>Librerías instaladas</button>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={auto} onChange={(e: { target: { checked: boolean } }) => onAuto(e.target.checked)} />
          Instalar solas las conocidas que pida el proyecto
        </label>
      </div>
    </div>
  );
}

/** Las librerías instaladas para los proyectos: qué son, cuánto ocupan y «Quitar» (lo que usan otras se queda). */
export function InstalledLibrariesDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<LibraryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEscapeToClose(onClose);
  const load = () => { void fetchProjectLibraries().then((r) => { if (r.ok) { setList(r.data); setError(null); } else setError(r.error); }); };
  useEffect(load, []);
  const remove = (name: string) => {
    setRemoving(name);
    void removeProjectLibrary(name).then((r) => {
      setRemoving(null);
      if (!r.ok) { setError(r.error); return; }
      setNote(`«${name}» quitada${r.data.removed > 1 ? ` (con ${r.data.removed - 1} que solo usaba ella)` : ""}: ${bytesLabel(r.data.bytes)} menos.`);
      onChanged();
      load();
    });
  };
  return (
    <div className="safe-modal fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-label="Librerías instaladas para los proyectos">
      <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl border border-border bg-card p-4 text-sm shadow-xl">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-primary" />
          <h2 className="font-semibold">Librerías instaladas para los proyectos</h2>
          <button type="button" className="ml-auto rounded p-1 hover:bg-accent" aria-label="Cerrar" onClick={onClose}><X className="size-4" /></button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Las instala WILLY desde npm (sin npm, comprobando su huella y sin ejecutar nada de ellas) cuando un proyecto las necesita. Están en «datos-privados/librerias-proyectos»: ninguna actualización las toca.</p>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        {note && <p className="mt-2 text-xs font-semibold">{note}</p>}
        {!list && !error && <p className="mt-3 flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Leyendo…</p>}
        {list && (list.libraries.length === 0 ? (
          <p className="mt-3 text-muted-foreground" data-sin-librerias>Todavía no hay ninguna: los proyectos usan solo las que trae WILLY.</p>
        ) : (
          <>
            <p className="mt-3 text-xs text-muted-foreground">{list.libraries.length} librería(s), {list.packages} paquete(s) en total, {bytesLabel(list.totalBytes)}.</p>
            <ul className="mt-1 divide-y divide-border" aria-label="Librerías instaladas">
              {list.libraries.map((l) => (
                <li key={l.name} className="flex items-center gap-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-semibold">{l.name} <span className="font-normal text-muted-foreground">{l.version}</span></p>
                    <p className="text-[11px] text-muted-foreground">{l.packages} paquete(s), {bytesLabel(l.bytes)} · pedida «{l.range}»</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" disabled={removing !== null} aria-label={`Quitar ${l.name}`} onClick={() => remove(l.name)}>
                    {removing === l.name ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}Quitar
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ))}
      </div>
    </div>
  );
}
