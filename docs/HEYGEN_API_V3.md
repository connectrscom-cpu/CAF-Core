# HeyGen External API (v3) — workspace reference

Consolidated notes for integrating with [HeyGen](https://developers.heygen.com/). Official human docs: [docs.heygen.com](https://docs.heygen.com). CAF Core wiring for jobs lives in [`VIDEO_FLOWS.md`](./VIDEO_FLOWS.md) and `src/services/heygen-renderer.ts`.

### CAF Core usage (implementation)

- **Poll:** `GET /v3/videos/{video_id}` first; on **404** only, fall back to legacy `GET .../v1/video_status.get?video_id=` for older ids.
- **Video Agent:** `POST /v3/video-agents` with a normalized body (unknown keys stripped; target length lives in the `prompt` text, not a `duration_sec` field).
- **Script + avatar:** `POST /v3/videos` with `{ type: "avatar", avatar_id, script, voice_id, aspect_ratio, ... }` mapped from the internal `video_inputs[0]` builder.
- **Silence / visual-only (no spoken script):** still **`POST /v2/video/generate`** when `voice.type === "silence"` — v3 create-video has no equivalent.
- **Captions on `POST /v3/videos` (script-led only):** v3 has no caption-burn parameter. For script-led avatar jobs CAF passes `caption: { file_format: "srt" }` (per HeyGen v3 OpenAPI `CaptionSetting`) so HeyGen renders an **SRT sidecar** at `data.subtitle_url` — *the MP4 itself is not modified*. CAF then burns the SRT in locally via the video-assembly `POST /burn-subtitles` endpoint and replaces the stored MP4 in Supabase. Toggle with `HEYGEN_BURN_SUBTITLES=0` to keep the raw HeyGen MP4. **Video Agent (`/v3/video-agents`) and silence-voice (`/v2/video/generate`) jobs are intentionally excluded from the burn step** — Video Agent narration is generated server-side and not knowable client-side, so a synthesized SRT wouldn't match the spoken audio.
- **Captioned download (legacy / proofread workflows):** prefer `data.captioned_video_url`, then legacy `video_url_caption`, then `video_url`. v3 only populates `captioned_video_url` for video-translation proofread renders; the regular `POST /v3/videos` create flow does not produce a burned-in MP4.

## Documentation index (for LLMs / discovery)

Fetch the full page list before deep exploration:

- **Index URL:** `https://heygen-1fa696a7.mintlify.app/llms.txt`

## Base URL and auth

| Item | Value |
|------|--------|
| **Production base** | `https://api.heygen.com` |
| **API key header** | `x-api-key` (OpenAPI name `ApiKeyAuth`; examples often use `X-Api-Key`) |
| **OAuth** | `Authorization: Bearer <token>` (`BearerAuth`) |

Obtain API keys from the HeyGen dashboard (Settings → API). Environment variable used in docs: `HEYGEN_API_KEY`.

## Versioning

Legacy `/v1` and `/v2` remain supported until **October 31, 2026**. New capabilities (CLI, MCP, Voice design API, improved errors, latest models such as lipsync) are **v3-only**. Prefer v3 for new work.

## Video Agent vs direct video creation

| | Video Agent | Direct video |
|---|-------------|----------------|
| **Endpoint** | `POST /v3/video-agents` | `POST /v3/videos` |
| **Input** | Natural language prompt | Structured JSON |
| **Script** | Agent writes | You supply |
| **Avatar / voice** | Agent picks (optional overrides) | You specify |
| **Interactive iteration** | Yes (`mode: "chat"`) | No |
| **Webhooks** | `callback_url` | `callback_url` |
| **Control** | Lower (prompt-driven) | Higher (explicit) |

Practical guidance: start with Video Agent; switch to `POST /v3/videos` when you need fixed avatar, voice, and script.

---

## Endpoints (summarized from OpenAPI excerpts)

### `GET /v3/video-agents/styles` — list Video Agent styles

Curated visual style templates (`style_id` for `POST /v3/video-agents`).

**Query:** `tag` (optional filter, e.g. `cinematic`, `retro-tech`), `limit` (1–100, default 20), `token` (pagination cursor).

**200 body:** `data[]` (`StyleItem`), `has_more`, `next_token`.

**`StyleItem`:** `style_id`, `name`, optional `thumbnail_url`, `preview_video_url`, `tags`, `aspect_ratio`.

### `GET /v3/video-agents` — list Video Agent sessions

Paginated sessions, newest first.

**Query:** `limit` (1–100, default 20), `token`.

**200 body:** `data[]` (`SessionListItem`: `session_id`, optional `title`, `created_at`), `has_more`, `next_token`.

### `POST /v3/video-agents` — create Video Agent session

One-shot or multi-turn video from a prompt.

**Body (`CreateVideoAgentRequest`):**

| Field | Notes |
|-------|--------|
| `prompt` | **Required.** 1–10000 characters |
| `mode` | `generate` (default) or `chat` |
| `avatar_id` | Optional override |
| `voice_id` | Optional override |
| `style_id` | From `GET /v3/video-agents/styles` |
| `orientation` | `landscape` \| `portrait` or omit (auto) |
| `files` | Up to 20 items; discriminated union: `{ type: "url", url }`, `{ type: "asset_id", asset_id }`, `{ type: "base64", media_type, data }` |
| `callback_url` | Webhook on completion/failure |
| `callback_id` | Optional id echoed in webhook payload |
| `incognito_mode` | Default `false`; disables memory injection/extraction |

**200 body:** `data` with `session_id`, `status` (`generating` \| `thinking` \| `completed` \| `failed`), optional `video_id`, `created_at`.

Poll video with `GET /v3/videos/{video_id}` when `video_id` is present.

### `GET /v3/avatars` — list avatar groups

Paginated avatar groups (characters); each group has one or more **looks**. Use `GET /v3/avatars/looks` (per HeyGen docs) for look-level detail and engine compatibility.

**Query:** `ownership` (`public` \| `private` or omit for all), `limit` (1–50, default 20), `token`.

**`AvatarGroupItem` highlights:** `id`, `name`, `created_at`, `looks_count`, optional previews, `gender`, `default_voice_id`, `consent_status`, optional `status` (`processing` \| `pending_consent` \| `failed` \| `completed`) for private avatars, optional `error` when failed.

### `POST /v3/assets` — upload asset

Multipart `file` field. **Max 32 MB.** Types: png, jpeg, mp4, webm, mp3, wav, pdf.

**200 `data`:** `asset_id`, `url`, `mime_type`, `size_bytes`. Use `asset_id` in Video Agent `files` or other v3 flows.

---

## Quick start (async flow)

1. **Create session:** `POST https://api.heygen.com/v3/video-agents` with JSON `{ "prompt": "..." }` and `X-Api-Key`.
2. **Read** `data.video_id` from the response (may be null in some multi-turn cases).
3. **Poll** `GET https://api.heygen.com/v3/videos/{video_id}` until `status` is `completed` or `failed`.
4. Typical video status progression: `pending` → `processing` → `completed` \| `failed`. Completed responses include `video_url`, `thumbnail_url`, `duration`, etc.

**Webhook:** pass `callback_url` on create to avoid polling.

## Common errors

Errors use a wrapper with `error: { code, message, param?, doc_url? }`. Examples:

- `invalid_parameter` (e.g. bad `limit`)
- `authentication_failed`
- `rate_limit_exceeded` (respect `Retry-After` header when present)

## Cookbook pattern: personalized outreach (batch)

1. Build a prompt template with prospect-specific variables (name, company, role, pain, value prop).
2. `POST /v3/video-agents` per prospect; space requests for rate limits (e.g. sleep between calls).
3. Poll each `video_id` (or use webhooks); deliver `video_url` / `thumbnail_url` via email, LinkedIn, etc.

Brand consistency: reuse the same `avatar_id`, `voice_id`, and style instructions across batches.

## Related HeyGen surfaces

- [HeyGen Developers](https://developers.heygen.com/) — overview, pricing pointers, Video Agent / Translation / Lipsync / Voices.
- Dashboard API key: Settings → API (linked from HeyGen quick start).
- CLI and MCP are documented on the developer site for agent-style workflows.

---

*This file is a project-local reference; always verify request/response shapes against the current HeyGen OpenAPI or official docs if something fails at runtime.*
