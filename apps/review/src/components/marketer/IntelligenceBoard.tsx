"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { MarketIntelligenceView } from "@/lib/marketer/market-intelligence-adapters";
import type { HashtagInsight, MarketInsight, ResearchBrief } from "@/lib/marketer/types";

interface IntelligenceBoardProps {
  slug: string;
  initialPackId?: string | null;
}

interface IntelligenceResponse {
  ok: boolean;
  intelligence: MarketIntelligenceView;
  hashtags: HashtagInsight[];
  packId: string | null;
  brief: ResearchBrief | null;
  briefs: ResearchBrief[];
  importId: string | null;
}

function InsightCards({ items, empty }: { items: MarketInsight[]; empty?: string }) {
  if (!items.length) {
    return empty ? <p className="intel-empty-note">{empty}</p> : null;
  }
  return (
    <div className="intel-cards">
      {items.map((ins) => (
        <article key={ins.id} className="intel-card intel-card--hover">
          <h4>{ins.title}</h4>
          {ins.summary && <p>{ins.summary}</p>}
          <div className="intel-card-meta">
            {ins.evidenceCount > 0 && (
              <span>
                {ins.evidenceCount} {ins.evidenceCount === 1 ? "post" : "posts"}
              </span>
            )}
            {ins.confidence != null && <span>{Math.round(ins.confidence * 100)}% pattern strength</span>}
          </div>
        </article>
      ))}
    </div>
  );
}

