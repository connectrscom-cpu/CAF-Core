import type { TaskAssetPreview } from "@/lib/media-url";

const BUNDLE_VERSION = 1;

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickCarouselTemplateName(generationPayload: Record<string, unknown>): string {
  const gp = generationPayload ?? {};
  const go = asRec(gp.generated_output);
  const goRender = go ? asRec(go.render) : null;
  const gpRender = asRec(gp.render);
  const v =
    goRender?.html_template_name ??
    goRender?.template_key ??
    gpRender?.html_template_name ??
    gpRender?.template_key ??
    gp.template;
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.replace(/\.hbs$/i, "") : "";
}

function pickMimicCarouselPackage(gp: Record<string, unknown>): Record<string, unknown> | null {
  const snap = asRec(gp.draft_package_snapshot);
  if (snap?.package_type === "mimic_carousel_package") return snap;
  const go = asRec(gp.generated_output);
  if (go?.package_type === "mimic_carousel_package") return go;
  return snap;
}

function latestValidationFromJob(job: Record<string, unknown>): unknown {
  const fromJob = job.latest_validation_output_json ?? null;
  if (fromJob && typeof fromJob === "object") return fromJob;
  const reviews = Array.isArray(job.reviews) ? job.reviews : [];
  const first = reviews.map((r) => asRec(r)).find(Boolean);
  const out = first?.validation_output_json;
  if (out && typeof out === "object") return out;
  const snap = asRec(job.review_snapshot);
  const snapVo = snap?.validation_output;
  if (snapVo && typeof snapVo === "object") return snapVo;
  return null;
}

export interface TaskDebugBundleReviewerUi {
  edited_slides?: unknown[];
  edited_caption?: string;
  edited_title?: string;
  edited_hook?: string;
  edited_hashtags?: string;
  edited_script?: string;
  carousel_template?: string;
  has_unsaved_edits?: boolean;
  edits_summary?: string[];
}

export interface BuildTaskDebugBundleInput {
  taskId: string;
  projectSlug: string;
  page: "task_review" | "content_review";
  workbenchRow: Record<string, string | undefined> | null;
  fullJob: Record<string, unknown> | null;
  taskAssets: TaskAssetPreview[];
  upstreamLineage?: Record<string, unknown> | null;
  heygenSubmit?: Record<string, unknown> | null;
  mimicImageAudits?: unknown[] | null;
  reviewerUi?: TaskDebugBundleReviewerUi;
  exportedAt?: string;
}

