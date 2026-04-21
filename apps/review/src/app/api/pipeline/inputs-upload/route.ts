import { NextResponse } from "next/server";
import { uploadInputsEvidenceWorkbook } from "@/lib/caf-core-client";
import { reviewQueueFallbackSlug } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const fd = await request.formData();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    let projectSlug = (fd.get("project_slug") as string | null)?.trim() ?? "";
    if (!projectSlug) projectSlug = reviewQueueFallbackSlug();

    const forward = new FormData();
    forward.append("file", file);
    forward.append("project_slug", projectSlug);
    const notes = fd.get("notes");
    if (typeof notes === "string" && notes.trim()) forward.append("notes", notes.trim());

    const out = await uploadInputsEvidenceWorkbook(forward);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
