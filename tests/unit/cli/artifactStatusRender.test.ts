import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { runArtifactStatus } from "../../../src/cli/commands/artifact.js";

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

describe("runArtifactStatus — approval rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recorded and not edited: prints Approved date/baseline and 'Edited since: no'", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.succeed({
        kind: "spec",
        status: "Approved",
        legalTargets: ["Approved", "Abandoned", "Completed"],
        approval: {
          kind: "recorded",
          date: "2026-09-01",
          baseline: "abc1234",
          editedSinceApproval: false,
        },
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactStatus("docs/specs/2609101231-spec-approval-ground.md", out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Approved:          2026-09-01 @ abc1234");
    expect(text).toContain("Edited since:      no");
  });

  it("recorded and edited: prints Approved date/baseline and 'Edited since: yes'", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.succeed({
        kind: "spec",
        status: "Approved",
        legalTargets: ["Approved", "Abandoned", "Completed"],
        approval: {
          kind: "recorded",
          date: "2026-09-01",
          baseline: "abc1234",
          editedSinceApproval: true,
        },
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactStatus("docs/specs/2609101231-spec-approval-ground.md", out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Approved:          2026-09-01 @ abc1234");
    expect(text).toContain("Edited since:      yes");
  });

  it("unrecorded: prints the unrecorded remedy line", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.succeed({
        kind: "spec",
        status: "Approved",
        legalTargets: ["Approved", "Abandoned", "Completed"],
        approval: { kind: "unrecorded" },
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactStatus("docs/specs/2609101231-spec-approval-ground.md", out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Approved:          (unrecorded — run phax artifact approve to record)");
    expect(text).not.toContain("Edited since:");
  });

  it("none: prints no Approved or Edited since lines", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.succeed({
        kind: "plan",
        status: "Approved",
        legalTargets: ["Approved", "Stale", "Abandoned", "Completed"],
        approval: { kind: "none" },
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactStatus("docs/plans/2609101256-spec-approval-ground-plan.md", out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).not.toContain("Approved:");
    expect(text).not.toContain("Edited since:");
  });
});
