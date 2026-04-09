/**
 * HeyGen video generation: config merge, submit, poll, download (prefer status `video_url_caption` like n8n), Supabase upload, asset row.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { listHeygenConfig, type HeygenConfigRow } from "../repositories/project-config.js";
import { insertAsset } from "../repositories/assets.js";
import { uploadBuffer, downloadUrl } from "./supabase-storage.js";
import { extractSpokenScriptText, extractVideoPromptText } from "./video-gen-fields.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";

function rowMatchesPlatformAndFlow(
  r: HeygenConfigRow,
  platform: string | null,
  flowType: string | null
): boolean {
  if (r.platform && platform && r.platform.toLowerCase() !== platform.toLowerCase()) return false;
  if (r.flow_type && flowType && r.flow_type.toLowerCase() !== flowType.toLowerCase()) return false;
  return true;
}

/** Sheets often use render_mode PROMPT / SCRIPT; jobs use HEYGEN_AVATAR / HEYGEN_NO_AVATAR. */
function renderModesCompatible(
  rowRenderMode: string | null | undefined,
  jobRenderMode: string | null | undefined,
  flowType: string | null | undefined
): boolean {
  const r = rowRenderMode != null && String(rowRenderMode).trim() !== "" ? String(rowRenderMode).trim() : null;
  const j = jobRenderMode != null && String(jobRenderMode).trim() !== "" ? String(jobRenderMode).trim() : null;
  if (!r || !j) return true;
  if (r === j) return true;

  const ft = flowType ?? "";
  const scriptLed = /Video_Script|video_script|script_generator|Script_HeyGen/i.test(ft);
  const promptLed =
    !scriptLed &&
    (/Video_Prompt|video_prompt|prompt_generator|Prompt_HeyGen/i.test(ft) ||
      /no_avatar|heygen_no|HEYGEN_NO_AVATAR|NoAvatar/i.test(ft));

  const rowPrompt = /^PROMPT$/i.test(r);
  const rowScript = /^SCRIPT$/i.test(r);
  if (!rowPrompt && !rowScript) return false;

  const jobHeygen = j === "HEYGEN_AVATAR" || j === "HEYGEN_NO_AVATAR";
  if (!jobHeygen) return false;
  if (rowPrompt && promptLed) return true;
  if (rowScript && scriptLed) return true;
  return false;
}

function rowMatchesTarget(
  r: HeygenConfigRow,
  platform: string | null,
  flowType: string | null,
  renderMode: string | null
): boolean {
  if (!rowMatchesPlatformAndFlow(r, platform, flowType)) return false;
  if (r.render_mode && renderMode && !renderModesCompatible(r.render_mode, renderMode, flowType)) return false;
  return true;
}

/** Merge HeyGen key/value rows that match platform / flow / render_mode (wildcards allowed). */
export function mergeHeygenConfig(
  rows: HeygenConfigRow[],
  platform: string | null,
  flowType: string | null,
  renderMode: string | null
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (!rowMatchesTarget(r, platform, flowType, renderMode)) continue;
    if (!r.config_key) continue;
    let v: string | number | boolean = r.value ?? "";
    if (r.value_type === "number" && r.value != null) v = Number(r.value);
    if (r.value_type === "boolean" && r.value != null) v = r.value === "true" || r.value === "1";
    out[r.config_key] = v;
  }
  return out;
}

/** When the job payload omits render_route, infer from flow_type so heygen_config rows scoped to HEYGEN_NO_AVATAR match. */
export function inferHeygenRenderModeFromFlowType(flowType: string | null | undefined): string | null {
  const ft = flowType ?? "";
  if (/no_avatar|heygen_no|HEYGEN_NO_AVATAR|NoAvatar/i.test(ft)) return "HEYGEN_NO_AVATAR";
  if (/Video_Script_HeyGen_Avatar|Video_Prompt_HeyGen_Avatar|HeyGen_Avatar|FLOW_HEYGEN_AVATAR|HEYGEN_AVATAR_SCRIPT/i.test(ft)) {
    return "HEYGEN_AVATAR";
  }
  return null;
}

/** Resolve render mode: explicit payload wins, then flow_type inference, then HEYGEN_AVATAR. */
export function resolveHeygenRenderMode(flowType: string | null | undefined, explicit: unknown): string {
  const ex = explicit != null && String(explicit).trim() !== "" ? String(explicit).trim() : null;
  return ex ?? inferHeygenRenderModeFromFlowType(flowType) ?? "HEYGEN_AVATAR";
}

const VOICE_CONFIG_KEYS = new Set(["voice", "voice_id", "default_voice"]);

/**
 * Last-resort voice when DB config and HEYGEN_DEFAULT_VOICE_ID are unset (HeyGen public voice list / docs).
 * Prefer setting HEYGEN_DEFAULT_VOICE_ID or `voice` in heygen_config for your brand.
 */
const HEYGEN_FALLBACK_VOICE_ID = "55f8c0f546884f9cbdefa113f5e7b682";

function trimConfigString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/**
 * When Postgres `heygen_config` has no avatar for HEYGEN_AVATAR flows, apply Fly/env defaults.
 */
export function applyHeygenEnvAvatarDefaults(merged: Record<string, unknown>, appConfig: AppConfig): void {
  const hasPool =
    trimConfigString(merged.prompt_avatar_pool_json) ||
    trimConfigString(merged.script_avatar_pool_json) ||
    trimConfigString(merged.avatar_pool_json);
  const hasSingle =
    trimConfigString(merged.prompt_avatar_id) ||
    trimConfigString(merged.script_avatar_id) ||
    trimConfigString(merged.avatar_id);
  if (hasPool || hasSingle) return;

  const poolRaw = appConfig.HEYGEN_DEFAULT_AVATAR_POOL_JSON?.trim();
  if (poolRaw) {
    merged.avatar_pool_json = poolRaw;
    return;
  }
  const aid = appConfig.HEYGEN_DEFAULT_AVATAR_ID?.trim();
  if (aid) {
    merged.avatar_id = aid;
    merged.prompt_avatar_id = aid;
    merged.script_avatar_id = aid;
  }
}

function heygenMergedHasVoiceKey(merged: Record<string, unknown>): boolean {
  const v = merged.voice ?? merged.default_voice ?? merged.voice_id;
  if (v != null && String(v).trim() !== "") return true;
  return trimConfigString(merged.script_voice_id) != null;
}

