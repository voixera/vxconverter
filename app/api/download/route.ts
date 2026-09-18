import { NextResponse } from "next/server";
import { getMediaById } from "../../../lib/store";
import { SecurityGuard } from "../../../lib/engine-v4-vx/guard";
import { MimeDetector } from "../../../lib/engine-v4-vx/mime";
import { MediaValidator } from "../../../lib/engine-v4-vx/validator";
import { ytdlpGetFormats, needsYtdlp } from "../../../lib/engine-v4-vx/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Headers that convince most CDN servers we're a real browser
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Encoding": "identity",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Proxy an HTTPS media URL through the server — UC Browser relay model.
 * Validates magic bytes then streams raw bytes to the client.
 */
async function proxyUrl(
  mediaUrl: string,
  rangeHeader: string | null,
  filename: string,
  hintMime: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const fetchHeaders: Record<string, string> = { ...BROWSER_HEADERS, ...extraHeaders };
  if (rangeHeader) fetchHeaders["Range"] = rangeHeader;

  const upstream = await fetch(mediaUrl, {
    headers: fetchHeaders,
    signal: AbortSignal.timeout(30000),
  });

  if (!upstream.ok || !upstream.body) {
    throw new Error(`Upstream ${upstream.status}: ${upstream.statusText}`);
  }

  // Read first chunk for magic-byte validation
  const reader = upstream.body.getReader();
  const { done, value: firstChunk } = await reader.read();

  if (done || !firstChunk?.length) {
    throw new Error("Upstream returned empty stream");
  }

  const chunkVal = MediaValidator.validateChunk(firstChunk);
  if (chunkVal.isHtmlOrJson) {
    const preview = Buffer.from(firstChunk).slice(0, 120).toString("utf8");
    throw new Error(`Source returned page/error instead of media: ${preview.slice(0, 60)}`);
  }

  const detectedMime = chunkVal.mime || hintMime;
  const detectedExt = chunkVal.extension || MimeDetector.resolve(mediaUrl, hintMime).extension;
  // Strip any existing extension from filename, re-add correct one
  const baseName = filename.replace(/\.[^.]+$/, "");
  const finalFilename = `${baseName}.${detectedExt}`;
  const safeFilename = finalFilename.replace(/[^\x20-\x7e]/g, "_");

  const respHeaders = new Headers();
  respHeaders.set("Content-Type", detectedMime);
  respHeaders.set(
    "Content-Disposition",
    `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`,
  );
  respHeaders.set("Accept-Ranges", "bytes");
  respHeaders.set("Cache-Control", "no-store");

  const cl = upstream.headers.get("content-length");
  if (cl) respHeaders.set("Content-Length", cl);
  const cr = upstream.headers.get("content-range");
  if (cr) respHeaders.set("Content-Range", cr);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstChunk);
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) { controller.close(); return; }
          controller.enqueue(value);
          pump();
        }).catch((e) => controller.error(e));
      }
      pump();
    },
    cancel() { reader.cancel(); },
  });

  return new Response(stream, {
    status: upstream.status === 206 ? 206 : 200,
    headers: respHeaders,
  });
}

function makeFilename(title: string, quality: string, ext: string): string {
  // Clean title — remove trailing quality suffix if already embedded
  const cleanTitle = (title || "vx-media")
    .replace(/\s*\(\s*\d{3,4}p[^)]*\)\s*$/, "")    // strip "(360p)" / "(1080p, video only)"
    .replace(/\s*\(Audio\)\s*$/, "")                  // strip "(Audio)"
    .replace(/\s*\(Embed[^)]*\)\s*$/, "")            // strip "(Embed...)"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "vx-media";
  const q = quality && quality !== "source" ? `-${quality}` : "";
  return `${cleanTitle}${q}.${ext}`;
}

async function handleDownload(mediaId: string, request: Request): Promise<Response> {
  const media = getMediaById(mediaId);
  if (!media) {
    return NextResponse.json(
      { ok: false, error: { code: "MEDIA_NOT_FOUND", message: "Session expired — re-inspect the URL." } },
      { status: 404 },
    );
  }

  // Embed/stream-only: can't download
  if (media.kind === "stream" && media.is_direct === false) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_DOWNLOADABLE", message: "Embed stream — not directly downloadable. Use another format." } },
      { status: 422 },
    );
  }

  const filename = makeFilename(media.title, media.quality, media.extension);
  const rangeHeader = request.headers.get("range");

  try {
    // --- Path A: Platform URL (YouTube, TikTok, etc.) ---
    // Re-resolve at download time → fresh signed CDN URL (avoids expiry)
    if (needsYtdlp(media.source_url)) {
      const formats = await ytdlpGetFormats(media.source_url);
      if (!formats.length) {
        return NextResponse.json(
          { ok: false, error: { code: "NO_FORMATS", message: "No downloadable formats found by yt-dlp." } },
          { status: 502 },
        );
      }

      // Match by kind + quality
      const kind = media.kind === "audio" ? "audio" : "video";
      let chosen = formats.find((f) => f.kind === kind && f.quality === media.quality);
      if (!chosen) chosen = formats.find((f) => f.kind === kind);
      if (!chosen) chosen = formats[0];

      const ext = chosen.ext || media.extension;
      const finalFilename = makeFilename(media.title, chosen.quality, ext);

      // Proxy the fresh CDN URL directly (no second yt-dlp spawn)
      return await proxyUrl(chosen.url, rangeHeader, finalFilename, media.mime, {
        // YouTube googlevideo servers need specific headers
        Referer: "https://www.youtube.com/",
        Origin: "https://www.youtube.com",
      });
    }

    // --- Path B: Direct URL ---
    const validation = SecurityGuard.isUrlSafe(media.media_url);
    if (!validation.safe || !validation.parsed) {
      return NextResponse.json(
        { ok: false, error: { code: "SSRF_BLOCKED", message: "Blocked: private or unsafe destination." } },
        { status: 403 },
      );
    }

    return await proxyUrl(validation.parsed.toString(), rangeHeader, filename, media.mime);
  } catch (err: any) {
    const msg: string = err?.message || "Download failed";
    const isTimeout = err?.name === "TimeoutError" || msg.includes("timed out");
    return NextResponse.json(
      { ok: false, error: { code: isTimeout ? "TIMEOUT" : "UPSTREAM_ERROR", message: msg } },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mediaId = searchParams.get("media_id");
  if (!mediaId?.trim()) {
    return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: "media_id required" } }, { status: 400 });
  }
  return handleDownload(mediaId.trim(), request);
}

export async function POST(request: Request) {
  let body: { media_id?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: "Invalid JSON" } }, { status: 400 }); }

  if (typeof body.media_id !== "string" || !body.media_id.trim()) {
    return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: "media_id required" } }, { status: 400 });
  }
  return handleDownload(body.media_id.trim(), request);
}
