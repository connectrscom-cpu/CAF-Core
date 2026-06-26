"use client";

import { useContentCart, useContentCartOptional } from "@/components/marketer/ContentCartContext";
import { humanizeFlowType } from "@/lib/marketer/language";

export function ContentCartDrawer() {
  const { items, count, flowTypes, removeItem, updateItem, drawerOpen, setDrawerOpen } = useContentCart();

  if (!drawerOpen) return null;

  const flowOptions =
    flowTypes.length > 0
      ? flowTypes
      : [{ id: "FLOW_CAROUSEL", label: "Carousel" }, { id: "FLOW_VIDEO", label: "Video" }];

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

        {items.length === 0 ? (
          <p className="content-cart-empty">Add ideas or top performers from the Ideas board.</p>
        ) : (
          <ul className="content-cart-list">
            {items.map((item) => (
              <li key={item.id} className="content-cart-line">
                <div className="content-cart-line-head">
                  <strong>{item.title}</strong>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => removeItem(item.id)}>
                    Remove
                  </button>
                </div>
                <span className="content-cart-kind">{item.kind === "idea" ? "Idea" : "Top performer"}</span>
                <label className="content-cart-flow">
                  <span>Flow</span>
                  <select
                    value={item.flowTypeRaw}
                    onChange={(e) =>
                      updateItem(item.id, {
                        flowTypeRaw: e.target.value,
                        flowDestination: humanizeFlowType(e.target.value),
                      })
                    }
                  >
                    {flowOptions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                {item.kind === "top_performer" && (
                  <>
                    <div className="content-cart-radio-group">
                      <span>Mimic style</span>
                      <label>
                        <input
                          type="radio"
                          name={`mimic-${item.id}`}
                          checked={(item.mimicMode ?? "replica") === "replica"}
                          onChange={() => updateItem(item.id, { mimicMode: "replica" })}
                        />
                        Replica
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`mimic-${item.id}`}
                          checked={item.mimicMode === "why_carousel"}
                          onChange={() => updateItem(item.id, { mimicMode: "why_carousel" })}
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
              </li>
            ))}
          </ul>
        )}

        <footer className="content-cart-footer">
          <button type="button" className="btn-primary" disabled={count === 0}>
            Review cart
          </button>
          <p className="section-stub-note">
            Content generation from your cart is not available yet. Share this cart with your CAF operator, or approve
            drafts already in <strong>Content</strong> once they are ready.
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
