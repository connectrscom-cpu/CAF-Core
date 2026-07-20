# CAF Current State Context Pack — Data Contracts and Flows

**Volume 2 of 4** | Regenerated 2026-07-16 from `docs/CAF_CURRENT_STATE_CONTEXT_PACK.md`  
**Planning LLMs:** `docs/FABLE_IMPROVEMENT_BRIEFING.md`

---

## 5. Database schema map

Grouped by domain (**83** migrations through `082_flow_vid_ugc.sql`; notable recent: `081_text_content_flows.sql`, `082_flow_vid_ugc.sql`, prior BVS `078`):

### Core pipeline
`projects`, `runs`, `content_jobs`, `job_drafts`, `assets`, `job_state_transitions`, `signal_packs`, `signal_pack_ideas`, `signal_pack_selected_ideas`, `ideas`, `idea_grounding_insights`

**Writers:** `run-orchestrator.ts`, `job-pipeline.ts`, `runs.ts`  
**Readers:** all routes keyed by `task_id`

### Review / QC / validation
`editorial_reviews`, `diagnostic_audits`, `auto_validation_results`, `qc_checklists`, `qc_flow_profiles`

**Writers:** `validation-router.ts`, review routes, `qc-runtime.ts` (payload only)

### Flow engine / prompts
`flow_definitions`, `prompts`, `prompt_versions`, `prompt_schemas`, `carousel_templates`, `risk_policies`

**Writers:** migrations seed, `flow-engine.ts` admin  
**Readers:** `llm-generator.ts`, `qc-runtime.ts`

### Project configuration
`project_strategy`, `brand_constraints`, `product_profiles`, `platform_constraints`, `project_system_constraints`, `project_brand_assets`, `brand_profiles`, `brand_bibles`, `heygen_config`, `project_integrations`, `risk_rules` (not QC-enforced)

### Inputs / evidence
`inputs_evidence_imports`, `inputs_evidence_rows`, `inputs_evidence_row_insights`, `inputs_evidence_packs`, `inputs_processing_profiles`, `inputs_source_rows`, `inputs_scraper_config`, `inputs_scraper_runs`, `inputs_idea_lists`, `inputs_ideas`, `evidence_media_assets`, `insights_packs`

### Creative intelligence / mimic
`creative_intelligence_assets`, `creative_intelligence_analyses`, `creative_intelligence_insights` (migration 055+)

### Learning / performance
`learning_rules`, `suppression_rules`, `learning_observations`, `learning_hypotheses`, `learning_insights`, `learning_generation_attribution`, `performance_metrics`, `performance_ingestion_batches`, `run_content_outcomes`, `job_outcomes` (075), `llm_approval_reviews`

### Publishing
`publication_placements`, `project_integrations`

### Operations / audit
`api_call_audit`, `run_context_snapshots`, `run_output_reviews`

---

## 6. Lifecycle map

### Runs
See §3. Terminal: `COMPLETED`, `FAILED`, `CANCELLED`.

### Content jobs
See §3. Editorial terminal: `APPROVED`, `REJECTED`. Rework re-enters `GENERATING`.

### Editorial decisions (`editorial_reviews.decision`)
`APPROVED` | `NEEDS_EDIT` | `REJECTED`

### Publication placements
`draft` → `scheduled` → `publishing` → `published` | `failed` | `cancelled`

### Learning rules
`pending` → `active` | `superseded` | `rejected` | `expired`

### Provider render state (`generation_payload.render_state`)
HeyGen: `video_id`, `session_id` — retry guard via `hasActiveProviderSession()` (`content-job-render-state.ts`).  
Scene assembly: `scene_bundle` progress, Sora job IDs.  
Carousel: `isCarouselRenderComplete()`.

### QC recommended routes (`qc_result.recommended_route`)
`AUTO_PUBLISH` | `BLOCKED` | `DISCARD` | `REWORK_REQUIRED` | `HUMAN_REVIEW`  
Default `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC=true` remaps clean QC to `HUMAN_REVIEW`.

---

## 7. Critical JSON contracts

### `content_jobs.generation_payload` (main integration contract)

