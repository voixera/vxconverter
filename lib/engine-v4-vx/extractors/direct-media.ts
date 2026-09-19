import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { MimeDetector } from "../mime";
import { MediaSniffer } from "../sniff";
import { ResilientFetcher, EngineError } from "../fetcher";
import { CandidateFactory } from "../candidate";
import type { MediaCandidate } from "../../types";

const DIRECT_EXT_RE = /\.(mp4|m4v|webm|ogv|mov|avi|mkv|flv|ts|m3u8|mpd|mp3|m4a|aac|wav|ogg|opus|flac)(?:$|[?#])/i;

/**
 * ENGINE V4 VX - Direct Media Extractor
 *
 * For URLs that already point at a media file. Probes the actual bytes rather
 * than trusting the extension: a .mp4 that actually serves HTML is reported
 * as HTML, never as video.
 */
export class DirectMediaExtractor implements V4Extractor {
  public name = "DirectMediaExtractor";

  public canHandle(url: URL): boolean {
    return DIRECT_EXT_RE.test(url.pathname);
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    let probe;
    try {
      probe = await ResilientFetcher.probe(ctx.rawUrl, ctx.timeoutMs, 4096);
    } catch (err: any) {
      if (err instanceof EngineError) throw err;
      throw new EngineError("SOURCE_FETCH_FAILED", err?.message || "Probe failed");
    }

    if (!probe.ok) {
      const code =
        probe.status === 404 ? "SOURCE_NOT_FOUND" :
        probe.status === 403 ? "MEDIA_NOT_PUBLIC" :
        probe.status === 429 ? "RATE_LIMITED" :
        "SOURCE_FETCH_FAILED";
      throw new EngineError(code, `Direct media responded with HTTP ${probe.status}`, probe.status);
    }

    // Determine the REAL type from magic bytes first, then headers, then ext.
    const sniff = probe.headBytes ? MediaSniffer.sniff(probe.headBytes) : null;
    if (sniff?.isHtmlOrJson) {
      throw new EngineError("MEDIA_TYPE_UNKNOWN", "URL returned a web page, not media (the file URL is wrong or expired)", probe.status);
    }

    let mime = probe.contentType;
    let extension: string | undefined;
    if (sniff && MediaSniffer.isKnownMedia(sniff.format)) {
      mime = sniff.mime;
      extension = sniff.extension;
    } else if (!MimeDetector.isMediaMime(mime)) {
      // Header said octet-stream (or nothing) and the bytes are unknown.
      // Fall back to URL extension but do not invent video/mp4.
      const resolved = MimeDetector.resolve(ctx.rawUrl, mime || undefined);
      mime = resolved.mime;
      extension = resolved.extension;
    }

    const title = decodeURIComponent(ctx.url.pathname.split("/").filter(Boolean).pop() || "Direct Media");

    const candidate: MediaCandidate = CandidateFactory.make({
      url: probe.finalUrl || ctx.rawUrl,
      title,
      sourceUrl: ctx.rawUrl,
      mime,
      extension,
      filesize: probe.contentLength,
      quality: "source",
      isDirect: true,
      source: "direct-media",
      platform: ctx.url.hostname,
    });

    return { handled: true, provider: ctx.url.hostname, media: [candidate] };
  }
}
