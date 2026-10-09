import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  planApprovalRecordExists,
  putPlanApprovalRecord,
  putSpecApprovalRecord,
  readPlanApprovalRecord,
  readSpecApprovalRecord,
  removePlanApprovalRecord,
  removeSpecApprovalRecord,
  specApprovalRecordExists,
} from "../../../src/app/approvalRecordStore.js";
import {
  ApprovalRecordUnreadableError,
  ArtifactValidationError,
} from "../../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../../src/infra/fakes/fs.js";
import { FileSystem, type FileSystemOps } from "../../../src/ports/fs.js";
import { PHAX_RELEASE } from "../../../src/schemas/release.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import type { SpecApprovalRecord } from "../../../src/schemas/specApprovalRecord.js";
import {
  clearApproved,
  computeStaleness,
  readSourceSpec,
  resolveCompletesSpec,
  specApprovalVerdict,
  stampApproved,
  STALENESS_REASONS,
  type ApprovalRecordLike,
  type PlanStalenessVerdict,
  type StalenessEvidence,
  type StalenessReason,
} from "../../../src/domain/artifact/lineage.js";
import { fingerprintSource } from "../../../src/domain/artifact/frontmatter.js";
import {
  decodeApprovalRecordFile,
  encodeApprovalRecordFile,
  type ApprovalRecord,
} from "../../../src/schemas/approvalRecord.js";

// `completes-spec` follows a spec path (true unless given) and is absent beside null.
function planFm(opts: {
  status?: string;
  sourceSpec?: string;
  completesSpec?: boolean;
  approved?: string;
  body?: string;
}) {
  const status = opts.status ?? "Draft";
  const sourceSpec = opts.sourceSpec ?? "null";
  const completes =
    sourceSpec === "null" ? "" : `completes-spec: ${String(opts.completesSpec ?? true)}\n`;
  const approved = opts.approved !== undefined ? `${opts.approved}\n` : "";
  const body = opts.body ?? "Body text.";
  return `---\nstatus: ${status}\nsource-spec: ${sourceSpec}\n${completes}${approved}---\n# Plan\n\n## Overview\n\n${body}\n`;
}

describe("readSourceSpec", () => {
  it.each([true, false])("reads a path-form declaration with completes-spec: %s", (value) => {
    expect(
      readSourceSpec(planFm({ sourceSpec: "docs/specs/2609101222-foo.md", completesSpec: value })),
    ).toEqual({
      kind: "spec",
      path: "docs/specs/2609101222-foo.md",
      completesSpec: value,
    });
  });

  it("returns null when completes-spec is missing beside a spec path", () => {
    expect(
      readSourceSpec(
        "---\nstatus: Draft\nsource-spec: docs/specs/2609101222-foo.md\n---\n# Plan\n\n## Overview\n",
      ),
    ).toBeNull();
  });

  it("reads the explicit null form", () => {
    expect(readSourceSpec(planFm({ sourceSpec: "null" }))).toEqual({ kind: "none" });
  });

  it("returns null when the frontmatter block is absent", () => {
    expect(readSourceSpec("# Plan\n\n## Overview\n")).toBeNull();
  });

  it("returns null when the source-spec key is missing", () => {
    expect(readSourceSpec("---\nstatus: Draft\n---\n# Plan\n\n## Overview\n")).toBeNull();
  });
});

describe("resolveCompletesSpec", () => {
  it.each([
    { hasSourceSpec: true, last: true, notLast: false, expected: true },
    { hasSourceSpec: true, last: false, notLast: true, expected: false },
    { hasSourceSpec: false, last: false, notLast: false, expected: null },
  ])(
    "spec $hasSourceSpec, --last $last, --not-last $notLast → $expected",
    ({ expected, ...flags }) => {
      expect(resolveCompletesSpec(flags)).toEqual(Either.right(expected));
    },
  );

  it.each([
    {
      flags: { hasSourceSpec: true, last: false, notLast: false },
      message:
        "--spec needs --last (this plan is the spec's last) or --not-last (more plans follow)",
    },
    {
      flags: { hasSourceSpec: true, last: true, notLast: true },
      message: "--last and --not-last are opposites: pass exactly one with --spec",
    },
    {
      flags: { hasSourceSpec: false, last: true, notLast: false },
      message: "--last needs --spec: a plan without a source spec completes none",
    },
    {
      flags: { hasSourceSpec: false, last: false, notLast: true },
      message: "--not-last needs --spec: a plan without a source spec completes none",
    },
  ])("refuses: $message", ({ flags, message }) => {
    expect(resolveCompletesSpec(flags)).toEqual(Either.left(message));
  });
});

