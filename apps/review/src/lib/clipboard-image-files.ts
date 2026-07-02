/** Extract image files from a clipboard DataTransfer (screenshots, copied images). */
export function imageFilesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];

  const out: File[] = [];
  const seen = new Set<string>();

  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    const type = item.type || "";
    if (!type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) continue;
    const normalized = normalizeClipboardImageFile(file);
    const key = `${normalized.name}:${normalized.size}:${normalized.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  if (out.length > 0) return out;

  for (const file of Array.from(data.files)) {
    if (!file.type.startsWith("image/")) continue;
    const normalized = normalizeClipboardImageFile(file);
    const key = `${normalized.name}:${normalized.size}:${normalized.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function normalizeClipboardImageFile(file: File): File {
  const type = file.type || "image/png";
  const hasName = file.name && file.name.trim() && !/^image\d*\.(png|jpe?g|gif|webp)$/i.test(file.name);
  if (hasName) return file;

  const ext =
    type === "image/jpeg"
      ? "jpg"
      : type === "image/webp"
        ? "webp"
        : type === "image/gif"
          ? "gif"
          : "png";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return new File([file], `screenshot-${stamp}.${ext}`, { type });
}
