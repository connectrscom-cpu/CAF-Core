"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BrandOnboardingChecklist } from "@/components/marketer/BrandOnboardingChecklist";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import { MARKETER_LABELS } from "@/lib/marketer/language";
import type { BrandSummary } from "@/lib/marketer/types";

interface BrandsResponse {
  brands: BrandSummary[];
}

export default function BrandDashboardPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [brand, setBrand] = useState<BrandSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    fetch("/api/workspace/brands")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: BrandsResponse | null) => {
        setBrand(j?.brands?.find((b) => b.slug === slug) ?? null);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return <p className="workspace-muted" style={{ padding: 28 }}>Loading brand…</p>;
  }

  if (!brand) {
    return (
      <div className="workspace-empty" style={{ margin: 28 }}>
        <h2>Brand not found</h2>
        <p>We could not find a brand matching this URL.</p>
        <Link href="/workspace">← Back to workspace</Link>
      </div>
    );
  }

  const base = `/brand/${encodeURIComponent(slug)}`;
  const nextActions: { label: string; href: string; hint: string; priority?: boolean }[] = [];

  if (brand.setupWarnings.some((w) => w.toLowerCase().includes("profile"))) {
    nextActions.push({
      label: "Complete brand profile",
      href: `${base}/profile`,
      hint: "Voice, audience, and visual style",
      priority: true,
    });
  }
  if (brand.researchStatus === "not_started") {
    nextActions.push({
      label: "Add research",
      href: `${base}/research`,
      hint: "Competitors, inspiration, uploads",
      priority: true,
    });
  }
  if (brand.stats.pendingReview > 0) {
    nextActions.push({
      label: `Review ${brand.stats.pendingReview} draft${brand.stats.pendingReview === 1 ? "" : "s"}`,
      href: `${base}/content`,
      hint: "Approve, edit, or reject content",
      priority: true,
    });
  }
  if (brand.ideasReady > 0) {
    nextActions.push({
      label: `Browse ${brand.ideasReady} ideas`,
      href: `${base}/ideas`,
      hint: "Pick what to create next",
    });
  }
  if (brand.stats.approved > 0) {
    nextActions.push({
      label: "Publish approved content",
      href: `${base}/publishing`,
      hint: `${brand.stats.approved} ready to go`,
    });
  }
  if (nextActions.length === 0) {
    nextActions.push({
      label: "Explore market intelligence",
      href: `${base}/intelligence`,
      hint: "See what CAF learned from your research",
    });
  }

  return (
    <div className="brand-dashboard" data-agent-id="brand-dashboard">
      <BrandPageHeader
        displayName={brand.displayName}
        slug={brand.slug}
        accentColor={brand.accentColor}
        subtitle="What should you do next?"
      />

      <BrandOnboardingChecklist brand={brand} />

      <section className="dashboard-next" aria-labelledby="next-actions" data-agent-id="recommended-next-steps">
        <h2 id="next-actions">Recommended next steps</h2>
        <div className="dashboard-action-grid">
          {nextActions.slice(0, 4).map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={`dashboard-action-card ${action.priority ? "dashboard-action-card--priority" : ""}`}
              data-agent-id={nextStepAgentId(action)}
            >
              <strong>{action.label}</strong>
              <span>{action.hint}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="dashboard-stats" aria-labelledby="brand-overview" data-agent-id="overview-metrics">
        <h2 id="brand-overview">Overview</h2>
        <div className="dashboard-stat-grid">
          <StatCard label="Needs review" value={brand.stats.pendingReview} href={`${base}/content`} agentId="metric-needs-review" />
          <StatCard label="Needs edits" value={brand.stats.needsEdits} href={`${base}/content?status=needs_edit`} agentId="metric-needs-edits" />
          <StatCard label="Approved" value={brand.stats.approved} href={`${base}/publishing`} agentId="metric-approved" />
          <StatCard label="Scheduled" value={brand.stats.scheduledPosts} href={`${base}/publishing`} agentId="metric-scheduled" />
          <StatCard label="Ideas ready" value={brand.ideasReady} href={`${base}/ideas`} agentId="metric-ideas-ready" />
        </div>
      </section>

      <section className="dashboard-pipeline" aria-labelledby="pipeline-status" data-agent-id="pipeline-status">
        <h2 id="pipeline-status">Pipeline status</h2>
        <ul className="dashboard-pipeline-list">
          <PipelineRow
            label={MARKETER_LABELS.brandProfile}
            status={brand.setupWarnings.some((w) => w.toLowerCase().includes("profile")) ? "Setup needed" : "Ready"}
            href={`${base}/profile`}
            agentId="pipeline-brand-profile"
          />
          <PipelineRow label={MARKETER_LABELS.research} status={statusLabel(brand.researchStatus)} href={`${base}/research`} agentId="pipeline-research" />
          <PipelineRow
            label={MARKETER_LABELS.marketIntelligence}
            status={statusLabel(brand.intelligenceStatus)}
            href={`${base}/intelligence`}
            agentId="pipeline-market-intelligence"
          />
          <PipelineRow label={MARKETER_LABELS.ideas} status={brand.ideasReady > 0 ? `${brand.ideasReady} ready to browse` : "Waiting on research"} href={`${base}/ideas`} agentId="pipeline-ideas" />
          <PipelineRow label={MARKETER_LABELS.content} status={contentPipelineStatus(brand.stats.activeContent)} href={`${base}/content`} agentId="pipeline-content" />
          <PipelineRow label={MARKETER_LABELS.publishing} status={brand.stats.scheduledPosts > 0 ? `${brand.stats.scheduledPosts} scheduled` : brand.stats.approved > 0 ? `${brand.stats.approved} ready` : "Nothing scheduled"} href={`${base}/publishing`} agentId="pipeline-publishing" />
        </ul>
      </section>
    </div>
  );
}