/** If strict render_mode merge omitted voice, reuse a voice* row that matches platform+flow (any render_mode). */
function pickVoiceFromRowsIgnoringRenderMode(
  rows: HeygenConfigRow[],
  platform: string | null,
  flowType: string | null
): string | undefined {
  for (const r of rows) {
    if (!r.config_key || !VOICE_CONFIG_KEYS.has(r.config_key)) continue;
    if (!rowMatchesPlatformAndFlow(r, platform, flowType)) continue;
    const v = r.value?.trim();
    if (v) return v;
  }
  return undefined;
}

const AVATAR_POOL_CONFIG_KEYS = ["prompt_avatar_pool_json", "script_avatar_pool_json", "avatar_pool_json"] as const;
type AvatarPoolConfigKey = (typeof AVATAR_POOL_CONFIG_KEYS)[number];

function mergedHasHeygenAvatarSource(merged: Record<string, unknown>): boolean {
  for (const k of AVATAR_POOL_CONFIG_KEYS) {
    if (parseHeygenAvatarPoolJson(merged[k]).length > 0) return true;
  }
  if (
    trimConfigString(merged.prompt_avatar_id) ||
    trimConfigString(merged.script_avatar_id) ||
    trimConfigString(merged.avatar_id)
  ) {
    return true;
  }
  return false;
}

function heygenRowValueString(r: HeygenConfigRow): string {
  if (r.value == null) return "";
  if (r.value_type === "boolean") return r.value === "true" || r.value === "1" ? "true" : "false";
  if (r.value_type === "number" && r.value !== "") return String(Number(r.value));
  return String(r.value);
}

/**
 * Higher = better. Prefer same platform, then same flow_type, then any brand pool (e.g. Instagram pool for TikTok job).
 */
function heygenAvatarPoolRowScore(r: HeygenConfigRow, platform: string | null, flowType: string | null): number {
  const rp = r.platform != null ? String(r.platform).trim() : "";
  const jp = platform != null ? String(platform).trim() : "";
  const jobFt = flowType != null ? String(flowType).trim() : "";
  const rft = r.flow_type != null ? String(r.flow_type).trim() : "";

  let platformTier = 0;
  if (!rp || !jp) platformTier = 2000;
  else if (rp.toLowerCase() === jp.toLowerCase()) platformTier = 3000;
  else platformTier = 400;

  let flowTier = 0;
  if (!rft) flowTier = 80;
  else if (jobFt && rft.toLowerCase() === jobFt.toLowerCase()) flowTier = 100;
  else flowTier = 40;

  return platformTier + flowTier;
}

/**
 * When strict merge drops avatar pools (e.g. pool row is scoped to Video_Prompt_* but job is Video_Script_*),
 * reuse any project pool row. Prefers matching platform + flow_type; falls back to another platform's pool so
 * TikTok avatar jobs still get avatars when pools are only configured for Instagram.
 */
export function supplementMergedHeygenAvatarPoolsFromRows(
  merged: Record<string, unknown>,
  rows: HeygenConfigRow[],
  platform: string | null,
  flowType: string | null,
  renderMode: string | null
): void {
  const rm =
    renderMode != null && String(renderMode).trim() !== "" ? String(renderMode).trim() : inferHeygenRenderModeFromFlowType(flowType);
  if (rm !== "HEYGEN_AVATAR") return;
  if (mergedHasHeygenAvatarSource(merged)) return;

  let best: { row: HeygenConfigRow; score: number } | null = null;

  for (const r of rows) {
    if (!r.is_active) continue;
    if (!r.config_key || !AVATAR_POOL_CONFIG_KEYS.includes(r.config_key as AvatarPoolConfigKey)) continue;
    // Pools are shared across PROMPT/SCRIPT sheet rows and HEYGEN_AVATAR jobs; do not use renderModesCompatible here
    // (e.g. render_mode PROMPT + job HEYGEN_AVATAR + Video_Script_* would otherwise drop a valid brand pool).
    const rowRm = r.render_mode != null ? String(r.render_mode).trim().toUpperCase() : "";
    if (rowRm === "HEYGEN_NO_AVATAR") continue;

    const raw = heygenRowValueString(r);
    if (parseHeygenAvatarPoolJson(raw).length === 0) continue;

    const score = heygenAvatarPoolRowScore(r, platform, flowType);

    if (!best || score > best.score || (score === best.score && r.config_id.localeCompare(best.row.config_id) < 0)) {
      best = { row: r, score };
    }
  }

  if (!best) return;
  const pk = best.row.config_key as AvatarPoolConfigKey;
  merged[pk] = best.row.value ?? "";
}

/** Merge HeyGen rows for a job, then fill voice from platform/flow when render_mode scoping hid it. */
export function mergeHeygenConfigForJob(
  rows: HeygenConfigRow[],
  platform: string | null,
  flowType: string | null,
  renderMode: string | null
): Record<string, unknown> {
  const merged = mergeHeygenConfig(rows, platform, flowType, renderMode);
  supplementMergedHeygenAvatarPoolsFromRows(merged, rows, platform, flowType, renderMode);
  if (heygenMergedHasVoiceKey(merged)) return merged;
  const fallback = pickVoiceFromRowsIgnoringRenderMode(rows, platform, flowType);
  if (fallback) return { ...merged, voice: fallback };
  return merged;
}

/** Keys from Sheets / admin that must not be sent to HeyGen API. */
const HEYGEN_INTERNAL_CONFIG_KEYS = new Set([
  "heygen_model",
  "prompt_avatar_pool_json",
  "script_avatar_pool_json",
  "avatar_pool_json",
  "prompt_avatar_id",
  "script_avatar_id",
  "script_voice_id",
]);

function stripInternalHeygenConfigKeys(body: Record<string, unknown>): void {
  for (const k of HEYGEN_INTERNAL_CONFIG_KEYS) delete body[k];
}

export function isScriptLedHeygenFlow(flowType: string | null | undefined): boolean {
  const ft = flowType ?? "";
  return /Video_Script|video_script|script_generator|Script_HeyGen|HEYGEN_AVATAR_SCRIPT|FLOW_HEYGEN_AVATAR_SCRIPT/i.test(
    ft
  );
}

export function isPromptLedHeygenFlow(flowType: string | null | undefined): boolean {
  const ft = flowType ?? "";
  if (isScriptLedHeygenFlow(ft)) return false;
  return (
    /Video_Prompt|video_prompt|prompt_generator|Prompt_HeyGen|HEYGEN_AVATAR_PROMPT|FLOW_HEYGEN_AVATAR_PROMPT|HEYGEN_NO_AVATAR_PROMPT|FLOW_HEYGEN_NO_AVATAR_PROMPT/i.test(
      ft
    ) || /no_avatar|heygen_no|HEYGEN_NO_AVATAR|NoAvatar/i.test(ft)
  );
}

