import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { phaxProgram } from "../../../src/cli/definitions/program.js";
import { call } from "../commandLibrary/commander/support/memoryIo.js";
import { answerJsonSchema } from "../../../src/schemas/answerSchemas.js";
import { getDecideVerdictsFileJsonSchema } from "../../../src/schemas/decideVerdicts.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import {
  makeArtifactNewPlanCommand,
  makeArtifactNewSpecCommand,
} from "../../../src/cli/definitions/artifactNew.js";
import { fullName } from "../../../src/cli/commandLibrary/contract/index.js";
import { inArtifactNew, phaxCall, runnerCall, withoutGuard } from "../../helpers/runnerCall.js";
import {
  ApprovalMigrationRefusedError,
  ArtifactArbiterRefusedError,
  ArtifactCommitFailedError,
  ArtifactCreationError,
  ArtifactDirtyWriteSetError,
  ArtifactSidecarDivergedError,
  ArtifactValidationError,
  AuthoringDocumentError,
  InvalidArtifactTransitionError,
  RateLimitError,
  SpecNotApprovedError,
  SpecRetirementBlockedError,
} from "../../../src/domain/errors.js";
import { sidecarRemedy } from "../../../src/domain/artifact/sidecar.js";
import { DEFAULT_MODEL_ROUTING } from "../../../src/domain/routing/defaults.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";
import type {
  AuthorArtifactResult,
  AuthoringRecordPush,
  AuthoringRecordStatus,
} from "../../../src/app/authorArtifact.js";

vi.mock("../../../src/app/artifactStatus.js", () => ({
  inspectArtifact: vi.fn(),
  transitionArtifactBy: vi.fn(),
}));

vi.mock("../../../src/app/migrateApprovals.js", () => ({
  migrateApprovals: vi.fn(),
}));

vi.mock("../../../src/app/createArtifact.js", () => ({
  createArtifact: vi.fn(),
}));

vi.mock("../../../src/app/authorArtifact.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/authorArtifact.js")>()),
  authorArtifact: vi.fn(),
}));

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/loadRouting.js", () => ({
  loadModelRouting: vi.fn(),
  loadProviderConfig: vi.fn(),
}));

vi.mock("../../../src/domain/routing/resolve.js", () => ({
  resolveModel: vi.fn(),
}));

const NO_FLAGS = { last: false, notLast: false } as const;
const LAST = { last: true, notLast: false } as const;
const NOT_LAST = { last: false, notLast: true } as const;

const VERB = {
  Approved: "approve",
  Stale: "stale",
  Abandoned: "abandon",
  Completed: "complete",
  Draft: "reopen",
} as const;

/** `phax artifact <verb> <path> [--by <by>]` through the runner. */
function transition(path: string, target: keyof typeof VERB, flags: { readonly by?: string } = {}) {
  return phaxCall([
    "artifact",
    VERB[target],
    path,
    ...(flags.by === undefined ? [] : ["--by", flags.by]),
  ]);
}

