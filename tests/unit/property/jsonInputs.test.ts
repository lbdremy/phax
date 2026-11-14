// In-phase checks of the hand-written JSON generators: a mutation changes a valid document at
// exactly one key path, a stamped object reaches every malformed-stamp kind, and a newer stamp is
// above the running release by exactly one step.
import { isDeepStrictEqual } from "node:util";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FORMAT_IDS, SCHEMA_URL_BASE } from "../../../src/schemas/schemaUrl.js";
import { FORMAT_REGISTRY } from "../../helpers/property/formatRegistry.js";
import { checkProperty, propertyTimeout, runProperty } from "../../helpers/property/harness.js";
import {
  anyJson,
  mutations,
  newerStamped,
  stampedObject,
} from "../../helpers/property/jsonInputs.js";

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A key's own value, never an inherited one: JSON.parse makes "__proto__" an own data key, and
// reading it back from an object that lacks it must give undefined, not Object.prototype.
const own = (value: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined;

// Every path where two JSON documents differ, descending only while both sides are objects, or
// both are arrays of one length.
const differences = (
  a: unknown,
  b: unknown,
  path: ReadonlyArray<string | number> = [],
): unknown[] => {
  if (isDeepStrictEqual(a, b)) return [];
  if (isObject(a) && isObject(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      differences(own(a, key), own(b, key), [...path, key]),
    );
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((item, index) => differences(item, b[index], [...path, index]));
  }
  return [path];
};

const typeOf = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

// What JSON.parse builds: ordinary objects, arrays, and finite numbers (-0 is a finite number).
const isParsedJson = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.every(isParsedJson);
  if (typeof value === "object" && value !== null) {
    return (
      Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isParsedJson)
    );
  }
  return typeof value !== "number" || Number.isFinite(value);
};

describe("anyJson", () => {
  it(
    "yields what JSON.parse would build",
    () => {
      checkProperty(anyJson(), isParsedJson);
    },
    propertyTimeout(),
  );
});

describe.each(FORMAT_IDS)("mutations of %s", (id) => {
  it(
    "differ from their source at exactly one key path",
    () => {
      checkProperty(mutations(FORMAT_REGISTRY[id]), ({ source, mutated, path, kind }) => {
        if (!isDeepStrictEqual(differences(source, mutated), [path])) return false;
        // A replacement is of another JSON type than the value it replaces.
        if (kind === "replace") {
          const before = path.reduce<unknown>((node, step) => (node as never)[step], source);
          const after = path.reduce<unknown>((node, step) => (node as never)[step], mutated);
          return typeOf(before) !== typeOf(after);
        }
        return true;
      });
    },
    propertyTimeout(),
  );
});

describe("mutations", () => {
  it("reach nested objects and array elements, by removal and by replacement", () => {
    const outcomes = new Set<string>();
    const outcome = runProperty(
      mutations(FORMAT_REGISTRY["plan-document"]),
      ({ source, path, kind }) => {
        outcomes.add(kind);
        if (path.length > 1) outcomes.add("nested");
        const node = path
          .slice(0, -1)
          .reduce<unknown>((parent, step) => (parent as never)[step], source);
        if (Array.isArray(node)) outcomes.add("array element");
        return true;
      },
      {
        env: { PHAX_PROPERTY_SEED: "1", PHAX_PROPERTY_RUNS: "200" },
        location: { file: "tests/unit/property/jsonInputs.test.ts", name: "mutations" },
      },
    );
    expect(outcome.kind).toBe("passed");
    expect([...outcomes].toSorted()).toEqual(["array element", "nested", "remove", "replace"]);
  });
});

// The kind of a `$schema` value, judged from its text alone.
const stampKind = (id: string, stamp: unknown): string => {
  if (typeof stamp !== "string") return "non-string";
  if (!stamp.startsWith(`${SCHEMA_URL_BASE}/`)) return "other-base";
  const rest = stamp.slice(SCHEMA_URL_BASE.length + 1);
  const match = /^([^/]+)\/(.+?)(\.json)?$/.exec(rest);
  if (match === null) return "other";
  const [, named, release, json] = match;
  if (json === undefined) return "missing-json";
  if (!(FORMAT_IDS as ReadonlyArray<string>).includes(named ?? "")) return "unknown-format";
  if (named !== id) return "other-format";
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release ?? "")
    ? "well-formed"
    : "malformed-release";
};

describe("stampedObject", () => {
  it("reaches every malformed-stamp kind, and the well-formed one", () => {
    const kinds = new Set<string>();
    const outcome = runProperty(
      stampedObject("run-status"),
      (document) => {
        kinds.add(stampKind("run-status", document["$schema"]));
        return true;
      },
      {
        env: { PHAX_PROPERTY_SEED: "1", PHAX_PROPERTY_RUNS: "400" },
        location: { file: "tests/unit/property/jsonInputs.test.ts", name: "stampedObject" },
      },
    );
    expect(outcome.kind).toBe("passed");
    expect([...kinds].toSorted()).toEqual([
      "malformed-release",
      "missing-json",
      "non-string",
      "other-base",
      "other-format",
      "unknown-format",
      "well-formed",
    ]);
  });

  it(
    "carries exactly one $schema entry, over arbitrary entries",
    () => {
      checkProperty(stampedObject("registry"), (document) => "$schema" in document);
    },
    propertyTimeout(),
  );
});

describe("newerStamped", () => {
  const parse = (release: string): [number, number, number] => {
    const [x = 0, y = 0, z = 0] = release.split(".").map(Number);
    return [x, y, z];
  };

  it(
    "is above the running release by exactly one patch, minor or major step",
    () => {
      const running = "1.2.3";
      const seen = new Set<string>();
      checkProperty(
        newerStamped("run-status", running, fc.dictionary(fc.string(), fc.constant(null))),
        ({ release, step, document }) => {
          seen.add(step);
          const [x, y, z] = parse(release);
          const expected = {
            patch: [1, 2, 4],
            minor: [1, 3, 0],
            major: [2, 0, 0],
          }[step];
          return (
            isDeepStrictEqual([x, y, z], expected) &&
            document["$schema"] === `${SCHEMA_URL_BASE}/run-status/${release}.json`
          );
        },
      );
      expect([...seen].toSorted()).toEqual(["major", "minor", "patch"]);
    },
    propertyTimeout(),
  );

  it(
    "replaces a $schema entry of the body with the newer stamp",
    () => {
      checkProperty(
        newerStamped("run-status", "1.2.3", fc.constant({ $schema: "stale", kept: 1 })),
        ({ release, document }) =>
          document["kept"] === 1 &&
          document["$schema"] === `${SCHEMA_URL_BASE}/run-status/${release}.json`,
      );
    },
    propertyTimeout(),
  );
});

// Found by the daily deep pass (2,000 runs, seed 2085412975): removing an own "__proto__" key read
// as a difference deep inside Object.prototype, not at the removed key.
describe("differences", () => {
  it("names a removed own __proto__ key as the one path that differs", () => {
    const source: unknown = JSON.parse('{"answer":{"__proto__":{"x":{}},"k":1}}');
    const mutated: unknown = JSON.parse('{"answer":{"k":1}}');
    expect(differences(source, mutated)).toEqual([["answer", "__proto__"]]);
  });
});