export type HeygenGeneratePath = "/v2/video/generate" | "/v1/video_agent/generate";

/**
 * n8n `3.2.2 - Video_Render - HeyGen`: SCRIPT_AVATAR → v2; PROMPT_AVATAR and SCRIPT_NO_AVATAR → Video Agent.
 */
export function resolveHeygenGeneratePath(
  flowType: string | null | undefined,
  renderMode: string | null | undefined
): HeygenGeneratePath {
  const rm =
    renderMode != null && String(renderMode).trim() !== ""
      ? String(renderMode).trim()
      : inferHeygenRenderModeFromFlowType(flowType) ?? "HEYGEN_AVATAR";
  if (rm === "HEYGEN_AVATAR" && isScriptLedHeygenFlow(flowType)) return "/v2/video/generate";
  return "/v1/video_agent/generate";
}

export type HeygenAvatarPoolEntry = { avatar_id: string; voice_id: string };

function normalizePoolEntries(arr: unknown[]): HeygenAvatarPoolEntry[] {
  const out: HeygenAvatarPoolEntry[] = [];
  for (const x of arr) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const aid = String(o.avatar_id ?? o.avatarId ?? "").trim();
    const vid = String(o.voice_id ?? o.voiceId ?? "").trim();
    /** avatar_id alone is valid — voice can come from another heygen_config row or env (see resolveVoiceIdForPoolEntry). */
    if (aid) out.push({ avatar_id: aid, voice_id: vid });
  }
  return out;
}

/** After picking from a pool: use paired voice_id, else merged config / script_voice_id / defaults. */
function resolveVoiceIdForPoolEntry(
  body: Record<string, unknown>,
  picked: HeygenAvatarPoolEntry,
  scriptLed: boolean
): string {
  const fromPick = String(picked.voice_id ?? "").trim();
  if (fromPick) return fromPick;
  if (scriptLed) {
    const sv = trimConfigString(body.script_voice_id);
    if (sv) return sv;
  }
  const fromBody =
    trimConfigString(body.voice_id) ??
    trimConfigString(body.default_voice_id) ??
    trimConfigString(body.default_voice) ??
    (typeof body.voice === "string" ? trimConfigString(body.voice) : undefined);
  if (fromBody) return fromBody;
  const envV = trimConfigString(process.env.HEYGEN_DEFAULT_VOICE_ID);
  if (envV) return envV;
  return HEYGEN_FALLBACK_VOICE_ID;
}

/** Parse `prompt_avatar_pool_json`-style values (string JSON or array). */
export function parseHeygenAvatarPoolJson(val: unknown): HeygenAvatarPoolEntry[] {
  if (val == null) return [];
  if (Array.isArray(val)) return normalizePoolEntries(val);
  if (typeof val !== "string") return [];
  const t = val.trim();
  if (!t.startsWith("[")) return [];
  try {
    const p = JSON.parse(t) as unknown;
    return Array.isArray(p) ? normalizePoolEntries(p) : [];
  } catch {
    return [];
  }
}

/** Stable pick so the same task (or scene seed) always gets the same avatar. */
export function stablePickIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % length;
}

