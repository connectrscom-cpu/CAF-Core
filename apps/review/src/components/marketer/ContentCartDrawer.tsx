"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useContentCart, useContentCartOptional } from "@/components/marketer/ContentCartContext";
import {
  filterGenerationStrategiesByEnabledFlows,
  GENERATION_STRATEGY_OPTIONS,
} from "@/lib/marketer/generation-strategy";
import {
  isCartItemAllowedByEnabledFlows,
  normalizeCartItemFlow,
  resolveCartFlowForIdea,
  ideaShapeFromCartItem,
} from "@/lib/marketer/cart-flow-resolve";
import {
  flowTypeForVideoIntent,
  isVideoTopPerformerItem,
  labelForVideoIntent,
  VIDEO_LANE_OPTIONS,
  videoIntentFromFlowType,
  videoLaneNeedsAvatar,
  videoLaneUsesUgcPresenters,
  type VideoPipelineIntent,
} from "@/lib/marketer/video-lane";
import { toBrandBible } from "@/lib/marketer/brand-bible-adapters";
import { toProductBible } from "@/lib/marketer/product-bible-adapters";
import { PageTip } from "@/components/marketer/PageTip";
import type { BrandBibleHeygenPresenter, GenerationStrategy } from "@/lib/marketer/types";

type PresenterOption = Pick<
  BrandBibleHeygenPresenter,
  "label" | "avatarId" | "voiceId" | "avatarName" | "voiceName"
>;

function presenterLabel(p: PresenterOption): string {
  const name = p.label.trim() || p.avatarName.trim() || p.avatarId;
  const voice = p.voiceName.trim() || p.voiceId.trim();
  return voice ? `${name} · ${voice}` : name;
}

function cartItemVideoLane(item: {
  videoIntent?: VideoPipelineIntent;
  flowTypeRaw?: string;
}): VideoPipelineIntent | string {
  return item.videoIntent ?? videoIntentFromFlowType(item.flowTypeRaw ?? "") ?? item.flowTypeRaw ?? "";
}

