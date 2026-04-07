/**
 * Diagnostic Audit Runner — Learning Loop A.
 *
 * Evaluates generated content against structured quality criteria:
 * hook strength, novelty, platform fit, tone fit, emotional specificity,
 * clarity, pacing/structure, CTA strength, claim risk.
 *
 * Produces a DiagnosticAudit record that feeds into learning rules.
 */
import type { Pool } from "pg";
import { qOne } from "../db/queries.js";
import { insertDiagnosticAudit } from "../repositories/ops.js";
import { getBrandConstraints } from "../repositories/project-config.js";

export interface DiagnosticResult {
  audit_id: string;
  task_id: string;
  audit_type: string;
  overall_score: number;
  strengths: string[];
  failure_types: string[];
  risk_findings: string[];
  improvement_suggestions: string[];
}

interface ContentPayload {
  caption?: string;
  hook?: string;
  generated_hook?: string;
  generated_caption?: string;
  slides?: unknown[];
  variations?: unknown[];
  spoken_script?: string;
  cta_type?: string;
  hashtags?: string[];
  [key: string]: unknown;
}

function scoreHookStrength(content: ContentPayload): { score: number; issues: string[]; strengths: string[] } {
  const hook = content.hook || content.generated_hook || "";
  const issues: string[] = [];
  const strengths: string[] = [];
  let score = 0.5;

  if (!hook) {
    issues.push("no_hook_present");
    return { score: 0, issues, strengths };
  }

  if (hook.length < 20) {
    issues.push("hook_too_short");
    score -= 0.2;
  }
  if (hook.length > 140) {
    issues.push("hook_too_long");
    score -= 0.1;
  }

  const genericPatterns = [
    /^did you know/i, /^check this out/i, /^here('|')s (a|the)/i,
    /^top \d+/i, /^you won('|')t believe/i,
  ];
  if (genericPatterns.some((p) => p.test(hook))) {
    issues.push("generic_hook_pattern");
    score -= 0.2;
  }

  const identityPatterns = [/if you('|')re/i, /your sign/i, /is this you/i, /you('|')re the type/i];
  if (identityPatterns.some((p) => p.test(hook))) {
    strengths.push("identity_trigger_hook");
    score += 0.2;
  }

  const emotionalPatterns = [/feel/i, /hurt/i, /love/i, /afraid/i, /coping/i, /pattern/i];
  if (emotionalPatterns.some((p) => p.test(hook))) {
    strengths.push("emotional_specificity");
    score += 0.1;
  }

  if (/\?/.test(hook)) {
    strengths.push("question_hook");
    score += 0.05;
  }

  return { score: Math.max(0, Math.min(1, score)), issues, strengths };
}