/** `phax artifact new spec|plan <slug>` (not headless) through the runner. */
function createArtifactCall(
  kind: "spec" | "plan",
  slug: string,
  spec: string | undefined,
  completion: { readonly last: boolean; readonly notLast: boolean },
) {
  return phaxCall([
    "artifact",
    "new",
    kind,
    slug,
    ...(kind === "plan" && spec !== undefined ? ["--spec", spec] : []),
    ...(kind === "plan" && completion.last ? ["--last"] : []),
    ...(kind === "plan" && completion.notLast ? ["--not-last"] : []),
  ]);
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
        approval: { kind: "none" },
        authoring: { kind: "interactive" },
        questions: { kind: "none" },
        orphanRecords: [],
      }),
    );

    const {
      code,
      outLines: lines,
      errLines,
    } = await phaxCall([
      "artifact",
      "status",
      "docs/plans/2607101056-typescript-7-migration-plan.md",
    ]);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Kind:");
    expect(text).toContain("plan");
    expect(text).toContain("Status:");
    expect(text).toContain("Approved");
    expect(text).toContain("Legal transitions:");
    expect(text).toContain("Stale, Abandoned, Completed");
    expect(errLines).toEqual([]);
  });

  it("warns once per orphan record of the kind, keeping the exit code and stdout lines", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    const report = {
      kind: "spec" as const,
      status: "Draft" as const,
      legalTargets: ["Approved" as const, "Abandoned" as const],
      approval: { kind: "none" as const },
      authoring: { kind: "interactive" as const },
      questions: { kind: "none" as const },
    };
    inspectArtifact.mockReturnValue(Effect.succeed({ ...report, orphanRecords: [] }));
    const clean = await phaxCall(["artifact", "status", "docs/specs/2609101221-foo.md"]);

    inspectArtifact.mockReturnValue(
      Effect.succeed({
        ...report,
        orphanRecords: [
          {
            recordFile: "docs/specs/approvals/2609010000-gone.json",
            artifact: "docs/specs/2609010000-gone.md",
          },
        ],
      }),
    );
    const { code, outLines, errLines } = await phaxCall([
      "artifact",
      "status",
      "docs/specs/2609101221-foo.md",
    ]);

    expect(code).toBe(clean.code);
    expect(outLines).toEqual(clean.outLines);
    expect(errLines).toEqual([
      "warning: orphan approval record docs/specs/approvals/2609010000-gone.json — docs/specs/2609010000-gone.md does not exist; delete the record file",
    ]);
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

    const { code, errLines: errors } = await phaxCall(["artifact", "status", "docs/plans/foo.md"]);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("has no frontmatter block");
  });
});

