/**
 * Adds --caf-carousel-* defaults into :root and a trailing override block so reviewer
 * typography (renderer :root injection) applies across carousel templates.
 * Skips templates that already contain --caf-carousel-headline-size.
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "services", "renderer", "templates");

const ROOT_LINES = `
      --caf-carousel-headline-size: 72px;
      --caf-carousel-body-size: 48px;
      --caf-carousel-kicker-size: 18px;
      --caf-carousel-cta-size: 72px;
      --caf-carousel-handle-size: 40px;
`;

const TRAILER = `
    /* CAF unified typography — optional px overrides from Review → generated_output.render */
    .kicker { font-size: var(--caf-carousel-kicker-size, 18px) !important; }
    .handle, .cta-handle { font-size: var(--caf-carousel-handle-size, 40px) !important; }
    .headline, .title, .cover-title, .body-title, .title-candy, .card h3 {
      font-size: var(--caf-carousel-headline-size, 72px) !important;
    }
    .body, .body-text, .subtitle-text, .cover-body, .cover-subtitle, .copy:not(.headline) {
      font-size: var(--caf-carousel-body-size, 48px) !important;
    }
    .card p { font-size: var(--caf-carousel-body-size, 48px) !important; }
    .cta, .cta-candy, .cta-text { font-size: var(--caf-carousel-cta-size, 72px) !important; }
`;

for (const f of fs.readdirSync(dir)) {
  if (!/^carousel_.*\.hbs$/i.test(f)) continue;
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("--caf-carousel-headline-size")) continue;

  const rootM = s.match(/:root\s*\{/);
  if (!rootM || rootM.index === undefined) {
    console.warn("skip (no :root):", f);
    continue;
  }
  const ins = rootM.index + rootM[0].length;
  s = s.slice(0, ins) + ROOT_LINES + s.slice(ins);

  const styleEnd = s.lastIndexOf("</style>");
  if (styleEnd < 0) {
    console.warn("skip (no </style>):", f);
    continue;
  }
  s = s.slice(0, styleEnd) + TRAILER + "\n  " + s.slice(styleEnd);
  fs.writeFileSync(p, s);
  console.log("updated:", f);
}
