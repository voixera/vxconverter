import { NextResponse } from "next/server";
import { getMediaById } from "../../../lib/store";
import { SecurityGuard } from "../../../lib/engine-v4-vx/guard";
import { MimeDetector } from "../../../lib/engine-v4-vx/mime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const media = getMediaById(body.media_id.trim());
  if (!media) {
    return NextResponse.json(
      { ok: false, error: { code: "MEDIA_NOT_FOUND", message: "Media not found or expired" } },
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
        { ok: false, error: { code: "UPSTREAM_ERROR", message: `Source returned HTTP ${upstream.status}` } },
        { status: 502 },
      );
    }

    const upstreamContentType = upstream.headers.get("content-type");
    const mimeInfo = MimeDetector.resolve(media.media_url, upstreamContentType || media.mime);
    const filename = MimeDetector.forgeFilename(media.title, media.quality, mimeInfo.extension);

    const headers = new Headers();
    headers.set("Content-Type", mimeInfo.mime);
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    headers.set("Accept-Ranges", "bytes");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);

    return new Response(upstream.body, {
      status: upstream.status === 206 ? 206 : 200,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error && err.name === "TimeoutError" ? "Download request timed out" : "Could not fetch media stream";
    return NextResponse.json(
      { ok: false, error: { code: "UPSTREAM_ERROR", message } },
      { status: 502 },
    );
  }
}
