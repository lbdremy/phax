import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  LAST_RELEASE_WITHOUT_BRIEF_ANSWER,
  currentSchemaUrl,
  describeBriefAnswerError,
  describeReportError,
  readBriefAnswer,
  readBriefRecordFile,
  readBriefReport,
  readBriefRequestFile,
  readComplianceReviewFile,
  readGateAttributionFile,
  readGateDiagnosticsAnswer,
  readGateReport,
  readPersisted,
  readPhaseFileReconciliationFile,
  readPhaxPlanFile,
  readPlanApprovalsFile,
  readPlanDocumentFile,
  readPlanRecordFile,
  readRecordManifestFile,
  readPhaseStatusFile,
  readRegistryFile,
  readRunStatusFile,
  readSchemaBornPersisted,
  readSpecApprovalsFile,
  readSpecDocumentFile,
  readSpecRecordFile,
  withSchemaUrl,
  type AnswerBounds,
  type BriefAnswerError,
  type GateDiagnosticsAnswerError,
  type MissingFact,
  type PersistedReadError,
  type PersistedSpec,
  type ReportError,
} from "../../src/schemas/persisted.js";
import { CURRENT_STAMPS, PHAX_RELEASE } from "../../src/schemas/release.js";
import {
  FORMAT_IDS,
  compareReleases,
  schemaUrl,
  type FormatId,
} from "../../src/schemas/schemaUrl.js";
import {
  EXAMPLE_BASE,
  latestPreSchema,
  preSchemaDocuments,
  validDocuments,
  versionOnePhaseRecordManifest,
  withKey,
  withoutKey,
} from "./schemasPackage/documents.js";

// Toy formats: a pre-schema shape with `version: 1`, and a current shape with
// a `$schema` string. Every document is made up.
const ToyPreSchema = Schema.Struct({ version: Schema.Literal(1), name: Schema.NonEmptyString });
const ToyCurrent = Schema.Struct({ $schema: Schema.String, name: Schema.NonEmptyString });

type Toy = { readonly name: string; readonly from: "current" | "pre-schema" };

const FILE = "/work/example-repo/toy.json";

function spec(
  overrides: Partial<PersistedSpec<typeof ToyCurrent.Type, typeof ToyPreSchema.Type, Toy>> = {},
): PersistedSpec<typeof ToyCurrent.Type, typeof ToyPreSchema.Type, Toy> & {
  readonly calls: { current: number; preSchema: number };
} {
  const calls = { current: 0, preSchema: 0 };
  const decodeCurrent = Schema.decodeUnknownEither(ToyCurrent);
  const decodePreSchema = Schema.decodeUnknownEither(ToyPreSchema);
  return {
    format: "registry",
    label: "toy document",
    file: FILE,
    decodeCurrent: (input) => {
      calls.current += 1;
      return decodeCurrent(input);
    },
    decodePreSchema: (input) => {
      calls.preSchema += 1;
      return decodePreSchema(input);
    },
    fromCurrent: (value) => ({ name: value.name, from: "current" }),
    fromPreSchema: (value) => Either.right({ name: value.name, from: "pre-schema" }),
    ...overrides,
    calls,
  };
}

function left<A>(result: Either.Either<A, PersistedReadError>): PersistedReadError {
  if (Either.isRight(result)) throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  return result.left;
}

function right<A>(result: Either.Either<A, PersistedReadError>): A {
  if (Either.isLeft(result)) throw new Error(`expected a value, got ${result.left.message}`);
  return result.right;
}

describe("readPersisted", () => {
  it("refuses a non-object, naming the file", () => {
    for (const input of [null, [], "text", 3]) {
      const error = left(readPersisted(input, spec()));
      expect(error).toEqual({
        _tag: "PersistedReadError",
        file: FILE,
        format: "registry",
        message: `${FILE}: a toy document is a JSON object`,
      });
    }
  });

  it("reads a $schema document only by the current decoder, even when the pre-schema decoder would accept it", () => {
    const toy = spec();
    const doc = { $schema: "https://example.test/toy.json", version: 1, name: "alpha" };
    expect(right(readPersisted(doc, toy))).toEqual({ name: "alpha", from: "current" });
    expect(toy.calls).toEqual({ current: 1, preSchema: 0 });
  });

  it("refuses a $schema document the current decoder rejects, naming the file and the violation", () => {
    const toy = spec();
    const doc = { $schema: "https://example.test/toy.json", version: 1, name: "" };
    const error = left(readPersisted(doc, toy));
    expect(error.message).toMatch(new RegExp(`^${FILE}: name: `));
    expect(toy.calls).toEqual({ current: 1, preSchema: 0 });
  });

  it("reads a document without $schema through the pre-schema decoder and its step", () => {
    const toy = spec();
    expect(right(readPersisted({ version: 1, name: "beta" }, toy))).toEqual({
      name: "beta",
      from: "pre-schema",
    });
    expect(toy.calls).toEqual({ current: 0, preSchema: 1 });
  });

  it("refuses a pre-schema document whose step reports a missing fact, naming the file and the fact", () => {
    const missing: MissingFact = { fact: "the run's branch" };
    const toy = spec({ fromPreSchema: () => Either.left(missing) });
    const error = left(readPersisted({ version: 1, name: "gamma" }, toy));
    expect(error.message).toBe(
      `${FILE}: toy document written before $schema lacks the run's branch, which phax needs — not supported`,
    );
  });

  it("refuses a document without $schema that the pre-schema decoder rejects, naming the file and the violation", () => {
    const toy = spec();
    const error = left(readPersisted({ version: 2, name: "delta" }, toy));
    expect(error.message).toMatch(
      new RegExp(
        `^${FILE}: toy document without \\$schema is not in the pre-schema shape — older than the first release that writes \\$schema, or damaged \\(version: `,
      ),
    );
    expect(toy.calls).toEqual({ current: 0, preSchema: 1 });
  });

  it("never throws, even when a decoder sees an odd value", () => {
    expect(() => readPersisted(Object.create(null), spec())).not.toThrow();
  });
});

