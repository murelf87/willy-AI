import { useEffect, useState } from "react";
import { BookOpenCheck, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { forgetAllOwnerLessons, forgetOwnerLesson, loadOwnerBrain, teachOwnerRule, useOwnerBrain } from "@/lib/owner-brain";

/**
 * Lo que WILLY ha aprendido del dueño: las reglas que dijo en los chats («a partir de ahora…», «recuerda que…», «nunca…»)
 * y las que añade aquí a mano. Valen para todas las IA (tu equipo y las externas) en el PC, el móvil, Súper IA y la
 * Autoconstrucción. Se pueden borrar una a una.
 */
export function OwnerLessonsCard({ ping }: { ping: (message: string) => void }) {
  const brain = useOwnerBrain();
  const [draft, setDraft] = useState("");
  // Al abrir, se trae del equipo lo aprendido en otros chats (por ejemplo, en el móvil).
  useEffect(() => { void loadOwnerBrain(); }, []);
  const lessons = [...brain.lessons].reverse();

  const add = () => {
    const learned = teachOwnerRule(draft, "escrito por ti");
    if (!learned) { ping(draft.trim() ? "Esa regla ya la sabían." : "Escribe la regla que quieres enseñarles."); return; }
    setDraft("");
    ping("📌 Aprendido: desde ahora lo cumplen todas las IA.");
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="Lo que han aprendido de ti">
      <div className="mb-1 flex items-center gap-2"><BookOpenCheck className="size-5 text-primary" /><h2 className="text-sm font-semibold">Lo que han aprendido de ti ({brain.lessons.length})</h2></div>
      <p className="mb-3 text-xs text-muted-foreground">
        Cada vez que en un chat dices «a partir de ahora…», «recuerda que…», «nunca…» o «prefiero…», se guarda aquí y lo cumplen TODAS las IA (tu equipo y las externas) en el PC, el móvil, Súper IA y la Autoconstrucción. Se guarda en tu equipo, no en internet.
      </p>
      <div className="mb-3 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}
          placeholder="Enséñales una regla nueva, p. ej.: «A partir de ahora las webs llevan siempre botón de WhatsApp»"
          aria-label="Regla nueva"
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
        />
        <Button size="sm" className="h-9 gap-1.5" onClick={add} disabled={!draft.trim()}><Plus className="size-4" />Enseñar</Button>
      </div>
      {lessons.length === 0 ? (
        <p className="text-xs text-muted-foreground">Todavía no han aprendido nada. Díselo en cualquier chat o escríbelo aquí arriba.</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Reglas aprendidas">
          {lessons.map((lesson) => (
            <li key={lesson.id} className="flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <p className="text-foreground">{lesson.text}</p>
                <p className="text-[10px] text-muted-foreground">{lesson.at ? new Date(lesson.at).toLocaleDateString("es-ES") : ""}{lesson.source ? ` · ${lesson.source}` : ""}</p>
              </div>
              <button type="button" onClick={() => void forgetOwnerLesson(lesson.id)} aria-label={`Olvidar: ${lesson.text.slice(0, 40)}`} title="Olvidar esta regla" className="shrink-0 text-muted-foreground hover:text-destructive"><X className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      {lessons.length > 1 && (
        <Button variant="ghost" size="sm" className="mt-2 gap-1.5 text-muted-foreground" onClick={() => { void forgetAllOwnerLessons(); ping("Han olvidado todas las reglas aprendidas."); }}><Trash2 className="size-4" />Olvidarlo todo</Button>
      )}
    </section>
  );
}
