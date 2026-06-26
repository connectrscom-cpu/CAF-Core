"use client";

import { useEffect } from "react";
import type { LearningRule } from "@/lib/learning/types";
import { learningRulePlainSummary } from "@/lib/learning/helpers";

export function RuleDetailModal({
  rule,
  onClose,
  onDrop,
  onApply,
}: {
  rule: LearningRule;
  onClose: () => void;
  onDrop?: (rule: LearningRule) => void;
  onApply?: (rule: LearningRule) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const scope = [rule.scope_flow_type, rule.scope_platform].filter(Boolean).join(" · ") || "—";
  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="rule-detail-title"
        style={{
          background: "var(--card)",
          color: "var(--fg)",
          borderRadius: 12,
          border: "1px solid var(--border)",
          maxWidth: 560,
          width: "100%",
          maxHeight: "min(85vh, 720px)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 48px rgba(0,0,0,0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
          <h3 id="rule-detail-title" style={{ margin: 0, fontSize: 17 }}>
            Rule details
          </h3>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Pending rules need Apply or Drop before they affect the next run.
          </p>
        </div>
        <div style={{ padding: 16, overflow: "auto", fontSize: 13, lineHeight: 1.5 }}>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px" }}>
            <dt style={{ color: "var(--muted)" }}>Rule ID</dt>
            <dd style={{ margin: 0, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
              {rule.rule_id}
            </dd>
            <dt style={{ color: "var(--muted)" }}>Status</dt>
            <dd style={{ margin: 0 }}>{rule.status}</dd>
            <dt style={{ color: "var(--muted)" }}>Trigger</dt>
            <dd style={{ margin: 0 }}>{rule.trigger_type}</dd>
            <dt style={{ color: "var(--muted)" }}>Scope</dt>
            <dd style={{ margin: 0 }}>{scope}</dd>
            <dt style={{ color: "var(--muted)" }}>Action</dt>
            <dd style={{ margin: 0 }}>
              <strong>{rule.action_type}</strong>
              {rule.rule_family ? (
                <span style={{ color: "var(--muted)" }}> · {rule.rule_family}</span>
              ) : null}
            </dd>
          </dl>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>What it does</div>
            <p style={{ margin: 0, color: "var(--fg-secondary)" }}>{learningRulePlainSummary(rule)}</p>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Payload (JSON)</div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                fontSize: 11,
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "auto",
                maxHeight: 220,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(rule.action_payload ?? {}, null, 2)}
            </pre>
          </div>
        </div>
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          {onApply && rule.status === "pending" ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                onApply(rule);
                onClose();
              }}
            >
              Apply
            </button>
          ) : null}
          {onDrop && (rule.status === "pending" || rule.status === "active") ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                onDrop(rule);
                onClose();
              }}
            >
              {rule.status === "pending" ? "Drop" : "Drop (deactivate)"}
            </button>
          ) : null}
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
