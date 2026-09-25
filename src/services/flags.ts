// Interruptores de funciones. Permiten publicar cosas experimentales sin romper
// lo que ya funciona. El propietario los cambia desde /admin.

import { useEffect, useState } from "react";
import { readJson, subscribe, write } from "./storage";

export type Flags = {
  /** Modo «Editar interfaz»: seleccionar un elemento y cambiar sus propiedades. */
  visualEditor: boolean;
  /** Separación borrador / publicado en los cambios de apariencia. */
  draftPublish: boolean;
  /** Diagnóstico técnico local en el panel de propietario. */
  telemetry: boolean;
};

export const DEFAULT_FLAGS: Flags = {
  visualEditor: false,
  draftPublish: true,
  telemetry: true,
};

const KEY = "willy-flags";

export function readFlags(): Flags {
  return readJson<Flags>(KEY, DEFAULT_FLAGS);
}

export function setFlag(name: keyof Flags, value: boolean) {
  write(KEY, { ...readFlags(), [name]: value });
}

export function useFlags(): Flags {
  const [flags, setFlags] = useState<Flags>(DEFAULT_FLAGS);
  useEffect(() => {
    const load = () => setFlags(readFlags());
    load();
    return subscribe(KEY, load);
  }, []);
  return flags;
}
