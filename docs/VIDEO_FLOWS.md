## CAF Core video flows (how they work)

This doc explains how **video jobs** are routed and rendered in CAF Core, with special focus on **HeyGen duration constraints**, **subtitle behavior**, and **avatar/voice selection**.

**HeyGen HTTP API (v3) reference** (endpoints, auth, Video Agent vs direct video): [`HEYGEN_API_V3.md`](./HEYGEN_API_V3.md).

### Glossary

- **Job**: a row in `caf_core.content_jobs` identified by `task_id` (primary execution key).
- **generated_output**: `content_jobs.generation_payload.generated_output` (LLM outputs and plans).
- **Scene pipeline**: multi-scene clip concat + optional TTS + subtitle burn-in.
- **HeyGen pipeline**: single-take (or agent-driven) HeyGen generation.

---

## Routing: how a job becomes a rendered video

### Entry points

- `POST /v1/jobs/:project_slug/:task_id/process` → `processJobByTaskId(...)` in `src/routes/runs.ts`
- `POST /v1/runs/:project_slug/:run_id/process` → `processRunJobs(...)` in `src/routes/runs.ts`

### Video decision point

All video-related work routes through `processVideoJob(...)` in `src/services/job-pipeline.ts`.

The routing logic is (conceptually):

1) **Scene pipeline** if any of the following are true:
- the chosen production route includes `SCENE`, or
- `generated_output.scene_bundle` exists, or
- `generation_payload.video_pipeline` is `"scene"`, or
- `flow_type` matches `Video_Scene_Generator` / `FLOW_SCENE_ASSEMBLY` / `scene_assembly` patterns

2) Else **HeyGen pipeline** if `HEYGEN_API_KEY` is configured:
- pre-step: `ensureHeygenPayloadForFlowType(...)` (adds missing script/prompt fields to `generated_output`)
- render: `runHeygenForContentJob(...)` in `src/services/heygen-renderer.ts`

3) Else fallback to **remote video-assembly** `/full-pipeline`

Key files:
- `src/services/job-pipeline.ts` (routing + orchestration)
- `src/decision_engine/flow-kind.ts` (`isVideoFlow(...)` heuristic classifier)

---

## Scene pipeline (multi-scene): clips → concat → TTS → subtitles → mux

Main orchestrator: `runScenePipeline(...)` in `src/services/scene-pipeline.ts`.

### 1) Scene bundle preparation

The pipeline ensures `generated_output.scene_bundle.scenes[]` exists via:
- `ensureSceneBundleInPayload(...)` in `src/services/scene-assembly-generator.ts`

Scene bundles typically contain:
- `scenes[i].video_prompt` (visual prompt per scene)
- optional `scenes[i].scene_narration_line` (text slice of spoken script aligned to that scene)
- optional clip URLs (`rendered_scene_url`, etc.)

### 2) Clip rendering (optional)

If scene clips are missing but prompts exist, Core can generate clips:

- **Sora (OpenAI Videos API)** when `SCENE_ASSEMBLY_CLIP_PROVIDER=sora`
  - implemented in `src/services/sora-scene-clips.ts`
  - requires `OPENAI_API_KEY` and Supabase config so clips can be uploaded to fetchable URLs

- **HeyGen Video Agent fallback** when `SCENE_ASSEMBLY_CLIP_PROVIDER=heygen` and `SCENE_ASSEMBLY_HEYGEN_CLIP_FALLBACK=1`
  - implemented in `src/services/scene-pipeline.ts` using helpers from `src/services/heygen-renderer.ts`
  - runs in **no-avatar** mode for clip segments

### 3) Concat (video-assembly)

Scene MP4 URLs are passed to the Node video-assembly service:

- `POST /concat-videos?async=1` with `{ video_urls, task_id, run_id }`
- poll `GET /status/:request_id`

Implementation:
- CAF Core client: `src/services/scene-pipeline.ts` (`pollVideoAssemblyJob(...)`)
- video-assembly server: `services/video-assembly/server.js`

### 4) TTS voiceover (optional)

