import { describe, expect, it } from "vitest";
import {
  hasActiveProviderSession,
  isMidProviderPhase,
  pickRenderState,
} from "./content-job-render-state.js";

describe("pickRenderState", () => {
  it("handles null / undefined / primitive / array as empty", () => {
    for (const bad of [null, undefined, 42, "x", [1, 2, 3]] as const) {
      const v = pickRenderState(bad as unknown);
      expect(v.phase).toBe("");
      expect(v.video_id).toBe("");
      expect(v.session_id).toBe("");
      expect(v.raw).toEqual({});
    }
  });

  it("lower-cases and trims phase", () => {
    expect(pickRenderState({ phase: "  Submitted  " }).phase).toBe("submitted");
  });

  it("coerces numeric ids to trimmed strings", () => {
    const v = pickRenderState({ video_id: 123, session_id: "   abc  " });
    expect(v.video_id).toBe("123");
    expect(v.session_id).toBe("abc");
  });

  it("exposes the raw object for other keys", () => {
    const v = pickRenderState({ phase: "polling", slide_index: 2, foo: "bar" });
    expect(v.raw.slide_index).toBe(2);
    expect(v.raw.foo).toBe("bar");
  });
});

describe("hasActiveProviderSession (HeyGen idempotency invariant)", () => {
  it("is false for empty / malformed state", () => {
    expect(hasActiveProviderSession(null)).toBe(false);
    expect(hasActiveProviderSession({})).toBe(false);
    expect(hasActiveProviderSession({ phase: "starting" })).toBe(false);
    expect(hasActiveProviderSession([] as unknown)).toBe(false);
  });

  it("is true when video_id is set", () => {
    expect(hasActiveProviderSession({ video_id: "vid_123" })).toBe(true);
  });

  it("is true when session_id is set", () => {
    expect(hasActiveProviderSession({ session_id: "sess_123" })).toBe(true);
  });

  it("is true when either id is numeric but non-empty", () => {
    expect(hasActiveProviderSession({ video_id: 42 })).toBe(true);
  });
});

describe("isMidProviderPhase", () => {
  it("flags the phases that imply provider ownership", () => {
    expect(isMidProviderPhase("submitted")).toBe(true);
    expect(isMidProviderPhase("polling")).toBe(true);
    expect(isMidProviderPhase("sora_polling")).toBe(true);
  });

  it("does not flag clean / idle phases", () => {
    expect(isMidProviderPhase("")).toBe(false);
    expect(isMidProviderPhase("starting")).toBe(false);
    expect(isMidProviderPhase("failed")).toBe(false);
    expect(isMidProviderPhase("SUBMITTED")).toBe(true); // case-insensitive
  });
});