function statusLabel(s: string): string {
  if (s === "ready") return "Ready";
  if (s === "stale") return "Needs refresh";
  if (s === "in_progress") return "Processing";
  return "Not started";
}

function contentPipelineStatus(active: number): string {
  if (active > 0) return `${active} in review`;
  return "No drafts yet";
}

function nextStepAgentId(action: { label: string; href: string }): string {
  if (action.href.includes("/content")) return "next-step-review-drafts";
  if (action.href.includes("/ideas")) return "next-step-browse-ideas";
  if (action.href.includes("/profile")) return "next-step-complete-profile";
  if (action.href.includes("/research")) return "next-step-add-research";
  if (action.href.includes("/publishing")) return "next-step-publish-approved";
  if (action.href.includes("/intelligence")) return "next-step-explore-intelligence";
  return "next-step-other";
}

function StatCard({
  label,
  value,
  href,
  agentId,
}: {
  label: string;
  value: number;
  href: string;
  agentId: string;
}) {
  return (
    <Link href={href} className="dashboard-stat-card" data-agent-id={agentId}>
      <span className="dashboard-stat-value">{value}</span>
      <span className="dashboard-stat-label">{label}</span>
    </Link>
  );
}

function pipelineStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "ready" || s.includes("ready")) return "pipeline-status--ready";
  if (s.includes("processing") || s.includes("in progress") || s.includes("in review") || s.includes("setup")) {
    return "pipeline-status--progress";
  }
  if (s.includes("not started") || s.includes("waiting") || s.includes("no drafts") || s.includes("nothing")) {
    return "pipeline-status--idle";
  }
  return "pipeline-status--neutral";
}

function PipelineRow({
  label,
  status,
  href,
  agentId,
}: {
  label: string;
  status: string;
  href: string;
  agentId: string;
}) {
  return (
    <li data-agent-id={agentId}>
      <Link href={href} className="dashboard-pipeline-row">
        <span>{label}</span>
        <span className={`dashboard-pipeline-status ${pipelineStatusClass(status)}`}>{status}</span>
      </Link>
    </li>
  );
}
