/**
 * ENGINE V4 VX - HLS (m3u8) Fetcher
 *
 * Fetches a master/media playlist, resolves relative segment URLs, and returns
 * an ordered list of absolute segment URLs. Callers stream them in order.
 *
 * Many public CDNs (e.g. surrit.com behind Cloudflare) refuse a bare request
 * and require a browser-like Referer/Origin that points at the page which
 * embedded the stream. We therefore try a small, ordered set of header
 * strategies and keep the first that succeeds. This is standard browser
 * behaviour, never an access-control bypass: if every strategy is rejected we
 * surface a truthful structured error.
 */

import { SecurityGuard } from "./guard";
import { EngineError, BROWSER_USER_AGENT, ResilientFetcher } from "./fetcher";
import { codeForUpstreamStatus } from "./errors";

export interface HlsPlan {
  playlistUrl: string;
  segmentUrls: string[];
  isMaster: boolean;
  /** Headers that successfully fetched the playlist (reused for segments). */
  headers: Record<string, string>;
}

function assertSafe(url: string): void {
  const check = SecurityGuard.isUrlSafe(url);
  if (!check.safe) throw new EngineError("SSRF_BLOCKED", "Blocked: unsafe segment destination");
}

/**
 * Build an ordered list of header variants to try. Each variant is a full
 * browser-like header set plus a Referer/Origin combination.
 */
function headerStrategies(
  targetUrl: string,
  extraHeaders: Record<string, string>,
): Record<string, string>[] {
  const base = ResilientFetcher.mediaHeaders(BROWSER_USER_AGENT);
  const providedReferer = extraHeaders.Referer || extraHeaders.referer;
  const providedOrigin = extraHeaders.Origin || extraHeaders.origin;

  let playlistOrigin = "";
  try { playlistOrigin = new URL(targetUrl).origin; } catch {}

  const variants: Record<string, string>[] = [];

  // 1. Caller-provided headers (usually the embedding page URL as Referer).
  variants.push({ ...base, ...extraHeaders });

  // 2. Playlist's own origin as Referer/Origin.
  if (playlistOrigin) {
    variants.push({ ...base, ...extraHeaders, Referer: playlistOrigin + "/", Origin: playlistOrigin });
  }

  // 3. Provided Referer + its Origin (explicit, in case extraHeaders had only one).
  if (providedReferer) {
    let origin = providedOrigin;
    if (!origin) { try { origin = new URL(providedReferer).origin; } catch {} }
    variants.push({ ...base, ...extraHeaders, Referer: providedReferer, ...(origin ? { Origin: origin } : {}) });
  }

  // 4. No Referer/Origin at all (some CDNs reject a foreign Referer outright).
  const bare = { ...base };
  delete (bare as any).Referer;
  delete (bare as any).Origin;
  variants.push(bare);

  // De-duplicate identical header sets while preserving priority order.
  const seen = new Set<string>();
  return variants.filter((v) => {
    const key = JSON.stringify(Object.entries(v).sort());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface PlaylistFetch {
  text: string;
  headers: Record<string, string>;
}

async function fetchPlaylist(
  url: string,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
): Promise<PlaylistFetch> {
  assertSafe(url);
  const strategies = headerStrategies(url, extraHeaders);
  let lastStatus = 0;

  for (const headers of strategies) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: any) {
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        throw new EngineError("TIMEOUT", "Playlist request timed out");
      }
      // Network failure — remember and try the next strategy.
      lastStatus = lastStatus || 0;
      continue;
    }
    if (res.ok) {
      const text = await res.text();
      return { text, headers };
    }
    lastStatus = res.status;
    // A 404/410/429/5xx will not be fixed by changing headers — stop early.
    if ([404, 410, 429].includes(res.status) || res.status >= 500) break;
  }

  const code = codeForUpstreamStatus(lastStatus, "SOURCE_FETCH_FAILED");
  throw new EngineError(code, `Playlist responded HTTP ${lastStatus || "error"}`, lastStatus || undefined);
}

export class HlsFetcher {
  public static async plan(masterUrl: string, extraHeaders: Record<string, string> = {}, timeoutMs = 30000): Promise<HlsPlan> {
    const first = await fetchPlaylist(masterUrl, extraHeaders, timeoutMs);
    let text = first.text;
    const headers = first.headers;
    let playlistUrl = masterUrl;
    let isMaster = false;

    if (text.includes("#EXT-X-STREAM-INF")) {
      isMaster = true;
      const lines = text.split("\n");
      let bestUrl = "";
      let maxBw = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXT-X-STREAM-INF")) {
          const bw = Number(/BANDWIDTH=(\d+)/i.exec(line)?.[1] || 0);
          const next = (lines[i + 1] || "").trim();
          if (next && !next.startsWith("#") && bw >= maxBw) {
            maxBw = bw;
            try { bestUrl = new URL(next, masterUrl).toString(); } catch {}
          }
        }
      }
      if (bestUrl) {
        playlistUrl = bestUrl;
        const sub = await fetchPlaylist(playlistUrl, extraHeaders, timeoutMs);
        text = sub.text;
      }
    }

    const segmentUrls: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      try {
        const abs = new URL(line, playlistUrl).toString();
        if (SecurityGuard.isUrlSafe(abs).safe) segmentUrls.push(abs);
      } catch {}
    }

    if (segmentUrls.length === 0) {
      throw new EngineError("MEDIA_VALIDATION_FAILED", "HLS playlist contained no media segments");
    }

    return { playlistUrl, segmentUrls, isMaster, headers };
  }
}
