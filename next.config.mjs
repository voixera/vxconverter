/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  generateBuildId: async () => `vx-${Date.now()}`,
};

export default nextConfig;
