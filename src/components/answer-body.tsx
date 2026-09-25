// Cómo se lee una respuesta de la IA (Chat y conversación del proyecto en SUPER WILLY): el texto normal como párrafos y el
// código SIN muros de texto. En SUPER WILLY cada archivo es una tarjeta que se abre en el taller («Código»); en el Chat, cada
// bloque de código se ve plegado o entero con su botón «Copiar» (y «Descargar» si es un archivo).
//
// Rev: el texto normal (fuera de los bloques de código) ahora se lee como markdown ligero — títulos, negrita/cursiva, listas,
// tablas, citas/avisos y separadores — en vez de una línea por párrafo sin más. Es solo presentación: el contenido semántico
// (lo que escribió la IA) no cambia, solo cómo se dibuja.

import { createElement, useState, type ReactNode } from "react";
import { Check, CheckCircle2, ChevronDown, Circle, Copy, Download, FileCode2, ListChecks } from "lucide-react";
import { copyText, downloadFile } from "@/lib/workspace-store";

const FENCE = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;

/** La ruta que lleva la cabecera de un bloque («tsx src/App.tsx», «html index.html»…), si la lleva. */
function pathOf(info: string): string | null {
  return info.trim().match(/([\w./@()[\]-]+\.[A-Za-z0-9]+)(?:\s*)$/)?.[1] ?? null;
}

export function AnswerBody({ text, onOpenFile, streaming = false }: {
  text: string;
  /** Si hay taller (SUPER WILLY): los archivos se abren allí en vez de enseñarse aquí. */
  onOpenFile?: (path: string) => void;
  /** Mientras la IA escribe, el último bloque puede estar a medias. */
  streaming?: boolean;
}) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(text))) {
    if (m.index > last) nodes.push(<Prose key={`t${k++}`} text={text.slice(last, m.index)} />);
    const info = (m[1] ?? "").trim();
    const code = (m[2] ?? "").replace(/\n$/, "");
    const path = pathOf(info);
    const open = streaming && m.index + m[0].length >= text.length && !m[0].endsWith("```");
    // Rev23: el bloque «plan» (qué tareas ha terminado WILLY) no es código para leer: una línea que lo dice.
    if (/^plan(?:-json)?$/i.test(info)) nodes.push(<PlanNote key={`p${k++}`} json={/json/i.test(info)} writing={open} done={(code.match(/^\s*hecho:\s*(.+)$/im)?.[1] ?? "").split(",").filter((x) => x.trim()).length} />);
    else if (path && onOpenFile) nodes.push(<FileChip key={`f${k++}`} path={path} lines={code.split("\n").length} writing={open} onOpen={() => onOpenFile(path)} />);
    else nodes.push(<CodeBlock key={`c${k++}`} path={path} lang={path ? "" : info} code={code} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<Prose key={`t${k++}`} text={text.slice(last)} />);
  return <div className="min-w-0 space-y-1.5">{nodes}</div>;
}

function PlanNote({ json, writing, done }: { json: boolean; writing: boolean; done: number }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary" data-plan-respuesta>
      <ListChecks className="size-3.5 shrink-0" />
      {writing ? "Anotando el progreso del proyecto…" : json ? "Plan del proyecto hecho: su progreso ya se puede calcular (míralo en Proyectos)." : done ? `Progreso del proyecto al día: ${done} tarea(s) terminada(s).` : "Progreso del proyecto al día."}
    </p>
  );
}

// ───────────────────────────────────────────────────────────────────────────── markdown ligero (solo presentación)

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "subheading"; text: string }
  | { type: "hr" }
  | { type: "quote"; blocks: Block[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "p"; text: string };

const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_RE = /^\s*>\s?/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const SEP_ROW_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const BOLD_LINE_RE = /^\*\*(.+)\*\*:?$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") { i++; continue; }

    const head = line.match(HEADING_RE);
    if (head) { blocks.push({ type: "heading", level: head[1]!.length, text: head[2]!.trim() }); i++; continue; }

    if (HR_RE.test(line.trim())) { blocks.push({ type: "hr" }); i++; continue; }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && (QUOTE_RE.test(lines[i]!) || lines[i]!.trim() === "")) {
        if (lines[i]!.trim() === "" && !QUOTE_RE.test(lines[i + 1] ?? "")) break;
        quoted.push(lines[i]!.replace(QUOTE_RE, ""));
        i++;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(quoted.join("\n")) });
      continue;
    }

    if (/\|/.test(line) && SEP_ROW_RE.test(lines[i + 1] ?? "")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /\|/.test(lines[i]!) && lines[i]!.trim() !== "") { rows.push(splitRow(lines[i]!)); i++; }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (BULLET_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const mm = lines[i]!.match(BULLET_RE);
        if (!mm) break;
        items.push(mm[1]!);
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (ORDERED_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const mm = lines[i]!.match(ORDERED_RE);
        if (!mm) break;
        items.push(mm[1]!);
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const bold = line.trim().match(BOLD_LINE_RE);
    if (bold && bold[1] && !bold[1].includes("**")) { blocks.push({ type: "subheading", text: bold[1] }); i++; continue; }

    blocks.push({ type: "p", text: line });
    i++;
  }
  return blocks;
}

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*]+\*)/g;

