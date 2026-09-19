import { NextResponse } from "next/server";
import { getMediaById } from "../../../lib/store";
import { DownloadResolver, ConvertTarget, YtdlpPipePlan, DirectPlan } from "../../../lib/engine-v4-vx/downloader";
import { HlsFetcher } from "../../../lib/engine-v4-vx/hls";
import { forgeDownloadName, asciiContentDisposition } from "../../../lib/engine-v4-vx/naming";
import { EngineError, BROWSER_USER_AGENT } from "../../../lib/engine-v4-vx/fetcher";
import { SecurityGuard } from "../../../lib/engine-v4-vx/guard";
import { MediaSniffer } from "../../../lib/engine-v4-vx/sniff";
import { FfmpegAdapter } from "../../../lib/engine-v4-vx/ffmpeg";
import { ytdlpStream } from "../../../lib/engine-v4-vx/ytdlp";
import { ENGINE_NAME, statusForCode, toStructuredError } from "../../../lib/engine-v4-vx/errors";
import type { MediaCandidate } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VALID_TARGETS: ConvertTarget[] = ["mp3", "m4a", "wav", "mp4", "webm"];

function errorResponse(err: unknown) {
  const { code, message } = toStructuredError(err);
  return NextResponse.json({ ok: false, engine: ENGINE_NAME, error: { code, message } }, { status: statusForCode(code) });
}

/** Build the streaming Response for a validated direct media source. */
async function streamDirect(
  source: Awaited<ReturnType<typeof DownloadResolver.resolveSource>>,
  request: Request,
  filename: string,
  convertTo: ConvertTarget | null,
  timeoutMs: number,
): Promise<Response> {
  const range = request.headers.get("range");

  // Config: HLS is assembled server-side.
  if (source.hintExtension === "m3u8" || (source.hintMime || "").includes("mpegurl") || /\.m3u8(\?|$)/i.test(source.url)) {
    return streamHls(source, filename, timeoutMs);
  }

  // Conversion path: download fully, transcode, validate, then respond.
  if (convertTo) {
    const dl = await DownloadResolver.downloadFull(source, { timeoutMs: Math.max(timeoutMs, 180000) });
    const out = await DownloadResolver.convertBuffer(dl.buffer, dl.extension, convertTo, 180000);
    const finalName = filename.replace(/\.[^.]+$/, "") + "." + out.extension;
    return new Response(new Uint8Array(out.buffer), {
      status: 200,
      headers: {
        "Content-Type": out.mime,
        "Content-Length": String(out.buffer.length),
        "Content-Disposition": asciiContentDisposition(finalName),
        "Cache-Control": "no-store",
        "X-VX-Engine": ENGINE_NAME,
      },
    });
  }

  // Pass-through: validate the first bytes, then stream with byte ranges.
  const opened = await DownloadResolver.openAndValidate(source, { timeoutMs, sniffBytes: 65536 });

  if (opened.isStream) {
    try { await opened.reader.cancel(); } catch {}
    return streamHls(source, filename, timeoutMs);
  }

  const finalName = filename.replace(/\.[^.]+$/, "") + "." + opened.realExtension;
  const headers = new Headers();
  headers.set("Content-Type", opened.realMime);
  headers.set("Content-Disposition", asciiContentDisposition(finalName));
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "no-store");
  headers.set("X-VX-Engine", ENGINE_NAME);

  const upstreamLength = opened.response.headers.get("content-length");
  const upstreamRange = opened.response.headers.get("content-range");
  if (upstreamRange) headers.set("Content-Range", upstreamRange);
  if (upstreamLength) headers.set("Content-Length", upstreamLength);

  const reader = opened.reader;
  const firstChunk = opened.firstChunk;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstChunk);
      (function pump() {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) return controller.close();
            if (value && value.length) controller.enqueue(value);
            pump();
          })
          .catch((e) => controller.error(e));
      })();
    },
    cancel() {
      try { reader.cancel(); } catch {}
    },
  });

  return new Response(stream, {
    status: request.headers.get("range") && opened.status === 206 ? 206 : 200,
    headers,
  });
}

