import { describe, expect, it } from "vitest";
import {
  renderDocumentMigrationRefusal,
  renderDocumentMigrationReport,
  renderMigrationReport,
  renderOrphanRecordWarning,
  renderQuestionCounts,
} from "../../../src/domain/artifact/render.js";

describe("renderMigrationReport", () => {
  it("says there is nothing to migrate, naming both ledgers", () => {
    expect(renderMigrationReport({ kind: "nothing-to-migrate" })).toEqual([
      "nothing to migrate: no docs/plans/approvals.json or docs/specs/approvals.json",
    ]);
  });

  it("lists each ledger's record files, then the commit by short hash and subject", () => {
    expect(
      renderMigrationReport({
        kind: "migrated",
        ledgers: [
          {
            ledgerPath: "docs/plans/approvals.json",
            recordFiles: ["docs/plans/approvals/2606291247-smolvm-isolation-spike-plan.json"],
          },
          {
            ledgerPath: "docs/specs/approvals.json",
            recordFiles: [
              "docs/specs/approvals/2608091526-batch-execution.json",
              "docs/specs/approvals/2609010000-gone.json",
            ],
          },
        ],
        orphans: [
          {
            recordFile: "docs/specs/approvals/2609010000-gone.json",
            artifact: "docs/specs/2609010000-gone.md",
          },
        ],
        commit: {
          hash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          subject: "chore(approvals): migrate approval ledgers to record files",
        },
      }),
    ).toEqual([
      "docs/plans/approvals.json → 1 record file",
      "  docs/plans/approvals/2606291247-smolvm-isolation-spike-plan.json",
      "docs/specs/approvals.json → 2 record files",
      "  docs/specs/approvals/2608091526-batch-execution.json",
      "  docs/specs/approvals/2609010000-gone.json",
      "committed a1b2c3d chore(approvals): migrate approval ledgers to record files",
    ]);
  });

  it("reports an empty ledger as zero record files", () => {
    expect(
      renderMigrationReport({
        kind: "migrated",
        ledgers: [{ ledgerPath: "docs/plans/approvals.json", recordFiles: [] }],
        orphans: [],
        commit: { hash: "0123456789abcdef", subject: "chore(approvals): migrate" },
      }),
    ).toEqual([
      "docs/plans/approvals.json → 0 record files",
      "committed 0123456 chore(approvals): migrate",
    ]);
  });
});

describe("renderOrphanRecordWarning", () => {
  it("names the record file, the artifact it derives and the delete remedy", () => {
    expect(
      renderOrphanRecordWarning({
        recordFile: "docs/plans/approvals/2609300900-gone-plan.json",
        artifact: "docs/plans/2609300900-gone-plan.md",
      }),
    ).toBe(
      "warning: orphan approval record docs/plans/approvals/2609300900-gone-plan.json — docs/plans/2609300900-gone-plan.md does not exist; delete the record file",
    );
  });

  it("renders a spec orphan the same way", () => {
    expect(
      renderOrphanRecordWarning({
        recordFile: "docs/specs/approvals/2609010000-gone.json",
        artifact: "docs/specs/2609010000-gone.md",
      }),
    ).toBe(
      "warning: orphan approval record docs/specs/approvals/2609010000-gone.json — docs/specs/2609010000-gone.md does not exist; delete the record file",
    );
  });
});

describe("renderQuestionCounts", () => {
  it("names the open ids, and leaves them out when none is open", () => {
    expect(renderQuestionCounts({ open: ["Q2", "q-keep"], arbitrated: 3, lifted: 2 })).toBe(
      "open 2 (Q2, q-keep) · arbitrated 3 (2 lifted)",
    );
    expect(renderQuestionCounts({ open: [], arbitrated: 1, lifted: 1 })).toBe(
      "open 0 · arbitrated 1 (1 lifted)",
    );
  });
});

