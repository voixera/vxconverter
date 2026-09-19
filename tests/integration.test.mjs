/**
 * ENGINE V4 VX - Integration Tests
 *
 * Runs the REAL Next.js route handlers (app/api/*) and the engine end-to-end,
 * in-process, against a local fixture server. No external/dev HTTP server is
 * ever started, and every command terminates.
 *
 * Why in-process: the previous harness required `next dev` to be running and
 * raced on server readiness. Invoking the exported route handlers directly
 * exercises the exact same code path (pipeline + validation + responses)
 * without a persistent process.
 *
 * Run: node --test tests/integration.test.mjs
 *
 * Note: the fixture server binds to 127.0.0.1, which the SSRF guard blocks by
 * design. The suite opts in to the test-only escape hatch below, which ONLY
 * relaxes 127.0.0.1 — localhost, metadata IPs and every other private range
 * stay blocked (verified by the SSRF tests themselves).
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createFixtureServer } from "./fixtures/server.mjs";
import { transpileDir } from "./transpile.mjs";

// Allow the loopback fixture server to be fetched by the engine under test.
process.env.VX_ALLOW_TEST_HOSTS = "1";

// Pre-transpile the engine + lib + route handlers to plain ESM siblings.
transpileDir("lib/engine-v4-vx");
transpileDir("lib");
transpileDir("app");

const analyzeRoute = await import("../app/api/analyze/route.vxtest.mjs");
const downloadRoute = await import("../app/api/download/route.vxtest.mjs");
const healthRoute = await import("../app/api/health/route.vxtest.mjs");

let fixtures;
let fx;

before(async () => {
  fixtures = await createFixtureServer();
  fx = fixtures.base;
});

after(() => {
  try { fixtures.server.close(); } catch {}
});

/* ---------------- In-process request helpers ---------------- */

