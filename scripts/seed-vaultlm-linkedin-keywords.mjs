#!/usr/bin/env node
/**
 * Seed VAULTLM linkedinkeywords tab via Core API.
 * Usage: node scripts/seed-vaultlm-linkedin-keywords.mjs [--base https://caf-core.fly.dev]
 */

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "https://caf-core.fly.dev";

const KEYWORDS = [
  // Brand & product
  "VaultLM",
  "ShareSafe",
  "confidential documents",
  "sensitive data",
  "sensitive documents",
  "document AI",
  "secure AI",
  "secure AI for confidential documents",
  "permission-aware RAG",
  "permission-aware search",
  "source-scoped",
  "data masking",
  "pseudonymisation",
  "anonymisation",
  "citations",
  "audit trail",
  "AI audit trails",
  "governed AI",
  "controlled sharing",
  "safe sharing",
  "document security",
  "model route",
  "vault isolation",
  "re-identification",
  // Governance & compliance
  "AI governance",
  "data governance",
  "privacy engineering",
  "information governance",
  "GDPR",
  "EU AI Act",
  "AI Act",
  "data residency",
  "special category data",
  "DPA",
  "data processing agreement",
  "legal privilege",
  // Professional context
  "legal tech",
  "enterprise AI",
  "knowledge management",
  "due diligence",
  "M&A diligence",
  "professional services",
  "CISO",
  "DPO",
  "chief privacy officer",
  // Hashtags
  "#VaultLM",
  "#SecureAI",
  "#DocumentAI",
  "#DataPrivacy",
  "#AISecurity",
  "#EnterpriseAI",
  "#ResponsibleAI",
  "#AICompliance",
  "#DataGovernance",
  "#LegalTech",
  "#PrivacyEngineering",
  "#EUAIAct",
  // Excludes
  "exclude: crypto",
  "exclude: bitcoin",
  "exclude: NFT",
  "exclude: military AI",
  "exclude: surveillance",
  "exclude: prompt hack",
  "exclude: benchmark war",
  "exclude: generic AI news",
  "exclude: breach panic",
];

function buildRow(keyword, row_index) {
  const trimmed = keyword.trim();
  const excludeMatch = trimmed.match(/^-\s*(.+)$/) || trimmed.match(/^exclude:\s*(.+)$/i);
  const term = excludeMatch ? excludeMatch[1].trim() : trimmed;
  const role = excludeMatch ? "exclude" : "include";
  return {
    row_index,
    enabled: true,
    payload_json: {
      Name: trimmed,
      Link: term,
      keyword: term,
      role,
      Platform: "LinkedIn",
      source_tab: "linkedinkeywords",
    },
  };
}

const rows = KEYWORDS.map((k, i) => buildRow(k, i));
const url = `${BASE.replace(/\/$/, "")}/v1/inputs-sources/VAULTLM/rows/linkedinkeywords`;

const res = await fetch(url, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ rows }),
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

if (!res.ok) {
  console.error("Seed failed", res.status, body);
  process.exit(1);
}

console.log(`Seeded ${rows.length} LinkedIn keywords for VAULTLM → ${url}`);
console.log(body);
