/**
 * ENGINE V4 VX - Media Sniffer (Magic-Byte / Container Detection)
 *
 * Determines the REAL media format from bytes on disk. This is the single
 * source of truth used to reject HTML/JSON masquerading as media and to
 * refuse fake extension renames (e.g. WebM renamed to .mp3).
 */

export interface SniffResult {
  /** A stable format id: mp4 | webm | mkv | mp3 | ogg | wav | flac | aac | ts | m3u8 | html | json | unknown */
  format: string;
  mime: string;
  extension: string;
  kind: "video" | "audio" | "stream" | "text" | "unknown";
  isHtmlOrJson: boolean;
  isContainer: boolean;
}

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.slice(start, end).toString("ascii");
}

export class MediaSniffer {
  /**
   * Sniff the format of a leading byte chunk (at least 16 bytes recommended).
   */
  public static sniff(chunk: Buffer | Uint8Array): SniffResult {
    if (!chunk || chunk.length < 4) {
      return { format: "unknown", mime: "application/octet-stream", extension: "bin", kind: "unknown", isHtmlOrJson: false, isContainer: false };
    }
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    // --- Text payload masquerading as media ---
    const sample = buf.slice(0, 512).toString("utf8").replace(/^\uFEFF/, "").trimStart();
    const lower = sample.slice(0, 64).toLowerCase();
    if (lower.startsWith("#extm3u")) {
      return { format: "m3u8", mime: "application/vnd.apple.mpegurl", extension: "m3u8", kind: "stream", isHtmlOrJson: false, isContainer: false };
    }
    if (
      lower.startsWith("<!doctype") ||
      lower.startsWith("<html") ||
      lower.startsWith("<head") ||
      lower.startsWith("<body") ||
      lower.startsWith("<?xml") ||
      /^<\?xml[\s\S]*?<html/i.test(sample)
    ) {
      return { format: "html", mime: "text/html", extension: "html", kind: "text", isHtmlOrJson: true, isContainer: false };
    }
    if (sample.startsWith("{") || sample.startsWith("[")) {
      // Only treat as JSON payload if it parses OR looks like an error object.
      const looksJson = /^[\[{][\s\S]*[}\]"]\s*$/.test(sample.slice(0, 256)) || /"(error|message|code|status)"/i.test(sample.slice(0, 256));
      if (looksJson) {
        return { format: "json", mime: "application/json", extension: "json", kind: "text", isHtmlOrJson: true, isContainer: false };
      }
    }

    // --- MP4 / M4A / MOV (ISO BMFF: 'ftyp' at offset 4) ---
    if (buf.length >= 12 && ascii(buf, 4, 8) === "ftyp") {
      const brand = ascii(buf, 8, 12).toLowerCase();
      const audioBrands = ["m4a ", "m4b ", "m4p ", "mp4a", "isom"];
      const isAudio = brand.startsWith("m4a") || brand === "m4b " || brand === "mp4a";
      if (isAudio && !brand.startsWith("isom")) {
        return { format: "m4a", mime: "audio/mp4", extension: "m4a", kind: "audio", isHtmlOrJson: false, isContainer: true };
      }
      const isMov = brand.startsWith("qt");
      return {
        format: isMov ? "mov" : "mp4",
        mime: isMov ? "video/quicktime" : "video/mp4",
        extension: isMov ? "mov" : "mp4",
        kind: "video",
        isHtmlOrJson: false,
        isContainer: true,
      };
    }
    // Older MP4 fragments may begin with moov/mdat/free/skip/wide.
    const box = ascii(buf, 4, 8);
    if (buf.length >= 8 && (box === "moov" || box === "mdat" || box === "free" || box === "skip" || box === "wide" || box === "styp")) {
      return { format: "mp4", mime: "video/mp4", extension: "mp4", kind: "video", isHtmlOrJson: false, isContainer: true };
    }

    // --- MPEG-TS (sync byte 0x47 every 188 bytes) ---
    if (buf[0] === 0x47 && (buf.length < 189 || buf[188] === 0x47)) {
      return { format: "ts", mime: "video/mp2t", extension: "ts", kind: "video", isHtmlOrJson: false, isContainer: true };
    }

    // --- MP3: ID3v2 tag or MPEG audio sync ---
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
      return { format: "mp3", mime: "audio/mpeg", extension: "mp3", kind: "audio", isHtmlOrJson: false, isContainer: false };
    }
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) {
      // Frame sync present; layer bits 01/10/11 avoid matching AAC ADTS (which is FF F1/F9).
      const layer = (buf[1] >> 1) & 0x03;
      if (layer !== 0) {
        return { format: "mp3", mime: "audio/mpeg", extension: "mp3", kind: "audio", isHtmlOrJson: false, isContainer: false };
      }
    }

