import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { FORMAT_DEFINITIONS } from "../../../packages/schemas/build/jsonSchemas.js";
import { CURRENT_SHAPES, PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  parseComplianceReview,
  parseDocument,
  parsePhaseStatus,
  parsePhaxPlan,
  parseRegistry,
  parseRunStatus,
  toLatestComplianceReview,
  toLatestPhaseStatus,
  toLatestPhaxPlan,
  toLatestRegistry,
  toLatestRunStatus,
  UNKNOWN,
  isUnknown,
} from "../../../packages/schemas/src/index.js";
import { newerReleaseMessage } from "../../../packages/schemas/src/shapes.js";
import { decodeComplianceReviewFile } from "../../../src/schemas/complianceReview.js";
import { decodePhaxPlanFile } from "../../../src/schemas/phaxPlan.js";
import { decodeRegistryFile } from "../../../src/schemas/registry.js";
import type { PreSchemaFormatId } from "../../../src/schemas/schemaUrl.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { decodePhaseStatusFile, decodeRunStatusFile } from "../../../src/schemas/status.js";
import {
  EXAMPLE_BASE,
  preSchemaDocuments,
  preSchemaUnsupported,
  validDocuments,
  withKey,
  withoutKey,
  type Doc,
} from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;

interface RunDirectoryFormat {
  readonly id: PreSchemaFormatId;
  readonly parse: (input: unknown) => {
    readonly ok: boolean;
    readonly shape?: string;
    readonly value?: unknown;
  };
  readonly phax: Decode;
  readonly toLatest: (value: never) => unknown;
  /** Facts a later shape added, as the upgrade marks them on a pre-schema document. */
  readonly unrecorded?: Doc;
  /** What the upgrade gives every phase of an older document, as the shape it read never carried it. */
  readonly phaseLift?: Doc;
}

const FORMATS: ReadonlyArray<RunDirectoryFormat> = [
  { id: "registry", parse: parseRegistry, phax: decodeRegistryFile, toLatest: toLatestRegistry },
  {
    id: "run-status",
    parse: parseRunStatus,
    phax: decodeRunStatusFile,
    toLatest: toLatestRunStatus,
  },
  {
    id: "phase-status",
    parse: parsePhaseStatus,
    phax: decodePhaseStatusFile,
    toLatest: toLatestPhaseStatus,
    // No phax that wrote a pre-schema status could run an interactive phase or stop.
    unrecorded: { base: UNKNOWN, mode: "headless", stop: null },
  },
  {
    id: "phax-plan",
    parse: parsePhaxPlan,
    phax: decodePhaxPlanFile,
    toLatest: toLatestPhaxPlan,
    // Every phase an older phax ran was headless, and no oracle phase existed.
    phaseLift: { mode: "headless", oracle: null },
  },
  {
    id: "compliance-review",
    parse: parseComplianceReview,
    phax: decodeComplianceReviewFile,
    toLatest: toLatestComplianceReview,
  },
];

const decodeFile: { readonly [F in "phax-plan" | "compliance-review"]: Decode } = {
  "phax-plan": decodePhaxPlanFile,
  "compliance-review": decodeComplianceReviewFile,
};

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