describe("phax artifact <transition>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approve: logs the resulting status without a path line, exits 0", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        previousStatus: "Draft",
        written: [],
        path: "docs/plans/2607101056-typescript-7-migration-plan.md",
      }),
    );

    const { code, outLines: lines } = await transition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
    );

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Approved");
    expect(lines.some((l) => l.startsWith("Path:"))).toBe(false);
  });

  it("complete: logs the resulting status and the new archived path", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.succeed({
        status: "Completed",
        previousStatus: "Approved",
        written: [],
        path: "docs/specs/archive/2608091526-artifact-lifecycle-status.md",
      }),
    );

    const { code, outLines: lines } = await transition(
      "docs/specs/2608091526-artifact-lifecycle-status.md",
      "Completed",
    );

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Completed");
    expect(text).toContain("docs/specs/archive/2608091526-artifact-lifecycle-status.md");
  });

  it("returns exit code 12 and names the legal targets on an illegal transition", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.fail(
        new InvalidArtifactTransitionError({
          kind: "plan",
          from: "Draft",
          to: "Stale",
          legalTargets: ["Approved", "Abandoned"],
        }),
      ),
    );

    const { code, errLines: errors } = await transition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Stale",
    );

    expect(code).toBe(12);
    const text = errors.join("\n");
    expect(text).toContain("Approved, Abandoned");
  });

  it("approve of a plan with a captured baseline logs the short sha", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        previousStatus: "Draft",
        written: [],
        path: "docs/plans/2607101056-typescript-7-migration-plan.md",
        approvedBaseline: "abcdef1234567890abcdef1234567890abcdef12",
      }),
    );

    const { code, outLines: lines } = await transition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
    );

    expect(code).toBe(0);
    expect(lines.some((l) => l === "Baseline: abcdef1")).toBe(true);
  });

  it("returns exit code 12 when the declared spec is not approved", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.fail(
        new SpecNotApprovedError({
          planPath: "docs/plans/2607101056-typescript-7-migration-plan.md",
          specPath: "docs/specs/2609101222-foo.md",
          specStatus: "Draft",
        }),
      ),
    );

    const { code, errLines: errors } = await transition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("approve the spec first");
  });

  it("returns exit code 12 and names both remedies when the sidecar diverged", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.fail(
        new ArtifactSidecarDivergedError({
          path: "docs/specs/2609230835-plan-prune.md",
          sidecarPath: "docs/specs/2609230835-plan-prune.json",
          problem: "has a body that differs from its sidecar's rendering",
          remedy: sidecarRemedy("spec", "plan-prune", "docs/specs/2609230835-plan-prune.json"),
        }),
      ),
    );

    const { code, errLines: errors } = await transition(
      "docs/specs/2609230835-plan-prune.md",
      "Approved",
    );

    expect(code).toBe(12);
    const text = errors.join("\n");
    expect(text).toContain("differs from its sidecar's rendering");
    expect(text).toContain("--headless");
    expect(text).toContain("delete docs/specs/2609230835-plan-prune.json");
  });

  it("returns exit code 12 when spec retirement is blocked by a live dependent", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.fail(
        new SpecRetirementBlockedError({
          specPath: "docs/specs/2609101222-foo.md",
          dependents: [
            { path: "docs/plans/2607101056-typescript-7-migration-plan.md", status: "Approved" },
          ],
        }),
      ),
    );

    const { code, errLines: errors } = await transition(
      "docs/specs/2609101222-foo.md",
      "Completed",
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("abandon or complete them first");
  });

  it("always passes commit: true to the use case", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        previousStatus: "Draft",
        written: [],
        path: "docs/plans/2607101056-typescript-7-migration-plan.md",
      }),
    );

    await transition("docs/plans/2607101056-typescript-7-migration-plan.md", "Approved");

    expect(transitionArtifactBy).toHaveBeenCalledWith(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
      expect.objectContaining({ commit: true }),
    );
  });

  it("hands the raw --by to the use case and prints the approver after the status", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        previousStatus: "Draft",
        written: [],
        path: "docs/specs/2609251400-plan-prune.md",
        approvedBaseline: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        approvedBy: { kind: "machine", grant: "roadmap-loop" },
      }),
    );

    const { code, outLines: lines } = await transition(
      "docs/specs/2609251400-plan-prune.md",
      "Approved",
      { by: "machine:roadmap-loop" },
    );

    expect(code).toBe(0);
    expect(transitionArtifactBy).toHaveBeenCalledWith(
      "docs/specs/2609251400-plan-prune.md",
      "Approved",
      expect.objectContaining({ by: "machine:roadmap-loop" }),
    );
    expect(lines.slice(0, 3)).toEqual([
      "Status: Approved",
      "Approver: machine (roadmap-loop)",
      "Baseline: a1b2c3d",
    ]);
  });

  it("reopen prints the deleted record, the arbiter and each bound plan before the commit", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.succeed({
        status: "Draft",
        previousStatus: "Approved",
        written: [],
        path: "docs/specs/2609251400-plan-prune.md",
        reopenedBy: { kind: "machine", grant: "roadmap-loop" },
        deletedRecord: "docs/specs/approvals/2609251400-plan-prune.json",
        boundPlans: [
          { path: "docs/plans/2609261000-plan-prune-store-plan.md", status: "Approved" },
        ],
        commit: {
          hash: "d4e5f6abcdef1234567890abcdef1234567890ab",
          subject: "chore(specs): reopen plan-prune",
        },
      }),
    );

    const { code, outLines: lines } = await transition(
      "docs/specs/2609251400-plan-prune.md",
      "Draft",
      {
        by: "machine:roadmap-loop",
      },
    );

    expect(code).toBe(0);
    expect(transitionArtifactBy).toHaveBeenCalledWith(
      "docs/specs/2609251400-plan-prune.md",
      "Draft",
      expect.objectContaining({ by: "machine:roadmap-loop" }),
    );
    expect(lines).toEqual([
      "Status: Draft (was Approved; docs/specs/approvals/2609251400-plan-prune.json deleted)",
      "Reopened-By: machine (roadmap-loop)",
      "Bound:  docs/plans/2609261000-plan-prune-store-plan.md (Approved) — left as is",
      "Commit: d4e5f6a — chore(specs): reopen plan-prune",
    ]);
  });

  it("returns exit code 12 when the arbiter is refused", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.fail(
        new ArtifactArbiterRefusedError({
          message:
            "Approval refused: no terminal and no --by — pass `--by operator` or `--by machine:<grant>`",
        }),
      ),
    );

    const { code, errLines: errors } = await transition(
      "docs/specs/2609251400-plan-prune.md",
      "Approved",
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("--by operator");
  });

  it("renders the Commit: line with hash and subject when a commit was created", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        previousStatus: "Draft",
        written: [],
        path: "docs/plans/2607101056-typescript-7-migration-plan.md",
        commit: {
          hash: "3f2a1c9abcdef1234567890abcdef1234567890",
          subject: "chore(plans): approve typescript-7-migration",
        },
      }),
    );

    const { code, outLines: lines } = await transition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
    );

    expect(code).toBe(0);
    expect(
      lines.some((l) => l === "Commit: 3f2a1c9 — chore(plans): approve typescript-7-migration"),
    ).toBe(true);
  });

  // Changed by the plan's retired-archive arbitration: the runner holds `artifact` whole and
  // refuses its retired word with the same sentence and the program's refused code, 64 (it was 1).
  it("archive refusal: writes the refusal naming complete and returns exit code 64", async () => {
    const called = await call(phaxProgram, { argv: ["artifact", "archive", "x"] });

    expect(called.code).toBe(64);
    expect(called.err.join("")).toContain(
      'unknown transition "archive" — the completion transition is: phax artifact complete <path>',
    );
    expect(called.out.join("")).toBe("");
  });

  it("omits the Commit: line when no commit was created", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        previousStatus: "Draft",
        written: [],
        path: "docs/plans/2607101056-typescript-7-migration-plan.md",
      }),
    );

    const { outLines: lines } = await transition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
    );

    expect(lines.some((l) => l.startsWith("Commit:"))).toBe(false);
  });

  it("returns exit code 12 when the write-set target is dirty", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.fail(
        new ArtifactDirtyWriteSetError({
          paths: ["docs/plans/2607101056-typescript-7-migration-plan.md"],
        }),
      ),
    );

    const { code, errLines: errors } = await transition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("commit or stash them first");
  });

  it("returns a non-zero exit code when the transition commit fails", async () => {
    const { transitionArtifactBy } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifactBy.mockReturnValue(
      Effect.fail(
        new ArtifactCommitFailedError({
          paths: ["docs/plans/2607101056-typescript-7-migration-plan.md"],
          cause: "pre-commit hook failed",
          commitMessage: {
            subject: "chore(plans): approve typescript-7-migration",
            body: "Transitions docs/plans/2607101056-typescript-7-migration-plan.md to Approved (approve).",
          },
        }),
      ),
    );

    const { code, errLines: errors } = await transition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
    );

    expect(code).not.toBe(0);
    expect(code).not.toBe(12);
    expect(errors.join("\n")).toContain("commit failed");
  });
});

