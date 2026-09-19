import type { MediaCandidate, ScanResult } from "../types";

export interface EngineContext {
  url: URL;
  rawUrl: string;
  userAgent: string;
  timeoutMs: number;
}

export interface ExtractorResult {
  handled: boolean;
  provider: string;
  media: MediaCandidate[];
}

export interface V4Extractor {
  name: string;
  /** Platform extractors return true only for their host; generic always true. */
  canHandle(url: URL): boolean;
  /** Runs the extraction. Return null when the extractor has no opinion. */
  extract(ctx: EngineContext): Promise<ExtractorResult | null>;
}

export interface EngineV4Options {
  timeoutMs?: number;
  userAgent?: string;
  maxHtmlBytes?: number;
  /** Allow the selective browser-render fallback for JS pages. */
  enableBrowserFallback?: boolean;
  /** Allow yt-dlp-based platform adapters. */
  enableYtdlp?: boolean;
}

export interface EngineTrace {
  stage: string;
  detail?: string;
  ok: boolean;
}
