# CAF — Domain Model

## Purpose of this document

CAF already contains real operating entities, even if some of them are hidden inside sheet rows or n8n payloads.

This document defines the core entities Claude should reason with.
If future code invents abstractions that do not map back to these entities, it is probably drifting away from the real system.

---

## 1. Project

### What it is
A named content system operating under CAF, such as SNS or Cuisina.

### Why it exists
CAF is not meant to support one content brand only. A Project provides the container for:
- strategy
- brand rules
- platform rules
- active flows
- learning memory

### Key fields
- `project`
- `active`
- `project_type`
- `core_offer`
- `target_audience`
- `primary_business_goal`
- `primary_content_goal`
- `north_star_metric`
- `brand_constraints`
- `platform_constraints`

### Relationships
- one Project has many Runs
- one Project has many PromptVersions
- one Project has many ContentJobs
- one Project has many LearningRules and Experiments

---

## 2. Run

### What it is
A single research/creation cycle or operating batch.

### Why it exists
A Run groups all work produced from a given evidence window into one traceable execution cycle.

### What it contains in practice
A Run is the bridge between processing outputs and creation/runtime execution.
In the current sheets design, Signal Packs are the run-level bundle.

### Key fields
- `run_id`
- `project`
- `created_at`
- `source_window`
- `ig_summary_json`
- `tiktok_summary_json`
- `reddit_summary_json`
- `fb_summary_json`
- `html_summary_json`
- `overall_candidates_json`
- `global_rising_keywords`
- `global_winning_formats`
- `global_engagement_triggers`
- `confidence_score_avg`

### Relationships
- belongs to one Project
- produces many Candidates
- produces one or more Signal Packs
- produces many ContentJobs
- may be associated with one or more Experiments

---

## 3. SignalPack

### What it is
A run-level intelligence package created from processing outputs.

### Why it exists
It formalizes the handoff from research synthesis into creation.
Without a SignalPack, creation logic would need to read raw processing artifacts directly.

### Key fields
- `run_id`
- `project`
- per-platform summary payloads
- `overall_candidates_json`
- global themes and triggers
- total candidate counts
- aggregate confidence information

### Relationships
- belongs to one Run
- is the parent input for many Candidates / ContentJobs

---

## 4. Candidate

### What it is
A structured content idea derived from processing.

### Why it exists
CAF should separate:
- “this is an idea worth considering”
from
- “this is a job the machine will execute now”

Candidate is the staging object between those two.

### Key fields
- `candidate_id`
- `project`
- `run_id`
- `signal_pack_run_id`
- `platform`
- `origin_platform`
- `target_platform`
- `flow_type`
- `content_idea`
- `idea_description`
- `hook_template`
- `cta_template`
- `confidence_score`
- `priority`
- `candidate_json`
- `recommended_route`

### Relationships
- belongs to one Run / SignalPack
- becomes one or more ContentJobs
- may later be associated with publishing outcomes and learning signals via linked jobs

---

## 5. ContentJob

### What it is
The atomic executable unit of CAF.

### Why it exists
This is the row/object the system actually acts on.
A ContentJob can be:
- generated
- normalized
- rendered
- reviewed
- revised
- published
- measured

### Why it is the most important entity
If CAF Core gets this entity wrong, the whole migration fails.

### Typical current fields
Identity:
- `task_id`
- `project`
- `run_id`
- `candidate_id`
- `variation_name`
- `flow_type`
- `platform`
- `origin_platform`
- `target_platform`

Routing / execution:
- `status`
- `recommended_route`
- `qc_status`
- `render_provider`
- `render_status`
- `render_job_id`

Asset linkage:
- `asset_id`
- `asset_type`
- `asset_version`
- `video_url`

Payload / content:
- `caption`
- `slides_json`
- `hashtags_json`
- `video`
- `hook`
- `spoken_script`
- `beats_json`
- `dialogue_json`
- `on_screen_text_json`

