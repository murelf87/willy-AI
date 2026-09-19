// Sesión real contra el backend: cookie HttpOnly, sin tokens en el navegador.
// La sesión se guarda también en el equipo para que la interfaz pueda pintarla
// sin esperar, pero la autorización de verdad la decide siempre el servidor.

import { fail, ok, type Role, type Session } from "@/types/domain";
import type { AuthService } from "./auth-service";
import { api, attempt } from "./backend";
import { readJson, remove, write } from "./storage";

const KEY = "willy-session";
const EMPTY: Session = { name: "", email: "", role: "member", at: "" };

type ApiUser = { id: string; email: string; name: string; avatarUrl?: string | null; createdAt?: string };

function cache(user: ApiUser, role: Role): Session {
  const session: Session = {
    name: user.name || user.email.split("@")[0]!,
    email: user.email,
    role,
    at: new Date().toISOString(),
  };
  write(KEY, session);
  return session;
}

/** Correos con acceso al panel de propietario mientras el backend no envíe el rol. */
const OWNER_EMAILS = ["antonio@willy.ai", "owner@willy.ai"];

export class ApiAuthService implements AuthService {
  session() {
    const s = readJson<Session>(KEY, EMPTY);
    return s.email ? s : null;
  }

  /** Recupera la sesión desde la cookie del servidor al abrir la aplicación. */
  async refresh(): Promise<Session | null> {
    const result = await attempt(() => api<{ user: ApiUser }>("/api/auth/me"));
    if (!result.ok) {
      remove(KEY);
      return null;
    }
    const user = result.data.user;
    return cache(user, OWNER_EMAILS.includes(user.email.toLowerCase()) ? "owner" : "member");
  }

  async signIn(input: { name: string; email: string; password?: string }) {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) return fail<Session>("Escribe un correo válido.");
    if (!input.password) return fail<Session>("Escribe tu contraseña.");

    const login = await attempt(() =>
      api<{ userId: string }>("/api/auth/login", { method: "POST", body: { email, password: input.password } }),
    );
    if (!login.ok) return fail<Session>(login.error);

    const session = await this.refresh();
    return session ? ok(session) : fail<Session>("No se pudo recuperar la sesión del servidor.");
  }

  /** Alta de cuenta nueva en el servidor. */
  async signUp(input: { name: string; email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) return fail<Session>("Escribe un correo válido.");
    if (input.password.length < 8) return fail<Session>("La contraseña necesita al menos 8 caracteres.");
    const res = await attempt(() =>
      api<{ userId: string; organizationId: string }>("/api/auth/register", {
        method: "POST",
        body: { name: input.name.trim() || email.split("@")[0], email, password: input.password },
      }),
    );
    if (!res.ok) return fail<Session>(res.error);
    const session = await this.refresh();
    return session ? ok(session) : fail<Session>("Cuenta creada, pero no se pudo iniciar la sesión.");
  }

  /** Envío del correo de recuperación de contraseña. */
  async requestPasswordReset(email: string) {
    return attempt(() =>
      api<{ message: string }>("/api/auth/password-reset/request", {
        method: "POST",
        body: { email: email.trim().toLowerCase() },
      }),
    );
  }

  async confirmPasswordReset(token: string, password: string) {
    return attempt(() =>
      api<void>("/api/auth/password-reset/confirm", { method: "POST", body: { token, password } }),
    );
  }

  signOut() {
    void attempt(() => api<void>("/api/auth/logout", { method: "POST" }));
    remove(KEY);
  }

  isOwner() {
    return this.session()?.role === "owner";
  }
}

export const apiAuthService = new ApiAuthService();
