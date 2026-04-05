import Link from "next/link";
import { PROJECT_SLUG } from "@/lib/env";
import { getQueueTab, getQueueCounts, type ReviewTab } from "@/lib/caf-core-client";

const TABS = [
  { key: "in_review", label: "In Review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "needs_edit", label: "Needs Edit" },
] as const;

export default async function Home({ searchParams }: { searchParams: { tab?: string } }) {
  const currentTab = (TABS.find((t) => t.key === searchParams.tab)?.key ?? "in_review") as ReviewTab;
  const [jobs, counts] = await Promise.all([
    getQueueTab(PROJECT_SLUG, currentTab),
    getQueueCounts(PROJECT_SLUG),
  ]);

  return (
    <main className="container">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>CAF Review</h1>
      <div className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/?tab=${t.key}`} className={`tab ${currentTab === t.key ? "active" : ""}`}>
            {t.label} ({counts[t.key as ReviewTab]})
          </Link>
        ))}
      </div>
      <div className="card">
        {jobs.length === 0 ? (
          <p style={{ color: "var(--muted)", padding: 40, textAlign: "center" }}>No tasks in this tab.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Task ID</th>
                <th>Flow</th>
                <th>Platform</th>
                <th>Status</th>
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
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{j.task_id}</td>
                    <td>{j.flow_type ?? "-"}</td>
                    <td>{j.platform ?? "-"}</td>
                    <td><StatusBadge decision={j.latest_decision} status={j.status} /></td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {hook || "-"}
                    </td>
                    <td>
                      <Link
                        href={`/t/${encodeURIComponent(j.task_id)}`}
                        className="btn-ghost"
                        style={{ padding: "4px 12px", fontSize: 12 }}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ decision, status }: { decision?: string | null; status?: string | null }) {
  const d = (decision ?? "").toUpperCase();
  if (d === "APPROVED") return <span className="badge badge-approved">Approved</span>;
  if (d === "REJECTED") return <span className="badge badge-rejected">Rejected</span>;
  if (d === "NEEDS_EDIT") return <span className="badge badge-needs-edit">Needs Edit</span>;
  return <span className="badge badge-review">{status ?? "Review"}</span>;
}
