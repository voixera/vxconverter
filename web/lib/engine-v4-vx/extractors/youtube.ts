import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - YouTube Extractor
 */
export class YouTubeExtractor implements V4Extractor {
  public name = "YouTubeExtractor";

  public canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host === "youtu.be" || host.endsWith(".youtube.com") || host === "youtube.com";
  }

  public extractVideoId(url: URL): string | null {
    if (url.hostname === "youtu.be") {
      return url.pathname.slice(1).split(/[?#]/)[0] || null;
    }
    if (url.searchParams.has("v")) {
      return url.searchParams.get("v");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.includes("shorts")) return parts[parts.indexOf("shorts") + 1] || null;
    if (parts.includes("embed")) return parts[parts.indexOf("embed") + 1] || null;
    if (parts.includes("v")) return parts[parts.indexOf("v") + 1] || null;
    return null;
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const videoId = this.extractVideoId(ctx.url);
    if (!videoId) return null;

    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(ctx.timeoutMs) }).catch(() => null);
    const oembed = oembedRes && oembedRes.ok ? await oembedRes.json().catch(() => null) : null;

    const title = oembed?.title || "YouTube Video";
    const thumbnail = oembed?.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const media: MediaCandidate[] = [
      {
        id: crypto.randomUUID(),
        title: `${title} (1080p Stream)`,
        source_url: ctx.rawUrl,
        media_url: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`,
        thumbnail_url: thumbnail,
        mime: "video/mp4",
        extension: "mp4",
        width: 1920,
        height: 1080,
        duration: null,
        filesize: null,
        quality: "1080p",
        kind: "stream",
        playable: true,
        is_direct: false,
      },
      {
        id: crypto.randomUUID(),
        title: `${title} (720p HD)`,
        source_url: ctx.rawUrl,
        media_url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail_url: thumbnail,
        mime: "video/mp4",
        extension: "mp4",
        width: 1280,
        height: 720,
        duration: null,
        filesize: null,
        quality: "720p",
        kind: "video",
        playable: true,
        is_direct: false,
      },
      {
        id: crypto.randomUUID(),
        title: `${title} (Audio Track)`,
        source_url: ctx.rawUrl,
        media_url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail_url: thumbnail,
        mime: "audio/mpeg",
        extension: "mp3",
        width: null,
        height: null,
        duration: null,
        filesize: null,
        quality: "audio",
        kind: "audio",
        playable: true,
        is_direct: false,
      },
    ];

    return {
      handled: true,
      provider: "youtube.com",
      media,
    };
  }
}