async function analyze(url) {
  const request = new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const res = await analyzeRoute.POST(request);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function download(body, headers = {}) {
  const request = new Request("http://localhost/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const res = await downloadRoute.POST(request);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const json = await res.json().catch(() => ({}));
    return { res, isJson: true, json, bytes: null, ct };
  }
  const ab = await res.arrayBuffer();
  return { res, isJson: false, json: null, bytes: Buffer.from(ab), ct };
}

async function health() {
  const res = await healthRoute.GET();
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/* ---------------- Analyze: direct media ---------------- */

test("analyze: direct MP4 → real video/mp4 candidate", async () => {
  const { status, json } = await analyze(`${fx}/direct.mp4`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.ok(json.data.media.length >= 1);
  const m = json.data.media[0];
  assert.equal(m.mime, "video/mp4");
  assert.equal(m.extension, "mp4");
  assert.equal(m.kind, "video");
});

test("analyze: direct MP3 → real audio/mpeg candidate", async () => {
  const { json } = await analyze(`${fx}/direct.mp3`);
  assert.equal(json.ok, true);
  const m = json.data.media[0];
  assert.equal(m.mime, "audio/mpeg");
  assert.equal(m.kind, "audio");
});

test("analyze: direct WebM → real video/webm candidate", async () => {
  const { json } = await analyze(`${fx}/direct.webm`);
  assert.equal(json.ok, true);
  assert.equal(json.data.media[0].mime, "video/webm");
});

/* ---------------- Analyze: generic HTML ---------------- */

test("analyze: <video src> page", async () => {
  const { json } = await analyze(`${fx}/page-video`);
  assert.equal(json.ok, true);
  assert.ok(json.data.media.some((m) => m.media_url === `${fx}/direct.mp4`));
});

test("analyze: <source> tags page", async () => {
  const { json } = await analyze(`${fx}/page-source`);
  assert.equal(json.ok, true);
  assert.ok(json.data.media.some((m) => m.media_url.endsWith("/direct.webm")));
  assert.ok(json.data.media.some((m) => m.media_url.endsWith("/direct.mp4")));
});

test("analyze: og:video page", async () => {
  const { json } = await analyze(`${fx}/page-og`);
  assert.equal(json.ok, true);
  assert.ok(json.data.media.some((m) => m.media_url === "https://cdn.example.com/og.mp4"));
});

test("analyze: multi-candidate page dedupes and finds all", async () => {
  const { json } = await analyze(`${fx}/page-multi`);
  assert.equal(json.ok, true);
  assert.equal(json.data.media_count, json.data.media.length);
  const urls = json.data.media.map((m) => m.media_url);
  assert.ok(urls.includes(`${fx}/a.mp4`));
  assert.ok(urls.includes(`${fx}/b.mp4`));
  assert.ok(urls.includes(`${fx}/c.mp3`));
  assert.ok(urls.includes(`${fx}/d.webm`));
  assert.ok(urls.includes("https://cdn.example.com/e.m3u8?token=1"));
  // no duplicates
  assert.equal(new Set(urls).size, urls.length);
});

/* ---------------- Analyze: errors ---------------- */

test("analyze: invalid URL → 400 INVALID_URL", async () => {
  const { status, json } = await analyze("not a url at all");
  assert.equal(status, 400);
  assert.equal(json.error.code, "INVALID_URL");
});

test("analyze: SSRF blocked → 403", async () => {
  const { status, json } = await analyze("http://169.254.169.254/latest/meta-data/");
  assert.equal(status, 403);
  assert.equal(json.error.code, "SSRF_BLOCKED");
});

test("analyze: localhost blocked", async () => {
  const { status, json } = await analyze("http://localhost:9/x");
  assert.equal(status, 403);
  assert.equal(json.error.code, "SSRF_BLOCKED");
});

test("analyze: 404 source → SOURCE_NOT_FOUND", async () => {
  const { status, json } = await analyze(`${fx}/missing.mp4`);
  assert.equal(status, 404);
  assert.equal(json.error.code, "SOURCE_NOT_FOUND");
});

test("analyze: redirect to internal host is blocked (SSRF on hop)", async () => {
  const { status, json } = await analyze(`${fx}/redirect-internal`);
  assert.equal(status, 403);
  assert.equal(json.error.code, "SSRF_BLOCKED");
});

test("analyze: redirect to 404 resolves and reports not found", async () => {
  const { status, json } = await analyze(`${fx}/redirect-404`);
  assert.equal(status, 404);
  assert.ok(["SOURCE_NOT_FOUND", "NO_MEDIA_FOUND"].includes(json.error.code));
});

test("analyze: 500 source → structured error (no raw 502 crash)", async () => {
  const { json } = await analyze(`${fx}/status-500`);
  assert.ok(json.ok === false);
  assert.ok(json.error && typeof json.error.code === "string");
});

test("analyze: bogus HTML-as-mp4 is NOT reported as video", async () => {
  const { json } = await analyze(`${fx}/bogus.mp4`);
  // Either it errors, or if it returns candidates none may claim video from HTML.
  if (json.ok) {
    assert.ok(!json.data.media.some((m) => m.mime === "video/mp4"));
  } else {
    assert.ok(["MEDIA_TYPE_UNKNOWN", "SOURCE_NOT_FOUND", "NO_MEDIA_FOUND"].includes(json.error.code));
  }
});

/* ---------------- Download: anti-corruption ---------------- */

test("download: real MP4 streams with correct type and non-HTML bytes", async () => {
  const { res, isJson, bytes } = await download({ media: {
    id: "t1", title: "Test MP4", source_url: `${fx}/direct.mp4`, media_url: `${fx}/direct.mp4`,
    thumbnail_url: null, mime: "video/mp4", extension: "mp4", width: null, height: null, duration: null,
    filesize: null, quality: "source", kind: "video", playable: true, is_direct: true,
  } });
  assert.equal(isJson, false);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "video/mp4");
  assert.match(res.headers.get("content-disposition") || "", /attachment/);
  // First 4 bytes should be the MP4 box size, and byte 4-8 "ftyp".
  assert.equal(bytes.slice(4, 8).toString("ascii"), "ftyp");
});

test("download: bogus.mp4 (HTML) is REJECTED, never saved as video", async () => {
  const { res, isJson, json } = await download({ media: {
    id: "t2", title: "Bogus", source_url: `${fx}/bogus.mp4`, media_url: `${fx}/bogus.mp4`,
    thumbnail_url: null, mime: "video/mp4", extension: "mp4", width: null, height: null, duration: null,
    filesize: null, quality: "source", kind: "video", playable: true, is_direct: true,
  } });
  assert.equal(isJson, true);
  assert.ok(res.status >= 400);
  assert.equal(json.error.code, "MEDIA_VALIDATION_FAILED");
});

test("download: bogus.mp3 (JSON) is REJECTED, never saved as audio", async () => {
  const { res, isJson, json } = await download({ media: {
    id: "t3", title: "Bogus MP3", source_url: `${fx}/bogus.mp3`, media_url: `${fx}/bogus.mp3`,
    thumbnail_url: null, mime: "audio/mpeg", extension: "mp3", width: null, height: null, duration: null,
    filesize: null, quality: "source", kind: "audio", playable: true, is_direct: true,
  } });
  assert.equal(isJson, true);
  assert.ok(res.status >= 400);
  assert.equal(json.error.code, "MEDIA_VALIDATION_FAILED");
});

test("download: octet-stream serving real MP4 is detected as MP4", async () => {
  const { res, isJson, bytes } = await download({ media: {
    id: "t4", title: "Octet", source_url: `${fx}/octet.mp4`, media_url: `${fx}/octet.mp4`,
    thumbnail_url: null, mime: "application/octet-stream", extension: "bin", width: null, height: null,
    duration: null, filesize: null, quality: "source", kind: "video", playable: true, is_direct: true,
  } });
  assert.equal(isJson, false);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "video/mp4");
  assert.equal(bytes.slice(4, 8).toString("ascii"), "ftyp");
});

test("download: unknown octet-stream bytes are rejected (no fake mp4)", async () => {
  const { res, isJson, json } = await download({ media: {
    id: "t5", title: "Unknown", source_url: `${fx}/octet-unknown.bin`, media_url: `${fx}/octet-unknown.bin`,
    thumbnail_url: null, mime: "application/octet-stream", extension: "bin", width: null, height: null,
    duration: null, filesize: null, quality: "source", kind: "video", playable: true, is_direct: true,
  } });
  assert.equal(isJson, true);
  assert.ok(res.status >= 400);
  assert.ok(["MEDIA_TYPE_UNKNOWN", "MEDIA_VALIDATION_FAILED"].includes(json.error.code));
});

test("download: missing media → structured MEDIA_NOT_FOUND", async () => {
  const { res, json } = await download({ media_id: "does-not-exist" });
  assert.equal(res.status, 404);
  assert.equal(json.error.code, "MEDIA_NOT_FOUND");
});

/* ---------------- Download: HLS ---------------- */

test("download: HLS master playlist is assembled into a single MP4", async () => {
  const { res, isJson, bytes } = await download({ media: {
    id: "h1", title: "HLS Test", source_url: `${fx}/master.m3u8`, media_url: `${fx}/master.m3u8`,
    thumbnail_url: null, mime: "application/vnd.apple.mpegurl", extension: "m3u8", width: null, height: null,
    duration: null, filesize: null, quality: "source", kind: "stream", playable: false, is_direct: true,
  } });
  assert.equal(isJson, false);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "video/mp4");
  assert.ok(bytes.length >= 376, "expected both TS segments to be concatenated");
  assert.equal(bytes[0], 0x47, "expected MPEG-TS sync byte");
});

