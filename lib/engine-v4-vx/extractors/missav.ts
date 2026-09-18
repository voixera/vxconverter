import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { ResilientFetcher } from "../fetcher";
import type { MediaCandidate } from "../../types";

export function unpackJs(packed: string): string {
  const match = /eval\(function\(p,a,c,k,e,[rd]\)\{.*\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/.exec(packed);
  if (!match) return "";
  const [, p, aStr, cStr, kStr] = match;
  const a = parseInt(aStr, 10);
  const c = parseInt(cStr, 10);
  const k = kStr.split("|");

  function e(c: number): string {
    return (c < a ? "" : e(Math.floor(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
  }

  let count = c;
  const dict: Record<string, string> = {};
  while (count--) {
    dict[e(count)] = k[count] || e(count);
  }

  return p.replace(/\b\w+\b/g, (w) => dict[w] || w);
}

/**
 * Engine V4 VX - MissAV & Stream Extractor
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
    const media: MediaCandidate[] = [];
    const seen = new Set<string>();

    const ogTitle = html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim();
    const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    const title = ogTitle || pageTitle || "Video Stream";

    const ogImage = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1];
    let thumbnail: string | null = null;
    if (ogImage) {
      try {
        thumbnail = new URL(ogImage, fetchRes.finalUrl).toString();
      } catch {}
    }

    // 1. Scan and unpack all script tags
    const scriptRegex = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
    const scripts = html.match(scriptRegex) || [];

    for (const s of scripts) {
      let scriptContent = s.replace(/^<script[^>]*>|<\/script>$/gi, "");
      if (scriptContent.includes("eval(function(p,a,c,k,e,")) {
        const unpacked = unpackJs(scriptContent);
        if (unpacked) scriptContent = unpacked;
      }

      // Match HLS playlist URLs in script
      const m3u8Matches = scriptContent.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*/gi) || [];
      for (const m3u8 of m3u8Matches) {
        let cleanUrl = m3u8.replace(/\\/g, "").replace(/['",;]+$/, "");
        try {
          cleanUrl = new URL(cleanUrl, fetchRes.finalUrl).toString();
        } catch {
          continue;
        }

        if (!seen.has(cleanUrl) && !cleanUrl.includes("/preview/") && !cleanUrl.includes("/seek/")) {
          seen.add(cleanUrl);
          media.push({
            id: crypto.randomUUID(),
            title,
            source_url: ctx.rawUrl,
            media_url: cleanUrl,
            thumbnail_url: thumbnail,
            mime: cleanUrl.includes(".m3u8") ? "application/x-mpegurl" : "video/mp4",
            extension: "mp4",
            width: null,
            height: null,
            duration: null,
            filesize: null,
            quality: "source",
            kind: "video",
            playable: true,
            is_direct: true,
          });
        }
      }

      // Check UUID pattern for CDN
      const uuidMatch = scriptContent.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (uuidMatch && media.length === 0) {
        const uuid = uuidMatch[0];
        const cdnUrl = `https://surrit.com/${uuid}/playlist.m3u8`;
        if (!seen.has(cdnUrl)) {
          seen.add(cdnUrl);
          media.push({
            id: crypto.randomUUID(),
            title,
            source_url: ctx.rawUrl,
            media_url: cdnUrl,
            thumbnail_url: thumbnail,
            mime: "application/x-mpegurl",
            extension: "mp4",
            width: null,
            height: null,
            duration: null,
            filesize: null,
            quality: "source",
            kind: "video",
            playable: true,
            is_direct: true,
          });
        }
      }
    }

    if (media.length > 0) {
      return { handled: true, provider: fetchRes.finalUrl.hostname, media };
    }

    return null;
  }
}
