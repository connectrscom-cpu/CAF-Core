import Link from "next/link";
import { PROJECT_SLUG } from "@/lib/env";
import { getJobDetail } from "@/lib/caf-core-client";

export default async function ContentPage({ params }: { params: { task_id: string } }) {
  const taskId = decodeURIComponent(params.task_id);
  const job = await getJobDetail(PROJECT_SLUG, taskId);

  if (!job) {
    return (
      <>
        <Link href="/" className="detail-back">← Home</Link>
        <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--muted)" }}>
          Content not found.
        </div>
      </>
    );
  }

  const gp = job.generation_payload ?? {};
  const hook = (gp.hook ?? gp.generated_hook ?? "") as string;
  const caption = (gp.caption ?? gp.generated_caption ?? "") as string;
  const videoAsset = job.assets.find((a) => a.asset_type === "final_video")
    ?? job.assets.find((a) => a.asset_type === "merged_video");
  const videoUrl = videoAsset?.public_url ?? null;

  return (
    <>
      <Link href="/" className="detail-back">← Home</Link>
      <h2 className="detail-title">{taskId}</h2>

      <div style={{ padding: "0 28px 28px" }}>
        <div className="card">
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
              <video src={videoUrl} controls style={{ width: "100%", maxWidth: 640, borderRadius: 8, marginTop: 4 }} />
            </div>
          )}
          {job.assets.length > 0 && (
            <div className="content-block">
              <div className="content-block-label">Assets ({job.assets.length})</div>
              <div className="assets-grid">
                {job.assets.map((a, i) => (
                  <a key={a.id} href={a.public_url ?? "#"} target="_blank" rel="noopener" className="asset-link">
                    {a.asset_type ?? "asset"} #{i + 1}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
