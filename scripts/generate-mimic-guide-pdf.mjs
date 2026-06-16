/**
 * One-off: render docs/MIMIC_FLOWS_COMPLETE_GUIDE.md → PDF via Puppeteer.
 * Usage: node scripts/generate-mimic-guide-pdf.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const mdPath = join(root, "docs", "MIMIC_FLOWS_COMPLETE_GUIDE.md");
const pdfPath = join(root, "docs", "MIMIC_FLOWS_COMPLETE_GUIDE.pdf");
const htmlPath = join(root, "docs", ".MIMIC_FLOWS_COMPLETE_GUIDE.html");

const md = readFileSync(mdPath, "utf8");

/** Minimal markdown → HTML (covers this doc's patterns). */
function mdToHtml(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inCode = false;
  let inTable = false;
  let tableRows = [];

  const flushTable = () => {
    if (tableRows.length === 0) return;
    out.push("<table>");
    tableRows.forEach((row, i) => {
      const tag = i === 0 ? "th" : "td";
      out.push("<tr>" + row.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("") + "</tr>");
    });
    out.push("</table>");
    tableRows = [];
    inTable = false;
  };

  const inline = (s) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const escapeHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("```")) {
      if (!inCode) {
        flushTable();
        out.push("<pre><code>");
        inCode = true;
      } else {
        out.push("</code></pre>");
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }
    if (line.startsWith("|") && line.endsWith("|")) {
      if (line.replace(/[|\-\s]/g, "") === "") continue;
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      tableRows.push(cells);
      inTable = true;
      continue;
    }
    if (inTable) flushTable();

    if (line === "---") {
      out.push("<hr />");
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    if (line.startsWith("- ")) {
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (!line) {
      out.push("");
      continue;
    }
    out.push(`<p>${inline(line)}</p>`);
  }
  flushTable();
  if (inCode) out.push("</code></pre>");

  let html = out.join("\n");
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`);
  return html;
}

const body = mdToHtml(md);
const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CAF Mimic Flows — Complete Guide</title>
  <style>
    @page { margin: 18mm 16mm; }
    body {
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      font-size: 10.5pt;
      line-height: 1.45;
      color: #1a1a1a;
      max-width: 100%;
    }
    h1 { font-size: 22pt; border-bottom: 2px solid #2563eb; padding-bottom: 6px; margin-top: 0; }
    h2 { font-size: 14pt; color: #1e40af; margin-top: 1.4em; page-break-after: avoid; }
    h3 { font-size: 12pt; color: #1e3a8a; margin-top: 1.1em; page-break-after: avoid; }
    h4 { font-size: 11pt; margin-top: 0.9em; }
    p { margin: 0.45em 0; }
    code, pre {
      font-family: Consolas, "Courier New", monospace;
      font-size: 9pt;
    }
    code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
    pre {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
      white-space: pre-wrap;
      word-break: break-word;
      page-break-inside: avoid;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.6em 0 1em;
      font-size: 9.5pt;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 5px 8px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #eff6ff; font-weight: 600; }
    tr:nth-child(even) td { background: #fafafa; }
    ul { margin: 0.3em 0 0.6em 1.2em; padding: 0; }
    li { margin: 0.2em 0; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.2em 0; }
    strong { color: #0f172a; }
  </style>
</head>
<body>
${body}
</body>
</html>`;

writeFileSync(htmlPath, fullHtml, "utf8");

const require = createRequire(join(root, "services", "renderer", "package.json"));
const puppeteer = require("puppeteer");

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "networkidle0" });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "16mm", right: "14mm", bottom: "16mm", left: "14mm" },
  });
  console.log(`Wrote ${pdfPath}`);
} finally {
  await browser.close();
}
