"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useContentCart, useSyncCartBriefPack } from "@/components/marketer/ContentCartContext";
import { useReviewProject } from "@/components/ReviewProjectContext";
import { useAbortableLoad } from "@/lib/marketer/use-abortable-load";
import { PreviewMediaCard } from "@/components/marketer/PreviewMediaCard";
import { contentPreviewMissing } from "@/lib/marketer/preview-resolver";
import {
  filterGenerationStrategiesByEnabledFlows,
} from "@/lib/marketer/generation-strategy";
import { resolveCartFlowForIdea } from "@/lib/marketer/cart-flow-resolve";
import { filterResearchBriefsByPlatform } from "@/lib/marketer/research-adapters";
import { ResearchBriefPlatformFilter } from "@/components/marketer/ResearchBriefPlatformFilter";
import {
  flowTypeForVideoIntent,
  labelForVideoIntent,
  resolveRecommendedVideoIntent,
  VIDEO_LANE_OPTIONS,
  type VideoPipelineIntent,
} from "@/lib/marketer/video-lane";
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
  packIdStale?: boolean;
}

const LOCAL_KEY = (slug: string) => `caf-review-idea-states-${slug}`;

type LocalState = Record<string, { status: IdeaStatus; strategy?: GenerationStrategy; useBvs?: boolean }>;

type MainTab = "new_content" | "top_performers";
type LensTab = "niche" | "product";
type FormatTab = "all" | "new_visual" | "carousel" | "video";

function matchesLens(idea: ContentIdea, lens: LensTab): boolean {
  if (lens === "product") return idea.contentLens === "product";
  return idea.contentLens === "niche" || idea.contentLens == null;
}

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

function mainTabFromParam(tab: string | null): MainTab {
  return tab === "top_performers" ? "top_performers" : "new_content";
}

