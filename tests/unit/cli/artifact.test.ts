import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { runArtifactStatus, runArtifactTransition } from "../../../src/cli/commands/artifact.js";
import {
  ArtifactCommitFailedError,
  ArtifactDirtyWriteSetError,
  ArtifactValidationError,
  InvalidArtifactTransitionError,
  SpecNotApprovedError,
  SpecRetirementBlockedError,
} from "../../../src/domain/errors.js";

vi.mock("../../../src/app/artifactStatus.js", () => ({
  inspectArtifact: vi.fn(),
  transitionArtifact: vi.fn(),
}));

function makeOutput() {
  const lines: string[] = [];
  const errors: string[] = [];
  const out = {
    log: (m: string) => lines.push(m),
    warn: (m: string) => lines.push(`WARN: ${m}`),
    error: (m: string) => errors.push(m),
  };
  return { out, lines, errors };
}

describe("runArtifactStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names kind, status, and legal transitions, exits 0", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.succeed({
        kind: "plan",
        status: "Approved",
        legalTargets: ["Approved", "Stale", "Abandoned", "Completed"],
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactStatus("docs/plans/45-typescript-7-migration-plan.md", out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Kind:");
    expect(text).toContain("plan");
    expect(text).toContain("Status:");
    expect(text).toContain("Approved");
    expect(text).toContain("Legal transitions:");
    expect(text).toContain("Stale, Abandoned, Completed");
  });

  it("returns exit code 12 and surfaces the validation message on failure", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.fail(
        new ArtifactValidationError({
          path: "docs/plans/foo.md",
          message:
            "docs/plans/foo.md has no frontmatter block — lifecycle metadata must be YAML frontmatter",
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactStatus("docs/plans/foo.md", out);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("has no frontmatter block");
  });
});

describe("runArtifactTransition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approve: logs the resulting status without a path line, exits 0", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        path: "docs/plans/45-typescript-7-migration-plan.md",
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/45-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Approved");
    expect(lines.some((l) => l.startsWith("Path:"))).toBe(false);
  });

  it("complete: logs the resulting status and the new archived path", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Completed",
        path: "docs/specs/archive/21-artifact-lifecycle-status.md",
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactTransition(
      "docs/specs/21-artifact-lifecycle-status.md",
      "Completed",
      out,
    );

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Completed");
    expect(text).toContain("docs/specs/archive/21-artifact-lifecycle-status.md");
  });

  it("returns exit code 12 and names the legal targets on an illegal transition", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.fail(
        new InvalidArtifactTransitionError({
          kind: "plan",
          from: "Draft",
          to: "Stale",
          legalTargets: ["Approved", "Abandoned"],
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/45-typescript-7-migration-plan.md",
      "Stale",
      out,
    );

    expect(code).toBe(12);
    const text = errors.join("\n");
    expect(text).toContain("Approved, Abandoned");
  });

  it("approve of a plan with a captured baseline logs the short sha", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        path: "docs/plans/45-typescript-7-migration-plan.md",
        approvedBaseline: "abcdef1234567890abcdef1234567890abcdef12",
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/45-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).toBe(0);
    expect(lines.some((l) => l === "Baseline: abcdef1")).toBe(true);
  });

  it("returns exit code 12 when the declared spec is not approved", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.fail(
        new SpecNotApprovedError({
          planPath: "docs/plans/45-typescript-7-migration-plan.md",
          specPath: "docs/specs/22-foo.md",
          specStatus: "Draft",
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/45-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("approve the spec first");
  });

  it("returns exit code 12 when spec retirement is blocked by a live dependent", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.fail(
        new SpecRetirementBlockedError({
          specPath: "docs/specs/22-foo.md",
          dependents: [
            { path: "docs/plans/45-typescript-7-migration-plan.md", status: "Approved" },
          ],
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactTransition("docs/specs/22-foo.md", "Completed", out);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("abandon or complete them first");
  });

  it("always passes commit: true to the use case", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        path: "docs/plans/45-typescript-7-migration-plan.md",
      }),
    );

    const { out } = makeOutput();
    await runArtifactTransition("docs/plans/45-typescript-7-migration-plan.md", "Approved", out);

    expect(transitionArtifact).toHaveBeenCalledWith(
      "docs/plans/45-typescript-7-migration-plan.md",
      "Approved",
      expect.objectContaining({ commit: true }),
    );
  });

  it("renders the Commit: line with hash and subject when a commit was created", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        path: "docs/plans/45-typescript-7-migration-plan.md",
        commit: {
          hash: "3f2a1c9abcdef1234567890abcdef1234567890",
          subject: "chore(plans): approve 45-typescript-7-migration-plan",
        },
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/45-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).toBe(0);
    expect(
      lines.some(
        (l) => l === "Commit: 3f2a1c9 — chore(plans): approve 45-typescript-7-migration-plan",
      ),
    ).toBe(true);
  });

  it("omits the Commit: line when no commit was created", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        path: "docs/plans/45-typescript-7-migration-plan.md",
      }),
    );

    const { out, lines } = makeOutput();
    await runArtifactTransition("docs/plans/45-typescript-7-migration-plan.md", "Approved", out);

    expect(lines.some((l) => l.startsWith("Commit:"))).toBe(false);
  });

  it("returns exit code 12 when the write-set target is dirty", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.fail(
        new ArtifactDirtyWriteSetError({
          paths: ["docs/plans/45-typescript-7-migration-plan.md"],
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/45-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("commit or stash them first");
  });

  it("returns a non-zero exit code when the transition commit fails", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.fail(
        new ArtifactCommitFailedError({
          paths: ["docs/plans/45-typescript-7-migration-plan.md"],
          cause: "pre-commit hook failed",
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/45-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).not.toBe(0);
    expect(code).not.toBe(12);
    expect(errors.join("\n")).toContain("commit failed");
  });
});
