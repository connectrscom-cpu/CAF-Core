# CAF — Current Architecture

## Purpose of this document

This document explains how CAF currently works in operational terms:
- who owns what
- where data lives
- what each subsystem does
- how state moves
- where the system is strong
- where it is fragile

This is not a target-state document. It is a map of the system that exists today.

---

## 1. Current state ownership

CAF is currently split across five major layers:

### n8n
Owns workflow orchestration:
- reading sources and configs
- transforming rows
- calling LLMs
- calling render services
- polling async jobs
- writing state back into Sheets / Supabase

### Google Sheets
Owns most visible operational state:
- project rules
- source definitions
- processing outputs
- runtime queues
- review queue
- publishing results
- lightweight learning placeholders

Sheets currently behave as an explicit **workflow state layer**, not just storage.

### Supabase
Owns durable software-native storage:
- task rows
- asset rows
- hosted binaries in storage
- stable URLs for previews and downstream access

### Fly.io
Owns reachable machine services:
- carousel rendering service
- stitching / muxing services
- any containerized runtime that n8n must call over HTTP

### Review App
Owns the human interaction surface:
- queue visibility
- previews
- approve / reject / edit actions

It does **not** own final workflow truth. It reads from the current state and writes decisions back into Sheets.

---

## 2. Where data lives

CAF’s data is not centralized.

### In Google Sheets
The Google Sheets layer is split between CAF-level and project-level workbooks.

#### CAF-level workbooks
These are shared infrastructure:
- **Flow Engine**
- **Logging Template**

They contain:
- flow definitions
- prompt templates
- output schemas
- carousel template metadata
- QC checklists
- risk policies
- experiment logs

#### Project-level workbooks
These carry project state, currently exemplified by SNS:
- **INPUTS**
- **PROCESSING**
- **CREATION - Project Config Sheet**
- **CREATION - Runtime**
- **VALIDATION**
- **PUBLISHING**
- **LEARNING**

These are not passive databases. They are the current operating surface of the project.

### In Supabase
Supabase currently acts as:
- durable data layer for tasks and assets
- hosted storage for generated PNGs, MP4s, audio, subtitles, merged edits, and related files
- source for preview URLs used by apps and downstream systems

### In Fly-hosted services
Rendered media is produced by services that expose stable endpoints. These services are not the control plane. They are transformation workers.

### In the review app
Only interface logic and temporary assembled views. It is not the canonical home of state.

---

## 3. What n8n currently does

n8n is the orchestration backbone.

### Input layer
n8n currently:
- reads source lists from Sheets
- runs Apify actors and other external retrieval processes
- normalizes source records into analysis-friendly rows
- appends those rows back into project source sheets

### Processing layer
n8n currently:
- reads normalized platform data
- computes simple scores / rankings
- packages evidence sets
- prompts models to generate summaries, archetypes, top examples, and short planning artifacts
- writes structured outputs into processing workbooks

### Creation layer
n8n currently:
- reads the latest Signal Pack
- parses `overall_candidates_json`
- expands candidates into routing rows
- assigns flow types and execution platforms
- creates `candidate_id` and `task_id` values
- creates `Content_Candidates`
- prepares `Content_Jobs`
- normalizes payloads for carousel, classic video, prompt video, and scene-bundle video paths

### Render layer
n8n currently:
- reads executable jobs from `Content_Jobs`
- dispatches by flow type and render provider
- prepares render packs for carousels
- calls Fly renderer for slide rendering
- calls HeyGen for avatar / video generation
- handles scene render, stitching, and post-process workflows
- generates voiceover and subtitle layers
- writes render outputs, status, and URLs back into Sheets and Supabase-linked storage paths

### Validation layer
n8n currently:
- routes jobs to human review when `recommended_route` requires it
- writes rows into `VALIDATION > Review Queue`
- syncs review decisions and carry-forward values

### Publishing / learning
These are less mature:
- publishing is currently represented more as a results recording layer than a deeply automated control system
- learning exists conceptually, but only thinly in the current implementation

---

## 4. What Google Sheets currently do

Google Sheets are the current control plane.

### Flow Engine
Stores reusable logic packages:
- supported flow definitions
- prompt templates
- output schemas
- carousel template metadata
- QC checklists
- risk policies

### INPUTS
Stores:
- configured source lists
- raw IG / TikTok / Reddit / Facebook / HTML data
- lightweight extracted findings

### PROCESSING
Stores:
- summaries
- archetypes
- top examples
- 7-day plans
- cross-platform “Overall” candidate pool