If `generated_output.spoken_script` exists and `OPENAI_API_KEY` is configured, the scene pipeline synthesizes voiceover:

- `synthesizeSpeechToStorage(...)` in `src/services/tts-service.ts`

#### Script length enforcement in the scene pipeline (optional)

The scene pipeline can optionally **trim `spoken_script` to fit the clip timeline**:

- Controlled by `SCENE_ENFORCE_SPOKEN_SCRIPT_WORD_TRIM` (boolean)
- Budget computed from:
  - timeline seconds (`clipDurs`)
  - `SCENE_VO_WORDS_PER_MINUTE`
  - `SCENE_VO_WORD_BUDGET_SAFETY`
- Trimming performed by `fitSpokenScriptToWordBudget(...)` in `src/services/spoken-script-word-budget.ts`

If trimming occurs, the pipeline writes the shortened script back into `generated_output` (`spoken_script` and `script`).

### 5) Subtitles (SRT generation) and how they’re picked

Scene pipeline subtitles are **generated from text**, not from transcription:

Source selection order (in `src/services/scene-pipeline.ts`):

1) Use `scene_narration_line` if it aligns exactly with the `spoken_script` (strict), checked by:
   - `narrationLinesAlignedWithScript(...)` in `src/services/scene-narration-alignment.ts`
2) Else accept a looser concatenation alignment:
   - `narrationLinesLooseConcatMatchesScript(...)`
3) Else split the `spoken_script` into per-scene chunks weighted by clip durations:
   - `splitScriptIntoSceneChunksByWeights(...)` in `src/services/caption-generator.ts`

SRT is built via:
- `buildSrtFromScenesWithSentenceCues(...)` in `src/services/caption-generator.ts`

The resulting file is uploaded to:
- `subtitles/{run}/{task}/captions.srt`

### 6) Mux + burn subtitles (video-assembly)

Final mux is done by video-assembly:
- `POST /mux?async=1` with `{ video_url, audio_url, subtitles_url? }`

If `subtitles_url` is provided, video-assembly downloads the SRT and runs ffmpeg with a subtitles filter to burn them into the MP4.

Implementation:
- CAF Core: `src/services/scene-pipeline.ts` (signs URLs, calls mux)
- video-assembly: `services/video-assembly/server.js` (`muxAudioBurnSubtitles(...)`)

---

## HeyGen pipeline (single-take): request building, duration constraints, captions

Main orchestrator: `runHeygenForContentJob(...)` in `src/services/heygen-renderer.ts`.

### Script and prompt fields

CAF Core extracts text from `generated_output` using aliases/nesting:
- `extractSpokenScriptText(...)` and `extractVideoPromptText(...)` in `src/services/video-gen-fields.ts`

Depending on the HeyGen path (see [`HEYGEN_API_V3.md`](./HEYGEN_API_V3.md) for upstream API details):

- **HeyGen v3 direct avatar video** (`POST /v3/videos`, `type: "avatar"`):
  - Built from the same merged `video_inputs` shape as the old v2 path, then mapped to a flat v3 body (`avatar_id`, `script`, `voice_id`, `aspect_ratio`, optional `callback_url`, etc.).
  - Used for **script-led** avatar jobs (`Video_Script_*` HeyGen flows).

- **HeyGen v3 Video Agent** (`POST /v3/video-agents`):
  - A single multiline `prompt` is constructed from hook, spoken_script, video_prompt, on-screen cues, etc.
  - Optional `avatar_id`, `voice_id`, `style_id`, `orientation`, `callback_url` are passed when configured.
  - Used for **prompt-led** avatar jobs and **no-avatar** agent jobs.

- **Legacy v2** (`POST /v2/video/generate`) — **only** when the job uses HeyGen `voice: { type: "silence" }` (visual-only / no spoken script). The v3 create-video schema has no silence-TTS equivalent, so CAF keeps this one legacy call for that edge case.

### Duration constraints: what is enforced vs guidance

