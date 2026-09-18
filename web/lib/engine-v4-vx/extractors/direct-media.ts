import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { MimeDetector } from "../mime";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - Direct Media Extractor
 */
export class DirectMediaExtractor implements V4Extractor {
  public name = "DirectMediaExtractor";

  public canHandle(url: URL): boolean {
    const cleanUrl = url.pathname.toLowerCase();
    return /\.(mp4|m4v|webm|ogv|mov|avi|mkv|flv|ts|m3u8|mp3|m4a|aac|wav|ogg|opus|flac)(?:$|\?)/i.test(cleanUrl);
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const headRes = await fetch(ctx.rawUrl, {
      method: "HEAD",
      headers: { "User-Agent": ctx.userAgent },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    }).catch(() => null);

    const contentType = headRes?.headers.get("content-type") || null;
    const contentLength = headRes?.headers.get("content-length") ? Number(headRes.headers.get("content-length")) : null;

    const mimeInfo = MimeDetector.resolve(ctx.rawUrl, contentType);
    const title = ctx.url.pathname.split("/").filter(Boolean).pop() || "Direct Media";

    const media: MediaCandidate[] = [
      {
        id: crypto.randomUUID(),
        title,
        source_url: ctx.rawUrl,
        media_url: ctx.rawUrl,
        thumbnail_url: null,
        mime: mimeInfo.mime,
        extension: mimeInfo.extension,
        width: null,
        height: null,
        duration: null,
        filesize: contentLength,
        quality: "source",
        kind: mimeInfo.kind,
        playable: mimeInfo.playable,
        is_direct: true,
      },
    ];

    return {
      handled: true,
      provider: ctx.url.hostname,
      media,
    };
  }
}