describe("phax artifact new (not headless)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spec: logs the created path with (Draft), exits 0", async () => {
    const { createArtifact } = vi.mocked(await import("../../../src/app/createArtifact.js"));
    createArtifact.mockReturnValue(
      Effect.succeed({
        path: "docs/specs/2609091412-plan-prune.md",
        sourceSpec: null,
        completesSpec: null,
      }),
    );

    const { code, outLines: lines } = await createArtifactCall(
      "spec",
      "plan-prune",
      undefined,
      NO_FLAGS,
    );

    expect(code).toBe(0);
    expect(lines).toEqual(["created docs/specs/2609091412-plan-prune.md (Draft)"]);
  });

  it.each([
    { completion: LAST, completesSpec: true },
    { completion: NOT_LAST, completesSpec: false },
  ])(
    "plan: logs the created path with the bound source-spec and completes-spec $completesSpec, exits 0",
    async ({ completion, completesSpec }) => {
      const { createArtifact } = vi.mocked(await import("../../../src/app/createArtifact.js"));
      createArtifact.mockReturnValue(
        Effect.succeed({
          path: "docs/plans/2609101030-plan-prune-plan.md",
          sourceSpec: "docs/specs/2609091412-plan-prune.md",
          completesSpec,
        }),
      );

      const { code, outLines: lines } = await createArtifactCall(
        "plan",
        "plan-prune",
        "docs/specs/2609091412-plan-prune.md",
        completion,
      );

      expect(code).toBe(0);
      expect(createArtifact).toHaveBeenCalledWith(expect.objectContaining({ completion }));
      expect(lines).toEqual([
        `created docs/plans/2609101030-plan-prune-plan.md (Draft, source-spec docs/specs/2609091412-plan-prune.md, completes-spec ${String(completesSpec)})`,
      ]);
    },
  );

  it.each([
    {
      completion: NO_FLAGS,
      spec: "docs/specs/2609091412-plan-prune.md",
      message:
        "--spec needs --last (this plan is the spec's last) or --not-last (more plans follow)",
    },
    {
      completion: { last: true, notLast: true },
      spec: "docs/specs/2609091412-plan-prune.md",
      message: "--last and --not-last are opposites: pass exactly one with --spec",
    },
    {
      completion: LAST,
      spec: undefined,
      message: "--last needs --spec: a plan without a source spec completes none",
    },
  ])("plan: a refused flag pairing exits 12 with its message ($message)", async (c) => {
    const { createArtifact } = vi.mocked(await import("../../../src/app/createArtifact.js"));
    createArtifact.mockReturnValue(Effect.fail(new ArtifactCreationError({ message: c.message })));

    const {
      code,
      outLines: lines,
      errLines: errors,
    } = await createArtifactCall("plan", "plan-prune", c.spec, c.completion);

    expect(code).toBe(12);
    expect(errors).toEqual([c.message]);
    expect(lines).toEqual([]);
  });

  it("plan: logs source-spec null when no --spec is given", async () => {
    const { createArtifact } = vi.mocked(await import("../../../src/app/createArtifact.js"));
    createArtifact.mockReturnValue(
      Effect.succeed({
        path: "docs/plans/2609101031-catalog-refresh-plan.md",
        sourceSpec: null,
        completesSpec: null,
      }),
    );

    const { code, outLines: lines } = await createArtifactCall(
      "plan",
      "catalog-refresh",
      undefined,
      NO_FLAGS,
    );

    expect(code).toBe(0);
    expect(lines).toEqual([
      "created docs/plans/2609101031-catalog-refresh-plan.md (Draft, source-spec null)",
    ]);
  });

  it("returns exit code 12 and surfaces the refusal message on a bad slug", async () => {
    const { createArtifact } = vi.mocked(await import("../../../src/app/createArtifact.js"));
    createArtifact.mockReturnValue(
      Effect.fail(
        new ArtifactCreationError({
          message: 'slug "Plan_Prune" does not match [a-z0-9]+(-[a-z0-9]+)*',
        }),
      ),
    );

    const { code, errLines: errors } = await createArtifactCall(
      "spec",
      "Plan_Prune",
      undefined,
      NO_FLAGS,
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("Plan_Prune");
  });
});

