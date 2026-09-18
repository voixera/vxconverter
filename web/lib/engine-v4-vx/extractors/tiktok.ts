import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - TikTok Extractor
 * Fetches page HTML and extracts real CDN video URL from __UNIVERSAL_DATA__ / SIGI_STATE JSON.
 */
export class TikTokExtractor implements V4Extractor {
  public name = "TikTokExtractor";

  public canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes("tiktok.com");
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    // oEmbed for title/thumbnail (lightweight, always works)
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(ctx.rawUrl)}`;
    const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(ctx.timeoutMs) }).catch(() => null);
    const oembedData = oembedRes && oembedRes.ok ? await oembedRes.json().catch(() => null) : null;

    const title = oembedData?.title || "TikTok Video";
    const thumbnail = oembedData?.thumbnail_url || null;

    // Fetch the TikTok page to extract the real CDN URL from embedded JSON
    const pageRes = await fetch(ctx.rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.tiktok.com/",
      },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    }).catch(() => null);

    if (!pageRes || !pageRes.ok) {
      // Can't fetch page — return original URL as best-effort (will fail at download)
      return {
        handled: true,
        provider: "tiktok.com",
        media: [
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
        ],
      };
    }

    const html = await pageRes.text().catch(() => "");

    // Try to extract from __UNIVERSAL_DATA__ (newer TikTok pages)
    let videoUrl: string | null = null;
    let noWatermarkUrl: string | null = null;

    const universalMatch = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);
    if (universalMatch) {
      try {
        const json = JSON.parse(universalMatch[1]);
        // Navigate the nested structure
        const defaultScope = json?.["__DEFAULT_SCOPE__"];
        const videoDetail =
          defaultScope?.["webapp.video-detail"]?.itemInfo?.itemStruct?.video;
        if (videoDetail) {
          videoUrl = videoDetail.downloadAddr || videoDetail.playAddr || null;
          noWatermarkUrl = videoDetail.downloadAddr || null;
        }
      } catch {}
    }

    // Fallback: SIGI_STATE
    if (!videoUrl) {
      const sigiMatch = html.match(/<script[^>]*id="SIGI_STATE"[^>]*>([^<]+)<\/script>/);
      if (sigiMatch) {
        try {
          const json = JSON.parse(sigiMatch[1]);
          const items = json?.ItemModule;
          if (items) {
            const first = Object.values(items)[0] as any;
            videoUrl = first?.video?.downloadAddr || first?.video?.playAddr || null;
          }
        } catch {}
      }
    }

    // Fallback: regex hunt for cdn .mp4 in page
    if (!videoUrl) {
      const cdnMatch = html.match(/"downloadAddr"\s*:\s*"([^"]+)"/);
      videoUrl = cdnMatch ? cdnMatch[1].replace(/\\u002F/g, "/").replace(/\\/g, "") : null;
    }
    if (!videoUrl) {
      const playMatch = html.match(/"playAddr"\s*:\s*"([^"]+)"/);
      videoUrl = playMatch ? playMatch[1].replace(/\\u002F/g, "/").replace(/\\/g, "") : null;
    }

    const media: MediaCandidate[] = [];
    if (videoUrl) {
      media.push({
        id: crypto.randomUUID(),
        title,
        source_url: ctx.rawUrl,
        media_url: videoUrl,
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
        is_direct: true,
      });
    } else {
      // ponytail: couldn't parse CDN URL — TikTok changed page structure
      // Upgrade: use a dedicated TikTok API wrapper or yt-dlp subprocess
      media.push({
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
      });
    }

    return { handled: true, provider: "tiktok.com", media };
  }
}