describe("fingerprintSource (approval-fingerprint neutrality)", () => {
  const BASE = planFm({ sourceSpec: "docs/specs/2609101222-foo.md" });

  it("is unchanged when only the status key changes", () => {
    const changed = planFm({ status: "Approved", sourceSpec: "docs/specs/2609101222-foo.md" });
    expect(fingerprintSource(changed)).toBe(fingerprintSource(BASE));
  });

  it("is unchanged when an approved mapping is added", () => {
    const stamped = planFm({
      sourceSpec: "docs/specs/2609101222-foo.md",
      approved: "approved:\n  date: 2026-08-10\n  baseline: abc1234",
    });
    expect(fingerprintSource(stamped)).toBe(fingerprintSource(BASE));
  });

  it("changes when the source-spec value changes", () => {
    const changed = planFm({ sourceSpec: "docs/specs/2609101223-bar.md" });
    expect(fingerprintSource(changed)).not.toBe(fingerprintSource(BASE));
  });

  it("changes when the completes-spec value flips", () => {
    const changed = planFm({ sourceSpec: "docs/specs/2609101222-foo.md", completesSpec: false });
    expect(fingerprintSource(changed)).not.toBe(fingerprintSource(BASE));
  });

  it("changes when body text changes", () => {
    const changed = planFm({ sourceSpec: "docs/specs/2609101222-foo.md", body: "Other text." });
    expect(fingerprintSource(changed)).not.toBe(fingerprintSource(BASE));
  });
});

describe("stampApproved", () => {
  it("adds the approved mapping after the other keys", () => {
    const md = planFm({ sourceSpec: "null" });
    const updated = stampApproved(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isRight(updated)).toBe(true);
    if (Either.isRight(updated)) {
      expect(updated.right).toContain("approved:");
      expect(updated.right).toContain("date: 2026-08-10");
      expect(updated.right).toContain("baseline: abc1234");
    }
  });

  it("replaces an existing approved mapping in place", () => {
    const md = planFm({
      sourceSpec: "null",
      approved: "approved:\n  date: 2020-01-01\n  baseline: '0000000'",
    });
    const updated = stampApproved(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isRight(updated)).toBe(true);
    if (Either.isRight(updated)) {
      expect(updated.right).toContain("date: 2026-08-10");
      expect(updated.right).not.toContain("2020-01-01");
      expect((updated.right.match(/^approved:/gm) ?? []).length).toBe(1);
    }
  });

  it("leaves the document body byte-identical", () => {
    const md = planFm({ sourceSpec: "null", body: "Untouched body line.\n\nSecond paragraph." });
    const updated = stampApproved(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isRight(updated)).toBe(true);
    if (Either.isRight(updated)) {
      const bodyAfter = updated.right.slice(updated.right.indexOf("---\n", 3) + 4);
      const bodyBefore = md.slice(md.indexOf("---\n", 3) + 4);
      expect(bodyAfter).toBe(bodyBefore);
    }
  });

  it("never affects the approval fingerprint", () => {
    const md = planFm({ sourceSpec: "null" });
    const stamped = stampApproved(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isRight(stamped)).toBe(true);
    if (Either.isRight(stamped)) {
      expect(fingerprintSource(stamped.right)).toBe(fingerprintSource(md));
    }
  });

  it("fails with missing-block when there is no frontmatter", () => {
    const result = stampApproved("# Plan\n\n## Overview\n", "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.kind).toBe("missing-block");
    }
  });
});