describe("readSchemaBornPersisted", () => {
  function bornSpec() {
    const calls = { current: 0 };
    const decodeCurrent = Schema.decodeUnknownEither(ToyCurrent);
    return {
      format: "plan-approval-record" as const,
      label: "toy record",
      file: FILE,
      decodeCurrent: (input: unknown) => {
        calls.current += 1;
        return decodeCurrent(input);
      },
      fromCurrent: (value: typeof ToyCurrent.Type): Toy => ({ name: value.name, from: "current" }),
      calls,
    };
  }

  it("refuses a non-object, naming the file", () => {
    for (const input of [null, [], "text", 3]) {
      expect(left(readSchemaBornPersisted(input, bornSpec()))).toEqual({
        _tag: "PersistedReadError",
        file: FILE,
        format: "plan-approval-record",
        message: `${FILE}: a toy record is a JSON object`,
      });
    }
  });

  it("reads a $schema document by the current decoder", () => {
    const toy = bornSpec();
    const doc = { $schema: "https://example.test/toy.json", name: "alpha" };
    expect(right(readSchemaBornPersisted(doc, toy))).toEqual({ name: "alpha", from: "current" });
    expect(toy.calls).toEqual({ current: 1 });
  });

  it("refuses a document without $schema, naming the file, and tries no decoder", () => {
    const toy = bornSpec();
    const error = left(readSchemaBornPersisted({ version: 1, name: "beta" }, toy));
    expect(error.message).toBe(
      `${FILE}: toy record has no $schema — every toy record is written with one`,
    );
    expect(toy.calls).toEqual({ current: 0 });
  });

  it("refuses a document stamped newer than the running version, before decoding it", () => {
    const toy = bornSpec();
    const release = `${Number(PHAX_RELEASE.split(".")[0]) + 1}.0.0`;
    const doc = { $schema: schemaUrl("plan-approval-record", release), name: "gamma" };
    expect(left(readSchemaBornPersisted(doc, toy)).message).toBe(
      `${FILE}: toy record ${release} is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it`,
    );
    expect(toy.calls).toEqual({ current: 0 });
  });
});

describe("withSchemaUrl", () => {
  it("puts $schema first, naming the format at its current stamp", () => {
    const stamped = withSchemaUrl("registry", { runs: [] });
    expect(Object.keys(stamped)).toEqual(["$schema", "runs"]);
    expect(stamped.$schema).toBe(currentSchemaUrl("registry"));
    expect(stamped.$schema).toBe(
      `https://docs.phax.run/schemas/registry/${CURRENT_STAMPS.registry}.json`,
    );
  });

  // A format that last changed before the running version is stamped with that
  // earlier release; no stamp is ever above the running version.
  it.each(FORMAT_IDS)("stamps %s with its current stamp, not the running version", (id) => {
    expect(withSchemaUrl(id, {}).$schema).toBe(currentSchemaUrl(id));
    expect(currentSchemaUrl(id)).toBe(schemaUrl(id, CURRENT_STAMPS[id]));
    expect(compareReleases(CURRENT_STAMPS[id], PHAX_RELEASE)).toBeLessThanOrEqual(0);
  });

  it("keeps the value's own keys in their order", () => {
    expect(Object.keys(withSchemaUrl("run-status", { b: 1, a: 2 }))).toEqual(["$schema", "b", "a"]);
  });
});

