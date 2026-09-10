import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.length > 0);
}

const PRE_MIGRATION_PATH = /docs\/(specs|plans)\/(archive\/)?[0-9]{2}[a-z]?-/;

// Test fixtures that name an old-grammar path on purpose, to assert the
// refusal. They are stripped from a test file's text before the scan so the
// rest of that file stays guarded.
const DELIBERATE_REFUSAL_FIXTURES: readonly string[] = ["docs/specs/34-foo.md"];

// The regex above also matches text that was never a real artifact path: the
// timestamp-naming spec/plan quote the old grammar verbatim in their own
// before/after illustration (rewriting them would corrupt the very history
// they document, and would invalidate their recorded approval fingerprint);
// several already-archived plans/specs use small counters in *hypothetical*
// CLI examples that were never backed by a file; and `phax artifact new`'s remaining
// fictitious example paths in cliDocs.ts, its generated contract files, and
// README.md are phase-04/05 scope. Each entry here was individually checked
// against the phase-02 migration mapping to confirm it names no real old
// path that should have been rewritten.
const KNOWN_NON_MIGRATION_MATCHES: ReadonlySet<string> = new Set([
  "README.md",
  "docs/blog/announcing-phax-1.0.md",
  "docs/cli/reference.md",
  "docs/plans/2609100902-artifact-timestamp-naming-plan.md",
  "docs/plans/archive/2606090853-review-handoff-plan.md",
  "docs/plans/archive/2606261007-plans-overlap-command-plan.md",
  "docs/plans/archive/2607101034-gate-profile-attributed-steps-plan.md",
  "docs/plans/archive/2608101018-artifact-lifecycle-status-plan.md",
  "docs/plans/archive/2609080902-plan-lint-plan.md",
  "docs/specs/2609091040-artifact-timestamp-naming.md",
  "docs/specs/archive/2608091526-artifact-lifecycle-status.md",
  "docs/specs/archive/2608091526-plan-staleness-lineage.md",
  "docs/specs/archive/2608110950-artifact-frontmatter-metadata.md",
  "docs/specs/archive/2608121241-rename-archived-to-completed.md",
  "docs/specs/archive/2608121241-run-carries-archival.md",
  "docs/specs/archive/2609030749-spec-approval-ground.md",
  "docs/specs/archive/2609080848-plan-lint.md",
  "phax.usage.kdl",
  "src/cli/cliDocs.ts",
]);

describe("artifact name migration guard", () => {
  it("no tracked file, tests included, names a pre-migration artifact path", () => {
    const offenders: string[] = [];
    for (const relPath of trackedFiles()) {
      if (KNOWN_NON_MIGRATION_MATCHES.has(relPath)) continue;
      let text = readFileTextSafe(join(repoRoot, relPath));
      if (text !== null && relPath.startsWith("tests/")) {
        for (const fixture of DELIBERATE_REFUSAL_FIXTURES) text = text.replaceAll(fixture, "");
      }
      if (text !== null && PRE_MIGRATION_PATH.test(text)) {
        offenders.push(relPath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("each artifact directory lists file names with non-decreasing stamps", () => {
    const dirs = ["docs/specs", "docs/specs/archive", "docs/plans", "docs/plans/archive"];
    for (const dir of dirs) {
      const names = readdirSync(join(repoRoot, dir))
        .filter((n) => n.endsWith(".md"))
        .toSorted();
      const stamps = names.map((n) => n.slice(0, 10));
      const sortedStamps = [...stamps].toSorted();
      expect(stamps, `${dir} listing order should be creation order`).toEqual(sortedStamps);
    }
  });
});

function readFileTextSafe(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}
