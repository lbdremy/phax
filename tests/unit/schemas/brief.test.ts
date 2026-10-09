import { describe, expect, it } from "vitest";
import { Either } from "effect";
import {
  decodeBriefAnswerFile,
  decodeBriefRecordFile,
  decodeBriefRequestFile,
} from "../../../src/schemas/brief.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";

// Every document here is made up.
const BASE = "0123456789abcdef0123456789abcdef01234567";

function phaseRequest(): Record<string, unknown> {
  return {
    $schema: currentSchemaUrl("brief-request"),
    phase: "phase-02",
    base: BASE,
    terminal: false,
    phases: [
      { id: "phase-01", files: ["src/billing/port.ts"] },
      { id: "phase-02", files: ["src/billing/invoice.ts"] },
    ],
    files: null,
  };
}

function outsideRequest(): Record<string, unknown> {
  return {
    $schema: currentSchemaUrl("brief-request"),
    files: ["src/billing/invoice.ts"],
  };
}

function answer(): Record<string, unknown> {
  return {
    $schema: currentSchemaUrl("brief-answer"),
    guarantees: [
      {
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
      },
      {
        id: "cli-commands-registered",
        statement: "every command module is registered in src/cli/index.ts",
        places: [
          {
            location: { file: "src/cli/index.ts" },
            state: "missing",
            due: "later",
            what: "invoiceCommand is not registered",
            repair: "register invoiceCommand in src/cli/index.ts",
          },
        ],
      },
      {
        id: "money-as-cents",
        statement: "amounts are integer cents",
        places: [
          {
            location: { file: "src/core/billing/legacy.ts", line: 40 },
            state: "accepted",
            what: "floats kept until the legacy export is retired",
          },
        ],
      },
    ],
  };
}

/** `answer()` with the first guarantee's places replaced. */
function withPlaces(places: ReadonlyArray<unknown>): Record<string, unknown> {
  const document = answer();
  const [first, ...rest] = document["guarantees"] as ReadonlyArray<Record<string, unknown>>;
  return { ...document, guarantees: [{ ...first, places }, ...rest] };
}

function decodes(decode: (input: unknown) => Either.Either<unknown, unknown>, input: unknown) {
  return Either.isRight(decode(input));
}

describe("the brief-request document", () => {
  it("decodes the in-phase variant, with null files and with a list", () => {
    const decoded = decodeBriefRequestFile(phaseRequest());
    expect(Either.isRight(decoded) && decoded.right).toEqual(phaseRequest());
    const named = { ...phaseRequest(), files: ["src/billing/tax.ts", "src/billing/invoice.ts"] };
    expect(decodes(decodeBriefRequestFile, named)).toBe(true);
  });

  it("decodes the outside variant: $schema and files only", () => {
    const decoded = decodeBriefRequestFile(outsideRequest());
    expect(Either.isRight(decoded) && decoded.right).toEqual(outsideRequest());
  });

  it("rejects an extra key in either variant", () => {
    expect(decodes(decodeBriefRequestFile, { ...phaseRequest(), touched: [] })).toBe(false);
    expect(decodes(decodeBriefRequestFile, { ...outsideRequest(), touched: [] })).toBe(false);
  });

  it.each(["$schema", "phase", "base", "terminal", "phases", "files"])(
    "rejects an in-phase request without %s",
    (key) => {
      const document = phaseRequest();
      delete document[key];
      expect(decodes(decodeBriefRequestFile, document)).toBe(false);
    },
  );

  it("rejects empty files in either variant, and null files outside a phase", () => {
    expect(decodes(decodeBriefRequestFile, { ...phaseRequest(), files: [] })).toBe(false);
    expect(decodes(decodeBriefRequestFile, { ...outsideRequest(), files: [] })).toBe(false);
    expect(decodes(decodeBriefRequestFile, { ...outsideRequest(), files: null })).toBe(false);
  });

  it("rejects an abbreviated base", () => {
    expect(decodes(decodeBriefRequestFile, { ...phaseRequest(), base: "0123456" })).toBe(false);
  });

  it("rejects a $schema naming another format", () => {
    const foreign = { ...phaseRequest(), $schema: currentSchemaUrl("gate-request") };
    expect(decodes(decodeBriefRequestFile, foreign)).toBe(false);
  });
});

