/**
 * ENGINE V4 VX - URL Normalizer
 *
 * Safely normalizes user input into a canonical absolute http(s) URL.
 * Never blindly concatenates strings — always parses via WHATWG URL.
 */

export interface NormalizeResult {
  ok: boolean;
  url?: string;
  parsed?: URL;
  reason?: "INVALID_URL" | "INVALID_PROTOCOL" | "EMPTY_HOST";
  message?: string;
}

export class UrlNormalizer {
  public static normalize(raw: string): NormalizeResult {
    if (typeof raw !== "string") {
      return { ok: false, reason: "INVALID_URL", message: "URL must be a string" };
    }

    let input = raw.trim();
    if (!input) {
      return { ok: false, reason: "INVALID_URL", message: "URL is empty" };
    }

    // Reject control characters / whitespace inside the URL.
    if (/[\s\u0000-\u001f]/.test(input)) {
      return { ok: false, reason: "INVALID_URL", message: "URL contains whitespace or control characters" };
    }

    // Add a protocol if the user omitted one, but never for things that are
    // clearly not web URLs.
    const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
    if (!hadScheme) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
        // Has a scheme but not '://' (e.g. javascript:, data:, ftp:) — reject.
        return { ok: false, reason: "INVALID_PROTOCOL", message: "Only http and https URLs are supported" };
      }
      input = "https://" + input;
    }

    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      return { ok: false, reason: "INVALID_URL", message: "Could not parse URL" };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "INVALID_PROTOCOL", message: "Only http and https URLs are supported" };
    }

    if (!parsed.hostname) {
      return { ok: false, reason: "EMPTY_HOST", message: "URL is missing a hostname" };
    }

    // A hostname with no dot and no scheme inferred from the user (i.e. they
    // typed "example" rather than "example.com") is almost certainly a typo.
    // We do NOT apply this when the user explicitly gave a scheme, so that
    // hostname-blocking (localhost etc.) is handled by the SSRF guard.
    if (!hadScheme && !parsed.hostname.includes(".") && !parsed.hostname.includes(":")) {
      return { ok: false, reason: "EMPTY_HOST", message: "Hostname looks incomplete" };
    }

    // Drop the fragment — servers never receive it and it breaks media identity.
    parsed.hash = "";

    return { ok: true, url: parsed.toString(), parsed };
  }
}
