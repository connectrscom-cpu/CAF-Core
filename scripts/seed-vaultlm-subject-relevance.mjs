#!/usr/bin/env node
/**
 * Enable subject relevance on VAULTLM processing profile (syncs from linkedinkeywords if empty).
 * Usage: node scripts/seed-vaultlm-subject-relevance.mjs [--base https://caf-core.fly.dev]
 */

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "https://caf-core.fly.dev";

const KEYWORDS = [
  "VaultLM",
  "ShareSafe",
  "confidential documents",
  "sensitive data",
  "document AI",
  "secure AI",
  "permission-aware RAG",
  "data masking",
  "audit trail",
  "AI governance",
  "data governance",
  "privacy engineering",
  "GDPR",
  "EU AI Act",
  "legal tech",
  "enterprise AI",
  "#VaultLM",
  "#SecureAI",
  "#DocumentAI",
  "#DataPrivacy",
  "#AICompliance",
  "#EUAIAct",
];

const EXCLUDES = ["crypto", "bitcoin", "NFT", "military AI", "surveillance", "generic AI news"];

async function api(path, opts = {}) {
  const res = await fetch(`${BASE.replace(/\/$/, "")}${path}`, opts);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const profileRes = await api("/v1/inputs-processing/VAULTLM/profile");
const criteria = { ...(profileRes.profile?.criteria_json ?? profileRes.criteria_help ?? {}) };
if (!criteria.pre_llm || typeof criteria.pre_llm !== "object") criteria.pre_llm = {};
criteria.pre_llm.enabled = true;
criteria.pre_llm.subject_relevance = {
  include_keywords: KEYWORDS.filter((k) => !k.startsWith("#")),
  include_hashtags: KEYWORDS.filter((k) => k.startsWith("#")),
  exclude_keywords: EXCLUDES,
  min_score: 0.2,
  subject_weight: 0.35,
  performance_weight: 0.65,
  apply_to_kinds: ["linkedin_post"],
};
if (!criteria.pre_llm.kinds?.linkedin_post) {
  criteria.pre_llm.kinds = {
    ...(criteria.pre_llm.kinds ?? {}),
    linkedin_post: { min_score: 0.06, weights: { li_likes: 0.4, li_comments: 0.25, li_shares: 0.15, text_signal: 0.2 } },
  };
}

const saved = await api("/v1/inputs-processing/VAULTLM/profile", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ criteria_json: criteria }),
});

console.log("VAULTLM subject relevance enabled on processing profile");
console.log(saved);
