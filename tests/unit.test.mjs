/**
 * ENGINE V4 VX - Unit Tests (pure modules)
 * Covers: URL normalization, SSRF guard, magic-byte sniffing.
 *
 * Node's built-in test runner. Run: node --test tests/unit.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { transpileDir } from "./transpile.mjs";

transpileDir("lib/engine-v4-vx");

const { UrlNormalizer } = await import("../lib/engine-v4-vx/normalize.vxtest.mjs");
const { SecurityGuard } = await import("../lib/engine-v4-vx/guard.vxtest.mjs");
const { MediaSniffer } = await import("../lib/engine-v4-vx/sniff.vxtest.mjs");
const { MediaValidator } = await import("../lib/engine-v4-vx/validator.vxtest.mjs");
const { MissavExtractor } = await import("../lib/engine-v4-vx/extractors/missav.vxtest.mjs");
const { MISSVAV_HTML, REAL_UUID, DECOY_UUID } = await import("./fixtures/missav-packed.mjs");

/* ---------------- URL normalization ---------------- */

test("normalize: adds https to bare host", () => {
  const r = UrlNormalizer.normalize("example.com/watch");
  assert.equal(r.ok, true);
  assert.equal(r.url, "https://example.com/watch");
});

test("normalize: keeps https and strips fragment", () => {
  const r = UrlNormalizer.normalize("https://example.com/v.mp4#t=10");
  assert.equal(r.ok, true);
  assert.equal(r.url, "https://example.com/v.mp4");
});

test("normalize: rejects javascript: scheme", () => {
  const r = UrlNormalizer.normalize("javascript:alert(1)");
  assert.equal(r.ok, false);
});

test("normalize: rejects whitespace injection", () => {
  const r = UrlNormalizer.normalize("https://evil.com/\nhost: 127.0.0.1");
  assert.equal(r.ok, false);
});

test("normalize: rejects empty", () => {
  assert.equal(UrlNormalizer.normalize("   ").ok, false);
});

test("normalize: allows explicit localhost for SSRF layer to handle", () => {
  const r = UrlNormalizer.normalize("http://localhost:3000/x");
  assert.equal(r.ok, true);
});

/* ---------------- SSRF guard ---------------- */

const blocked = [
  "http://localhost/",
  "http://127.0.0.1/",
  "http://127.1.2.3/",
  "http://0.0.0.0/",
  "http://[::1]/",
  "http://10.0.0.5/",
  "http://172.16.0.1/",
  "http://192.168.1.1/",
  "http://169.254.169.254/latest/meta-data/",
  "http://100.100.100.200/",
  "http://metadata.google.internal/",
  "http://2130706433/", // decimal 127.0.0.1
  "http://0x7f.0.0.1/", // hex 127.0.0.1
  "http://foo.internal/",
  "http://service.local/",
  "http://[fe80::1]/",
  "http://[fd00::1]/",
];

for (const u of blocked) {
  test(`SSRF: blocks ${u}`, () => {
    const r = SecurityGuard.isUrlSafe(u);
    assert.equal(r.safe, false, `expected ${u} to be blocked`);
  });
}

const allowed = [
  "https://example.com/",
  "https://www.youtube.com/watch?v=x",
  "https://203.0.113.10/media.mp4", // TEST-NET-3 is actually reserved; keep as public-shaped but ensure our logic
  "https://8.8.8.8/",
  "https://cdn.example.co.uk/a.mp4",
];

for (const u of allowed.slice(0, 2).concat(allowed.slice(3))) {
  test(`SSRF: allows ${u}`, () => {
    const r = SecurityGuard.isUrlSafe(u);
    assert.equal(r.safe, true, `expected ${u} to be allowed`);
  });
}

test("SSRF: non-http protocol rejected", () => {
  assert.equal(SecurityGuard.isUrlSafe("ftp://example.com").safe, false);
});

/* ---------------- Magic-byte sniffing ---------------- */

function buf(bytes) {
  return Buffer.from(bytes);
}

