import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { answerJsonSchema } from "../../src/schemas/answerSchemas.js";
import {
  readDocumentSidecar,
  readPlanDocumentFile,
  withDeclaredGateProfile,
} from "../../src/schemas/persisted.js";
import {
  decodeAuthoredPlanDocument,
  projectExtractedPlan,
  type PlanDocument,
} from "../../src/schemas/planDocument.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import {
  validDocuments,
  withKey,
  withoutGateProfile,
  type Doc,
} from "./schemasPackage/documents.js";

// The plan document declares the one gate profile of phax.json that verifies
// its whole run, as the required run.gateProfile, rendered as the plan's
// `## Gate profile` section. Every document here is made up.

const FILE = "docs/plans/2611250000-widget-plan.json";

function decoded(raw: unknown): PlanDocument {
  const result = decodeAuthoredPlanDocument(raw);
  if (Result.isFailure(result)) throw new Error(`fixture does not decode: ${result.failure}`);
  const { $schema: _schema, ...document } = result.success;
  return document;
}

/** The plan document phax writes, its run declaring `gateProfile`. */
function declaring(gateProfile: unknown): Doc {
  const { run } = decoded(validDocuments["plan-document"]);
  return withKey(validDocuments["plan-document"], "run", { ...run, gateProfile });
}

describe("a plan document's gate profile", () => {
  it("renders ## Gate profile holding light, just before ## Required commands", () => {
    const body = renderPlanBody(decoded(declaring("light")));
    expect(body).toContain("\n\n## Gate profile\n\n`light`\n\n## Required commands\n\n");
    const lines = body.split("\n");
    const section = lines.indexOf("## Gate profile");
    expect(lines.slice(section, section + 4)).toEqual(["## Gate profile", "", "`light`", ""]);
    expect(lines[section + 4]).toBe("## Required commands");
    // The summary paragraph is the only block between the title and the section.
    expect(lines.indexOf("## Gate profile")).toBeLessThan(lines.indexOf("## Required commands"));
    expect(lines.filter((line) => line.startsWith("## ")).at(0)).toBe("## Gate profile");
  });

  it("is refused when run.gateProfile is missing, naming it, by the authoring decoder and the sidecar reader", () => {
    const missing = withoutGateProfile(validDocuments["plan-document"]);
    expect(decodeAuthoredPlanDocument(missing)).toEqual(Result.fail("run.gateProfile: is missing"));
    const read = readPlanDocumentFile(FILE, missing);
    expect(Result.isFailure(read) && read.failure.message).toBe(
      `${FILE}: run.gateProfile: is missing`,
    );
  });

  it.each([
    ["empty", ""],
    ["holding a space", "light profile"],
    ["holding a tab", "light\tprofile"],
    ["holding a backtick", "light`profile"],
    ["a line break", "light\n"],
  ])("refuses a gate profile %s, naming run.gateProfile", (_name, gateProfile) => {
    expect(decodeAuthoredPlanDocument(declaring(gateProfile))).toEqual(
      Result.fail(
        "run.gateProfile: a gate profile id is a run of non-whitespace characters holding no backtick",
      ),
    );
  });

  it.each(["standard", "light", "ci-gate.v2", "a/b:c"])("admits the id %j", (gateProfile) => {
    expect(decoded(declaring(gateProfile)).run.gateProfile).toBe(gateProfile);
  });

  it("states the rule in the JSON Schema phax artifact schema plan prints", () => {
    expect(answerJsonSchema("plan-document")).toMatchObject({
      properties: {
        run: {
          required: ["shortName", "title", "requiredCommands", "gateProfile"],
          properties: {
            gateProfile: {
              type: "string",
              pattern: "^[^\\s`]+$",
              description:
                "The id of the one gate profile in phax.json that verifies this plan's whole run; rendered as the plan's `## Gate profile` section.",
            },
          },
        },
      },
    });
  });

  it("carries the gate profile into the extracted-plan projection", () => {
    const projected = projectExtractedPlan(decoded(declaring("light")));
    expect(projected.run.gateProfile).toBe("light");
  });
});

describe("an older plan sidecar's gate profile", () => {
  const v0_38_0 = withKey(
    withoutGateProfile(validDocuments["plan-document"]),
    "$schema",
    schemaUrl("plan-document", "0.38.0"),
  );

  it("reads at shape 0.38.0 with a missing-gate-profile lift carrying every other fact", () => {
    const read = readDocumentSidecar("plan", FILE, v0_38_0);
    if (Result.isFailure(read)) throw new Error(read.failure.message);
    const { $schema: _schema, ...recorded } = v0_38_0;
    expect(read.success).toEqual({
      kind: "plan",
      shape: "0.38.0",
      lift: { kind: "missing-gate-profile", document: recorded },
      older: recorded,
    });
  });

  it("is refused as a current document, naming run.gateProfile", () => {
    const read = readPlanDocumentFile(FILE, v0_38_0);
    expect(Result.isFailure(read) && read.failure.message).toBe(
      `${FILE}: the plan declares no gate profile (run.gateProfile)`,
    );
  });

  it("becomes the current document once a gate profile is named, the id the run's last key", () => {
    const read = readDocumentSidecar("plan", FILE, v0_38_0);
    if (Result.isFailure(read) || read.success.shape === "current") throw new Error("not older");
    const { lift } = read.success;
    if (lift.kind !== "missing-gate-profile") throw new Error(`lift ${lift.kind}`);
    const document = withDeclaredGateProfile(lift, "light");
    expect(document).toEqual(decoded(declaring("light")));
    expect(Object.keys(document.run).at(-1)).toBe("gateProfile");
  });
});
