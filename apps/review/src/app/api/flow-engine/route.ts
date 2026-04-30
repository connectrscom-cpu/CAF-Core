import { NextResponse } from "next/server";
import { getFlowEngine } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

function stripLegacyFlowEngineRows(data: any) {
  const legacyToCanonical: Record<string, string> = {
    Flow_Carousel_Copy: "FLOW_CAROUSEL",
    Carousel_Angle_Extractor: "FLOW_ANGLE",
    Carousel_Slide_Architecture: "FLOW_STRUCTURE",
    CTA_Generator: "FLOW_CTA",
    Hook_Variations: "FLOW_HOOKS",
    Text_Post_Generator: "FLOW_TEXT",
    Video_Prompt_Generator: "FLOW_VID_PROMPT",
    Video_Script_Generator: "FLOW_VID_SCRIPT",
    Video_Scene_Generator: "FLOW_VID_SCENES",
  };
  const schemaLegacyToCanonical: Record<string, string> = {
    Carousel_Insight_Output: "OS_CAROUSEL",
    Carousel_Angle_Output: "OS_ANGLE",
    Carousel_Structure_Output: "OS_STRUCTURE",
    CTA_Output: "OS_CTA",
    Hook_Variations_Output: "OS_HOOKS",
    Text_Post_Output: "OS_TEXT",
    Video_Prompt_Output: "OS_VID_PROMPT",
    Video_Script_Output: "OS_VID_SCRIPT",
    Video_Scene_Generator_Output: "OS_VID_SCENES",
    Viral_Format_Output: "OS_VIRAL",
  };

  const flows = data?.flows ?? [];
  const canonSet = new Set(flows.map((f: any) => String(f.flow_type ?? "")).filter((x: string) => x.startsWith("FLOW_")));
  const hideLegacyFlow = (ft: string) => {
    const mapped = legacyToCanonical[ft];
    return mapped && canonSet.has(mapped);
  };

  const prompt_templates = (data?.prompts ?? []).filter((p: any) => !hideLegacyFlow(String(p.flow_type ?? "")));

  const schemaCanonPresent = new Set(
    (data?.schemas ?? []).map((s: any) => String(s.output_schema_name ?? "")).filter((n: string) => n.startsWith("OS_"))
  );
  const schemas = (data?.schemas ?? []).filter((s: any) => {
    const n = String(s.output_schema_name ?? "");
    const mapped = schemaLegacyToCanonical[n];
    if (!mapped) return true;
    return !schemaCanonPresent.has(mapped);
  });

  return {
    ...data,
    flows: flows.filter((f: any) => !hideLegacyFlow(String(f.flow_type ?? ""))),
    prompts: prompt_templates,
    schemas,
  };
}

export async function GET() {
  const data = await getFlowEngine();
  if (!data) return NextResponse.json({ error: "Failed to fetch flow engine" }, { status: 502 });
  return NextResponse.json(stripLegacyFlowEngineRows(data));
}
