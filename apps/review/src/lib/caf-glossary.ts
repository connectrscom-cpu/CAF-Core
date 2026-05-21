/** Single source of truth for CAF workbench term explanations (Review + Admin). */

export type CafGlossaryKey =
  | "evidence"
  | "insights"
  | "jobs"
  | "signalPack"
  | "run"
  | "runOutputs"
  | "plannedJobs"
  | "processing"
  | "inputs";

export const CAF_GLOSSARY: Record<CafGlossaryKey, string> = {
  evidence:
    "Scraped rows from your INPUTS workbook (typically 9–10 platform sheets). Raw social and web content before analysis.",
  insights:
    "LLM analysis of evidence — patterns, hooks, top-performer findings, and strategic opportunities.",
  jobs:
    "Content units that travel from signal pack → run planning → generation. The same concept throughout the pipeline.",
  signalPack:
    "Bundle attached to a run: jobs, visual guidelines, hashtags, and derived globals.",
  run: "One execution cycle for a project, tied to a signal pack.",
  runOutputs: "Post-run artifacts: exports, content log, and output review.",
  plannedJobs:
    "Jobs selected from the signal pack for a run before planning and generation start.",
  processing:
    "Filter evidence, generate insights, build jobs, and compile a signal pack from an import.",
  inputs: "Upload INPUTS workbooks and browse import history before processing.",
};

export function glossaryText(key: CafGlossaryKey): string {
  return CAF_GLOSSARY[key] ?? key;
}
