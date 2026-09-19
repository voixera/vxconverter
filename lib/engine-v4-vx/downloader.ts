/**
 * ENGINE V4 VX - Download Resolver
 *
 * Given a media candidate, determine the REAL upstream URL(s) to fetch, verify
 * that the bytes are genuine media (never HTML/JSON), and (optionally) transcode
 * with ffmpeg. All heavy lifting for /api/download lives here so the route stays
 * thin and testable.
 */

import { SecurityGuard } from "./guard";
import { ResilientFetcher, EngineError, BROWSER_USER_AGENT } from "./fetcher";
import { MediaSniffer } from "./sniff";
import { FfmpegAdapter } from "./ffmpeg";
import { ytdlpGetFormats, ytdlpIsAvailable, needsYtdlp, YtdlpResolvedFormat } from "./ytdlp";
import type { MediaCandidate } from "../types";

export type ConvertTarget = "mp3" | "m4a" | "wav" | "mp4" | "webm";

export interface YtdlpPipePlan {
  kind: "ytdlp-pipe";
  selector: string;
  mergeContainer: "mp4" | "mkv";
  title: string;
  quality: string;
  hintMime: string;
  hintExtension: string;
}

export interface DirectPlan {
  kind: "direct";
  url: string;
  headers: Record<string, string>;
  hintMime?: string;
  hintExtension?: string;
  title: string;
  quality: string;
}

export type DownloadPlan = YtdlpPipePlan | DirectPlan;

export interface ResolveOptions {
  /** Desired output container, e.g. "mp3". Omit for pass-through. */
  convertTo?: ConvertTarget | null;
  /** Bytes of the upstream to sniff for validation (default 65536). */
  sniffBytes?: number;
  timeoutMs?: number;
}

export interface ResolvedSource {
  url: string;
  headers: Record<string, string>;
  hintMime?: string;
  hintExtension?: string;
  /** True if the URL needs yt-dlp pipe rather than a direct HTTP GET. */
  viaYtdlp?: { sourceUrl: string; formatId: string };
  title: string;
  quality: string;
}

/**
 * Build the referer/origin headers that some CDNs require for public media.
 */
function refererHeaders(sourceUrl?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!sourceUrl) return headers;
  try {
    const u = new URL(sourceUrl);
    headers["Referer"] = sourceUrl;
    headers["Origin"] = u.origin;
  } catch {}
  return headers;
}

export class DownloadResolver {
  /**
   * Determine the upstream URL(s) for a candidate. For platform URLs (YouTube,
   * TikTok) this re-resolves fresh signed URLs via yt-dlp at download time.
   */
  public static async resolveSource(media: MediaCandidate, opts: ResolveOptions = {}): Promise<ResolvedSource> {
    const sourceUrl = media.source_url || media.media_url;

    // Platform route: re-resolve via yt-dlp for fresh, downloadable URLs.
    if (sourceUrl && needsYtdlp(sourceUrl) && (await ytdlpIsAvailable())) {
      try {
        const formats = await ytdlpGetFormats(sourceUrl);
        if (formats.length) {
          const wantedKind = opts.convertTo && ["mp3", "m4a", "wav"].includes(opts.convertTo) ? "audio" : media.kind === "audio" ? "audio" : "video";
          let chosen = formats.find((f) => f.kind === wantedKind && f.quality === media.quality);
          if (!chosen) chosen = formats.find((f) => f.kind === wantedKind);
          if (!chosen) chosen = formats[0];

          return {
            url: chosen.url,
            headers: { "User-Agent": BROWSER_USER_AGENT, ...this.platformReferer(sourceUrl) },
            hintMime: chosen.ext === "webm" ? "video/webm" : chosen.kind === "audio" ? "audio/mp4" : "video/mp4",
            hintExtension: chosen.ext,
            viaYtdlp: { sourceUrl, formatId: chosen.format_id },
            title: media.title,
            quality: chosen.quality,
          };
        }
      } catch (err: any) {
        // If we have a direct URL we can fall through; otherwise surface it.
        if (!media.media_url || media.is_direct === false) {
          throw new EngineError("SOURCE_FETCH_FAILED", `Could not resolve platform stream: ${err?.message || "yt-dlp failed"}`);
        }
      }
    }

    // Direct / generic route.
    const url = media.media_url;
    if (!url) {
      throw new EngineError("MEDIA_NOT_FOUND", "This candidate has no resolvable media URL");
    }
    const check = SecurityGuard.isUrlSafe(url);
    if (!check.safe) {
      throw new EngineError("SSRF_BLOCKED", "Blocked: private or unsafe destination");
    }

    return {
      url,
      headers: refererHeaders(media.source_url),
      hintMime: media.mime,
      hintExtension: media.extension,
      title: media.title,
      quality: media.quality,
    };
  }

