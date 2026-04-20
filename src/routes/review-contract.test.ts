/**
 * Review app contract smoke tests.
 *
 * The Review UI (`apps/review/src/lib/caf-core-client.ts`) calls a specific
 * set of `/v1/...` HTTP paths on Core. Breaking any of them is a P0 for
 * operators. These tests are static on purpose: they assert that each path
 * the Review client uses still has a matching Fastify registration somewhere
 * under `src/routes/`.
 *
 * This catches accidental renames, moved-then-forgotten routes, and typos in
 * CI without requiring a running server or a Postgres instance.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const routesDir = resolve(here, ".");

function readAllRouteFiles(): string {
  const files = readdirSync(routesDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  return files.map((f) => readFileSync(join(routesDir, f), "utf8")).join("\n\n");
}

const allRouteSource = readAllRouteFiles();

/**
 * Each entry is a Fastify path template the Review client hits. The tests
 * assert the literal string appears as a registered route. Parameter names
 * here must match the names declared in the route file.
 */
const REVIEW_CRITICAL_PATHS: string[] = [
  "/v1/review-queue/:project_slug/counts",
  "/v1/review-queue-all/counts",
  "/v1/review-queue/:project_slug/:tab",
  "/v1/review-queue-all/:tab",
  "/v1/review-queue/:project_slug/facets",
  "/v1/review-queue-all/facets",
  "/v1/projects",
  "/v1/projects/:project_slug",
  "/v1/projects/:project_slug/profile",
  "/v1/projects/:project_slug/strategy",
  "/v1/projects/:project_slug/brand",
  "/v1/projects/:project_slug/constraints",
  "/v1/projects/:project_slug/platforms",
  "/v1/projects/:project_slug/risk-rules",
  "/v1/projects/:project_slug/risk-qc-status",
  "/v1/learning/:project_slug/rules",
  "/v1/learning/:project_slug/context-preview",
  "/v1/publications/:project_slug",
];

describe("Review app contract (static)", () => {
  for (const path of REVIEW_CRITICAL_PATHS) {
    it(`route is still registered: ${path}`, () => {
      const quoted = `"${path}"`;
      expect(
        allRouteSource.includes(quoted),
        `expected to find a route registration for \`${path}\` under src/routes/*.ts`
      ).toBe(true);
    });
  }
});

describe("Review app client references are still valid paths", () => {
  it("every :param appears with a consistent leading colon", () => {
    for (const p of REVIEW_CRITICAL_PATHS) {
      const parts = p.split("/").filter(Boolean);
      for (const seg of parts) {
        if (seg.startsWith(":")) {
          expect(seg.length).toBeGreaterThan(1);
          expect(seg.slice(1)).toMatch(/^[a-z_]+$/);
        }
      }
    }
  });
});

// Guard against silently dropping this list.
void statSync;