export function IdeasBoard({ slug }: IdeasBoardProps) {
  const searchParams = useSearchParams();
  const { navHref } = useReviewProject();
  const packFromUrl = searchParams.get("packId");
  const tabFromUrl = mainTabFromParam(searchParams.get("tab"));

  const cart = useContentCart();
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [topPerformers, setTopPerformers] = useState<TopPerformerRef[]>([]);
  const [briefs, setBriefs] = useState<ResearchBrief[]>([]);
  const [packId, setPackId] = useState<string>(packFromUrl ?? "");
  useSyncCartBriefPack(packId && packId !== "all" ? packId : null);
  const [local, setLocal] = useState<LocalState>({});
  const [mainTab, setMainTab] = useState<MainTab>(tabFromUrl);
  const [lensTab, setLensTab] = useState<LensTab>("niche");
  const [formatTab, setFormatTab] = useState<FormatTab>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tpMimic, setTpMimic] = useState<Record<string, "replica" | "why_carousel">>({});
  const [tpRender, setTpRender] = useState<Record<string, "full_bleed" | "template">>({});
  const [tpVideoLane, setTpVideoLane] = useState<Record<string, VideoPipelineIntent>>({});
  const [staleBriefNotice, setStaleBriefNotice] = useState(false);
  const [queueHint, setQueueHint] = useState<string | null>(null);
  const [briefPlatformFilter, setBriefPlatformFilter] = useState("all");
  const [enabledFlowTypes, setEnabledFlowTypes] = useState<string[]>([]);
  const packIdRef = useRef(packId);
  packIdRef.current = packId;

  const strategyOptions = useMemo(
    () => filterGenerationStrategiesByEnabledFlows(enabledFlowTypes),
    [enabledFlowTypes]
  );

  useEffect(() => {
    setLocal(readLocal(slug));
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/brand/${encodeURIComponent(slug)}/content-routes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.lanes) return;
        const flows = new Set<string>();
        for (const lane of j.lanes as Array<{ enabled: boolean; flow_types: string[] }>) {
          if (!lane.enabled) continue;
          for (const ft of lane.flow_types ?? []) flows.add(ft);
        }
        setEnabledFlowTypes([...flows]);
      })
      .catch(() => {
        if (!cancelled) setEnabledFlowTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Sync from external links (e.g. View all →) without router.replace — avoids Next.js nav deadlocks.
  useEffect(() => {
    if (packFromUrl != null) setPackId(packFromUrl);
    setMainTab(tabFromUrl);
  }, [packFromUrl, tabFromUrl]);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const qs = new URLSearchParams();
      const pid = packIdRef.current;
      // Default to latest brief (omit packId) — avoid hydrating every pack on first paint.
      if (pid) qs.set("packId", pid);
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/ideas?${qs}`, { signal });
      if (!res.ok) throw new Error("Failed to load ideas");
      const j = (await res.json()) as IdeasResponse;
      if (signal.aborted) return;
      setIdeas(j.ideas ?? []);
      setTopPerformers(j.topPerformers ?? []);
      setBriefs(j.briefs ?? []);

      if (j.packIdStale && pid && pid !== "all") {
        setStaleBriefNotice(true);
        cart.detachBriefPackId();
        const fallback = j.briefs?.[0]?.id ?? "";
        setPackId(fallback);
        if (fallback) cart.attachBriefPackId(fallback, { keepItems: true });
      } else {
        setStaleBriefNotice(false);
        if (!pid && j.packId) setPackId(j.packId);
      }
    },
    [slug, cart]
  );

  const { loading, error } = useAbortableLoad([slug, packId], load);

  const filteredBriefs = useMemo(
    () => filterResearchBriefsByPlatform(briefs, briefPlatformFilter),
    [briefs, briefPlatformFilter]
  );

  useEffect(() => {
    if (packId && packId !== "all" && !filteredBriefs.some((b) => b.id === packId)) {
      setPackId(filteredBriefs[0]?.id ?? "all");
    }
  }, [filteredBriefs, packId]);

  function resolveQueuePackId(): string | null {
    if (packId && packId !== "all") return packId;
    if (cart.briefPackId) return cart.briefPackId;
    return briefs[0]?.id ?? null;
  }

  function queueNeedsBriefMessage(): string {
    return "Select a research brief in Research context before queueing for generation.";
  }

  function queueForGeneration(run: () => boolean) {
    setQueueHint(null);
    const ok = run();
    if (!ok) setQueueHint(queueNeedsBriefMessage());
  }

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

  const nicheCount = useMemo(() => ideas.filter((i) => matchesLens(i, "niche")).length, [ideas]);
  const productCount = useMemo(() => ideas.filter((i) => matchesLens(i, "product")).length, [ideas]);

  const ideasInLens = useMemo(
    () => ideas.filter((i) => matchesLens(i, lensTab)),
    [ideas, lensTab]
  );

  const filteredIdeas = useMemo(() => {
    let list = ideasInLens;
    if (formatTab === "new_visual") list = list.filter((i) => i.isNewVisualCarousel);
    else if (formatTab === "carousel")
      list = list.filter((i) => i.format === "carousel" && !i.isNewVisualCarousel);
    else if (formatTab === "video") list = list.filter((i) => i.format === "video");

    if (enabledFlowTypes.length === 0) return list;
    const enabled = new Set(enabledFlowTypes);
    return list.filter((idea) => {
      const resolved = resolveCartFlowForIdea(idea, "caf_recommended");
      return enabled.has(resolved.flowTypeRaw);
    });
  }, [ideasInLens, formatTab, enabledFlowTypes]);

  const formatCounts = useMemo(
    () => ({
      all: ideasInLens.length,
      new_visual: ideasInLens.filter((i) => i.isNewVisualCarousel).length,
      carousel: ideasInLens.filter((i) => i.format === "carousel" && !i.isNewVisualCarousel).length,
      video: ideasInLens.filter((i) => i.format === "video").length,
    }),
    [ideasInLens]
  );

  const newVisualCount = formatCounts.new_visual;

  const selectedCount = ideas.filter((i) => statusOf(i) === "selected").length;

  if (loading) return <p className="workspace-muted">Loading ideas…</p>;
  if (error) return <p className="workspace-error">{error}</p>;

  const hasAnyContent = ideas.length > 0 || topPerformers.length > 0 || briefs.length > 0;

  if (!hasAnyContent) {
    return (
      <div className="workspace-empty">
        <h3>No ideas yet</h3>
        <p>Once research is processed into a brief, CAF will recommend content ideas here.</p>
        <Link href={navHref(`/brand/${encodeURIComponent(slug)}/research`)} className="btn-primary">
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
          <ResearchBriefPlatformFilter
            value={briefPlatformFilter}
            onChange={(next) => {
              setBriefPlatformFilter(next);
              setStaleBriefNotice(false);
              setQueueHint(null);
            }}
          />
          <label className="intel-pack-select">
            <span>Research context</span>
            <select
              value={packId || "all"}
              onChange={(e) => {
                setStaleBriefNotice(false);
                setQueueHint(null);
                setPackId(e.target.value === "all" ? "all" : e.target.value);
              }}
            >
              <option value="all">All research briefs</option>
              {filteredBriefs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          {cart.count > 0 && (
            <>
              <button type="button" className="btn-primary btn-sm" onClick={() => cart.setReviewOpen(true)}>
                Start creation ({cart.count})
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => cart.setDrawerOpen(true)}>
                Cart ({cart.count})
              </button>
            </>
          )}
        </div>

        {staleBriefNotice ? (
          <p className="content-cart-review-error">
            Your saved research brief is no longer on CAF Core. Pick a current brief above and re-add items to your
            cart.
          </p>
        ) : null}
        {queueHint ? <p className="content-cart-review-error">{queueHint}</p> : null}

        {mainTab === "new_content" && (
          <>
            <div className="ideas-lens-tabs">
              {(
                [
                  ["niche", "Niche"],
                  ["product", "Product"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`ideas-main-tab ${lensTab === key ? "active" : ""}`}
                  onClick={() => {
                    setLensTab(key);
                    setFormatTab("all");
                  }}
                >
                  {label}
                  <span className="ideas-tab-count">{key === "niche" ? nicheCount : productCount}</span>
                </button>
              ))}
            </div>
            <div className="ideas-format-tabs">
              {(
                [
                  ["all", "All"],
                  ["new_visual", "New visual"],
                  ["carousel", "Carousels (text)"],
                  ["video", "Videos"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`ideas-format-tab ${formatTab === key ? "active" : ""} ${
                    key === "new_visual" ? "ideas-format-tab--new-visual" : ""
                  } ${key === "new_visual" && formatTab !== key && newVisualCount > 0 ? "ideas-format-tab--has-new-visual" : ""}`}
                  onClick={() => setFormatTab(key)}
                >
                  {label}
                  <span className="ideas-tab-count">{formatCounts[key]}</span>
                </button>
              ))}
            </div>
            {newVisualCount > 0 && formatTab !== "new_visual" && (
              <p className="ideas-new-visual-hint">
                <strong>{newVisualCount}</strong> idea{newVisualCount === 1 ? "" : "s"} use{" "}
                <button type="button" className="ideas-new-visual-link" onClick={() => setFormatTab("new_visual")}>
                  New visual
                </button>{" "}
                — original concepts with AI-generated slide art and fresh copy (not mimic replicas).
              </p>
            )}
            {formatTab === "new_visual" && (
              <p className="ideas-new-visual-hint ideas-new-visual-hint--active">
                Brand-style carousel lane: each idea becomes a completely new deck — AI slide plates plus fresh copy.
                For replica or why-mimic picks, use the Top performers tab.
              </p>
            )}
          </>
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
            High-performing references from your research. For carousels, pick replica vs why mimic and render mode.
            For video references, choose the HeyGen lane (script avatar, prompt avatar, no avatar, or hook-first hybrid), then queue for
            generation.
          </p>
          <div className="ideas-tp-grid">
            {topPerformers.map((tp) => {
              const isVideo = tp.mimicKind === "video";
              const isCarousel =
                !isVideo &&
                (tp.format.toLowerCase().includes("carousel") || tp.mimicKind === "replica" || tp.mimicKind === "why_carousel");
              const mimic = tpMimic[tp.id] ?? (tp.mimicKind === "why_carousel" ? "why_carousel" : "replica");
              const render = tpRender[tp.id] ?? "full_bleed";
              const videoLane =
                tpVideoLane[tp.id] ?? tp.recommendedVideoIntent ?? resolveRecommendedVideoIntent(tp.format);
              return (
                <article key={tp.id} className="idea-tp-card intel-card--hover">
                  <PreviewMediaCard
                    preview={tp.preview ?? contentPreviewMissing("reference")}
                    alt={tp.title}
                    variant="card"
                  />
                  <div className="idea-tp-body">
                    <h3>{tp.title}</h3>
                    <span className="idea-tp-meta">
                      {tp.platform} · {tp.format}
                    </span>
                    <p>{MIMIC_EXPLAIN[tp.mimicKind]}</p>
                    {isVideo ? (
                      <>
                        <p className="idea-tp-recommended">
                          CAF recommends <strong>{labelForVideoIntent(tp.recommendedVideoIntent ?? videoLane)}</strong>{" "}
                          for this format.
                        </p>
                        <div className="content-cart-radio-group">
                          {VIDEO_LANE_OPTIONS.map((lane) => (
                            <label key={lane.id} title={lane.description}>
                              <input
                                type="radio"
                                name={`tp-video-${tp.id}`}
                                checked={videoLane === lane.id}
                                onChange={() => setTpVideoLane((p) => ({ ...p, [tp.id]: lane.id }))}
                              />
                              {lane.label}
                            </label>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
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
                          {isCarousel && (
                            <label>
                              <input
                                type="radio"
                                name={`tp-mimic-${tp.id}`}
                                checked={mimic === "why_carousel"}
                                onChange={() => setTpMimic((p) => ({ ...p, [tp.id]: "why_carousel" }))}
                              />
                              Why mimic
                            </label>
                          )}
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
                      </>
                    )}
                    <div className="idea-tp-actions">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => {
                          const queuePackId = resolveQueuePackId();
                          queueForGeneration(() => {
                            if (isVideo) {
                              return cart.addTopPerformer(
                                {
                                  id: `tp_${tp.id}`,
                                  title: tp.title,
                                  flowDestination: labelForVideoIntent(videoLane),
                                  flowTypeRaw: flowTypeForVideoIntent(videoLane),
                                  videoIntent: videoLane,
                                  platform: tp.platform,
                                  format: tp.format,
                                  useBrandVisualSystem: true,
                                },
                                { packId: queuePackId ?? undefined }
                              );
                            }
                            return cart.addTopPerformer(
                              {
                                id: `tp_${tp.id}`,
                                title: tp.title,
                                flowDestination:
                                  mimic === "why_carousel" ? "Why mimic" : "Visual mimic",
                                flowTypeRaw:
                                  mimic === "why_carousel"
                                    ? "FLOW_WHY_MIMIC_CAROUSEL"
                                    : "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
                                mimicMode: mimic,
                                renderMode: isCarousel ? render : undefined,
                                platform: tp.platform,
                                format: tp.format,
                                useBrandVisualSystem: true,
                              },
                              { packId: queuePackId ?? undefined }
                            );
                          });
                        }}
                      >
                        Queue for generation
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
            const isNewVisual = idea.isNewVisualCarousel === true;
            return (
              <article
                key={idea.id}
                className={`idea-tile ${expanded ? "idea-tile--expanded" : ""} idea-card--${status}${
                  isNewVisual ? " idea-tile--new-visual" : ""
                }`}
              >
                {isNewVisual && <span className="idea-new-visual-ribbon" aria-hidden="true" />}
                <PreviewMediaCard
                  preview={idea.preview ?? contentPreviewMissing(idea.format === "video" ? "video" : idea.format === "carousel" ? "carousel" : "storyboard")}
                  alt={idea.title}
                  variant="card"
                  className="idea-tile-preview"
                />
                <button
                  type="button"
                  className="idea-tile-head"
                  onClick={() => setExpandedId(expanded ? null : idea.id)}
                >
                  <div className="idea-tile-badges">
                    {isNewVisual ? (
                      <span className="idea-new-visual-badge" title="Original concept · AI slide art + fresh copy">
                        New visual
                      </span>
                    ) : (
                      <span className="idea-format-badge">{idea.suggestedFormat}</span>
                    )}
                    <span className={`idea-flow-badge ${isNewVisual ? "idea-flow-badge--new-visual" : ""}`}>
                      {idea.flowType}
                    </span>
                  </div>
                  <h3 className="idea-tile-title">{idea.title}</h3>
                </button>

                {expanded && (
                  <div className="idea-tile-body">
                    {isNewVisual && (
                      <p className="idea-new-visual-explainer">
                        Completely new carousel — inspired by winning deck mechanics, not a pixel replica. CAF generates
                        fresh copy and AI slide art via <strong>Brand-style carousel</strong>.
                      </p>
                    )}
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
                          {strategyOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <label className="idea-bvs-toggle">
                      <input
                        type="checkbox"
                        checked={local[idea.id]?.useBvs !== false}
                        onChange={(e) => {
                          const useBvs = e.target.checked;
                          setLocal((prev) => ({
                            ...prev,
                            [idea.id]: { ...prev[idea.id], status: prev[idea.id]?.status ?? status, useBvs },
                          }));
                          writeLocal(slug, {
                            ...local,
                            [idea.id]: { ...local[idea.id], status: local[idea.id]?.status ?? status, useBvs },
                          });
                        }}
                      />
                      <span>Use Brand Visual System</span>
                      <span className="idea-bvs-hint">Apply your brand bible to visuals for this piece</span>
                    </label>
                    <div className="idea-actions">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => {
                          const queuePackId = resolveQueuePackId();
                          const ideaStrategy = local[idea.id]?.strategy ?? "caf_recommended";
                          const resolved = resolveCartFlowForIdea(idea, ideaStrategy);
                          queueForGeneration(() =>
                            cart.addIdea(
                              {
                                id: `idea_${idea.id}`,
                                title: idea.title,
                                flowDestination: resolved.flowDestination,
                                flowTypeRaw: resolved.flowTypeRaw,
                                generationStrategy: resolved.generationStrategy,
                                format: idea.format,
                                platform: idea.platform,
                                ideaTargetFlowType: idea.targetFlowType,
                                useBrandVisualSystem: local[idea.id]?.useBvs !== false,
                              },
                              { packId: queuePackId ?? undefined }
                            )
                          );
                        }}
                      >
                        Queue for generation
                      </button>
                      {status === "selected" ? (
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setStatus(idea, "new")}>
                          Unselect
                        </button>
                      ) : (
                        <>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setStatus(idea, "selected")}>
                            Shortlist
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setStatus(idea, "rejected")}>
                            Reject idea
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

      {mainTab === "new_content" && filteredIdeas.length === 0 && ideasInLens.length > 0 && (
        <p className="workspace-muted">No {lensTab} ideas match this format.</p>
      )}

      {mainTab === "new_content" && ideasInLens.length === 0 && ideas.length > 0 && (
        <p className="workspace-muted">
          No {lensTab} ideas in this research brief yet. Try the other content lens tab.
        </p>
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
