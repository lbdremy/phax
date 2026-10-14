import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { runArtifactStatus } from "../../../src/cli/commands/artifact.js";
import type { ArtifactAuthoring } from "../../../src/app/artifactStatus.js";

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

const INTERACTIVE: ArtifactAuthoring = { kind: "interactive" };

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
          approvedBy: { kind: "machine", grant: "roadmap-loop" },
          editedSinceApproval: false,
        },
        authoring: INTERACTIVE,
        orphanRecords: [],
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactStatus("docs/specs/2609101231-spec-approval-ground.md", out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Approved:          2026-09-01 @ abc1234 by machine (roadmap-loop)");
    expect(text).toContain("Edited since:      no");
  });

  it.each([
    [{ kind: "operator", name: "Ada Lovelace" }, "2026-09-01 @ abc1234 by operator (Ada Lovelace)"],
    [{ kind: "unattributed" }, "2026-09-01 @ abc1234 unattributed"],
  ] as const)(
    "names a plan's approver %j on the Approved line, then Edited since",
    async (approvedBy, approvedLine) => {
      const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
      inspectArtifact.mockReturnValue(
        Effect.succeed({
          kind: "plan",
          status: "Approved",
          legalTargets: ["Approved", "Stale", "Abandoned", "Completed"],
          approval: {
            kind: "recorded",
            date: "2026-09-01",
            baseline: "abc1234",
            approvedBy,
            editedSinceApproval: false,
          },
          authoring: INTERACTIVE,
          orphanRecords: [],
        }),
      );

      const { out, lines } = makeOutput();
      const code = await runArtifactStatus(
        "docs/plans/2609101256-spec-approval-ground-plan.md",
        out,
      );

      expect(code).toBe(0);
      const approvedAt = lines.findIndex((l) => l.startsWith("Approved:"));
      expect(lines[approvedAt]).toBe(`Approved:          ${approvedLine}`);
      expect(lines[approvedAt + 1]).toBe("Edited since:      no");
      expect(lines.join("\n")).not.toContain("by unattributed");
    },
  );

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
          approvedBy: { kind: "operator", name: "Ada Lovelace" },
          editedSinceApproval: true,
        },
        authoring: INTERACTIVE,
        orphanRecords: [],
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactStatus("docs/specs/2609101231-spec-approval-ground.md", out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Approved:          2026-09-01 @ abc1234 by operator (Ada Lovelace)");
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
        authoring: INTERACTIVE,
        orphanRecords: [],
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
        authoring: INTERACTIVE,
        orphanRecords: [],
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

describe("runArtifactStatus — authoring rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const SIDECAR = "docs/specs/2609230835-plan-prune.json";

  it.each<[string, ArtifactAuthoring, string]>([
    ["interactive", INTERACTIVE, "Authored:          interactive (no sidecar)"],
    [
      "headless, in sync",
      { kind: "headless", sidecarPath: SIDECAR, agreement: "in-sync" },
      `Authored:          headless — sidecar ${SIDECAR} (in sync)`,
    ],
    [
      "headless, diverged",
      { kind: "headless", sidecarPath: SIDECAR, agreement: "diverged" },
      `Authored:          headless — sidecar ${SIDECAR} (diverged — body differs from the sidecar's rendering)`,
    ],
    [
      "headless, invalid sidecar",
      {
        kind: "headless",
        sidecarPath: SIDECAR,
        agreement: { kind: "invalid", message: "not JSON (Unexpected token)" },
      },
      `Authored:          headless — sidecar ${SIDECAR} (invalid sidecar — not JSON (Unexpected token))`,
    ],
  ])("%s: prints the Authored line", async (_label, authoring, expected) => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.succeed({
        kind: "spec",
        status: "Draft",
        legalTargets: ["Approved", "Abandoned"],
        approval: { kind: "none" },
        authoring,
        orphanRecords: [],
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactStatus("docs/specs/2609230835-plan-prune.md", out);

    expect(code).toBe(0);
    expect(lines).toContain(expected);
    expect(lines.indexOf(expected)).toBe(lines.findIndex((l) => l.startsWith("Status:")) + 1);
  });
});
