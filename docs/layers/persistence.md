# Layer: Persistence (repositories)

**Purpose:** Centralize **SQL** access patterns per aggregate so services stay testable and DRY.

## Layout

**`src/repositories/`** — one file (or small cluster) per concern:

| File / area | Responsibility |
|-------------|----------------|
| **`core.ts`** | Projects, constraints, **learning rules for planning**, prompt versions, counts. |
| **`jobs.ts`** | **`upsertContentJob`**, deletes, bulk run cleanup. |
| **`runs.ts`** | Run CRUD, status updates, replan reset. |
| **`signal-packs.ts`** | Signal pack load/save. |
| **`flow-engine.ts`** | Flow definitions, prompts, schemas, QC checks, **risk_policies** list. |
| **`learning.ts`**, **`learning-evidence.ts`** | Learning CRUD, attribution. |
| **`assets.ts`** | Asset rows per task. |
| **`publications.ts`** | Publication placements. |
| **`review-queue.ts`** | Queue listing for admin/review APIs. |
| **`transitions.ts`** | **`job_state_transitions`**. |
| **`project-config.ts`** | Strategy, brand, platform, allowed flows, HeyGen config, **risk_rules** rows. |
| **`ops.ts`** | Inserts for audits, reviews, metrics, etc. |

## Queries helper

- **`src/db/queries.ts`** — **`q`**, **`qOne`** wrappers.

## Typed payload subsets (`src/domain/`)

Sibling to repositories: modules that carve typed shapes out of the `generation_payload` / `render_state` JSONB columns. Services should prefer these over ad-hoc casts when reading or writing known slices:

| Slice | Module | Helpers |
|-------|--------|---------|
| `qc_result` | **`generation-payload-qc.ts`** | **`qcResultSchema`** (Zod), **`mergeGenerationPayloadQc`** (canonical writer), **`pickStoredQcResult`** |
| `generated_output` | **`generation-payload-output.ts`** | **`pickGeneratedOutput`**, **`pickGeneratedOutputOrEmpty`**, **`hasGeneratedOutput`** |
| `render_state` | **`content-job-render-state.ts`** | **`pickRenderState`**, **`hasActiveProviderSession`** (HeyGen idempotency), **`isMidProviderPhase`** |

Adoption is incremental. Existing call sites keep working; new or touched code should call these helpers rather than repeating `(x as Record<string, unknown>) ?? {}`.

## Inputs / outputs

- **Pool** from **`createPool`**, typed rows where possible; many return **`Record<string, unknown>[]`**.

## State owned

- **None** — repositories are side-effect **only** against Postgres.

## Boundaries

- **Clean:** services call repositories, not raw SQL scattered everywhere (exceptions exist in hot paths — acceptable when localized).
- **Risk:** duplicated business logic between repo and route — prefer **service** as single owner.

## See also

- [../ARCHITECTURE.md](../ARCHITECTURE.md)
- [http-api.md](./http-api.md)
