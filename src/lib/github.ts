/** Conexión real con GitHub desde el navegador mediante un token personal. */

const KEY = "willy-github";
const API = "https://api.github.com";

export type GitHubAccount = { token: string; login: string; avatar: string; repo: string };

export type Repo = { name: string; full_name: string; private: boolean; html_url: string; default_branch: string };

export function readAccount(): GitHubAccount | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GitHubAccount) : null;
  } catch {
    return null;
  }
}

export function saveAccount(account: GitHubAccount | null) {
  if (account) window.localStorage.setItem(KEY, JSON.stringify(account));
  else window.localStorage.removeItem(KEY);
}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Comprueba el token y devuelve la cuenta asociada. */
export async function verifyToken(token: string): Promise<{ login: string; avatar: string }> {
  const user = await call<{ login: string; avatar_url: string }>(token, "/user");
  return { login: user.login, avatar: user.avatar_url };
}

export async function listRepos(token: string): Promise<Repo[]> {
  return call<Repo[]>(token, "/user/repos?per_page=100&sort=updated&affiliation=owner");
}

export async function createRepo(token: string, name: string, isPrivate: boolean): Promise<Repo> {
  return call<Repo>(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({ name, private: isPrivate, auto_init: true, description: "Creado con WILLY AI" }),
  });
}

/** Texto a base64 admitiendo acentos y emojis. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

/**
 * Sube archivos al repositorio en un único commit usando la API de Git.
 * Devuelve la URL del commit creado.
 */
export async function pushFiles(
  token: string,
  fullName: string,
  branch: string,
  files: { path: string; content: string }[],
  message: string,
): Promise<string> {
  const ref = await call<{ object: { sha: string } }>(token, `/repos/${fullName}/git/ref/heads/${branch}`);
  const head = ref.object.sha;
  const commit = await call<{ tree: { sha: string } }>(token, `/repos/${fullName}/git/commits/${head}`);

  const blobs = await Promise.all(
    files.map(async (f) => {
      const blob = await call<{ sha: string }>(token, `/repos/${fullName}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: toBase64(f.content), encoding: "base64" }),
      });
      return { path: f.path.replace(/^\/+/, ""), mode: "100644" as const, type: "blob" as const, sha: blob.sha };
    }),
  );

  const tree = await call<{ sha: string }>(token, `/repos/${fullName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: commit.tree.sha, tree: blobs }),
  });

  const created = await call<{ sha: string; html_url: string }>(token, `/repos/${fullName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [head] }),
  });

  await call(token, `/repos/${fullName}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: created.sha }),
  });

  return created.html_url;
}
