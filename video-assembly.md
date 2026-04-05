# Video assembly: stitch + mux (post–scene-render stage)

This document defines the **remote video assembly** stage for the CAF n8n flow: after scene clips are generated (e.g. Sora 2 / HeyGen), we merge clips into one video, add voiceover and optional subtitles, then store results in Supabase. All heavy work is done by **remote services** (no local ffmpeg inside n8n).

---

## 1. Remote stitch service (merge scene clips)

**Purpose:** Accept an ordered list of scene clip URLs, download them server-side, concatenate into one video, upload to Supabase Storage, return the merged asset URL.

### Endpoint

- **`POST /stitch`** (or `POST /video/stitch` if the service is under a `/video` prefix)

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parent_id` | string | Yes | Parent bundle id (same as `task_id` for the bundle). |
| `task_id` | string | Yes | Same as parent_id for 1:1 parent bundles. |
| `candidate_id` | string | No | For logging/tracing. |
| `asset_id` | string | No | e.g. `SNS_2026W09_Multi_0003__VIDEO_v1`. |
| `output_path` | string | Yes | Path in Supabase bucket (no leading slash). E.g. `SNS_2026W09/SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1/merged.mp4`. |
| `clips` | array | Yes | Ordered list of clip descriptors. |

**Clip item:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scene_number` | number | Yes | Order (1-based). |
| `scene_id` | string | No | For logging. |
| `url` | string | Yes | Public URL of the scene video (must be fetchable by the service). |
| `duration_sec` | number | No | Hint for concat list; service can probe. |

**Example request:**

```json
{
  "parent_id": "SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1",
  "task_id": "SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1",
  "candidate_id": "SNS_2026W09_Multi_0003",
  "asset_id": "SNS_2026W09_Multi_0003__VIDEO_v1",
  "output_path": "SNS_2026W09/SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1/merged.mp4",
  "clips": [
    { "scene_number": 1, "scene_id": "SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1__scene_01", "url": "https://...", "duration_sec": 3 },
    { "scene_number": 2, "scene_id": "SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1__scene_02", "url": "https://...", "duration_sec": 3 }
  ]
}
```

### Response (success)

- **Sync:** `200 OK` with body below when merge + upload finish within request timeout (e.g. 2–5 min).
- **Async:** `202 Accepted` with `job_id` and `status_url`; client polls `GET /stitch/status/:job_id` until `status === "COMPLETED"` or `"FAILED"`.

**Body (sync 200 or from status when completed):**

```json
{
  "ok": true,
  "status": "COMPLETED",
  "job_id": "stitch_abc123",
  "merged_video_url": "https://your-project.supabase.co/storage/v1/object/public/assets/SNS_2026W09/SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1/merged.mp4",
  "storage_path": "SNS_2026W09/SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1/merged.mp4",
  "bucket": "assets",
  "duration_sec": 18
}
```

**Body (async 202):**

```json
{
  "ok": true,
  "accepted": true,
  "job_id": "stitch_abc123",
  "status_url": "/stitch/status/stitch_abc123",
  "status": "PENDING"
}
```

**Status response (`GET /stitch/status/:job_id`):**

- `200`: `{ "ok": true, "status": "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED", "job_id": "...", "merged_video_url?: "...", "storage_path?: "...", "error?: "..." }`

### Behaviour

