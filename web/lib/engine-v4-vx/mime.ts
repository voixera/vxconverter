/**
 * Engine V4 VX - Media MIME and Format Detection
 */

export interface MimeInfo {
  mime: string;
  extension: string;
  kind: "video" | "audio" | "stream" | "image";
  playable: boolean;
}

export class MimeDetector {
  private static EXT_MIME_MAP: Record<string, { mime: string; kind: "video" | "audio" | "stream" | "image"; playable: boolean }> = {
    // Video Formats
    mp4: { mime: "video/mp4", kind: "video", playable: true },
    m4v: { mime: "video/mp4", kind: "video", playable: true },
    webm: { mime: "video/webm", kind: "video", playable: true },
    ogv: { mime: "video/ogg", kind: "video", playable: true },
    mov: { mime: "video/quicktime", kind: "video", playable: false },
    avi: { mime: "video/x-msvideo", kind: "video", playable: false },
    mkv: { mime: "video/x-matroska", kind: "video", playable: false },
    flv: { mime: "video/x-flv", kind: "video", playable: false },
    ts: { mime: "video/mp2t", kind: "video", playable: false },
    m3u8: { mime: "application/x-mpegurl", kind: "stream", playable: false },
    mpd: { mime: "application/dash+xml", kind: "stream", playable: false },

    // Audio Formats
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

  public static resolve(url: string, declaredMime?: string | null): MimeInfo {
    const cleanDeclared = declaredMime?.split(";")[0]?.trim().toLowerCase() || "";
    const cleanUrl = url.split("?")[0].toLowerCase();
    const extMatch = /\.([a-z0-9]{2,5})$/i.exec(cleanUrl);
    const ext = extMatch ? extMatch[1] : "";

    if (cleanDeclared.startsWith("video/") || cleanDeclared.startsWith("audio/") || cleanDeclared.includes("mpegurl")) {
      const isM3u8 = cleanDeclared.includes("mpegurl") || ext === "m3u8";
      const isAudio = cleanDeclared.startsWith("audio/");
      const isWebm = cleanDeclared.includes("webm");
      const isQuicktime = cleanDeclared.includes("quicktime");

      const resolvedExt = isM3u8
        ? "m3u8"
        : isAudio
          ? (ext === "m4a" || ext === "aac" || ext === "ogg" || ext === "wav" || ext === "flac" ? ext : "mp3")
          : isWebm
            ? "webm"
            : isQuicktime
              ? "mov"
              : ext || "mp4";

      const playable = !isM3u8 && (cleanDeclared === "video/mp4" || cleanDeclared === "video/webm" || isAudio);

      return {
        mime: cleanDeclared,
        extension: resolvedExt,
        kind: isM3u8 ? "stream" : isAudio ? "audio" : "video",
        playable,
      };
    }

    if (ext && this.EXT_MIME_MAP[ext]) {
      const match = this.EXT_MIME_MAP[ext];
      return {
        mime: match.mime,
        extension: ext,
        kind: match.kind,
        playable: match.playable,
      };
    }

    return {
      mime: "video/mp4",
      extension: "mp4",
      kind: "video",
      playable: true,
    };
  }

  public static forgeFilename(title: string, quality: string, extension: string): string {
    const cleanTitle = (title || "vx-media")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "vx-media";
    return `${cleanTitle}-${quality || "source"}.${extension || "mp4"}`;
  }
}
