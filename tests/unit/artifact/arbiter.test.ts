import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  describeArbiter,
  needsOperatorName,
  parseArbiterDeclaration,
  resolveArbiter,
  type ArbiterDeclaration,
} from "../../../src/domain/artifact/arbiter.js";
import { GRANT_PATTERN } from "../../../src/schemas/approvedBy.js";

function refusal<A>(result: Either.Either<A, string>): string {
  if (Either.isRight(result)) throw new Error("expected a refusal");
  return result.left;
}

describe("parseArbiterDeclaration", () => {
  it("reads operator", () => {
    expect(parseArbiterDeclaration("operator")).toEqual(Either.right({ kind: "operator" }));
  });

  it("reads a machine and its grant", () => {
    expect(parseArbiterDeclaration("machine:roadmap-loop")).toEqual(
      Either.right({ kind: "machine", grant: "roadmap-loop" }),
    );
  });

  it.each(["machine:Roadmap Loop", "machine:a.b", "machine:", "machine:-x", "machine:name@1.2"])(
    "refuses %s, naming the grant pattern",
    (raw) => {
      expect(refusal(parseArbiterDeclaration(raw))).toContain(GRANT_PATTERN.source);
    },
  );

  it("refuses anything else, naming both forms", () => {
    const message = refusal(parseArbiterDeclaration("bogus"));
    expect(message).toContain("--by operator");
    expect(message).toContain("--by machine:<grant>");
  });
});

describe("resolveArbiter", () => {
  const operator: ArbiterDeclaration = { kind: "operator" };
  const machine: ArbiterDeclaration = { kind: "machine", grant: "roadmap-loop" };

  it.each([true, false])("resolves a declared machine with terminal %s and no user.name", (tty) => {
    expect(resolveArbiter({ declared: machine, stdinIsTerminal: tty, gitUserName: null })).toEqual(
      Either.right({ kind: "machine", grant: "roadmap-loop" }),
    );
  });

  it.each([true, false])("resolves a declared operator by user.name, terminal %s", (tty) => {
    expect(
      resolveArbiter({ declared: operator, stdinIsTerminal: tty, gitUserName: "Ada Lovelace" }),
    ).toEqual(Either.right({ kind: "operator", name: "Ada Lovelace" }));
  });

  it("defaults to the operator from a terminal", () => {
    expect(
      resolveArbiter({ declared: null, stdinIsTerminal: true, gitUserName: "Ada Lovelace" }),
    ).toEqual(Either.right({ kind: "operator", name: "Ada Lovelace" }));
  });

  it("refuses no declaration without a terminal, naming both forms", () => {
    const message = refusal(
      resolveArbiter({ declared: null, stdinIsTerminal: false, gitUserName: "Ada Lovelace" }),
    );
    expect(message).toContain("--by operator");
    expect(message).toContain("--by machine:<grant>");
  });

  it.each([
    ["a declared operator", operator, false, null],
    ["a declared operator", operator, true, ""],
    ["the terminal default", null, true, null],
    ["the terminal default", null, true, ""],
  ] as const)(
    "refuses %s without a user.name (%#), naming git config user.name",
    (_label, declared, tty, name) => {
      const message = refusal(
        resolveArbiter({ declared, stdinIsTerminal: tty, gitUserName: name }),
      );
      expect(message).toContain("git config user.name");
    },
  );
});

describe("needsOperatorName", () => {
  it("is true for a declared operator, and for no declaration only at a terminal", () => {
    expect(needsOperatorName({ kind: "operator" }, false)).toBe(true);
    expect(needsOperatorName({ kind: "machine", grant: "roadmap-loop" }, true)).toBe(false);
    expect(needsOperatorName(null, true)).toBe(true);
    expect(needsOperatorName(null, false)).toBe(false);
  });
});

describe("describeArbiter", () => {
  it("names each kind", () => {
    expect(describeArbiter({ kind: "machine", grant: "roadmap-loop" })).toBe(
      "machine (roadmap-loop)",
    );
    expect(describeArbiter({ kind: "operator", name: "Ada Lovelace" })).toBe(
      "operator (Ada Lovelace)",
    );
    expect(describeArbiter({ kind: "unattributed" })).toBe("unattributed");
  });
});
