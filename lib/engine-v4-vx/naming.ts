/**
 * ENGINE V4 VX - Filename forging (safe, ASCII-safe for Content-Disposition)
 */

const MIME_EXT_OK: Record<string, string[]> = {
  "video/mp4": ["mp4"],
  "video/webm": ["webm"],
  "video/ogg": ["ogv"],
  "video/quicktime": ["mov"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a"],
  "audio/aac": ["aac"],
  "audio/wav": ["wav"],
  "audio/ogg": ["ogg"],
  "audio/opus": ["opus"],
  "audio/flac": ["flac"],
  "application/vnd.apple.mpegurl": ["m3u8"],
};

export function forgeDownloadName(title: string, quality: string, extension: string): string {
  const cleanTitle =
    (title || "vx-media")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "vx-media";
  const q = quality && quality !== "source" && quality !== "audio" ? `-${quality}` : "";
  const ext = (extension || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
  return `${cleanTitle}${q}.${ext}`;
}

export function asciiContentDisposition(filename: string): string {
  const safeAscii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function expectedExtForMime(mime: string): string | null {
  const m = (mime || "").split(";")[0].trim().toLowerCase();
  return MIME_EXT_OK[m]?.[0] ?? null;
}
