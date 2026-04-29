/**
 * HeyGen video generation: config merge, submit, poll, download (prefer status `video_url_caption` like n8n), Supabase upload, asset row.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { randomInt } from "node:crypto";
import {
  getBrandConstraints,
  getProductProfile,
  listHeygenConfig,
  listProjectBrandAssets,
  resolveProductFlowHeygenMode,
  type HeygenConfigRow,
} from "../repositories/project-config.js";
import { isProductVideoFlow, productVideoAgentPromptSuffix } from "../domain/product-flow-types.js";
import { brandAssetsToHeygenFiles, mergeHeygenVideoAgentFiles } from "./brand-heygen-files.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import { buildProductVideoAgentBrandPromptBlock } from "./product-video-agent-brand.js";
import { buildProductProfilePromptBlock } from "./product-video-agent-product.js";
import { insertAsset } from "../repositories/assets.js";
import {
  uploadBuffer,
  downloadUrl,
  createSignedUrlForObjectKey,
  downloadBufferFromUrl,
} from "./supabase-storage.js";
import { extractSpokenScriptText, extractVideoPromptText } from "./video-gen-fields.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import { enforceHeygenSpokenScriptWordLaw } from "./heygen-spoken-script-enforcement.js";
import { buildRoughSrt } from "./caption-generator.js";
import { parseVideoAssemblyJson, pollVideoAssemblyJob } from "./video-assembly-client.js";

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

/** Optional `voice_id` for `POST /v3/video-agents` (brand voice); omit if unset so the agent can choose. */
function pickVoiceIdForVideoAgentOverride(merged: Record<string, unknown>): string | undefined {
  for (const k of ["voice", "default_voice", "voice_id", "default_voice_id", "script_voice_id"] as const) {
    const t = trimConfigString(merged[k]);
    if (t) return t;
  }
  const char = merged.character;
  if (char && typeof char === "object" && !Array.isArray(char)) {
    const c = char as Record<string, unknown>;
    for (const k of ["voice", "voice_id", "default_voice", "default_voice_id"] as const) {
      const t = trimConfigString(c[k]);
      if (t) return t;
    }
  }
  return trimConfigString(process.env.HEYGEN_DEFAULT_VOICE_ID);
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
  /** Pool picked avatar but no paired voice — v3 omits voice_id (avatar default); do not inject unrelated env voice. */
  "heygen_allow_missing_voice_for_avatar",
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

/** HeyGen v3 (recommended). `/v2/video/generate` kept only for `voice.type: silence` (visual-only) which has no v3 equivalent. */
export type HeygenGeneratePath = "/v3/videos" | "/v3/video-agents" | "/v2/video/generate";

/**
 * n8n `3.2.2 - Video_Render - HeyGen` routing, upgraded to v3:
 * - Script + avatar → `POST /v3/videos` (unless silence-voice visual-only → legacy v2).
 * - Prompt avatar + no-avatar agent → `POST /v3/video-agents`.
 *
 * v3 has no caption parameter on the create endpoint, so captions are added afterwards by
 * `runHeygenForContentJob` (download SRT from `data.subtitle_url` or synthesize, then burn via
 * the video-assembly `/burn-subtitles` service).
 */
export function resolveHeygenGeneratePath(
  flowType: string | null | undefined,
  renderMode: string | null | undefined
): HeygenGeneratePath {
  const rm =
    renderMode != null && String(renderMode).trim() !== ""
      ? String(renderMode).trim()
      : inferHeygenRenderModeFromFlowType(flowType) ?? "HEYGEN_AVATAR";
  if (rm === "HEYGEN_AVATAR" && isScriptLedHeygenFlow(flowType)) return "/v3/videos";
  return "/v3/video-agents";
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

/**
 * After picking from a pool: use paired voice_id; script-led flows avoid unrelated merged `voice` rows.
 * Prompt-led flows still use merged `voice` / env when the pool entry has no voice (v2-style compatibility).
 */
function resolveVoiceIdForPoolEntry(
  body: Record<string, unknown>,
  picked: HeygenAvatarPoolEntry,
  scriptLed: boolean
): string | undefined {
  const fromPick = String(picked.voice_id ?? "").trim();
  if (fromPick) return fromPick;
  if (scriptLed) {
    const sv = trimConfigString(body.script_voice_id);
    if (sv) return sv;
    return undefined;
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

/**
 * Round-robin index for a structured task / scene seed (`{run}__…__row{NNNN}__v{N}` or `…__scene_{i}`).
 * Returns -1 when the seed has no `row` / `scene` / `v` markers so callers can fall back to a hash pick.
 *
 * Composition rule: `(row - 1) + (variation - 1) + scene` (each missing axis contributes 0). This makes:
 * - row0001/v1/scene0 → 0, row0002/v1/scene0 → 1, row0003/v1/scene0 → 2 (round-robin across a run);
 * - row0001/scene_1   → 1 (consecutive scenes within a multi-scene job rotate);
 * - row0001/v2        → 1 (variations of the same row also rotate, so v1/v2 of the same row don't collide).
 *
 * Same `(row, scene, v)` triple → same index, so the pick stays stable across retries / restarts.
 */
export function roundRobinIndexFromSeed(seed: string, length: number): number {
  if (length <= 0) return 0;
  const rowM = /(?:^|[^a-z0-9])row0*(\d+)(?:[^a-z0-9]|$)/i.exec(seed);
  const sceneM = /(?:^|[^a-z0-9])scene[_-]?0*(\d+)(?:[^a-z0-9]|$)/i.exec(seed);
  const varM = /(?:^|[^a-z0-9])v0*(\d+)(?:[^a-z0-9]|$)/i.exec(seed);
  if (!rowM && !sceneM && !varM) return -1;
  const row = rowM ? Math.max(1, parseInt(rowM[1]!, 10) || 1) : 1;
  const scene = sceneM ? Math.max(0, parseInt(sceneM[1]!, 10) || 0) : 0;
  const variation = varM ? Math.max(1, parseInt(varM[1]!, 10) || 1) : 1;
  const counter = (row - 1) + (variation - 1) + scene;
  return ((counter % length) + length) % length;
}

/**
 * Pool index pick: round-robin when the seed encodes per-run row/scene/variation; FNV-like hash fallback
 * for ad-hoc seeds. Same task always returns the same index either way.
 */
export function stablePickIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  const rr = roundRobinIndexFromSeed(seed, length);
  if (rr >= 0) return rr;
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
    // Stable pick when a seed is provided (task_id / avatarPickSeed). When absent, allow randomness so
    // manual/operator runs don't always reuse the same avatar+voice pair.
    // Voice is resolved from the picked entry first, so avatar+voice pairing is preserved when provided.
    const idx = seed ? stablePickIndex(seed, pool.length) : randomInt(pool.length);
    const picked = pool[idx]!;
    const pickedHasVoice = Boolean(String(picked.voice_id ?? "").trim());
    if (scriptLed && !pickedHasVoice) {
      for (const vk of ["voice", "voice_id", "default_voice", "default_voice_id"] as const) {
        delete body[vk];
      }
    }
    const voiceId = resolveVoiceIdForPoolEntry(body, picked, scriptLed);
    body.character = mergeCharacterWithAvatarId(body, picked.avatar_id);
    if (voiceId) {
      body.voice_id = voiceId;
      body.voice = voiceId;
    } else {
      delete body.voice_id;
      delete body.voice;
      if (scriptLed && !pickedHasVoice) {
        body.heygen_allow_missing_voice_for_avatar = true;
      }
    }
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
 * HeyGen Video Agent request builder (n8n PROMPT_AVATAR / SCRIPT_NO_AVATAR semantics).
 * Normalize with {@link normalizeHeyGenVideoAgentRequestForV3} before `POST /v3/video-agents` (v3 rejects unknown keys).
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
    /**
     * Who writes the voiceover:
     *  - `"user_provided"` (default, legacy): include our `spoken_script` as "Main spoken content"
     *    so the agent delivers it roughly verbatim. Use when the job actually has a spoken_script
     *    we want HeyGen to speak.
     *  - `"agent_writes"`: omit the "Main spoken content" line. Use for prompt-led product flows
     *    where we deliberately skip ensureVideoScriptInPayload — the agent authors its own VO
     *    from the visual / hook / cta context. This prevents HeyGen from paraphrasing a stale
     *    or uncoordinated spoken_script and instead produces VO grounded in the same brief
     *    that drives the visuals.
     */
    spokenMode?: "user_provided" | "agent_writes";
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

  const spokenMode = opts.spokenMode ?? "user_provided";
  if (hook) lines.push(`Hook: ${hook}`);
  if (spokenMode === "user_provided" && spokenScript) {
    lines.push(`Main spoken content: ${spokenScript}`);
  } else if (spokenMode === "agent_writes") {
    lines.push(
      "Voiceover: write a natural, on-brand narration from the hook + visual direction + CTA below. Keep it tight, punchy, and native to short-form — do not read product specs as a list."
    );
  }
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
    const voicePick = pickVoiceIdForVideoAgentOverride(merged);
    if (voicePick) out.voice_id = voicePick;
  }

  const stylePick = trimConfigString(merged.style_id ?? merged.heygen_style_id);
  if (stylePick) out.style_id = stylePick;

  const modePick = trimConfigString(merged.video_agent_mode ?? merged.agent_mode);
  if (modePick === "chat" || modePick === "generate") out.mode = modePick;

  const cb = trimConfigString(merged.callback_url);
  if (cb) out.callback_url = cb;

  const body = override && Object.keys(override).length > 0 ? deepMerge(out, override) : out;
  stripInternalHeygenConfigKeys(body);
  if (opts.agentMode === "no_avatar" && "avatar_id" in body) delete body.avatar_id;

  return body;
}

const HEYGEN_V3_VIDEO_AGENT_KEYS = new Set([
  "prompt",
  "mode",
  "avatar_id",
  "voice_id",
  "style_id",
  "orientation",
  "files",
  "callback_url",
  "callback_id",
  "incognito_mode",
]);

/**
 * v3 `POST /v3/video-agents` uses `additionalProperties: false` — strip legacy-only fields (`duration_sec`, etc.).
 */
export function normalizeHeyGenVideoAgentRequestForV3(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of HEYGEN_V3_VIDEO_AGENT_KEYS) {
    if (body[k] !== undefined && body[k] !== null) out[k] = body[k];
  }
  return out;
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

function extractSessionId(json: Record<string, unknown>): string | null {
  const data = json.data as Record<string, unknown> | undefined;
  const s = data?.session_id;
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

const HEYGEN_SESSION_VIDEO_ID_MAX_MS = 180_000;
/** Per-call timeout for the submit POST and each session-poll GET — prevents an unsignaled fetch from hanging the worker indefinitely (Node fetch has no default outer timeout). */
const HEYGEN_HTTP_PER_CALL_TIMEOUT_MS = 60_000;

/**
 * Hooks fired before the long video poll so the caller can persist resume keys to durable storage.
 * Without these, a worker death between submit and `HeygenPollTimeoutError` loses the HeyGen ids and
 * forces a brand-new submission on retry (double-billing).
 */
export interface HeygenSubmitProgress {
  /** Fired when the v3 video-agents POST returns a `session_id` (no `video_id` yet). */
  onSession?: (sessionId: string) => Promise<void> | void;
  /** Fired as soon as we have a HeyGen `video_id` (either directly from POST or after session poll). */
  onVideoId?: (videoId: string) => Promise<void> | void;
}

async function safeProgress(fn: (() => Promise<void> | void) | undefined): Promise<void> {
  if (!fn) return;
  try {
    await fn();
  } catch (e) {
    /** Persistence is best-effort; never break the HeyGen submission because the caller's bookkeeping failed. */
    console.warn("[heygen] progress callback failed", e);
  }
}

async function pollHeyGenSessionForVideoId(
  apiKey: string,
  apiBase: string,
  sessionId: string
): Promise<string> {
  const base = apiBase.replace(/\/$/, "");
  const url = `${base}/v3/video-agents/${encodeURIComponent(sessionId)}`;
  const start = Date.now();
  let delay = 1500;
  while (Date.now() - start < HEYGEN_SESSION_VIDEO_ID_MAX_MS) {
    const res = await fetch(url, {
      headers: { "X-Api-Key": apiKey },
      signal: AbortSignal.timeout(HEYGEN_HTTP_PER_CALL_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HeyGen session ${res.status}: ${text.slice(0, 400)}`);
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`HeyGen session: invalid JSON (${text.slice(0, 200)})`);
    }
    throwIfHeyGenStandardApiError(json, "get video agent session");
    throwIfHeyGenBusinessError(json, "get video agent session");
    const vid = extractVideoId(json);
    if (vid) return vid;
    const data = json.data as Record<string, unknown> | undefined;
    const st = String(data?.status ?? "").trim().toLowerCase();
    if (st === "failed") {
      const detail = JSON.stringify(data?.messages ?? data).slice(0, 600);
      throw new Error(`HeyGen Video Agent session failed: ${detail}`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.25), 8000);
  }
  throw new Error(
    `HeyGen Video Agent: no video_id after ${HEYGEN_SESSION_VIDEO_ID_MAX_MS}ms for session_id=${sessionId} — poll GET /v3/video-agents/{session_id} timed out`
  );
}

function getHeyGenNumericCode(json: Record<string, unknown>): number | undefined {
  const c = json.code;
  if (c == null) return undefined;
  if (typeof c === "number" && Number.isFinite(c)) return c;
  const n = Number(c);
  return Number.isFinite(n) ? n : undefined;
}

/** v3 `{ error: { code, message } }` shape (HTTP 200 is uncommon but handle it). */
function throwIfHeyGenStandardApiError(json: Record<string, unknown>, where: string): void {
  const err = json.error;
  if (err && typeof err === "object" && !Array.isArray(err)) {
    const o = err as Record<string, unknown>;
    const m = String(o.message ?? o.code ?? "error").trim();
    if (m) throw new Error(`HeyGen ${where}: ${m}`);
  }
}

/** HeyGen wraps payloads in `{ code: 100, data, message }`. Non-100 was previously misread as status "unknown" → poll timeout. */
function throwIfHeyGenBusinessError(json: Record<string, unknown>, where: string): void {
  throwIfHeyGenStandardApiError(json, where);
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
  const fromOutput = (): string | undefined => {
    const out = data?.output;
    if (!out || typeof out !== "object" || Array.isArray(out)) return undefined;
    const o = out as Record<string, unknown>;
    const u = o.video_url ?? o.url ?? o.download_url ?? o.file_url;
    return typeof u === "string" && u.trim() ? u.trim() : undefined;
  };
  const url =
    (data?.video_url as string) ??
    (data?.download_url as string) ??
    (data?.output_url as string) ??
    (json.video_url as string) ??
    (data?.url as string) ??
    ((data?.video as Record<string, unknown>)?.url as string) ??
    fromResult() ??
    fromOutput();
  return url ? String(url).trim() : null;
}

function trimUrlString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/**
 * n8n `3.2.2 - Video_Render - HeyGen` downloads `data.video_url_caption || video_url_caption` for Supabase upload
 * (burned-in captions, only ever set for v2 / proofread workflows). Plain `video_url` is the non-caption render.
 *
 * v3 `POST /v3/videos` with `caption: { file_format: "srt" }` returns `data.subtitle_url` (standalone SRT) — the
 * MP4 itself is **not** modified. CAF burns that SRT into the video locally via video-assembly. `durationSec` is
 * surfaced when HeyGen exposes it so we can synthesize a fallback SRT for paths that don't return one.
 */
export function pickHeyGenDownloadUrlFromStatus(json: Record<string, unknown>): {
  url: string | null;
  usedVideoUrlCaption: boolean;
  subtitleUrl: string | null;
  durationSec: number | null;
} {
  const data = json.data as Record<string, unknown> | undefined;
  const caption =
    trimUrlString(data?.video_url_caption) ??
    trimUrlString(data?.captioned_video_url) ??
    trimUrlString(json.video_url_caption);
  const subtitleUrl =
    trimUrlString(data?.subtitle_url) ??
    trimUrlString(data?.caption_url) ??
    trimUrlString(data?.captions_url) ??
    trimUrlString(json.subtitle_url) ??
    null;
  const durationSec = pickHeyGenDurationFromStatus(json);
  if (caption) return { url: caption, usedVideoUrlCaption: true, subtitleUrl, durationSec };
  const plain = extractVideoUrl(json);
  return { url: plain, usedVideoUrlCaption: false, subtitleUrl, durationSec };
}

function pickHeyGenDurationFromStatus(json: Record<string, unknown>): number | null {
  const data = json.data as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    data?.duration,
    data?.duration_sec,
    data?.duration_seconds,
    (data?.video as Record<string, unknown> | undefined)?.duration,
    (data?.result as Record<string, unknown> | undefined)?.duration,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const n = typeof c === "number" ? c : Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export async function submitHeyGenVideo(
  apiKey: string,
  apiBase: string,
  body: Record<string, unknown>,
  path: HeygenGeneratePath,
  progress?: HeygenSubmitProgress
): Promise<string> {
  const base = apiBase.replace(/\/$/, "");
  const payload = path === "/v3/video-agents" ? normalizeHeyGenVideoAgentRequestForV3(body) : body;
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(HEYGEN_HTTP_PER_CALL_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HeyGen generate ${res.status}: ${text.slice(0, 800)}`);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("HeyGen generate: invalid JSON");
  }
  throwIfHeyGenStandardApiError(json, `generate ${path}`);
  throwIfHeyGenBusinessError(json, `generate ${path}`);
  let vid = extractVideoId(json);
  if (!vid && path === "/v3/video-agents") {
    const sid = extractSessionId(json);
    if (sid) {
      /** Persist `session_id` BEFORE the (up to 180s) session poll so worker death is recoverable without re-submitting. */
      await safeProgress(progress?.onSession ? () => progress.onSession!(sid) : undefined);
      vid = await pollHeyGenSessionForVideoId(apiKey, apiBase, sid);
    }
  }
  if (!vid) throw new Error(`HeyGen generate: no video_id in response: ${text.slice(0, 400)}`);
  /** Persist `video_id` BEFORE the (up to HEYGEN_POLL_MAX_MS, default 45min) video status poll. */
  await safeProgress(progress?.onVideoId ? () => progress.onVideoId!(vid!) : undefined);
  return vid;
}

function wrapV3VideoDetailJsonForCaptionPicker(json: Record<string, unknown>): Record<string, unknown> {
  const data = json.data as Record<string, unknown> | undefined;
  if (!data) return json;
  const cap = data.captioned_video_url ?? data.video_url_caption;
  return {
    ...json,
    data: {
      ...data,
      ...(typeof cap === "string" && cap.trim() ? { video_url_caption: cap } : {}),
    },
  };
}

export interface HeygenVideoStatus {
  status: string;
  videoUrl: string | null;
  usedVideoUrlCaption: boolean;
  /** HeyGen-supplied SRT (set when `caption: { file_format: "srt" }` was passed to `POST /v3/videos`). */
  subtitleUrl: string | null;
  /** Rendered video duration in seconds when HeyGen exposes it (used to build a fallback SRT when needed). */
  durationSec: number | null;
  raw: Record<string, unknown>;
}

async function getHeyGenVideoStatusLegacy(
  apiKey: string,
  apiBase: string,
  videoId: string
): Promise<HeygenVideoStatus> {
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
  const status = pickHeyGenLifecycleStatusLabel(json);
  const { url: videoUrl, usedVideoUrlCaption, subtitleUrl, durationSec } = pickHeyGenDownloadUrlFromStatus(json);
  return { status, videoUrl, usedVideoUrlCaption, subtitleUrl, durationSec, raw: json };
}

/** Prefer `GET /v3/videos/{video_id}`; fall back to legacy `video_status.get` on 404 (pre-v3 job ids). */
export async function getHeyGenVideoStatus(
  apiKey: string,
  apiBase: string,
  videoId: string
): Promise<HeygenVideoStatus> {
  const base = apiBase.replace(/\/$/, "");
  const v3Url = `${base}/v3/videos/${encodeURIComponent(videoId)}`;
  const res = await fetch(v3Url, {
    headers: { "X-Api-Key": apiKey },
  });
  const text = await res.text();
  if (res.status === 404) {
    return getHeyGenVideoStatusLegacy(apiKey, apiBase, videoId);
  }
  if (!res.ok) throw new Error(`HeyGen status ${res.status}: ${text.slice(0, 400)}`);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `HeyGen status: response is not JSON (${res.status}). Preview: ${text.slice(0, 240)}`
    );
  }
  throwIfHeyGenStandardApiError(json, "get /v3/videos");
  throwIfHeyGenBusinessError(json, "get /v3/videos");
  const wrapped = wrapV3VideoDetailJsonForCaptionPicker(json);
  const status = pickHeyGenLifecycleStatusLabel(wrapped);
  const { url: videoUrl, usedVideoUrlCaption, subtitleUrl, durationSec } = pickHeyGenDownloadUrlFromStatus(wrapped);
  return { status, videoUrl, usedVideoUrlCaption, subtitleUrl, durationSec, raw: wrapped };
}

/** Coerce nested API shapes (string | object) into a single status string for polling. */
function coerceHeyGenStatusValue(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const nested = o.status ?? o.state ?? o.phase ?? o.video_status;
    if (nested !== undefined && nested !== raw) return coerceHeyGenStatusValue(nested);
  }
  return "";
}

/**
 * HeyGen OpenAPI lists enum labels like `completed: Video rendered successfully`. If the API returns the
 * full label, strict equality against `completed` never matches → poll runs until timeout while the
 * dashboard already shows the asset. We compare the token before the first ":" (when present).
 */
export function normalizeHeyGenLifecycleToken(status: string): string {
  const s = status.trim().toLowerCase();
  if (!s) return "";
  const head = s.split(":")[0]?.trim() ?? s;
  return head;
}

function pickHeyGenLifecycleStatusLabel(json: Record<string, unknown>): string {
  const data = json.data as Record<string, unknown> | undefined;
  const fromResult = (): string => {
    const r = data?.result;
    if (!r || typeof r !== "object" || Array.isArray(r)) return "";
    return coerceHeyGenStatusValue((r as Record<string, unknown>).status);
  };
  const candidates = [
    coerceHeyGenStatusValue(data?.status),
    coerceHeyGenStatusValue(data?.state),
    coerceHeyGenStatusValue(json.status),
    fromResult(),
  ];
  for (const c of candidates) {
    if (c !== "") return c.trim().toLowerCase();
  }
  return "unknown";
}

function isHeyGenSuccessStatus(status: string): boolean {
  const token = normalizeHeyGenLifecycleToken(status);
  return (
    token === "completed" ||
    token === "complete" ||
    token === "success" ||
    token === "succeeded" ||
    token === "done" ||
    token === "ready" ||
    token === "finished"
  );
}

function isHeyGenFailureStatus(status: string): boolean {
  const token = normalizeHeyGenLifecycleToken(status);
  return (
    token === "failed" ||
    token === "error" ||
    token === "cancelled" ||
    token === "canceled"
  );
}

export interface HeygenPollResult {
  videoUrl: string;
  usedVideoUrlCaption: boolean;
  subtitleUrl: string | null;
  durationSec: number | null;
}

/**
 * Video Agent sometimes returns `status: completed` before `video_url` is populated; retry briefly instead of failing.
 */
async function waitForHeyGenDownloadUrl(
  apiKey: string,
  apiBase: string,
  videoId: string,
  initial: { usedVideoUrlCaption: boolean; subtitleUrl: string | null; durationSec: number | null },
  initialUrl: string | null
): Promise<HeygenPollResult> {
  if (initialUrl) {
    return {
      videoUrl: initialUrl,
      usedVideoUrlCaption: initial.usedVideoUrlCaption,
      subtitleUrl: initial.subtitleUrl,
      durationSec: initial.durationSec,
    };
  }
  let delayMs = 500;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(Math.round(delayMs * 1.2), 4000);
    const st = await getHeyGenVideoStatus(apiKey, apiBase, videoId);
    if (st.videoUrl) {
      return {
        videoUrl: st.videoUrl,
        usedVideoUrlCaption: st.usedVideoUrlCaption,
        subtitleUrl: st.subtitleUrl,
        durationSec: st.durationSec,
      };
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

/**
 * Sometimes `captioned_video_url` is populated shortly after `video_url`; keep polling to prefer burned-in captions.
 */
async function retryPollForCaptionedHeyGenUrl(
  apiKey: string,
  apiBase: string,
  videoId: string,
  initial: HeygenPollResult,
  opts?: { maxMs?: number }
): Promise<HeygenPollResult> {
  const maxMs = opts?.maxMs ?? 120_000;
  const start = Date.now();
  let delay = 2000;
  let best: HeygenPollResult = { ...initial };
  while (Date.now() - start < maxMs) {
    const st = await getHeyGenVideoStatus(apiKey, apiBase, videoId);
    const picked = pickHeyGenDownloadUrlFromStatus(st.raw);
    if (picked.usedVideoUrlCaption && picked.url) {
      return {
        videoUrl: picked.url,
        usedVideoUrlCaption: true,
        subtitleUrl: picked.subtitleUrl ?? best.subtitleUrl,
        durationSec: picked.durationSec ?? best.durationSec,
      };
    }
    if (picked.url) best = { ...best, videoUrl: picked.url };
    if (picked.subtitleUrl) best = { ...best, subtitleUrl: picked.subtitleUrl };
    if (picked.durationSec != null) best = { ...best, durationSec: picked.durationSec };
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.2), 8000);
  }
  return best;
}

export async function pollHeyGenUntilComplete(
  apiKey: string,
  apiBase: string,
  videoId: string,
  opts?: { maxMs?: number }
): Promise<HeygenPollResult> {
  const maxMs = opts?.maxMs ?? 600_000;
  const start = Date.now();
  let delay = 1000;
  while (Date.now() - start < maxMs) {
    const { status, videoUrl, usedVideoUrlCaption, subtitleUrl, durationSec, raw } = await getHeyGenVideoStatus(
      apiKey,
      apiBase,
      videoId
    );
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
    if (isHeyGenSuccessStatus(status) || videoUrl) {
      return waitForHeyGenDownloadUrl(
        apiKey,
        apiBase,
        videoId,
        { usedVideoUrlCaption, subtitleUrl, durationSec },
        videoUrl
      );
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30_000);
  }
  throw new HeygenPollTimeoutError(videoId, maxMs);
}

export class HeygenPollTimeoutError extends Error {
  videoId: string;
  maxMs: number;

  constructor(videoId: string, maxMs: number) {
    super(`HeyGen poll timeout for video_id=${videoId} (maxMs=${maxMs})`);
    this.name = "HeygenPollTimeoutError";
    this.videoId = videoId;
    this.maxMs = maxMs;
  }
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

/** True when HeyGen v2 `voice: { type: "silence" }` is used (visual-only). v3 `POST /v3/videos` has no silence-TTS equivalent. */
export function firstHeyGenVideoInputUsesSilenceVoice(body: Record<string, unknown>): boolean {
  const vi = body.video_inputs;
  if (!Array.isArray(vi) || vi.length === 0) return false;
  const v0 = vi[0];
  if (!v0 || typeof v0 !== "object" || Array.isArray(v0)) return false;
  return heygenVoiceDiscriminatorType((v0 as Record<string, unknown>).voice) === "silence";
}

function heygenOrientationToV3AspectRatio(orientation: string | undefined): "9:16" | "16:9" {
  const o = (orientation ?? "portrait").trim().toLowerCase();
  if (o === "landscape" || o === "16:9" || o === "16x9") return "16:9";
  if (o === "9:16" || o === "9x16") return "9:16";
  return "9:16";
}

/** Voice id for v3 avatar map: explicit config only — no hard-coded fallback (HeyGen uses avatar default when omitted). */
function pickExplicitVoiceIdForV3Avatar(body: Record<string, unknown>): string | undefined {
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
  const envV = trimVoiceId(process.env.HEYGEN_DEFAULT_VOICE_ID);
  if (envV) return envV;
  return undefined;
}

/**
 * Map CAF's v2-shaped `video_inputs` body (from {@link buildHeyGenRequestBody}) to HeyGen v3 `POST /v3/videos` avatar payload.
 * Caller must ensure this is not a silence-voice job (use legacy v2 instead).
 */
export function mapHeyGenV2StyleBodyToV3CreateVideoAvatar(body: Record<string, unknown>): Record<string, unknown> {
  const viRaw = body.video_inputs;
  if (!Array.isArray(viRaw) || viRaw.length === 0) {
    throw new Error("HeyGen v3 map: missing video_inputs");
  }
  const vi0 = viRaw[0] as Record<string, unknown>;
  if (firstHeyGenVideoInputUsesSilenceVoice(body)) {
    throw new Error("HeyGen v3 map: silence voice requires legacy POST /v2/video/generate");
  }
  const ch = vi0.character;
  const cr = ch && typeof ch === "object" && !Array.isArray(ch) ? (ch as Record<string, unknown>) : null;
  const avatarId = trimConfigString(cr?.avatar_id) ?? trimConfigString(cr?.talking_photo_id);
  if (!avatarId) throw new Error("HeyGen v3 map: missing avatar_id on video_inputs[0].character");

  const script = trimConfigString(vi0.script_text);
  if (!script) throw new Error("HeyGen v3 map: script_text is required for POST /v3/videos type avatar");

  const voiceId =
    extractVoiceIdFromHeygenVoiceValue(vi0.voice) ?? pickExplicitVoiceIdForV3Avatar(body);

  const orient =
    trimConfigString(body.orientation) ??
    trimConfigString(body.default_orientation) ??
    trimConfigString(vi0.orientation);
  const aspect_ratio = heygenOrientationToV3AspectRatio(orient);

  const out: Record<string, unknown> = {
    type: "avatar",
    avatar_id: avatarId,
    script,
    aspect_ratio,
  };
  if (voiceId) out.voice_id = voiceId;

  const cb = trimConfigString(body.callback_url);
  if (cb) out.callback_url = cb;
  const cbi = trimConfigString(body.callback_id);
  if (cbi) out.callback_id = cbi;
  const title = trimConfigString(body.title);
  if (title) out.title = title;

  const of = trimConfigString(body.output_format);
  if (of === "mp4" || of === "webm") out.output_format = of;

  const res = trimConfigString(body.resolution);
  if (res === "4k" || res === "1080p" || res === "720p") out.resolution = res;

  if (body.background != null && typeof body.background === "object" && !Array.isArray(body.background)) {
    out.background = body.background;
  }
  if (typeof body.remove_background === "boolean") out.remove_background = body.remove_background;

  // Script-led only: this mapper is invoked from runHeygenForContentJob's `/v3/videos` branch (Video Agent has
  // its own builder). Ask HeyGen to render an SRT sidecar (`data.subtitle_url`) so the script-led burn step can
  // burn captions into the MP4 locally — HeyGen v3 does not burn captions itself. Caller can pass `caption: false`
  // (or `caption: { file_format: ... }`) to override. Per HeyGen v3 OpenAPI: `caption` accepts `boolean` or
  // `CaptionSetting`.
  if (body.caption !== undefined) {
    if (body.caption !== false) out.caption = body.caption;
  } else {
    out.caption = { file_format: "srt" };
  }

  return out;
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
  if (body.heygen_allow_missing_voice_for_avatar === true) return undefined;
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
    const voice =
      body.heygen_allow_missing_voice_for_avatar === true
        ? undefined
        : pickVoiceFromBody(body, opts?.defaultVoiceId);
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
    const voice =
      body.heygen_allow_missing_voice_for_avatar === true
        ? undefined
        : pickVoiceFromBody(body, opts?.defaultVoiceId);
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

  const allowMissingVoice =
    body.heygen_allow_missing_voice_for_avatar === true &&
    opts?.flowType &&
    isScriptLedHeygenFlow(opts.flowType) &&
    resolveHeygenGeneratePath(opts.flowType, null) === "/v3/videos";

  // `override` deepMerge may replace video_inputs[0] without voice — fill id from config / default.
  const head = viArr[0];
  if (head && typeof head === "object" && !Array.isArray(head)) {
    const z = head as Record<string, unknown>;
    if (
      !allowMissingVoice &&
      !isHeygenNonTextVoice(z.voice) &&
      !extractVoiceIdFromHeygenVoiceValue(z.voice)
    ) {
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
    if (!vid && i === 0 && !allowMissingVoice) {
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
  if (!v0Id && !v0Silence && !allowMissingVoice) {
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
  opts?: { postPath?: HeygenGeneratePath; progress?: HeygenSubmitProgress }
): Promise<{
  videoUrl: string;
  videoId: string;
  usedVideoUrlCaption: boolean;
  subtitleUrl: string | null;
  durationSec: number | null;
}> {
  const apiKey = appConfig.HEYGEN_API_KEY?.trim();
  if (!apiKey) throw new Error("HEYGEN_API_KEY not configured");
  const postPath = opts?.postPath ?? "/v3/video-agents";
  const endpoint = `${appConfig.HEYGEN_API_BASE.replace(/\/$/, "")}${postPath}`;
  try {
    const videoId = await submitHeyGenVideo(
      apiKey,
      appConfig.HEYGEN_API_BASE,
      body,
      postPath,
      opts?.progress
    );
    let polled = await pollHeyGenUntilComplete(
      apiKey,
      appConfig.HEYGEN_API_BASE,
      videoId,
      { maxMs: appConfig.HEYGEN_POLL_MAX_MS }
    );
    if (!polled.usedVideoUrlCaption && postPath === "/v3/videos") {
      polled = await retryPollForCaptionedHeyGenUrl(
        apiKey,
        appConfig.HEYGEN_API_BASE,
        videoId,
        polled
      );
    }
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
          video_url: polled.videoUrl,
          used_video_url_caption: polled.usedVideoUrlCaption,
          subtitle_url: polled.subtitleUrl,
          duration_sec: polled.durationSec,
        },
      });
    }
    return {
      videoUrl: polled.videoUrl,
      videoId,
      usedVideoUrlCaption: polled.usedVideoUrlCaption,
      subtitleUrl: polled.subtitleUrl,
      durationSec: polled.durationSec,
    };
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
  job: HeygenJobContext,
  opts?: { progress?: HeygenSubmitProgress }
): Promise<{ public_url: string | null; object_path: string | null; video_id: string }> {
  const apiKey = appConfig.HEYGEN_API_KEY?.trim();
  if (!apiKey) throw new Error("HEYGEN_API_KEY not configured");

  const rows = await listHeygenConfig(db, job.project_id);
  let gen: Record<string, unknown> = pickGeneratedOutputOrEmpty(job.generation_payload);
  const enforced = await enforceHeygenSpokenScriptWordLaw(db, appConfig, job, { ...gen });
  gen = enforced.gen;
  const renderMode = resolveHeygenRenderMode(
    job.flow_type,
    job.generation_payload.render_mode ?? gen.render_mode ?? gen.production_route
  );

  const merged = mergeHeygenConfigForJob(rows, job.platform, job.flow_type, renderMode);
  applyHeygenEnvAvatarDefaults(merged, appConfig);
  const override = job.generation_payload.heygen_request as Record<string, unknown> | undefined;

  /**
   * For FLOW_PRODUCT_*, the per-project `allowed_flow_types.heygen_mode` (or the baked-in
   * default from {@link defaultProductFlowHeygenMode}) picks the route — overriding the
   * regex-based {@link resolveHeygenGeneratePath} which would always send product flows to
   * /v3/video-agents. Operators can flip any angle between script_led (verbatim TTS) and
   * prompt_led (agent-written VO) from the Flow Types settings tab.
   */
  const productMode = isProductVideoFlow(job.flow_type)
    ? await resolveProductFlowHeygenMode(db, job.project_id, job.flow_type)
    : null;
  const preferredPath: HeygenGeneratePath =
    productMode === "script_led"
      ? "/v3/videos"
      : productMode === "prompt_led"
        ? "/v3/video-agents"
        : resolveHeygenGeneratePath(job.flow_type, renderMode);
  let postPath: HeygenGeneratePath = preferredPath;
  let body: Record<string, unknown>;

  if (preferredPath === "/v3/videos") {
    body = buildHeyGenRequestBody(merged, gen, override, {
      defaultVoiceId: appConfig.HEYGEN_DEFAULT_VOICE_ID,
      flowType: job.flow_type,
      taskId: job.task_id,
      visualOnlySilenceDurationSec: appConfig.HEYGEN_VISUAL_ONLY_SILENCE_DURATION_SEC,
    });
    if (firstHeyGenVideoInputUsesSilenceVoice(body)) {
      postPath = "/v2/video/generate";
    } else {
      body = mapHeyGenV2StyleBodyToV3CreateVideoAvatar(body);
    }
    /**
     * Script-led product flows: avatar reads our LLM-authored spoken_script verbatim via
     * `video_inputs[].script_text`. Visual direction / brand / product context is already
     * baked into the prompt templates that produced the script (see migration 021 —
     * Product_Video_* templates), so we intentionally do NOT inject extra prompt blocks
     * here. `/v3/videos` has no agent-guidance field, and any brand-asset `files` array
     * would be rejected by the endpoint's `additionalProperties: false` schema.
     */
  } else {
    body = buildHeyGenVideoAgentRequestBody(merged, gen, override, {
      flowType: job.flow_type,
      taskId: job.task_id,
      agentMode: renderMode === "HEYGEN_NO_AVATAR" ? "no_avatar" : "prompt_avatar",
      durationBounds: {
        minSec: appConfig.HEYGEN_AGENT_MIN_DURATION_SEC,
        maxSec: 300,
        missingFallbackSec: appConfig.VIDEO_TARGET_DURATION_MIN_SEC,
      },
      /**
       * Prompt-led product flows deliberately skip ensureVideoScriptInPayload, so there is
       * no user-authored spoken_script to read — tell the agent to author its own VO from
       * the hook + visual_direction + cta block. Legacy video flows stay on "user_provided".
       */
      spokenMode: productMode === "prompt_led" ? "agent_writes" : "user_provided",
    });
    if (isProductVideoFlow(job.flow_type)) {
      const suffix = productVideoAgentPromptSuffix(job.flow_type);
      if (suffix && typeof body.prompt === "string") {
        const p = body.prompt.trim();
        body.prompt = p ? `${p}\n\n${suffix}` : suffix;
      }
      /**
       * Append project brand_constraints (tone/voice/banned words/disclaimers/etc.)
       * so HeyGen's agent honours them directly — not just via the upstream LLM output.
       * Best-effort: a missing row or empty constraints simply skips this block.
       */
      try {
        const brand = await getBrandConstraints(db, job.project_id);
        const brandBlock = buildProductVideoAgentBrandPromptBlock(brand);
        if (brandBlock && typeof body.prompt === "string") {
          const p = body.prompt.trim();
          body.prompt = p ? `${p}\n\n${brandBlock}` : brandBlock;
        }
      } catch {
        /* non-fatal: brand constraints are an enhancement, not a requirement */
      }
      /**
       * Append project product_profile (value prop / features / audience pain /
       * differentiators / offer / CTA) so HeyGen's Video Agent uses accurate
       * product facts rather than inventing generic copy for FLOW_PRODUCT_*.
       */
      try {
        const product = await getProductProfile(db, job.project_id);
        const productBlock = buildProductProfilePromptBlock(product);
        if (productBlock && typeof body.prompt === "string") {
          const p = body.prompt.trim();
          body.prompt = p ? `${p}\n\n${productBlock}` : productBlock;
        }
      } catch {
        /* non-fatal: product profile is an enhancement, not a requirement */
      }
      const kit = await listProjectBrandAssets(db, job.project_id);
      mergeHeygenVideoAgentFiles(body, brandAssetsToHeygenFiles(kit));
    }
  }

  const {
    videoUrl,
    videoId,
    usedVideoUrlCaption,
    subtitleUrl,
    durationSec,
  } = await runHeygenVideoWithBody(
    appConfig,
    body,
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: "heygen_video_generate",
    },
    { postPath, progress: opts?.progress }
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

  const burnReport = await maybeBurnHeygenSubtitles(db, appConfig, job, {
    videoId,
    videoUrl,
    postPath,
    usedVideoUrlCaption,
    subtitleUrl,
    durationSec,
    spokenScript: extractSpokenScriptText(gen) || null,
    storedObjectPath,
    storedPublicUrl: publicUrl,
    safeRun,
    safeTask,
  });
  if (burnReport.replacedObjectPath) {
    storedObjectPath = burnReport.replacedObjectPath;
    publicUrl = burnReport.replacedPublicUrl;
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
      heygen_post_path: postPath,
      heygen_used_video_url_caption: usedVideoUrlCaption,
      heygen_subtitle_url: subtitleUrl,
      heygen_duration_sec: durationSec,
      subtitles_burned: burnReport.burned,
      subtitles_burn_skipped_reason: burnReport.skippedReason,
      subtitles_burn_error: burnReport.error,
      subtitles_source: burnReport.subtitleSource,
    },
  });

  // 5B render manifest (additive): stable “what we produced” snapshot for downstream audit/review/learning.
  await db.query(
    `UPDATE caf_core.content_jobs SET
       generation_payload = jsonb_set(
         COALESCE(generation_payload, '{}'::jsonb),
         '{render_manifest}',
         $1::jsonb,
         true
       ),
       updated_at = now()
     WHERE project_id = $2 AND task_id = $3`,
    [
      JSON.stringify({
        render_type: "heygen",
        asset_type: "video",
        provider: "heygen",
        heygen_post_path: postPath,
        video_id: videoId,
        source_url: videoUrl,
        subtitles_burned: burnReport.burned,
        subtitles_source: burnReport.subtitleSource,
        subtitles_burn_skipped_reason: burnReport.skippedReason,
        duration_sec: durationSec,
        output: {
          object_path: storedObjectPath,
          public_url: publicUrl,
          asset_id: assetId,
        },
        finished_at: new Date().toISOString(),
      }),
      job.project_id,
      job.task_id,
    ]
  );

  return { public_url: publicUrl, object_path: storedObjectPath, video_id: videoId };
}

interface HeygenBurnReport {
  burned: boolean;
  /** "heygen_v3_srt" | "synthesized_from_spoken_script" | null */
  subtitleSource: string | null;
  skippedReason: string | null;
  error: string | null;
  replacedObjectPath: string | null;
  replacedPublicUrl: string | null;
}

/**
 * After HeyGen returns a video, optionally burn captions in via the local video-assembly `/burn-subtitles` service.
 *
 * **Script-led `/v3/videos` only.** Video Agent (`/v3/video-agents`) and silence-voice (`/v2/video/generate`)
 * paths are intentionally skipped:
 *   - Video Agent prompts produce non-script narration whose words/timing are not knowable client-side, so a
 *     synthesized SRT from `spoken_script` would not match what the avatar actually said.
 *   - Silence-voice is visual-only (no spoken script to caption).
 *   Only `/v3/videos` opts in to `caption: { file_format: "srt" }`, so it's the only path where HeyGen returns
 *   an authoritative `data.subtitle_url` aligned to the rendered audio. For that path we burn HeyGen's SRT
 *   (or, only when HeyGen omits one for some reason, fall back to a synthesized SRT from `spoken_script` +
 *   reported `durationSec`).
 *
 * On success the burned MP4 replaces the previously uploaded raw MP4 at the same Supabase object path so downstream
 * tables (`assets.object_path`) keep pointing at the captioned file.
 */
async function maybeBurnHeygenSubtitles(
  db: Pool,
  appConfig: AppConfig,
  job: HeygenJobContext,
  opts: {
    videoId: string;
    videoUrl: string;
    postPath: HeygenGeneratePath;
    usedVideoUrlCaption: boolean;
    subtitleUrl: string | null;
    durationSec: number | null;
    spokenScript: string | null;
    storedObjectPath: string | null;
    storedPublicUrl: string | null;
    safeRun: string;
    safeTask: string;
  }
): Promise<HeygenBurnReport> {
  const skip = (reason: string): HeygenBurnReport => ({
    burned: false,
    subtitleSource: null,
    skippedReason: reason,
    error: null,
    replacedObjectPath: null,
    replacedPublicUrl: null,
  });
  if (!appConfig.HEYGEN_BURN_SUBTITLES) return skip("HEYGEN_BURN_SUBTITLES=false");
  if (opts.postPath !== "/v3/videos") {
    // Script-led only: Video Agent has no client-side script alignment, silence-voice has nothing to caption.
    return skip(`script_led_only (postPath=${opts.postPath})`);
  }
  if (opts.usedVideoUrlCaption) return skip("heygen_already_burned (video_url_caption returned)");
  if (!opts.storedObjectPath) return skip("supabase_not_configured");

  let subtitleSource: "heygen_v3_srt" | "synthesized_from_spoken_script" | null = null;
  let burnSubtitlesUrl: string | null = null;
  let synthesizedSrtBuffer: Buffer | null = null;

  if (opts.subtitleUrl) {
    burnSubtitlesUrl = opts.subtitleUrl;
    subtitleSource = "heygen_v3_srt";
  } else {
    const script = (opts.spokenScript ?? "").trim();
    const dur = opts.durationSec ?? 0;
    if (!script) return skip("no_subtitle_url_and_no_spoken_script");
    if (!Number.isFinite(dur) || dur <= 0) return skip("no_subtitle_url_and_no_duration_for_fallback_srt");
    const { srt } = buildRoughSrt(script, dur);
    if (!srt.trim()) return skip("synthesized_srt_empty");
    synthesizedSrtBuffer = Buffer.from(srt, "utf8");
    subtitleSource = "synthesized_from_spoken_script";
  }

  try {
    const bucket = appConfig.SUPABASE_ASSETS_BUCKET;
    const signTtlSec = 14_400;
    let subtitlesMuxUrl = burnSubtitlesUrl;
    let srtObjectPath: string | null = null;
    if (synthesizedSrtBuffer) {
      const srtPath = `subtitles/${opts.safeRun}/${opts.safeTask}/heygen_${opts.videoId}.srt`;
      const srtUp = await uploadBuffer(appConfig, srtPath, synthesizedSrtBuffer, "text/plain; charset=utf-8");
      srtObjectPath = srtUp.object_path;
      const srtSign = await createSignedUrlForObjectKey(appConfig, bucket, srtUp.object_path, signTtlSec);
      if ("signedUrl" in srtSign) subtitlesMuxUrl = srtSign.signedUrl;
      else if (srtUp.public_url) subtitlesMuxUrl = srtUp.public_url;
      else return { burned: false, subtitleSource, skippedReason: null, error: `srt_sign_failed: ${srtSign.error}`, replacedObjectPath: null, replacedPublicUrl: null };
    }

    const videoSign = await createSignedUrlForObjectKey(appConfig, bucket, opts.storedObjectPath, signTtlSec);
    const videoMuxUrl = "signedUrl" in videoSign ? videoSign.signedUrl : opts.storedPublicUrl;
    if (!videoMuxUrl) {
      return { burned: false, subtitleSource, skippedReason: null, error: `video_sign_failed: ${"error" in videoSign ? videoSign.error : "missing_public_url"}`, replacedObjectPath: null, replacedPublicUrl: null };
    }
    if (!subtitlesMuxUrl) {
      return { burned: false, subtitleSource, skippedReason: null, error: "no_fetchable_subtitle_url", replacedObjectPath: null, replacedPublicUrl: null };
    }

    const baseUrl = appConfig.VIDEO_ASSEMBLY_BASE_URL.replace(/\/$/, "");
    const burnEndpoint = `${baseUrl}/burn-subtitles?async=1`;
    const burnBody: Record<string, unknown> = {
      video_url: videoMuxUrl,
      subtitles_url: subtitlesMuxUrl,
      task_id: job.task_id,
      run_id: job.run_id,
    };
    if (appConfig.HEYGEN_BURN_SUBTITLE_FORCE_STYLE?.trim()) {
      burnBody.options = { force_style: appConfig.HEYGEN_BURN_SUBTITLE_FORCE_STYLE.trim() };
    }
    const burnRes = await fetch(burnEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(burnBody),
    });
    const burnRaw = await burnRes.text();
    const burnJson = parseVideoAssemblyJson(burnRaw, burnRes.status, "video-assembly burn-subtitles", burnEndpoint) as {
      request_id?: string;
    };
    if (!burnRes.ok || !burnJson.request_id) {
      return {
        burned: false,
        subtitleSource,
        skippedReason: null,
        error: `burn_start_failed (${burnRes.status}): ${burnRaw.slice(0, 600)}`,
        replacedObjectPath: null,
        replacedPublicUrl: null,
      };
    }
    const burned = await pollVideoAssemblyJob(
      baseUrl,
      burnJson.request_id,
      appConfig.HEYGEN_BURN_SUBTITLES_POLL_MAX_MS
    );
    await tryInsertApiCallAudit(db, {
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: "heygen_burn_subtitles",
      provider: "video_assembly",
      model: null,
      ok: true,
      requestJson: {
        endpoint: burnEndpoint,
        video_object_path: opts.storedObjectPath,
        subtitles_object_path: srtObjectPath,
        subtitles_source: subtitleSource,
      },
      responseJson: { request_id: burnJson.request_id, public_url: burned.public_url },
    });
    if (!burned.public_url) {
      return {
        burned: false,
        subtitleSource,
        skippedReason: null,
        error: "burn_completed_without_public_url (set SUPABASE_* on video-assembly)",
        replacedObjectPath: null,
        replacedPublicUrl: null,
      };
    }

    // Replace the raw HeyGen MP4 at the same Supabase path so downstream consumers automatically pick up captions.
    const burnedBuf = await downloadBufferFromUrl(appConfig, burned.public_url);
    const replaceUp = await uploadBuffer(appConfig, opts.storedObjectPath, burnedBuf, "video/mp4");
    return {
      burned: true,
      subtitleSource,
      skippedReason: null,
      error: null,
      replacedObjectPath: replaceUp.object_path,
      replacedPublicUrl: replaceUp.public_url ?? opts.storedPublicUrl,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await tryInsertApiCallAudit(db, {
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: "heygen_burn_subtitles",
      provider: "video_assembly",
      model: null,
      ok: false,
      errorMessage: msg.slice(0, 4000),
      requestJson: { video_object_path: opts.storedObjectPath, subtitles_source: subtitleSource },
      responseJson: {},
    });
    return { burned: false, subtitleSource, skippedReason: null, error: msg.slice(0, 600), replacedObjectPath: null, replacedPublicUrl: null };
  }
}
