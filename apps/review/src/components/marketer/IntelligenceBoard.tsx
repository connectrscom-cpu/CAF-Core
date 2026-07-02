"use client";

import { ReviewNavLink } from "@/components/ReviewNavLink";
import { useCallback, useEffect, useRef, useState } from "react";
import { IntelEvidenceModal } from "@/components/marketer/IntelEvidenceModal";
import { IntelFormatExplorer } from "@/components/marketer/IntelFormatExplorer";
import { useSyncCartBriefPack } from "@/components/marketer/ContentCartContext";
import { useReviewProject } from "@/components/ReviewProjectContext";
import type { MarketIntelligenceView, FormatGroupExample } from "@/lib/marketer/market-intelligence-adapters";
import {
  insightHasInspectableEvidence,
  resolveCompetitorThumbnail,
  resolveEvidencePostsForInsight,
  statBucketToInsight,
} from "@/lib/marketer/intel-evidence";
import { formatResearchPlatformLabels } from "@/lib/marketer/research-notes";
import { useAbortableLoad } from "@/lib/marketer/use-abortable-load";
import type { HashtagInsight, IntelEvidencePost, MarketInsight, ResearchBrief } from "@/lib/marketer/types";
import { PreviewMediaCard } from "@/components/marketer/PreviewMediaCard";
import { pickRenderableThumb } from "@/lib/marketer/inspection-media";
import { contentPreviewMissing, contentPreviewReady } from "@/lib/marketer/preview-resolver";

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
  evidencePosts?: IntelEvidencePost[];
}

