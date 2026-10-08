#!/usr/bin/env node
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.WILLY_AGENT_PORT || 4050);
const BIND = process.env.WILLY_AGENT_BIND || '127.0.0.1';
const ROOT = process.env.WILLY_ROOT || process.cwd();
const DATA_DIR = path.join(ROOT, 'datos-privados', 'willy-agent');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');
const pending = new Map();
await fs.mkdir(DATA_DIR, { recursive: true });

const tools = [
  t('agent_status','Estado y capacidades del agente propio de WILLY.',{}),
  t('approval_status','Consulta una acción pendiente.',{approval_id:'string'}),
  t('system_info','Información del sistema. Requiere aprobación.',{}),
  t('fs_list','Lista una carpeta. Requiere aprobación.',{path:'string'}),
  t('fs_read','Lee un archivo de texto. Requiere aprobación.',{path:'string',offset:'number?',length:'number?'}),
  t('fs_write','Escribe o añade texto a un archivo. Requiere aprobación.',{path:'string',content:'string',mode:'rewrite|append?'}),
  t('fs_replace','Reemplazo exacto SEARCH/REPLACE. Requiere aprobación.',{path:'string',search:'string',replace:'string',expected_replacements:'number?'}),
  t('fs_delete','Elimina archivo o carpeta. Requiere aprobación.',{path:'string',recursive:'boolean?'}),
  t('shell_run','Ejecuta PowerShell/shell y devuelve salida. Requiere aprobación.',{command:'string',cwd:'string?',timeout_ms:'number?'}),
  t('process_list','Lista procesos. Requiere aprobación.',{}),
  t('process_kill','Finaliza un proceso por PID. Requiere aprobación.',{pid:'number',force:'boolean?'}),
  t('open_url','Abre una URL http/https. Requiere aprobación.',{url:'string'}),
  t('screen_capture','Captura la pantalla en PNG. Requiere aprobación.',{}),
];

function schema(shape){
  const properties={}; const required=[];
  for(const [name,kind] of Object.entries(shape)){
    const optional=String(kind).endsWith('?'); const base=String(kind).replace('?','');
    const s={};
    if(base==='string')s.type='string'; else if(base==='number')s.type='number'; else if(base==='boolean')s.type='boolean'; else{s.type='string';s.description=base;}
    properties[name]=s; if(!optional)required.push(name);
  }
  return {type:'object',properties,required,additionalProperties:false};
}
function t(name,description,shape){return{name,description,inputSchema:schema(shape)};}
function text(v){return[{type:'text',text:typeof v==='string'?v:JSON.stringify(v,null,2)}];}
function loopback(req){const a=req.socket.remoteAddress||'';return a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';}
function resolvePath(p){if(!p||typeof p!=='string')throw new Error('Ruta no válida.');return path.resolve(p.replace(/^~(?=$|[\\/])/,os.homedir()));}
async function audit(event,detail){await fs.appendFile(AUDIT_FILE,JSON.stringify({at:new Date().toISOString(),event,detail})+'\n','utf8').catch(()=>{});}
function prune(){const now=Date.now();for(const [id,x] of pending){if(now-x.createdAt>20*60*1000)pending.delete(id);}}
setInterval(prune,60000).unref();

async function requestApproval(name,args){
  prune(); const id='wa-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex');
  const summary=name+' · '+String(args.path||args.command||args.url||args.pid||'').slice(0,180);
  pending.set(id,{id,name,args,status:'pending',summary,createdAt:Date.now()});
  await audit('approval_requested',{id,name,summary});
  return {content:text({status:'approval_required',approval_id:id,summary,message:'Aprueba la acción en WILLY > Equipo remoto y después consulta approval_status.'})};
}

