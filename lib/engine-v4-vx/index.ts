/**
 * ENGINE V4 VX
 * Universal Public-Media Inspector & Downloader Core
 *
 * Layered extraction pipeline (each layer has one responsibility):
 *
 *   INPUT URL → URL NORMALIZER → SSRF VALIDATOR → SOURCE FETCHER →
 *   REDIRECT RESOLVER → CONTENT-TYPE DETECTOR → PLATFORM DETECTOR →
 *   GENERIC HTML SCRAPER → PLATFORM EXTRACTOR → DIRECT MEDIA RESOLVER →
 *   MEDIA VALIDATOR → CANDIDATE NORMALIZER → result
 *
 * Strategy hierarchy for every URL:
 *   1. normalize + validate
 *   2. direct-media detection
 *   3. platform extractor
 *   4. generic HTML discovery (video/source/og/json-ld/scripts)
 *   5. browser-render fallback (only if 4 found nothing and page looks JS)
 *   6. if all failed → truthful structured error
 */

import { SecurityGuard } from "./guard";
import { UrlNormalizer } from "./normalize";
import { ExtractorRegistry } from "./registry";
import { EngineContext, EngineV4Options } from "./types";
import { EngineError } from "./fetcher";
import { BrowserRenderer } from "./browser";
import { GenericExtractor } from "./extractors/generic";
import { dedupeCandidates } from "./candidate";
import { ENGINE_NAME, ENGINE_VERSION } from "./errors";
import type { ScanResult, MediaCandidate } from "../types";

export interface AnalyzeOptions extends EngineV4Options {
  /** Emit stage traces (used by the API for progress UI). */
  withTrace?: boolean;
}

export interface AnalyzeOutcome {
  result: ScanResult;
  trace: { stage: string; ok: boolean; detail?: string }[];
}

export class EngineV4VX {
  public static readonly VERSION = ENGINE_VERSION;
  public static readonly ENGINE_NAME = ENGINE_NAME;

  private registry: ExtractorRegistry;
  private defaults: Required<Omit<EngineV4Options, "enableBrowserFallback" | "enableYtdlp" | "maxHtmlBytes">> &
    Pick<EngineV4Options, "maxHtmlBytes"> & { enableBrowserFallback: boolean; enableYtdlp: boolean };

  constructor(options?: EngineV4Options) {
    this.registry = new ExtractorRegistry();
    this.defaults = {
      timeoutMs: options?.timeoutMs ?? 15000,
      userAgent:
        options?.userAgent ??
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      maxHtmlBytes: options?.maxHtmlBytes ?? 15 * 1024 * 1024,
      enableBrowserFallback: options?.enableBrowserFallback ?? true,
      enableYtdlp: options?.enableYtdlp ?? true,
    };
  }

  public async analyze(rawUrl: string, opts: AnalyzeOptions = {}): Promise<ScanResult> {
    return (await this.analyzeWithTrace(rawUrl, opts)).result;
  }

