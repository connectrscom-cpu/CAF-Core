# Architecture layers

Each file describes **one vertical slice** of CAF Core: responsibility, main modules, and how it connects to neighbors.

| # | Layer | File |
|---|--------|------|
| 1 | HTTP API | [http-api.md](./http-api.md) |
| 2 | Run orchestration | [orchestration.md](./orchestration.md) |
| 3 | Decision engine (planning) | [decision-engine.md](./decision-engine.md) |
| 4 | Job pipeline (execution) | [job-pipeline.md](./job-pipeline.md) |
| 5 | LLM generation | [generation.md](./generation.md) |
| 6 | Rendering (carousel & video) | [rendering.md](./rendering.md) |
| 7 | Review & rework | [review-rework.md](./review-rework.md) |
| 8 | Publishing | [publishing.md](./publishing.md) |
| 9 | Learning | [learning.md](./learning.md) |
| 10 | Persistence (repositories) | [persistence.md](./persistence.md) |

Cross-cutting topics:

- [../LIFECYCLE.md](../LIFECYCLE.md) — run & job state machines
- [../TECH_STACK.md](../TECH_STACK.md) — technologies
- [../QUALITY_CHECKS.md](../QUALITY_CHECKS.md) — QC checklists
- [../GENERATION_GUIDANCE.md](../GENERATION_GUIDANCE.md) — prompt guidance
- [../RISK_RULES.md](../RISK_RULES.md) — risk policies vs project risk rows
