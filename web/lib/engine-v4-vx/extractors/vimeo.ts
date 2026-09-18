import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - Vimeo Extractor
 */
export class VimeoExtractor implements V4Extractor {
  public name = "VimeoExtractor";

  public canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes("vimeo.com") || host === "vimeo.com";
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(ctx.rawUrl)}`;
    const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(ctx.timeoutMs) }).catch(() => null);
    if (!oembedRes || !oembedRes.ok) return null;

    const data = await oembedRes.json().catch(() => null);
    if (!data) return null;

    const title = data.title || "Vimeo Video";
    const thumbnail = data.thumbnail_url || null;
    const width = data.width || 1280;
    const height = data.height || 720;
    const duration = data.duration || null;
    const videoId = data.video_id;

    const media: MediaCandidate[] = [
      {
        id: crypto.randomUUID(),
        title: `${title} (Embed Stream)`,
        source_url: ctx.rawUrl,
        media_url: `https://player.vimeo.com/video/${videoId}?autoplay=1`,
        thumbnail_url: thumbnail,
        mime: "video/mp4",
        extension: "mp4",
        width,
        height,
        duration,
        filesize: null,
        quality: height >= 1080 ? "1080p" : "720p",
        kind: "stream",
        playable: true,
        is_direct: false,
      },
    ];

    return {
      handled: true,
      provider: "vimeo.com",
      media,
    };
  }
}
