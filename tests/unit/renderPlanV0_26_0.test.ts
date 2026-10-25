import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { decideDocumentMigration } from "../../src/domain/artifact/documentMigration.js";
import { artifactBody } from "../../src/domain/artifact/sidecar.js";
import { renderPlanBodyV0_26_0 } from "../../src/domain/authoring/renderPlanV0_26_0.js";
import { decodePlanDocumentV0_26_0 } from "../../src/schemas/history/plan-document/0.26.0.js";
import type { PlanDocumentV0_26_0Value } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

// The frozen plan rendering of plan-document 0.26.0, checked against bodies
// phax 0.26.0 and 0.27.0 actually wrote: the repository's archived plans
// stamped 0.26.0, each beside its sidecar. Read only, never written.

const ARCHIVE = join(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  "docs",
  "plans",
  "archive",
);
const INTERACTIVE_PHASES = "2610230951-interactive-phases-plan";

function archived(name: string): { readonly md: string; readonly sidecarText: string } {
  return {
    md: readFileSync(join(ARCHIVE, `${name}.md`), "utf8"),
    sidecarText: readFileSync(join(ARCHIVE, `${name}.json`), "utf8"),
  };
}

function frozenValue(sidecarText: string): PlanDocumentV0_26_0Value {
  const decoded = decodePlanDocumentV0_26_0(JSON.parse(sidecarText));
  if (Either.isLeft(decoded)) throw new Error(decoded.left.message);
  const { $schema: _schema, ...value } = decoded.right;
  return value;
}

// Every archived plan whose sidecar is stamped 0.26.0.
const STAMPED_0_26_0 = readdirSync(ARCHIVE)
  .filter((entry) => entry.endsWith(".json"))
  .map((entry) => entry.slice(0, -".json".length))
  .filter((name) =>
    archived(name).sidecarText.includes(`"$schema": "${schemaUrl("plan-document", "0.26.0")}"`),
  );

describe("renderPlanBodyV0_26_0", () => {
  it("finds the archived 0.26.0 plans, interactive-phases among them", () => {
    expect(STAMPED_0_26_0).toContain(INTERACTIVE_PHASES);
    expect(STAMPED_0_26_0).toContain("2610241631-surface-summary-plan");
  });

  it.each(STAMPED_0_26_0)("reproduces %s's body byte for byte", (name) => {
    const { md, sidecarText } = archived(name);
    expect(renderPlanBodyV0_26_0(frozenValue(sidecarText))).toBe(artifactBody(md));
  });

  it("writes each phase's test strategy as the string it was, Mode and oracle lines included", () => {
    const value = frozenValue(archived(INTERACTIVE_PHASES).sidecarText);
    const body = renderPlanBodyV0_26_0(value);
    const [first] = value.phases;
    expect(body).toContain(
      `### Test strategy\n\n${first.testStrategy}\n\n### Implementation order`,
    );
  });
});

describe("migrate-documents over the interactive-phases plan, made live", () => {
  // ac-migrate-refuse: its first item is the prose line spec §6 names.
  it("is refused naming phase-01, its first departing line and the remedy", () => {
    const { md, sidecarText } = archived(INTERACTIVE_PHASES);
    const path = `docs/plans/${INTERACTIVE_PHASES}.md`;
    const live = md.replace(/^status: Abandoned$/m, "status: Draft");
    const decision = decideDocumentMigration({
      kind: "plan",
      path,
      sidecarPath: `docs/plans/${INTERACTIVE_PHASES}.json`,
      md: live,
      sidecarJson: sidecarText,
    });
    expect(decision.kind).toBe("refuse");
    if (decision.kind !== "refuse") return;
    expect(`✗ ${decision.refusal.path} ${decision.refusal.problem}`).toBe(
      '✗ docs/plans/2610230951-interactive-phases-plan.md phase-01 testStrategy line 1 departs from the test line format: "Write `tests/unit/hold.test.ts` first."',
    );
    expect(decision.refusal.remedy).toBe(
      "Rewrite each phase's test strategy in the line format, in the sidecar and plan.md alike, or re-author the plan, then rerun.",
    );
  });
});
