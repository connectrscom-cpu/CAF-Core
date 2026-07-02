/**
 * Project-agnostic copy/metadata quality checks for QC runtime.
 * Brand-specific terms come from brand_constraints.banned_words (qc-runtime risk scan).
 */

export interface CopyQualityFinding {
  check_id: string;
  check_name: string;
  passed: boolean;
  severity: string;
  blocking: boolean;
  failure_message: string | null;
  details?: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function hashtagsFromContent(content: Record<string, unknown>): string[] {
  const raw = content.hashtags ?? content.generated_hashtags;
  if (Array.isArray(raw)) {
    return raw.map((h) => str(h)).filter(Boolean);
  }
  const asText = str(raw);
  if (!asText) return [];
  return asText.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
}

function allCopyText(content: Record<string, unknown>): string {
  const parts = [
    str(content.hook),
    str(content.generated_hook),
    str(content.caption),
    str(content.generated_caption),
    str(content.title),
    str(content.generated_title),
  ];
  const slides = content.slides ?? content.variations;
  if (Array.isArray(slides)) {
    for (const s of slides) {
      if (!s || typeof s !== "object") continue;
      const rec = s as Record<string, unknown>;
      parts.push(str(rec.headline), str(rec.body), str(rec.title), str(rec.cover));
    }
  }
  return parts.filter(Boolean).join("\n");
}

const MEME_CONTRAST_PATTERN = /\bborn to\b[\s\S]{0,80}\bforced to\b/i;

const PLATITUDE_PATTERNS = [
  /\babundance and serenity\b/i,
  /\bcollective awakening\b/i,
  /\bthe world is changing\b/i,
  /\bpeace[, ]+love[, ]+and blessings\b/i,
  /\byou(?:'|')?re not imagining\b/i,
];

const GENERIC_HOOK_PATTERNS = [
  /^did you know/i,
  /^check this out/i,
  /^here(?:'|')s (?:a|the)/i,
  /^top \d+/i,
  /^you won(?:'|')t believe/i,
];

const HASHTAG_PLACEHOLDER = /^#?example$/i;

export function runCopyQualityChecks(
  content: Record<string, unknown>,
  opts?: { brandTone?: string | null; minHashtags?: number }
): CopyQualityFinding[] {
  const findings: CopyQualityFinding[] = [];
  const text = allCopyText(content);
  const hook = str(content.hook) || str(content.generated_hook) || str(content.title);
  const tags = hashtagsFromContent(content);
  const minTags = opts?.minHashtags ?? 1;

  if (MEME_CONTRAST_PATTERN.test(text)) {
    findings.push({
      check_id: "copy_meme_contrast_template",
      check_name: "Meme contrast template",
      passed: false,
      severity: "HIGH",
      blocking: true,
      failure_message: "Copy uses meme contrast template (born to X / forced to Y)",
    });
  }

  for (const p of PLATITUDE_PATTERNS) {
    if (p.test(text)) {
      findings.push({
        check_id: "copy_platitude_pattern",
        check_name: "Generic platitude",
        passed: false,
        severity: "MEDIUM",
        blocking: true,
        failure_message: "Copy matches generic affirmation / platitude pattern",
        details: p.source,
      });
      break;
    }
  }

  if (hook && GENERIC_HOOK_PATTERNS.some((p) => p.test(hook))) {
    findings.push({
      check_id: "copy_generic_hook",
      check_name: "Generic hook",
      passed: false,
      severity: "MEDIUM",
      blocking: true,
      failure_message: "Hook matches generic social template",
    });
  }

  const tagJoined = tags.join(" ").toLowerCase();
  if (tags.length === 0 || tags.every((t) => HASHTAG_PLACEHOLDER.test(t.replace(/^#/, "")))) {
    findings.push({
      check_id: "metadata_hashtags_missing",
      check_name: "Hashtags required",
      passed: false,
      severity: "MEDIUM",
      blocking: true,
      failure_message: "Hashtags missing or still placeholder (#example)",
    });
  } else if (tags.length < minTags) {
    findings.push({
      check_id: "metadata_hashtags_min",
      check_name: "Minimum hashtags",
      passed: false,
      severity: "LOW",
      blocking: false,
      failure_message: `Fewer than ${minTags} hashtag(s)`,
    });
  }

  if (/#memes?\b/i.test(tagJoined)) {
    findings.push({
      check_id: "metadata_hashtag_meme",
      check_name: "Meme hashtag",
      passed: false,
      severity: "MEDIUM",
      blocking: true,
      failure_message: "Hashtags include meme tags (#memes)",
    });
  }

  const tone = str(opts?.brandTone).toLowerCase();
  if (tone.includes("warm") || tone.includes("emotionally intelligent")) {
    if (/\byou must\b/i.test(text) || /\bstop being\b/i.test(text)) {
      findings.push({
        check_id: "copy_tone_mismatch",
        check_name: "Tone mismatch",
        passed: false,
        severity: "MEDIUM",
        blocking: true,
        failure_message: "Aggressive phrasing conflicts with brand tone",
      });
    }
  }

  return findings;
}
