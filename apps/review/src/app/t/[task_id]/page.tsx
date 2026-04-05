import Link from "next/link";
import { PROJECT_SLUG } from "@/lib/env";
import { getJobDetail } from "@/lib/caf-core-client";
import { DecisionForm } from "./DecisionForm";

export default async function TaskPage({ params }: { params: { task_id: string } }) {
  const taskId = decodeURIComponent(params.task_id);
  const job = await getJobDetail(PROJECT_SLUG, taskId);

  if (!job) {
    return (
      <main className="container">
        <Link href="/">&larr; Back</Link>
        <p className="mt-4" style={{ color: "var(--muted)" }}>Task not found.</p>
      </main>
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
  } catch {}

  const videoAsset = job.assets.find((a) => a.asset_type === "final_video")
    ?? job.assets.find((a) => a.asset_type === "merged_video");
  const videoUrl = videoAsset?.public_url ?? null;

  const isDecided = !!job.latest_decision;
  const backTab = isDecided
    ? (job.latest_decision === "APPROVED" ? "approved" : job.latest_decision === "REJECTED" ? "rejected" : "needs_edit")
    : "in_review";

  return (
    <main className="container">
      <Link href={`/?tab=${backTab}`}>&larr; Back to queue</Link>
      <h2 className="mt-4" style={{ fontSize: 20, fontWeight: 600 }}>{taskId}</h2>

      <div className="grid-2 mt-4">
        <div className="card">
          <h3 style={{ fontSize: 14, color: "var(--muted)", marginBottom: 12 }}>Content</h3>
          {title && <p><strong>Title:</strong> {title}</p>}
          {hook && <p className="mt-4"><strong>Hook:</strong> {hook}</p>}
          {caption && (
            <p className="mt-4" style={{ whiteSpace: "pre-wrap" }}><strong>Caption:</strong> {caption}</p>
          )}
          {videoUrl && (
            <div className="mt-4">
              <video src={videoUrl} controls style={{ width: "100%", borderRadius: 8 }} />
            </div>
          )}
          {slides.length > 0 && (
            <div className="mt-4">
              <strong>Slides ({slides.length})</strong>
              <pre style={{ fontSize: 11, overflow: "auto", maxHeight: 300, marginTop: 8, background: "#111", padding: 8, borderRadius: 6 }}>
                {JSON.stringify(slides, null, 2)}
              </pre>
            </div>
          )}
          {job.assets.length > 0 && (
            <div className="mt-4">
              <strong>Assets ({job.assets.length})</strong>
              <div className="flex gap-2 mt-4" style={{ flexWrap: "wrap", gap: 8 }}>
                {job.assets.map((a, i) => (
                  <a key={a.id} href={a.public_url ?? "#"} target="_blank" rel="noopener" style={{ fontSize: 12, color: "var(--accent)" }}>
                    {a.asset_type ?? "asset"} #{i + 1}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ fontSize: 14, color: "var(--muted)", marginBottom: 12 }}>Info</h3>
          <table style={{ fontSize: 13 }}>
            <tbody>
              {([
                ["Platform", job.platform],
                ["Flow", job.flow_type],
                ["Route", job.recommended_route],
                ["QC", job.qc_status],
                ["Pre-gen Score", job.pre_gen_score],
                ["Run", job.run_id],
              ] as [string, string | null][]).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ color: "var(--muted)", width: 110 }}>{k}</td>
                  <td>{v ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {job.auto_validation && (
            <div className="mt-4">
              <h3 style={{ fontSize: 14, color: "var(--muted)", marginBottom: 8 }}>Auto-validation</h3>
              <table style={{ fontSize: 12 }}>
                <tbody>
                  <tr><td style={{ color: "var(--muted)" }}>Overall</td><td>{job.auto_validation.overall_score ?? "-"}</td></tr>
                  <tr><td style={{ color: "var(--muted)" }}>Hook</td><td>{job.auto_validation.hook_score ?? "-"}</td></tr>
                  <tr><td style={{ color: "var(--muted)" }}>Clarity</td><td>{job.auto_validation.clarity_score ?? "-"}</td></tr>
                  <tr><td style={{ color: "var(--muted)" }}>Pass</td><td>{job.auto_validation.pass_auto ? "Yes" : "No"}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {!isDecided && (
            <div className="mt-4">
              <h3 style={{ fontSize: 14, color: "var(--muted)", marginBottom: 12 }}>Decision</h3>
              <DecisionForm taskId={taskId} project={PROJECT_SLUG} />
            </div>
          )}

          {isDecided && (
            <div className="mt-4">
              <h3 style={{ fontSize: 14, color: "var(--muted)", marginBottom: 8 }}>Decision</h3>
              <p><strong style={{ color: "var(--fg)" }}>{job.latest_decision}</strong></p>
              {job.latest_notes && <p className="mt-4" style={{ fontSize: 13, color: "var(--muted)" }}>{job.latest_notes}</p>}
              {job.latest_validator && <p style={{ fontSize: 12, color: "var(--muted)" }}>by {job.latest_validator}</p>}
            </div>
          )}

          {job.reviews.length > 1 && (
            <div className="mt-4">
              <h3 style={{ fontSize: 14, color: "var(--muted)", marginBottom: 8 }}>Review History</h3>
              {job.reviews.map((r) => (
                <div key={r.id} style={{ marginBottom: 8, fontSize: 12, color: "var(--muted)" }}>
                  <span style={{ color: "var(--fg)" }}>{r.decision ?? "—"}</span>
                  {r.validator && <span> by {r.validator}</span>}
                  {r.submitted_at && <span> at {new Date(r.submitted_at).toLocaleString()}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