function scoreNovelty(content: ContentPayload): { score: number; issues: string[] } {
  const caption = content.caption || content.generated_caption || "";
  const issues: string[] = [];
  let score = 0.6;

  const clichePatterns = [
    /the universe/i, /manifest/i, /cosmic energy/i, /alignment/i,
    /written in the stars/i, /meant to be/i,
  ];
  const clicheCount = clichePatterns.filter((p) => p.test(caption)).length;
  if (clicheCount > 0) {
    issues.push(`cliche_count_${clicheCount}`);
    score -= clicheCount * 0.1;
  }

  const uniqueWords = new Set(caption.toLowerCase().split(/\s+/));
  const totalWords = caption.split(/\s+/).length;
  if (totalWords > 10) {
    const lexicalDiversity = uniqueWords.size / totalWords;
    if (lexicalDiversity < 0.5) {
      issues.push("low_lexical_diversity");
      score -= 0.15;
    }
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

function scorePlatformFit(content: ContentPayload, platform: string | null): { score: number; issues: string[] } {
  const caption = content.caption || content.generated_caption || "";
  const issues: string[] = [];
  let score = 0.7;

  if (platform?.toLowerCase() === "instagram") {
    if (caption.length > 2200) {
      issues.push("caption_exceeds_ig_limit");
      score -= 0.3;
    }
    const slides = content.slides || content.variations;
    if (Array.isArray(slides) && slides.length > 0) {
      if (slides.length > 10) {
        issues.push("too_many_slides");
        score -= 0.2;
      }
    }
    const hashtags = content.hashtags || [];
    if (Array.isArray(hashtags) && hashtags.length > 30) {
      issues.push("too_many_hashtags");
      score -= 0.1;
    }
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

function scoreToneFit(content: ContentPayload, brandTone: string | null): { score: number; issues: string[] } {
  const text = (content.caption || content.generated_caption || "") + " " + (content.hook || content.generated_hook || "");
  const issues: string[] = [];
  let score = 0.7;

  if (!brandTone) return { score, issues };

  const toneWords = brandTone.toLowerCase().split(/[,;]+/).map((w) => w.trim());
  if (toneWords.includes("warm") || toneWords.includes("emotionally intelligent")) {
    const aggressivePatterns = [/you must/i, /do this now/i, /wake up/i, /stop being/i];
    if (aggressivePatterns.some((p) => p.test(text))) {
      issues.push("aggressive_tone_mismatch");
      score -= 0.2;
    }
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

function scoreClarity(content: ContentPayload): { score: number; issues: string[] } {
  const text = content.caption || content.generated_caption || "";
  const issues: string[] = [];
  let score = 0.7;

  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const longSentences = sentences.filter((s) => s.split(/\s+/).length > 30);
  if (longSentences.length > 0) {
    issues.push("long_sentences");
    score -= longSentences.length * 0.1;
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

function scoreCtaStrength(content: ContentPayload): { score: number; issues: string[]; strengths: string[] } {
  const text = content.caption || content.generated_caption || "";
  const issues: string[] = [];
  const strengths: string[] = [];
  let score = 0.5;

  const strongCtas = [/save this/i, /share with/i, /tag someone/i, /comment your/i, /follow for/i, /link in bio/i];
  const weakCtas = [/let us know/i, /what do you think/i, /thoughts\?/i];

  if (strongCtas.some((p) => p.test(text))) {
    strengths.push("strong_cta");
    score += 0.3;
  }
  if (weakCtas.some((p) => p.test(text))) {
    issues.push("weak_cta");
    score -= 0.1;
  }
  if (!strongCtas.some((p) => p.test(text)) && !weakCtas.some((p) => p.test(text))) {
    issues.push("no_cta_detected");
    score -= 0.2;
  }

  return { score: Math.max(0, Math.min(1, score)), issues, strengths };
}

/**
 * Run a full diagnostic audit on a content_job.
 */
export async function runDiagnosticAudit(db: Pool, jobId: string): Promise<DiagnosticResult> {
  const job = await qOne<{
    id: string; task_id: string; project_id: string; flow_type: string;
    platform: string | null; generation_payload: Record<string, unknown>;
  }>(db, `SELECT * FROM caf_core.content_jobs WHERE id = $1`, [jobId]);

  if (!job) throw new Error(`Job not found: ${jobId}`);

  const generatedOutput = (job.generation_payload?.generated_output ?? {}) as ContentPayload;
  const brand = await getBrandConstraints(db, job.project_id);

  const hookResult = scoreHookStrength(generatedOutput);
  const noveltyResult = scoreNovelty(generatedOutput);
  const platformResult = scorePlatformFit(generatedOutput, job.platform);
  const toneResult = scoreToneFit(generatedOutput, brand?.tone ?? null);
  const clarityResult = scoreClarity(generatedOutput);
  const ctaResult = scoreCtaStrength(generatedOutput);

  const allIssues = [
    ...hookResult.issues, ...noveltyResult.issues, ...platformResult.issues,
    ...toneResult.issues, ...clarityResult.issues, ...ctaResult.issues,
  ];
  const allStrengths = [...hookResult.strengths, ...ctaResult.strengths];

  const overallScore = (
    hookResult.score * 0.25 +
    noveltyResult.score * 0.15 +
    platformResult.score * 0.15 +
    toneResult.score * 0.15 +
    clarityResult.score * 0.15 +
    ctaResult.score * 0.15
  );

  const riskFindings: string[] = [];
  if (platformResult.issues.length > 0) riskFindings.push("platform_constraint_violation");
  if (toneResult.issues.length > 0) riskFindings.push("tone_mismatch");

  const improvements: string[] = [];
  if (hookResult.issues.includes("generic_hook_pattern")) {
    improvements.push("Replace generic hook with identity-trigger or emotional-specificity hook");
  }
  if (noveltyResult.issues.length > 0) {
    improvements.push("Reduce cliche language and increase lexical diversity");
  }
  if (ctaResult.issues.includes("weak_cta") || ctaResult.issues.includes("no_cta_detected")) {
    improvements.push("Add a direct save/share/comment CTA");
  }
  if (clarityResult.issues.includes("long_sentences")) {
    improvements.push("Break long sentences into shorter, punchier lines");
  }

  const auditId = await insertDiagnosticAudit(db, {
    task_id: job.task_id,
    project_id: job.project_id,
    audit_type: "auto_diagnostic",
    failure_types: allIssues,
    strengths: allStrengths,
    risk_findings: riskFindings,
    improvement_suggestions: improvements,
    audit_score: overallScore,
    metadata: {
      scores: {
        hook: hookResult.score,
        novelty: noveltyResult.score,
        platform_fit: platformResult.score,
        tone_fit: toneResult.score,
        clarity: clarityResult.score,
        cta: ctaResult.score,
      },
      flow_type: job.flow_type,
      platform: job.platform,
    },
  });

  return {
    audit_id: auditId,
    task_id: job.task_id,
    audit_type: "auto_diagnostic",
    overall_score: overallScore,
    strengths: allStrengths,
    failure_types: allIssues,
    risk_findings: riskFindings,
    improvement_suggestions: improvements,
  };
}
