import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - Reddit Extractor
 */
export class RedditExtractor implements V4Extractor {
  public name = "RedditExtractor";

  public canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes("reddit.com") || host === "redd.it" || host === "v.redd.it";
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    if (ctx.url.hostname === "v.redd.it") {
      const videoUrl = ctx.rawUrl.split("?")[0];
      const media: MediaCandidate[] = [
        {
          id: crypto.randomUUID(),
          title: "Reddit Video Stream",
          source_url: ctx.rawUrl,
          media_url: `${videoUrl}/HLSPlaylist.m3u8`,
          thumbnail_url: null,
          mime: "application/x-mpegurl",
          extension: "m3u8",
          width: null,
          height: null,
          duration: null,
          filesize: null,
          quality: "source",
          kind: "stream",
          playable: false,
          is_direct: true,
        },
      ];
      return { handled: true, provider: "v.redd.it", media };
    }

    const cleanUrl = ctx.rawUrl.split("?")[0].replace(/\/$/, "");
    const jsonUrl = `${cleanUrl}.json`;
    const res = await fetch(jsonUrl, {
      headers: { "User-Agent": ctx.userAgent },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    }).catch(() => null);

    if (!res || !res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data) || !data[0]?.data?.children?.[0]?.data) return null;

    const post = data[0].data.children[0].data;
    const title = post.title || "Reddit Media";
    const thumbnail = post.thumbnail && post.thumbnail.startsWith("http") ? post.thumbnail : null;
    const media: MediaCandidate[] = [];

    if (post.secure_media?.reddit_video?.fallback_url) {
      const vid = post.secure_media.reddit_video;
      // Reddit DASH: fallback_url is video-only (no audio track).
      // Audio lives at <base>/DASH_audio.mp4. We expose both separately.
      // ponytail: muxing video+audio requires ffmpeg — add when server-side ffmpeg available.
      const baseUrl = (vid.fallback_url as string).replace(/\/DASH_[^/?]+/, "");
      const audioUrl = `${baseUrl}/DASH_audio.mp4`;

      media.push({
        id: crypto.randomUUID(),
        title: `${title} (${vid.height}p, video only — no audio)`,
        source_url: ctx.rawUrl,
        media_url: vid.fallback_url,
        thumbnail_url: thumbnail,
        mime: "video/mp4",
        extension: "mp4",
        width: vid.width,
        height: vid.height,
        duration: vid.duration,
        filesize: null,
        quality: `${vid.height}p`,
        kind: "video",
        playable: true,
        is_direct: true,
      });

      // Audio track (separate)
      media.push({
        id: crypto.randomUUID(),
        title: `${title} (Audio)`,
        source_url: ctx.rawUrl,
        media_url: audioUrl,
        thumbnail_url: thumbnail,
        mime: "audio/mp4",
        extension: "mp4",
        width: null,
        height: null,
        duration: vid.duration,
        filesize: null,
        quality: "audio",
        kind: "audio",
        playable: true,
        is_direct: true,
      });
      if (vid.hls_url) {
        media.push({
          id: crypto.randomUUID(),
          title: `${title} (HLS Stream)`,
          source_url: ctx.rawUrl,
          media_url: vid.hls_url,
          thumbnail_url: thumbnail,
          mime: "application/x-mpegurl",
          extension: "m3u8",
          width: vid.width,
          height: vid.height,
          duration: vid.duration,
          filesize: null,
          quality: "source",
          kind: "stream",
          playable: false,
          is_direct: true,
        });
      }
    }

    return media.length ? { handled: true, provider: "reddit.com", media } : null;
  }
}