Scene-bundle / assembly:
- `scene_bundle_json`
- `scenes_json`
- `expected_scene_count`
- `ok_scene_count`
- `failed_scene_count`
- `all_scenes_ready`
- `parent_render_status`
- `aggregation_status`

### Relationships
- belongs to one Candidate
- produces one or more Assets
- may spawn JobDrafts
- may have one or more DiagnosticAudits
- may have one or more EditorialReviews / ValidationEvents
- may have one or more PerformanceMetrics
- may belong to an Experiment

---

## 6. JobDraft

### What it is
A draft or revision attempt associated with a ContentJob.

### Why it exists
CAF should not flatten rework history into the latest row only.
JobDraft preserves revision memory.

### Key fields
- `draft_id`
- `task_id`
- `candidate_id`
- `run_id`
- `attempt_no`
- `revision_round`
- `prompt_name`
- `prompt_version`
- `generated_title`
- `generated_hook`
- `generated_caption`
- `generated_render_json`

### Relationships
- belongs to one ContentJob
- may be created because of one EditorialReview or rejection event

---

## 7. Asset

### What it is
A generated artifact produced by a ContentJob.

### Why it exists
Execution state and media artifact are not the same thing.
Asset makes outputs explicit.

### Common asset forms
- rendered carousel slide images
- final carousels
- HeyGen videos
- scene-rendered clips
- stitched videos
- voiceover audio
- subtitles / SRT
- edited / muxed outputs

### Key fields
- `asset_id`
- `task_id`
- `asset_type`
- `asset_version`
- `storage_key`
- `public_url`
- `provider`
- `created_at`

### Relationships
- belongs to one ContentJob
- may be one of several assets for one job

---

## 8. DiagnosticAudit

### What it is
A machine-generated or analyst-generated evaluation of output quality.

### Why it exists
CAF currently knows how to create content but does not yet strongly know how to explain failure.
DiagnosticAudit is the entity that captures failure modes explicitly.

### Examples of what it should capture
- weak hook
- low novelty
- poor emotional specificity
- off-brand tone
- poor platform fit
- structural bloat
- weak CTA
- generic wording

### Key fields
- `audit_id`
- `task_id`
- `audit_type`
- `failure_types`
- `strengths`
- `risk_findings`
- `improvement_suggestions`
- `audit_score`
- `created_at`

### Relationships
- belongs to one ContentJob
- can generate LearningRules
- can inform PromptVersion changes

---

## 9. EditorialReview

### What it is
A human decision on whether generated content should be approved, rejected, or edited.

### Why it exists
Human review is one of the few places where real taste enters the system.
That signal must not be treated as disposable.

### Current practical fields
- `task_id`
- `candidate_id`
- `run_id`
- `review_status`
- `decision`
- `rejection_tags`
- `notes`
- `final_title_override`
- `final_hook_override`
- `final_caption_override`
- `final_slides_json_override`
- `validator`
- `submit`
- `submitted_at`

### Relationships
- belongs to one ContentJob
- may produce ValidationEvents
- may trigger JobDraft creation
- may produce LearningRules

---

## 10. ValidationEvent

### What it is
An audit trail event recording state change in the human validation lifecycle.

### Why it exists
Without event memory, the system only sees current state and loses process history.

### Key fields
- `event_id`
- `candidate_id`
- `task_id`
- `project`
- `from_status`
- `to_status`
- `changed_by`
- `changed_at`
- `rejection_reason_tag`
- `notes`

### Relationships
- belongs to one ContentJob
- often linked to one EditorialReview

---

## 11. PerformanceMetric

### What it is
Post-publication market outcome data.

### Why it exists
Market learning requires actual outcomes, not internal opinions only.

### Current example fields
- `candidate_id`
- `project`
- `platform`
- `posted_at`
- `metric_date`
- `likes`
- `comments`
- `shares`
- `saves`
- `watch_time`
- `engagement_rate`
- `notes`

