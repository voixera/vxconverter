import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { CandidateFactory } from "../candidate";
import { ytdlpIsAvailable, ytdlpGetInfo } from "../ytdlp";
import { YouTubeExtractor } from "./youtube";
import type { MediaCandidate } from "../../types";

/**
 * ENGINE V4 VX - Vimeo Extractor
 *
 * Strategy: player config API for public progressive MP4s; if that fails and
 * yt-dlp is available, fall back to yt-dlp. Never fabricates an embed as if it
 * were downloadable.
 */
export class VimeoExtractor implements V4Extractor {
  public name = "VimeoExtractor";

  public canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host === "vimeo.com" || host.endsWith(".vimeo.com");
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(ctx.rawUrl)}`;
    const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(ctx.timeoutMs) }).catch(() => null);
    const data = oembedRes && oembedRes.ok ? await oembedRes.json().catch(() => null) : null;

    const title = data?.title || "Vimeo Video";
    const thumbnail = data?.thumbnail_url || null;
    const duration = data?.duration || null;
    const videoId = data?.video_id;

    const media: MediaCandidate[] = [];

    if (videoId) {
      const configRes = await fetch(`https://player.vimeo.com/video/${videoId}/config`, {
        headers: { "User-Agent": ctx.userAgent, Referer: "https://vimeo.com/" },
        signal: AbortSignal.timeout(ctx.timeoutMs),
      }).catch(() => null);

      if (configRes && configRes.ok) {
        const config = await configRes.json().catch(() => null);
        const progressive: any[] = config?.request?.files?.progressive ?? [];
        progressive.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
        for (const fmt of progressive.slice(0, 6)) {
          if (!fmt.url) continue;
          const h = fmt.height ?? 0;
          const quality = h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : h > 0 ? `${h}p` : "source";
          media.push(CandidateFactory.make({
            url: fmt.url, title: `${title} (${quality})`, sourceUrl: ctx.rawUrl, thumbnail,
            mime: "video/mp4", extension: "mp4", width: fmt.width, height: fmt.height, duration,
            quality, kind: "video", playable: true, isDirect: true, source: "vimeo", platform: "vimeo.com",
          }));
        }
      }
    }

    // yt-dlp fallback for public videos the config API did not expose.
    if (media.length === 0 && (await ytdlpIsAvailable())) {
      try {
        const info = await ytdlpGetInfo(ctx.rawUrl, ctx.timeoutMs > 15000 ? ctx.timeoutMs : 30000);
        media.push(...YouTubeExtractor.buildCandidates(info, ctx.rawUrl));
      } catch {
        // fall through to error below
      }
    }

    if (media.length === 0) {
      const err: any = new Error("No public downloadable streams found for this Vimeo video (it may be private or embed-only)");
      err.code = "MEDIA_NOT_PUBLIC";
      throw err;
    }

    return { handled: true, provider: "vimeo.com", media };
  }
}
