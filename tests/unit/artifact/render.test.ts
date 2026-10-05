import { describe, expect, it } from "vitest";
import { renderOrphanRecordWarning } from "../../../src/domain/artifact/render.js";

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
