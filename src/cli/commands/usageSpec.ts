import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The spec content must be piped to `usage … -f -` (stdin), never handed over
// as a path. External processes (like the `usage` CLI) cannot see deno's VFS
// where the embedded spec lives in the compiled binary.

function resolveSpecPath(): string {
  // Walk up 3 levels: commands/ → cli/ → src|dist/ → package root.
  return join(dirname(fileURLToPath(import.meta.url)), "../../../phax.usage.kdl");
}

export function readUsageSpec(): { found: true; content: string } | { found: false; path: string } {
  const path = resolveSpecPath();
  try {
    const content = readFileSync(path, "utf8");
    return { found: true, content };
  } catch {
    return { found: false, path };
  }
}
