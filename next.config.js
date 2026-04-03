/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow large payloads for telemetry ingestion
  experimental: {
    serverComponentsExternalPackages: [],
  },
};

module.exports = nextConfig;