**Important**: HeyGen **avatar** `POST /v3/videos` has no `duration_sec` — runtime follows TTS. CAF enforces **word budgets** so “target 30–60s” is not only prompt text:

- **Default:** `HEYGEN_ENFORCE_SPOKEN_SCRIPT_WORD_BOUNDS=true` (env). Min/max words = `VIDEO_TARGET_DURATION_{MIN,MAX}_SEC` × `SCENE_VO_WORDS_PER_MINUTE` / 60 (see `heygenSpokenScriptWordBoundsFromConfig` in `src/services/spoken-script-word-budget.ts`).
- **Before HeyGen:** `enforceHeygenSpokenScriptWordLaw` in `src/services/heygen-spoken-script-enforcement.ts` trims over-max scripts, expands under-min via OpenAI when `OPENAI_API_KEY` is set, or **fails** with a clear error.
- **Script prep LLM:** `ensureVideoScriptInPayload` retries once if the first draft is under the minimum word count (`src/services/video-script-generator.ts`).

What *is* also enforced for **Video Agent**:

- CAF Core clamps a target length in seconds, then embeds it in the agent prompt (e.g. “Target duration: about N seconds”). The v3 `POST /v3/video-agents` body is normalized and may omit `duration_sec` per HeyGen schema.
  - `resolveHeygenAgentDurationSec(...)` in `src/services/heygen-renderer.ts`
  - bounds include `HEYGEN_AGENT_MIN_DURATION_SEC` and a max of 300s (hard-coded), and a fallback based on `VIDEO_TARGET_DURATION_MIN_SEC`.

Additional **guidance** (LLM):

- Prompts are told to target a duration band via:
  - `appendVideoUserPromptDurationHardFooter(...)` and `withVideoScriptDurationPolicy(...)` in `src/services/video-content-policy.ts`

### Subtitles / captions for HeyGen

**Scope: script-led `/v3/videos` only.** Video Agent (`/v3/video-agents`) and silence-voice (`/v2/video/generate`) jobs are intentionally excluded — Video Agent prompts produce non-script narration whose words/timing aren't knowable client-side (a synthesized SRT wouldn't match what the avatar actually said), and silence-voice has nothing to caption.

HeyGen v3 `POST /v3/videos` does **not** burn captions into the MP4 — there is no v3 caption-burn parameter on the create endpoint, and `captioned_video_url` is only populated by the video-translation proofread workflow. CAF therefore does the burn locally for script-led jobs:

1. **Request side:** `mapHeyGenV2StyleBodyToV3CreateVideoAvatar(...)` injects `caption: { file_format: "srt" }` (per HeyGen v3 OpenAPI `CaptionSetting`) so HeyGen renders an **SRT sidecar** at `data.subtitle_url`. The MP4 is unchanged.
2. **Status surface:** `pickHeyGenDownloadUrlFromStatus(...)` returns `{ url, usedVideoUrlCaption, subtitleUrl, durationSec }`. CAF still prefers `captioned_video_url` / `video_url_caption` when present (legacy / proofread paths) and skips burning if HeyGen already burned in.
3. **Burn step:** `runHeygenForContentJob(...)` calls `maybeBurnHeygenSubtitles(...)`. The function gates on `postPath === "/v3/videos"` first; if not script-led, it short-circuits with `subtitles_burn_skipped_reason: "script_led_only (postPath=...)"`. For script-led jobs it downloads HeyGen's SRT (or, only when HeyGen omits one, synthesizes via `buildRoughSrt(spoken_script, durationSec)`), uploads it + signs the stored MP4, then `POST {VIDEO_ASSEMBLY_BASE_URL}/burn-subtitles?async=1` → polls → downloads the burned MP4 → **overwrites the same Supabase object path** so the canonical asset includes captions.
4. **video-assembly:** `services/video-assembly/server.js` exposes `POST /burn-subtitles` (added alongside `/mux`) — copies audio with `-c:a copy` and re-encodes video with `libx264 + subtitles` filter.

Config keys (in `src/config.ts`):

