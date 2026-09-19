import { EngineContext, ExtractorResult, V4Extractor } from "../types";
import { CandidateFactory, dedupeCandidates } from "../candidate";
import type { MediaCandidate } from "../../types";

/**
 * ENGINE V4 VX - JSON-LD Schema.org Video/Audio Extractor
 */
export class JsonLdExtractor implements V4Extractor {
  public name = "JsonLdExtractor";

  public canHandle(_url: URL): boolean {
    return true;
  }

  public static parseHtml(html: string, base: URL): MediaCandidate[] {
    const media: MediaCandidate[] = [];
    const jsonLdPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    const visit = (obj: any) => {
      if (!obj || typeof obj !== "object") return;
      const type = obj["@type"];
      if (type === "VideoObject" || type === "AudioObject" || type === "Clip") {
        const contentUrl = obj.contentUrl || obj.embedUrl || obj.url;
        if (contentUrl && typeof contentUrl === "string") {
          let abs: string;
          try { abs = new URL(contentUrl, base).toString(); } catch { return; }
          const thumbRaw = Array.isArray(obj.thumbnailUrl) ? obj.thumbnailUrl[0] : obj.thumbnailUrl;
          let thumb: string | null = null;
          if (thumbRaw) { try { thumb = new URL(thumbRaw, base).toString(); } catch {} }
          media.push(
            CandidateFactory.make({
              url: abs,
              title: obj.name || obj.headline || "Video",
              sourceUrl: base.toString(),
              thumbnail: thumb,
              mime: type === "AudioObject" ? "audio/mpeg" : undefined,
              width: obj.width ? Number(obj.width) : null,
              height: obj.height ? Number(obj.height) : null,
              quality: obj.height ? `${obj.height}p` : "source",
              source: "json-ld",
              platform: base.hostname,
            }),
          );
        }
      }
      for (const key of Object.keys(obj)) {
        const v = obj[key];
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object") visit(v);
      }
    };

    while ((match = jsonLdPattern.exec(html))) {
      try {
        const parsed = JSON.parse(match[1]);
        (Array.isArray(parsed) ? parsed : [parsed]).forEach(visit);
      } catch {}
    }

    return dedupeCandidates(media);
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
