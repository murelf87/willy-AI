// HERRAMIENTAS · Tool Center (diseño de 24/09): todo lo que WILLY puede hacer, organizado por categorías, con búsqueda,
// favoritas y recientes. Cada tarjeta abre la pantalla REAL de esa función (o deja el encargo escrito en el Chat); lo que
// todavía no existe se enseña como «no disponible» con el motivo, sin fingir. El registro está en tools-registry.ts.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, Clock3, LayoutGrid, Search, Star, X } from "lucide-react";
import { DataSourcesCard } from "@/components/data-sources-card";
import type { View } from "@/components/app-sections";
import { saveDraft, usePersistentState } from "@/lib/persistent-state";
import { relativeTime } from "@/lib/project-progress";
import type { Ping } from "@/types/domain";
import {
  CATEGORIES, TOOLS, TOOLS_EVENT, availableCount, readFavorites, readRecent, recordToolUse, toggleFavorite, toolById, toolsOf,
  type Tool, type ToolCategoryId,
} from "@/front/tools-registry";

export type HerramientasProps = {
  ping: Ping;
  onNav: (view: View, tab?: string) => void;
  onNewProject: () => void;
  /** Abre el Chat con el texto ya escrito (y lo envía si `autoSend`). */
  onOpenChat: (text: string, autoSend: boolean) => void;
};

type Filter = "todas" | "favoritas" | ToolCategoryId;

const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

const AVAIL_BADGE: Record<Tool["availability"], { text: string; cls: string } | null> = {
  disponible: null,
  pendiente: { text: "Pendiente", cls: "bg-warning/20 text-amber-700 dark:text-amber-300" },
  "no-disponible": { text: "Todavía no disponible", cls: "bg-muted text-muted-foreground" },
};

