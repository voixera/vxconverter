import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import type { MediaCandidate } from "../../types";
import { ytdlpGetInfo } from "../ytdlp";

/**
 * Engine V4 VX - YouTube Extractor
 * Uses yt-dlp to get real signed stream URLs + metadata.
 * source_url is stored so download route can re-resolve at download time
 * (YouTube signed URLs expire; we re-run yt-dlp on download to get fresh URL).
 */
export class YouTubeExtractor implements V4Extractor {
  public name = "YouTubeExtractor";

  public canHandle(url: URL): boolean {
    const h = url.hostname.toLowerCase();
    return h === "youtu.be" || h.endsWith(".youtube.com") || h === "youtube.com";
  }

  public extractVideoId(url: URL): string | null {
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split(/[?#]/)[0] || null;
    if (url.searchParams.has("v")) return url.searchParams.get("v");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.includes("shorts")) return parts[parts.indexOf("shorts") + 1] || null;
    if (parts.includes("embed")) return parts[parts.indexOf("embed") + 1] || null;
    return null;
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const videoId = this.extractVideoId(ctx.url);
    if (!videoId) return null;

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    let title = "YouTube Video";
    let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    let duration: number | null = null;
    const media: MediaCandidate[] = [];

    try {
      const info = await ytdlpGetInfo(watchUrl, ctx.timeoutMs);
      title = info.title || title;
      thumbnail = info.thumbnail || thumbnail;
      duration = info.duration ?? null;

      const fmts = info.formats || [];
      const hasVideo = (f: any) => f.vcodec && f.vcodec !== "none";
      const hasAudio = (f: any) => f.acodec && f.acodec !== "none";
      const isHttp = (f: any) =>
        !f.protocol || f.protocol === "https" || f.protocol === "http" || f.protocol === "https+http_dash_segments";

      // Progressive (video + audio) — best first
      const progressive = fmts
        .filter((f: any) => hasVideo(f) && hasAudio(f) && f.url && isHttp(f))
        .sort((a: any, b: any) => (b.height ?? 0) - (a.height ?? 0));

      const seen = new Set<string>();

      for (const f of progressive.slice(0, 3)) {
        if (seen.has(f.url)) continue;
        seen.add(f.url);
        const h = f.height ?? 0;
        const quality = h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : h > 0 ? `${h}p` : "SD";
        media.push({
          id: crypto.randomUUID(),
          title: `${title} (${quality})`,
          source_url: watchUrl, // used by download route to re-resolve
          media_url: f.url,
          thumbnail_url: thumbnail,
          mime: f.ext === "webm" ? "video/webm" : "video/mp4",
          extension: f.ext || "mp4",
          width: f.width ?? null,
          height: f.height ?? null,
          duration,
          filesize: f.filesize ?? f.filesize_approx ?? null,
          quality,
          kind: "video",
          playable: true,
          is_direct: true,
        });
      }

      // Video-only fallback (no progressive found)
      if (media.filter((m) => m.kind === "video").length === 0) {
        const videoOnly = fmts
          .filter((f: any) => hasVideo(f) && !hasAudio(f) && f.url && isHttp(f))
          .sort((a: any, b: any) => (b.height ?? 0) - (a.height ?? 0));

        for (const f of videoOnly.slice(0, 2)) {
          if (seen.has(f.url)) continue;
          seen.add(f.url);
          const h = f.height ?? 0;
          const quality = h >= 1080 ? "1080p" : h >= 720 ? "720p" : h > 0 ? `${h}p` : "video";
          media.push({
            id: crypto.randomUUID(),
            title: `${title} (${quality}, video only)`,
            source_url: watchUrl,
            media_url: f.url,
            thumbnail_url: thumbnail,
            mime: f.ext === "webm" ? "video/webm" : "video/mp4",
            extension: f.ext || "mp4",
            width: f.width ?? null,
            height: f.height ?? null,
            duration,
            filesize: f.filesize ?? f.filesize_approx ?? null,
            quality,
            kind: "video",
            playable: true,
            is_direct: true,
          });
        }
      }

      // Best audio-only
      const audioOnly = fmts
        .filter((f: any) => !hasVideo(f) && hasAudio(f) && f.url && isHttp(f))
        .sort((a: any, b: any) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0));

      if (audioOnly.length > 0) {
        const f = audioOnly[0];
        if (!seen.has(f.url)) {
          seen.add(f.url);
          media.push({
            id: crypto.randomUUID(),
            title: `${title} (Audio)`,
            source_url: watchUrl,
            media_url: f.url,
            thumbnail_url: thumbnail,
            mime: f.ext === "webm" ? "audio/webm" : "audio/mp4",
            extension: f.ext || "m4a",
            width: null,
            height: null,
            duration,
            filesize: f.filesize ?? f.filesize_approx ?? null,
            quality: "audio",
            kind: "audio",
            playable: true,
            is_direct: true,
          });
        }
      }
    } catch (err: any) {
      // yt-dlp failed — surface a clear non-downloadable embed placeholder
      media.push({
        id: crypto.randomUUID(),
        title: `${title} (Embed — download unavailable)`,
        source_url: watchUrl,
        media_url: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`,
        thumbnail_url: thumbnail,
        mime: "video/mp4",
        extension: "mp4",
        width: null,
        height: null,
        duration: null,
        filesize: null,
        quality: "embed",
        kind: "stream",
        playable: true,
        is_direct: false,
      });
    }

    return { handled: true, provider: "youtube.com", media };
  }
}
