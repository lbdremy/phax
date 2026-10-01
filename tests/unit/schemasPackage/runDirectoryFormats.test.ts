import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
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
} from "../../../packages/schemas/src/index.js";
import { newerReleaseMessage } from "../../../packages/schemas/src/shapes.js";
import { decodeComplianceReview } from "../../../src/schemas/complianceReview.js";
import { decodePhaxPlan } from "../../../src/schemas/phaxPlan.js";
import { decodeRegistry } from "../../../src/schemas/registry.js";
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { decodePhaseStatus, decodeRunStatus } from "../../../src/schemas/status.js";
import { validDocuments, withKey, withoutKey } from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;

interface RunDirectoryFormat {
  readonly id: FormatId;
  readonly parse: (input: unknown) => {
    readonly ok: boolean;
    readonly shape?: string;
    readonly value?: unknown;
  };
  readonly phax: Decode;
  readonly toLatest: (value: never) => unknown;
}

const FORMATS: ReadonlyArray<RunDirectoryFormat> = [
  { id: "registry", parse: parseRegistry, phax: decodeRegistry, toLatest: toLatestRegistry },
  { id: "run-status", parse: parseRunStatus, phax: decodeRunStatus, toLatest: toLatestRunStatus },
  {
    id: "phase-status",
    parse: parsePhaseStatus,
    phax: decodePhaseStatus,
    toLatest: toLatestPhaseStatus,
  },
  { id: "phax-plan", parse: parsePhaxPlan, phax: decodePhaxPlan, toLatest: toLatestPhaxPlan },
  {
    id: "compliance-review",
    parse: parseComplianceReview,
    phax: decodeComplianceReview,
    toLatest: toLatestComplianceReview,
  },
];

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

describe.each(FORMATS)("$id", (format) => {
  const document = validDocuments[format.id];

  it("parses the document as shape pre-schema, with phax's value", () => {
    const phax = format.phax(document);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(format.parse(document)).toEqual({ ok: true, shape: "pre-schema", value: phax.right });
  });

  it("fails a document the frozen decoder rejects as older than the first release that writes $schema", () => {
    const result = format.parse(withKey(document, "version", 0)) as {
      readonly ok: boolean;
      readonly error?: { readonly path: string; readonly message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error?.path).toBe("version");
    expect(result.error?.message).toContain("older than the first release that writes $schema");
  });

  it("upgrades by dropping version and keeping everything else", () => {
    const result = format.parse(document);
    if (!result.ok) throw new Error("document rejected");
    expect(format.toLatest(result.value as never)).toEqual(withoutKey(document, "version"));
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(document, "$schema", schemaUrl(format.id, NEWER_RELEASE));
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
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
