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
  canHandle(url: URL): boolean;
  extract(ctx: EngineContext): Promise<ExtractorResult | null>;
}

export interface EngineV4Options {
  timeoutMs?: number;
  userAgent?: string;
  maxHtmlBytes?: number;
}