export function IntelligenceBoard({ slug, initialPackId }: IntelligenceBoardProps) {
  const [data, setData] = useState<IntelligenceResponse | null>(null);
  const [packId, setPackId] = useState(initialPackId ?? "");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [selectedFormats, setSelectedFormats] = useState<string[]>(["carousel", "video"]);
  const [selectedLens, setSelectedLens] = useState<string[]>(["niche", "product"]);
  const [openTopic, setOpenTopic] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const qs = packId ? `?packId=${encodeURIComponent(packId)}` : "";
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/intelligence${qs}`);
      if (!res.ok) throw new Error("Failed to load intelligence");
      const j = (await res.json()) as IntelligenceResponse;
      setData(j);
      if (!packId && j.packId) setPackId(j.packId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [slug, packId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generateIdeas() {
    setGenerating(true);
    setGenMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId: packId || data?.packId,
          formats: selectedFormats,
          contentLens: selectedLens,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? j.error ?? "Failed to generate ideas");
      setGenMessage(
        j.message ??
          `Generated ${j.ideasCount ?? 0} ideas in a new brief. Switch briefs in the dropdown above or open Ideas.`
      );
      if (j.signalPackId) setPackId(String(j.signalPackId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGenerating(false);
    }
  }

  function toggleFormat(f: string) {
    setSelectedFormats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  function toggleLens(l: string) {
    setSelectedLens((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));
  }

  if (loading) return <p className="workspace-muted">Loading market intelligence…</p>;
  if (error && !data) return <p className="workspace-error">{error}</p>;

  const intel = data?.intelligence;
  const hasContent =
    intel &&
    (intel.totalPatterns > 0 ||
      intel.totalInsights > 0 ||
      intel.mediaLanes.length > 0 ||
      intel.hashtags.length > 0 ||
      intel.topPerformers.length > 0 ||
      intel.summaryBullets.length > 0);

  if (!data || !hasContent) {
    return (
      <div className="workspace-empty">
        <h3>No intelligence yet</h3>
        <p>
          Once research is analyzed into a signal pack, CAF surfaces winning patterns, hooks, hashtags, and format
          takeaways here.
        </p>
        <div className="section-stub-actions">
          <Link href={`/brand/${encodeURIComponent(slug)}/research`} className="btn-primary">
            Start market research
          </Link>
        </div>
      </div>
    );
  }

  const briefSubtitle = [
    data.brief?.createdAt ? new Date(data.brief.createdAt).toLocaleDateString() : null,
    data.brief?.sourceWindow,
    data.brief?.platforms?.length ? data.brief.platforms.join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const hashtags = intel.hashtags.length ? intel.hashtags : data.hashtags;
  const showAvgScore = hashtags.some((t) => t.avgScore != null);

  return (
    <div className="intel-board">
      <div className="intel-toolbar">
        <label className="intel-pack-select">
          <span>Research brief</span>
          <select value={packId || data.packId || ""} onChange={(e) => setPackId(e.target.value)}>
            {(data.briefs ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          {briefSubtitle && <span className="intel-brief-sub">{briefSubtitle}</span>}
        </label>
        {data.brief && (
          <span className="intel-window">
            {data.brief.ideasCount} ideas in brief
          </span>
        )}
      </div>

      {intel.summaryBullets.length > 0 && (
        <section className="intel-executive">
          <h3 className="intel-group-title">Executive summary</h3>
          <ul className="intel-summary-list">
            {intel.summaryBullets.map((line) => (
              <li key={line.slice(0, 40)}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {intel.mediaLanes.length > 0 && (
        <section className="intel-formats">
          <h3 className="intel-group-title">By format</h3>
          <div className="intel-lane-grid">
            {intel.mediaLanes.map((lane) => (
              <article key={lane.lane} className="intel-lane-card intel-card--hover">
                <h4>{lane.label}</h4>
                <p className="intel-lane-summary">{lane.summary}</p>
                {lane.formatGroups.map((g) => (
                  <div key={g.formatKey} className="intel-lane-format">
                    <span className="intel-lane-format-label">{g.label}</span>
                    <ul>
                      {g.takeaways.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </article>
            ))}
          </div>
        </section>
      )}

      {intel.winningPatterns.length > 0 && (
        <section className="intel-group">
          <h3 className="intel-group-title">
            Winning patterns
            <span className="intel-group-count">{intel.winningPatterns.length}</span>
          </h3>
          <InsightCards items={intel.winningPatterns} />
        </section>
      )}

      {intel.hooks.length > 0 && (
        <section className="intel-group">
          <h3 className="intel-group-title">
            Hooks &amp; word choice
            <span className="intel-group-count">{intel.hooks.length}</span>
          </h3>
          <InsightCards items={intel.hooks} />
        </section>
      )}

      {(intel.emotions.length > 0 || intel.topics.length > 0) && (
        <section className="intel-group">
          <h3 className="intel-group-title">Topics &amp; themes</h3>
          <InsightCards items={[...intel.emotions, ...intel.topics]} />
        </section>
      )}

      {hashtags.length > 0 && (
        <section className="intel-hashtags">
          <h3 className="intel-group-title">Hashtags</h3>
          <div className="intel-hashtag-table-wrap">
            <table className="intel-hashtag-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Uses</th>
                  {showAvgScore && <th>Avg score</th>}
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {hashtags.map((t) => (
                  <tr key={t.hashtag}>
                    <td>{t.hashtag}</td>
                    <td>{t.count}</td>
                    {showAvgScore && <td>{t.avgScore != null ? t.avgScore.toFixed(2) : "—"}</td>}
                    <td>{t.sharePct != null ? `${t.sharePct}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {intel.visualPatterns.length > 0 && (
        <section className="intel-group">
          <h3 className="intel-group-title">Visual patterns</h3>
          <InsightCards items={intel.visualPatterns} />
        </section>
      )}

      {intel.opportunities.length > 0 && (
        <section className="intel-group">
          <h3 className="intel-group-title">Opportunities</h3>
          <InsightCards items={intel.opportunities} />
        </section>
      )}

      {intel.avoid.length > 0 && (
        <section className="intel-group">
          <h3 className="intel-group-title">What to avoid</h3>
          <InsightCards items={intel.avoid} />
        </section>
      )}

      {intel.topPerformers.length > 0 && (
        <section className="intel-tp-preview">
          <div className="intel-group-title-row">
            <h3 className="intel-group-title">Top performers preview</h3>
            <Link
              href={`/brand/${encodeURIComponent(slug)}/ideas?packId=${encodeURIComponent(packId || data.packId || "")}&tab=top_performers`}
              className="btn-ghost btn-sm"
            >
              View all →
            </Link>
          </div>
          <div className="intel-tp-grid">
            {intel.topPerformers.map((tp) => (
              <article key={tp.id} className="intel-tp-card intel-card--hover">
                <div className="intel-tp-thumb">
                  {tp.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tp.thumbnailUrl} alt="" />
                  ) : (
                    <span className="intel-tp-thumb-placeholder">{tp.format.slice(0, 1)}</span>
                  )}
                </div>
                <div className="intel-tp-body">
                  <h4>{tp.title}</h4>
                  <span className="intel-tp-meta">
                    {tp.platform} · {tp.format}
                  </span>
                  <p>{tp.why}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {intel.deepDive.length > 0 && (
        <section className="intel-deep-dive">
          <h3 className="intel-group-title">Deep dive by topic</h3>
          <div className="intel-accordion">
            {intel.deepDive.map((group) => {
              const open = openTopic === group.topic;
              return (
                <div key={group.topic} className="intel-accordion-item">
                  <button
                    type="button"
                    className="intel-accordion-trigger"
                    aria-expanded={open}
                    onClick={() => setOpenTopic(open ? null : group.topic)}
                  >
                    {group.topic}
                    <span className="intel-group-count">{group.items.length}</span>
                  </button>
                  {open && (
                    <div className="intel-accordion-panel">
                      <InsightCards items={group.items} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="intel-generate">
        <h3>Next: pick ideas</h3>
        <p className="research-lead">
          This brief includes <strong>{data.brief?.ideasCount ?? 0} curated ideas</strong> from your research.
          Browse them, add favorites to your cart, and choose a generation style.
        </p>
        <div className="intel-generate-actions">
          <Link
            href={`/brand/${encodeURIComponent(slug)}/ideas?packId=${encodeURIComponent(packId || data.packId || "")}`}
            className="btn-primary"
          >
            Browse ideas for this brief
          </Link>
        </div>

        <details className="intel-generate-advanced">
          <summary>Generate a fresh idea set (1–3 minutes)</summary>
          <p className="section-stub-note">
            Creates a new research brief with additional ideas from the same evidence. Useful when you want more
            angles — not required if you already have enough ideas above.
          </p>
          <div className="intel-generate-options">
            <div>
              <span className="intel-generate-label">Formats</span>
              {["carousel", "video"].map((f) => (
                <label key={f} className="intel-check">
                  <input type="checkbox" checked={selectedFormats.includes(f)} onChange={() => toggleFormat(f)} />
                  {f}
                </label>
              ))}
            </div>
            <div>
              <span className="intel-generate-label">Content lens</span>
              {["niche", "product"].map((l) => (
                <label key={l} className="intel-check">
                  <input type="checkbox" checked={selectedLens.includes(l)} onChange={() => toggleLens(l)} />
                  {l}
                </label>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost"
            disabled={generating || !data.importId}
            onClick={() => void generateIdeas()}
          >
            {generating ? "Generating… (this can take a few minutes)" : "Generate new idea set"}
          </button>
          {!data.importId && (
            <p className="section-stub-note">
              This brief isn&apos;t linked to processed evidence yet — complete processing first.
            </p>
          )}
        </details>
        {genMessage && <p className="profile-editor-ok">{genMessage}</p>}
        {genMessage && (
          <Link
            href={`/brand/${encodeURIComponent(slug)}/ideas?packId=${encodeURIComponent(packId || data.packId || "")}`}
            className="btn-ghost btn-sm"
          >
            Go to ideas →
          </Link>
        )}
      </section>

      {error && <p className="workspace-error">{error}</p>}
    </div>
  );
}
