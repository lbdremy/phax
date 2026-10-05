import { describe, expect, it } from "vitest";
import {
  renderMigrationReport,
  renderOrphanRecordWarning,
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