describe("format readers", () => {
  it("readRegistryFile reads a pre-schema registry, dropping version", () => {
    const registry = right(
      readRegistryFile("/home/example/.phax/registry.json", preSchemaDocuments.registry),
    );
    const { version: _version, ...rest } = preSchemaDocuments.registry;
    expect(registry).toEqual(rest);
    expect(registry).not.toHaveProperty("version");
  });

  it("readRegistryFile reads a registry phax wrote, dropping $schema", () => {
    const registry = right(
      readRegistryFile("/home/example/.phax/registry.json", validDocuments.registry),
    );
    expect(registry).toEqual({ runs: preSchemaDocuments.registry["runs"] });
    expect(registry).not.toHaveProperty("$schema");
  });

  it("readRegistryFile reads a registry another release wrote in the same shape", () => {
    const doc = withKey(validDocuments.registry, "$schema", schemaUrl("registry", "0.1.0"));
    expect(right(readRegistryFile("registry.json", doc)).runs).toHaveLength(1);
  });

  it("readRegistryFile refuses a $schema registry the current decoder rejects, naming the file", () => {
    const file = "/home/example/.phax/registry.json";
    const doc = withKey(validDocuments.registry, "$schema", schemaUrl("run-status", "0.1.0"));
    const error = left(readRegistryFile(file, doc));
    expect(error.format).toBe("registry");
    expect(error.message).toMatch(new RegExp(`^${file}: .*\\$schema`));
    expect(error.message).not.toContain("without $schema");
  });

  it("readRegistryFile does not rescue a $schema registry with the pre-schema decoder", () => {
    const doc = withKey(preSchemaDocuments.registry, "$schema", "not a url");
    expect(Either.isLeft(readRegistryFile("registry.json", doc))).toBe(true);
  });

  it("readRegistryFile refuses a registry in no known shape, naming the file", () => {
    const file = "/home/example/.phax/registry.json";
    const error = left(readRegistryFile(file, withKey(preSchemaDocuments.registry, "version", 7)));
    expect(error.format).toBe("registry");
    expect(error.message).toMatch(new RegExp(`^${file}: run registry without \\$schema`));
  });

  type StatusReader = (file: string, input: unknown) => Either.Either<object, PersistedReadError>;
  it.each<readonly ["run-status", StatusReader, string]>([
    ["run-status", readRunStatusFile, "run status"],
  ])("%s: reads both shapes to the same in-memory value", (id, read, label) => {
    const file = `/home/example/.phax/runs/example.example-run/${id}.json`;
    const fromPreSchema = right(read(file, preSchemaDocuments[id]));
    const fromCurrent = right(read(file, validDocuments[id]));
    const { version: _version, ...expected } = preSchemaDocuments[id];
    expect(fromPreSchema).toEqual(expected);
    expect(fromCurrent).toEqual(expected);
    expect(fromCurrent).not.toHaveProperty("$schema");
    expect(fromPreSchema).not.toHaveProperty("version");

    const another = withKey(validDocuments[id], "$schema", schemaUrl(id, "0.1.0"));
    expect(right(read(file, another))).toEqual(expected);

    const rejected = left(read(file, withKey(preSchemaDocuments[id], "state", "paused")));
    expect(rejected.format).toBe(id);
    expect(rejected.message).toMatch(new RegExp(`^${file}: ${label} without \\$schema`));

    const wrongUrl = withKey(validDocuments[id], "$schema", schemaUrl("registry", "0.1.0"));
    const refused = left(read(file, wrongUrl));
    expect(refused.message).toMatch(new RegExp(`^${file}: .*\\$schema`));
    expect(refused.message).not.toContain("without $schema");
  });

  describe("phase-status: base", () => {
    const file = "/home/example/.phax/runs/example.example-run/phase-01/status.json";

    it("reads a status with base back unchanged, dropping $schema", () => {
      const { $schema: _schema, ...expected } = validDocuments["phase-status"];
      const status = right(readPhaseStatusFile(file, validDocuments["phase-status"]));
      expect(status).toEqual(expected);
      expect(status).toHaveProperty("base", EXAMPLE_BASE);
    });

    it("refuses a $schema status without base, naming the file", () => {
      const error = left(
        readPhaseStatusFile(file, withoutKey(validDocuments["phase-status"], "base")),
      );
      expect(error.format).toBe("phase-status");
      expect(error.message).toMatch(new RegExp(`^${file}: .*base`));
      expect(error.message).not.toContain("without $schema");
    });

    it("refuses a pre-schema status: it lacks base", () => {
      const error = left(readPhaseStatusFile(file, preSchemaDocuments["phase-status"]));
      expect(error.format).toBe("phase-status");
      expect(error.message).toBe(
        `${file}: phase status written before $schema lacks base, which phax needs — not supported`,
      );
    });

    it("refuses a base that is not a full commit sha", () => {
      const short = withKey(validDocuments["phase-status"], "base", "0123456");
      expect(left(readPhaseStatusFile(file, short)).message).toMatch(new RegExp(`^${file}: `));
    });
  });

  type StrictReader = (file: string, input: unknown) => Either.Either<object, PersistedReadError>;
  type StrictFormat =
    | "phax-plan"
    | "compliance-review"
    | "plan-approvals"
    | "spec-approvals"
    | "spec-document"
    | "plan-document";
  const RUN_DIR = "/home/example/.phax/runs/example.example-run";
  it.each<readonly [StrictFormat, StrictReader, string, string]>([
    ["phax-plan", readPhaxPlanFile, "phax-plan", `${RUN_DIR}/phax-plan.json`],
    [
      "compliance-review",
      readComplianceReviewFile,
      "compliance review",
      `${RUN_DIR}/compliance-review.json`,
    ],
    ["plan-approvals", readPlanApprovalsFile, "plan approvals ledger", "docs/plans/approvals.json"],
    ["spec-approvals", readSpecApprovalsFile, "spec approvals ledger", "docs/specs/approvals.json"],
    ["spec-document", readSpecDocumentFile, "spec document", "docs/specs/2609230835-example.json"],
    [
      "plan-document",
      readPlanDocumentFile,
      "plan document",
      "docs/plans/2609230835-example-plan.json",
    ],
  ])("%s: reads both shapes to the same in-memory value", (id, read, label, file) => {
    const expected = latestPreSchema(id);
    const fromPreSchema = right(read(file, preSchemaDocuments[id]));
    const fromCurrent = right(read(file, validDocuments[id]));
    expect(fromPreSchema).toEqual(expected);
    expect(fromCurrent).toEqual(expected);
    expect(fromCurrent).not.toHaveProperty("$schema");
    expect(fromPreSchema).not.toHaveProperty("version");

    // Both shapes stay strict: an unknown key is refused, naming the file.
    const strictPre = left(read(file, withKey(preSchemaDocuments[id], "extra", true)));
    expect(strictPre.format).toBe(id);
    expect(strictPre.message).toMatch(new RegExp(`^${file}: ${label} without \\$schema`));
    const strictCurrent = left(read(file, withKey(validDocuments[id], "extra", true)));
    expect(strictCurrent.message).toMatch(new RegExp(`^${file}: `));
    expect(strictCurrent.message).not.toContain("without $schema");

    // A $schema document is never rescued by the pre-schema decoder.
    const both = left(
      read(file, withKey(preSchemaDocuments[id], "$schema", schemaUrl(id, "0.1.0"))),
    );
    expect(both.message).not.toContain("without $schema");
  });

  describe("plan-document: completesSpec", () => {
    const file = "docs/plans/2609230835-example-plan.json";
    const specPath = "docs/specs/2609230835-example.md";

    it("steps a spec-less pre-schema sidecar to completesSpec: null", () => {
      expect(right(readPlanDocumentFile(file, preSchemaDocuments["plan-document"]))).toMatchObject({
        sourceSpec: null,
        completesSpec: null,
      });
    });

    it("refuses a pre-schema sidecar beside a spec path rather than invent completesSpec", () => {
      const beside = withKey(preSchemaDocuments["plan-document"], "sourceSpec", specPath);
      expect(left(readPlanDocumentFile(file, beside)).message).toBe(
        `${file}: plan document written before $schema lacks completesSpec, which phax needs — not supported`,
      );
    });

    it("refuses a $schema sidecar written before completesSpec (0.17.0–0.19.x)", () => {
      const { completesSpec: _unrecorded, ...older } = validDocuments["plan-document"];
      const refused = left(
        readPlanDocumentFile(file, withKey(older, "$schema", schemaUrl("plan-document", "0.19.0"))),
      );
      expect(refused.message).toBe(`${file}: completesSpec: is missing`);
    });

    it("reads a current sidecar beside a spec path with its boolean", () => {
      const current = {
        ...validDocuments["plan-document"],
        sourceSpec: specPath,
        completesSpec: false,
      };
      expect(right(readPlanDocumentFile(file, current))).toMatchObject({
        sourceSpec: specPath,
        completesSpec: false,
      });
    });
  });

  it.each<readonly ["phase-record-manifest" | "authoring-record-manifest", string, string]>([
    ["phase-record-manifest", "phase record manifest", "run-0001/phase-01/record.json"],
    ["authoring-record-manifest", "authoring record manifest", "authoring/auth-0001/record.json"],
  ])(
    "readRecordManifestFile reads both %s shapes to the same in-memory value",
    (id, label, file) => {
      const { version: _version, ...expected } = preSchemaDocuments[id];
      const fromPreSchema = right(readRecordManifestFile(file, preSchemaDocuments[id]));
      const fromCurrent = right(readRecordManifestFile(file, validDocuments[id]));
      expect(fromPreSchema).toEqual(expected);
      expect(fromCurrent).toEqual(expected);
      expect(fromCurrent).not.toHaveProperty("$schema");
      expect(fromPreSchema).not.toHaveProperty("version");

      // Both shapes stay strict: an unknown key is refused, naming the file.
      const strictPre = left(readRecordManifestFile(file, withKey(preSchemaDocuments[id], "x", 1)));
      expect(strictPre.format).toBe(id);
      expect(strictPre.message).toMatch(new RegExp(`^${file}: ${label} without \\$schema`));
      const strictCurrent = left(readRecordManifestFile(file, withKey(validDocuments[id], "x", 1)));
      expect(strictCurrent.message).toMatch(new RegExp(`^${file}: `));
      expect(strictCurrent.message).not.toContain("without $schema");

      // A $schema manifest is never rescued by the pre-schema decoder.
      const both = left(
        readRecordManifestFile(
          file,
          withKey(preSchemaDocuments[id], "$schema", currentSchemaUrl(id)),
        ),
      );
      expect(both.message).not.toContain("without $schema");
    },
  );

  it("readRecordManifestFile keeps an authoring manifest's kind and never invents a sourceSha", () => {
    const { sourceSha: _sha, ...uncommitted } = validDocuments["authoring-record-manifest"];
    const manifest = right(readRecordManifestFile("authoring/auth-0001/record.json", uncommitted));
    expect(manifest).toMatchObject({ kind: "authoring" });
    expect(manifest).not.toHaveProperty("sourceSha");
  });

  it("readRecordManifestFile refuses a version-1 phase manifest, naming the file", () => {
    const file = "run-0001/phase-01/record.json";
    const error = left(readRecordManifestFile(file, versionOnePhaseRecordManifest));
    expect(error.format).toBe("phase-record-manifest");
    expect(error.message).toMatch(
      new RegExp(
        `^${file}: phase record manifest without \\$schema is not in the pre-schema shape — older than the first release that writes \\$schema, or damaged`,
      ),
    );
  });

  it("readRecordManifestFile refuses a non-object as a record manifest", () => {
    expect(left(readRecordManifestFile("record.json", [])).message).toBe(
      "record.json: a record manifest is a JSON object",
    );
  });

  type TimelineReader = (file: string, input: unknown) => Either.Either<object, PersistedReadError>;
  type TimelineFormat = "gate-attribution" | "phase-file-reconciliation";
  it.each<readonly [TimelineFormat, TimelineReader, string, string, string]>([
    [
      "gate-attribution",
      readGateAttributionFile,
      "gate attribution",
      `${RUN_DIR}/phase-01/gate-attribution.json`,
      "steps",
    ],
    [
      "phase-file-reconciliation",
      readPhaseFileReconciliationFile,
      "phase file reconciliation",
      `${RUN_DIR}/phase-01/file-reconciliation.json`,
      "hasDeviations",
    ],
  ])("%s: reads both shapes to the same in-memory value", (id, read, label, file, wrongKey) => {
    // The pre-schema file never carried a version: it is the in-memory value as it is.
    const expected = preSchemaDocuments[id];
    const fromPreSchema = right(read(file, preSchemaDocuments[id]));
    const fromCurrent = right(read(file, validDocuments[id]));
    expect(fromPreSchema).toEqual(expected);
    expect(fromCurrent).toEqual(expected);
    expect(fromCurrent).not.toHaveProperty("$schema");

    // Both shapes ignore an unknown key, as they always have.
    expect(right(read(file, withKey(preSchemaDocuments[id], "extra", true)))).toMatchObject(
      expected,
    );
    expect(right(read(file, withKey(validDocuments[id], "extra", true)))).toMatchObject(expected);

    const rejected = left(read(file, withKey(preSchemaDocuments[id], wrongKey, "none")));
    expect(rejected.format).toBe(id);
    expect(rejected.message).toMatch(new RegExp(`^${file}: ${label} without \\$schema`));

    // A $schema document is never rescued by the pre-schema decoder.
    const wrongUrl = withKey(validDocuments[id], "$schema", currentSchemaUrl("registry"));
    const refused = left(read(file, wrongUrl));
    expect(refused.message).toMatch(new RegExp(`^${file}: .*\\$schema`));
    expect(refused.message).not.toContain("without $schema");
  });
});