- `HEYGEN_BURN_SUBTITLES` (default `true`): set to `0`/`false` to keep the raw HeyGen MP4 (no captions).
- `HEYGEN_BURN_SUBTITLES_POLL_MAX_MS` (default 900000): how long to wait on the burn job.
- `HEYGEN_BURN_SUBTITLE_FORCE_STYLE` (optional): ffmpeg `force_style` override for HeyGen burns only.

The resulting `assets` row records `metadata_json.subtitles_burned`, `subtitles_source` (`heygen_v3_srt` | `synthesized_from_spoken_script`), `subtitles_burn_skipped_reason`, and `subtitles_burn_error` for auditability. The burn step is best-effort: if it fails or is skipped, the raw HeyGen MP4 remains the stored asset and the failure is captured in `api_call_audit` (step `heygen_burn_subtitles`).

---

## Avatar + voice selection (HeyGen): precedence and config keys

### Where config is stored

Per-project HeyGen configuration is stored as key/value rows:
- Postgres table: `caf_core.heygen_config` (see `migrations/002_project_config_and_runs.sql`)
- Accessors: `listHeygenConfig(...)` / `upsertHeygenConfig(...)` in `src/repositories/project-config.ts`

Rows can be scoped by optional fields:
- `platform` (nullable; null means “all platforms”)
- `flow_type` (nullable; null means “all flows”)
- `render_mode` (nullable; null means “all render modes”)

### How rows merge for a job

`mergeHeygenConfigForJob(...)` in `src/services/heygen-renderer.ts` merges all matching rows, with wildcards allowed.

Compatibility note: alternate render-mode spellings `PROMPT` / `SCRIPT` (from admin or imported config rows) are treated as compatible with job render modes `HEYGEN_AVATAR` / `HEYGEN_NO_AVATAR` depending on the flow type.

### Avatar selection

Avatar can come from either:

- **Pools** (preferred): `prompt_avatar_pool_json`, `script_avatar_pool_json`, `avatar_pool_json`\n  Each is a JSON array of objects like `{ \"avatar_id\": \"...\", \"voice_id\": \"...\" }` (voice_id optional).
- **Single IDs**: `prompt_avatar_id`, `script_avatar_id`, `avatar_id`

Pool picks are deterministic **and round-robin within a run**:
- Seed defaults to `task_id` (scene-assembly overrides to `${task_id}__scene_${i}`).
- `stablePickIndex(seed, pool.length)` parses `row{NNNN}` / `scene_{i}` / `v{N}` from the seed and computes `((row - 1) + (variation - 1) + scene) mod pool.length`. So:
  - Within a run, jobs `row0001`, `row0002`, `row0003` pick entries `0`, `1`, `2`, then wrap.
  - Within a multi-scene job, scenes `0`, `1`, `2` rotate independently.
  - Variations `v1`, `v2` of the same row also rotate (so they don't collide on a single avatar).
- Same `(row, scene, v)` triple → same index, so retries / restarts always re-pick the same `(avatar_id, voice_id)` pair from the pool.
- Ad-hoc seeds with no `row`/`scene`/`v` markers fall back to a stable FNV-like hash pick.

No-avatar flows skip avatar injection entirely.

### Voice selection

Voice resolution order (simplified):

1) If an avatar pool entry includes `voice_id`, use it.\n2) Else use config keys like `voice`, `voice_id`, `default_voice`, `default_voice_id`.\n3) For script-led flows, `script_voice_id` can override.\n4) Else fallback to environment `HEYGEN_DEFAULT_VOICE_ID`.\n5) Else final hard fallback constant in `src/services/heygen-renderer.ts`.

---

## Operational notes / debugging

- Most pipeline steps insert `api_call_audit` rows via `tryInsertApiCallAudit(...)` to capture request/response metadata per `task_id`.\n- For HeyGen, the resulting `assets` row includes `metadata_json.heygen_used_video_url_caption` so you can confirm whether captioned output was used.\n- For scene pipeline, `content_jobs.scene_bundle_state` is updated with a compact report, warnings, and mux details.\n+
