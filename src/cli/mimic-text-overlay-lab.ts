/**
 * Mimic text overlay lab — preview Document AI + Nemotron placement without running a job.
 *
 * Usage:
 *   npm run mimic-text-lab -- --fixture fixtures/mimic-text-overlay/two-block-dark-slide.json --serve
 *   npm run mimic-text-lab -- --fixture ... --write preview.html
 *   npm run mimic-text-lab -- --insights-id <uuid> --slide 2 --serve
 *   npm run mimic-text-lab -- --fixture ... --copy '{"headline":"Shorter hook"}' --write out.html
 *
 * Deployed UI: https://caf-core.fly.dev/admin/mimic-text-overlay-lab
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../config.js";
import {
  composeMimicTextOverlayLabFromFixture,
  renderMimicTextOverlayLabHtml,
  type MimicTextOverlayLabFixture,
} from "../services/mimic-text-overlay-lab.js";
import { loadMimicTextOverlayFixtureFromInsights } from "../services/mimic-text-overlay-lab-load.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function usage(): string {
  return `Mimic text overlay lab

Options:
  --fixture <path>       JSON fixture (Nemotron slides + llm_slide copy)
  --insights-id <id>     Load visual_guideline from inputs_evidence_row_insights
  --slide <n>            1-based slide index (default: 1)
  --copy <json>          Override llm_slide fields (headline, body, text_blocks, …)
  --bg <url>             Optional background plate URL
  --write <path>         Write standalone HTML file
  --serve                HTTP preview server (default port 3456)
  --port <n>             Port for --serve (default 3456)
  --no-debug-boxes       Hide reference OCR bounding boxes
  --ghost-ref            Show faded reference text for comparison
  --help`;
}

function parseArgs(argv: string[]) {
  const opts: Record<string, string | boolean> = {
    slide: "1",
    port: "3456",
    serve: false,
    "no-debug-boxes": false,
    "ghost-ref": false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      opts.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return opts;
}

function readFixture(pathArg: string): MimicTextOverlayLabFixture {
  const abs = resolve(REPO_ROOT, pathArg);
  const raw = readFileSync(abs, "utf8");
  return JSON.parse(raw) as MimicTextOverlayLabFixture;
}

function mergeCopy(base: Record<string, unknown>, copyJson: string): Record<string, unknown> {
  const patch = JSON.parse(copyJson) as Record<string, unknown>;
  return { ...base, ...patch };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }

  const slideIndex = Math.max(1, parseInt(String(opts.slide), 10) || 1);
  let fixture: MimicTextOverlayLabFixture;

  if (typeof opts.fixture === "string") {
    fixture = readFixture(opts.fixture);
  } else if (typeof opts["insights-id"] === "string") {
    const config = loadConfig();
    const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
    try {
      fixture = await loadMimicTextOverlayFixtureFromInsights(pool, opts["insights-id"], slideIndex);
    } finally {
      await pool.end();
    }
  } else {
    console.error("Provide --fixture <path> or --insights-id <id>\n");
    console.error(usage());
    process.exit(1);
  }

  if (typeof opts.copy === "string") {
    fixture.llm_slide = mergeCopy(fixture.llm_slide, opts.copy);
  }
  if (typeof opts.bg === "string" && opts.bg.trim()) {
    fixture.background_image_url = opts.bg.trim();
  }
  fixture.slide_index = slideIndex;

  const composed = composeMimicTextOverlayLabFromFixture(fixture);
  if (composed.text_layers.length === 0) {
    console.warn(
      "Warning: no Document AI / Nemotron text blocks found for this slide. " +
        "Check visual_guideline.slides[].text_blocks or document_ai_ocr_v1."
    );
  }

  const html = renderMimicTextOverlayLabHtml(composed, {
    title: "Mimic text overlay lab",
    description: fixture.description,
    showDebugBoxes: !opts["no-debug-boxes"],
    showReferenceGhostText: Boolean(opts["ghost-ref"]),
  });

  if (typeof opts.write === "string") {
    const outPath = resolve(process.cwd(), opts.write);
    writeFileSync(outPath, html, "utf8");
    console.log(`Wrote ${outPath}`);
    console.log(`Layers: ${composed.text_layers.length}, reference blocks: ${composed.reference_blocks.length}`);
  }

  if (opts.serve) {
    const port = parseInt(String(opts.port), 10) || 3456;
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });
    server.listen(port, "127.0.0.1", () => {
      console.log(`Mimic text overlay lab: http://127.0.0.1:${port}/`);
      console.log(`Slide ${composed.slide_index} — ${composed.text_layers.length} layer(s)`);
      if (fixture.description) console.log(fixture.description);
    });
    return;
  }

  if (typeof opts.write !== "string") {
    const defaultOut = resolve(REPO_ROOT, "tmp-mimic-text-overlay-preview.html");
    writeFileSync(defaultOut, html, "utf8");
    console.log(`Wrote ${defaultOut} (use --serve to preview in browser)`);
    console.log(`Layers: ${composed.text_layers.length}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