describe("documents from another release", () => {
  // Every release derives from PHAX_RELEASE, so a release cut leaves the table
  // right; each row asserts its own precondition, so a cut that voids one fails
  // loudly instead of silently testing nothing.
  const [major, minor, patch] = PHAX_RELEASE.split(".").map(Number) as [number, number, number];
  const older =
    patch > 0
      ? `${major}.${minor}.${patch - 1}`
      : minor > 0
        ? `${major}.${minor - 1}.0`
        : `${major - 1}.0.0`;

  // `sortsAbove`: whether the release string sorts above PHAX_RELEASE, for the
  // rows where lexical and numeric order must disagree.
  type Case = readonly [name: string, release: string, newer: boolean, sortsAbove: boolean | null];
  const releases: ReadonlyArray<Case> = [
    ["newer patch", `${major}.${minor}.${patch + 1}`, true, null],
    ["newer minor", `${major}.${minor + 1}.0`, true, null],
    ["newer major", `${major + 1}.0.0`, true, null],
    // A minor with more digits: numerically newer, sorts lower as a string.
    ["newer but lexically lower", `${major}.${10 ** String(minor).length}.0`, true, false],
    ["equal", PHAX_RELEASE, false, null],
    ["older", older, false, null],
    // A single-digit minor below a two-digit one: older, sorts higher as a string.
    ["older but lexically higher", `${major}.9.0`, false, true],
  ];

  it.each(releases)("the %s case (%s) holds its precondition", (_name, release, newer, above) => {
    const order = compareReleases(release, PHAX_RELEASE);
    if (newer) expect(order).toBeGreaterThan(0);
    else expect(order).toBeLessThanOrEqual(0);
    if (above !== null) expect(release > PHAX_RELEASE).toBe(above);
  });

  type AnyReader = (file: string, input: unknown) => Either.Either<object, PersistedReadError>;
  const readers: ReadonlyArray<readonly [FormatId, AnyReader, string]> = [
    ["registry", readRegistryFile, "run registry"],
    ["run-status", readRunStatusFile, "run status"],
    ["phase-status", readPhaseStatusFile, "phase status"],
    ["phax-plan", readPhaxPlanFile, "phax-plan"],
    ["compliance-review", readComplianceReviewFile, "compliance review"],
    ["plan-approvals", readPlanApprovalsFile, "plan approvals ledger"],
    ["spec-approvals", readSpecApprovalsFile, "spec approvals ledger"],
    ["spec-document", readSpecDocumentFile, "spec document"],
    ["plan-document", readPlanDocumentFile, "plan document"],
    ["gate-attribution", readGateAttributionFile, "gate attribution"],
    ["phase-file-reconciliation", readPhaseFileReconciliationFile, "phase file reconciliation"],
    ["phase-record-manifest", readRecordManifestFile, "phase record manifest"],
    ["authoring-record-manifest", readRecordManifestFile, "authoring record manifest"],
    ["plan-approval-record", readPlanRecordFile, "plan approval record"],
    ["spec-approval-record", readSpecRecordFile, "spec approval record"],
    ["brief-request", readBriefRequestFile, "brief request"],
    ["brief-record", readBriefRecordFile, "brief record"],
  ];

  const table = readers.flatMap(([id, read, label]) =>
    releases.map(([name, release, newer]) => [id, name, read, label, release, newer] as const),
  );

  it.each(table)("%s at the %s release", (id, _name, read, label, release, newer) => {
    const file = `/home/example/.phax/example/${id}.json`;
    const result = read(file, withKey(validDocuments[id], "$schema", schemaUrl(id, release)));
    if (!newer) {
      right(result);
      return;
    }
    const error = left(result);
    expect(error).toEqual({
      _tag: "PersistedReadError",
      file,
      format: id,
      message: `${file}: ${label} ${release} is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it`,
    });
  });
});

