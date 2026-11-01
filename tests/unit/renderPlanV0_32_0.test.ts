import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decideDocumentMigration } from "../../src/domain/artifact/documentMigration.js";
import { artifactBody } from "../../src/domain/artifact/sidecar.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { renderPlanBodyV0_32_0 } from "../../src/domain/authoring/renderPlanV0_32_0.js";
import { liftPlanDocument } from "../../src/schemas/acceptanceLift.js";
import { decodePlanDocumentV0_28_0 } from "../../src/schemas/history/plan-document/0.28.0.js";
import { decodePlanDocumentV0_32_0 } from "../../src/schemas/history/plan-document/0.32.0.js";
import type { PlanDocumentV0_32_0Value } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { validDocuments } from "./schemasPackage/documents.js";

// The frozen plan rendering of plan-document 0.32.0, which also renders a
// 0.28.0 sidecar's own body: the layout phax 0.28.0 to 0.32.0 wrote, its
// `**Oracle phase:**` and `**Oracle files:**` lines and its `oracle` loop
// included. Checked against bodies phax actually wrote: the repository's
// archived plans stamped 0.28.0 and its live plan stamped 0.32.0, each beside
// its sidecar. Read only, never written.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function stampedPlans(dir: string, release: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .filter((name) =>
      readFileSync(join(dir, `${name}.json`), "utf8").includes(
        `"$schema": "${schemaUrl("plan-document", release)}"`,
      ),
    );
}

const ARCHIVE = join(ROOT, "docs", "plans", "archive");
const LIVE = join(ROOT, "docs", "plans");
const STAMPED_0_28_0 = stampedPlans(ARCHIVE, "0.28.0");

function frozen28(sidecarText: string): PlanDocumentV0_32_0Value {
  const decoded = decodePlanDocumentV0_28_0(JSON.parse(sidecarText));
  if (Either.isLeft(decoded)) throw new Error(decoded.left.message);
  const { $schema: _schema, ...value } = decoded.right;
  return value;
}

/** A plan document as a 0.32.0 sidecar carried it: phase-01 an oracle phase, its lines in the loop `oracle`. */
function plan0_32_0(): PlanDocumentV0_32_0Value {
  const { $schema: _schema, ...doc } = validDocuments["plan-document"] as Record<string, unknown>;
  const [first] = doc["phases"] as Array<Record<string, unknown>>;
  const { acceptance: _acceptance, ...firstPhase } = first!;
  return {
    ...doc,
    phases: [
      {
        ...firstPhase,
        oracle: { dischargedBy: "phase-04", files: ["tests/a.test.ts"] },
        testStrategy: [
          {
            guarantee: "every pair is refused as the table says",
            size: "small",
            technique: "table",
            oracle: "transition table",
            loop: "oracle",
            criterion: "AC-1",
          },
        ],
      },
    ],
  } as unknown as PlanDocumentV0_32_0Value;
}

describe("renderPlanBodyV0_32_0", () => {
  it("finds archived 0.28.0 plans and the live acceptance-tests plan at 0.32.0", () => {
    expect(STAMPED_0_28_0.length).toBeGreaterThan(0);
    expect(stampedPlans(LIVE, "0.32.0")).toContain("2610311031-acceptance-tests-plan");
  });

  it.each(STAMPED_0_28_0)("reproduces the archived 0.28.0 plan %s's body byte for byte", (name) => {
    const md = readFileSync(join(ARCHIVE, `${name}.md`), "utf8");
    const sidecarText = readFileSync(join(ARCHIVE, `${name}.json`), "utf8");
    expect(renderPlanBodyV0_32_0(frozen28(sidecarText))).toBe(artifactBody(md));
  });

  it("reproduces the live 0.32.0 acceptance-tests plan's body byte for byte", () => {
    const name = "2610311031-acceptance-tests-plan";
    const md = readFileSync(join(LIVE, `${name}.md`), "utf8");
    const decoded = decodePlanDocumentV0_32_0(
      JSON.parse(readFileSync(join(LIVE, `${name}.json`), "utf8")),
    );
    if (Either.isLeft(decoded)) throw new Error(decoded.left.message);
    const { $schema: _schema, ...value } = decoded.right;
    expect(renderPlanBodyV0_32_0(value)).toBe(artifactBody(md));
  });

  it("writes the Oracle phase and Oracle files lines and the oracle loop", () => {
    const body = renderPlanBodyV0_32_0(plan0_32_0());
    expect(body).toContain("**Oracle phase:** discharged by phase-04");
    expect(body).toContain("**Oracle files:** `tests/a.test.ts`");
    expect(body).toContain(
      "- every pair is refused as the table says — small · table · transition table · oracle · AC-1",
    );
  });

  it("differs from the current rendering in the test lines' loop only", () => {
    const value = plan0_32_0();
    const lifted = liftPlanDocument(value);
    expect(renderPlanBody(lifted)).toBe(
      renderPlanBodyV0_32_0(value).replace("· oracle · AC-1", "· acceptance · AC-1"),
    );
  });
});

describe("migrate-documents over a 0.32.0 sidecar", () => {
  // A hand-edited body is told apart from an unedited one: only the own-shape
  // rendering, with its `oracle` loop, migrates.
  const sidecarJson = (): string =>
    JSON.stringify({ ...plan0_32_0(), $schema: schemaUrl("plan-document", "0.32.0") });
  const frontmatter = "---\nstatus: Draft\nsource-spec: null\n---\n";
  const path = "docs/plans/2610010000-example-plan.md";
  const decide = (md: string) =>
    decideDocumentMigration({
      kind: "plan",
      path,
      sidecarPath: "docs/plans/2610010000-example-plan.json",
      md,
      sidecarJson: sidecarJson(),
    });

  it("migrates the unedited own-shape body and rewrites its test line with the loop acceptance", () => {
    const decision = decide(frontmatter + renderPlanBodyV0_32_0(plan0_32_0()));
    expect(decision.kind).toBe("migrate");
    if (decision.kind !== "migrate") return;
    expect(decision.migration.fromShape).toBe("0.32.0");
    expect(decision.migration.bodyChanged).toBe(true);
    expect(decision.migration.md).toContain("· acceptance · AC-1");
    expect(decision.migration.md).not.toContain("· oracle · AC-1");
    expect(decision.migration.sidecarText).toContain('"loop": "acceptance"');
  });

  it("refuses a body edited by hand", () => {
    const edited = (frontmatter + renderPlanBodyV0_32_0(plan0_32_0())).replace(
      "An example plan.",
      "An example plan, edited by hand.",
    );
    const decision = decide(edited);
    expect(decision.kind).toBe("refuse");
    if (decision.kind !== "refuse") return;
    expect(decision.refusal.problem).toContain("a hand edit would be overwritten");
  });
});