export function buildTaskDebugBundle(input: BuildTaskDebugBundleInput): Record<string, unknown> {
  const job = input.fullJob ?? {};
  const gp = asRec(job.generation_payload) ?? {};
  const workbench = input.workbenchRow ?? {};

  const jobAssets = Array.isArray(job.assets) ? (job.assets as unknown[]) : null;
  const assetsFromJob = jobAssets
    ? jobAssets
        .map((a) => asRec(a))
        .filter(Boolean)
        .map((a) => ({
          id: a!.id ?? null,
          position: a!.position ?? null,
          asset_type: a!.asset_type ?? null,
          public_url: a!.public_url ?? null,
          bucket: a!.bucket ?? null,
          object_path: a!.object_path ?? null,
        }))
    : input.taskAssets.map((a) => ({
        position: a.position,
        asset_type: a.asset_type ?? null,
        public_url: a.public_url,
        media_kind: a.kind,
      }));

  const assetUrlsFlat = [
    ...new Set(
      assetsFromJob
        .map((a) => (typeof a.public_url === "string" ? a.public_url.trim() : ""))
        .filter(Boolean)
    ),
  ];

  const previewUrl = (workbench.preview_url ?? "").trim();
  const videoUrl = (workbench.video_url ?? "").trim();
  if (previewUrl && !assetUrlsFlat.includes(previewUrl)) assetUrlsFlat.unshift(previewUrl);
  if (videoUrl && !assetUrlsFlat.includes(videoUrl)) assetUrlsFlat.push(videoUrl);

  const templateUsed = pickCarouselTemplateName(gp);
  const mimicPackage = pickMimicCarouselPackage(gp);

  const latestValidation = latestValidationFromJob(job);
  const reviewedContent =
    latestValidation && typeof latestValidation === "object" && !Array.isArray(latestValidation)
      ? (latestValidation as Record<string, unknown>).reviewed_content ?? null
      : null;

  return {
    _caf_debug_bundle_version: BUNDLE_VERSION,
    purpose:
      "One-shot export from CAF Review for debugging a failed or wrong generation in Cursor. " +
      "Describe what looks wrong after pasting.",
    exported_at: input.exportedAt ?? new Date().toISOString(),
    review_page: input.page,
    ids: {
      task_id: String(job.task_id ?? input.taskId).trim() || input.taskId,
      run_id: String(job.run_id ?? workbench.run_id ?? "").trim() || null,
      candidate_id: job.candidate_id ?? null,
      project_id: job.project_id ?? null,
      project_slug: String(job.project_slug ?? input.projectSlug).trim() || input.projectSlug,
      job_uuid: job.id ?? null,
    },
    status: {
      job_status: job.status ?? workbench.review_status ?? null,
      qc_status: job.qc_status ?? workbench.qc_status ?? null,
      recommended_route: job.recommended_route ?? workbench.recommended_route ?? null,
      pre_gen_score: job.pre_gen_score ?? workbench.risk_score ?? null,
      latest_decision: job.latest_decision ?? workbench.decision ?? null,
      latest_notes: job.latest_notes ?? workbench.notes ?? null,
      latest_rejection_tags: job.latest_rejection_tags ?? workbench.latest_rejection_tags ?? null,
      platform: job.platform ?? workbench.platform ?? null,
      flow_type: job.flow_type ?? workbench.flow_type ?? null,
    },
    asset_urls_flat: assetUrlsFlat,
    assets: assetsFromJob,
    workbench_row: workbench,
    upstream_lineage: input.upstreamLineage ?? null,
    heygen_last_submit: input.heygenSubmit ?? null,
    mimic_image_audits: input.mimicImageAudits ?? null,
    carousel_inspect: {
      template_used: templateUsed || null,
      template_path_hint: templateUsed ? `services/renderer/templates/${templateUsed}.hbs` : null,
    },
    draft_package_snapshot: gp.draft_package_snapshot ?? null,
    draft_package_meta: {
      draft_package_type: gp.draft_package_type ?? null,
      draft_package_warnings: gp.draft_package_warnings ?? [],
      draft_package_errors: gp.draft_package_errors ?? [],
    },
    mimic_carousel_package: mimicPackage,
    mimic_v1: gp.mimic_v1 ?? null,
    render_manifest: gp.render_manifest ?? null,
    generation_payload: Object.keys(gp).length > 0 ? gp : null,
    render_state: job.render_state ?? null,
    scene_bundle_state: job.scene_bundle_state ?? null,
    review_slides_json: job.review_slides_json ?? null,
    review_snapshot: job.review_snapshot ?? null,
    reviews: job.reviews ?? null,
    auto_validation: job.auto_validation ?? null,
    latest_validation_output: latestValidation,
    latest_reviewed_content: reviewedContent,
    latest_overrides_json: job.latest_overrides_json ?? null,
    reviewer_ui: input.reviewerUi ?? null,
  };
}

/** Markdown + JSON block optimized for pasting into Cursor chat. */
export function formatTaskDebugBundleForClipboard(bundle: Record<string, unknown>): string {
  const ids = asRec(bundle.ids) ?? {};
  const status = asRec(bundle.status) ?? {};
  const taskId = String(ids.task_id ?? "").trim();
  const flow = String(status.flow_type ?? "").trim();
  const platform = String(status.platform ?? "").trim();
  const urls = Array.isArray(bundle.asset_urls_flat) ? (bundle.asset_urls_flat as string[]) : [];

  const lines: string[] = [
    "# CAF generation debug bundle",
    "",
    "Paste this into Cursor and describe what looks wrong with this generation.",
    "",
    `**task_id:** \`${taskId}\``,
  ];
  if (ids.run_id) lines.push(`**run_id:** \`${String(ids.run_id)}\``);
  if (flow) lines.push(`**flow_type:** \`${flow}\``);
  if (platform) lines.push(`**platform:** ${platform}`);
  const decision = String(status.latest_decision ?? "").trim();
  if (decision) lines.push(`**latest_decision:** ${decision}`);
  const qc = String(status.qc_status ?? "").trim();
  if (qc) lines.push(`**qc_status:** ${qc}`);

  if (urls.length > 0) {
    lines.push("", "## Asset & preview URLs");
    for (const u of urls) lines.push(`- ${u}`);
  }

  lines.push("", "## Full JSON", "", "```json", JSON.stringify(bundle, null, 2), "```");
  return lines.join("\n");
}
