/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  generateBuildId: async () => `vx-${Date.now()}`,
  // The media engine needs native tools (yt-dlp, ffmpeg) and a non-datacenter
  // egress IP, so it runs on a VPS/Docker host. When VX_API_BASE is set, the
  // Vercel front-end transparently proxies every /api/* call to that backend.
  // If it is unset (e.g. self-hosting the whole app on the VPS), the local API
  // routes are used directly.
  async rewrites() {
    const backend = process.env.VX_API_BASE?.replace(/\/+$/, "");
    if (!backend) return [];
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/health", destination: `${backend}/api/health` },
    ];
  },
};

export default nextConfig;