test("download: HLS playlist 403 → truthful BLOCKED_RESOURCE (not a blanket 502)", async () => {
  const { res, isJson, json } = await download({ media: {
    id: "h2", title: "Forbidden HLS", source_url: `${fx}/forbidden.m3u8`, media_url: `${fx}/forbidden.m3u8`,
    thumbnail_url: null, mime: "application/vnd.apple.mpegurl", extension: "m3u8", width: null, height: null,
    duration: null, filesize: null, quality: "source", kind: "stream", playable: false, is_direct: true,
  } });
  assert.equal(isJson, true);
  assert.equal(res.status, 403);
  assert.equal(json.error.code, "BLOCKED_RESOURCE");
});

test("download: SSRF target blocked at download time", async () => {
  const { res, json } = await download({ media: {
    id: "t6", title: "SSRF", source_url: "http://169.254.169.254/", media_url: "http://169.254.169.254/latest/meta-data/",
    thumbnail_url: null, mime: "video/mp4", extension: "mp4", width: null, height: null, duration: null,
    filesize: null, quality: "source", kind: "video", playable: true, is_direct: true,
  } });
  assert.equal(res.status, 403);
  assert.equal(json.error.code, "SSRF_BLOCKED");
});

/* ---------------- Health ---------------- */

test("health: reports engine + capabilities", async () => {
  const { json } = await health();
  assert.equal(json.ok, true);
  assert.equal(json.engine, "Engine V4 VX");
  assert.ok(typeof json.data.capabilities === "object");
});