// A development build opened at 0.21.0, while a format's current stamp is
// 0.20.0 (unchanged this cycle) or 0.21.0 (changed this cycle).
const UNCHANGED = { current: "0.20.0", running: "0.21.0" } as const;
const CHANGED = { current: "0.21.0", running: "0.21.0" } as const;

function refusal(input: unknown, bounds?: AnswerBounds): GateDiagnosticsAnswerError {
  const result = readGateDiagnosticsAnswer(input, bounds);
  if (Either.isRight(result)) throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  return result.left;
}

describe("readGateDiagnosticsAnswer", () => {
  const invariant = {
    rule: "no-cycles",
    class: "invariant",
    location: { file: "src/example/a.ts", line: 4 },
    message: "a imports b, which imports a",
    repair: "move the shared type into its own module",
  } as const;

  const at = (release: string) => ({
    $schema: schemaUrl("gate-diagnostics", release),
    diagnostics: [invariant],
  });

  it("decodes a document at the current stamp and drops $schema and extra keys", () => {
    const result = readGateDiagnosticsAnswer({
      $schema: currentSchemaUrl("gate-diagnostics"),
      diagnostics: [invariant],
      generator: "example-audit",
    });
    expect(result).toEqual(Either.right({ diagnostics: [invariant] }));
  });

  it("reads every stamp from the current stamp up to the running version", () => {
    for (const release of ["0.20.0", "0.20.1", "0.21.0"]) {
      expect(readGateDiagnosticsAnswer(at(release), UNCHANGED)).toEqual(
        Either.right({ diagnostics: [invariant] }),
      );
    }
    expect(readGateDiagnosticsAnswer(at("0.21.0"), CHANGED)).toEqual(
      Either.right({ diagnostics: [invariant] }),
    );
  });

  it("refuses a stamp above the running version by name", () => {
    expect(refusal(at("0.22.0"), UNCHANGED)).toEqual({
      kind: "newer",
      message: "gate-diagnostics 0.22.0 is newer than this phax (0.21.0) — upgrade phax to read it",
    });
  });

  it("refuses a stamp below the current stamp as an older shape, naming the URL it reads", () => {
    expect(refusal(at("0.20.0"), CHANGED)).toEqual({
      kind: "older",
      message:
        "gate-diagnostics 0.20.0 is an older shape — this phax reads https://docs.phax.run/schemas/gate-diagnostics/0.21.0.json",
    });
  });

  it("keeps the saved-file refusal at or below 0.19.0, whatever the bounds", () => {
    for (const bounds of [UNCHANGED, CHANGED]) {
      expect(refusal(at("0.18.0"), bounds)).toEqual({
        kind: "malformed",
        reason: "gate-diagnostics 0.18.0 names the saved file's shape, not a gate step's document",
      });
    }
  });

  it.each([
    ["no $schema", { diagnostics: [] }],
    ["a gate-attribution URL", { $schema: currentSchemaUrl("gate-attribution"), diagnostics: [] }],
    ["a malformed URL", { $schema: "https://example.com/gate-diagnostics.json", diagnostics: [] }],
    ["the 0.18.0 release", { $schema: schemaUrl("gate-diagnostics", "0.18.0"), diagnostics: [] }],
    [
      "a schema violation",
      {
        $schema: currentSchemaUrl("gate-diagnostics"),
        diagnostics: [{ ...invariant, class: "warning" }],
      },
    ],
  ])("refuses %s as malformed", (_name, input) => {
    const error = refusal(input);
    expect(error.kind).toBe("malformed");
    expect(error.kind === "malformed" ? error.reason : "").not.toBe("");
  });

  it("refuses a non-object as malformed and never throws", () => {
    for (const value of [null, undefined, 3, "text", ["a"], { $schema: 4 }]) {
      expect(refusal(value).kind).toBe("malformed");
    }
  });

  // The reader decodes every answer release with the current decoder, which is
  // right only while one answer shape exists. An answer shape is the `next`
  // snapshot or a release-named one newer than 0.19.0, the last release whose
  // shape described only the saved file.
  it("is written for a single answer shape", () => {
    const dir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../packages/schemas/snapshots/gate-diagnostics",
    );
    const answerShapes = readdirSync(dir)
      .map((file) => file.replace(/\.schema\.json$/, ""))
      .filter(
        (name) =>
          name === "next" || (/^\d+\.\d+\.\d+$/.test(name) && compareReleases(name, "0.19.0") > 0),
      );
    expect(
      answerShapes,
      "a second gate-diagnostics answer shape: teach readGateDiagnosticsAnswer to decode each answer release with its own shape",
    ).toHaveLength(1);
  });
});

