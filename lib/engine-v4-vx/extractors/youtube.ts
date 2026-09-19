import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { CandidateFactory } from "../candidate";
import { ytdlpGetInfo, ytdlpIsAvailable, YtdlpInfo, YtdlpFormat } from "../ytdlp";
import type { MediaCandidate } from "../../types";

/**
 * ENGINE V4 VX - YouTube Extractor (yt-dlp adapter)
 *
 * yt-dlp resolves real signed stream URLs + metadata. The signed URLs expire,
 * so the candidate keeps `source_url` = canonical watch URL and the download
 * route re-resolves fresh URLs via yt-dlp at download time.
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
    if (parts[0] === "live") return parts[1] || null;
    return null;
  }

  public static buildCandidates(info: YtdlpInfo, watchUrl: string): MediaCandidate[] {
    const media: MediaCandidate[] = [];
    const fmts = info.formats || [];
    const title = info.title || "YouTube Video";
    const thumbnail = info.thumbnail || null;
    const duration = info.duration ?? null;

    const hasVideo = (f: YtdlpFormat) => !!f.vcodec && f.vcodec !== "none";
    const hasAudio = (f: YtdlpFormat) => !!f.acodec && f.acodec !== "none";
    const isHttp = (f: YtdlpFormat) =>
      !f.protocol || ["https", "http", "https+http_dash_segments", "m3u8", "m3u8_native"].includes(f.protocol);

    const qualityFor = (h: number | null | undefined) =>
      !h ? "SD" : h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : h >= 360 ? "360p" : `${h}p`;

    const seen = new Set<string>();
    const push = (c: MediaCandidate) => {
      if (seen.has(c.media_url)) return;
      seen.add(c.media_url);
      media.push(c);
    };

    // 1. Progressive (video+audio muxed) — best first.
    const progressive = fmts
      .filter((f) => hasVideo(f) && hasAudio(f) && f.url && isHttp(f))
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    for (const f of progressive.slice(0, 3)) {
      const q = qualityFor(f.height);
      push(CandidateFactory.make({
        url: f.url,
        title: `${title} (${q})`,
        sourceUrl: watchUrl,
        thumbnail,
        mime: f.ext === "webm" ? "video/webm" : "video/mp4",
        extension: f.ext || "mp4",
        width: f.width, height: f.height, duration,
        filesize: f.filesize ?? f.filesize_approx ?? null,
        quality: q, kind: "video", playable: true, isDirect: true,
        source: "youtube", platform: "youtube.com",
      }));
    }

    // 2. Best video + best audio (separate) — for muxing at download time.
    if (media.filter((m) => m.kind === "video").length === 0) {
      const videoOnly = fmts
        .filter((f) => hasVideo(f) && !hasAudio(f) && f.url && isHttp(f))
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
      const bestVideo = videoOnly[0];

      if (bestVideo) {
        const q = qualityFor(bestVideo.height);
        push(CandidateFactory.make({
          url: bestVideo.url,
          title: `${title} (${q}, muxed)`,
          sourceUrl: watchUrl,
          thumbnail,
          mime: "video/mp4",
          extension: "mp4",
          width: bestVideo.width, height: bestVideo.height, duration,
          filesize: bestVideo.filesize ?? bestVideo.filesize_approx ?? null,
          quality: q, kind: "video", playable: true, isDirect: true,
          source: "youtube-muxed", platform: "youtube.com",
        }));

        push(CandidateFactory.make({
          url: bestVideo.url,
          title: `${title} (${q}, video only)`,
          sourceUrl: watchUrl,
          thumbnail,
          mime: bestVideo.ext === "webm" ? "video/webm" : "video/mp4",
          extension: bestVideo.ext || "mp4",
          width: bestVideo.width, height: bestVideo.height, duration,
          filesize: bestVideo.filesize ?? bestVideo.filesize_approx ?? null,
          quality: q, kind: "video", playable: true, isDirect: true,
          source: "youtube", platform: "youtube.com",
        }));
      }
    }

    // 3. Best audio-only.
    const audioOnly = fmts
      .filter((f) => !hasVideo(f) && hasAudio(f) && f.url && isHttp(f))
      .sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0));
    const bestAudio = audioOnly[0];
    if (bestAudio) {
      push(CandidateFactory.make({
        url: bestAudio.url,
        title: `${title} (Audio)`,
        sourceUrl: watchUrl,
        thumbnail,
        mime: bestAudio.ext === "webm" ? "audio/webm" : "audio/mp4",
        extension: bestAudio.ext || "m4a",
        duration,
        filesize: bestAudio.filesize ?? bestAudio.filesize_approx ?? null,
        quality: "audio", kind: "audio", playable: true, isDirect: true,
        source: "youtube", platform: "youtube.com",
      }));
    }

    return media;
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const videoId = this.extractVideoId(ctx.url);
    if (!videoId) return null;

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (!(await ytdlpIsAvailable())) {
      // No extractor available — report truthfully, do not emit a fake entry.
      const err: any = new Error("yt-dlp is not available in this environment to resolve YouTube streams");
      err.code = "UNSUPPORTED_SOURCE";
      throw err;
    }

    const info = await ytdlpGetInfo(watchUrl, ctx.timeoutMs > 15000 ? ctx.timeoutMs : 30000);
    const media = YouTubeExtractor.buildCandidates(info, watchUrl);

    if (media.length === 0) {
      const err: any = new Error("No downloadable formats were found for this video");
      err.code = "NO_MEDIA_FOUND";
      throw err;
    }

    return { handled: true, provider: "youtube.com", media };
  }
}
