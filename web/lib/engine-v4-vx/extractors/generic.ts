import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { MimeDetector } from "../mime";
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
    return true;
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const res = await fetch(ctx.rawUrl, {
      headers: {
        "User-Agent": ctx.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,video/*,audio/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? "Source page was not found (HTTP 404). Check the URL or media may have been removed."
          : res.status === 403
            ? "Source server denied access (HTTP 403). Content may be private or protected."
            : res.status === 429
              ? "Source server rate limited requests (HTTP 429). Try again shortly."
              : `Source returned HTTP ${res.status}`,
      );
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const media: MediaCandidate[] = [];
    const seen = new Set<string>();

    if (contentType.startsWith("video/") || contentType.startsWith("audio/") || contentType.includes("mpegurl")) {
      const mimeInfo = MimeDetector.resolve(ctx.rawUrl, contentType);
      const title = ctx.url.pathname.split("/").filter(Boolean).pop() || "Direct Stream";
      media.push({
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
        filesize: res.headers.get("content-length") ? Number(res.headers.get("content-length")) : null,
        quality: "source",
        kind: mimeInfo.kind,
        playable: mimeInfo.playable,
        is_direct: true,
      });
      return { handled: true, provider: ctx.url.hostname, media };
    }

    const html = (await res.text()).slice(0, 15 * 1024 * 1024);

    const ogResults = OpenGraphExtractor.parseHtml(html, ctx.url);
    const html5Results = HTML5Extractor.parseHtml(html, ctx.url);
    const jsonLdResults = JsonLdExtractor.parseHtml(html, ctx.url);

    for (const item of [...ogResults, ...html5Results, ...jsonLdResults]) {
      if (!seen.has(item.media_url)) {
        seen.add(item.media_url);
        media.push(item);
      }
    }

    const directPattern = /(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|webm|mov|mp3|m4a)(?:\?[^\s"'<>\\]*)?)/gi;
    let match: RegExpExecArray | null;

    const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || "Discovered Media";
    const ogImage = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1];
    let thumbnail: string | null = null;
    if (ogImage) {
      try {
        thumbnail = new URL(ogImage, ctx.url).toString();
      } catch {}
    }

    while ((match = directPattern.exec(html))) {
      const rawUrl = match[1];
      let absUrl: string;
      try {
        absUrl = new URL(rawUrl, ctx.url).toString();
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

    return media.length ? { handled: true, provider: ctx.url.hostname, media } : null;
  }
}
