import Link from "next/link";
import { Suspense } from "react";
import { PROJECT_SLUG } from "@/lib/env";
import {
  getQueueTab,
  getQueueCounts,
  getFacets,
  type ReviewTab,
  type ReviewQueueJob,
  type QueueFilters,
} from "@/lib/caf-core-client";
import { FilterPanel } from "@/components/FilterPanel";

const TABS: { key: ReviewTab; label: string }[] = [
  { key: "in_review", label: "In Review" },
  { key: "needs_edit", label: "Waiting for Rework" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

interface PageProps {
  searchParams: {
    status?: string;
    tab?: string;
    search?: string;
    platform?: string;
    flow_type?: string;
    recommended_route?: string;
    qc_status?: string;
    review_status?: string;
    decision?: string;
    has_preview?: string;
    risk_score_min?: string;
    run_id?: string;
    sort?: string;
    group_by?: string;
  };
}

export default async function Home({ searchParams }: PageProps) {
  const tabKey = searchParams.status ?? searchParams.tab ?? "in_review";
  const currentTab = (TABS.find((t) => t.key === tabKey)?.key ?? "in_review") as ReviewTab;

  const filters: QueueFilters = {
    search: searchParams.search,
    platform: searchParams.platform,
    flow_type: searchParams.flow_type,
    recommended_route: searchParams.recommended_route,
    qc_status: searchParams.qc_status,
    review_status: searchParams.review_status,
    decision: searchParams.decision,
    has_preview: searchParams.has_preview,
    risk_score_min: searchParams.risk_score_min,
    run_id: searchParams.run_id,
    sort: searchParams.sort,
    group_by: searchParams.group_by,
  };

  const [jobs, counts, facets] = await Promise.all([
    getQueueTab(PROJECT_SLUG, currentTab, filters),
    getQueueCounts(PROJECT_SLUG),
    getFacets(PROJECT_SLUG),
  ]);

  const groupBy = searchParams.group_by;
  const grouped = groupBy ? groupJobs(jobs, groupBy) : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>CAF Review Console</h2>
          <div className="page-header-sub">Workbench</div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/?status=${t.key}`}
            className={`tab ${currentTab === t.key ? "active" : ""}`}
          >
            {t.label}
            <span className="tab-count">{counts[t.key]}</span>
          </Link>
        ))}
      </div>

      <div className="workbench">
        <Suspense fallback={<div className="workbench-filters" />}>
          <FilterPanel facets={facets} />
        </Suspense>

        <div className="workbench-table">
          {jobs.length === 0 ? (
            <div className="table-empty">
              No tasks found in this tab.
            </div>
          ) : grouped ? (
            Object.entries(grouped).map(([group, groupJobs]) => (
              <div key={group}>
                <div className="group-header">{group || "—"}</div>
                <JobTable jobs={groupJobs} />
              </div>
            ))
          ) : (
            <JobTable jobs={jobs} />
          )}
        </div>
      </div>
    </>
  );
}

function JobTable({ jobs }: { jobs: ReviewQueueJob[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Task ID</th>
          <th>Platform</th>
          <th>Flow</th>
          <th>Route</th>
          <th>Status</th>
          <th>QC</th>
          <th>Hook</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => {
          const gp = j.generation_payload ?? {};
          const hook = (gp.hook ?? gp.generated_hook ?? "") as string;
          return (
            <tr key={j.task_id}>
              <td className="task-id-cell">
                <Link href={`/t/${encodeURIComponent(j.task_id)}`}>
                  {j.task_id}
                </Link>
              </td>
              <td className="text-sm">{j.platform ?? "—"}</td>
              <td className="text-sm">{j.flow_type ?? "—"}</td>
              <td className="text-sm">{j.recommended_route ?? "—"}</td>
              <td>
                <StatusBadge decision={j.latest_decision} status={j.status} />
              </td>
              <td>
                {j.qc_status ? (
                  <span className="badge badge-qc">{j.qc_status}</span>
                ) : (
                  <span className="text-muted text-xs">—</span>
                )}
              </td>
              <td className="hook-cell">{hook || "—"}</td>
              <td>
                <Link
                  href={`/t/${encodeURIComponent(j.task_id)}`}
                  className="btn-open-row"
                >
                  Open →
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusBadge({
  decision,
  status,
}: {
  decision?: string | null;
  status?: string | null;
}) {
  const d = (decision ?? "").toUpperCase();
  if (d === "APPROVED")
    return <span className="badge badge-approved">Approved</span>;
  if (d === "REJECTED")
    return <span className="badge badge-rejected">Rejected</span>;
  if (d === "NEEDS_EDIT")
    return <span className="badge badge-needs-edit">Needs Edit</span>;
  return <span className="badge badge-review">{status ?? "Review"}</span>;
}

function groupJobs(
  jobs: ReviewQueueJob[],
  key: string
): Record<string, ReviewQueueJob[]> {
  const groups: Record<string, ReviewQueueJob[]> = {};
  for (const job of jobs) {
    const val =
      key === "platform"
        ? job.platform
        : key === "flow_type"
          ? job.flow_type
          : key === "recommended_route"
            ? job.recommended_route
            : key === "project"
              ? job.project_id
              : null;
    const groupKey = val ?? "—";
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(job);
  }
  return groups;
}
