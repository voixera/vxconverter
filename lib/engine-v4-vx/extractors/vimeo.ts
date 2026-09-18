import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - Vimeo Extractor
 * Uses Vimeo's player config API to resolve real progressive MP4 stream URLs.
 */
export class VimeoExtractor implements V4Extractor {
  public name = "VimeoExtractor";

  public canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes("vimeo.com") || host === "vimeo.com";
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    // Step 1: oEmbed for title, thumbnail, video_id
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(ctx.rawUrl)}`;
    const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(ctx.timeoutMs) }).catch(() => null);
    if (!oembedRes || !oembedRes.ok) return null;

    const data = await oembedRes.json().catch(() => null);
    if (!data) return null;

    const title = data.title || "Vimeo Video";
    const thumbnail = data.thumbnail_url || null;
    const duration = data.duration || null;
    const videoId = data.video_id;
    if (!videoId) return null;

    // Step 2: Player config API → real progressive MP4 URLs
    const media: MediaCandidate[] = [];
    try {
      const configRes = await fetch(`https://player.vimeo.com/video/${videoId}/config`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Referer: "https://vimeo.com/",
        },
        signal: AbortSignal.timeout(ctx.timeoutMs),
      }).catch(() => null);

      if (configRes && configRes.ok) {
        const config = await configRes.json().catch(() => null);
        const progressive: any[] = config?.request?.files?.progressive ?? [];

        // Sort descending by height
        progressive.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

        for (const fmt of progressive) {
          if (!fmt.url) continue;
          const h = fmt.height ?? 0;
          const quality = h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : `${h}p`;
          media.push({
            id: crypto.randomUUID(),
            title: `${title} (${quality})`,
            source_url: ctx.rawUrl,
            media_url: fmt.url,
            thumbnail_url: thumbnail,
            mime: "video/mp4",
            extension: "mp4",
            width: fmt.width ?? null,
            height: fmt.height ?? null,
            duration,
            filesize: null,
            quality,
            kind: "video",
            playable: true,
            is_direct: true,
          });
        }
      }
    } catch {
      // ponytail: config API blocked (private video, DRM) — fall back to embed
    }

    // Fallback: embed URL (playable in browser but not directly downloadable)
    if (media.length === 0) {
      media.push({
        id: crypto.randomUUID(),
        title: `${title} (Embed)`,
        source_url: ctx.rawUrl,
        media_url: `https://player.vimeo.com/video/${videoId}?autoplay=1`,
        thumbnail_url: thumbnail,
        mime: "video/mp4",
        extension: "mp4",
        width: data.width || null,
        height: data.height || null,
        duration,
        filesize: null,
        quality: "embed",
        kind: "stream",
        playable: true,
        is_direct: false,
      });
    }

    return { handled: true, provider: "vimeo.com", media };
  }
}
