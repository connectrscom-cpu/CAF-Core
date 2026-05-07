const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  /** Allow importing CAF Core carousel pack from repo `src/services` (live slide preview API). */
  experimental: { externalDir: true },
  webpack: (config) => {
    config.resolve.alias["@caf-core-carousel"] = path.join(__dirname, "..", "..", "src", "services");
    return config;
  },
};
module.exports = nextConfig;
