/**
 * ENGINE V4 VX - Output / Chunk Validator
 *
 * Thin, backward-compatible wrapper over MediaSniffer. Rejects HTML/JSON
 * payloads and reports the REAL container for a byte chunk.
 */

import { MediaSniffer } from "./sniff";

export interface ValidationResult {
  valid: boolean;
  format?: string;
  mime?: string;
  extension?: string;
  isHtmlOrJson?: boolean;
  reason?: string;
}

export class MediaValidator {
  /** Validate a leading byte chunk of a stream. */
  public static validateChunk(chunk: Buffer | Uint8Array): ValidationResult {
    if (!chunk || chunk.length < 4) {
      return { valid: false, reason: "CHUNK_EMPTY_OR_TOO_SMALL" };
    }
    const sniff = MediaSniffer.sniff(chunk);
    if (sniff.isHtmlOrJson) {
      return { valid: false, isHtmlOrJson: true, reason: "HTML_OR_JSON_PAYLOAD_DETECTED", format: sniff.format };
    }
    if (sniff.format === "unknown") {
      // Binary but unrecognized — allow streaming but flag as unverified.
      return { valid: true, format: "binary", mime: "application/octet-stream", extension: "bin" };
    }
    return { valid: true, format: sniff.format, mime: sniff.mime, extension: sniff.extension };
  }

  /**
   * Full validation of a completed buffer (post-download / post-conversion).
   * Returns the real format and whether it is a valid, non-empty media file.
   */
  public static validateBuffer(buffer: Buffer, expectedExtension?: string): ValidationResult {
    if (!buffer || buffer.length === 0) {
      return { valid: false, reason: "EMPTY_FILE" };
    }
    const sniff = MediaSniffer.sniff(buffer.subarray(0, Math.min(buffer.length, 4096)));
    if (sniff.isHtmlOrJson) {
      return { valid: false, isHtmlOrJson: true, reason: "HTML_OR_JSON_PAYLOAD", format: sniff.format };
    }
    if (!MediaSniffer.isKnownMedia(sniff.format)) {
      return { valid: false, reason: "UNKNOWN_CONTAINER", format: sniff.format };
    }
    if (expectedExtension) {
      const exp = expectedExtension.toLowerCase();
      const ok =
        sniff.extension === exp ||
        // Accept m4a when mp4/aac expected and vice versa where container-compatible.
        (["mp4", "m4a", "mov"].includes(exp) && ["mp4", "m4a", "mov"].includes(sniff.extension));
      if (!ok) {
        return { valid: false, reason: `CONTAINER_MISMATCH (expected ${exp}, got ${sniff.extension})`, format: sniff.format, extension: sniff.extension };
      }
    }
    return { valid: true, format: sniff.format, mime: sniff.mime, extension: sniff.extension };
  }
}
