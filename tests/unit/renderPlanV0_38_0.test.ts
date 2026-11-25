import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { artifactBody } from "../../src/domain/artifact/sidecar.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { renderPlanBodyV0_38_0 } from "../../src/domain/authoring/renderPlanV0_38_0.js";
import { decodePlanDocumentV0_33_0 } from "../../src/schemas/history/plan-document/0.33.0.js";
import { decodePlanDocumentV0_38_0 } from "../../src/schemas/history/plan-document/0.38.0.js";
import type { PlanDocumentV0_38_0Value } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { validDocuments, withKey, withoutGateProfile } from "./schemasPackage/documents.js";

// The frozen plan rendering of plan-document 0.38.0, which also renders a
// 0.33.0 sidecar's own body: the layout phax 0.33.0 to 0.42.x wrote, with no
// `## Gate profile` section. Checked against bodies phax actually wrote: the
// repository's archived plans stamped 0.33.0 and 0.38.0, each beside its
// sidecar. Archived plans are never migrated, so they keep these stamps. Read
// only, never written.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE = join(ROOT, "docs", "plans", "archive");

function stampedPlans(release: string): string[] {
  return readdirSync(ARCHIVE)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .filter((name) =>
      readFileSync(join(ARCHIVE, `${name}.json`), "utf8").includes(
        `"$schema": "${schemaUrl("plan-document", release)}"`,
      ),
    );
}

const STAMPED_0_33_0 = stampedPlans("0.33.0");
const STAMPED_0_38_0 = stampedPlans("0.38.0");

function sidecarOf(name: string): unknown {
  return JSON.parse(readFileSync(join(ARCHIVE, `${name}.json`), "utf8"));
}

function bodyOf(name: string): string {
  return artifactBody(readFileSync(join(ARCHIVE, `${name}.md`), "utf8"));
}

/** A plan document as a 0.38.0 sidecar carried it: the current document, its run without a gate profile. */
function plan0_38_0(): PlanDocumentV0_38_0Value {
  const decoded = decodePlanDocumentV0_38_0(
    withKey(
      withoutGateProfile(validDocuments["plan-document"]),
      "$schema",
      schemaUrl("plan-document", "0.38.0"),
    ),
  );
  if (Result.isFailure(decoded)) throw new Error(decoded.failure.message);
  const { $schema: _schema, ...value } = decoded.success;
  return value;
}

describe("renderPlanBodyV0_38_0", () => {
  it("finds archived plans at 0.33.0 and at 0.38.0", () => {
    expect(STAMPED_0_33_0.length).toBeGreaterThan(0);
    expect(STAMPED_0_38_0.length).toBeGreaterThan(0);
  });

  it.each(STAMPED_0_38_0)("reproduces the archived 0.38.0 plan %s's body byte for byte", (name) => {
    const decoded = decodePlanDocumentV0_38_0(sidecarOf(name));
    if (Result.isFailure(decoded)) throw new Error(decoded.failure.message);
    const { $schema: _schema, ...value } = decoded.success;
    expect(renderPlanBodyV0_38_0(value)).toBe(bodyOf(name));
  });

  it.each(STAMPED_0_33_0)("reproduces the archived 0.33.0 plan %s's body byte for byte", (name) => {
    const decoded = decodePlanDocumentV0_33_0(sidecarOf(name));
    if (Result.isFailure(decoded)) throw new Error(decoded.failure.message);
    const { $schema: _schema, ...value } = decoded.success;
    expect(renderPlanBodyV0_38_0(value)).toBe(bodyOf(name));
  });

  it("writes no Gate profile section", () => {
    expect(renderPlanBodyV0_38_0(plan0_38_0())).not.toContain("## Gate profile");
  });

  it("differs from the current rendering by the Gate profile section only", () => {
    const value = plan0_38_0();
    const current = renderPlanBody({ ...value, run: { ...value.run, gateProfile: "light" } });
    expect(current).toBe(
      renderPlanBodyV0_38_0(value).replace(
        "## Required commands",
        "## Gate profile\n\n`light`\n\n## Required commands",
      ),
    );
  });
});
