/**
 * Engine V4 VX - Resilient Fetch Layer
 * Handles browser content negotiation, redirect tracing, and HTML rescue.
 */

import { SecurityGuard } from "./guard";

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  finalUrl: URL;
  contentType: string;
  contentLength: number | null;
  html?: string;
  rawResponse?: Response;
}

export class ResilientFetcher {
  private static readonly BROWSER_HEADERS: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,video/*,audio/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };

  /**
   * Fetch with SSRF checks on initial URL and redirect destinations
   */
  public static async fetch(
    targetUrl: URL,
    timeoutMs = 15000,
    maxBytes = 15 * 1024 * 1024,
  ): Promise<FetchResult> {
    const initialCheck = SecurityGuard.isUrlSafe(targetUrl.toString());
    if (!initialCheck.safe || !initialCheck.parsed) {
      throw new Error("Private destinations are not supported");
    }

    let response: Response;
    try {
      response = await fetch(targetUrl.toString(), {
        headers: this.BROWSER_HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        const timeoutErr = new Error("Source request timed out after " + timeoutMs + "ms");
        (timeoutErr as any).code = "TIMEOUT";
        throw timeoutErr;
      }
      const fetchErr = new Error("Could not connect to source URL: " + (err.message || "Network error"));
      (fetchErr as any).code = "SOURCE_FETCH_FAILED";
      throw fetchErr;
    }

    const finalUrlStr = response.url || targetUrl.toString();
    const redirectCheck = SecurityGuard.isUrlSafe(finalUrlStr);
    if (!redirectCheck.safe || !redirectCheck.parsed) {
      throw new Error("Redirected to a private or unsafe destination");
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const contentLength = response.headers.get("content-length")
      ? Number(response.headers.get("content-length"))
      : null;

    let html: string | undefined;

    // Read body text if HTML or text
    if (
      contentType.includes("html") ||
      contentType.includes("text") ||
      contentType.includes("xml") ||
      contentType === "" ||
      !response.ok
    ) {
      try {
        const text = await response.text();
        html = text.slice(0, maxBytes);
      } catch {}
    }

    return {
      ok: response.ok,
      status: response.status,
      url: finalUrlStr,
      finalUrl: redirectCheck.parsed,
      contentType,
      contentLength,
      html,
      rawResponse: response,
    };
  }
}
