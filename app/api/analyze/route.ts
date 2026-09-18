import { NextResponse } from "next/server";
import { pushHistory } from "../../../lib/store";
import type { MediaCandidate } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1"
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function absoluteUrl(value: string | undefined | null, source: URL): string | null {
  if (!value) return null;
  try {
    return new URL(value.replace(/&amp;/g, "&").trim(), source).toString();
  } catch {
    return null;
  }
}

function guessQuality(width: number | null, height: number | null, url: string): string {
  if (height) {
    if (height >= 2160) return "4k";
    if (height >= 1440) return "2k";
    if (height >= 1080) return "1080p";
    if (height >= 720) return "720p";
    if (height >= 480) return "480p";
    if (height >= 360) return "360p";
  }
  const match = /(?:2160|1440|1080|720|480|360)p/i.exec(url);
  if (match) return match[0].toLowerCase();
  if (/(?:audio|mp3|m4a|aac)/i.test(url)) return "audio";
  return "source";
}

function candidate(
  url: string,
  source: string,
  title: string,
  thumb: string | null = null,
  mime = "video/mp4",
  width: number | null = null,
  height: number | null = null,
  duration: number | null = null,
): MediaCandidate {
  const cleanMime = mime.split(";")[0].trim().toLowerCase();
  const isM3u8 = cleanMime.includes("mpegurl") || /\.m3u8(?:$|\?)/i.test(url);
  const isAudio = cleanMime.startsWith("audio/") || /\.(?:mp3|m4a|aac|wav|ogg)(?:$|\?)/i.test(url);
  const extension = isM3u8 ? "m3u8" : isAudio ? "mp3" : cleanMime.includes("webm") ? "webm" : "mp4";
  const kind = isM3u8 ? "stream" : isAudio ? "audio" : "video";
  const quality = guessQuality(width, height, url);

  return {
    id: crypto.randomUUID(),
    title: title || "Detected media",
    source_url: source,
    media_url: url,
    thumbnail_url: thumb,
    mime: cleanMime || (isAudio ? "audio/mpeg" : "video/mp4"),
    extension,
    width,
    height,
    duration,
    filesize: null,
    quality,
    kind,
  };
}

export async function POST(request: Request) {
  let body: { url?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  if (typeof body.url !== "string" || !/^https?:\/\//i.test(body.url.trim())) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_URL", message: "Only HTTP and HTTPS URLs are supported" } },
      { status: 400 },
    );
  }

  const source = body.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_URL", message: "Invalid source URL" } },
      { status: 400 },
    );
  }

  if (isPrivateHost(parsed.hostname)) {
    return NextResponse.json(
      { ok: false, error: { code: "SSRF_BLOCKED", message: "Private destinations are not supported" } },
      { status: 403 },
    );
  }

  try {
    const response = await fetch(parsed, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,video/*,audio/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const msg =
        response.status === 404
          ? "Source page was not found (HTTP 404). Check the URL or the media may have been removed."
          : response.status === 403
            ? "Source server denied access (HTTP 403). Content may be private or protected."
            : response.status === 429
              ? "Source server rate limited requests (HTTP 429). Try again shortly."
              : `Source returned HTTP ${response.status}`;
      return NextResponse.json(
        { ok: false, error: { code: "UPSTREAM_ERROR", message: msg } },
        { status: 502 },
      );
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const media: MediaCandidate[] = [];
    const seen = new Set<string>();

    if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
      const direct = candidate(source, source, "Direct Stream", null, contentType);
      media.push(direct);
      seen.add(source);
    } else {
      const html = (await response.text()).slice(0, 15 * 1024 * 1024);

      // Extract general title & thumbnail
      const ogTitle = html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim();
      const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
      const title = ogTitle || pageTitle || "Detected media";

      const ogImage = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1];
      const posterAttr = html.match(/<video[^>]+poster=["']([^"']+)["']/i)?.[1];
      const thumbnail = absoluteUrl(ogImage || posterAttr, parsed);

      // 1. OpenGraph & Twitter video tags
      const ogVideoPattern = /<meta[^>]+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["'][^>]+content=["']([^"']+)["']/gi;
      let ogMatch: RegExpExecArray | null;
      while ((ogMatch = ogVideoPattern.exec(html))) {
        const url = absoluteUrl(ogMatch[1], parsed);
        if (url && !seen.has(url)) {
          seen.add(url);
          media.push(candidate(url, source, title, thumbnail, "video/mp4"));
        }
      }

      // 2. HTML5 Video / Audio / Source tags with src & data-src
      const tagPattern = /<(video|audio|source)[^>]+(?:src|data-src|data-video|data-url)=["']([^"']+)["'][^>]*>/gi;
      let tagMatch: RegExpExecArray | null;
      while ((tagMatch = tagPattern.exec(html))) {
        const tag = tagMatch[1].toLowerCase();
        const url = absoluteUrl(tagMatch[2], parsed);
        if (url && !seen.has(url)) {
          seen.add(url);
          const mime = tag === "audio" || /audio/i.test(tagMatch[0]) ? "audio/mpeg" : "video/mp4";
          media.push(candidate(url, source, title, thumbnail, mime));
        }
      }

      // 3. JSON-LD VideoObjects
      const jsonLdPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let jsonMatch: RegExpExecArray | null;
      while ((jsonMatch = jsonLdPattern.exec(html))) {
        try {
          const parsedJson = JSON.parse(jsonMatch[1]);
          const objects = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
          for (const item of objects) {
            const graph = item["@graph"] ? (Array.isArray(item["@graph"]) ? item["@graph"] : [item["@graph"]]) : [item];
            for (const obj of graph) {
              if (obj && (obj["@type"] === "VideoObject" || obj["@type"] === "AudioObject")) {
                const mediaUrl = absoluteUrl(obj.contentUrl || obj.embedUrl, parsed);
                if (mediaUrl && !seen.has(mediaUrl)) {
                  seen.add(mediaUrl);
                  const itemTitle = obj.name || obj.headline || title;
                  const itemThumb = absoluteUrl(obj.thumbnailUrl, parsed) || thumbnail;
                  media.push(candidate(mediaUrl, source, itemTitle, itemThumb, obj["@type"] === "AudioObject" ? "audio/mpeg" : "video/mp4"));
                }
              }
            }
          }
        } catch {
          // ignore malformed JSON-LD
        }
      }

      // 4. Fallback search for inline .m3u8 / .mp4 links in scripts
      const directMediaPattern = /(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?)/gi;
      let directMatch: RegExpExecArray | null;
      while ((directMatch = directMediaPattern.exec(html))) {
        const url = absoluteUrl(directMatch[1], parsed);
        if (url && !seen.has(url)) {
          seen.add(url);
          media.push(candidate(url, source, title, thumbnail, url.includes(".m3u8") ? "application/x-mpegurl" : "video/mp4"));
        }
      }
    }

    if (!media.length) {
      return NextResponse.json(
        { ok: false, error: { code: "MEDIA_NOT_FOUND", message: "No public media found on source page" } },
        { status: 404 },
      );
    }

    const result = {
      scan_id: crypto.randomUUID(),
      source_url: source,
      normalized_url: parsed.toString(),
      media_count: media.length,
      media,
      provider: parsed.hostname,
      cached: false,
      created_at: new Date().toISOString(),
    };

    pushHistory(result);
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "Source request timed out" : "Could not inspect source URL";
    return NextResponse.json({ ok: false, error: { code: "UPSTREAM_ERROR", message } }, { status: 502 });
  }
}