describe("renderDocumentMigrationReport", () => {
  const DRAFT = "docs/specs/2609281200-log-rotation.md";
  const PRUNE = "docs/specs/2609251400-plan-prune.md";
  const CACHE = "docs/specs/2609271000-cache-keys.md";
  const PLAN = "docs/plans/2609261000-plan-prune-store-plan.md";

  it("says there is nothing to migrate", () => {
    expect(renderDocumentMigrationReport({ kind: "nothing-to-migrate" })).toEqual([
      "nothing to migrate: every live spec and plan sidecar is at its current shape",
    ]);
  });

  it("groups the artifacts by format and shape, names what it unsettles, then the commit", () => {
    const lines = renderDocumentMigrationReport({
      kind: "migrated",
      groups: [
        {
          format: "spec-document",
          fromShape: "0.17.0",
          toShape: "0.25.0",
          artifacts: [
            {
              path: DRAFT,
              status: "Draft",
              questions: { open: ["Q2"], arbitrated: 3, lifted: 3 },
              bodyChanged: true,
              editedSinceApproval: false,
            },
            {
              path: PRUNE,
              status: "Approved",
              questions: { open: [], arbitrated: 2, lifted: 2 },
              bodyChanged: true,
              editedSinceApproval: true,
            },
            {
              path: CACHE,
              status: "Approved",
              questions: { open: ["Q3"], arbitrated: 1, lifted: 1 },
              bodyChanged: true,
              editedSinceApproval: true,
            },
          ],
        },
        {
          format: "plan-document",
          fromShape: "pre-schema",
          toShape: "0.25.0",
          artifacts: [
            {
              path: PLAN,
              status: "Approved",
              questions: { open: [], arbitrated: 0, lifted: 0 },
              bodyChanged: false,
              editedSinceApproval: false,
            },
          ],
        },
      ],
      stalePlans: [{ path: PLAN, specPath: PRUNE }],
      commit: {
        hash: "e5f6a7b8c9d0",
        subject: "chore(artifacts): migrate documents to their current shapes",
      },
    });

    expect(lines).toEqual([
      "spec-document 0.17.0 → 0.25.0",
      `  ${DRAFT.padEnd(PLAN.length)}  Draft     open 1 (Q2) · arbitrated 3 (3 lifted)`,
      `  ${PRUNE.padEnd(PLAN.length)}  Approved  open 0 · arbitrated 2 (2 lifted)`,
      `    now edited since approval — re-approve with \`phax artifact approve ${PRUNE}\``,
      `  ${CACHE.padEnd(PLAN.length)}  Approved  open 1 (Q3) · arbitrated 1 (1 lifted)`,
      `    now edited since approval, with open questions Q3 — reopen it with \`phax artifact reopen ${CACHE}\` before re-approving`,
      "plan-document written before $schema → 0.25.0",
      `  ${PLAN}  Approved  body unchanged`,
      "stale (spec-changed)",
      `  ${PLAN}  its spec ${PRUNE} was re-rendered`,
      "committed e5f6a7b chore(artifacts): migrate documents to their current shapes",
    ]);
    expect(lines.join("\n")).not.toContain("decide");
  });
});

describe("renderDocumentMigrationRefusal", () => {
  it("names each refused artifact, its problem, and its remedy", () => {
    expect(
      renderDocumentMigrationRefusal([
        {
          path: "docs/specs/2609281200-log-rotation.md",
          problem:
            "is not its sidecar's spec-document 0.17.0 rendering — a hand edit would be overwritten",
          remedy: "Re-author it headless, or delete its sidecar. Then rerun.",
        },
        {
          path: "docs/plans/2609261000-plan-prune-store-plan.md",
          problem: "has an invalid sidecar (completesSpec is missing)",
          remedy: "Delete its sidecar. Then rerun.",
        },
      ]).split("\n"),
    ).toEqual([
      "migrate refused: docs/specs/2609281200-log-rotation.md is not its sidecar's spec-document 0.17.0 rendering — a hand edit would be overwritten",
      "  Re-author it headless, or delete its sidecar. Then rerun.",
      "migrate refused: docs/plans/2609261000-plan-prune-store-plan.md has an invalid sidecar (completesSpec is missing)",
      "  Delete its sidecar. Then rerun.",
    ]);
  });
});
