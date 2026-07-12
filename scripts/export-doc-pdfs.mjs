#!/usr/bin/env node
/**
 * Build topic PDF bundles from existing markdown docs (sources are never modified).
 * Outputs:
 *   docs/export/bundles/<topic>.md   — aggregated markdown per topic
 *   docs/export/pdf/<topic>.pdf      — shareable PDF per topic
 *
 * Usage: node scripts/export-doc-pdfs.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mdToPdf } from "md-to-pdf";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BUNDLES_DIR = join(ROOT, "docs", "export", "bundles");
const PDF_DIR = join(ROOT, "docs", "export", "pdf");

/** @type {{ id: string; title: string; files: string[] }[]} */
const BUNDLES = [
  {
    id: "01-caf-product",
    title: "CAF — Product",
    files: [
      "docs/CAF_PRODUCT_PITCH.md",
      "docs/CAF_COMPLETE_PRODUCT_GUIDE.md",
      "docs/PROJECT_OVERVIEW.md",
    ],
  },
  {
    id: "02-caf-onboarding-and-context",
    title: "CAF — Onboarding & External Context",
    files: [
      "docs/EXTERNAL_CONTEXT_PACK.md",
      "docs/CAF_CURRENT_STATE_CONTEXT_PACK.md",
      "docs/REBUILD_FROM_DOCS.md",
      "docs/DOMAIN_MODEL.md",
      "docs/DATABASE_SCHEMA.md",
      "AGENTS.md",
    ],
  },
  {
    id: "11-caf-current-state-vol1-platform",
    title: "CAF Current State — Vol 1: Platform & Funnel",
    files: ["docs/volumes/CAF_CONTEXT_VOL1_Platform_and_Funnel.md", "AGENTS.md"],
  },
  {
    id: "12-caf-current-state-vol2-data",
    title: "CAF Current State — Vol 2: Data & Contracts",
    files: ["docs/volumes/CAF_CONTEXT_VOL2_Data_Contracts_and_Flows.md"],
  },
  {
    id: "13-caf-current-state-vol3-mimic",
    title: "CAF Current State — Vol 3: Operators, Mimic & BVS",
    files: [
      "docs/volumes/CAF_CONTEXT_VOL3_Operators_Mimic_and_BVS.md",
      "apps/review/CHATGPT_CAROUSEL_REVIEW_CONSOLE_EDIT_GUIDE.md",
    ],
  },
  {
    id: "14-caf-current-state-vol4-ops",
    title: "CAF Current State — Vol 4: Quality, Ops & Agent Map",
    files: ["docs/volumes/CAF_CONTEXT_VOL4_Quality_Ops_and_Agent_Map.md"],
  },
  {
    id: "03-caf-architecture-and-layers",
    title: "CAF — Architecture & Layers",
    files: [
      "docs/ARCHITECTURE.md",
      "docs/TECH_STACK.md",
      "docs/LIFECYCLE.md",
      "docs/layers/README.md",
      "docs/layers/http-api.md",
      "docs/layers/orchestration.md",
      "docs/layers/decision-engine.md",
      "docs/layers/job-pipeline.md",
      "docs/layers/generation.md",
      "docs/layers/rendering.md",
      "docs/layers/review-rework.md",
      "docs/layers/publishing.md",
      "docs/layers/learning.md",
      "docs/layers/persistence.md",
    ],
  },
  {
    id: "04-caf-engineering-complete-guide",
    title: "CAF Core — Complete Engineering Guide",
    files: ["docs/CAF_CORE_COMPLETE_GUIDE.md"],
  },
  {
    id: "05-caf-quality-risk-generation",
    title: "CAF — Quality, Risk & Generation",
    files: [
      "docs/QUALITY_CHECKS.md",
      "docs/RISK_RULES.md",
      "docs/GENERATION_GUIDANCE.md",
      "docs/stage-contracts/validation-output.md",
    ],
  },
  {
    id: "06-caf-api-and-integrations",
    title: "CAF — API & Integrations",
    files: [
      "docs/API_REFERENCE.md",
      "docs/VIDEO_FLOWS.md",
      "docs/HEYGEN_API_V3.md",
    ],
  },
  {
    id: "07-caf-mimic-and-creative-intelligence",
    title: "CAF — Mimic & Creative Intelligence",
    files: [
      "docs/MIMIC_FLOWS_COMPLETE_GUIDE.md",
      "docs/MIMIC_IMAGE_FLOWS.md",
      "docs/MIMIC_TEXT_PLACEMENT_AUTOMATION.md",
      "docs/CREATIVE_INTELLIGENCE.md",
    ],
  },
  {
    id: "08-caf-inputs-pipeline",
    title: "CAF — Inputs Pipeline",
    files: ["docs/CAF_INPUTS_PIPELINE_ROADMAP.md"],
  },
  {
    id: "10-caf-job-lifecycle",
    title: "CAF — Content Job Lifecycle",
    files: [
      "docs/JOB_LIFECYCLE.md",
      "docs/LIFECYCLE.md",
      "docs/layers/job-pipeline.md",
      "docs/layers/review-rework.md",
    ],
  },
  {
    id: "09-caf-operations-and-deploy",
    title: "CAF — Operations & Deploy",
    files: [
      "docs/FLY_PRODUCTION_CHECKLIST.md",
      "docs/USER_INPUT_AND_SECRETS.md",
      "ENV_AND_SECRETS_INVENTORY.md",
    ],
  },
];