  /**
   * Decide how to obtain the media. Platform URLs that need signing/decryption
   * are routed through a yt-dlp pipe (yt-dlp fetches with the correct headers).
   * Everything else is a direct HTTP fetch.
   */
  public static async planDownload(media: MediaCandidate, opts: ResolveOptions = {}): Promise<DownloadPlan> {
    const sourceUrl = media.source_url || media.media_url;

    if (sourceUrl && needsYtdlp(sourceUrl) && (await ytdlpIsAvailable())) {
      const audioWanted = opts.convertTo ? ["mp3", "m4a", "wav"].includes(opts.convertTo) : media.kind === "audio";
      try {
        const formats = await ytdlpGetFormats(sourceUrl);
        if (formats.length) {
          // Pick a format matching the candidate's kind/quality when possible.
          const wantedKind = audioWanted ? "audio" : "video";
          let chosen =
            formats.find((f) => f.kind === wantedKind && f.quality === media.quality) ||
            formats.find((f) => f.kind === wantedKind) ||
            formats[0];

          const selector =
            audioWanted
              ? "bestaudio/best"
              : chosen.kind === "video"
                ? `${chosen.format_id}+bestaudio/${chosen.format_id}/best`
                : "bestvideo+bestaudio/best";

          return {
            kind: "ytdlp-pipe",
            selector,
            mergeContainer: "mp4",
            title: media.title,
            quality: chosen.quality,
            hintMime: audioWanted ? "audio/mp4" : "video/mp4",
            hintExtension: audioWanted ? "m4a" : "mp4",
          };
        }
      } catch (err: any) {
        if (!media.media_url || media.is_direct === false) {
          throw new EngineError("SOURCE_FETCH_FAILED", `Could not resolve platform stream: ${err?.message || "yt-dlp failed"}`);
        }
      }
    }

    const direct = await this.resolveSource(media, opts);
    return {
      kind: "direct",
      url: direct.url,
      headers: direct.headers,
      hintMime: direct.hintMime,
      hintExtension: direct.hintExtension,
      title: direct.title,
      quality: direct.quality,
    };
  }

  private static platformReferer(sourceUrl: string): Record<string, string> {
    try {
      const h = new URL(sourceUrl).hostname;
      if (h.includes("youtube") || h === "youtu.be") return { Referer: "https://www.youtube.com/", Origin: "https://www.youtube.com" };
      if (h.includes("tiktok")) return { Referer: "https://www.tiktok.com/" };
      if (h.includes("vimeo")) return { Referer: "https://vimeo.com/" };
      if (h.includes("reddit")) return { Referer: "https://www.reddit.com/" };
    } catch {}
    return {};
  }

  /**
   * Open the upstream stream and read the first bytes for validation.
   * Returns the validated real format plus a reader positioned after the
   * sniffed chunk.
   */
  public static async openAndValidate(
    source: ResolvedSource,
    opts: ResolveOptions = {},
  ): Promise<{
    response: Response;
    reader: ReadableStreamDefaultReader<Uint8Array>;
    firstChunk: Uint8Array;
    realFormat: string;
    realMime: string;
    realExtension: string;
    isStream: boolean;
    status: number;
  }> {
    const rangeHeader = opts.convertTo ? null : undefined; // caller passes range separately if needed

    const init: RequestInit = {
      headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "*/*", ...source.headers },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
    };

