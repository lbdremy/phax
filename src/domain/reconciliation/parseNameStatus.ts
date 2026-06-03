import type { NameStatusEntry } from "./types.js";

export function parseNameStatus(stdout: string): readonly NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split("\t");
    const code = parts[0] ?? "";

    if (code.startsWith("R")) {
      const oldPath = parts[1];
      const newPath = parts[2];
      if (oldPath && newPath) {
        entries.push({ status: "renamed", path: newPath.trim(), oldPath: oldPath.trim() });
      }
    } else if (code.startsWith("C")) {
      const newPath = parts[2];
      if (newPath) {
        entries.push({ status: "added", path: newPath.trim() });
      }
    } else if (code === "A") {
      const path = parts[1];
      if (path) entries.push({ status: "added", path: path.trim() });
    } else if (code === "M") {
      const path = parts[1];
      if (path) entries.push({ status: "modified", path: path.trim() });
    } else if (code === "D") {
      const path = parts[1];
      if (path) entries.push({ status: "deleted", path: path.trim() });
    }
    // unknown codes are silently skipped
  }

  return entries;
}
