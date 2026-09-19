/**
 * ENGINE V4 VX - Media Candidate Normalization
 *
 * Single place that shapes a raw discovered URL into a normalized candidate
 * with real MIME/extension. Prevents fake types from leaking to the frontend.
 */

import type { MediaCandidate } from "../types";
import { MimeDetector } from "./mime";

export interface CandidateInput {
  url: string;
  title?: string;
  sourceUrl: string;
  thumbnail?: string | null;
  mime?: string | null;
  extension?: string | null;
  quality?: string;
  kind?: "video" | "audio" | "stream" | "image";
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  filesize?: number | null;
  playable?: boolean;
  isDirect?: boolean;
  /** Where the candidate came from: "youtube" | "opengraph" | "html5" | ... */
  source: string;
  platform?: string;
}

export class CandidateFactory {
  public static make(input: CandidateInput): MediaCandidate {
    const resolved = MimeDetector.resolve(input.url, input.mime || undefined);
    const kind = input.kind || resolved.kind;
    const extension = input.extension || resolved.extension;
    const mime = input.mime || resolved.mime;

    return {
      id: crypto.randomUUID(),
      title: input.title || "Discovered Media",
      source_url: input.sourceUrl,
      media_url: input.url,
      thumbnail_url: input.thumbnail ?? null,
      mime,
      extension,
      width: input.width ?? null,
      height: input.height ?? null,
      duration: input.duration ?? null,
      filesize: input.filesize ?? null,
      quality: input.quality || "source",
      kind,
      playable: input.playable ?? resolved.playable,
      is_direct: input.isDirect ?? true,
      // Extended (optional) fields.
      source: input.source,
      platform: input.platform ?? null,
    } as MediaCandidate;
  }
}

/** Remove duplicate candidates by media_url, keeping the richest entry. */
export function dedupeCandidates(list: MediaCandidate[]): MediaCandidate[] {
  const byUrl = new Map<string, MediaCandidate>();
  for (const c of list) {
    if (!c.media_url) continue;
    const key = c.media_url.split("#")[0];
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, c);
      continue;
    }
    // Prefer the candidate with more metadata.
    const score = (m: MediaCandidate) =>
      (m.width ? 1 : 0) + (m.height ? 1 : 0) + (m.duration ? 1 : 0) + (m.filesize ? 1 : 0) + (m.thumbnail_url ? 1 : 0);
    if (score(c) > score(existing)) byUrl.set(key, c);
  }
  return Array.from(byUrl.values());
}