    // --- AAC ADTS (FF F1 / FF F9) ---
    if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) {
      return { format: "aac", mime: "audio/aac", extension: "aac", kind: "audio", isHtmlOrJson: false, isContainer: false };
    }

    // --- WebM / MKV (EBML 1A 45 DF A3) ---
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      // Disambiguate DocType between "webm" and "matroska".
      const head = buf.slice(0, Math.min(buf.length, 128)).toString("binary");
      if (head.includes("webm")) {
        return { format: "webm", mime: "video/webm", extension: "webm", kind: "video", isHtmlOrJson: false, isContainer: true };
      }
      if (head.includes("matroska")) {
        return { format: "mkv", mime: "video/x-matroska", extension: "mkv", kind: "video", isHtmlOrJson: false, isContainer: true };
      }
      return { format: "webm", mime: "video/webm", extension: "webm", kind: "video", isHtmlOrJson: false, isContainer: true };
    }

    // --- OGG (OggS) — inspect codec ---
    if (ascii(buf, 0, 4) === "OggS") {
      const head = buf.slice(0, Math.min(buf.length, 128)).toString("binary");
      if (head.includes("OpusHead") || head.includes("vorbis")) {
        return { format: "ogg", mime: "audio/ogg", extension: "ogg", kind: "audio", isHtmlOrJson: false, isContainer: true };
      }
      if (head.includes("theora")) {
        return { format: "ogv", mime: "video/ogg", extension: "ogv", kind: "video", isHtmlOrJson: false, isContainer: true };
      }
      return { format: "ogg", mime: "audio/ogg", extension: "ogg", kind: "audio", isHtmlOrJson: false, isContainer: true };
    }

    // --- WAV (RIFF....WAVE) ---
    if (ascii(buf, 0, 4) === "RIFF" && buf.length >= 12 && ascii(buf, 8, 12) === "WAVE") {
      return { format: "wav", mime: "audio/wav", extension: "wav", kind: "audio", isHtmlOrJson: false, isContainer: true };
    }
    // --- AVI (RIFF....AVI) ---
    if (ascii(buf, 0, 4) === "RIFF" && buf.length >= 12 && ascii(buf, 8, 12) === "AVI ") {
      return { format: "avi", mime: "video/x-msvideo", extension: "avi", kind: "video", isHtmlOrJson: false, isContainer: true };
    }

    // --- FLAC ---
    if (ascii(buf, 0, 4) === "fLaC") {
      return { format: "flac", mime: "audio/flac", extension: "flac", kind: "audio", isHtmlOrJson: false, isContainer: false };
    }

    // --- FLV ---
    if (ascii(buf, 0, 3) === "FLV") {
      return { format: "flv", mime: "video/x-flv", extension: "flv", kind: "video", isHtmlOrJson: false, isContainer: true };
    }

    return { format: "unknown", mime: "application/octet-stream", extension: "bin", kind: "unknown", isHtmlOrJson: false, isContainer: false };
  }

  /** True if `format` is a container/format we consider valid finished media. */
  public static isKnownMedia(format: string): boolean {
    return ["mp4", "m4a", "mov", "webm", "mkv", "mp3", "aac", "ogg", "ogv", "wav", "flac", "avi", "flv", "ts", "m3u8"].includes(format);
  }
}
