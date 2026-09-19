import { NextResponse } from "next/server";
import { ENGINE_NAME, ENGINE_VERSION } from "../../../lib/engine-v4-vx/errors";
import { FfmpegAdapter } from "../../../lib/engine-v4-vx/ffmpeg";
import { ytdlpIsAvailable } from "../../../lib/engine-v4-vx/ytdlp";
import { BrowserRenderer } from "../../../lib/engine-v4-vx/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const START = Date.now();

export async function GET() {
  // Capabilities probe — reported honestly so the UI can reflect real limits.
  const [ffmpeg, ytdlp, browser] = await Promise.all([
    FfmpegAdapter.isAvailable().catch(() => false),
    ytdlpIsAvailable().catch(() => false),
    BrowserRenderer.isAvailable().catch(() => false),
  ]);

  return NextResponse.json({
    ok: true,
    engine: ENGINE_NAME,
    data: {
      status: "ok",
      version: ENGINE_VERSION,
      engine: ENGINE_NAME,
      uptime_secs: Math.floor((Date.now() - START) / 1000),
      capabilities: {
        ffmpeg,
        ytdlp,
        browser,
        hls: true,
        ssrfGuard: true,
        magicByteValidation: true,
      },
    },
  });
}
