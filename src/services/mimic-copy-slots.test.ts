import { describe, expect, it } from "vitest";
import {
  assignLlmCopyUsingCopySlots,
  collapseTextBlocksToCopySlots,
  copySlotsShouldDriveMapping,
  copySlotsForSlideRecord,
  extractLlmTextPerCopySlot,
  inferMimicReferenceCopySlots,
  inferMimicReferenceCopySlotsOnePerBlock,
  normalizeLlmSlideToCopySlots,
  normalizeInferredCopySlots,
  splitHeadlineForChatMockTitlePair,
  splitLineAcrossRefBlocks,
  llmSlideFromCopySlots,
  ocrBlockCountForCopySlots,
  serializeCopySlotsForLlmPrompt,
} from "./mimic-copy-slots.js";

describe("mimic-copy-slots", () => {
  it("inferMimicReferenceCopySlotsOnePerBlock keeps one slot per OCR box on 2x2 grids", () => {
    const blocks = [
      { text: "line one", role: "body", x: 0.55, y: 0.38, w: 0.32, h: 0.04 },
      { text: "line two", role: "body", x: 0.55, y: 0.44, w: 0.32, h: 0.04 },
      { text: "line three", role: "body", x: 0.12, y: 0.58, w: 0.32, h: 0.04 },
      { text: "@signandsound", role: "handle", x: 0.4, y: 0.45, w: 0.2, h: 0.03 },
    ];
    const stacked = inferMimicReferenceCopySlots(blocks);
    const perBox = inferMimicReferenceCopySlotsOnePerBlock(blocks);
    expect(stacked.length).toBeLessThan(blocks.length);
    expect(perBox).toHaveLength(4);
    expect(perBox.every((s) => s.block_texts.length === 1)).toBe(true);
    expect(ocrBlockCountForCopySlots(perBox)).toBe(4);
  });

  it("groups chat-mock title pair into one headline slot", () => {
    const blocks = [
      { text: "how you should text", role: "headline", x: 0.14, y: 0.07, w: 0.72, h: 0.065 },
      { text: "your gemini friend", role: "subheadline", x: 0.17, y: 0.15, w: 0.65, h: 0.065 },
      { text: "Brain full of whimsy", role: "cta", x: 0.11, y: 0.9, w: 0.31, h: 0.025 },
    ];
    const slots = inferMimicReferenceCopySlots(
      blocks,
      "how you should text your gemini friend"
    );
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({
      llm_field: "headline",
      split: "line_per_block",
      block_indices: [0, 1],
      reference_text: "how you should text your gemini friend",
    });
    expect(slots[1]?.llm_field).toBe("cta");
  });

  it("skips watermarks when inferring slots", () => {
    const blocks = [
      { text: "how you should text", role: "headline", x: 0.14, y: 0.07, w: 0.72, h: 0.065 },
      { text: "your virgo friend", role: "subheadline", x: 0.17, y: 0.15, w: 0.7, h: 0.065 },
      { text: "mymarketinglab", role: "body", x: 0.22, y: 0.34, w: 0.08, h: 0.02 },
      { text: "while writing essays", role: "cta", x: 0.08, y: 0.77, w: 0.34, h: 0.03 },
    ];
    const slots = inferMimicReferenceCopySlots(blocks);
    expect(slots.map((s) => s.llm_field)).toEqual(["headline", "handle", "cta"]);
    expect(slots[0]?.block_texts).toEqual(["how you should text", "your virgo friend"]);
  });

  it("assignLlmCopyUsingCopySlots splits headline across title pair", () => {
    const slots = inferMimicReferenceCopySlots([
      { text: "how you should text", role: "headline", x: 0.14, y: 0.07, w: 0.72, h: 0.065 },
      { text: "your gemini friend", role: "subheadline", x: 0.17, y: 0.15, w: 0.65, h: 0.065 },
      { text: "Brain full of whimsy", role: "cta", x: 0.11, y: 0.9, w: 0.31, h: 0.025 },
    ]);
    const orderedRef = [
      { ref_text: "how you should text", role: "headline", x: 0.14, y: 0.07, w: 0.72, h: 0.065 },
      { ref_text: "your gemini friend", role: "subheadline", x: 0.17, y: 0.15, w: 0.65, h: 0.065 },
      { ref_text: "Brain full of whimsy", role: "cta", x: 0.11, y: 0.9, w: 0.31, h: 0.025 },
    ];
    const assigned = assignLlmCopyUsingCopySlots(
      orderedRef,
      slots,
      { headline: "Texting a Gemini", bodyLines: ["You're the whimsical one", "Brain full of stories"] },
      ["Texting a Gemini", "You're the whimsical one", "Brain full of stories"]
    );
    expect(assigned).toEqual(["Texting a", "Gemini friend", "Brain full of stories"]);
  });

  it("splitHeadlineForChatMockTitlePair mirrors sentence rhythm", () => {
    expect(
      splitHeadlineForChatMockTitlePair(
        "Texting a Gemini",
        { ref_text: "how you should text" },
        { ref_text: "your gemini friend" }
      )
    ).toEqual({ upper: "Texting a", lower: "Gemini friend" });
  });

  it("groups stacked body OCR fragments into one slot", () => {
    const blocks = [
      { text: "Aries", role: "headline", x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
      { text: "mad about", role: "body", x: 0.55, y: 0.35, w: 0.35, h: 0.04 },
      { text: "the canceled", role: "body", x: 0.55, y: 0.41, w: 0.35, h: 0.04 },
      { text: "birthday trip", role: "body", x: 0.55, y: 0.47, w: 0.35, h: 0.04 },
    ];
    const slots = inferMimicReferenceCopySlots(
      blocks,
      "Aries mad about the canceled birthday trip"
    );
    // Sign label is decor-only — not an LLM headline slot.
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      llm_field: "body",
      split: "single_block",
      block_texts: ["mad about", "the canceled", "birthday trip"],
    });
  });

  it("splits list-column bullets into one copy slot per line and merges orphan on TikTok tail", () => {
    const blocks = [
      { text: "Virgo", role: "headline", x: 0.08, y: 0.08, w: 0.2, h: 0.05 },
      { text: "plans home workouts but stops after a few minutes", role: "body", x: 0.1, y: 0.3, w: 0.35, h: 0.04 },
      { text: "hosts online catch-ups with pals", role: "body", x: 0.1, y: 0.36, w: 0.35, h: 0.04 },
      { text: "purchases every idea", role: "body", x: 0.1, y: 0.42, w: 0.35, h: 0.04 },
      { text: "tackles each DIY", role: "body", x: 0.1, y: 0.48, w: 0.35, h: 0.04 },
      { text: "on TikTok", role: "cta", x: 0.55, y: 0.48, w: 0.15, h: 0.04 },
      { text: "@signandsound", role: "handle", x: 0.4, y: 0.85, w: 0.2, h: 0.03 },
    ];
    const slots = inferMimicReferenceCopySlots(blocks);
    const body = slots.filter((s) => s.llm_field === "body");
    expect(body).toHaveLength(4);
    expect(body[3]!.reference_text).toMatch(/tackles each DIY.*on TikTok/i);
    expect(slots.some((s) => s.llm_field === "cta" && /tiktok/i.test(s.reference_text))).toBe(false);
    expect(slots.find((s) => s.llm_field === "handle")?.reference_text).toBe("@signandsound");
  });

  it("splits one LLM body sentence across stacked OCR lines", () => {
    const slots = inferMimicReferenceCopySlots([
      { text: "mad about", role: "body", x: 0.55, y: 0.35, w: 0.35, h: 0.04 },
      { text: "the canceled", role: "body", x: 0.55, y: 0.41, w: 0.35, h: 0.04 },
      { text: "birthday trip", role: "body", x: 0.55, y: 0.47, w: 0.35, h: 0.04 },
    ]);
    const orderedRef = [
      { ref_text: "mad about", role: "body", x: 0.55, y: 0.35, w: 0.35, h: 0.04 },
      { ref_text: "the canceled", role: "body", x: 0.55, y: 0.41, w: 0.35, h: 0.04 },
      { ref_text: "birthday trip", role: "body", x: 0.55, y: 0.47, w: 0.35, h: 0.04 },
    ];
    const assigned = assignLlmCopyUsingCopySlots(
      orderedRef,
      slots,
      { headline: null, bodyLines: ["Upset about cancelled plans"] },
      ["Upset about cancelled plans"]
    );
    expect(assigned[0]).toBe("Upset about cancelled plans");
    expect(assigned.slice(1).every((s) => !s.trim())).toBe(true);
  });

  it("splitLineAcrossRefBlocks respects reference line lengths", () => {
    expect(splitLineAcrossRefBlocks("Upset about cancelled plans", ["mad about", "the canceled", "birthday trip"])).toEqual([
      "Upset about",
      "cancelled",
      "plans",
    ]);
  });

  it("groups each corner stack as one copy slot on multi-quadrant memes", () => {
    const blocks = [
      { text: "Aries", role: "headline", x: 0.35, y: 0.06, w: 0.3, h: 0.05 },
      { text: "mad about", role: "body", x: 0.58, y: 0.32, w: 0.32, h: 0.04 },
      { text: "the canceled", role: "body", x: 0.58, y: 0.38, w: 0.32, h: 0.04 },
      { text: "birthday trip", role: "body", x: 0.58, y: 0.44, w: 0.32, h: 0.04 },
      { text: "plans on getting", role: "body", x: 0.58, y: 0.58, w: 0.32, h: 0.04 },
      { text: "3 birthday cakes", role: "body", x: 0.12, y: 0.58, w: 0.32, h: 0.04 },
      { text: "to compensate", role: "body", x: 0.12, y: 0.64, w: 0.32, h: 0.04 },
      { text: "starts to flirt", role: "body", x: 0.58, y: 0.64, w: 0.32, h: 0.04 },
      { text: "already did", role: "body", x: 0.12, y: 0.72, w: 0.32, h: 0.04 },
      { text: "the 5th photo shoot in a row", role: "body", x: 0.12, y: 0.78, w: 0.36, h: 0.05 },
      { text: "shoot in a row @cancermajesty", role: "cta", x: 0.2, y: 0.92, w: 0.6, h: 0.04 },
    ];
    const slots = inferMimicReferenceCopySlots(blocks);
    const bodySlots = slots.filter((s) => s.llm_field === "body");
    expect(bodySlots.length).toBeGreaterThanOrEqual(2);
    const madCluster = bodySlots.find((s) => {
      const t = s.block_texts.join(" ");
      return t.includes("mad about") && t.includes("birthday trip");
    });
    expect(madCluster).toBeTruthy();
    expect(bodySlots.some((s) => s.block_texts.join(" ").includes("starts to flirt"))).toBe(true);
    expect(bodySlots.some((s) => s.block_texts.join(" ").includes("plans on getting"))).toBe(true);

    const llm = llmSlideFromCopySlots(slots);
    expect(Array.isArray(llm.text_blocks)).toBe(true);
    expect((llm.text_blocks as unknown[]).length).toBe(slots.length);
  });

  it("reclassifies inverted zodiac crush roles (corner brand vs main line)", () => {
    const blocks = [
      { text: "astrhology", role: "headline", x: 0.596, y: 0.047, w: 0.083, h: 0.016 },
      { text: "taurus with a crush", role: "cta", x: 0.149, y: 0.477, w: 0.696, h: 0.049 },
    ];
    const slots = inferMimicReferenceCopySlots(blocks, "astrhology\ntaurus with a crush");
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({
      llm_field: "headline",
      block_texts: ["taurus with a crush"],
    });
    expect(slots[1]).toMatchObject({
      llm_field: "handle",
      block_texts: ["astrhology"],
    });

    const orderedRef = [
      { ref_text: "astrhology", role: "headline", x: 0.596, y: 0.047, w: 0.083, h: 0.016 },
      { ref_text: "taurus with a crush", role: "cta", x: 0.149, y: 0.477, w: 0.696, h: 0.049 },
    ];
    const assigned = assignLlmCopyUsingCopySlots(
      orderedRef,
      slots,
      { headline: "Taurus' Steady Admiration", bodyLines: [] },
      ["Taurus' Steady Admiration"]
    );
    expect(assigned[1]).toBe("Taurus' Steady Admiration");
  });

  it("collapses many OCR fragments in quadrant trait memes to a handful of copy slots", () => {
    const b = (text: string, x: number, y: number, role = "body") => ({
      text,
      role,
      x,
      y,
      w: 0.14,
      h: 0.022,
    });
    const blocks = [
      b("Virgo", 0.12, 0.04, "headline"),
      b("Online", 0.58, 0.12),
      b("shopping", 0.58, 0.14),
      b("carts,", 0.58, 0.16),
      b("always full", 0.58, 0.18),
      b("Hosts", 0.1, 0.12),
      b("virtual", 0.1, 0.14),
      b("hangouts", 0.1, 0.16),
      b("with friends", 0.1, 0.18),
      b("Announces", 0.58, 0.52),
      b("a home", 0.58, 0.54),
      b("workout,", 0.58, 0.56),
      b("surrenders", 0.58, 0.58),
      b("after warmup", 0.58, 0.6),
      b("Up for", 0.1, 0.52),
      b("every", 0.1, 0.54),
      b("Pinterest", 0.1, 0.56),
      b("DIY", 0.1, 0.58),
      b("@signandsound", 0.4, 0.88, "handle"),
    ];
    const slots = inferMimicReferenceCopySlots(blocks);
    const editable = slots.filter((s) => s.llm_field !== "handle");
    expect(editable.length).toBeLessThanOrEqual(6);
    expect(editable.length).toBeGreaterThanOrEqual(3);
    expect(slots.filter((s) => s.llm_field === "body").length).toBeGreaterThanOrEqual(2);
  });

  it("copySlotsForSlideRecord re-infers when persisted slots are over-fragmented", () => {
    const b = (text: string, x: number, y: number, role = "body") => ({
      text,
      role,
      x,
      y,
      w: 0.14,
      h: 0.022,
    });
    const text_blocks = [
      b("Virgo", 0.12, 0.04, "headline"),
      b("Online", 0.58, 0.12),
      b("shopping", 0.58, 0.14),
      b("carts,", 0.58, 0.16),
      b("always full", 0.58, 0.18),
      b("Hosts", 0.1, 0.12),
      b("virtual", 0.1, 0.14),
      b("hangouts", 0.1, 0.16),
      b("with friends", 0.1, 0.18),
      b("Announces", 0.58, 0.52),
      b("a home", 0.58, 0.54),
      b("workout,", 0.58, 0.56),
      b("surrenders", 0.58, 0.58),
      b("after warmup", 0.58, 0.6),
      b("Up for", 0.1, 0.52),
      b("every", 0.1, 0.54),
      b("Pinterest", 0.1, 0.56),
      b("DIY", 0.1, 0.58),
      b("@signandsound", 0.4, 0.88, "handle"),
    ];
    const overFragmented = text_blocks.map((block, i) => ({
      slot_index: i,
      llm_field: block.role === "headline" ? "headline" : block.role === "handle" ? "handle" : "body",
      split: "single_block" as const,
      block_indices: [i],
      block_texts: [block.text],
      reference_text: block.text,
    }));
    const slide = { text_blocks, copy_slots_v1: overFragmented };
    const resolved = copySlotsForSlideRecord(slide);
    expect(resolved.filter((s) => s.llm_field !== "handle").length).toBeLessThanOrEqual(6);
    expect(resolved.filter((s) => s.llm_field !== "handle").length).toBeGreaterThanOrEqual(3);
  });

  it("copySlotsShouldDriveMapping prefers slots for multi-quadrant memes", () => {
    const blocks = [
      { text: "Aries", role: "headline", x: 0.35, y: 0.05, w: 0.3, h: 0.06 },
      { text: "mad about", role: "body", x: 0.7, y: 0.21, w: 0.22, h: 0.04 },
      { text: "the canceled", role: "body", x: 0.7, y: 0.26, w: 0.22, h: 0.04 },
      { text: "starts to flirt", role: "body", x: 0.06, y: 0.33, w: 0.25, h: 0.04 },
      { text: "out of boredom", role: "body", x: 0.06, y: 0.38, w: 0.25, h: 0.04 },
    ];
    const slots = inferMimicReferenceCopySlots(blocks);
    expect(copySlotsShouldDriveMapping(slots, 2)).toBe(true);
    expect(slots.filter((s) => s.llm_field === "body").length).toBeGreaterThanOrEqual(2);
  });

  it("collapseTextBlocksToCopySlots splits one LLM body across multiple body slots", () => {
    const blocks = [
      { text: "Aries", role: "headline" },
      {
        role: "body",
        text: "Flirting with anyone just to break the boredom Still not over that birthday trip getting axed",
      },
    ];
    const ocrBlocks = [
      { text: "Aries", role: "headline", x: 0.35, y: 0.05, w: 0.3, h: 0.06 },
      { text: "mad about", role: "body", x: 0.7, y: 0.21, w: 0.22, h: 0.04 },
      { text: "the canceled", role: "body", x: 0.7, y: 0.26, w: 0.22, h: 0.04 },
      { text: "starts to flirt", role: "body", x: 0.06, y: 0.33, w: 0.25, h: 0.04 },
      { text: "out of boredom", role: "body", x: 0.06, y: 0.38, w: 0.25, h: 0.04 },
      { text: "already did", role: "body", x: 0.06, y: 0.58, w: 0.25, h: 0.04 },
      { text: "plans on getting", role: "body", x: 0.58, y: 0.58, w: 0.32, h: 0.04 },
    ];
    const slots = inferMimicReferenceCopySlots(ocrBlocks);
    const collapsed = collapseTextBlocksToCopySlots(blocks, slots);
    expect(collapsed[0]).toBe("Aries");
    const bodyParts = collapsed.filter((_, i) => slots[i]?.llm_field === "body");
    expect(bodyParts.filter((t) => t.trim()).length).toBeGreaterThanOrEqual(2);
    expect(bodyParts.join(" ")).toContain("Flirting");
    expect(bodyParts.join(" ")).toContain("birthday trip");
  });

  it("routes headline remainder to matching body stack when decor title is preserved", () => {
    const blocks = [
      { text: "Aries", role: "headline", x: 0.35, y: 0.06, w: 0.3, h: 0.05 },
      { text: "mad about", role: "body", x: 0.58, y: 0.32, w: 0.32, h: 0.04 },
      { text: "the canceled", role: "body", x: 0.58, y: 0.38, w: 0.32, h: 0.04 },
      { text: "birthday trip", role: "body", x: 0.58, y: 0.44, w: 0.32, h: 0.04 },
      { text: "plans on getting", role: "body", x: 0.58, y: 0.58, w: 0.32, h: 0.04 },
      { text: "3 birthday cakes", role: "body", x: 0.12, y: 0.58, w: 0.32, h: 0.04 },
      { text: "to compensate", role: "body", x: 0.12, y: 0.64, w: 0.32, h: 0.04 },
      { text: "starts to flirt", role: "body", x: 0.58, y: 0.64, w: 0.32, h: 0.04 },
      { text: "out of boredom", role: "body", x: 0.58, y: 0.7, w: 0.32, h: 0.04 },
      { text: "already did", role: "body", x: 0.12, y: 0.72, w: 0.32, h: 0.04 },
      { text: "the 5th photo shoot in a row", role: "body", x: 0.12, y: 0.78, w: 0.36, h: 0.05 },
    ];
    const transcript = [
      "Aries",
      "mad about",
      "the canceled",
      "birthday trip",
      "plans on getting",
      "3 birthday cakes",
      "to compensate",
      "starts to flirt",
      "out of boredom",
      "already did",
      "the 5th photo shoot in a row",
    ].join("\n");
    const slots = inferMimicReferenceCopySlots(blocks, transcript);
    const orderedRef = blocks.map((b) => ({
      ref_text: b.text,
      role: b.role,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
    }));
    const assigned = assignLlmCopyUsingCopySlots(
      orderedRef,
      slots,
      {
        headline: "Aries gets playful when bored",
        bodyLines: [
          "Mad about cancelled plans",
          "Plans three birthday cakes",
          "Already flirted three times",
        ],
      },
      [],
      { transcript }
    );
    expect(assigned[0]).toBe("Aries");
    expect(assigned[0]).toBe("Aries");
    expect(assigned.join(" ")).toMatch(/playful/i);
    expect(assigned.join(" ")).toMatch(/bored/i);
    expect(assigned.some((t) => /Mad about/i.test(t))).toBe(true);
    expect(assigned.some((t) => /playful/i.test(t) && /bored/i.test(t))).toBe(true);
  });

  it("normalizeLlmSlideToCopySlots keeps one text_blocks row per copy slot cluster", () => {
    const blocks = [
      { text: "Aries", role: "headline", x: 0.35, y: 0.06, w: 0.3, h: 0.05 },
      { text: "mad about trip", role: "body", x: 0.58, y: 0.32, w: 0.32, h: 0.04 },
      { text: "three cakes", role: "body", x: 0.12, y: 0.58, w: 0.32, h: 0.04 },
      { text: "flirts when bored", role: "body", x: 0.58, y: 0.64, w: 0.32, h: 0.04 },
    ];
    const slots = inferMimicReferenceCopySlots(blocks, "Aries mad about trip three cakes flirts when bored");
    const normalized = normalizeLlmSlideToCopySlots(
      {
        headline: "Aries gets playful when bored",
        body: "Upset about cancelled trip\nPlans three birthday cakes\nStarts flirting out of boredom",
      },
      slots,
      { projectHandle: "@mybrand" }
    );
    const tbs = normalized.text_blocks as Array<{ role: string; text: string }>;
    expect(tbs.length).toBe(slots.length);
    expect(String(normalized.headline)).toMatch(/Aries/i);
  });

  it("normalizeLlmSlideToCopySlots keeps line_per_block headline as one cluster row", () => {
    const slots = inferMimicReferenceCopySlots([
      { text: "how you should text", role: "headline", x: 0.14, y: 0.07, w: 0.72, h: 0.065 },
      { text: "your gemini friend", role: "subheadline", x: 0.17, y: 0.15, w: 0.65, h: 0.065 },
    ]);
    const normalized = normalizeLlmSlideToCopySlots(
      { headline: "Texting a Gemini friend", text_blocks: [{ role: "headline", text: "Texting a Gemini friend" }] },
      slots
    );
    const tbs = normalized.text_blocks as Array<{ role: string; text: string }>;
    expect(tbs).toHaveLength(1);
    expect(tbs[0]?.role).toBe("headline");
    expect(tbs[0]?.text).toMatch(/Texting a Gemini friend/i);
  });

  it("extractLlmTextPerCopySlot reads plain-string text_blocks", () => {
    const slots = [
      {
        slot_index: 0,
        llm_field: "headline" as const,
        split: "single_block" as const,
        block_texts: ["THE MOTHERS OF THE ZODIAC"],
        reference_text: "THE MOTHERS OF THE ZODIAC",
        reference_chars: 24,
        reference_chars_per_line: [24],
        line_count: 1,
      },
      {
        slot_index: 1,
        llm_field: "handle" as const,
        split: "single_block" as const,
        block_texts: ["@sistersvillage"],
        reference_text: "@sistersvillage",
        reference_chars: 15,
        reference_chars_per_line: [15],
        line_count: 1,
      },
    ];
    const perSlot = extractLlmTextPerCopySlot(
      {
        text_blocks: ["THE MOTHERS OF THE ZODIAC", "@sistersvillage"],
      },
      slots
    );
    expect(perSlot.get(0)).toMatch(/MOTHERS/);
    expect(perSlot.get(1)).toBe("@sistersvillage");
  });

  it("extractLlmTextPerCopySlot prefers slot-aligned text_blocks", () => {
    const slots = inferMimicReferenceCopySlots([
      { text: "how you should text", role: "headline", x: 0.14, y: 0.07, w: 0.72, h: 0.065 },
      { text: "your gemini friend", role: "subheadline", x: 0.17, y: 0.15, w: 0.65, h: 0.065 },
      { text: "Brain full of whimsy", role: "cta", x: 0.11, y: 0.9, w: 0.31, h: 0.025 },
    ]);
    const perSlot = extractLlmTextPerCopySlot(
      {
        text_blocks: [
          { role: "headline", text: "Texting a Gemini" },
          { role: "cta", text: "Brain full of stories" },
        ],
      },
      slots
    );
    expect(perSlot.get(0)).toBe("Texting a Gemini");
    expect(perSlot.get(1)).toBe("Brain full of stories");
  });

  it("serializeCopySlotsForLlmPrompt omits geometry", () => {
    const slots = inferMimicReferenceCopySlots([
      { text: "Aries", role: "headline", x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
      { text: "body line", role: "body", x: 0.5, y: 0.5, w: 0.3, h: 0.05 },
    ]);
    const slim = serializeCopySlotsForLlmPrompt(slots);
    expect(slim?.[0]).toMatchObject({ llm_field: "body", line_count: 1, reference_chars_per_line: [9] });
    expect(JSON.stringify(slim)).not.toContain('"x"');
  });

  it("reassigns body slots that are only @handle text to handle field", () => {
    const slots = normalizeInferredCopySlots([
      {
        schema_version: "copy_slots_v1",
        slot_index: 0,
        llm_field: "headline",
        split: "single_block",
        block_indices: [0],
        block_texts: ["THE ARIES MOTHER"],
        reference_text: "THE ARIES MOTHER",
      },
      {
        schema_version: "copy_slots_v1",
        slot_index: 1,
        llm_field: "body",
        split: "single_block",
        block_indices: [1],
        block_texts: ["@signandsound"],
        reference_text: "@signandsound",
      },
      {
        schema_version: "copy_slots_v1",
        slot_index: 2,
        llm_field: "body",
        split: "single_block",
        block_indices: [2],
        block_texts: ["Deeply rooted in family"],
        reference_text: "Deeply rooted in family",
      },
    ]);
    expect(slots.find((s) => s.llm_field === "handle")?.reference_text).toBe("@signandsound");
    expect(slots.filter((s) => s.llm_field === "body")).toHaveLength(1);
  });

  it("joins multiline body into one OCR box and skips handle lines for handle slot", () => {
    const blocks = [
      { text: "THE ARIES MOTHER", role: "headline", x: 0.1, y: 0.08, w: 0.8, h: 0.08 },
      { text: "@sistersvillage", role: "handle", x: 0.35, y: 0.18, w: 0.3, h: 0.04 },
      {
        text: "Deeply rooted in family",
        role: "body",
        x: 0.1,
        y: 0.55,
        w: 0.8,
        h: 0.2,
      },
    ];
    const slots = inferMimicReferenceCopySlots(blocks);
    const orderedRef = blocks.map((b) => ({ ref_text: b.text, role: b.role, x: b.x, y: b.y, w: b.w, h: b.h }));
    const assigned = assignLlmCopyUsingCopySlots(
      orderedRef,
      slots,
      {
        headline: "THE ARIES MOTHER",
        bodyLines: [
          "@sistersvillage",
          "Full of life and passion, she",
          "brings energy into every moment",
        ],
      },
      ["THE ARIES MOTHER", "@sistersvillage", "Full of life and passion, she", "brings energy into every moment"]
    );
    expect(assigned[0]).toBe("THE ARIES MOTHER");
    expect(assigned[1]).toBe("");
    expect(assigned[2]).toContain("Full of life and passion, she");
    expect(assigned[2]).toContain("brings energy into every moment");
  });
});