describe("phax artifact migrate-approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs the report on stdout, warns each orphan on stderr, exits 0", async () => {
    const { migrateApprovals } = vi.mocked(await import("../../../src/app/migrateApprovals.js"));
    migrateApprovals.mockReturnValue(
      Effect.succeed({
        kind: "migrated",
        ledgers: [
          {
            ledgerPath: "docs/specs/approvals.json",
            recordFiles: ["docs/specs/approvals/2609010000-gone.json"],
          },
        ],
        orphans: [
          {
            recordFile: "docs/specs/approvals/2609010000-gone.json",
            artifact: "docs/specs/2609010000-gone.md",
          },
        ],
        commit: { hash: "a1b2c3d4e5f6", subject: "chore(approvals): migrate" },
      }),
    );

    const { code, errLines: errors } = await phaxCall(["artifact", "migrate-approvals"]);

    expect(code).toBe(0);
    expect(errors).toEqual([
      "warning: orphan approval record docs/specs/approvals/2609010000-gone.json — docs/specs/2609010000-gone.md does not exist; delete the record file",
    ]);
  });

  it("reports nothing to migrate and exits 0", async () => {
    const { migrateApprovals } = vi.mocked(await import("../../../src/app/migrateApprovals.js"));
    migrateApprovals.mockReturnValue(Effect.succeed({ kind: "nothing-to-migrate" }));

    const { code, outLines: lines } = await phaxCall(["artifact", "migrate-approvals"]);
    expect(code).toBe(0);
    expect(lines).toEqual([
      "nothing to migrate: no docs/plans/approvals.json or docs/specs/approvals.json",
    ]);
  });

  it("surfaces a refusal and exits 12", async () => {
    const { migrateApprovals } = vi.mocked(await import("../../../src/app/migrateApprovals.js"));
    const message =
      "docs/plans/approvals.json: entry docs/plans/archive/2609010000-old-plan.md is not a live plan path — remove the entry, then rerun";
    migrateApprovals.mockReturnValue(
      Effect.fail(
        new ApprovalMigrationRefusedError({ message, path: "docs/plans/approvals.json" }),
      ),
    );

    const {
      code,
      outLines: lines,
      errLines: errors,
    } = await phaxCall(["artifact", "migrate-approvals"]);
    expect(code).toBe(12);
    expect(errors).toEqual([message]);
    expect(lines).toEqual([]);
  });

  it("is registered under artifact as migrate-approvals", () => {
    const names = phaxProgram.commands.map((command) => fullName(command).join(" "));
    expect(names).toContain("artifact migrate-approvals");
  });
});

