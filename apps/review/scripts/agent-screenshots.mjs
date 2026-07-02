#!/usr/bin/env node
/**
 * Capture marketer workspace screenshots for agent UX audits.
 * Usage: AGENT_BASE_URL=http://localhost:3000 npm run agent:screenshots
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_ROOT = path.resolve(__dirname, "..");
const ARTIFACTS_DIR = path.resolve(REVIEW_ROOT, "agent-artifacts");
const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, "screenshots");

const BASE_URL = (process.env.AGENT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = (process.env.AGENT_INSPECTION_TOKEN ?? "").trim();
const NAV_TIMEOUT_MS = Number(process.env.AGENT_SCREENSHOT_TIMEOUT_MS ?? 45_000);

const ROUTES = [
  { path: "/workspace", file: "workspace.png", title: "Workspace — all brands" },
  { path: "/brand/SNS", file: "brand-SNS-dashboard.png", title: "Sign And Sound dashboard" },
  { path: "/brand/SNS/profile", file: "brand-SNS-profile.png", title: "Sign And Sound — brand profile" },
  { path: "/brand/SNS/research", file: "brand-SNS-research.png", title: "Sign And Sound — research" },
  { path: "/brand/SNS/intelligence", file: "brand-SNS-intelligence.png", title: "Sign And Sound — market intelligence" },
  { path: "/brand/SNS/ideas", file: "brand-SNS-ideas.png", title: "Sign And Sound — ideas" },
  { path: "/brand/SNS/content", file: "brand-SNS-content.png", title: "Sign And Sound — content" },
  { path: "/brand/SNS/publishing", file: "brand-SNS-publishing.png", title: "Sign And Sound — publishing" },
  { path: "/brand/SNS/performance", file: "brand-SNS-performance.png", title: "Sign And Sound — performance" },
];

async function loadPlaywright() {
  try {
    const mod = await import("playwright");
    return mod.chromium;
  } catch {
    console.error(
      "Playwright is not installed. Run: cd apps/review && npm install -D playwright && npx playwright install chromium"
    );
    process.exit(1);
  }
}

async function main() {
  const chromium = await loadPlaywright();
  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  if (TOKEN) {
    await context.setExtraHTTPHeaders({ "x-agent-inspection-token": TOKEN });
  }

  const page = await context.newPage();
  const generatedAt = new Date().toISOString();
  const screenshots = [];

  for (const route of ROUTES) {
    const url = `${BASE_URL}${route.path}`;
    const outPath = path.join(SCREENSHOTS_DIR, route.file);
    const relFile = path.relative(REVIEW_ROOT, outPath).replace(/\\/g, "/");

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
      await page.waitForTimeout(800);
      await page.screenshot({ path: outPath, fullPage: true });
      screenshots.push({
        path: route.path,
        file: relFile,
        title: route.title,
        status: "ok",
      });
      console.log(`✓ ${route.path} → ${relFile}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      screenshots.push({
        path: route.path,
        file: relFile,
        title: route.title,
        status: "failed",
        error: message.includes("Timeout") ? "timeout" : message,
      });
      console.warn(`✗ ${route.path}: ${message}`);
    }
  }

  await browser.close();

  const index = {
    generated_at: generatedAt,
    base_url: BASE_URL,
    screenshots,
  };

  const indexPath = path.join(ARTIFACTS_DIR, "index.json");
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
  console.log(`\nWrote ${path.relative(REVIEW_ROOT, indexPath)}`);

  const failed = screenshots.filter((s) => s.status === "failed").length;
  if (failed > 0) {
    console.warn(`${failed} route(s) failed — see index.json for details.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
