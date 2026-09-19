import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { ResilientFetcher } from "../fetcher";
import { CandidateFactory, dedupeCandidates } from "../candidate";
import type { MediaCandidate } from "../../types";

/**
 * ENGINE V4 VX - HTML5 Media Extractor (<video>, <audio>, <source>)
 */
export class HTML5Extractor implements V4Extractor {
  public name = "HTML5Extractor";

  public canHandle(_url: URL): boolean {
    return true;
  }

  public static parseHtml(html: string, base: URL): MediaCandidate[] {
    const media: MediaCandidate[] = [];
    const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || "Discovered Media";

    const poster = html.match(/<video[^>]+poster=["']([^"']+)["']/i)?.[1];
    let thumbnail: string | null = null;
    if (poster) {
      try { thumbnail = new URL(poster, base).toString(); } catch {}
    }

    const tagPattern = /<(video|audio|source|embed)[^>]*?(?:src|data-src|data-video|data-url|data-file)=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(html))) {
      const tag = match[1].toLowerCase();
      const raw = match[2];
      if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) continue;

      let abs: string;
      try { abs = new URL(raw, base).toString(); } catch { continue; }

      const typeMatch = match[0].match(/type=["']([^"']+)["']/i);
      const declared = typeMatch ? typeMatch[1] : undefined;

      media.push(
        CandidateFactory.make({
          url: abs,
          title: pageTitle,
          sourceUrl: base.toString(),
          thumbnail,
          mime: declared,
          source: "html5",
          platform: base.hostname,
        }),
      );
    }

    return dedupeCandidates(media);
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const fetchRes = await ResilientFetcher.fetch(ctx.url, ctx.timeoutMs, ctx.timeoutMs ? 15 * 1024 * 1024 : undefined);
    if (!fetchRes.html) return null;
    const media = HTML5Extractor.parseHtml(fetchRes.html, fetchRes.finalUrl);
    return media.length ? { handled: true, provider: fetchRes.finalUrl.hostname, media } : null;
  }
}
