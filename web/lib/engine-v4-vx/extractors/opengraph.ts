import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { MimeDetector } from "../mime";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - OpenGraph / Twitter Cards Extractor
 */
export class OpenGraphExtractor implements V4Extractor {
  public name = "OpenGraphExtractor";

  public canHandle(_url: URL): boolean {
    return true; // Generic parser
  }

  public static parseHtml(html: string, base: URL): MediaCandidate[] {
    const media: MediaCandidate[] = [];
    const seen = new Set<string>();

    const ogTitle = html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim();
    const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    const title = ogTitle || pageTitle || "Discovered Media";

    const ogImage = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1];
    let thumbnail: string | null = null;
    if (ogImage) {
      try {
        thumbnail = new URL(ogImage, base).toString();
      } catch {}
    }

    const pattern = /<meta[^>]+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["'][^>]+content=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html))) {
      const raw = match[1];
      let absUrl: string;
      try {
        absUrl = new URL(raw, base).toString();
      } catch {
        continue;
      }

      if (!seen.has(absUrl)) {
        seen.add(absUrl);
        const mimeInfo = MimeDetector.resolve(absUrl, "video/mp4");
        media.push({
          id: crypto.randomUUID(),
          title,
          source_url: base.toString(),
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

    return media;
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const res = await fetch(ctx.rawUrl, {
      headers: { "User-Agent": ctx.userAgent },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    }).catch(() => null);

    if (!res || !res.ok) return null;
    const html = await res.text().catch(() => "");
    const media = OpenGraphExtractor.parseHtml(html, ctx.url);

    return media.length ? { handled: true, provider: ctx.url.hostname, media } : null;
  }
}