function briefRefusal(input: unknown, bounds?: AnswerBounds): BriefAnswerError {
  const result = readBriefAnswer(input, bounds);
  if (Either.isRight(result)) throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  return result.left;
}

describe("readBriefAnswer", () => {
  const guarantee = {
    id: "core-no-adapters",
    statement: "src/core imports no adapter from src/infra",
    places: [
      {
        location: { file: "src/core/billing/invoice.ts", line: 3 },
        state: "forbidden",
        due: "this-phase",
        what: "imports src/infra/stripe.ts",
        repair: "depend on PaymentPort from src/core/billing/port.ts",
      },
      { location: { file: "src/core/billing/port.ts" }, state: "met" },
    ],
  } as const;

  const at = (release: string) => ({
    $schema: schemaUrl("brief-answer", release),
    guarantees: [guarantee],
  });

  it("is pinned to the release current when the format was added", () => {
    expect(LAST_RELEASE_WITHOUT_BRIEF_ANSWER).toBe("0.19.0");
  });

  it("decodes an answer at the current stamp and drops $schema and extra keys", () => {
    const result = readBriefAnswer({
      $schema: currentSchemaUrl("brief-answer"),
      guarantees: [guarantee],
      generator: "example-brief",
    });
    expect(result).toEqual(Either.right({ guarantees: [guarantee] }));
  });

  it("decodes an empty answer", () => {
    const answer = { $schema: currentSchemaUrl("brief-answer"), guarantees: [] };
    expect(readBriefAnswer(answer)).toEqual(Either.right({ guarantees: [] }));
  });

  it("reads every stamp from the current stamp up to the running version", () => {
    for (const bounds of [UNCHANGED, CHANGED]) {
      expect(readBriefAnswer(at("0.21.0"), bounds)).toEqual(
        Either.right({ guarantees: [guarantee] }),
      );
    }
    expect(readBriefAnswer(at("0.20.0"), UNCHANGED)).toEqual(
      Either.right({ guarantees: [guarantee] }),
    );
  });

  it("refuses a stamp above the running version by name", () => {
    expect(briefRefusal(at("0.22.0"), UNCHANGED)).toEqual({
      kind: "newer",
      reason: "brief-answer 0.22.0 is newer than this phax (0.21.0) — upgrade phax to read it",
    });
  });

  it("refuses a stamp below the current stamp as an older shape, naming the URL it reads", () => {
    expect(briefRefusal(at("0.20.0"), CHANGED)).toEqual({
      kind: "older",
      reason:
        "brief-answer 0.20.0 is an older shape — this phax reads https://docs.phax.run/schemas/brief-answer/0.21.0.json",
    });
  });

  it("keeps 'has no known shape' at or below 0.19.0, whatever the bounds", () => {
    for (const bounds of [UNCHANGED, CHANGED]) {
      expect(briefRefusal(at("0.19.0"), bounds)).toEqual({
        kind: "schema",
        reason: "brief-answer 0.19.0 has no known shape",
      });
    }
  });

  it("refuses an answer without $schema", () => {
    expect(briefRefusal({ guarantees: [] })).toEqual({
      kind: "schema",
      reason: "a brief-answer document must carry $schema",
    });
  });

  it.each([
    ["a gate-diagnostics URL", currentSchemaUrl("gate-diagnostics")],
    ["not a url", "not a url"],
    ["a number", 4],
  ])("refuses %s at $schema, naming the value", (_name, value) => {
    const error = briefRefusal({ $schema: value, guarantees: [] });
    expect(error.kind).toBe("schema");
    expect(error.reason).toContain(JSON.stringify(value));
  });

  it("refuses a release at or below the last release without the format", () => {
    expect(briefRefusal({ $schema: schemaUrl("brief-answer", "0.18.0"), guarantees: [] })).toEqual({
      kind: "schema",
      reason: "brief-answer 0.18.0 has no known shape",
    });
  });

  it("refuses a variant violation as a shape error", () => {
    const error = briefRefusal({
      $schema: currentSchemaUrl("brief-answer"),
      guarantees: [{ ...guarantee, places: [{ location: { file: "a.ts" }, state: "stale" }] }],
    });
    expect(error.kind).toBe("shape");
    expect(error.reason).toMatch(/^schema mismatch: /);
  });

  it("refuses a non-object as a shape error and never throws", () => {
    for (const value of [null, undefined, 3, "text", ["a"]]) {
      expect(briefRefusal(value).kind).toBe("shape");
    }
  });

  it("describes each error in one line that names the URL this phax reads", () => {
    const reads = `this phax reads ${currentSchemaUrl("brief-answer")}`;
    expect(describeBriefAnswerError({ kind: "schema", reason: "x" })).toBe(
      `brief answer refused at $schema: x; ${reads}`,
    );
    expect(describeBriefAnswerError({ kind: "newer", reason: "y" })).toBe(
      `brief answer refused at $schema: y; ${reads}`,
    );
    expect(describeBriefAnswerError({ kind: "shape", reason: "z" })).toBe(
      `brief answer refused: z; ${reads}`,
    );
    const older = briefRefusal(at("0.20.0"), CHANGED);
    expect(describeBriefAnswerError(older)).toBe(
      `brief answer refused at $schema: ${older.reason}`,
    );
    expect(describeBriefAnswerError(briefRefusal({ guarantees: [] }))).toBe(
      `brief answer refused at $schema: a brief-answer document must carry $schema; ${reads}`,
    );
  });

  // The reader decodes every answer release with the current decoder, which is
  // right only while one answer shape exists. An answer shape is the `next`
  // snapshot or a release-named one newer than LAST_RELEASE_WITHOUT_BRIEF_ANSWER.
  it("is written for a single answer shape", () => {
    const dir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../packages/schemas/snapshots/brief-answer",
    );
    const answerShapes = readdirSync(dir)
      .map((file) => file.replace(/\.schema\.json$/, ""))
      .filter(
        (name) =>
          name === "next" ||
          (/^\d+\.\d+\.\d+$/.test(name) &&
            compareReleases(name, LAST_RELEASE_WITHOUT_BRIEF_ANSWER) > 0),
      );
    expect(
      answerShapes,
      "a second brief-answer answer shape: teach readBriefAnswer to decode each answer release with its own shape",
    ).toHaveLength(1);
  });
});

