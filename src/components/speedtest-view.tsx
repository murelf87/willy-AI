import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowUp, Check, Clock3, Copy, Download, Gauge, Globe2, History, Loader2, Network, Play, RotateCcw, ShieldCheck, Signal, Timer, Wifi, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard as Card } from "@/components/panel-card";
import type { Ping } from "@/types/domain";

type NetworkInfo = { ip:string; country:string; edge:string; adapter?:{ name:string; description:string; linkSpeed:string } };
type Latency = { latencyMs:number; jitterMs:number; p95Ms:number; lossPct:number|null; samples:number[]; lossMethod:string };
type Throughput = { mbps:number; bytes:number; durationMs:number; streams:number; provider:string };
type Quality = { grade:string; stability:number; uses:{ browsing:boolean; streaming4k:boolean; videoCalls:boolean; gaming:boolean } };
type Result = { id:string; at:string; info:NetworkInfo; latency:Latency; download:Throughput; upload:Throughput; quality:Quality };
type Stage = "idle"|"info"|"latency"|"download"|"upload"|"quality"|"done"|"error";

const HISTORY_KEY = "willy:speedtest:history:v1";

async function post<T>(action:string, extra:Record<string,unknown>={}, signal?:AbortSignal):Promise<T>{
  const res=await fetch("/api/speedtest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...extra}),...(signal?{signal}:{})});
  const data=await res.json() as {ok?:boolean;error?:string}&T;
  if(!res.ok||data.ok===false) throw new Error(data.error||`Error HTTP ${res.status}`);
  return data as T;
}

const bytesText=(n:number)=>{
  if(n>=1_000_000_000)return `${(n/1_000_000_000).toFixed(1)} GB`;
  if(n>=1_000_000)return `${(n/1_000_000).toFixed(1)} MB`;
  return `${Math.round(n/1000)} KB`;
};

function readHistory():Result[]{
  try{const v=JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]") as Result[];return Array.isArray(v)?v.slice(0,20):[];}catch{return[];}
}
function saveHistory(items:Result[]){try{localStorage.setItem(HISTORY_KEY,JSON.stringify(items.slice(0,20)));}catch{/* sin espacio */}}

function useElapsed(running:boolean){
  const [started,setStarted]=useState(0); const [now,setNow]=useState(0);
  useEffect(()=>{if(!running){setStarted(0);setNow(0);return;}const s=Date.now();setStarted(s);setNow(s);const t=window.setInterval(()=>setNow(Date.now()),100);return()=>window.clearInterval(t);},[running]);
  return started?Math.max(0,(now-started)/1000):0;
}

function dialMax(v:number){ if(v<=100)return 100;if(v<=500)return 500;if(v<=1000)return 1000;if(v<=2500)return 2500;return Math.ceil(v/1000)*1000; }

function SpeedGauge({value,label,active=false}:{value:number|null;label:string;active?:boolean}){
  const safe=Math.max(0,value??0); const max=dialMax(safe); const frac=Math.min(1,safe/max); const angle=-90+frac*180;
  return <div className="relative mx-auto w-full max-w-[420px]">
    <svg viewBox="0 0 240 165" className="w-full overflow-visible" role="img" aria-label={`${label}: ${value==null?"midiendo":`${value} Mbps`}`}>
      <path d="M30 130 A90 90 0 0 1 210 130" fill="none" stroke="currentColor" strokeWidth="13" strokeLinecap="round" className="text-muted/70"/>
      <path d="M30 130 A90 90 0 0 1 210 130" fill="none" stroke="currentColor" strokeWidth="13" strokeLinecap="round" pathLength="100" strokeDasharray={`${frac*100} 100`} className={`text-primary transition-all duration-700 ${active?"drop-shadow-sm":""}`}/>
      {[0,.25,.5,.75,1].map((f)=><g key={f} transform={`rotate(${-90+f*180} 120 130)`}><line x1="120" y1="34" x2="120" y2="43" stroke="currentColor" strokeWidth="2" className="text-muted-foreground"/></g>)}
      <g transform={`rotate(${angle} 120 130)`} className="transition-transform duration-700">
        <line x1="120" y1="130" x2="120" y2="54" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" className="text-foreground"/>
      </g>
      <circle cx="120" cy="130" r="8" fill="currentColor" className="text-foreground"/>
      <text x="28" y="151" textAnchor="middle" className="fill-muted-foreground text-[9px]">0</text>
      <text x="120" y="26" textAnchor="middle" className="fill-muted-foreground text-[9px]">{Math.round(max/2)}</text>
      <text x="212" y="151" textAnchor="middle" className="fill-muted-foreground text-[9px]">{max}</text>
    </svg>
    <div className="absolute inset-x-0 bottom-2 text-center">
      <p className={`font-mono text-4xl font-black tracking-tight sm:text-5xl ${active?"animate-pulse":""}`}>{value==null?"—":value.toFixed(1)}</p>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Mbps · {label}</p>
    </div>
  </div>;
}

function Metric({icon:Icon,label,value,sub}:{icon:typeof Gauge;label:string;value:string;sub?:string}){
  return <div className="rounded-xl border border-border bg-background p-3">
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="size-3.5"/>{label}</div>
    <p className="mt-1 font-mono text-xl font-bold">{value}</p>{sub&&<p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
  </div>;
}

function UseBadge({ok,label}:{ok:boolean;label:string}){
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${ok?"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":"border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{ok?<Check className="size-3"/>:<Activity className="size-3"/>}{label}</span>;
}

function stageText(stage:Stage){
  if(stage==="info")return "Identificando la conexión"; if(stage==="latency")return "Midiendo ping, jitter y pérdida";
  if(stage==="download")return "Saturando descarga"; if(stage==="upload")return "Midiendo subida"; if(stage==="quality")return "Calculando estabilidad";
  if(stage==="done")return "Prueba completada"; if(stage==="error")return "Prueba interrumpida"; return "Preparado";
}

export function SpeedTestView({ping}:{ping:Ping}){
  const [stage,setStage]=useState<Stage>("idle"); const [error,setError]=useState("");
  const [info,setInfo]=useState<NetworkInfo|null>(null); const [latency,setLatency]=useState<Latency|null>(null);
  const [download,setDownload]=useState<Throughput|null>(null); const [upload,setUpload]=useState<Throughput|null>(null); const [quality,setQuality]=useState<Quality|null>(null);
  const [history,setHistory]=useState<Result[]>(()=>typeof window==="undefined"?[]:readHistory());
  const abortRef=useRef<AbortController|null>(null); const running=!["idle","done","error"].includes(stage); const elapsed=useElapsed(running);
  const shownSpeed=stage==="upload"?upload?.mbps??null:download?.mbps??null; const shownLabel=stage==="upload"?"subida":"descarga";

  useEffect(()=>{void post<{info:NetworkInfo}>("info").then((r)=>setInfo(r.info)).catch(()=>undefined);},[]);

  const reset=()=>{abortRef.current?.abort();setStage("idle");setError("");setLatency(null);setDownload(null);setUpload(null);setQuality(null);};
  const cancel=()=>{abortRef.current?.abort();setStage("error");setError("Prueba cancelada.");};

  const run=async()=>{
    const ctrl=new AbortController();abortRef.current=ctrl;setError("");setLatency(null);setDownload(null);setUpload(null);setQuality(null);
    try{
      setStage("info"); const i=await post<{info:NetworkInfo}>("info",{},ctrl.signal);setInfo(i.info);
      setStage("latency"); const l=await post<{result:Latency}>("latency",{samples:10},ctrl.signal);setLatency(l.result);
      setStage("download"); const d=await post<{result:Throughput}>("download",{},ctrl.signal);setDownload(d.result);
      setStage("upload"); const u=await post<{result:Throughput}>("upload",{},ctrl.signal);setUpload(u.result);
      setStage("quality"); const q=await post<{result:Quality}>("quality",{download:d.result.mbps,upload:u.result.mbps,latency:l.result.latencyMs,jitter:l.result.jitterMs,loss:l.result.lossPct},ctrl.signal);setQuality(q.result);
      const item:Result={id:crypto.randomUUID(),at:new Date().toISOString(),info:i.info,latency:l.result,download:d.result,upload:u.result,quality:q.result};
      setHistory((old)=>{const next=[item,...old].slice(0,20);saveHistory(next);return next;});
      setStage("done");ping(`Test terminado: ${d.result.mbps} Mbps ↓ · ${u.result.mbps} Mbps ↑ · ${l.result.latencyMs} ms.`);
    }catch(e){if(ctrl.signal.aborted){setStage("error");setError("Prueba cancelada.");return;}setStage("error");setError(e instanceof Error?e.message:"No se pudo completar la prueba.");}
  };

  const current=useMemo(()=>quality&&latency&&download&&upload&&info?{id:"current",at:new Date().toISOString(),quality,latency,download,upload,info}:null,[quality,latency,download,upload,info]);
  const copyResult=async()=>{if(!current)return;const t=`WILLY AI · Test de velocidad\nDescarga: ${current.download.mbps} Mbps\nSubida: ${current.upload.mbps} Mbps\nPing: ${current.latency.latencyMs} ms\nJitter: ${current.latency.jitterMs} ms\nPérdida: ${current.latency.lossPct??"—"} %\nEstabilidad: ${current.quality.stability}/100\nCalidad: ${current.quality.grade}`;await navigator.clipboard.writeText(t);ping("Resultado copiado.");};
  const exportResult=()=>{if(!current)return;const blob=new Blob([JSON.stringify(current,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`willy-speedtest-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;a.click();URL.revokeObjectURL(a.href);};

  return <div className="min-w-0 space-y-4 sm:space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><div className="flex items-center gap-2"><Gauge className="size-6 text-primary"/><h1 className="text-xl font-black tracking-tight sm:text-2xl">Test de velocidad Pro</h1></div><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Mide la conexión real de este PC contra un nodo externo de Cloudflare. Prueba adaptativa con varias conexiones para líneas rápidas.</p></div>
      <div className="flex flex-wrap gap-2">
        {running?<Button variant="outline" className="gap-2 border-destructive/40 text-destructive" onClick={cancel}><X className="size-4"/>Cancelar</Button>:<Button variant="outline" className="gap-2" onClick={reset}><RotateCcw className="size-4"/>Nueva prueba</Button>}
        <Button className="gap-2" disabled={running} onClick={()=>void run()}>{running?<Loader2 className="size-4 animate-spin"/>:<Play className="size-4"/>}{stage==="done"?"Repetir test":"Iniciar test"}</Button>
      </div>
    </div>

    <Card className="overflow-hidden p-0">
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
        <div className="min-w-0 p-4 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><span className={`size-2.5 rounded-full ${running?"bg-primary animate-pulse":stage==="done"?"bg-emerald-500":"bg-muted-foreground/40"}`}/><span className="text-sm font-semibold">{stageText(stage)}</span></div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs"><Clock3 className="size-3.5"/>{running?elapsed.toFixed(1):"0.0"} s</span>
          </div>
          <SpeedGauge value={shownSpeed} label={shownLabel} active={stage==="download"||stage==="upload"}/>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric icon={ArrowDown} label="Descarga" value={download?`${download.mbps}`:"—"} sub="Mbps"/>
            <Metric icon={ArrowUp} label="Subida" value={upload?`${upload.mbps}`:"—"} sub="Mbps"/>
            <Metric icon={Timer} label="Ping" value={latency?`${latency.latencyMs}`:"—"} sub="ms"/>
            <Metric icon={Activity} label="Jitter" value={latency?`${latency.jitterMs}`:"—"} sub="ms"/>
          </div>
        </div>
        <div className="border-t border-border bg-muted/20 p-4 sm:p-5 lg:border-l lg:border-t-0">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Estado de la línea</p>
          {quality?<><div className="mt-2 flex items-end gap-2"><span className="text-3xl font-black">{quality.stability}</span><span className="pb-1 text-sm text-muted-foreground">/ 100 estabilidad</span></div><p className="mt-1 text-sm font-bold text-primary">{quality.grade}</p></>:<p className="mt-3 text-sm text-muted-foreground">Completa la prueba para obtener diagnóstico.</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric icon={Signal} label="Pérdida" value={latency?.lossPct==null?"—":`${latency.lossPct}%`} sub="estimada TCP"/>
            <Metric icon={Clock3} label="P95" value={latency?`${latency.p95Ms}`:"—"} sub="ms"/>
          </div>
          {quality&&<div className="mt-4 flex flex-wrap gap-2"><UseBadge ok={quality.uses.browsing} label="Web"/><UseBadge ok={quality.uses.streaming4k} label="Streaming 4K"/><UseBadge ok={quality.uses.videoCalls} label="Videollamadas"/><UseBadge ok={quality.uses.gaming} label="Gaming"/></div>}
          <div className="mt-4 space-y-2 rounded-xl border border-border bg-background p-3 text-xs">
            <p className="flex items-center gap-2 font-semibold"><Globe2 className="size-3.5 text-primary"/>Conexión</p>
            <div className="grid gap-1 text-muted-foreground">
              <p className="break-all">IP pública: <span className="font-mono text-foreground">{info?.ip||"Comprobando…"}</span></p>
              <p>Nodo de prueba: <span className="font-semibold text-foreground">{info?.edge||"—"}{info?.country?` · ${info.country}`:""}</span></p>
              {info?.adapter&&<><p>Adaptador: <span className="font-semibold text-foreground">{info.adapter.name}</span></p><p>Enlace local: <span className="font-semibold text-foreground">{info.adapter.linkSpeed||"—"}</span></p></>}
            </div>
          </div>
        </div>
      </div>
    </Card>

    {error&&<div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

    {current&&<Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="size-4 text-primary"/>Informe de la prueba</p><p className="mt-1 text-xs text-muted-foreground">Datos medidos en este PC; no se confunden con la velocidad nominal contratada.</p></div><div className="flex gap-2"><Button size="sm" variant="outline" className="gap-2" onClick={()=>void copyResult()}><Copy className="size-3.5"/>Copiar</Button><Button size="sm" variant="outline" className="gap-2" onClick={exportResult}><Download className="size-3.5"/>Informe</Button></div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-border p-3"><p className="text-[11px] uppercase text-muted-foreground">Datos descargados</p><p className="mt-1 font-mono font-bold">{bytesText(current.download.bytes)}</p><p className="text-[10px] text-muted-foreground">{current.download.streams} flujos · {current.download.durationMs} ms</p></div><div className="rounded-xl border border-border p-3"><p className="text-[11px] uppercase text-muted-foreground">Datos subidos</p><p className="mt-1 font-mono font-bold">{bytesText(current.upload.bytes)}</p><p className="text-[10px] text-muted-foreground">{current.upload.streams} flujos · {current.upload.durationMs} ms</p></div><div className="rounded-xl border border-border p-3"><p className="text-[11px] uppercase text-muted-foreground">Muestras latencia</p><p className="mt-1 font-mono font-bold">{current.latency.samples.length}</p><p className="text-[10px] text-muted-foreground">{current.latency.lossMethod}</p></div></div>
    </Card>}

    <Card className="p-4">
      <div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-bold"><History className="size-4 text-primary"/>Historial</p><p className="mt-1 text-xs text-muted-foreground">Últimas 20 pruebas guardadas solo en este navegador.</p></div>{history.length>0&&<button className="text-xs font-semibold text-muted-foreground hover:text-destructive" onClick={()=>{setHistory([]);saveHistory([]);}}>Borrar</button>}</div>
      {history.length===0?<p className="mt-4 rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">Aún no hay pruebas guardadas.</p>:<div className="mt-3 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="text-muted-foreground"><tr><th className="pb-2">Fecha</th><th className="pb-2">Descarga</th><th className="pb-2">Subida</th><th className="pb-2">Ping</th><th className="pb-2">Jitter</th><th className="pb-2">Estabilidad</th></tr></thead><tbody>{history.map((h)=><tr key={h.id} className="border-t border-border"><td className="py-2">{new Date(h.at).toLocaleString("es-ES")}</td><td className="py-2 font-mono font-semibold">{h.download.mbps} Mbps</td><td className="py-2 font-mono font-semibold">{h.upload.mbps} Mbps</td><td className="py-2 font-mono">{h.latency.latencyMs} ms</td><td className="py-2 font-mono">{h.latency.jitterMs} ms</td><td className="py-2 font-semibold">{h.quality.stability}/100</td></tr>)}</tbody></table></div>}
    </Card>

    <p className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground"><Network className="mt-0.5 size-3.5 shrink-0"/>La prueba puede consumir aproximadamente entre 15 y 135 MB según la velocidad detectada. El resultado puede variar por Wi‑Fi, VPN, saturación, distancia al router, otros dispositivos o el nodo de Internet usado.</p>
  </div>;
}
