import Link from "next/link";
import { PROJECT_SLUG } from "@/lib/env";
import { getJobDetail } from "@/lib/caf-core-client";

export default async function ContentPage({ params }: { params: { task_id: string } }) {
  const taskId = decodeURIComponent(params.task_id);
  const job = await getJobDetail(PROJECT_SLUG, taskId);

  if (!job) {
    return (
      <main className="container">
        <Link href="/">&larr; Home</Link>
        <p className="mt-4" style={{ color: "var(--muted)" }}>Content not found.</p>
      </main>
    );
  }

  const gp = job.generation_payload ?? {};
  const hook = (gp.hook ?? gp.generated_hook ?? "") as string;
  const caption = (gp.caption ?? gp.generated_caption ?? "") as string;
  const videoAsset = job.assets.find((a) => a.asset_type === "final_video")
    ?? job.assets.find((a) => a.asset_type === "merged_video");
  const videoUrl = videoAsset?.public_url ?? null;

  return (
    <main className="container">
      <Link href="/">&larr; Home</Link>
      <h2 className="mt-4" style={{ fontSize: 20, fontWeight: 600 }}>{taskId}</h2>
      <div className="card mt-4">
        {hook && <p><strong>Hook:</strong> {hook}</p>}
        {caption && <p className="mt-4" style={{ whiteSpace: "pre-wrap" }}>{caption}</p>}
        {videoUrl && (
          <div className="mt-4">
            <video src={videoUrl} controls style={{ width: "100%", maxWidth: 640, borderRadius: 8 }} />
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
    </main>
  );
}