  public async analyzeWithTrace(rawUrl: string, opts: AnalyzeOptions = {}): Promise<AnalyzeOutcome> {
    const trace: { stage: string; ok: boolean; detail?: string }[] = [];
    const mark = (stage: string, ok: boolean, detail?: string) => trace.push({ stage, ok, detail });

    // ---- Layer 1: URL normalization ----
    const norm = UrlNormalizer.normalize(rawUrl);
    if (!norm.ok || !norm.parsed) {
      mark("NORMALIZE", false, norm.reason);
      const code = norm.reason === "INVALID_PROTOCOL" ? "INVALID_URL" : norm.reason || "INVALID_URL";
      throw new EngineError(code, norm.message || "Invalid URL");
    }
    mark("NORMALIZE", true, norm.url);

    // ---- Layer 2: SSRF validation ----
    const guard = SecurityGuard.isUrlSafe(norm.url!);
    if (!guard.safe || !guard.parsed) {
      mark("SSRF", false, guard.reason);
      throw new EngineError(guard.reason || "SSRF_BLOCKED", "Blocked: private or unsafe destination");
    }
    mark("SSRF", true);

    const parsedUrl = guard.parsed;
    const ctx: EngineContext = {
      url: parsedUrl,
      rawUrl: norm.url!,
      userAgent: this.defaults.userAgent,
      timeoutMs: opts.timeoutMs ?? this.defaults.timeoutMs,
    };

    // ---- Layers 3-8: run extractors in priority order ----
    const extractors = this.registry.getExtractorsFor(parsedUrl);
    let lastError: EngineError | null = null;
    let genericRan = false;

    for (const extractor of extractors) {
      if (extractor instanceof GenericExtractor) genericRan = true;
      try {
        const result = await extractor.extract(ctx);
        if (result && result.media.length > 0) {
          const media = dedupeCandidates(result.media);
          mark("EXTRACT:" + extractor.name, true, `${media.length} candidate(s)`);
          return this.wrap(ctx, media, result.provider, trace);
        }
        mark("EXTRACT:" + extractor.name, true, "no media");
      } catch (err: any) {
        // Remember the first meaningful failure but keep trying others, except
        // for hard security/validation errors which should surface immediately.
        if (err instanceof EngineError) {
          if (err.code === "SSRF_BLOCKED" || err.code === "INVALID_URL") throw err;
          if (!lastError) lastError = err;
        } else if (err?.code) {
          if (!lastError) lastError = new EngineError(err.code, err.message);
        } else if (!lastError) {
          lastError = new EngineError("SOURCE_FETCH_FAILED", err?.message || "Extractor failed");
        }
        mark("EXTRACT:" + extractor.name, false, (err as any)?.code || "failed");
      }
    }

    // ---- Layer 9: browser-render fallback for JS pages ----
    if (this.defaults.enableBrowserFallback && genericRan) {
      const rendered = await this.tryBrowserFallback(ctx);
      if (rendered && rendered.length > 0) {
        mark("BROWSER_FALLBACK", true, `${rendered.length} candidate(s)`);
        return this.wrap(ctx, rendered, parsedUrl.hostname, trace);
      }
      mark("BROWSER_FALLBACK", false, "no media");
    }

    // ---- All methods failed → truthful structured error ----
    if (lastError) {
      mark("FAILED", false, lastError.code);
      throw lastError;
    }
    mark("FAILED", false, "NO_MEDIA_FOUND");
    throw new EngineError(
      "NO_MEDIA_FOUND",
      "No publicly accessible media could be extracted. If this page loads its video with JavaScript, it may require a browser runtime that is not enabled in this deployment.",
    );
  }

  private async tryBrowserFallback(ctx: EngineContext): Promise<MediaCandidate[] | null> {
    try {
      if (!(await BrowserRenderer.isAvailable())) return null;
      const rendered = await BrowserRenderer.render(ctx.rawUrl, ctx.timeoutMs + 10000);
      if (!rendered.available || !rendered.html) return null;
      const base = rendered.finalUrl ? new URL(rendered.finalUrl) : ctx.url;
      const media = GenericExtractor.parseHtml(rendered.html, base, ctx.rawUrl);
      return media.length ? media : null;
    } catch {
      return null;
    }
  }

  private wrap(
    ctx: EngineContext,
    media: MediaCandidate[],
    provider: string,
    trace: { stage: string; ok: boolean; detail?: string }[],
  ): AnalyzeOutcome {
    const result: ScanResult = {
      scan_id: crypto.randomUUID(),
      source_url: ctx.rawUrl,
      normalized_url: ctx.url.toString(),
      media_count: media.length,
      media,
      provider,
      engine: EngineV4VX.ENGINE_NAME,
      cached: false,
      created_at: new Date().toISOString(),
      trace,
      engine_version: EngineV4VX.VERSION,
    };
    return { result, trace };
  }
}

export const engineV4 = new EngineV4VX();
