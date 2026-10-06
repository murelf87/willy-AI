import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, CheckCircle2, Code2, ExternalLink, LoaderCircle, Monitor, MousePointer2,
  RotateCcw, Save, Send, Smartphone, Sparkles, Tablet, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { chatLocalStream, resolveLocalModel, type ChatMsg } from "@/lib/local-ai";
import { useLocalModels } from "@/lib/use-local-models";
import { loadDraft, saveDraft } from "@/lib/persistent-state";
import { mergeFiles } from "@/lib/super-willy-projects";
import { openView } from "@/lib/background-tasks";
import { projectService, useProjects } from "@/services/project-service";
import { useSettings } from "@/lib/workspace-store";
import type { Ping } from "@/types/domain";

type Device = "desktop" | "tablet" | "mobile";
type Picked = { tag: string; text: string; id: string; classes: string; path: string; html: string };
type ChatLine = { id: string; role: "user" | "assistant"; text: string };

const WIDTHS: Record<Device, { label: string; width: number | null; icon: typeof Monitor }> = {
  desktop: { label: "Ordenador", width: null, icon: Monitor },
  tablet: { label: "Tableta", width: 768, icon: Tablet },
  mobile: { label: "Móvil", width: 390, icon: Smartphone },
};

const EMPTY_PREVIEW = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;margin:0}body{font-family:Inter,system-ui,sans-serif;display:grid;place-items:center;background:#f7f7fb;color:#525866}
main{text-align:center;max-width:520px;padding:32px}.mark{width:54px;height:54px;border-radius:16px;margin:0 auto 16px;display:grid;place-items:center;background:#111827;color:white;font-size:24px}
h1{font-size:24px;color:#111827;margin:0 0 8px}p{line-height:1.6;margin:0}
</style></head><body><main><div class="mark">✦</div><h1>Diseño IA · Open CoDesign</h1><p>Describe en el chat lo que quieres diseñar. La vista aparecerá aquí y podrás tocar cualquier elemento para cambiarlo.</p></main></body></html>`;

function cleanHtml(raw: string): string {
  let out = raw.trim();
  const startDoctype = out.toLowerCase().indexOf("<!doctype");
  const startHtml = out.toLowerCase().indexOf("<html");
  const start = startDoctype >= 0 ? startDoctype : startHtml;
  if (start >= 0) out = out.slice(start);
  out = out.replace(/^\`\`\`(?:html)?\s*/i, "").replace(/\s*\`\`\`\s*$/i, "");
  return out.trim();
}

function validHtml(value: string): boolean {
  return /<html[\s>]/i.test(value) && /<body[\s>]/i.test(value) && value.length > 180;
}

function selectorScript(enabled: boolean): string {
  return `<script>
(function(){
  var picking=${enabled ? "true" : "false"}, hover=null, chosen=null;
  function pathOf(el){var a=[];while(el&&el.nodeType===1&&a.length<7){var s=el.tagName.toLowerCase();if(el.id){s+='#'+el.id;a.unshift(s);break}var p=el.parentElement;if(p){var same=Array.prototype.filter.call(p.children,function(x){return x.tagName===el.tagName});if(same.length>1)s+=':nth-of-type('+(same.indexOf(el)+1)+')'}a.unshift(s);el=p}return a.join(' > ')}
  function clearHover(){if(hover&&hover!==chosen){hover.style.outline=hover.dataset.willyOutline||'';hover.style.outlineOffset=hover.dataset.willyOutlineOffset||''}hover=null}
  function mark(el,kind){if(!el||el===document.body||el===document.documentElement)return;clearHover();hover=el;if(!el.dataset.willyOutline)el.dataset.willyOutline=el.style.outline||'';if(!el.dataset.willyOutlineOffset)el.dataset.willyOutlineOffset=el.style.outlineOffset||'';el.style.outline=kind==='chosen'?'3px solid #7c3aed':'2px solid #3b82f6';el.style.outlineOffset='2px'}
  document.addEventListener('mouseover',function(e){if(picking)mark(e.target,'hover')},true);
  document.addEventListener('mouseout',function(){if(picking)clearHover()},true);
  document.addEventListener('click',function(e){if(!picking)return;e.preventDefault();e.stopPropagation();if(chosen){chosen.style.outline=chosen.dataset.willyOutline||'';chosen.style.outlineOffset=chosen.dataset.willyOutlineOffset||''}chosen=e.target;mark(chosen,'chosen');picking=false;parent.postMessage({type:'willy-codesign-picked',payload:{tag:chosen.tagName.toLowerCase(),text:(chosen.innerText||chosen.textContent||'').trim().slice(0,240),id:chosen.id||'',classes:typeof chosen.className==='string'?chosen.className.slice(0,240):'',path:pathOf(chosen),html:chosen.outerHTML.slice(0,1400)}},'*')},true);
  window.addEventListener('message',function(e){if(!e.data||e.data.type!=='willy-codesign-picking')return;picking=!!e.data.enabled;if(!picking)clearHover()});
})();
<\/script>`;
}

function withSelector(html: string, enabled: boolean): string {
  const script = selectorScript(enabled);
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, script + "</body>") : html + script;
}

function systemPrompt(selected: Picked | null): string {
  return [
    "Eres el motor de diseño de Open CoDesign integrado dentro de WILLY AI.",
    "Tu trabajo es diseñar interfaces web profesionales, completas y visualmente excelentes.",
    "Devuelve EXCLUSIVAMENTE un documento HTML completo, empezando por <!doctype html>. Sin markdown, sin explicación y sin bloques de código.",
    "El HTML debe ser autónomo: CSS y JavaScript dentro del mismo archivo. No dependas de paquetes npm.",
    "Debe funcionar de verdad: navegación, botones, menús, formularios, modales y estados interactivos cuando sean pertinentes.",
    "Diseña mobile-first y responsive para 390, 768, 1280 y 1920 px. Nada puede salirse de pantalla.",
    "Cuida jerarquía, tipografía, espaciado, contraste, estados hover/focus, accesibilidad y aspecto premium. Evita plantillas genéricas.",
    "No inventes funcionalidades que contradigan el encargo. Si ya existe un HTML, conserva todo lo que no se haya pedido cambiar.",
    selected ? "Hay un elemento seleccionado. Cambia prioritariamente ese elemento y solo toca otras zonas si es imprescindible para mantener coherencia o funcionamiento." : "",
  ].filter(Boolean).join("\n");
}

function describeSelection(p: Picked): string {
  return [p.tag, p.id ? `#${p.id}` : "", p.classes ? `.${p.classes.split(/\s+/).slice(0, 3).join(".")}` : "", p.text ? `“${p.text}”` : ""].filter(Boolean).join(" ");
}

export function OpenCoDesignView({ ping }: { ping: Ping }) {
  const [settings] = useSettings();
  const { projects } = useProjects();
  const active = useMemo(
    () => (settings.projectId ? projects.find((p) => p.id === settings.projectId) : undefined)
      ?? (settings.project ? projects.find((p) => p.name === settings.project) : undefined),
    [projects, settings.projectId, settings.project],
  );
  const storageKey = `open-codesign:html:${active?.id ?? "scratch"}`;
  const [html, setHtml] = useState("");
  const [liveHtml, setLiveHtml] = useState("");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [status, setStatus] = useState<{ installed: boolean; configured: boolean; ollama?: { online: boolean; models: string[] } } | null>(null);
  const { models, engine } = useLocalModels(settings.endpoint);
  const [model, setModel] = useState("qwen2.5-coder:7b");
  const iframe = useRef<HTMLIFrameElement>(null);
  const htmlRef = useRef("");
  const lastPreviewAt = useRef(0);

  useEffect(() => {
    const stored = loadDraft<string>(storageKey);
    setHtml(stored ?? "");
    setLiveHtml(stored ?? "");
    htmlRef.current = stored ?? "";
    setPicked(null);
    setMessages([]);
  }, [storageKey]);

  useEffect(() => {
    if (models.length && !models.includes(model)) {
      setModel(models.includes("qwen2.5-coder:7b") ? "qwen2.5-coder:7b" : models[0]!);
    }
  }, [models, model]);

  useEffect(() => {
    void fetch("/api/open-codesign").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!event.data || event.data.type !== "willy-codesign-picked") return;
      const value = event.data.payload as Picked;
      setPicked(value);
      setPicking(false);
      ping(`Seleccionado: ${describeSelection(value)}`);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [ping]);

  const preview = withSelector(liveHtml || html || EMPTY_PREVIEW, picking);
  const width = WIDTHS[device].width;

  const startPicking = () => {
    if (!htmlRef.current) {
      ping("Primero crea un diseño.");
      return;
    }
    setPicking((current) => {
      const next = !current;
      iframe.current?.contentWindow?.postMessage({ type: "willy-codesign-picking", enabled: next }, "*");
      return next;
    });
  };

  const submit = async (text = prompt) => {
    const request = text.trim();
    if (!request || busy) return;
    setPrompt("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: request }]);
    setBusy(true);

    try {
      const chosenModel = await resolveLocalModel(settings.endpoint, model || "qwen2.5-coder:7b");
      if (chosenModel !== model) setModel(chosenModel);
      const current = htmlRef.current;
      const context = current
        ? `HTML ACTUAL (debes devolverlo completo con el cambio aplicado):\n${current.slice(0, 60_000)}`
        : "No hay diseño anterior. Crea la primera versión completa.";
      const selection = picked
        ? `\nELEMENTO SELECCIONADO:\nRuta: ${picked.path}\nEtiqueta: ${picked.tag}\nTexto: ${picked.text}\nHTML: ${picked.html}`
        : "";
      const msgs: ChatMsg[] = [
        { role: "system", content: systemPrompt(picked) },
        { role: "user", content: `${request}\n\n${context}${selection}` },
      ];
      let raw = "";
      const answer = await chatLocalStream({
        endpoint: settings.endpoint,
        model: chosenModel,
        messages: msgs,
        temperature: 0.25,
        maxOutputTokens: 10_000,
        numCtx: 32_768,
        onDelta: (delta) => {
          raw += delta;
          const now = Date.now();
          if (now - lastPreviewAt.current < 260) return;
          lastPreviewAt.current = now;
          const partial = cleanHtml(raw);
          if (partial.length > 220 && /<html[\s>]/i.test(partial)) setLiveHtml(partial);
        },
      });
      const next = cleanHtml(answer);
      if (!validHtml(next)) throw new Error("La IA no devolvió un HTML completo. Vuelve a enviar la instrucción.");
      htmlRef.current = next;
      setHtml(next);
      setLiveHtml(next);
      saveDraft(storageKey, next);
      setPicked(null);
      setPicking(false);
      setMessages((m) => [...m, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: current ? "Cambio aplicado. La vista previa ya muestra la nueva versión." : "Primera versión creada. Puedes seleccionar cualquier elemento y pedirme cambios.",
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo generar el diseño.";
      setLiveHtml(htmlRef.current);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text: `Error: ${message}` }]);
      ping(`⚠️ ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveToProject = async () => {
    if (!active) {
      ping("Abre o crea un proyecto antes de guardar el diseño.");
      return;
    }
    if (!htmlRef.current) {
      ping("Todavía no hay ningún diseño que guardar.");
      return;
    }
    const project = await projectService.get(active.id);
    if (!project) {
      ping("No encuentro el proyecto activo.");
      return;
    }
    const nextFiles = mergeFiles(project.files, [
      { path: "vista-previa.html", lang: "html", content: htmlRef.current },
      {
        path: "docs/open-codesign.md",
        lang: "md",
        content: `# Diseño IA · Open CoDesign\n\n- Modelo local: ${model}\n- Proveedor: Ollama local\n- Coste API: 0 €\n- Última actualización: ${new Date().toISOString()}\n\nLa vista principal editable se guarda en \x60vista-previa.html\x60.\n`,
      },
    ]);
    const result = await projectService.saveFiles(active.id, nextFiles, "Diseño IA · Open CoDesign");
    ping(result.ok ? `Diseño guardado como nueva versión de «${active.name}».` : `⚠️ ${result.error}`);
  };

  const openDesktop = async () => {
    try {
      const r = await fetch("/api/open-codesign", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = (await r.json()) as { ok?: boolean; error?: string };
      ping(data.ok ? "Open CoDesign abierto en tu PC." : `⚠️ ${data.error ?? "No se pudo abrir."}`);
    } catch {
      ping("⚠️ No se pudo abrir Open CoDesign.");
    }
  };

  const reset = () => {
    if (!window.confirm("¿Vaciar el lienzo de Diseño IA? El proyecto guardado no se borra.")) return;
    htmlRef.current = "";
    setHtml("");
    setLiveHtml("");
    setPicked(null);
    setMessages([]);
    saveDraft(storageKey, "");
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h1 className="truncate text-sm font-bold">Diseño IA · Open CoDesign</h1>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">LOCAL · GRATIS</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {active ? `Proyecto: ${active.name}` : "Lienzo libre"} · {engine === "ok" ? `Ollama · ${model}` : "Ollama sin conexión"}
          </p>
        </div>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="h-8 max-w-48 rounded-md border border-border bg-background px-2 text-xs" aria-label="Modelo de diseño">
          {models.length ? models.map((name) => <option key={name} value={name}>{name}</option>) : <option value={model}>{model}</option>}
        </select>
        <Button variant={picking ? "default" : "secondary"} size="sm" onClick={startPicking} className="gap-1.5">
          <MousePointer2 className="size-3.5" />{picking ? "Toca un elemento…" : "Seleccionar"}
        </Button>
        <Button variant="secondary" size="sm" onClick={saveToProject} className="gap-1.5"><Save className="size-3.5" />Guardar</Button>
        <Button variant="secondary" size="sm" onClick={openDesktop} className="gap-1.5" disabled={status?.installed === false}>
          <ExternalLink className="size-3.5" />Open CoDesign
        </Button>
        <Button variant="ghost" size="icon" onClick={reset} aria-label="Vaciar lienzo" title="Vaciar lienzo"><RotateCcw className="size-4" /></Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-[280px] flex-col border-b border-border bg-card lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold"><Bot className="size-4 text-primary" />Chat de diseño</div>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Describe una pantalla o selecciona algo en la vista para cambiar solo esa parte.</p>
          </div>

          {picked && (
            <div className="m-2 rounded-lg border border-primary/30 bg-primary/5 p-2 text-[11px]">
              <div className="flex items-start gap-2">
                <MousePointer2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Elemento seleccionado</p>
                  <p className="mt-0.5 truncate text-muted-foreground">{describeSelection(picked)}</p>
                </div>
                <button onClick={() => setPicked(null)} aria-label="Quitar selección"><X className="size-3.5" /></button>
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 && (
              <div className="space-y-2 text-[11px] text-muted-foreground">
                <p className="rounded-lg bg-muted/60 p-2.5">Puedes empezar con: “Diseña el dashboard completo de mi app con menú lateral, métricas y actividad reciente”.</p>
                <div className="flex flex-wrap gap-1.5">
                  {["Más premium", "Hazlo más limpio", "Mejora el móvil", "Más contraste"].map((q) => (
                    <button key={q} onClick={() => setPrompt(q)} className="rounded-full border border-border px-2 py-1 hover:bg-accent">{q}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`rounded-xl px-3 py-2 text-xs leading-5 ${m.role === "user" ? "ml-5 bg-primary text-primary-foreground" : "mr-5 bg-muted"}`}>
                {m.text}
              </div>
            ))}
            {busy && <div className="mr-5 flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs"><LoaderCircle className="size-3.5 animate-spin" />Diseñando y actualizando la vista…</div>}
          </div>

          <div className="border-t border-border p-2.5">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
              placeholder={picked ? "¿Qué quieres cambiar en este elemento?" : "Describe qué quieres diseñar o cambiar…"}
              className="min-h-20 w-full resize-none rounded-lg border border-border bg-background p-2.5 text-xs outline-none focus:border-primary"
              disabled={busy}
            />
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" className="flex-1 gap-1.5" disabled={busy || !prompt.trim()} onClick={() => void submit()}>
                {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {html ? "Aplicar cambio" : "Crear diseño"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openView("superia")} title="Abrir proyecto en Súper IA"><Code2 className="size-3.5" /></Button>
            </div>
          </div>
        </aside>

        <main className="flex min-h-[440px] min-w-0 flex-col bg-muted/30 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
            <span className="text-xs font-semibold">Vista previa en vivo</span>
            <span className="flex items-center gap-1 text-[10px] text-emerald-600"><CheckCircle2 className="size-3" />Interactiva</span>
            <div className="ml-auto flex items-center rounded-md border border-border bg-background p-0.5">
              {(Object.keys(WIDTHS) as Device[]).map((key) => {
                const item = WIDTHS[key];
                const Icon = item.icon;
                return (
                  <button key={key} onClick={() => setDevice(key)} className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${device === key ? "bg-accent font-semibold" : "text-muted-foreground"}`} title={item.label}>
                    <Icon className="size-3.5" /><span className="hidden sm:inline">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2 sm:p-4">
            <div
              className="mx-auto h-full min-h-[400px] overflow-hidden rounded-xl border border-border bg-white shadow-sm transition-[width] duration-200"
              style={{ width: width ? `${width}px` : "100%", maxWidth: "100%" }}
            >
              <iframe
                ref={iframe}
                title="Vista previa del diseño"
                srcDoc={preview}
                sandbox="allow-scripts allow-forms allow-modals allow-popups"
                className="h-full min-h-[400px] w-full bg-white"
                onLoad={() => iframe.current?.contentWindow?.postMessage({ type: "willy-codesign-picking", enabled: picking }, "*")}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