| Slice | Meaning | Read/write helpers |
|-------|---------|-------------------|
| Plan-time base | `schema_version`, `signal_pack_id`, `candidate_data`, prompt binding | `buildPlannedGenerationPayloadBase()` (`stage-contract.ts`) |
| `generated_output` | LLM output body | `pickGeneratedOutput()`, `hasGeneratedOutput()` |
| `qc_result` | QC pass/fail, findings, route | `pickStoredQcResult()`, **`mergeGenerationPayloadQc()`** (only writer) |
| `render_state` | Provider sessions, carousel progress | `pickRenderState()`, `hasActiveProviderSession()`, `isMidProviderPhase()` |
| `mimic_v1` | Mimic render truth | `pickMimicPayload()`, `MIMIC_PAYLOAD_KEY` |
| `mimic_carousel_package` | Draft package for TP-grounded carousels | `pickMimicCarouselDraftPackage()` — all `isTpGroundedCarouselRenderFlow()` |
| `carousel_package` | Standard `FLOW_CAROUSEL` only | `draft-package-contract.ts` |
| `bvs_v1` | Frozen brand bible snapshot | `parseBvsV1()`, `attachBvsToPlannedPayload()` |
| `mimic_job_grounding` | Plan-time mimic grounding | `mimic-job-grounding.ts` |
| `semantic_contract_v1` | Cross-flow semantic constraints | `semantic-contract.ts` |
| `content_display` | Display metadata for Review | `content-display-metadata.ts` |
| `layout_qc` | Post-render layout QA blob | `mimic-composite-layout-qa.ts` |
| `docai_layer_positions` | Inside `mimic_v1` — reviewer text boxes | `mimic-docai-layer-positions.ts` |
| `scene_bundle` | Scene assembly progress | scene-pipeline types |
| `schema_validation_warnings` | Non-fatal LLM schema issues | when `CAF_OUTPUT_SCHEMA_VALIDATION_MODE=warn` |
| Publish snapshots | URLs after approval | `validation-router.ts` |

### `mimic_v1` key fields

```typescript
// src/domain/mimic-payload.ts (abridged)
{
  schema_version: 1,
  execution_mode?: "classic" | "why_mimic" | "new_visual",
  mode: "image_full" | "template_bg" | "carousel_visual",
  reference_items[], visual_guideline, slide_plans[],
  flux_image_prompts?, docai_layer_positions?,
  bvs_enabled?, bvs_bible_snapshot?, bvs_render_plan?,
  slide_intelligence?, brand_execution_brief?
}
```

### `bvs_v1` key fields

```typescript
// src/domain/bvs-v1.ts
{ schema_version: "bvs_v1", enabled: boolean, bible_version, bible_snapshot }
```

### Signal pack JSON (high-signal fields)

- `overall_candidates_json` — raw idea rows
- `visual_guidelines_pack_v1` — merged styling for mimic
- `mimic_mode_overrides` — per-insight reviewer mode overrides
- `derived_globals_json` — CI styling merge output

### Risky untyped areas

- Ad-hoc reads of `candidate_data` nested fields in Review components
- Legacy `ideas_json` on older signal packs
- `render_manifest` (commented in migrations, sparse usage)
- Some admin HTML forms bypass typed helpers

---

## 8. Flow types and content formats

### Content routes (marketer lanes)

Human-facing **lanes** toggle `allowed_flow_types` + idea-generation quotas together.

- **Source of truth:** `src/domain/content-routes.ts` (+ apply helper `src/services/content-routes-apply.ts`)
- **Catalog doc:** `docs/CONTENT_ROUTES.md`
- **Setup:** chosen in `docs/PROJECT_SETUP_CHECKLIST.md` § Content routes; editable later in Review Brand profile → Content routes (`ContentRoutesEditor.tsx`)
- **Groups:** `carousel` | `video` | `text`
- When a lane is **off:** related flows `enabled=false`, related idea buckets set to **0**, Ideas/cart hide that lane

Key lane ids: `niche_carousels`, `product_carousels`, `visual_first_carousels`, `top_performer_mimic_carousel`, `why_mimic_carousels`, `avatar_video_script`, `avatar_video_prompt`, `video_no_avatar`, `hook_first_video`, `ugc_video`, `product_marketing_videos`, `linkedin_posts`, `reddit_posts`, `instagram_threads`.