describe("the brief-answer document", () => {
  it("decodes the spec's example", () => {
    const decoded = decodeBriefAnswerFile(answer());
    expect(Either.isRight(decoded) && decoded.right).toEqual(answer());
  });

  it("decodes an empty answer: nothing to report", () => {
    expect(decodes(decodeBriefAnswerFile, { ...answer(), guarantees: [] })).toBe(true);
  });

  it("decodes a null due", () => {
    const place = {
      location: { file: "src/a.ts" },
      state: "missing",
      due: null,
      what: "no test",
      repair: "add a test",
    };
    expect(decodes(decodeBriefAnswerFile, withPlaces([place]))).toBe(true);
  });

  it("ignores an extra key on a place, and drops it", () => {
    const decoded = decodeBriefAnswerFile(
      withPlaces([{ location: { file: "src/a.ts" }, state: "met", score: 3 }]),
    );
    if (Either.isLeft(decoded)) throw new Error("answer rejected");
    expect(decoded.right.guarantees[0]?.places[0]).toEqual({
      location: { file: "src/a.ts" },
      state: "met",
    });
  });

  it.each([
    ["an unknown state", [{ location: { file: "src/a.ts" }, state: "stale" }]],
    [
      "a missing place without repair",
      [{ location: { file: "src/a.ts" }, state: "missing", due: "later", what: "no test" }],
    ],
    [
      "a forbidden place without due",
      [{ location: { file: "src/a.ts" }, state: "forbidden", what: "x", repair: "y" }],
    ],
    ["an accepted place without what", [{ location: { file: "src/a.ts" }, state: "accepted" }]],
    [
      "an unknown due",
      [
        {
          location: { file: "src/a.ts" },
          state: "missing",
          due: "soon",
          what: "x",
          repair: "y",
        },
      ],
    ],
    ["a place at line 0", [{ location: { file: "src/a.ts", line: 0 }, state: "met" }]],
    ["no places", []],
  ])("rejects %s", (_name, places) => {
    expect(decodes(decodeBriefAnswerFile, withPlaces(places))).toBe(false);
  });

  it("rejects a $schema naming another format", () => {
    const foreign = { ...answer(), $schema: currentSchemaUrl("brief-request") };
    expect(decodes(decodeBriefAnswerFile, foreign)).toBe(false);
  });
});

describe("the brief-record document", () => {
  const pushed = {
    $schema: currentSchemaUrl("brief-record"),
    moment: "pushed",
    request: phaseRequest(),
    outcome: { kind: "answered", answer: { ...answer(), note: "kept as printed" } },
  };

  const pulled = {
    $schema: currentSchemaUrl("brief-record"),
    moment: "pulled",
    request: { ...phaseRequest(), files: ["src/billing/tax.ts"] },
    outcome: { kind: "failed", reason: "brief provider exited with code 1" },
  };

  it("decodes a pushed record with an answered outcome, keeping the answer as printed", () => {
    const decoded = decodeBriefRecordFile(pushed);
    expect(Either.isRight(decoded) && decoded.right).toEqual(pushed);
  });

  it("decodes a pulled record with a failed outcome", () => {
    expect(decodes(decodeBriefRecordFile, pulled)).toBe(true);
  });

  it("decodes a pulled record whose request is the outside variant", () => {
    expect(decodes(decodeBriefRecordFile, { ...pulled, request: outsideRequest() })).toBe(true);
  });

  it("rejects an extra top-level key", () => {
    expect(decodes(decodeBriefRecordFile, { ...pushed, phase: "phase-02" })).toBe(false);
  });

  it("rejects an extra key in the request or the outcome", () => {
    expect(
      decodes(decodeBriefRecordFile, { ...pushed, request: { ...phaseRequest(), extra: 1 } }),
    ).toBe(false);
    expect(
      decodes(decodeBriefRecordFile, { ...pulled, outcome: { ...pulled.outcome, code: 1 } }),
    ).toBe(false);
  });

  it("rejects an unknown moment", () => {
    expect(decodes(decodeBriefRecordFile, { ...pushed, moment: "later" })).toBe(false);
  });
});
