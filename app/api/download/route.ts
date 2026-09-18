import { NextResponse } from "next/server";
import { getMediaById } from "../../../lib/store";
import { SecurityGuard } from "../../../lib/engine-v4-vx/guard";
import { MimeDetector } from "../../../lib/engine-v4-vx/mime";
import { MediaValidator } from "../../../lib/engine-v4-vx/validator";
import { ytdlpGetFormats, ytdlpStream, needsYtdlp } from "../../../lib/engine-v4-vx/ytdlp";
import { Readable } from "stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long timeout for large video files
export const maxDuration = 300;

/**
 * Pipe a Node.js Readable into a Web ReadableStream.
 */
function nodeReadableToWebStream(readable: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      readable.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      readable.on("end", () => controller.close());
      readable.on("error", (err) => controller.error(err));
    },
    cancel() {
      if (typeof (readable as any).destroy === "function") {
        (readable as any).destroy();
      }
    },
  });
}

/**
 * Proxy a direct HTTP stream through the server.
 * Like UC Browser: server fetches media bytes and relays to client.
 */
async function proxyDirectStream(
  mediaUrl: string,
  rangeHeader: string | null,
  filename: string,
  mime: string,
): Promise<Response> {
  const fetchHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Encoding": "identity",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.google.com/",
    Origin: "https://www.google.com",
  };
  if (rangeHeader) fetchHeaders["Range"] = rangeHeader;

  const upstream = await fetch(mediaUrl, {
    headers: fetchHeaders,
    signal: AbortSignal.timeout(30000),
  });

  if (!upstream.ok || !upstream.body) {
    throw new Error(`Upstream returned HTTP ${upstream.status}`);
  }

  // Read first chunk for magic-byte validation
  const reader = upstream.body.getReader();
  const { done, value: firstChunk } = await reader.read();

  if (done || !firstChunk || firstChunk.length === 0) {
    throw new Error("Upstream returned empty stream");
  }

  const chunkVal = MediaValidator.validateChunk(firstChunk);
  if (chunkVal.isHtmlOrJson) {
    const preview = Buffer.from(firstChunk).slice(0, 200).toString("utf8");
    throw new Error(`Source returned HTML/JSON instead of media bytes. Preview: ${preview.slice(0, 80)}`);
  }

  const detectedMime = chunkVal.mime || mime;
  const detectedExt = chunkVal.extension || MimeDetector.resolve(mediaUrl, mime).extension;
  const finalFilename = MimeDetector.forgeFilename(
    filename.replace(/\.[^.]+$/, ""),
    "",
    detectedExt,
  );

  const respHeaders = new Headers();
  respHeaders.set("Content-Type", detectedMime);
  respHeaders.set(
    "Content-Disposition",
    `attachment; filename="${finalFilename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`,
  );
  respHeaders.set("Accept-Ranges", "bytes");
  respHeaders.set("Cache-Control", "no-store");

  const cl = upstream.headers.get("content-length");
  if (cl) respHeaders.set("Content-Length", cl);
  const cr = upstream.headers.get("content-range");
  if (cr) respHeaders.set("Content-Range", cr);

  // Reconstruct stream with validated first chunk prepended
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

/**
 * Stream via yt-dlp subprocess → pipe to client.
 * Works for YouTube, TikTok, Instagram, Twitter, etc.
 * Re-runs yt-dlp at download time to get fresh signed URL.
 */
