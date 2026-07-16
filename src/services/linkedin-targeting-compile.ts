/**
 * Compile free-text LinkedIn targeting into a structured profile (LLM + heuristic fallback).
 */
import { z } from "zod";
import type { AppConfig } from "../config.js";
import {
  compileLinkedInTargetingHeuristic,
  parseLinkedInTargetingProfile,
  type LinkedInTargetingProfile,
} from "../domain/linkedin-targeting-profile.js";
import { openaiChat } from "./openai-chat.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";

const targetingLlmSchema = z.object({
  roles: z.array(z.string()).max(24).optional(),
  industries: z.array(z.string()).max(16).optional(),
  company_size_bands: z.array(z.string()).max(8).optional(),
  companies: z.array(z.string()).max(24).optional(),
  geo: z
    .object({
      languages: z.array(z.string()).max(12).optional(),
      person_locations: z.array(z.string()).max(16).optional(),
      company_hq: z.array(z.string()).max(16).optional(),
    })
    .optional(),
  topics_include: z.array(z.string()).max(32).optional(),
  topics_exclude: z.array(z.string()).max(24).optional(),
});

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.slice(0, 120));
  }
  return out;
}

export async function compileLinkedInTargetingFromFreeText(
  freeText: string,
  config: AppConfig
): Promise<LinkedInTargetingProfile> {
  const text = freeText.trim();
  if (!text) {
    return { ...compileLinkedInTargetingHeuristic(""), free_text: "" };
  }

  const heuristic = compileLinkedInTargetingHeuristic(text);
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) return heuristic;

  try {
    const out = await openaiChat(apiKey, {
      model: "gpt-4o-mini",
      system_prompt: `You compile LinkedIn research targeting for a B2B content brand into JSON.
Extract roles/job titles to monitor, industries, company size bands, named companies, geo (languages, person locations, company HQ), and topic include/exclude keywords.
Soft ranking only — never invent hard exclusions beyond explicit exclude language.
Return a single JSON object only.`,
      user_prompt: `Free-text targeting brief:

${text.slice(0, 6000)}

Return JSON:
{
  "roles": ["..."],
  "industries": ["..."],
  "company_size_bands": ["1-50"|"51-200"|"201-1000"|"1001-5000"|"5001+"],
  "companies": ["..."],
  "geo": { "languages": ["en"], "person_locations": ["Netherlands"], "company_hq": ["Europe"] },
  "topics_include": ["..."],
  "topics_exclude": ["..."]
}`,
      max_tokens: 2000,
      response_format: "json_object",
    });

    const raw = parseJsonObjectFromLlmText(out.content);
    const parsed = targetingLlmSchema.safeParse(raw);
    if (!parsed.success) return heuristic;

    const g = parsed.data.geo ?? {};
    const merged: LinkedInTargetingProfile = {
      schema_version: 1,
      free_text: text,
      roles: uniq([...(parsed.data.roles ?? []), ...heuristic.roles]),
      industries: uniq([...(parsed.data.industries ?? []), ...heuristic.industries]),
      company_size_bands: uniq([...(parsed.data.company_size_bands ?? []), ...heuristic.company_size_bands]),
      companies: uniq([...(parsed.data.companies ?? []), ...heuristic.companies]),
      geo: {
        languages: uniq([...(g.languages ?? []), ...heuristic.geo.languages]),
        person_locations: uniq([...(g.person_locations ?? []), ...heuristic.geo.person_locations]),
        company_hq: uniq([...(g.company_hq ?? []), ...heuristic.geo.company_hq]),
      },
      topics_include: uniq([...(parsed.data.topics_include ?? []), ...heuristic.topics_include]),
      topics_exclude: uniq([...(parsed.data.topics_exclude ?? []), ...heuristic.topics_exclude]),
      soft_only: true,
      compiled_at: new Date().toISOString(),
      compiled_by: "llm",
    };
    return parseLinkedInTargetingProfile(merged) ?? merged;
  } catch {
    return heuristic;
  }
}
