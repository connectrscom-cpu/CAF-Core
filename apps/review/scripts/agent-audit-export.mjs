#!/usr/bin/env node
/**
 * Generate CAF_REVIEW_AGENT_AUDIT_CONTEXT.md from agent inspection APIs.
 * Usage: AGENT_BASE_URL=http://localhost:3000 npm run agent:audit-export
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_ROOT = path.resolve(__dirname, "..");
const ARTIFACTS_DIR = path.resolve(REVIEW_ROOT, "agent-artifacts");

const BASE_URL = (process.env.AGENT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = (process.env.AGENT_INSPECTION_TOKEN ?? "").trim();

async function fetchJson(pathname) {
  const headers = TOKEN ? { "x-agent-inspection-token": TOKEN } : {};
  const res = await fetch(`${BASE_URL}${pathname}`, { headers });
  if (!res.ok) {
    throw new Error(`${pathname} returned ${res.status}`);
  }
  return res.json();
}

function mdList(items) {
  if (!items?.length) return "- (none)";
  return items.map((item) => `- ${item}`).join("\n");
}

async function main() {
  await mkdir(ARTIFACTS_DIR, { recursive: true });

  let snapshot;
  let copyInventory;
  let technicalTerms;

  try {
    [snapshot, copyInventory, technicalTerms] = await Promise.all([
      fetchJson("/api/agent/snapshot"),
      fetchJson("/api/agent/copy-inventory"),
      fetchJson("/api/agent/technical-terms"),
    ]);
  } catch (err) {
    console.error(
      `Failed to fetch agent APIs from ${BASE_URL}. Ensure the Review app is running with AGENT_INSPECTION_ENABLED=true.\n`,
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }

  const brand = snapshot.current_brand;
  const dashboard = snapshot.dashboard_example;
  const terms = technicalTerms.technical_terms_visible ?? [];

  let screenshotIndex = null;
  try {
    const raw = await readFile(path.join(ARTIFACTS_DIR, "index.json"), "utf8");
    screenshotIndex = JSON.parse(raw);
  } catch {
    // optional
  }

  const pageSummaries = [];
  const paths = brand
    ? [
        `/brand/${brand.slug}`,
        `/brand/${brand.slug}/profile`,
        `/brand/${brand.slug}/research`,
        `/brand/${brand.slug}/intelligence`,
        `/brand/${brand.slug}/ideas`,
        `/brand/${brand.slug}/content`,
        `/brand/${brand.slug}/publishing`,
        `/brand/${brand.slug}/performance`,
      ]
    : ["/workspace"];

  for (const p of paths) {
    try {
      const page = await fetchJson(`/api/agent/page?path=${encodeURIComponent(p)}`);
      pageSummaries.push(page);
    } catch {
      pageSummaries.push({ path: p, error: "Could not load page descriptor" });
    }
  }

  const generatedAt = new Date().toISOString();

  const lines = [
    "# CAF Review Agent Audit Context",
    "",
    `Generated: ${generatedAt}`,
    `Base URL: ${BASE_URL}`,
    `Data source: ${snapshot.data_source ?? "unknown"}`,
    "",
    "## App purpose",
    "CAF Review is the marketer-facing workspace for CAF — manage brands, review content, and publish.",
    "",
    "## Inspection mode",
    `- Enabled: ${snapshot.inspection_mode ? "yes" : "no"}`,
    `- Agent map: ${BASE_URL}/agent-map`,
    "",
    "## Current known brand",
    brand ? `${brand.display_label} (\`${brand.slug}\`)` : "No brand loaded from Core API.",
    "",
  ];

  if (dashboard) {
    lines.push(
      "## Current dashboard state",
      ...dashboard.overview_metrics.map((m) => `- ${m.label}: ${m.value}`),
      "",
      "### Recommended next steps",
      ...dashboard.recommended_next_steps.map((s) => `- ${s.label} — ${s.description} (${s.href})`),
      "",
      "### Pipeline status",
      ...dashboard.pipeline_status.map((p) => `- ${p.label}: ${p.status}`),
      ""
    );
  }

  lines.push(
    "## Main navigation",
    mdList(copyInventory.sidebar_labels),
    "",
    "## Dashboard labels",
    mdList(copyInventory.dashboard_labels),
    "",
    "## Technical terms visible",
    terms.length === 0
      ? "None found in static copy inventory."
      : terms.map((t) => `- **${t.term}** in ${t.where}: ${t.recommendation}`).join("\n"),
    "",
    "## Page summaries"
  );

  for (const page of pageSummaries) {
    lines.push(
      "",
      `### ${page.path}`,
      `- Title: ${page.page_title ?? "—"}`,
      page.primary_user_goal ? `- Goal: ${page.primary_user_goal}` : "",
      page.implementation_status ? `- Status: ${page.implementation_status}` : "",
      page.visible_sections?.length ? `- Sections: ${page.visible_sections.join(", ")}` : "",
      page.notes ? `- Notes: ${page.notes}` : ""
    );
  }

  lines.push(
    "",
    "## Route map",
    ...(snapshot.route_descriptions ?? []).map((r) => `- \`${r.path}\` — ${r.description}`),
    "",
    "## Known brands",
    ...(snapshot.brands ?? []).map((b) => `- ${b.display_label} (\`${b.slug}\`) — ${b.href}`),
    "",
    "## Screenshots",
    screenshotIndex
      ? `See \`agent-artifacts/screenshots/\` (${screenshotIndex.screenshots?.length ?? 0} captures from ${screenshotIndex.generated_at}).`
      : "No screenshot index found. Run `npm run agent:screenshots` first.",
    "",
    "## Known limitations",
    "- Agent endpoints return 404 when inspection mode is disabled (unless AGENT_INSPECTION_TOKEN is set).",
    "- Screenshot script defaults to `/brand/SNS` routes; adjust ROUTES in scripts if your primary brand differs.",
    "- Performance page is stubbed; operator tools require `?debug=1`.",
    "- This export does not include secrets, raw API tokens, or database dumps.",
    ""
  );

  const outPath = path.join(ARTIFACTS_DIR, "CAF_REVIEW_AGENT_AUDIT_CONTEXT.md");
  await writeFile(outPath, lines.filter((l) => l !== "").join("\n") + "\n", "utf8");
  console.log(`Wrote ${path.relative(REVIEW_ROOT, outPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