describe("clearApproved", () => {
  it("removes an approved mapping added by stampApproved, restoring the frontmatter", () => {
    const md = planFm({ sourceSpec: "docs/specs/2609101222-foo.md" });
    const stamped = stampApproved(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isRight(stamped)).toBe(true);
    if (!Either.isRight(stamped)) return;
    const cleared = clearApproved(stamped.right);
    expect(Either.isRight(cleared)).toBe(true);
    if (!Either.isRight(cleared)) return;
    expect(cleared.right).toBe(md);
  });

  it("is a no-op when no approved mapping is present", () => {
    const md = planFm({ sourceSpec: "null" });
    const cleared = clearApproved(md);
    expect(Either.isRight(cleared)).toBe(true);
    if (Either.isRight(cleared)) expect(cleared.right).toBe(md);
  });

  it("is fingerprint-neutral: clearing never changes the approval fingerprint", () => {
    const md = planFm({ sourceSpec: "docs/specs/2609101222-foo.md" });
    const stamped = stampApproved(md, "2026-08-10T12:00:00.000Z", "abc1234");
    expect(Either.isRight(stamped)).toBe(true);
    if (!Either.isRight(stamped)) return;
    const cleared = clearApproved(stamped.right);
    expect(Either.isRight(cleared)).toBe(true);
    if (!Either.isRight(cleared)) return;
    expect(fingerprintSource(cleared.right)).toBe(fingerprintSource(md));
    expect(fingerprintSource(cleared.right)).toBe(fingerprintSource(stamped.right));
  });

  it("fails with missing-block when there is no frontmatter", () => {
    const result = clearApproved("# Plan\n\n## Overview\n");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.kind).toBe("missing-block");
  });
});

const SPEC_DOC = `---
status: Draft
date: 2026-08-11
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Some Spec

Body text.
`;

describe("stampApproved on a spec", () => {
  it("leaves other keys byte-identical when stamping a spec", () => {
    const updated = stampApproved(SPEC_DOC, "2026-08-11T12:00:00.000Z", "abc1234");
    expect(Either.isRight(updated)).toBe(true);
    if (!Either.isRight(updated)) return;
    expect(updated.right).toContain("date: 2026-08-11");
    expect(updated.right).toContain("audience: implementation planning with Claude Code");
    expect(updated.right).toContain("scope: functional behavior and consumption surface");
    expect(updated.right).toContain("approved:");
  });

  it("leaves the body byte-identical when stamping a spec", () => {
    const updated = stampApproved(SPEC_DOC, "2026-08-11T12:00:00.000Z", "abc1234");
    expect(Either.isRight(updated)).toBe(true);
    if (!Either.isRight(updated)) return;
    const bodyAfter = updated.right.slice(updated.right.indexOf("---\n", 3) + 4);
    const bodyBefore = SPEC_DOC.slice(SPEC_DOC.indexOf("---\n", 3) + 4);
    expect(bodyAfter).toBe(bodyBefore);
  });
});

describe("specApprovalVerdict", () => {
  it("returns unrecorded when record is null", () => {
    expect(specApprovalVerdict(null, "fp-current")).toEqual({ kind: "unrecorded" });
  });

  it("returns recorded/not edited when fingerprints match", () => {
    expect(specApprovalVerdict({ specFingerprint: "fp-same" }, "fp-same")).toEqual({
      kind: "recorded",
      editedSinceApproval: false,
    });
  });

  it("returns recorded/edited when fingerprints differ", () => {
    expect(specApprovalVerdict({ specFingerprint: "fp-old" }, "fp-new")).toEqual({
      kind: "recorded",
      editedSinceApproval: true,
    });
  });
});

function record(overrides: Partial<ApprovalRecordLike> = {}): ApprovalRecordLike {
  return {
    planFingerprint: "plan-fp",
    approvedAt: "2026-08-10T00:00:00.000Z",
    baseline: "a".repeat(40),
    sourceSpec: { path: "docs/specs/2609101222-foo.md", fingerprint: "spec-fp" },
    ...overrides,
  };
}

describe("STALENESS_REASONS", () => {
  it("is the closed reason set in evidence-collection order", () => {
    expect(STALENESS_REASONS).toEqual(["spec-changed", "ground-changed", "self-changed"]);
    const reason: StalenessReason = STALENESS_REASONS[0];
    expect(STALENESS_REASONS).toContain(reason);
  });

  it("StalenessEvidence discriminates by reason", () => {
    const evidence: StalenessEvidence = { reason: "self-changed" };
    expect(evidence.reason).toBe("self-changed");
  });
});