function useToolsState(): { favorites: string[]; recent: Array<{ id: string; at: number }> } {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<Array<{ id: string; at: number }>>([]);
  useEffect(() => {
    const sync = () => { setFavorites(readFavorites()); setRecent(readRecent()); };
    sync();
    window.addEventListener(TOOLS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(TOOLS_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return { favorites, recent };
}

function ToolCard({ tool, favorite, onRun, onFavorite }: { tool: Tool; favorite: boolean; onRun: () => void; onFavorite: () => void }) {
  const Icon = tool.icon;
  const badge = AVAIL_BADGE[tool.availability];
  const off = tool.availability !== "disponible";
  return (
    <div className={`group relative flex flex-col gap-2 rounded-2xl border bg-card p-4 text-left shadow-card ${off ? "border-dashed border-border" : "border-border hover:border-primary/40"}`}>
      <button type="button" onClick={onRun} className="flex flex-1 flex-col items-start gap-2 text-left" aria-describedby={off ? `nota-${tool.id}` : undefined} title={off ? tool.note : undefined}>
        <span className={`grid size-11 place-items-center rounded-xl ${off ? "bg-muted text-muted-foreground" : "bg-accent text-primary"}`}><Icon className="size-5" /></span>
        <span className="text-[15px] font-bold leading-tight">{tool.name}</span>
        <span className="text-xs leading-snug text-muted-foreground">{tool.desc}</span>
        {badge && <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.text}</span>}
        {off && tool.note && <span id={`nota-${tool.id}`} className="sr-only">{tool.note}</span>}
      </button>
      <button type="button" onClick={onFavorite} aria-label={favorite ? `Quitar ${tool.name} de favoritas` : `Añadir ${tool.name} a favoritas`} aria-pressed={favorite}
        className={`absolute right-3 top-3 grid size-8 place-items-center rounded-lg ${favorite ? "text-warning" : "text-muted-foreground/60 opacity-0 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"}`}>
        <Star className={`size-4 ${favorite ? "fill-current" : ""}`} />
      </button>
    </div>
  );
}

export function HerramientasScreen({ ping, onNav, onNewProject, onOpenChat }: HerramientasProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = usePersistentState<Filter>("front:herramientas:filtro", "todas");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const { favorites, recent } = useToolsState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);

  const run = (tool: Tool) => {
    if (tool.availability !== "disponible" || !tool.action) { ping(`«${tool.name}»: ${tool.note ?? "todavía no disponible."}`); return; }
    recordToolUse(tool.id);
    const a = tool.action;
    if (a.kind === "view") {
      if (a.draftKey && a.tab) saveDraft(a.draftKey, a.tab);
      onNav(a.view as View, a.tab);
    } else if (a.kind === "chat") onOpenChat(a.text, a.autoSend ?? false);
    else if (a.kind === "nuevo-proyecto") onNewProject();
    else if (a.kind === "fuentes-datos") setSourcesOpen(true);
  };

  const q = norm(query.trim());
  const searching = q.length > 0;
  const matches = useMemo(() => TOOLS.filter((t) => !q || norm(`${t.name} ${t.desc} ${t.categories.map((c) => CATEGORIES.find((x) => x.id === c)?.name ?? c).join(" ")}`).includes(q)), [q]);
  const favoriteTools = favorites.map(toolById).filter((t): t is Tool => Boolean(t));
  const recentTools = recent.map((r) => ({ tool: toolById(r.id), at: r.at })).filter((r): r is { tool: Tool; at: number } => Boolean(r.tool)).slice(0, 6);
  const category = filter !== "todas" && filter !== "favoritas" ? CATEGORIES.find((c) => c.id === filter) ?? null : null;
  const listed: Tool[] = searching ? matches : filter === "favoritas" ? favoriteTools : category ? toolsOf(category.id) : [];
  const chips: Array<[Filter, string]> = [["todas", "Todas"], ...CATEGORIES.map((c): [Filter, string] => [c.id, c.short])];

  return (
    <section className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-background" aria-label="Herramientas">
      <div className="mx-auto w-full max-w-[1240px] px-4 pb-8 pt-5 sm:px-6">
        {/* Cabecera */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-primary"><LayoutGrid className="size-6" /></span>
            <div className="min-w-0">
              <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tight">Herramientas</h1>
              <p className="truncate text-sm text-muted-foreground">Todo lo que WILLY puede hacer, organizado para ti.</p>
            </div>
          </div>
          <button type="button" onClick={() => setFilter(filter === "favoritas" ? "todas" : "favoritas")} aria-pressed={filter === "favoritas"}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold ${filter === "favoritas" ? "border-primary bg-accent text-primary" : "border-border bg-card text-foreground hover:border-primary/40"}`}>
            <Star className={`size-4 ${filter === "favoritas" ? "fill-current" : ""}`} />Mis favoritas
          </button>
        </div>

        <label className="mb-3 flex items-center gap-2 rounded-2xl border border-border bg-card px-4 shadow-card">
          <Search className="size-4 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar herramienta o capacidad..." aria-label="Buscar herramienta o capacidad" className="h-12 w-full bg-transparent text-[15px] outline-none" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X className="size-4 text-muted-foreground" /></button>}
        </label>

        <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Categorías">
          {chips.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => { setFilter(id); setQuery(""); }}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${filter === id && !searching ? "bg-primary text-primary-foreground shadow-glow" : "border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>

        {sourcesOpen && (
          <div className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-bold">Fuentes de datos en tiempo real</h2>
              <button type="button" onClick={() => setSourcesOpen(false)} aria-label="Cerrar fuentes de datos" className="grid size-8 place-items-center rounded-lg hover:bg-accent"><X className="size-4" /></button>
            </div>
            <DataSourcesCard ping={ping} />
          </div>
        )}

        {/* Resultado de búsqueda, favoritas o una categoría */}
        {(searching || filter !== "todas") && (
          <div className="mb-6">
            <div className="mb-3 flex items-center gap-2">
              {!searching && <button type="button" onClick={() => setFilter("todas")} className="grid size-8 place-items-center rounded-lg border border-border hover:bg-accent" aria-label="Volver a todas las categorías"><ChevronLeft className="size-4" /></button>}
              <h2 className="text-[15px] font-bold">{searching ? `Resultados para «${query.trim()}»` : filter === "favoritas" ? "Favoritas" : category?.name}</h2>
              {category && <span className="text-xs text-muted-foreground">{category.desc}</span>}
            </div>
            {listed.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                {searching ? "Ninguna herramienta coincide." : filter === "favoritas" ? "Todavía no has marcado favoritas: pulsa la estrella de cualquier herramienta." : "No hay herramientas en esta categoría."}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {listed.map((t) => <ToolCard key={t.id} tool={t} favorite={favorites.includes(t.id)} onRun={() => run(t)} onFavorite={() => toggleFavorite(t.id)} />)}
            </div>
          </div>
        )}

        {!searching && filter === "todas" && (
          <>
            {/* Favoritas */}
            <div className="mb-6">
              <h2 className="mb-3 text-[15px] font-bold">Favoritas</h2>
              {favoriteTools.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Marca con la estrella las herramientas que más uses y aparecerán aquí.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {favoriteTools.slice(0, 8).map((t) => <ToolCard key={t.id} tool={t} favorite onRun={() => run(t)} onFavorite={() => toggleFavorite(t.id)} />)}
                </div>
              )}
            </div>

            {/* Categorías */}
            <div className="mb-6">
              <h2 className="mb-3 text-[15px] font-bold">Categorías</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {CATEGORIES.filter((c) => c.id !== "automatizacion").map((c) => {
                  const n = availableCount(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => setFilter(c.id)} className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 text-left shadow-card hover:border-primary/40">
                      <span className="grid size-11 place-items-center rounded-xl bg-accent text-primary"><c.icon className="size-5" /></span>
                      <span className="text-[15px] font-bold leading-tight">{c.name}</span>
                      <span className="text-xs leading-snug text-muted-foreground">{c.desc}</span>
                      <span className="mt-auto text-xs font-semibold text-primary">
                        {n.available > 0 ? `${n.available} herramienta${n.available === 1 ? "" : "s"}` : "Todavía no disponible"}
                        {n.pending > 0 ? ` · ${n.pending} pendiente${n.pending === 1 ? "" : "s"}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recientes */}
            <div className="mb-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[15px] font-bold">Recientes</h2>
                {recentTools.length > 0 && <button type="button" onClick={() => setFilter("todas")} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Ver todas <ArrowRight className="size-3.5" /></button>}
              </div>
              {recentTools.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Aquí verás las últimas herramientas que hayas usado.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                  {recentTools.map(({ tool, at }) => (
                    <button key={tool.id} type="button" onClick={() => run(tool)} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-card hover:border-primary/40">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-primary"><tool.icon className="size-4" /></span>
                      <span className="min-w-0"><span className="block truncate text-sm font-bold">{tool.name}</span><span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="size-3" />{relativeTime(new Date(at).toISOString(), now).toLowerCase()}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
