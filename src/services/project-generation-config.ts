import type { Pool } from "pg";
import { qOne } from "../db/queries.js";
import {
  parseProjectOpenAiGenerationMode,
  type OpenAiGenerationMode,
} from "./openai-generation-placeholder.js";

export async function loadProjectOpenAiGenerationMode(
  db: Pool,
  projectId: string
): Promise<OpenAiGenerationMode | null> {
  try {
    const row = await qOne<{ openai_generation_mode: string | null }>(
      db,
      `SELECT openai_generation_mode FROM caf_core.project_system_constraints WHERE project_id = $1`,
      [projectId]
    );
    return parseProjectOpenAiGenerationMode(row?.openai_generation_mode);
  } catch {
    return null;
  }
}