### Relationships
- belongs to one ContentJob or Candidate lineage
- feeds LearningRules
- feeds Experiments
- helps evaluate PromptVersions / formats / routes

---

## 12. LearningRule

### What it is
A structured insight that changes future behavior.

### Why it exists
Learning is useless if it stays as commentary.
LearningRule is the mechanism that turns observations into reusable operating logic.

### Examples
- “Hooks using generic astrology phrasing underperform”
- “Relationship-psychology framing increases saves”
- “Specific rejection tag X should trigger alternative prompt path Y”
- “Video scripts above duration threshold Z fail validation more often”

### Key fields
- `rule_id`
- `project`
- `rule_type` (`diagnostic`, `editorial`, `market`)
- `condition`
- `action`
- `confidence`
- `status`
- `source_entity_ids`
- `created_at`

### Relationships
- can be produced from DiagnosticAudits
- can be produced from EditorialReviews
- can be produced from PerformanceMetrics
- can influence PromptVersions, ranking logic, QC, routing, or selection

---

## 13. PromptVersion

### What it is
A versioned generation configuration for a given flow.

### Why it exists
CAF cannot improve safely if prompts change as silent drift.
PromptVersion makes changes traceable and testable.

### Current practical fields
- `project`
- `flow_type`
- `prompt_id`
- `prompt_version`
- `system_prompt_version`
- `user_prompt_version`
- `output_schema_version`
- `temperature`
- `max_tokens`
- `active`
- `experiment_tag`
- `start_date`
- `end_date`

### Relationships
- belongs to one Project and flow family
- used by many ContentJobs
- evaluated by EditorialReview and PerformanceMetrics
- may be part of an Experiment

---

## 14. Experiment

### What it is
A controlled intervention in the system.

### Why it exists
Without an Experiment entity, the team will keep changing prompts, rules, and routes in a way that cannot be measured cleanly.

### Current basis in the system
The Logging Template already points toward this, even though the runtime system does not yet deeply enforce it.

### Key fields
- `experiment_id`
- `flow_name`
- `flow_version`
- `status`
- `baseline_window`
- `hypothesis`
- `intervention_description`
- `change_type`
- `exact_components_changed`
- `expected_outcome`
- `primary_metrics_tracked`
- `outcome`
- `decision`
- `key_learning`

### Relationships
- may reference Projects, Runs, PromptVersions, LearningRules, or PerformanceMetrics

---

## 15. ExternalIntegration

### What it is
A system dependency that CAF calls or depends on.

### Why it exists
Integrations are part of the actual operating model and should be explicit in CAF Core.

### Examples
- Apify
- OpenAI
- HeyGen
- Supabase
- Fly renderer / stitch / mux
- Google Sheets
- publishing APIs

### Relationships
- used by workflows and services
- may be associated with provider-specific Assets or job execution paths

---

## 16. Core relationship summary

In simplified form:

- a **Project** has many **Runs**
- a **Run** produces a **SignalPack**
- a **SignalPack** produces many **Candidates**
- a **Candidate** becomes one or more **ContentJobs**
- a **ContentJob** produces one or more **Assets**
- a **ContentJob** may go through many **EditorialReviews** and **ValidationEvents**
- a **ContentJob** may spawn **JobDrafts**
- a **ContentJob** may receive **DiagnosticAudits**
- a **ContentJob** or Candidate lineage later produces **PerformanceMetrics**
- those signals create **LearningRules**
- **LearningRules** influence future **PromptVersions**, routing, ranking, and generation
- **Experiments** measure whether those changes help

---

## 17. Modeling warning

Do not model CAF as “just prompts plus outputs.”

That would be shallow and wrong.

CAF is a system of:
- evidence
- staged ideas
- executable jobs
- assets
- review decisions
- performance
- learning

Those entities need to stay explicit.
