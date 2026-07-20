import { describe, expect, it } from "vitest";
import {
  computeEngagementRate,
  metricWindowForPublishedAt,
  parseFbMetrics,
  parseIgMetrics,
} from "./meta-metrics-pull.js";

describe("computeEngagementRate", () => {
  it("sums interactions over reach", () => {
    expect(
      computeEngagementRate({ likes: 10, comments: 5, shares: 3, saves: 2, reach: 1000 })
    ).toBeCloseTo(0.02, 5);
  });

  it("treats missing interaction counts as zero", () => {
    expect(
      computeEngagementRate({ likes: 10, comments: null, shares: null, saves: null, reach: 100 })
    ).toBeCloseTo(0.1, 5);
  });

  it("returns null when reach is unknown or zero", () => {
    expect(computeEngagementRate({ likes: 5, comments: 1, shares: 0, saves: 0, reach: null })).toBeNull();
    expect(computeEngagementRate({ likes: 5, comments: 1, shares: 0, saves: 0, reach: 0 })).toBeNull();
  });
});

describe("metricWindowForPublishedAt", () => {
  const now = new Date("2026-07-16T12:00:00Z");

  it("classifies young posts as early", () => {
    expect(metricWindowForPublishedAt("2026-07-15T12:00:00Z", now)).toBe("early");
  });

  it("classifies posts older than 72h as stabilized", () => {
    expect(metricWindowForPublishedAt("2026-07-10T12:00:00Z", now)).toBe("stabilized");
  });

  it("defaults to stabilized for null/invalid published_at", () => {
    expect(metricWindowForPublishedAt(null, now)).toBe("stabilized");
    expect(metricWindowForPublishedAt("garbage", now)).toBe("stabilized");
  });
});

describe("parseIgMetrics", () => {
  it("merges media counts with insights", () => {
    const m = parseIgMetrics(
      { like_count: 42, comments_count: 7 },
      {
        data: [
          { name: "reach", values: [{ value: 1234 }] },
          { name: "saved", values: [{ value: 9 }] },
          { name: "shares", values: [{ value: 4 }] },
          { name: "views", values: [{ value: 5000 }] },
        ],
      }
    );
    expect(m.likes).toBe(42);
    expect(m.comments).toBe(7);
    expect(m.reach).toBe(1234);
    expect(m.saves).toBe(9);
    expect(m.shares).toBe(4);
    expect(m.video_views).toBe(5000);
  });

  it("tolerates empty insights", () => {
    const m = parseIgMetrics({ like_count: "3" }, {});
    expect(m.likes).toBe(3);
    expect(m.reach).toBeNull();
    expect(m.saves).toBeNull();
  });
});

describe("parseFbMetrics", () => {
  it("reads summary counts and impressions", () => {
    const m = parseFbMetrics(
      {
        likes: { summary: { total_count: 11 } },
        comments: { summary: { total_count: 2 } },
        shares: { count: 6 },
      },
      { data: [{ name: "post_impressions_unique", values: [{ value: 800 }] }] }
    );
    expect(m.likes).toBe(11);
    expect(m.comments).toBe(2);
    expect(m.shares).toBe(6);
    expect(m.saves).toBeNull();
    expect(m.reach).toBe(800);
  });

  it("falls back to post_impressions when unique reach is missing", () => {
    const m = parseFbMetrics({}, { data: [{ name: "post_impressions", values: [{ value: 900 }] }] });
    expect(m.reach).toBe(900);
  });
});