/** Assemble an HLS stream into a single .mp4 response by concatenating TS/MP4 segments. */
async function streamHls(
  source: Awaited<ReturnType<typeof DownloadResolver.resolveSource>>,
  filename: string,
  timeoutMs: number,
): Promise<Response> {
  const plan = await HlsFetcher.plan(source.url, source.headers, timeoutMs);
  const finalName = filename.replace(/\.[^.]+$/, "") + ".mp4";

  const headers = new Headers();
  headers.set("Content-Type", "video/mp4");
  headers.set("Content-Disposition", asciiContentDisposition(finalName));
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "no-store");
  headers.set("X-VX-Engine", ENGINE_NAME);

  const fetchHeaders = { "User-Agent": BROWSER_USER_AGENT, Accept: "*/*", ...source.headers };
  let sawBytes = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const segUrl of plan.segmentUrls) {
          if (!SecurityGuard.isUrlSafe(segUrl).safe) continue;
          let segRes = await fetch(segUrl, { headers: fetchHeaders, signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
          if (segRes && segRes.status === 403) {
            try {
              const origin = new URL(segUrl).origin;
              segRes = await fetch(segUrl, { headers: { ...fetchHeaders, Referer: origin + "/", Origin: origin }, signal: AbortSignal.timeout(timeoutMs) });
            } catch {}
          }
          if (!segRes || !segRes.ok || !segRes.body) continue;
          const reader = segRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.length) {
              sawBytes = true;
              controller.enqueue(value);
            }
          }
        }
        if (!sawBytes) {
          controller.error(new EngineError("MEDIA_VALIDATION_FAILED", "No HLS segments could be downloaded"));
          return;
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, { status: 200, headers });
}

/**
 * Stream media through a yt-dlp subprocess pipe. yt-dlp fetches with the
 * correct signing/headers and muxes separate video+audio streams itself.
 * We validate the first bytes so an error page is never saved as media, and
 * (when converting) buffer the pipe output then transcode with ffmpeg.
 */
async function streamViaYtdlp(
  plan: YtdlpPipePlan,
  sourceUrl: string,
  filename: string,
  convertTo: ConvertTarget | null,
  timeoutMs: number,
): Promise<Response> {
  const proc = ytdlpStream(sourceUrl, plan.selector, { mergeContainer: plan.mergeContainer, timeoutMs });
  const stdout = proc.stdout as NodeJS.ReadableStream & AsyncIterable<Buffer>;

  const iterator = stdout[Symbol.asyncIterator]();

  // Read the first chunk for validation.
  const first = await iterator.next();
  if (first.done || !first.value || first.value.length === 0) {
    proc.kill();
    const stderr = proc.stderr();
    // Give the user an actionable message rather than the raw yt-dlp noise.
    if (/HTTP Error 403|403: Forbidden|Sign in to confirm|not a bot/i.test(stderr)) {
      throw new EngineError(
        "MEDIA_NOT_PUBLIC",
        "The platform (e.g. YouTube) refused the stream request from this server (HTTP 403). This is typically an anti-bot/geo restriction. Try a different public source, or run VX Converter on a host with an up-to-date extractor and network access.",
      );
    }
    throw new EngineError("SOURCE_FETCH_FAILED", `The platform extractor produced no data. ${stderr.slice(-160).trim()}`);
  }
  const firstChunk = Buffer.from(first.value);
  const sniff = MediaSniffer.sniff(firstChunk.subarray(0, Math.min(firstChunk.length, 4096)));
  if (sniff.isHtmlOrJson) {
    proc.kill();
    throw new EngineError("MEDIA_VALIDATION_FAILED", "Source returned a web page or error instead of media");
  }

  // Conversion path: buffer everything (yt-dlp already validated first chunk).
  if (convertTo) {
    if (!(await FfmpegAdapter.isAvailable())) {
      proc.kill();
      throw new EngineError("CONVERSION_UNAVAILABLE", "Conversion requires ffmpeg, which is not available in this environment.");
    }
    const chunks: Buffer[] = [firstChunk];
    let total = firstChunk.length;
    const MAX = 512 * 1024 * 1024;
    while (true) {
      const { done, value } = await iterator.next();
      if (done) break;
      if (value && value.length) {
        total += value.length;
        if (total > MAX) { proc.kill(); throw new EngineError("MEDIA_VALIDATION_FAILED", "Media too large to convert in this environment"); }
        chunks.push(Buffer.from(value));
      }
    }
    const inputExt = sniff.extension && sniff.extension !== "bin" ? sniff.extension : plan.hintExtension;
    const out = await DownloadResolver.convertBuffer(Buffer.concat(chunks), inputExt, convertTo, timeoutMs);
    const finalName = filename.replace(/\.[^.]+$/, "") + "." + out.extension;
    return new Response(new Uint8Array(out.buffer), {
      status: 200,
      headers: {
        "Content-Type": out.mime,
        "Content-Length": String(out.buffer.length),
        "Content-Disposition": asciiContentDisposition(finalName),
        "Cache-Control": "no-store",
        "X-VX-Engine": ENGINE_NAME,
      },
    });
  }

  // Pass-through: stream the rest of the pipe.
  const realExt = MediaSniffer.isKnownMedia(sniff.format) ? sniff.extension : plan.hintExtension;
  const realMime = MediaSniffer.isKnownMedia(sniff.format) ? sniff.mime : plan.hintMime;
  const finalName = filename.replace(/\.[^.]+$/, "") + "." + realExt;

  const headers = new Headers();
  headers.set("Content-Type", realMime);
  headers.set("Content-Disposition", asciiContentDisposition(finalName));
  headers.set("Cache-Control", "no-store");
  headers.set("X-VX-Engine", ENGINE_NAME);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(firstChunk));
      (async () => {
        try {
          while (true) {
            const { done, value } = await iterator.next();
            if (done) break;
            if (value && value.length) controller.enqueue(new Uint8Array(value));
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      })();
    },
    cancel() {
      proc.kill();
    },
  });

  return new Response(stream, { status: 200, headers });
}

