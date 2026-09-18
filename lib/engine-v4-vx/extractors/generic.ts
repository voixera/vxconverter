import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { MimeDetector } from "../mime";
import { ResilientFetcher } from "../fetcher";
import { OpenGraphExtractor } from "./opengraph";
import { HTML5Extractor } from "./html5";
import { JsonLdExtractor } from "./jsonld";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - Generic Fallback Web Page Extractor
 */
export class GenericExtractor implements V4Extractor {
  public name = "GenericExtractor";

  public canHandle(_url: URL): boolean {
    return true; // Always available as universal fallback
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const fetchRes = await ResilientFetcher.fetch(ctx.url, ctx.timeoutMs);
    const media: MediaCandidate[] = [];
    const seen = new Set<string>();

    // 1. Direct media response check
    if (
      fetchRes.contentType.startsWith("video/") ||
      fetchRes.contentType.startsWith("audio/") ||
      fetchRes.contentType.includes("mpegurl")
    ) {
      const mimeInfo = MimeDetector.resolve(fetchRes.url, fetchRes.contentType);
      const title = fetchRes.finalUrl.pathname.split("/").filter(Boolean).pop() || "Direct Stream";
      media.push({
        id: crypto.randomUUID(),
        title,
        source_url: ctx.rawUrl,
        media_url: fetchRes.url,
        thumbnail_url: null,
        mime: mimeInfo.mime,
        extension: mimeInfo.extension,
        width: null,
        height: null,
        duration: null,
        filesize: fetchRes.contentLength,
        quality: "source",
        kind: mimeInfo.kind,
        playable: mimeInfo.playable,
        is_direct: true,
      });
      return { handled: true, provider: fetchRes.finalUrl.hostname, media };
    }

    // 2. HTML text inspection (even if status is 403/404, check if HTML body contains media tags)
    if (fetchRes.html) {
      const html = fetchRes.html;

      // Run OpenGraph, HTML5, and JSON-LD parsers
      const ogResults = OpenGraphExtractor.parseHtml(html, fetchRes.finalUrl);
      const html5Results = HTML5Extractor.parseHtml(html, fetchRes.finalUrl);
      const jsonLdResults = JsonLdExtractor.parseHtml(html, fetchRes.finalUrl);

      for (const item of [...ogResults, ...html5Results, ...jsonLdResults]) {
        if (!seen.has(item.media_url)) {
          seen.add(item.media_url);
          media.push(item);
        }
      }

      // 3. Fallback regex for inline .m3u8, .mp4, .webm in scripts
      const directPattern = /(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|webm|mov|mp3|m4a|aac|wav|ogg|flac)(?:\?[^\s"'<>\\]*)?)/gi;
      let match: RegExpExecArray | null;

      const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || "Discovered Media";
      const ogImage = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1];
      let thumbnail: string | null = null;
      if (ogImage) {
        try {
          thumbnail = new URL(ogImage, fetchRes.finalUrl).toString();
        } catch {}
      }

      while ((match = directPattern.exec(html))) {
        const rawUrl = match[1];
        let absUrl: string;
        try {
          absUrl = new URL(rawUrl, fetchRes.finalUrl).toString();
        } catch {
          continue;
        }

        if (!seen.has(absUrl)) {
          seen.add(absUrl);
          const mimeInfo = MimeDetector.resolve(absUrl);
          media.push({
            id: crypto.randomUUID(),
            title: pageTitle,
            source_url: ctx.url.toString(),
            media_url: absUrl,
            thumbnail_url: thumbnail,
            mime: mimeInfo.mime,
            extension: mimeInfo.extension,
            width: null,
            height: null,
            duration: null,
            filesize: null,
            quality: "source",
            kind: mimeInfo.kind,
            playable: mimeInfo.playable,
            is_direct: true,
          });
        }
      }
    }

    if (media.length > 0) {
      return { handled: true, provider: fetchRes.finalUrl.hostname, media };
    }

    // If no media found and HTTP status was an error, surface clean status error
    if (!fetchRes.ok) {
      const err = new Error(
        fetchRes.status === 404
          ? "Source page was not found (HTTP 404). Check the URL or media may have been removed."
          : fetchRes.status === 403
            ? "Source server denied access (HTTP 403). Content may be private or protected."
            : fetchRes.status === 429
              ? "Source server rate limited requests (HTTP 429). Try again shortly."
              : `Source returned HTTP ${fetchRes.status}`,
      );
      (err as any).code = "UPSTREAM_ERROR";
      throw err;
    }

    return null;
  }
}
