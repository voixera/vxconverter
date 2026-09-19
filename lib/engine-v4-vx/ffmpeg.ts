/**
 * ENGINE V4 VX - FFmpeg Adapter
 *
 * Detects whether a usable ffmpeg binary is present and performs REAL
 * audio/video conversion. Never renames an extension — always transcodes.
 * On environments without ffmpeg (e.g. default Vercel), conversion requests
 * fail truthfully with CONVERSION_UNAVAILABLE instead of faking output.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";

function candidatePaths(): string[] {
  const list: string[] = [];
  if (process.env.FFMPEG_PATH) list.push(process.env.FFMPEG_PATH);
  if (process.env.VX_FFMPEG_PATH) list.push(process.env.VX_FFMPEG_PATH);
  // Common local install locations (Windows dev machines).
  list.push(
    path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
  );
  return list;
}

export class FfmpegAdapter {
  private static resolved: string | null | undefined;

  /** Resolve the ffmpeg binary path, or null if unavailable. */
  public static resolveBinary(): string | null {
    if (this.resolved !== undefined) return this.resolved;
    for (const candidate of candidatePaths()) {
      try {
        if (candidate && existsSync(candidate)) {
          this.resolved = candidate;
          return candidate;
        }
      } catch {}
    }
    // Fall back to PATH lookup — probed lazily by isAvailable().
    this.resolved = "ffmpeg";
    return this.resolved;
  }

  /** Async availability check (runs `ffmpeg -version`). */
  public static async isAvailable(): Promise<boolean> {
    const bin = this.resolveBinary();
    if (!bin) return false;
    return new Promise((resolve) => {
      try {
        const child = spawn(bin, ["-version"], { stdio: "ignore" });
        const timer = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch {}
          resolve(false);
        }, 5000);
        child.on("error", () => { clearTimeout(timer); resolve(false); });
        child.on("close", (code) => { clearTimeout(timer); resolve(code === 0); });
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Convert an input buffer to the requested target using ffmpeg pipes.
   * target: "mp3" | "m4a" | "wav" | "mp4" | "webm"
   * Returns the converted buffer (fully materialized — callers should keep
   * inputs modest for serverless safety).
   */
  public static async convert(
    input: Buffer,
    target: "mp3" | "m4a" | "wav" | "mp4" | "webm",
    opts: { ext?: string; timeoutMs?: number } = {},
  ): Promise<Buffer> {
    const bin = this.resolveBinary();
    if (!bin) {
      const err: any = new Error("ffmpeg is not available in this environment");
      err.code = "CONVERSION_UNAVAILABLE";
      throw err;
    }

    const inputExt = opts.ext || "bin";
    const args = this.buildArgs(inputExt, target);

    return new Promise<Buffer>((resolve, reject) => {
      let child;
      try {
        child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
      } catch (e: any) {
        const err: any = new Error(`ffmpeg spawn failed: ${e.message}`);
        err.code = "CONVERSION_FAILED";
        return reject(err);
      }

      const out: Buffer[] = [];
      const errChunks: Buffer[] = [];
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        const err: any = new Error("ffmpeg conversion timed out");
        err.code = "TIMEOUT";
        reject(err);
      }, opts.timeoutMs || 120000);

      child.stdout!.on("data", (d: Buffer) => out.push(d));
      child.stderr!.on("data", (d: Buffer) => { if (errChunks.length < 40) errChunks.push(d); });

      child.on("error", (e) => {
        clearTimeout(timer);
        const err: any = new Error(`ffmpeg failed: ${e.message}`);
        err.code = "CONVERSION_UNAVAILABLE";
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const stderr = Buffer.concat(errChunks).toString("utf8");
        if (code !== 0) {
          const err: any = new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`);
          err.code = "CONVERSION_FAILED";
          return reject(err);
        }
        const buffer = Buffer.concat(out);
        if (buffer.length === 0) {
          const err: any = new Error("ffmpeg produced empty output");
          err.code = "CONVERSION_FAILED";
          return reject(err);
        }
        resolve(buffer);
      });

      child.stdin!.on("error", () => {});
      child.stdin!.end(input);
    });
  }

  private static buildArgs(inputExt: string, target: string): string[] {
    const base = ["-hide_banner", "-loglevel", "error", "-i", "pipe:0"];
    switch (target) {
      case "mp3":
        return [...base, "-vn", "-acodec", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"];
      case "m4a":
        return [...base, "-vn", "-acodec", "aac", "-b:a", "192k", "-f", "ipod", "pipe:1"];
      case "wav":
        return [...base, "-vn", "-acodec", "pcm_s16le", "-f", "wav", "pipe:1"];
      case "mp4":
        // Mux/transcode to a browser-safe MP4 (H.264 + AAC).
        return [...base, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"];
      case "webm":
        return [...base, "-c:v", "libvpx-vp9", "-b:v", "1M", "-c:a", "libopus", "-f", "webm", "pipe:1"];
      default:
        return [...base, "-f", "mp3", "pipe:1"];
    }
  }
}
