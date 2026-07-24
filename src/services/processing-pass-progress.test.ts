import { describe, expect, it } from "vitest";
import {
  appendProcessingPassProgress,
  beginProcessingPassProgress,
  finishProcessingPassProgress,
  getProcessingPassProgress,
} from "./processing-pass-progress.js";

describe("processing-pass-progress", () => {
  it("tracks lines and completion", () => {
    const id = "test-progress-" + Date.now();
    beginProcessingPassProgress(id, "top_performer_carousel");
    appendProcessingPassProgress(id, "Starting", "init");
    appendProcessingPassProgress(id, "Document AI OCR…", "document_ai");

    const mid = getProcessingPassProgress(id);
    expect(mid?.pass).toBe("top_performer_carousel");
    expect(mid?.lines).toHaveLength(2);
    expect(mid?.finished_at).toBeNull();

    finishProcessingPassProgress(id, true);
    const done = getProcessingPassProgress(id);
    expect(done?.ok).toBe(true);
    expect(done?.finished_at).toBeTruthy();
  });

  it("keeps early lines when begin is called twice for the same active pass", () => {
    const id = "test-progress-idempotent-" + Date.now();
    beginProcessingPassProgress(id, "top_performer_carousel");
    appendProcessingPassProgress(id, "Accepted — running in background…", "accepted");
    beginProcessingPassProgress(id, "top_performer_carousel");
    appendProcessingPassProgress(id, "Init · vision", "init");

    const snap = getProcessingPassProgress(id);
    expect(snap?.lines.map((l) => l.message)).toEqual([
      "Accepted — running in background…",
      "Init · vision",
    ]);
    expect(snap?.finished_at).toBeNull();
  });
});
