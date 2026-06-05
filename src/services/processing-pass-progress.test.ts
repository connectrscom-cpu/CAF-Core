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
});
