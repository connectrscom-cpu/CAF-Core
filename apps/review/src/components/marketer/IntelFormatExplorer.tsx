"use client";

import { useEffect, useMemo, useState } from "react";
import { FormatExampleStrip } from "@/components/marketer/FormatExampleStrip";
import { enrichFormatExamplesFromEvidence } from "@/lib/marketer/format-group-examples";
import type { FormatGroupExample, MediaLaneTakeaway } from "@/lib/marketer/market-intelligence-adapters";
import type { IntelEvidencePost } from "@/lib/marketer/types";

export function IntelFormatExplorer({
  mediaLanes,
  evidencePosts,
  onSelectExample,
}: {
  mediaLanes: MediaLaneTakeaway[];
  evidencePosts: IntelEvidencePost[];
  onSelectExample: (example: FormatGroupExample) => void;
}) {
  const [laneTab, setLaneTab] = useState<MediaLaneTakeaway["lane"]>(mediaLanes[0]?.lane ?? "carousel");
  const [styleTab, setStyleTab] = useState<string>("all");

  useEffect(() => {
    if (!mediaLanes.length) return;
    if (!mediaLanes.some((l) => l.lane === laneTab)) {
      setLaneTab(mediaLanes[0]!.lane);
      setStyleTab("all");
    }
  }, [mediaLanes, laneTab]);

  const activeLane = mediaLanes.find((l) => l.lane === laneTab) ?? mediaLanes[0];

  const groups = useMemo(() => {
    if (!activeLane) return [];
    return activeLane.formatGroups.map((g) => ({
      ...g,
      examples: enrichFormatExamplesFromEvidence(g.examples ?? [], evidencePosts),
    }));
  }, [activeLane, evidencePosts]);

  const visibleGroups = styleTab === "all" ? groups : groups.filter((g) => g.formatKey === styleTab);

  if (!mediaLanes.length || !activeLane) return null;

  return (
    <section className="intel-formats">
      <h3 className="intel-group-title">By format</h3>
      {activeLane.summary ? <p className="intel-lane-summary intel-lane-summary--lead">{activeLane.summary}</p> : null}

      <div className="intel-format-filters">
        <div className="ideas-format-tabs intel-format-lane-tabs" role="tablist" aria-label="Media format">
          {mediaLanes.map((lane) => (
            <button
              key={lane.lane}
              type="button"
              role="tab"
              aria-selected={laneTab === lane.lane}
              className={`ideas-format-tab ${laneTab === lane.lane ? "active" : ""}`}
              onClick={() => {
                setLaneTab(lane.lane);
                setStyleTab("all");
              }}
            >
              {lane.label}
              <span className="ideas-tab-count">{lane.formatGroups.length}</span>
            </button>
          ))}
        </div>

        <div className="ideas-format-tabs intel-format-style-tabs" role="tablist" aria-label="Content style">
          <button
            type="button"
            role="tab"
            aria-selected={styleTab === "all"}
            className={`ideas-format-tab ${styleTab === "all" ? "active" : ""}`}
            onClick={() => setStyleTab("all")}
          >
            All styles
            <span className="ideas-tab-count">{groups.length}</span>
          </button>
          {groups.map((g) => (
            <button
              key={g.formatKey}
              type="button"
              role="tab"
              aria-selected={styleTab === g.formatKey}
              className={`ideas-format-tab ${styleTab === g.formatKey ? "active" : ""}`}
              onClick={() => setStyleTab(g.formatKey)}
            >
              {g.label}
              <span className="ideas-tab-count">{g.examples.length}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        className={`intel-format-cards-row${styleTab !== "all" ? " intel-format-cards-row--single" : ""}`}
        role="tabpanel"
      >
        {visibleGroups.map((g) => (
          <article key={g.formatKey} className="intel-format-style-card">
            <h4>{g.label}</h4>
            {g.examples.length > 0 ? (
              <FormatExampleStrip examples={g.examples} onSelect={onSelectExample} horizontal />
            ) : (
              <p className="intel-empty-note">No preview media for this style in the brief.</p>
            )}
            <ul className="intel-format-style-takeaways">
              {g.takeaways.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
