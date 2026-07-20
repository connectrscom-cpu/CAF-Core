"use client";

import { useMemo } from "react";
import {
  pickViralityTip,
  sourceLabel,
  type ViralityTipPage,
} from "@/lib/marketer/virality-tips";

interface PageTipProps {
  page: ViralityTipPage;
  /** Extra salt when multiple tips appear on one screen (e.g. empty vs loading). */
  salt?: string;
  className?: string;
  compact?: boolean;
}

/** Rotating educational tip for Meta organic reach — display only. */
export function PageTip({ page, salt = "", className = "", compact = false }: PageTipProps) {
  const tip = useMemo(() => pickViralityTip(page, salt), [page, salt]);
  if (!tip) return null;

  return (
    <aside
      className={`page-tip ${compact ? "page-tip--compact" : ""} ${className}`.trim()}
      data-tip-id={tip.id}
      data-agent-id={`virality-tip-${page}`}
    >
      <div className="page-tip-meta">
        <span className="page-tip-kicker">Tip</span>
        <span className="page-tip-source">{sourceLabel(tip.source)}</span>
      </div>
      <p className="page-tip-title">{tip.title}</p>
      <p className="page-tip-body">{tip.body}</p>
    </aside>
  );
}

interface LoadingWithTipProps {
  page: ViralityTipPage;
  label: string;
}

/** Standard loading line + rotating tip. */
export function LoadingWithTip({ page, label }: LoadingWithTipProps) {
  return (
    <div className="page-tip-loading">
      <p className="workspace-muted">{label}</p>
      <PageTip page={page} salt="loading" />
    </div>
  );
}
