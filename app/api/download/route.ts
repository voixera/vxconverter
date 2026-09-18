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

// Headers that convince CDNs we're a standard browser
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Encoding": "identity",
  "Accept-Language": "en-US,en;q=0.9",
};

function sanitizeFilename(title: string, quality: string, ext: string): string {
  const cleanTitle =
    (title || "vx-media")
      .replace(/\s*\(\s*\d{3,4}p[^)]*\)\s*$/, "")
      .replace(/\s*\(Audio\)\s*$/, "")
      .replace(/\s*\(Embed[^)]*\)\s*$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "vx-media";
  const q = quality && quality !== "source" ? `-${quality}` : "";
  return `${cleanTitle}${q}.${ext}`;
}

/**
 * Parses HLS (.m3u8) master or media playlist, extracts all TS/MP4 segments,
 * and streams them consecutively into a single unified video file response.
 */
async function streamHlsSegments(
  masterUrl: string,
  fetchHeaders: Record<string, string>,
  filename: string,
): Promise<Response> {
  const res = await fetch(masterUrl, {
    headers: fetchHeaders,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`HLS playlist fetch failed with HTTP ${res.status}`);
  }

  let text = await res.text();
  let playlistUrl = masterUrl;

  // If master playlist with multiple variant streams, choose the best quality stream
  if (text.includes("#EXT-X-STREAM-INF")) {
    const lines = text.split("\n");
    let bestUrl = "";
    let maxBw = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        const bwMatch = /BANDWIDTH=(\d+)/i.exec(line);
        const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        const nextLine = (lines[i + 1] || "").trim();
        if (nextLine && !nextLine.startsWith("#")) {
          if (bw >= maxBw || !bestUrl) {
            maxBw = bw;
            try {
              bestUrl = new URL(nextLine, masterUrl).toString();
            } catch {}
          }
        }
      }
    }

    if (bestUrl) {
      playlistUrl = bestUrl;
      const subRes = await fetch(playlistUrl, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(30000),
      });
      if (subRes.ok) {
        text = await subRes.text();
      }
    }
  }

  // Extract all segment URLs from media playlist
  const lines = text.split("\n");
  const segmentUrls: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith("#")) {
      try {
        const absSegment = new URL(line, playlistUrl).toString();
        segmentUrls.push(absSegment);
      } catch {}
    }
  }

  if (segmentUrls.length === 0) {
    throw new Error("No media segments found in HLS stream playlist");
  }

  const baseName = filename.replace(/\.[^.]+$/, "");
  const finalFilename = `${baseName}.mp4`;
  const safeFilename = finalFilename.replace(/[^\x20-\x7e]/g, "_");

  const respHeaders = new Headers();
  respHeaders.set("Content-Type", "video/mp4");
  respHeaders.set(
    "Content-Disposition",
    `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`,
  );
  respHeaders.set("Cache-Control", "no-store");
  respHeaders.set("Accept-Ranges", "bytes");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const segUrl of segmentUrls) {
          const segRes = await fetch(segUrl, {
            headers: fetchHeaders,
            signal: AbortSignal.timeout(30000),
          });
          if (segRes.ok && segRes.body) {
            const reader = segRes.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.length > 0) {
                controller.enqueue(value);
              }
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: respHeaders,
  });
}

/**
 * Proxy an HTTPS media URL through the server.
 * Handles both direct media streams and HLS (.m3u8) playlists.
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

  // Check if target is directly known as HLS (.m3u8)
  const isHls =
    mediaUrl.toLowerCase().includes(".m3u8") ||
    hintMime.toLowerCase().includes("mpegurl");

  if (isHls) {
    return streamHlsSegments(mediaUrl, fetchHeaders, filename);
  }

  const upstream = await fetch(mediaUrl, {
    headers: fetchHeaders,
    redirect: "follow",
    signal: AbortSignal.timeout(60000),
  });

  if (!upstream.ok || !upstream.body) {
    throw new Error(`Upstream ${upstream.status}: ${upstream.statusText}`);
  }

  const reader = upstream.body.getReader();
  const { done, value: firstChunk } = await reader.read();

  if (done || !firstChunk?.length) {
    throw new Error("Upstream returned empty stream");
  }

  const chunkVal = MediaValidator.validateChunk(firstChunk);

  // If first chunk indicates HLS playlist, switch to HLS segment assembler
  if (chunkVal.format === "m3u8") {
    return streamHlsSegments(mediaUrl, fetchHeaders, filename);
  }

  if (chunkVal.isHtmlOrJson) {
    const preview = Buffer.from(firstChunk).slice(0, 120).toString("utf8");
    throw new Error(`Source returned page/error instead of media: ${preview.slice(0, 60)}`);
  }

  const detectedMime = chunkVal.mime || hintMime || "application/octet-stream";
  const detectedExt = chunkVal.extension || MimeDetector.resolve(mediaUrl, hintMime).extension || "mp4";
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
          .then(({ done: d, value }) => {
            if (d) {
              controller.close();
              return;
            }
            if (value && value.length > 0) {
              controller.enqueue(value);
            }
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

  // Embed stream without source cannot be relayed
  if (media.kind === "stream" && media.is_direct === false && !media.media_url) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_DOWNLOADABLE", message: "Embed player only — not directly downloadable." } },
      { status: 422 },
    );
  }

  const filename = sanitizeFilename(media.title, media.quality, media.extension);
  const rangeHeader = request.headers.get("range");

  try {
    // --- Path A: Platform URL (YouTube, TikTok, etc.) ---
    if (needsYtdlp(media.source_url)) {
      try {
        const formats = await ytdlpGetFormats(media.source_url);
        if (formats.length) {
          const kind = media.kind === "audio" ? "audio" : "video";
          let chosen = formats.find((f) => f.kind === kind && f.quality === media.quality);
          if (!chosen) chosen = formats.find((f) => f.kind === kind);
          if (!chosen) chosen = formats[0];

          const ext = chosen.ext || media.extension;
          const finalFilename = sanitizeFilename(media.title, chosen.quality, ext);

          return await proxyUrl(chosen.url, rangeHeader, finalFilename, media.mime, {
            Referer: "https://www.youtube.com/",
            Origin: "https://www.youtube.com",
          });
        }
      } catch (ytdlpErr) {
        if (!media.media_url || !media.is_direct) {
          throw ytdlpErr;
        }
      }
    }

    // --- Path B: Direct / HLS URL ---
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