// Both reports are born at 0.21.0: `BORN` plays the release that opened them,
// `MOVED` a later one whose current stamp moved on.
const BORN = { current: "0.21.0", running: "0.21.0" } as const;
const MOVED = { current: "0.22.0", running: "0.22.0" } as const;

const reportFinding = {
  id: "no-node-import src/greet.ts node:fs",
  rule: "a module under src/ imports no node: module",
  location: { file: "src/greet.ts", lines: [1, 1] },
  message: "imports node:fs",
  related: [{ file: "src/cli.ts", lines: [3, 5], why: "the caller, where the read belongs" }],
  guide: { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" },
} as const;

const gateReportAt = (release: string) => ({
  $schema: schemaUrl("gate-report", release),
  outcome: "checked",
  findings: [reportFinding],
  review: [],
});

const briefReportAt = (release: string) => ({
  $schema: schemaUrl("brief-report", release),
  rules: [],
  findings: [{ ...reportFinding, due: null }],
});

function reportRefusal(result: Either.Either<unknown, ReportError>): ReportError {
  if (Either.isRight(result)) throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  return result.left;
}

const GATE_REPORT_URL = "https://docs.phax.run/schemas/gate-report/0.21.0.json";
const BRIEF_REPORT_URL = "https://docs.phax.run/schemas/brief-report/0.21.0.json";

interface ReportReaderCase {
  readonly format: "gate-report" | "brief-report";
  readonly read: (input: unknown, bounds?: AnswerBounds) => Either.Either<unknown, ReportError>;
  readonly at: (release: string) => Readonly<Record<string, unknown>>;
  readonly url: string;
  /** Another format's document: its id, a release and its body without `$schema`. */
  readonly others: ReadonlyArray<readonly [FormatId, string, Readonly<Record<string, unknown>>]>;
}

const REPORT_READERS: ReadonlyArray<ReportReaderCase> = [
  {
    format: "gate-report",
    read: readGateReport,
    at: gateReportAt,
    url: GATE_REPORT_URL,
    others: [
      ["gate-diagnostics", "0.20.0", { diagnostics: [] }],
      ["brief-report", "0.21.0", { rules: [], findings: [] }],
    ],
  },
  {
    format: "brief-report",
    read: readBriefReport,
    at: briefReportAt,
    url: BRIEF_REPORT_URL,
    others: [
      ["brief-answer", "0.20.0", { guarantees: [] }],
      ["gate-report", "0.21.0", { outcome: "checked", findings: [], review: [] }],
    ],
  },
];

describe.each(REPORT_READERS)("$format reader", ({ format, read, at, url, others }) => {
  it("reads a document at its current stamp whole, $schema included", () => {
    expect(read(at("0.21.0"), BORN)).toEqual(Either.right(at("0.21.0")));
  });

  it("reads with the current stamp and the running version by default", () => {
    expect(currentSchemaUrl(format)).toBe(url);
    expect(read(at(CURRENT_STAMPS[format]))).toEqual(Either.right(at(CURRENT_STAMPS[format])));
  });

  it.each(others)(
    "refuses a %s/%s document by name, giving the URL it reads",
    (other, release, body) => {
      const error = reportRefusal(read({ $schema: schemaUrl(other, release), ...body }, BORN));
      expect(error).toEqual({
        kind: "malformed",
        reads: url,
        reason: `${other} is not read by this phax — it reads ${url}`,
      });
      expect(describeReportError(error)).toBe(
        `${other} is not read by this phax — it reads ${url}`,
      );
    },
  );

  it("refuses a format id unknown to this build by name", () => {
    const error = reportRefusal(
      read({ $schema: "https://docs.phax.run/schemas/lint-report/0.21.0.json" }, BORN),
    );
    expect(describeReportError(error)).toBe(
      `lint-report is not read by this phax — it reads ${url}`,
    );
  });

  it("refuses a stamp above the running version by name", () => {
    const message = `${format} 0.22.0 is newer than this phax (0.21.0) — upgrade phax to read it`;
    const error = reportRefusal(read(at("0.22.0"), BORN));
    expect(error).toEqual({ kind: "newer", reads: url, message });
    expect(describeReportError(error)).toBe(`${message}; this phax reads ${url}`);
  });

  it("refuses a stamp below the current stamp as an older shape, naming the URL it reads", () => {
    const moved = schemaUrl(format, "0.22.0");
    const message = `${format} 0.21.0 is an older shape — this phax reads ${moved}`;
    const error = reportRefusal(read(at("0.21.0"), MOVED));
    expect(error).toEqual({ kind: "older", reads: moved, message });
    expect(describeReportError(error)).toBe(message);
  });

  it("refuses a document without $schema, naming the URL it reads", () => {
    const { $schema: _schema, ...unstamped } = at("0.21.0");
    const error = reportRefusal(read(unstamped, BORN));
    expect(error.kind).toBe("malformed");
    expect(describeReportError(error)).toBe(
      `a ${format} document carries $schema; this phax reads ${url}`,
    );
  });

  it("refuses a $schema that is not a phax schema URL, naming the value", () => {
    const error = reportRefusal(read({ ...at("0.21.0"), $schema: "not a url" }, BORN));
    expect(describeReportError(error)).toBe(
      `$schema "not a url" is not a phax schema URL; this phax reads ${url}`,
    );
  });

  it("refuses a non-object as malformed and never throws", () => {
    for (const value of [null, undefined, 3, "text", ["a"]]) {
      expect(reportRefusal(read(value, BORN)).kind).toBe("malformed");
    }
  });

  it("refuses a decode failure with the key path, naming the URL it reads", () => {
    const error = reportRefusal(read({ ...at("0.21.0"), debt: [] }, BORN));
    expect(error.kind).toBe("malformed");
    expect(describeReportError(error)).toMatch(
      new RegExp(`^debt: is unexpected, .*; this phax reads ${url.replaceAll(".", "\\.")}$`),
    );
  });

  // The reader decodes every stamp with the current decoder, which is right
  // only while one shape exists: the `next` snapshot or one release-named.
  it("is written for a single report shape", () => {
    const dir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      `../../packages/schemas/snapshots/${format}`,
    );
    expect(
      readdirSync(dir),
      `a second ${format} shape: teach its reader to decode each release with its own shape`,
    ).toHaveLength(1);
  });
});