    let response: Response;
    try {
      response = await fetch(source.url, init);
    } catch (err: any) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        throw new EngineError("TIMEOUT", "Upstream media request timed out");
      }
      throw new EngineError("SOURCE_FETCH_FAILED", `Could not open upstream media: ${err?.message || "network error"}`);
    }

    if (!response.ok || !response.body) {
      const code =
        response.status === 404 ? "SOURCE_NOT_FOUND" :
        response.status === 403 ? "MEDIA_NOT_PUBLIC" :
        response.status === 429 ? "RATE_LIMITED" : "SOURCE_FETCH_FAILED";
      throw new EngineError(code, `Upstream responded with HTTP ${response.status}`, response.status);
    }

    const reader = response.body.getReader();
    const sniffBytes = opts.sniffBytes ?? 65536;
    let firstChunk: Uint8Array;
    try {
      const first = await reader.read();
      if (first.done || !first.value || first.value.length === 0) {
        throw new EngineError("MEDIA_VALIDATION_FAILED", "Upstream returned an empty stream");
      }
      firstChunk = first.value;
      // Accumulate a bit more if the first chunk is tiny.
      while (firstChunk.length < 512) {
        const more = await reader.read();
        if (more.done || !more.value) break;
        firstChunk = Buffer.concat([Buffer.from(firstChunk), Buffer.from(more.value)]);
      }
    } catch (err: any) {
      if (err instanceof EngineError) throw err;
      throw new EngineError("SOURCE_FETCH_FAILED", `Failed reading upstream: ${err?.message || "stream error"}`);
    }

    const sniff = MediaSniffer.sniff(firstChunk.subarray(0, Math.min(firstChunk.length, sniffBytes)));

    if (sniff.isHtmlOrJson) {
      throw new EngineError("MEDIA_VALIDATION_FAILED", "Source returned a web page or error payload instead of media (the media link is wrong, expired, or not public)");
    }

    // Determine the real mime/extension. If bytes are unknown but hint is a
    // valid media type, trust the hint; otherwise fail — never invent mp4.
    let realFormat = sniff.format;
    let realMime = sniff.mime;
    let realExtension = sniff.extension;

    if (!MediaSniffer.isKnownMedia(realFormat)) {
      const hint = (source.hintMime || "").toLowerCase();
      if (hint.includes("mpegurl") || source.hintExtension === "m3u8") {
        realFormat = "m3u8"; realMime = "application/vnd.apple.mpegurl"; realExtension = "m3u8";
      } else if (hint.startsWith("video/") || hint.startsWith("audio/")) {
        realMime = hint; realExtension = source.hintExtension || "bin";
      } else if (source.hintExtension && MediaSniffer.isKnownMedia(source.hintExtension)) {
        const h = source.hintExtension;
        realFormat = h; realExtension = h;
        realMime = h === "mp3" ? "audio/mpeg" : h === "webm" ? "video/webm" : "video/mp4";
      } else {
        throw new EngineError("MEDIA_TYPE_UNKNOWN", "Could not determine the real media format of the source bytes");
      }
    }

    return {
      response,
      reader,
      firstChunk,
      realFormat,
      realMime,
      realExtension,
      isStream: realFormat === "m3u8",
      status: response.status,
    };
  }

  /**
   * Download the FULL upstream into memory (bounded) and validate the container.
   * Used for conversion and for small files where a reliable Content-Length is
   * required before responding.
   */
  public static async downloadFull(
    source: ResolvedSource,
    opts: ResolveOptions & { maxBytes?: number } = {},
  ): Promise<{ buffer: Buffer; format: string; mime: string; extension: string; contentType: string }> {
    const maxBytes = opts.maxBytes ?? 512 * 1024 * 1024;

    const res = await fetch(source.url, {
      headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "*/*", ...source.headers },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180000),
    }).catch((err: any) => {
      throw new EngineError("SOURCE_FETCH_FAILED", `Could not open upstream media: ${err?.message || "network error"}`);
    });

    if (!res.ok || !res.body) {
      const code =
        res.status === 404 ? "SOURCE_NOT_FOUND" :
        res.status === 403 ? "MEDIA_NOT_PUBLIC" :
        res.status === 429 ? "RATE_LIMITED" : "SOURCE_FETCH_FAILED";
      throw new EngineError(code, `Upstream responded with HTTP ${res.status}`, res.status);
    }

    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        total += value.length;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new EngineError("MEDIA_VALIDATION_FAILED", `Media exceeds the safe in-memory limit (${Math.round(maxBytes / 1024 / 1024)}MB)`);
        }
        chunks.push(Buffer.from(value));
      }
    }

    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) {
      throw new EngineError("MEDIA_VALIDATION_FAILED", "Upstream returned an empty file");
    }

    const sniff = MediaSniffer.sniff(buffer.subarray(0, 4096));
    if (sniff.isHtmlOrJson) {
      throw new EngineError("MEDIA_VALIDATION_FAILED", "Downloaded content is a web page or error payload, not media");
    }

    return {
      buffer,
      format: sniff.format,
      mime: sniff.mime,
      extension: sniff.extension,
      contentType: (res.headers.get("content-type") || "").toLowerCase(),
    };
  }

  /**
   * Convert a downloaded buffer to the requested target and validate the output.
   */
  public static async convertBuffer(
    buffer: Buffer,
    inputExt: string,
    target: ConvertTarget,
    timeoutMs = 180000,
  ): Promise<{ buffer: Buffer; format: string; mime: string; extension: string }> {
    if (!(await FfmpegAdapter.isAvailable())) {
      throw new EngineError(
        "CONVERSION_UNAVAILABLE",
        "Conversion requires ffmpeg, which is not available in this environment. Download the source file instead, or run VX Converter on a host with ffmpeg installed.",
      );
    }

    let converted: Buffer;
    try {
      converted = await FfmpegAdapter.convert(buffer, target, { ext: inputExt, timeoutMs });
    } catch (err: any) {
      const code = err?.code || "CONVERSION_FAILED";
      throw new EngineError(code, `Conversion failed: ${err?.message || "ffmpeg error"}`);
    }

    const sniff = MediaSniffer.sniff(converted.subarray(0, 4096));
    if (sniff.isHtmlOrJson || !MediaSniffer.isKnownMedia(sniff.format)) {
      throw new EngineError("OUTPUT_VALIDATION_FAILED", "Converted output is not a valid media file");
    }
    // Ensure the converted container actually matches the requested target.
    const expectedOk =
      sniff.format === target ||
      (target === "m4a" && ["m4a", "mp4"].includes(sniff.format)) ||
      (target === "mp3" && sniff.format === "mp3");
    if (!expectedOk) {
      throw new EngineError("OUTPUT_VALIDATION_FAILED", `Conversion produced ${sniff.format}, expected ${target}`);
    }

    return { buffer: converted, format: sniff.format, mime: sniff.mime, extension: sniff.extension };
  }
}
