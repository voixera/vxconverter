import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - YouTube Extractor
 * Uses @distube/ytdl-core (server-side only) to resolve real stream URLs.
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

    // Fetch oEmbed for title/thumbnail
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(ctx.timeoutMs) }).catch(() => null);
    const oembed = oembedRes && oembedRes.ok ? await oembedRes.json().catch(() => null) : null;

    const title = oembed?.title || "YouTube Video";
    const thumbnail = oembed?.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    // Resolve real stream URLs with ytdl-core (server-side only)
    let media: MediaCandidate[] = [];
    try {
      // Dynamic import keeps this out of client bundle
      const ytdl = await import("@distube/ytdl-core");
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const info = await ytdl.default.getInfo(watchUrl, {
        requestOptions: {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        },
      });

      // Pick best video+audio format (progressive), then best video-only
      const progressive = ytdl.default
        .filterFormats(info.formats, "videoandaudio")
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

      const videoOnly = ytdl.default
        .filterFormats(info.formats, "videoonly")
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

      const audioOnly = ytdl.default
        .filterFormats(info.formats, "audioonly")
        .sort((a, b) => (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0));

      const seen = new Set<string>();

      for (const fmt of progressive) {
        if (!fmt.url || seen.has(fmt.url)) continue;
        seen.add(fmt.url);
        const h = fmt.height ?? 0;
        const quality = h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : `${h}p`;
        media.push({
          id: crypto.randomUUID(),
          title: `${title} (${quality})`,
          source_url: ctx.rawUrl,
          media_url: fmt.url,
          thumbnail_url: thumbnail,
          mime: (fmt.mimeType?.split(";")[0] ?? "video/mp4"),
          extension: fmt.container ?? "mp4",
          width: fmt.width ?? null,
          height: fmt.height ?? null,
          duration: info.videoDetails.lengthSeconds ? Number(info.videoDetails.lengthSeconds) : null,
          filesize: fmt.contentLength ? Number(fmt.contentLength) : null,
          quality,
          kind: "video",
          playable: true,
          is_direct: true,
        });
        // cap at 3 progressive formats
        if (media.filter((m) => m.kind === "video").length >= 3) break;
      }

      // Best video-only (highest res) if no progressive found
      if (media.length === 0 && videoOnly.length > 0) {
        const fmt = videoOnly[0];
        if (fmt.url) {
          const h = fmt.height ?? 0;
          const quality = h >= 1080 ? "1080p" : h >= 720 ? "720p" : `${h}p`;
          media.push({
            id: crypto.randomUUID(),
            title: `${title} (${quality}, video only)`,
            source_url: ctx.rawUrl,
            media_url: fmt.url,
            thumbnail_url: thumbnail,
            mime: fmt.mimeType?.split(";")[0] ?? "video/mp4",
            extension: fmt.container ?? "mp4",
            width: fmt.width ?? null,
            height: fmt.height ?? null,
            duration: info.videoDetails.lengthSeconds ? Number(info.videoDetails.lengthSeconds) : null,
            filesize: fmt.contentLength ? Number(fmt.contentLength) : null,
            quality,
            kind: "video",
            playable: true,
            is_direct: true,
          });
        }
      }

      // Best audio track
      if (audioOnly.length > 0) {
        const fmt = audioOnly[0];
        if (fmt.url) {
          media.push({
            id: crypto.randomUUID(),
            title: `${title} (Audio)`,
            source_url: ctx.rawUrl,
            media_url: fmt.url,
            thumbnail_url: thumbnail,
            mime: fmt.mimeType?.split(";")[0] ?? "audio/webm",
            extension: fmt.container ?? "webm",
            width: null,
            height: null,
            duration: info.videoDetails.lengthSeconds ? Number(info.videoDetails.lengthSeconds) : null,
            filesize: fmt.contentLength ? Number(fmt.contentLength) : null,
            quality: "audio",
            kind: "audio",
            playable: true,
            is_direct: true,
          });
        }
      }
    } catch {
      // ponytail: ytdl-core failed (age-gated, bot-check, etc.) — fall back to embed links
      // Upgrade path: use yt-dlp subprocess or a cookies-based approach
      media = [
        {
          id: crypto.randomUUID(),
          title: `${title} (Embed)`,
          source_url: ctx.rawUrl,
          media_url: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`,
          thumbnail_url: thumbnail,
          mime: "video/mp4",
          extension: "mp4",
          width: 1280,
          height: 720,
          duration: null,
          filesize: null,
          quality: "embed",
          kind: "stream",
          playable: true,
          is_direct: false,
        },
      ];
    }

    return { handled: true, provider: "youtube.com", media };
  }
}
