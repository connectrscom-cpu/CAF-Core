# CAF — Current IDs and State Conventions

## Purpose of this document

CAF already relies heavily on naming and state conventions.

These conventions are not cosmetic.
They are part of the operating contract between:
- Sheets
- n8n
- Supabase
- render services
- review flows

If the rebuild ignores them, continuity breaks.

---

## 1. Why the ID system matters

CAF joins work across phases using explicit IDs rather than hidden database relations.

That is one of the strongest parts of the current design.

The main IDs are:
- `run_id`
- `candidate_id`
- `task_id`
- `draft_id`
- `asset_id`
- scene-level IDs such as `scene_id`
- parent-child IDs such as `parent_id` and `parent_candidate_id`

These must stay understandable and stable during migration.

---

## 2. `run_id`

### Meaning
A single processing/creation cycle or batch.

### Observed example
`SNS_2026W09`

### Current usage
Appears across:
- Signal Packs
- Content Candidates
- Content Jobs
- Validation
- Publishing
- storage path conventions

### Practical rule
`run_id` is the top-level lineage anchor for a batch of work.

---

## 3. `candidate_id`

### Meaning
A content idea instance tied to a run and route.

### Observed example
`SNS_2026W09_Instagram_0002`

Another observed family:
`SNS_2026W09_Multi_0012`

### Current usage
Appears across:
- Content Candidates
- Content Jobs
- Review Queue
- Publishing
- scene-bundle parent relationships

### Practical rule
A candidate is the bridge between an idea and the executable jobs derived from it.

---

## 4. `task_id`

### Meaning
A single executable job row.

### Observed example
`SNS_2026W09__Instagram__FLOW_CAROUSEL__row0002__v1`

Observed video / multi example:
`SNS_2026W09__Multi__FLOW_VIDEO__row0012`

Observed scene-bundle example:
`SNS_2026W09__Multi__FLOW_VIDEO__row0021__SCENE_BUNDLE`

### Current usage
Appears across:
- Content Jobs
- Review Queue
- Job Drafts
- render payloads
- storage path conventions
- asset linkage
- validation event lineage

### Practical rule
`task_id` is the main execution key.
If another system does not preserve `task_id`, CAF continuity breaks.

---

## 5. `draft_id`

### Meaning
A single rework / editable draft instance.

### Observed example
`d_mn398eopb4y3`

### Current usage
Appears in:
- Content Jobs
- Job Drafts

### Practical rule
Drafts preserve edit history rather than overwriting a single job state with no memory.

---

## 6. `asset_id`

### Meaning
A produced media asset linked to a job or candidate lineage.

### Observed example
`SNS_2026W09_Multi_0005__VIDEO_v1`

### Current usage
Appears in:
- Content Jobs
- scene-bundle payloads
- render-linked rows
- asset storage logic

### Practical rule
`asset_id` identifies the produced artifact family, not just the execution row.

---

## 7. `reference_post_id`

### Meaning
A manually tracked reference example used in format analysis.

### Observed example
`REF_0001`

### Current usage
Appears in:
- Reference_Posts
- Viral Format Library

### Practical rule
This is not runtime execution state. It is reference intelligence state.

---

## 8. Parent-child ID conventions

CAF also uses parent-child lineage explicitly.

### Common fields
- `parent_id`
- `parent_candidate_id`
- `debug_task_id`

### Why they exist
They are especially important for:
- scene-bundle workflows
- derived render tasks
- merged outputs
- post-process steps
- rework memory

### Example pattern
A scene bundle may carry:
- `parent_id = SNS_2026W09__Multi__FLOW_VIDEO__row0021`
- `task_id = SNS_2026W09__Multi__FLOW_VIDEO__row0021__SCENE_BUNDLE`
- `candidate_id = SNS_2026W09_Multi_0021__SCENE_BUNDLE`
- `parent_candidate_id = SNS_2026W09_Multi_0021`

This allows CAF to distinguish:
- the original conceptual execution row
- the special scene-bundle execution artifact derived from it

---

## 9. Scene-level ID conventions

Scene workflows introduce lower-level IDs.

