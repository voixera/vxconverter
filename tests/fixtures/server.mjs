/**
 * ENGINE V4 VX - Test Fixture Server
 *
 * A tiny local HTTP server that serves the tricky cases the engine must handle:
 *   /direct.mp4        real MP4 bytes
 *   /direct.mp3        real MP3 bytes
 *   /direct.webm       real WebM (EBML) bytes
 *   /bogus.mp4         HTML masquerading as a video
 *   /bogus.mp3         JSON error masquerading as audio
 *   /octet.mp4         application/octet-stream with real MP4 bytes
 *   /page-video        HTML page with <video src="/direct.mp4">
 *   /page-source       HTML page with <source> tags
 *   /page-og           HTML page with og:video
 *   /page-multi        HTML page with several media links
 *   /page-js-only      HTML page with media only revealed by JS (no static media)
 *   /redirect-404      Redirects to a 404
 *   /redirect-internal Redirects to a private host (SSRF redirect test)
 *   /status-500        Returns 500
 */

import http from "http";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SAMPLE_MP3 = path.join(__dirname, "sample.mp3");
const SAMPLE_MP4 = path.join(__dirname, "sample.mp4");

// Minimal but genuinely valid container headers.
const MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // size + ftyp
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // isom
  0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
]);
const MP3_HEADER = Buffer.concat([Buffer.from("ID3"), Buffer.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])]);
const WEBM_HEADER = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from("webm"), // docType marker
  Buffer.alloc(32, 0x00),
]);
const OGG_HEADER = Buffer.concat([Buffer.from("OggS"), Buffer.from("OpusHead"), Buffer.alloc(32)]);

function pad(buf, size = 4096) {
  return Buffer.concat([buf, Buffer.alloc(Math.max(0, size - buf.length), 0x20)]);
}

export function createFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;

    const send = (status, type, body, extra = {}) => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      res.writeHead(status, { "Content-Type": type, "Content-Length": String(buf.length), ...extra });
      res.end(buf);
    };

    switch (path) {
      case "/direct.mp4":
        return send(200, "video/mp4", pad(MP4_HEADER));
      case "/direct.mp3":
        return send(200, "audio/mpeg", pad(MP3_HEADER));
      case "/real.mp3": {
        try {
          return send(200, "audio/mpeg", fs.readFileSync(SAMPLE_MP3));
        } catch {
          return send(404, "text/html", "<html>no sample</html>");
        }
      }
      case "/real.mp4": {
        try {
          return send(200, "video/mp4", fs.readFileSync(SAMPLE_MP4));
        } catch {
          return send(404, "text/html", "<html>no sample</html>");
        }
      }
      case "/direct.webm":
        return send(200, "video/webm", pad(WEBM_HEADER));
      case "/direct.ogg":
        return send(200, "audio/ogg", pad(OGG_HEADER));
      case "/bogus.mp4":
        // HTML pretending to be an MP4.
        return send(200, "text/html", "<!DOCTYPE html><html><body>Not a video</body></html>");
      case "/bogus.mp3": {
        // JSON error pretending to be audio (and mislabeled content-type).
        const body = JSON.stringify({ error: "rate limited", code: 429 });
        return send(200, "audio/mpeg", body);
      }
      case "/octet.mp4":
        return send(200, "application/octet-stream", pad(MP4_HEADER));
      case "/octet-unknown.bin":
        return send(200, "application/octet-stream", Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));
      case "/page-video":
        return send(
          200,
          "text/html",
          `<!DOCTYPE html><html><head><title>Video Page</title>
           <meta property="og:image" content="/thumb.jpg"></head>
           <body><video src="/direct.mp4" poster="/thumb.jpg"></video></body></html>`,
        );
      case "/page-source":
        return send(
          200,
          "text/html",
          `<!DOCTYPE html><html><head><title>Source Page</title></head><body>
           <video><source src="direct.webm" type="video/webm"><source src="./direct.mp4" type="video/mp4"></video>
           </body></html>`,
        );
      case "/page-og":
        return send(
          200,
          "text/html",
          `<!DOCTYPE html><html><head>
           <meta property="og:title" content="OG Video">
           <meta property="og:video:secure_url" content="https://cdn.example.com/og.mp4">
           <meta property="og:image" content="https://cdn.example.com/poster.jpg">
           </head><body></body></html>`,
        );
      case "/page-multi":
        return send(
          200,
          "text/html",
          `<!DOCTYPE html><html><head><title>Multi</title>
           <meta property="og:video" content="/a.mp4"></head><body>
           <video src="/b.mp4"></video>
           <audio><source src="/c.mp3" type="audio/mpeg"></audio>
           <script>var url = "\\u002Fd.webm"; var x = "https://cdn.example.com/e.m3u8?token=1";</script>
           </body></html>`,
        );
      case "/page-js-only":
        return send(
          200,
          "text/html",
          `<!DOCTYPE html><html><head><title>JS Only</title></head>
           <body><div id="player"></div>
           <script>document.getElementById('player').innerHTML = '<video src="/late.mp4"></video>';</script>
           </body></html>`,
        );
      case "/redirect-404":
        res.writeHead(302, { Location: "/missing.mp4" });
        return res.end();
      case "/redirect-internal":
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      case "/status-500":
        return send(500, "text/html", "<html>Internal error</html>");
      case "/forbidden.m3u8":
        // Public-looking HLS playlist that the CDN refuses (403).
        return send(403, "text/html", "<html>Forbidden</html>");
      case "/master.m3u8":
        return send(
          200,
          "application/vnd.apple.mpegurl",
          "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nv0.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nv1.m3u8\n",
        );
      case "/v1.m3u8":
        return send(200, "application/vnd.apple.mpegurl", "#EXTM3U\n#EXT-X-TARGETDURATION:4\nseg0.ts\nseg1.ts\n");
      case "/seg0.ts":
      case "/seg1.ts": {
        const ts = Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187, 0x00)]);
        return send(200, "video/mp2t", ts);
      }
      case "/missing.mp4":
        return send(404, "text/html", "<html>not found</html>");
      case "/slow":
        // Never responds within a short timeout.
        return; // keep socket open
      default:
        return send(404, "text/html", "<html>not found</html>");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, base: `http://127.0.0.1:${addr.port}` });
    });
  });
}
