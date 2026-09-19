/**
 * Engine V4 VX - yt-dlp Integration
 *
 * Resolves real stream URLs at download time using yt-dlp subprocess.
 * Avoids URL expiry issues (YouTube signed URLs expire in ~6 hours).
 * This is the same engine powering yt-dlp, cobalt.tools, 9convert, etc.
 */

import { spawn } from "child_process";

export interface YtdlpFormat {
  format_id: string;
  ext: string;
  url: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  filesize_approx: number | null;
  tbr: number | null;
  abr: number | null;
  vbr: number | null;
  format_note: string;
  protocol: string;
}

export interface YtdlpInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  duration: number | null;
  formats: YtdlpFormat[];
  requested_formats?: YtdlpFormat[];
}

export interface YtdlpResolvedFormat {
  format_id: string;
  url: string;
  ext: string;
  width: number | null;
  height: number | null;
  quality: string;
  kind: "video" | "audio";
  filesize: number | null;
  acodec: string;
  vcodec: string;
  protocol: string;
}

/**
 * Resolve the yt-dlp binary. Order of precedence:
 *   1. YTDLP_PATH env (production: a vendored binary next to the function)
 *   2. `yt-dlp` on PATH
 *   3. legacy local Windows python install (dev machines)
 */
function resolveYtdlpPath(): string {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  if (process.env.VX_YTDLP_PATH) return process.env.VX_YTDLP_PATH;
  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE || "";
    const candidates = [
      `${userProfile}\\AppData\\Local\\Programs\\Python\\Python313\\Scripts\\yt-dlp.exe`,
      `${userProfile}\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\yt-dlp.exe`,
      `${userProfile}\\AppData\\Local\\Programs\\Python\\Python311\\Scripts\\yt-dlp.exe`,
    ];
    for (const c of candidates) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        if (require("fs").existsSync(c)) return c;
      } catch {}
    }
  }
  return "yt-dlp";
}

let cachedYtdlpPath: string | null = null;
function getYtdlpPath(): string {
  if (!cachedYtdlpPath) cachedYtdlpPath = resolveYtdlpPath();
  return cachedYtdlpPath;
}

/** Cheap availability probe (cached). */
let ytdlpAvailable: boolean | null = null;
export async function ytdlpIsAvailable(timeoutMs = 6000): Promise<boolean> {
  if (ytdlpAvailable !== null) return ytdlpAvailable;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; ytdlpAvailable = v; resolve(v); } };
    try {
      const child = spawn(getYtdlpPath(), ["--version"], { stdio: "ignore" });
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {}; finish(false); }, timeoutMs);
      child.on("error", () => { clearTimeout(timer); finish(false); });
      child.on("close", (code) => { clearTimeout(timer); finish(code === 0); });
    } catch {
      finish(false);
    }
  });
}

/**
 * Run yt-dlp --dump-json and return parsed info.
 * Timeout: 30s by default.
 */
export async function ytdlpGetInfo(sourceUrl: string, timeoutMs = 30000): Promise<YtdlpInfo> {
  return new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "--dump-json",
      "--no-warnings",
      "--no-check-certificates",
      // Use Node.js to solve YouTube's JS challenges when available.
      "--js-runtimes",
      "node",
      // Ask for multiple clients to maximise the set of public formats
      // (progressive + separated video/audio) without any auth bypass.
      "--extractor-args",
      "youtube:player_client=default,web,android,ios",
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      sourceUrl,
    ];

    const child = spawn(getYtdlpPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (d: Buffer) => stdout.push(d));
    child.stderr.on("data", (d: Buffer) => stderr.push(d));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp timed out"));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const raw = Buffer.concat(stdout).toString("utf8").trim();
      if (!raw || code !== 0) {
        const errMsg = Buffer.concat(stderr).toString("utf8").slice(0, 400);
        reject(new Error(`yt-dlp failed (exit ${code}): ${errMsg}`));
        return;
      }
      // yt-dlp may output multiple JSON lines (playlists) — take first
      const firstLine = raw.split("\n").find((l) => l.trim().startsWith("{"));
      if (!firstLine) {
        reject(new Error("yt-dlp returned no JSON"));
        return;
      }
      try {
        resolve(JSON.parse(firstLine) as YtdlpInfo);
      } catch {
        reject(new Error("yt-dlp JSON parse failed"));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`yt-dlp spawn failed: ${err.message}`));
    });
  });
}

/**
 * Get best downloadable formats for a URL.
 * Returns: best video+audio progressive, best video-only, best audio-only.
 */
