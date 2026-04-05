import Link from "next/link";
import { PROJECT_SLUG } from "@/lib/env";
import { getJobDetail } from "@/lib/caf-core-client";
import { DecisionForm } from "./DecisionForm";

export default async function TaskPage({ params }: { params: { task_id: string } }) {
  const taskId = decodeURIComponent(params.task_id);
  const job = await getJobDetail(PROJECT_SLUG, taskId);

  if (!job) {
    return (
      <>
        <Link href="/" className="detail-back">← Back to queue</Link>
        <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--muted)" }}>
          Task <strong>{taskId}</strong> not found.
        </div>
      </>
    );
  }

  const gp = job.generation_payload ?? {};
  const hook = (gp.hook ?? gp.generated_hook ?? "") as string;
  const title = (gp.title ?? gp.generated_title ?? "") as string;
  const caption = (gp.caption ?? gp.generated_caption ?? "") as string;
  let slides: unknown[] = [];
  try {
    const raw = gp.slides ?? gp.generated_slides_json;
    if (typeof raw === "string") slides = JSON.parse(raw);
    else if (Array.isArray(raw)) slides = raw;
  } catch { /* ignore */ }

  const videoAsset = job.assets.find((a) => a.asset_type === "final_video")
    ?? job.assets.find((a) => a.asset_type === "merged_video");
  const videoUrl = videoAsset?.public_url ?? null;

  const isDecided = !!job.latest_decision;
  const backTab = isDecided
    ? (job.latest_decision === "APPROVED" ? "approved" : job.latest_decision === "REJECTED" ? "rejected" : "needs_edit")
    : "in_review";

  return (
    <>
      <Link href={`/?status=${backTab}`} className="detail-back">← Back to queue</Link>
      <h2 className="detail-title">{taskId}</h2>
      <div className="detail-subtitle">
        {job.platform ?? "—"} · {job.flow_type ?? "—"} · {job.recommended_route ?? "—"}
      </div>

      <div className="detail-grid">
        {/* Left: Content */}
        <div>
          <div className="card mb-3">
            <div className="card-header">Content</div>

            {title && (
              <div className="content-block">
                <div className="content-block-label">Title</div>
                <div className="content-block-text">{title}</div>
              </div>
            )}

            {hook && (
              <div className="content-block">
                <div className="content-block-label">Hook</div>
                <div className="content-block-text">{hook}</div>
              </div>
            )}

            {caption && (
              <div className="content-block">
                <div className="content-block-label">Caption</div>
                <div className="content-block-text">{caption}</div>
              </div>
            )}

            {videoUrl && (
              <div className="content-block">
                <div className="content-block-label">Video</div>
                <video src={videoUrl} controls style={{ width: "100%", borderRadius: 8, marginTop: 4 }} />
              </div>
            )}

            {slides.length > 0 && (
              <div className="content-block">
                <div className="content-block-label">Slides ({slides.length})</div>
                <pre className="slides-json">{JSON.stringify(slides, null, 2)}</pre>
              </div>
            )}
          </div>

          {job.assets.length > 0 && (
            <div className="card">
              <div className="card-header">Assets ({job.assets.length})</div>
              <div className="assets-grid">
                {job.assets.map((a, i) => (
                  <a
                    key={a.id}
                    href={a.public_url ?? "#"}
                    target="_blank"
                    rel="noopener"
                    className="asset-link"
                  >
                    {a.asset_type ?? "asset"} #{i + 1}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Info + Decision */}
        <div>
          <div className="card mb-3">
            <div className="card-header">Details</div>
            {([
              ["Platform", job.platform],
              ["Flow type", job.flow_type],
              ["Recommended route", job.recommended_route],
              ["QC status", job.qc_status],
              ["Pre-gen score", job.pre_gen_score],
              ["Run ID", job.run_id],
              ["Status", job.status],
              ["Created", job.created_at ? new Date(job.created_at).toLocaleString() : null],
            ] as [string, string | null][]).map(([k, v]) => (
              <div key={k} className="info-row">
                <span className="info-label">{k}</span>
                <span className="info-value">{v ?? "—"}</span>
              </div>
            ))}
          </div>

          {job.auto_validation && (
            <div className="card mb-3">
              <div className="card-header">Auto-validation</div>
              {([
                ["Overall", job.auto_validation.overall_score],
                ["Hook score", job.auto_validation.hook_score],
                ["Clarity", job.auto_validation.clarity_score],
                ["Format OK", job.auto_validation.format_ok ? "Yes" : "No"],
                ["Pass", job.auto_validation.pass_auto ? "Yes" : "No"],
              ] as [string, string | null][]).map(([k, v]) => (
                <div key={k} className="info-row">
                  <span className="info-label">{k}</span>
                  <span className="info-value">{v ?? "—"}</span>
                </div>
              ))}
            </div>
          )}

          <div className="card mb-3">
            <div className="card-header">Decision</div>
            {!isDecided ? (
              <DecisionForm taskId={taskId} project={PROJECT_SLUG} />
            ) : (
              <div>
                <div className="info-row">
                  <span className="info-label">Verdict</span>
                  <span className="info-value">
                    <StatusBadge decision={job.latest_decision} />
                  </span>
                </div>
                {job.latest_notes && (
                  <div className="info-row">
                    <span className="info-label">Notes</span>
                    <span className="info-value" style={{ fontSize: 12 }}>{job.latest_notes}</span>
                  </div>
                )}
                {job.latest_validator && (
                  <div className="info-row">
                    <span className="info-label">Reviewer</span>
                    <span className="info-value">{job.latest_validator}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {job.reviews.length > 1 && (
            <div className="card">
              <div className="card-header">Review History</div>
              {job.reviews.map((r) => (
                <div key={r.id} className="review-history-item">
                  <span style={{ color: "var(--fg)", fontWeight: 600 }}>
                    {r.decision ?? "—"}
                  </span>
                  {r.validator && (
                    <span className="text-muted"> by {r.validator}</span>
                  )}
                  {r.submitted_at && (
                    <span className="text-muted"> · {new Date(r.submitted_at).toLocaleString()}</span>
                  )}
                  {r.notes && (
                    <div className="text-muted text-xs mt-2">{r.notes}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StatusBadge({ decision }: { decision?: string | null }) {
  const d = (decision ?? "").toUpperCase();
  if (d === "APPROVED") return <span className="badge badge-approved">Approved</span>;
  if (d === "REJECTED") return <span className="badge badge-rejected">Rejected</span>;
  if (d === "NEEDS_EDIT") return <span className="badge badge-needs-edit">Needs Edit</span>;
  return <span className="badge badge-review">Pending</span>;
}
