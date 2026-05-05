import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export type PromptLabsOverrideRow = {
  prompt_name: string;
  flow_type: string | null;
  prompt_role: string | null;
  system_prompt: string | null;
  user_prompt_template: string | null;
  output_format_rule: string | null;
  notes: string | null;
  updated_at: string;
};

export async function listPromptLabsOverrides(db: Pool): Promise<PromptLabsOverrideRow[]> {
  return q<PromptLabsOverrideRow>(
    db,
    `SELECT prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template, output_format_rule, notes, updated_at
     FROM caf_core.prompt_labs_overrides
     ORDER BY prompt_name ASC`
  );
}

export async function upsertPromptLabsOverride(
  db: Pool,
  row: Omit<PromptLabsOverrideRow, "updated_at">
): Promise<PromptLabsOverrideRow> {
  const out = await qOne<PromptLabsOverrideRow>(
    db,
    `INSERT INTO caf_core.prompt_labs_overrides
      (prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template, output_format_rule, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (prompt_name) DO UPDATE SET
       flow_type = EXCLUDED.flow_type,
       prompt_role = EXCLUDED.prompt_role,
       system_prompt = EXCLUDED.system_prompt,
       user_prompt_template = EXCLUDED.user_prompt_template,
       output_format_rule = EXCLUDED.output_format_rule,
       notes = EXCLUDED.notes,
       updated_at = now()
     RETURNING prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template, output_format_rule, notes, updated_at`,
    [
      row.prompt_name,
      row.flow_type,
      row.prompt_role,
      row.system_prompt,
      row.user_prompt_template,
      row.output_format_rule,
      row.notes,
    ]
  );
  if (!out) throw new Error("Failed to upsert prompt labs override");
  return out;
}

export async function deletePromptLabsOverride(db: Pool, promptName: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.prompt_labs_overrides WHERE prompt_name = $1`, [promptName]);
}

