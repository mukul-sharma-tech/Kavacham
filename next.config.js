/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [],
  },
  // Remove the manual webpack alias section unless you have a specific non-standard need
};

module.exports = nextConfig;
