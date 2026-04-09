function normWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function narrationLinesAlignedWithScript(
  scenes: Record<string, unknown>[],
  script: string
): string[] | null {
  const lines = scenes.map((sc) => String(sc.scene_narration_line ?? "").trim()).filter(Boolean);
  if (lines.length !== scenes.length || lines.length === 0) return null;
  const joined = lines.join(" ");
  const sw = normWords(script);
  const lw = normWords(joined);
  if (lw.length === 0 || sw.length === 0) return null;
  if (lw.join(" ") !== sw.join(" ")) return null;
  return lines;
}

export function narrationLinesLooseConcatMatchesScript(
  scenes: Record<string, unknown>[],
  script: string
): string[] | null {
  const lines = scenes.map((sc) => String(sc.scene_narration_line ?? "").trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const joined = normWords(lines.join(" ")).join(" ");
  const sw = normWords(script).join(" ");
  if (!joined || !sw) return null;
  if (joined !== sw) return null;
  return lines;
}

export function sceneNarrationLinesStrict(scenes: Record<string, unknown>[]): boolean {
  return scenes.every((sc) => String(sc.scene_narration_line ?? "").trim().length > 0);
}
