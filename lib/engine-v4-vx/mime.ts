/**
 * ENGINE V4 VX - Media MIME and Format Detection
 */

export type MediaKind = "video" | "audio" | "stream" | "image";

export interface MimeInfo {
  mime: string;
  extension: string;
  kind: MediaKind;
  playable: boolean;
}

const EXT_MIME_MAP: Record<string, { mime: string; kind: MediaKind; playable: boolean }> = {
  mp4: { mime: "video/mp4", kind: "video", playable: true },
  m4v: { mime: "video/mp4", kind: "video", playable: true },
  webm: { mime: "video/webm", kind: "video", playable: true },
  ogv: { mime: "video/ogg", kind: "video", playable: false },
  mov: { mime: "video/quicktime", kind: "video", playable: false },
  avi: { mime: "video/x-msvideo", kind: "video", playable: false },
  mkv: { mime: "video/x-matroska", kind: "video", playable: false },
  flv: { mime: "video/x-flv", kind: "video", playable: false },
  ts: { mime: "video/mp2t", kind: "video", playable: false },
  m3u8: { mime: "application/vnd.apple.mpegurl", kind: "stream", playable: false },
  mpd: { mime: "application/dash+xml", kind: "stream", playable: false },
  mp3: { mime: "audio/mpeg", kind: "audio", playable: true },
  m4a: { mime: "audio/mp4", kind: "audio", playable: true },
  aac: { mime: "audio/aac", kind: "audio", playable: true },
  wav: { mime: "audio/wav", kind: "audio", playable: true },
  ogg: { mime: "audio/ogg", kind: "audio", playable: true },
  oga: { mime: "audio/ogg", kind: "audio", playable: true },
  opus: { mime: "audio/opus", kind: "audio", playable: true },
  flac: { mime: "audio/flac", kind: "audio", playable: true },
  weba: { mime: "audio/webm", kind: "audio", playable: true },
};

export class MimeDetector {
  public static isMediaMime(mime: string): boolean {
    const m = (mime || "").split(";")[0].trim().toLowerCase();
    if (!m) return false;
    if (m.startsWith("video/") || m.startsWith("audio/")) return true;
    if (m.includes("mpegurl") || m.includes("dash+xml")) return true;
    return false;
  }

  public static resolve(url: string, declaredMime?: string | null): MimeInfo {
    const cleanDeclared = (declaredMime || "").split(";")[0].trim().toLowerCase();
    const cleanUrl = url.split("?")[0].split("#")[0].toLowerCase();
    const extMatch = /\.([a-z0-9]{2,5})$/.exec(cleanUrl);
    const ext = extMatch ? extMatch[1] : "";

    if (this.isMediaMime(cleanDeclared)) {
      const isHls = cleanDeclared.includes("mpegurl") || ext === "m3u8";
      const isDash = cleanDeclared.includes("dash+xml") || ext === "mpd";
      const isAudio = cleanDeclared.startsWith("audio/");
      const isWebm = cleanDeclared.includes("webm");
      const isQuicktime = cleanDeclared.includes("quicktime");
      const isOgg = cleanDeclared.includes("ogg");

      let resolvedExt: string;
      if (isHls) resolvedExt = "m3u8";
      else if (isDash) resolvedExt = "mpd";
      else if (isAudio) resolvedExt = EXT_MIME_MAP[ext]?.kind === "audio" ? ext : "m4a";
      else if (isWebm) resolvedExt = "webm";
      else if (isQuicktime) resolvedExt = "mov";
      else if (isOgg) resolvedExt = "ogv";
      else resolvedExt = ext || "mp4";

      return {
        mime: cleanDeclared,
        extension: resolvedExt,
        kind: isHls || isDash ? "stream" : isAudio ? "audio" : "video",
        playable:
          !isHls &&
          !isDash &&
          (cleanDeclared === "video/mp4" || cleanDeclared === "video/webm" || isAudio),
      };
    }

    if (ext && EXT_MIME_MAP[ext]) {
      const match = EXT_MIME_MAP[ext];
      return { mime: match.mime, extension: ext, kind: match.kind, playable: match.playable };
    }

    // Unknown — do NOT pretend it is mp4.
    return { mime: "application/octet-stream", extension: ext || "bin", kind: "video", playable: false };
  }

  public static forgeFilename(title: string, quality: string, extension: string): string {
    const cleanTitle =
      (title || "vx-media")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "vx-media";
    return `${cleanTitle}-${quality || "source"}.${extension || "bin"}`;
  }
}
