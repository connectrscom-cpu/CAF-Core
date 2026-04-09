export function buildSceneAssemblyGlobalVisualContext(args: {
  gen: Record<string, unknown>;
  bundle: Record<string, unknown>;
}): string {
  const parts: string[] = [];
  const style = args.gen.visual_style ?? args.gen.brand_visual_notes ?? args.bundle.visual_style;
  if (typeof style === "string" && style.trim()) parts.push(style.trim());
  const mood = args.gen.mood ?? args.bundle.mood;
  if (typeof mood === "string" && mood.trim()) parts.push(`Mood: ${mood.trim()}`);
  return parts.join(" · ");
}
