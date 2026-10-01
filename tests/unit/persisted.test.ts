import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  readPersisted,
  readRecordManifestFile,
  readRegistryFile,
  withSchemaUrl,
  type MissingFact,
  type PersistedReadError,
  type PersistedSpec,
} from "../../src/schemas/persisted.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import {
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

  it("readRecordManifestFile reads a pre-schema phase manifest", () => {
    const doc = preSchemaDocuments["phase-record-manifest"];
    expect(right(readRecordManifestFile("run-0001/phase-01/record.json", doc))).toEqual(doc);
  });

  it("readRecordManifestFile reads a pre-schema authoring manifest", () => {
    const doc = preSchemaDocuments["authoring-record-manifest"];
    expect(right(readRecordManifestFile("authoring/auth-0001/record.json", doc))).toEqual(doc);
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
});
