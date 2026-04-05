# CAF — External Integrations

## Purpose of this document

CAF is not self-contained.
It depends on a set of external integrations that provide:
- source retrieval
- generation
- rendering
- storage
- publishing
- human operations

This document lists the important integrations, what they do now, and whether they should stay in n8n for now or move later into CAF Core services.

---

## 1. Google Sheets

### Purpose
Current control plane and visible operating layer.

### Current role
Sheets currently hold:
- source definitions
- processing outputs
- project configuration
- runtime queues
- review queue
- publishing metrics
- learning placeholders

### Why it matters
Sheets are currently where a lot of real state lives, especially state visible to operators.

### Keep in n8n or move later?
- **Keep during migration**
- gradually reduce as source of truth for core domain state
- preserve operator-facing utility while moving durable logic inward

---

## 2. Supabase

### Purpose
Durable storage for structured records and hosted assets.

### Current role
Used for:
- tasks/assets access patterns
- media storage
- public or stable URLs for previews and downstream processing
- app-facing durable storage

### Why it matters
Without Supabase, assets and app integration become much weaker.

### Keep in n8n or move later?
- **Keep**
- likely becomes even more central in CAF Core
- good candidate for stronger DB-first ownership

---

## 3. Fly.io

### Purpose
Hosts stable machine services reachable by n8n.

### Current role
Used for:
- carousel rendering service
- possible stitch / mux services
- other containerized media-processing endpoints

### Why it matters
n8n needs stable public endpoints for heavy transformation workloads.

### Keep in n8n or move later?
- **Keep**
- ownership of orchestration may stay in n8n for now
- service contracts should become better formalized via CAF Core over time

---

## 4. Apify

### Purpose
Source retrieval / scraping infrastructure.

### Current role
Used for:
- Instagram scraping
- potentially other source retrieval flows depending on actor setup

### Why it matters
Provides practical scraping capability without rebuilding acquisition infrastructure from scratch.

### Keep in n8n or move later?
- **Keep in n8n for now**
- input layer is not the first rebuild target
- can remain an external acquisition dependency while CAF Core matures elsewhere

---

## 5. OpenAI

### Purpose
Model provider for synthesis, generation, and some post-process tasks.

### Current role
Used for:
- processing summaries / archetypes / examples
- content generation paths
- possible audits later
- TTS in the current post-process voiceover path

### Why it matters
OpenAI is one of the main intelligence providers in the system.

### Keep in n8n or move later?
- mixed:
  - keep current flow-driven usage during migration
  - move higher-value structured logic (audits, learning extraction, reusable generation contracts) into CAF Core services where appropriate

---

## 6. HeyGen

### Purpose
Video generation provider.

### Current role
Used for:
- video render flows
- avatar/script modes
- prompt-based video generation paths
- project-level config-driven render settings

### Why it matters
It is currently one of the core render providers for video output.

### Keep in n8n or move later?
- **Keep during migration**
- provider contracts should be formalized
- orchestration can remain in n8n initially
- future provider abstraction should live in CAF Core, not ad hoc in flows

---

## 7. Social publishing APIs

### Purpose
Push approved content to live platforms and/or record results.

### Current role
Only partially visible in current material.
Publishing exists conceptually and outcome metrics are recorded, but this layer is thinner than others.

### Why it matters
Without publishing and metrics ingestion, market learning remains weak.

### Keep in n8n or move later?
- keep any working publishing connectors
- design future publishing and performance ingestion more explicitly in CAF Core

---

## 8. Review App

### Purpose
Human review interface.

### Current role
- reads eligibility from Sheets
- loads task/assets for preview
- allows approve/reject/edit
- writes decisions back into the review queue

### Why it matters
It is the main human-in-the-loop surface.

### Keep in n8n or move later?
- app stays as a separate interface
- state ownership and intelligence behind it should move more into CAF Core over time

---

## 9. Renderer service

### Purpose
Render carousel templates into slide images.

### Current role
Receives render packs and template payloads from n8n, returns files or render artifacts.

### Why it matters
It turns structured content into actual visual assets.

### Keep in n8n or move later?
- keep the service
- keep n8n orchestration initially
- formalize render contracts in CAF Core

---

## 10. Stitch / Mux / Media assembly services

### Purpose
Assemble scene-level outputs into final videos.

### Current role
- stitch rendered scenes
- merge or mux audio/subtitles/video
- support post-process workflows

### Why it matters
These services allow the scene-based video path to produce finished outputs.

### Keep in n8n or move later?
- keep current services
- migrate state and contracts around them first, not the services themselves

---

## 11. Bannerbear / template-related tooling

### Purpose
Template metadata and visual-generation support in some flow paths.

### Current role
Present in parts of the creation/render chain.

### Why it matters
Supports template-aware output generation and/or asset preparation.

### Keep in n8n or move later?
- low priority for migration
- preserve if working
- do not rebuild just for aesthetic cleanup

---

## 12. Recommended integration strategy

### Preserve now
Keep these working integrations in place during early migration:
- Google Sheets
- Supabase
- Fly services
- Apify
- OpenAI
- HeyGen
- existing render/media services

### Move later
Gradually move into CAF Core:
- domain ownership
- job ingestion APIs
- audits and learning extraction
- structured review memory
- prompt / experiment registry
- decision-support intelligence

### Do not do first
Do not start by rebuilding:
- scrapers
- all render services
- all provider adapters
- every app/UI surface

That is not where the main leverage is.

---

## 13. Practical conclusion

CAF already has enough integrations to operate.
The rebuild should not be about replacing integrations for the sake of neatness.

It should be about:
- clarifying contracts
- centralizing state and learning
- reducing hidden coupling
- preserving what already works
