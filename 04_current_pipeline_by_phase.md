# CAF — Current Pipeline by Phase

## Purpose of this document

This is the practical phase-by-phase map of the current CAF pipeline.

It is intentionally concise, but explicit enough that someone new to the system can understand:
- what happens in each phase
- what comes in
- what goes out
- where the outputs live
- what still feels incomplete

---

## 1. INPUT / RESEARCH

### Purpose
Collect external content signals from the market.

### Current sources
- Reddit
- Instagram
- TikTok
- Facebook
- HTML websites / blogs

### Current mechanism
- source lists are configured in project Sheets
- n8n runs scrapers / retrieval flows
- Apify is used for some source collection paths
- outputs are normalized into sheet tables

### Current outputs
Examples include:
- Instagram post data
- TikTok video rows
- Reddit raw post data
- Facebook post/page data
- scraped HTML content
- findings summaries by sign / theme

### Where outputs live
Primarily in **INPUTS - Sources for SNS** or equivalent project-level source workbooks.

### Current reality
This layer is functioning. It is not the main problem.

---

## 2. PROCESSING

### Purpose
Turn raw source data into directional intelligence.

### Current mechanism
n8n reads source tables, computes scores, ranks evidence, and prompts models to generate structured analysis.

### Current outputs
By platform, CAF currently produces artifacts such as:
- summaries
- archetypes
- top examples
- 7-day plan ideas
- extracted hooks / CTA patterns
- content gaps
- candidate pools

### Most important output
The most important output is the cross-platform **Overall candidate pool**, because this is what creation uses downstream.

### Where outputs live
Primarily in **PROCESSING - SNS Insights** or equivalent project processing workbooks.

### Current reality
Processing is already structured enough to be useful. It is one of the stronger parts of the system.

---

## 3. CREATION

### Purpose
Turn processed ideas into executable content work.

### Current mechanism
Creation reads the latest run-level intelligence and expands it into runtime rows.

### Current sub-steps
1. Read latest Signal Pack
2. Parse `overall_candidates_json`
3. Infer or assign:
   - `flow_type`
   - execution platform
   - routing
4. create `candidate_id`
5. create `task_id`
6. write `Content_Candidates`
7. prepare `Content_Jobs`

### Main runtime entities created here
- **Signal_Packs**
- **Content_Candidates**
- **Content_Jobs**
- **Job_Drafts** (when revision paths are used)

### Current content families
- carousel flows
- classic video flows
- prompt-based video flows
- scene-bundle video flows
- lighter text-oriented paths in some flows

### Where outputs live
Primarily in **CREATION - Runtime**.

### Current reality
This phase works operationally, but it is where a lot of complexity begins to accumulate.

---

## 4. VALIDATION

### Purpose
Decide whether generated content is acceptable, needs edits, or should be rejected.

### Current mechanism
Validation combines:
- machine QC / risk checks
- human review routing
- review queue management
- override capture
- validation event tracking

### Current outputs
- review-ready rows
- approval / rejection decisions
- override fields
- rejection tags
- validation event history

### Main current tables
- validation-facing candidate snapshot
- **Review Queue**
- **Rejection Tags**
- **Validation_Events**
- aggregate validation memory in some current structures

### Where outputs live
Primarily in the **VALIDATION** workbook and the review app interface.

### Current reality
Validation exists and works, but the knowledge captured here is not yet being fully recycled back into generation.

---

## 5. RENDERING

### Purpose
Turn generated content payloads into real assets.

### Current mechanism
n8n dispatches jobs to render providers and services.

### Current render paths
- **Carousel rendering**
  - render pack creation
  - template resolution
  - Fly renderer call
  - slide-level outputs

- **HeyGen video rendering**
  - script or prompt payload assembly
  - render request and polling
  - output URL persistence

- **Scene render / stitching**
  - scene bundle normalization
  - scene-level generation
  - stitch service
  - optional post-process path

- **Post-process**
  - voiceover generation
  - SRT generation
  - mux / burn / subtitle workflows

### Output examples
- PNG slide images
- MP4 videos
- merged stitched videos
- voiceover audio
- subtitle files
- edited / muxed final outputs

### Where outputs live
- operational state in **Content_Jobs**
- hosted artifacts in **Supabase storage**
- transformation services on **Fly**

### Current reality
Rendering is technically advanced relative to the rest of the system. The media pipeline is not the main strategic bottleneck.

---

## 6. PUBLISHING

### Purpose
Move approved content into live channels and record outcome data.

### Current mechanism
Partially implemented. Current material suggests publishing is modeled more as a results ledger than a mature orchestration subsystem.

### Current outputs
- post-publication metric rows
- candidate / platform / date outcome data

### Where outputs live
Primarily in **PUBLISHING > Publishing_Results**

### Current reality
The idea exists. The layer is thinner than creation, validation, or rendering.

---

## 7. LEARNING

### Purpose
Improve future output quality using feedback.

### Intended inputs
- validation outcomes
- rejection tags
- overrides
- publishing metrics
- aggregated performance patterns

### Current outputs
Very limited in the current snapshot:
- light aggregate memory
- stub-like config change proposal area

### Where outputs live
Partly in **LEARNING**, partly in validation aggregates, but not yet in a strong structured system.

### Current reality
This phase is mostly conceptual compared with the rest.
This is the main gap between CAF-as-automation and CAF-as-learning-platform.

---

## 8. Cross-phase movement summary

In plain terms, the current pipeline is:

1. gather source material
2. synthesize what matters
3. convert ideas into executable jobs
4. generate and render assets
5. route through human validation
6. record publishing outcomes
7. weakly attempt to learn from the above

---

## 9. Current bottleneck by phase

### INPUT
Not the bottleneck.

### PROCESSING
Good enough to support creation, though selection intelligence can be improved.

### CREATION
Works, but contains growing complexity and too much embedded logic.

### VALIDATION
Useful, but under-harvested as a feedback source.

### PUBLISHING
Thinner than it should be.

### LEARNING
The major missing layer.

---

## 10. Practical conclusion

The current CAF pipeline already proves that:
- research ingestion works
- synthesis works
- generation works
- rendering works
- validation routing works

The real gap is:
- judgment
- reuse of corrections
- reuse of outcomes
- learning-led improvement across future runs
