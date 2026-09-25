// Lista viva de los modelos instalados en el equipo del usuario.
// Se refresca sola cada pocos segundos y al volver a la ventana,
// para que los desplegables muestren siempre lo que hay instalado.

import { useCallback, useEffect, useState } from "react";
import { listLocalModels } from "@/lib/local-ai";

export type LocalModelsState = {
  models: string[];
  engine: "checking" | "ok" | "offline";
  refresh: () => void;
};

export function useLocalModels(endpoint = "", intervalMs = 8000): LocalModelsState {
  const [models, setModels] = useState<string[]>([]);
  const [engine, setEngine] = useState<"checking" | "ok" | "offline">("checking");

  const refresh = useCallback(() => {
    void listLocalModels(endpoint)
      .then((list) => {
        setModels(list);
        setEngine(list.length ? "ok" : "offline");
      })
      .catch(() => setEngine("offline"));
  }, [endpoint]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, intervalMs);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, intervalMs]);

  return { models, engine, refresh };
}
