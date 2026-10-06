import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  readComplianceReviewFile,
  readGateAttributionFile,
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
  type MissingFact,
  type PersistedReadError,
  type PersistedSpec,
} from "../../src/schemas/persisted.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { compareReleases, schemaUrl, type FormatId } from "../../src/schemas/schemaUrl.js";
import {
  latestPreSchema,
  preSchemaDocuments,
  validDocuments,
  versionOnePhaseRecordManifest,
  withKey,
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

  it("refuses a document a newer release wrote, before decoding it", () => {
    const toy = bornSpec();
    const release = `${Number(PHAX_RELEASE.split(".")[0]) + 1}.0.0`;
    const doc = { $schema: schemaUrl("plan-approval-record", release), name: "gamma" };
    expect(left(readSchemaBornPersisted(doc, toy)).message).toBe(
      `${FILE}: toy record written by phax ${release} is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it`,
    );
    expect(toy.calls).toEqual({ current: 0 });
  });
});

describe("withSchemaUrl", () => {
  it("puts $schema first, naming the format at the running release", () => {
    const stamped = withSchemaUrl("registry", { runs: [] });
    expect(Object.keys(stamped)).toEqual(["$schema", "runs"]);
    expect(stamped.$schema).toBe(schemaUrl("registry", PHAX_RELEASE));
    expect(stamped.$schema).toBe(`https://docs.phax.run/schemas/registry/${PHAX_RELEASE}.json`);
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
  it.each<readonly ["run-status" | "phase-status", StatusReader, string]>([
    ["run-status", readRunStatusFile, "run status"],
    ["phase-status", readPhaseStatusFile, "phase status"],
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
          withKey(preSchemaDocuments[id], "$schema", schemaUrl(id, PHAX_RELEASE)),
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
    const wrongUrl = withKey(validDocuments[id], "$schema", schemaUrl("registry", PHAX_RELEASE));
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
      message: `${file}: ${label} written by phax ${release} is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it`,
    });
  });
});