// Made-up plan paths for staleness judgement; JUDGED_PLAN matches record()'s key.
const JUDGED_PLAN = "docs/plans/2609101222-foo-plan.md";
const JUDGED_RECORD = "docs/plans/approvals/2609101222-foo-plan.json";
const JUDGED_SIDECAR = "docs/plans/2609101222-foo-plan.json";
const OTHER_JUDGED_RECORD = "docs/plans/approvals/2609101223-bar-plan.json";

describe("computeStaleness", () => {
  it("is fresh when nothing changed", () => {
    const verdict = computeStaleness({
      planPath: JUDGED_PLAN,
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: [],
      footprint: ["src/a.ts"],
    });
    expect(verdict).toEqual({ kind: "fresh" });
  });

  it("reports spec-changed alone", () => {
    const verdict = computeStaleness({
      planPath: JUDGED_PLAN,
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp-2",
      changedFilesSinceBaseline: [],
      footprint: ["src/a.ts"],
    });
    expect(verdict).toEqual({
      kind: "stale",
      evidence: [{ reason: "spec-changed", specPath: "docs/specs/2609101222-foo.md" }],
    });
  });

  it("reports ground-changed naming exactly the intersecting files", () => {
    const verdict = computeStaleness({
      planPath: JUDGED_PLAN,
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: ["src/a.ts", "src/unrelated.ts"],
      footprint: ["src/a.ts", "src/b.ts"],
    });
    expect(verdict).toEqual({
      kind: "stale",
      evidence: [{ reason: "ground-changed", baseline: "a".repeat(40), files: ["src/a.ts"] }],
    });
  });

  it("reports self-changed alone", () => {
    const verdict = computeStaleness({
      planPath: JUDGED_PLAN,
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp-2",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: [],
      footprint: ["src/a.ts"],
    });
    expect(verdict).toEqual({ kind: "stale", evidence: [{ reason: "self-changed" }] });
  });

  it("reports all three reasons together in enum order", () => {
    const verdict = computeStaleness({
      planPath: JUDGED_PLAN,
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp-2",
      currentSpecFingerprint: "spec-fp-2",
      changedFilesSinceBaseline: ["src/a.ts"],
      footprint: ["src/a.ts"],
    });
    expect(verdict).toEqual({
      kind: "stale",
      evidence: [
        { reason: "spec-changed", specPath: "docs/specs/2609101222-foo.md" },
        { reason: "ground-changed", baseline: "a".repeat(40), files: ["src/a.ts"] },
        { reason: "self-changed" },
      ],
    });
  });

  it("is fresh when changed files are disjoint from the footprint", () => {
    const verdict = computeStaleness({
      planPath: JUDGED_PLAN,
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: ["src/unrelated.ts"],
      footprint: ["src/a.ts"],
    });
    expect(verdict).toEqual({ kind: "fresh" });
  });

  it("is missing-record with no record", () => {
    const verdict = computeStaleness({
      planPath: JUDGED_PLAN,
      record: null,
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: [],
      footprint: [],
    });
    expect(verdict.kind).toBe("missing-record");
  });

  it("is missing-record when the baseline has vanished", () => {
    const verdict = computeStaleness({
      planPath: JUDGED_PLAN,
      record: record(),
      baselineExists: false,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: [],
      footprint: [],
    });
    expect(verdict.kind).toBe("missing-record");
    if (verdict.kind === "missing-record") {
      expect(verdict.detail).toContain("a".repeat(40));
    }
  });

  it("a spec-less record never reports spec-changed", () => {
    const verdict = computeStaleness({
      planPath: JUDGED_PLAN,
      record: record({ sourceSpec: null }),
      baselineExists: true,
      currentPlanFingerprint: "plan-fp",
      currentSpecFingerprint: null,
      changedFilesSinceBaseline: [],
      footprint: [],
    });
    expect(verdict).toEqual({ kind: "fresh" });
  });
});