function IntelInspectButton({
  label = "Inspect evidence",
  onClick,
  disabled,
}: {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="intel-inspect-btn btn-ghost btn-sm" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

function InsightCards({
  items,
  empty,
  structured,
  evidencePosts,
  onInspect,
}: {
  items: MarketInsight[];
  empty?: string;
  structured?: boolean;
  evidencePosts: IntelEvidencePost[];
  onInspect: (insight: MarketInsight, posts: IntelEvidencePost[]) => void;
}) {
  if (!items.length) {
    return empty ? <p className="intel-empty-note">{empty}</p> : null;
  }
  return (
    <div className={structured ? "intel-pattern-list" : "intel-cards"}>
      {items.map((ins) => {
        const posts = resolveEvidencePostsForInsight(ins, evidencePosts);
        const canInspect = posts.length > 0 || insightHasInspectableEvidence(ins, evidencePosts);
        return (
          <article key={ins.id} className={`intel-card intel-card--hover${structured ? " intel-card--structured" : ""}`}>
            <h4>{ins.title}</h4>
            {ins.summary && <p>{ins.summary}</p>}
            {ins.actionable && (
              <p className="intel-actionable">
                <strong>Apply:</strong> {ins.actionable}
              </p>
            )}
            <div className="intel-card-footer">
              <div className="intel-card-meta">
                {ins.evidenceCount > 0 && (
                  <span>
                    {ins.evidenceCount} {ins.evidenceCount === 1 ? "post" : "posts"}
                  </span>
                )}
                {ins.confidence != null && <span>{Math.round(ins.confidence * 100)}% pattern strength</span>}
              </div>
              {canInspect ? (
                <IntelInspectButton onClick={() => onInspect(ins, posts)} />
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function IntelligenceBoard({ slug, initialPackId }: IntelligenceBoardProps) {
  const { navHref } = useReviewProject();
  const [data, setData] = useState<IntelligenceResponse | null>(null);
  const [packId, setPackId] = useState(initialPackId ?? "");
  useSyncCartBriefPack(packId || null);
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [selectedFormats, setSelectedFormats] = useState<string[]>(["carousel", "video"]);
  const [selectedLens, setSelectedLens] = useState<string[]>(["niche", "product"]);
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const packIdRef = useRef(packId);
  packIdRef.current = packId;
  const [evidenceModal, setEvidenceModal] = useState<{
    title: string;
    subtitle?: string;
    posts: IntelEvidencePost[];
  } | null>(null);

  const evidencePosts = data?.evidencePosts ?? [];

  useEffect(() => {
    if (initialPackId != null) setPackId(initialPackId);
  }, [initialPackId]);

  const openEvidence = useCallback(
    (insight: MarketInsight, resolved?: IntelEvidencePost[]) => {
      const posts =
        resolved && resolved.length > 0 ? resolved : resolveEvidencePostsForInsight(insight, evidencePosts);
      setEvidenceModal({
        title: insight.title,
        subtitle: insight.summary,
        posts,
      });
    },
    [evidencePosts]
  );

  const openFormatExample = useCallback(
    (example: FormatGroupExample) => {
      const matched = evidencePosts.filter((p) => p.insightsId === example.insightsId);
      if (matched.length) {
        setEvidenceModal({
          title: example.title,
          subtitle: `${example.platform} · example post`,
          posts: matched,
        });
        return;
      }
      if (example.postUrl) {
        window.open(example.postUrl, "_blank", "noopener,noreferrer");
        return;
      }
      setEvidenceModal({
        title: example.title,
        subtitle: "Example from your research brief",
        posts: [
          {
            insightsId: example.insightsId,
            title: example.title,
            hookText: null,
            platform: example.platform,
            format: example.isVideo ? "Video" : "Carousel",
            postUrl: example.postUrl,
            thumbnailUrl: example.thumbnailUrl,
            customLabel1: null,
            customLabel2: null,
            customLabel3: null,
            primaryEmotion: null,
            hookType: null,
            hashtags: null,
          },
        ],
      });
    },
    [evidencePosts]
  );

  const inspectStat = useCallback(
    (insight: MarketInsight) => {
      openEvidence(insight);
    },
    [openEvidence]
  );

  const load = useCallback(
    async (signal: AbortSignal) => {
      const qs = packIdRef.current ? `?packId=${encodeURIComponent(packIdRef.current)}` : "";
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/intelligence${qs}`, { signal });
      if (!res.ok) throw new Error("Failed to load intelligence");
      const j = (await res.json()) as IntelligenceResponse;
      if (signal.aborted) return;
      setData(j);
      if (!packIdRef.current && j.packId) setPackId(j.packId);
    },
    [slug]
  );

  const { loading, error, setError } = useAbortableLoad([slug, packId], load);

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
      intel.summaryBullets.length > 0 ||
      intel.marketOverview ||
      intel.whatWorked ||
      intel.competitiveLandscape);

  if (!data || !hasContent) {
    return (
      <div className="workspace-empty">
        <h3>No intelligence yet</h3>
        <p>
          Once research is analyzed into a signal pack, CAF surfaces winning patterns, hooks, hashtags, and format
          takeaways here.
        </p>
        <div className="section-stub-actions">
          <ReviewNavLink href={navHref(`/brand/${encodeURIComponent(slug)}/research`)} className="btn-primary">
            Start market research
          </ReviewNavLink>
        </div>
      </div>
    );
  }

  const briefSubtitle = [
    data.brief?.createdAt ? new Date(data.brief.createdAt).toLocaleDateString() : null,
    data.brief?.sourceWindow,
    data.brief?.platforms?.length ? formatResearchPlatformLabels(data.brief.platforms) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const hashtags = intel.hashtags.length ? intel.hashtags : data.hashtags;
  const showAvgScore = hashtags.some((t) => t.avgScore != null);
  const resolvedPackId = packId || data.packId || "";
  const topPerformersIdeasHref = navHref(
    resolvedPackId
      ? `/brand/${encodeURIComponent(slug)}/ideas?packId=${encodeURIComponent(resolvedPackId)}&tab=top_performers`
      : `/brand/${encodeURIComponent(slug)}/ideas?tab=top_performers`
  );

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

      {intel.researchBriefTitle && (
        <header className="intel-brief-header">
          <h2>{intel.researchBriefTitle}</h2>
          {briefSubtitle && <p className="intel-brief-sub">{briefSubtitle}</p>}
        </header>
      )}

      {intel.marketOverview && (
        <section className="intel-hero">
          <h3 className="intel-group-title">Market landscape</h3>
          <p className="intel-hero-text">{intel.marketOverview}</p>
        </section>
      )}

      {intel.whatWorked && (
        <section className="intel-hero intel-hero--secondary">
          <h3 className="intel-group-title">What worked</h3>
          <p className="intel-hero-text">{intel.whatWorked}</p>
        </section>
      )}

      {intel.competitiveLandscape && (
        <section className="intel-competitive">
          <h3 className="intel-group-title">Competitive landscape</h3>
          <p className="intel-hero-text">{intel.competitiveLandscape.overview}</p>
          <div className="intel-brand-grid">
            {intel.competitiveLandscape.brands.map((brand) => {
              const previewUrl = resolveCompetitorThumbnail(brand, evidencePosts);
              return (
              <article key={brand.handle} className="intel-brand-card intel-card--hover">
                <PreviewMediaCard
                  preview={
                    previewUrl
                      ? contentPreviewReady(previewUrl, { kind: "reference" })
                      : contentPreviewMissing("reference")
                  }
                  alt={brand.handle}
                  variant="card"
                  className="intel-brand-card__preview"
                />
                <div className="intel-brand-head">
                  <h4>{brand.handle}</h4>
                  <span className="intel-tp-meta">
                    {brand.platform}
                    {brand.postCount > 0 ? ` · ${brand.postCount} posts in brief` : ""}
                  </span>
                </div>
                <ul className="intel-brand-moves">
                  {brand.signatureMoves.map((move) => (
                    <li key={move.slice(0, 40)}>{move}</li>
                  ))}
                </ul>
                {brand.standoutExample && (
                  <p className="intel-brand-example">
                    <strong>Example:</strong> {brand.standoutExample}
                  </p>
                )}
              </article>
              );
            })}
          </div>
        </section>
      )}

      {intel.actionPlaybook && intel.actionPlaybook.length > 0 && (
        <section className="intel-playbook">
          <h3 className="intel-group-title">This week&apos;s playbook</h3>
          <ol className="intel-playbook-list">
            {intel.actionPlaybook.map((step) => (
              <li key={step.slice(0, 40)}>{step}</li>
            ))}
          </ol>
        </section>
      )}

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
        <IntelFormatExplorer
          mediaLanes={intel.mediaLanes}
          evidencePosts={evidencePosts}
          onSelectExample={openFormatExample}
        />
      )}

      {intel.researchStats && (intel.researchStats.formats.length > 0 || intel.researchStats.emotions.length > 0) && (
        <section className="intel-stats-row">
          <h3 className="intel-group-title">Research snapshot</h3>
          <div className="intel-stats-grid">
            {intel.researchStats.formats.length > 0 && (
              <div className="intel-stat-block">
                <h4>Formats</h4>
                <ul>
                  {intel.researchStats.formats.map((f) => (
                    <li key={f.key} className="intel-stat-row">
                      <span>{f.key.replace(/_/g, " ")}</span>
                      <div className="intel-stat-row-actions">
                        <strong>{f.count}</strong>
                        <IntelInspectButton
                          label="Inspect"
                          onClick={() =>
                            inspectStat(statBucketToInsight(f, { kind: "format", key: f.key }, f.key.replace(/_/g, " ")))
                          }
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {intel.researchStats.emotions.length > 0 && (
              <div className="intel-stat-block">
                <h4>Emotions</h4>
                <ul>
                  {intel.researchStats.emotions.map((e) => (
                    <li key={e.key} className="intel-stat-row">
                      <span>{e.key}</span>
                      <div className="intel-stat-row-actions">
                        <strong>{e.count}</strong>
                        <IntelInspectButton
                          label="Inspect"
                          onClick={() => inspectStat(statBucketToInsight(e, { kind: "emotion", key: e.key }, e.key))}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {intel.researchStats.hookTypes.length > 0 && (
              <div className="intel-stat-block">
                <h4>Hook types</h4>
                <ul>
                  {intel.researchStats.hookTypes.map((h) => (
                    <li key={h.key} className="intel-stat-row">
                      <span>{h.key.replace(/_/g, " ")}</span>
                      <div className="intel-stat-row-actions">
                        <strong>{h.count}</strong>
                        <IntelInspectButton
                          label="Inspect"
                          onClick={() =>
                            inspectStat(
                              statBucketToInsight(h, { kind: "hook_type", key: h.key }, h.key.replace(/_/g, " "))
                            )
                          }
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {intel.customLabelStats && intel.customLabelStats.length > 0 && (
        <section className="intel-custom-labels">
          <h3 className="intel-group-title">Custom insight columns</h3>
          <p className="intel-custom-labels-note">
            Values your operator tagged during research — use these to spot recurring themes and segment winners.
          </p>
          <div className="intel-hashtag-table-wrap">
            <table className="intel-hashtag-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Value</th>
                  <th>Posts</th>
                  <th>Share</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {intel.customLabelStats.map((row) => (
                  <tr key={`${row.slot}-${row.value}`}>
                    <td>{row.columnLabel}</td>
                    <td>{row.value}</td>
                    <td>{row.count}</td>
                    <td>{row.sharePct}%</td>
                    <td>
                      <IntelInspectButton
                        label="Inspect"
                        onClick={() =>
                          inspectStat(
                            statBucketToInsight(
                              { key: row.value, count: row.count },
                              { kind: "custom_label", slot: row.slot, key: row.value },
                              row.value
                            )
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {intel.winningPatterns.length > 0 && (
        <section className="intel-group">
          <h3 className="intel-group-title">
            Winning patterns
            <span className="intel-group-count">{intel.winningPatterns.length}</span>
          </h3>
          <InsightCards
            items={intel.winningPatterns}
            structured
            evidencePosts={evidencePosts}
            onInspect={openEvidence}
          />
        </section>
      )}

      {(intel.hooksDigest?.hooks.length || intel.hooks.length > 0) && (
        <section className="intel-group intel-hooks">
          <h3 className="intel-group-title">Hooks &amp; word choice</h3>
          {intel.hooksDigest?.keyTakeaways.length ? (
            <div className="intel-hooks-takeaways">
              <h4>Key takeaways</h4>
              <ul>
                {intel.hooksDigest.keyTakeaways.map((t) => (
                  <li key={t.slice(0, 40)}>{t}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="intel-hook-list-wrap">
            <h4>Proven hooks in this brief</h4>
            <ul className="intel-hook-list">
              {(intel.hooksDigest?.hooks.length ? intel.hooksDigest.hooks : intel.hooks.map((h) => h.title.replace(/^Hook:\s*/i, ""))).map(
                (hook) => (
                  <li key={hook.slice(0, 60)}>&ldquo;{hook}&rdquo;</li>
                )
              )}
            </ul>
          </div>
          {intel.hooks.length > 0 ? (
            <InsightCards items={intel.hooks} evidencePosts={evidencePosts} onInspect={openEvidence} />
          ) : null}
        </section>
      )}

      {intel.emotions.length > 0 && (
        <section className="intel-group">
          <h3 className="intel-group-title">
            Emotions that resonate
            <span className="intel-group-count">{intel.emotions.length}</span>
          </h3>
          <InsightCards items={intel.emotions} evidencePosts={evidencePosts} onInspect={openEvidence} />
        </section>
      )}

      {intel.topics.length > 0 && (
        <section className="intel-group">
          <h3 className="intel-group-title">Topics &amp; themes</h3>
          <InsightCards items={intel.topics} evidencePosts={evidencePosts} onInspect={openEvidence} />
        </section>
      )}

      {hashtags.length > 0 && (
        <details className="intel-hashtags intel-hashtags--collapsible">
          <summary className="intel-group-title intel-hashtags-summary">
            Hashtags
            <span className="intel-group-count">{hashtags.length}</span>
          </summary>
          <div className="intel-hashtag-table-wrap">
            <table className="intel-hashtag-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Uses</th>
                  {showAvgScore && <th>Avg score</th>}
                  <th>Share</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hashtags.map((t) => (
                  <tr key={t.hashtag}>
                    <td>{t.hashtag}</td>
                    <td>{t.count}</td>
                    {showAvgScore && <td>{t.avgScore != null ? t.avgScore.toFixed(2) : "—"}</td>}
                    <td>{t.sharePct != null ? `${t.sharePct}%` : "—"}</td>
                    <td>
                      <IntelInspectButton
                        label="Inspect"
                        onClick={() =>
                          inspectStat(
                            statBucketToInsight(
                              { key: t.hashtag, count: t.count },
                              { kind: "hashtag", key: t.hashtag },
                              t.hashtag
                            )
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {intel.visualPatterns.length > 0 && (
        <section className="intel-group">
          <h3 className="intel-group-title">Visual patterns</h3>
          <InsightCards items={intel.visualPatterns} evidencePosts={evidencePosts} onInspect={openEvidence} />
        </section>
      )}

      {intel.opportunities.length > 0 && (
        <section className="intel-group">
          <h3 className="intel-group-title">Opportunities</h3>
          <InsightCards items={intel.opportunities} evidencePosts={evidencePosts} onInspect={openEvidence} />
        </section>
      )}

      {intel.avoid.length > 0 && (
        <section className="intel-group intel-avoid">
          <h3 className="intel-group-title">
            What to avoid
            <span className="intel-group-count">{intel.avoid.length}</span>
          </h3>
          <InsightCards items={intel.avoid} structured evidencePosts={evidencePosts} onInspect={openEvidence} />
        </section>
      )}

      {intel.topPerformers.length > 0 && (
        <section className="intel-tp-preview">
          <div className="intel-group-title-row">
            <h3 className="intel-group-title">Top performers preview</h3>
            <ReviewNavLink href={topPerformersIdeasHref} className="btn-ghost btn-sm">
              View all →
            </ReviewNavLink>
          </div>
          <div className="intel-tp-grid">
            {intel.topPerformers.map((tp) => (
              <article key={tp.id} className="intel-tp-card intel-card--hover">
                <PreviewMediaCard
                  preview={
                    (() => {
                      const thumb = pickRenderableThumb(tp.thumbnailUrl);
                      return thumb
                        ? contentPreviewReady(thumb, { kind: "reference" })
                        : contentPreviewMissing("reference");
                    })()
                  }
                  alt={tp.title}
                  variant="card"
                />
                <div className="intel-tp-body">
                  <h4>{tp.title}</h4>
                  <span className="intel-tp-meta">
                    {tp.platform} · {tp.format}
                  </span>
                  <p>{tp.why}</p>
                  {tp.postUrl && (
                    <a href={tp.postUrl} target="_blank" rel="noopener noreferrer" className="intel-evidence-link">
                      View on Instagram →
                    </a>
                  )}
                  {tp.applyThis && <p className="intel-tp-apply"><strong>Apply:</strong> {tp.applyThis}</p>}
                  <IntelInspectButton
                    label="Inspect evidence"
                    onClick={() =>
                      openEvidence({
                        id: tp.id,
                        category: "winning_pattern",
                        title: tp.title,
                        summary: tp.why,
                        evidenceCount: 1,
                        confidence: null,
                        sourceInsightIds: [tp.id],
                        evidenceUrls: tp.postUrl ? [tp.postUrl] : undefined,
                      })
                    }
                  />
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
                      <InsightCards
                        items={group.items}
                        evidencePosts={evidencePosts}
                        onInspect={openEvidence}
                      />
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
          <ReviewNavLink
            href={navHref(
              `/brand/${encodeURIComponent(slug)}/ideas?packId=${encodeURIComponent(packId || data.packId || "")}`
            )}
            className="btn-primary"
          >
            Browse ideas for this brief
          </ReviewNavLink>
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
          <ReviewNavLink
            href={navHref(
              `/brand/${encodeURIComponent(slug)}/ideas?packId=${encodeURIComponent(packId || data.packId || "")}`
            )}
            className="btn-ghost btn-sm"
          >
            Go to ideas →
          </ReviewNavLink>
        )}
      </section>

      {error && <p className="workspace-error">{error}</p>}

      <IntelEvidenceModal
        open={evidenceModal != null}
        title={evidenceModal?.title ?? "Evidence"}
        subtitle={evidenceModal?.subtitle}
        posts={evidenceModal?.posts ?? []}
        onClose={() => setEvidenceModal(null)}
      />
    </div>
  );
}