### CREATION - Project Config
Stores project rulebooks:
- strategy defaults
- brand constraints
- platform constraints
- risk rules
- allowed flow types
- prompt version pointers
- reference posts
- viral format library
- HeyGen config

### CREATION - Runtime
Stores runtime execution state:
- Signal Packs
- Content Candidates
- Run Logs
- Content Jobs
- Job Drafts

This workbook is the operational center of the project.

### VALIDATION
Stores human control state:
- validation-facing candidate rows
- Review Queue
- Rejection Tags
- Validation Events
- aggregate validation memory in some versions

### PUBLISHING
Stores outcome metrics after posting.

### LEARNING
Currently stores very little. It is more a placeholder for change proposals than a mature learning subsystem.

---

## 5. What Supabase currently does

Supabase is the durable storage layer.

It is used for:
- storing or exposing task and asset records
- hosting generated files in storage
- producing stable public or signed URLs
- supporting preview experiences in the review app
- acting as a more software-native home than Sheets for media-heavy state

Typical storage paths encode provenance using `run_id` and `task_id`, which is good and should be preserved.

Examples of storage responsibilities include:
- rendered slide images
- final video files
- merged scene outputs
- voiceover audio
- subtitle files
- edited video intermediates

Supabase should be treated as the durable backbone for assets even though Sheets still own much of the operational truth.

---

## 6. What Fly.io currently does

Fly hosts the media services that must be reachable from n8n by stable URL.

### Current responsibilities
- carousel rendering service
- possibly stitching service
- possibly mux / assembly service depending on deployment snapshot

### Why it exists
These workloads need:
- stable public endpoints
- headless browser / runtime support
- containerized execution
- enough compute to run rendering reliably

### Operational role
Fly does not decide what to render.
It receives machine-prepared payloads and transforms them into artifacts.

---

## 7. How the review app fits

The review app is the human approval layer.

### It reads
- queue eligibility from **Review Queue** in Sheets
- task / asset content from Supabase
- possibly override-ready content carried forward from current rows

### It allows humans to
- approve
- reject
- mark needs edit
- provide override text / structured changes

### It writes back
- decision
- review status
- override fields
- notes
- submit flags
- timestamps
- validator identity

### What it does not own
It does not replace the state model. It is an interface on top of it.

---

## 8. End-to-end current flow

The current architecture, in its simplified operational shape, is:

1. **INPUT** gathers source material into project Sheets
2. **PROCESSING** turns raw source rows into structured learnings and candidates
3. **CREATION** turns candidates into executable jobs
4. **RENDERING** turns jobs into media artifacts via external render providers / services
5. **VALIDATION** routes jobs into human review when needed
6. **PUBLISHING** records outcome metrics
7. **LEARNING** is supposed to feed future improvement, but is weak today

---

## 9. Known architectural strengths

The current architecture is not sloppy everywhere. Some parts are strong.

### Strong points
- explicit phase separation
- strong use of IDs across phases
- good distinction between shared CAF-level logic and project-level runtime
- `Content_Jobs` as a concrete executable unit
- support for multiple render paths
- review separated from generation
- ability to preserve rework memory through drafts and events
- deliberate split between Sheets-as-control-plane and Supabase-as-durable-storage

---

## 10. Known architectural pain points

### Too much logic trapped in n8n
Code nodes contain real business logic that is hard to test, version, or reason about outside the flow graph.

### Sheets are overloaded
They are doing too much:
- queueing
- state management
- review ownership
- project config
- operational memory

### `Content_Jobs` has become too wide
It works, but it is carrying many concerns in one row:
- execution state
- payload data
- render state
- review state
- scene assembly state

That is useful in prototyping and risky at scale.

### Learning is underbuilt
The architecture can produce and route. It does not yet learn in a structured way.

### Publishing is thin
The publishing layer records outcomes but does not yet look like a mature workflow subsystem.

### State is split on purpose, but still hard to reason about
The split between Sheets, Supabase, n8n, and the review app is deliberate. The problem is not the split itself. The problem is that the contracts are not formalized enough yet.

---

## 11. What this means for the rebuild

The rebuild should not attempt to replace every piece immediately.

It should:
- preserve working orchestration
- preserve current IDs and flow contracts
- preserve external services that already work
- pull domain logic and learning logic into CAF Core
- move toward database-first ownership gradually
- reduce the amount of truth trapped only in spreadsheets and code nodes

That is the actual architectural job.
