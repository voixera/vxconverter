import { NextResponse } from "next/server";
import { getMediaById } from "../../../lib/store";

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

  let mediaUrl: URL;
  try {
    mediaUrl = new URL(media.media_url);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_URL", message: "Invalid media URL" } },
      { status: 400 },
    );
  }

  if (isPrivateHost(mediaUrl.hostname)) {
    return NextResponse.json(
      { ok: false, error: { code: "SSRF_BLOCKED", message: "Private destinations are not supported" } },
      { status: 403 },
    );
  }

  try {
    const upstream = await fetch(mediaUrl.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { ok: false, error: { code: "UPSTREAM_ERROR", message: `Source returned HTTP ${upstream.status}` } },
        { status: 502 },
      );
    }

    const safeTitle = (media.title || "vx-media")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vx-media";
    const filename = `${safeTitle}-${media.quality || "source"}.${media.extension || "mp4"}`;
    const contentType = media.mime || upstream.headers.get("content-type") || "application/octet-stream";

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    headers.set("Accept-Ranges", "bytes");

    return new Response(upstream.body, {
      status: 200,
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
