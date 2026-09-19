// Sesión y roles.
// ADAPTADOR TEMPORAL: la sesión vive en este equipo. El frontend OCULTA el panel
// de propietario, pero la autorización real debe hacerla el backend.
// TODO(backend): sustituir `signIn`/`session` por llamadas al backend y validar el
// rol en cada operación sensible del servidor, no solo aquí.

import { useEffect, useState } from "react";
import { fail, ok, type Role, type ServiceResult, type Session } from "@/types/domain";
import { readJson, remove, subscribe, write } from "./storage";
import { apiAuthService } from "./api-auth-service";
import { backendOn } from "./backend";
import { findLogin, licenseAllowed } from "./licensing";

const KEY = "willy-session";
const ADMIN_KEY = "willy-admin";

/** Cuenta de administrador (el dueño). Se puede cambiar desde Licencias. */
export type AdminAccount = { name: string; email: string; pass: string };

export const DEFAULT_ADMIN: AdminAccount = {
  name: "Antonio",
  email: "admin@willy.ai",
  pass: "WillyAdmin2026",
};

export function readAdmin(): AdminAccount {
  return readJson<AdminAccount>(ADMIN_KEY, DEFAULT_ADMIN);
}

export function saveAdmin(patch: Partial<AdminAccount>): AdminAccount {
  const next = { ...readAdmin(), ...patch };
  write(ADMIN_KEY, next);
  return next;
}

const EMPTY: Session = { name: "", email: "", role: "member", at: "" };

export interface AuthService {
  session(): Session | null;
  signIn(input: { name: string; email: string; password?: string }): Promise<ServiceResult<Session>>;
  signOut(): void;
  isOwner(): boolean;
}

/** Correo del propietario del producto. En producción lo decide el backend. */
const OWNER_EMAILS = ["antonio@willy.ai", "owner@willy.ai"];

class LocalAuthService implements AuthService {
  session() {
    const s = readJson<Session>(KEY, EMPTY);
    return s.email ? s : null;
  }

  async signIn(input: { name: string; email: string; password?: string }) {
    const email = input.email.trim().toLowerCase();
    const pass = (input.password ?? "").trim();
    const admin = readAdmin();
    const isAdmin = email === admin.email.trim().toLowerCase() && pass === admin.pass;

    let role: Role = "member";
    let name = input.name.trim();

    if (isAdmin || OWNER_EMAILS.includes(email)) {
      if (!isAdmin && pass !== admin.pass) return fail<Session>("Contraseña incorrecta.");
      role = "owner";
      name = name || admin.name;
    } else {
      const lic = findLogin(email, pass);
      if (!lic) return fail<Session>("Usuario o contraseña incorrectos.");
      if (!licenseAllowed(lic)) {
        return fail<Session>("Tu acceso está suspendido. Ponte en contacto para reactivarlo.");
      }
      name = name || lic.client || email;
    }

    const session: Session = {
      name: name || email.split("@")[0]!,
      email,
      role,
      at: new Date().toISOString(),
    };
    write(KEY, session);
    return ok(session);
  }

  signOut() {
    remove(KEY);
  }

  isOwner() {
    return this.session()?.role === "owner";
  }
}

export const localAuthService: AuthService = new LocalAuthService();

/** Con el servidor conectado la sesión la decide el backend (cookie HttpOnly). */
function pick(): AuthService {
  return backendOn() ? apiAuthService : localAuthService;
}

export const authService: AuthService = {
  session: () => pick().session(),
  signIn: (input) => pick().signIn(input),
  signOut: () => pick().signOut(),
  isOwner: () => pick().isOwner(),
};

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const load = () => {
      setSession(authService.session());
      setReady(true);
    };
    load();
    return subscribe(KEY, load);
  }, []);

  return { session, ready, isOwner: session?.role === "owner" };
}