async function proxyYtdlpStream(
  sourceUrl: string,
  qualityHint: string,
  kind: "video" | "audio" | string,
  filename: string,
  mime: string,
): Promise<Response> {
  // Re-resolve format at download time (avoids YouTube URL expiry)
  const formats = await ytdlpGetFormats(sourceUrl);

  if (formats.length === 0) {
    throw new Error("yt-dlp found no downloadable formats for this URL");
  }

  // Pick format matching kind + quality
  let chosen = formats.find(
    (f) => f.kind === kind && f.quality === qualityHint,
  );
  // Fallback: same kind any quality
  if (!chosen) chosen = formats.find((f) => f.kind === kind);
  // Fallback: first format
  if (!chosen) chosen = formats[0];

  // Now proxy via yt-dlp stdout pipe (handles encrypted/DASH segments too)
  const nodeStream = ytdlpStream(sourceUrl, chosen.format_id);

  const ext = chosen.ext || MimeDetector.resolve("", mime).extension;
  const detectedMime =
    chosen.kind === "audio"
      ? chosen.ext === "webm"
        ? "audio/webm"
        : "audio/mp4"
      : chosen.ext === "webm"
      ? "video/webm"
      : "video/mp4";

  const finalFilename = MimeDetector.forgeFilename(
    filename.replace(/\.[^.]+$/, ""),
    chosen.quality,
    ext,
  );

  const respHeaders = new Headers();
  respHeaders.set("Content-Type", detectedMime);
  respHeaders.set(
    "Content-Disposition",
    `attachment; filename="${finalFilename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`,
  );
  respHeaders.set("Cache-Control", "no-store");
  if (chosen.filesize) respHeaders.set("Content-Length", String(chosen.filesize));

  const webStream = nodeReadableToWebStream(nodeStream);

  return new Response(webStream, { status: 200, headers: respHeaders });
}

async function handleDownload(mediaId: string, request: Request): Promise<Response> {
  const media = getMediaById(mediaId);
  if (!media) {
    return NextResponse.json(
      { ok: false, error: { code: "MEDIA_NOT_FOUND", message: "Session expired. Re-inspect the URL to download." } },
      { status: 404 },
    );
  }

  // Determine if this is a platform URL that needs yt-dlp relay
  const isPlatform = needsYtdlp(media.source_url) && media.is_direct !== false;
  // Embed/stream-only items (is_direct: false) can't be downloaded
  if (media.kind === "stream" && media.is_direct === false) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_DOWNLOADABLE",
          message: "This is an embed stream and cannot be directly downloaded. Use a browser extension or try another format.",
        },
      },
      { status: 422 },
    );
  }

  // Build a clean filename from the title
  const filename = MimeDetector.forgeFilename(media.title, media.quality, media.extension);
  const rangeHeader = request.headers.get("range");

  try {
    if (isPlatform) {
      // Platform route: yt-dlp subprocess relay
      return await proxyYtdlpStream(
        media.source_url,
        media.quality,
        media.kind,
        filename,
        media.mime,
      );
    }

    // Direct route: validate URL then proxy bytes
    const validation = SecurityGuard.isUrlSafe(media.media_url);
    if (!validation.safe || !validation.parsed) {
      return NextResponse.json(
        { ok: false, error: { code: "SSRF_BLOCKED", message: "Private or unsafe destination blocked." } },
        { status: 403 },
      );
    }

    return await proxyDirectStream(
      validation.parsed.toString(),
      rangeHeader,
      filename,
      media.mime,
    );
  } catch (err: any) {
    const msg = err?.message || "Download failed";
    const isTimeout = err?.name === "TimeoutError" || msg.includes("timed out");
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: isTimeout ? "TIMEOUT" : "UPSTREAM_ERROR",
          message: isTimeout ? "Download timed out — try again." : msg,
        },
      },
      { status: 502 },
    );
  }
}

// GET /api/download?media_id=xxx
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mediaId = searchParams.get("media_id");
  if (!mediaId?.trim()) {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "media_id required" } },
      { status: 400 },
    );
  }
  return handleDownload(mediaId.trim(), request);
}

// POST /api/download { media_id }
export async function POST(request: Request) {
  let body: { media_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "Invalid JSON" } },
      { status: 400 },
    );
  }
  if (typeof body.media_id !== "string" || !body.media_id.trim()) {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "media_id required" } },
      { status: 400 },
    );
  }
  return handleDownload(body.media_id.trim(), request);
}
