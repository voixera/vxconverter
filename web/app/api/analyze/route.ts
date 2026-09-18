import { NextResponse } from "next/server";
import { pushHistory } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Candidate = {
  id: string;
  title: string;
  source_url: string;
  media_url: string;
  thumbnail_url: string | null;
  mime: string;
  extension: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  filesize: number | null;
  quality: string;
  kind: "video" | "audio" | "stream";
};

function absoluteUrl(value: string, source: URL) {
  try {
    return new URL(value.replace(/&amp;/g, "&"), source).toString();
  } catch {
    return null;
  }
}

function candidate(url: string, source: string, mime = "video/mp4"): Candidate {
  const extension = mime.includes("mpegurl") || /\.m3u8(?:$|\?)/i.test(url) ? "m3u8" : mime.includes("audio") ? "mp3" : "mp4";
  return {
    id: crypto.randomUUID(),
    title: "Detected media",
    source_url: source,
    media_url: url,
    thumbnail_url: null,
    mime,
    extension,
    width: null,
    height: null,
    duration: null,
    filesize: null,
    quality: "source",
    kind: extension === "m3u8" ? "stream" : mime.includes("audio") ? "audio" : "video",
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
  const parsed = new URL(source);
  if (parsed.hostname === "localhost" || parsed.hostname.endsWith(".local") || parsed.hostname.endsWith(".internal")) {
    return NextResponse.json(
      { ok: false, error: { code: "SSRF_BLOCKED", message: "Private destinations are not supported" } },
      { status: 403 },
    );
  }

  try {
    const response = await fetch(parsed, {
      headers: { "User-Agent": "VXConverter/1.0", Accept: "text/html,video/*,audio/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: { code: "UPSTREAM_ERROR", message: `Source returned HTTP ${response.status}` } },
        { status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") || "";
    const media = contentType.startsWith("video/") || contentType.startsWith("audio/")
      ? [candidate(source, source, contentType.split(";")[0])]
      : [];
    const html = (await response.text()).slice(0, 15 * 1024 * 1024);
    const sourceUrl = new URL(source);
    const seen = new Set(media.map((item) => item.media_url));
    const pattern = /<(?:video|audio|source)[^>]+src=["']([^"']+)["'][^>]*>|<meta[^>]+(?:property|name)=["'](?:og:video|og:audio|twitter:player:stream)["'][^>]+content=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const url = absoluteUrl(match[1] || match[2], sourceUrl);
      if (url && !seen.has(url)) {
        seen.add(url);
        media.push(candidate(url, source, /audio/i.test(match[0]) ? "audio/mpeg" : "video/mp4"));
      }
    }

    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || "Detected media";
    media.forEach((item) => { item.title = title; });
    if (!media.length) {
      return NextResponse.json({ ok: false, error: { code: "MEDIA_NOT_FOUND", message: "No public media found on source page" } }, { status: 404 });
    }
    const result = { scan_id: crypto.randomUUID(), source_url: source, normalized_url: parsed.toString(), media_count: media.length, media, provider: parsed.hostname, cached: false, created_at: new Date().toISOString() };
    pushHistory(result);
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "Source request timed out" : "Could not inspect source URL";
    return NextResponse.json({ ok: false, error: { code: "UPSTREAM_ERROR", message } }, { status: 502 });
  }
}
