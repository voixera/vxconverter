/**
 * ENGINE V4 VX - Security Guard (SSRF Protection)
 *
 * Validates the INITIAL url and EVERY redirect hop before the server follows it.
 * Blocks loopback, private, link-local, CGNAT, multicast, metadata endpoints and
 * internal hostnames. Handles IPv6 (including IPv4-mapped) and decimal/hex/octal
 * IPv4 obfuscation.
 */

export type GuardReason =
  | "INVALID_URL"
  | "INVALID_PROTOCOL"
  | "EMPTY_HOST"
  | "SSRF_BLOCKED";

export interface GuardResult {
  safe: boolean;
  reason?: GuardReason;
  parsed?: URL;
}

export class SecurityGuard {
  /** Exact hostnames that must never be fetched. */
  private static readonly BLOCKED_HOSTS = new Set([
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata",
    "metadata.google.internal",
    "metadata.goog",
    "instance-data",
    "instance-data.ec2.internal",
  ]);

  /** Cloud metadata / infrastructure endpoints (host or IP). */
  private static readonly BLOCKED_IPS = new Set([
    "169.254.169.254", // AWS/GCP/Azure/Oracle metadata
    "169.254.170.2", // AWS ECS task metadata
    "100.100.100.200", // Alibaba Cloud metadata
    "fd00:ec2::254", // AWS IPv6 metadata
  ]);

  private static readonly BLOCKED_SUFFIXES = [
    ".local",
    ".internal",
    ".localhost",
    ".lan",
    ".home.arpa",
    ".corp",
    ".intranet",
    ".private",
  ];

  /**
   * Validate a URL string for SSRF safety. Does NOT perform DNS resolution —
   * this runs at every hop; the fetcher additionally verifies the resolved
   * address set is public before connecting.
   */
  public static isUrlSafe(urlStr: string): GuardResult {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { safe: false, reason: "INVALID_URL" };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safe: false, reason: "INVALID_PROTOCOL" };
    }

    // Strip brackets from IPv6 literal hostnames.
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").trim();
    if (!hostname) {
      return { safe: false, reason: "EMPTY_HOST" };
    }

    if (this.BLOCKED_HOSTS.has(hostname) || this.BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
      const testEscape = process.env.VX_ALLOW_TEST_HOSTS === "1" && hostname === "127.0.0.1";
      if (!testEscape) return { safe: false, reason: "SSRF_BLOCKED" };
    }

    if (this.BLOCKED_IPS.has(hostname)) {
      return { safe: false, reason: "SSRF_BLOCKED" };
    }

    const ipv4 = this.parseIpv4(hostname);
    if (ipv4) {
      if (!this.isPublicIpv4(ipv4)) return { safe: false, reason: "SSRF_BLOCKED" };
    } else if (this.looksLikeIp(hostname)) {
      // IPv6 literal (contains ':').
      if (!this.isPublicIpv6(hostname)) return { safe: false, reason: "SSRF_BLOCKED" };
    }

    return { safe: true, parsed };
  }

  /**
   * Parse an IPv4 string supporting dotted-quad plus decimal / octal / hex
   * obfuscation (e.g. 2130706433, 0x7f.0.0.1, 0177.0.0.1).
   */
  public static parseIpv4(host: string): number[] | null {
    // Strip IPv4-mapped IPv6 prefix.
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
    if (mapped) host = mapped[1];

    const parts = host.split(".");
    if (parts.length !== 4) {
      // Single-integer form: 2130706433
      if (/^\d+$/.test(host)) {
        const n = Number(host);
        if (n >= 0 && n <= 0xffffffff) {
          return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
        }
      }
      return null;
    }

    const out: number[] = [];
    for (const p of parts) {
      let v: number;
      if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p, 16);
      else if (/^0[0-7]+$/.test(p)) v = parseInt(p, 8);
      else if (/^\d+$/.test(p)) v = parseInt(p, 10);
      else return null;
      if (v < 0 || v > 255 || Number.isNaN(v)) return null;
      out.push(v);
    }
    return out;
  }

  private static isPublicIpv4(ip: number[]): boolean {
    const [a, b, c] = ip;
    // Test-only escape hatch: never enabled in production. Allows the local
    // fixture server in the automated test suite to be fetched.
    if (process.env.VX_ALLOW_TEST_HOSTS === "1") {
      if (a === 127) return true;
    }
    if (a === 0) return false; // 0.0.0.0/8 "this network"
    if (a === 10) return false; // 10/8 private
    if (a === 127) return false; // loopback
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT
    if (a === 169 && b === 254) return false; // link-local
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12
    if (a === 192 && b === 0 && c === 0) return false; // 192.0.0/24 IETF
    if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
    if (a === 192 && b === 168) return false; // 192.168/16
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
    if (a >= 224) return false; // multicast + reserved + broadcast
    return true;
  }

  private static isPublicIpv6(host: string): boolean {
    const h = host.toLowerCase();
    if (h === "::" || h === "::1") return false;
    if (h.startsWith("fe80")) return false; // link-local
    if (h.startsWith("fc") || h.startsWith("fd")) return false; // unique local
    if (h.startsWith("ff")) return false; // multicast
    if (h.startsWith("::ffff:")) {
      const v4 = this.parseIpv4(h);
      return v4 ? this.isPublicIpv4(v4) : false;
    }
    // 6to4 / Teredo embed IPv4 — reject to be safe.
    if (h.startsWith("2002:") || h.startsWith("2001:0:")) return false;
    return true;
  }

  private static looksLikeIp(host: string): boolean {
    return host.includes(":") || this.parseIpv4(host) !== null;
  }
}