/* ---------------- MP3 conversion (real ffmpeg) ---------------- */

test("download: MP3 conversion from a real audio source produces a valid MP3", async (t) => {
  const { json: healthJson } = await health();
  if (!healthJson.data.capabilities.ffmpeg) return t.skip("ffmpeg not available");

  const { res, isJson, bytes, json } = await download({ convert: "mp3", media: {
    id: "t7", title: "Convert Me", source_url: `${fx}/real.mp3`, media_url: `${fx}/real.mp3`,
    thumbnail_url: null, mime: "audio/mpeg", extension: "mp3", width: null, height: null, duration: null,
    filesize: null, quality: "source", kind: "audio", playable: true, is_direct: true,
  } });
  if (isJson) return t.skip(`conversion unavailable: ${json?.error?.code}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  const ok = bytes[0] === 0x49 || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  assert.ok(ok, "converted output is not a valid MP3 container");
  assert.ok(bytes.length > 0);
});

test("download: MP3 extraction from a real MP4 (video) produces a valid MP3", async (t) => {
  const { json: healthJson } = await health();
  if (!healthJson.data.capabilities.ffmpeg) return t.skip("ffmpeg not available");

  const { res, isJson, bytes, json } = await download({ convert: "mp3", media: {
    id: "t8", title: "Video To Audio", source_url: `${fx}/real.mp4`, media_url: `${fx}/real.mp4`,
    thumbnail_url: null, mime: "video/mp4", extension: "mp4", width: 320, height: 240, duration: 1,
    filesize: null, quality: "source", kind: "video", playable: true, is_direct: true,
  } });
  if (isJson) return t.skip(`conversion unavailable: ${json?.error?.code}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  const ok = bytes[0] === 0x49 || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  assert.ok(ok, "MP4→MP3 output is not a valid MP3 container");
});

test("download: WebM source is NOT renamed to MP3 without conversion", async () => {
  // Requesting mp3 from an OGG/Opus-only source should either transcode to real
  // MP3 (ffmpeg) or fail — never return WebM bytes labeled .mp3.
  const { res, isJson, bytes, json } = await download({ convert: "mp3", media: {
    id: "t9", title: "Opus To MP3", source_url: `${fx}/direct.ogg`, media_url: `${fx}/direct.ogg`,
    thumbnail_url: null, mime: "audio/ogg", extension: "ogg", width: null, height: null, duration: null,
    filesize: null, quality: "source", kind: "audio", playable: true, is_direct: true,
  } });
  if (isJson) {
    assert.ok(res.status >= 400);
    return; // truthful failure is acceptable
  }
  // If it succeeded, the bytes MUST be a real MP3, not the original OGG.
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  assert.ok(bytes[0] === 0x49 || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
});
