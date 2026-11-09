import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRunListV0_30_0 } from "../../../src/schemas/history/run-list/0.30.0.js";
import { decodeArtifactStatusFile } from "../../../src/schemas/artifactStatusDocument.js";
import { decodePlanLintFile } from "../../../src/schemas/planLint.js";
import { decodePlanOverviewFile } from "../../../src/schemas/planOverview.js";
import { decodeRunListFile } from "../../../src/schemas/runList.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { validDocuments, withKey, withoutKey, type Doc } from "../schemasPackage/documents.js";

// The three answers born at 0.34.0 and the run list that gained `pullRequest`:
// each decoder reads a full document, refuses a key it does not name and one
// that is missing.

type Decoder = (input: unknown) => Result.Result<unknown, unknown>;

const DECODERS: ReadonlyArray<
  readonly ["artifact-status" | "plan-overview" | "plan-lint", Decoder, string]
> = [
  ["artifact-status", decodeArtifactStatusFile, "path"],
  ["plan-overview", decodePlanOverviewFile, "plan"],
  ["plan-lint", decodePlanLintFile, "findings"],
];

describe.each(DECODERS)("the %s format", (id, decode, requiredKey) => {
  const document = validDocuments[id];

  it("decodes a full document", () => {
    expect(Result.isSuccess(decode(document))).toBe(true);
  });

  it("starts with $schema and is stamped 0.34.0", () => {
    expect(Object.keys(document)[0]).toBe("$schema");
    expect(document["$schema"]).toBe(schemaUrl(id, "0.34.0"));
  });

  it("refuses a key it does not name", () => {
    expect(Result.isFailure(decode(withKey(document, "extra", 1)))).toBe(true);
  });

  it("refuses a missing key", () => {
    expect(Result.isFailure(decode(withoutKey(document, requiredKey)))).toBe(true);
    expect(Result.isFailure(decode(withoutKey(document, "$schema")))).toBe(true);
  });
});

describe("the artifact-status variants", () => {
  const base = validDocuments["artifact-status"];
  const decodes = (patch: Record<string, unknown>) =>
    Result.isSuccess(decodeArtifactStatusFile({ ...base, ...patch }));

  it("reads each approval", () => {
    expect(decodes({ approval: { kind: "none" } })).toBe(true);
    expect(decodes({ approval: { kind: "unrecorded" } })).toBe(true);
    expect(
      decodes({
        approval: {
          kind: "recorded",
          date: "2026-11-03",
          baseline: "0123456789abcdef0123456789abcdef01234567",
          approver: { kind: "operator", name: "Ada Example" },
          editedSinceApproval: true,
        },
      }),
    ).toBe(true);
    expect(decodes({ approval: { kind: "recorded", date: "2026-11-03" } })).toBe(false);
  });

  it("reads each authoring and agreement", () => {
    expect(decodes({ authoring: { kind: "interactive" } })).toBe(true);
    for (const agreement of [
      "in-sync",
      "diverged",
      { kind: "invalid", message: "the sidecar is not JSON" },
      { kind: "stamped", format: "spec-document", shape: "0.25.0" },
    ]) {
      expect(
        decodes({ authoring: { kind: "headless", sidecar: "docs/specs/x.json", agreement } }),
      ).toBe(true);
    }
    expect(
      decodes({
        authoring: { kind: "headless", sidecar: "docs/specs/x.json", agreement: "unknown" },
      }),
    ).toBe(false);
  });

  it("reads each questions variant", () => {
    expect(decodes({ questions: { kind: "none" } })).toBe(true);
    expect(decodes({ questions: { kind: "departs", line: 12, text: "## 9. Questions" } })).toBe(
      true,
    );
    expect(decodes({ questions: { kind: "parsed", open: [], arbitrated: [], lifted: [] } })).toBe(
      true,
    );
    expect(decodes({ questions: { kind: "parsed", open: ["q-a"] } })).toBe(false);
  });
});

function withoutPullRequest(row: Record<string, unknown>): Record<string, unknown> {
  const { pullRequest: _pullRequest, ...rest } = row;
  return rest;
}

describe("the run list's pull request", () => {
  const current: Doc = validDocuments["run-list"];
  const rows = current["runs"] as ReadonlyArray<Record<string, unknown>>;
  const frozen: Doc = {
    ...current,
    $schema: schemaUrl("run-list", "0.30.0"),
    runs: rows.map(withoutPullRequest),
  };

  it("decodes a 0.30.0 list without pullRequest in the frozen shape", () => {
    expect(Result.isSuccess(decodeRunListV0_30_0(frozen))).toBe(true);
  });

  it("refuses a 0.30.0 list that carries pullRequest", () => {
    expect(Result.isFailure(decodeRunListV0_30_0(current))).toBe(true);
  });

  it("refuses a current list without pullRequest", () => {
    expect(Result.isFailure(decodeRunListFile(frozen))).toBe(true);
  });

  it("reads a URL and null, and refuses an empty URL", () => {
    const urls = rows.map((row) => row["pullRequest"]);
    expect(urls).toEqual(["https://github.com/example/invoices/pull/12", null]);
    expect(
      Result.isFailure(decodeRunListFile({ ...current, runs: [{ ...rows[0], pullRequest: "" }] })),
    ).toBe(true);
  });
});
