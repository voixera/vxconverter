import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { ResilientFetcher } from "../fetcher";
import { CandidateFactory, dedupeCandidates } from "../candidate";
import { ScriptScanner, unpackPacker } from "./scripts";
import type { MediaCandidate } from "../../types";

/**
 * ENGINE V4 VX - MissAV & streaming-site Extractor
 *
 * MissAV embeds the real stream inside a Dean-Edwards-packed <script> block:
 *
 *   source='https://surrit.com/<uuid>/playlist.m3u8';
 *   source842='https://surrit.com/<uuid>/720p/video.m3u8';
 *   source1280='https://surrit.com/<uuid>/1080p/video.m3u8';
 *
 * The page ALSO contains an unrelated random `user_uuid` cookie value, so we
 * must never grab "the first UUID" — we decode the packed block and read the
 * surrit URLs / UUID from the decoded source, which is authoritative.
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
    const seen = new Set<string>();

    const push = (url: string, source: string) => {
      const key = url.split("#")[0];
      if (seen.has(key)) return;
      seen.add(key);
      media.push(CandidateFactory.make({
        url, title, sourceUrl: ctx.rawUrl, thumbnail,
        mime: "application/vnd.apple.mpegurl", extension: "m3u8", kind: "stream",
        playable: false, isDirect: true, source, platform: fetchRes.finalUrl.hostname,
      }));
    };

    // Decode the whole document (unpacking any Dean-Edwards packed scripts) and
    // pull the authoritative surrit playback URLs from it.
    const decoded = MissavExtractor.decodeDocument(html);
    for (const url of MissavExtractor.surritUrls(decoded)) push(url, "missav-surrit");

    // Fallback: surrit UUID convention → master playlist.
    const uuid = MissavExtractor.surritUuid(decoded);
    if (uuid && MissavExtractor.surritUrls(decoded).length === 0) {
      push(`https://surrit.com/${uuid}/playlist.m3u8`, "missav-uuid");
    }

    // Shared script scan (handles other packed players, HLS + mp4).
    media.push(...ScriptScanner.scan(html, fetchRes.finalUrl, title, thumbnail));

    const deduped = dedupeCandidates(media).filter((c) => !/\/(preview|seek)\//i.test(c.media_url));
    return deduped.length ? { handled: true, provider: fetchRes.finalUrl.hostname, media: deduped } : null;
  }

  /** Unpack every packed <script> block and return the fully decoded document. */
  public static decodeDocument(html: string): string {
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let out = html;
    let sm: RegExpExecArray | null;
    while ((sm = scriptRegex.exec(html))) {
      const content = sm[1] || "";
      if (!content.includes("eval(function(p,a,c,k,e,")) continue;
      const unpacked = unpackPacker(content);
      if (unpacked) out += "\n" + unpacked;
    }
    return out.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  }

  /** All explicit surrit.com *.m3u8 URLs found in a (decoded) document. */
  public static surritUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^"'\\\s)]*surrit\.com[^"'\\\s)]+\.m3u8[^"'\\\s)]*/gi) || [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of matches) {
      const url = raw.replace(/\\/g, "").replace(/["',;)]+$/, "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }

  /** The video's surrit CDN UUID (from a surrit URL), never a random page UUID. */
  public static surritUuid(text: string): string | null {
    return text.match(/surrit\.com\/([0-9a-f-]{16,})["'/\\]/i)?.[1] || null;
  }
}