export async function ytdlpGetFormats(sourceUrl: string): Promise<YtdlpResolvedFormat[]> {
  const info = await ytdlpGetInfo(sourceUrl);
  const fmts = info.formats || [];
  const results: YtdlpResolvedFormat[] = [];
  const seen = new Set<string>();

  const hasVideo = (f: YtdlpFormat) => f.vcodec && f.vcodec !== "none";
  const hasAudio = (f: YtdlpFormat) => f.acodec && f.acodec !== "none";
  const isHttp = (f: YtdlpFormat) => !f.protocol || f.protocol === "https" || f.protocol === "http" || f.protocol === "https+http_dash_segments";

  // Progressive (video+audio) — best quality first
  const progressive = fmts
    .filter((f) => hasVideo(f) && hasAudio(f) && f.url && isHttp(f))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

  for (const f of progressive.slice(0, 3)) {
    if (seen.has(f.url)) continue;
    seen.add(f.url);
    const h = f.height ?? 0;
    results.push({
      format_id: f.format_id,
      url: f.url,
      ext: f.ext,
      width: f.width ?? null,
      height: f.height ?? null,
      quality: h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : h > 0 ? `${h}p` : "SD",
      kind: "video",
      filesize: f.filesize ?? f.filesize_approx ?? null,
      acodec: f.acodec,
      vcodec: f.vcodec,
      protocol: f.protocol,
    });
  }

  // Best video-only (highest res, for sites that don't have progressive)
  if (results.filter((r) => r.kind === "video").length === 0) {
    const videoOnly = fmts
      .filter((f) => hasVideo(f) && !hasAudio(f) && f.url && isHttp(f))
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    for (const f of videoOnly.slice(0, 2)) {
      if (seen.has(f.url)) continue;
      seen.add(f.url);
      const h = f.height ?? 0;
      results.push({
        format_id: f.format_id,
        url: f.url,
        ext: f.ext,
        width: f.width ?? null,
        height: f.height ?? null,
        quality: h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : h > 0 ? `${h}p` : "video",
        kind: "video",
        filesize: f.filesize ?? f.filesize_approx ?? null,
        acodec: f.acodec,
        vcodec: f.vcodec,
        protocol: f.protocol,
      });
    }
  }

  // Best audio-only
  const audioOnly = fmts
    .filter((f) => !hasVideo(f) && hasAudio(f) && f.url && isHttp(f))
    .sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0));

  if (audioOnly.length > 0) {
    const f = audioOnly[0];
    if (!seen.has(f.url)) {
      seen.add(f.url);
      results.push({
        format_id: f.format_id,
        url: f.url,
        ext: f.ext,
        width: null,
        height: null,
        quality: "audio",
        kind: "audio",
        filesize: f.filesize ?? f.filesize_approx ?? null,
        acodec: f.acodec,
        vcodec: "none",
        protocol: f.protocol,
      });
    }
  }

  return results;
}

/**
 * Stream a URL via yt-dlp pipe (for formats that need decryption/dash/signing).
 * `selector` may be a yt-dlp format expression (e.g. "18", "bestvideo+bestaudio").
 * stderr is captured so callers can report real failures.
 */
export function ytdlpStream(
  sourceUrl: string,
  selector: string,
  opts: { mergeContainer?: "mp4" | "mkv"; timeoutMs?: number } = {},
): { stdout: NodeJS.ReadableStream; stderr: () => string; kill: () => void; done: Promise<number> } {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "--no-part",
    "--js-runtimes",
    "node",
    "--extractor-args",
    "youtube:player_client=default,web,android,ios",
    "-f", selector,
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "-o", "-",
    sourceUrl,
  ];
  // When merging separate streams, tell yt-dlp which container to mux to.
  if (selector.includes("+")) {
    args.splice(args.indexOf("-o"), 0, "--merge-output-format", opts.mergeContainer || "mp4");
  }

  const child = spawn(getYtdlpPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
  const errBuf: Buffer[] = [];
  child.stderr.on("data", (d: Buffer) => { if (errBuf.length < 40) errBuf.push(d); });

  const done = new Promise<number>((resolve) => {
    let settled = false;
    const finish = (code: number) => { if (!settled) { settled = true; resolve(code); } };
    if (opts.timeoutMs) {
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {}; finish(-1); }, opts.timeoutMs);
    }
    child.on("close", (code) => finish(code ?? -1));
    child.on("error", () => finish(-2));
  });

  return {
    stdout: child.stdout!,
    stderr: () => Buffer.concat(errBuf).toString("utf8"),
    kill: () => { try { child.kill("SIGKILL"); } catch {} },
    done,
  };
}

/**
 * Map a candidate to a yt-dlp format selector expression.
 *  - video+audio muxed: "<format_id>+bestaudio/best"
 *  - audio only: "bestaudio/best"
 */
export function ytdlpSelectorFor(kind: "video" | "audio", formatId?: string): string {
  if (kind === "audio") return "bestaudio/best";
  if (formatId) return `${formatId}+bestaudio/${formatId}/best`;
  return "bestvideo+bestaudio/best";
}

/**
 * Detect if a URL needs yt-dlp (platform with DRM/signing/anti-bot).
 */
export function needsYtdlp(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h.includes("youtube.com") ||
      h === "youtu.be" ||
      h.includes("tiktok.com") ||
      h.includes("instagram.com") ||
      h.includes("twitter.com") ||
      h.includes("x.com") ||
      h.includes("facebook.com") ||
      h.includes("fb.watch") ||
      h.includes("twitch.tv") ||
      h.includes("dailymotion.com") ||
      h.includes("bilibili.com") ||
      h.includes("nicovideo.jp") ||
      h.includes("soundcloud.com")
    );
  } catch {
    return false;
  }
}