async function runTool(name,args){
  if(name==='system_info')return{content:text({platform:process.platform,release:os.release(),arch:os.arch(),hostname:os.hostname(),user:os.userInfo().username,home:os.homedir(),cwd:process.cwd(),cpus:os.cpus().length,totalMemory:os.totalmem(),freeMemory:os.freemem(),node:process.version})};
  if(name==='fs_list'){
    const dir=resolvePath(args.path);const entries=await fs.readdir(dir,{withFileTypes:true});const out=[];
    for(const e of entries.slice(0,1000)){const full=path.join(dir,e.name);const st=await fs.stat(full).catch(()=>null);out.push({name:e.name,path:full,type:e.isDirectory()?'directory':e.isFile()?'file':'other',size:st?st.size:null,modified:st?st.mtime.toISOString():null});}
    return{content:text({path:dir,entries:out,truncated:entries.length>1000})};
  }
  if(name==='fs_read'){
    const file=resolvePath(args.path);const raw=await fs.readFile(file);const off=Math.max(0,Number(args.offset||0));const len=Math.max(1,Math.min(2*1024*1024,Number(args.length||200000)));return{content:text({path:file,offset:off,text:raw.subarray(off,off+len).toString('utf8'),bytes:Math.min(len,Math.max(0,raw.length-off))})};
  }
  if(name==='fs_write'){
    const file=resolvePath(args.path);const content=String(args.content||'');if(Buffer.byteLength(content)>2*1024*1024)throw new Error('Contenido superior a 2 MB.');await fs.mkdir(path.dirname(file),{recursive:true});if(args.mode==='append')await fs.appendFile(file,content,'utf8');else await fs.writeFile(file,content,'utf8');return{content:text({ok:true,path:file,bytes:Buffer.byteLength(content)})};
  }
  if(name==='fs_replace'){
    const file=resolvePath(args.path);const search=String(args.search||'');const repl=String(args.replace||'');const expected=Math.max(1,Number(args.expected_replacements||1));let current=await fs.readFile(file,'utf8');const count=current.split(search).length-1;if(!search||count!==expected)throw new Error('Coincidencias SEARCH: '+count+'; esperadas: '+expected+'.');current=current.split(search).join(repl);await fs.writeFile(file,current,'utf8');return{content:text({ok:true,path:file,replacements:count})};
  }
  if(name==='fs_delete'){const target=resolvePath(args.path);await fs.rm(target,{recursive:Boolean(args.recursive),force:false});return{content:text({ok:true,path:target})};}
  if(name==='shell_run'){
    const command=String(args.command||'');if(!command)throw new Error('Comando vacío.');const cwd=args.cwd?resolvePath(args.cwd):process.cwd();const timeout=Math.max(1000,Math.min(300000,Number(args.timeout_ms||60000)));const win=process.platform==='win32';const exe=win?'powershell.exe':'/bin/sh';const av=win?['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command]:['-lc',command];const r=await execFileAsync(exe,av,{cwd,timeout,windowsHide:true,maxBuffer:1024*1024});return{content:text({cwd,stdout:String(r.stdout||''),stderr:String(r.stderr||'')})};
  }
  if(name==='process_list'){
    if(process.platform==='win32'){const r=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Depth 3'],{windowsHide:true,maxBuffer:2*1024*1024});return{content:text(JSON.parse(r.stdout||'[]'))};}
    const r=await execFileAsync('/bin/sh',['-lc','ps -eo pid,ppid,comm,args'],{maxBuffer:2*1024*1024});return{content:text(String(r.stdout||''))};
  }
  if(name==='process_kill'){
    const pid=Number(args.pid);if(!Number.isInteger(pid)||pid<=0)throw new Error('PID no válido.');if(process.platform==='win32'){const av=['/PID',String(pid),'/T'];if(args.force)av.push('/F');await execFileAsync('taskkill.exe',av,{windowsHide:true});}else process.kill(pid,args.force?'SIGKILL':'SIGTERM');return{content:text({ok:true,pid})};
  }
  if(name==='open_url'){
    const u=String(args.url||'');const parsed=new URL(u);if(parsed.protocol!=='http:'&&parsed.protocol!=='https:')throw new Error('Solo http/https.');if(process.platform==='win32')await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Start-Process '"+u.replaceAll("'","''")+"'"],{windowsHide:true});else if(process.platform==='darwin')await execFileAsync('open',[u]);else await execFileAsync('xdg-open',[u]);return{content:text({ok:true,url:u})};
  }
  if(name==='screen_capture')return captureScreen();
  throw new Error('Herramienta desconocida: '+name);
}

async function captureScreen(){
  const file=path.join(os.tmpdir(),'willy-screen-'+Date.now()+'.png');
  try{
    if(process.platform==='win32'){
      const q=file.replaceAll("'","''");
      const ps=['Add-Type -AssemblyName System.Windows.Forms','Add-Type -AssemblyName System.Drawing','$b=[System.Windows.Forms.SystemInformation]::VirtualScreen','$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height','$g=[System.Drawing.Graphics]::FromImage($bmp)','$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)',"$bmp.Save('"+q+"',[System.Drawing.Imaging.ImageFormat]::Png)",'$g.Dispose();$bmp.Dispose()'].join(';');
      await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps],{windowsHide:true,timeout:15000});
    }else if(process.platform==='darwin')await execFileAsync('screencapture',['-x',file],{timeout:15000});
    else await execFileAsync('/bin/sh',['-lc',"gnome-screenshot -f '"+file+"' || scrot '"+file+"'"],{timeout:15000});
    const data=await fs.readFile(file);return{content:[{type:'image',data:data.toString('base64'),mimeType:'image/png'},{type:'text',text:JSON.stringify({bytes:data.length})}]};
  }finally{await fs.rm(file,{force:true}).catch(()=>{});}
}

