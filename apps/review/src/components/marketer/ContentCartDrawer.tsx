"use client";

import { useContentCart, useContentCartOptional } from "@/components/marketer/ContentCartContext";
import { normalizeCartItemFlow, resolveCartFlowForIdea, ideaShapeFromCartItem } from "@/lib/marketer/cart-flow-resolve";
import { GENERATION_STRATEGY_OPTIONS } from "@/lib/marketer/generation-strategy";
import {
  flowTypeForVideoIntent,
  isVideoTopPerformerItem,
  labelForVideoIntent,
  VIDEO_LANE_OPTIONS,
  type VideoPipelineIntent,
} from "@/lib/marketer/video-lane";
import type { GenerationStrategy } from "@/lib/marketer/types";

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

  if (!drawerOpen) return null;

  const displayItems = items.map(normalizeCartItemFlow);

  function updateIdeaStrategy(itemId: string, strategy: GenerationStrategy) {
    const item = items.find((x) => x.id === itemId);
    if (!item || item.kind !== "idea") return;
    const resolved = resolveCartFlowForIdea(ideaShapeFromCartItem(item), strategy);
    updateItem(itemId, {
      generationStrategy: strategy,
      flowTypeRaw: resolved.flowTypeRaw,
      flowDestination: resolved.flowDestination,
    });
  }

  function setTopPerformerMimic(itemId: string, mimic: "replica" | "why_carousel") {
    updateItem(itemId, {
      mimicMode: mimic,
      flowTypeRaw:
        mimic === "why_carousel" ? "FLOW_WHY_MIMIC_CAROUSEL" : "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
      flowDestination: mimic === "why_carousel" ? "Why mimic" : "Visual mimic",
    });
  }

  function setTopPerformerVideoLane(itemId: string, lane: VideoPipelineIntent) {
    updateItem(itemId, {
      videoIntent: lane,
      flowTypeRaw: flowTypeForVideoIntent(lane),
      flowDestination: labelForVideoIntent(lane),
    });
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
          <p className="content-cart-empty">Add ideas or top performers from the Ideas board.</p>
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
                          onChange={(e) => updateIdeaStrategy(item.id, e.target.value as GenerationStrategy)}
                        >
                          {GENERATION_STRATEGY_OPTIONS.map((o) => (
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
