/**
 * Engine V4 VX - Media Output & File Signature Validator
 * Prevents corrupt downloads and rejects HTML/JSON error payloads.
 */

export interface ValidationResult {
  valid: boolean;
  format?: string;
  mime?: string;
  extension?: string;
  reason?: string;
  isHtmlOrJson?: boolean;
}

export class MediaValidator {
  /**
   * Validate initial chunk of stream against magic bytes and HTML injection
   */
  public static validateChunk(chunk: Buffer | Uint8Array): ValidationResult {
    if (!chunk || chunk.length < 4) {
      return { valid: false, reason: "CHUNK_EMPTY_OR_TOO_SMALL" };
    }

    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const textSample = buf.slice(0, 128).toString("utf8").trim().toLowerCase();

    // Check for HTML / JSON / XML payload masquerading as media
    if (
      textSample.startsWith("<!doctype") ||
      textSample.startsWith("<html") ||
      textSample.startsWith("<?xml") ||
      textSample.startsWith("<head") ||
      textSample.startsWith("<body") ||
      textSample.startsWith("{\"error\"") ||
      textSample.startsWith("{\"status\"") ||
      textSample.startsWith("{\"code\"")
    ) {
      return {
        valid: false,
        isHtmlOrJson: true,
        reason: "HTML_OR_JSON_PAYLOAD_DETECTED",
      };
    }

    // MP3 Detection: ID3v2 tag (49 44 33) or MPEG sync frame (FF Fx or FF Ex)
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
      return { valid: true, format: "mp3", mime: "audio/mpeg", extension: "mp3" };
    }
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
      return { valid: true, format: "mp3", mime: "audio/mpeg", extension: "mp3" };
    }

    // MP4 / M4A / MOV: ftyp / moov / mdat signature
    if (buf.length >= 8 && buf.slice(4, 8).toString("ascii") === "ftyp") {
      const brand = buf.slice(8, 12).toString("ascii").toLowerCase();
      const isAudio = brand.includes("m4a") || brand.includes("mp4a");
      return {
        valid: true,
        format: isAudio ? "m4a" : "mp4",
        mime: isAudio ? "audio/mp4" : "video/mp4",
        extension: isAudio ? "m4a" : "mp4",
      };
    }
    if (buf.length >= 8 && (buf.slice(4, 8).toString("ascii") === "moov" || buf.slice(4, 8).toString("ascii") === "mdat")) {
      return { valid: true, format: "mp4", mime: "video/mp4", extension: "mp4" };
    }

    // WebM / MKV: EBML ID (1A 45 DF A3)
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      return { valid: true, format: "webm", mime: "video/webm", extension: "webm" };
    }

    // OGG / Opus / Vorbis: OggS (4F 67 67 53)
    if (buf.slice(0, 4).toString("ascii") === "OggS") {
      return { valid: true, format: "ogg", mime: "audio/ogg", extension: "ogg" };
    }

    // RIFF WAV: RIFF ... WAVE
    if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.length >= 12 && buf.slice(8, 12).toString("ascii") === "WAVE") {
      return { valid: true, format: "wav", mime: "audio/wav", extension: "wav" };
    }

    // FLAC: fLaC
    if (buf.slice(0, 4).toString("ascii") === "fLaC") {
      return { valid: true, format: "flac", mime: "audio/flac", extension: "flac" };
    }

    // HLS M3U8 Playlist
    if (textSample.startsWith("#extm3u")) {
      return { valid: true, format: "m3u8", mime: "application/x-mpegurl", extension: "m3u8" };
    }

    // Generic binary stream
    return { valid: true, format: "binary", mime: "application/octet-stream", extension: "bin" };
  }
}
