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

/** Repoint override PK when operators rename a DB prompt template row. */
export async function renamePromptLabsOverridePromptName(
  db: Pool,
  fromPromptName: string,
  toPromptName: string
): Promise<void> {
  const from = String(fromPromptName ?? "").trim();
  const to = String(toPromptName ?? "").trim();
  if (!from || !to || from === to) return;
  await db.query(
    `UPDATE caf_core.prompt_labs_overrides SET prompt_name = $2, updated_at = now() WHERE prompt_name = $1`,
    [from, to]
  );
}

/** Rename + update fields for a code-defined prompt override (single PK = prompt_name). */
export async function replacePromptLabsOverrideKey(
  db: Pool,
  fromPromptName: string,
  row: Omit<PromptLabsOverrideRow, "updated_at">
): Promise<PromptLabsOverrideRow | null> {
  const from = String(fromPromptName ?? "").trim();
  if (!from || from === row.prompt_name) {
    return upsertPromptLabsOverride(db, row);
  }
  const other = await qOne<{ prompt_name: string }>(
    db,
    `SELECT prompt_name FROM caf_core.prompt_labs_overrides WHERE prompt_name = $1`,
    [row.prompt_name]
  );
  if (other && other.prompt_name !== from) {
    throw new Error(
      `Another Prompt Labs override already uses prompt_name=${row.prompt_name}; delete or rename it first.`
    );
  }
  const out = await qOne<PromptLabsOverrideRow>(
    db,
    `UPDATE caf_core.prompt_labs_overrides SET
       prompt_name = $1,
       flow_type = $2,
       prompt_role = $3,
       system_prompt = $4,
       user_prompt_template = $5,
       output_format_rule = $6,
       notes = $7,
       updated_at = now()
     WHERE prompt_name = $8
     RETURNING prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template, output_format_rule, notes, updated_at`,
    [
      row.prompt_name,
      row.flow_type,
      row.prompt_role,
      row.system_prompt,
      row.user_prompt_template,
      row.output_format_rule,
      row.notes,
      from,
    ]
  );
  if (out) return out;
  return upsertPromptLabsOverride(db, row);
}

