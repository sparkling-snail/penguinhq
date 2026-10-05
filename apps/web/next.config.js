/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // PixiJS touches `window`/WebGL at module load in some sub-deps; keep it
  // out of the server bundle entirely rather than fighting SSR for it.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    return config;
  },
};

module.exports = nextConfig;
