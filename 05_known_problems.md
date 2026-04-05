# CAF — Known Problems

## Purpose of this document

This is a direct list of real weaknesses in the current CAF system.

It is not meant to sound optimistic.
It is meant to stop the rebuild from solving the wrong problems.

---

## 1. Content quality is weak

CAF can already generate a lot of content.
That is not the problem.

The problem is that a meaningful share of that content:
- sounds generic
- lacks sharpness
- lacks novelty
- lacks emotional specificity
- feels machine-made
- is not reliably strong enough to deserve publishing

This is the central business problem.

---

## 2. Selection is not strong enough

CAF produces candidates, but it does not yet choose aggressively enough between:
- strong ideas
- mediocre ideas
- obviously weak ideas

Symptoms:
- too many low-signal ideas survive downstream
- generation volume compensates for weak judgment
- confidence / priority signals are not yet a strong enough gate

Result:
the system spends real generation/render time on ideas that should have died earlier.

---

## 3. Learning is not properly implemented

The learning concept exists in the architecture, but the actual loop is weak.

Current reality:
- diagnostics are not formalized strongly enough
- editorial corrections are not deeply captured as structured rules
- post-publication performance is not strongly feeding future generation
- the LEARNING workbook is effectively underdeveloped

Result:
CAF can repeat mistakes at scale.

---

## 4. Too much business logic is trapped in n8n

A large amount of logic currently lives inside:
- code nodes
- workflow branches
- implicit assumptions between nodes
- one-off normalization code

Problems caused by this:
- hard to test
- hard to version
- hard to reason about outside the flow UI
- hard to migrate safely
- easy to create hidden regressions

n8n is doing work that a real backend/domain layer should own.

---

## 5. Google Sheets are overloaded as system state

Sheets currently carry:
- source definitions
- processing results
- runtime queues
- review state
- draft memory
- publishing results
- partial learning memory

This made sense to get the system off the ground.
It is also one of the main reasons the system is now difficult to evolve cleanly.

Problems caused:
- too many columns
- too many responsibilities in one place
- hidden state transitions
- spreadsheet shape becoming a proxy for architecture

---

## 6. `Content_Jobs` has become too wide

`Content_Jobs` is useful because it centralizes execution state.
It is also dangerous because it centralizes too many concerns in one row.

A single row can now carry:
- identity
- generation payload
- render state
- review state
- scene bundle state
- asset linkage
- provider-specific details

This is strong for operations and bad for clean long-term modeling.

---

## 7. Review app feedback is underused

The review layer captures highly valuable information:
- approvals
- rejections
- edits
- override text
- rejection tags
- validator notes

But that information is not yet strongly turned into:
- durable structured feedback
- learning rules
- better ranking logic
- better prompt adaptation

Right now, too much editorial intelligence dies in the review step.

---

## 8. Publishing is thinner than the earlier phases

The upstream system is much more developed than the downstream result loop.

CAF has much richer machinery for:
- intake
- synthesis
- creation
- rendering

than for:
- publishing control
- performance normalization
- market feedback reuse

That imbalance matters because the final outcome should be what disciplines the system.

---

## 9. Learning and experiment memory are too weak

There are signs of the right idea:
- logging template
- validation memory
- config change proposal intention

But the system still lacks a strong, enforceable experiment discipline.

That means changes can happen without:
- clear baselines
- clean comparison windows
- reliable attribution of impact

---

## 10. State ownership is split but not formalized enough

The split itself is not wrong:
- Sheets for control and human visibility
- Supabase for durable assets/data
- n8n for orchestration
- review app for interface

The problem is that the contracts between these systems are still too implicit.

That creates risk around:
- mismatched IDs
- stale statuses
- ghost tasks
- review queue inconsistencies
- provider-specific edge cases

---

## 11. Complexity is growing faster than maintainability

The more CAF adds:
- providers
- branches
- scene paths
- project configurations
- review logic
- exceptions

the more dangerous it becomes to maintain as a primarily flow-first system.

This is the classic transition point where:
- prototype architecture stops being enough
- core domain logic needs a real home

CAF is at that point now.

---

## 12. The system scales output better than it scales taste

This is the real summary.

CAF can:
- generate
- route
- render
- queue

But it does not yet:
- judge well enough
- remember well enough
- adapt well enough

That is why the rebuild should focus on:
- selection
- structured feedback
- learning loops
- domain centralization

Not on rebuilding scrapers for the sake of rebuilding scrapers.