async function handleDownload(
  media: MediaCandidate,
  request: Request,
  convertTo: ConvertTarget | null,
  filenameOverride?: string,
): Promise<Response> {
  try {
    if (!media.media_url && !media.source_url) {
      throw new EngineError("MEDIA_NOT_FOUND", "Candidate has no media URL");
    }
    if (media.kind === "stream" && media.is_direct === false && !media.media_url) {
      throw new EngineError("UNSUPPORTED_SOURCE", "This is an embed player, not directly downloadable");
    }

    const filename = filenameOverride || forgeDownloadName(media.title, media.quality, media.extension);
    const timeoutMs = convertTo ? 240000 : 120000;

    const plan = await DownloadResolver.planDownload(media, { convertTo });
    if (plan.kind === "ytdlp-pipe") {
      return await streamViaYtdlp(plan, media.source_url, filename, convertTo, timeoutMs);
    }

    // Direct plan — reuse the validate+stream path.
    const source = {
      url: (plan as DirectPlan).url,
      headers: (plan as DirectPlan).headers,
      hintMime: (plan as DirectPlan).hintMime,
      hintExtension: (plan as DirectPlan).hintExtension,
      title: (plan as DirectPlan).title,
      quality: (plan as DirectPlan).quality,
    };
    return await streamDirect(source, request, filename, convertTo, timeoutMs);
  } catch (err) {
    return errorResponse(err);
  }
}

function buildPassedMedia(params: URLSearchParams): MediaCandidate {
  const mediaUrl = params.get("media_url")!.trim();
  const mime = params.get("mime")?.trim() || "";
  const kindParam = params.get("kind")?.trim();
  return {
    id: params.get("media_id")?.trim() || crypto.randomUUID(),
    title: params.get("title")?.trim() || "vx-media",
    source_url: params.get("source_url")?.trim() || mediaUrl,
    media_url: mediaUrl,
    thumbnail_url: null,
    mime: mime || "application/octet-stream",
    extension: params.get("extension")?.trim() || "bin",
    width: null,
    height: null,
    duration: null,
    filesize: null,
    quality: params.get("quality")?.trim() || "source",
    kind: kindParam || (mime.startsWith("audio/") ? "audio" : mime.includes("mpegurl") ? "stream" : "video"),
    playable: true,
    is_direct: true,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mediaId = searchParams.get("media_id")?.trim() || "";
  const mediaUrl = searchParams.get("media_url")?.trim();
  const convertRaw = searchParams.get("convert")?.trim().toLowerCase() || "";
  const convertTo = VALID_TARGETS.includes(convertRaw as ConvertTarget) ? (convertRaw as ConvertTarget) : null;

  let media: MediaCandidate | undefined;
  if (mediaUrl) {
    media = buildPassedMedia(searchParams);
  } else if (mediaId) {
    media = getMediaById(mediaId);
  }

  if (!media) {
    return NextResponse.json(
      { ok: false, engine: ENGINE_NAME, error: { code: "MEDIA_NOT_FOUND", message: "Re-inspect the URL to obtain media details." } },
      { status: 404 },
    );
  }

  return handleDownload(media, request, convertTo, searchParams.get("filename")?.trim() || undefined);
}

export async function POST(request: Request) {
  let body: { media_id?: string; media?: MediaCandidate; convert?: string; filename?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, engine: ENGINE_NAME, error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const convertRaw = (body.convert || "").toLowerCase();
  const convertTo = VALID_TARGETS.includes(convertRaw as ConvertTarget) ? (convertRaw as ConvertTarget) : null;

  const mediaId = typeof body.media_id === "string" ? body.media_id.trim() : body.media?.id || "";
  const media = body.media && typeof body.media === "object" ? body.media : mediaId ? getMediaById(mediaId) : undefined;

  if (!media) {
    return NextResponse.json(
      { ok: false, engine: ENGINE_NAME, error: { code: "MEDIA_NOT_FOUND", message: "Re-inspect the URL to obtain media details." } },
      { status: 404 },
    );
  }

  return handleDownload(media, request, convertTo, body.filename);
}
