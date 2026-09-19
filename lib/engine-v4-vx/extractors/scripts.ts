/**
 * ENGINE V4 VX - Inline Script Media Scanner
 *
 * Finds media URLs embedded in page <script> blocks, including Packer-packed
 * players (eval(function(p,a,c,k,e,...))) that hide the real stream URL.
 * Only extracts URLs that resolve to absolute http(s) media locations.
 */

import type { MediaCandidate } from "../../types";
import { CandidateFactory } from "../candidate";

const MEDIA_EXT = "m3u8|mpd|mp4|m4v|webm|mov|mp3|m4a|aac|wav|ogg|opus|flac|ts";
const URL_RE = new RegExp(`https?://[^\\s"'<>\\\\)]+?\\.(?:${MEDIA_EXT})(?:\\?[^\\s"'<>\\\\)]*)?`, "gi");

function unpackJs(packed: string): string {
  const match = /eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/.exec(packed);
  if (!match) return "";
  const [, p, aStr, cStr, kStr] = match;
  const a = parseInt(aStr, 10);
  const k = kStr.split("|");
  const c = parseInt(cStr, 10);

  function e(n: number): string {
    return (n < a ? "" : e(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
  }
  let count = c;
  const dict: Record<string, string> = {};
  while (count--) dict[e(count)] = k[count] || e(count);
  return p.replace(/\b\w+\b/g, (w) => dict[w] || w);
}

export class ScriptScanner {
  public static scan(
    html: string,
    base: URL,
    title: string,
    thumbnail: string | null,
  ): MediaCandidate[] {
    const results: MediaCandidate[] = [];
    const seen = new Set<string>();

    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let sm: RegExpExecArray | null;

    while ((sm = scriptRegex.exec(html))) {
      let content = sm[1] || "";
      if (content.includes("eval(function(p,a,c,k,e,")) {
        const unpacked = unpackJs(content);
        if (unpacked) content = unpacked;
      }
      // Unescape common JS string escapes so URL matching works.
      const unescaped = content.replace(/\\u002F/gi, "/").replace(/\\\//g, "/").replace(/\\"/g, '"');

      let m: RegExpExecArray | null;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(unescaped))) {
        let raw = m[0].replace(/\\/g, "").replace(/['",;)]+$/, "");
        let abs: string;
        try {
          abs = new URL(raw, base).toString();
        } catch {
          continue;
        }
        // Skip obvious preview/sprite/seek posters.
        if (/\/(preview|seek|poster|thumb|sprite)\//i.test(abs)) continue;
        const key = abs.split("#")[0];
        if (seen.has(key)) continue;
        seen.add(key);

        results.push(
          CandidateFactory.make({
            url: abs,
            title,
            sourceUrl: base.toString(),
            thumbnail,
            source: "script",
            platform: base.hostname,
          }),
        );
      }

      // Also pick up quoted relative media paths inside scripts, e.g. "/v/x.webm".
      const REL_RE = new RegExp(`["'\`](/[^"'\`\\s<>]{1,200}?\\.(?:${MEDIA_EXT}))(?:\\?[^"'\`\\s<>]*)?["'\`]`, "gi");
      let rm: RegExpExecArray | null;
      while ((rm = REL_RE.exec(unescaped))) {
        const raw = rm[1].replace(/\\/g, "");
        let abs: string;
        try {
          abs = new URL(raw, base).toString();
        } catch {
          continue;
        }
        if (/\/(preview|seek|poster|thumb|sprite)\//i.test(abs)) continue;
        const key = abs.split("#")[0];
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(
          CandidateFactory.make({
            url: abs, title, sourceUrl: base.toString(), thumbnail,
            source: "script", platform: base.hostname,
          }),
        );
      }
    }

    return results;
  }
}
