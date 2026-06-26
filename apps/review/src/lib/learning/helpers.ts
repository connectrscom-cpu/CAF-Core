import type { LearningRule } from "@/lib/learning/types";

export async function copyTaskIdToClipboard(taskId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(taskId);
  } catch {
    window.prompt("Copy task_id (Ctrl+C, then Enter):", taskId);
  }
}

export function asStringList(v: unknown, max = 24): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, max);
}

function normalizeBulletKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?…]+$/g, "")
    .trim();
}

interface AggregatedBullet {
  count: number;
  display: string;
  taskIds: string[];
}

function aggregateReviewBullets(
  reviews: Record<string, unknown>[],
  field: "improvement_bullets" | "weaknesses" | "strengths" | "risk_flags"
): AggregatedBullet[] {
  const map = new Map<string, AggregatedBullet>();
  for (const r of reviews) {
    const tid = String(r.task_id ?? "").trim();
    const arr = asStringList(r[field], 64);
    for (const raw of arr) {
      const display = raw.trim();
      if (!display) continue;
      const k = normalizeBulletKey(display);
      if (!k) continue;
      const cur = map.get(k);
      if (!cur) {
        map.set(k, { count: 1, display, taskIds: tid ? [tid] : [] });
      } else {
        cur.count += 1;
        if (tid && !cur.taskIds.includes(tid) && cur.taskIds.length < 10) cur.taskIds.push(tid);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function buildLlmReviewsCompiledMarkdown(projectSlug: string, reviews: Record<string, unknown>[]): string {
  const n = reviews.length;
  const when = new Date().toISOString().slice(0, 10);
  const flowCounts = new Map<string, number>();
  for (const r of reviews) {
    const ft = String(r.flow_type ?? "").trim() || "—";
    flowCounts.set(ft, (flowCounts.get(ft) ?? 0) + 1);
  }
  const flowLines = [...flowCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([ft, c]) => `- **${ft}:** ${c} review(s)`)
    .join("\n");

  const improvements = aggregateReviewBullets(reviews, "improvement_bullets");
  const weaknesses = aggregateReviewBullets(reviews, "weaknesses");
  const strengths = aggregateReviewBullets(reviews, "strengths");
  const risks = aggregateReviewBullets(reviews, "risk_flags");

  const formatAgg = (items: AggregatedBullet[]) =>
    items.length === 0
      ? "_None in this set._"
      : items
          .map((x) => {
            const sample =
              x.taskIds.length > 0
                ? ` — e.g. \`${x.taskIds.slice(0, 4).join("`, `")}\`${x.taskIds.length > 4 ? " …" : ""}`
                : "";
            return `- **(${x.count}×)** ${x.display}${sample}`;
          })
          .join("\n");

  const upstreamByTarget = new Map<string, { change: string; taskIds: string[]; rationale?: string }[]>();
  for (const r of reviews) {
    const tid = String(r.task_id ?? "").trim();
    const raw = r.upstream_recommendations;
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const target = typeof o.target === "string" && o.target.trim() ? o.target.trim() : "other";
      const change = typeof o.change === "string" ? o.change.trim() : "";
      if (!change) continue;
      const rationale = typeof o.rationale === "string" ? o.rationale.trim() : "";
      const list = upstreamByTarget.get(target) ?? [];
      const dup = list.find((x) => normalizeBulletKey(x.change) === normalizeBulletKey(change));
      if (dup) {
        if (tid && !dup.taskIds.includes(tid) && dup.taskIds.length < 8) dup.taskIds.push(tid);
      } else {
        list.push({
          change,
          taskIds: tid ? [tid] : [],
          ...(rationale ? { rationale } : {}),
        });
      }
      upstreamByTarget.set(target, list);
    }
  }

  let upstreamMd = "";
  if (upstreamByTarget.size > 0) {
    const parts: string[] = [];
    for (const [target, rows] of [...upstreamByTarget.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      parts.push(`### ${target}`);
      parts.push(
        rows
          .map((row) => {
            const ids =
              row.taskIds.length > 0
                ? ` (\`${row.taskIds.slice(0, 4).join("`, `")}\`${row.taskIds.length > 4 ? " …" : ""})`
                : "";
            const rat = row.rationale ? ` — _${row.rationale}_` : "";
            return `- ${row.change}${ids}${rat}`;
          })
          .join("\n")
      );
    }
    upstreamMd = `## Upstream recommendations (structured)\n\n${parts.join("\n\n")}\n`;
  }

  return [
    "# CAF — engineering remediation (from LLM approval reviews)",
    "",
    `**Project:** \`${projectSlug}\``,
    `**Compiled:** ${when}`,
    `**Reviews analyzed:** ${n}`,
    "",
    "## Scope",
    "Merged **summary bullets** from every loaded LLM approval review below. Use this as a Cursor / coding-agent brief; pair with **Mint fix** on individual rows for pending `GENERATION_GUIDANCE` rules.",
    "",
    "### Flow mix (loaded rows)",
    flowLines || "- _No flow_type on rows._",
    "",
    "## Constraints",
    "- Preserve existing `task_id` / text-ID hierarchy; do not rename ID schemes in a partial change.",
    "- `learning_rules` adjust ranking and volume; this brief is for **code, templates, or pipeline** when prompts alone are insufficient.",
    "- Prefer the smallest change that addresses the pattern; add a test or rendered snapshot if the issue is visual.",
    "",
    "## Aggregated improvements",
    formatAgg(improvements),
    "",
    "## Aggregated weaknesses",
    formatAgg(weaknesses),
    "",
    "## Aggregated strengths",
    formatAgg(strengths),
    "",
    "## Aggregated risk flags",
    formatAgg(risks),
    "",
    upstreamMd,
    "## Next step",
    "Use **Compile** on this page to also generate the **Repo agent prompt** (action checklist for Cursor). Then implement and redeploy Core + renderer.",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

const UPSTREAM_TARGET_HINTS: Record<string, string> = {
  prompt_template: "`src/repositories/flow-engine.ts` · Flow Engine DB prompt templates · `src/services/llm-generator.ts`",
  output_schema: "`src/domain/` · generation payload shapes · `src/services/llm-output-normalize.ts`",
  flow_definition: "`src/repositories/flow-engine.ts` · `src/domain/canonical-flow-types.ts`",
  project_brand: "`src/repositories/project-config.ts` · brand/signal packs",
  project_strategy: "`src/repositories/project-config.ts`",
  learning_guidance: "`src/services/learning-rule-selection.ts` · `caf_core.learning_rules`",
  qc_checklist: "`src/services/qc-runtime.ts` · `src/domain/generation-payload-qc.ts`",
  risk_policy: "`src/services/risk-qc-status.ts` · risk policy migrations",
  other: "`src/services/` · narrow using `flow_type` / evidence below",
};

function inferRepoHintsFromBullet(text: string): string[] {
  const t = text.toLowerCase();
  const out = new Set<string>();
  if (/\b(carousel|slide|template|font|typograph|emoji|cta|hook|hashtag|deck|hbs|render pack)\b/i.test(t)) {
    out.add("`services/renderer/templates/*.hbs`");
    out.add("`src/services/carousel-render-pack.ts`");
  }
  if (/\b(copy|prompt|llm|json|schema|field|variation|bullet)\b/i.test(t)) {
    out.add("`src/services/llm-generator.ts`");
  }
  if (/\b(video|scene|script|heygen|caption|subtitle|avatar|voice|b-?roll|reel|tiktok|spoken)\b/i.test(t)) {
    out.add("`src/services/video-script-generator.ts`");
    out.add("`src/services/video-prompt-generator.ts`");
    out.add("`src/services/scene-assembly-generator.ts`");
    out.add("`src/services/heygen-renderer.ts`");
  }
  if (/\b(review|workbench|ui|override|editorial)\b/i.test(t)) {
    out.add("`apps/review/src/**`");
  }
  if (out.size === 0) {
    out.add("`src/services/` (use **flow_type** + sample `task_id`s below to pick the right module)");
  }
  return [...out].slice(0, 5);
}

/**
 * Imperative prompt for Cursor / repo agents — mirrors the intent of editorial `coding_agent_markdown`
 * without calling OpenAI (heuristic routing from bullet text + upstream targets).
 */
export function buildLlmReviewsRepoAgentPrompt(projectSlug: string, reviews: Record<string, unknown>[]): string {
  const when = new Date().toISOString().slice(0, 19).replace("T", " ");
  const n = reviews.length;
  const improvements = aggregateReviewBullets(reviews, "improvement_bullets");
  const weaknesses = aggregateReviewBullets(reviews, "weaknesses");

  type Task = { title: string; evidence: string[]; surfaces: string; acceptance: string };
  const tasks: Task[] = [];

  const upstreamFlat: { target: string; change: string; taskIds: string[] }[] = [];
  for (const r of reviews) {
    const tid = String(r.task_id ?? "").trim();
    const raw = r.upstream_recommendations;
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const target = typeof o.target === "string" && o.target.trim() ? o.target.trim() : "other";
      const change = typeof o.change === "string" ? o.change.trim() : "";
      if (!change) continue;
      const k = `${target}::${normalizeBulletKey(change)}`;
      const existing = upstreamFlat.find((x) => `${x.target}::${normalizeBulletKey(x.change)}` === k);
      if (existing) {
        if (tid && !existing.taskIds.includes(tid) && existing.taskIds.length < 6) existing.taskIds.push(tid);
      } else {
        upstreamFlat.push({ target, change, taskIds: tid ? [tid] : [] });
      }
    }
  }

  for (const u of upstreamFlat.slice(0, 6)) {
    const hint = UPSTREAM_TARGET_HINTS[u.target] ?? UPSTREAM_TARGET_HINTS.other;
    tasks.push({
      title: `[upstream · ${u.target}] ${u.change}`,
      evidence: u.taskIds.map((x) => `\`${x}\``),
      surfaces: hint,
      acceptance: `Change matches the **${u.target}** lever; preserve task_id / run_id formats; add or extend a test if behavior is non-visual.`,
    });
  }

  const seen = new Set<string>();
  for (const agg of [...improvements, ...weaknesses]) {
    if (tasks.length >= 12) break;
    const k = normalizeBulletKey(agg.display);
    if (seen.has(k)) continue;
    seen.add(k);
    const hints = inferRepoHintsFromBullet(agg.display);
    tasks.push({
      title: agg.display,
      evidence: agg.taskIds.slice(0, 5).map((x) => `\`${x}\``),
      surfaces: hints.join(" · "),
      acceptance:
        "Smallest fix that removes the pattern; preserve ID schemes; add a snapshot/unit test if output is visual or structured JSON.",
    });
  }

  const taskBlocks = tasks.map((t, i) => {
    const ev = t.evidence.length ? t.evidence.join(", ") : "_none_";
    return [
      `### ${i + 1}. ${t.title}`,
      "",
      `- **Evidence:** ${ev}`,
      `- **Likely surfaces:** ${t.surfaces}`,
      `- **Acceptance criteria:** ${t.acceptance}`,
      "",
    ].join("\n");
  });

  return [
    `# CAF-Core — repo agent prompt (LLM approval reviews)`,
    "",
    `Paste this into **Cursor Agent** (or Claude Code) in the **CAF-Core** repository. Implement tasks in order unless two tasks clearly touch the same files — then batch.`,
    "",
    "## Role",
    "You are a senior engineer on **CAF-Core**: Postgres-backed content jobs, LLM generation, Handlebars renderer (`services/renderer`), Next.js review app (`apps/review`).",
    "",
    "## Context",
    `- **Project:** \`${projectSlug}\``,
    `- **Evidence:** ${n} post-approval LLM review row(s), compiled ${when}`,
    "- **Do not** rename \`task_id\`, \`run_id\`, or review text-ID formats.",
    "",
    "## Global constraints",
    "- Prefer **small PR-sized** changes; no drive-by refactors.",
    "- **learning_rules** handle ranking/volume; this work is **code / templates / pipeline** when prompts alone are not enough.",
    "- If the issue is **visual**, change \`services/renderer/templates/*.hbs\` (or carousel pack) and add a render snapshot or fixture test if the repo already does that.",
    "- Run **typecheck** and **tests** for files you touch before finishing.",
    "",
    "## Priority work items",
    taskBlocks.length > 0 ? taskBlocks.join("\n") : "_No structured tasks inferred — expand LLM review rows on the Learning page and recompile._",
    "",
    "## Verification checklist",
    "- [ ] `npx tsc --noEmit` at repository root",
    "- [ ] `npx vitest run` for affected packages (e.g. `src/services/*.test.ts`)",
    "- [ ] If templates changed: confirm renderer still builds / snapshot tests pass",
    "",
    "## Reference",
    "The **Merged engineering brief (markdown)** on the same page lists **all** aggregated bullets (improvements, weaknesses, strengths, risks). Use it for nuance; use **this** document as the execution checklist.",
    "",
  ].join("\n");
}

/** Score must be below this to mint improvement rules (threshold just above actual score). */
export function mintBelowThresholdForScore(score: number): number {
  return Math.min(0.9999, Math.max(0.01, score + 0.0005));
}

/** Score must be ≥ this to mint strength rules (just below actual score). */
export function mintAboveThresholdForScore(score: number): number {
  return Math.max(0.0001, Math.min(0.9999, score - 0.0005));
}

export function learningRulePlainSummary(rule: LearningRule): string {
  const p = rule.action_payload ?? {};
  const obs = typeof p.observation === "string" ? p.observation : "";
  switch (rule.action_type) {
    case "SCORE_PENALTY":
      return (
        `Lowers ranking scores for ideas that match this pattern (typically tied to rejection tag "${String(p.rejection_tag ?? "—")}"). ` +
        `Penalty: ${String(p.penalty ?? "see payload")}. ` +
        (obs ? obs : "").trim()
      );
    case "REDUCE_VOLUME":
      return (
        `Tells the planner to generate fewer jobs for flow "${String(p.flow_type ?? rule.scope_flow_type ?? "—")}" ` +
        `because human approval was weak in the analysis window. ` +
        `${String(p.recommendation ?? "")} ${obs}`.trim()
      );
    case "SCORE_BOOST":
      return `Increases ranking scores when the trigger matches (boost in payload). ${obs}`.trim();
    case "GENERATION_GUIDANCE":
    case "GENERATION_HINT":
      return typeof p.text === "string"
        ? p.text
        : `Injects generation guidance for the content LLM. ${obs}`.trim();
    default:
      return `${rule.action_type}: when trigger "${rule.trigger_type}" fires, Core applies the parameters in the payload below.`;
  }
}

/** Split merged engineering markdown into heuristic vs OpenAI blocks (same join as Core). */
export function splitEngineeringMarkdown(full: string): { heuristic: string; llmSection: string } {
  const marker = "\n---\n\n## Reviewer notes";
  const idx = full.indexOf(marker);
  if (idx === -1) return { heuristic: full.trim(), llmSection: "" };
  const afterSep = idx + "\n---\n\n".length;
  return {
    heuristic: full.slice(0, idx).trim(),
    llmSection: full.slice(afterSep).trim(),
  };
}

export function llmCodingAgentMarkdownOnly(result: Record<string, unknown>): string {
  const llm = result.llm_notes_synthesis;
  if (!llm || typeof llm !== "object" || "skipped" in llm) return "";
  const cam = (llm as { coding_agent_markdown?: string }).coding_agent_markdown;
  return typeof cam === "string" ? cam.trim() : "";
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function buildNotesOnlyGuidelinesPrompt(input: {
  projectSlug: string;
  windowDays: number;
  notes: Array<{
    task_id: string;
    decision: string | null;
    flow_type: string | null;
    platform: string | null;
    carousel_template_name: string | null;
    carousel_template_path_hint?: string | null;
    rejection_tags: unknown[];
    notes: string | null;
    created_at: string;
  }>;
}): string {
  const allowedDecisions = new Set(["APPROVED", "NEEDS_EDIT", "REJECTED"]);
  const rows = (input.notes ?? [])
    // Only include the rows that were analyzed (human decisions). Excludes history/audit rows.
    .filter((r) => (r.decision ? allowedDecisions.has(String(r.decision).trim().toUpperCase()) : false))
    .filter((r) => (r.notes ?? "").trim().length > 0)
    .slice(0, 80)
    .map((r) => {
      const note = String(r.notes ?? "").trim().replace(/\s+/g, " ");
      const tags = Array.isArray(r.rejection_tags) ? r.rejection_tags.map((t) => String(t)).slice(0, 8) : [];
      const meta = [
        r.decision ? `decision=${r.decision}` : null,
        r.flow_type ? `flow=${r.flow_type}` : null,
        r.platform ? `platform=${r.platform}` : null,
        r.carousel_template_name ? `template=${r.carousel_template_name}` : null,
        tags.length ? `tags=${tags.join(",")}` : null,
        r.created_at ? `at=${String(r.created_at).slice(0, 10)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `- ${r.task_id}${meta ? ` (${meta})` : ""}\n  ${note}`;
    })
    .join("\n");

  return [
    "# CAF — guidelines + code changes (from reviewer notes)",
    "",
    `**Project:** \`${input.projectSlug}\``,
    `**Window:** last ${input.windowDays} days`,
    "",
    "## What to do",
    "Turn these notes into **(A) guidelines to feed back into generation** and **(B) concrete codebase changes** when needed.",
    "",
    "## Output (strict)",
    "1) **Guidelines** (bullet list). Each guideline must include:",
    "- scope: flow/platform and (if relevant) `carousel_template_name`",
    "- rule text: what to enforce/avoid",
    "- evidence: 2-5 `task_id` examples",
    "",
    "2) **Proposed changes** as a list of small PRs. For each PR include:",
    "- title",
    "- files/paths likely to change (e.g. `services/renderer/templates/<template>.hbs`, generator prompt files, review UI)",
    "- concrete changes",
    "- acceptance criteria",
    "- evidence: 3-6 `task_id` examples",
    "",
    "## Where issues usually live (mapping)",
    "- If `carousel_template_name=carousel_xxx`: check `services/renderer/templates/carousel_xxx.hbs`",
    "- Template selection / fallback logic: `src/services/carousel-render-pack.ts`",
    "- Editorial learning loop: `src/services/editorial-learning.ts` and `src/services/editorial-notes-llm-synthesis.ts`",
    "- Review UI: `apps/review/src/app/learning/page.tsx` and related components",
    "",
    "## Constraints",
    "- Do not rename `task_id` / text-ID schemes; preserve CAF join patterns.",
    "- If visuals are mentioned (fonts, caption overlays, spacing, cropping), anchor changes to the specific template named in the notes.",
    "- Prefer the smallest verifiable change; avoid unrelated refactors.",
    "",
    "## Notes (evidence)",
    rows || "_No non-empty notes found in this window._",
    "",
  ].join("\n");
}

