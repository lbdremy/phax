import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AssignmentsSchema } from "../../../src/schemas/assignments.js";
import { formatConfigParseError } from "../../../src/schemas/formatError.js";
import { decodePhaxConfig } from "../../../src/schemas/phaxConfig.js";

const decodeAssignments = Schema.decodeUnknownEither(AssignmentsSchema, {
  onExcessProperty: "error",
});

// The spec §6 example, for a made-up acme-billing repository.
const EXAMPLE = [
  {
    kind: "part",
    part: "core-decide",
    model: "claude-opus-5-5",
    effort: { min: "medium", max: "high" },
  },
  {
    kind: "globs",
    globs: ["src/*/schemas/**"],
    model: "claude-sonnet-5-5",
    effort: { min: "medium", max: "high" },
  },
  { kind: "part", part: "docs", model: "claude-haiku-5-5", effort: { min: "low", max: "medium" } },
];

const [PART, GLOBS] = EXAMPLE as unknown as [Record<string, unknown>, Record<string, unknown>];

/** The config decode refusal for a phax.json carrying these assignments, or "OK". */
function configRefusal(assignments: unknown): string {
  const raw = {
    version: 1,
    name: "acme-billing",
    gateProfiles: { fast: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
    assignments,
  };
  const decoded = decodePhaxConfig(raw);
  return Either.isLeft(decoded) ? formatConfigParseError(raw, decoded.left) : "OK";
}

describe("AssignmentsSchema", () => {
  it("decodes the spec §6 example in list order", () => {
    const decoded = decodeAssignments(EXAMPLE);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) expect(decoded.right).toEqual(EXAMPLE);
  });

  it("admits a range whose min equals its max", () => {
    expect(
      Either.isRight(decodeAssignments([{ ...PART, effort: { min: "high", max: "high" } }])),
    ).toBe(true);
  });

  it.each([
    ["an unknown kind", [{ ...PART, kind: "path" }]],
    ["a part bound carrying globs", [{ ...PART, globs: ["src/**"] }]],
    ["a globs bound carrying part", [{ ...GLOBS, part: "docs" }]],
    ["an empty globs list", [{ ...GLOBS, globs: [] }]],
    ["a glob with braces", [{ ...GLOBS, globs: ["src/{a,b}/**"] }]],
    ["an unknown key", [{ ...PART, note: "why" }]],
    ["an effort outside the vocabulary", [{ ...PART, effort: { min: "huge", max: "high" } }]],
    ["a missing max", [{ ...PART, effort: { min: "low" } }]],
    ["a missing model", [{ kind: "part", part: "docs", effort: { min: "low", max: "low" } }]],
    ["an empty list", []],
    ["a part id that is not a kebab-case slug", [{ ...PART, part: "Core-Decide" }]],
    ["a part id with a backtick", [{ ...PART, part: "core`decide" }]],
  ])("refuses %s", (_label, assignments) => {
    expect(Either.isLeft(decodeAssignments(assignments))).toBe(true);
  });
});

describe("phax.json assignments decode messages", () => {
  it("accepts the example", () => {
    expect(configRefusal(EXAMPLE)).toBe("OK");
  });

  it("names assignments[1] and kind for an unknown kind", () => {
    expect(configRefusal([PART, { ...PART, kind: "path" }])).toBe(
      '  assignments[1].kind: Expected "part" | "globs", actual "path"',
    );
  });

  it("names assignments[1] and globs for a part bound carrying globs", () => {
    expect(configRefusal([PART, { ...PART, globs: ["src/**"] }])).toBe(
      '  assignments[1].globs: is unexpected, expected: "kind" | "part" | "model" | "effort"',
    );
  });

  it("names assignments[1] and globs for an empty globs list", () => {
    expect(configRefusal([PART, { ...GLOBS, globs: [] }])).toBe(
      "  assignments[1].globs: must not be empty",
    );
  });

  it("names the glob a globs bound refuses", () => {
    expect(configRefusal([PART, { ...GLOBS, globs: ["src/{a,b}/**"] }])).toBe(
      '  assignments[1].globs[0]: "src/{a,b}/**" uses braces',
    );
  });

  it("names assignments[0].effort.min once for an effort outside the vocabulary", () => {
    expect(configRefusal([{ ...PART, effort: { min: "huge", max: "high" } }])).toBe(
      '  assignments[0].effort.min: Expected "none" | "off" | "low" | "medium" | "high" | "xhigh" | "max" | "ultracode" | "ultra", actual "huge"',
    );
  });

  it("names assignments for an empty list", () => {
    expect(configRefusal([])).toBe(
      "  assignments: must not be empty: omit the key to declare no bounds",
    );
  });

  it("leaves every other path dotted", () => {
    const raw = {
      version: 1,
      name: "acme-billing",
      gateProfiles: { fast: [{ command: "pnpm test", surface: "nowhere", firing: "every-phase" }] },
    };
    const decoded = decodePhaxConfig(raw);
    expect(Either.isLeft(decoded) && formatConfigParseError(raw, decoded.left)).toMatch(
      /^ {2}gateProfiles\.fast\.0\.surface: /,
    );
  });
});
