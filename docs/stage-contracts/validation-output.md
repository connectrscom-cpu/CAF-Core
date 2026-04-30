# Validation output (human review) — contract v1

This document defines the **stored output of the validation layer** (human review) as persisted in:

- `caf_core.editorial_reviews.validation_output_json`
- mirrored (latest only) into `caf_core.content_jobs.review_snapshot.validation_output`

The purpose is to make review decisions **automation-friendly** and **learning-ready**:

- Verdict + who/when
- Reviewed content (finalized/edited fields)
- Standardized labels (issue tags)
- Rework hints (routing controls, provider overrides)
- Findings (structured “what’s wrong and where”, with actionable guidance)

## Top-level shape

`ValidationOutputV1`:

```json
{
  "schema_version": "v1",
  "submitted_at": "2026-04-30T12:34:56.789Z",
  "decision": "NEEDS_EDIT",
  "validator": "migue",
  "notes": "Optional notes for downstream",
  "issue_tags": ["tone_off", "hook_strategy_wrong"],
  "content_kind": "carousel",
  "reviewed_content": {
    "title": "Final title (optional)",
    "hook": "Final hook (optional)",
    "caption": "Final caption (optional)",
    "hashtags": "#a #b (optional)",
    "slides": [
      { "index": 0, "headline": "Slide 1 title", "body": "Slide 1 body" }
    ],
    "spoken_script": "Video-only (optional)"
  },
  "rework_hints": {
    "regenerate": false,
    "rewrite_copy": true,
    "skip_video_regeneration": false,
    "skip_image_regeneration": false,
    "heygen_avatar_id": "optional",
    "heygen_voice_id": "optional",
    "heygen_force_rerender": false
  },
  "findings": [
    {
      "label": "bad_structure",
      "severity": "warn",
      "location": { "area": "slide_body", "slide_index": 2 },
      "message": "Slide 3 body is too long and loses the core point.",
      "suggestion": "Reduce to one sentence + a single proof point.",
      "example_fix": "Replace body with: 'Here’s the one lever that matters…'"
    }
  ],
  "metadata": {}
}
```

## Notes

- **`issue_tags`**: today these are the review console “Issue tags” buttons; they are standardized labels.
- **`reviewed_content`**: this stores the *reviewed* fields (overrides when present, otherwise generated output).
- **`rework_hints.regenerate`**: if `false`, downstream should **reuse the existing rendered assets** and only patch copy fields (caption/hashtags/hook/etc). No renderer/HeyGen calls.
- **`findings`**: this is where we’ll evolve to store “what’s wrong and where” with concrete suggestions. It’s
  currently empty unless a caller populates it (UI work to follow).