describe("computeStaleness: a plan's own approval is never ground change", () => {
  const BASELINE = "a".repeat(40);

  function judge(
    changed: readonly string[],
    footprint: readonly string[],
    opts: { readonly planPath?: string; readonly planFingerprint?: string } = {},
  ): PlanStalenessVerdict {
    return computeStaleness({
      planPath: opts.planPath ?? JUDGED_PLAN,
      record: record(),
      baselineExists: true,
      currentPlanFingerprint: opts.planFingerprint ?? "plan-fp",
      currentSpecFingerprint: "spec-fp",
      changedFilesSinceBaseline: changed,
      footprint,
    });
  }

  it.each([
    {
      name: "(a) the plan's own path",
      changed: [JUDGED_PLAN],
      footprint: [JUDGED_PLAN],
      planPath: JUDGED_PLAN,
      expected: { kind: "fresh" },
    },
    {
      name: "(b) the plan's own record file",
      changed: [JUDGED_RECORD],
      footprint: [JUDGED_RECORD],
      planPath: JUDGED_PLAN,
      expected: { kind: "fresh" },
    },
    {
      name: "(c) another plan's record file",
      changed: [OTHER_JUDGED_RECORD],
      footprint: [OTHER_JUDGED_RECORD],
      planPath: JUDGED_PLAN,
      expected: {
        kind: "stale",
        evidence: [{ reason: "ground-changed", baseline: BASELINE, files: [OTHER_JUDGED_RECORD] }],
      },
    },
    {
      name: "(d) the plan's own sidecar",
      changed: [JUDGED_SIDECAR],
      footprint: [JUDGED_SIDECAR],
      planPath: JUDGED_PLAN,
      expected: {
        kind: "stale",
        evidence: [{ reason: "ground-changed", baseline: BASELINE, files: [JUDGED_SIDECAR] }],
      },
    },
    {
      name: "(e) own path and record alongside a real change",
      changed: [JUDGED_PLAN, JUDGED_RECORD, "src/a.ts"],
      footprint: [JUDGED_PLAN, JUDGED_RECORD, "src/a.ts"],
      planPath: JUDGED_PLAN,
      expected: {
        kind: "stale",
        evidence: [{ reason: "ground-changed", baseline: BASELINE, files: ["src/a.ts"] }],
      },
    },
    {
      name: "(g) a loose plan outside docs/plans/",
      changed: ["plan.md"],
      footprint: ["plan.md"],
      planPath: "plan.md",
      expected: { kind: "fresh" },
    },
  ])("$name", ({ changed, footprint, planPath, expected }) => {
    expect(judge(changed, footprint, { planPath })).toEqual(expected);
  });

  it("(f) the plan's own edited content is self-changed only", () => {
    expect(judge([JUDGED_PLAN], [JUDGED_PLAN], { planFingerprint: "plan-fp-2" })).toEqual({
      kind: "stale",
      evidence: [{ reason: "self-changed" }],
    });
  });
});

describe("approval record sidecar schema", () => {
  const sample = {
    $schema: schemaUrl("plan-approvals", "0.17.0"),
    records: {
      "docs/plans/2609101222-foo-plan.md": {
        planFingerprint: "plan-fp",
        approvedAt: "2026-08-10T00:00:00.000Z",
        baseline: "a".repeat(40),
        sourceSpec: { path: "docs/specs/2609101222-foo.md", fingerprint: "spec-fp" },
      },
    },
  };

  it("round-trips decode/encode", () => {
    const decoded = decodeApprovalRecordFile(sample);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(encodeApprovalRecordFile(decoded.right)).toEqual(sample);
    }
  });

  it("decodes a null sourceSpec", () => {
    const withNull = {
      ...sample,
      records: {
        "docs/plans/2609101222-foo-plan.md": {
          ...sample.records["docs/plans/2609101222-foo-plan.md"],
          sourceSpec: null,
        },
      },
    };
    expect(Either.isRight(decodeApprovalRecordFile(withNull))).toBe(true);
  });

  it("rejects a missing required field", () => {
    const bad = {
      $schema: sample.$schema,
      records: { "docs/plans/2609101222-foo-plan.md": { approvedAt: "2026-08-10T00:00:00.000Z" } },
    };
    expect(Either.isLeft(decodeApprovalRecordFile(bad))).toBe(true);
  });

  it("rejects a ledger without $schema, or one that still carries version", () => {
    const { $schema: _schema, ...unstamped } = sample;
    expect(Either.isLeft(decodeApprovalRecordFile({ version: 1, ...unstamped }))).toBe(true);
    expect(Either.isLeft(decodeApprovalRecordFile({ ...sample, version: 1 }))).toBe(true);
  });

  it("rejects a $schema naming another format", () => {
    const other = { ...sample, $schema: schemaUrl("spec-approvals", "0.17.0") };
    expect(Either.isLeft(decodeApprovalRecordFile(other))).toBe(true);
  });

  it("rejects a malformed baseline", () => {
    const bad = {
      ...sample,
      records: {
        "docs/plans/2609101222-foo-plan.md": {
          ...sample.records["docs/plans/2609101222-foo-plan.md"],
          baseline: "not-hex",
        },
      },
    };
    expect(Either.isLeft(decodeApprovalRecordFile(bad))).toBe(true);
  });
});

