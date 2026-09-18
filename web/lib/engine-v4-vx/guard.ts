/**
 * Engine V4 VX - Security Guard (SSRF Protection)
 */

export class SecurityGuard {
  private static PRIVATE_HOSTS = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "0:0:0:0:0:0:0:1",
    "169.254.169.254", // AWS/GCP/Azure instance metadata
    "metadata.google.internal",
    "instance-data",
  ]);

  /**
   * Validate destination URL against SSRF and private networks
   */
  public static isUrlSafe(urlStr: string): { safe: boolean; reason?: string; parsed?: URL } {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { safe: false, reason: "INVALID_URL" };
    }

    // Protocol check
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safe: false, reason: "INVALID_PROTOCOL" };
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").trim();

    // Check exact blacklisted hosts
    if (this.PRIVATE_HOSTS.has(hostname)) {
      return { safe: false, reason: "SSRF_BLOCKED" };
    }

    // Check domain suffixes
    if (
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".lan") ||
      hostname.endsWith(".home.arpa")
    ) {
      return { safe: false, reason: "SSRF_BLOCKED" };
    }

    // Check IPv4 private and reserved address blocks
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    if (ipv4) {
      const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
      if (a === 0) return { safe: false, reason: "SSRF_BLOCKED" }; // 0.0.0.0/8
      if (a === 10) return { safe: false, reason: "SSRF_BLOCKED" }; // 10.0.0.0/8
      if (a === 127) return { safe: false, reason: "SSRF_BLOCKED" }; // 127.0.0.0/8
      if (a === 100 && b >= 64 && b <= 127) return { safe: false, reason: "SSRF_BLOCKED" }; // 100.64.0.0/10 Carrier-grade NAT
      if (a === 169 && b === 254) return { safe: false, reason: "SSRF_BLOCKED" }; // 169.254.0.0/16 Link-local
      if (a === 172 && b >= 16 && b <= 31) return { safe: false, reason: "SSRF_BLOCKED" }; // 172.16.0.0/12
      if (a === 192 && b === 168) return { safe: false, reason: "SSRF_BLOCKED" }; // 192.168.0.0/16
      if (a === 198 && (b === 18 || b === 19)) return { safe: false, reason: "SSRF_BLOCKED" }; // 198.18.0.0/15
      if (a >= 224) return { safe: false, reason: "SSRF_BLOCKED" }; // Multicast & Reserved
    }

    // Check IPv6 loopback / unique local / link-local
    if (
      hostname.startsWith("fe80:") ||
      hostname.startsWith("fc00:") ||
      hostname.startsWith("fd00:") ||
      hostname.startsWith("::ffff:127.") ||
      hostname.startsWith("::ffff:10.") ||
      hostname.startsWith("::ffff:192.168.")
    ) {
      return { safe: false, reason: "SSRF_BLOCKED" };
    }

    return { safe: true, parsed };
  }
}
