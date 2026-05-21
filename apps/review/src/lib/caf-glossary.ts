/** Single source of truth for CAF workbench term explanations (Review + Admin). */

export type CafGlossaryKey =
  | "evidence"
  | "insights"
  | "ideas"
  | "jobs"
  | "signalPack"
  | "run"
  | "runOutputs"
  | "plannedJobs"
  | "ideaPickingRules"
  | "ideaPickingLlm"
  | "ideaPickingManual"
  | "processing"
  | "inputs"
  | "inputSources";

export const CAF_GLOSSARY: Record<CafGlossaryKey, string> = {
  evidence:
    "Scraped rows from your INPUTS workbook (typically 9–10 platform sheets). Raw social and web content before analysis.",
  insights:
    "LLM analysis of evidence — patterns, hooks, top-performer findings, and strategic opportunities.",
  ideas:
    "Curated content concepts built during Processing (ideas_json). Fed into a signal pack before any run exists.",
  jobs:
    "Executable content units (content_jobs) created when you Start a run — planned from signal pack ideas × enabled flows.",
  signalPack:
    "Research bundle: curated ideas (ideas_json), visual guidelines, hashtags, and derived globals. Attached when you create a run.",
  run: "One execution cycle for a project, tied to a signal pack. Starting a run creates jobs from pack ideas.",
  runOutputs: "Post-run artifacts: exports, content log, and output review.",
  plannedJobs:
    "Jobs selected from the signal pack for a run before planning and generation start.",
  ideaPickingRules:
    "Include every idea in the signal pack. Each idea becomes a planner row using deterministic rules (format, confidence, platform, creative-intel boost) — no LLM selection at this step.",
  ideaPickingLlm:
    "OpenAI picks a diverse, high-impact subset from pack ideas (default max 40) before you Start the run.",
  ideaPickingManual:
    "You choose which pack ideas become planner rows on Planned jobs before Start.",
  processing:
    "Filter evidence, generate insights, build ideas, and compile a signal pack from an import.",
  inputs:
    "Evidence for this project. Today, n8n flows run scrapers that collect posts from hashtags and accounts chosen as sources for the project; results land here as imports (.xlsx). You can also upload INPUTS workbooks manually. Source picking and scraper config will move into this page later.",
  inputSources:
    "Automated collection runs in n8n: each flow uses scrapers and selects hashtags / accounts that fit the project’s source list. Imports appear in the table below until source management lives here.",
};

export function glossaryText(key: CafGlossaryKey): string {
  return CAF_GLOSSARY[key] ?? key;
}