test("sniff: MP4 (ftyp)", () => {
  const r = MediaSniffer.sniff(Buffer.concat([buf([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(8)]));
  assert.equal(r.format, "mp4");
  assert.equal(r.mime, "video/mp4");
});

test("sniff: M4A audio brand", () => {
  const r = MediaSniffer.sniff(Buffer.concat([buf([0, 0, 0, 0x18]), Buffer.from("ftypM4A "), Buffer.alloc(8)]));
  assert.equal(r.format, "m4a");
  assert.equal(r.mime, "audio/mp4");
});

test("sniff: WebM (EBML + docType)", () => {
  const r = MediaSniffer.sniff(Buffer.concat([buf([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("webm"), Buffer.alloc(8)]));
  assert.equal(r.format, "webm");
});

test("sniff: Matroska", () => {
  const r = MediaSniffer.sniff(Buffer.concat([buf([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("matroska"), Buffer.alloc(8)]));
  assert.equal(r.format, "mkv");
});

test("sniff: MP3 ID3", () => {
  const r = MediaSniffer.sniff(buf([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00]));
  assert.equal(r.format, "mp3");
});

test("sniff: OGG Opus", () => {
  const r = MediaSniffer.sniff(Buffer.concat([Buffer.from("OggS"), Buffer.from("OpusHead"), Buffer.alloc(8)]));
  assert.equal(r.format, "ogg");
});

test("sniff: WAV", () => {
  const r = MediaSniffer.sniff(Buffer.concat([Buffer.from("RIFF"), buf([0, 0, 0, 0]), Buffer.from("WAVE")]));
  assert.equal(r.format, "wav");
});

test("sniff: HTML is flagged, not media", () => {
  const r = MediaSniffer.sniff(Buffer.from("<!DOCTYPE html><html></html>"));
  assert.equal(r.isHtmlOrJson, true);
  assert.equal(MediaSniffer.isKnownMedia(r.format), false);
});

test("sniff: JSON payload is flagged", () => {
  const r = MediaSniffer.sniff(Buffer.from('{"error":"nope","code":429}'));
  assert.equal(r.isHtmlOrJson, true);
});

test("sniff: HLS playlist detected", () => {
  const r = MediaSniffer.sniff(Buffer.from("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nseg.ts"));
  assert.equal(r.format, "m3u8");
  assert.equal(r.kind, "stream");
});

/* ---------------- validateChunk wrapper ---------------- */

test("validator: rejects HTML chunk", () => {
  const r = MediaValidator.validateChunk(Buffer.from("<html><body>oops</body></html>"));
  assert.equal(r.valid, false);
  assert.equal(r.isHtmlOrJson, true);
});

test("validator: accepts MP4 chunk with real type", () => {
  const r = MediaValidator.validateChunk(Buffer.concat([buf([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(8)]));
  assert.equal(r.valid, true);
  assert.equal(r.mime, "video/mp4");
});

test("validator: container mismatch detected (WebM expected as mp3)", () => {
  const bufWebm = Buffer.concat([buf([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("webm"), Buffer.alloc(8)]);
  const r = MediaValidator.validateBuffer(bufWebm, "mp3");
  assert.equal(r.valid, false);
  assert.match(r.reason, /CONTAINER_MISMATCH/);
});

test("validator: empty buffer rejected", () => {
  assert.equal(MediaValidator.validateBuffer(Buffer.alloc(0)).valid, false);
});

/* ---------------- MissAV packed-player extraction ---------------- */

test("missav: decodes the packed player and reads the REAL surrit URLs", () => {
  const decoded = MissavExtractor.decodeDocument(MISSVAV_HTML);
  const urls = MissavExtractor.surritUrls(decoded);
  assert.ok(urls.length >= 1, "expected at least one surrit URL");
  assert.ok(
    urls.some((u) => u.includes(REAL_UUID) && u.endsWith("/playlist.m3u8")),
    `expected playlist URL with real uuid, got: ${JSON.stringify(urls)}`,
  );
  assert.ok(
    urls.some((u) => u.includes("/1080p/video.m3u8")),
    "expected 1080p variant URL",
  );
});

test("missav: never uses the decoy page uuid (user_uuid cookie)", () => {
  const decoded = MissavExtractor.decodeDocument(MISSVAV_HTML);
  const urls = MissavExtractor.surritUrls(decoded);
  assert.ok(!urls.some((u) => u.includes(DECOY_UUID)), "decoy uuid leaked into stream URLs");
  assert.equal(MissavExtractor.surritUuid(decoded), REAL_UUID);
  // Sanity: the decoy really is present in the raw HTML, so this is a real guard.
  assert.ok(MISSVAV_HTML.includes(DECOY_UUID));
});
