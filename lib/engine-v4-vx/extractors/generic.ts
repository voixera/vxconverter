import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { ResilientFetcher, EngineError } from "../fetcher";
import { CandidateFactory, dedupeCandidates } from "../candidate";
import { MimeDetector } from "../mime";
import { MediaSniffer } from "../sniff";
import { OpenGraphExtractor } from "./opengraph";
import { HTML5Extractor } from "./html5";
import { JsonLdExtractor } from "./jsonld";
import { ScriptScanner } from "./scripts";
import type { MediaCandidate } from "../../types";

/**
 * ENGINE V4 VX - Generic Web Page Extractor
 *
 * The universal fallback. Fetches the page, then:
 *   1. detects a direct media response (real MIME)
 *   2. parses <video>/<source>, OpenGraph, JSON-LD, twitter player
 *   3. scans inline scripts / packed players for embedded media URLs
 *
 * Returns null (not an error) when the page is fine but simply has no media,
 * so the engine can continue to the browser-render fallback.
 * Throws a coded EngineError only when the SOURCE itself is unreachable.
 */
export class GenericExtractor implements V4Extractor {
  public name = "GenericExtractor";

  public canHandle(_url: URL): boolean {
    return true;
  }

  /** Parse an HTML string into candidates using all sub-parsers. */
  public static parseHtml(html: string, base: URL, sourceUrl: string): MediaCandidate[] {
    const pageTitle =
      html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
      base.hostname;

    let thumbnail: string | null = null;
    const ogImage = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|og:image:secure_url|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1];
    if (ogImage) {
      try { thumbnail = new URL(ogImage, base).toString(); } catch {}
    }

    const candidates: MediaCandidate[] = [
      ...HTML5Extractor.parseHtml(html, base),
      ...JsonLdExtractor.parseHtml(html, base),
      ...OpenGraphExtractor.parseHtml(html, base),
      ...ScriptScanner.scan(html, base, pageTitle, thumbnail),
    ];

    // Backfill shared metadata (title/thumbnail/source) on generic hits.
    for (const c of candidates) {
      if (!c.title || c.title === "Discovered Media") c.title = pageTitle;
      if (!c.thumbnail_url && thumbnail) c.thumbnail_url = thumbnail;
      c.source_url = sourceUrl;
      c.source = c.source || "generic";
    }

    return dedupeCandidates(candidates);
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const fetchRes = await ResilientFetcher.fetch(ctx.url, ctx.timeoutMs, ctx.timeoutMs ? 15 * 1024 * 1024 : undefined);

    const media: MediaCandidate[] = [];

    // --- Case 1: response itself is media (real content-type from server) ---
    if (MimeDetector.isMediaMime(fetchRes.contentType)) {
      const m = CandidateFactory.make({
        url: fetchRes.url,
        title: decodeURIComponent(fetchRes.finalUrl.pathname.split("/").filter(Boolean).pop() || "Direct Stream"),
        sourceUrl: ctx.rawUrl,
        mime: fetchRes.contentType,
        quality: "source",
        filesize: fetchRes.contentLength,
        isDirect: true,
        source: "direct-response",
        platform: fetchRes.finalUrl.hostname,
      });
      return { handled: true, provider: fetchRes.finalUrl.hostname, media: [m] };
    }

    // --- Case 2: parse the HTML page ---
    if (fetchRes.html) {
      const parsed = GenericExtractor.parseHtml(fetchRes.html, fetchRes.finalUrl, ctx.rawUrl);
      media.push(...parsed);
      if (media.length > 0) {
        return { handled: true, provider: fetchRes.finalUrl.hostname, media: dedupeCandidates(media) };
      }
    }

    // --- Case 3: no media found ---
    // If the source was an HTTP error AND we could not read a body, surface a
    // coded error. But if we DID get parseable HTML, do not mislabel it as 404:
    // many SPAs return 200 with empty media and require rendering.
    if (!fetchRes.ok && !fetchRes.html) {
      const code =
        fetchRes.status === 404 ? "SOURCE_NOT_FOUND" :
        fetchRes.status === 403 ? "MEDIA_NOT_PUBLIC" :
        fetchRes.status === 429 ? "RATE_LIMITED" :
        "SOURCE_FETCH_FAILED";
      throw new EngineError(code, `Source responded with HTTP ${fetchRes.status}`, fetchRes.status);
    }

    // Page fetched OK (or returned HTML) but exposed no media → allowed to
    // continue to browser fallback. Returning null signals "no opinion".
    return null;
  }
}