function separator(title, sourcePath) {
  return `\n\n---\n\n<!-- Source: ${sourcePath} -->\n\n# Included: ${sourcePath}\n\n`;
}

function aggregateBundle(bundle) {
  const parts = [
    `# ${bundle.title}\n`,
    `*Aggregated export — ${new Date().toISOString().slice(0, 10)}. Source markdown in repo is unchanged.*\n`,
    `*Bundle id: \`${bundle.id}\`*\n`,
  ];

  for (const rel of bundle.files) {
    const abs = join(ROOT, rel.replace(/\//g, "\\").replace(/\\/g, "/"));
    const normalized = join(ROOT, ...rel.split("/"));
    const path = existsSync(normalized) ? normalized : abs;
    if (!existsSync(path)) {
      console.warn(`  skip missing: ${rel}`);
      continue;
    }
    const body = readFileSync(path, "utf8");
    parts.push(separator(rel, rel));
    parts.push(body.trim());
    parts.push("\n");
  }

  return parts.join("\n");
}

async function main() {
  mkdirSync(BUNDLES_DIR, { recursive: true });
  mkdirSync(PDF_DIR, { recursive: true });

  const pdfCss = `
    body { font-family: system-ui, Segoe UI, sans-serif; font-size: 11pt; line-height: 1.45; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.6rem; border-bottom: 1px solid #ccc; padding-bottom: 0.3rem; }
    h2 { font-size: 1.25rem; margin-top: 1.5rem; }
    h3 { font-size: 1.05rem; }
    code, pre { font-size: 0.85em; }
    pre { overflow-x: auto; background: #f6f6f6; padding: 0.75rem; border-radius: 4px; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
    th, td { border: 1px solid #ddd; padding: 0.35rem 0.5rem; text-align: left; }
    th { background: #f0f0f0; }
    a { color: #0563c1; }
  `;

  console.log("CAF doc PDF export\n");

  for (const bundle of BUNDLES) {
    const mdPath = join(BUNDLES_DIR, `${bundle.id}.md`);
    const pdfPath = join(PDF_DIR, `${bundle.id}.pdf`);

    console.log(`→ ${bundle.id}`);
    const md = aggregateBundle(bundle);
    writeFileSync(mdPath, md, "utf8");

    const pdf = await mdToPdf(
      { path: mdPath },
      {
        dest: pdfPath,
        css: pdfCss,
        pdf_options: {
          format: "A4",
          margin: { top: "18mm", right: "16mm", bottom: "18mm", left: "16mm" },
          printBackground: true,
        },
        launch_options: { args: ["--no-sandbox"] },
      },
    );

    if (!pdf?.filename) {
      console.error(`  FAILED: ${bundle.id}`);
      process.exitCode = 1;
    } else {
      console.log(`  md:  docs/export/bundles/${bundle.id}.md`);
      console.log(`  pdf: docs/export/pdf/${bundle.id}.pdf`);
    }
  }

  // README is maintained manually at docs/export/README.md

  console.log("\nDone. See docs/export/README.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
