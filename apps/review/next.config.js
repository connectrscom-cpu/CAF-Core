const path = require("path");
const webpack = require("webpack");

const coreServices = path.join(__dirname, "..", "..", "src", "services");
const coreDomain = path.join(__dirname, "..", "..", "src", "domain");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  /** Allow importing CAF Core carousel pack from repo `src/services` (live slide preview API). */
  experimental: { externalDir: true },
  webpack: (config) => {
    for (const mod of ["carousel-render-pack", "mimic-slide-typography", "mimic-prompt-builder"]) {
      config.resolve.alias[`@caf-core-carousel/${mod}`] = path.join(coreServices, `${mod}.ts`);
    }
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^\.\/supabase-storage\.js$/, path.join(coreServices, "supabase-storage.ts")),
      new webpack.NormalModuleReplacementPlugin(/^\.\.\/domain\/(.+)\.js$/, (resource) => {
        const base = resource.request.match(/^\.\.\/domain\/(.+)\.js$/)?.[1];
        if (base) resource.request = path.join(coreDomain, `${base}.ts`);
      })
    );
    return config;
  },
};
module.exports = nextConfig;
