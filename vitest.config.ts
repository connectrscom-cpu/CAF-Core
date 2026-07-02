import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const reviewSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "apps/review/src");

export default defineConfig({
  resolve: {
    alias: {
      "@": reviewSrc,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "services/renderer/**/*.test.ts", "apps/review/src/**/*.test.ts"],
  },
});