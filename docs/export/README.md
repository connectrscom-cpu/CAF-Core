# CAF documentation — shareable PDF bundles

**Purpose:** Topic-grouped PDFs for sharing with stakeholders, partners, or external LLM reviewers. **Original markdown in `docs/` is never modified** — these are aggregated copies.

**Folder layout**

| Path | Contents |
|------|----------|
| `docs/export/pdf/` | Shareable **PDF** files (send these) |
| `docs/export/bundles/` | Aggregated markdown (regenerated; gitignored) |
| `scripts/export-doc-pdfs.mjs` | Build script |

**Regenerate after doc changes:** `npm run export:doc-pdfs`

---

## PDF catalog

| PDF | Topic | Best for | Source files |
|-----|-------|----------|--------------|
| [01-caf-product.pdf](./pdf/01-caf-product.pdf) | Product | Leadership, investors, new stakeholders | Pitch, complete product guide, project overview |
| [02-caf-onboarding-and-context.pdf](./pdf/02-caf-onboarding-and-context.pdf) | Onboarding & context | ChatGPT bundles, new engineers, other repos | External context pack, rebuild guide, domain model, DB schema, AGENTS |
| [03-caf-architecture-and-layers.pdf](./pdf/03-caf-architecture-and-layers.pdf) | Architecture & layers | Engineers implementing features | Architecture, stack, lifecycle, all layer docs |
| [04-caf-engineering-complete-guide.pdf](./pdf/04-caf-engineering-complete-guide.pdf) | Engineering (merged) | Deep technical onboarding (single file) | CAF_CORE_COMPLETE_GUIDE |
| [05-caf-quality-risk-generation.pdf](./pdf/05-caf-quality-risk-generation.pdf) | QC, risk, generation | Ops, compliance, prompt owners | Quality checks, risk rules, generation guidance |
| [06-caf-api-and-integrations.pdf](./pdf/06-caf-api-and-integrations.pdf) | API & integrations | Integrators, video pipeline owners | API reference, video flows, HeyGen |
| [07-caf-mimic-and-creative-intelligence.pdf](./pdf/07-caf-mimic-and-creative-intelligence.pdf) | Mimic & creative intel | Mimic operators, creative team | Mimic guides, text placement automation, creative intelligence |
| [08-caf-inputs-pipeline.pdf](./pdf/08-caf-inputs-pipeline.pdf) | Inputs pipeline | Research / inputs operators | Inputs roadmap |
| [10-caf-job-lifecycle.pdf](./pdf/10-caf-job-lifecycle.pdf) | **Content job lifecycle** | Engineers, ops, reviewers | Job lifecycle guide, LIFECYCLE, job-pipeline, review-rework |
| [09-caf-operations-and-deploy.pdf](./pdf/09-caf-operations-and-deploy.pdf) | Operations & deploy | DevOps, production setup | Fly checklist, secrets guide, env inventory |

*Last generated: 2026-06-16*

---

## Suggested sharing packs

| Recipient | Send these PDFs |
|-----------|-----------------|
| Executive / investor | `01-caf-product.pdf` |
| New product hire | `01` + `08-caf-inputs-pipeline.pdf` |
| New engineer | `02` + `03` + `04` |
| External integrator | `06` + `09` |
| Mimic / creative team | `07` |
| Job lifecycle (ops / engineers) | `10-caf-job-lifecycle.pdf` |
| ChatGPT / Claude project | `02` (or upload Tier 1 markdown from EXTERNAL_CONTEXT_PACK) |

---

## Notes

- Internal links in PDFs point at repo paths — they are not clickable to live docs unless you host them.
- For always-fresh markdown, share from `docs/` directly or regenerate PDFs after edits.
- Do **not** commit real secrets; `09` references env var **names** only.