describe("phax artifact schema", () => {
  it.each([
    ["spec", "phax spec document"],
    ["plan", "phax plan document"],
  ] as const)(
    "%s: prints the published answer schema, its $schema a const, no allOf or oneOf, exits 0",
    async (kind, title) => {
      const { code, out: text, err } = await phaxCall(["artifact", "schema", kind]);

      expect(code).toBe(0);
      expect(err).toBe("");
      const schema = JSON.parse(text) as {
        title: string;
        properties: { kind: unknown; $schema: { const: string } };
      };
      expect(schema).toEqual(answerJsonSchema(`${kind}-document`));
      expect(schema.title).toBe(title);
      expect(schema.properties.$schema.const).toBe(currentSchemaUrl(`${kind}-document`));
      expect(text).not.toMatch(/"(allOf|oneOf)"/);
      expect(schema.properties.kind).toEqual({ type: "string", enum: [kind] });
      // Pretty-printed, not a single line.
      expect(text).toContain('\n  "');
    },
  );

  it("verdicts: prints the decide-verdicts JSON Schema the decoder renders, exits 0", async () => {
    const { code, out: text, err } = await phaxCall(["artifact", "schema", "verdicts"]);

    expect(code).toBe(0);
    expect(err).toBe("");
    expect(text).toBe(`${JSON.stringify(getDecideVerdictsFileJsonSchema(), null, 2)}\n`);
  });

  it("an unknown kind is refused by the runner, before anything is printed", async () => {
    const called = await call(withoutGuard(phaxProgram), {
      argv: ["artifact", "schema", "idea"],
    });

    expect(called.code).toBe(phaxProgram.exits.refused);
    expect(called.out).toEqual([]);
    expect(called.err.join("")).toContain("idea");
  });
});

const FAKE_SECURITY: ResolvedConfig["security"] = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

const WRITTEN_RECORD: AuthoringRecordStatus = {
  kind: "written",
  commitSha: "f".repeat(40),
  branch: "phax/records/v1",
  key: "authoring/2609230835-plan-prune",
  shape: "full",
  fileCount: 5,
};

function authoredResult(
  record: AuthoringRecordStatus,
  recordPush: AuthoringRecordPush = { kind: "not-configured" },
): AuthorArtifactResult {
  return {
    path: "docs/specs/2609230835-plan-prune.md",
    sidecarPath: "docs/specs/2609230835-plan-prune.json",
    commit: { hash: "a1b2c3d4e5f6", subject: "docs(specs): draft plan-prune" },
    authoringId: "2609230835-plan-prune",
    sessionFolder: "/fake-state/authoring/2609230835-plan-prune",
    record,
    recordPush,
  };
}