function written(fs: { getFile(path: string): string | undefined }, path: string) {
  const parsed: Record<string, unknown> = JSON.parse(fs.getFile(path) ?? "");
  return parsed;
}

function runWith<A>(
  files: Readonly<Record<string, string>>,
  effect: Effect.Effect<A, unknown, FileSystem>,
) {
  const fs = makeFakeFileSystem();
  for (const [path, text] of Object.entries(files)) fs.impl.setFile(path, text);
  const value = Effect.runSync(effect.pipe(Effect.provide(fs.layer)));
  return { value, fs: fs.impl };
}

const PLAN = "docs/plans/2609101222-foo-plan.md";
const PLAN_RECORD = "docs/plans/approvals/2609101222-foo-plan.json";
const OTHER_PLAN = "docs/plans/2609101223-bar-plan.md";
const OTHER_PLAN_RECORD = "docs/plans/approvals/2609101223-bar-plan.json";
const SPEC = "docs/specs/2609101222-foo.md";
const SPEC_RECORD = "docs/specs/approvals/2609101222-foo.json";
const OTHER_SPEC = "docs/specs/2609101223-bar.md";
const OTHER_SPEC_RECORD = "docs/specs/approvals/2609101223-bar.json";
const OLD_PLAN_LEDGER = "docs/plans/approvals.json";
const OLD_SPEC_LEDGER = "docs/specs/approvals.json";

const planRecord: ApprovalRecord = {
  planFingerprint: "plan-fp",
  approvedAt: "2026-08-10T00:00:00.000Z",
  baseline: "a".repeat(40),
  sourceSpec: { path: SPEC, fingerprint: "spec-fp" },
};
const specRecord: SpecApprovalRecord = {
  specFingerprint: "spec-fp",
  approvedAt: "2026-08-10T00:00:00.000Z",
  baseline: "b".repeat(40),
};

function planRecordText(artifact: string, release = PHAX_RELEASE): string {
  return JSON.stringify(
    { $schema: schemaUrl("plan-approval-record", release), artifact, ...planRecord },
    null,
    2,
  );
}

function specRecordText(artifact: string, release = PHAX_RELEASE): string {
  return JSON.stringify(
    { $schema: schemaUrl("spec-approval-record", release), artifact, ...specRecord },
    null,
    2,
  );
}