- Service fetches each `clips[].url` (HTTP GET), writes to temp files, builds ffmpeg concat list (by `scene_number` order), runs ffmpeg, uploads result to Supabase Storage at `bucket` + `output_path`.
- Service needs: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`), bucket name (e.g. `assets`). Upload via Supabase Storage API (service role).
- **Variation safety:** `output_path` already includes `task_id` (e.g. `..._v1` / `_v2`). Do not reuse the same path for different variations; no extra `render_bundle_id` is required if `task_id` is unique per variation.

### Errors

- `400`: Missing `parent_id`, `task_id`, `output_path`, or `clips`; or `clips` empty.
- `502` / `504`: Fetch or ffmpeg timeout.
- `500`: Upload or internal error. Response: `{ "ok": false, "error": "..." }`.

---

## 2. Remote audio / mux service (voiceover + subtitles + final video)

**Purpose:** Mux a **pre-generated voiceover audio file** onto the merged video, optionally upload an SRT, optionally **burn** subtitles into the video (re-encodes with `libx264`), upload final artifacts to Supabase.

**Implementation note (CAF `services/video-assembly`):** The service does **not** run TTS from `voiceover_text`. n8n (or another step) must produce audio and pass **`voiceover_audio_url`** (HTTP-fetchable URL, same pattern as stitch clip URLs).

### Endpoint

- **`POST /mux`** (or `POST /video/mux`)

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parent_id` | string | Yes | Parent bundle id. |
| `merged_video_url` | string | Yes | URL of the stitched video (from stitch step). |
| `voiceover_audio_url` | string | Conditional | Single narration file URL — **required** unless `voiceover_segments` is used. Mutually exclusive with `voiceover_segments`. |
| `voiceover_segments` | array | Conditional | Per-line TTS sync: `[{ "text": "One line.", "audio_url": "https://.../line1.mp3" }, ...]`. Service **ffprobe**s each file for exact duration, builds **SRT in lockstep**, **concats** audio to one track, then muxes like a normal `voiceover_audio_url`. Use with **`POST /mux/chunk-script`** to split the script before TTS. **Do not** send `voiceover_audio_url` together with this field. |
| `subtitles_srt` | string | No | Full SRT file content. |
| `scenes_for_srt` | array | No | `[{ scene_number, duration_sec, text }]` — **By default, `duration_sec` is ignored** and timing uses **equal split**: each cue gets `voiceover_length / N` seconds (slowest, steadiest pacing). Set **`MUX_CAPTION_TIMING_MODE=weighted`** (or body **`caption_timing_mode`**: `weighted`) for char‑softened weights + min dwell. Set **`MUX_USE_SCENE_DURATION_FOR_SRT=true`** to use payload `duration_sec` (legacy). With **`subtitle_align`**: `whisper`, timings come from **OpenAI word-level timestamps** on `voiceover_audio_url`; your `text` is mapped across those words (no need for segment count to match Whisper). |
| `spoken_script` | string | No | Full narration as one string (used when you do **not** send `scenes_for_srt` / `subtitles_srt`). Split into caption lines using **`caption_line_max_chars`** (and chunk rules). With **`subtitle_align`**: `whisper`, timings follow Whisper words; script text is mapped by line. |
| `subtitle_align` | string | No | Set to **`whisper`** for audio-locked captions: service calls OpenAI **transcriptions** with **word timestamps** on the downloaded voiceover. Requires **`OPENAI_API_KEY`** on the mux host. Can also set env **`MUX_SUBTITLE_ALIGN=whisper`** so n8n can omit the field. |
| `subtitle_caption_source` | string | No | With Whisper: **`payload`** (default) = on-screen text from your **`scenes_for_srt` / `spoken_script`**; **`transcript`** = on-screen text is Whisper’s words (grouped). Env: **`MUX_WHISPER_CAPTION_SOURCE`**. |
| `caption_line_max_chars` | number | No | Max characters per line when auto-chunking **`spoken_script`** or grouping Whisper **`transcript`** lines (default 80 or **`MUX_CHUNK_SCRIPT_MAX_CHARS`**). |
| `caption_timing_mode` | string | No | **`equal`** \| **`weighted`** — only used when **not** using Whisper and **not** legacy `MUX_USE_SCENE_DURATION_FOR_SRT`. |
| `caption_min_sec` | number | No | Optional pacing hint for weighted/equal paths (see env **`MUX_MIN_CAPTION_SEC`**). |
| `caption_weight_exponent` | number | No | Optional for weighted mode (see **`MUX_CAPTION_WEIGHT_EXPONENT`**). |
| `output_path_final` | string | Yes | Path for final video in bucket. E.g. `SNS_2026W09/.../final.mp4`. |
| `output_path_voiceover` | string | No | Path to store a copy of the voiceover in the bucket. E.g. `.../voiceover.mp3`. |
| `output_path_subtitles` | string | No | Path to upload the SRT file (optional; **not** required for burn — burn uses in-memory/temp SRT). |
| `burn_subtitles` | boolean | No | If `true`, burn subtitles into the final video (requires a subtitle source: `subtitles_srt`, `scenes_for_srt`, `spoken_script`, or segment text). Uses ffmpeg **libass** (`subtitles` filter), **bottom-centered** by default (`Alignment=2`, `MarginV=56`, **FontSize=22**). Re-encodes with `libx264`. Override styling with env **`MUX_BURN_SUBTITLE_FORCE_STYLE`**. Default false. |
| `subtitle_duration_scale` | number | No | **Only when `MUX_USE_SCENE_DURATION_FOR_SRT=true` (legacy `scenes_for_srt` timings):** multiplies each scene’s `duration_sec`. Ignored for default voice-synced `scenes_for_srt`, `voiceover_segments`, and `spoken_script` paths. Optional env **`MUX_SUBTITLE_DURATION_SCALE`**. Does not rewrite raw `subtitles_srt`. |