function makeHeadlessConfig(
  authoring: ResolvedConfig["authoring"] = {
    spec: { model: "config-spec-model", effort: "medium" },
    plan: { model: "config-plan-model", effort: "medium" },
  },
): ResolvedConfig {
  return {
    raw: {} as ResolvedConfig["raw"],
    namespace: "test-project",
    stateRoot: "/fake-state",
    repoRoot: "/fake-repo",
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    security: FAKE_SECURITY,
    publish: {
      auto: false,
      remote: "origin",
      provider: "github",
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: { enabled: false, model: "claude-sonnet-5", effort: "medium" },
    codeReview: { enabled: false, model: "claude-opus-5-5", effort: "high" },
    authoring,
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
  };
}

const FAKE_RESOLUTION = {
  requested: { model: "config-spec-model", family: "claude-opus", effort: "medium" },
  selected: {
    provider: "claude-code",
    family: "claude-opus",
    concreteModel: "config-spec-model",
    thinking: "medium",
  },
  relationship: "exact",
  reason: "exact match",
} as const;

// `phax artifact new spec|plan --headless` through the command runner over a memory Io, the
// use case mocked: stdout's lines, and stderr's as `WARN: ` lines, in the order written.
async function headless(
  kind: "spec" | "plan",
  argv: ReadonlyArray<string>,
  stdin = "brief",
): Promise<{ code: number; lines: string[]; errors: ReadonlyArray<string> }> {
  const command = kind === "spec" ? makeArtifactNewSpecCommand() : makeArtifactNewPlanCommand();
  const called = await runnerCall([inArtifactNew(command)], ["artifact", "new", kind, ...argv], {
    stdin,
  });
  const lines = called.writes.flatMap(({ stream, text }) =>
    text
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => (stream === "err" ? `WARN: ${line}` : line)),
  );
  return { code: called.code, lines, errors: called.errLines };
}