describe.each(FORMATS)("$id", (format) => {
  const document = validDocuments[format.id];
  const preSchema = preSchemaDocuments[format.id];
  const current = CURRENT_SHAPES[format.id];

  it("parses the pre-schema document as shape pre-schema", () => {
    expect(format.parse(preSchema)).toEqual({ ok: true, shape: "pre-schema", value: preSchema });
  });

  it("parses the document phax writes as its current shape, with phax's value", () => {
    const phax = format.phax(document);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(format.parse(document)).toEqual({ ok: true, shape: current, value: phax.right });
  });

  it("identifies the document phax writes by its $schema alone as its current shape (ac-identify-alone)", () => {
    expect(parseDocument(document)).toMatchObject({ ok: true, format: format.id, shape: current });
  });

  it("drops $schema when upgrading the document phax writes, and carries no version", () => {
    const result = format.parse(document);
    if (!result.ok) throw new Error("document rejected");
    const latest = format.toLatest(result.value as never);
    expect(latest).toEqual(withoutKey(document, "$schema"));
    expect(latest).not.toHaveProperty("version");
  });

  it("fails a document the frozen decoder rejects as older than the first supported release", () => {
    const result = format.parse(withKey(preSchema, "version", 0)) as {
      readonly ok: boolean;
      readonly error?: { readonly path: string; readonly message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error?.path).toBe("version");
    expect(result.error?.message).toContain(
      preSchemaUnsupported(FORMAT_DEFINITIONS[format.id].label),
    );
  });

  it("upgrades by dropping version, keeping everything else and marking what it never recorded", () => {
    const result = format.parse(preSchema);
    if (!result.ok) throw new Error("document rejected");
    const recorded = withoutKey(preSchema, "version");
    const phaseLift = format.phaseLift;
    expect(format.toLatest(result.value as never)).toEqual({
      ...recorded,
      ...format.unrecorded,
      ...(phaseLift === undefined
        ? {}
        : { phases: (recorded["phases"] as Doc[]).map((phase) => ({ ...phase, ...phaseLift })) }),
    });
  });

  it("upgrades the pre-schema document and the document phax writes to the same recorded facts", () => {
    const old = format.parse(preSchema);
    const written = format.parse(document);
    if (!old.ok || !written.ok) throw new Error("document rejected");
    const recorded = (latest: unknown): Doc =>
      Object.keys(format.unrecorded ?? {}).reduce(withoutKey, latest as Doc);
    expect(recorded(format.toLatest(written.value as never))).toEqual(
      recorded(format.toLatest(old.value as never)),
    );
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(document, "$schema", schemaUrl(format.id, NEWER_RELEASE));
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });
});

describe.each([
  { id: "run-status", parse: parseRunStatus },
  { id: "phase-status", parse: parsePhaseStatus },
] as const)("$id written by phax", ({ id, parse }) => {
  const written = validDocuments[id];

  it("fails at state when the state is unknown (ac-failure)", () => {
    const result = parse(withKey(written, "state", "paused"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toBe("state");
  });
});

describe.each([
  { id: "phax-plan", parse: parsePhaxPlan },
  { id: "compliance-review", parse: parseComplianceReview },
] as const)("$id written by phax", ({ id, parse }) => {
  const written = validDocuments[id];

  it("rejects an unknown key, as phax's strict decoder does", () => {
    const result = parse(withKey(written, "extra", true));
    expect(result.ok).toBe(false);
    expect(Either.isLeft(decodeFile[id](withKey(written, "extra", true)))).toBe(true);
  });

  it("rejects a document that carries both $schema and version", () => {
    expect(parse(withKey(written, "version", 1)).ok).toBe(false);
  });
});

describe("toLatestPhaxPlan", () => {
  it("keeps run.requiredCommands and every phase's planned-file lists as recorded", () => {
    const result = parsePhaxPlan(validDocuments["phax-plan"]);
    if (!result.ok) throw new Error("document rejected");
    const latest = toLatestPhaxPlan(result.value);
    expect(latest.run.requiredCommands).toEqual(result.value.run.requiredCommands);
    expect(latest.phases[0].plannedFilesToCreate).toEqual(["src/example.ts"]);
    expect(latest.phases[0].plannedFilesToEdit).toEqual(["src/index.ts"]);
    expect(latest.phases[0].optionalFilesToEdit).toEqual(["README.md"]);
  });
});

describe("the phax-plan's mode and oracle history", () => {
  const current = validDocuments["phax-plan"];
  /** A phax-plan as phax 0.17.0 through 0.25.x wrote it: `$schema`, phases without mode and oracle. */
  function older(release: string): Doc {
    const phases = (current["phases"] as Doc[]).map((phase) =>
      withoutKey(withoutKey(phase, "mode"), "oracle"),
    );
    return withKey(withKey(current, "phases", phases), "$schema", schemaUrl("phax-plan", release));
  }

  it("parses a 0.17.0 document as shape 0.17.0 through the frozen module", () => {
    const document = older("0.17.0");
    expect(parsePhaxPlan(document)).toEqual({ ok: true, shape: "0.17.0", value: document });
  });

  // Literal releases, not PACKAGE_VERSION: the answer must not change when a release is cut.
  it("reads a document stamped 0.25.0, the last release without mode, as shape 0.17.0", () => {
    expect(parsePhaxPlan(older("0.25.0"))).toMatchObject({ ok: true, shape: "0.17.0" });
  });

  it("refuses a document stamped 0.26.0, the first release with mode, that lacks it", () => {
    expect(parsePhaxPlan(older("0.26.0"))).toMatchObject({ ok: false });
  });

  it("lifts an older document's phases with mode headless and oracle null, keeping every recorded fact", () => {
    const result = parsePhaxPlan(older("0.17.0"));
    if (!result.ok) throw new Error("document rejected");
    expect(toLatestPhaxPlan(result.value)).toEqual(withoutKey(current, "$schema"));
  });

  it("keeps an interactive phase and its oracle as recorded", () => {
    const phases = (current["phases"] as Doc[]).map((phase) => ({
      ...phase,
      mode: "interactive",
      oracle: { dischargedBy: "phase-02", files: ["tests/a.test.ts"] },
    }));
    const result = parsePhaxPlan(withKey(current, "phases", phases));
    if (!result.ok) throw new Error("document rejected");
    expect(toLatestPhaxPlan(result.value).phases[0]).toMatchObject({
      mode: "interactive",
      oracle: { dischargedBy: "phase-02", files: ["tests/a.test.ts"] },
    });
  });
});

describe("the phase status's base history", () => {
  const current = validDocuments["phase-status"];
  /** A status as phax 0.20.0 through 0.26.x wrote it: `$schema` and base, no mode or stop. */
  const withBase = withoutKey(withoutKey(current, "mode"), "stop");
  /** A status as phax 0.17.0 through 0.19.x wrote it: `$schema`, no base. */
  function older(release: string): Doc {
    return withKey(withoutKey(withBase, "base"), "$schema", schemaUrl("phase-status", release));
  }

  it("parses a 0.20.0 document as shape 0.20.0 and lifts it as headless and never stopped", () => {
    const document = withKey(withBase, "$schema", schemaUrl("phase-status", "0.20.0"));
    const result = parsePhaseStatus(document);
    expect(result).toEqual({ ok: true, shape: "0.20.0", value: document });
    if (!result.ok) return;
    expect(toLatestPhaseStatus(result.value)).toEqual({
      ...withoutKey(document, "$schema"),
      mode: "headless",
      stop: null,
    });
  });

  it("parses a 0.17.0 document as shape 0.17.0 through the frozen module", () => {
    const document = older("0.17.0");
    expect(parsePhaseStatus(document)).toEqual({ ok: true, shape: "0.17.0", value: document });
  });

  // Literal releases, not PACKAGE_VERSION: the answer must not change when a release is cut.
  it("reads a document stamped 0.19.0, the last release without base, as shape 0.17.0", () => {
    expect(parsePhaseStatus(older("0.19.0"))).toMatchObject({ ok: true, shape: "0.17.0" });
  });

  it("refuses a document stamped 0.20.0, the first release with base, that lacks it", () => {
    expect(parsePhaseStatus(older("0.20.0"))).toMatchObject({ ok: false, error: { path: "base" } });
  });

  it("upgrades an older document with base Unknown, never a sha", () => {
    for (const document of [older("0.17.0"), preSchemaDocuments["phase-status"]]) {
      const result = parsePhaseStatus(document);
      if (!result.ok) throw new Error("document rejected");
      expect(isUnknown(toLatestPhaseStatus(result.value).base)).toBe(true);
    }
  });

  it("reads a document with base as the current shape and keeps its base", () => {
    const result = parsePhaseStatus(current);
    expect(result).toMatchObject({ ok: true, shape: CURRENT_SHAPES["phase-status"] });
    if (!result.ok) return;
    expect(toLatestPhaseStatus(result.value).base).toBe(EXAMPLE_BASE);
  });

  it("never keeps a base that is not a full commit sha", () => {
    const result = parsePhaseStatus(withKey(current, "base", "0123456"));
    expect(result).toMatchObject({ ok: false, error: { path: "base" } });
  });
});
