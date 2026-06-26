"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useContentCart } from "@/components/marketer/ContentCartContext";
import { GENERATION_STRATEGY_OPTIONS } from "@/lib/marketer/generation-strategy";
import type {
  ContentIdea,
  GenerationStrategy,
  IdeaStatus,
  ResearchBrief,
  TopPerformerRef,
} from "@/lib/marketer/types";

interface IdeasBoardProps {
  slug: string;
}

interface IdeasResponse {
  ideas: ContentIdea[];
  topPerformers: TopPerformerRef[];
  packId: string | null;
  briefs: ResearchBrief[];
  sourceWindow?: string | null;
}

const LOCAL_KEY = (slug: string) => `caf-review-idea-states-${slug}`;

type LocalState = Record<string, { status: IdeaStatus; strategy?: GenerationStrategy }>;

type MainTab = "new_content" | "top_performers";
type FormatTab = "all" | "carousel" | "video" | "product" | "niche";

function readLocal(slug: string): LocalState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY(slug)) ?? "{}") as LocalState;
  } catch {
    return {};
  }
}

function writeLocal(slug: string, state: LocalState) {
  try {
    localStorage.setItem(LOCAL_KEY(slug), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

const MIMIC_EXPLAIN: Record<TopPerformerRef["mimicKind"], string> = {
  replica:
    "Replica mimic — closely follows the visual layout and style of the reference. Best when the format itself is the insight.",
  why_carousel:
    "Why mimic — recreates the strategic argument and slide structure, translated for your brand. Best when the idea matters more than pixel-perfect layout.",
  video: "Video mimic — routes to the right HeyGen lane based on the reference format.",
  image: "Image mimic — single-frame visual reference replication.",
};

export function IdeasBoard({ slug }: IdeasBoardProps) {
  const searchParams = useSearchParams();
  const initialPack = searchParams.get("packId");
  const initialTab = searchParams.get("tab");

  const cart = useContentCart();
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [topPerformers, setTopPerformers] = useState<TopPerformerRef[]>([]);
  const [briefs, setBriefs] = useState<ResearchBrief[]>([]);
  const [packId, setPackId] = useState<string>(initialPack ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalState>({});
  const [mainTab, setMainTab] = useState<MainTab>(
    initialTab === "top_performers" ? "top_performers" : "new_content"
  );
  const [formatTab, setFormatTab] = useState<FormatTab>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tpMimic, setTpMimic] = useState<Record<string, "replica" | "why_carousel">>({});
  const [tpRender, setTpRender] = useState<Record<string, "full_bleed" | "template">>({});

  useEffect(() => {
    setLocal(readLocal(slug));
  }, [slug]);

  const load = useCallback(async () => {
    setError(null);
    const qs = new URLSearchParams();
    if (packId) qs.set("packId", packId);
    else qs.set("packId", "all");
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/ideas?${qs}`);
      if (!res.ok) throw new Error("Failed to load ideas");
      const j = (await res.json()) as IdeasResponse;
      setIdeas(j.ideas ?? []);
      setTopPerformers(j.topPerformers ?? []);
      setBriefs(j.briefs ?? []);
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

  function statusOf(idea: ContentIdea): IdeaStatus {
    return local[idea.id]?.status ?? idea.status;
  }

  function setStatus(idea: ContentIdea, status: IdeaStatus) {
    setLocal((prev) => {
      const next = { ...prev, [idea.id]: { ...prev[idea.id], status } };
      writeLocal(slug, next);
      return next;
    });
  }

  function setStrategy(idea: ContentIdea, strategy: GenerationStrategy) {
    setLocal((prev) => {
      const next = {
        ...prev,
        [idea.id]: { status: prev[idea.id]?.status ?? statusOf(idea), strategy },
      };
      writeLocal(slug, next);
      return next;
    });
  }

  const filteredIdeas = useMemo(() => {
    let list = ideas;
    if (formatTab === "carousel") list = list.filter((i) => i.format === "carousel");
    else if (formatTab === "video") list = list.filter((i) => i.format === "video");
    else if (formatTab === "product") list = list.filter((i) => i.contentLens === "product");
    else if (formatTab === "niche") list = list.filter((i) => i.contentLens === "niche");
    return list;
  }, [ideas, formatTab]);

  const selectedCount = ideas.filter((i) => statusOf(i) === "selected").length;

  if (loading) return <p className="workspace-muted">Loading ideas…</p>;
  if (error) return <p className="workspace-error">{error}</p>;

  const empty = mainTab === "new_content" ? ideas.length === 0 : topPerformers.length === 0;

  if (empty && !briefs.length) {
    return (
      <div className="workspace-empty">
        <h3>No ideas yet</h3>
        <p>Once research is processed into a brief, CAF will recommend content ideas here.</p>
        <Link href={`/brand/${encodeURIComponent(slug)}/research`} className="btn-primary">
          Start market research
        </Link>
      </div>
    );
  }

  return (
    <div className="ideas-board">

      <div className="ideas-toolbar ideas-toolbar--stacked">
        <div className="ideas-main-tabs">
          <button
            type="button"
            className={`ideas-main-tab ${mainTab === "new_content" ? "active" : ""}`}
            onClick={() => setMainTab("new_content")}
          >
            New content
            <span className="ideas-tab-count">{ideas.length}</span>
          </button>
          <button
            type="button"
            className={`ideas-main-tab ${mainTab === "top_performers" ? "active" : ""}`}
            onClick={() => setMainTab("top_performers")}
          >
            Top performers
            <span className="ideas-tab-count">{topPerformers.length}</span>
          </button>
        </div>

        <div className="ideas-toolbar-row">
          <label className="intel-pack-select">
            <span>Research context</span>
            <select
              value={packId || "all"}
              onChange={(e) => setPackId(e.target.value === "all" ? "all" : e.target.value)}
            >
              <option value="all">All research briefs</option>
              {briefs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          {cart.count > 0 && (
            <button type="button" className="btn-primary btn-sm" onClick={() => cart.setDrawerOpen(true)}>
              Cart ({cart.count})
            </button>
          )}
        </div>

        {mainTab === "new_content" && (
          <div className="ideas-format-tabs">
            {(
              [
                ["all", "All"],
                ["carousel", "Carousels"],
                ["video", "Videos"],
                ["product", "Product"],
                ["niche", "Niche"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`ideas-format-tab ${formatTab === key ? "active" : ""}`}
                onClick={() => setFormatTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {mainTab === "new_content" && (
          <span className="ideas-count">
            {filteredIdeas.length} ideas · {selectedCount} selected
          </span>
        )}
      </div>

      {mainTab === "top_performers" ? (
        <div className="ideas-tp-section">
          <p className="ideas-tp-intro">
            High-performing references from your research. Pick replica vs why mimic and carousel render mode, then add
            to your cart.
          </p>
          <div className="ideas-tp-grid">
            {topPerformers.map((tp) => {
              const mimic = tpMimic[tp.id] ?? (tp.mimicKind === "why_carousel" ? "why_carousel" : "replica");
              const render = tpRender[tp.id] ?? "full_bleed";
              const isCarousel = tp.format.toLowerCase().includes("carousel") || tp.mimicKind === "replica";
              return (
                <article key={tp.id} className="idea-tp-card intel-card--hover">
                  <div className="idea-tp-thumb">
                    {tp.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={tp.thumbnailUrl} alt="" />
                    ) : (
                      <span className="intel-tp-thumb-placeholder">{tp.format.slice(0, 1)}</span>
                    )}
                  </div>
                  <div className="idea-tp-body">
                    <h3>{tp.title}</h3>
                    <span className="idea-tp-meta">
                      {tp.platform} · {tp.format}
                    </span>
                    <p>{MIMIC_EXPLAIN[tp.mimicKind]}</p>
                    <div className="content-cart-radio-group">
                      <label>
                        <input
                          type="radio"
                          name={`tp-mimic-${tp.id}`}
                          checked={mimic === "replica"}
                          onChange={() => setTpMimic((p) => ({ ...p, [tp.id]: "replica" }))}
                        />
                        Replica
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`tp-mimic-${tp.id}`}
                          checked={mimic === "why_carousel"}
                          onChange={() => setTpMimic((p) => ({ ...p, [tp.id]: "why_carousel" }))}
                        />
                        Why mimic
                      </label>
                    </div>
                    {isCarousel && (
                      <div className="content-cart-radio-group">
                        <label>
                          <input
                            type="radio"
                            name={`tp-render-${tp.id}`}
                            checked={render === "full_bleed"}
                            onChange={() => setTpRender((p) => ({ ...p, [tp.id]: "full_bleed" }))}
                          />
                          Full bleed
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`tp-render-${tp.id}`}
                            checked={render === "template"}
                            onChange={() => setTpRender((p) => ({ ...p, [tp.id]: "template" }))}
                          />
                          Template
                        </label>
                      </div>
                    )}
                    <div className="idea-tp-actions">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() =>
                          cart.addTopPerformer({
                            id: `tp_${tp.id}`,
                            title: tp.title,
                            flowDestination:
                              mimic === "why_carousel" ? "Why mimic carousel" : "Top performer mimic",
                            flowTypeRaw:
                              mimic === "why_carousel"
                                ? "FLOW_WHY_MIMIC_CAROUSEL"
                                : "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
                            mimicMode: mimic,
                            renderMode: isCarousel ? render : undefined,
                          })
                        }
                      >
                        Add to cart
                      </button>
                      {tp.postUrl && (
                        <a href={tp.postUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">
                          View post
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {topPerformers.length === 0 && (
            <div className="workspace-empty workspace-empty--compact">
              <p>No top performers in this research brief yet.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="ideas-tile-grid">
          {filteredIdeas.map((idea) => {
            const expanded = expandedId === idea.id;
            const status = statusOf(idea);
            const strategy = local[idea.id]?.strategy;
            return (
              <article
                key={idea.id}
                className={`idea-tile ${expanded ? "idea-tile--expanded" : ""} idea-card--${status}`}
              >
                <button
                  type="button"
                  className="idea-tile-head"
                  onClick={() => setExpandedId(expanded ? null : idea.id)}
                >
                  <div className="idea-tile-badges">
                    <span className="idea-format-badge">{idea.suggestedFormat}</span>
                    <span className="idea-flow-badge">{idea.flowType}</span>
                  </div>
                  <h3 className="idea-tile-title">{idea.title}</h3>
                </button>

                {expanded && (
                  <div className="idea-tile-body">
                    {idea.concept && <p className="idea-concept">{idea.concept}</p>}
                    {idea.rationale && (
                      <p className="idea-rationale">
                        <span className="idea-rationale-label">Why now</span> {idea.rationale}
                      </p>
                    )}
                    {idea.keyPoints.length > 0 && (
                      <ul className="idea-points">
                        {idea.keyPoints.slice(0, 4).map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    )}
                    {status === "selected" && (
                      <div className="idea-strategy">
                        <label>Generation strategy</label>
                        <select
                          value={strategy ?? "caf_recommended"}
                          onChange={(e) => setStrategy(idea, e.target.value as GenerationStrategy)}
                        >
                          {GENERATION_STRATEGY_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="idea-actions">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() =>
                          cart.addIdea({
                            id: `idea_${idea.id}`,
                            title: idea.title,
                            flowDestination: idea.flowType,
                            flowTypeRaw: idea.targetFlowType,
                          })
                        }
                      >
                        Add to cart
                      </button>
                      {status === "selected" ? (
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setStatus(idea, "new")}>
                          Unselect
                        </button>
                      ) : (
                        <>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setStatus(idea, "selected")}>
                            Select
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setStatus(idea, "rejected")}>
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {mainTab === "new_content" && filteredIdeas.length === 0 && ideas.length > 0 && (
        <p className="workspace-muted">No ideas match this tab.</p>
      )}

      {selectedCount > 0 && mainTab === "new_content" && (
        <div className="ideas-footer">
          <p>
            <strong>{selectedCount}</strong> idea{selectedCount === 1 ? "" : "s"} selected — add them to your cart to
            prepare a content run.
          </p>
        </div>
      )}
    </div>
  );
}