function mergeCharacterWithAvatarId(
  body: Record<string, unknown>,
  avatarId: string
): Record<string, unknown> {
  const existing = body.character;
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? ({ ...(existing as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const t = String(base.type ?? "avatar").trim() || "avatar";
  return { ...base, type: t, avatar_id: avatarId };
}

/**
 * Resolves Sheets-style avatar pools (`prompt_avatar_pool_json` / `script_avatar_pool_json`) into
 * `character` + top-level voice ids. Skips avatar injection for no-avatar flows.
 */
export function applyHeygenAvatarFromSheetConfig(
  body: Record<string, unknown>,
  opts: { flowType?: string | null; pickSeed?: string | null }
): void {
  const ft = opts.flowType ?? "";
  if (/no_avatar|heygen_no|HEYGEN_NO_AVATAR|NoAvatar/i.test(ft)) return;

  const scriptLed = isScriptLedHeygenFlow(ft);
  const promptLed = isPromptLedHeygenFlow(ft);

  /** Prefer flow-specific pool key first, then shared pools — one `prompt_avatar_pool_json` can back both script and prompt avatar flows. */
  const poolKeys = scriptLed
    ? (["script_avatar_pool_json", "avatar_pool_json", "prompt_avatar_pool_json"] as const)
    : promptLed
      ? (["prompt_avatar_pool_json", "avatar_pool_json", "script_avatar_pool_json"] as const)
      : (["avatar_pool_json", "prompt_avatar_pool_json", "script_avatar_pool_json"] as const);

  const seed = opts.pickSeed != null && String(opts.pickSeed).trim() !== "" ? String(opts.pickSeed) : "";

  for (const key of poolKeys) {
    const pool = parseHeygenAvatarPoolJson(body[key]);
    if (pool.length === 0) continue;
    const idx = seed ? stablePickIndex(seed, pool.length) : 0;
    const picked = pool[idx]!;
    const voiceId = resolveVoiceIdForPoolEntry(body, picked, scriptLed);
    body.character = mergeCharacterWithAvatarId(body, picked.avatar_id);
    body.voice_id = voiceId;
    body.voice = voiceId;
    return;
  }

  /**
   * Flow-specific ids (prompt vs script) are preferred; many Sheets exports use a single `avatar_id`
   * config_key for all HeyGen flows — without this fallback those rows never become `character`.
   */
  const avatarKey = scriptLed ? "script_avatar_id" : promptLed ? "prompt_avatar_id" : "avatar_id";
  let singleAvatar = trimConfigString(body[avatarKey]);
  if (!singleAvatar) {
    singleAvatar = trimConfigString(body.avatar_id);
  }
  if (singleAvatar) {
    body.character = mergeCharacterWithAvatarId(body, singleAvatar);
  }

  if (scriptLed) {
    const sv = trimConfigString(body.script_voice_id);
    if (sv) {
      body.voice_id = sv;
      body.voice = sv;
    }
  }
}

export type HeygenAgentDurationBounds = {
  /** Below this (after parsing) we treat the value as unreliable and bump to at least `minSec`. */
  minSec: number;
  maxSec: number;
  /** When `estimated_runtime_seconds` / merged duration fields are missing or non-numeric. */
  missingFallbackSec: number;
};

/**
 * HeyGen Video Agent accepts very short durations; we clamp so missing/broken LLM output does not produce 5s videos.
 */
export function resolveHeygenAgentDurationSec(raw: unknown, bounds: HeygenAgentDurationBounds): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1) return bounds.missingFallbackSec;
  if (n < bounds.minSec) return bounds.minSec;
  return Math.min(bounds.maxSec, n);
}

function cleanHeygenAgentText(s: string): string {
  return String(s || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function heygenAgentOnScreenLines(gen: Record<string, unknown>, maxItems: number, maxChars: number): string[] {
  const ost = gen.on_screen_text;
  if (!Array.isArray(ost)) return [];
  const out: string[] = [];
  for (const x of ost) {
    if (typeof x !== "string" || !x.trim()) continue;
    const t = x.trim();
    out.push(t.length <= maxChars ? t : `${t.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`);
    if (out.length >= maxItems) break;
  }
  return out;
}

function heygenAgentStringifyField(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return cleanHeygenAgentText(val);
  if (typeof val === "object" && !Array.isArray(val)) {
    try {
      return cleanHeygenAgentText(JSON.stringify(val));
    } catch {
      return "";
    }
  }
  return cleanHeygenAgentText(String(val));
}

export type HeygenVideoAgentMode = "prompt_avatar" | "no_avatar";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/**
 * LLMs often still emit on-camera framing for voiceover-only agent jobs; strip host/speaker cues for HeyGen no-avatar.
 */
export function sanitizeGenForHeygenNoAvatar(gen: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...gen };
  const cam = asRecord(out.camera_instructions);
  if (!cam) return out;
  const framing = String(cam.framing ?? "");
  const movement = String(cam.movement ?? "");
  const toxic = /speaker|host|presenter|talking\s*head|on[-\s]?camera|the\s+host|centered\s+on\s+the\s+speaker|face\s+to\s+camera/i;
  if (!toxic.test(framing) && !toxic.test(movement)) return out;
  out.camera_instructions = {
    ...cam,
    framing:
      "No on-camera talent. Voiceover-only: full-frame motion graphics, kinetic type, abstract backgrounds, and licensed-style b-roll — no presenter, host, or talking head.",
    movement: toxic.test(movement)
      ? "Slow parallax on graphics; gentle drift on b-roll; no talent-facing camera moves."
      : movement,
  };
  return out;
}

/** Static lines prepended to every Video Agent prompt (for admin Prompt labs / docs). */
export const HEYGEN_VIDEO_AGENT_RUBRIC_LINES = [
  "Create a polished short-form social video.",
  "Orientation: <from config, default portrait>.",
  "Target duration: about <duration_sec> seconds.",
  "prompt_avatar: use assigned avatar; keep pacing tight and native to short-form.",
  "no_avatar: forbid avatar/presenter/host; narration + graphics/b-roll/text only.",
] as const;

/**
 * HeyGen Video Agent (`POST /v1/video_agent/generate`) body aligned with n8n PROMPT_AVATAR / SCRIPT_NO_AVATAR builders.
 */
export function buildHeyGenVideoAgentRequestBody(
  mergedConfig: Record<string, unknown>,
  gen: Record<string, unknown>,
  override: Record<string, unknown> | undefined,
  opts: {
    flowType?: string | null;
    taskId?: string | null;
    avatarPickSeed?: string | null;
    agentMode: HeygenVideoAgentMode;
    /** When omitted, uses a safe default (20–300s) suitable for unit tests only; production callers should pass config-derived bounds. */
    durationBounds?: HeygenAgentDurationBounds;
  }
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...mergedConfig };
  coerceHeyGenMergedFields(merged);
  applyHeygenAvatarFromSheetConfig(merged, {
    flowType: opts.flowType,
    pickSeed: opts.avatarPickSeed ?? opts.taskId,
  });

  const genUse = opts.agentMode === "no_avatar" ? sanitizeGenForHeygenNoAvatar(gen) : gen;

  const orientation =
    trimConfigString(merged.orientation) ??
    trimConfigString(merged.default_orientation) ??
    "portrait";

  const durationBounds =
    opts.durationBounds ??
    ({
      minSec: 20,
      maxSec: 300,
      missingFallbackSec: 30,
    } satisfies HeygenAgentDurationBounds);

  const durationSec = resolveHeygenAgentDurationSec(
    genUse.estimated_runtime_seconds ?? merged.duration_sec ?? merged.default_duration_sec,
    durationBounds
  );

  const hook = cleanHeygenAgentText(String(genUse.hook ?? "").trim());
  const spokenScript = cleanHeygenAgentText(extractSpokenScriptText(genUse, 1));
  const cta = cleanHeygenAgentText(String(genUse.cta ?? "").trim());
  const caption = cleanHeygenAgentText(String(genUse.caption ?? "").trim());
  const disclaimer = cleanHeygenAgentText(String(genUse.disclaimer ?? "").trim());
  const videoPrompt = cleanHeygenAgentText(extractVideoPromptText(genUse, 1));
  const onScreenText = heygenAgentOnScreenLines(genUse, 12, 60);

  const lines: string[] = [];
  lines.push("Create a polished short-form social video.");
  lines.push(`Orientation: ${orientation}.`);
  lines.push(`Target duration: about ${durationSec} seconds.`);
  if (opts.agentMode === "prompt_avatar") {
    lines.push("Use the assigned avatar if supported by the render route.");
    lines.push("Make it feel native to short-form social media.");
    lines.push("Keep pacing tight, clear, and engaging.");
    lines.push("Output should be production-ready.");
  } else {
    lines.push("Do not show an avatar, presenter, talking head, spokesperson, or host on screen.");
    lines.push(
      "Use narration with scene-driven visuals, motion graphics, text overlays, b-roll, and cuts only."
    );
  }

  if (hook) lines.push(`Hook: ${hook}`);
  if (spokenScript) lines.push(`Main spoken content: ${spokenScript}`);
  if (videoPrompt && videoPrompt !== spokenScript) lines.push(`Visual / generation prompt: ${videoPrompt}`);
  if (onScreenText.length) lines.push(`On-screen text cues: ${onScreenText.join(" | ")}`);

  const visual = heygenAgentStringifyField(genUse.visual_direction);
  if (visual) lines.push(`Visual direction: ${visual}`);
  const camera = heygenAgentStringifyField(genUse.camera_instructions);
  if (camera) lines.push(`Camera instructions: ${camera}`);
  const editing = heygenAgentStringifyField(genUse.editing_notes);
  if (editing) lines.push(`Editing notes: ${editing}`);

  if (cta) lines.push(`Ending CTA: ${cta}`);
  if (caption) lines.push(`Caption context: ${caption}`);
  const tags = genUse.hashtags;
  if (Array.isArray(tags) && tags.length) {
    const flat = tags
      .filter((t): t is string => typeof t === "string" && t.trim() !== "")
      .map((t) => t.trim());
    if (flat.length) lines.push(`Hashtag context: ${flat.join(" ")}`);
  } else if (typeof tags === "string" && tags.trim() !== "") {
    lines.push(`Hashtag context: ${tags.trim()}`);
  }
  if (disclaimer) lines.push(`Required disclaimer: ${disclaimer}`);

  const prompt = lines.join("\n").trim();
  if (!prompt) {
    throw new Error(
      "HeyGen Video Agent: empty prompt. Add spoken_script, video_prompt, hook, or plan fields in generated_output."
    );
  }

  const out: Record<string, unknown> = {
    prompt,
    duration_sec: durationSec,
    orientation,
  };

  if (opts.agentMode === "prompt_avatar") {
    const ch = merged.character;
    const cr =
      ch && typeof ch === "object" && !Array.isArray(ch) ? (ch as Record<string, unknown>) : null;
    let avatarId = trimConfigString(cr?.avatar_id);
    if (!avatarId) avatarId = trimConfigString(merged.avatar_id);
    if (!avatarId) {
      throw new Error(
        "HeyGen Video Agent (prompt + avatar): set prompt_avatar_pool_json, prompt_avatar_id, or avatar config in heygen_config for this job."
      );
    }
    out.avatar_id = avatarId;
  }

  const cb = trimConfigString(merged.callback_url);
  if (cb) out.callback_url = cb;

  const body = override && Object.keys(override).length > 0 ? deepMerge(out, override) : out;
  stripInternalHeygenConfigKeys(body);
  if (opts.agentMode === "no_avatar" && "avatar_id" in body) delete body.avatar_id;

  return body;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function extractVideoId(json: Record<string, unknown>): string | null {
  const data = json.data as Record<string, unknown> | undefined;
  const id =
    (data?.video_id as string) ??
    (json.video_id as string) ??
    (data?.id as string) ??
    (json.id as string);
  return id ? String(id) : null;
}

function getHeyGenNumericCode(json: Record<string, unknown>): number | undefined {
  const c = json.code;
  if (c == null) return undefined;
  if (typeof c === "number" && Number.isFinite(c)) return c;
  const n = Number(c);
  return Number.isFinite(n) ? n : undefined;
}

/** HeyGen wraps payloads in `{ code: 100, data, message }`. Non-100 was previously misread as status "unknown" → poll timeout. */
function throwIfHeyGenBusinessError(json: Record<string, unknown>, where: string): void {
  const code = getHeyGenNumericCode(json);
  if (code !== undefined && code !== 100) {
    const m = String(json.message ?? json.msg ?? "").trim() || `API code ${code}`;
    throw new Error(`HeyGen ${where}: ${m}`);
  }
}

function extractVideoUrl(json: Record<string, unknown>): string | null {
  const data = json.data as Record<string, unknown> | undefined;
  const fromResult = (): string | undefined => {
    const r = data?.result;
    if (!r || typeof r !== "object" || Array.isArray(r)) return undefined;
    const o = r as Record<string, unknown>;
    const u = o.video_url ?? o.url ?? o.download_url;
    return typeof u === "string" && u.trim() ? u.trim() : undefined;
  };
  const url =
    (data?.video_url as string) ??
    (data?.download_url as string) ??
    (data?.output_url as string) ??
    (json.video_url as string) ??
    (data?.url as string) ??
    ((data?.video as Record<string, unknown>)?.url as string) ??
    fromResult();
  return url ? String(url).trim() : null;
}

function trimUrlString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/**
 * n8n `3.2.2 - Video_Render - HeyGen` downloads `data.video_url_caption || video_url_caption` for Supabase upload
 * (burned-in captions). Plain `video_url` is the non-caption render.
 */
export function pickHeyGenDownloadUrlFromStatus(json: Record<string, unknown>): {
  url: string | null;
  usedVideoUrlCaption: boolean;
} {
  const data = json.data as Record<string, unknown> | undefined;
  const caption =
    trimUrlString(data?.video_url_caption) ?? trimUrlString(json.video_url_caption);
  if (caption) return { url: caption, usedVideoUrlCaption: true };
  const plain = extractVideoUrl(json);
  return { url: plain, usedVideoUrlCaption: false };
}

export async function submitHeyGenVideo(
  apiKey: string,
  apiBase: string,
  body: Record<string, unknown>,
  path: HeygenGeneratePath = "/v2/video/generate"
): Promise<string> {
  const base = apiBase.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HeyGen generate ${res.status}: ${text.slice(0, 800)}`);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("HeyGen generate: invalid JSON");
  }
  throwIfHeyGenBusinessError(json, `generate ${path}`);
  const vid = extractVideoId(json);
  if (!vid) throw new Error(`HeyGen generate: no video_id in response: ${text.slice(0, 400)}`);
  return vid;
}

export async function getHeyGenVideoStatus(
  apiKey: string,
  apiBase: string,
  videoId: string
): Promise<{
  status: string;
  videoUrl: string | null;
  usedVideoUrlCaption: boolean;
  raw: Record<string, unknown>;
}> {
  const base = apiBase.replace(/\/$/, "");
  const url = `${base}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, {
    headers: { "X-Api-Key": apiKey },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HeyGen status ${res.status}: ${text.slice(0, 400)}`);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `HeyGen status: response is not JSON (${res.status}). Preview: ${text.slice(0, 240)}`
    );
  }
  throwIfHeyGenBusinessError(json, "video_status.get");
  const data = json.data as Record<string, unknown> | undefined;
  const status = String(data?.status ?? json.status ?? "unknown")
    .trim()
    .toLowerCase();
  const { url: videoUrl, usedVideoUrlCaption } = pickHeyGenDownloadUrlFromStatus(json);
  return { status, videoUrl, usedVideoUrlCaption, raw: json };
}

function isHeyGenSuccessStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return (
    s === "completed" ||
    s === "complete" ||
    s === "success" ||
    s === "succeeded" ||
    s === "done"
  );
}

function isHeyGenFailureStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return (
    s === "failed" ||
    s === "error" ||
    s === "cancelled" ||
    s === "canceled"
  );
}

/**
 * Video Agent sometimes returns `status: completed` before `video_url` is populated; retry briefly instead of failing.
 */
async function waitForHeyGenDownloadUrl(
  apiKey: string,
  apiBase: string,
  videoId: string,
  usedVideoUrlCaption: boolean,
  initialUrl: string | null
): Promise<{ videoUrl: string; usedVideoUrlCaption: boolean }> {
  if (initialUrl) return { videoUrl: initialUrl, usedVideoUrlCaption };
  let delayMs = 500;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(Math.round(delayMs * 1.2), 4000);
    const st = await getHeyGenVideoStatus(apiKey, apiBase, videoId);
    if (st.videoUrl) {
      return { videoUrl: st.videoUrl, usedVideoUrlCaption: st.usedVideoUrlCaption };
    }
    if (isHeyGenFailureStatus(st.status)) {
      const raw = st.raw;
      const data = raw.data as Record<string, unknown> | undefined;
      const blob =
        data?.error ?? data?.error_msg ?? data?.message ?? raw.message ?? raw.error;
      const detail =
        typeof blob === "string"
          ? blob.trim()
          : blob != null && typeof blob === "object"
            ? JSON.stringify(blob).slice(0, 500)
            : blob != null
              ? String(blob).slice(0, 500)
              : "";
      throw new Error(
        detail
          ? `HeyGen video ${videoId} failed while waiting for URL: ${detail}`
          : `HeyGen video ${videoId} failed while waiting for URL`
      );
    }
  }
  throw new Error(
    "HeyGen completed but no video_url (or video_url_caption) in status payload after retries — check HeyGen dashboard for this video_id"
  );
}

export async function pollHeyGenUntilComplete(
  apiKey: string,
  apiBase: string,
  videoId: string,
  opts?: { maxMs?: number }
): Promise<{ videoUrl: string; usedVideoUrlCaption: boolean }> {
  const maxMs = opts?.maxMs ?? 600_000;
  const start = Date.now();
  let delay = 1000;
  while (Date.now() - start < maxMs) {
    const { status, videoUrl, usedVideoUrlCaption, raw } = await getHeyGenVideoStatus(
      apiKey,
      apiBase,
      videoId
    );
    if (isHeyGenSuccessStatus(status)) {
      return waitForHeyGenDownloadUrl(apiKey, apiBase, videoId, usedVideoUrlCaption, videoUrl);
    }
    if (isHeyGenFailureStatus(status)) {
      const data = raw.data as Record<string, unknown> | undefined;
      const blob =
        data?.error ?? data?.error_msg ?? data?.message ?? raw.message ?? raw.error;
      const detail =
        typeof blob === "string"
          ? blob.trim()
          : blob != null && typeof blob === "object"
            ? JSON.stringify(blob).slice(0, 500)
            : blob != null
              ? String(blob).slice(0, 500)
              : "";
      throw new Error(
        detail
          ? `HeyGen video ${videoId} failed: ${detail}`
          : `HeyGen video ${videoId} failed (no error detail in status payload)`
      );
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30_000);
  }
  throw new Error(`HeyGen poll timeout for video_id=${videoId}`);
}

export interface HeygenJobContext {
  id: string;
  task_id: string;
  project_id: string;
  run_id: string;
  flow_type: string;
  platform: string | null;
  generation_payload: Record<string, unknown>;
}

function trimVoiceId(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/** HeyGen v2 `video_inputs[].voice` for TTS must include discriminator `type: "text"` plus `voice_id` (not a bare string). */
function extractVoiceIdFromHeygenVoiceValue(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string" || typeof v === "number") return trimVoiceId(v);
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return trimVoiceId(o.voice_id ?? o.voiceId ?? o.id);
  }
  return undefined;
}

function heygenVoiceDiscriminatorType(voice: unknown): string | undefined {
  if (voice == null || typeof voice !== "object" || Array.isArray(voice)) return undefined;
  const t = String((voice as Record<string, unknown>).type ?? "").trim().toLowerCase();
  return t === "" ? undefined : t;
}

/** Leave `audio` / `silence` payloads untouched (discriminator + type-specific fields). */
function isHeygenNonTextVoice(voice: unknown): boolean {
  const t = heygenVoiceDiscriminatorType(voice);
  return t === "audio" || t === "silence";
}

/** Spoken lines for TTS only — never use `prompt` (visual description) as `voice.input_text`. */
function trimSpeechForHeygenVideoInput(row: Record<string, unknown>): string | undefined {
  return trimConfigString(row.script_text);
}

function clampHeygenSilenceDurationSec(sec: number): number {
  const n = Math.round(Number(sec));
  if (!Number.isFinite(n)) return 15;
  return Math.min(100, Math.max(1, n));
}

/**
 * Normalize to HeyGen v2 `video_inputs[n].voice` for TTS: discriminator `type` + `voice_id`.
 * Optional speech (usually `script_text`, else `prompt`) becomes `input_text` when not already set on the voice object.
 */
function coerceHeygenVoiceToV2Object(
  voice: unknown,
  voiceId: string,
  speechForInputText?: unknown
): Record<string, unknown> {
  if (isHeygenNonTextVoice(voice)) {
    return { ...(voice as Record<string, unknown>) };
  }
  const base =
    voice != null && typeof voice === "object" && !Array.isArray(voice)
      ? ({ ...(voice as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const scriptFromScene = trimConfigString(speechForInputText);
  const scriptInVoice = trimConfigString(base.input_text);
  const out: Record<string, unknown> = {
    ...base,
    type: "text",
    voice_id: voiceId,
  };
  if (scriptFromScene && !scriptInVoice) out.input_text = scriptFromScene;
  return out;
}

/** HeyGen sheets/legacy rows often use `voice_id` or `default_voice_id`; nested character may carry voice. */
function pickVoiceFromBody(body: Record<string, unknown>, defaultVoiceId?: string | null): string | undefined {
  for (const k of ["voice", "default_voice", "voice_id", "default_voice_id"] as const) {
    const t = trimVoiceId(body[k]);
    if (t) return t;
  }
  const scriptV = trimVoiceId(body.script_voice_id);
  if (scriptV) return scriptV;
  const char = body.character;
  if (char && typeof char === "object" && !Array.isArray(char)) {
    const c = char as Record<string, unknown>;
    for (const k of ["voice", "voice_id", "default_voice", "default_voice_id"] as const) {
      const t = trimVoiceId(c[k]);
      if (t) return t;
    }
  }
  const tDef = trimVoiceId(defaultVoiceId);
  if (tDef) return tDef;
  const envV = trimVoiceId(process.env.HEYGEN_DEFAULT_VOICE_ID);
  if (envV) return envV;
  return HEYGEN_FALLBACK_VOICE_ID;
}

/** DB / sheet imports sometimes store JSON arrays or objects as strings. */
function coerceHeyGenMergedFields(body: Record<string, unknown>): void {
  const vi = body.video_inputs;
  if (typeof vi === "string") {
    const t = vi.trim();
    if (t.startsWith("[")) {
      try {
        const p = JSON.parse(t) as unknown;
        if (Array.isArray(p)) body.video_inputs = p;
      } catch {
        /* keep string */
      }
    }
  }
  const ch = body.character;
  if (typeof ch === "string") {
    const t = ch.trim();
    if (t.startsWith("{")) {
      try {
        const p = JSON.parse(t) as unknown;
        if (p && typeof p === "object" && !Array.isArray(p)) body.character = p;
      } catch {
        /* keep string */
      }
    }
  }
}

function resolveVoiceForVideoInput(
  first: Record<string, unknown>,
  body: Record<string, unknown>,
  defaultVoiceId?: string | null
): string | undefined {
  const fromVoiceField = extractVoiceIdFromHeygenVoiceValue(first.voice);
  if (fromVoiceField) return fromVoiceField;
  const fromFirst =
    trimVoiceId(first.voice_id) ??
    trimVoiceId(first.default_voice) ??
    trimVoiceId(first.default_voice_id);
  if (fromFirst) return fromFirst;
  return pickVoiceFromBody(body, defaultVoiceId);
}

/**
 * Build HeyGen v2 body: ensure required `video_inputs` and `video_inputs[0].voice`
 * (API rejects missing fields even when character/script live only on the merged config object).
 */
export function buildHeyGenRequestBody(
  mergedConfig: Record<string, unknown>,
  gen: Record<string, unknown>,
  override: Record<string, unknown> | undefined,
  opts?: {
    defaultVoiceId?: string | null;
    flowType?: string | null;
    taskId?: string | null;
    /** Overrides taskId for avatar pool hashing (e.g. task_id + scene index). */
    avatarPickSeed?: string | null;
    /** Seconds for HeyGen `voice: { type: "silence" }` when there is only a visual prompt (no spoken script). */
    visualOnlySilenceDurationSec?: number;
  }
): Record<string, unknown> {
  const script = extractSpokenScriptText(gen, 1);
  const prompt = extractVideoPromptText(gen, 1);

  let body: Record<string, unknown> = { ...mergedConfig };
  coerceHeyGenMergedFields(body);
  applyHeygenAvatarFromSheetConfig(body, {
    flowType: opts?.flowType,
    pickSeed: opts?.avatarPickSeed ?? opts?.taskId,
  });

  if (typeof body.video_inputs === "undefined" && (script || prompt)) {
    const voice = pickVoiceFromBody(body, opts?.defaultVoiceId);
    body = deepMerge(body, {
      video_inputs: [
        {
          ...(body.character != null ? { character: body.character } : {}),
          ...(voice ? { voice } : {}),
          ...(script ? { script_text: script } : {}),
          ...(prompt ? { prompt } : {}),
        },
      ],
    });
  }

  if (override && Object.keys(override).length > 0) {
    body = deepMerge(body, override);
  }

  const viRaw = body.video_inputs;
  if (!Array.isArray(viRaw) || viRaw.length === 0) {
    if (!script && !prompt) {
      throw new Error(
        "HeyGen: missing video_inputs and no spoken_script/script or video_prompt in generated_output. Configure heygen_config or fix LLM output."
      );
    }
    const voice = pickVoiceFromBody(body, opts?.defaultVoiceId);
    body.video_inputs = [
      {
        ...(body.character != null ? { character: body.character } : {}),
        ...(voice ? { voice } : {}),
        ...(script ? { script_text: script } : {}),
        ...(prompt ? { prompt } : {}),
      },
    ];
  } else {
    const first = (typeof viRaw[0] === "object" && viRaw[0] && !Array.isArray(viRaw[0])
      ? ({ ...(viRaw[0] as Record<string, unknown>) } as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const voice = resolveVoiceForVideoInput(first, body, opts?.defaultVoiceId);
    const mergedFirst: Record<string, unknown> = {
      ...first,
      ...(first.character == null && body.character != null ? { character: body.character } : {}),
      ...(voice ? { voice } : {}),
      ...(script && (first.script_text == null || String(first.script_text).trim() === "")
        ? { script_text: script }
        : {}),
      ...(prompt && (first.prompt == null || String(first.prompt).trim() === "") ? { prompt } : {}),
    };
    body.video_inputs = [mergedFirst, ...viRaw.slice(1)];
  }

  const viArr = body.video_inputs as Record<string, unknown>[];
  const head0 = viArr[0];
  if (head0 && typeof head0 === "object" && !Array.isArray(head0)) {
    const z0 = head0 as Record<string, unknown>;
    const effScript = trimConfigString(script) ?? trimConfigString(z0.script_text);
    const effPrompt = trimConfigString(prompt) ?? trimConfigString(z0.prompt);
    if (effPrompt && !effScript && !isHeygenNonTextVoice(z0.voice)) {
      const d = clampHeygenSilenceDurationSec(opts?.visualOnlySilenceDurationSec ?? 15);
      z0.voice = { type: "silence", duration: String(d) };
    }
  }

  if (opts?.flowType && inferHeygenRenderModeFromFlowType(opts.flowType) === "HEYGEN_AVATAR") {
    const h = viArr[0];
    if (h && typeof h === "object" && !Array.isArray(h)) {
      const c = (h as Record<string, unknown>).character;
      const cr = c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
      const hasChar =
        Boolean(trimConfigString(cr?.avatar_id)) || Boolean(trimConfigString(cr?.talking_photo_id));
      if (!hasChar) {
        throw new Error(
          "HeyGen avatar flow requires an avatar: set prompt_avatar_pool_json, prompt_avatar_id, script_avatar_pool_json, script_avatar_id, or avatar_pool_json in heygen_config for this project (match platform/flow/render_mode rows as needed)."
        );
      }
    }
  }

  // `override` deepMerge may replace video_inputs[0] without voice — fill id from config / default.
  const head = viArr[0];
  if (head && typeof head === "object" && !Array.isArray(head)) {
    const z = head as Record<string, unknown>;
    if (!isHeygenNonTextVoice(z.voice) && !extractVoiceIdFromHeygenVoiceValue(z.voice)) {
      const fill = pickVoiceFromBody(body, opts?.defaultVoiceId) ?? trimVoiceId(opts?.defaultVoiceId);
      if (fill) z.voice = coerceHeygenVoiceToV2Object(z.voice, fill, trimSpeechForHeygenVideoInput(z));
    }
  }

  for (let i = 0; i < viArr.length; i++) {
    const raw = viArr[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (isHeygenNonTextVoice(row.voice)) continue;
    let vid = extractVoiceIdFromHeygenVoiceValue(row.voice);
    if (!vid && i === 0) {
      vid = pickVoiceFromBody(body, opts?.defaultVoiceId) ?? trimVoiceId(opts?.defaultVoiceId);
    }
    if (vid) row.voice = coerceHeygenVoiceToV2Object(row.voice, vid, trimSpeechForHeygenVideoInput(row));
  }

  const vi0 = viArr[0];
  const v0Voice = vi0 && typeof vi0 === "object" && !Array.isArray(vi0) ? (vi0 as Record<string, unknown>).voice : null;
  const v0Id = vi0 && typeof vi0 === "object" && !Array.isArray(vi0)
    ? extractVoiceIdFromHeygenVoiceValue((vi0 as Record<string, unknown>).voice)
    : undefined;
  const v0Silence = heygenVoiceDiscriminatorType(v0Voice) === "silence";
  if (!v0Id && !v0Silence) {
    throw new Error(
      "HeyGen: video_inputs[0].voice ({ type: \"text\", voice_id }) is required for TTS. In heygen_config use config_key `voice` or `voice_id` (or nest voice on `character`), or set HEYGEN_DEFAULT_VOICE_ID in the environment."
    );
  }

  stripInternalHeygenConfigKeys(body);
  return body;
}

export interface HeyGenRunAudit {
  db: Pool;
  projectId: string;
  runId: string;
  taskId: string;
  step: string;
  scene_index?: number;
}

export async function runHeygenVideoWithBody(
  appConfig: AppConfig,
  body: Record<string, unknown>,
  audit?: HeyGenRunAudit | null,
  opts?: { postPath?: HeygenGeneratePath }
): Promise<{ videoUrl: string; videoId: string; usedVideoUrlCaption: boolean }> {
  const apiKey = appConfig.HEYGEN_API_KEY?.trim();
  if (!apiKey) throw new Error("HEYGEN_API_KEY not configured");
  const postPath = opts?.postPath ?? "/v2/video/generate";
  const endpoint = `${appConfig.HEYGEN_API_BASE.replace(/\/$/, "")}${postPath}`;
  try {
    const videoId = await submitHeyGenVideo(apiKey, appConfig.HEYGEN_API_BASE, body, postPath);
    const { videoUrl, usedVideoUrlCaption } = await pollHeyGenUntilComplete(
      apiKey,
      appConfig.HEYGEN_API_BASE,
      videoId
    );
    if (audit) {
      await tryInsertApiCallAudit(audit.db, {
        projectId: audit.projectId,
        runId: audit.runId,
        taskId: audit.taskId,
        step: audit.step,
        provider: "heygen",
        model: null,
        ok: true,
        requestJson: { endpoint, body, scene_index: audit.scene_index },
        responseJson: {
          video_id: videoId,
          video_url: videoUrl,
          used_video_url_caption: usedVideoUrlCaption,
        },
      });
    }
    return { videoUrl, videoId, usedVideoUrlCaption };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (audit) {
      await tryInsertApiCallAudit(audit.db, {
        projectId: audit.projectId,
        runId: audit.runId,
        taskId: audit.taskId,
        step: audit.step,
        provider: "heygen",
        model: null,
        ok: false,
        errorMessage: msg.slice(0, 4000),
        requestJson: { endpoint, body, scene_index: audit.scene_index },
        responseJson: {},
      });
    }
    throw err;
  }
}

export async function runHeygenForContentJob(
  db: Pool,
  appConfig: AppConfig,
  job: HeygenJobContext
): Promise<{ public_url: string | null; object_path: string | null; video_id: string }> {
  const apiKey = appConfig.HEYGEN_API_KEY?.trim();
  if (!apiKey) throw new Error("HEYGEN_API_KEY not configured");

  const rows = await listHeygenConfig(db, job.project_id);
  const gen = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
  const renderMode = resolveHeygenRenderMode(
    job.flow_type,
    job.generation_payload.render_mode ?? gen.render_mode ?? gen.production_route
  );

  const merged = mergeHeygenConfigForJob(rows, job.platform, job.flow_type, renderMode);
  applyHeygenEnvAvatarDefaults(merged, appConfig);
  const override = job.generation_payload.heygen_request as Record<string, unknown> | undefined;
  const postPath = resolveHeygenGeneratePath(job.flow_type, renderMode);
  const body =
    postPath === "/v2/video/generate"
      ? buildHeyGenRequestBody(merged, gen, override, {
          defaultVoiceId: appConfig.HEYGEN_DEFAULT_VOICE_ID,
          flowType: job.flow_type,
          taskId: job.task_id,
          visualOnlySilenceDurationSec: appConfig.HEYGEN_VISUAL_ONLY_SILENCE_DURATION_SEC,
        })
      : buildHeyGenVideoAgentRequestBody(merged, gen, override, {
          flowType: job.flow_type,
          taskId: job.task_id,
          agentMode: renderMode === "HEYGEN_NO_AVATAR" ? "no_avatar" : "prompt_avatar",
          durationBounds: {
            minSec: appConfig.HEYGEN_AGENT_MIN_DURATION_SEC,
            maxSec: 300,
            missingFallbackSec: appConfig.VIDEO_TARGET_DURATION_MIN_SEC,
          },
        });

  const { videoUrl, videoId, usedVideoUrlCaption } = await runHeygenVideoWithBody(
    appConfig,
    body,
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: "heygen_video_generate",
    },
    { postPath }
  );

  const buf = await downloadUrl(videoUrl);
  const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const objectPath = `videos/${safeRun}/${safeTask}/heygen_${videoId}.mp4`;

  let publicUrl: string | null = null;
  let storedObjectPath = objectPath;
  try {
    const up = await uploadBuffer(appConfig, objectPath, buf, "video/mp4");
    publicUrl = up.public_url;
    storedObjectPath = up.object_path;
  } catch {
    // Supabase optional in dev
  }

  const assetId = `${job.task_id}__VIDEO_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  await insertAsset(db, {
    asset_id: assetId,
    task_id: job.task_id,
    project_id: job.project_id,
    asset_type: "VIDEO",
    asset_version: "1",
    bucket: appConfig.SUPABASE_ASSETS_BUCKET,
    object_path: storedObjectPath,
    public_url: publicUrl,
    provider: "heygen",
    position: 0,
    metadata_json: {
      video_id: videoId,
      source_url: videoUrl,
      heygen_used_video_url_caption: usedVideoUrlCaption,
    },
  });

  return { public_url: publicUrl, object_path: storedObjectPath, video_id: videoId };
}
