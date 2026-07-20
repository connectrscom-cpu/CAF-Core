"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { humanizePublishStatus } from "@/lib/marketer/language";
import type { PublishStatus, ScheduledPost } from "@/lib/marketer/types";
import { LoadingWithTip, PageTip } from "@/components/marketer/PageTip";

interface PublishingViewProps {
  slug: string;
}

interface PublishingResponse {
  approvedCount: number;
  inReviewCount: number;
  brandDisplayName?: string;
  scheduled: ScheduledPost[];
  published: ScheduledPost[];
}

type Tab = "ready" | "scheduled" | "published";

const STATUS_CLASS: Record<PublishStatus, string> = {
  ready: "pub-status--ready",
  scheduled: "pub-status--scheduled",
  publishing: "pub-status--publishing",
  published: "pub-status--published",
  failed: "pub-status--failed",
};

export function PublishingView({ slug }: PublishingViewProps) {
  const [data, setData] = useState<PublishingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ready");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/brand/${encodeURIComponent(slug)}/publishing`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load publishing"))))
      .then((j: PublishingResponse) => !cancelled && setData(j))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const composeHref = `/publish?project=${encodeURIComponent(slug)}`;

  const grouped = useMemo(() => {
    if (!data) return { scheduled: [], published: [] };
    return { scheduled: data.scheduled, published: data.published };
  }, [data]);

  if (loading) return <LoadingWithTip page="publishing" label="Loading publishing…" />;
  if (error) return <p className="workspace-error">{error}</p>;
  if (!data) return null;

  return (
    <div className="publishing-view">
      <PageTip page="publishing" salt="banner" className="page-tip-banner" />
      <div className="tabs">
        <button type="button" className={`tab ${tab === "ready" ? "active" : ""}`} onClick={() => setTab("ready")}>
          Ready to publish
          <span className="tab-count">{data.approvedCount}</span>
        </button>
        <button type="button" className={`tab ${tab === "scheduled" ? "active" : ""}`} onClick={() => setTab("scheduled")}>
          Scheduled
          <span className="tab-count">{grouped.scheduled.length}</span>
        </button>
        <button type="button" className={`tab ${tab === "published" ? "active" : ""}`} onClick={() => setTab("published")}>
          Published
          <span className="tab-count">{grouped.published.length}</span>
        </button>
      </div>

      {tab === "ready" && (
        <div className="publishing-section">
          {data.approvedCount === 0 ? (
            <div className="workspace-empty">
              <h3>Nothing ready to publish yet</h3>
              <p>
                {data.inReviewCount > 0 ? (
                  <>
                    <strong>{data.inReviewCount}</strong> {data.brandDisplayName ?? slug} draft
                    {data.inReviewCount === 1 ? " is" : "s are"} waiting for review. Approve content first, then
                    return here to schedule.
                  </>
                ) : (
                  <>
                    Approved content will appear here when it is ready to schedule. Review drafts in Content first —
                    approve pieces you want to publish, then return here to pick dates and channels.
                  </>
                )}
              </p>
              <div className="section-stub-actions">
                <Link href={`/brand/${encodeURIComponent(slug)}/content`} className="btn-primary">
                  Review content
                </Link>
                <Link href={`/brand/${encodeURIComponent(slug)}/ideas`} className="btn-ghost">
                  Browse ideas
                </Link>
              </div>
              <PageTip page="publishing" salt="empty" compact />
            </div>
          ) : (
            <div className="publishing-ready-card">
              <p>
                <strong>{data.approvedCount}</strong> approved piece{data.approvedCount === 1 ? "" : "s"} ready to schedule.
              </p>
              <Link href={composeHref} className="btn-primary">
                Schedule a post
              </Link>
            </div>
          )}
        </div>
      )}

      {tab === "scheduled" && (
        <PostList
          posts={grouped.scheduled}
          emptyTitle="No scheduled posts"
          emptyBody="Schedule approved content and it will appear here with date and platform."
          composeHref={composeHref}
          slug={slug}
        />
      )}

      {tab === "published" && (
        <PostList
          posts={grouped.published}
          emptyTitle="Nothing published yet"
          emptyBody="Once posts go live, links and performance notes will show up here."
          composeHref={composeHref}
          slug={slug}
        />
      )}
    </div>
  );
}

function PostList({
  posts,
  emptyTitle,
  emptyBody,
  composeHref,
  slug,
}: {
  posts: ScheduledPost[];
  emptyTitle: string;
  emptyBody: string;
  composeHref: string;
  slug: string;
}) {
  if (posts.length === 0) {
    return (
      <div className="workspace-empty">
        <h3>{emptyTitle}</h3>
        <p>{emptyBody}</p>
        <Link href={`/brand/${encodeURIComponent(slug)}/content?status=approved`} className="btn-primary">
          View approved content
        </Link>
        <PageTip page="publishing" salt="list-empty" compact />
      </div>
    );
  }

  return (
    <ul className="publishing-list">
      {posts.map((p) => (
        <li key={p.id} className="publishing-row">
          <div className="publishing-row-main">
            <span className="publishing-platform">{p.platform}</span>
            <span className="publishing-title">{p.contentTitle}</span>
          </div>
          <div className="publishing-row-meta">
            <span className={`pub-status ${STATUS_CLASS[p.status]}`}>{humanizePublishStatus(p.status)}</span>
            {p.scheduledAt && p.status === "scheduled" && (
              <span className="publishing-time">{new Date(p.scheduledAt).toLocaleString()}</span>
            )}
            {p.publishedAt && p.status === "published" && (
              <span className="publishing-time">{new Date(p.publishedAt).toLocaleString()}</span>
            )}
            {p.postUrl ? (
              <a href={p.postUrl} target="_blank" rel="noreferrer" className="publishing-link">
                View post
              </a>
            ) : null}
            {p.error && <span className="publishing-error">{p.error}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
