import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { MimeDetector } from "../mime";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - HTML5 Media Extractor (<video>, <audio>, <source>)
 */
export class HTML5Extractor implements V4Extractor {
  public name = "HTML5Extractor";

  public canHandle(_url: URL): boolean {
    return true;
  }

  public static parseHtml(html: string, base: URL): MediaCandidate[] {
    const media: MediaCandidate[] = [];
    const seen = new Set<string>();

    const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || "Discovered Media";
    const posterGlobal = html.match(/<video[^>]+poster=["']([^"']+)["']/i)?.[1];
    let globalThumbnail: string | null = null;
    if (posterGlobal) {
      try {
        globalThumbnail = new URL(posterGlobal, base).toString();
      } catch {}
    }

    const tagPattern = /<(video|audio|source)[^>]+(?:src|data-src|data-video|data-url)=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(html))) {
      const tag = match[1].toLowerCase();
      const rawUrl = match[2];
      let absUrl: string;
      try {
        absUrl = new URL(rawUrl, base).toString();
      } catch {
        continue;
      }

      if (!seen.has(absUrl)) {
        seen.add(absUrl);
        const typeMatch = match[0].match(/type=["']([^"']+)["']/i);
        const declaredType = typeMatch ? typeMatch[1] : tag === "audio" ? "audio/mpeg" : "video/mp4";
        const mimeInfo = MimeDetector.resolve(absUrl, declaredType);

        media.push({
          id: crypto.randomUUID(),
          title: pageTitle,
          source_url: base.toString(),
          media_url: absUrl,
          thumbnail_url: globalThumbnail,
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
    const media = HTML5Extractor.parseHtml(html, ctx.url);

    return media.length ? { handled: true, provider: ctx.url.hostname, media } : null;
  }
}
