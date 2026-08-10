import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { runArtifactStatus, runArtifactTransition } from "../../../src/cli/commands/artifact.js";
import {
  ArtifactValidationError,
  InvalidArtifactTransitionError,
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
        legalTargets: ["Approved", "Stale", "Abandoned", "Archived"],
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
    expect(text).toContain("Stale, Abandoned, Archived");
  });

  it("returns exit code 12 and surfaces the validation message on failure", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.fail(
        new ArtifactValidationError({
          path: "docs/plans/foo.md",
          message: 'docs/plans/foo.md has no "Status:" line in its header',
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactStatus("docs/plans/foo.md", out);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain('has no "Status:" line');
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

  it("archive: logs the resulting status and the new archived path", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Archived",
        path: "docs/specs/archive/21-artifact-lifecycle-status.md",
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactTransition(
      "docs/specs/21-artifact-lifecycle-status.md",
      "Archived",
      out,
    );

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Archived");
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
});
