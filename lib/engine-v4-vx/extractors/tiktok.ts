import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - TikTok Extractor
 */
export class TikTokExtractor implements V4Extractor {
  public name = "TikTokExtractor";

  public canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes("tiktok.com");
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(ctx.rawUrl)}`;
    const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(ctx.timeoutMs) }).catch(() => null);
    if (!oembedRes || !oembedRes.ok) return null;

    const data = await oembedRes.json().catch(() => null);
    if (!data) return null;

    const title = data.title || "TikTok Video";
    const thumbnail = data.thumbnail_url || null;

    const media: MediaCandidate[] = [
      {
        id: crypto.randomUUID(),
        title,
        source_url: ctx.rawUrl,
        media_url: ctx.rawUrl,
        thumbnail_url: thumbnail,
        mime: "video/mp4",
        extension: "mp4",
        width: 1080,
        height: 1920,
        duration: null,
        filesize: null,
        quality: "HD",
        kind: "video",
        playable: true,
        is_direct: false,
      },
    ];

    return {
      handled: true,
      provider: "tiktok.com",
      media,
    };
  }
}