function renderInline(str: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let idx = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(str))) {
    if (m.index > idx) out.push(str.slice(idx, m.index));
    const token = m[0];
    if (token.startsWith("`")) out.push(<code key={`${keyPrefix}c${k++}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) out.push(<strong key={`${keyPrefix}b${k++}`} className="font-bold text-foreground">{token.slice(2, -2)}</strong>);
    else if (token.startsWith("[")) {
      const mm = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      out.push(<a key={`${keyPrefix}a${k++}`} href={mm?.[2] ?? "#"} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">{mm?.[1] ?? token}</a>);
    } else out.push(<em key={`${keyPrefix}e${k++}`} className="italic">{token.slice(1, -1)}</em>);
    idx = m.index + token.length;
  }
  if (idx < str.length) out.push(str.slice(idx));
  return out;
}

/** Una línea suelta de párrafo: conserva el resaltado ya existente para ✅ (éxito) y ⚠️ (aviso). */
function renderParagraphLine(line: string, key: string): ReactNode {
  const tone = line.startsWith("✅") ? "font-semibold text-emerald-500" : line.startsWith("⚠️") ? "text-amber-600 dark:text-amber-400" : "";
  return (
    <p key={key} className={`whitespace-pre-wrap break-words text-sm leading-6 ${tone}`}>
      {line ? renderInline(line, key) : " "}
    </p>
  );
}

function renderBlock(b: Block, key: string): ReactNode {
  switch (b.type) {
    case "heading": {
      const Tag = (`h${Math.min(b.level + 2, 6)}`) as "h3" | "h4" | "h5" | "h6";
      const size = b.level <= 1 ? "text-base" : b.level === 2 ? "text-[15px]" : "text-sm";
      return createElement(Tag, { key, className: `mt-3 mb-1 first:mt-0 ${size} font-display font-extrabold tracking-tight text-foreground` }, renderInline(b.text, key));
    }
    case "subheading":
      return <p key={key} className="mt-3 mb-1 first:mt-0 text-[13px] font-extrabold tracking-tight text-foreground">{renderInline(b.text, key)}</p>;
    case "hr":
      return <hr key={key} className="my-2 border-border" />;
    case "quote":
      return (
        <div key={key} className="my-1 space-y-1 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5">
          {b.blocks.map((inner, j) => renderBlock(inner, `${key}-${j}`))}
        </div>
      );
    case "ul":
      return (
        <ul key={key} className="my-1 space-y-1.5">
          {b.items.map((item, j) => {
            const check = item.match(/^\[( |x|X)\]\s*(.*)$/);
            if (check) {
              const done = check[1]!.toLowerCase() === "x";
              return (
                <li key={j} className="flex items-start gap-2 text-sm leading-6">
                  {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <span className={done ? "text-muted-foreground line-through" : ""}>{renderInline(check[2]!, `${key}-${j}`)}</span>
                </li>
              );
            }
            return (
              <li key={j} className="flex items-start gap-2 text-sm leading-6">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/70" />
                <span className="min-w-0">{renderInline(item, `${key}-${j}`)}</span>
              </li>
            );
          })}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="my-1 space-y-1.5">
          {b.items.map((item, j) => (
            <li key={j} className="flex items-start gap-2 text-sm leading-6">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-primary">{j + 1}</span>
              <span className="min-w-0">{renderInline(item, `${key}-${j}`)}</span>
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div key={key} className="my-1.5 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-muted/60">
              <tr>{b.header.map((h, j) => <th key={j} className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">{renderInline(h, `${key}-h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-border">
                  {row.map((cell, ci) => <td key={ci} className="px-3 py-2 align-top">{renderInline(cell, `${key}-${ri}-${ci}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "p":
    default:
      return renderParagraphLine(b.text, key);
  }
}

function Prose({ text }: { text: string }) {
  const clean = text.replace(/^\n+|\n+$/g, "");
  if (!clean.trim()) return null;
  const blocks = parseBlocks(clean);
  return <div className="min-w-0">{blocks.map((b, i) => renderBlock(b, `b${i}`))}</div>;
}

function FileChip({ path, lines, writing, onOpen }: { path: string; lines: number; writing: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent/50" title="Ver este archivo en el taller (pestaña Código)">
      <FileCode2 className="size-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{writing ? `escribiendo… ${lines} líneas` : `${lines} líneas · Ver`}</span>
    </button>
  );
}

function CodeBlock({ path, lang, code }: { path: string | null; lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n").length;
  // Los archivos largos se ven plegados (se abren con un clic); un ejemplo corto, entero.
  const [open, setOpen] = useState(!path || lines <= 25);
  const copy = () => void copyText(code).then((ok) => { setCopied(ok); if (ok) window.setTimeout(() => setCopied(false), 1500); });
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {path ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={open}>
            <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
            <FileCode2 className="size-3.5 shrink-0 text-primary" />
            <span className="truncate font-mono text-foreground">{path}</span>
            <span className="shrink-0">· {lines} líneas</span>
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono">{lang || "código"}</span>
        )}
        <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground" aria-label={path ? `Copiar ${path}` : "Copiar el código"}>
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}{copied ? "Copiado" : "Copiar"}
        </button>
        {path && (
          <button type="button" onClick={() => downloadFile(path.split("/").pop() ?? path, `${code}\n`)} className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground" aria-label={`Descargar ${path}`}>
            <Download className="size-3.5" />Descargar
          </button>
        )}
      </div>
      {open && <pre className="max-h-96 overflow-auto p-3 font-mono text-[11px] leading-5 text-foreground/90"><code>{code}</code></pre>}
    </div>
  );
}
