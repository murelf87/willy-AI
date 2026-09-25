import { useEffect, useState } from "react";
import { Check, Github, Loader2, LogOut, Plus, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard as Card } from "@/components/panel-card";
import type { GeneratedFile } from "@/lib/ai-standard";
import { createRepo, listRepos, pushFiles, readAccount, saveAccount, verifyToken, type GitHubAccount, type Repo } from "@/lib/github";
import type { Ping } from "@/types/domain";

/** Conexión del proyecto con GitHub: subir el código generado en un commit real. */
export function GitHubView({ project, files, ping }: { project: string; files: GeneratedFile[]; ping: Ping }) {
  const [account, setAccount] = useState<GitHubAccount | null>(null);
  const [token, setToken] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [busy, setBusy] = useState<"" | "login" | "repos" | "push" | "create">("");
  const [newRepo, setNewRepo] = useState("");
  const [isPrivate, setPrivate] = useState(true);
  const [lastCommit, setLastCommit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setAccount(readAccount()); }, []);

  const refresh = async (acc: GitHubAccount) => {
    setBusy("repos");
    try {
      setRepos(await listRepos(acc.token));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  useEffect(() => { if (account) void refresh(account); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [account?.login]);

  const connect = async () => {
    const value = token.trim();
    if (!value) return;
    setBusy("login");
    setError(null);
    try {
      const user = await verifyToken(value);
      const acc: GitHubAccount = { token: value, login: user.login, avatar: user.avatar, repo: "" };
      saveAccount(acc);
      setAccount(acc);
      setToken("");
      ping(`Conectado a GitHub como ${user.login}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      ping("No se pudo conectar con GitHub. Revisa el token.");
    } finally {
      setBusy("");
    }
  };

  const disconnect = () => {
    saveAccount(null);
    setAccount(null);
    setRepos([]);
    ping("Cuenta de GitHub desconectada de este equipo.");
  };

  const choose = (repo: Repo) => {
    if (!account) return;
    const next = { ...account, repo: repo.full_name };
    saveAccount(next);
    setAccount(next);
    ping(`Repositorio activo: ${repo.full_name}`);
  };

  const create = async () => {
    if (!account || !newRepo.trim()) return;
    setBusy("create");
    setError(null);
    try {
      const repo = await createRepo(account.token, newRepo.trim().replace(/\s+/g, "-"), isPrivate);
      setNewRepo("");
      await refresh(account);
      choose(repo);
      ping(`Repositorio «${repo.name}» creado en GitHub.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const push = async () => {
    if (!account?.repo) return;
    if (!files.length) { ping("Todavía no hay archivos generados que subir."); return; }
    const repo = repos.find((r) => r.full_name === account.repo);
    setBusy("push");
    setError(null);
    try {
      const url = await pushFiles(
        account.token,
        account.repo,
        repo?.default_branch ?? "main",
        files.map((f) => ({ path: f.path, content: f.content })),
        `WILLY AI: ${project} (${files.length} archivo(s))`,
      );
      setLastCommit(url);
      ping(`Código subido a ${account.repo}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      ping("No se pudo subir el código a GitHub.");
    } finally {
      setBusy("");
    }
  };

  if (!account) {
    return (
      <div className="space-y-3">
        <Card>
          <div className="flex items-start gap-3">
            <Github className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Conecta tu cuenta de GitHub</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pega un token personal con permiso <span className="font-mono">repo</span>. Se guarda solo en este equipo y nunca sale a ningún servidor de terceros.
              </p>
              <a className="mt-1 inline-block text-xs text-primary underline" href="https://github.com/settings/tokens/new?scopes=repo&description=WILLY%20AI" target="_blank" rel="noreferrer">
                Crear un token en GitHub
              </a>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void connect()}
                  placeholder="ghp_..."
                  aria-label="Token de GitHub"
                  className="h-10 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary"
                />
                <Button onClick={() => void connect()} disabled={busy === "login" || !token.trim()}>
                  {busy === "login" ? <Loader2 className="size-4 animate-spin" /> : <Github className="size-4" />}Conectar
                </Button>
              </div>
            </div>
          </div>
        </Card>
        {error && <Card className="text-xs text-amber-500">{error}</Card>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3">
        <img src={account.avatar} alt="" className="size-10 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{account.login}</p>
          <p className="truncate text-xs text-muted-foreground">{account.repo || "Sin repositorio seleccionado"}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh(account)} disabled={busy === "repos"}>
          {busy === "repos" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Actualizar
        </Button>
        <Button variant="outline" size="sm" onClick={disconnect}><LogOut className="size-4" />Desconectar</Button>
      </Card>

      <Card>
        <p className="text-sm font-semibold">Subir el código del proyecto</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {files.length ? `${files.length} archivo(s) generados listos para subir.` : "Genera código en el chat y aparecerá aquí para subirlo."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => void push()} disabled={!account.repo || busy === "push" || !files.length}>
            {busy === "push" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}Subir a GitHub
          </Button>
          {lastCommit && (
            <a className="inline-flex items-center gap-1 text-xs text-emerald-500 underline" href={lastCommit} target="_blank" rel="noreferrer">
              <Check className="size-3.5" />Ver el último commit
            </a>
          )}
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold">Crear un repositorio nuevo</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={newRepo}
            onChange={(e) => setNewRepo(e.target.value)}
            placeholder="mi-aplicacion"
            aria-label="Nombre del repositorio"
            className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />Privado
          </label>
          <Button variant="secondary" onClick={() => void create()} disabled={busy === "create" || !newRepo.trim()}>
            {busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}Crear
          </Button>
        </div>
      </Card>

      <Card className="p-0">
        <p className="border-b border-border px-4 py-3 text-sm font-semibold">Tus repositorios</p>
        <ul className="max-h-80 overflow-y-auto">
          {repos.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted-foreground">No hay repositorios que mostrar.</li>}
          {repos.map((r) => (
            <li key={r.full_name} className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 last:border-0">
              <Github className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs">{r.full_name}</span>
              <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{r.private ? "privado" : "público"}</span>
              <Button size="sm" variant={account.repo === r.full_name ? "primary" : "secondary"} onClick={() => choose(r)}>
                {account.repo === r.full_name ? "Activo" : "Usar"}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {error && <Card className="text-xs text-amber-500">{error}</Card>}
    </div>
  );
}