// Plan approval writes its own record file; spec approval too.
describe("approval record store: one file per artifact", () => {
  it("writes a plan's record file with $schema, artifact, then the record fields", () => {
    const { fs } = runWith({}, putPlanApprovalRecord(PLAN, planRecord));
    const file = written(fs, PLAN_RECORD);
    expect(Object.keys(file)).toEqual([
      "$schema",
      "artifact",
      "planFingerprint",
      "approvedAt",
      "baseline",
      "sourceSpec",
    ]);
    expect(file).toEqual({
      $schema: currentSchemaUrl("plan-approval-record"),
      artifact: PLAN,
      ...planRecord,
    });
    expect(fs.getFile(OLD_PLAN_LEDGER)).toBeUndefined();
  });

  it("writes a spec's record file with $schema, artifact, then the record fields", () => {
    const { fs } = runWith({}, putSpecApprovalRecord(SPEC, specRecord));
    const file = written(fs, SPEC_RECORD);
    expect(Object.keys(file)).toEqual([
      "$schema",
      "artifact",
      "specFingerprint",
      "approvedAt",
      "baseline",
    ]);
    expect(file).toEqual({
      $schema: currentSchemaUrl("spec-approval-record"),
      artifact: SPEC,
      ...specRecord,
    });
    expect(fs.getFile(OLD_SPEC_LEDGER)).toBeUndefined();
  });

  it("reads back the record it wrote, carrying artifact", () => {
    const { value } = runWith(
      {},
      Effect.zipRight(putPlanApprovalRecord(PLAN, planRecord), readPlanApprovalRecord(PLAN)),
    );
    expect(value).toEqual({ artifact: PLAN, ...planRecord });
    const { value: spec } = runWith(
      {},
      Effect.zipRight(putSpecApprovalRecord(SPEC, specRecord), readSpecApprovalRecord(SPEC)),
    );
    expect(spec).toEqual({ artifact: SPEC, ...specRecord });
  });

  it("replaces only the artifact's own file on re-approval", () => {
    const other = specRecordText(OTHER_SPEC);
    const reapproved = { ...specRecord, specFingerprint: "spec-fp-2" };
    const { fs } = runWith(
      { [SPEC_RECORD]: specRecordText(SPEC), [OTHER_SPEC_RECORD]: other },
      putSpecApprovalRecord(SPEC, reapproved),
    );
    expect(written(fs, SPEC_RECORD)["specFingerprint"]).toBe("spec-fp-2");
    expect(fs.getFile(OTHER_SPEC_RECORD)).toBe(other);
  });

  it("removes only the artifact's own file", () => {
    const other = planRecordText(OTHER_PLAN);
    const { fs } = runWith(
      { [PLAN_RECORD]: planRecordText(PLAN), [OTHER_PLAN_RECORD]: other },
      removePlanApprovalRecord(PLAN),
    );
    expect(fs.getFile(PLAN_RECORD)).toBeUndefined();
    expect(fs.getFile(OTHER_PLAN_RECORD)).toBe(other);

    const { fs: specFs } = runWith(
      { [SPEC_RECORD]: specRecordText(SPEC) },
      removeSpecApprovalRecord(SPEC),
    );
    expect(specFs.getFile(SPEC_RECORD)).toBeUndefined();
  });

  it("removing a missing record file is a no-op", () => {
    const { fs } = runWith({}, removePlanApprovalRecord(PLAN));
    expect(fs.getFile(PLAN_RECORD)).toBeUndefined();
  });

  it("reports whether the artifact's own record file exists", () => {
    const { value } = runWith(
      { [OTHER_PLAN_RECORD]: planRecordText(OTHER_PLAN), [SPEC_RECORD]: "{ not json" },
      Effect.all([planApprovalRecordExists(PLAN), specApprovalRecordExists(SPEC)]),
    );
    expect(value).toEqual([false, true]);
  });

  it("never reads another artifact's record file, even an unreadable one", () => {
    const { value, fs } = runWith(
      { [OTHER_PLAN_RECORD]: "{ not json" },
      Effect.zipRight(putPlanApprovalRecord(PLAN, planRecord), readPlanApprovalRecord(PLAN)),
    );
    expect(value).toEqual({ artifact: PLAN, ...planRecord });
    expect(fs.getFile(OTHER_PLAN_RECORD)).toBe("{ not json");
  });
});