### Common fields
- `scene_id`
- `scene_number`

### Example
`SNS_2026W09__Multi__FLOW_VIDEO__row0012__scene_01`

### Why they matter
They allow:
- ordering scenes
- tracking failures by scene
- stitch/mux logic
- subtitle generation
- diagnostics at scene level if needed later

---

## 10. Structural pattern of current IDs

The current naming system is intentionally descriptive.

### Common `task_id` pattern
`{run_id}__{platform}__{flow_type}__row{NNNN}__{variation_or_special_suffix}`

### Common `candidate_id` pattern
`{run_id}_{platform}_{NNNN}`  
or derived special forms such as `__SCENE_BUNDLE`

### Common `asset_id` pattern
`{candidate_id}__{ASSET_TYPE}_v{version}`

These patterns are not perfectly universal in every edge case, but they are strong enough to preserve as first-class conventions.

---

## 11. State-family conventions

CAF also relies on explicit state columns.
These are functionally as important as IDs.

### Routing state
Typical fields:
- `recommended_route`
- `origin_platform`
- `target_platform`
- `platform`
- `carousel_route`

### Quality state
Typical fields:
- `qc_status`
- `qc_fail_reasons`
- `risk_score`
- `risk_flags`
- `risk_level`

### Render state
Typical fields:
- `render_provider`
- `render_status`
- `render_job_id`
- `video_url`

### Human review state
Typical fields:
- `review_status`
- `decision`
- `rejection_tags`
- `final_*_override`
- `validator`
- `submit`
- `submitted_at`

### Revision-memory state
Typical fields:
- `draft_id`
- `attempt_no`
- `revision_round`

### Scene / aggregation state
Typical fields:
- `expected_scene_count`
- `actual_scene_count`
- `ok_scene_count`
- `failed_scene_count`
- `failed_scene_numbers_json`
- `failed_scene_ids_json`
- `missing_scene_numbers_json`
- `all_scenes_ready`
- `parent_render_status`
- `parent_render_error`
- `aggregation_status`

---

## 12. Important observed statuses

There is not yet one perfect enum registry, but current observed values include status families such as:

### Execution / job status
- `ok`
- `error`
- `GENERATED`
- `READY_FOR_SCENE_RENDER`
- `PENDING_SCENE_RENDER`
- `APPROVED`
- `NEEDS_REVIEW`

### Render status
- `NOT_STARTED`
- provider-specific progress states
- completion / failure states depending on workflow path

### Review decisions
- `APPROVED`
- `NEEDS_EDIT`
- `REJECTED`

### Route values
- `HUMAN_REVIEW`
- `AUTO_PUBLISH` in some logic
- manual-review equivalents in older flow logic

### Aggregation / scene readiness
- `OK`
- `READY_FOR_SCENE_RENDER`

The rebuild should normalize these into explicit enums later, but it should first preserve compatibility with what exists.

---

## 13. Storage-path conventions

Storage keys commonly encode lineage using current IDs.

### Examples
- `assets/audios/SNS_2026W09/SNS_2026W09__Multi__FLOW_VIDEO__row0005__v3/audio.mp3`
- `videos_edit/SNS_2026W09/SNS_2026W09__Multi__FLOW_VIDEO__row0015/merged.mp4`

### Why this matters
This provides:
- provenance
- easier tracing
- safer re-renders
- clearer debugging

CAF Core should preserve this principle even if the exact path scheme evolves.

---

## 14. Review queue semantics tied to state

Eligibility for review is not arbitrary.
It is governed by explicit row state.

Typical deciding fields include:
- `review_status`
- `status`
- `submit`
- readiness of preview assets / URLs

The review app must obey those semantics.
If CAF Core changes these semantics without compatibility planning, review behavior will break.

---

## 15. Migration rule

During migration:
- keep current external IDs stable
- map new internal primary keys behind them if needed
- do not casually rename job lineage keys
- do not lose parent-child traceability
- do not collapse scene-bundle identities into vague generic objects

This is one of the few parts of the current system that is already disciplined enough to preserve almost as-is.