### `POST /mux/chunk-script` (optional helper)

Split a full narration script into **short lines** (one caption / one TTS call per chunk). **Does not** call TTS — n8n loops chunks → TTS → collects URLs for `voiceover_segments`.

**Body:** `{ "script": "Full text…", "max_chars": 80, "min_chars": 20 }` — `max_chars` defaults from env **`MUX_CHUNK_SCRIPT_MAX_CHARS`** (default 80) if omitted.

**Response:** `{ "ok": true, "chunks": ["Line one.", "Line two."], "count": 2 }`

**Example request (with caption burn):**

```json
{
  "parent_id": "SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1",
  "merged_video_url": "https://.../merged.mp4",
  "voiceover_audio_url": "https://.../voiceover.mp3",
  "subtitles_srt": "1\n00:00:00,000 --> 00:00:03,000\nScene 1 text.\n\n2\n00:00:03,000 --> 00:00:06,000\nScene 2 text.\n",
  "output_path_final": "SNS_2026W09/SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1/final.mp4",
  "output_path_voiceover": "SNS_2026W09/SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1/voiceover.mp3",
  "output_path_subtitles": "SNS_2026W09/SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1/subtitles.srt",
  "burn_subtitles": true
}
```

### Response (success)

- **Sync:** `200 OK` with body below when TTS + mux + upload finish.
- **Async:** `202 Accepted` with `job_id` and `status_url`; poll until `status === "COMPLETED"` or `"FAILED"`.

**Body (sync 200 or from status when completed):**

```json
{
  "ok": true,
  "status": "COMPLETED",
  "job_id": "mux_456",
  "final_video_url": "https://.../final.mp4",
  "voiceover_url": "https://.../voiceover.mp3",
  "subtitles_url": "https://.../subtitles.srt"
}
```

**Status:** Same pattern as stitch (`GET /mux/status/:job_id`). Poll responses include **`stage`** (e.g. `whisper_transcribe`, `ffmpeg_mux`) while `status` is `PROCESSING` — useful for n8n logging and timeouts.

### Behaviour

- Download `merged_video_url` and `voiceover_audio_url`.
- **Audio in the final file** always comes from the muxed voiceover: either **`voiceover_audio_url`** or audio **concatenated** from **`voiceover_segments`**. The merged clip’s embedded audio track is **not** copied to the output, so narration is not accidentally replaced by scene audio.
- **`voiceover_segments` flow:** download each `audio_url` → **ffprobe** duration → build SRT segments with those durations and matching `text` → **ffmpeg concat** → single `voiceover.mp3` → same burn/mux path as today. Caption timing matches the real TTS length per line.
- Build SRT from `subtitles_srt`, or from `scenes_for_srt` (ordered by `scene_number`; **default:** timings from measured voiceover, not `duration_sec`), or from `spoken_script` when no scenes/subtitles.
- **`subtitle_align`:** `whisper`: after downloading the voiceover, the service requests **verbose_json** transcription with **word + segment** granularities, builds SRT from **word timings** (and optional **prompt** from your script/scenes), then mux/burn as usual. Adds latency (API + ffmpeg) vs proportional sync only.
- If `burn_subtitles` is true: ffmpeg **burns** subtitles (libass); video is re-encoded (`libx264`), audio muxed as AAC.
- If `burn_subtitles` is false: video stream is copied (`-c:v copy`), audio muxed as AAC.
- Upload: final video to `output_path_final`; optional uploads for voiceover and SRT when `output_path_voiceover` / `output_path_subtitles` are set.
- **Review Console (optional, default on):** after upload, the mux service updates **`tasks`** (`final_video_url`, `merged_video_url` from the request’s merged clip URL, optional `voiceover_url` / `subtitles_url`) and upserts one **`assets`** row with `asset_type = final_video` for the first matching `task_id` (tries `parent_id`, optional body **`task_id`**, and id variants such as `__v1` / `__SCENE_BUNDLE`). Disable with env **`MUX_SYNC_SUPABASE_TASK=0`** if you only want Storage uploads.
- Same Supabase credentials as stitch service; bucket `assets` (or `SUPABASE_ASSETS_BUCKET`). Service role must be allowed to **`update` `tasks`** and **`insert`/`update` `assets`**.

