/**
 * Optional OpenAI pass: reads human reviewer `notes` alongside aggregates and proposes
 * actions (learning vs prompts vs code). Output is structured JSON + a markdown block for coding agents.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";

const NOTE_MAX_CHARS = 480;
const MAX_NOTE_ROWS = 40;

export interface EditorialNoteRow {
  task_id: string;
  decision: string | null;
  flow_type: string | null;
  platform: string | null;
  /** Base template name (e.g. `carousel_sns_chat_story`) when available. */
  carousel_template_name?: string | null;
  /** Repo path hint for template-driven issues (when template name is known). */
  carousel_template_path_hint?: string | null;
  rejection_tags: unknown[];
  note: string;
  created_at: string;
}

export interface LlmNotesTheme {
  theme: string;
  approx_count?: number;
  example_quotes?: string[];
}

export interface LlmNotesAction {
  category: string;
  priority: string;
  title: string;
  /** When action is template-specific, which template(s) it applies to. */
  carousel_template_name?: string | string[] | null;
  /** Repo path(s) to change, e.g. `services/renderer/templates/default.hbs`. */
  where_to_change?: string | string[] | null;
  rationale: string;
  suggested_next_steps: string;
  example_task_ids: string[];
}

export interface EditorialNotesLlmSynthesis {
  model: string;
  summary: string;
  recurring_themes: LlmNotesTheme[];
  recommended_actions: LlmNotesAction[];
  coding_agent_markdown: string;
  total_tokens: number;
}

export interface EditorialNotesLlmSkipped {
  skipped: true;
  reason: string;
}

export type EditorialNotesLlmResult = EditorialNotesLlmSynthesis | EditorialNotesLlmSkipped;

function trimNote(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= NOTE_MAX_CHARS) return t;
  return `${t.slice(0, NOTE_MAX_CHARS)}…`;
}

function safeParseSynthesisJson(raw: string): Partial<EditorialNotesLlmSynthesis> | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      summary: typeof o.summary === "string" ? o.summary : "",
      recurring_themes: Array.isArray(o.recurring_themes) ? (o.recurring_themes as LlmNotesTheme[]) : [],
      recommended_actions: Array.isArray(o.recommended_actions) ? (o.recommended_actions as LlmNotesAction[]) : [],
      coding_agent_markdown:
        typeof o.coding_agent_markdown === "string" ? o.coding_agent_markdown : "",
    };
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You are an analyst for CAF (Content Automation Framework), a system that generates content jobs, renders carousels/videos, and records human editorial reviews.

You receive:
- Aggregate stats from the review window (tags, overrides, flow approval, deterministic insights).
- Individual review rows that include reviewer-written **notes** (only rows with non-empty notes are included), plus the carousel template name when available.

Your job:
1. Convert the notes into **guidelines** that improve next generations: what was good/bad about the body/script, what failed structurally, and what should be consistently enforced.
2. When notes reference visuals (fonts, spacing, caption overlays, slide layout, cropping), treat it as a template-level issue and anchor recommendations to the specific 'carousel_template_name' when possible.
3. Recommend concrete actions. Categories must be one of: learning_rule, generation_prompt, renderer_template, review_ui, pipeline, process, other.
4. Every action must include **where to change** as concrete repo paths. Prefer:
   - renderer templates: 'services/renderer/templates/<carousel_template_name>.hbs' (use 'carousel_template_path_hint' if provided)
   - renderer/template selection logic: 'src/services/carousel-render-pack.ts'
   - editorial learning loop: 'src/services/editorial-learning.ts'
   - review UI: 'apps/review/src/**'
3. For each action, set priority to high, medium, or low.
4. Prefer **small, verifiable changes**. Preserve CAF text IDs: do not suggest renaming task_id / run_id schemes.
5. When the issue is visual layout, typography, cropping, or template binding, point engineers at services/renderer (Handlebars) and related paths.
6. When the issue is copy, tone, or structure from the LLM, point at generation prompts / llm-generator paths.
7. learning_rule means something expressible as ranking/suppression/generation guidance rules, not necessarily code.

For 'recommended_actions', add these fields:
- carousel_template_name: string | string[] | null — required for renderer_template issues when the evidence contains a template name
- where_to_change: string | string[] | null — required for every action; must be concrete repo paths

Respond with a single JSON object only (no markdown fences), keys:
- summary: string (2-4 sentences)
- recurring_themes: array of { theme: string, approx_count?: number, example_quotes?: string[] } (max 8 themes)
- recommended_actions: array of { category: string, priority: string, title: string, carousel_template_name?: string|string[]|null, where_to_change?: string|string[]|null, rationale: string, suggested_next_steps: string, example_task_ids: string[] } (max 10)
- coding_agent_markdown: string — a single markdown document for a coding agent (Cursor/Claude) listing what to change in the repo, with evidence task_ids and acceptance criteria. Use an empty string if no code change is appropriate.`;

/**
 * Runs OpenAI on reviewer notes + aggregates. Returns skipped result if no key, no notes, or failure.
 */
export async function synthesizeEditorialNotesWithLlm(
  db: Pool,
  config: AppConfig,
  projectId: string,
  params: {
    projectSlug: string;
    windowDays: number;
    aggregate: Record<string, unknown>;
    noteRows: EditorialNoteRow[];
  }
): Promise<EditorialNotesLlmResult> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { skipped: true, reason: "OPENAI_API_KEY not configured" };
  }

  const withNotes = params.noteRows.filter((r) => r.note.trim().length > 0);
  if (withNotes.length === 0) {
    return { skipped: true, reason: "no_reviewer_notes_in_window" };
  }

  const payload = {
    project_slug: params.projectSlug,
    window_days: params.windowDays,
    aggregate: params.aggregate,
    reviews_with_notes: withNotes.slice(0, MAX_NOTE_ROWS).map((r) => ({
      task_id: r.task_id,
      decision: r.decision,
      flow_type: r.flow_type,
      platform: r.platform,
      carousel_template_name: r.carousel_template_name ?? null,
      carousel_template_path_hint: r.carousel_template_path_hint ?? null,
      rejection_tags: Array.isArray(r.rejection_tags) ? r.rejection_tags : [],
      note: trimNote(r.note),
      created_at: r.created_at,
    })),
  };

  const userPrompt = `Analyze the following editorial evidence and produce the JSON object described in your instructions.\n\n${JSON.stringify(payload)}`;

  try {
    const out = await openaiChat(
      apiKey,
      {
        model: config.OPENAI_MODEL,
        system_prompt: SYSTEM_PROMPT,
        user_prompt: userPrompt,
        max_tokens: openAiMaxTokens(4096),
        response_format: "json_object",
      },
      {
        db,
        projectId,
        step: "editorial_notes_synthesis",
      }
    );

    const parsed = safeParseSynthesisJson(out.content);
    if (!parsed) {
      return { skipped: true, reason: "llm_invalid_json" };
    }

    return {
      model: out.model,
      summary: parsed.summary ?? "",
      recurring_themes: parsed.recurring_themes ?? [],
      recommended_actions: parsed.recommended_actions ?? [],
      coding_agent_markdown: parsed.coding_agent_markdown ?? "",
      total_tokens: out.total_tokens,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { skipped: true, reason: `openai_error:${msg.slice(0, 500)}` };
  }
}
