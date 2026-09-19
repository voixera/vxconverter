/**
 * ENGINE V4 VX - HLS (m3u8) Fetcher
 *
 * Fetches a master/media playlist, resolves relative segment URLs, and returns
 * an ordered list of absolute segment URLs. Callers stream them in order.
 * Handles variant selection (highest bandwidth) and basic 403 retry with a
 * playlist-origin Referer for publicly accessible CDNs.
 */

import { SecurityGuard } from "./guard";
import { EngineError, BROWSER_USER_AGENT } from "./fetcher";

export interface HlsPlan {
  playlistUrl: string;
  segmentUrls: string[];
  isMaster: boolean;
}

function assertSafe(url: string): void {
  const check = SecurityGuard.isUrlSafe(url);
  if (!check.safe) throw new EngineError("SSRF_BLOCKED", "Blocked: unsafe segment destination");
}

async function fetchText(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  assertSafe(url);
  let res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) }).catch((e: any) => {
    throw new EngineError("SOURCE_FETCH_FAILED", `Playlist fetch failed: ${e?.message || "network error"}`);
  });
  if (res.status === 403) {
    try {
      const origin = new URL(url).origin;
      res = await fetch(url, { headers: { ...headers, Referer: origin + "/", Origin: origin }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    } catch {}
  }
  if (!res.ok) throw new EngineError("SOURCE_FETCH_FAILED", `Playlist responded HTTP ${res.status}`, res.status);
  return res.text();
}

export class HlsFetcher {
  public static async plan(masterUrl: string, extraHeaders: Record<string, string> = {}, timeoutMs = 30000): Promise<HlsPlan> {
    const headers = { "User-Agent": BROWSER_USER_AGENT, Accept: "*/*", ...extraHeaders };
    let text = await fetchText(masterUrl, headers, timeoutMs);
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
        text = await fetchText(playlistUrl, headers, timeoutMs);
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

    return { playlistUrl, segmentUrls, isMaster };
  }
}
