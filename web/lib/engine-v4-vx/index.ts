/**
 * ENGINE V4 VX
 * Universal Public-Media Inspector & Downloader Core
 */

import { SecurityGuard } from "./guard";
import { ExtractorRegistry } from "./registry";
import { EngineContext, EngineV4Options } from "./types";
import { ScanResult } from "../types";

export class EngineV4VX {
  public static readonly VERSION = "4.0.0";
  public static readonly ENGINE_NAME = "Engine V4 VX";

  private registry: ExtractorRegistry;
  private defaultOptions: EngineV4Options;

  constructor(options?: EngineV4Options) {
    this.registry = new ExtractorRegistry();
    this.defaultOptions = {
      timeoutMs: options?.timeoutMs || 15000,
      userAgent:
        options?.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      maxHtmlBytes: options?.maxHtmlBytes || 15 * 1024 * 1024,
    };
  }

  /**
   * Inspect public media URL using Engine V4 VX
   */
  public async analyze(rawUrl: string): Promise<ScanResult> {
    const trimmed = rawUrl.trim();

    // 1. SSRF & URL Validation
    const validation = SecurityGuard.isUrlSafe(trimmed);
    if (!validation.safe || !validation.parsed) {
      const err = new Error(
        validation.reason === "SSRF_BLOCKED"
          ? "Private destinations are not supported"
          : "Invalid or unsupported URL protocol",
      );
      (err as any).code = validation.reason || "INVALID_URL";
      throw err;
    }

    const parsedUrl = validation.parsed;
    const ctx: EngineContext = {
      url: parsedUrl,
      rawUrl: trimmed,
      userAgent: this.defaultOptions.userAgent!,
      timeoutMs: this.defaultOptions.timeoutMs!,
    };

    // 2. Extractor Discovery
    const extractors = this.registry.getExtractorsFor(parsedUrl);

    for (const extractor of extractors) {
      try {
        const result = await extractor.extract(ctx);
        if (result && result.media.length > 0) {
          return {
            scan_id: crypto.randomUUID(),
            source_url: trimmed,
            normalized_url: parsedUrl.toString(),
            media_count: result.media.length,
            media: result.media,
            provider: result.provider,
            engine: EngineV4VX.ENGINE_NAME,
            cached: false,
            created_at: new Date().toISOString(),
          };
        }
      } catch (err: any) {
        if (extractor.name === "GenericExtractor") {
          throw err;
        }
      }
    }

    const notFoundErr = new Error("No public media found on source page");
    (notFoundErr as any).code = "MEDIA_NOT_FOUND";
    throw notFoundErr;
  }
}

export const engineV4 = new EngineV4VX();
