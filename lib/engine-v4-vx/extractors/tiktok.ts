import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { CandidateFactory } from "../candidate";
import { ytdlpIsAvailable, ytdlpGetInfo } from "../ytdlp";
import { YouTubeExtractor } from "./youtube";
import type { MediaCandidate } from "../../types";

/**
 * ENGINE V4 VX - TikTok Extractor
 *
 * Prefers yt-dlp (handles signing). Falls back to parsing the page's embedded
 * JSON. Never returns the source URL as a fake "downloadable" candidate.
 */
export class TikTokExtractor implements V4Extractor {
  public name = "TikTokExtractor";

  public canHandle(url: URL): boolean {
    return url.hostname.toLowerCase().includes("tiktok.com");
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const media: MediaCandidate[] = [];

    // 1. yt-dlp first — most reliable for public TikToks.
    if (await ytdlpIsAvailable()) {
      try {
        const info = await ytdlpGetInfo(ctx.rawUrl, ctx.timeoutMs > 15000 ? ctx.timeoutMs : 30000);
        media.push(...YouTubeExtractor.buildCandidates(info, ctx.rawUrl));
      } catch {}
    }

    // 2. HTML parse fallback.
    if (media.length === 0) {
      const pageRes = await fetch(ctx.rawUrl, {
        headers: {
          "User-Agent": ctx.userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.tiktok.com/",
        },
        signal: AbortSignal.timeout(ctx.timeoutMs),
      }).catch(() => null);

      const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(ctx.rawUrl)}`, {
        signal: AbortSignal.timeout(ctx.timeoutMs),
      }).catch(() => null);
      const oembed = oembedRes && oembedRes.ok ? await oembedRes.json().catch(() => null) : null;
      const title = oembed?.title || "TikTok Video";
      const thumbnail = oembed?.thumbnail_url || null;

      if (pageRes && pageRes.ok) {
        const html = await pageRes.text().catch(() => "");
        let videoUrl: string | null = null;
        const universal = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
        if (universal) {
          try {
            const json = JSON.parse(universal[1]);
            const v = json?.["__DEFAULT_SCOPE__"]?.["webapp.video-detail"]?.itemInfo?.itemStruct?.video;
            videoUrl = v?.downloadAddr || v?.playAddr || null;
          } catch {}
        }
        if (!videoUrl) {
          const m = html.match(/"downloadAddr"\s*:\s*"([^"]+)"/) || html.match(/"playAddr"\s*:\s*"([^"]+)"/);
          if (m) videoUrl = m[1].replace(/\\u002F/g, "/").replace(/\\/g, "");
        }
        if (videoUrl) {
          media.push(CandidateFactory.make({
            url: videoUrl, title, sourceUrl: ctx.rawUrl, thumbnail,
            mime: "video/mp4", extension: "mp4", quality: "HD",
            kind: "video", playable: true, isDirect: true, source: "tiktok", platform: "tiktok.com",
          }));
        }
      }
    }

    if (media.length === 0) {
      const err: any = new Error("No public downloadable stream found for this TikTok");
      err.code = "NO_MEDIA_FOUND";
      throw err;
    }
    return { handled: true, provider: "tiktok.com", media };
  }
}
