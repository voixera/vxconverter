/**
 * ENGINE V4 VX - Structured Error Taxonomy
 */

export type EngineErrorCode =
  | "INVALID_URL"
  | "SSRF_BLOCKED"
  | "BLOCKED_RESOURCE"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_FETCH_FAILED"
  | "NO_MEDIA_FOUND"
  | "MEDIA_NOT_PUBLIC"
  | "MEDIA_TYPE_UNKNOWN"
  | "MEDIA_VALIDATION_FAILED"
  | "CONVERSION_FAILED"
  | "CONVERSION_UNAVAILABLE"
  | "OUTPUT_VALIDATION_FAILED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "UNSUPPORTED_SOURCE"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR";

export const ENGINE_NAME = "Engine V4 VX";
export const ENGINE_VERSION = "4.0.0-vx";

const HTTP_STATUS: Record<string, number> = {
  INVALID_URL: 400,
  BAD_REQUEST: 400,
  SSRF_BLOCKED: 403,
  BLOCKED_RESOURCE: 403,
  MEDIA_NOT_PUBLIC: 403,
  SOURCE_NOT_FOUND: 404,
  NO_MEDIA_FOUND: 404,
  MEDIA_TYPE_UNKNOWN: 422,
  UNSUPPORTED_SOURCE: 422,
  MEDIA_VALIDATION_FAILED: 422,
  OUTPUT_VALIDATION_FAILED: 422,
  CONVERSION_FAILED: 500,
  CONVERSION_UNAVAILABLE: 501,
  SOURCE_FETCH_FAILED: 502,
  TIMEOUT: 504,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Map an upstream HTTP failure to a truthful, specific error code instead of a
 * blanket 502. A 403 from a CDN is "not public / blocked", not "our server is
 * broken". A 404 is the source missing. A 429 is rate limiting.
 */
export function codeForUpstreamStatus(status: number, fallback = "SOURCE_FETCH_FAILED"): string {
  if (status === 401) return "MEDIA_NOT_PUBLIC";
  if (status === 403) return "BLOCKED_RESOURCE";
  if (status === 404 || status === 410) return "SOURCE_NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 500) return "SOURCE_FETCH_FAILED";
  return fallback;
}

export function statusForCode(code: string): number {
  return HTTP_STATUS[code] ?? 500;
}

/** Convert any thrown value into a safe, structured error payload. */
export function toStructuredError(err: unknown): { code: string; message: string } {
  const anyErr = err as any;
  const code: string = anyErr?.code || "INTERNAL_ERROR";
  let message: string = anyErr?.message || "Media extraction failed";
  // Never leak stack traces or absolute paths.
  message = String(message).split("\n")[0].slice(0, 300);
  // Map a couple of low-level codes to a cleaner public code.
  const known = Object.keys(HTTP_STATUS);
  return { code: known.includes(code) ? code : "INTERNAL_ERROR", message };
}