export function ContentCartDrawer() {
  const {
    items,
    count,
    removeItem,
    updateItem,
    drawerOpen,
    setDrawerOpen,
    setReviewOpen,
  } = useContentCart();
  const params = useParams();
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const [enabledFlowTypes, setEnabledFlowTypes] = useState<string[]>([]);
  const [brandPresenters, setBrandPresenters] = useState<PresenterOption[]>([]);
  const [ugcPresenters, setUgcPresenters] = useState<PresenterOption[]>([]);

  useEffect(() => {
    if (!slug) return;
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

  useEffect(() => {
    if (!slug || !drawerOpen) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/brand/${encodeURIComponent(slug)}/brand-bible`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/brand/${encodeURIComponent(slug)}/product-bible`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null
      ),
    ])
      .then(([brandJson, productJson]) => {
        if (cancelled) return;
        const brand = brandJson?.parsed
          ? toBrandBible(slug, brandJson.parsed, brandJson.version ?? null)
          : null;
        const product = productJson?.parsed
          ? toProductBible(slug, productJson.parsed, productJson.version ?? null)
          : null;
        setBrandPresenters(brand?.heygenPresenters ?? []);
        const ugc = [
          ...(brand?.heygenUgcPresenters ?? []),
          ...(product?.heygenUgcPresenters ?? []),
        ];
        const seen = new Set<string>();
        setUgcPresenters(
          ugc.filter((p) => {
            const id = p.avatarId.trim();
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
          })
        );
      })
      .catch(() => {
        if (!cancelled) {
          setBrandPresenters([]);
          setUgcPresenters([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, drawerOpen]);

  const strategyOptions = useMemo(
    () => filterGenerationStrategiesByEnabledFlows(enabledFlowTypes),
    [enabledFlowTypes]
  );

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.classList.add("body-scroll-locked");
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("body-scroll-locked");
      document.body.style.overflow = prev;
    };
  }, [drawerOpen, setDrawerOpen]);

  if (!drawerOpen) return null;

  const displayItems = items
    .map(normalizeCartItemFlow)
    .filter((item) => isCartItemAllowedByEnabledFlows(item, enabledFlowTypes));

  function updateIdeaStrategy(itemId: string, strategy: GenerationStrategy) {
    const item = items.find((x) => x.id === itemId);
    if (!item || item.kind !== "idea") return;
    const resolved = resolveCartFlowForIdea(ideaShapeFromCartItem(item), strategy);
    const nextFlow = resolved.flowTypeRaw;
    const needsAvatar = videoLaneNeedsAvatar(nextFlow);
    updateItem(itemId, {
      generationStrategy: strategy,
      flowTypeRaw: nextFlow,
      flowDestination: resolved.flowDestination,
      ...(needsAvatar ? {} : { heygenAvatarId: undefined, heygenVoiceId: undefined }),
    });
  }

  function setTopPerformerMimic(itemId: string, mimic: "replica" | "why_carousel") {
    updateItem(itemId, {
      mimicMode: mimic,
      flowTypeRaw:
        mimic === "why_carousel" ? "FLOW_WHY_MIMIC_CAROUSEL" : "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
      flowDestination: mimic === "why_carousel" ? "Why mimic" : "Visual mimic",
      heygenAvatarId: undefined,
      heygenVoiceId: undefined,
    });
  }

  function setTopPerformerVideoLane(itemId: string, lane: VideoPipelineIntent) {
    updateItem(itemId, {
      videoIntent: lane,
      flowTypeRaw: flowTypeForVideoIntent(lane),
      flowDestination: labelForVideoIntent(lane),
      ...(videoLaneNeedsAvatar(lane)
        ? {}
        : { heygenAvatarId: undefined, heygenVoiceId: undefined }),
    });
  }

  function setHeygenPresenter(itemId: string, avatarId: string, pool: PresenterOption[]) {
    const trimmed = avatarId.trim();
    if (!trimmed) {
      updateItem(itemId, { heygenAvatarId: undefined, heygenVoiceId: undefined });
      return;
    }
    const match = pool.find((p) => p.avatarId === trimmed);
    updateItem(itemId, {
      heygenAvatarId: trimmed,
      heygenVoiceId: match?.voiceId?.trim() || undefined,
    });
  }

  function renderAvatarPicker(item: (typeof displayItems)[number]) {
    const lane = cartItemVideoLane(item);
    if (!videoLaneNeedsAvatar(lane)) return null;
    const pool = videoLaneUsesUgcPresenters(lane) ? ugcPresenters : brandPresenters;
    const poolForSelect = pool.length > 0 ? pool : brandPresenters;
    return (
      <label className="content-cart-flow">
        <span>Avatar</span>
        <select
          value={item.heygenAvatarId ?? ""}
          onChange={(e) => setHeygenPresenter(item.id, e.target.value, poolForSelect)}
        >
          <option value="">Random from pool</option>
          {poolForSelect.map((p) => (
            <option key={p.avatarId} value={p.avatarId}>
              {presenterLabel(p)}
            </option>
          ))}
        </select>
        {poolForSelect.length === 0 ? (
          <em className="content-cart-route">
            Add presenters (with voices) in Brand Bible / Product Bible.
          </em>
        ) : item.heygenAvatarId ? (
          <em className="content-cart-route">Voice paired automatically from the presenter setup.</em>
        ) : (
          <em className="content-cart-route">No pick → random avatar + its HeyGen voice.</em>
        )}
      </label>
    );
  }

  return (
    <div className="content-cart-overlay" role="presentation" onClick={() => setDrawerOpen(false)}>
      <aside
        className="content-cart-drawer"
        role="dialog"
        aria-label="Content cart"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="content-cart-header">
          <h3>Content cart</h3>
          <span className="content-cart-count">{count} item{count === 1 ? "" : "s"}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setDrawerOpen(false)}>
            Close
          </button>
        </header>

        {displayItems.length === 0 ? (
          <div>
            <p className="content-cart-empty">Add ideas or top performers from the Ideas board.</p>
            <PageTip page="cart" salt="empty" compact />
          </div>
        ) : (
          <ul className="content-cart-list">
            {displayItems.map((item) => {
              const strategyLabel =
                GENERATION_STRATEGY_OPTIONS.find((o) => o.id === item.generationStrategy)?.label ??
                "CAF recommended";

              return (
                <li key={item.id} className="content-cart-line">
                  <div className="content-cart-line-head">
                    <strong>{item.title}</strong>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => removeItem(item.id)}>
                      Remove
                    </button>
                  </div>
                  <span className="content-cart-kind">
                    {item.kind === "idea" ? "Idea" : "Top performer"}
                    {item.platform ? ` · ${item.platform}` : ""}
                    {item.format ? ` · ${item.format}` : ""}
                  </span>

                  {item.kind === "idea" ? (
                    <>
                      <label className="content-cart-flow">
                        <span>Generation strategy</span>
                        <select
                          value={item.generationStrategy ?? "caf_recommended"}
                          onChange={(e) =>
                            updateIdeaStrategy(item.id, e.target.value as GenerationStrategy)
                          }
                        >
                          {strategyOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="content-cart-route">
                        <span>Generation route</span>
                        <strong>{item.flowDestination}</strong>
                        <em>{strategyLabel}</em>
                      </p>
                      {renderAvatarPicker(item)}
                    </>
                  ) : isVideoTopPerformerItem(item) ? (
                    <>
                      <p className="content-cart-route">
                        <span>HeyGen lane</span>
                        <strong>{item.flowDestination}</strong>
                      </p>
                      <div className="content-cart-radio-group">
                        <span>Video lane</span>
                        {VIDEO_LANE_OPTIONS.map((lane) => (
                          <label key={lane.id}>
                            <input
                              type="radio"
                              name={`video-lane-${item.id}`}
                              checked={(item.videoIntent ?? "prompt_avatar") === lane.id}
                              onChange={() => setTopPerformerVideoLane(item.id, lane.id)}
                            />
                            {lane.label}
                          </label>
                        ))}
                      </div>
                      {renderAvatarPicker(item)}
                    </>
                  ) : (
                    <>
                      <p className="content-cart-route">
                        <span>Generation route</span>
                        <strong>{item.flowDestination}</strong>
                        {(item.renderMode ?? "full_bleed") === "template" ? (
                          <em>Template render</em>
                        ) : (
                          <em>Full bleed render</em>
                        )}
                      </p>
                      <div className="content-cart-radio-group">
                        <span>Mimic style</span>
                        <label>
                          <input
                            type="radio"
                            name={`mimic-${item.id}`}
                            checked={(item.mimicMode ?? "replica") === "replica"}
                            onChange={() => setTopPerformerMimic(item.id, "replica")}
                          />
                          Replica
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`mimic-${item.id}`}
                            checked={item.mimicMode === "why_carousel"}
                            onChange={() => setTopPerformerMimic(item.id, "why_carousel")}
                          />
                          Why mimic
                        </label>
                      </div>
                      <div className="content-cart-radio-group">
                        <span>Carousel render</span>
                        <label>
                          <input
                            type="radio"
                            name={`render-${item.id}`}
                            checked={(item.renderMode ?? "full_bleed") === "full_bleed"}
                            onChange={() => updateItem(item.id, { renderMode: "full_bleed" })}
                          />
                          Full bleed
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`render-${item.id}`}
                            checked={item.renderMode === "template"}
                            onChange={() => updateItem(item.id, { renderMode: "template" })}
                          />
                          Template
                        </label>
                      </div>
                    </>
                  )}

                  <label className="content-cart-bvs">
                    <input
                      type="checkbox"
                      checked={item.useBrandVisualSystem !== false}
                      onChange={(e) => updateItem(item.id, { useBrandVisualSystem: e.target.checked })}
                    />
                    <span>Use Brand Visual System</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="content-cart-footer">
          <button
            type="button"
            className="btn-primary content-cart-start-cta"
            disabled={count === 0}
            onClick={() => {
              setDrawerOpen(false);
              setReviewOpen(true);
            }}
          >
            Review &amp; start creation
          </button>
          <p className="section-stub-note">
            Your cart is saved per research brief. Review the plan, then start a full run through rendering.
          </p>
        </footer>
      </aside>
    </div>
  );
}

export function ContentCartBadge() {
  const cart = useContentCartOptional();
  if (!cart) return null;
  return (
    <button
      type="button"
      className={`content-cart-badge ${cart.count > 0 ? "content-cart-badge--active" : ""}`}
      onClick={() => cart.setDrawerOpen(true)}
      title="Open content cart"
    >
      Cart{cart.count > 0 ? ` · ${cart.count}` : ""}
    </button>
  );
}