// A file another release wrote in the same shape stays readable: the stamp
// names the shape, not the build, so neither a cut nor an opening refuses it.
describe("files stamped by an earlier release in the current shape", () => {
  type Reader = (file: string, input: unknown) => Either.Either<object, PersistedReadError>;
  it.each<readonly [FormatId, Reader, string]>([
    ["registry", readRegistryFile, "0.20.0"],
    ["run-status", readRunStatusFile, "0.20.0"],
    ["phase-status", readPhaseStatusFile, "0.20.0"],
    ["phax-plan", readPhaxPlanFile, "0.20.0"],
    ["run-status", readRunStatusFile, "0.19.0"],
  ])("reads a %s stamped %s", (id, read, release) => {
    const document = withKey(validDocuments[id], "$schema", schemaUrl(id, release));
    expect(Either.isRight(read(`${id}.json`, document))).toBe(true);
  });
});

describe("brief request and record files", () => {
  const requestFile = "/work/example-repo/.phax-context/brief-request.json";
  const recordFile = "/home/example/.phax/runs/example/phase-02/brief-01.json";

  it("readBriefRequestFile reads the phase request, dropping $schema", () => {
    const document = validDocuments["brief-request"];
    expect(right(readBriefRequestFile(requestFile, document))).toEqual(
      withoutKey(document, "$schema"),
    );
  });

  it("readBriefRequestFile reads the outside request, dropping $schema", () => {
    const document = { $schema: currentSchemaUrl("brief-request"), files: ["src/a.ts"] };
    expect(right(readBriefRequestFile(requestFile, document))).toEqual({ files: ["src/a.ts"] });
  });

  it("readBriefRecordFile drops only the record's own $schema", () => {
    const document = validDocuments["brief-record"];
    const record = right(readBriefRecordFile(recordFile, document));
    expect(record).toEqual(withoutKey(document, "$schema"));
    expect(record.request).toHaveProperty("$schema");
    expect(record.outcome.kind === "answered" && record.outcome.answer).toHaveProperty("$schema");
  });

  type BriefReader = (file: string, input: unknown) => Either.Either<object, PersistedReadError>;
  it.each<readonly [string, BriefReader, string, Readonly<Record<string, unknown>>]>([
    [requestFile, readBriefRequestFile, "brief request", validDocuments["brief-request"]],
    [recordFile, readBriefRecordFile, "brief record", validDocuments["brief-record"]],
  ])("%s without $schema is refused", (file, read, label, document) => {
    expect(left(read(file, withoutKey(document, "$schema"))).message).toBe(
      `${file}: ${label} has no $schema — every ${label} is written with one`,
    );
  });
});
