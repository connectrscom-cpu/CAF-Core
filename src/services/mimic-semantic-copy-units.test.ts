import { describe, expect, it } from "vitest";
import {
  bodyLinesToSemanticUnits,
  fitSemanticUnitsToStackCount,
  repairDanglingStackTexts,
  semanticBodyCopyForStacks,
} from "./mimic-semantic-copy-units.js";

describe("mimic-semantic-copy-units", () => {
  it("merges lowercase continuations into one phrase", () => {
    expect(
      bodyLinesToSemanticUnits([
        "Aims to shape up",
        "for the sunny season",
      ])
    ).toEqual(["Aims to shape up for the sunny season"]);
  });

  it("merges FaceTime party tail words", () => {
    expect(
      bodyLinesToSemanticUnits([
        "Hosts FaceTime",
        "parties",
        "DIY TikTok",
        "icons",
      ])
    ).toEqual(["Hosts FaceTime parties", "DIY TikTok icons"]);
  });

  it("merges bed-day phrase for Cancer", () => {
    expect(
      bodyLinesToSemanticUnits([
        "Spending whole",
        "day in bed",
      ])
    ).toEqual(["Spending whole day in bed"]);
  });

  it("fitSemanticUnitsToStackCount keeps four corner phrases for Leo", () => {
    const lines = [
      "Delivers speeches",
      "to their reflection",
      "Cleans space,",
      "clears clutter",
      "Ignores Instagram challenges",
      "Aims to shape up",
      "for the sunny season",
    ];
    const units = bodyLinesToSemanticUnits(lines);
    expect(units).toEqual([
      "Delivers speeches to their reflection",
      "Cleans space, clears clutter",
      "Ignores Instagram challenges",
      "Aims to shape up for the sunny season",
    ]);
    expect(fitSemanticUnitsToStackCount(units, 4)).toEqual(units);
  });

  it("semanticBodyCopyForStacks splits run-on Aries body into three phrases", () => {
    const runOn =
      "Already upset about the trip being canceled 5th photoshoot of the day completed Making up for extended birthday with three cakes";
    expect(semanticBodyCopyForStacks([runOn], 3)).toEqual([
      "Already upset about the trip being canceled",
      "5th photoshoot of the day completed",
      "Making up for extended birthday with three cakes",
    ]);
  });

  it("repairDanglingStackTexts merges dangling tail into nearest stack", () => {
    const stacks = [
      [{ x: 0.1, y: 0.2, w: 0.2, h: 0.04 }],
      [{ x: 0.7, y: 0.2, w: 0.2, h: 0.04 }],
    ];
    const repaired = repairDanglingStackTexts(
      ["Aims to shape up", "for the sunny season"],
      stacks
    );
    expect(repaired[0]).toBe("");
    expect(repaired[1]).toContain("Aims to shape up");
    expect(repaired[1]).toContain("for the sunny season");
  });
});