`FLOW_CAROUSEL` stays enabled if **either** niche or product carousels is on.

### Canonical utility / copy flows (`canonical-flow-types.ts`)
`FLOW_CAROUSEL`, `FLOW_ANGLE`, `FLOW_STRUCTURE`, `FLOW_CTA`, `FLOW_HOOKS`, `FLOW_TEXT`

### Text content flows (`text-content-flow-types.ts`, migration 081)

| Flow | Platform | Idea format | Status |
|------|----------|-------------|--------|
| `FLOW_LINKEDIN_TEXT_POST` | LinkedIn | `linkedin_text` | Newer production |
| `FLOW_LINKEDIN_DOCUMENT_POST` | LinkedIn | `linkedin_document` | Production (earlier path) |
| `FLOW_REDDIT_POST` | Reddit | `reddit_post` | Newer production |
| `FLOW_INSTAGRAM_THREAD` | Instagram | `instagram_thread` | Newer production |

Domain helpers also live in `linkedin-text-post.ts`, `reddit-post.ts`, `instagram-thread.ts`. Format routing: `decision_engine/format-routing.ts` (+ `format-routing.text-flows.test.ts`).

### Video flows
| Flow | Status | Generate | Render | Review |
|------|--------|----------|--------|--------|
| `FLOW_VID_SCRIPT` | Production | OpenAI script | HeyGen | Video edits panel |
| `FLOW_VID_PROMPT` | Production | OpenAI prompt | HeyGen Video Agent | HeyGenReviewEdits |
| `FLOW_VID_PROMPT_NO_AVATAR` | Production | OpenAI | HeyGen no-avatar | HeyGenReviewEdits |
| `FLOW_VID_HOOK_FIRST` | Production | Hook-first pack | HeyGen / resume-safe render | Video review |
| `FLOW_VID_UGC` | Newer (migration 082) | Peer-voice `spoken_script` | HeyGen script-led UGC host pool | Video review |
| `FLOW_VID_SCENES` / `FLOW_SCENE_ASSEMBLY` | Provider-dependent | Scene scripts | Sora clips + ffmpeg concat | Video review |
| `FLOW_PRODUCT_*` (6 types) | Production | Product prompts | HeyGen | Video review |

UGC domain: `src/domain/ugc-video.ts`. Hosts come from brand/product bible presenter pools.

### Carousel flows
| Flow | Status | Notes |
|------|--------|-------|
| `FLOW_CAROUSEL` | Production | `carousel_package`, HBS templates, `CarouselBrandStylingPanel` |
| `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` | Production (gated render) | `mimic_v1`, reference frames, compare UI in Review |
| `FLOW_VISUAL_FIRST_CAROUSEL` | Production (evolving) | **`execution_mode: "new_visual"`** — no TP references, BVS-driven |
| `FLOW_WHY_MIMIC_CAROUSEL` | Production (newer) | SIL-driven, `execution_mode: "why_mimic"` |
| `FLOW_TOP_PERFORMER_MIMIC_IMAGE` | Gated | `image_full` mode, single frame |
| `FLOW_TOP_PERFORMER_MIMIC_VIDEO` | Alias | Routes to HeyGen video planning |

### Product image flows (`FLOW_IMG_*`)
Registered in flow engine; **blocked at LLM** with `PRODUCT_IMAGE_FLOW_NOT_READY_MESSAGE`.

### Offline / excluded (`offline-flow-types.ts`)
`Reel_Script`, `FLOW_REEL_SCRIPT`, hook variation flows — excluded from planning.

### Per-flow requirements

| Flow family | Env / config |
|-------------|--------------|
| Mimic carousel | `MIMIC_IMAGE_ENABLED=1`, provider API key, archived reference media (except new_visual) |
| New visual | BVS recommended; `analysis_t2i` input mode |
| HeyGen / UGC | `HEYGEN_API_KEY`, project `heygen_config`, UGC host pool in bibles |
| Scene assembly | `OPENAI_API_KEY`, `SCENE_ASSEMBLY_CLIP_PROVIDER`, `VIDEO_ASSEMBLY_BASE_URL` |
| Standard carousel | `RENDERER_BASE_URL`, templates |
| Text lanes | Prompts/schemas per flow; publish path per platform maturity |

---
