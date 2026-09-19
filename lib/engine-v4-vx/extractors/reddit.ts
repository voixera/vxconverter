import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { CandidateFactory } from "../candidate";
import type { MediaCandidate } from "../../types";

/**
 * ENGINE V4 VX - Reddit Extractor
 */
export class RedditExtractor implements V4Extractor {
  public name = "RedditExtractor";

  public canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.endsWith("reddit.com") || host === "redd.it" || host === "v.redd.it";
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    if (ctx.url.hostname === "v.redd.it") {
      const base = ctx.rawUrl.split("?")[0];
      return {
        handled: true,
        provider: "v.redd.it",
        media: [
          CandidateFactory.make({
            url: `${base}/HLSPlaylist.m3u8`, title: "Reddit Video (HLS)", sourceUrl: ctx.rawUrl,
            mime: "application/vnd.apple.mpegurl", extension: "m3u8", kind: "stream",
            playable: false, isDirect: true, source: "reddit", platform: "v.redd.it",
          }),
          CandidateFactory.make({
            url: `${base}/DASH_720.mp4`, title: "Reddit Video (MP4)", sourceUrl: ctx.rawUrl,
            mime: "video/mp4", extension: "mp4", kind: "video", playable: true,
            isDirect: true, source: "reddit", platform: "v.redd.it",
          }),
        ],
      };
    }

    const cleanUrl = ctx.rawUrl.split("?")[0].replace(/\/$/, "");
    const res = await fetch(`${cleanUrl}.json`, {
      headers: { "User-Agent": ctx.userAgent },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    }).catch(() => null);

    if (!res || !res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data) || !data[0]?.data?.children?.[0]?.data) return null;

    const post = data[0].data.children[0].data;
    const title = post.title || "Reddit Media";
    const thumbnail = post.thumbnail && String(post.thumbnail).startsWith("http") ? post.thumbnail : null;
    const media: MediaCandidate[] = [];

    const vid = post.secure_media?.reddit_video || post.media?.reddit_video;
    if (vid?.fallback_url) {
      const baseUrl = String(vid.fallback_url).replace(/\/DASH_[^/?]+/, "");

      // Best: HLS contains muxed audio+video — offer it as the primary stream.
      if (vid.hls_url) {
        media.push(CandidateFactory.make({
          url: vid.hls_url, title: `${title} (HLS, audio+video)`, sourceUrl: ctx.rawUrl, thumbnail,
          mime: "application/vnd.apple.mpegurl", extension: "m3u8",
          width: vid.width, height: vid.height, duration: vid.duration,
          quality: `${vid.height}p`, kind: "stream", playable: false, isDirect: true,
          source: "reddit-hls", platform: "reddit.com",
        }));
      }

      // Progressive DASH video (video-only; audio separate) — labeled honestly.
      media.push(CandidateFactory.make({
        url: vid.fallback_url, title: `${title} (${vid.height}p, video only)`, sourceUrl: ctx.rawUrl, thumbnail,
        mime: "video/mp4", extension: "mp4", width: vid.width, height: vid.height, duration: vid.duration,
        quality: `${vid.height}p`, kind: "video", playable: true, isDirect: true,
        source: "reddit", platform: "reddit.com",
      }));

      media.push(CandidateFactory.make({
        url: `${baseUrl}/DASH_audio.mp4`, title: `${title} (Audio)`, sourceUrl: ctx.rawUrl, thumbnail,
        mime: "audio/mp4", extension: "m4a", duration: vid.duration,
        quality: "audio", kind: "audio", playable: true, isDirect: true,
        source: "reddit", platform: "reddit.com",
      }));
    }

    return media.length ? { handled: true, provider: "reddit.com", media } : null;
  }
}
