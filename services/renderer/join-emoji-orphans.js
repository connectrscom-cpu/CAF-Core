"use strict";

/**
 * Merge lines that contain only emoji (no letters/digits) into the previous or
 * next text line so standalone emoji "paragraphs" do not render alone.
 */
function isEmojiOnlyLine(line) {
  const t = String(line).trim();
  if (!t) return false;
  if (/[\p{L}\p{N}]/u.test(t)) return false;
  if (!/\p{Extended_Pictographic}/u.test(t)) return false;
  const stripped = t
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0F\u200D\s#*•·.!?,;:'"()\-–—\[\]{}«»`]+/g, "");
  return stripped.length === 0;
}

function joinEmojiOrphanLines(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  if (lines.length === 0) return "";
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!isEmojiOnlyLine(line)) {
      out.push(line);
      i++;
      continue;
    }
    const run = [line.trim()];
    i++;
    while (i < lines.length && isEmojiOnlyLine(lines[i])) {
      run.push(lines[i].trim());
      i++;
    }
    const glue = run.join(" ");
    if (out.length > 0) {
      let k = out.length - 1;
      while (k >= 0 && !String(out[k]).trim()) k--;
      if (k >= 0) {
        out[k] = String(out[k]).replace(/\s+$/, "") + " " + glue;
        while (out.length > k + 1 && !String(out[out.length - 1]).trim()) out.pop();
      } else {
        let j = i;
        while (j < lines.length && (!String(lines[j]).trim() || isEmojiOnlyLine(lines[j]))) j++;
        if (j < lines.length) {
          lines[j] = glue + " " + String(lines[j]).replace(/^\s+/, "");
          i = j;
        } else out.push(glue);
      }
      continue;
    }
    let j = i;
    while (j < lines.length && (!String(lines[j]).trim() || isEmojiOnlyLine(lines[j]))) j++;
    if (j < lines.length) {
      lines[j] = glue + " " + String(lines[j]).replace(/^\s+/, "");
      i = j;
      continue;
    }
    out.push(glue);
  }
  return out.join("\n");
}

module.exports = { joinEmojiOrphanLines, isEmojiOnlyLine };