async function callTool(name,args){
  if(name==='agent_status')return{content:text({ok:true,name:'WILLY Remote Agent',version:'1.0.0',approvalMode:'ask-every-time',pending:[...pending.values()].filter(x=>x.status==='pending').length,tools:tools.map(x=>x.name)})};
  if(name==='approval_status'){
    const id=String(args.approval_id||'');const item=pending.get(id);if(!item)return{content:text({status:'unknown',approval_id:id})};if(item.status==='pending')return{content:text({status:'pending',approval_id:id,summary:item.summary})};if(item.status==='denied')return{content:text({status:'denied',approval_id:id}),isError:true};if(item.error)return{content:text({status:'approved',approval_id:id,error:item.error}),isError:true};return item.result;
  }
  return requestApproval(name,args||{});
}

async function readJson(req){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>3*1024*1024)throw new Error('Petición demasiado grande.');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
function send(res,status,body){const data=JSON.stringify(body);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(data)});res.end(data);}
function rpc(id,result){return{jsonrpc:'2.0',id,result};}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url||'/','http://localhost');
    if(u.pathname==='/health')return send(res,200,{ok:true,name:'WILLY Remote Agent',version:'1.0.0',port:PORT,bind:BIND,pending:[...pending.values()].filter(x=>x.status==='pending').length,mcp:'/mcp'});
    if(u.pathname.startsWith('/admin/')){
      if(!loopback(req))return send(res,403,{ok:false,error:'Admin solo desde localhost.'});
      if(u.pathname==='/admin/status')return send(res,200,{ok:true,pending:[...pending.values()].filter(x=>x.status==='pending').map(x=>({id:x.id,name:x.name,summary:x.summary,args:x.args,createdAt:x.createdAt}))});
      if((u.pathname==='/admin/approve'||u.pathname==='/admin/deny')&&req.method==='POST'){
        const body=await readJson(req);const item=pending.get(String(body.id||''));if(!item||item.status!=='pending')return send(res,404,{ok:false,error:'Acción no encontrada.'});
        if(u.pathname.endsWith('deny')){item.status='denied';await audit('approval_denied',{id:item.id,name:item.name});return send(res,200,{ok:true});}
        try{item.result=await runTool(item.name,item.args);item.status='approved';await audit('approval_executed',{id:item.id,name:item.name,ok:true});return send(res,200,{ok:true});}catch(e){item.error=e instanceof Error?e.message:String(e);item.status='approved';await audit('approval_executed',{id:item.id,name:item.name,ok:false,error:item.error});return send(res,500,{ok:false,error:item.error});}
      }
      return send(res,404,{ok:false,error:'Ruta admin desconocida.'});
    }
    if(u.pathname==='/mcp'){
      if(req.method==='GET'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.write('event: ready\ndata: {"ok":true}\n\n');const tm=setInterval(()=>res.write(': ping\n\n'),15000);req.on('close',()=>clearInterval(tm));return;}
      if(req.method==='DELETE')return send(res,200,{ok:true});
      if(req.method!=='POST')return send(res,405,{error:'Método no permitido.'});
      const body=await readJson(req);const id=body.id;
      if(body.method==='notifications/initialized'){res.writeHead(202);return res.end();}
      if(body.method==='initialize'){const requested=String(body.params&&body.params.protocolVersion||'');const pv=requested||'2025-06-18';return send(res,200,rpc(id,{protocolVersion:pv,capabilities:{tools:{listChanged:false}},serverInfo:{name:'WILLY Remote Agent',version:'1.0.0'}}));}
      if(body.method==='ping')return send(res,200,rpc(id,{}));
      if(body.method==='tools/list')return send(res,200,rpc(id,{tools}));
      if(body.method==='tools/call'){const name=String(body.params&&body.params.name||'');const args=body.params&&body.params.arguments||{};return send(res,200,rpc(id,await callTool(name,args)));}
      return send(res,200,{jsonrpc:'2.0',id:id||null,error:{code:-32601,message:'Método MCP no soportado.'}});
    }
    return send(res,200,{ok:true,name:'WILLY Remote Agent',mcp:'/mcp'});
  }catch(e){await audit('server_error',{error:e instanceof Error?e.message:String(e)});return send(res,500,{ok:false,error:e instanceof Error?e.message:String(e)});}
});
server.listen(PORT,BIND,()=>{console.log('[willy-agent] http://'+BIND+':'+PORT+'/mcp · aprobación: preguntar siempre');});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
