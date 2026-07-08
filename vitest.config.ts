import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const reviewSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "apps/review/src");
const coreServices = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src/services");
const coreDomain = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src/domain");

export default defineConfig({
  resolve: {
    alias: {
      "@": reviewSrc,
      "@caf-core-carousel/mimic-copy-slots": path.join(coreServices, "mimic-copy-slots.ts"),
      "@caf-core-carousel/mimic-template-bg-copy": path.join(coreDomain, "mimic-template-bg-copy.ts"),
      "@caf-core-carousel/slide-copy-lines": path.join(coreDomain, "slide-copy-lines.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "services/renderer/**/*.test.ts", "apps/review/src/**/*.test.ts"],
  },
});