**Fly.io / Docker:** The **media-gateway** image includes `ffmpeg` and `fonts-liberation` for subtitle rendering. Set the same Supabase env vars as stitch (`NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). For Whisper alignment, set **`OPENAI_API_KEY`** on the same app (see `fly.media-gateway.toml` comments).

### Errors

- `400`: Missing `parent_id`, `merged_video_url`, or `output_path_final`; or neither `voiceover_audio_url` nor `voiceover_segments`; or both voiceover modes sent together.
- Job `FAILED`: e.g. `burn_subtitles` with no subtitle content, ffmpeg/libass errors, or Supabase upload errors.
- `502`/`504`: Timeout.
- `500`: `{ "ok": false, "error": "..." }`.

---

## 3. n8n orchestration structure

High-level sequence (parent-first, then scenes, then parent-level assembly):

```
Aggregate Scene Prompt Outputs
  → Loop parent bundles (1 at a time)
    → Explode scenes
    → Loop scenes (1 at a time)
      → Generate scene video (HeyGen/Sora/etc.)
      → Normalize scene render result (rendered_scene_url, duration_sec)
    → Aggregate rendered scenes by parent_id (sort by scene_number)
    → Build stitch payload (parent_id, task_id, output_path, clips[])
    → Call remote stitch service (POST /stitch)
    → Normalize stitch result (merged_video_url)
    → Build full narration script (join scene_script in order)
    → Build mux payload (parent_id, merged_video_url, voiceover_audio_url, scenes_for_srt with text per scene, burn_subtitles?, output_path_*)
      — caption timing is aligned to the voiceover file automatically unless MUX_USE_SCENE_DURATION_FOR_SRT=true
    → Call remote mux service (POST /mux)
    → Normalize final result (final_video_url, voiceover_url, subtitles_url)
    → Write metadata to Supabase (assets + optional task columns)
```

**Optional (advanced):** per-line TTS + `voiceover_segments`, or `POST /mux/chunk-script` to split a script before TTS.

**Whisper-synced burns:** add **`subtitle_align`:** `whisper` (and **`OPENAI_API_KEY`** on Fly). See **§3.1** below.

### 3.1 n8n: enable Whisper-synced captions (step by step)

Do these once per environment (e.g. production Fly app + n8n), then wire your existing **Merge Voice → Build Mux Payload → Mux Start → Poll** branch.

1. **Fly (media-gateway / `caf-renderer`) secrets**  
   From the machine that runs mux (same app as stitch if you use the bundled gateway):

   ```bash
   fly secrets set OPENAI_API_KEY="sk-..." --app caf-renderer
   ```

   Optional defaults so the HTTP body stays minimal:

   ```bash
   fly secrets set MUX_SUBTITLE_ALIGN=whisper MUX_WHISPER_CAPTION_SOURCE=payload --app caf-renderer
   ```

   Redeploy if the image was built before Whisper support: `fly deploy --config fly.media-gateway.toml`.

2. **Confirm the service sees the key**  
   `GET https://<your-fly-host>/health` → **`capabilities.mux_whisper_align_available`** should be **`true`**.

3. **n8n: base URL**  
   Store **`VIDEO_ASSEMBLY_BASE_URL`** (e.g. `https://caf-renderer.fly.dev`) in n8n **Variables** or **Credentials** so HTTP nodes don’t hardcode hosts.

4. **Merge Voice (before Build Mux Payload)**  
   Ensure the merged item includes at least:

   - `merged_video_url` (from stitch)
   - `voiceover_audio_url` (public URL to the same audio file n8n used for TTS)
   - `parent_id` (or `task_id` you use for paths)
   - **Either** `scenes_for_srt`: `[{ scene_number, text, duration_sec? }, ...]` **or** a single `spoken_script` string that matches narration order
   - Output paths: `output_path_final`, and optionally `output_path_voiceover`, `output_path_subtitles`

5. **Build Mux Payload (Code or Set node)**  
   Add to the JSON you already send:

   | Field | Value |
   |--------|--------|
   | `burn_subtitles` | `true` (required for visible captions) |
   | `subtitle_align` | `"whisper"` (omit if you set `MUX_SUBTITLE_ALIGN=whisper` on Fly) |
   | `subtitle_caption_source` | `"payload"` (default: your scene/script text on screen) or `"transcript"` (Whisper’s words) |

   Keep sending **`scenes_for_srt`** or **`spoken_script`** so **`payload`** mode has text to map. Order of lines should match spoken order.

6. **Mux Start (HTTP Request)**  
   - **Method:** POST  
   - **URL:** `{{ $vars.VIDEO_ASSEMBLY_BASE_URL }}/mux?async=1` (or your expression; **query `async=1`** avoids n8n HTTP timeout).  
   - **Body:** JSON — the object from step 5 (same fields as sync mode).  
   - **Headers:** `Content-Type: application/json`  

   From the response, read **`job_id`** (and optionally **`status_url`**).

7. **Poll loop**  
   - **GET** `{{ $vars.VIDEO_ASSEMBLY_BASE_URL }}/mux/status/{{ $json.job_id }}`  
   - **Wait** 5–15 s between tries (Whisper + ffmpeg can take several minutes).  
   - **Exit when** `status === "COMPLETED"` → use `final_video_url`, etc.  
   - **Exit when** `status === "FAILED"` → read `error`, `failed_stage`, `stage`.  
   - Optional: log **`stage`** while processing (`whisper_transcribe`, `downloading_voiceover_audio`, `ffmpeg_mux`, …).

8. **n8n workflow settings**  
   Increase **execution timeout** / loop **max iterations** so a single run can outlive Whisper + burn (e.g. 15–25+ minutes if your videos are long).

**Copy-paste Code node:** see repo **`examples/n8n-build-mux-payload.js`** — set the node to **Run Once for Each Item**, adjust property names to match your **Merge Voice** output, then pass **`$json`** as the HTTP Request body.

### 3.2 Example mux body (Whisper + scenes + async)

```json
{
  "parent_id": "SNS_2026W09__Multi__FLOW_VIDEO__row0003__v1",
  "merged_video_url": "https://.../merged.mp4",
  "voiceover_audio_url": "https://.../voiceover.mp3",
  "burn_subtitles": true,
  "subtitle_align": "whisper",
  "subtitle_caption_source": "payload",
  "scenes_for_srt": [
    { "scene_number": 1, "text": "First line as on your sheet." },
    { "scene_number": 2, "text": "Second line." }
  ],
  "caption_line_max_chars": 42,
  "output_path_final": "SNS_2026W09/.../final.mp4",
  "output_path_voiceover": "SNS_2026W09/.../voiceover.mp3",
  "output_path_subtitles": "SNS_2026W09/.../subtitles.srt"
}
```

`duration_sec` on scenes is optional for this path (Whisper drives timing).

### Rules

- **Inside the scene loop:** Only scene-level operations: validate scene, call scene render API, normalize result (e.g. set `rendered_scene_url`, `duration_sec` on each scene).
- **After the scene loop, per parent:** Aggregate all scene outputs for that parent (by `parent_id`), then run stitch → mux → Supabase write. No cross-parent mixing.
- **Stitch payload:** Build `clips` from aggregated scenes: `scene_number`, `scene_id`, `url` = `rendered_scene_url`, `duration_sec` = scene’s duration or default.
- **Output paths:** Use a stable pattern, e.g. `{run_id}/{task_id}/merged.mp4`, `{run_id}/{task_id}/final.mp4`, so each variation (`task_id` = `..._v1` / `_v2`) has its own path and there are no collisions.

---

## 4. Supabase: minimal metadata to persist

Two approaches (can combine):

### A. Use `assets` table only (recommended)

Store every artifact as an asset row keyed by `task_id` (parent):

| task_id | asset_type | position | bucket | object_path | public_url (or derived) |
|---------|------------|----------|--------|-------------|--------------------------|
| ..._v1 | scene_clip | 1 | assets | .../scene_01.mp4 | ... |
| ..._v1 | scene_clip | 2 | assets | .../scene_02.mp4 | ... |
| ..._v1 | merged_video | 0 | assets | .../merged.mp4 | ... |
| ..._v1 | final_video | 0 | assets | .../final.mp4 | ... |
| ..._v1 | voiceover | 0 | assets | .../voiceover.mp3 | ... |
| ..._v1 | subtitles | 0 | assets | .../subtitles.srt | ... |

- **asset_type:** `scene_clip` | `merged_video` | `final_video` | `voiceover` | `subtitles`.
- **position:** 0 for single-per-type assets; 1..N for scene clips (by scene_number).
- Review console (and `/content/[task_id]`) can keep using “first asset’s public_url” for video by preferring `asset_type = 'final_video'` then `merged_video` then first asset.

### B. Optional task-level columns (quick display)

If you want a single “primary video” on the task row for filters/APIs:

- `merged_video_url` (text, nullable)
- `final_video_url` (text, nullable) — primary playback URL
- `voiceover_url` (text, nullable)
- `subtitles_url` (text, nullable)

Populate these when writing after mux; keep assets table as source of truth for all artifacts. Prefer reading `final_video_url` from task when present, else derive from assets (first `final_video` or `merged_video` asset).

### Recommendation

- **Minimum:** Use **assets only** with `asset_type` and `position`; n8n (or the stitch/mux services) insert/upsert rows after stitch and mux. No schema change required if `assets` already has `asset_type` and supports multiple rows per `task_id`.
- **Convenience:** Add the four task-level URL columns above and set them when persisting assembly results, so the Review Console and content view can show the final video without joining to assets.

---

## 5. Variation and collision

- **Same asset_id, multiple variations:** You already have different `task_id`s per variation (e.g. `..._v1`, `..._v2`). Use `task_id` in the storage path (e.g. `{run_id}/{task_id}/merged.mp4`). No need for a separate `render_bundle_id` unless you introduce a concept of “bundle” that is distinct from “task” (e.g. one asset_id with several render attempts). For current “one parent bundle = one task_id” model, `task_id` is enough.
- **Idempotency:** If the same parent is re-run, overwriting the same `output_path` is acceptable (same task_id → same path). If you need to keep multiple attempts, add a suffix to the path (e.g. timestamp or attempt id).

---

## 6. Design pitfalls and mitigations

| Risk | Mitigation |
|------|-------------|
| **Long-running stitch/mux** | Prefer async (202 + poll) so n8n doesn’t hit HTTP timeouts; or run stitch/mux in a worker and have n8n poll a single “assembly status” endpoint. |
| **Clip URLs not publicly reachable** | Stitch service must be able to GET each clip URL (same network or public URLs). If HeyGen/Sora return signed or short-lived URLs, ensure they’re still valid when stitch runs (e.g. run stitch immediately after scene loop). |
| **Large memory / disk** | Stitch service should stream or use temp files and delete after upload; limit concurrent stitch jobs per process. |
| **Supabase upload auth** | Stitch and mux services must use a key with Storage write (e.g. service role). Use the same bucket and path convention as carousels (`assets` bucket). |
| **SRT timing mismatch** | Build SRT from `scene_estimated_duration_sec` so segment boundaries align with stitched clips; if actual durations differ, consider a second pass or “loose” SRT. |
| **Prompt/continuity quality** | Out of scope here; focus on workflow and contracts first. |

---

## 7. Summary

- **Stitch:** `POST /stitch` with `parent_id`, `task_id`, `output_path`, `clips[]` → returns `merged_video_url` (sync or async).
- **Mux:** `POST /mux` with `parent_id`, `merged_video_url`, `voiceover_audio_url`, optional `subtitles_srt` / `scenes_for_srt`, optional `burn_subtitles`, `output_path_*` → returns `final_video_url`, `voiceover_url`, `subtitles_url`.
- **n8n:** Parent loop → scene loop (render only) → aggregate by parent → stitch → build script + SRT → mux → write to Supabase (assets + optional task URL columns).
- **Supabase:** Prefer storing all artifacts in `assets` with `asset_type`; optionally add task-level URL columns for primary video and links.
- **Collisions:** Use `task_id` (and thus path) per variation; no extra `render_bundle_id` required for the described parent→scenes→stitch→mux flow.

Prompt/continuity improvements can be tackled separately from this architecture.
