/**
 * HeyGen avatar + voice catalog for marketer picker (Brand Visual System).
 * @see docs/HEYGEN_API_V3.md — use GET /v3/avatars/looks for look-level preview_image_url.
 */
import type { AppConfig } from "../config.js";

export interface HeygenCatalogAvatar {
  avatar_id: string;
  name: string;
  preview_image_url: string | null;
  preview_video_url: string | null;
  gender: string | null;
  default_voice_id: string | null;
  avatar_type: string | null;
}

export interface HeygenCatalogVoice {
  voice_id: string;
  name: string;
  language: string | null;
  gender: string | null;
  preview_audio_url: string | null;
}

export interface HeygenCatalogResult {
  ok: boolean;
  configured: boolean;
  avatars: HeygenCatalogAvatar[];
  voices: HeygenCatalogVoice[];
  error: string | null;
}

function str(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

type HeygenGetResult = {
  ok: boolean;
  json: Record<string, unknown> | null;
  status: number;
  error: string | null;
};

async function heygenGet(appConfig: AppConfig, path: string): Promise<HeygenGetResult> {
  const apiKey = appConfig.HEYGEN_API_KEY?.trim();
  if (!apiKey) return { ok: false, json: null, status: 0, error: "HEYGEN_API_KEY not configured" };
  const base = appConfig.HEYGEN_API_BASE.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    headers: { "x-api-key": apiKey, accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    let error = `HeyGen HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const errRec = asRec(parsed.error) ?? asRec(asRec(parsed.data)?.error);
      error = str(errRec?.message, 300) ?? error;
    } catch {
      /* keep status message */
    }
    return { ok: false, json: null, status: res.status, error };
  }
  try {
    return { ok: true, json: JSON.parse(text) as Record<string, unknown>, status: res.status, error: null };
  } catch {
    return { ok: false, json: null, status: res.status, error: "HeyGen response was not JSON" };
  }
}

/** Parse v3 avatar look rows (preferred — includes preview_image_url). */
export function parseAvatarLookItems(raw: unknown, cap = 200): HeygenCatalogAvatar[] {
  if (!Array.isArray(raw)) return [];
  const out: HeygenCatalogAvatar[] = [];
  for (const item of raw) {
    const rec = asRec(item);
    if (!rec) continue;
    const avatar_id = str(rec.id ?? rec.avatar_id ?? rec.look_id, 120);
    if (!avatar_id) continue;
    const status = str(rec.status, 40);
    if (status && status !== "completed") continue;
    out.push({
      avatar_id,
      name: str(rec.name ?? rec.avatar_name, 120) ?? avatar_id,
      preview_image_url: str(rec.preview_image_url ?? rec.preview_url ?? rec.image_url, 800),
      preview_video_url: str(rec.preview_video_url ?? rec.preview_video, 800),
      gender: str(rec.gender, 40),
      default_voice_id: str(rec.default_voice_id, 120),
      avatar_type: str(rec.avatar_type, 60),
    });
    if (out.length >= cap) break;
  }
  return out;
}

/** Flat avatar list from HeyGen v2 (legacy fallback). */
export function parseAvatarsV2Payload(json: Record<string, unknown> | null): HeygenCatalogAvatar[] {
  if (!json) return [];
  const data = asRec(json.data) ?? json;
  const buckets: unknown[] = [];
  for (const key of ["avatars", "talking_photos", "talkingPhotos"]) {
    const arr = (data as Record<string, unknown>)[key];
    if (Array.isArray(arr)) buckets.push(...arr);
  }
  if (buckets.length === 0 && Array.isArray(data)) buckets.push(...data);

  const out: HeygenCatalogAvatar[] = [];
  for (const item of buckets) {
    const rec = asRec(item);
    if (!rec) continue;
    const avatar_id = str(rec.avatar_id ?? rec.avatarId ?? rec.id, 120);
    if (!avatar_id) continue;
    out.push({
      avatar_id,
      name: str(rec.avatar_name ?? rec.name ?? rec.avatar_id, 120) ?? avatar_id,
      preview_image_url: str(rec.preview_image_url ?? rec.preview_url ?? rec.image_url, 800),
      preview_video_url: str(rec.preview_video_url ?? rec.preview_video, 800),
      gender: str(rec.gender, 40),
      default_voice_id: str(rec.default_voice_id, 120),
      avatar_type: str(rec.avatar_type, 60),
    });
    if (out.length >= 120) break;
  }
  return out;
}

/** Voice list from HeyGen v3/v2 payloads. */
export function parseVoicesPayload(json: Record<string, unknown> | null): HeygenCatalogVoice[] {
  if (!json) return [];
  const data = asRec(json.data) ?? json;
  const raw = (data as Record<string, unknown>).voices ?? (Array.isArray(data) ? data : null);
  if (!Array.isArray(raw)) return [];
  const out: HeygenCatalogVoice[] = [];
  for (const item of raw) {
    const rec = asRec(item);
    if (!rec) continue;
    const voice_id = str(rec.voice_id ?? rec.voiceId ?? rec.id, 120);
    if (!voice_id) continue;
    out.push({
      voice_id,
      name: str(rec.name, 120) ?? voice_id,
      language: str(rec.language, 80),
      gender: str(rec.gender, 40),
      preview_audio_url: str(rec.preview_audio_url ?? rec.preview_audio, 800),
    });
    if (out.length >= 100) break;
  }
  return out;
}

/** Paginated v3 looks — each look id is the avatar_id for POST /v3/videos. */
async function fetchAvatarLooksV3(appConfig: AppConfig): Promise<{ avatars: HeygenCatalogAvatar[]; error: string | null }> {
  const out: HeygenCatalogAvatar[] = [];
  let token: string | null = null;
  let lastError: string | null = null;

  for (let page = 0; page < 6; page++) {
    const qs = new URLSearchParams({ limit: "50" });
    if (token) qs.set("token", token);
    const { ok, json, error } = await heygenGet(appConfig, `/v3/avatars/looks?${qs}`);
    if (!ok) {
      lastError = error;
      break;
    }
    const batch = parseAvatarLookItems(json?.data, 200 - out.length);
    out.push(...batch);
    const hasMore = json?.has_more === true;
    const next = str(json?.next_token, 500);
    if (!hasMore || !next || out.length >= 200) break;
    token = next;
  }

  return { avatars: out, error: out.length === 0 ? lastError : null };
}

async function fetchAvatarsV2(appConfig: AppConfig): Promise<{ avatars: HeygenCatalogAvatar[]; error: string | null }> {
  const { ok, json, error } = await heygenGet(appConfig, "/v2/avatars");
  if (!ok) return { avatars: [], error };
  return { avatars: parseAvatarsV2Payload(json), error: null };
}

async function fetchVoicesV3(appConfig: AppConfig): Promise<{ voices: HeygenCatalogVoice[]; error: string | null }> {
  const { ok, json, error } = await heygenGet(appConfig, "/v3/voices?limit=100");
  if (!ok) {
    const v2 = await heygenGet(appConfig, "/v2/voices");
    if (!v2.ok) return { voices: [], error: v2.error ?? error };
    return { voices: parseVoicesPayload(v2.json), error: null };
  }
  const voices = parseVoicesPayload(json);
  if (voices.length > 0) return { voices, error: null };
  const v2 = await heygenGet(appConfig, "/v2/voices");
  if (!v2.ok) return { voices: [], error: v2.error ?? error };
  return { voices: parseVoicesPayload(v2.json), error: null };
}

/** Load avatars + voices for Brand Visual System HeyGen presenter picker. */
export async function fetchHeygenCatalog(appConfig: AppConfig): Promise<HeygenCatalogResult> {
  const configured = Boolean(appConfig.HEYGEN_API_KEY?.trim());
  if (!configured) {
    return { ok: false, configured: false, avatars: [], voices: [], error: "HEYGEN_API_KEY not configured" };
  }

  try {
    const [looks, v2, voicesResult] = await Promise.all([
      fetchAvatarLooksV3(appConfig),
      fetchAvatarsV2(appConfig),
      fetchVoicesV3(appConfig),
    ]);

    const avatars = looks.avatars.length > 0 ? looks.avatars : v2.avatars;
    const voices = voicesResult.voices;
    const errors = [looks.error, v2.avatars.length === 0 ? v2.error : null, voicesResult.error].filter(Boolean);

    if (avatars.length === 0 && voices.length === 0) {
      const msg =
        errors[0] ??
        "HeyGen catalog empty — check API key permissions and that your account has avatars/voices.";
      return { ok: false, configured: true, avatars: [], voices: [], error: msg };
    }

    return {
      ok: true,
      configured: true,
      avatars,
      voices,
      error: errors.length && avatars.length === 0 ? (errors[0] ?? null) : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, configured: true, avatars: [], voices: [], error: msg.slice(0, 300) };
  }
}

/** Build heygen_defaults avatar_pool_json from brand bible presenter rows. */
export function heygenPoolJsonFromPresenters(
  presenters: Array<{ avatar_id: string; voice_id?: string | null }>
): string {
  const out: Array<{ avatar_id: string; voice_id?: string }> = [];
  for (const row of presenters) {
    const avatar_id = row.avatar_id.trim();
    const voice_id = row.voice_id?.trim() ?? "";
    if (!avatar_id) continue;
    out.push(voice_id ? { avatar_id, voice_id } : { avatar_id });
  }
  return JSON.stringify(out);
}