// A missing record file is no record.
describe("approval record store: no record", () => {
  it("reads a missing record file as no record", () => {
    const { value } = runWith(
      {},
      Effect.all([readPlanApprovalRecord(PLAN), readSpecApprovalRecord(SPEC)]),
    );
    expect(value).toEqual([null, null]);
  });

  it("reads a non-live path as no record without touching disk", () => {
    const untouchable = Layer.succeed(
      FileSystem,
      new Proxy({} as FileSystemOps, {
        get: (_, name) => () => Effect.die(`touched disk: ${String(name)}`),
      }),
    );
    const value = Effect.runSync(
      Effect.all([
        readPlanApprovalRecord("docs/plans/archive/2609101222-foo-plan.md"),
        readSpecApprovalRecord("docs/specs/archive/2609101222-foo.md"),
        readPlanApprovalRecord("docs/plans/nested/2609101222-foo-plan.md"),
        planApprovalRecordExists("docs/plans/archive/2609101222-foo-plan.md"),
      ]).pipe(Effect.provide(untouchable)),
    );
    expect(value).toEqual([null, null, null, false]);
  });

  it("refuses to write a record for a path that is not a live artifact", () => {
    const { result } = failure(
      {},
      putPlanApprovalRecord("docs/plans/nested/2609101222-foo-plan.md", planRecord),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(ArtifactValidationError);
  });
});

// Runs an effect over a fake file system and returns its Either, with the files.
function failure<A>(
  files: Readonly<Record<string, string>>,
  effect: Effect.Effect<A, unknown, FileSystem>,
) {
  const fs = makeFakeFileSystem();
  for (const [path, text] of Object.entries(files)) fs.impl.setFile(path, text);
  const result = Effect.runSync(effect.pipe(Effect.either, Effect.provide(fs.layer)));
  return { result, fs: fs.impl };
}

// An unreadable record file is never read as no record, never rewritten and
// never deleted: a file that is not JSON, has no $schema, a newer release
// wrote, or that fails to decode is refused by every read and every write,
// and left byte for byte as it was.
describe("approval record store over an unreadable record file", () => {
  const [major = 0] = PHAX_RELEASE.split(".").map(Number);
  const NEWER = `${major + 1}.0.0`;
  const { $schema: _schema, ...withoutSchema } = JSON.parse(planRecordText(PLAN)) as Record<
    string,
    unknown
  >;

  const unreadablePlanRecords: ReadonlyArray<readonly [string, string, string]> = [
    ["that is not JSON", "{ not json", "not valid JSON"],
    ["without $schema", JSON.stringify(withoutSchema), "has no $schema"],
    [
      "written by a newer release",
      planRecordText(PLAN, NEWER),
      `newer than this phax (${PHAX_RELEASE})`,
    ],
    [
      "that fails to decode",
      JSON.stringify({ ...JSON.parse(planRecordText(PLAN)), baseline: "not-hex" }),
      PLAN_RECORD,
    ],
  ];

  it.each(unreadablePlanRecords)("refuses to read a plan record file %s", (_, text, expected) => {
    const { result } = failure({ [PLAN_RECORD]: text }, readPlanApprovalRecord(PLAN));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApprovalRecordUnreadableError);
      const error = result.left as ApprovalRecordUnreadableError;
      expect(error.recordPath).toBe(PLAN_RECORD);
      expect(error.message.startsWith(`${PLAN_RECORD}: `)).toBe(true);
      expect(error.message).toContain(expected);
    }
  });

  it.each(unreadablePlanRecords)("never rewrites or deletes a plan record file %s", (_, text) => {
    for (const effect of [
      putPlanApprovalRecord(PLAN, planRecord),
      removePlanApprovalRecord(PLAN),
    ]) {
      const { result, fs } = failure({ [PLAN_RECORD]: text }, effect);
      expect(Either.isLeft(result)).toBe(true);
      expect(fs.getFile(PLAN_RECORD)).toBe(text);
    }
  });

  it("never rewrites a spec record file written by a newer release", () => {
    const text = specRecordText(SPEC, NEWER);
    const { result, fs } = failure(
      { [SPEC_RECORD]: text },
      putSpecApprovalRecord(SPEC, specRecord),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(ApprovalRecordUnreadableError);
    expect(fs.getFile(SPEC_RECORD)).toBe(text);
  });
});

// A copied record does not approve another artifact: a record file whose
// `artifact` names another path is refused and kept.
describe("approval record store over a copied record file", () => {
  it("refuses a plan record that records another plan", () => {
    const copied = planRecordText(OTHER_PLAN);
    for (const effect of [
      readPlanApprovalRecord(PLAN),
      putPlanApprovalRecord(PLAN, planRecord),
      removePlanApprovalRecord(PLAN),
    ]) {
      const { result, fs } = failure({ [PLAN_RECORD]: copied }, effect);
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ApprovalRecordUnreadableError);
        expect((result.left as ApprovalRecordUnreadableError).message).toBe(
          `${PLAN_RECORD}: records ${OTHER_PLAN}, not ${PLAN} — restore it from git, or delete it and re-approve`,
        );
      }
      expect(fs.getFile(PLAN_RECORD)).toBe(copied);
    }
  });

  it("refuses a spec record that records another spec", () => {
    const { result } = failure(
      { [SPEC_RECORD]: specRecordText(OTHER_SPEC) },
      readSpecApprovalRecord(SPEC),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApprovalRecordUnreadableError);
      expect((result.left as ApprovalRecordUnreadableError).recordPath).toBe(SPEC_RECORD);
    }
  });
});
