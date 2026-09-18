import { NextResponse } from "next/server";
import { getMediaById } from "../../../lib/store";
import { SecurityGuard } from "../../../lib/engine-v4-vx/guard";
import { MimeDetector } from "../../../lib/engine-v4-vx/mime";
import { MediaValidator } from "../../../lib/engine-v4-vx/validator";
import { ytdlpGetFormats, needsYtdlp } from "../../../lib/engine-v4-vx/ytdlp";
import type { MediaCandidate } from "../../../lib/types";

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
    redirect: "follow",
    signal: AbortSignal.timeout(60000),
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

  const detectedMime = chunkVal.mime || hintMime || "application/octet-stream";
  const detectedExt = chunkVal.extension || MimeDetector.resolve(mediaUrl, hintMime).extension || "mp4";
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
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
            pump();
          })
          .catch((e) => controller.error(e));
      }
      pump();
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    status: upstream.status === 206 ? 206 : 200,
    headers: respHeaders,
  });
}

function makeFilename(title: string, quality: string, ext: string): string {
  // Clean title — remove trailing quality suffix if already embedded
  const cleanTitle =
    (title || "vx-media")
      .replace(/\s*\(\s*\d{3,4}p[^)]*\)\s*$/, "") // strip "(360p)" / "(1080p, video only)"
      .replace(/\s*\(Audio\)\s*$/, "") // strip "(Audio)"
      .replace(/\s*\(Embed[^)]*\)\s*$/, "") // strip "(Embed...)"
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "vx-media";
  const q = quality && quality !== "source" ? `-${quality}` : "";
  return `${cleanTitle}${q}.${ext}`;
}

async function handleDownload(
  mediaId: string,
  request: Request,
  passedMedia?: MediaCandidate,
): Promise<Response> {
  const media = passedMedia || (mediaId ? getMediaById(mediaId) : undefined);
  if (!media) {
    return NextResponse.json(
      { ok: false, error: { code: "MEDIA_NOT_FOUND", message: "Media details not found. Please re-inspect the URL." } },
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
      try {
        const formats = await ytdlpGetFormats(media.source_url);
        if (formats.length) {
          // Match by kind + quality
          const kind = media.kind === "audio" ? "audio" : "video";
          let chosen = formats.find((f) => f.kind === kind && f.quality === media.quality);
          if (!chosen) chosen = formats.find((f) => f.kind === kind);
          if (!chosen) chosen = formats[0];

          const ext = chosen.ext || media.extension;
          const finalFilename = makeFilename(media.title, chosen.quality, ext);

          // Proxy the fresh CDN URL directly (no second yt-dlp spawn)
          return await proxyUrl(chosen.url, rangeHeader, finalFilename, media.mime, {
            Referer: "https://www.youtube.com/",
            Origin: "https://www.youtube.com",
          });
        }
      } catch (ytdlpErr) {
        // If yt-dlp binary is missing on host, fallback to direct media_url if valid
        if (!media.media_url || !media.is_direct) {
          throw ytdlpErr;
        }
      }
    }

    // --- Path B: Direct URL ---
    const validation = SecurityGuard.isUrlSafe(media.media_url);
    if (!validation.safe || !validation.parsed) {
      return NextResponse.json(
        { ok: false, error: { code: "SSRF_BLOCKED", message: "Blocked: private or unsafe destination." } },
        { status: 403 },
      );
    }

    const extraHeaders: Record<string, string> = {};
    if (media.source_url) {
      try {
        const srcUrl = new URL(media.source_url);
        extraHeaders["Referer"] = media.source_url;
        extraHeaders["Origin"] = srcUrl.origin;
      } catch {}
    }

    return await proxyUrl(validation.parsed.toString(), rangeHeader, filename, media.mime, extraHeaders);
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
  const mediaId = searchParams.get("media_id")?.trim() || "";
  const mediaUrl = searchParams.get("media_url")?.trim();
  const sourceUrl = searchParams.get("source_url")?.trim();
  const title = searchParams.get("title")?.trim();
  const mime = searchParams.get("mime")?.trim();
  const quality = searchParams.get("quality")?.trim();
  const extension = searchParams.get("extension")?.trim();

  let passedMedia: MediaCandidate | undefined;
  if (mediaUrl) {
    passedMedia = {
      id: mediaId || crypto.randomUUID(),
      title: title || "vx-media",
      source_url: sourceUrl || mediaUrl,
      media_url: mediaUrl,
      thumbnail_url: null,
      mime: mime || "video/mp4",
      extension: extension || "mp4",
      width: null,
      height: null,
      duration: null,
      filesize: null,
      quality: quality || "source",
      kind: mime?.startsWith("audio/") ? "audio" : "video",
      playable: true,
      is_direct: true,
    };
  }

  if (!mediaId && !passedMedia) {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "media_id or media_url required" } },
      { status: 400 },
    );
  }
  return handleDownload(mediaId, request, passedMedia);
}

export async function POST(request: Request) {
  let body: { media_id?: string; media?: MediaCandidate };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const mediaId = typeof body.media_id === "string" ? body.media_id.trim() : body.media?.id || "";
  const passedMedia = body.media && typeof body.media === "object" ? body.media : undefined;

  if (!mediaId && !passedMedia) {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "media_id or media details required" } },
      { status: 400 },
    );
  }
  return handleDownload(mediaId, request, passedMedia);
}