describe("artifact new --headless", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function mockHappyPathConfig(authoring?: ResolvedConfig["authoring"]): Promise<void> {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeHeadlessConfig(authoring)));

    const { loadModelRouting, loadProviderConfig } = vi.mocked(
      await import("../../../src/app/loadRouting.js"),
    );
    loadModelRouting.mockReturnValue(Effect.succeed(DEFAULT_MODEL_ROUTING));
    loadProviderConfig.mockReturnValue(Effect.succeed({ providers: {} }));

    const { resolveModel } = vi.mocked(await import("../../../src/domain/routing/resolve.js"));
    resolveModel.mockReturnValue(FAKE_RESOLUTION);
  }

  it("exits 12 without calling authorArtifact when --brief is missing", async () => {
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));

    const { code, errors } = await headless("spec", ["plan-prune", "--headless"]);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("--brief");
    expect(authorArtifact).not.toHaveBeenCalled();
  });

  it("success: prints the five lines, ending with the record key, and exits 0", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(Effect.succeed(authoredResult(WRITTEN_RECORD)));

    const { code, lines } = await headless(
      "spec",
      ["plan-prune", "--headless", "--brief", "-"],
      "write a spec about plan pruning",
    );

    expect(code).toBe(0);
    expect(lines).toEqual([
      "authoring spec plan-prune — config-spec-model / medium",
      "created docs/specs/2609230835-plan-prune.md (Draft, headless)",
      "sidecar docs/specs/2609230835-plan-prune.json",
      "commit a1b2c3d — docs(specs): draft plan-prune",
      "record authoring/2609230835-plan-prune",
    ]);
  });

  it("success with records off prints `record off`", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(Effect.succeed(authoredResult({ kind: "records-off" })));

    const { code, lines } = await headless("spec", ["plan-prune", "--headless", "--brief", "-"]);

    expect(code).toBe(0);
    expect(lines.at(-1)).toBe("record off");
  });

  it("a refused records destination is a warning naming the remedy, never a failure", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.succeed(
        authoredResult({
          kind: "refused",
          reason: "public-source-in-repo",
          destination: { kind: "in-repo" },
          message: "the source repo is public",
          remedy: "turn transcripts off",
        }),
      ),
    );

    const { code, lines } = await headless("spec", ["plan-prune", "--headless", "--brief", "-"]);

    expect(code).toBe(0);
    expect(lines.at(-1)).toBe(
      "WARN: authoring record refused: the source repo is public (remedy: turn transcripts off)",
    );
  });

  it("passes the publish remote and warns after the record line when the push fails, still exiting 0", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.succeed(
        authoredResult(WRITTEN_RECORD, {
          kind: "failed",
          remote: "origin",
          path: "/fake-repo",
          message: "remote rejected",
        }),
      ),
    );

    const { code, lines } = await headless("spec", ["plan-prune", "--headless", "--brief", "-"]);

    expect(code).toBe(0);
    expect(authorArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ publishRemote: "origin" }),
    );
    expect(lines.slice(-2)).toEqual([
      "record authoring/2609230835-plan-prune",
      "WARN: authoring record not pushed to origin (remote rejected) — it stays pending (`phax records status` lists it); share it with `git -C /fake-repo push origin phax/records/v1`",
    ]);
  });

  it("failure: AuthoringDocumentError prints the message and exits 5", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.fail(
        new AuthoringDocumentError({
          kind: "spec",
          slug: "plan-prune",
          message:
            'spec document rejected — acceptanceCriteria[2].refs[0]: "5.9" names no requirement',
        }),
      ),
    );

    const { code, errors } = await headless("spec", ["plan-prune", "--headless", "--brief", "-"]);

    expect(code).toBe(5);
    expect(errors.join("\n")).toContain("names no requirement");
    expect(errors.join("\n")).toContain("✗ authoring failed:");
  });

  it("failure: ArtifactCreationError (existing target) exits 12", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.fail(new ArtifactCreationError({ message: "docs/specs/foo.md already exists" })),
    );

    const { code, errors } = await headless("spec", ["plan-prune", "--headless", "--brief", "-"]);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("already exists");
  });

  it("failure: RateLimitError exits 8", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.fail(new RateLimitError({ message: "rate limited", rawMessage: "rate limited" })),
    );

    const { code, errors } = await headless("spec", ["plan-prune", "--headless", "--brief", "-"]);

    expect(code).toBe(8);
    expect(errors.join("\n")).toContain("rate limited");
  });

  it("precedence: flag wins over config over catalog default for model and effort", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(Effect.succeed(authoredResult(WRITTEN_RECORD)));

    await headless("spec", [
      "plan-prune",
      "--headless",
      "--brief",
      "-",
      "--model",
      "flag-model",
      "--effort",
      "high",
    ]);

    expect(authorArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ model: "flag-model", effort: "high" }),
    );
  });

  it("precedence: config wins over catalog default when no flag is given", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(Effect.succeed(authoredResult(WRITTEN_RECORD)));

    await headless("spec", ["plan-prune", "--headless", "--brief", "-"]);

    expect(authorArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ model: "config-spec-model", effort: "medium" }),
    );
  });

  it("passes the raw --last/--not-last flags to authorArtifact", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(Effect.succeed(authoredResult(WRITTEN_RECORD)));

    await headless("plan", [
      "plan-prune",
      "--spec",
      "docs/specs/2609091412-plan-prune.md",
      "--not-last",
      "--headless",
      "--brief",
      "-",
    ]);

    expect(authorArtifact).toHaveBeenCalledWith(expect.objectContaining({ completion: NOT_LAST }));
  });

  it("failure: a bad --last/--not-last pairing exits 12", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.fail(
        new ArtifactCreationError({
          message:
            "--spec needs --last (this plan is the spec's last) or --not-last (more plans follow)",
        }),
      ),
    );

    const { code, errors } = await headless("plan", [
      "plan-prune",
      "--spec",
      "docs/specs/2609091412-plan-prune.md",
      "--headless",
      "--brief",
      "-",
    ]);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("--spec needs --last");
  });

  it("invalid --effort refuses before calling authorArtifact", async () => {
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));

    const { code, errors } = await headless("spec", [
      "plan-prune",
      "--headless",
      "--brief",
      "-",
      "--effort",
      "extreme",
    ]);

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Invalid --effort value");
    expect(authorArtifact).not.toHaveBeenCalled();
  });
});
