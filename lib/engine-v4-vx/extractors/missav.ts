import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { ResilientFetcher } from "../fetcher";
import { CandidateFactory, dedupeCandidates } from "../candidate";
import { ScriptScanner } from "./scripts";
import type { MediaCandidate } from "../../types";

/**
 * ENGINE V4 VX - MissAV & streaming-site Extractor
 *
 * Uses the shared script scanner (handles packed JS + HLS master playlists)
 * plus the surrit CDN UUID convention.
 */
export class MissavExtractor implements V4Extractor {
  public name = "MissavExtractor";

  public canHandle(url: URL): boolean {
    const h = url.hostname.toLowerCase();
    return h.includes("missav") || h.includes("surrit") || h.includes("sixyik");
  }

  public async extract(ctx: EngineContext): Promise<ExtractorResult | null> {
    const fetchRes = await ResilientFetcher.fetch(ctx.url, ctx.timeoutMs);
    if (!fetchRes.html) return null;
    const html = fetchRes.html;

    const title =
      html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
      "Video Stream";

    let thumbnail: string | null = null;
    const ogImage = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1];
    if (ogImage) { try { thumbnail = new URL(ogImage, fetchRes.finalUrl).toString(); } catch {} }

    const media: MediaCandidate[] = [];

    // 1. surrit CDN UUID convention (most reliable for missav).
    const uuid = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    if (uuid) {
      media.push(CandidateFactory.make({
        url: `https://surrit.com/${uuid}/playlist.m3u8`, title, sourceUrl: ctx.rawUrl, thumbnail,
        mime: "application/vnd.apple.mpegurl", extension: "m3u8", kind: "stream",
        playable: false, isDirect: true, source: "missav", platform: fetchRes.finalUrl.hostname,
      }));
    }

    // 2. Shared script scan (packed + HLS + mp4).
    media.push(...ScriptScanner.scan(html, fetchRes.finalUrl, title, thumbnail));
    const deduped = dedupeCandidates(media).filter((c) => !/\/(preview|seek)\//i.test(c.media_url));

    return deduped.length ? { handled: true, provider: fetchRes.finalUrl.hostname, media: deduped } : null;
  }
}
