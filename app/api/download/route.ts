import { NextResponse } from "next/server";
import { getMediaById } from "../../../lib/store";
import { SecurityGuard } from "../../../lib/engine-v4-vx/guard";
import { MimeDetector } from "../../../lib/engine-v4-vx/mime";
import { MediaValidator } from "../../../lib/engine-v4-vx/validator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleDownload(mediaId: string, request: Request): Promise<Response> {
  const media = getMediaById(mediaId);
  if (!media) {
    return NextResponse.json(
      { ok: false, error: { code: "MEDIA_NOT_FOUND", message: "Media session expired or not found. Please inspect the URL again." } },
      { status: 404 },
    );
  }

  const validation = SecurityGuard.isUrlSafe(media.media_url);
  if (!validation.safe || !validation.parsed) {
    return NextResponse.json(
      { ok: false, error: { code: validation.reason || "SSRF_BLOCKED", message: "Private destinations are not supported" } },
      { status: 403 },
    );
  }

  const mediaUrl = validation.parsed;

  try {
    const rangeHeader = request.headers.get("range");
    const fetchHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "*/*",
      "Accept-Encoding": "identity", // Ensure raw uncompressed media stream
    };
    if (rangeHeader) {
      fetchHeaders["Range"] = rangeHeader;
    }

    const upstream = await fetch(mediaUrl.toString(), {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { ok: false, error: { code: "UPSTREAM_ERROR", message: `Source server returned HTTP ${upstream.status}` } },
        { status: 502 },
      );
    }

    // Inspect first chunk to validate magic bytes and reject HTML masquerading as media
    const reader = upstream.body.getReader();
    const firstRead = await reader.read();

    if (firstRead.done || !firstRead.value || firstRead.value.length === 0) {
      return NextResponse.json(
        { ok: false, error: { code: "MEDIA_OUTPUT_INVALID", message: "Source returned an empty stream." } },
        { status: 502 },
      );
    }

    const firstChunk = firstRead.value;
    const chunkValidation = MediaValidator.validateChunk(firstChunk);

    if (!chunkValidation.valid || chunkValidation.isHtmlOrJson) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "MEDIA_OUTPUT_INVALID",
            message: "Source returned a webpage or non-media text instead of raw media bytes.",
          },
        },
        { status: 502 },
      );
    }

    const detectedMime = chunkValidation.mime || media.mime;
    const detectedExt = chunkValidation.extension || media.extension;
    const filename = MimeDetector.forgeFilename(media.title, media.quality, detectedExt);

    const headers = new Headers();
    headers.set("Content-Type", detectedMime);
    // RFC 5987 encoded filename handles non-ASCII titles correctly
    const encodedFilename = encodeURIComponent(filename);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodedFilename}`,
    );
    headers.set("Accept-Ranges", "bytes");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);

    // Reconstruct stream with first validated chunk prepended
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(firstChunk);
        function push() {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                controller.close();
                return;
              }
              controller.enqueue(value);
              push();
            })
            .catch((err) => {
              controller.error(err);
            });
        }
        push();
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(stream, {
      status: upstream.status === 206 ? 206 : 200,
      headers,
    });
  } catch (err: any) {
    const message = err?.name === "TimeoutError" ? "Download request timed out" : "Could not fetch media stream";
    return NextResponse.json(
      { ok: false, error: { code: "UPSTREAM_ERROR", message } },
      { status: 502 },
    );
  }
}

// GET /api/download?media_id=xxx  — browser navigates directly, streams without JS buffering
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mediaId = searchParams.get("media_id");
  if (!mediaId || !mediaId.trim()) {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "media_id query param is required" } },
      { status: 400 },
    );
  }
  return handleDownload(mediaId.trim(), request);
}

// POST /api/download  { media_id, format }  — kept for backward compat
export async function POST(request: Request) {
  let body: { media_id?: unknown; format?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  if (typeof body.media_id !== "string" || !body.media_id.trim()) {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "media_id is required" } },
      { status: 400 },
    );
  }

  return handleDownload(body.media_id.trim(), request);
}
