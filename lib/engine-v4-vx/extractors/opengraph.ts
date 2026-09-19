import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { ResilientFetcher } from "../fetcher";
import { CandidateFactory, dedupeCandidates } from "../candidate";
import type { MediaCandidate } from "../../types";

/**
 * ENGINE V4 VX - OpenGraph / Twitter Card Extractor
 */
export class OpenGraphExtractor implements V4Extractor {
  public name = "OpenGraphExtractor";

  public canHandle(_url: URL): boolean {
    return true;
  }

  public static parseHtml(html: string, base: URL): MediaCandidate[] {
    const media: MediaCandidate[] = [];

    const title =
      html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
      base.hostname;

    let thumbnail: string | null = null;
    const ogImage = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|og:image:secure_url|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1];
    if (ogImage) {
      try { thumbnail = new URL(ogImage, base).toString(); } catch {}
    }

    // og:video / og:video:url / og:video:secure_url / twitter:player:stream
    const pattern = /<meta[^>]+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream|twitter:player)["'][^>]+content=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const raw = match[1];
      if (!raw || raw.startsWith("data:")) continue;
      let abs: string;
      try { abs = new URL(raw, base).toString(); } catch { continue; }
      media.push(
        CandidateFactory.make({
          url: abs,
          title,
          sourceUrl: base.toString(),
          thumbnail,
          source: "opengraph",
          platform: base.hostname,
        }),
      );
    }

    // og:video:type hint (apply to the last candidate).
    const ogType = html.match(/<meta[^>]+(?:property|name)=["']og:video:type["'][^>]+content=["']([^"']+)["']/i)?.[1];
    if (ogType && media.length) {
      for (const c of media) {
        if (!c.mime || c.mime === "application/octet-stream") c.mime = ogType;
      }
    }

    return dedupeCandidates(media);
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const fetchRes = await ResilientFetcher.fetch(ctx.url, ctx.timeoutMs, ctx.timeoutMs ? 15 * 1024 * 1024 : undefined);
    if (!fetchRes.html) return null;
    const media = OpenGraphExtractor.parseHtml(fetchRes.html, fetchRes.finalUrl);
    return media.length ? { handled: true, provider: fetchRes.finalUrl.hostname, media } : null;
  }
}
