export function fitSpokenScriptToWordBudget(
  script: string,
  _clipDursSec: number[],
  maxWords: number
): { script: string; trimmed: boolean; wordsBefore: number; wordsAfter: number } {
  const words = script.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
  const wordsBefore = words.length;
  if (words.length <= maxWords) {
    return { script, trimmed: false, wordsBefore, wordsAfter: words.length };
  }
  const cut = words.slice(0, maxWords).join(" ");
  return { script: cut, trimmed: true, wordsBefore, wordsAfter: maxWords };
}
