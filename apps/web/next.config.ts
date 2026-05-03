import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'out',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  compress: true,
  productionBrowserSourceMaps: false,
};

export default nextConfig;
