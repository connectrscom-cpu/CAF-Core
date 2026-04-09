# CAF Core HTTP API

Base URL: `http://localhost:3847` (or your deploy).  
Auth: if enabled, send `x-caf-core-token: <CAF_CORE_API_TOKEN>` or `Authorization: Bearer <token>` on every route except `GET /health`.

---

## `GET /health`

```json
{ "ok": true, "service": "caf-core", "engine_version": "v1" }
```

---

## `POST /v1/decisions/plan`

Computes suppression, scores, ranking, prompt/route selection; persists `decision_traces` unless `dry_run: true`.

**Body**

```json
{
  "project_slug": "SNS",
  "run_id": "SNS_2026W09",
  "dry_run": false,
  "min_score": 0.4,
  "max_candidates": 20,
  "max_variations_per_candidate": 2,
  "prompt_override": {
    "template_only": false,
    "prompt_id": "carousel_v2",
    "prompt_version_id": "optional-uuid"
  },
  "candidates": [
    {
      "candidate_id": "SNS_2026W09_Instagram_0001",
      "flow_type": "FLOW_CAROUSEL",
      "platform": "Instagram",
      "target_platform": "Instagram",
      "confidence_score": 0.72,
      "platform_fit": 0.8,
      "novelty_score": 0.55,
      "past_performance_similarity": 0.6,
      "recommended_route": "HUMAN_REVIEW",
      "content_idea": "Hook about weekly reset",
      "dedupe_key": "optional-stable-key"
    }
  ]
}
```

**Response** (`200`): `{ "ok": true, "result": { "trace_id", "selected", "dropped_candidates", "suppression_reasons", "meta", ... } }`

---

## `POST /v1/jobs/ingest`

```json
{
  "project_slug": "SNS",
  "task_id": "SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1",
  "run_id": "SNS_2026W09",
  "candidate_id": "SNS_2026W09_Instagram_0001",
  "variation_name": "v1",
  "flow_type": "FLOW_CAROUSEL",
  "platform": "Instagram",
  "status": "PLANNED",
  "recommended_route": "HUMAN_REVIEW",
  "pre_gen_score": 0.61,
  "generation_payload": { "caption": "..." }
}
```

---

## `GET /v1/jobs/:project_slug/:task_id`

Returns `{ "ok": true, "job": { ...row } }` or `404`.

---

## `PUT /v1/projects/:project_slug/constraints`

```json
{
  "max_daily_jobs": 80,
  "min_score_to_generate": 0.35,
  "max_active_prompt_versions": 3,
  "default_variation_cap": 2,
  "auto_validation_pass_threshold": 0.72
}
```

`null` allowed for numeric caps you want unset (e.g. unlimited daily jobs).

---

## `POST /v1/prompt-versions`

```json
{
  "project_slug": "SNS",
  "flow_type": "FLOW_CAROUSEL",
  "prompt_id": "carousel_v2",
  "version": "2.1.0",
  "status": "active",
  "temperature": 0.7,
  "max_tokens": 2000
}
```

---

## `POST /v1/suppression/rules`

```json
{
  "project_slug": "SNS",
  "name": "High rejection carousel",
  "rule_type": "REJECTION_RATE",
  "scope_flow_type": "FLOW_CAROUSEL",
  "threshold_numeric": 0.55,
  "window_days": 14,
  "action": "BLOCK_FLOW"
}
```

`rule_type`: `REJECTION_RATE` | `QC_FAIL_RATE` | `ENGAGEMENT_FLOOR` | `BLOCK_FLOW` | `BLOCK_PROMPT_VERSION`  
`action`: `BLOCK_FLOW` | `REDUCE_VOLUME` | `FORCE_HUMAN_REVIEW` | `BLOCK_PROMPT_VERSION`

---

## `POST /v1/learning/rules`

```json
{
  "project_slug": "SNS",
  "rule_id": "rule_reject_soft_hooks_01",
  "trigger_type": "REJECT_RATE",
  "scope_flow_type": "FLOW_CAROUSEL",
  "action_type": "BOOST_RANK",
  "action_payload": { "multiplier": 1.02 },
  "confidence": 0.8,
  "source_entity_ids": ["task_123"]
}
```

Apply (sets `applied_at`, `status = active`):  
`POST /v1/learning/rules/:project_slug/:rule_id/apply`

List: `GET /v1/learning/rules/:project_slug`

---

## `POST /v1/transitions`

```json
{
  "project_slug": "SNS",
  "task_id": "SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1",
  "from_state": "GENERATED",
  "to_state": "IN_REVIEW",
  "triggered_by": "system",
  "metadata": {}
}
```

`triggered_by`: `system` | `human` | `rule` | `experiment`

---

## `POST /v1/audits`

```json
{
  "project_slug": "SNS",
  "task_id": "SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1",
  "audit_type": "diagnostic",
  "failure_types": ["generic_hook"],
  "audit_score": 0.42,
  "metadata": {}
}
```

---

## `POST /v1/reviews`

```json
{
  "project_slug": "SNS",
  "task_id": "SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1",
  "decision": "REJECTED",
  "rejection_tags": ["off_brand"],
  "validator": "you@example.com",
  "submit": true
}
```

---

## `POST /v1/metrics`

Use **`metric_window`: `stabilized`** for learning-driving metrics.

```json
{
  "project_slug": "SNS",
  "task_id": "SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1",
  "platform": "Instagram",
  "metric_window": "stabilized",
  "window_label": "72h",
  "engagement_rate": 0.041,
  "likes": 1200,
  "saves": 90
}
```

---

## `POST /v1/auto-validation`

```json
{
  "project_slug": "SNS",
  "task_id": "SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1",
  "hook": "Sunday reset ritual",
  "caption": "Long caption …",
  "banned_substrings": ["guaranteed", "cure"]
}
```

Returns heuristic scores and inserts `auto_validation_results`.

---

*Handlers: [`src/routes/v1.ts`](../src/routes/v1.ts).*
