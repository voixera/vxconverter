import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { MimeDetector } from "../mime";
import type { MediaCandidate } from "../../types";

/**
 * Engine V4 VX - JSON-LD Schema.org Video/Audio Extractor
 */
export class JsonLdExtractor implements V4Extractor {
  public name = "JsonLdExtractor";

  public canHandle(_url: URL): boolean {
    return true;
  }

  public static parseHtml(html: string, base: URL): MediaCandidate[] {
    const media: MediaCandidate[] = [];
    const seen = new Set<string>();

    const jsonLdPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    while ((match = jsonLdPattern.exec(html))) {
      try {
        const parsed = JSON.parse(match[1]);
        const list = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of list) {
          const items = item["@graph"] ? (Array.isArray(item["@graph"]) ? item["@graph"] : [item["@graph"]]) : [item];

          for (const obj of items) {
            if (obj && (obj["@type"] === "VideoObject" || obj["@type"] === "AudioObject")) {
              const contentUrl = obj.contentUrl || obj.embedUrl;
              if (!contentUrl) continue;

              let absUrl: string;
              try {
                absUrl = new URL(contentUrl, base).toString();
              } catch {
                continue;
              }

              if (!seen.has(absUrl)) {
                seen.add(absUrl);
                const title = obj.name || obj.headline || "Video";
                const thumbRaw = Array.isArray(obj.thumbnailUrl) ? obj.thumbnailUrl[0] : obj.thumbnailUrl;
                let thumb: string | null = null;
                if (thumbRaw) {
                  try {
                    thumb = new URL(thumbRaw, base).toString();
                  } catch {}
                }

                const mimeInfo = MimeDetector.resolve(absUrl, obj["@type"] === "AudioObject" ? "audio/mpeg" : "video/mp4");

                media.push({
                  id: crypto.randomUUID(),
                  title,
                  source_url: base.toString(),
                  media_url: absUrl,
                  thumbnail_url: thumb,
                  mime: mimeInfo.mime,
                  extension: mimeInfo.extension,
                  width: obj.width ? Number(obj.width) : null,
                  height: obj.height ? Number(obj.height) : null,
                  duration: null,
                  filesize: null,
                  quality: obj.height ? `${obj.height}p` : "source",
                  kind: mimeInfo.kind,
                  playable: mimeInfo.playable,
                  is_direct: true,
                });
              }
            }
          }
        }
      } catch {}
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
    const media = JsonLdExtractor.parseHtml(html, ctx.url);

    return media.length ? { handled: true, provider: ctx.url.hostname, media } : null;
  }
}
