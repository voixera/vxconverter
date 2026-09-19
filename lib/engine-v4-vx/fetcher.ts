/**
 * ENGINE V4 VX - Resilient Fetch Layer
 *
 * Performs browser-like HTTP fetches with:
 *  - manual redirect following so EVERY hop is SSRF-validated
 *  - timeouts, gzip handling, content-length capture
 *  - HEAD/range probing for direct-media detection
 *
 * No anti-bot bypasses. Only standard browser headers.
 */

import { SecurityGuard } from "./guard";

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  finalUrl: URL;
  contentType: string;
  contentLength: number | null;
  acceptsRanges: boolean;
  contentDisposition: string | null;
  html?: string;
  rawResponse?: Response;
  redirectChain: string[];
}

export interface ProbeResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string;
  contentLength: number | null;
  acceptsRanges: boolean;
  contentDisposition: string | null;
  /** First bytes of the body, if a range request was used. */
  headBytes?: Buffer;
  redirectChain: string[];
}

export class EngineError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.status = status;
  }
}

export class ResilientFetcher {
  private static readonly MAX_REDIRECTS = 5;

  public static htmlHeaders(userAgent = BROWSER_USER_AGENT): Record<string, string> {
    return {
      "User-Agent": userAgent,
      Accept: HTML_ACCEPT,
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
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
  }

  /**
   * Fetch a URL following redirects manually, validating each hop for SSRF.
   */
  public static async fetch(
    targetUrl: URL | string,
    timeoutMs = 15000,
    maxBytes = 15 * 1024 * 1024,
    init?: { method?: string; headers?: Record<string, string>; readBody?: boolean },
  ): Promise<FetchResult> {
    const start = typeof targetUrl === "string" ? targetUrl : targetUrl.toString();
    const initial = SecurityGuard.isUrlSafe(start);
    if (!initial.safe || !initial.parsed) {
      throw new EngineError("SSRF_BLOCKED", "Blocked: unsafe or private destination");
    }

    const method = init?.method || "GET";
    const headers = init?.headers || this.htmlHeaders();
    const readBody = init?.readBody !== false;

    let current = initial.parsed;
    const redirectChain: string[] = [current.toString()];

    for (let hop = 0; hop <= this.MAX_REDIRECTS; hop++) {
      let response: Response;
      try {
        response = await fetch(current.toString(), {
          method,
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err: any) {
        if (err?.name === "TimeoutError" || err?.name === "AbortError") {
          throw new EngineError("TIMEOUT", `Source request timed out after ${timeoutMs}ms`);
        }
        throw new EngineError("SOURCE_FETCH_FAILED", `Could not connect to source: ${err?.message || "network error"}`);
      }

      // Handle redirects manually so each hop is validated.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return this.finalize(response, current, redirectChain, readBody, undefined);
        }
        if (hop === this.MAX_REDIRECTS) {
          throw new EngineError("SOURCE_FETCH_FAILED", "Too many redirects");
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new EngineError("SOURCE_FETCH_FAILED", "Invalid redirect location");
        }
        const check = SecurityGuard.isUrlSafe(next.toString());
        if (!check.safe || !check.parsed) {
          throw new EngineError("SSRF_BLOCKED", "Redirected to a private or unsafe destination");
        }
        current = check.parsed;
        redirectChain.push(current.toString());
        // Drain the redirect body to free the socket.
        try { await response.arrayBuffer(); } catch {}
        continue;
      }

      return this.finalize(response, current, redirectChain, readBody, maxBytes);
    }

    throw new EngineError("SOURCE_FETCH_FAILED", "Redirect limit exceeded");
  }

  private static async finalize(
    response: Response,
    current: URL,
    redirectChain: string[],
    readBody: boolean,
    maxBytes: number | undefined,
  ): Promise<FetchResult> {
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const lenHeader = response.headers.get("content-length");
    const contentLength = lenHeader ? Number(lenHeader) : null;
    const acceptsRanges = (response.headers.get("accept-ranges") || "").toLowerCase().includes("bytes");

    let html: string | undefined;
    const isText = contentType.includes("html") || contentType.includes("text") || contentType.includes("xml") || contentType === "";
    if (readBody && isText) {
      try {
        const text = await response.text();
        html = maxBytes ? text.slice(0, maxBytes) : text;
      } catch {}
    }

    return {
      ok: response.ok,
      status: response.status,
      url: response.url || current.toString(),
      finalUrl: current,
      contentType,
      contentLength: Number.isFinite(contentLength as number) ? contentLength : null,
      acceptsRanges,
      contentDisposition: response.headers.get("content-disposition"),
      html,
      rawResponse: response,
      redirectChain,
    };
  }

  /**
   * Lightweight probe: issues a ranged GET (falls back to HEAD) and returns
   * only status, headers and the first bytes. Used to determine the REAL
   * media type and validity without downloading the whole file.
   */
  public static async probe(
    targetUrl: URL | string,
    timeoutMs = 15000,
    rangeBytes = 2048,
    extraHeaders: Record<string, string> = {},
  ): Promise<ProbeResult> {
    const start = typeof targetUrl === "string" ? targetUrl : targetUrl.toString();
    const initial = SecurityGuard.isUrlSafe(start);
    if (!initial.safe || !initial.parsed) {
      throw new EngineError("SSRF_BLOCKED", "Blocked: unsafe or private destination");
    }

    const headers: Record<string, string> = {
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "*/*",
      ...extraHeaders,
    };

    let current = initial.parsed;
    const redirectChain: string[] = [current.toString()];
    let useRange = true;

    for (let hop = 0; hop <= this.MAX_REDIRECTS; hop++) {
      const reqHeaders = { ...headers };
      if (useRange) reqHeaders["Range"] = `bytes=0-${rangeBytes - 1}`;

      let response: Response;
      try {
        response = await fetch(current.toString(), {
          method: "GET",
          headers: reqHeaders,
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err: any) {
        if (err?.name === "TimeoutError" || err?.name === "AbortError") {
          throw new EngineError("TIMEOUT", `Probe timed out after ${timeoutMs}ms`);
        }
        throw new EngineError("SOURCE_FETCH_FAILED", `Probe failed: ${err?.message || "network error"}`);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new EngineError("SOURCE_FETCH_FAILED", "Invalid redirect location");
        }
        const check = SecurityGuard.isUrlSafe(next.toString());
        if (!check.safe || !check.parsed) {
          throw new EngineError("SSRF_BLOCKED", "Redirected to a private or unsafe destination");
        }
        current = check.parsed;
        redirectChain.push(current.toString());
        try { await response.arrayBuffer(); } catch {}
        continue;
      }

      // Some servers reject Range with 416 or respond 200 — read a little.
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const lenHeader = response.headers.get("content-length");
      const contentLength = lenHeader ? Number(lenHeader) : null;
      const acceptsRanges =
        (response.headers.get("accept-ranges") || "").toLowerCase().includes("bytes") ||
        response.status === 206;

      let headBytes: Buffer | undefined;
      try {
        if (response.body) {
          const reader = response.body.getReader();
          const { value } = await reader.read();
          if (value) headBytes = Buffer.from(value).subarray(0, rangeBytes);
          try { await reader.cancel(); } catch {}
        }
      } catch {}

      return {
        ok: response.ok,
        status: response.status,
        finalUrl: current.toString(),
        contentType,
        contentLength: Number.isFinite(contentLength as number) ? contentLength : null,
        acceptsRanges,
        contentDisposition: response.headers.get("content-disposition"),
        headBytes,
        redirectChain,
      };
    }

    throw new EngineError("SOURCE_FETCH_FAILED", "Probe redirect limit exceeded");
  }
}
