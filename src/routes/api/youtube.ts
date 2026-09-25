import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import { fetchCaptions, isShortUrl, videoIdOf, type CaptionsResult } from "@/lib/youtube-captions";
import { ytDlpCaptions } from "@/lib/ytdlp-server";
import { privateDataDir } from "@/lib/project-root";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * Obtiene los subtítulos reales de un vídeo de YouTube para poder traducirlos al español y leerlos
 * sincronizados con el vídeo. Todo el proceso ocurre en el equipo del dueño. Las distintas vías (app de
 * Android, otras apps, la web y, como último recurso, yt-dlp) están explicadas en lib/youtube-captions.ts.
 */

export { videoIdOf };
export type { Segment } from "@/lib/youtube-captions";

const tooMany = createRateLimiter(30);
// Lo ya leído se guarda 15 minutos: volver a traducir el mismo vídeo (a otro idioma, con otro modelo…) es inmediato.
const cache = new Map<string, { at: number; result: CaptionsResult }>();
const CACHE_MS = 15 * 60_000;

export const Route = createFileRoute("/api/youtube")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const blocked = blockForeignSite(request);
        if (blocked) return blocked;
        if (tooMany()) return Response.json({ error: "Demasiadas consultas seguidas a YouTube. Espera un minuto." }, { status: 429 });
        let body: { url?: string };
        try {
          body = (await request.json()) as { url?: string };
        } catch {
          return Response.json({ error: "Petición no válida." }, { status: 400 });
        }
        const url = String(body.url ?? "");
        const id = videoIdOf(url);
        if (!id) return Response.json({ error: "Ese enlace no es un vídeo de YouTube." }, { status: 400 });

        const hit = cache.get(id);
        let result = hit && Date.now() - hit.at < CACHE_MS ? hit.result : null;
        if (!result) {
          const dataDir = await privateDataDir();
          result = await fetchCaptions(id, { fallback: (videoId) => ytDlpCaptions(videoId, dataDir) }, { isShort: isShortUrl(url) });
          if (result.ok) cache.set(id, { at: Date.now(), result });
          for (const [key, value] of cache) if (Date.now() - value.at > CACHE_MS) cache.delete(key);
        }

        if (!result.ok) {
          return Response.json({ videoId: id, title: result.title, segments: [], error: result.error, code: result.code }, { status: 200 });
        }
        return Response.json(
          { videoId: id, title: result.title, lang: result.lang, segments: result.segments, via: result.via },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
