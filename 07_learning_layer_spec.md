# CAF — Learning Layer Specification

## Purpose of this document

CAF should not remain a content generator that forgets everything.

The learning layer is the missing system that must transform:
- generated output
- human corrections
- market outcomes

into future improvements.

CAF Core should implement this through **three learning loops**.

---

## 1. Learning Loop A — Diagnostic Learning

### Purpose
Understand **why** an output is weak, risky, generic, misaligned, or unexpectedly strong.

### Why this matters
Right now CAF can generate content, but it does not strongly explain failure.
Without explicit failure diagnosis, the system only knows that content was bad, not why.

### Inputs
Diagnostic learning should consume:
- generated ContentJob payloads
- rendered assets
- scripts / hooks / captions / slides
- route and QC context
- optional prior review outcomes for comparison

### Process
A diagnostic service should evaluate outputs against structured criteria such as:
- hook strength
- novelty
- platform fit
- tone fit
- emotional specificity
- clarity
- pacing / structure
- CTA strength
- visual coherence
- claim risk / sensitivity risk

### Outputs
Produce a **DiagnosticAudit** record with fields such as:
- `task_id`
- `audit_type`
- `strengths`
- `failure_types`
- `severity`
- `audit_score`
- `improvement_suggestions`
- `risk_findings`
- `created_at`

### Storage
Store in CAF Core database, not only as comments or logs.

### How it should affect future generation
Diagnostic outputs should be reusable to:
- identify repeated failure patterns
- create or update LearningRules
- improve prompt templates
- improve candidate ranking
- trigger route changes or stricter QC

### Example effect
If recurring audits show “generic hooks” in a specific flow, CAF Core should be able to:
- reduce ranking weight for similar candidates
- switch to a stronger prompt version
- add a constraint or rubric for the next generation run

---

## 2. Learning Loop B — Editorial Learning

### Purpose
Learn from what humans actually approve, reject, or rewrite.

### Why this matters
Human review contains the system’s most valuable taste signal.
If that signal is discarded after the decision, CAF wastes one of its few high-quality judgment sources.

### Inputs
Editorial learning should consume:
- review decisions
- review status transitions
- rejection tags
- override fields
- freeform notes
- validator identity if useful
- validation event history
- before/after generated vs overridden content

### Process
The editorial learning service should detect patterns such as:
- frequent rejection reasons
- recurring edits to hooks
- recurring edits to captions
- flow types with low approval
- platform-specific failure types
- prompt versions associated with more overrides
- structural mismatch between generated content and accepted content

### Outputs
Produce structured entities such as:
- **EditorialReview**
- **ValidationEvent**
- derived **LearningRules**
- summary aggregates by project / flow / prompt version / rejection tag

### Storage
Store in CAF Core database with durable linkage to:
- `task_id`
- `candidate_id`
- `run_id`
- `project`
- prompt version / experiment version where possible

### How it should affect future generation
Editorial learning should directly influence:
- prompt version selection
- ranking / routing rules
- approval prediction
- required manual-review thresholds
- rework templates
- platform-specific generation constraints

### Example effect
If reviewers repeatedly replace soft generic CTAs with direct save/share CTAs in a certain project, CAF Core should learn:
- that the original CTA style underperforms editorially
- that future outputs should prefer the edited style

---

## 3. Learning Loop C — Market Learning

### Purpose
Learn from actual audience response after publishing.

### Why this matters
Editorial approval is useful, but it is not enough.
The market is the final judge.

### Inputs
Market learning should consume:
- publishing result rows
- performance metrics by platform and date
- engagement metrics
- watch-time metrics where available
- save/share behavior
- downstream conversion or traffic metrics if later integrated

### Current metrics examples
The current publishing layer suggests tracking fields such as:
- likes
- comments
- shares
- saves
- watch_time
- engagement_rate

### Process
Market learning should compare:
- actual performance across jobs
- performance by prompt version
- performance by flow type
- performance by content archetype
- performance by editorial outcome
- performance by diagnostic score
- performance by topic / hook pattern / CTA pattern / format

### Outputs
Produce:
- **PerformanceMetric** records
- ranked performance summaries
- derived **LearningRules**
- experiment evaluations
- suggested config changes

### Storage
Store in CAF Core database as first-class metrics linked back to job lineage.

### How it should affect future generation
Market learning should influence:
- candidate scoring
- priority weights
- prompt version activation
- format allocation
- content mix decisions
- project strategy adjustments

### Example effect
If short, identity-heavy psychology/astrology hooks reliably outperform generic horoscope hooks in saves, CAF Core should move future ranking and generation toward that pattern.

---

## 4. How the three loops interact

These loops are not separate silos.
They should reinforce each other.

### Diagnostic Learning
Answers:
> what looks weak or strong, and why?

### Editorial Learning
Answers:
> what did humans actually accept, reject, or fix?

### Market Learning
Answers:
> what actually worked in the real world?

Together they should form a closed system:

1. CAF generates content
2. Diagnostic learning evaluates the output
3. Editorial learning captures human correction
4. Market learning records audience outcome
5. CAF Core turns those into LearningRules
6. Future generation changes accordingly

That is the loop CAF currently lacks.

---

## 5. Required storage model

For the learning layer to matter, the outputs must be:
- structured
- queryable
- linkable to upstream jobs
- reusable in future runs

That means the learning layer should not live only in:
- Sheets comments
- ad hoc notes
- one-off prompt changes
- someone’s memory

It needs proper durable storage in CAF Core.

---

## 6. Required feedback surfaces

CAF Core should expose learning outputs back into the system through at least these surfaces:

### Generation surface
Use learning to influence:
- prompt choice
- constraints
- examples
- ranking
- route decisions

### Review surface
Show prior diagnostic/editorial patterns to reviewers or operators.

### Operations surface
Show approval-rate trends, rejection clusters, and performance by flow/prompt.

### Experiment surface
Use learning outputs to justify or evaluate controlled changes.

---

## 7. Minimum viable implementation order

A sensible implementation order is:

### First
Diagnostic learning  
Because it gives the system explicit language for failure.

### Second
Editorial learning  
Because review signals already exist and are highly valuable.

### Third
Market learning  
Because it becomes stronger once publishing and metrics ingestion are cleaner.

This order is practical, not ideological.

---

## 8. Failure condition

The learning layer is failing if it produces reports that do not change future generation.

If the output of the learning layer is:
- interesting
- well written
- ignored

then it is not a learning system.
It is just analytics theater.

---

## 9. Success condition

The learning layer is succeeding when CAF can demonstrate that:
- repeated failure types decline
- approval rate improves
- overrides decline where appropriate
- content quality improves
- performance improves
- prompt changes are evidence-based
- generation becomes more selective, not just more prolific

That is the north star.
