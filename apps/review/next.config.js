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
    for (const mod of ["carousel-render-pack", "mimic-slide-typography", "mimic-prompt-builder", "mimic-copy-slots"]) {
      config.resolve.alias[`@caf-core-carousel/${mod}`] = path.join(coreServices, `${mod}.ts`);
    }
    config.resolve.alias["@caf-core-carousel/mimic-docai-layer-positions"] = path.join(
      coreDomain,
      "mimic-docai-layer-positions.ts"
    );
    config.resolve.alias["@caf-core-carousel/mimic-template-bg-copy"] = path.join(
      coreDomain,
      "mimic-template-bg-copy.ts"
    );
    config.resolve.alias["@caf-core-carousel/slide-copy-lines"] = path.join(
      coreDomain,
      "slide-copy-lines.ts"
    );
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^\.\/supabase-storage\.js$/, path.join(coreServices, "supabase-storage.ts")),
      new webpack.NormalModuleReplacementPlugin(
        /^\.\/mimic-docai-overlay-layout\.js$/,
        path.join(coreServices, "mimic-docai-overlay-layout.ts")
      ),
      new webpack.NormalModuleReplacementPlugin(
        /^\.\/mimic-copy-slots\.js$/,
        path.join(coreServices, "mimic-copy-slots.ts")
      ),
      new webpack.NormalModuleReplacementPlugin(
        /^\.\/mimic-semantic-copy-units\.js$/,
        path.join(coreServices, "mimic-semantic-copy-units.ts")
      ),
      new webpack.NormalModuleReplacementPlugin(
        /^\.\/instagram-handle\.js$/,
        path.join(coreDomain, "instagram-handle.ts")
      ),
      new webpack.NormalModuleReplacementPlugin(
        /^\.\/slide-copy-lines\.js$/,
        path.join(coreDomain, "slide-copy-lines.ts")
      ),
      new webpack.NormalModuleReplacementPlugin(/^\.\.\/domain\/(.+)\.js$/, (resource) => {
        const base = resource.request.match(/^\.\.\/domain\/(.+)\.js$/)?.[1];
        if (base) resource.request = path.join(coreDomain, `${base}.ts`);
      })
    );
    return config;
  },
};
module.exports = nextConfig;
