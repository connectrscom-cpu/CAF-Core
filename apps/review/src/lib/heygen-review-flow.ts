/** Single-take HeyGen flows in the workbench (not multi-scene assembly). */
export function isHeyGenReviewFlow(flowType: string | undefined): boolean {
  const ft = flowType ?? "";
  if (/scene_assembly|FLOW_SCENE|Video_Scene_Assembly/i.test(ft)) return false;
  return /heygen|HeyGen|Video_Script_HeyGen|Video_Prompt_HeyGen/i.test(ft);
}
