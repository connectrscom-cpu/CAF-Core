/** Minimal CSV parser: handles quoted fields and \r\n. */

export function parseCsvToRecords(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  function parseRow(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let i = 0;
    let inQ = false;
    while (i < line.length) {
      const c = line[i]!;
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 2;
            continue;
          }
          inQ = false;
          i += 1;
          continue;
        }
        cur += c;
        i += 1;
        continue;
      }
      if (c === '"') {
        inQ = true;
        i += 1;
        continue;
      }
      if (c === ",") {
        out.push(cur);
        cur = "";
        i += 1;
        continue;
      }
      cur += c;
      i += 1;
    }
    out.push(cur);
    return out;
  }

  const header = parseRow(lines[0]!).map((h) => h.trim().replace(/^\uFEFF/, ""));
  const rows: Record<string, string>[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = parseRow(lines[li]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = cells[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}
